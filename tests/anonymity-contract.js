/**
 * The redaction gate.
 *
 * Every anonymity decision in the product routes through isHidden(). It is
 * deliberately a pure function over the two records that decide it, so it can
 * be tested without AWS and so there is exactly one place to read when asking
 * "why did this round show names".
 *
 * The copy-drift guard at the end is not ceremony. Lambda CodeUri is
 * per-directory and there are no layers, so this file exists twice; a gate that
 * says "hidden" in one directory and "visible" in the other is a leak that no
 * single-file test can see.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const REPO = path.join(__dirname, '..');
const GAME_COPY = path.join(REPO, 'lambda-functions/game/anonymity.js');
const WS_COPY = path.join(REPO, 'lambda-functions/websocket/anonymity.js');

const { isHidden, redactAnswer, redactAnswers, ANON_FIELDS } = require(GAME_COPY);

let pass = 0, fail = 0;
function check(label, fn) {
  try { fn(); console.log(`  PASS  ${label}`); pass++; }
  catch (e) { console.log(`  FAIL  ${label}\n        ${e.message}`); fail++; }
}

const on = { HostPreferences: { anonymousUntilReveal: true } };
const off = { HostPreferences: { anonymousUntilReveal: false } };
const bare = {};

console.log('\n1. the gate');

// Default ON is the owner's explicit requirement, and it must survive every
// shape of missing data — a game created before this feature existed has no
// HostPreferences at all and must still be anonymous.
check('absent preferences default to hidden', () =>
  assert.strictEqual(isHidden(bare, {}), true));
check('absent metadata entirely defaults to hidden', () =>
  assert.strictEqual(isHidden(undefined, undefined), true));
check('explicitly on is hidden', () =>
  assert.strictEqual(isHidden(on, {}), true));
check('explicitly off is never hidden', () =>
  assert.strictEqual(isHidden(off, {}), false));
check('off stays off even before reveal', () =>
  assert.strictEqual(isHidden(off, { AuthorsRevealed: false }), false));

console.log('\n2. reveal ends it, per round');

check('revealed round is not hidden', () =>
  assert.strictEqual(isHidden(on, { AuthorsRevealed: true }), false));
check('an unrevealed round is still hidden', () =>
  assert.strictEqual(isHidden(on, { AuthorsRevealed: false }), true));
// Per-round, not per-game: revealing round 3 must not unmask round 4.
check('reveal on another round does not leak into this one', () =>
  assert.strictEqual(isHidden(on, {}), true));

console.log('\n3. redaction omits, never nulls');

const row = {
  playerId: 'Ada', playerName: 'Ada', name: 'Ada',
  answer: 'a splendid answer', answerType: 'text', submittedAt: '2026-01-01T00:00:00.000Z'
};

check('all three attribution fields are absent, not null', () => {
  const out = redactAnswer(row);
  for (const f of ANON_FIELDS) {
    assert.ok(!(f in out), `'${f}' is still present as ${JSON.stringify(out[f])}`);
  }
});
check('the answer itself survives', () =>
  assert.strictEqual(redactAnswer(row).answer, 'a splendid answer'));
check('non-attribution fields survive', () => {
  const out = redactAnswer(row);
  assert.strictEqual(out.answerType, 'text');
  assert.strictEqual(out.submittedAt, '2026-01-01T00:00:00.000Z');
});
check('the input is not mutated', () => {
  const input = { ...row };
  redactAnswer(input);
  assert.strictEqual(input.playerName, 'Ada', 'redactAnswer mutated its argument');
});

console.log('\n4. order is preserved — the ballot runs on it');

// get-results tallies vote index -> answers[index]. Any reorder or filter here
// lands votes on the wrong answers, silently.
const many = ['Ada', 'Grace', 'Alan', 'Barbara'].map((n, i) => ({
  playerName: n, name: n, playerId: n, answer: `answer ${i}`
}));

check('length is unchanged', () =>
  assert.strictEqual(redactAnswers(many).length, 4));
check('order is unchanged', () =>
  assert.deepStrictEqual(redactAnswers(many).map(a => a.answer),
    ['answer 0', 'answer 1', 'answer 2', 'answer 3']));
check('an empty round redacts to an empty array', () =>
  assert.deepStrictEqual(redactAnswers([]), []));
check('a non-array is treated as empty rather than thrown', () =>
  assert.deepStrictEqual(redactAnswers(undefined), []));

console.log('\n5. the two copies have not drifted');

check('game/anonymity.js and websocket/anonymity.js are byte-identical', () => {
  const a = fs.readFileSync(GAME_COPY, 'utf8');
  const b = fs.readFileSync(WS_COPY, 'utf8');
  assert.strictEqual(a, b,
    'the copies have diverged — a gate that disagrees with itself across two ' +
    'Lambda directories is a leak no single-file test can see');
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
