/**
 * AI poll generation — asynchronous, structured, tag-suggesting.
 *
 * Same fix as trivia: generation ran inside the HTTP request against API
 * Gateway's hard 30s integration timeout, worked around with parallel batches
 * that each raced the same clock and were blind to each other. POST now returns
 * 202 + a jobId; a self-invoked worker generates against the full 900s.
 *
 * The old handler's option fallback is gone. When the model returned no usable
 * options it substituted ["Option 1","Option 2","Option 3"] and shipped that as
 * a poll — a placeholder that looks like content and reaches players. A poll
 * with fewer than two real options is now dropped, and the pass simply produces
 * one fewer item.
 */

const { makeGenerationHandler } = require('./shared/generation-handler');
const { tagGuidance } = require('./shared/structured-generation');
const { normalizeTags } = require('./shared/tags');
const {
  normalizeRoundKind, roundKindDirection, roundKindDetailCeiling,
} = require('./shared/round-kinds');
const { pollsToCsv } = require('./shared/generated-set');

const MAX_COUNT = 100;
const MIN_OPTIONS = 2;
const MAX_OPTIONS = 5;

function parseRequest(payload) {
  const total = Math.min(Math.max(parseInt(payload.count, 10) || 1, 1), MAX_COUNT);
  return {
    total,
    config: {
      topic: payload.topic || 'general topics',
      category: payload.category || '',
      audience: payload.audience || '',
      difficulty: payload.difficulty || 'medium',
      allowMultiple: payload.allowMultiple === true,
      customPrompt: payload.customPrompt || '',
      // DIRECTION — what the room is asked to DO with each item, as opposed to
      // the topic it is about. A poll round can hand people somebody else's
      // material and ask where it lands just as a call-and-answer round can;
      // the only difference is that the answers are picked rather than written.
      // Unknown values resolve to `produce` at the reader — the 400 belongs on
      // the write paths. See shared/round-kinds.js.
      roundKind: normalizeRoundKind(payload.roundKind),
      roundKindBrief: String(payload.roundKindBrief || '').trim(),
    },
  };
}

function buildTool(config) {
  // An Apply or Improve poll must CARRY the material it is about — the room is
  // choosing between readings of a passage it was handed, and a passage that
  // does not fit cannot be read. See shared/round-kinds.js for the ceilings.
  const detailMax = roundKindDetailCeiling('poll', config.roundKind);
  const detailSentences = detailMax > 350 ? '3-8 sentences' : '1-3 sentences';
  return {
    name: 'emit_items',
    description: 'Return the generated poll questions as structured data.',
    input_schema: {
      type: 'object',
      properties: {
        items: {
          type: 'array',
          description: 'The generated poll questions, in order.',
          items: {
            type: 'object',
            properties: {
              title: { type: 'string', description: 'The poll question itself, 3-20 words.' },
              category: { type: 'string', description: 'The category this poll belongs to.' },
              detail: {
                type: 'string',
                // The schema and the LENGTH LIMITS block below are two
                // statements of one instruction. They have to move together, or
                // a model reading 300 in one and 900 in the other obeys
                // whichever it read last.
                description: `Background or context, ${detailSentences}, ${detailMax} characters maximum.`,
              },
              school: { type: 'string', description: 'Broader subject area.' },
              customInstructions: { type: 'string', description: 'What the participant should do, one sentence.' },
              options: {
                type: 'array',
                items: { type: 'string' },
                minItems: MIN_OPTIONS,
                maxItems: MAX_OPTIONS,
                description: `${MIN_OPTIONS}-${MAX_OPTIONS} answer options, each 60 characters maximum. They must be genuinely distinct.`,
              },
              allowMultiple: {
                type: 'boolean',
                description: config.allowMultiple
                  ? 'True where picking several options is genuinely useful.'
                  : 'Always false for this set.',
              },
              tags: { type: 'array', items: { type: 'string' }, description: '3-6 lowercase kebab-case tags for filtering and search.' },
            },
            required: ['title', 'category', 'detail', 'customInstructions', 'options', 'allowMultiple', 'tags'],
          },
        },
      },
      required: ['items'],
    },
  };
}

