/**
 * THE BROWSER'S HALF OF FILL / REFINE / LOCK.
 *
 * The owner asked for a helper that fills a blank field, REFINES one the
 * operator already wrote, and never touches a LOCKED one. The server half is
 * `lambda-functions/admin/shared/field-drafting.js`; this is what decides what
 * actually lands in the form.
 *
 * It lives here rather than inside the builder components on purpose. The three
 * AI builders are 800-1300 line components and two of the five files that
 * cannot be mounted in jsdom at all are the same shape — so the rule in this
 * repo is that logic which matters lives in a module a test can call directly.
 * `config/anonymity.js`, `config/podium.js` and `utils/nextQuestion.js` exist
 * for the same reason.
 *
 * ── THE LOCK, ONE MORE TIME ────────────────────────────────────────────────
 *
 * The server never offers the model a slot for a locked field and strips the key
 * if it appears anyway. `applyFieldDraft` refuses it a third time, on the way
 * into the form. That is not belt-and-braces for its own sake: the browser is
 * talking to whatever version of the Lambda is deployed, and a lock is the one
 * promise in this feature that the operator is relying on absolutely. It must
 * hold against a stale backend, a replayed job id, and a hand-rolled response.
 *
 * ── WHAT STOPS "REFINE" BECOMING "REPLACE" ─────────────────────────────────
 *
 * The prompt asks for the operator's own words improved. Asking is not
 * enforcing. `retention()` measures how much of the operator's distinctive
 * wording survived into the proposal, and a proposal that kept too little of it
 * is HELD — shown beside their text with an explicit choice — rather than
 * written into the form. That is the mechanism; the prompt is only the aim.
 */

/**
 * Words too common to say anything about whether a sentence survived.
 *
 * Deliberately short. A long stoplist starts deleting the words that carry the
 * operator's meaning ("team", "new", "work"), and every word it removes makes
 * the retention score jumpier on exactly the short fields — a title, an
 * audience — where a single kept noun is the whole signal.
 */
const STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'if', 'of', 'to', 'in', 'on', 'for',
  'with', 'at', 'by', 'from', 'as', 'is', 'are', 'was', 'were', 'be', 'been',
  'it', 'its', 'this', 'that', 'these', 'those', 'their', 'our', 'your',
]);

const trim = (value) => String(value ?? '').trim();

/**
 * The words worth tracking: lowercased, punctuation-stripped, 3+ characters,
 * not a stopword. Numbers are kept whatever their length — "2026", "40" and
 * "3x" are exactly the specifics a replacement quietly loses.
 */
export function distinctiveTokens(value) {
  return trim(value)
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .filter((word) => (/\d/.test(word) ? true : word.length >= 3 && !STOPWORDS.has(word)));
}

/**
 * How much of the operator's wording survived, 0..1.
 *
 * Measured over the SET of their distinctive words, so repeating a word does not
 * inflate the score and reordering does not deflate it. An empty original
 * returns 1: there was nothing to lose, which is the `fill` case and never
 * reaches here.
 */
export function retention(original, proposed) {
  const mine = new Set(distinctiveTokens(original));
  if (mine.size === 0) return 1;
  const theirs = new Set(distinctiveTokens(proposed));
  let kept = 0;
  for (const word of mine) if (theirs.has(word)) kept += 1;
  return kept / mine.size;
}

/**
 * How much of the operator's wording a refinement must keep to be applied
 * without asking.
 *
 * Half, and the number is a judgement rather than a measurement. Real
 * refinements of a rough sentence score high — tightening grammar and adding a
 * clause keeps nearly every noun. A model that has written its own version of
 * the field from the same brief scores low, because it reached for its own
 * vocabulary. The failure mode of setting it too high is a proposal held back
 * that the operator would have accepted, which costs one click; the failure mode
 * of setting it too low is their paragraph replaced by something else, which is
 * the thing the owner asked us not to do. So it errs high.
 */
export const REFINE_RETENTION_MIN = 0.5;

