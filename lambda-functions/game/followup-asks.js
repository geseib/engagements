/**
 * THE SUGGESTION CALL: up to three follow-up asks for one Call & Answer round.
 *
 * docs/design/ca-followup-asks/SPEC.md §4.1-4.2, PLAN.md T6. Made by the
 * get-ai-summary worker AFTER the round's read is stored and announced, so the
 * read is never delayed by it and never broken by it: every failure here
 * returns `{ asks: [], reason }` and nothing is thrown.
 *
 * THE MODEL. Sonnet, whatever wrote the read (owner, 2026-10-11): Bedrock
 * Sonnet 4.6, sent through claude-route.js, which with the Engage-wide switch
 * on sends it to Sonnet 5.5 on the Anthropic API and falls back to Bedrock
 * Sonnet 4.6 with the original request on any failure.
 *
 * THE 5.5 RULES, which the request is written to:
 *   - no assistant prefill (the request has one user turn);
 *   - no temperature;
 *   - the tool is FORCED on the Bedrock body (`tool_choice: {type:'tool'}`),
 *     which Bedrock 4.x honours; the route turns it into `auto` plus "Answer
 *     by calling the suggest_follow_up_asks tool", and treats a reply without
 *     the call as a failure that falls back to Bedrock. So a tool call is a
 *     checked output channel on both paths, and this file reads only the
 *     tool_use block.
 *
 * NOTHING ABOUT THE ROOM IS LOGGED. One structured line per call: the site,
 * the models, the time, the counts and reason words. Never the prompt, the
 * answers, the read or the model's reply.
 */
const { InvokeModelCommand } = require('@aws-sdk/client-bedrock-runtime');
const claudeRoute = require('./claude-route');
const PROMPT = require('./followup-prompt.json');
const { checkSuggestions } = require('./followup-grounding');
const { numberedAnswersText } = require('./numbered-answers');
const { withoutLateIncludedLine } = require('./late-labels');

/** Bedrock Sonnet 4.6; the switch maps it to claude-sonnet-5-5. */
const FOLLOWUP_MODEL_ID = 'us.anthropic.claude-sonnet-4-6';
const SITE = 'followup-asks';
/** The Anthropic attempt, sign-in included; the Bedrock fallback follows it. */
const ROUTE_TIMEOUT_MS = 45000;

const REASONS = Object.freeze({
  NO_ANSWERS: 'no-answers',
  NO_TOOL_CALL: 'no-tool-call',
  MALFORMED: 'malformed',
  MODEL_ERROR: 'model-error',
  TIMEOUT: 'timeout',
});

const profileArn = (modelId) => `arn:aws:bedrock:us-east-1:${process.env.ACCOUNT_ID}:inference-profile/${modelId}`;

/** The instructions with every `{variable}` filled. Unknown names are left alone. */
function buildPrompt(vars) {
  const v = vars || {};
  return String(PROMPT.instructions).replace(/\{([A-Za-z]+)\}/g, (whole, name) => (
    Object.prototype.hasOwnProperty.call(v, name) ? String(v[name] ?? '') : whole
  ));
}

/** The variables the instructions name, in order of first use. */
function promptVariables() {
  return [...new Set([...String(PROMPT.instructions).matchAll(/\{([A-Za-z]+)\}/g)].map((m) => m[1]))];
}

/** The Bedrock request: one user turn, the tool, forced; no prefill, no temperature. */
function buildRequest(promptText) {
  return new InvokeModelCommand({
    modelId: profileArn(FOLLOWUP_MODEL_ID),
    body: JSON.stringify({
      anthropic_version: 'bedrock-2023-05-31',
      max_tokens: PROMPT.maxTokens,
      messages: [{ role: 'user', content: promptText }],
      tools: [PROMPT.tool],
      tool_choice: { type: 'tool', name: PROMPT.tool.name },
    }),
  });
}

/** The tool's input from a Messages-shaped reply body, or null when it did not call it. */
function toolInputOf(replyBody) {
  const content = replyBody && Array.isArray(replyBody.content) ? replyBody.content : [];
  const call = content.find((b) => b && b.type === 'tool_use' && b.name === PROMPT.tool.name);
  return call ? call.input : null;
}

