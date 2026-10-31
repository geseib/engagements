/**
 * The opening move must not out-rank a Judge prompt — review #48, finding 2.
 *
 * Test session 4567, Ready or Not with the Verdict Board: four answers that
 * all said the wiki diagram falls short ("Not shown." / "Not yet." / "Does not
 * meet the bar." / "Not yet.") were read back as 3 + 1 "No verdict", with
 * "the disagreement is about whether the bar covers the offline path at all"
 * — a split nobody stated.
 *
 * Most of that is the stored prompt's own counting scheme (see the issue
 * write-up). What is the engine's: the per-round OPENING MOVE
 * (personas.js OPENING_MOVES) rides inside the FORMAT block, which
 * "supersedes any formatting instruction that appeared earlier", so
 *   - a drawn "Open by naming the tension: where two responses pulled in
 *     opposite directions" demanded a split on every round, the exact failure
 *     the session-advisor's conditionalAddition was made for (game 6497);
 *   - "Open with a short, punchy verdict on the round" asked a Judge round's
 *     reader for a ruling of its own, which the prompt forbids;
 *   - any drawn move competed with the Verdict Board's own required first
 *     line, "Open with the bold count line".
 */
const suiteFinished = require('./helpers/finish-guard');
const path = require('path');
const fs = require('fs');
const assert = require('assert');

const REPO = path.join(__dirname, '..');
const personas = require(path.join(REPO, 'lambda-functions', 'game', 'personas.js'));
const { OPENING_MOVES, buildOutputContract, promptOwnsOpening } = personas;
const verdictBoard = require(path.join(REPO, 'demo-sets', 'ready-or-not.prompt.json'));
const transferReader = require(path.join(REPO, 'demo-sets', 'lessons-from-different-schools.prompt.json'));

let pass = 0, fail = 0;
function check(label, fn) {
  try { fn(); console.log(`  PASS  ${label}`); pass++; }
  catch (e) { console.log(`  FAIL  ${label}\n        ${e.message}`); fail++; }
}

const OPENING = 'THE OPENING, for this round only:';

console.log('\nthe deck never demands a split or a ruling\n');

// rejects: restoring the unconditional tension move.
check('a move about a tension or split is conditional and forbids inventing one', () => {
  const splitMoves = OPENING_MOVES.filter((m) => /tension|opposite|split|disagree/i.test(m));
  assert(splitMoves.length > 0, 'the tension move is gone entirely; this test should be revisited, not deleted');
  for (const m of splitMoves) {
    assert(/only if/i.test(m), `demands a split unconditionally: ${m}`);
    assert(/never invent/i.test(m), `does not forbid an invented split: ${m}`);
  }
});

// rejects: "a short, punchy verdict on the round" — on a Judge round the
// reader is told it is not the deciding vote.
check('no move asks Workie for a verdict of its own', () => {
  const bad = OPENING_MOVES.filter((m) => /\bverdict\b/i.test(m));
  assert.deepStrictEqual(bad, []);
});

check('every move is still an instruction to open (persona-controls.js holds the deck size)', () => {
  for (const m of OPENING_MOVES) assert(/^Open/.test(m), m);
});

console.log('\na prompt that names its own first line keeps it\n');

// rejects: a drawn move riding over "Open with the bold count line".
check('the Verdict Board owns its opening', () => assert.strictEqual(promptOwnsOpening(verdictBoard), true));

check('no drawn move reaches the Verdict Board contract, whichever is drawn', () => {
  for (const move of OPENING_MOVES) {
    const contract = buildOutputContract(verdictBoard, { openingMove: move });
    assert(!contract.includes(OPENING), `move leaked into the contract: ${move}`);
    assert(!contract.includes(move), `move text leaked: ${move}`);
    assert(contract.includes('## The verdict\nOpen with the bold count line'),
      'the prompt\'s own first line must still be in the contract');
  }
});

// rejects: dropping the move for everyone (the "We asked one question" groove
// the moves exist to break is a real failure on prompts that say nothing).
check('a prompt with no declared shape still gets its move', () => {
  assert.strictEqual(promptOwnsOpening({}), false);
  const c = buildOutputContract({}, { openingMove: OPENING_MOVES[0] });
  assert(c.includes(OPENING) && c.includes(OPENING_MOVES[0]));
});

check('a declared shape whose first section does not say how to open still gets its move', () => {
  assert.strictEqual(promptOwnsOpening(transferReader), false);
  const c = buildOutputContract(transferReader, { openingMove: OPENING_MOVES[1] });
  assert(c.includes(OPENING) && c.includes(OPENING_MOVES[1]));
});

check('a malformed declaration falls back to the default triad and keeps the move', () => {
  const broken = { outputSections: [{ heading: 'One\n## Two', guidance: 'Open with x' }] };
  assert.strictEqual(promptOwnsOpening(broken), false);
  assert(buildOutputContract(broken, { openingMove: OPENING_MOVES[2] }).includes(OPENING));
});

console.log('\nthe worker hands the prompt record to the contract\n');

// rejects: a call site that passes only the move, which would bypass the
// prompt-owns-its-opening rule above.
check('both contract builds in get-ai-summary.js pass the prompt record', () => {
  const src = fs.readFileSync(path.join(REPO, 'lambda-functions', 'game', 'get-ai-summary.js'), 'utf8');
  // `buildOutputContract()` with nothing inside is a comment's mention, not a call.
  const calls = (src.match(/buildOutputContract\([^)]*\)/g) || []).filter((c) => c !== 'buildOutputContract()');
  assert(calls.length >= 2, `expected the prompt and the read-check builds, found ${calls.length}`);
  for (const c of calls) assert(/^buildOutputContract\(promptData,/.test(c), c);
});

suiteFinished();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
