// lambda-functions/admin/shared/review-card.js
/**
 * WHAT A CHECK MEASURED, PROJECTED ONCE FOR EVERY SURFACE THAT MAY SHOW IT.
 *
 * The REVIEW row (shared/set-review.js) holds three different people's facts in
 * one item: what the check MEASURED (`tally`, `observed`), what a person
 * DECIDED (`reviewer`, `decidedAt`, `notice`, and after a decision `note`), and
 * what the author DECLARED (`declaredNotice`). Two surfaces read it and they
 * are owed different halves:
 *
 *   the staff score card   everything — it is the record of a decision, and of
 *                          who made it (admin/public-library-item.js).
 *   the author's editor    the measurement of THEIR OWN content, and the note
 *                          they already receive. Never the reviewer, never when
 *                          they ruled, never the notices they attached, never
 *                          the snapshot key (admin/get-set-versions.js).
 *
 * `measurementOf` is the half they share, and it lives here so that "what a
 * check measured" is one list rather than two that drift. A field added to the
 * review row does NOT arrive on either surface by growing this function — both
 * callers project explicitly, and the author's caller re-states the boundary in
 * its own words, because a whitelist that only one reader maintains is a
 * whitelist that leaks the first time somebody else edits it.
 *
 * ── WHY THE TEXT-NAMING IS HERE BUT THE AUTHOR DOES NOT USE IT ─────────────
 *
 * `withText` names each row by its question's text. The card needs it because
 * STAFF HAVE NO OTHER WAY TO SEE THE QUESTION: an organisation's rows are
 * encrypted under that organisation's key, so the card reads the PUBLIC COPY,
 * which publish wrote in plaintext with the judged snapshot's keys intact.
 *
 * The author's version list does not call it, and must not: its function has no
 * `kms:Decrypt` grant (template-clean.yaml, AdminGetSetVersionsFunction), so
 * the moment it reached tenant-crypto `tests/kms-grants-match-code.js` would
 * fail — which is the test doing its job, not an obstacle to route around. It
 * does not need one either. The surface that renders the author's measurement
 * IS the set editor, and the editor is already holding the plaintext questions
 * these ids name.
 */
const { queryPartition } = require('./set-version');

/** The row an observation or a finding uses to mean "the set's own text". */
const SET_SUBJECT = '(set)';
const QUESTION_PREFIX = 'QUESTION#';

/** A question as a room sees it asked: title, then detail, one per line. */
const lines = (...values) => values
  .map((v) => (typeof v === 'string' ? v.trim() : ''))
  .filter(Boolean)
  .join('\n');

/**
 * WHAT THE CHECK MEASURED, and only that.
 *
 * `tally` is null, never `{}`: "checked before measuring existed" is not
 * "measured, and nothing seen" (content-guardrail.js `tallyOf`, `scope:
 * 'full'`), and a reader forced to tell those apart from an empty object will
 * eventually get it wrong in the reassuring direction. `observed` is every LOW+
 * band the check saw — a superset of `findings`, which keeps its own narrower
 * meaning of what actually HELD the set.
 */
function measurementOf(review) {
  const tally = review && review.tally && typeof review.tally === 'object' ? review.tally : null;
  const observed = Array.isArray(review && review.observed) ? review.observed : [];
  return { tally, observed };
}

/**
 * Name each row of each list by its subject's text, from ONE read of
 * `partitionPk` however many lists name a question.
 *
 * An id that partition does not hold, and a row that names no subject at all,
 * get '' rather than a guess. A list that is not an array comes back empty.
 * The partition must be PLAINTEXT — see the header.
 */
async function withText(db, tableName, lists, { partitionPk, setName = '' } = {}) {
  const rowsOf = (list) => (Array.isArray(list) ? list : []).filter((o) => o && typeof o === 'object');
  const all = lists.map(rowsOf);
  const texts = new Map();
  if (partitionPk && all.some((rows) => rows.some((o) => o.questionId && o.questionId !== SET_SUBJECT))) {
    const { items } = await queryPartition(db, tableName, partitionPk, QUESTION_PREFIX);
    for (const row of items) texts.set(String(row.SK).slice(QUESTION_PREFIX.length), lines(row.Title, row.Detail));
  }
  const named = (o) => ({ ...o, text: o.questionId === SET_SUBJECT ? setName : (texts.get(o.questionId) || '') });
  return all.map((rows) => rows.map(named));
}

module.exports = { SET_SUBJECT, QUESTION_PREFIX, lines, measurementOf, withText };
