/**
 * AI poll generation — asynchronous, structured, tag-suggesting, and since the
 * 27 Sep 2026 redesign it writes TYPED polls.
 *
 * Same fix as trivia: generation ran inside the HTTP request against API
 * Gateway's hard 30s integration timeout, worked around with parallel batches
 * that each raced the same clock and were blind to each other. POST now returns
 * 202 + a jobId; a self-invoked worker generates against the full 900s.
 *
 * The old handler's option fallback is gone. When the model returned no usable
 * options it substituted ["Option 1","Option 2","Option 3"] and shipped that as
 * a poll — a placeholder that looks like content and reaches players. A choice
 * with fewer than two real options is still dropped, and the pass simply
 * produces one fewer item.
 *
 * ── WHY POLLS ARE TYPED NOW ───────────────────────────────────────────────
 *
 * The owner: "it seems to be too much like call and answer and the reality is
 * it should be a short instant feedback version of the survey items", with
 * "rate, pick from a few choices, binary … and then open ended". And the defect
 * that made it concrete: "an example AI rendered medium Poll item but didn't
 * give options but open text box". A poll question is now a survey question
 * the host asks (shared/survey-kinds.js, POLL_KINDS): choice, rating, yesno or
 * text, with the survey's fields, the survey's validation and the survey's
 * CSV columns. So:
 *
 *   - THE REQUEST carries `kinds`, the subset of the four the host ticked
 *     (empty or absent means all four). The old `allowMultiple` flag is still
 *     read from an older builder: `false` keeps every choice single-select.
 *   - THE TOOL SCHEMA's kind enum is exactly the chosen kinds, and it offers
 *     only those kinds' fields, worded for a poll (shared/kind-generation.js).
 *   - THE PROMPT asks for instant feedback: one idea per question, a title that
 *     reads on a projected wall, options that fit at a glance, a scale whose
 *     ends mean something, a binary whose two words fit the question, and open
 *     answers only where the room's own words are the point.
 *   - `normalizeItem` repairs what it can and runs the contract's pollFieldsOf
 *     + validatePoll; an item that is still not a valid poll of a chosen kind
 *     is dropped rather than shipped into a set whose importer would skip it.
 *   - `setCreation` writes the poll CSV, which IS the survey contract's columns
 *     with each question keeping its own category (shared/generated-set.js).
 */

const { makeGenerationHandler } = require('./shared/generation-handler');
const { tagGuidance } = require('./shared/structured-generation');
const { normalizeTags } = require('./shared/tags');
const {
  normalizeRoundKind, roundKindDirection, roundKindDetailCeiling,
} = require('./shared/round-kinds');
const { POLL_KINDS, normalizeKind } = require('./shared/survey-kinds');
const {
  POLL_MAX_OPTIONS, pollItemProperties, pollKindGuide, typedPollFields,
} = require('./shared/kind-generation');
const { pollsToCsv } = require('./shared/generated-set');

const MAX_COUNT = 100;

/**
 * The house detail ceiling for a Produce round. Above it the round kind hands
 * the room material (Apply, Improve, Judge — shared/round-kinds.js), and a
 * question about material it cannot see is unanswerable, so `detail` becomes
 * required. At or below it `detail` is framing, and an instant poll usually
 * needs none.
 */
const FRAMING_CEILING = 350;

/** `kinds` as sent, in POLL_KINDS order, deduplicated; none (or none valid) means all four. */
function chosenKinds(payload) {
  const wanted = new Set();
  if (Array.isArray(payload.kinds)) {
    for (const raw of payload.kinds) {
      const { kind } = normalizeKind(raw);
      if (kind) wanted.add(kind);
    }
  }
  const ordered = POLL_KINDS.filter((k) => wanted.has(k));
  return ordered.length > 0 ? ordered : [...POLL_KINDS];
}

