/**
 * THE PHONE AND THE REPORT RANK A ROUND'S RESPONSES THE SAME WAY.
 *
 * A participant's comment on a response is anchored to the row's position in
 * the list the phone drew ("On Response 2 — A"). The report used to break a
 * points tie by first-place votes and the phone did not, so on a tie the
 * comment's "Response 2" was a different response in the report.
 *
 * Both copies of the rule run the same fixtures here — the backend's
 * `lambda-functions/game/response-order.js` (what create-report.js sorts with)
 * and the frontend's `config/responseOrder.js` — and the phone's own
 * conversion (`rankedResultsFrom`) is held to the backend's result.
 */
import { compareResponses as feCompare, rankResponses as feRank } from '../config/responseOrder';
import { rankedResultsFrom } from '../PlayerPage';

const be = require('../../../lambda-functions/game/response-order.js');

/** Display position is the array index here, as get-results keys its tallies. */
const FIXTURES = {
  'points tie broken by first-place votes, against display order': [
    { id: 'A', totalScore: 5, firstPlace: 1 },
    { id: 'B', totalScore: 5, firstPlace: 2 },
    { id: 'C', totalScore: 1, firstPlace: 0 },
  ],
  'points and first-place tie, so display order decides': [
    { id: 'A', totalScore: 3, firstPlace: 1 },
    { id: 'B', totalScore: 3, firstPlace: 1 },
  ],
  'a three-way tie on points with mixed first-place votes': [
    { id: 'A', totalScore: 4, firstPlace: 0 },
    { id: 'B', totalScore: 4, firstPlace: 2 },
    { id: 'C', totalScore: 4, firstPlace: 1 },
    { id: 'D', totalScore: 6, firstPlace: 1 },
  ],
  'nobody voted: every row at zero keeps display order': [
    { id: 'A', totalScore: 0, firstPlace: 0 },
    { id: 'B', totalScore: 0, firstPlace: 0 },
    { id: 'C', totalScore: 0, firstPlace: 0 },
  ],
};

const withPlaces = (rows) => rows.map((r, i) => ({ ...r, shownPlace: i }));
const ids = (rows) => rows.map((r) => r.id);
const asTallies = (rows) => Object.fromEntries(rows.map((r, i) => [String(i), {
  answerText: `text ${r.id}`, playerName: r.id, totalScore: r.totalScore, firstPlace: r.firstPlace,
}]));

describe.each(Object.entries(FIXTURES))('%s', (_name, rows) => {
  test('the frontend copy orders and ranks exactly as the backend copy', () => {
    // rejects: the two copies of the rule drifting apart.
    const backend = be.rankResponses(withPlaces(rows));
    const frontend = feRank(withPlaces(rows));
    expect(ids(frontend)).toEqual(ids(backend));
    expect(frontend.map((r) => r.rank)).toEqual(backend.map((r) => r.rank));
    const pairs = withPlaces(rows);
    for (const a of pairs) {
      for (const b of pairs) expect(Math.sign(feCompare(a, b))).toBe(Math.sign(be.compareResponses(a, b)));
    }
  });

  test('the phone\'s feedback panel lists the responses in the report\'s order', () => {
    // rejects: rankedResultsFrom sorting by points alone, which on a points
    // tie fell straight to display order and skipped the first-place tiebreak.
    const report = be.rankResponses(withPlaces(rows));
    const phone = rankedResultsFrom({ voteTallies: asTallies(rows) });
    expect(phone.map((r) => r.playerName)).toEqual(ids(report));
    expect(phone.map((r) => r.rank)).toEqual(report.map((r) => r.rank));
  });
});

test('the case that was wrong: B has more first-place votes, so B is Response 1 on both', () => {
  // rejects: the phone putting A (shown first, fewer first-place votes) at the
  // top while the report put B there.
  const rows = FIXTURES['points tie broken by first-place votes, against display order'];
  const phone = rankedResultsFrom({ voteTallies: asTallies(rows) });
  expect(phone.map((r) => r.playerName)).toEqual(['B', 'A', 'C']);
  // A points tie still SHARES its placement; the tiebreak orders, never splits.
  expect(phone.map((r) => r.rank)).toEqual([1, 1, 3]);
});

test('create-report.js sorts with the shared rule, not a copy of its own', () => {
  // rejects: create-report keeping an inline comparator that could drift from
  // the one the phone mirrors.
  const src = require('fs').readFileSync(
    require('path').join(__dirname, '../../../lambda-functions/game/create-report.js'), 'utf8');
  expect(src).toMatch(/require\('\.\/response-order'\)/);
  expect(src).toMatch(/\.sort\(\(a, b\) => compareResponses\(a, b,/);
});
