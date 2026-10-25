/**
 * AI trivia generation — asynchronous, structured, tag-suggesting.
 *
 * THE BUG THIS REPLACES. Generation ran inside the HTTP request, and `RestApi`
 * is an AWS::Serverless::HttpApi whose 30s integration timeout is a hard
 * ceiling. The client worked around it by fanning out parallel three-question
 * batches, but every one of those calls raced the same wall clock, and each was
 * blind to the other batches — which is why duplicates appeared and why a
 * "Batch N of M: HTTP 503" could not be retried into success.
 *
 * Now: POST creates a job and returns 202, a self-invoked worker generates
 * against the full 900s, and the client polls. Passes run in sequence and each
 * one is told what the previous ones wrote, so duplicate avoidance is a
 * property of the prompt rather than a client-side filter.
 *
 * ALSO FIXED: numberOfCategories and mustHaveCategories. TriviaAIBuilder has
 * sent both on every request since it was written; this handler never
 * destructured them, so the category controls in the trivia UI have never done
 * anything at all.
 */

const { makeGenerationHandler } = require('./shared/generation-handler');
const {
  tagGuidance, HOST_MATERIAL_NOTE, fenceHost, triviaAccuracyRules,
} = require('./shared/structured-generation');
const { normalizeTags } = require('./shared/tags');
const { triviaToCsv } = require('./shared/generated-set');
const { readBatchGuidance, batchGuidanceBlock } = require('./shared/batch-guidance');
const { clampBackground, BACKGROUND_TRUTH_RULE } = require('./shared/question-background');
const { categoryBlock, aboutSetBlock, categoryList } = require('./shared/category-brief');

const MAX_COUNT = 100;
const OPTION_KEYS = ['optionA', 'optionB', 'optionC', 'optionD', 'optionE', 'optionF'];

function parseRequest(payload) {
  const total = Math.min(Math.max(parseInt(payload.count, 10) || 1, 1), MAX_COUNT);
  const numChoices = Math.min(Math.max(parseInt(payload.numChoices, 10) || 4, 2), 6);
  const numCorrect = Math.min(Math.max(parseInt(payload.numCorrect, 10) || 1, 1), numChoices);
  // Clamp against the TOTAL, not the chunk. Clamping against a chunk is what
  // collapsed the scenario builder's category count to 1 on every pass.
  const categories = Math.min(parseInt(payload.numberOfCategories, 10) || 3, 24, Math.max(total, 1));
  return {
    total,
    config: {
      topic: payload.topic || 'general knowledge',
      category: payload.category || '',
      audience: payload.audience || '',
      difficulty: payload.difficulty || 'medium',
      customPrompt: payload.customPrompt || '',
      numChoices, numCorrect, categories,
      mustHaveCategories: payload.mustHaveCategories || '',
      // The set's categories and what the set is about — shared/category-brief.js.
      setCategories: categoryList([...categoryList(payload.categories), ...categoryList(payload.mustHaveCategories)]),
      aboutSet: payload.aboutSet && typeof payload.aboutSet === 'object' ? payload.aboutSet : null,
      total,
      // ONE RUN'S INSTRUCTION, not the set's brief — see shared/batch-guidance.js.
      batchGuidance: readBatchGuidance(payload.batchGuidance),
    },
  };
}

