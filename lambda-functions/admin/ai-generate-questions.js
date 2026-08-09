/**
 * AI question generation (the AIAssistant endpoint) — asynchronous, structured.
 *
 * Same 30s-gateway fix as the other builders. This one had the worst token
 * budget of the four: max_tokens was `1000 + count * 700`, i.e. 1700 even at
 * count=1, and at the ~45 output tokens/sec this account measures from Sonnet
 * that is ~38 seconds of generation before the response exists — already past
 * API Gateway's ceiling at the smallest possible request.
 *
 * Two modes, both routed through the job so there is no synchronous path left
 * racing the ceiling:
 *   - bulk: generate `questionCount` new questions.
 *   - refine: rewrite ONE existing question from the user's feedback.
 *
 * Item shape follows the engagement type, resolved through normalizeGameType
 * rather than compared as a raw string — comparing raw game-type spellings is
 * exactly what has silently broken lookups elsewhere in this codebase.
 */

const { makeGenerationHandler } = require('./shared/generation-handler');
const { tagGuidance } = require('./shared/structured-generation');
const { normalizeTags } = require('./shared/tags');
const { normalizeGameType } = require('./shared/game-types');

const MAX_COUNT = 50;

function parseRequest(payload) {
  const existing = payload.existingQuestion || null;
  // Refining one question produces exactly one question, whatever was asked.
  const total = existing
    ? 1
    : Math.min(Math.max(parseInt(payload.questionCount, 10) || 1, 1), MAX_COUNT);
  return {
    total,
    config: {
      gameType: normalizeGameType(payload.engagementType),
      userInput: String(payload.userInput || '').trim(),
      existingQuestion: existing,
      context: payload.context || {},
    },
  };
}

const baseProps = {
  title: { type: 'string', description: 'The question or subject.' },
  category: { type: 'string', description: 'The category this question belongs to.' },
  detail: { type: 'string', description: 'Context or the scenario itself, 2-4 sentences, 350 characters maximum.' },
  school: { type: 'string', description: 'Broader subject area.' },
  customInstructions: { type: 'string', description: 'What the participant should do, 1-2 sentences.' },
  tags: { type: 'array', items: { type: 'string' }, description: '3-6 lowercase kebab-case tags for filtering and search.' },
};
const baseRequired = ['title', 'category', 'detail', 'customInstructions', 'tags'];

function buildTool(config) {
  let properties = { ...baseProps };
  let required = [...baseRequired];

  if (config.gameType === 'trivia') {
    properties = {
      ...properties,
      questionDetail: { type: 'string', description: 'The question text shown to players, 200 characters maximum.' },
      optionA: { type: 'string', description: 'Answer choice A.' },
      optionB: { type: 'string', description: 'Answer choice B.' },
      optionC: { type: 'string', description: 'Answer choice C.' },
      optionD: { type: 'string', description: 'Answer choice D.' },
      correctAnswer: {
        type: 'string',
        enum: ['OptionA', 'OptionB', 'OptionC', 'OptionD'],
        description: 'The correct option id. NOT the answer text.',
      },
      answerDetails: { type: 'string', description: 'Why the correct answer is correct, 1-3 sentences.' },
      difficulty: { type: 'string', enum: ['easy', 'medium', 'hard'], description: 'Difficulty of this question.' },
    };
    required = [...required, 'questionDetail', 'optionA', 'optionB', 'optionC', 'optionD', 'correctAnswer', 'answerDetails', 'difficulty'];
  } else if (config.gameType === 'poll') {
    properties = {
      ...properties,
      options: {
        type: 'array', items: { type: 'string' }, minItems: 2, maxItems: 5,
        description: '2-5 genuinely distinct answer options, 60 characters each.',
      },
      allowMultiple: { type: 'boolean', description: 'True only where picking several options is genuinely useful.' },
    };
    required = [...required, 'options', 'allowMultiple'];
  }

  return {
    name: 'emit_items',
    description: 'Return the generated questions as structured data.',
    input_schema: {
      type: 'object',
      properties: {
        items: {
          type: 'array',
          description: 'The generated questions, in order.',
          items: { type: 'object', properties, required },
        },
      },
      required: ['items'],
    },
  };
}

