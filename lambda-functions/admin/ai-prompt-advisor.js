/**
 * THE AI PROMPT ADVISOR, AS A JOB.
 *
 *   POST /admin/ai-prompt-advisor           start one — 202 { jobId }
 *   GET  /admin/ai-prompt-advisor/{jobId}   read it   — { status, phase, error, result }
 *
 * WHY A JOB. `RestApi` is an HttpApi, whose 30-second integration timeout is a
 * hard ceiling that cannot be raised. The advisor asks Sonnet 4.6 for a long
 * structured reply, and on dev "improve" took 62,252 ms and "validate"
 * 34,963 ms. Both SUCCEEDED inside the Lambda and both reached the admin as a
 * gateway 503, because the gateway had already hung up. The generation
 * builders hit the same wall and this follows what they did
 * (shared/generation-jobs.js, shared/generation-handler.js): the POST
 * validates, authorises, records a job and self-invokes a worker with
 * `InvocationType: 'Event'`; the worker makes today's Bedrock call against the
 * function's own timeout and stores the outcome; the client polls.
 *
 * WHO. The same people as before: the authorizer admits `admins` only to every
 * `admin/*` route, and `ai-prompt-advisor` is deliberately NOT one of the
 * routes opened to hosts (auth/authorizer.js, HOST_ADMIN_ROUTES and
 * AI_JOB_POLL: it "shapes what the AI does for every organisation"). The
 * handler asks again with require-admin.js, as the draft helpers do, and that
 * covers the poll route too. A job is readable only by the user who started it,
 * acting for the same organisation — a job id is not a capability, and anything
 * else is "not found", never "not yours" (check-question-set.js, same rule).
 *
 * WHAT IS STORED, AND SEALED. The prompt being analysed is NOT stored: the POST
 * resolves it (reading the caller's own Workie through prompt-access.js, which
 * is also the read guard) and hands it to the worker in the invoke payload. The
 * job row carries who asked, the analysis type and the status until the worker
 * writes `result` — which quotes the Workie back and, for apply, rewrites its
 * two halves. The ticked fixes ride in the payload too, never on the row. For a caller acting inside an organisation `result` is
 * sealed under that org's key (ENCRYPTED_FIELDS.job); Engage's own library is
 * plaintext by decision, as every platform row is. Neither the prompt nor the
 * analysis is ever logged — lengths, ids, models and stop reasons only.
 *
 * THE CUT-OFF. An "improve" run logged "Could not parse AI response as JSON" on
 * a 16,581-character reply — about 4,000 tokens, which was the whole budget.
 * The format asked for every changed passage twice (before and after) AND the
 * full rewrite, so the model ran out mid-object and a truncation was reported
 * as a parse error. The budget is four times the old one, since time is no
 * longer the constraint; `stop_reason` is logged; and a reply that still ends
 * on `max_tokens` fails the job with a sentence saying so instead of storing
 * something nobody can read.
 *
 * TICK THE ADVICE, APPLY THE TICKED (2026-09-24). The owner: "It gave good
 * advice on validate quality, but you cant action that advice". Validate's
 * issues were never shown, Optimize rendered nothing, the halves were reviewed
 * JOINED so no advice could say which half it meant, and Improve's one-string
 * rewrite was pasted whole into Output Format. So, two lenses and one shape:
 *
 *   review  (was validate)          safety, bias, clarity, technical
 *   improve (was improve+optimize)  effectiveness, tightening
 *     → { overallScore, summary,
 *         issues: [{ id, severity: high|medium|low,
 *                    half: instructions|outputFormat|both, issue, fix }] }
 *
 *   apply   the two halves + ONLY the fixes the admin ticked
 *     → { instructions, outputFormat, applied: [id…] }
 *     (the model writes the halves between tags, not in JSON — parseRewrite)
 *
 * The halves go to the model separately and labelled. Every prompt carries
 * describeAuthoringRules() — the rules the save gate enforces — because the
 * advisor never knew them and its rewrites were refused at Save. `validate`
 * and `optimize` are still accepted, as the names of `review` and `improve`.
 * A half that no ticked fix names is handed back exactly as it went in,
 * whatever the model sent for it: "change nothing you were not asked to" is
 * enforced here, not hoped for.
 */
const { BedrockRuntimeClient, InvokeModelCommand } = require('@aws-sdk/client-bedrock-runtime');
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, GetCommand, UpdateCommand } = require('@aws-sdk/lib-dynamodb');
const { S3Client, GetObjectCommand } = require('@aws-sdk/client-s3');
const { LambdaClient, InvokeCommand } = require('@aws-sdk/client-lambda');
const { isKnownGameType, normalizeGameType } = require('./shared/game-types');
const { describeVariablesForPrompt, describeAuthoringRules } = require('./shared/template-variable-usage');
const { extractVariableTokens } = require('./shared/template-variables');
const {
  STATUS, jobKey, newJobId, createJob, getJob, failJob, isCallersJob,
} = require('./shared/generation-jobs');
const { requireAdmin, callerUsername } = require('./shared/require-admin');
const { callerUserId } = require('./shared/question-set-access');
const { ORG, callerOrgId, callerOrgRole } = require('./shared/tenant');
const { findPromptForCaller, canAuthorPrompts, promptRefusalMessage } = require('./shared/prompt-access');
const { encryptItem, decryptItem, decryptValue } = require('./shared/tenant-crypto');

const tableName = process.env.TABLE_NAME;
const aiPromptsBucket = process.env.AI_PROMPTS_BUCKET;

