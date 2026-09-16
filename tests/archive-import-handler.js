/**
 * RESTORING FROM THE ARCHIVE, AS THE ADMIN SCREEN ASKS FOR IT — the import handler's wiring.
 *
 * shared/archive-restore.js is tested on its own (tests/archive-restore.js). This drives the
 * REAL handler against tests/helpers/archive-harness.js and checks what only the handler
 * decides: who may restore, which path each item takes, that one bad item does not stop the
 * rest, and that the response names every set now live for every organisation.
 *
 * // rejects: a restore by a host or by an admin standing in a customer team; a batch that
 * //          dies on its first bad item; a refusal that still writes; a legacy CSV that lands
 * //          active or renamed; an unsigned archive call.
 */
const h = require('./helpers/archive-harness');
const assert = require('assert');
const path = require('path');

const REPO = path.join(__dirname, '..');
const SHARED = path.join(REPO, 'lambda-functions/admin/shared');
const snap = require(path.join(SHARED, 'archive-snapshot.js'));
const { setMetadataKey, setPartition } = require(path.join(SHARED, 'set-version.js'));
const importHandler = require(path.join(REPO, 'lambda-functions/admin/import-from-archive.js')).handler;

const { check, finish } = h.checker();
const run = async (event) => { const res = await importHandler(event); return { status: res.statusCode, body: JSON.parse(res.body) }; };
const metaRow = (setId) => { const k = setMetadataKey({ scope: 'platform', setId }); return h.get(k.PK, k.SK); };
const setSnapshot = (setId, meta, extra = {}) => snap.buildSetEnvelope({
  tier: 'test', scope: 'platform', setId, version: 1, metadata: { name: setId, engagementType: 'call-and-answer', ...meta },
  rows: [{ SK: 'CATEGORY#c001', Name: 'A' }, { SK: 'QUESTION#c001#001', Title: 'Q', Category: 'A' }],
  media: [], snapshotId: 'snap', exportedAt: '2026-09-14T09:00:00.000Z', ...extra,
});
const seedSnapshot = (envelope) => h.seedArchiveItem({
  contentType: envelope.schema === snap.PROMPT_SCHEMA ? 'prompt' : 'questionset',
  title: String(envelope.metadata.name), tags: snap.envelopeTags(envelope), content: JSON.stringify(envelope),
});
const LEGACY_CSV = '"Category","Title","Detail","OptionA","OptionB","OptionC","OptionD","OptionE","CorrectAnswer"\n'
  + '"Space","Largest planet?","","Mars","Venus","Earth","Mercury","Jupiter","OptionE"';

