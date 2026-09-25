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
 * writes `result` — which quotes the Workie back and, for improve and optimize,
 * rewrites all of it. For a caller acting inside an organisation `result` is
 * sealed under that org's key (ENCRYPTED_FIELDS.job); Engage's own library is
 * plaintext by decision, as every platform row is. Neither the prompt nor the
 * analysis is ever logged — lengths, ids, models and stop reasons only.
 *
 * THE CUT-OFF. An "improve" run logged "Could not parse AI response as JSON" on
 * a 16,581-character reply — about 4,000 tokens, which was the whole budget.
 * The format asked for every changed passage twice (before and after) AND the
 * full rewrite, so the model ran out mid-object and a truncation was reported
 * as a parse error. The improve format now names each change once and writes
 * the rewrite once; the budget is four times the old one, since time is no
 * longer the constraint; `stop_reason` is logged; and a reply that still ends
 * on `max_tokens` fails the job with a sentence saying so instead of storing
 * something nobody can read.
 */
const { BedrockRuntimeClient, InvokeModelCommand } = require('@aws-sdk/client-bedrock-runtime');
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, GetCommand, UpdateCommand } = require('@aws-sdk/lib-dynamodb');
const { S3Client, GetObjectCommand } = require('@aws-sdk/client-s3');
const { LambdaClient, InvokeCommand } = require('@aws-sdk/client-lambda');
const { isKnownGameType, normalizeGameType } = require('./shared/game-types');
const { describeVariablesForPrompt } = require('./shared/template-variable-usage');
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

