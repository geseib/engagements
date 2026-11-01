/**
 * THE ORDER A CALL & ANSWER ROUND'S RESPONSES ARE RANKED IN — the frontend
 * copy of `lambda-functions/game/response-order.js`, which the report uses.
 *
 *   1. more points first;
 *   2. on equal points, more first-place votes first;
 *   3. on both equal, the order the room voted in (display position).
 *
 * A participant's comment is anchored to a response's POSITION in the list the
 * phone drew, so the phone must order exactly as the report does or "On
 * Response 2" lands beside the wrong response. `responseOrder.test.js` runs
 * tie fixtures through both copies and requires they agree. Change both or
 * neither.
 */
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

export function compareResponses(a, b, placeOf = (row) => row.shownPlace) {
  const score = num(b.totalScore) - num(a.totalScore);
  if (score !== 0) return score;
  const first = num(b.firstPlace) - num(a.firstPlace);
  if (first !== 0) return first;
  return num(placeOf(a)) - num(placeOf(b));
}

/** A new, ranked array. Equal SCORES share a rank (1, 1, 3). */
export function rankResponses(rows, placeOf) {
  const list = (Array.isArray(rows) ? rows : []).slice()
    .sort((a, b) => compareResponses(a, b, placeOf));
  let rank = 1;
  return list.map((row, idx) => {
    if (idx > 0 && num(row.totalScore) !== num(list[idx - 1].totalScore)) rank = idx + 1;
    return { ...row, rank };
  });
}