(async () => {
  console.log('1. only Engage staff acting as Engage may restore');
  h.reset();
  const anyItem = seedSnapshot(setSnapshot('guarded', { active: true }));
  for (const [who, event] of [
    ['a host', h.hostEvent({ selectedItems: [anyItem] })],
    ['an Engage admin standing in a customer team', h.orgAdminEvent('acme', { selectedItems: [anyItem] })],
  ]) {
    // eslint-disable-next-line no-await-in-loop
    const res = await run(event);
    // eslint-disable-next-line no-await-in-loop
    await check(`${who} is refused before the archive is touched`, () => {
      assert.strictEqual(res.status, 403);
      assert.match(res.body.error, /Switch to Engage/);
      assert.strictEqual(h.fetchLog.length, 0);
      assert.deepStrictEqual(h.writes, []);
    });
  }
  await check('an empty selection is a 400', async () => {
    assert.strictEqual((await run(h.adminEvent({ selectedItems: [] }))).status, 400);
  });

  console.log('\n2. snapshots');
  h.reset();
  const live = seedSnapshot(setSnapshot('livequiz', { active: true }));
  const hidden = seedSnapshot(setSnapshot('hiddenquiz', { active: false }));
  h.seedSet({ setId: 'alreadylive', version: 1, meta: { name: 'Already live', active: true }, rows: [{ SK: 'QUESTION#c001#001', Title: 'old' }] });
  const stillLive = seedSnapshot(setSnapshot('alreadylive', { name: 'Already live', active: true }));
  let res = await run(h.adminEvent({ selectedItems: [live, hidden, stillLive] }));
  await check('each set is restored, and the entry says what happened', () => {
    assert.strictEqual(res.status, 200);
    assert.deepStrictEqual(res.body.results.failed, []);
    assert.deepStrictEqual(res.body.results.successful[0], {
      archiveId: live, kind: 'set', id: 'livequiz', name: 'livequiz', mode: 'created', version: 1, active: true,
    });
    assert.deepStrictEqual(res.body.results.successful.map((r) => r.mode), ['created', 'created', 'new-version']);
  });
  await check('becameActive names the set that is newly live — not the hidden one, not one that was live already', () => {
    assert.deepStrictEqual(res.body.becameActive, [{ id: 'livequiz', name: 'livequiz' }]);
  });
  await check('the restore is recorded against the member of staff who ran it', () => {
    assert.strictEqual(metaRow('livequiz').restoredBy, 'staff-1');
  });
  await check('every archive call was signed; the presigned downloads were not', () => {
    const archiveCalls = h.fetchLog.filter((c) => c.url.startsWith(process.env.ARCHIVE_SERVICE_URL));
    const downloads = h.fetchLog.filter((c) => c.url.startsWith(h.DOWNLOAD));
    assert.strictEqual(archiveCalls.length, 3);
    assert.ok(archiveCalls.every((c) => String(c.headers.authorization).startsWith('AWS4-HMAC-SHA256')));
    assert.ok(downloads.length === 3 && downloads.every((c) => !c.headers.authorization));
  });

  console.log('\n3. refusals write nothing, and one bad item does not stop the batch');
  h.reset();
  const orgBackup = seedSnapshot(setSnapshot('acmeretro', {}, { scope: 'org' }));
  const future = h.seedArchiveItem({ title: 'From the future', content: JSON.stringify({ schema: 'engage.set/9' }) });
  const encrypted = seedSnapshot(setSnapshot('sealed', { name: 'sealed', customInstruction: { v: 1, iv: 'aQ==', tag: 'dA==', ct: 'Yw==' } }));
  const good = seedSnapshot(setSnapshot('goodquiz', { active: false }));
  res = await run(h.adminEvent({ selectedItems: ['arc-does-not-exist', orgBackup, future, encrypted, good] }));
  await check('the three refusals are marked as refusals and name their reason', () => {
    const refused = res.body.results.failed.filter((f) => f.refused);
    assert.deepStrictEqual(refused.map((f) => f.archiveId), [orgBackup, future, encrypted]);
    assert.match(refused[0].error, /Organisation content is not archived/);
    assert.match(refused[1].error, /engage\.set\/9/);
    assert.match(refused[2].error, /encrypted/);
  });
  await check('a missing item is a failure, not a refusal', () => {
    const missing = res.body.results.failed.find((f) => f.archiveId === 'arc-does-not-exist');
    assert.ok(missing && !missing.refused && /404/.test(missing.error), JSON.stringify(missing));
  });
  await check('the good item after them was still restored, and it is the only thing written', () => {
    assert.deepStrictEqual(res.body.results.successful.map((r) => r.id), ['goodquiz']);
    assert.ok(h.writes.every((w) => w.PK === setPartition({ scope: 'platform', setId: 'goodquiz' }, 1) || w.SK === 'SET#goodquiz'));
  });

  console.log('\n4. legacy items: no suffixes, and a set lands inactive');
  h.reset();
  const legacySet = h.seedArchiveItem({
    contentType: 'questionset', title: 'Old Quiz (dev)', description: 'Space facts - Exported from dev environment',
    tags: ['dev', 'trivia', 'questions:1'], content: LEGACY_CSV,
  });
  res = await run(h.adminEvent({ selectedItems: [legacySet] }));
  const legacyRow = metaRow('oldquiz');
  await check('the CSV restores as "Old Quiz", inactive, owned by the restorer', () => {
    assert.deepStrictEqual(res.body.results.failed, []);
    assert.deepStrictEqual(res.body.results.successful[0], {
      archiveId: legacySet, kind: 'set', id: 'oldquiz', name: 'Old Quiz', mode: 'created', version: null, active: false, legacy: true, questionCount: 1,
    });
    assert.deepStrictEqual([legacyRow.name, legacyRow.description, legacyRow.active, legacyRow.createdBy], ['Old Quiz', 'Space facts', false, 'staff-1']);
  });
  await check('its trivia options survive', () => {
    const question = h.rows(setPartition({ scope: 'platform', setId: 'oldquiz' }, null)).find((r) => r.SK.startsWith('QUESTION#'));
    assert.deepStrictEqual([question.optionE, question.correctAnswer], ['Jupiter', 'OptionE']);
  });
  await check('restoring it again, over the set it created, is refused and changes nothing', async () => {
    const before = metaRow('oldquiz');
    const again = await run(h.adminEvent({ selectedItems: [legacySet] }));
    assert.match(again.body.results.failed[0].error, /already exists/);
    assert.deepStrictEqual(metaRow('oldquiz'), before);
  });

  h.reset();
  const legacyPrompt = h.seedArchiveItem({
    contentType: 'prompt', title: 'Summary (dev)', tags: ['dev', 'trivia'],
    content: JSON.stringify({ metadata: { promptId: 'old1', name: 'Summary', description: 'Reads the room', gameType: 'trivia' }, prompt: { instructions: 'Say {x}', outputFormat: '## S' } }),
  });
  res = await run(h.adminEvent({ selectedItems: [legacyPrompt] }));
  await check('a legacy prompt restores as a draft copy, with no suffix on its name or description', () => {
    const entry = res.body.results.successful[0];
    assert.ok(entry && entry.legacy && entry.id.startsWith('imported-'), JSON.stringify(res.body));
    const row = h.rows('AIPROMPTS').find((r) => r.promptId === entry.id);
    assert.deepStrictEqual([row.name, row.description, row.status, row.isDefault], ['Summary', 'Reads the room', 'draft', false]);
  });

  finish();
})().catch((e) => { console.error('harness error:', e); process.exit(2); });
