/**
 * CLAUDE MODELS: ANTHROPIC 5.5 (DEFAULT) OR BEDROCK 4.x — the Engage-wide switch.
 *
 * The owner, 2026-10-11: "I want 5.5 to be the default API call in the
 * session. I want the option to set these in the admin pages. A direct switch:
 * if Sonnet 4.6 go to Sonnet 5.5, if Haiku 4.5 go to Haiku 5.5. For now set
 * this at the Engage level for everyone."
 *
 * So every model call in Engage goes through `send(bedrock, command)` in place
 * of `bedrock.send(command)`. It decides, per call:
 *
 *   Bedrock Haiku 4.5  (us.anthropic.claude-haiku-4-5-20251001-v1:0) -> claude-haiku-5-5
 *   Bedrock Sonnet 4.6 (us.anthropic.claude-sonnet-4-6)              -> claude-sonnet-5-5
 *   anything else (Opus 4.6 in dev's picker, a guardrail)            -> Bedrock, untouched
 *
 * and sends the mapped call to the Anthropic Messages API
 * (anthropic-messages.js, Workload Identity Federation) only when ALL of:
 *   1. the model is one of the two above;
 *   2. the tier has the four federation ids (anthropicConnected) — prod has
 *      none yet, so prod never even reads the setting;
 *   3. the platform setting is on. One row, PLATFORM#SETTINGS / CLAUDE_MODELS,
 *      field Anthropic55 (boolean). ABSENT MEANS ON — the owner's default.
 *      Staff change it in the platform console (admin/orgs/platform-settings.js),
 *      audited first. Read at most once a minute per warm container.
 * Otherwise `bedrock.send(command)` is called with the very command it was
 * given, so with the switch off a call site's Bedrock request is byte for byte
 * what it was before this file existed.
 *
 * THE REQUEST, TRANSLATED. The command's Bedrock body is the source; the API
 * body differs only where the 5.5 models require it (claude-api skill,
 * "Migrating to Claude Haiku 5.5 / Sonnet 5.5"):
 *   - `anthropic_version` dropped (a Bedrock field);
 *   - `temperature`, `top_p`, `top_k` dropped — a non-default value is a 400;
 *   - an assistant PREFILL is a 400: the last assistant turn is removed, the
 *     user turn asks for the reply to begin with that text, and the reply is
 *     checked and the prefill cut off it — so a caller that adds its prefill
 *     back (`'{' + text`) reads exactly what Bedrock would have given it;
 *   - a FORCED tool_choice (`tool` / `any`) is a 400 on Sonnet 5.5, so both
 *     models are sent `auto` plus a sentence naming the tool, and a reply
 *     that did not call it is a failure;
 *   - thinking OFF, as the calls were tuned without it: `disabled` on Haiku
 *     5.5, `between_tools` on Sonnet 5.5 (which refuses `disabled`), at effort
 *     `low` unless the call site asks for more;
 *   - `max_tokens` raised by half again, plus 256: the 5.5 tokenizer counts the
 *     same text as about 30% more tokens, and a reply cut short is a failure.
 *
 * EVERY FAILURE FALLS BACK TO THE ORIGINAL BEDROCK MODEL, with the original
 * command: not connected, STS, token exchange, HTTP error, timeout, refusal,
 * a reply cut off at max_tokens, an empty reply, a missing tool call, a reply
 * that does not begin with the prefill. One structured warning is logged —
 * the site, the models and a reason word; never a token, never the prompt,
 * never the reply.
 *
 * THE ANSWER, TRANSLATED BACK into the shape the call sites already read:
 * `{ body: <bytes of a Messages-shaped JSON> }`, holding only text and
 * tool_use blocks (thinking blocks are never passed on). The response also
 * carries `claudeModel` — the API model that wrote it — so a caller that
 * records a model (the round's read, `Model`) can say which one actually did.
 * A Bedrock response is returned exactly as Bedrock gave it.
 *
 * DUPLICATED, BYTE FOR BYTE: lambda-functions/game/claude-route.js and
 * lambda-functions/admin/shared/claude-route.js (Lambda bundles are
 * per-folder). tests/claude-55-switch.js fails the build if they drift.
 */
