/**
 * THE SESSION SO FAR, AND THE CLAIM IT EXISTS TO CHECK — session 8741.
 *
 * Dev, 2026-11-07, trivia, 4 players. Round 14's read: "Ges, Charlie, Katydid
 * and Amanda Andrews all answered correctly, so it was a clean sweep, and the
 * first time the four of them agreed on something this session." All four had
 * been right in rounds 1, 2, 3, 6, 11, 12 and 13. The prompt carried round
 * 14's "4 of 4" and the running totals, and no earlier round.
 *
 * rejects: the block missing an earlier round, recounting this one from the
 * stored rows instead of the prompt's own tally, calling round 14 the first
 * everyone-right round, a run that skips an unanswered round, a block on
 * round 1; and in read-check.js, the round-14 sentence passing (with no
 * history, or with history that contradicts it), a true "first time" or a
 * real run being flagged, or "the first time they watched Platoon" being
 * read as a claim about the session.
 */
const suiteFinished = require('./helpers/finish-guard');
const path = require('path');
const assert = require('assert');

const { sessionSoFar } = require(path.join(__dirname, '..', 'lambda-functions/game/session-so-far.js'));
const { checkRead, revisionNote } = require(path.join(__dirname, '..', 'lambda-functions/game/read-check.js'));

let pass = 0; let fail = 0;
function check(label, fn) {
  try { fn(); pass += 1; console.log(`  PASS  ${label}`); } catch (e) { fail += 1; console.log(`  FAIL  ${label}\n        ${e.message}`); }
}

// Session 8741's correctness, rounds 1-13, as stored (IsCorrect per player).
const PLAYERS = ['Amanda', 'Charlie', 'Ges', 'Katydid'];
const RIGHT = {
  1: 'YYYY', 2: 'YYYY', 3: 'YYYY', 4: 'NNYN', 5: 'YNNN', 6: 'YYYY', 7: 'NYYY',
  8: 'NYNN', 9: 'NNYY', 10: 'NYYN', 11: 'YYYY', 12: 'YYYY', 13: 'YYYY',
};
const rows = [];
for (const [round, marks] of Object.entries(RIGHT)) {
  PLAYERS.forEach((p, i) => rows.push({ SK: `QUESTION#${String(round).padStart(3, '0')}#ANSWER#${p}`, IsCorrect: marks[i] === 'Y' }));
}
// Rows that are not answers, and a stray later round, are ignored.
rows.push({ SK: 'QUESTION#013#AISummary' }, { SK: 'QUESTION#014#RESULTS' }, { SK: 'QUESTION#015#ANSWER#Ges', IsCorrect: false });

const ROUND14 = 'Everyone in the room got this one: **Pool**. Ges, Charlie, Katydid and Amanda Andrews all answered correctly, '
  + 'so it was a clean sweep, and the first time the four of them agreed on something this session. Ges takes the lead at 160 points.';

console.log('\n1. the block states what actually happened');

const h14 = sessionSoFar(rows, { round: 14, correct: 4, answered: 4 });

check('every earlier round is listed, with this round from the prompt\'s tally', () => {
  assert.strictEqual(h14.rounds.length, 14);
  assert.deepStrictEqual(h14.rounds[3], { round: 4, correct: 1, answered: 4 });
  assert.deepStrictEqual(h14.rounds[13], { round: 14, correct: 4, answered: 4 });
  assert.ok(h14.block.includes('round 1 4 of 4; round 2 4 of 4'), h14.block);
});

check('round 14 is the eighth everyone-right round, and the block says it is not the first', () => {
  assert.deepStrictEqual(h14.allRight, [1, 2, 3, 6, 11, 12, 13, 14]);
  assert.strictEqual(h14.priorAllRight, 7);
  assert.ok(h14.block.includes('in 8 of 14 rounds so far (rounds 1, 2, 3, 6, 11, 12, 13, 14)'), h14.block);
  assert.ok(h14.block.includes('This is NOT the first round everyone got right: 7 earlier rounds'), h14.block);
});

check('the run is 11-14, four in a row', () => {
  assert.strictEqual(h14.streak, 4);
  assert.ok(h14.block.includes('4 rounds in a row'), h14.block);
});

check('a round that broke the run has no streak line and no "first" line', () => {
  const h = sessionSoFar(rows, { round: 14, correct: 2, answered: 4 });
  assert.strictEqual(h.streak, 0);
  assert.ok(!/in a row,/.test(h.block) && !/first round/.test(h.block), h.block);
});

check('a gap (an unanswered round) ends a run', () => {
  const r = [1, 2, 4].flatMap((n) => PLAYERS.map((p) => ({ SK: `QUESTION#00${n}#ANSWER#${p}`, IsCorrect: true })));
  assert.strictEqual(sessionSoFar(r, { round: 5, correct: 4, answered: 4 }).streak, 2);
});

check('the first everyone-right round is called the first', () => {
  const h = sessionSoFar(rows.filter((x) => /QUESTION#00[45]#/.test(x.SK)), { round: 6, correct: 4, answered: 4 });
  assert.strictEqual(h.priorAllRight, 0);
  assert.ok(h.block.includes('This is the first round of the session where everyone was right.'), h.block);
});

check('round 1 has no "so far"', () => {
  assert.strictEqual(sessionSoFar(rows, { round: 1, correct: 4, answered: 4 }), null);
});

console.log('\n2. the read check holds a history claim to it');

const MATERIAL = ['4 of 4 players correct (100%)', 'Ges: 160 pts', h14.block];
const VOTE = { points: [13, 13, 10, 10], answered: 4, round: 14, unanimous: true };
const kinds = (read, history) => checkRead({ read, material: MATERIAL, vote: { ...VOTE, history } }).issues
  .filter((i) => i.kind === 'history');

check('session 8741 round 14: "the first time the four of them agreed … this session" is flagged against the real history', () => {
  const issues = kinds(ROUND14, { priorAllRight: 7, streak: 4 });
  assert.strictEqual(issues.length, 1, JSON.stringify(issues));
  assert.strictEqual(issues[0].token, 'the first time');
  assert.ok(revisionNote(issues).includes('claims something about earlier rounds'), revisionNote(issues));
});

check('with no history handed over at all, the same claim is flagged', () => {
  assert.strictEqual(kinds(ROUND14, null).length, 1);
});

check('a true "first time" (no earlier everyone-right round) passes', () => {
  assert.strictEqual(kinds('All four got it, the first time the whole room agreed this session.', { priorAllRight: 0, streak: 1 }).length, 0);
});

check('"four in a row" passes on a real run, fails without one', () => {
  const read = 'All four right again, four rounds in a row for the whole room.';
  assert.strictEqual(kinds(read, { priorAllRight: 7, streak: 4 }).length, 0);
  assert.strictEqual(kinds(read, { priorAllRight: 7, streak: 1 }).length, 1);
  assert.strictEqual(kinds(read, null).length, 1);
});

check('a discussion question about watching a film is not a claim about the session', () => {
  const read = '## Discussion Questions\n1. Who remembers the first time they watched Platoon, and did they know Stone had served?';
  assert.strictEqual(kinds(read, null).length, 0);
});

console.log(`\n${pass} passed, ${fail} failed`);
suiteFinished();
process.exit(fail === 0 ? 0 : 1);