function buildTool(config) {
  const optionKeys = OPTION_KEYS.slice(0, config.numChoices);
  const optionProps = {};
  for (const key of optionKeys) {
    optionProps[key] = { type: 'string', description: `Answer choice ${key.slice(-1)}.` };
  }
  const correctAnswer = config.numCorrect > 1
    ? {
        type: 'array',
        items: { type: 'string', enum: optionKeys.map((k) => `Option${k.slice(-1)}`) },
        description: `Exactly ${config.numCorrect} correct option ids, e.g. ["OptionA","OptionC"].`,
      }
    : {
        type: 'string',
        enum: optionKeys.map((k) => `Option${k.slice(-1)}`),
        description: 'The correct option id, e.g. "OptionA". NOT the answer text.',
      };

  return {
    name: 'emit_items',
    description: 'Return the generated trivia questions as structured data.',
    input_schema: {
      type: 'object',
      properties: {
        items: {
          type: 'array',
          description: 'The generated trivia questions, in order.',
          items: {
            type: 'object',
            properties: {
              title: { type: 'string', description: 'Short descriptive title for the question, 3-10 words.' },
              questionDetail: { type: 'string', description: 'The actual question text shown to players, 200 characters maximum.' },
              category: { type: 'string', description: 'The category this question belongs to. Use only the categories requested.' },
              ...optionProps,
              correctAnswer,
              answerDetails: { type: 'string', description: 'Why the correct answer is correct, 1-3 sentences, 300 characters maximum.' },
              school: { type: 'string', description: 'Broader subject area, e.g. "General Knowledge".' },
              difficulty: { type: 'string', enum: ['easy', 'medium', 'hard'], description: 'Difficulty of this question.' },
              tags: { type: 'array', items: { type: 'string' }, description: '3-6 lowercase kebab-case tags for filtering and search.' },
              background: { type: 'string', description: 'The story around the answer that makes good '
                + 'commentary, 1-3 sentences, 400 characters maximum. Not why it is correct — that is '
                + 'answerDetails. Never shown to players.' },
            },
            required: ['title', 'questionDetail', 'category', ...optionKeys, 'correctAnswer', 'answerDetails', 'difficulty', 'tags', 'background'],
          },
        },
      },
      required: ['items'],
    },
  };
}

function buildPrompt({ config, count, alreadyUsedTitles }) {
  let p = `You are an expert trivia question creator. Create ${count} trivia questions about ${config.topic}.`;
  // THE AUTHOR'S GUIDANCE FOR THIS BATCH, straight after the opening line and
  // ahead of the brief, because first is what a model follows (the DIRECTION
  // BEFORE TOPIC note in ai-generate-scenarios.js). Its own paragraph, closed by
  // a blank line so the brief's next line is not read as more of it. With
  // none, nothing changes.
  const guidance = batchGuidanceBlock(config.batchGuidance);
  if (guidance) p += `\n\n${guidance}\n`;
  const about = aboutSetBlock(config.aboutSet);
  if (about) p += `\n\n${about}\n`;
  p += `\nDifficulty level: ${config.difficulty}.`;
  p += `\nEach question has exactly ${config.numChoices} answer choices.`;
  if (config.numCorrect > 1) p += `\nEach question has exactly ${config.numCorrect} correct answers.`;

  // WHICH CATEGORY, AND WHICH NOT — the one rule every generator shares.
  const categories = categoryBlock({
    target: config.category,
    categories: config.setCategories,
    count: config.categories,
    total: config.total,
  });
  if (categories) p += `\n\n${categories}`;

  // THE HOST'S TEXT, FENCED, in one block under the line that says what the
  // tags mean (structured-generation.js fenceHost) — the survey generator's
  // pattern. The category names are in the category block above. With none
  // of it, no block and no note.
  const host = [
    config.audience && `Target audience: ${fenceHost('audience', config.audience)}`,
    config.customPrompt && `Additional Requirements: ${fenceHost('requirements', config.customPrompt)}`,
  ].filter(Boolean);
  if (host.length > 0) p += `\n\n${HOST_MATERIAL_NOTE}\n${host.join('\n')}`;

  if (alreadyUsedTitles.length > 0) {
    p += `\n\nALREADY GENERATED for this set — do not repeat, rephrase, or write a near-variant of any of these:\n`;
    p += alreadyUsedTitles.map((t) => `- ${t}`).join('\n');
  }

  p += [
    '',
    '',
    'LENGTH LIMITS (hard limits, not targets):',
    '- title: 3-10 words, a label for the question, not the question itself.',
    '- questionDetail: the question as asked, 200 characters maximum.',
    '- answerDetails: 1-3 sentences, 300 characters maximum.',
    '- background: 1-3 sentences, 400 characters maximum. ' + BACKGROUND_TRUTH_RULE,
    '- each option: 60 characters maximum.',
    'Write only what the content needs; do not pad to reach a limit.',
    '',
    triviaAccuracyRules(config.numCorrect),
  ].join('\n');
  p += tagGuidance();
  p += `\n\nReturn the questions by calling the emit_items tool. Do not write prose.`;
  return p;
}

