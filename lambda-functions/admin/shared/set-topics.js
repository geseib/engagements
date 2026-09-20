/**
 * THE SHELF A SET SITS ON — one closed list, plus the author's own words.
 *
 * THE OWNER ASKED FOR THIS, in their words: *"i think we need topic tags for
 * question sets and req at least 1 pretty broad for public ones Science/Tech
 * Health/Med Business Politics History etc. think how a book store might
 * classify sections. and we need an easy filter on that. but also ability to
 * see/search all tags."*
 *
 * ── WHY A CLOSED LIST AND FREE WORDS, RATHER THAN EITHER ALONE ─────────────
 *
 * Free text alone fragments. "history", "History" and "hist" are one shelf to
 * a reader and three to a filter, and a browse built on them offers a list
 * nobody can navigate. A closed list alone is too coarse: no shelf of fifteen
 * will ever carry "1980s" or "onboarding".
 *
 * So a set carries BOTH, and they do different jobs:
 *
 *   topic   EXACTLY ONE id from the fifteen below. A book sits on one shelf.
 *           This is what the filter and the browse are built on.
 *   tags    any number of the author's own words, for the specifics.
 *
 * ── THE WORDS THIS PRODUCT ALREADY OVERLOADS ───────────────────────────────
 *
 * CATEGORY IS TAKEN, and a collision here would be expensive. In this codebase
 * a category is the IN-SET grouping: `c001`…`c005`, `categoryCount`, the
 * `CATEGORY#` rows, the host's 24-bit mask. The shelf is NOT one of those and
 * must never be called a category, in code or in copy.
 *
 * TAGS IS HALF TAKEN. `Tags` — capitalised, parsed from the CSV column — is a
 * QUESTION row's own keywords (upload-questions.js, tests/upload-questions-tags.js).
 * `tags` — lower case, on the set's metadata row — is the SET's. The case
 * difference is this repo's existing convention, not a coincidence: attributes
 * derived from a CSV cell are Capitalised (Title, Detail, Category, Tags) and
 * metadata attributes are not (name, description, promptId). Nothing may carry
 * one list to the other; tests/set-topics.js pins that.
 *
 * ── UNFILED IS A STATE, NOT A FAILURE ──────────────────────────────────────
 *
 * Around forty sets predate this field. They are UNFILED: they list, read and
 * play exactly as they did, they can be renamed, and a filter can ask for them
 * by that name. `UNFILED` is the empty string rather than a sixteenth id,
 * because the absence of an attribute is what those rows actually carry and
 * inventing a stored value for them would need a migration to say nothing new.
 *
 * WRITERS REFUSE, READERS RESOLVE. `normalizeSetTopic` answers null for
 * anything off the shelf so a writer can refuse it and tell somebody;
 * `resolveSetTopic` answers UNFILED for the same input, because a reader's job
 * is to render a set and not to police it. This is the same split
 * `round-kinds.js` makes, for the same reason.
 *
 * ── TAGS REUSE THE ONE TAG VOCABULARY, DELIBERATELY ────────────────────────
 *
 * `shared/tags.js` already exists, already says in its own header that it is
 * "shared by generation, prompts and (eventually) question sets", and already
 * carries the rule: NORMALISE ON WRITE, TOLERATE ON READ. Its reason is a real
 * bug — the stored prompt tags include "STAR" beside "star", so a filter
 * comparing strings matched nothing.
 *
 * So a set's tags are STORED CANONICAL — lower-case kebab — and shown in that
 * form. That is the decision, and it is pinned here rather than left open: the
 * alternative (store what was typed, fold only for comparison) needs a second
 * field on every row and reintroduces exactly the two-spellings-of-one-tag bug
 * the shared module exists to prevent. `normalizeSetTags` is a thin wrapper so
 * there is one implementation, not two that must be kept in step.
 *
 * DUPLICATED ON PURPOSE. `src/src/config/setTopics.js` is the ESM mirror of the
 * data below. Lambda bundles are per-directory and cannot import the frontend's
 * ESM module — the same rule `shared/set-version.js` states and
 * `shared/round-kinds.js` follows. Keep the two in sync; tests/set-topics.js
 * asserts that they are.
 */
const { normalizeTag, normalizeTags } = require('./tags');

/**
 * The shelf. Order is the order a picker renders them in: alphabetical, with
 * the honest catch-all last so it is not the first thing reached for.
 *
 * `label` is what a person reads. `id` is what a row stores, and it is exactly
 * `normalizeTag(label)` — so a topic id is a well-formed tag, a browse can put
 * shelves and tags through the same comparison, and a caller may send either
 * spelling without a lookup table.
 *
 * `blurb` is the picker's one line. It is load-bearing for General Knowledge in
 * particular: a catch-all with nothing said about it becomes the shelf
 * everything lands on, which is the failure that makes a filter useless.
 */
