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
const {
  normalizeRoundKind, roundKindDirection, roundKindDetailCeiling,
} = require('./shared/round-kinds');

const MAX_COUNT = 100;

const textList = (value, limit) => (Array.isArray(value) ? value : [])
  .map((entry) => String(entry ?? '').trim())
  .filter(Boolean)
  .slice(0, limit);

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
      // Titles the CALLER already holds, as opposed to the ones this job has
      // produced. The add-a-question modal in the console sends the titles
      // already in the working copy: without them the model has no way to know
      // it is rewriting question 41 of a set it cannot see.
      callerUsedTitles: textList(payload.alreadyUsedTitles, 200),
      // DIRECTION. Unknown values fall back to `produce` at the reader rather
      // than failing the job; the 400 belongs on the write paths. See
      // shared/round-kinds.js.
      roundKind: normalizeRoundKind(payload.roundKind),
      roundKindBrief: String(payload.roundKindBrief || '').trim(),
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
  // The schema's `detail` description is a second statement of the length
  // limit. It has to move with lengthGuidanceFor() or the two halves of the
  // same instruction contradict each other — an Apply question cannot carry its
  // material through a schema that still says 350 characters.
  const detailMax = roundKindDetailCeiling(config.gameType, config.roundKind);
  let properties = {
    ...baseProps,
    detail: {
      type: 'string',
      description: `Context or the scenario itself, ${detailMax > 350 ? '3-8' : '2-4'} sentences, ${detailMax} characters maximum.`,
    },
  };
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

function lengthGuidanceFor(gameType, roundKind) {
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
  // Round-kind aware, and appended LAST, which is why it has to be: a model
  // weights the most recent formatting instruction most heavily, so a flat 350
  // would quietly overrule an Apply direction that needs the material carried.
  const detailMax = roundKindDetailCeiling(gameType, roundKind);
  return [
    '',
    '',
    'LENGTH LIMITS (hard limits, not targets):',
    '- title: 3-10 words. Do not use a colon to bolt a subtitle onto the title.',
    `- detail: ${detailMax > 350 ? '3-8' : '2-4'} sentences, ${detailMax} characters maximum.`,
    '- customInstructions: 1-2 sentences, 200 characters maximum.',
    'Write only what the content needs; do not pad to reach a limit.',
  ].join('\n');
}

function buildPrompt({ config, count, alreadyUsedTitles }) {
  const { gameType, existingQuestion, context, userInput, roundKind, roundKindBrief } = config;
  let p = 'You are an expert educational content creator.\n\n';

  // DIRECTION FIRST, for both the bulk and the refine paths.
  //
  // Refine needs it as much as bulk does, and for a reason worth stating: the
  // refine prompt below opens "Improve the following question based on the
  // user's feedback", which is an IMPROVE operation on OUR OWN DRAFT and has
  // nothing to do with the `improve` ROUND KIND. Without the direction a refine
  // of an Apply question drifts back towards the house shape, because nothing
  // in the prompt any longer knows the room was handed foreign material.
  const direction = roundKindDirection(gameType, roundKind, roundKindBrief);
  if (direction) {
    p += `${direction}\n\nThis direction governs the shape of every question below.\n\n`;
  }

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
    if (context?.category) p += `Category to write in: ${context.category}\n`;

    // THE SET'S SHAPE, which the console's add-a-question modal can see and
    // this prompt previously could not. Both blocks are additive: a caller
    // that sends neither (BuilderPage, AIAssistant) gets the prompt it always
    // got.
    const categories = textList(context?.categories, 24);
    if (categories.length > 0) {
      p += `\nCATEGORIES ALREADY IN THIS SET (prefer one of these; a new one is a real cost): ${categories.join(', ')}\n`;
    }

    // "Writing alongside these." The author is shown this exact list in the
    // modal, and the design doc's whole argument for showing it is that the
    // human's "what am I matching?" and the model's conditioning must be ONE
    // list. Dropping it here would make the screen a lie.
    const siblings = Array.isArray(context?.siblingQuestions)
      ? context.siblingQuestions.filter((s) => s && String(s.title || '').trim()).slice(0, 5)
      : [];
    if (siblings.length > 0) {
      p += '\nWRITING ALONGSIDE THESE — existing questions from the same set. Match their voice,'
        + ' their length and their level of specificity. Do not repeat them:\n';
      for (const s of siblings) {
        p += `- ${String(s.title).trim()}`;
        if (s.detail) p += `\n  ${String(s.detail).trim()}`;
        if (s.customInstructions) p += `\n  Instruction: ${String(s.customInstructions).trim()}`;
        p += '\n';
      }
    }

    // The caller's titles and this job's own, in one list: the model needs to
    // avoid both what the set already holds and what this run has just made.
    const avoid = [...new Set([...(config.callerUsedTitles || []), ...alreadyUsedTitles])];
    if (avoid.length > 0) {
      p += `\nALREADY GENERATED for this set — do not repeat, rephrase, or write a near-variant of any of these:\n`;
      p += avoid.map((t) => `- ${t}`).join('\n');
    }
  }

  p += lengthGuidanceFor(gameType, roundKind);
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
  // NO `setCreation`, AND THAT IS THE POINT. This adds ONE question to a set
  // that already exists; the whole-set generators create a draft set when their
  // worker finishes (shared/generated-set.js), and doing that here would mint a
  // second, one-question set every time somebody added a question to an
  // existing one. Do not "make it consistent" with trivia and polls.
});
