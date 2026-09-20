/**
 * WHAT A CHECK MEASURED, IN WORDS — for every surface that shows it.
 *
 * The REVIEW row carries `tally` (per category, counted in DISTINCT questions)
 * and `observed` (every band the check saw, whether or not it intervened).
 * Two surfaces render them and they are owed the same vocabulary:
 *
 *   the staff score card   a public copy's whole record, question text and all
 *                          (components/ScoreCard.jsx, fed by
 *                          admin/public-library-item.js).
 *   the author's editor    their OWN set's measurement, beside the note they
 *                          already receive (components/SetReviewBanner.jsx, fed
 *                          by admin/get-set-versions.js).
 *
 * This file is the half they share. It exists because the card kept its own
 * copy of the category words and the band sentences, and the handoff for that
 * work named the drift as a risk before a second reader existed; a second
 * reader is what turns a risk into two screens describing one check in two
 * vocabularies. Nothing here renders: these are strings and arithmetic, so the
 * card can keep its table and the banner its list.
 *
 * The server side has the same seam for the same reason —
 * `lambda-functions/admin/shared/review-card.js` is one PROJECTION for two
 * routes, this is one VOCABULARY for two components.
 */

/** The row a finding or an observation uses to mean "the set's own text". */
export const SET_SUBJECT = '(set)';
export const BAND_RANK = { HIGH: 0, MEDIUM: 1, LOW: 2 };
export const bandOf = (row) => String((row && row.band) || '').toUpperCase();
// A band is a confidence — high, medium, low — never a verdict word: most rows
// on a public card were seen at a band and let through.
export const bandWord = (b) => String(b || '').toLowerCase();

/*
  The five categories a set is judged on (content-guardrail.js SET_CATEGORIES),
  in the words the explanations use (finding-explanations.js CATEGORY_WORDS),
  so a row, its "why" and the category block all say the same thing.
*/
export const CATEGORIES = [
  ['VIOLENCE', 'violence or injury'],
  ['SEXUAL', 'sexual content'],
  ['HATE', 'hateful content'],
  ['INSULTS', 'insulting or harassing language'],
  ['MISCONDUCT', 'dangerous or criminal instructions'],
];
export const CATEGORY_WORDS = Object.fromEntries(CATEGORIES);
/**
 * Judged in one of the five? Anything else in `findings` is the check's own —
 * a subject the guardrail could not read, a check its budget stopped, a set
 * with nothing in it — and has no band to show.
 */
export const JUDGED = new Set(CATEGORIES.map(([id]) => id));
export const isJudged = (row) => JUDGED.has(String(row.category || '').toUpperCase());
export const humanise = (id) => String(id || '').replace(/[-_]+/g, ' ');
export const categoryWords = (c) => CATEGORY_WORDS[String(c || '').toUpperCase()]
  || humanise(String(c || '').toLowerCase());
export const capitalised = (s) => s.charAt(0).toUpperCase() + s.slice(1);

/** Did this row hold the set? Only an intervention can (finding-explanations.js `held`). */
export const held = (row) => row.intervened !== false;
/** Worst band first; within a band, what held before what was let through. */
export const rank = (row) => (BAND_RANK[bandOf(row)] ?? 3) * 2 + (held(row) ? 0 : 1);
/** Stored in question order; a reader wants the worst first, stably. */
export const worstFirst = (list) => list
  .map((o, i) => ({ o, i }))
  .sort((a, b) => rank(a.o) - rank(b.o) || a.i - b.i)
  .map(({ o }) => o);
/** The worst of some bands, or null when none of them is HIGH, MEDIUM or LOW. */
export const worstBand = (bands) => bands
  .map((b) => String(b || '').toUpperCase())
  .filter((b) => BAND_RANK[b] !== undefined)
  .sort((a, b) => BAND_RANK[a] - BAND_RANK[b])[0] || null;
export const rowsOf = (list) => (Array.isArray(list) ? list : []).filter((o) => o && typeof o === 'object');

