/**
 * AI survey generation — asynchronous, structured, tag-suggesting.
 *
 * This was the most exposed of the four builders. Unlike trivia and polls it
 * was never chunked at all: one call for up to 50 questions, against API
 * Gateway's hard 30s integration timeout. Its own source comment admitted that
 * counts above ~10 risked the ceiling and that fixing it "needs a design
 * change". This is that change.
 *
 * The survey is also the only builder whose result has a shape of its own — a
 * title and description wrapping the questions, which the model is allowed to
 * improve on. Job records store a flat `items` array, so the framing travels in
 * the job's optional `meta` (see shared/generation-jobs.js). It is asked for on
 * the FIRST pass only: re-deriving it per chunk invites the model to contradict
 * itself, and writing it immediately means it survives a later failure.
 *
 * If the model returns no framing, `meta` stays null and SurveyAIBuilder falls
 * back to whatever the admin typed. An improved title is an improvement, not a
 * dependency.
 */

const { makeGenerationHandler } = require('./shared/generation-handler');
const { tagGuidance } = require('./shared/structured-generation');
const { normalizeTags } = require('./shared/tags');

const MAX_COUNT = 50;
const QUESTION_TYPES = ['rating', 'multiple_choice', 'text_entry'];

/** Survey questions are numbered 1..n; SurveyAIBuilder renders by index. */
let sequence = 0;

function parseRequest(payload) {
  // Reset per job. A warm container would otherwise keep counting from the
  // previous run's last question and hand SurveyAIBuilder ids starting at 43.
  sequence = 0;
  const total = Math.min(Math.max(parseInt(payload.questionCount, 10) || 1, 1), MAX_COUNT);
  const types = [];
  if (payload.includeRating) types.push('rating');
  if (payload.includeMultipleChoice) types.push('multiple_choice');
  if (payload.includeTextEntry) types.push('text_entry');
  return {
    total,
    config: {
      title: String(payload.title || '').trim(),
      description: String(payload.description || '').trim(),
      topic: String(payload.topic || '').trim(),
      audience: String(payload.audience || '').trim(),
      purpose: String(payload.purpose || '').trim(),
      customPrompt: String(payload.customPrompt || '').trim(),
      // An admin who unticks every box gets all three rather than none.
      types: types.length > 0 ? types : QUESTION_TYPES,
    },
  };
}

function buildTool(config) {
  return {
    name: 'emit_items',
    description: 'Return the generated survey questions as structured data.',
    input_schema: {
      type: 'object',
      properties: {
        // Optional and first-pass only. Declared on every call because the tool
        // schema is built once per job; the PROMPT is what asks for it.
        surveyTitle: { type: 'string', description: 'An improved title for the survey as a whole. Omit unless it genuinely improves on the one given.' },
        surveyDescription: { type: 'string', description: 'An improved one-or-two sentence description of the survey as a whole.' },
        items: {
          type: 'array',
          description: 'The generated survey questions, in order.',
          items: {
            type: 'object',
            properties: {
              question: { type: 'string', description: 'The question text, 200 characters maximum.' },
              type: { type: 'string', enum: config.types, description: 'The question type. Use only the types listed.' },
              scale: {
                type: 'object',
                properties: {
                  type: { type: 'string', description: 'Scale range, e.g. "1-5" or "1-10".' },
                  lowLabel: { type: 'string', description: 'Label for the low end.' },
                  highLabel: { type: 'string', description: 'Label for the high end.' },
                },
                description: 'Required for rating questions; ignored otherwise.',
              },
              options: { type: 'array', items: { type: 'string' }, description: '2-6 options. Required for multiple_choice; empty otherwise.' },
              allowMultiple: { type: 'boolean', description: 'Multiple_choice only: may the respondent pick several?' },
              textType: { type: 'string', enum: ['short', 'long', 'email', 'number'], description: 'Text_entry only: the kind of input expected.' },
              placeholder: { type: 'string', description: 'Text_entry only: placeholder text.' },
              required: { type: 'boolean', description: 'Must the respondent answer this question?' },
              tags: { type: 'array', items: { type: 'string' }, description: '3-6 lowercase kebab-case tags for filtering and search.' },
            },
            required: ['question', 'type', 'required', 'tags'],
          },
        },
      },
      required: ['items'],
    },
  };
}

