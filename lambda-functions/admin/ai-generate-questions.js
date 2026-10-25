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
const {
  tagGuidance, HOST_MATERIAL_NOTE, fenceHost, triviaAccuracyRules,
} = require('./shared/structured-generation');
const { clampBackground, BACKGROUND_TRUTH_RULE } = require('./shared/question-background');
const { normalizeTags } = require('./shared/tags');
const { normalizeGameType } = require('./shared/game-types');
const {
  normalizeRoundKind, roundKindDirection, roundKindDetailCeiling,
} = require('./shared/round-kinds');
const { POLL_KINDS, normalizeKind, pollFieldsOf } = require('./shared/survey-kinds');
const {
  POLL_MAX_OPTIONS, pollItemProperties, pollKindGuide, typedPollFields,
} = require('./shared/kind-generation');

const MAX_COUNT = 100;
const OPTION_KEYS = ['optionA', 'optionB', 'optionC', 'optionD', 'optionE', 'optionF'];
const optionId = (key) => `Option${key.slice(-1)}`;

/** What a single trivia draft says when its answer key matches no option. */
const UNKEYED_DRAFT_ERROR = 'The AI\'s answer did not match any option; try again.';

const clampInt = (value, lo, hi) => {
  const n = parseInt(value, 10);
  return Number.isFinite(n) ? Math.min(Math.max(n, lo), hi) : null;
};

/**
 * A TRIVIA DRAFT HAS THE SET'S SHAPE — its number of choices and of correct
 * answers — not always four and one. Read from `numChoices`/`numCorrect` when
 * the caller sends them (top level or on `context`), else from the question
 * being refined, else the house four and one.
 */
function triviaShapeFrom(payload, existing) {
  const context = payload.context || {};
  const filled = existing ? OPTION_KEYS.filter((k) => String(existing[k] || '').trim()).length : 0;
  const keyed = existing
    ? String(existing.correctAnswer || '').split(',').filter((id) => /^Option[A-F]$/.test(id.trim())).length
    : 0;
  const numChoices = clampInt(payload.numChoices ?? context.numChoices, 2, 6) || (filled >= 2 ? filled : 4);
  const numCorrect = clampInt(payload.numCorrect ?? context.numCorrect, 1, numChoices) || Math.min(keyed || 1, numChoices);
  return { numChoices, numCorrect };
}

const textList = (value, limit) => (Array.isArray(value) ? value : [])
  .map((entry) => String(entry ?? '').trim())
  .filter(Boolean)
  .slice(0, limit);

/**
 * The poll kinds a drafted poll question may be: `kinds` as sent, else all
 * four. A refine may change the kind when the feedback asks for it ("make it
 * a yes/no"), so it is offered all four too unless the caller says otherwise.
 */
function pollKindsFrom(payload) {
  const wanted = new Set((Array.isArray(payload.kinds) ? payload.kinds : [])
    .map((raw) => normalizeKind(raw).kind)
    .filter(Boolean));
  const ordered = POLL_KINDS.filter((kind) => wanted.has(kind));
  return ordered.length > 0 ? ordered : [...POLL_KINDS];
}

/** The house detail ceiling; above it a round kind hands the room material to read. */
const FRAMING_CEILING = 350;

/**
 * An existing poll question's kind and settings, as lines of the refine
 * prompt. Read through the contract's pollFieldsOf, so a row from before kinds
 * is described as the choice (or open answer) it plays as.
 */
