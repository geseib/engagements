/**
 * Archive export/import regression: an art-title set keeps its artwork and its reveal.
 *
 * BUG (fixed twice, now structurally impossible): the archive once stored a fixed-column CSV,
 * so an art-title set lost its Image and its AnswerDetails reveal on every round trip, in
 * every environment. Since 2026-09-15 the archive stores a wholesale snapshot
 * (shared/archive-snapshot.js), so there is no column to lose. This file keeps the original
 * regression pinned against that.
 *
 * Runs the REAL export and import handlers against tests/helpers/archive-harness.js.
 */
const h = require('./helpers/archive-harness');
const assert = require('assert');
const path = require('path');

const REPO = path.join(__dirname, '..');
const { setMetadataKey, setPartition } = require(path.join(REPO, 'lambda-functions/admin/shared/set-version.js'));
const exportHandler = require(path.join(REPO, 'lambda-functions/admin/export-to-archive.js')).handler;
const importHandler = require(path.join(REPO, 'lambda-functions/admin/import-from-archive.js')).handler;

const { check, finish } = h.checker();
const ref = { scope: 'platform', setId: 'artset1' };
const QUESTION = {
  SK: 'QUESTION#c001#001', Title: 'A puzzling smile', Detail: '', Category: 'Art',
  Image: '/assets/art/the-enigmatic-smile.jpg', AnswerDetails: 'The Enigmatic Smile — painted 1900s', CustomInstructions: '',
};
function seedArt() {
  h.reset();
  h.seedSet({ setId: 'artset1', meta: { name: 'Mystery Art', description: 'An art-title round', engagementType: 'call-and-answer', active: true }, rows: [{ SK: 'CATEGORY#c001', Name: 'Art' }, QUESTION] });
}
const exportArt = async () => JSON.parse((await exportHandler(h.adminEvent({ selectedItems: ['artset1'], exportType: 'questionsets' }))).body).results;

(async () => {
  await check('the archived snapshot carries the Image and the reveal', async () => {
    seedArt();
    const out = await exportArt();
    const archived = JSON.parse(h.archive.get(out.successful[0].archiveId).content).rows.find((r) => r.SK === QUESTION.SK);
    assert.strictEqual(archived.Image, QUESTION.Image);
    assert.strictEqual(archived.AnswerDetails, QUESTION.AnswerDetails);
  });

  await check('importing into an empty environment restores the Image on the question row', async () => {
    seedArt();
    const out = await exportArt();
    h.table.clear(); // a fresh environment: only the archive still has the set
    const res = JSON.parse((await importHandler(h.adminEvent({ selectedItems: [out.successful[0].archiveId] }))).body);
    assert.deepStrictEqual(res.results.failed, []);
    const restored = h.rows(setPartition(ref, 1)).find((r) => r.SK === QUESTION.SK);
    assert.strictEqual(restored.Image, QUESTION.Image, 'Image did not survive the archive round trip');
    assert.strictEqual(restored.AnswerDetails, QUESTION.AnswerDetails, 'the reveal did not survive the archive round trip');
    assert.strictEqual(h.get(setMetadataKey(ref).PK, setMetadataKey(ref).SK).hasImages, true);
  });

  finish();
})().catch((e) => { console.error('harness error:', e); process.exit(2); });
