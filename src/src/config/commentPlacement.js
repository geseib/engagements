/**
 * WHICH THING A COMMENT SITS UNDER — Workie's read, one response, or the round
 * as a whole. The frontend copy of `lambda-functions/game/comment-placement.js`
 * (phone-comments README, backend B1); the reasoning lives there.
 *
 *   - a reply stored with `anchorBasis: 'ballot'` goes under the response with
 *     that ballot number (the 1-based place the room voted under), on every
 *     surface, whatever order the rows are drawn in — so a tie cannot mis-file it;
 *   - an older reply (no basis) is placed by matching its stored quote against
 *     each response's words, and goes under the whole round when nothing
 *     matches, still printing its quote.
 *
 * `commentPlacement.test.js` runs both copies on one set of fixtures and
 * requires they agree. Change both or neither.
 */

/** Words only: case, punctuation, markdown symbols and spacing removed. */
export const wordsOf = (text) => String(text ?? '')
  .toLowerCase()
  .replace(/…$/u, '')
  .replace(/[^\p{L}\p{N}]+/gu, '');

const textOfRow = (row) => (row && (row.answerText ?? row.answer)) || '';

/** A row's ballot number, or null when the row carries none. */
export const ballotOfRow = (row) => {
  const n = Number(row && row.ballot);
  return Number.isInteger(n) && n > 0 ? n : null;
};

/** `{ section: 'summary'|'response'|'round', index, ballot }` for one comment. */
export function placeComment(comment, answers) {
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

  const quote = wordsOf(c.anchorExcerpt ?? c.AnchorExcerpt);
  if (!quote) return { section: 'round', index: null, ballot: null };
  const matches = [];
  rows.forEach((row, i) => {
    const words = wordsOf(textOfRow(row));
    if (words && words.startsWith(quote)) matches.push(i);
  });
  if (!matches.length) return { section: 'round', index: null, ballot: null };
  const index = matches.includes(ref) ? ref : matches[0];
  return { section: 'response', index, ballot: ballotOfRow(rows[index]) };
}

/**
 * Every comment of a round, grouped where it belongs:
 * `{ summary: [], byRow: Map(index -> []), round: [] }`, each list in the
 * order given (writing order).
 */
export function placeComments(comments, answers) {
  const out = { summary: [], byRow: new Map(), round: [] };
  for (const comment of Array.isArray(comments) ? comments : []) {
    if (!comment) continue;
    const at = placeComment(comment, answers);
    if (at.section === 'summary') out.summary.push(comment);
    else if (at.section === 'response') {
      const list = out.byRow.get(at.index) || [];
      list.push(comment);
      out.byRow.set(at.index, list);
    } else out.round.push(comment);
  }
  return out;
}