const anthropic = require('./anthropic-messages');

const { ModelCallError, REASONS } = anthropic;

/** The direct switch. Keys are Bedrock model ids (an inference profile's suffix). */
const MODEL_MAP = Object.freeze({
  'us.anthropic.claude-haiku-4-5-20251001-v1:0': 'claude-haiku-5-5',
  'us.anthropic.claude-sonnet-4-6': 'claude-sonnet-5-5',
});

/** Each API model's thinking-off setting. Sonnet 5.5 answers `disabled` with a 400. */
const THINKING_OFF = Object.freeze({
  'claude-haiku-5-5': Object.freeze({ type: 'disabled' }),
  'claude-sonnet-5-5': Object.freeze({ type: 'between_tools' }),
});

/** Effort levels a call site may ask for; both models accept thinking off at these. */
const EFFORTS = Object.freeze(['low', 'medium', 'high']);

/** Under every model-calling function's timeout, with room for the fallback. */
const DEFAULT_TIMEOUT_MS = 60000;
/** The API's own ceiling for one non-streamed reply, kept well under 128K. */
const MAX_TOKENS_CEILING = 32000;

/** The one platform row. */
const SETTING_KEY = Object.freeze({ PK: 'PLATFORM#SETTINGS', SK: 'CLAUDE_MODELS' });
const SETTING_FIELD = 'Anthropic55';
const SETTING_CACHE_MS = 60000;

let clock = () => Date.now();

// ---- which model --------------------------------------------------------------
/** A Bedrock model id out of a modelId that may be an inference-profile ARN. */
function bedrockModelOf(modelId) {
  const s = String(modelId || '');
  const marker = 'inference-profile/';
  const i = s.lastIndexOf(marker);
  return i >= 0 ? s.slice(i + marker.length) : s;
}

/** The API model a Bedrock model id switches to, or null when it has none. */
function apiModelFor(modelId) {
  return MODEL_MAP[bedrockModelOf(modelId)] || null;
}

// ---- the setting -------------------------------------------------------------
/** The row's value: true unless the row says false. Absent, malformed: on. */
function settingFromItem(item) {
  if (!item || typeof item[SETTING_FIELD] !== 'boolean') return true;
  return item[SETTING_FIELD];
}

let docClient = null;
async function readSettingRow() {
  if (!docClient) {
    const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
    const { DynamoDBDocumentClient } = require('@aws-sdk/lib-dynamodb');
    docClient = DynamoDBDocumentClient.from(new DynamoDBClient({ region: process.env.AWS_REGION || 'us-east-1' }));
  }
  const { GetCommand } = require('@aws-sdk/lib-dynamodb');
  const res = await docClient.send(new GetCommand({ TableName: process.env.TABLE_NAME, Key: { ...SETTING_KEY } }));
  return res && res.Item ? res.Item : null;
}

let readSetting = readSettingRow;
let cached = null; // { value, at }

/**
 * Is the platform switch on? Cached a minute per warm container. A read that
 * fails keeps the last value known, or the default (on): an unreadable row
 * must not quietly change which model answers.
 */
async function anthropic55On() {
  if (cached && clock() - cached.at < SETTING_CACHE_MS) return cached.value;
  let value;
  try {
    value = settingFromItem(await readSetting());
  } catch (e) {
    console.warn(JSON.stringify({ event: 'claude-switch-unreadable', error: e && e.name ? e.name : 'Error' }));
    value = cached ? cached.value : true;
  }
  cached = { value, at: clock() };
  return value;
}

/** The API model this call goes to, or null for Bedrock. Never throws. */
async function routeFor(modelId) {
  const apiModel = apiModelFor(modelId);
  if (!apiModel) return null;
  if (!anthropic.anthropicConnected()) return null;
  try {
    return (await anthropic55On()) ? apiModel : null;
  } catch {
    return null;
  }
}