function lengthGuidanceFor(gameType) {
  if (gameType === 'wavelength') {
    return [
      '',
      '',
      'LENGTH LIMITS (hard limits, not targets):',
      '- title: the subject, 1-4 words. Not a question and not a sentence.',
      '- detail: one short scenario introducing the subject, 200 characters maximum.',
      '- customInstructions: "What are the first 10 words you think of when you think of this word?"',
      '',
      'Wavelength is a word-association alignment game: every participant lists words',
      'for the subject and the game measures overlap. Do not write questions or',
      'anything with a correct answer.',
    ].join('\n');
  }
  return [
    '',
    '',
    'LENGTH LIMITS (hard limits, not targets):',
    '- title: 3-10 words. Do not use a colon to bolt a subtitle onto the title.',
    '- detail: 2-4 sentences, 350 characters maximum.',
    '- customInstructions: 1-2 sentences, 200 characters maximum.',
    'Write only what the content needs; do not pad to reach a limit.',
  ].join('\n');
}

function buildPrompt({ config, count, alreadyUsedTitles }) {
  const { gameType, existingQuestion, context, userInput } = config;
  let p = 'You are an expert educational content creator.\n\n';

  if (existingQuestion) {
    p += `Improve the following ${gameType} question based on the user's feedback.\n\n`;
    p += 'EXISTING QUESTION:\n';
    for (const [label, value] of [
      ['Title', existingQuestion.title],
      ['Category', existingQuestion.category],
      ['Detail', existingQuestion.detail],
      ['Correct Answer', existingQuestion.correctAnswer],
      ['Answer Explanation', existingQuestion.answerDetails],
    ]) {
      if (value) p += `${label}: ${value}\n`;
    }
    if (Array.isArray(existingQuestion.options) && existingQuestion.options.length > 0) {
      p += `Options: ${existingQuestion.options.join(', ')}\n`;
    }
    for (const key of ['optionA', 'optionB', 'optionC', 'optionD']) {
      if (existingQuestion[key]) p += `${key}: ${existingQuestion[key]}\n`;
    }
    p += `\nUSER FEEDBACK: ${userInput}\n`;
    p += '\nReturn exactly ONE improved question.';
  } else {
    p += `Create ${count} high-quality ${gameType} questions.\n\nREQUIREMENTS: ${userInput}\n`;
    if (context?.title) p += `Question Set Title: ${context.title}\n`;
    if (context?.description) p += `Description: ${context.description}\n`;
    if (context?.customInstructions) p += `Set Instructions: ${context.customInstructions}\n`;
    if (context?.aiContextInstructions) p += `Additional Context: ${context.aiContextInstructions}\n`;

    if (alreadyUsedTitles.length > 0) {
      p += `\nALREADY GENERATED for this set — do not repeat, rephrase, or write a near-variant of any of these:\n`;
      p += alreadyUsedTitles.map((t) => `- ${t}`).join('\n');
    }
  }

  p += lengthGuidanceFor(gameType);
  p += tagGuidance();
  p += `\n\nReturn the questions by calling the emit_items tool. Do not write prose.`;
  return p;
}

function normalizeItem(raw, config) {
  const title = String(raw?.title || '').trim();
  if (!title) return null;

  const item = {
    id: Date.now() + Math.random(),
    active: true,
    title,
    category: String(raw?.category || 'General').trim(),
    detail: String(raw?.detail || '').trim(),
    school: String(raw?.school || 'Business School').trim(),
    customInstructions: String(raw?.customInstructions || '').trim(),
    tags: normalizeTags(raw?.tags),
  };

  if (config.gameType === 'trivia') {
    const valid = new Set(['OptionA', 'OptionB', 'OptionC', 'OptionD']);
    const answer = String(raw?.correctAnswer || '').trim();
    item.questionDetail = String(raw?.questionDetail || title).trim();
    item.optionA = String(raw?.optionA || '').trim();
    item.optionB = String(raw?.optionB || '').trim();
    item.optionC = String(raw?.optionC || '').trim();
    item.optionD = String(raw?.optionD || '').trim();
    item.correctAnswer = valid.has(answer) ? answer : 'OptionA';
    item.answerDetails = String(raw?.answerDetails || '').trim();
    item.difficulty = String(raw?.difficulty || 'medium').trim();
  } else if (config.gameType === 'poll') {
    const options = (Array.isArray(raw?.options) ? raw.options : [])
      .map((o) => String(o || '').trim()).filter(Boolean).slice(0, 5);
    if (options.length < 2) return null;
    item.options = options;
    item.allowMultiple = raw?.allowMultiple === true;
  }

  return item;
}

exports.handler = makeGenerationHandler({
  kind: 'question',
  tokenKind: 'question',
  parseRequest,
  buildTool,
  buildPrompt,
  normalizeItem,
});