const bedrockClient = new BedrockRuntimeClient({ region: process.env.AWS_REGION });
const dynamodb = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
  marshallOptions: { removeUndefinedValues: true },
});
const s3Client = new S3Client({});
const lambda = new LambdaClient({ region: process.env.AWS_REGION });

/** The job-row `kind`. The poll serves this kind and no other. */
const KIND = 'prompt-advice';

/** The three jobs, and the old names two of them still answer to. */
const ANALYSIS_TYPES = ['review', 'improve', 'apply'];
const ANALYSIS_ALIASES = { validate: 'review', optimize: 'improve' };
const canonicalAnalysisType = (value) => {
  const name = ANALYSIS_ALIASES[value] || value;
  return ANALYSIS_TYPES.includes(name) ? name : null;
};

/** The checklist's closed vocabularies — what the screen groups and ticks by. */
const SEVERITIES = ['high', 'medium', 'low'];
const HALVES = ['instructions', 'outputFormat', 'both'];

/** No real checklist is near these; they bound what one request can make the model read. */
const MAX_APPLY_ISSUES = 30;
const MAX_ISSUE_TEXT = 2000;

/**
 * A rewrite is an EDIT: the model is asked to change only what was ticked, and
 * a creative temperature is how an edit turns into a new draft. The two lenses
 * keep the temperature the advisor always used.
 */
const APPLY_TEMPERATURE = 0.2;
const ANALYSIS_TEMPERATURE = 0.7;

/**
 * THE OUTPUT BUDGET. The old 4,000 is what cut "improve" off. 16,000 is four
 * times that, and the improve format no longer writes each passage twice, so
 * the largest reply — a full rewrite plus its notes — fits with a wide margin.
 * It is within both models' output limits and is the size a non-streaming call
 * is sensibly kept to. At the ~45 output tokens/sec this account measures from
 * Sonnet, a reply that used all of it would take about six minutes — inside
 * the function's 900s, and inside the screen's eight-minute give-up.
 */
const MAX_TOKENS = 16000;

/**
 * Lambda's asynchronous-invocation payload limit is 256 KB. The prompt rides in
 * that payload, so a prompt that would not fit is refused on the request with a
 * sentence rather than failing the dispatch. No real Workie is near it.
 */
const MAX_EVENT_PAYLOAD_BYTES = 240 * 1024;

/** Sonnet first — the quality this screen exists for — and Haiku if it fails. */
const MODELS = [
  {
    label: 'claude-sonnet-4-6',
    arn: () => `arn:aws:bedrock:us-east-1:${process.env.ACCOUNT_ID}:inference-profile/us.anthropic.claude-sonnet-4-6`,
  },
  {
    label: 'claude-haiku-4-5',
    arn: () => `arn:aws:bedrock:us-east-1:${process.env.ACCOUNT_ID}:inference-profile/us.anthropic.claude-haiku-4-5-20251001-v1:0`,
  },
];

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization,X-Engage-Org',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};
const json = (statusCode, body) => ({ statusCode, headers: CORS, body: JSON.stringify(body) });

/** A failure whose message is already written for the person reading the screen. */
class AdvisorFailure extends Error {
  constructor(message) { super(message); this.name = 'AdvisorFailure'; }
}

const httpError = (statusCode, message) => Object.assign(new Error(message), { statusCode });

// ── The model call ─────────────────────────────────────────────────────────

/**
 * One analysis, Sonnet 4.6 then Haiku 4.5. Returns the text, the stop reason
 * and the model that ACTUALLY answered — the result used to be labelled
 * `claude-3.5-sonnet` whichever model it came from.
 *
 * Logs sizes, timings and `stop_reason`; never the prompt or the reply.
 */
async function invokeClaude(prompt, { temperature = ANALYSIS_TEMPERATURE } = {}) {
  const body = JSON.stringify({
    anthropic_version: 'bedrock-2023-05-31',
    max_tokens: MAX_TOKENS,
    temperature,
    messages: [{ role: 'user', content: [{ type: 'text', text: prompt }] }],
  });

  const failures = [];
  for (const model of MODELS) {
    const startedAt = Date.now();
    let responseBody;
    try {
      const response = await bedrockClient.send(new InvokeModelCommand({
        contentType: 'application/json',
        body,
        modelId: model.arn(),
      }));
      responseBody = JSON.parse(new TextDecoder().decode(response.body));
    } catch (error) {
      console.error(`❌ BEDROCK: ${model.label} failed after ${Date.now() - startedAt}ms — ${error.name}: ${error.message}`);
      failures.push(`${model.label}: ${error.message}`);
      continue;
    }

    const text = (Array.isArray(responseBody.content) ? responseBody.content : [])
      .filter((block) => block && block.type === 'text')
      .map((block) => block.text || '')
      .join('');
    const stopReason = responseBody.stop_reason || 'not given';
    const outputTokens = responseBody.usage?.output_tokens ?? 'unknown';
    console.log(`🤖 BEDROCK: ${model.label} answered in ${Date.now() - startedAt}ms — ${text.length} chars, `
      + `output_tokens ${outputTokens}, stop_reason ${stopReason}`);
    return { text, stopReason, model: model.label };
  }

  throw new AdvisorFailure(`The AI service did not answer, so no analysis was made (${failures.join('; ')}). `
    + 'Nothing was changed — try again in a minute.');
}

/** The JSON object in a reply: the ```json block, the whole reply, or the outermost braces. */
function parseAnalysis(text) {
  const candidates = [];
  const fenced = /```json\s*([\s\S]*?)\s*```/.exec(text);
  if (fenced) candidates.push(fenced[1]);
  candidates.push(text);
  const first = text.indexOf('{');
  const last = text.lastIndexOf('}');
  if (first >= 0 && last > first) candidates.push(text.slice(first, last + 1));

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
    } catch { /* try the next shape */ }
  }
  return null;
}