function normalizeItem(raw, config) {
  const title = String(raw?.title || '').trim();
  if (!title) return null;

  const optionKeys = OPTION_KEYS.slice(0, config.numChoices);
  const valid = new Set(optionKeys.map((k) => `Option${k.slice(-1)}`));

  // The model occasionally answers with the option TEXT instead of its id. Map
  // it back rather than dropping the question. An answer that maps to no
  // option DROPS the question: it used to be keyed to OptionA, which put a
  // question in the set whose "right" answer was a guess. The worker's next
  // pass replaces it (shared/generation-handler.js asks again until it has the
  // count, and stops with a warning when a pass adds nothing).
  const toId = (value) => {
    const s = String(value || '').trim();
    if (valid.has(s)) return s;
    const match = optionKeys.find((k) => String(raw?.[k] || '').trim() === s);
    return match ? `Option${match.slice(-1)}` : null;
  };

  let correctAnswer;
  if (config.numCorrect > 1) {
    const list = (Array.isArray(raw?.correctAnswer) ? raw.correctAnswer : [raw?.correctAnswer])
      .map(toId).filter(Boolean);
    if (list.length === 0) return null;
    correctAnswer = [...new Set(list)];
  } else {
    const single = Array.isArray(raw?.correctAnswer) ? raw.correctAnswer[0] : raw?.correctAnswer;
    correctAnswer = toId(single);
    if (!correctAnswer) return null;
  }

  const item = {
    id: Date.now() + Math.random(),
    active: true,
    title,
    questionDetail: String(raw?.questionDetail || title).trim(),
    category: String(raw?.category || config.category || 'General').trim(),
    answerDetails: String(raw?.answerDetails || '').trim(),
    school: String(raw?.school || 'General Knowledge').trim(),
    correctAnswer,
    difficulty: String(raw?.difficulty || config.difficulty || 'medium').trim(),
    tags: normalizeTags(raw?.tags),
    background: clampBackground(raw?.background),
  };
  // Always emit all six keys — generateTriviaCSV writes a fixed-width row.
  for (const key of OPTION_KEYS) {
    item[key] = optionKeys.includes(key) ? String(raw?.[key] || '').trim() : '';
  }
  return item;
}

// The prompt's own tests (tests/question-guidance.js) read these directly.
exports.parseRequest = parseRequest;
exports.buildPrompt = buildPrompt;

exports.handler = makeGenerationHandler({
  kind: 'trivia',
  tokenKind: 'trivia',
  parseRequest,
  buildTool,
  buildPrompt,
  normalizeItem,
  // A WHOLE-SET GENERATOR, so leaving the builder produces a draft set rather
  // than a job record nobody turned into anything. See
  // shared/generated-set.js for what "draft" means and who owns it.
  //
  // NO roundKindFrom: a round kind describes what a room does with material it
  // was handed, and trivia has a correct answer, so "invention" and "verdict"
  // are meaningless for it — `roundKindApplies` in shared/round-kinds.js lists
  // call-and-answer and poll only. Sending one here would write a direction
  // onto a set whose generation never read it.
  setCreation: {
    engagementType: 'trivia',
    toCsv: (items) => triviaToCsv(items),
  },
});

// Exported for tests/question-background-generators.js, which drives the tool
// schema, the prompt and the normaliser directly rather than through a Bedrock
// stub — makeGenerationHandler has no seam for reaching them otherwise.
// buildPrompt is already exported above, for tests/question-guidance.js.
module.exports.buildTool = buildTool;
module.exports.normalizeItem = normalizeItem;
