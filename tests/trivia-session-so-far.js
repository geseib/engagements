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

console.log('\n3. the race: who leads, and whether that changed this round (raceSoFar)');

const { raceSoFar } = require(path.join(__dirname, '..', 'lambda-functions/game/session-so-far.js'));
const STANDINGS = [{ name: 'Marcus', score: 62 }, { name: 'Priya', score: 58 }, { name: 'Elena', score: 51 }];

check('a player who passes the leader this round "took the lead", with the gap after', () => {
  const r = raceSoFar(STANDINGS, { Marcus: 14 }, { round: 9 });
  assert.strictEqual(r.change, 'took');
  assert.deepStrictEqual(r.leadersBefore, ['Priya']);
  assert.ok(r.block.includes('Marcus leads on 62 points, 4 ahead of Priya on 58.'), r.block);
  assert.ok(r.block.includes('Marcus took the lead this round from Priya.'), r.block);
});

check('a lead that holds says so, with the gap before, and forbids "takes the lead"', () => {
  const r = raceSoFar(STANDINGS, { Marcus: 2, Priya: 10 }, { round: 9 });
  assert.strictEqual(r.change, 'held');
  assert.ok(r.block.includes('already led before this round, by 9'), r.block);
  assert.ok(r.block.includes('the gap shrank'), r.block);
  assert.ok(r.block.includes('Never say Marcus "takes" the lead'), r.block);
});

check('a tie at the top: drew level, and broke a tie', () => {
  const level = raceSoFar([{ name: 'Priya', score: 36 }, { name: 'Elena', score: 36 }, { name: 'Tom', score: 20 }], { Priya: 12, Elena: 11 }, { round: 4 });
  assert.strictEqual(level.change, 'drew-level');
  assert.ok(level.block.includes('Priya and Elena are level at the top on 36 points.'), level.block);
  assert.ok(level.block.includes('Priya drew level at the top this round.'), level.block);
  const broke = raceSoFar([{ name: 'Priya', score: 40 }, { name: 'Elena', score: 30 }], { Priya: 10 }, { round: 5 });
  assert.strictEqual(broke.change, 'broke-tie');
});

check('round 1, nobody scored, or one player: no change claimed / no block', () => {
  assert.strictEqual(raceSoFar(STANDINGS, { Marcus: 62, Priya: 58, Elena: 51 }, { round: 1 }).change, 'first');
  assert.strictEqual(raceSoFar([{ name: 'A', score: 0 }, { name: 'B', score: 0 }], {}, { round: 3 }), null);
  assert.strictEqual(raceSoFar([{ name: 'A', score: 9 }], {}, { round: 3 }), null);
});

check('get-ai-summary hands the race to a trivia read beside the session so far', () => {
  const src = require('fs').readFileSync(path.join(__dirname, '..', 'lambda-functions/game/get-ai-summary.js'), 'utf8');
  assert.ok(/raceSoFar\(leaderboard, roundPointsByName/.test(src), 'raceSoFar is not called with the leaderboard');
  assert.ok(/historyLayer \+= `\\n\\n\$\{race\.block\}`/.test(src), 'the race block does not join the history layer');
});

console.log(`\n${pass} passed, ${fail} failed`);
suiteFinished();
process.exit(fail === 0 ? 0 : 1);
