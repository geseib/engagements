/**
 * Structured (tool-use) generation for the AI builders.
 *
 * REPLACES: asking the model for "ONLY the JSON array" and then running four
 * escalating regex strategies over the prose it actually returned. That parser
 * failed in production — two of three sampled invocations died on
 * "No JSON array found in response" AFTER 39-40 seconds of paid generation,
 * because the response hit max_tokens mid-object and therefore had no closing
 * `]` for `/\[[\s\S]*\]/` to find. A truncation was being reported as a parse
 * error, which is why it was never obvious what was wrong.
 *
 * Two changes fix that class of failure:
 *   1. Tool use, so the model returns a typed object instead of prose we parse.
 *      (Plain tool use, NOT `strict: true` — strict/structured outputs are not
 *      offered on Sonnet 4.6, which is the model this stack is wired to. Plain
 *      tool use is available on every Claude model and is what matters here.)
 *   2. An explicit `stop_reason === 'max_tokens'` check, so truncation says it
 *      truncated instead of impersonating malformed JSON.
 *
 * The length limits below are the other half of the fix and matter MORE than
 * the token budget. The runaway output was the root cause of both the latency
 * and the truncation: with no length guidance in the fallback prompt, a single
 * "detailed" scenario came back as 8,500 characters. Raising max_tokens alone
 * would have bought slower, more expensive essays.
 */

const { retryWithBackoff } = require('./bedrock-utils');
const { MIN_SUGGESTED_TAGS, MAX_TAGS } = require('./tags');
const { roundKindDetailCeiling } = require('./round-kinds');

const SONNET = () => `arn:aws:bedrock:us-east-1:${process.env.ACCOUNT_ID}:inference-profile/us.anthropic.claude-sonnet-4-6`;
const HAIKU = () => `arn:aws:bedrock:us-east-1:${process.env.ACCOUNT_ID}:inference-profile/us.anthropic.claude-haiku-4-5-20251001-v1:0`;

const TOOL_NAME = 'emit_items';

/**
 * Output-token budget per Bedrock call.
 *
 * Sized against the ~45 output tokens/sec this account measures from Sonnet:
 * 8000 tokens is roughly 3 minutes, comfortable inside the Lambda's 900s and
 * meaningless to the API Gateway ceiling now that generation is off the request.
 */
const MAX_TOKENS_PER_CALL = 8000;
const PROMPT_OVERHEAD_TOKENS = 600;

/**
 * With the length limits enforced below, an item costs roughly this much.
 *
 * Keyed by engagement type for the scenario builder and by generation kind for
 * the others. Measured against real output: a trivia question carries 4-6
 * options plus an explanation, a poll carries 3-5 short options and no
 * explanation, a survey question is mostly a scale or a placeholder.
 */
const PER_ITEM_TOKENS = {
  wavelength: 110,
  survey: 200,
  poll: 260,
  trivia: 380,
  question: 420,
  // A question SET's own metadata, drafted as one object: a title, a
  // description, a participant instruction and an AI context instruction. Four
  // prose fields against a question's one, so it is budgeted above `question`
  // rather than left on `default` — the default would give the longest of the
  // four (the AI context, which conditions every later generation) barely room
  // to finish, and a truncated draft is a failed one.
  'set-metadata': 900,
  // A BUILDER FORM, drafted as one object: up to five prose fields whose
  // character ceilings add up to ~2200 (shared/builder-form-fields.js), which is
  // roughly 600 output tokens. Budgeted at double that so the longest field —
  // `customPrompt`, at 1200 characters, and the one that steers the whole
  // generation afterwards — has room to finish. A truncated draft is a failed
  // one, and this is the field an operator is least able to tell was cut short.
  'builder-form': 1200,
  default: 420,
};

const perItemTokens = (engagementType) =>
  PER_ITEM_TOKENS[engagementType] || PER_ITEM_TOKENS.default;

/**
 * How many items one call may produce.
 *
 * The old design ran ONE item per call, twenty calls deep, and each call was
 * blind to the other nineteen — which is precisely why duplicates appeared. One
 * call that writes all the items can see everything it has already written.
 */
