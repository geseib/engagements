/**
 * Canonical engagement-type vocabulary for backend handlers.
 *
 * ⚠️ DUPLICATED ON PURPOSE. Each Lambda group deploys from its own CodeUri
 * (`lambda-functions/admin/`, `lambda-functions/game/`, …) so a module outside
 * that directory is simply not in the bundle. The three copies that must stay
 * in lock-step are:
 *
 *   - src/src/config/gameTypes.js          (frontend, the original)
 *   - lambda-functions/admin/shared/game-types.js
 *   - lambda-functions/game/game-types.js      (this file)
 *
 * The ALIASES map below is a verbatim copy of the frontend one. If you add an
 * alias, add it in all three.
 *
 * Why this exists: AI prompts were written with two spellings of the same
 * type — analysis prompts used `callandanswer`/`polls`, generation prompts used
 * `call-and-answer`/`poll` — so a filter on either spelling silently returned
 * nothing. Everything canonicalises on the dashed ids now; the aliases keep
 * rows written under the old spellings resolving.
 */

const GAME_TYPE_IDS = ['call-and-answer', 'trivia', 'poll', 'wavelength', 'survey'];

/** Storage/legacy spellings → canonical id. Mirrors src/src/config/gameTypes.js. */
const ALIASES = {
  callandanswer: 'call-and-answer',
  call_and_answer: 'call-and-answer',
  calland: 'call-and-answer',
  quiz: 'trivia',
  polls: 'poll',
};

const DEFAULT_GAME_TYPE = 'call-and-answer';

/** Canonical id for any spelling; falls back to call-and-answer. */
function normalizeGameType(type) {
  if (!type) return DEFAULT_GAME_TYPE;
  const key = String(type).trim().toLowerCase();
  if (GAME_TYPE_IDS.includes(key)) return key;
  if (ALIASES[key]) return ALIASES[key];
  return DEFAULT_GAME_TYPE;
}

/**
 * Is this a spelling we actually recognise?
 *
 * `normalizeGameType` deliberately never returns undefined, which makes it a
 * bad validator — "banana" would normalise to call-and-answer. Writers use
 * this to reject junk before it reaches the table.
 */
function isKnownGameType(type) {
  if (!type) return false;
  const key = String(type).trim().toLowerCase();
  return GAME_TYPE_IDS.includes(key) || Boolean(ALIASES[key]);
}

/**
 * Every spelling a row may legitimately be stored under for this type.
 * Readers use it to match legacy rows without a data migration.
 */
function gameTypeSpellings(type) {
  const canonical = normalizeGameType(type);
  const legacy = Object.keys(ALIASES).filter((a) => ALIASES[a] === canonical);
  return [canonical, ...legacy];
}

/** Do two spellings refer to the same engagement type? */
function sameGameType(a, b) {
  return normalizeGameType(a) === normalizeGameType(b);
}

module.exports = {
  GAME_TYPE_IDS,
  ALIASES,
  DEFAULT_GAME_TYPE,
  normalizeGameType,
  isKnownGameType,
  gameTypeSpellings,
  sameGameType,
};