/**
 * THE REWRITE COMES BACK IN TAGS, NOT JSON — and a live run is why.
 *
 * The first cut asked for `{ "instructions": "…", "outputFormat": "…" }`. On
 * dev's default Workie — 5,000 characters of numbered rules, every other line
 * carrying a "quoted label" — Sonnet 4.6 wrote a 6,771-character reply that
 * held no parseable JSON object: two whole halves is a lot of text to escape
 * by hand, and one missed quote or raw newline sinks the lot. A checklist of
 * short sentences survives JSON; a rewrite of a long prompt does not. So each
 * half is written verbatim between its own tags, which need no escaping at
 * all. A JSON reply is still read if the model sends one anyway.
 *
 * Returns `{ instructions, outputFormat, applied }` with whatever it found —
 * normaliseRewrite decides whether that is a rewrite — or null.
 */
function parseRewrite(text) {
  const between = (tag) => {
    const open = `<${tag}>`;
    const close = `</${tag}>`;
    const start = text.indexOf(open);
    const end = text.lastIndexOf(close);
    if (start < 0 || end < start + open.length) return undefined;
    // The tag sits on its own line, so the newline after it and the one
    // before its close are layout, not content.
    return text.slice(start + open.length, end).replace(/^\r?\n/, '').replace(/\r?\n$/, '');
  };
  const instructions = between('instructions');
  const outputFormat = between('outputFormat');
  if (instructions !== undefined || outputFormat !== undefined) {
    const applied = between('applied');
    return {
      instructions,
      outputFormat,
      applied: applied === undefined ? [] : applied.split(/[\s,]+/).filter(Boolean),
    };
  }
  return parseAnalysis(text);
}

// ── The prompt the model is given ──────────────────────────────────────────

/** Does this input carry the two halves, or one older single-piece prompt? */
const hasHalves = (input) => !!(String(input.instructions || '').trim() || String(input.outputFormat || '').trim());

/** Every character the model is asked about, for the empty check and the logs. */
const promptLength = (input) => (hasHalves(input)
  ? String(input.instructions || '').length + String(input.outputFormat || '').length
  : String(input.promptText || '').length);

/**
 * THE PROMPT, AS THE MODEL SEES IT — the two halves in two labelled blocks.
 *
 * They used to be joined with a blank line into one string, which is also what
 * get-ai-summary.js does at run time, so the advisor saw exactly what Haiku
 * sees and could say nothing about where anything was. Each half is fenced by
 * its own tag rather than a ``` block, because an output format written in
 * Markdown may carry a code fence of its own.
 */
function describeThePrompt(input) {
  if (!hasHalves(input)) {
    return `
The prompt is ONE piece of text (an older single-template prompt), not two halves.
Every item you report is about the whole of it, so its "half" is "both".

<prompt>
${input.promptText}
</prompt>
`;
  }
  const shown = (text) => (String(text || '').trim() ? text : '(this half is empty)');
  return `
The prompt has two halves. At run time they are joined — the instructions, a blank
line, then the output format — the round's data is substituted into the {variables},
and the result is sent to Claude Haiku 4.5, whose reply is shown to the room.

**Half 1 — "instructions" (what the AI is given):**
<instructions>
${shown(input.instructions)}
</instructions>

**Half 2 — "outputFormat" (what the AI writes):**
<outputFormat>
${shown(input.outputFormat)}
</outputFormat>
`;
}

/** Who wrote it and what for — the part of the old prompts worth keeping. */
function describeTheContext(input) {
  const context = input.context || {};
  return `**Admin Context:**
- Prompt Name: ${context.name || 'Not provided'}
- Description: ${context.description || 'Not provided'}
- Game Type: ${input.gameType || context.gameType || 'Unknown'}
- Scenario: ${input.scenario || context.scenario || 'General engagement'}
- Target Audience: ${input.targetAudience || 'Professional teams'}
- Goals: ${input.goals || 'Effective engagement and meaningful insights'}`;
}

/**
 * The variable catalogue for this game type. All the lenses ask about
 * variables, and until this list existed none of them said which ones exist —
 * a validator with no list can only agree with whatever it is shown. An
 * unrecognised or absent type gets the FULL catalogue rather than nothing.
 */
function describeTheVariables(input) {
  const effectiveGameType = input.gameType || (input.context || {}).gameType;
  const canonicalGameType = isKnownGameType(effectiveGameType)
    ? normalizeGameType(effectiveGameType)
    : null;
  const scope = canonicalGameType
    ? `for ${canonicalGameType}`
    : 'across all engagement types (no game type was supplied)';
  return `**Template Variables that exist ${scope}** — this list is COMPLETE. A {token}
outside it is substituted by nothing and reaches the screen as literal braces, so
treat any such token as an error and never suggest one:

${describeVariablesForPrompt(canonicalGameType)}`;
}

/**
 * HOW OFTEN EACH {variable} APPEARS, COUNTED HERE — because the model, asked to
 * count, does not. On dev's default Workie, which names {responsesText} exactly
 * once, two Review runs out of two reported it "named twice" as a HIGH item —
 * pre-ticked — with the fix "remove it", which would have cut the only variable
 * carrying what the room said. The rule the model was checking ("name each
 * variable once") is one it can only judge from a count, so it is given one.
 */
