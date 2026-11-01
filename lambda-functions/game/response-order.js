/**
 * THE ORDER A CALL & ANSWER ROUND'S RESPONSES ARE RANKED IN — one rule, read
 * by the report and by the participant's feedback panel.
 *
 *   1. more points first;
 *   2. on equal points, more first-place votes first;
 *   3. on both equal, the order the room voted in (answer-order.js's display
 *      position), never the order the rows happen to be stored in.
 *
 * Why it matters beyond looks: a participant's comment on a response is
 * anchored to the row's POSITION in the list the phone drew ("On Response 2 —
 * A"). If the phone and the report break ties differently, the comment sits
 * beside the wrong response when the report is read. The phone used to stop
 * at rule 1 and fall straight to rule 3, while the report applied rule 2.
 *
 * The frontend copy is `src/src/config/responseOrder.js`, and
 * `src/src/__tests__/responseOrder.test.js` runs fixtures with ties through
 * both and requires they agree.
 *
 * `placeOf(row)` gives a row's display position; it defaults to `row.shownPlace`.
 */
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

function compareResponses(a, b, placeOf = (row) => row.shownPlace) {
  const score = num(b.totalScore) - num(a.totalScore);
  if (score !== 0) return score;
  const first = num(b.firstPlace) - num(a.firstPlace);
  if (first !== 0) return first;
  return num(placeOf(a)) - num(placeOf(b));
}

/**
 * A new, ranked array. Equal SCORES share a rank (1, 1, 3) — the first-place
 * tiebreak orders rows but does not split a rank, as the report always did.
 */
function rankResponses(rows, placeOf) {
  const list = (Array.isArray(rows) ? rows : []).slice()
    .sort((a, b) => compareResponses(a, b, placeOf));
  let rank = 1;
  return list.map((row, idx) => {
    if (idx > 0 && num(row.totalScore) !== num(list[idx - 1].totalScore)) rank = idx + 1;
    return { ...row, rank };
  });
}

module.exports = { compareResponses, rankResponses };