/**
 * Make, read and check the suggestions.
 *
 * @param {object} p
 * @param {string} p.eventTitle
 * @param {string} p.task
 * @param {string} p.questionTitle
 * @param {{n:number,text:string,points:number}[]} p.ranked   numbered-answers.js rankAnswers
 * @param {number} p.voteCount
 * @param {string} p.readBack        the stored read (markdown), plaintext
 * @param {string[]} p.rosterNames
 * @param {(cmd:object)=>Promise<object>} [p.send]  the model call (tests); default claude-route
 * @param {object} [p.bedrock]       the Bedrock client the default send uses
 * @param {number} [p.deadlineMs]    give up (reason 'timeout') after this long
 * @param {object} [p.logContext]    identifiers for the log line (gameId, round)
 * @returns {Promise<{asks: object[], dropped: number, reasons: object, raw: number,
 *   model: string, servedBy: string, ms: number, reason: string|null, promptVersion: string}>}
 */
async function suggestFollowUps(p) {
  const startedAt = Date.now();
  const ranked = Array.isArray(p.ranked) ? p.ranked : [];
  // A Redo's "Includes N answers that arrived late." is about the read, not
  // in it: neither the prompt nor the grounding check sees it.
  const readBack = withoutLateIncludedLine(p.readBack);
  const base = {
    asks: [], dropped: 0, reasons: {}, raw: 0,
    model: FOLLOWUP_MODEL_ID, servedBy: null, ms: 0, reason: null,
    promptVersion: PROMPT.version,
  };
  const finish = (result) => {
    const out = { ...base, ...result, ms: Date.now() - startedAt };
    const marks = {};
    for (const a of out.asks) for (const m of a.marks || []) marks[m] = (marks[m] || 0) + 1;
    console.log(JSON.stringify({
      event: 'followup-asks',
      ...(p.logContext || {}),
      model: out.model,
      servedBy: out.servedBy,
      ms: out.ms,
      reason: out.reason,
      raw: out.raw,
      kept: out.asks.length,
      keptKinds: out.asks.map((a) => a.type),
      dropped: out.dropped,
      dropReasons: out.reasons,
      marks,
      answers: ranked.length,
      promptVersion: out.promptVersion,
    }));
    return out;
  };

  if (!ranked.length) return finish({ reason: REASONS.NO_ANSWERS });

  const promptText = buildPrompt({
    eventTitle: p.eventTitle || 'Engagement Event',
    task: p.task || '',
    questionTitle: p.questionTitle || '',
    responseCount: ranked.length,
    voteCount: Number(p.voteCount) || 0,
    numberedAnswers: numberedAnswersText(ranked),
    readBack,
  });

  const send = p.send || ((cmd) => claudeRoute.send(p.bedrock, cmd, { site: SITE, timeoutMs: ROUTE_TIMEOUT_MS }));
  const once = () => send(buildRequest(promptText));

  let response;
  try {
    const call = (async () => {
      try {
        return await once();
      } catch (e) {
        if (e && e.name === 'ThrottlingException') return once(); // one retry, as the read does
        throw e;
      }
    })();
    // A call still running when the deadline wins must not surface later as
    // an unhandled rejection in a container that has moved on.
    call.catch(() => {});
    const deadline = Number(p.deadlineMs);
    response = Number.isFinite(deadline) && deadline > 0
      ? await Promise.race([
        call,
        new Promise((_, reject) => setTimeout(() => reject(Object.assign(new Error('deadline'), { name: 'FollowUpDeadline' })), deadline).unref()),
      ])
      : await call;
  } catch (e) {
    return finish({ reason: e && e.name === 'FollowUpDeadline' ? REASONS.TIMEOUT : REASONS.MODEL_ERROR });
  }

  const servedBy = claudeRoute.servedBy(response) || FOLLOWUP_MODEL_ID;
  let body;
  try {
    body = JSON.parse(new TextDecoder().decode(response.body));
  } catch {
    return finish({ servedBy, reason: REASONS.MALFORMED });
  }
  const input = toolInputOf(body);
  if (!input) return finish({ servedBy, reason: REASONS.NO_TOOL_CALL });
  if (!Array.isArray(input.asks)) return finish({ servedBy, reason: REASONS.MALFORMED });

  const checked = checkSuggestions(input.asks, ranked.map((a) => a.text), p.rosterNames || [], { read: readBack });
  return finish({
    servedBy,
    asks: checked.kept,
    dropped: checked.dropped,
    reasons: checked.reasons,
    raw: checked.raw,
  });
}

module.exports = {
  FOLLOWUP_MODEL_ID,
  SITE,
  ROUTE_TIMEOUT_MS,
  REASONS,
  PROMPT,
  buildPrompt,
  promptVariables,
  buildRequest,
  toolInputOf,
  suggestFollowUps,
};