function describeVariableUse(input) {
  const halves = hasHalves(input)
    ? [['instructions', input.instructions], ['outputFormat', input.outputFormat]]
    : [['the prompt', input.promptText]];
  const uses = new Map();
  for (const [half, text] of halves) {
    for (const name of extractVariableTokens(String(text || ''))) {
      const times = String(text).split(`{${name}}`).length - 1;
      uses.set(name, [...(uses.get(name) || []), `${half} ${times}`]);
    }
  }
  if (!uses.size) return '**Variables in this prompt, counted exactly:** none — it names no {variable} at all.';
  const lines = [...uses].map(([name, where]) => {
    const total = where.reduce((sum, w) => sum + Number(w.split(' ').pop()), 0);
    return `- {${name}}: ${total === 1 ? 'once' : `${total} times`} (${where.join(', ')})`;
  });
  return `**Variables in this prompt, counted exactly by the server** — trust these counts over
your own reading. A variable counted once here is named once:
${lines.join('\n')}`;
}

/**
 * THE SAVE RULES, in every advisor prompt. The advisor did not know them and
 * ai-generate-prompt.js did, so the advisor's rewrites were refused at Save —
 * which is where the owner met them. One source, shared/template-variable-usage.js.
 */
function describeTheRules() {
  return `**Rules the save gate enforces** — a prompt that breaks one of these is refused when
it is saved, or misbehaves in front of a room. They are not style preferences, and no
fix you propose may break one. The variables these rules quote are EXAMPLES, not part of
the admin's prompt: judge only the text inside the prompt's own tags above.

${describeAuthoringRules()}`;
}

/** What each lens looks for. The checklist it answers in is shared. */
const LENSES = {
  review: {
    idPrefix: 'r',
    role: 'You are an expert reviewer of AI prompts for Engage, a live engagement platform. '
      + 'Review the admin\'s prompt for problems, respecting what they are trying to do.',
    ask: `**Review it for:**
1. **Safety** — anything that could make the reply inappropriate, hurtful or unsafe to show a room.
2. **Bias and fairness** — anything that favours some voices, groups or answers over others.
3. **Clarity** — contradictions, vague asks, or instructions the model could read two ways.
4. **Technical** — the rules above, any {token} not on the variable list, formatting, and
   anything that would make the model reply to the author instead of to the room.

Do not rewrite the admin's approach; report what is wrong with it.`,
  },
  improve: {
    idPrefix: 'i',
    role: 'You are an expert AI prompt engineer for Engage, a live engagement platform. '
      + 'Suggest improvements that keep the admin\'s purpose and voice.',
    ask: `**Suggest improvements to:**
1. **Effectiveness** — will Haiku write a better, more useful summary for the room if this
   changes? Specific asks, a clear shape for the reply, the right emphasis.
2. **Tightening** — cut repetition and words that do nothing; make it shorter where
   shorter says the same thing.
3. **Structure** — put things where they belong: what the AI is given in the instructions,
   what it writes in the output format.

Keep the admin's purpose, voice and approach. Improve what exists; do not replace it.`,
  },
};

/** The checklist both lenses answer in — the shape the dialog ticks. */
function describeTheChecklist(prefix) {
  return `**How to answer.** Report each problem or improvement as ONE checklist item the admin
can tick and have applied on its own:
- "severity": "high" when it breaks a rule above or would put something wrong, unsafe or
  unfair in front of the room; "medium" when the summary would clearly be worse for it;
  "low" for polish.
- "half": the half the fix changes — "instructions" or "outputFormat" — or "both" only
  when the fix has to change both.
- "issue" and "fix": one or two plain sentences each, written for the admin. Say where,
  in a few words; never quote a passage at length. The fix must be specific enough to
  apply without reading this review.
Report only problems you can point to in the prompt's own text. If you checked something
and it is fine, leave it out — an item is something to change, never a note that all is well.
At most ten items, most important first. If nothing needs changing, return an empty list.

Reply with one JSON object in a \`\`\`json block, with this structure:
\`\`\`json
{
  "overallScore": 7.5,
  "summary": "One or two plain sentences on the prompt as a whole",
  "issues": [
    {
      "id": "${prefix}1",
      "severity": "high|medium|low",
      "half": "instructions|outputFormat|both",
      "issue": "What is wrong or could be better, and where",
      "fix": "The change to make"
    }
  ]
}
\`\`\`
`;
}

/** The apply job: the halves, the ticked fixes, and nothing else. */
function describeTheTickedFixes(issues) {
  return issues.map((item) => `<fix id="${item.id}" half="${item.half}" severity="${item.severity}">
Issue: ${item.issue || '(not stated)'}
Fix: ${item.fix || '(not stated)'}
</fix>`).join('\n');
}

/** Build the request for one job from what the POST resolved. */
function buildAnalysisPrompt(input) {
  const analysisType = canonicalAnalysisType(input.analysisType) || 'improve';

  if (analysisType === 'apply') {
    return `
You are editing an AI prompt for Engage, a live engagement platform. The admin read advice
about this prompt and ticked the fixes below. Apply EVERY ticked fix, and change nothing else.
${describeThePrompt(input)}
${describeTheContext(input)}

${describeTheVariables(input)}

${describeTheRules()}

**The ticked fixes** — apply each one in the half it names:
${describeTheTickedFixes(input.issues || [])}

**How to apply them:**
- Change only what these fixes need. Every other word, line break, heading and variable
  stays exactly as it is — including typographic quotes and apostrophes (’ “ ”), which
  are not to be straightened.
- A half that no fix names is returned exactly as it was given, character for character.
- If a fix cannot be applied without breaking a rule above, apply it in the way that keeps
  the rule, or leave it out and do not list its id in "applied".
- Return each half in full — the complete text, never a summary, a diff or an excerpt.

**How to reply.** Not JSON. Write each half in full between its tags, exactly as it should
be saved — plain text, nothing escaped, no code fence around it — then the ids of the fixes
you applied, separated by commas. Nothing before the first tag and nothing after the last:

<instructions>
The complete instructions half, with the fixes applied
</instructions>
<outputFormat>
The complete output-format half, with the fixes applied
</outputFormat>
<applied>the id of each fix you applied, separated by commas</applied>
`;
  }

  const lens = LENSES[analysisType];
  return `
${lens.role}
${describeThePrompt(input)}
${describeTheContext(input)}

${describeTheVariables(input)}

${describeVariableUse(input)}

${describeTheRules()}

${lens.ask}

${describeTheChecklist(lens.idPrefix)}`;
}