function itemsPerCall(engagementType) {
  return Math.max(1, Math.floor((MAX_TOKENS_PER_CALL - PROMPT_OVERHEAD_TOKENS) / perItemTokens(engagementType)));
}

function maxTokensFor(engagementType, count) {
  return Math.min(PROMPT_OVERHEAD_TOKENS + count * perItemTokens(engagementType), MAX_TOKENS_PER_CALL);
}

/**
 * Hard length limits, stated as limits.
 *
 * "Level of Detail: detailed" alone produced 8,500-character scenarios. The
 * final line matters as much as the numbers — without it the model treats the
 * ceiling as a target and pads to reach it.
 *
 * THE `detail` CEILING IS ROUND-KIND AWARE, and it has to be, because this
 * block is appended LAST and a model weights the most recent formatting
 * instruction most heavily. An Apply or Improve question must CARRY the
 * material it is about; a flat 350 characters would quietly win that argument
 * and produce a round that gestures at a passage nobody was given. Produce
 * keeps 350 — its `detail` is framing, not source material. See
 * shared/round-kinds.js for the ceilings and the engagement-type gate.
 */
function lengthGuidance(engagementType, roundKind) {
  if (engagementType === 'wavelength') {
    return [
      '',
      'LENGTH LIMITS (hard limits, not targets):',
      '- title: a subject of 1-4 words.',
      '- detail: ONE sentence of framing, 140 characters maximum.',
      '- customInstructions: one sentence telling the player what to enter.',
      'Write only what the content needs; do not pad to reach a limit.',
    ].join('\n');
  }
  const detailMax = roundKindDetailCeiling(engagementType, roundKind);
  // A 900-character ceiling with a "2-4 sentences" cap beside it is two limits
  // that contradict each other, and the model would obey whichever it read
  // last. The sentence count scales with the ceiling instead.
  const sentences = detailMax > 350 ? '3-8 sentences' : '2-4 sentences';
  return [
    '',
    'LENGTH LIMITS (hard limits, not targets):',
    '- title: 3-10 words. Do not use a colon to bolt a subtitle onto the title.',
    `- detail: ${sentences}, ${detailMax} characters maximum.`,
    '- customInstructions: 1-2 sentences, 200 characters maximum.',
    'Write only what the content needs; do not pad to reach a limit. A short,',
    'sharp scenario is better than a thorough one nobody reads aloud.',
  ].join('\n');
}

/** Tell the model what a tag is for, or it emits one tag per item and filters nothing. */
function tagGuidance() {
  return [
    '',
    `TAGS: suggest ${MIN_SUGGESTED_TAGS}-${MAX_TAGS} tags per item, lowercase kebab-case`,
    '(e.g. "remote-work", "conflict-resolution", "leadership"). Tags are for',
    'filtering and search later, so prefer terms that group SOME items together',
    'and separate others. A tag that would apply to every item in this set is',
    'useless — skip it. Do not invent a tag that only restates the title.',
  ].join('\n');
}

/**
 * Tool schema. `tags` is folded into the same call that writes the content —
 * the model that just wrote the scenario is the thing best placed to say what
 * it is about, and once we are no longer regex-parsing prose it is nearly free.
 */
