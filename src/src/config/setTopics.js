/**
 * THE SHELF A SET SITS ON — ESM MIRROR of
 * `lambda-functions/admin/shared/set-topics.js`.
 *
 * ⚠️ DUPLICATED ON PURPOSE, for the same reason `config/roundKinds.js` and
 * `utils/tags.js` are: each Lambda deploys from its own CodeUri, so the backend
 * cannot import from `src/`. Keep the two in lock-step — `tests/set-topics.js`
 * fails the build if the shelf drifts, and a drift here would have the picker
 * offering a shelf the importer refuses.
 *
 * ── WHAT THIS IS, IN ONE LINE EACH ─────────────────────────────────────────
 *
 *   topic   EXACTLY ONE id from the fifteen below. A book sits on one shelf.
 *           This is what the library filter and the browse are built on.
 *   tags    any number of the author's own words, for the specifics a shelf of
 *           fifteen will never carry ("1980s", "onboarding").
 *
 * ── THE WORDS THIS PRODUCT ALREADY OVERLOADS ───────────────────────────────
 *
 * CATEGORY IS TAKEN: in this app it means the IN-SET grouping (c001…c005,
 * `categoryCount`, `CategoryPicker`, the host's 24-bit mask). The shelf is NOT
 * a category and must never be called one, in code or in copy.
 *
 * TAGS IS HALF TAKEN: `tags` on a QUESTION row (`utils/questionRows.js`) are
 * that question's keywords. The list here is the SET's. Nothing may carry one
 * to the other.
 *
 * ── UNFILED IS A STATE, NOT A FAILURE ──────────────────────────────────────
 *
 * Around forty sets predate this field. They are UNFILED: they list, read and
 * play exactly as they did, a filter can ask for them by that name, and a
 * rename of one still saves. `UNFILED` is the empty string rather than a
 * sixteenth id, because that is what those rows really carry.
 *
 * A SCREEN RESOLVES, A FORM REFUSES. `resolveSetTopic` answers `UNFILED` for
 * anything it does not recognise, so a list never breaks over a stored value;
 * `normalizeSetTopic` answers `null` for the same input, so a form can refuse
 * it and say why. Same split as `config/roundKinds.js`.
 */
import { normalizeTag, normalizeTags } from '../utils/tags';

/**
 * The shelf. Order is the order a picker renders them in: alphabetical, with
 * the honest catch-all last so it is not the first thing reached for.
 *
 * `id` is exactly `normalizeTag(label)`, so a topic id is a well-formed tag and
 * a caller may send either spelling without a lookup table.
 */
export const SET_TOPICS = {
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
    blurb: 'A genuine mix that spans the shelves — not the place to put a set you have not thought about.',
  },
};

/** The closed list, in picker order. */
export const SET_TOPIC_IDS = Object.keys(SET_TOPICS);

/** What a set with no topic is. Empty, because that is what the row carries. */
export const UNFILED = '';

/** What a person sees where a shelf would be. */
export const UNFILED_LABEL = 'Unfiled';

/** A ceiling on a set's own tags — a guard against a paste, not a design limit. */
export const MAX_SET_TAGS = 12;

/**
 * Canonical id for any spelling of a shelf, or null when it is not one.
 *
 * A LIST IS NOT A TOPIC: `String(['history'])` is `'history'`, so without the
 * type guard an array of one would be accepted and a set would quietly claim
 * two shelves the day somebody passed an array of two.
 */
export const normalizeSetTopic = (value) => {
  if (typeof value !== 'string') return null;
  const key = normalizeTag(value);
  return SET_TOPIC_IDS.includes(key) ? key : null;
};

/** What a SCREEN should treat a stored value as: a shelf, or UNFILED. */
export const resolveSetTopic = (value) => normalizeSetTopic(value) || UNFILED;

/** The label to show, including for a set with no shelf. */
export const setTopicLabel = (value) => {
  const id = normalizeSetTopic(value);
  return id ? SET_TOPICS[id].label : UNFILED_LABEL;
};

/** The shelf written out, for a message that has to name it. */
export const setTopicChoices = () => SET_TOPIC_IDS.map((id) => SET_TOPICS[id].label).join(', ');

/**
 * The refusal a FORM should show, or null when this is a shelf. Both refusals
 * name the whole shelf, because that is the entire answer to "what should I
 * have said".
 */
export const setTopicRefusal = (value) => {
  if (normalizeSetTopic(value)) return null;
  const offered = typeof value === 'string' ? value.trim() : '';
  return offered === ''
    ? `Give this set a topic. Choose one of: ${setTopicChoices()}.`
    : `Unknown topic "${offered}". Choose one of: ${setTopicChoices()}.`;
};

/**
 * A set's own tags → canonical, de-duplicated, capped.
 *
 * One implementation, in `utils/tags.js`; this only fixes the cap. Its editing
 * note applies here too: do NOT normalise on every keystroke — it eats the
 * hyphen out of "remote-" the instant it is typed. Hold the raw text while
 * editing and call this on blur.
 */
export const normalizeSetTags = (raw) => normalizeTags(raw, { max: MAX_SET_TAGS });