const ANALYSIS_TYPES = ['improve', 'validate', 'optimize'];

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
async function invokeClaude(prompt) {
  const body = JSON.stringify({
    anthropic_version: 'bedrock-2023-05-31',
    max_tokens: MAX_TOKENS,
    temperature: 0.7,
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

// ── The prompt the model is given ──────────────────────────────────────────

/**
 * Build the analysis request from what the POST resolved. Unchanged in
 * substance for validate and optimize; improve's response format is the one
 * that changed — see the header.
 */
function buildAnalysisPrompt(input) {
  const {
    analysisType, promptText, gameType, scenario, targetAudience, goals,
  } = input;
  const currentContext = input.context || {};

  // All three variants ask the model about template variables — "suggest
  // relevant variables", "missing or incorrect variable usage", "ensure proper
  // variable usage" — and until now none of them said which variables exist.
  // A validator with no list can only agree with whatever it is shown.
  //
  // An unrecognised or absent type gets the FULL catalogue rather than
  // nothing: the advisor is advisory, and half a list still beats none.
  const effectiveGameType = gameType || currentContext.gameType;
  const canonicalGameType = isKnownGameType(effectiveGameType)
    ? normalizeGameType(effectiveGameType)
    : null;
  const variableReference = describeVariablesForPrompt(canonicalGameType);
  const variableScope = canonicalGameType
    ? `for ${canonicalGameType}`
    : 'across all engagement types (no game type was supplied)';
  const VARIABLES_BLOCK = `
**Template Variables that exist ${variableScope}** — this list is COMPLETE. A {token}
outside it is substituted by nothing and reaches the screen as literal braces, so
treat any such token as an error and never suggest one:

${variableReference}
`;

  if (analysisType === 'improve') {
    return `
You are an expert AI prompt engineer specializing in enhancing existing engagement platform prompts while preserving the admin's original vision and intent.

**Current Prompt Template to Enhance:**
\`\`\`
${promptText}
\`\`\`

**Admin Context:**
- Prompt Name: ${currentContext.name || 'Not provided'}
- Description: ${currentContext.description || 'Not provided'}
- Game Type: ${gameType || currentContext.gameType || 'Unknown'}
- Scenario: ${scenario || currentContext.scenario || 'General engagement'}
- Target Audience: ${targetAudience || 'Professional teams'}
- Goals: ${goals || 'Effective engagement and meaningful insights'}
${VARIABLES_BLOCK}
**Enhancement Request:** Analyze and provide improvements that PRESERVE the admin's original purpose and direction:

1. **Preserve Intent**: Identify and maintain the core purpose and direction
2. **Enhance Clarity**: Make existing content clearer without changing meaning
3. **Add Detail**: Expand on existing concepts with more specificity
4. **Improve Structure**: Better organize existing content
5. **Template Variables**: Suggest variables from the list above, and flag any {token} in the prompt that is not on it
6. **Professional Polish**: Enhance language and presentation

**IMPORTANT**: Do not change the fundamental approach or purpose. Enhance what exists.

**Keep the reply compact.** The complete enhanced prompt is written out ONCE, in improvedPrompt.
Each entry in improvements describes one change in a sentence or two: say where it is in a
few words — never quote a passage at length, and never write out before-and-after versions
of it. At most eight improvements, most important first.

**Response Format:**
Reply with one JSON object in a \`\`\`json block, with this structure:
\`\`\`json
{
  "overallScore": 8.5,
  "adminIntent": "What the admin was trying to achieve, in one sentence",
  "strengths": ["Aspects that work well and should be preserved"],
  "improvements": [
    {
      "category": "Clarity|Detail|Structure|Variables|Polish",
      "priority": "high|medium|low",
      "issue": "What should change, and where, in one or two sentences",
      "suggestion": "How to change it, in one or two sentences"
    }
  ],
  "improvedPrompt": "The complete enhanced prompt, building on the original rather than replacing it",
  "templateVariableSuggestions": ["Relevant variables for this game type"],
  "preservationNotes": "Key elements that must remain unchanged"
}
\`\`\`
`;
  }

  if (analysisType === 'validate') {
    return `
You are an expert AI prompt validator. Thoroughly validate the admin's prompt template while respecting their intended approach and goals.

**Admin's Prompt Template to Validate:**
\`\`\`
${promptText}
\`\`\`

**Admin Context:**
- Prompt Name: ${currentContext.name || 'Not provided'}
- Description: ${currentContext.description || 'Not provided'}
- Game Type: ${gameType || currentContext.gameType || 'Unknown'}
- Scenario: ${scenario || currentContext.scenario || 'General engagement'}
${VARIABLES_BLOCK}
**Validation Request:** Check for potential issues while respecting the admin's vision:

1. **Technical Issues**: Syntax, formatting, token limits that could cause failures
2. **Logic Problems**: Internal contradictions or unclear instructions
3. **Bias & Fairness**: Potential biases that conflict with inclusive engagement
4. **Safety Concerns**: Risks of inappropriate content generation
5. **Performance Issues**: Elements that might confuse AI interpretation
6. **Template Variables**: Any {token} not on the list above is an error — report it under category "variables"

**Important:** Focus on technical and safety validation, not changing the admin's approach.

**Response Format:**
Provide validation results as JSON:
\`\`\`json
{
  "isValid": true,
  "overallScore": 8.5,
  "adminApproachAssessment": "Assessment of the admin's intended approach",
  "issues": [
    {
      "severity": "high|medium|low",
      "category": "technical|logic|bias|safety|performance|variables",
      "issue": "Description of the specific issue",
      "location": "Where in the prompt this occurs",
      "adminImpact": "How this affects the admin's intended outcome",
      "fixSuggestion": "How to fix while preserving intent"
    }
  ],
  "safetyScore": 9.0,
  "biasScore": 8.5,
  "clarityScore": 8.0,
  "technicalScore": 8.5,
  "strengths": ["What works well in the admin's approach"],
  "recommendations": ["Technical fixes that preserve the admin's vision"]
}
\`\`\`
`;
  }

  // optimize
  return `
You are an AI prompt optimization specialist. Optimize the admin's prompt while preserving their core approach and intent.

**Admin's Current Prompt:**
\`\`\`
${promptText}
\`\`\`

**Admin Context:**
- Prompt Name: ${currentContext.name || 'Not provided'}
- Description: ${currentContext.description || 'Not provided'}
- Game Type: ${gameType || currentContext.gameType || 'Unknown'}
- Target Audience: ${targetAudience || 'Professional teams'}
- Performance Goals: ${goals || 'High-quality, engaging content'}
${VARIABLES_BLOCK}
**Optimization Request:** Improve efficiency while preserving the admin's vision:

1. **Token Efficiency**: Reduce unnecessary words without changing meaning or approach
2. **Performance**: Optimize for consistent AI responses in the admin's intended style
3. **Clarity**: Make instructions clearer without changing the fundamental approach
4. **Template Variables**: Ensure every {token} used appears on the list above
5. **Maintainability**: Organize content better while preserving all key elements

**Critical:** Do not change the admin's fundamental approach, just make it more efficient.

**Response Format:**
\`\`\`json
{
  "adminIntent": "Summary of what the admin was trying to achieve",
  "optimizedPrompt": "Optimized version that preserves the admin's approach",
  "optimizations": [
    {
      "type": "token-reduction|clarity|organization|variables",
      "originalText": "Text that was optimized",
      "optimizedText": "Improved version",
      "benefit": "Why this optimization helps",
      "preservedElements": "Key admin elements that remained unchanged"
    }
  ],
  "metrics": {
    "tokenReduction": "Percentage reduced",
    "clarityImprovement": "How clarity was enhanced",
    "preservationScore": "How well admin intent was maintained"
  },
  "adminApprovalNotes": "What the admin should review before accepting changes"
}
\`\`\`
`;
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
    promptText, gameType, scenario, targetAudience, context, goals, analysisType,
    existingPromptId = null,
  } = body;

  let text = typeof promptText === 'string' ? promptText : '';
  let currentContext = context && typeof context === 'object' ? context : {};

  if (existingPromptId) {
    const found = await findPrompt(event, existingPromptId);
    if (!found) throw httpError(404, `Prompt not found: ${existingPromptId}`);
    const promptData = await readPromptDocument(found);
    // Only legacy prompts carry `template`. Structured (instructions +
    // outputFormat) and generation (basePrompt) prompts would otherwise hand
    // the advisor `undefined` and it would critique the string "undefined".
    text = promptData.template
      || [promptData.instructions, promptData.outputFormat].filter(Boolean).join('\n\n')
      || promptData.basePrompt
      || '';
    currentContext = {
      name: promptData.name,
      description: promptData.description,
      gameType: promptData.gameType,
      category: promptData.category,
      scenario: promptData.scenario,
      ...currentContext,
    };
  }

  return {
    analysisType,
    promptText: text,
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

  const analysisType = body.analysisType ?? 'improve';
  if (!ANALYSIS_TYPES.includes(analysisType)) {
    return json(400, { error: `analysisType must be improve, validate or optimize (got ${JSON.stringify(analysisType)}).` });
  }
  if (!body.promptText && !body.existingPromptId) {
    return json(400, { error: 'Either promptText or existingPromptId is required' });
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
    + `${input.promptId ? `prompt ${input.promptId}` : 'pasted text'} (${input.promptText.length} chars, `
    + `gameType ${input.gameType || input.context.gameType || 'none'})`);
  return json(202, { jobId, status: STATUS.QUEUED, analysisType });
}

// ── The worker ─────────────────────────────────────────────────────────────

/**
 * Take the job, once. Lambda delivers an Event invoke AT LEAST once, and a
 * second delivery of the same job would pay for the same analysis again.
 * Returns false when another delivery already has it.
 */
async function claimJob(jobId) {
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
        ':phase': 'Analysing the prompt',
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
async function completeAdviceJob(jobId, result, orgId) {
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
      ':phase': 'Analysis ready',
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
  if (!(await claimJob(jobId))) {
    console.warn(`⚠️ ${KIND} ${jobId}: already taken (status ${job.status}) — a repeat delivery of the same Event, ignored`);
    return;
  }
  const orgId = job.callerOrgId || '';

  try {
    if (!input || typeof input.promptText !== 'string' || !input.promptText.trim()) {
      throw new AdvisorFailure('The prompt is empty, so there was nothing to analyse. Nothing was changed.');
    }
    const analysisType = ANALYSIS_TYPES.includes(input.analysisType) ? input.analysisType : 'improve';
    console.log(`🪄 ${KIND} ${jobId}: ${analysisType}, ${input.promptText.length} chars, `
      + `${orgId ? 'org-scoped (result sealed)' : 'platform'}`);

    const reply = await invokeClaude(buildAnalysisPrompt({ ...input, analysisType }));

    if (reply.stopReason === 'max_tokens') {
      throw new AdvisorFailure(`The advisor's reply was cut off at its ${MAX_TOKENS.toLocaleString('en-US')}-token `
        + 'limit before it finished, so there is no complete analysis to show. Nothing was changed. '
        + 'Try again; if it happens again, the prompt may be too long to analyse in one pass.');
    }

    const analysis = parseAnalysis(reply.text);
    if (!analysis) {
      console.warn(`⚠️ ${KIND} ${jobId}: ${reply.model} replied with ${reply.text.length} chars that hold no JSON object`);
      throw new AdvisorFailure('The advisor replied, but not in the format it was asked for, so there is nothing to show. '
        + 'Nothing was changed — run it again.');
    }

    await completeAdviceJob(jobId, {
      analysisType,
      promptId: input.promptId || null,
      gameType: input.gameType || input.context?.gameType || null,
      analysis,
      metadata: {
        analyzedAt: new Date().toISOString(),
        modelUsed: reply.model,
        stopReason: reply.stopReason,
        promptLength: input.promptText.length,
      },
    }, orgId);
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
