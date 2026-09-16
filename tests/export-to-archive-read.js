/**
 * DOES THE EXPORTER ACTUALLY READ A SET'S QUESTIONS?
 *
 *   "its wasnt in archive when you did it, and when i retryed archive, it says export
 *    completed, 0 items exported"
 *
 * The exporter once used a ScanCommand with a FilterExpression and no pagination. A Scan reads
 * one 1 MB page of the WHOLE TABLE and filters after reading, so a set whose rows sat outside
 * that page exported nothing, and the archive's reply blamed three fields that were all fine.
 * It failed by TABLE POSITION: reproducible for one set, invisible for the rest.
 *
 * These drive the REAL export handler against tests/helpers/archive-harness.js, whose Query
 * pages are forced small and whose Scan throws. A single-page read or a table Scan fails here
 * the way it failed in production.
 *
 * // rejects: a Scan; one Query page; an empty read sent onward as an empty backup.
 */
const h = require('./helpers/archive-harness');
const assert = require('assert');
const path = require('path');

const REPO = path.join(__dirname, '..');
const { setPartition } = require(path.join(REPO, 'lambda-functions/admin/shared/set-version.js'));
const exportHandler = require(path.join(REPO, 'lambda-functions/admin/export-to-archive.js')).handler;

const { check, finish } = h.checker();
const exportSet = async (id) => JSON.parse((await exportHandler(h.adminEvent({ selectedItems: [id], exportType: 'questionsets' }))).body).results;

(async () => {
  h.reset();
  h.options.queryPageSize = 2;
  const questions = Array.from({ length: 11 }, (_, i) => ({ SK: `QUESTION#c001#${String(i + 1).padStart(3, '0')}`, Title: `Q${i + 1}`, Category: 'A' }));
  h.seedSet({ setId: 'readyornot', version: 1, meta: { name: 'Ready or Not', questionCount: 11 }, rows: [{ SK: 'CATEGORY#c001', Name: 'A' }, ...questions] });
  const out = await exportSet('readyornot');

  await check('every row of the partition is archived, across six Query pages', () => {
    assert.strictEqual(out.successful.length, 1, JSON.stringify(out.failed));
    assert.strictEqual(JSON.parse(h.archive.get(out.successful[0].archiveId).content).rows.length, 12);
    assert.strictEqual(out.successful[0].questionsCount, 11);
  });
  await check('the rows were read by paginated Query on the set partition (the harness throws on Scan)', () => {
    const pk = setPartition({ scope: 'platform', setId: 'readyornot' }, 1);
    assert.ok(h.reads.filter((r) => r.op === 'Query' && r.PK === pk).length >= 6);
  });

  h.reset();
  h.seedSet({ setId: 'hollow', version: 1, meta: { name: 'Hollow', questionCount: 12 }, rows: [] });
  const empty = await exportSet('hollow');
  await check('an empty read is refused with a diagnosis, and nothing is uploaded', () => {
    assert.strictEqual(empty.successful.length, 0);
    assert.match(empty.failed[0].error, /read problem, not an empty set/);
    assert.match(empty.failed[0].error, /12 questions/);
    assert.strictEqual(h.archive.size, 0);
  });

  finish();
})().catch((e) => { console.error('harness error:', e); process.exit(2); });