function buildPrompt({ config, count, alreadyUsedTitles }) {
  let p = `You are an expert poll question creator. Create ${count} poll questions about ${config.topic}.`;

  // DIRECTION BEFORE TOPIC — the same ordering, and the same reason, as
  // ai-generate-scenarios.js: the topic used to be the first and only steering
  // an operator had, so a request to hand the room foreign material came back
  // shaped like the house's own reflection prompts.
  const direction = roundKindDirection('poll', config.roundKind, config.roundKindBrief);
  if (direction) {
    p += `\n\n${direction}\n\nWhere the direction above and the topic disagree, follow the direction.`;
  }

  if (config.category) p += `\nCategory: ${config.category}.`;
  if (config.audience) p += `\nTarget audience: ${config.audience}.`;
  p += `\nComplexity level: ${config.difficulty}.`;
  p += config.allowMultiple
    ? `\nSome questions should allow multiple selections where that genuinely helps.`
    : `\nEvery question is single-select. Set allowMultiple to false on all of them.`;
  if (config.customPrompt) p += `\n\nAdditional Requirements: ${config.customPrompt}`;

  if (alreadyUsedTitles.length > 0) {
    p += `\n\nALREADY GENERATED for this set — do not repeat, rephrase, or write a near-variant of any of these:\n`;
    p += alreadyUsedTitles.map((t) => `- ${t}`).join('\n');
  }

  const detailMax = roundKindDetailCeiling('poll', config.roundKind);
  p += [
    '',
    '',
    'LENGTH LIMITS (hard limits, not targets):',
    '- title: the question itself, 3-20 words.',
    `- detail: ${detailMax > 350 ? '3-8' : '1-3'} sentences, ${detailMax} characters maximum.`,
    '- customInstructions: one sentence.',
    `- options: ${MIN_OPTIONS}-${MAX_OPTIONS} of them, 60 characters each.`,
    'Write only what the content needs; do not pad to reach a limit.',
    '',
    'A poll measures opinion, so it has no correct answer. Options must cover the',
    'realistic range of views and must not overlap.',
  ].join('\n');
  p += tagGuidance();
  p += `\n\nReturn the questions by calling the emit_items tool. Do not write prose.`;
  return p;
}

function normalizeItem(raw, config) {
  const title = String(raw?.title || '').trim();
  if (!title) return null;

  const options = (Array.isArray(raw?.options) ? raw.options : [])
    .map((o) => String(o || '').trim())
    .filter(Boolean)
    .slice(0, MAX_OPTIONS);
  // A poll with one option is not a poll. Dropping it costs one item; the old
  // placeholder fallback cost a question set that looked complete and was not.
  if (options.length < MIN_OPTIONS) return null;

  return {
    id: Date.now() + Math.random(),
    active: true,
    title,
    category: String(raw?.category || config.category || 'General').trim(),
    detail: String(raw?.detail || '').trim(),
    school: String(raw?.school || 'General Context').trim(),
    customInstructions: String(raw?.customInstructions || '').trim(),
    options,
    // An explicit single-select request wins over a model that volunteers
    // multi-select.
    allowMultiple: config.allowMultiple ? raw?.allowMultiple === true : false,
    tags: normalizeTags(raw?.tags),
  };
}

exports.handler = makeGenerationHandler({
  kind: 'poll',
  tokenKind: 'poll',
  parseRequest,
  buildTool,
  buildPrompt,
  normalizeItem,
  // A WHOLE-SET GENERATOR, so leaving the builder produces a draft set rather
  // than a job record nobody turned into anything. See shared/generated-set.js.
  //
  // The DIRECTION travels: a poll round can hand people somebody else's
  // material just as a call-and-answer round can, and a kind that steers the
  // generation and is then dropped at creation leaves the library, the editor
  // and every later regeneration believing the set was Produce.
  setCreation: {
    engagementType: 'poll',
    toCsv: (items) => pollsToCsv(items),
    roundKindFrom: (payload) => ({
      roundKind: payload?.roundKind,
      roundKindBrief: payload?.roundKindBrief,
    }),
  },
});
