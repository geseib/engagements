/**
 * THE TOPIC AN AI RUN PROPOSES FOR ITS OWN SET — asked of the model in the
 * call the run already makes, and answered by keywords when it does not say.
 *
 * The owner, 23 Oct 2026: *"when ai generates question sets. it should auto
 * tag (based on a list of categories) right now the user gets an error
 * activating sets because they dont have a tag"*. Switching a set on needs a
 * topic (toggle-question-set.js), and a generated set arrived with none unless
 * the person picked one in the review — so "Switch it on now", ticked by
 * default, ended in a refusal.
 *
 * ── NO SECOND CALL ────────────────────────────────────────────────────────
 *
 * The run's FIRST pass carries two optional fields on its own tool —
 * `setTopic` (an enum of the fifteen ids) and `setTags` — and one short block
 * in its prompt naming the shelf. Optional, so a model that skips them still
 * returns valid items and nothing about the items changes. Later passes carry
 * the same tool (one schema per run) and no prompt block, and their answer is
 * not read: one topic per set, decided once, as the survey's improved title is.
 *
 * ── WHAT ANSWERS WHEN THE MODEL DOES NOT ──────────────────────────────────
 *
 * An omitted field, an id off the shelf, a pass that failed before it
 * answered: `shared/topic-keywords.js`, over the set's title, description and
 * every question the draft holds. It always answers with an id on the shelf,
 * so every finished draft carries a suggestion and "Switch it on now" works
 * without a pick. `source` says which one answered ('model' | 'keywords').
 *
 * IT IS A SUGGESTION. The review pre-fills it and the person may change it;
 * the accept uses their choice, else the builder's own pick, else this.
 * A run that ADDS to a set never writes the set's topic — the review offers
 * the suggestion only when that set has none (DraftReview.jsx).
 */
const { SET_TOPICS, SET_TOPIC_IDS, normalizeSetTopic, normalizeSetTags } = require('./set-topics');
const {
  classifySetTopic, suggestSetTags, MAX_SUGGESTED_SET_TAGS,
} = require('./topic-keywords');

const SOURCES = Object.freeze({ MODEL: 'model', KEYWORDS: 'keywords' });

/** The tool, with the two optional set-level fields added. Never mutates. */
function withTopicFields(tool) {
  if (!tool || typeof tool !== 'object' || !tool.input_schema) return tool;
  const schema = tool.input_schema;
  return {
    ...tool,
    input_schema: {
      ...schema,
      properties: {
        ...(schema.properties || {}),
        setTopic: {
          type: 'string',
          enum: [...SET_TOPIC_IDS],
          description: 'The ONE topic id, from the list in the prompt, that this whole set is filed under.',
        },
        setTags: {
          type: 'array',
          items: { type: 'string' },
          description: `Up to ${MAX_SUGGESTED_SET_TAGS} short lower-case kebab-case tags for what this whole set is specifically about.`,
        },
      },
    },
  };
}

/** The prompt block that names the shelf. First pass only. */
function topicPromptBlock() {
  return [
    '',
    'SET TOPIC: also return "setTopic" — the ONE id below that this whole set belongs under,',
    'the way a bookshop files a book on one shelf — and "setTags": up to',
    `${MAX_SUGGESTED_SET_TAGS} lower-case kebab-case words for what the set is specifically about.`,
    'Use general-knowledge only for a genuine mix that spans several topics.',
    ...SET_TOPIC_IDS.map((id) => `- ${id}: ${SET_TOPICS[id].label}`),
  ].join('\n');
}

/** The model's answer from a tool input, or null when it gave no usable topic. */
function readModelTopic(toolInput) {
  if (!toolInput || typeof toolInput !== 'object') return null;
  const topic = normalizeSetTopic(toolInput.setTopic);
  if (!topic) return null;
  const tags = normalizeSetTags(Array.isArray(toolInput.setTags) ? toolInput.setTags : [])
    .filter((t) => t !== topic)
    .slice(0, MAX_SUGGESTED_SET_TAGS);
  return { topic, tags };
}

/**
 * The suggestion to store on a draft.
 *
 * @param {object} opts
 * @param {{topic: string, tags: string[]}|null} opts.model  readModelTopic's answer
 * @param {string} [opts.title]
 * @param {string} [opts.description]
 * @param {Array<object>} [opts.items]  every item the draft holds
 * @returns {{topic: string, tags: string[], source: 'model'|'keywords'}}
 */
function proposeDraftTopic({ model = null, title = '', description = '', items = [] } = {}) {
  const set = { title, description, questions: items };
  if (model && normalizeSetTopic(model.topic)) {
    const topic = normalizeSetTopic(model.topic);
    const tags = model.tags && model.tags.length ? model.tags.slice(0, MAX_SUGGESTED_SET_TAGS) : suggestSetTags(set, topic);
    return { topic, tags, source: SOURCES.MODEL };
  }
  const topic = classifySetTopic(set);
  return { topic, tags: suggestSetTags(set, topic), source: SOURCES.KEYWORDS };
}

module.exports = {
  SOURCES,
  withTopicFields,
  topicPromptBlock,
  readModelTopic,
  proposeDraftTopic,
};
