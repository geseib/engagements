/**
 * IS THIS AN ANSWER TO THIS QUESTION? — every survey value, checked before it
 * is kept.
 *
 * The contract's table (docs/design/survey-redesign/IMPLEMENTATION-phase-2.md,
 * "Answer values"), one branch per kind:
 *
 *   rating  an integer on the scale: 1-5, 1-10, 0-10; stars are 1-5
 *   choice  [index…] or [index…, {other}] — distinct, in range; one pick unless
 *           allowMultiple, at most maxPicks; a write-in only if allowOther,
 *           ≤ 280 characters. A write-in IS a pick: "Other: lunch" alone is a
 *           whole answer to a pick-one question, and it counts toward maxPicks.
 *           A blank write-in is dropped, the picks beside it kept.
 *   yesno   {v: 'yes'|'no'|'unsure', why?} — unsure only where offered; a why
 *           only where followUpWhen asks for one, ≤ 280
 *   rank    [index…] in order — distinct, in range, at least one
 *   text    a string, trimmed, ≤ maxLength (never past 2000)
 *   any     null — clears the answer
 *
 * Indexes are the CANONICAL option order. `shuffle` is how a phone draws the
 * list, never how an answer is stored — the aggregate counts by index.
 *
 * Returns the value to STORE, which is the sent value cleaned: a write-in and a
 * why trimmed, a blank why or write-in dropped, a blank text read as a clear.
 * Anything that is not an answer is refused WHOLE with a sentence, never
 * repaired into one — an index that names no option would be counted against
 * nothing.
 *
 * THE SAME RULES AS THE AGGREGATE (survey-aggregate.js), which ignores whole
 * any value that does not fit its question. If this accepted what that ignores,
 * a person would be told "Saved" for an answer that is never counted. This may
 * be STRICTER than the aggregate (it refuses keys a value should not carry);
 * it must never be looser.
 */
const MAX_OTHER = 280;
const MAX_WHY = 280;
const MAX_TEXT = 2000;

const SCALE_RANGE = Object.freeze({
  '1-5': [1, 5], '1-10': [1, 10], '0-10': [0, 10], stars: [1, 5],
});

const ok = (value) => ({ ok: true, value });
const no = (error) => ({ ok: false, error });

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

function checkRating(q, value) {
  const [lo, hi] = SCALE_RANGE[q.scale] || SCALE_RANGE['1-5'];
  if (!Number.isInteger(value) || value < lo || value > hi) {
    return no(`a rating on this question is a whole number from ${lo} to ${hi}`);
  }
  return ok(value);
}

/** The distinct, in-range indexes of a list answer, or an error sentence. */
function indexesOf(list, count) {
  const seen = new Set();
  for (const i of list) {
    if (!Number.isInteger(i) || i < 0 || i >= count) return { error: `an option number must be from 0 to ${count - 1}` };
    if (seen.has(i)) return { error: 'the same option is picked twice' };
    seen.add(i);
  }
  return { indexes: [...seen] };
}

function checkChoice(q, value) {
  if (!Array.isArray(value)) return no('a choice is a list of option numbers');
  const options = Array.isArray(q.options) ? q.options : [];
  let other = null;
  let picks = value;
  const last = value[value.length - 1];
  if (isPlainObject(last)) {
    if (!q.allowOther) return no('this question takes no write-in answer');
    if (Object.keys(last).some((k) => k !== 'other') || typeof last.other !== 'string') {
      return no('a write-in is {"other": "…"}');
    }
    // A blank write-in is DROPPED and the picks kept — the rule the aggregate
    // reads by (survey-aggregate.js), so the two never disagree about it.
    other = last.other.trim() || null;
    if (other && other.length > MAX_OTHER) return no(`a write-in is at most ${MAX_OTHER} characters`);
    picks = value.slice(0, -1);
  }
  const { indexes, error } = indexesOf(picks, options.length);
  if (error) return no(error);
  const total = indexes.length + (other === null ? 0 : 1);
  if (total === 0) return no('pick at least one option, or send null to clear');
  if (!q.allowMultiple && total !== 1) return no('this question takes one pick');
  const cap = Number.isInteger(q.maxPicks) ? q.maxPicks : options.length + (q.allowOther ? 1 : 0);
  if (total > cap) return no(`this question takes at most ${cap} picks`);
  return ok(other === null ? indexes : [...indexes, { other }]);
}

/** Does `followUpWhen` ask for a why after answer `v`? */
function asksWhy(followUpWhen, v) {
  if (followUpWhen === 'any') return true;
  return followUpWhen === v;
}

function checkYesNo(q, value) {
  if (!isPlainObject(value)) return no('a yes/no answer is {"v": "yes" | "no" | "unsure"}');
  if (Object.keys(value).some((k) => k !== 'v' && k !== 'why')) return no('a yes/no answer carries only v and why');
  const { v } = value;
  if (v !== 'yes' && v !== 'no' && v !== 'unsure') return no('a yes/no answer is yes, no or unsure');
  if (v === 'unsure' && !q.unsure) return no('this question does not offer "not sure"');
  if (value.why === undefined || value.why === null) return ok({ v });
  if (typeof value.why !== 'string') return no('a why is text');
  const why = value.why.trim();
  if (!why) return ok({ v });
  if (!asksWhy(q.followUpWhen, v)) return no('this answer does not ask why');
  if (why.length > MAX_WHY) return no(`a why is at most ${MAX_WHY} characters`);
  return ok({ v, why });
}

function checkRank(q, value) {
  if (!Array.isArray(value)) return no('a ranking is a list of option numbers, first place first');
  const options = Array.isArray(q.options) ? q.options : [];
  const { indexes, error } = indexesOf(value, options.length);
  if (error) return no(error);
  if (!indexes.length) return no('place at least one item, or send null to clear');
  return ok(indexes);
}

function checkText(q, value) {
  if (typeof value !== 'string') return no('this answer is text');
  const text = value.trim();
  if (!text) return ok(null);
  const cap = Math.min(Number.isInteger(q.maxLength) ? q.maxLength : MAX_TEXT, MAX_TEXT);
  if (text.length > cap) return no(`this answer is at most ${cap} characters`);
  return ok(text);
}

const CHECKS = Object.freeze({
  rating: checkRating, choice: checkChoice, yesno: checkYesNo, rank: checkRank, text: checkText,
});

/**
 * @param question one of survey-questions.js's shapes
 * @param value    what the phone sent
 * @returns {{ ok: true, value: any } | { ok: false, error: string }}
 *   `value` null means "clear this answer".
 */
function checkAnswer(question, value) {
  if (value === null) return ok(null);
  if (value === undefined) return no('value is required — send null to clear an answer');
  const check = question && CHECKS[question.kind];
  if (!check) return no('this question cannot be answered');
  return check(question, value);
}

module.exports = { checkAnswer, SCALE_RANGE, MAX_OTHER, MAX_WHY, MAX_TEXT };