// ---- the request ---------------------------------------------------------------
const invalid = () => new ModelCallError(REASONS.INVALID);

function textOf(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content.filter((b) => b && b.type === 'text').map((b) => b.text || '').join('');
  }
  return '';
}

function apiMaxTokens(n) {
  const base = Number.isFinite(n) && n > 0 ? n : 1024;
  return Math.min(Math.ceil(base * 1.5) + 256, MAX_TOKENS_CEILING);
}

function decodeBody(body) {
  if (typeof body === 'string') return body;
  if (body instanceof Uint8Array) return new TextDecoder().decode(body);
  throw invalid();
}

/**
 * The API request for one Bedrock body, and what the reply must show.
 * Exported for the tests that pin its shape.
 */
function toApiRequest(bedrockBody, apiModel, { effort = 'low' } = {}) {
  let b;
  try { b = JSON.parse(decodeBody(bedrockBody)); } catch { throw invalid(); }
  if (!b || !Array.isArray(b.messages) || !b.messages.length) throw invalid();
  const messages = b.messages.map((m) => ({ ...m }));

  let prefill = '';
  if (messages[messages.length - 1].role === 'assistant') {
    prefill = textOf(messages.pop().content);
  }
  const asks = [];
  if (prefill) asks.push('Begin your reply with exactly this text, and write nothing before it:\n' + prefill);

  const tc = b.tool_choice;
  const forced = Boolean(tc && (tc.type === 'tool' || tc.type === 'any'));
  const toolName = tc && tc.type === 'tool' ? String(tc.name || '') : '';
  if (toolName) asks.push(`Answer by calling the ${toolName} tool. Do not answer in text.`);
  else if (forced) asks.push('Answer by calling one of the tools. Do not answer in text.');

  if (asks.length) {
    const last = messages[messages.length - 1];
    if (!last || last.role !== 'user') throw invalid();
    const extra = '\n\n' + asks.join('\n\n');
    if (typeof last.content === 'string') {
      last.content += extra;
    } else if (Array.isArray(last.content)) {
      last.content = [...last.content, { type: 'text', text: extra.trim() }];
    } else {
      throw invalid();
    }
  }

  const request = {
    model: apiModel,
    max_tokens: apiMaxTokens(b.max_tokens),
    messages,
    thinking: { ...THINKING_OFF[apiModel] },
    output_config: { effort: EFFORTS.includes(effort) ? effort : 'low' },
  };
  if (b.system !== undefined) request.system = b.system;
  if (Array.isArray(b.tools)) request.tools = b.tools;
  if (tc) {
    request.tool_choice = forced
      ? { type: 'auto', ...(tc.disable_parallel_tool_use ? { disable_parallel_tool_use: true } : {}) }
      : tc;
  }
  if (Array.isArray(b.stop_sequences)) request.stop_sequences = b.stop_sequences;
  return { request, prefill, toolName, forced };
}

// ---- the reply ---------------------------------------------------------------
/** Where the prefill starts: at the top, or on a line of its own just after a short preamble. */
function prefillAt(text, prefill) {
  if (text.startsWith(prefill)) return 0;
  const i = text.indexOf('\n' + prefill);
  return i >= 0 && i < 300 ? i + 1 : -1;
}

/**
 * A Messages-shaped body the call sites already parse, from the API's reply.
 * Throws a ModelCallError when the reply is not one the caller could use.
 */