function parseRequest(payload) {
  const total = Math.min(Math.max(parseInt(payload.count, 10) || 1, 1), MAX_COUNT);
  return {
    total,
    config: {
      topic: payload.topic || 'general topics',
      category: payload.category || '',
      audience: payload.audience || '',
      difficulty: payload.difficulty || 'medium',
      kinds: chosenKinds(payload),
      // THE OLD CHECKBOX, read only from a builder that still sends it. Its
      // `false` meant "single-select only" and is honoured; `true` meant "where
      // it helps", which is what the kind guide now says anyway; absent (every
      // current builder) leaves picking several to the question.
      allowMultiple: typeof payload.allowMultiple === 'boolean' ? payload.allowMultiple : null,
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
  const carriesMaterial = detailMax > FRAMING_CEILING;
  const detailSentences = carriesMaterial ? '3-8 sentences' : '1-3 sentences';
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
              ...pollItemProperties(config.kinds),
              title: { type: 'string', description: 'The poll question itself: one idea, 3-15 words, readable from the back of the room.' },
              category: { type: 'string', description: 'The category this poll belongs to.' },
              detail: {
                type: 'string',
                // The schema and the LENGTH LIMITS block below are two
                // statements of one instruction. They have to move together, or
                // a model reading 300 in one and 900 in the other obeys
                // whichever it read last.
                description: carriesMaterial
                  ? `The material the question is about, ${detailSentences}, ${detailMax} characters maximum.`
                  : `Optional framing shown under the question, ${detailSentences}, ${detailMax} characters maximum. Usually empty: a poll reads at a glance.`,
              },
              school: { type: 'string', description: 'Broader subject area.' },
              customInstructions: { type: 'string', description: 'Optional: one short sentence, only when the question\'s own buttons do not already say what to do.' },
              tags: { type: 'array', items: { type: 'string' }, description: '3-6 lowercase kebab-case tags for filtering and search.' },
            },
            required: ['kind', 'title', 'category', ...(carriesMaterial ? ['detail'] : []), 'tags'],
          },
        },
      },
      required: ['items'],
    },
  };
}

/*
  THE PROMPT, in the order a model weighs it: who is asking and for what, the
  round's direction (which outranks the topic), the host's limits, the kinds,
  what makes a poll good, the host's own requirements, what already exists, and
  the hard length limits LAST, because the most recent formatting instruction
  is the one a model obeys.
*/
function buildPrompt({ config, count, alreadyUsedTitles }) {
  let p = `You write instant-feedback polls: questions a host puts on the main screen for a room to answer in a few seconds, with the results filling in on screen as people answer. Create ${count} poll questions about ${config.topic}.`;

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

  p += `\n\n${pollKindGuide(config.kinds)}`;
  if (config.kinds.includes('choice') && config.allowMultiple === false) {
    p += '\nEvery choice question is single-select: set allowMultiple to false on all of them.';
  }

  p += [
    '',
    '',
    'WHAT MAKES A GOOD INSTANT POLL:',
    '- One idea per question. Never two questions in one.',
    '- The title IS the question, short enough to read from the back of the room on a projected screen.',
    '- It is answered in seconds, from where people sit — a tap, not an essay. This is not call-and-answer.',
    '- A poll measures opinion or experience, so it has no correct answer.',
    '- Answers never overlap, and together they cover the realistic range of views.',
  ].join('\n');

  if (config.customPrompt) p += `\n\nAdditional Requirements: ${config.customPrompt}`;

  if (alreadyUsedTitles.length > 0) {
    p += `\n\nALREADY GENERATED for this set — do not repeat, rephrase, or write a near-variant of any of these:\n`;
    p += alreadyUsedTitles.map((t) => `- ${t}`).join('\n');
  }

  const detailMax = roundKindDetailCeiling('poll', config.roundKind);
  const carriesMaterial = detailMax > FRAMING_CEILING;
  p += [
    '',
    '',
    'LENGTH LIMITS (hard limits, not targets):',
    '- title: the question itself, 3-15 words.',
    carriesMaterial
      ? `- detail: 3-8 sentences, ${detailMax} characters maximum.`
      : `- detail: 1-3 sentences, ${detailMax} characters maximum — and usually none at all.`,
    '- customInstructions: one short sentence, or none.',
    `- options: 2-${POLL_MAX_OPTIONS} of them, 40 characters each.`,
    '- labels and placeholder: a few words, 30 characters maximum.',
    'Write only what the content needs; do not pad to reach a limit.',
  ].join('\n');
  p += tagGuidance();
  p += `\n\nReturn the questions by calling the emit_items tool. Do not write prose.`;
  return p;
}

/**
 * One raw tool item → a typed poll item, or null.
 *
 * The kind and its fields come from shared/kind-generation.js typedPollFields:
 * the contract's pollFieldsOf, repaired where a sensible value exists, then the
 * contract's validatePoll. A choice with one option, a kind the host did not
 * tick, or an item with neither a kind nor options is dropped — the last one
 * is the owner's "didn't give options but open text box".
 */
function normalizeItem(raw, config) {
  const title = String(raw?.title || '').trim();
  if (!title) return null;

  const fields = typedPollFields(raw, { kinds: config.kinds, allowMultiple: config.allowMultiple });
  if (!fields) return null;

  return {
    id: Date.now() + Math.random(),
    active: true,
    title,
    category: String(raw?.category || config.category || 'General').trim(),
    detail: String(raw?.detail || '').trim(),
    school: String(raw?.school || 'General Context').trim(),
    customInstructions: String(raw?.customInstructions || '').trim(),
    ...fields,
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

// For tests/poll-generation-job.js, which holds the schema and the item rules
// directly as well as through a run.
exports.parseRequest = parseRequest;
exports.buildTool = buildTool;
exports.buildPrompt = buildPrompt;
exports.normalizeItem = normalizeItem;