// ── What the model sent back, as the screen will read it ───────────────────

const asText = (value) => (typeof value === 'string' ? value.trim() : '');

/** "Output format", "output_format", "OutputFormat" — the model's spellings of a half. */
function normaliseHalf(value, withHalves) {
  if (!withHalves) return 'both';
  const squashed = asText(value).toLowerCase().replace(/[^a-z]/g, '');
  if (squashed === 'instructions') return 'instructions';
  if (squashed === 'outputformat') return 'outputFormat';
  return 'both';
}

/**
 * THE CHECKLIST, NORMALISED — every item with a unique id, a known severity and
 * a known half, because those are what the dialog ticks, colours and groups by,
 * and an item missing one would be an item nobody could tick. Returns null when
 * the reply holds no list at all: that is a failure to say so, not an empty
 * review.
 */
function normaliseChecklist(analysis, input) {
  if (!Array.isArray(analysis.issues)) return null;
  const withHalves = hasHalves(input);
  const taken = new Set();
  let next = 1;
  const issues = [];
  for (const raw of analysis.issues) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
    const issue = asText(raw.issue);
    const fix = asText(raw.fix);
    if (!issue && !fix) continue;
    let id = asText(raw.id === undefined || raw.id === null ? '' : String(raw.id)).slice(0, 64);
    while (!id || taken.has(id)) id = `item-${next++}`;
    taken.add(id);
    const severity = asText(raw.severity).toLowerCase();
    issues.push({
      id,
      severity: SEVERITIES.includes(severity) ? severity : 'medium',
      half: normaliseHalf(raw.half, withHalves),
      issue,
      fix,
    });
  }
  const score = Number(analysis.overallScore);
  return {
    overallScore: Number.isFinite(score) && score >= 0 && score <= 10 ? score : null,
    summary: asText(analysis.summary),
    issues,
  };
}

/**
 * THE REWRITE, NORMALISED. Both halves must come back as text. A half that no
 * ticked fix names is the ORIGINAL, whatever the model sent for it — the rule
 * the model is given, enforced where it can be. `applied` is cut to the ids
 * that were actually ticked.
 */
const straightened = (line) => line.replace(/[‘’]/g, '\'').replace(/[“”]/g, '"');

/**
 * PUT BACK THE TYPOGRAPHY NOBODY ASKED TO CHANGE. Told in so many words not
 * to, Sonnet still straightens curly quotes and apostrophes (’ → ') across a
 * half it edits — on dev's default Workie, three live runs of three — so lines
 * no fix touched showed up as changed in the before-and-after. A line that
 * differs from an original line ONLY in its quote marks is that original line.
 */
function restoreTypography(original, rewritten) {
  const byShape = new Map(String(original).split('\n').map((line) => [straightened(line), line]));
  return rewritten.split('\n').map((line) => byShape.get(straightened(line)) ?? line).join('\n');
}

function normaliseRewrite(analysis, input) {
  if (typeof analysis.instructions !== 'string' || typeof analysis.outputFormat !== 'string') return null;
  const ticked = input.issues || [];
  const named = (half) => ticked.some((item) => item.half === half || item.half === 'both');
  const tickedIds = new Set(ticked.map((item) => item.id));
  const applied = [];
  for (const id of Array.isArray(analysis.applied) ? analysis.applied : []) {
    const key = String(id);
    if (tickedIds.has(key) && !applied.includes(key)) applied.push(key);
  }
  const half = (name) => (named(name)
    ? restoreTypography(input[name] || '', analysis[name])
    : String(input[name] || ''));
  return {
    instructions: half('instructions'),
    outputFormat: half('outputFormat'),
    applied,
  };
}

/**
 * The ticked fixes a request carries, cleaned to the five fields the model is
 * shown, or null when there are none it could apply. Only the id and some text
 * are required: severity and half fall back as the checklist's do.
 */
function tickedFixesFrom(value) {
  if (!Array.isArray(value)) return null;
  const seen = new Set();
  const out = [];
  for (const raw of value) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
    const id = asText(raw.id === undefined || raw.id === null ? '' : String(raw.id)).slice(0, 64);
    const issue = asText(raw.issue).slice(0, MAX_ISSUE_TEXT);
    const fix = asText(raw.fix).slice(0, MAX_ISSUE_TEXT);
    if (!id || seen.has(id) || (!issue && !fix)) continue;
    seen.add(id);
    const severity = asText(raw.severity).toLowerCase();
    out.push({
      id,
      severity: SEVERITIES.includes(severity) ? severity : 'medium',
      half: HALVES.includes(raw.half) ? raw.half : 'both',
      issue,
      fix,
    });
  }
  return out.length ? out : null;
}

// ── The request: resolve, record, dispatch ─────────────────────────────────

