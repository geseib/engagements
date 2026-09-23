/**
 * THE NAMES VALUES AND THE SURVEY STATES AGREE ACROSS THE TWO TIERS.
 *
 * src/src/config/surveyNames.js (ESM, the browser) and
 * lambda-functions/game/survey-names.js (CommonJS, the server) each carry the
 * three Names ids and the default; the server also names the two survey
 * states. The browser file is read as TEXT (it is ESM), the way
 * tests/feedback-round-beat.js reads its frontend twin.
 * docs/design/survey-redesign/IMPLEMENTATION-phase-2.md, Step 0.
 */
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const REPO = path.join(__dirname, '..');
const server = require(path.join(REPO, 'lambda-functions/game/survey-names.js'));
const browserText = fs.readFileSync(path.join(REPO, 'src/src/config/surveyNames.js'), 'utf8');

let pass = 0; let fail = 0;
function check(label, fn) {
  try { fn(); console.log(`  PASS  ${label}`); pass++; } catch (e) { console.log(`  FAIL  ${label}\n        ${e.message}`); fail++; }
}

check('the server knows the three ids, in order', () =>
  assert.deepStrictEqual(server.NAMES, ['anonymous', 'finished', 'named']));
check('the default is anonymous on both sides', () => {
  assert.strictEqual(server.NAMES_DEFAULT, 'anonymous');
  assert.ok(/export const NAMES_DEFAULT = 'anonymous'/.test(browserText), 'browser default differs');
});
check('the browser lists the same three ids, in the same order', () => {
  const ids = [...browserText.matchAll(/\bid: '([a-z]+)'/g)].map((m) => m[1]);
  assert.deepStrictEqual(ids, server.NAMES);
});
check('normalizeNames folds case and falls back to the default', () => {
  assert.strictEqual(server.normalizeNames('Named'), 'named');
  assert.strictEqual(server.normalizeNames(' finished '), 'finished');
  assert.strictEqual(server.normalizeNames('everyone'), 'anonymous');
  assert.strictEqual(server.normalizeNames(undefined), 'anonymous');
});
check('the two survey states carry no digits after #, so every round parser treats them as inert', () => {
  assert.strictEqual(server.SURVEY_OPEN, 'SURVEY#OPEN');
  assert.strictEqual(server.SURVEY_CLOSED, 'SURVEY#CLOSED');
  for (const s of [server.SURVEY_OPEN, server.SURVEY_CLOSED]) assert.ok(!/#\d/.test(s), s);
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
