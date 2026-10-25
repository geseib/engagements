/**
 * src/src/config/surveyContract.json IS CURRENT WITH THE SURVEY CONTRACT.
 *
 *   node tests/survey-contract-fresh.js
 *
 * The poll and survey authoring prompts (src/src/config/aiAuthoringPrompt.js)
 * read the survey contract from a JSON file that scripts/build-survey-contract.js
 * writes from lambda-functions/admin/shared/survey-kinds.js, because the frontend
 * cannot import outside src/. A contract change that is not rebuilt would have
 * the prompt teach somebody else's AI columns or limits the importer no longer
 * accepts — and the importer then skips the rows. This fails until it is rebuilt.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const REPO = path.join(__dirname, '..');
const builder = require(path.join(REPO, 'scripts', 'build-survey-contract.js'));
const K = require(path.join(REPO, 'lambda-functions', 'admin', 'shared', 'survey-kinds.js'));

let failed = 0;
function check(name, fn) {
  try { fn(); process.stdout.write(`  PASS  ${name}\n`); } catch (e) { failed += 1; process.stdout.write(`  FAIL  ${name}\n        ${e.message}\n`); }
}

const committed = fs.readFileSync(builder.OUT, 'utf8');

check('is current with survey-kinds.js (run node scripts/build-survey-contract.js if not)', () => {
  assert.strictEqual(committed, builder.render());
});

const c = JSON.parse(committed);

check('the header is the importer\'s survey header plus Tags', () => {
  assert.strictEqual(c.header, `${K.SURVEY_CSV_HEADER},Tags`);
});

check('every kind lists Kind and Required first, and only columns of the contract', () => {
  for (const kind of K.KINDS) {
    assert.deepStrictEqual(c.columnsByKind[kind].slice(0, 2), ['Kind', 'Required'], kind);
    for (const col of c.columnsByKind[kind]) assert.ok(K.SURVEY_CSV_COLUMNS.includes(col), `${kind}: ${col}`);
  }
});

check('the measured limits are what validateSurvey enforces at their edges', () => {
  const read = (cells) => K.surveyFieldsFromCells((col) => cells[col] ?? '');
  const opts = (n) => Array.from({ length: n }, (_, i) => `o${i}`).join('|');
  const { choiceOptions, rankItems, maxLength } = c.limits;
  assert.deepStrictEqual(K.validateSurvey(read({ Kind: 'choice', Options: opts(choiceOptions.min) })), []);
  assert.notDeepStrictEqual(K.validateSurvey(read({ Kind: 'choice', Options: opts(choiceOptions.max + 1) })), []);
  assert.deepStrictEqual(K.validateSurvey(read({ Kind: 'rank', Options: opts(rankItems.max) })), []);
  assert.notDeepStrictEqual(K.validateSurvey(read({ Kind: 'rank', Options: opts(rankItems.min - 1) })), []);
  assert.deepStrictEqual(K.validateSurvey(read({ Kind: 'text', MaxLength: String(maxLength.max) })), []);
  assert.notDeepStrictEqual(K.validateSurvey(read({ Kind: 'text', MaxLength: String(maxLength.min - 1) })), []);
});

process.stdout.write(failed ? `\n${failed} failed\n` : '\nall passed\n');
process.exit(failed ? 1 : 0);