function buildItemsTool(engagementType, roundKind) {
  const isWavelength = engagementType === 'wavelength';
  // The schema description is a SECOND statement of the length limit, and a
  // model reads both. Leaving it hardcoded at 350 while lengthGuidance() says
  // 900 would put the two halves of the same instruction in disagreement, which
  // is the failure mode this whole module was written to stop.
  const detailMax = roundKindDetailCeiling(engagementType, roundKind);
  const detailSentences = detailMax > 350 ? '3-8 sentences' : '2-4 sentences';
  return {
    name: TOOL_NAME,
    description: isWavelength
      ? 'Return the generated wavelength subjects as structured data.'
      : 'Return the generated scenarios as structured data.',
    input_schema: {
      type: 'object',
      properties: {
        items: {
          type: 'array',
          description: 'The generated items, in order.',
          items: {
            type: 'object',
            properties: {
              title: {
                type: 'string',
                description: isWavelength ? 'The subject, 1-4 words.' : 'The scenario title, 3-10 words.',
              },
              category: {
                type: 'string',
                description: 'The category this item belongs to. Use only the categories requested.',
              },
              detail: {
                type: 'string',
                description: isWavelength
                  ? 'One sentence of framing, 140 characters maximum.'
                  : `The scenario itself, ${detailSentences}, ${detailMax} characters maximum.`,
              },
              customInstructions: {
                type: 'string',
                description: 'What the participant should do, 1-2 sentences.',
              },
              tags: {
                type: 'array',
                items: { type: 'string' },
                description: `${MIN_SUGGESTED_TAGS}-${MAX_TAGS} lowercase kebab-case tags for filtering and search.`,
              },
            },
            required: ['title', 'category', 'detail', 'customInstructions', 'tags'],
          },
        },
      },
      required: ['items'],
    },
  };
}

/** Pull the tool_use block out of a Bedrock messages response. */
function extractToolInput(responseBody) {
  const blocks = Array.isArray(responseBody?.content) ? responseBody.content : [];
  const toolUse = blocks.find((b) => b && b.type === 'tool_use' && b.name === TOOL_NAME);
  if (!toolUse) {
    const text = blocks.filter((b) => b?.type === 'text').map((b) => b.text).join(' ').slice(0, 300);
    throw new Error(`Model did not call ${TOOL_NAME}${text ? ` (said: ${text})` : ''}`);
  }
  return toolUse.input || {};
}

/**
 * One structured generation call, Sonnet with a Haiku fallback.
 *
 * Throws a NAMED truncation error when the model runs out of budget, so the
 * caller can shrink the chunk and retry instead of reporting "no JSON array
 * found" and losing the run.
 */
async function invokeStructured(bedrockClient, InvokeModelCommand, { prompt, tool, maxTokens }) {
  const payload = {
    anthropic_version: 'bedrock-2023-05-31',
    max_tokens: maxTokens,
    temperature: 0.7,
    tools: [tool],
    tool_choice: { type: 'tool', name: tool.name },
    messages: [{ role: 'user', content: prompt }],
  };

  const call = async () => {
    let responseBody;
    try {
      const res = await bedrockClient.send(new InvokeModelCommand({
        modelId: SONNET(),
        body: JSON.stringify(payload),
      }));
      responseBody = JSON.parse(new TextDecoder().decode(res.body));
    } catch (error) {
      console.error('🚨 BEDROCK Sonnet ERROR:', error.message);
      console.log('🔄 BEDROCK: trying Haiku 4.5 as fallback...');
      const res = await bedrockClient.send(new InvokeModelCommand({
        modelId: HAIKU(),
        body: JSON.stringify(payload),
      }));
      responseBody = JSON.parse(new TextDecoder().decode(res.body));
    }

    // The check the old parser never made. A truncated tool_use input is not
    // recoverable and must not be reported as malformed JSON.
    if (responseBody?.stop_reason === 'max_tokens') {
      const err = new Error(`Model hit the ${maxTokens}-token output limit before finishing`);
      err.name = 'OutputTruncatedError';
      throw err;
    }

    return extractToolInput(responseBody);
  };

  // retryWithBackoff only re-attempts throttling; anything else throws on the
  // first failure. That is the behaviour we want here — retrying an identical
  // request that truncated just burns another 40 seconds to fail the same way.
  return retryWithBackoff(call, 2, 1000);
}

module.exports = {
  TOOL_NAME,
  MAX_TOKENS_PER_CALL,
  PER_ITEM_TOKENS,
  perItemTokens,
  itemsPerCall,
  maxTokensFor,
  lengthGuidance,
  tagGuidance,
  buildItemsTool,
  extractToolInput,
  invokeStructured,
};