/** fill | refine | locked, for one field. Mirrors the server's `planFields`. */
export function classifyField(values, locked, key) {
  if (isLocked(locked, key)) return 'locked';
  return trim(values?.[key]) ? 'refine' : 'fill';
}

/** `locked` may be a Set or an array — components hold a Set, the wire an array. */
export function isLocked(locked, key) {
  if (!locked) return false;
  if (typeof locked.has === 'function') return locked.has(key);
  return Array.isArray(locked) && locked.includes(key);
}

/** The wire form: a sorted array of the field keys this form actually has. */
export function lockedKeys(locked, fields) {
  return fields.map((f) => f.key).filter((key) => isLocked(locked, key));
}

/**
 * THE APPLY STEP, and the only place a drafted value becomes a form value.
 *
 * Per field, in the order the form shows them:
 *
 *   LOCKED   → refused, and recorded in `blocked`. Nothing about the proposal
 *              can change a locked field, including a proposal that names one.
 *              `blocked` being non-empty means a server-side guarantee failed,
 *              so it is reported rather than swallowed.
 *   ABSENT   → nothing proposed for this field. Not the same as an empty
 *              proposal and never treated as "clear it".
 *   EMPTY NOW→ FILLED. There is nothing to destroy.
 *   SAME     → `unchanged`. The model was asked to return the operator's text
 *              untouched when it could not improve it, so this is a correct
 *              answer and must not be reported as a refinement — a screen that
 *              claims it refined a field it did not touch is a lie the operator
 *              will act on.
 *   KEPT     → REFINED, applied, with the previous text kept for undo.
 *   REPLACED → HELD. Shown beside their words, applied only if they say so.
 *
 * Returns a patch rather than mutating anything: the caller merges it into its
 * own config state, and nothing here is saved or sent anywhere.
 */
export function applyFieldDraft(item, { fields, values, locked }) {
  const patch = {};
  const filled = [];
  const refined = [];
  const unchanged = [];
  const held = {};
  const blocked = [];
  const previous = {};

  for (const field of fields) {
    const key = field.key;
    if (isLocked(locked, key)) {
      if (trim(item?.[key])) blocked.push(key);
      continue;
    }
    const proposed = trim(item?.[key]);
    if (!proposed) continue;

    const mine = trim(values?.[key]);
    if (!mine) {
      patch[key] = proposed;
      filled.push(key);
      continue;
    }
    if (proposed === mine) {
      unchanged.push(key);
      continue;
    }
    if (retention(mine, proposed) >= REFINE_RETENTION_MIN) {
      previous[key] = mine;
      patch[key] = proposed;
      refined.push(key);
    } else {
      held[key] = proposed;
    }
  }

  return { patch, filled, refined, unchanged, held, blocked, previous };
}

/**
 * DROP ANYTHING THE OPERATOR HAS EDITED SINCE THE REQUEST WENT OUT.
 *
 * Found by a test rather than by reasoning, and it is the same data-loss bug as
 * the one this feature exists to avoid, one layer down. The job takes seconds;
 * the operator keeps typing. `applyFieldDraft` classifies against the SNAPSHOT
 * the request was built from — correctly, because that is what the model was
 * shown — but merging the resulting patch into the LIVE state would then write
 * over a sentence the model never saw, and would do it to a field it believed
 * was blank.
 *
 * A field that has moved is skipped and named, not silently dropped: the
 * operator is told the proposal for it was discarded because they were mid-edit.
 */
export function dropEditedSince(patch, { snapshot, latest }) {
  const kept = {};
  const stale = [];
  for (const [key, value] of Object.entries(patch || {})) {
    if (trim(latest?.[key]) === trim(snapshot?.[key])) kept[key] = value;
    else stale.push(key);
  }
  return { patch: kept, stale };
}

/** Is there anything at all for the model to work from? */
export function hasSeedContent(fields, values) {
  return fields.some((field) => trim(values?.[field.key]));
}

/** Anything left for it to write into? Every field locked means no. */
export function hasUnlockedField(fields, locked) {
  return fields.some((field) => !isLocked(locked, field.key));
}
