/**
 * WHICH THING A COMMENT SITS UNDER — Workie's read, one response, or the round
 * as a whole (docs/design/phone-comments README, backend B1).
 *
 * ── THE BALLOT NUMBER IS THE REPLY ANCHOR ──────────────────────────────────
 *
 * A reply to a response used to be anchored to the row's POSITION in whichever
 * ranked list the phone drew. On a tie the phone and the report could order the
 * rows differently, so "Response 2" could name two different responses. Since
 * Phase 3c a new reply stores the response's BALLOT number — its display place
 * from answer-order.js, 1-based, the number the room voted under and the one
 * the results screen prints ("You wrote response 4") — and says so with
 * `AnchorBasis: 'ballot'`. The sort key keeps its numeric shape; only the
 * meaning of the number is marked.
 *
 * ── OLDER COMMENTS ─────────────────────────────────────────────────────────
 *
 * A row with no AnchorBasis holds a position that cannot be trusted. It is
 * placed by matching its stored quote (`AnchorExcerpt`) against each
 * response's own words. When nothing matches it goes under the whole round,
 * where it still prints its quote — nothing is lost, and nothing is filed
 * under the wrong person.
 *
 * DUPLICATED in src/src/config/commentPlacement.js, because Lambda bundles are
 * per-directory and the frontend cannot import from here.
 * src/src/__tests__/commentPlacement.test.js runs both copies on one set of
 * fixtures and requires they agree. Change both or neither.
 */

/** Words only: case, punctuation, markdown symbols and spacing removed. */
const wordsOf = (text) => String(text ?? '')
  .toLowerCase()
  .replace(/…$/u, '')
  .replace(/[^\p{L}\p{N}]+/gu, '');

/** A response row's own text, in either spelling (report or live payload). */
const textOfRow = (row) => (row && (row.answerText ?? row.answer)) || '';

/** A row's ballot number, or null when the row carries none. */
const ballotOfRow = (row) => {
  const n = Number(row && row.ballot);
  return Number.isInteger(n) && n > 0 ? n : null;
};

/**
 * Where one comment goes, given the response rows it is being drawn beside.
 *
 * Returns `{ section, index, ballot }`:
 *   section  'summary' | 'response' | 'round'
 *   index    the row's position in `answers` (response only), else null
 *   ballot   that row's ballot number when it has one, else null
 */
function placeComment(comment, answers) {
  const c = comment || {};
  const rows = Array.isArray(answers) ? answers : [];
  const kind = c.anchorKind ?? c.AnchorKind;
  if (kind === 'summary') return { section: 'summary', index: null, ballot: null };
  if (kind !== 'response') return { section: 'round', index: null, ballot: null };

  const basis = c.anchorBasis ?? c.AnchorBasis;
  const ref = Number(c.anchorRef ?? c.AnchorRef);

  if (basis === 'ballot' && Number.isInteger(ref)) {
    const index = rows.findIndex((row) => ballotOfRow(row) === ref);
    if (index >= 0) return { section: 'response', index, ballot: ref };
    return { section: 'round', index: null, ballot: null };
  }

  // An older row: match the stored quote against each response's words.
  const quote = wordsOf(c.anchorExcerpt ?? c.AnchorExcerpt);
  if (!quote) return { section: 'round', index: null, ballot: null };
  const matches = [];
  rows.forEach((row, i) => {
    const words = wordsOf(textOfRow(row));
    if (words && words.startsWith(quote)) matches.push(i);
  });
  if (!matches.length) return { section: 'round', index: null, ballot: null };
  // Two responses with the same opening words: the stored position breaks the
  // tie when it names one of them, otherwise the first is taken.
  const index = matches.includes(ref) ? ref : matches[0];
  return { section: 'response', index, ballot: ballotOfRow(rows[index]) };
}

module.exports = { placeComment, wordsOf };
