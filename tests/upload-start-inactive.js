/**
 * A LEGACY BACKUP LANDS INACTIVE — WITHOUT A MOMENT WHERE IT IS LIVE.
 *
 * spec §4.8. A CSV written before snapshots does not record whether its set was active, and an
 * active Engage set is shown to every organisation. So the legacy restore creates the set
 * inactive. Doing it with a follow-up update would leave a window in which the set is live,
 * hence an additive flag on the create itself.
 *
 * // rejects: a flag that also deactivates the questions (activating the set would then not be
 * //          enough); a truthy string counting as true; any change to the default.
 */
const h = require('./helpers/archive-harness');
const assert = require('assert');
const path = require('path');

const REPO = path.join(__dirname, '..');
const { setMetadataKey, setPartition, FIRST_VERSION } = require(path.join(REPO, 'lambda-functions/admin/shared/set-version.js'));
const upload = require(path.join(REPO, 'lambda-functions/admin/upload-questions.js')).handler;

const { check, finish } = h.checker();
const CSV = 'Category,Title,Detail\nWarmups,First,One\nWarmups,Second,Two';
const ref = { scope: 'platform', setId: 'warmups' };
// `topic` because a live set is created with a shelf now (shared/set-topics.js);
// `extra` still overrides it, so a caller may drop or change it.
const create = (extra) => upload(h.adminEvent({ fileName: 'warm.csv', fileContent: CSV, customTitle: 'Warm Ups', topic: 'everyday-life', ...extra }));
const meta = () => h.get(setMetadataKey(ref).PK, setMetadataKey(ref).SK);
// FIRST_VERSION: the import creates the set, and a new set is born at v1.
const questions = () => h.rows(setPartition(ref, FIRST_VERSION)).filter((row) => row.SK.startsWith('QUESTION#'));

(async () => {
  console.log('1. startInactive');
  h.reset();
  let res = await create({ startInactive: true });
  await check('the set is created inactive', () => {
    assert.strictEqual(res.statusCode, 200, res.body);
    assert.strictEqual(meta().active, false);
  });
  await check('its questions stay playable, so activating the set is all it takes', () => {
    assert.strictEqual(questions().length, 2);
    assert.ok(questions().every((q) => q.Active === true));
  });
  await check('it is not marked AI-generated', () => assert.strictEqual(meta().isAIGenerated, false));

  console.log('\n2. nothing else changes');
  h.reset();
  res = await create({});
  await check('without the flag a new set is active, as before', () => {
    assert.strictEqual(res.statusCode, 200, res.body);
    assert.strictEqual(meta().active, true);
  });
  h.reset();
  await create({ startInactive: 'true' });
  await check('only a real true counts — the string "true" does not', () => assert.strictEqual(meta().active, true));
  h.reset();
  await create({ isAIGenerated: true });
  await check('AI-generated content still starts inactive, questions and all', () => {
    assert.strictEqual(meta().active, false);
    assert.ok(questions().every((q) => q.Active === false));
  });

  finish();
})().catch((e) => { console.error('harness error:', e); process.exit(2); });