function describePollFields(question) {
  const f = pollFieldsOf(question);
  const lines = [`Kind: ${f.kind}`];
  if (f.kind === 'choice') {
    if (f.options.length > 0) lines.push(`Options: ${f.options.join(', ')}`);
    lines.push(`Pick: ${f.allowMultiple ? 'several' : 'one'}`);
  } else if (f.kind === 'rating') {
    lines.push(`Scale: ${f.scale}`);
    if (f.lowLabel || f.highLabel) lines.push(`Scale labels: ${f.lowLabel || '(none)'} to ${f.highLabel || '(none)'}`);
  } else if (f.kind === 'yesno') {
    lines.push(`Buttons: ${f.yesLabel || 'Yes'} / ${f.noLabel || 'No'}${f.unsure ? ' / Not sure' : ''}`);
  } else if (f.kind === 'text') {
    lines.push(`Answer: ${f.textLength}${f.placeholder ? `, hint "${f.placeholder}"` : ''}`);
  }
  return lines.map((line) => `${line}\n`).join('');
}

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
      // ONE DRAFT, as the console's add-a-question modal asks for: an item that
      // cannot be used fails the job with a sentence rather than being dropped
      // into an empty result (normalizeItem).
      single: total === 1,
      ...triviaShapeFrom(payload, existing),
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
      // A POLL QUESTION IS TYPED (ai-generate-polls.js says why), so the
      // drafter writes one of these kinds with its fields, never a bare list.
      pollKinds: pollKindsFrom(payload),
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
    // The set generator's shape (ai-generate-trivia.js buildTool): the set's
    // number of options and of correct answers, and the background the set
    // generator requires — QuestionsPanel's form has a Background field, and a
    // drafted question without one was the only trivia question in its set
    // with nothing for the summariser.
    const optionKeys = OPTION_KEYS.slice(0, config.numChoices);
    const ids = optionKeys.map(optionId);
    const options = {};
    for (const key of optionKeys) options[key] = { type: 'string', description: `Answer choice ${key.slice(-1)}.` };
    properties = {
      ...properties,
      questionDetail: { type: 'string', description: 'The question text shown to players, 200 characters maximum.' },
      ...options,
      correctAnswer: config.numCorrect > 1
        ? {
            type: 'array',
            items: { type: 'string', enum: ids },
            description: `Exactly ${config.numCorrect} correct option ids, e.g. ["OptionA","OptionC"].`,
          }
        : { type: 'string', enum: ids, description: 'The correct option id. NOT the answer text.' },
      answerDetails: { type: 'string', description: 'Why the correct answer is correct, 1-3 sentences.' },
      difficulty: { type: 'string', enum: ['easy', 'medium', 'hard'], description: 'Difficulty of this question.' },
      background: { type: 'string', description: 'The story around the answer that makes good '
        + 'commentary, 1-3 sentences, 400 characters maximum. Not why it is correct — that is '
        + 'answerDetails. Never shown to players.' },
    };
    required = [...required, 'questionDetail', ...optionKeys, 'correctAnswer', 'answerDetails', 'difficulty', 'background'];
  } else if (config.gameType === 'wavelength') {
    // NO DETAIL, as the wavelength set generator (structured-generation.js
    // lengthGuidance): a sentence about the subject seeds the very words the
    // round exists to compare.
    properties = {
      ...properties,
      title: { type: 'string', description: 'The subject, 1-4 words.' },
      detail: { type: 'string', description: 'Leave empty. Never describe or define the subject — the players supply the meaning.' },
    };
    required = required.filter((key) => key !== 'detail');
  } else if (config.gameType === 'poll') {
    // The same kind and kind fields the poll set generator offers
    // (shared/kind-generation.js), so a poll question drafted into a set is
    // the same shape as one generated with it. An instant poll needs no
    // participant instruction and, outside a round that hands the room
    // material, no detail either — requiring them is what made a poll read
    // like a call-and-answer prompt.
    const carriesMaterial = detailMax > FRAMING_CEILING;
    properties = {
      ...pollItemProperties(config.pollKinds),
      ...properties,
      title: { type: 'string', description: 'The poll question itself: one idea, 3-15 words, readable from the back of the room.' },
      detail: {
        type: 'string',
        description: carriesMaterial
          ? `The material the question is about, 3-8 sentences, ${detailMax} characters maximum.`
          : `Optional framing shown under the question, 1-3 sentences, ${detailMax} characters maximum. Usually empty.`,
      },
      customInstructions: { type: 'string', description: 'Optional: one short sentence, only when the question\'s own buttons do not already say what to do.' },
    };
    required = ['kind', 'title', 'category', ...(carriesMaterial ? ['detail'] : []), 'tags'];
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
      '- detail: LEAVE EMPTY (""). Never describe, define or hint at the',
      '  subject — the players supply the meaning; any framing contaminates',
      '  their answers.',
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
  if (gameType === 'poll') {
    // The poll set generator's limits (ai-generate-polls.js): a poll is read
    // at a glance, so its detail is usually absent and its answers are short.
    return [
      '',
      '',
      'LENGTH LIMITS (hard limits, not targets):',
      '- title: the question itself, 3-15 words.',
      detailMax > FRAMING_CEILING
        ? `- detail: 3-8 sentences, ${detailMax} characters maximum.`
        : `- detail: 1-3 sentences, ${detailMax} characters maximum — and usually none at all.`,
      '- customInstructions: one short sentence, or none.',
      `- options: 2-${POLL_MAX_OPTIONS} of them, 40 characters each.`,
      '- labels and placeholder: a few words, 30 characters maximum.',
      'Write only what the content needs; do not pad to reach a limit.',
    ].join('\n');
  }
  return [
    '',
    '',
    'LENGTH LIMITS (hard limits, not targets):',
    '- title: 3-10 words. Do not use a colon to bolt a subtitle onto the title.',
    `- detail: ${detailMax > 350 ? '3-8' : '2-4'} sentences, ${detailMax} characters maximum.`,
    '- customInstructions: 1-2 sentences, 200 characters maximum.',
    // The set generator's trivia limits (ai-generate-trivia.js).
    ...(gameType === 'trivia' ? [
      '- questionDetail: the question as asked, 200 characters maximum.',
      '- answerDetails: 1-3 sentences, 300 characters maximum.',
      `- background: 1-3 sentences, 400 characters maximum. ${BACKGROUND_TRUTH_RULE}`,
      '- each option: 60 characters maximum.',
    ] : []),
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

  // The host's text — the question being refined, the feedback, the set's
  // fields, its other questions — is fenced (structured-generation.js
  // fenceHost) under the one line that says what the tags mean.
  p += `${HOST_MATERIAL_NOTE}\n\n`;

  if (existingQuestion) {
    p += `Improve the following ${gameType} question based on the user's feedback.\n\n`;
    let shown = '';
    for (const [label, value] of [
      ['Title', existingQuestion.title],
      ['Category', existingQuestion.category],
      ['Detail', existingQuestion.detail],
      ['Correct Answer', existingQuestion.correctAnswer],
      ['Answer Explanation', existingQuestion.answerDetails],
    ]) {
      if (value) shown += `${label}: ${value}\n`;
    }
    if (gameType === 'poll') {
      // The poll as it stands, kind first: without it a rating or a yes/no
      // under refinement is a title with nothing to say what it asks for, and
      // comes back as whatever the model guesses.
      shown += describePollFields(existingQuestion);
    } else if (Array.isArray(existingQuestion.options) && existingQuestion.options.length > 0) {
      shown += `Options: ${existingQuestion.options.join(', ')}\n`;
    }
    for (const key of OPTION_KEYS) {
      if (existingQuestion[key]) shown += `${key}: ${existingQuestion[key]}\n`;
    }
    p += `EXISTING QUESTION:\n${fenceHost('existing_question', shown)}\n`;
    p += `\nUSER FEEDBACK: ${fenceHost('feedback', userInput)}\n`;
    p += '\nReturn exactly ONE improved question.';
    if (gameType === 'poll') p += ' Keep its kind unless the feedback asks for another.';
  } else {
    p += `Create ${count} high-quality ${gameType} questions.\n\nREQUIREMENTS: ${fenceHost('requirements', userInput)}\n`;
    if (context?.title) p += `Question Set Title: ${fenceHost('set_title', context.title)}\n`;
    if (context?.description) p += `Description: ${fenceHost('set_description', context.description)}\n`;
    if (context?.customInstructions) p += `Set Instructions: ${fenceHost('set_instructions', context.customInstructions)}\n`;
    if (context?.aiContextInstructions) p += `Additional Context: ${fenceHost('set_context', context.aiContextInstructions)}\n`;
    if (context?.category) p += `Category to write in: ${fenceHost('category', context.category)}\n`;

    // THE SET'S SHAPE, which the console's add-a-question modal can see and
    // this prompt previously could not. Both blocks are additive: a caller
    // that sends neither (BuilderPage, AIAssistant) gets the prompt it always
    // got.
    const categories = textList(context?.categories, 24);
    if (categories.length > 0) {
      p += `\nCATEGORIES ALREADY IN THIS SET (prefer one of these; a new one is a real cost): ${fenceHost('categories', categories.join(', '))}\n`;
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
      let listed = '';
      for (const s of siblings) {
        listed += `- ${String(s.title).trim()}`;
        if (s.detail) listed += `\n  ${String(s.detail).trim()}`;
        if (s.customInstructions) listed += `\n  Instruction: ${String(s.customInstructions).trim()}`;
        listed += '\n';
      }
      p += `${fenceHost('other_questions', listed)}\n`;
    }

    // The caller's titles and this job's own, in one list: the model needs to
    // avoid both what the set already holds and what this run has just made.
    const avoid = [...new Set([...(config.callerUsedTitles || []), ...alreadyUsedTitles])];
    if (avoid.length > 0) {
      p += `\nALREADY GENERATED for this set — do not repeat, rephrase, or write a near-variant of any of these:\n`;
      p += avoid.map((t) => `- ${t}`).join('\n');
    }
  }

  if (gameType === 'poll') {
    // An instant-feedback poll, typed — the same kinds and the same guidance
    // the poll set generator gives, so a question drafted into a poll set
    // matches the ones generated with it.
    p += '\n\nA poll is instant feedback: the host puts one question on the main screen and the room answers in'
      + ' seconds while the results fill in. One idea per question; no correct answer.';
    p += `\n\n${pollKindGuide(config.pollKinds)}`;
  }

  if (gameType === 'trivia') {
    // The set generator's shape and accuracy rules (ai-generate-trivia.js), so
    // a question drafted into a set is held to what the set was.
    p += `\n\nThe question has exactly ${config.numChoices} answer choices`
      + (config.numCorrect > 1 ? `, exactly ${config.numCorrect} of them correct.` : '.');
    p += `\n\n${triviaAccuracyRules(config.numCorrect)}`;
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
    // A wavelength subject carries NO detail, whatever the model wrote — the
    // same guarantee as the set generator's (ai-generate-scenarios.js).
    detail: config.gameType === 'wavelength' ? '' : String(raw?.detail || '').trim(),
    school: String(raw?.school || 'Business School').trim(),
    customInstructions: String(raw?.customInstructions || '').trim(),
    tags: normalizeTags(raw?.tags),
  };

  if (config.gameType === 'trivia') {
    const optionKeys = OPTION_KEYS.slice(0, config.numChoices);
    const valid = new Set(optionKeys.map(optionId));
    // An id, or the option's own text mapped back to its id.
    const toId = (value) => {
      const s = String(value || '').trim();
      if (valid.has(s)) return s;
      const match = optionKeys.find((k) => String(raw?.[k] || '').trim() === s);
      return match ? optionId(match) : null;
    };
    const answers = (Array.isArray(raw?.correctAnswer) ? raw.correctAnswer : String(raw?.correctAnswer || '').split(','))
      .map(toId).filter(Boolean);
    const keyed = [...new Set(answers)].slice(0, config.numCorrect);
    // AN ANSWER THAT MATCHES NO OPTION IS NOT KEYED TO A. It used to be, which
    // drafted a question whose "right" answer was a guess. One draft fails with
    // a sentence the host can read; a bulk run drops the item, and the worker
    // asks again for the shortfall (shared/generation-handler.js).
    if (keyed.length === 0) {
      if (config.single) throw new Error(UNKEYED_DRAFT_ERROR);
      return null;
    }
    item.questionDetail = String(raw?.questionDetail || title).trim();
    for (const key of OPTION_KEYS) {
      item[key] = optionKeys.includes(key) ? String(raw?.[key] || '').trim() : '';
    }
    // Comma-joined for several, as the CSV and QuestionsPanel's form store it
    // (shared/generated-set.js triviaToCsv).
    item.correctAnswer = config.numCorrect > 1 ? keyed.join(',') : keyed[0];
    item.answerDetails = String(raw?.answerDetails || '').trim();
    item.difficulty = String(raw?.difficulty || 'medium').trim();
    item.background = clampBackground(raw?.background);
  } else if (config.gameType === 'poll') {
    // The kind and the fields it uses, repaired and validated by the contract
    // (shared/kind-generation.js typedPollFields); a choice with one option, or
    // a question with neither a kind nor options, is dropped.
    const fields = typedPollFields(raw, { kinds: config.pollKinds });
    if (!fields) return null;
    Object.assign(item, fields);
  }

  return item;
}

// Exported for tests/question-generation-job.js, which drives the drafter's
// schema, prompt and normaliser directly as well as through the job.
exports.parseRequest = parseRequest;
exports.buildTool = buildTool;
exports.buildPrompt = buildPrompt;
exports.normalizeItem = normalizeItem;
exports.UNKEYED_DRAFT_ERROR = UNKEYED_DRAFT_ERROR;

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
