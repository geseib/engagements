/**
 * A SESSION'S GOAL — lambda-functions/websocket/session-goal.js and its
 * byte-identical copy in lambda-functions/game/ (events M1b).
 *
 * The owner, 26 Sep 2026: "even though the set contains 50 question they
 * might have a goal of 5 questions. And we could alert the host/facilitator
 * they have completed, but they could do extra if time permitted".
 *
 * rejects: a goal of 0, a fraction, a word or more than the set holds
 * accepted; a blank goal refused (blank is "no goal"); a survey offered a
 * goal; the size read from the active version for a session pinned to an
 * older one; the notice shown before the goal's own results, after the room
 * moved on past it, or with no goal at all; progress shown in the lobby or
 * after the end; the two copies drifting; a module the browser cannot import.
 */
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const REPO = path.join(__dirname, '..');
const FILE = path.join(REPO, 'lambda-functions/websocket/session-goal.js');
const G = require(FILE);

let pass = 0; let fail = 0;
function check(label, fn) {
  try { fn(); console.log(`  ok - ${label}`); pass += 1; }
  catch (e) { console.log(`  FAIL - ${label}\n    ${e.message}`); fail += 1; }
}

console.log('\n1. what a goal may be');
check('blank, null and undefined mean no goal', () => {
  for (const v of ['', null, undefined]) assert.deepStrictEqual(G.checkTarget(v, 50), { value: null });
});
check('a whole number up to the set\'s size is the goal', () => {
  assert.deepStrictEqual(G.checkTarget(5, 50), { value: 5 });
  assert.deepStrictEqual(G.checkTarget(50, 50), { value: 50 });
  assert.deepStrictEqual(G.checkTarget('7', 50), { value: 7 });
});
for (const bad of [0, -1, 2.5, 'five', '5.5', true, [], {}]) {
  check(`${JSON.stringify(bad)} is refused in plain words`, () =>
    assert.strictEqual(G.checkTarget(bad, 0).error, 'A goal is a whole number of questions, 1 or more.'));
}
check('more than the set holds is refused, naming the size', () =>
  assert.strictEqual(G.checkTarget(51, 50).error, 'This set has 50 questions, so the goal can be 50 at most.'));
check('one question reads as one question', () =>
  assert.strictEqual(G.checkTarget(2, 1).error, 'This set has 1 question, so the goal can be 1 at most.'));
check('an unknown size bounds the goal by the ceiling alone', () => {
  assert.deepStrictEqual(G.checkTarget(999, 0), { value: 999 });
  assert.deepStrictEqual(G.checkTarget(12, undefined), { value: 12 });
});
// final review Minor 2: 1000 is a whole number — the likely typo is one zero
// too many — so it must never fall into the whole-number sentence above.
check('1000 is refused by its own ceiling sentence, not the whole-number one', () =>
  assert.strictEqual(G.checkTarget(1000, 0).error, 'A goal can be at most 999 questions.'));
check('the ceiling itself, 999, is fine when the size is unknown', () =>
  assert.deepStrictEqual(G.checkTarget(999, 0), { value: 999 }));
check('a known set size is checked before the ceiling, and speaks first', () =>
  assert.strictEqual(G.checkTarget(2000, 50).error, 'This set has 50 questions, so the goal can be 50 at most.'));
check('surrounding space is trimmed', () => assert.deepStrictEqual(G.checkTarget(' 5 ', 50), { value: 5 }));
check('NaN is refused in plain words', () =>
  assert.strictEqual(G.checkTarget(NaN, 50).error, 'A goal is a whole number of questions, 1 or more.'));
check('Infinity is refused in plain words', () =>
  assert.strictEqual(G.checkTarget(Infinity, 50).error, 'A goal is a whole number of questions, 1 or more.'));
check('a survey has no goal; every round-based format does', () => {
  assert.strictEqual(G.goalApplies('survey'), false);
  assert.strictEqual(G.goalApplies(' Survey '), false);
  for (const t of ['trivia', 'call-and-answer', 'poll', 'wavelength', undefined]) {
    assert.strictEqual(G.goalApplies(t), true, String(t));
  }
});

console.log('\n2. how many questions a set has at a version');
const SET = {
  questionCount: 12, activeVersion: 3,
  versions: [{ version: 1, questionCount: 8 }, { version: 2 }, { version: 3, questionCount: 12 }],
};
check('a recorded version gives its own count', () => assert.strictEqual(G.questionCountAt(SET, 1), 8));
check('the active version, and no version at all, give the set\'s count', () => {
  assert.strictEqual(G.questionCountAt(SET, 3), 12);
  assert.strictEqual(G.questionCountAt(SET, null), 12);
});
check('a pin missing from versions[] plays the active version at run time (resolvePartitionFromMeta\'s pinned-missing fallback), so the bound follows it', () =>
  assert.strictEqual(G.questionCountAt(SET, 5), 12));
check('an entry that exists but records no count of its own is unknown, not the active version\'s', () =>
  assert.strictEqual(G.questionCountAt(SET, 2), null));
check('no set is size 0 (unknown)', () => assert.strictEqual(G.questionCountAt(null, 1), 0));

console.log('\n3. where a running session stands');
check('goalReachedLine reads the notice for a given goal', () =>
  assert.strictEqual(G.goalReachedLine(5), 'That’s your 5. Keep going if there’s time, or end the session.'));
const NONE = { progress: '', reached: false, line: '' };
check('no goal: nothing to say', () =>
  assert.deepStrictEqual(G.goalProgress({ target: null, round: 3, phase: 'ASK' }), NONE));
check('before the first round and after the end: nothing', () => {
  assert.deepStrictEqual(G.goalProgress({ target: 5, round: 0, phase: 'LOBBY' }), NONE);
  assert.deepStrictEqual(G.goalProgress({ target: 5, round: 5, phase: 'ENDED' }), NONE);
});
check('mid-way: "Question 3 of 5", not reached', () =>
  assert.deepStrictEqual(G.goalProgress({ target: 5, round: 3, phase: 'VOTE' }),
    { progress: 'Question 3 of 5', reached: false, line: '' }));
check('the goal\'s own round, still answering: not reached yet', () =>
  assert.deepStrictEqual(G.goalProgress({ target: 5, round: 5, phase: 'ASK' }),
    { progress: 'Question 5 of 5', reached: false, line: '' }));
for (const phase of ['RESULTS', 'FIELD_NOTES', 'FEEDBACK', 'results']) {
  check(`the goal's own round on ${phase}: reached, with the notice`, () =>
    assert.deepStrictEqual(G.goalProgress({ target: 5, round: 5, phase }), {
      progress: 'Question 5 of 5',
      reached: true,
      line: 'That’s your 5. Keep going if there’s time, or end the session.',
    }));
}
check('kept going: progress says so, and the notice has done its job', () =>
  assert.deepStrictEqual(G.goalProgress({ target: 5, round: 6, phase: 'RESULTS' }),
    { progress: 'Question 6 · your goal was 5', reached: false, line: '' }));

console.log('\n4. one file, two bundles, and the browser');
check('the game/ copy is byte-identical to the websocket/ copy', () => {
  const read = (rel) => fs.readFileSync(path.join(REPO, rel), 'utf8');
  assert.strictEqual(read('lambda-functions/game/session-goal.js'), read('lambda-functions/websocket/session-goal.js'));
});
check('no require and no process in the code (comments aside)', () => {
  const code = fs.readFileSync(FILE, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  assert.ok(!/\brequire\s*\(/.test(code), 'it requires something');
  assert.ok(!/\bprocess\./.test(code), 'it reads process');
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
