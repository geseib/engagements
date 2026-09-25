/**
 * A QUESTION'S BACKGROUND — stored like the Reveal, never served like the question.
 * Spec: docs/superpowers/specs/2026-09-25-question-background-design.md §1.
 * rejects: an unclamped or mid-word-cut Background; a Background left in the clear on an
 *          org set or missing from the published surface; a Background reaching any
 *          player or live payload (get-question, get-game-state, next-question, websocket).
 */
const suiteFinished = require('./helpers/finish-guard');
// Required here, before section 2 requires any tenant-crypto.js copy: this
// helper registers the KMS stub in require.cache at require-time, and
// createGame (used by section 3) encrypts the session under the org's data
// key. Loading a tenant-crypto copy first risks the org index write reaching
// the real AWS SDK instead of the stub — see the helper's own header.
require('./helpers/question-background-live-check');
const path = require('path');
const assert = require('assert');
const REPO = path.join(__dirname, '..');

const say = (...a) => process.stdout.write(a.join(' ') + '\n');
let pass = 0, fail = 0;
async function check(label, fn) {
  try { await fn(); say(`  PASS  ${label}`); pass++; }
  catch (e) { say(`  FAIL  ${label}\n        ${e.message}`); fail++; }
}

(async () => {
  say('\n1. clampBackground');
  const { BACKGROUND_MAX, clampBackground, BACKGROUND_TRUTH_RULE } =
    require(path.join(REPO, 'lambda-functions/admin/shared/question-background.js'));
  await check('the limit is 600', () => assert.strictEqual(BACKGROUND_MAX, 600));
  await check('short text is only trimmed', () =>
    assert.strictEqual(clampBackground('  Git records every change.  '), 'Git records every change.'));
  await check('a line break inside is kept', () =>
    assert.strictEqual(clampBackground('One.\nTwo.'), 'One.\nTwo.'));
  await check('non-strings become empty', () => {
    for (const v of [undefined, null, 42, {}, []]) assert.strictEqual(clampBackground(v), '');
  });
  await check('over the limit it cuts at the last sentence end that fits', () => {
    const s = 'A'.repeat(300) + '. ' + 'B'.repeat(250) + '. ' + 'C'.repeat(200) + '.';
    const out = clampBackground(s);
    assert.ok(out.length <= 600, `length ${out.length}`);
    assert.ok(out.endsWith('B'.repeat(250) + '.'), `cut in the wrong place: …${out.slice(-20)}`);
  });
  await check('with no sentence end it cuts at a word, never mid-word', () => {
    const s = Array.from({ length: 200 }, (_, i) => `word${i}`).join(' ');
    const out = clampBackground(s);
    assert.ok(out.length <= 600);
    assert.ok(s.startsWith(out) && (s[out.length] === ' '), `cut mid-word: …${out.slice(-12)}`);
  });
  await check('the truth rule is the spec\'s text', () => assert.strictEqual(BACKGROUND_TRUTH_RULE,
    'Write only what you are certain is true. No statistics, dates, names or quotations unless they are '
    + 'widely established and you are sure of them. Nothing about the audience\'s organisation, people or '
    + 'events. When you are not certain of a fact, give an angle or a question instead.'));

  say('\n2. stored like the Reveal');
  for (const pkg of ['admin/shared', 'game', 'websocket']) {
    await check(`${pkg}/tenant-crypto.js encrypts Background on a question row`, () => {
      const { ENCRYPTED_FIELDS } = require(path.join(REPO, 'lambda-functions', pkg, 'tenant-crypto.js'));
      assert.ok(ENCRYPTED_FIELDS.question.includes('Background'));
    });
  }
  await check('Background is on the published surface (checked, hashed, copied)', () => {
    const { QUESTION_FIELDS, questionText } = require(path.join(REPO, 'lambda-functions/admin/shared/publishable.js'));
    assert.ok(QUESTION_FIELDS.includes('Background'));
    assert.ok(questionText({ Title: 't', Background: 'zqbackground-sentinel' }).includes('zqbackground-sentinel'));
  });

  say('\n3. never served live');
  await require('./helpers/question-background-live-check')(check);

  say(`\n${pass} passed, ${fail} failed`);
  suiteFinished();
  process.exit(fail ? 1 : 0);
})().catch((e) => { say(`CRASH ${e.stack}`); process.exit(1); });
