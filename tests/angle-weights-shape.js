/**
 * A WORKIE'S OWN ROUND-ANGLE WEIGHTS — normalizeAngleWeights, in both copies
 * of prompt-shape.js.
 *
 * Spec: docs/superpowers/specs/2026-09-24-workie-round-angles-design.md.
 *
 * `angleWeights: { question, race, event, fact }`, each a whole number 0-100.
 * Absent means the house mix. A key left out of an override takes the house
 * weight. Anything else is refused rather than guessed at.
 *
 * rejects: a copy that disagrees with the other; an unknown key, a fraction,
 *          a negative, a number over 100 or a non-object accepted; a partial
 *          override refused; "use the house mix" (null / absent / {})
 *          reported as an error.
 */
const suiteFinished = require('./helpers/finish-guard');
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const REPO = path.join(__dirname, '..');
const GAME = path.join(REPO, 'lambda-functions/game/prompt-shape.js');
const ADMIN = path.join(REPO, 'lambda-functions/admin/shared/prompt-shape.js');

let pass = 0, fail = 0;
const check = (label, fn) => {
  try { fn(); console.log(`  PASS  ${label}`); pass++; }
  catch (e) { console.log(`  FAIL  ${label}\n        ${e.message}`); fail++; }
};

check('the two copies are identical apart from their "(this file)" header lines', () => {
  const strip = (f) => fs.readFileSync(f, 'utf8').split('\n').filter((l) => !/prompt-shape\.js/.test(l)).join('\n');
  assert.strictEqual(strip(GAME), strip(ADMIN));
});

for (const [label, file] of [['game', GAME], ['admin', ADMIN]]) {
  const { normalizeAngleWeights } = require(file);
  console.log(`\n${label}/prompt-shape.js`);
  check('a full override passes through', () =>
    assert.deepStrictEqual(normalizeAngleWeights({ question: 10, race: 60, event: 20, fact: 10 }),
      { ok: true, weights: { question: 10, race: 60, event: 20, fact: 10 } }));
  check('a partial override is accepted as given', () =>
    assert.deepStrictEqual(normalizeAngleWeights({ race: 0 }), { ok: true, weights: { race: 0 } }));
  check('null, undefined and {} mean the house mix', () => {
    for (const v of [null, undefined, {}]) assert.deepStrictEqual(normalizeAngleWeights(v), { ok: true, weights: null });
  });
  check('an unknown key is refused', () => assert.strictEqual(normalizeAngleWeights({ race: 10, drama: 5 }).ok, false));
  check('a fraction, a negative, over 100, or a non-number is refused', () => {
    for (const bad of [1.5, -1, 101, '20', NaN]) {
      assert.strictEqual(normalizeAngleWeights({ race: bad }).ok, false, `accepted ${String(bad)}`);
    }
  });
  check('a non-object is refused', () => {
    for (const bad of [[10, 20], 'race', 5]) assert.strictEqual(normalizeAngleWeights(bad).ok, false, `accepted ${JSON.stringify(bad)}`);
  });
  check('a refusal says why', () => assert.ok(/drama/.test(normalizeAngleWeights({ drama: 5 }).error || '')));
}

console.log(`\n${pass} passed, ${fail} failed`);
suiteFinished();
process.exit(fail ? 1 : 0);