/**
 * Find a saved prompt in the first library this caller may read — their own
 * organisation's, then Engage's, then the public one. prompt-access.js is the
 * READ GUARD as well as the lookup: another organisation's Workie is never
 * probed, so it is absent here rather than forbidden.
 *
 * This used to read the platform partition only, so an organisation's own
 * Workie was always "Prompt not found". The legacy `AI_PROMPT#<id>/METADATA`
 * key is still tried last — only the dead populate-default-prompts.js wrote it,
 * and it is platform content.
 */
async function findPrompt(event, promptId) {
  const hit = await findPromptForCaller(dynamodb, tableName, event, promptId, undefined, GetCommand);
  if (hit) return hit;
  console.warn(`⚠️ prompt ${promptId} not found in any readable library — trying the legacy AI_PROMPT#/METADATA key`);
  const legacy = await dynamodb.send(new GetCommand({
    TableName: tableName,
    Key: { PK: `AI_PROMPT#${promptId}`, SK: 'METADATA' },
  }));
  return legacy.Item ? { ref: { scope: 'platform', orgId: '', promptId }, item: legacy.Item } : null;
}

/** The prompt's saved document: its S3 body, opened under its org when it has one. */
async function readPromptDocument({ ref, item }) {
  const orgId = ref.scope === ORG ? ref.orgId : '';
  if (!item.s3Key) return orgId ? decryptItem(orgId, 'prompt', item) : item;
  const s3Response = await s3Client.send(new GetObjectCommand({ Bucket: aiPromptsBucket, Key: item.s3Key }));
  const parsed = JSON.parse(await s3Response.Body.transformToString());
  // create-ai-prompt.js wraps an org's whole body in one envelope; decryptValue
  // passes anything that is not an envelope straight through.
  return orgId ? decryptValue(orgId, parsed) : parsed;
}

/** Everything the worker needs, resolved while the caller's identity is still in hand. */
async function resolveInput(event, body) {
  const {
    promptText, instructions, outputFormat, gameType, scenario, targetAudience, context, goals,
    analysisType, existingPromptId = null,
  } = body;
  const text = (value) => (typeof value === 'string' ? value : '');

  let halves = { instructions: text(instructions), outputFormat: text(outputFormat) };
  let single = text(promptText);
  let currentContext = context && typeof context === 'object' ? context : {};

  if (existingPromptId) {
    const found = await findPrompt(event, existingPromptId);
    if (!found) throw httpError(404, `Prompt not found: ${existingPromptId}`);
    const promptData = await readPromptDocument(found);
    // WHAT RUNS IS WHAT IS REVIEWED. get-ai-summary.js reads a legacy
    // `template` in preference to the halves, so a prompt carrying one is
    // reviewed as that one piece. Structured prompts are sent as their two
    // halves, separately; a generation prompt's `basePrompt` is one piece.
    // (Reading a missing field used to hand the model the string "undefined".)
    if (promptData.template) {
      halves = { instructions: '', outputFormat: '' };
      single = text(promptData.template);
    } else {
      halves = { instructions: text(promptData.instructions), outputFormat: text(promptData.outputFormat) };
      single = text(promptData.basePrompt);
    }
    currentContext = {
      name: promptData.name,
      description: promptData.description,
      gameType: promptData.gameType,
      category: promptData.category,
      scenario: promptData.scenario,
      ...currentContext,
    };
  }

  // Two halves, or one piece — never both, so the prompt builder cannot show
  // the model the same words twice.
  const withHalves = hasHalves(halves);
  return {
    analysisType,
    instructions: withHalves ? halves.instructions : '',
    outputFormat: withHalves ? halves.outputFormat : '',
    promptText: withHalves ? '' : single,
    context: currentContext,
    gameType: gameType || null,
    scenario: scenario || null,
    targetAudience: targetAudience || null,
    goals: goals || null,
    promptId: existingPromptId || null,
  };
}