const TYPE_LABELS = {
  rating: 'rating scale questions (1-5, 1-10, etc.)',
  multiple_choice: 'multiple choice questions',
  text_entry: 'text entry questions (short and long form)',
};

function buildPrompt({ config, count, alreadyUsedTitles, isFirstPass }) {
  let p = `You are an expert survey designer. Create ${count} survey questions.`;
  if (config.title) p += `\nSurvey title: "${config.title}".`;
  if (config.topic) p += `\nTopic: ${config.topic}.`;
  if (config.description) p += `\nDescription: ${config.description}`;
  if (config.audience) p += `\nTarget audience: ${config.audience}.`;
  if (config.purpose) p += `\nPurpose: ${config.purpose}.`;
  p += `\n\nUse ONLY these question types: ${config.types.map((t) => TYPE_LABELS[t]).join(', ')}.`;
  if (config.customPrompt) p += `\n\nAdditional Requirements: ${config.customPrompt}`;

  if (alreadyUsedTitles.length > 0) {
    p += `\n\nALREADY ASKED in this survey — do not repeat or rephrase any of these:\n`;
    p += alreadyUsedTitles.map((t) => `- ${t}`).join('\n');
  }

  if (isFirstPass) {
    p += [
      '',
      '',
      'SURVEY FRAMING: you may also return surveyTitle and surveyDescription to',
      'improve the survey\'s own framing. Return them ONLY if they genuinely',
      'improve on what was given; omit them otherwise. Do not restate the topic.',
    ].join('\n');
  }

  p += [
    '',
    '',
    'LENGTH LIMITS (hard limits, not targets):',
    '- question: one question, 200 characters maximum. Ask one thing, not two.',
    '- options: 2-6 of them, 60 characters each, mutually exclusive.',
    '- placeholder: a short hint, 60 characters maximum.',
    'Write only what the content needs; do not pad to reach a limit.',
    '',
    'Avoid leading questions and double-barrelled questions. A rating question',
    'must carry a scale with labelled ends.',
  ].join('\n');
  p += tagGuidance();
  p += `\n\nReturn the questions by calling the emit_items tool. Do not write prose.`;
  return p;
}

function normalizeItem(raw, config) {
  const question = String(raw?.question || '').trim();
  if (!question) return null;

  const type = config.types.includes(raw?.type) ? raw.type : config.types[0];
  sequence += 1;

  return {
    id: sequence,
    question,
    type,
    scale: raw?.scale && typeof raw.scale === 'object'
      ? {
          type: String(raw.scale.type || '1-5').trim(),
          lowLabel: String(raw.scale.lowLabel || 'Low').trim(),
          highLabel: String(raw.scale.highLabel || 'High').trim(),
        }
      : { type: '1-5', lowLabel: 'Low', highLabel: 'High' },
    options: (Array.isArray(raw?.options) ? raw.options : [])
      .map((o) => String(o || '').trim()).filter(Boolean).slice(0, 6),
    allowMultiple: raw?.allowMultiple === true,
    textType: ['short', 'long', 'email', 'number'].includes(raw?.textType) ? raw.textType : 'short',
    placeholder: String(raw?.placeholder || '').trim(),
    required: raw?.required !== false,
    tags: normalizeTags(raw?.tags),
  };
}

/** First pass only; blanks are treated as "no improvement offered". */
function extractMeta(toolInput) {
  const title = String(toolInput?.surveyTitle || '').trim();
  const description = String(toolInput?.surveyDescription || '').trim();
  if (!title && !description) return null;
  const meta = {};
  if (title) meta.title = title;
  if (description) meta.description = description;
  return meta;
}

exports.handler = makeGenerationHandler({
  kind: 'survey',
  tokenKind: 'survey',
  parseRequest,
  buildTool,
  buildPrompt,
  normalizeItem,
  extractMeta,
  // The near-duplicate net keys on `question`, not `title`.
  titleOf: (item) => item?.question,
  // NO `setCreation`. Survey is not a playable type: upload-questions.js
  // refuses it outright ("Survey upload is not yet supported"), which is why
  // SurveyAIBuilder exports JSON instead of loading. A worker that tried to
  // create a set here would be asking for a 400 on every single run.
  // See shared/generated-set.js.
});
