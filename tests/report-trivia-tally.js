/**
 * THE SESSION REPORT COUNTS HOW THE ROOM ANSWERED A TRIVIA QUESTION
 * (lambda-functions/game/trivia-tally.js, create-report.js `triviaTally`).
 *
 * The owner, 2026-10-31: show why the answer is right and how the room
 * answered. The counts must agree with the SCORER: a phone sends the letter it
 * drew, which is not the stored slot when a question skips one, so the tally
 * reads the scorer's own trivia-answer.js. Counts only, never a name.
 *
 * Judge by exit code: node tests/report-trivia-tally.js
 */
const suiteFinished = require('./helpers/finish-guard');
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const GAME = path.join(__dirname, '..', 'lambda-functions', 'game');
const { triviaOptionCounts } = require(path.join(GAME, 'trivia-tally'));
const { mergeRound } = require(path.join(GAME, 'report-merge'));

let failed = 0;
function check(name, fn) {
  try { fn(); console.log(`  ok  ${name}`); } catch (e) { failed += 1; console.log(`  FAIL ${name}\n       ${e.message}`); }
}

const q = { optionA: 'Tokens out', optionB: 'One request', optionC: 'Memory', optionD: 'Training data', correctAnswer: 'OptionB' };
const rows = (letters) => letters.map((Answer, i) => ({ SK: `QUESTION#001#ANSWER#p${i}`, PlayerName: `P${i}`, Answer }));

check('counts each option and marks the right one', () => {
  const t = triviaOptionCounts(q, rows(['B', 'B', 'A', 'C', 'B', 'D']));
  assert.deepStrictEqual(t.options.map((o) => [o.letter, o.count, o.correct]), [['A', 1, false], ['B', 3, true], ['C', 1, false], ['D', 1, false]]);
  assert.strictEqual(t.answered, 6);
  assert.strictEqual(t.correct, 3);
});

check('no names: the tally carries counts and letters only', () => {
  const t = triviaOptionCounts(q, rows(['B', 'A']));
  assert.ok(!JSON.stringify(t).includes('P0'));
  assert.deepStrictEqual(Object.keys(t.options[0]).sort(), ['correct', 'count', 'letter', 'slot']);
});

check('a question that skips a slot counts the DRAWN letter under its slot, as the scorer does', () => {
  // optionB empty: the room sees A, B, C for slots A, C, D. A phone's "B" is slot C.
  const holey = { optionA: 'One', optionC: 'Three', optionD: 'Four', correctAnswer: 'OptionC' };
  const t = triviaOptionCounts(holey, rows(['B', 'B', 'C']));
  assert.deepStrictEqual(t.options.map((o) => [o.slot, o.letter, o.count, o.correct]), [['A', 'A', 0, false], ['C', 'B', 2, true], ['D', 'C', 1, false]]);
  assert.strictEqual(t.correct, 2);
});

check('the right answer stored as the option\'s own text is read too', () => {
  const t = triviaOptionCounts({ ...q, correctAnswer: 'One request' }, rows(['B']));
  assert.strictEqual(t.options.find((o) => o.correct).slot, 'B');
});

check('a blank or unplaceable answer is not counted as a pick', () => {
  const t = triviaOptionCounts(q, rows(['', 'F', 'A']));
  assert.strictEqual(t.answered, 2); // 'F' answered, but no option was drawn for it
  assert.strictEqual(t.options.reduce((n, o) => n + o.count, 0), 1);
});

check('a question with no options gives no tally; nobody answering gives zeros', () => {
  assert.strictEqual(triviaOptionCounts({}, rows(['A'])), null);
  const t = triviaOptionCounts(q, []);
  assert.strictEqual(t.answered, 0);
  assert.ok(t.options.every((o) => o.count === 0));
});

check('a rebuild after the answer rows expired keeps the stored counts', () => {
  const kept = { questionNumber: '001', answers: [{ answerText: 'x' }], triviaTally: { answered: 6, correct: 3, options: [] } };
  const live = { questionNumber: '001', answers: [], triviaTally: { answered: 0, correct: 0, options: [] } };
  assert.strictEqual(mergeRound(live, kept).round.triviaTally.answered, 6);
  const fresh = { ...live, triviaTally: { answered: 7, correct: 4, options: [] } };
  assert.strictEqual(mergeRound(fresh, kept).round.triviaTally.answered, 7);
});

check('create-report files the tally on trivia rounds, from the decrypted rows', () => {
  const src = fs.readFileSync(path.join(GAME, 'create-report.js'), 'utf8');
  assert.match(src, /require\('\.\/trivia-tally'\)/);
  assert.match(src, /GameType === 'trivia' && questionDetails\s*\?\s*\{ triviaTally: triviaOptionCounts\(questionDetails, questionAnswers\) \}/);
  // questionAnswers is filtered from `answers`, the decrypted rows.
  assert.match(src, /const answers = reportOrgId \? await decryptItems\(reportOrgId, 'answer', rawAnswers\) : rawAnswers;/);
  assert.match(src, /const questionAnswers = answers\.filter/);
});

suiteFinished();
if (failed) { console.log(`\n${failed} failed`); process.exit(1); }
console.log('\nall passed');