/** "2 at medium · 1 at low" — distinct questions per band, worst first, zeros left out. */
export const countsWords = (c) => ['HIGH', 'MEDIUM', 'LOW']
  .map((b) => [b, Number(c[b.toLowerCase()]) || 0])
  .filter(([, n]) => n > 0)
  .map(([b, n]) => `${n} at ${bandWord(b)}`)
  .join(' · ');

/**
 * One row of the category block: the worst band ANYTHING was seen at in the
 * category, and where. The tally counts questions (content-guardrail.js
 * tallyOf) and leaves the set's own text out of every count — it is one
 * subject, not a question — so that text is read from `observed` and named
 * beside the counts. Reading the tally alone, a category seen only in the
 * set's own text read "none", one line above that text's own row sending the
 * set to a person; and one seen lower in a question named the lower band.
 */
export function categoryRow(id, tally, observed) {
  const seen = (tally.categories && tally.categories[id]) || {};
  const inQuestions = worstBand([seen.worst]);
  const inSetText = worstBand(observed
    .filter((o) => o.questionId === SET_SUBJECT && String(o.category || '').toUpperCase() === id)
    .map(bandOf));
  const where = [
    inQuestions ? countsWords(seen) : '',
    inSetText ? `the set's own text at ${bandWord(inSetText)}` : '',
  ].filter(Boolean).join(' · ');
  return { worst: worstBand([inQuestions, inSetText]), where };
}

/**
 * How far the check got with the set's own text, which it judges last
 * (content-guardrail.js tallyOf): `checked`, the guardrail read it;
 * `unread`, the check reached it and the guardrail could not read it — so it
 * is never named as checked, nor clean; `unreached`, the budget stopped the
 * check before it.
 */
export function setTextState(tally) {
  if (tally.setTextChecked) return 'checked';
  if (tally.setTextUnread) return 'unread';
  return 'unreached';
}

/**
 * The tally's one line. "Every question clean" is `spotless === questions`,
 * never "no observations": a question the guardrail could not read has none
 * either, and is not clean — it is `unread`.
 *
 * Only a check its budget stopped reached fewer questions than the set holds,
 * and it says "of". The TALLY says which check that was — the set's own text,
 * judged last, `unreached` — never a count beside it: a complete check of a
 * past version would otherwise read as one that skipped questions.
 */
export function summaryLine(tally, questionCount, setClean) {
  const n = Number(tally.questions) || 0;
  const spotless = Number(tally.spotless) || 0;
  const unread = Number(tally.unread) || 0;
  const total = Number(questionCount) || 0;
  const setText = setTextState(tally);
  const cutShort = setText === 'unreached';
  const of = cutShort && total > n ? ` of ${total}` : '';
  const parts = [`${n}${of} ${n === 1 && !of ? 'question' : 'questions'}${setText === 'checked' ? " and the set's own text" : ''} checked`];
  if (n > 0 && spotless === n) {
    // "all" is every question AND the set's own text, which the first clause
    // has just named; with only the questions clean, it says only that. A
    // check cut short counts what it reached, never "every question".
    if (cutShort) parts.push(`all ${n} clean in every category`);
    else parts.push(setClean ? 'all clean in every category' : 'every question clean in every category');
  } else {
    parts.push(`${spotless} with nothing in any category`);
  }
  if (unread) parts.push(`${unread} could not be read`);
  if (setText === 'unread') parts.push("the set's own text could not be read");
  if (cutShort) parts.push("the set's own text was not reached");
  return parts.join(' · ');
}

/**
 * Is this a measurement at all? Only a tally carrying the FULL scope was
 * produced by a check that measured everything (content-guardrail.js tallyOf);
 * one without the marker was never measured, which is not "measured, clean".
 */
export const measuredTally = (tally) => (tally && tally.scope === 'full' ? tally : null);

/**
 * Was the set's own text read AND clean? Text the guardrail could not read is
 * `setTextUnread`, never `setTextChecked`, so it is neither.
 */
export const setTextClean = (tally, observed) => Boolean(tally && tally.setTextChecked)
  && !observed.some((o) => o.questionId === SET_SUBJECT);
