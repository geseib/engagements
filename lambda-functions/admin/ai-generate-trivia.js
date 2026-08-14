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
const { tagGuidance } = require('./shared/structured-generation');
const { normalizeTags } = require('./shared/tags');
const { triviaToCsv } = require('./shared/generated-set');

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
            },
            required: ['title', 'questionDetail', 'category', ...optionKeys, 'correctAnswer', 'answerDetails', 'difficulty', 'tags'],
          },
        },
      },
      required: ['items'],
    },
  };
}

function buildPrompt({ config, count, alreadyUsedTitles }) {
  let p = `You are an expert trivia question creator. Create ${count} trivia questions about ${config.topic}.`;
  if (config.category) p += `\nCategory: ${config.category}.`;
  if (config.audience) p += `\nTarget audience: ${config.audience}.`;
  p += `\nDifficulty level: ${config.difficulty}.`;
  p += `\nEach question has exactly ${config.numChoices} answer choices.`;
  if (config.numCorrect > 1) p += `\nEach question has exactly ${config.numCorrect} correct answers.`;
  if (config.customPrompt) p += `\n\nAdditional Requirements: ${config.customPrompt}`;

  p += `\n\nOrganize questions into EXACTLY ${config.categories} categories - no more, no less.`;
  if (config.mustHaveCategories) p += `\nMust include these categories: ${config.mustHaveCategories}`;

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
    '- each option: 60 characters maximum.',
    'Write only what the content needs; do not pad to reach a limit.',
    '',
    'The wrong answers must be plausible. An option nobody would pick is a wasted option.',
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
  // it back rather than dropping the question; an unmappable answer falls back
  // to OptionA, which is what the old handler did unconditionally.
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
    correctAnswer = list.length > 0 ? list : ['OptionA'];
  } else {
    const single = Array.isArray(raw?.correctAnswer) ? raw.correctAnswer[0] : raw?.correctAnswer;
    correctAnswer = toId(single) || 'OptionA';
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
  };
  // Always emit all six keys — generateTriviaCSV writes a fixed-width row.
  for (const key of OPTION_KEYS) {
    item[key] = optionKeys.includes(key) ? String(raw?.[key] || '').trim() : '';
  }
  return item;
}

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
