/**
 * THE MODELS WORKIE'S READ MAY BE WRITTEN BY — dev's model picker.
 *
 * The owner wants to regenerate one round with different models and compare
 * the reads side by side (2026-10-11, after docs/reviews/
 * relay-pilot-ai-advisor-2026-10-11.md). This is the one list. Everything the
 * picker, the generator and the cost line need about a model is here, so a
 * model is added or dropped in one place.
 *
 * THE PICKER IS DEV ONLY. template-clean.yaml passes `AiModelPicker` to the
 * get-ai-summary function as AI_MODEL_PICKER; only buildspec-dev.yml sets it to
 * 'true'. While it is off, nothing here is consulted except DEFAULT_MODEL, and
 * the read is written exactly as it was before the picker existed: Bedrock
 * Haiku 4.5, with its first heading prefilled.
 *
 * Fields:
 *   id         the catalogue id the host sends as `model`, and the suffix of a
 *              variant row's SK. Never contains "#".
 *   label      what the staff menu and the Compare footer print.
 *   provider   'bedrock' (this account's inference profiles, IAM-authorised)
 *              or 'anthropic' (the Messages API, signed in with Workload
 *              Identity Federation — anthropic-messages.js; no stored key).
 *   modelId    what the provider is asked for.
 *   prefill    whether the model accepts the reply's first heading as an
 *              assistant prefill. Only Haiku 4.5 does: Sonnet 4.6, Opus 4.6
 *              and every Anthropic API model here return 400 on a prefill, so
 *              for them the heading is asked for in words and checked after.
 *   temperature  whether `temperature` may be sent. The current Anthropic API
 *              models refuse a non-default value with a 400, so they get
 *              their default; the Bedrock models keep the 0.7 the read was
 *              tuned at.
 *   maxTokens  only where it differs from the read's 2048: Opus 5.5 and Fable
 *              5.1 think on every request (it cannot be switched off), and
 *              their thinking counts against max_tokens, so they get room for
 *              it rather than a reply cut short.
 *   thinking   the `thinking` field sent, where thinking can be switched off.
 *   priceIn / priceOut  rough list price, US dollars per million tokens, for
 *              the Compare footer's cost line. Bedrock rows use the matching
 *              Anthropic list price; check AWS's page before quoting one.
 */
const { anthropicConnected } = require('./anthropic-messages');

const MODELS = Object.freeze([
  {
    id: 'bedrock-haiku-4-5', label: 'Claude Haiku 4.5', provider: 'bedrock',
    modelId: 'us.anthropic.claude-haiku-4-5-20251001-v1:0',
    prefill: true, temperature: true, priceIn: 1, priceOut: 5,
  },
  {
    id: 'bedrock-sonnet-4-6', label: 'Claude Sonnet 4.6', provider: 'bedrock',
    modelId: 'us.anthropic.claude-sonnet-4-6',
    prefill: false, temperature: true, priceIn: 3, priceOut: 15,
  },
  {
    id: 'bedrock-opus-4-6', label: 'Claude Opus 4.6', provider: 'bedrock',
    modelId: 'us.anthropic.claude-opus-4-6-v1',
    prefill: false, temperature: true, priceIn: 5, priceOut: 25,
  },
  {
    id: 'claude-haiku-5-5', label: 'Claude Haiku 5.5', provider: 'anthropic',
    modelId: 'claude-haiku-5-5',
    prefill: false, temperature: false, thinking: { type: 'disabled' },
    priceIn: 0.1, priceOut: 0.5,
  },
  {
    id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5', provider: 'anthropic',
    modelId: 'claude-sonnet-5-5',
    // Sonnet 5.5 refuses `disabled`; `between_tools` is its thinking-off.
    prefill: false, temperature: false, thinking: { type: 'between_tools' },
    priceIn: 2, priceOut: 10,
  },
  {
    id: 'claude-opus-5-5', label: 'Claude Opus 5.5', provider: 'anthropic',
    modelId: 'claude-opus-5-5',
    prefill: false, temperature: false, maxTokens: 8192,
    priceIn: 4, priceOut: 20,
  },
  {
    id: 'claude-fable-5-1', label: 'Claude Fable 5.1', provider: 'anthropic',
    modelId: 'claude-fable-5-1',
    prefill: false, temperature: false, maxTokens: 8192,
    priceIn: 10, priceOut: 50,
  },
].map(Object.freeze));

const DEFAULT_MODEL_ID = 'bedrock-haiku-4-5';
const DEFAULT_MODEL = MODELS.find((m) => m.id === DEFAULT_MODEL_ID);

/** The catalogue entry for an id, or null. Only an exact id matches. */
function findModel(id) {
  if (typeof id !== 'string') return null;
  return MODELS.find((m) => m.id === id) || null;
}

/** The catalogue entry whose provider id is `modelId`, or null. */
function modelByProviderId(modelId) {
  return MODELS.find((m) => m.modelId === modelId) || null;
}

/** Is the picker switched on for this function? Exactly 'true'; anything else is off. */
function modelPickerOn(env = process.env) {
  return env.AI_MODEL_PICKER === 'true';
}

/**
 * What the staff menu is told: no provider model ids, nothing secret. An
 * Anthropic API model is marked unavailable until all four federation ids are
 * set (anthropic-messages.js); asked for anyway, it falls back to Haiku 4.5
 * with the reason "not-connected".
 */
const NOT_CONNECTED = 'Anthropic API not connected';
function pickerCatalogue(env = process.env) {
  const connected = anthropicConnected(env);
  return MODELS.map((m) => {
    const available = m.provider !== 'anthropic' || connected;
    return {
      id: m.id, label: m.label, provider: m.provider,
      priceIn: m.priceIn, priceOut: m.priceOut, isDefault: m.id === DEFAULT_MODEL_ID,
      available, ...(available ? {} : { unavailableReason: NOT_CONNECTED }),
    };
  });
}

/** Rough US dollars for one read, or null when a count is missing. */
function estimateCostUsd(model, inputTokens, outputTokens) {
  if (!model || !Number.isFinite(inputTokens) || !Number.isFinite(outputTokens)) return null;
  return (inputTokens * model.priceIn + outputTokens * model.priceOut) / 1e6;
}

/**
 * WHERE A VARIANT LIVES: `QUESTION#<nnn>#AIVARIANT#<catalogue id>`.
 *
 * Not `…#AISummary#…`: create-report.js gathers a game's summaries with
 * `SK.includes('#AISummary')` and numbers them with /QUESTION#(\d+)#AISummary/,
 * so a variant under that name would land in the session report as a second
 * read of the round. The room's reader keeps its exact key,
 * `QUESTION#<nnn>#AISummary`, which no variant ever writes.
 */
const variantSkPrefix = (paddedQuestionNumber) => 'QUESTION#' + paddedQuestionNumber + '#AIVARIANT#';
const variantSk = (paddedQuestionNumber, id) => variantSkPrefix(paddedQuestionNumber) + id;

module.exports = {
  MODELS,
  DEFAULT_MODEL_ID,
  DEFAULT_MODEL,
  findModel,
  modelByProviderId,
  modelPickerOn,
  pickerCatalogue,
  estimateCostUsd,
  variantSkPrefix,
  variantSk,
};