async function startJob(event, context) {
  if (!event.body) return json(400, { error: 'Request body is required' });
  let body;
  try { body = JSON.parse(event.body); } catch { return json(400, { error: 'The request body is not valid JSON.' }); }

  const requested = body.analysisType ?? 'improve';
  const analysisType = canonicalAnalysisType(requested);
  if (!analysisType) {
    return json(400, { error: `analysisType must be review, improve or apply (got ${JSON.stringify(requested)}).` });
  }
  if (!body.promptText && !body.instructions && !body.outputFormat && !body.existingPromptId) {
    return json(400, { error: 'Either the prompt (its instructions and output format) or existingPromptId is required' });
  }

  // APPLY IS SENT ONLY WHAT WAS TICKED. The screen sends the ticked fixes and
  // nothing else; this keeps the five fields the model is shown and refuses a
  // request with none it could apply, before any job exists.
  let issues = null;
  if (analysisType === 'apply') {
    issues = tickedFixesFrom(body.issues);
    if (!issues) {
      return json(400, { error: 'Tick at least one fix to apply. This request carried none that could be applied — '
        + 'each needs its id and its text. Nothing was changed.' });
    }
    if (issues.length > MAX_APPLY_ISSUES) {
      return json(400, { error: `Tick at most ${MAX_APPLY_ISSUES} fixes at a time (this request carried ${issues.length}). `
        + 'Nothing was changed.' });
    }
  }

  // The poll hands a result only to the user who started the job, so a job
  // with no user could never be read. The authorizer always supplies one.
  const userId = callerUserId(event);
  if (!userId) return json(401, { error: 'This request carried no signed-in user. Sign in again and retry.' });

  let input;
  try {
    input = await resolveInput(event, { ...body, analysisType });
  } catch (error) {
    if (error.statusCode) return json(error.statusCode, { error: error.message });
    throw error;
  }
  if (analysisType === 'apply') {
    if (!hasHalves(input)) {
      return json(400, { error: 'This prompt is one piece of text (an older single-template prompt), not two halves, '
        + 'so there are no two halves to rewrite the fixes into. Nothing was changed — apply the advice by hand '
        + 'in the editor instead.' });
    }
    input.issues = issues;
  }

  const jobId = newJobId();
  const payload = { __workerMode: true, jobId, input };
  const serialized = JSON.stringify(payload);
  const bytes = Buffer.byteLength(serialized, 'utf8');
  if (bytes > MAX_EVENT_PAYLOAD_BYTES) {
    return json(413, {
      error: `This prompt is too long to analyse (${Math.round(bytes / 1024)} KB; the advisor takes up to `
        + `${Math.round(MAX_EVENT_PAYLOAD_BYTES / 1024)} KB).`,
    });
  }

  // THE ROW BEFORE THE DISPATCH, so a dispatch that fails leaves something to
  // poll that explains why. It holds no content — see the header.
  await createJob(dynamodb, tableName, {
    jobId,
    kind: KIND,
    requested: 1,
    request: { kind: KIND, analysisType },
    caller: {
      userId,
      username: callerUsername(event),
      orgId: callerOrgId(event),
      orgRole: callerOrgRole(event),
    },
  });

  try {
    await lambda.send(new InvokeCommand({
      FunctionName: context?.functionName || process.env.AWS_LAMBDA_FUNCTION_NAME,
      InvocationType: 'Event',
      Payload: Buffer.from(serialized),
    }));
  } catch (error) {
    const message = `Could not start the prompt advisor: ${error.message}`;
    console.error(`❌ ${KIND} ${jobId}: dispatch failed — ${error.name}: ${error.message}`);
    await failJob(dynamodb, tableName, jobId, message);
    return json(500, { error: message, jobId });
  }

  console.log(`🚀 ${KIND} ${jobId}: dispatched ${analysisType} for `
    + `${input.promptId ? `prompt ${input.promptId}` : 'pasted text'} (${promptLength(input)} chars, `
    + `${hasHalves(input) ? 'two halves' : 'one piece'}, `
    + `${issues ? `${issues.length} ticked fixes, ` : ''}`
    + `gameType ${input.gameType || input.context.gameType || 'none'})`);
  return json(202, { jobId, status: STATUS.QUEUED, analysisType });
}

// ── The worker ─────────────────────────────────────────────────────────────

/**
 * Take the job, once. Lambda delivers an Event invoke AT LEAST once, and a
 * second delivery of the same job would pay for the same analysis again.
 * Returns false when another delivery already has it.
 */
async function claimJob(jobId, phase) {
  try {
    await dynamodb.send(new UpdateCommand({
      TableName: tableName,
      Key: jobKey(jobId),
      UpdateExpression: 'SET #status = :running, phase = :phase, updatedAt = :now',
      ConditionExpression: '#status = :queued',
      ExpressionAttributeNames: { '#status': 'status' },
      ExpressionAttributeValues: {
        ':running': STATUS.RUNNING,
        ':queued': STATUS.QUEUED,
        ':phase': phase,
        ':now': new Date().toISOString(),
      },
    }));
    return true;
  } catch (error) {
    if (error.name === 'ConditionalCheckFailedException') return false;
    throw error;
  }
}

/** Store the outcome — sealed under the caller's organisation when there is one. */
async function completeAdviceJob(jobId, result, orgId, phase) {
  const stored = orgId ? (await encryptItem(orgId, 'job', { result })).result : result;
  await dynamodb.send(new UpdateCommand({
    TableName: tableName,
    Key: jobKey(jobId),
    UpdateExpression: 'SET #status = :status, #result = :result, completed = :completed, phase = :phase, updatedAt = :now',
    ExpressionAttributeNames: { '#status': 'status', '#result': 'result' },
    ExpressionAttributeValues: {
      ':status': STATUS.COMPLETE,
      ':result': stored,
      ':completed': 1,
      ':phase': phase,
      ':now': new Date().toISOString(),
    },
  }));
}

/**
 * Never throws for a failed ANALYSIS: that is recorded on the job for the
 * screen to show, and a throw would make Lambda retry the Event and pay for it
 * again. A failure to reach the table at all does throw, so Lambda's retry can
 * try once more — the claim keeps that from running Bedrock twice.
 */