function toBedrockShape(parsed, plan, apiModel) {
  if (parsed.stop_reason === 'max_tokens') throw new ModelCallError(REASONS.MAX_TOKENS);
  const content = (Array.isArray(parsed.content) ? parsed.content : [])
    .filter((blk) => blk && ((blk.type === 'text' && typeof blk.text === 'string') || blk.type === 'tool_use'))
    .map((blk) => (blk.type === 'text'
      ? { type: 'text', text: blk.text }
      : { type: 'tool_use', id: blk.id, name: blk.name, input: blk.input }));

  if (plan.forced) {
    const called = content.some((blk) => blk.type === 'tool_use' && (!plan.toolName || blk.name === plan.toolName));
    if (!called) throw invalid();
  } else if (!content.some((blk) => blk.type === 'text' && blk.text.trim())) {
    throw new ModelCallError(REASONS.EMPTY);
  }

  if (plan.prefill) {
    const first = content.find((blk) => blk.type === 'text');
    if (!first) throw invalid();
    const text = first.text.replace(/^\s+/, '');
    const at = prefillAt(text, plan.prefill);
    if (at < 0) throw invalid();
    first.text = text.slice(at + plan.prefill.length);
  }

  const usage = parsed.usage || {};
  return {
    id: parsed.id,
    type: 'message',
    role: 'assistant',
    model: apiModel,
    content,
    stop_reason: parsed.stop_reason || null,
    stop_sequence: parsed.stop_sequence ?? null,
    usage: {
      input_tokens: Number.isFinite(usage.input_tokens) ? usage.input_tokens : null,
      output_tokens: Number.isFinite(usage.output_tokens) ? usage.output_tokens : null,
    },
  };
}

// ---- the call --------------------------------------------------------------------
/**
 * `bedrock.send(command)`, through the switch. `command` is an
 * InvokeModelCommand; its `input` is read, never changed.
 *
 * @param {object} opts
 * @param {string} opts.site       a short name for the logs ('draft-briefing')
 * @param {number} opts.timeoutMs  the whole API attempt, sign-in included
 * @param {string} opts.effort     'low' (default) | 'medium' | 'high'
 */
async function send(bedrock, command, { site = 'model-call', timeoutMs = DEFAULT_TIMEOUT_MS, effort = 'low' } = {}) {
  const input = (command && command.input) || {};
  const apiModel = await routeFor(input.modelId);
  if (!apiModel) return bedrock.send(command);

  const startedAt = clock();
  try {
    const plan = toApiRequest(input.body, apiModel, { effort });
    const parsed = await anthropic.postMessagesRaw(plan.request, { timeoutMs });
    const shaped = toBedrockShape(parsed, plan, apiModel);
    console.log(JSON.stringify({
      event: 'claude-route', site, model: apiModel, ms: clock() - startedAt,
      stopReason: shaped.stop_reason, outputTokens: shaped.usage.output_tokens,
    }));
    return {
      body: new TextEncoder().encode(JSON.stringify(shaped)),
      contentType: 'application/json',
      claudeModel: apiModel,
    };
  } catch (e) {
    // The reason word and the models, never the error's own text.
    console.warn(JSON.stringify({
      event: 'claude-route-fallback', site, model: apiModel,
      fallback: bedrockModelOf(input.modelId),
      reason: e instanceof ModelCallError ? e.reason : REASONS.INVALID,
      status: (e && e.status) || null,
      ms: clock() - startedAt,
    }));
    return bedrock.send(command);
  }
}

/** The API model that wrote a response from `send`, or null when Bedrock did. */
function servedBy(response) {
  return (response && typeof response.claudeModel === 'string' && response.claudeModel) || null;
}

module.exports = {
  MODEL_MAP,
  THINKING_OFF,
  SETTING_KEY,
  SETTING_FIELD,
  SETTING_CACHE_MS,
  DEFAULT_TIMEOUT_MS,
  apiModelFor,
  bedrockModelOf,
  settingFromItem,
  anthropic55On,
  routeFor,
  toApiRequest,
  toBedrockShape,
  send,
  servedBy,
  /** Tests only. */
  _setSettingReader(fn) { readSetting = fn || readSettingRow; cached = null; },
  _resetSettingCache() { cached = null; },
  _setClock(fn) { clock = fn || (() => Date.now()); },
};
