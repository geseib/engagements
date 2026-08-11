/**
 * consensusLevel regression tests — lambda-functions/game/consensus.js
 *
 * `{consensusLevel}` is interpolated into the LIVE model prompt, so whatever it
 * says the model reports as an observation and the host reads aloud. The value
 * it replaces was a tautology:
 *
 *     winners[0].score > results.maxScore * 0.8
 *
 * with winners built as exactly the answers scoring maxScore, so it reduced to
 * `maxScore > 0.8 * maxScore` — true for every round with any vote at all.
 *
 * The first test below is the one that matters: a room that split three ways
 * must not be described as strongly agreed.
 */
const path = require('path');
const assert = require('assert');

const { consensusLabel } = require(path.join(__dirname, '..', 'lambda-functions', 'game', 'consensus'));

const say = (s) => process.stdout.write(`${s}\n`);
let pass = 0, fail = 0;
function check(label, fn) {
  try { fn(); say(`  PASS  ${label}`); pass++; }
  catch (e) { say(`  FAIL  ${label}\n        ${e.message}`); fail++; }
}

// sortedAnswers is Object.entries(voteTallies) sorted score-descending, so each
// entry is [index, { totalScore }] — the shape get-ai-summary.js:1282 produces.
const answers = (...scores) => scores.map((totalScore, i) => [String(i), { totalScore }]);
const round = (scores, extra = {}) => ({
  gameType: 'call-and-answer',
  sortedAnswers: answers(...scores),
  maxScore: scores.length ? Math.max(...scores) : 0,
  ...extra,
});

say('consensusLevel: measured against the runner-up, not against itself\n');

// ---- THE REGRESSION ---------------------------------------------------------
// rejects: any return to comparing the top score with itself (maxScore * k,
//          winners[0].score, or any expression whose two sides are equal).
check('a room that split 4/3/3 is NOT strong consensus', () =>
  assert.strictEqual(consensusLabel(round([4, 3, 3])), 'Mixed opinions'));

check('a near-tie 5/4 is NOT strong consensus', () =>
  assert.strictEqual(consensusLabel(round([5, 4])), 'Mixed opinions'));

check('the old tautology is dead: a single top answer is not automatically strong', () => {
  // Under the old rule EVERY one of these returned 'Strong consensus', because
  // each has exactly one top scorer and a positive maxScore.
  const split = [[4, 3, 3], [5, 4], [7, 6, 5], [2, 1, 1, 1]];
  const wrong = split
    .map((s) => [s, consensusLabel(round(s))])
    .filter(([, label]) => label === 'Strong consensus');
  assert.strictEqual(wrong.length, 0,
    `these splits still read as strong consensus: ${JSON.stringify(wrong)}`);
});

// ---- The scale still distinguishes real agreement ---------------------------
// rejects: collapsing everything to 'Mixed opinions', which would be safe and
//          useless — the label would stop carrying information.
check('a runaway winner IS strong consensus', () =>
  assert.strictEqual(consensusLabel(round([9, 2, 1])), 'Strong consensus'));

check('exactly 3x the runner-up is strong', () =>
  assert.strictEqual(consensusLabel(round([6, 2])), 'Strong consensus'));

check('exactly 2x the runner-up is moderate', () =>
  assert.strictEqual(consensusLabel(round([6, 3])), 'Moderate consensus'));

check('just under 2x is mixed', () =>
  assert.strictEqual(consensusLabel(round([5, 3])), 'Mixed opinions'));

check('the top answer taking every point is strong', () =>
  assert.strictEqual(consensusLabel(round([8, 0, 0])), 'Strong consensus'));

// ---- Degenerate rounds must say what they are ------------------------------
// rejects: reporting a ranking on a round nobody voted in. voteTallies is
//          initialised with a row per answer at totalScore 0, so {voteTally}
//          renders a full ranked list at zero points even here — the label is
//          the only thing that stops that reading as a result.
check('nobody voted is stated, not scored', () => {
  const label = consensusLabel(round([0, 0, 0]));
  assert(/no votes cast/i.test(label), label);
});

check('a tie at the top is not consensus', () =>
  assert.strictEqual(consensusLabel(round([4, 4, 1])), 'Mixed opinions'));

// rejects: calling one response unanimous. One answer is an absence of
//          alternatives, not agreement.
check('a single response says so rather than claiming agreement', () => {
  const label = consensusLabel(round([5]));
  assert(/only one response/i.test(label), label);
  assert(!/consensus/i.test(label), `claimed consensus on one answer: ${label}`);
});

check('no answers at all does not throw', () =>
  assert(typeof consensusLabel(round([])) === 'string'));

check('a missing argument object does not throw', () =>
  assert(typeof consensusLabel() === 'string'));

// ---- Game types that do not vote -------------------------------------------
// rejects: running the vote arithmetic on a game type that has no votes.
check('trivia is excluded by name', () =>
  // gameType AFTER the spread: round() defaults it to call-and-answer.
  assert(/no consensus voting/i.test(
    consensusLabel({ ...round([9, 1]), gameType: 'trivia' }))));

check('wavelength reports its own measure', () =>
  assert(/word connection rate/i.test(
    consensusLabel({ gameType: 'wavelength', connectionScore: 42, sortedAnswers: [], maxScore: 0 }))));

// ---- The call site actually uses it ----------------------------------------
// rejects: leaving the old inline expression in place beside the new module.
check('get-ai-summary.js calls the module and no longer compares maxScore to itself', () => {
  const fs = require('fs');
  const src = fs.readFileSync(
    path.join(__dirname, '..', 'lambda-functions', 'game', 'get-ai-summary.js'), 'utf8')
    .split('\n')
    .filter((l) => !l.trim().startsWith('*') && !l.trim().startsWith('//'))
    .join('\n');
  assert(/consensusLabel\(/.test(src), 'get-ai-summary.js does not call consensusLabel');
  assert(!/winners\[0\]\.score\s*>\s*\(?\s*results\.maxScore/.test(src),
    'the original tautology is still present in get-ai-summary.js');
});

say(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