const SET_TOPICS = {
  'arts-culture': {
    id: 'arts-culture',
    label: 'Arts & Culture',
    blurb: 'Painting, theatre, design, museums — how people make things and what they make of them.',
  },
  'business-work': {
    id: 'business-work',
    label: 'Business & Work',
    blurb: 'Companies, money, careers, how teams actually get things done.',
  },
  'everyday-life': {
    id: 'everyday-life',
    label: 'Everyday Life',
    blurb: 'Home, habits, money in the small, the things nobody is taught and everybody does.',
  },
  'film-tv': {
    id: 'film-tv',
    label: 'Film & TV',
    blurb: 'Movies, series, the people who make them and the lines everyone can quote.',
  },
  'food-drink': {
    id: 'food-drink',
    label: 'Food & Drink',
    blurb: 'Cooking, ingredients, restaurants, wine, coffee and everything around a table.',
  },
  'geography-travel': {
    id: 'geography-travel',
    label: 'Geography & Travel',
    blurb: 'Places, maps, borders, cities and the journeys between them.',
  },
  'health-medicine': {
    id: 'health-medicine',
    label: 'Health & Medicine',
    blurb: 'The body, medicine, fitness, mental health and how care is delivered.',
  },
  history: {
    id: 'history',
    label: 'History',
    blurb: 'What happened before now — people, events, and the arguments about both.',
  },
  'language-literature': {
    id: 'language-literature',
    label: 'Language & Literature',
    blurb: 'Books, poetry, writing, words and where they came from.',
  },
  music: {
    id: 'music',
    label: 'Music',
    blurb: 'Songs, players, genres, instruments and the business around them.',
  },
  'nature-environment': {
    id: 'nature-environment',
    label: 'Nature & Environment',
    blurb: 'Animals, plants, weather, climate and the living world.',
  },
  'politics-society': {
    id: 'politics-society',
    label: 'Politics & Society',
    blurb: 'Government, law, religion, the way people organise and disagree.',
  },
  'science-technology': {
    id: 'science-technology',
    label: 'Science & Technology',
    blurb: 'Physics through software — how things work and how we found out.',
  },
  'sport-games': {
    id: 'sport-games',
    label: 'Sport & Games',
    blurb: 'Teams, athletes, board games, video games and the rules of all of them.',
  },
  'general-knowledge': {
    id: 'general-knowledge',
    label: 'General Knowledge',
    blurb: 'A genuine mix that spans the topics — not the place to put a set you have not thought about.',
  },
};

/** The closed list. Order is the order a picker renders them in. */
const SET_TOPIC_IDS = Object.keys(SET_TOPICS);

/** What a set with no topic is. The empty string, because that is what a row
 *  that predates the field really carries — there is nothing to migrate. */
const UNFILED = '';

/** What a person sees where a shelf would be. */
const UNFILED_LABEL = 'Unfiled';

/**
 * A ceiling on a set's own tags. Not a view about how many words a set
 * deserves — it is a guard against a paste turning one row into a hundred-tag
 * row that no chip list can render and no filter can read.
 */
const MAX_SET_TAGS = 12;

/**
 * Canonical id for any spelling of a shelf, or null when it is not one.
 *
 * A LIST IS NOT A TOPIC. The type guard is the point of the first line, not
 * defensive noise: `String(['history'])` is `'history'`, so without it an array
 * of one would be accepted and a set would quietly claim two shelves the day
 * somebody sent an array of two.
 */
function normalizeSetTopic(value) {
  if (typeof value !== 'string') return null;
  const key = normalizeTag(value);
  return SET_TOPIC_IDS.includes(key) ? key : null;
}

/** What a READER should treat a stored value as: a shelf, or UNFILED. */
function resolveSetTopic(value) {
  return normalizeSetTopic(value) || UNFILED;
}

/** The label to show for a stored value, including for a set with no shelf. */
function setTopicLabel(value) {
  const id = normalizeSetTopic(value);
  return id ? SET_TOPICS[id].label : UNFILED_LABEL;
}

/** The shelf, written out, for a message that has to name it. */
function setTopicChoices() {
  return SET_TOPIC_IDS.map((id) => SET_TOPICS[id].label).join(', ');
}

/**
 * The refusal a WRITER should return, or null when this is a shelf.
 *
 * Both refusals name the whole shelf, because the shelf is the entire answer
 * to "what should I have said" and a refusal that withholds it just sends the
 * person back to guess again.
 */
function setTopicRefusal(value) {
  if (normalizeSetTopic(value)) return null;
  const offered = typeof value === 'string' ? value.trim() : '';
  return offered === ''
    ? `Give this set a topic. Choose one of: ${setTopicChoices()}.`
    : `Unknown topic "${offered}". Choose one of: ${setTopicChoices()}.`;
}

/**
 * A set's own tags → canonical, de-duplicated, capped.
 *
 * One implementation, in shared/tags.js; this only fixes the cap so a set and
 * a question do not have to agree about how many words each may carry.
 */
function normalizeSetTags(raw) {
  return normalizeTags(raw, { max: MAX_SET_TAGS });
}

module.exports = {
  SET_TOPICS,
  SET_TOPIC_IDS,
  UNFILED,
  UNFILED_LABEL,
  MAX_SET_TAGS,
  normalizeSetTopic,
  resolveSetTopic,
  setTopicLabel,
  setTopicChoices,
  setTopicRefusal,
  normalizeSetTags,
};