async function runWorker(event) {
  const { jobId, input } = event;
  if (!jobId) {
    console.error(`❌ ${KIND} worker invoked without a jobId`);
    return;
  }

  // WHO ASKED comes from the ROW, written by the authorised POST — never from
  // this payload, which anything able to invoke the function could write
  // (generation-jobs.js, createJob).
  const job = await getJob(dynamodb, tableName, jobId);
  if (!job || job.kind !== KIND) {
    console.error(`❌ ${KIND} ${jobId}: no such job — nothing to do`);
    return;
  }
  const analysisType = canonicalAnalysisType(input && input.analysisType) || 'improve';
  const applying = analysisType === 'apply';
  if (!(await claimJob(jobId, applying ? 'Applying the ticked fixes' : 'Analysing the prompt'))) {
    console.warn(`⚠️ ${KIND} ${jobId}: already taken (status ${job.status}) — a repeat delivery of the same Event, ignored`);
    return;
  }
  const orgId = job.callerOrgId || '';

  try {
    if (!input || !(hasHalves(input) || String(input.promptText || '').trim())) {
      throw new AdvisorFailure('The prompt is empty, so there was nothing to analyse. Nothing was changed.');
    }
    if (applying && !(Array.isArray(input.issues) && input.issues.length && hasHalves(input))) {
      throw new AdvisorFailure('There were no ticked fixes and two halves to apply them to, so nothing was rewritten. '
        + 'Nothing was changed.');
    }
    console.log(`🪄 ${KIND} ${jobId}: ${analysisType}, ${promptLength(input)} chars, `
      + `${applying ? `${input.issues.length} ticked fixes, ` : ''}`
      + `${orgId ? 'org-scoped (result sealed)' : 'platform'}`);

    const reply = await invokeClaude(buildAnalysisPrompt({ ...input, analysisType }), {
      temperature: applying ? APPLY_TEMPERATURE : ANALYSIS_TEMPERATURE,
    });

    if (reply.stopReason === 'max_tokens') {
      throw new AdvisorFailure(`The advisor's reply was cut off at its ${MAX_TOKENS.toLocaleString('en-US')}-token `
        + `limit before it finished, so there is no complete ${applying ? 'rewrite' : 'analysis'} to show. `
        + 'Nothing was changed. Try again; if it happens again, the prompt may be too long to analyse in one pass.');
    }

    const analysis = applying ? parseRewrite(reply.text) : parseAnalysis(reply.text);
    if (!analysis) {
      console.warn(`⚠️ ${KIND} ${jobId}: ${reply.model} replied with ${reply.text.length} chars that hold `
        + `${applying ? 'neither the tagged halves nor a JSON object' : 'no JSON object'}`);
      throw new AdvisorFailure('The advisor replied, but not in the format it was asked for, so there is nothing to show. '
        + 'Nothing was changed — run it again.');
    }

    // THE SHAPE THE SCREEN READS, or a sentence saying the reply had none.
    const shaped = applying ? normaliseRewrite(analysis, input) : normaliseChecklist(analysis, input);
    if (!shaped) {
      console.warn(`⚠️ ${KIND} ${jobId}: ${reply.model} replied without `
        + `${applying ? 'both halves as text' : 'an issues array'}`);
      throw new AdvisorFailure(`The advisor replied, but not in the format it was asked for — ${applying
        ? 'the two rewritten halves were not in it'
        : 'there was no list of issues in it'} — so there is nothing to show. Nothing was changed — run it again.`);
    }

    await completeAdviceJob(jobId, {
      analysisType,
      promptId: input.promptId || null,
      gameType: input.gameType || input.context?.gameType || null,
      analysis: shaped,
      metadata: {
        analyzedAt: new Date().toISOString(),
        modelUsed: reply.model,
        stopReason: reply.stopReason,
        promptLength: promptLength(input),
      },
    }, orgId, applying ? 'Rewrite ready' : 'Analysis ready');
    console.log(`✅ ${KIND} ${jobId}: complete (${reply.model})`);
  } catch (error) {
    const message = error instanceof AdvisorFailure
      ? error.message
      : `The analysis failed: ${error.message}`;
    console.error(`❌ ${KIND} ${jobId}: ${error.name}: ${error.message}`);
    await failJob(dynamodb, tableName, jobId, message);
  }
}

// ── The poll ───────────────────────────────────────────────────────────────

async function readJob(event, jobId) {
  if (!jobId) return json(400, { error: 'jobId is required' });
  const job = await getJob(dynamodb, tableName, jobId);

  // THE CALLER WHO ASKED, ACTING WHERE THEY ASKED. Anything else — another
  // admin, the same admin standing in another organisation, a job of another
  // kind — is not found, and carries nothing of the job. The rule is stated
  // once, in shared/generation-jobs.js, for this poll and the builders' alike.
  const mine = isCallersJob(job, { kind: KIND, userId: callerUserId(event), orgId: callerOrgId(event) });
  if (!mine) return json(404, { error: 'Job not found or expired' });

  let result = null;
  if (job.status === STATUS.COMPLETE && job.result !== undefined) {
    result = job.callerOrgId
      ? (await decryptItem(job.callerOrgId, 'job', { result: job.result })).result
      : job.result;
  }

  return json(200, {
    jobId: job.jobId,
    status: job.status,
    phase: job.phase || '',
    error: job.errorMessage || null,
    result,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
  });
}

exports.handler = async (event, context) => {
  // The worker: an Event self-invoke, against the function's own timeout and
  // nowhere near the gateway's 30 seconds. It carries no authorizer context.
  if (event && event.__workerMode === true) {
    await runWorker(event);
    return { statusCode: 200, body: 'ok' };
  }

  const method = String(event?.requestContext?.http?.method || event?.httpMethod || 'POST').toUpperCase();
  if (method === 'OPTIONS') return { statusCode: 200, headers: CORS, body: '' };

  const refused = requireAdmin(event);
  if (refused) return { ...refused, headers: { ...CORS, ...refused.headers } };

  try {
    const jobId = event?.pathParameters?.jobId;
    if (method === 'GET' || jobId) return await readJob(event, jobId);
    // Engage mode only (docs/superpowers/specs/2026-09-24-prompt-admin-engage-mode-design.md):
    // the advisor rewrites prompts, and only Engage staff acting as Engage
    // change prompts for now. Reading back a job already started stays open.
    if (!canAuthorPrompts(event)) return json(403, { error: promptRefusalMessage(event, null) });
    return await startJob(event, context);
  } catch (error) {
    console.error(`❌ AI Prompt Advisor: ${error.name}: ${error.message}`);
    return json(500, { error: `AI Prompt Advisor failed: ${error.message}` });
  }
};
