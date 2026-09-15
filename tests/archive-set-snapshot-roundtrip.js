/**
 * A QUESTION SET SURVIVES THE ARCHIVE — every field, both directions, twice.
 *
 * spec §6 items 2–5, against the list in spec §2.1 of what a restore used to lose: poll
 * options, trivia E and F, uploaded images, every set setting, the active flag, the set's id
 * and its name. The fixtures carry all of them. The REAL export handler archives them, the
 * tier is wiped, and the REAL import handler puts them back.
 *
 * // rejects: every loss in spec §2.1; a second trip that differs from the first; an export
 * //          that writes to the main table; archiving a superseded version; a restore that
 * //          overwrites the version it replaces or an image that already exists.
 */
const h = require('./helpers/archive-harness');
const assert = require('assert');
const path = require('path');

const REPO = path.join(__dirname, '..');
const SHARED = path.join(REPO, 'lambda-functions/admin/shared');
const tenant = require(path.join(SHARED, 'tenant.js'));
const { setMetadataKey, setPartition, resolveSetPartition } = require(path.join(SHARED, 'set-version.js'));
const { DynamoDBDocumentClient } = require('@aws-sdk/lib-dynamodb');
const exportHandler = require(path.join(REPO, 'lambda-functions/admin/export-to-archive.js')).handler;
const importHandler = require(path.join(REPO, 'lambda-functions/admin/import-from-archive.js')).handler;

const { check, finish } = h.checker();
const parse = (res) => ({ status: res.statusCode, body: JSON.parse(res.body) });
const exportSets = async (...refs) => parse(await exportHandler(h.adminEvent({ selectedItems: refs, exportType: 'questionsets' })));
const importItems = async (...ids) => parse(await importHandler(h.adminEvent({ selectedItems: ids })));
const platform = (setId) => ({ scope: tenant.PLATFORM, setId });
const metaRow = (setId) => h.get(setMetadataKey(platform(setId)).PK, `SET#${setId}`);
const envelopeOf = (archiveId) => JSON.parse(h.archive.get(archiveId).content);
const MEDIA = process.env.MEDIA_BUCKET;

/** Wipe the tier (table and media bucket), keeping only what the archive holds. */
function loseTheTier() {
  h.table.clear();
  for (const key of [...h.objects.keys()]) if (key.startsWith(`${MEDIA}/`)) h.objects.delete(key);
}

const POLL = {
  setId: 'pulse',
  version: 2,
  meta: {
    name: 'Pulse Check', description: 'How the team is doing', engagementType: 'poll', customInstruction: 'Be kind',
    aiContextInstruction: 'Quarterly check-in', personaId: 'persona-7', roundNoun: 'Pulse', roundKind: 'produce',
    roundKindBrief: 'Say it plainly', Quickstart: true, isAIGenerated: false, promptId: 'p-pulse', active: false,
    createdBy: 'author-9', createdByName: 'Nine', createdAt: '2026-01-01T00:00:00.000Z',
    questionCount: 2, categoryCount: 2, hasImages: true, versions: [{ version: 1 }, { version: 2 }],
  },
  rows: [
    { SK: 'CATEGORY#c001', Name: 'Zeta', Description: 'Zeta questions', QuestionCount: 1 },
    { SK: 'CATEGORY#c002', Name: 'Alpha', Description: 'Alpha questions', QuestionCount: 1 },
    { SK: 'QUESTION#c001#001', Title: 'How is your week?', Detail: 'Honestly', Category: 'Zeta', options: ['Great', 'Fine', 'Rough'], allowMultiple: true, Tags: ['mood'], Image: 'sets/pulse/chart.png', Active: true },
    { SK: 'QUESTION#c002#001', Title: 'Anything blocking you?', Detail: '', Category: 'Alpha', options: ['Yes', 'No'], allowMultiple: false, Tags: [], Image: '', Active: true },
  ],
};
const TRIVIA = {
  setId: 'spacequiz',
  version: null,
  meta: { name: 'Space Quiz', description: 'Planets', engagementType: 'trivia', active: true, isAIGenerated: false },
  rows: [
    { SK: 'CATEGORY#c001', Name: 'Planets', QuestionCount: 1 },
    { SK: 'QUESTION#c001#001', Title: 'Largest planet?', Detail: '', Category: 'Planets', optionA: 'Mars', optionB: 'Venus', optionC: 'Earth', optionD: 'Mercury', optionE: 'Jupiter', optionF: 'Saturn', correctAnswer: 'OptionE', difficulty: 'hard', points: 10, AnswerDetails: 'Jupiter is eleven Earths wide', Image: 'https://upload.wikimedia.org/jupiter.jpg' },
  ],
};
const ART = {
  setId: 'artset',
  version: 1,
  meta: { name: 'Mystery Art', description: 'An art-title round', engagementType: 'call-and-answer', active: true },
  rows: [
    { SK: 'CATEGORY#c001', Name: 'Art', QuestionCount: 1 },
    { SK: 'QUESTION#c001#001', Title: 'A puzzling smile', Detail: '', Category: 'Art', Image: '/assets/art/the-enigmatic-smile.jpg', AnswerDetails: 'The Enigmatic Smile — painted 1900s', CustomInstructions: '' },
  ],
};

(async () => {
  console.log('1. export');
  h.reset();
  for (const set of [POLL, TRIVIA, ART]) h.seedSet(set);
  h.put({ PK: setPartition(platform('pulse'), 1), SK: 'QUESTION#c001#001', Title: 'Superseded' });
  h.objects.set(`${MEDIA}/sets/pulse/chart.png`, { Body: 'PNG-CHART', ContentType: 'image/png' });
  h.seedPrompt({ promptId: 'p-pulse', row: { name: 'Workie - Pulse' } });
  const writesBefore = h.writes.length;
  let exported = await exportSets({ scope: 'platform', id: 'pulse' }, 'spacequiz', { scope: 'platform', id: 'artset' });
  const [pollItem, triviaItem, artItem] = exported.body.results.successful;

  await check('three snapshots, one per set, and no failures', () => {
    assert.strictEqual(exported.status, 200);
    assert.deepStrictEqual(exported.body.results.failed, []);
    assert.deepStrictEqual(exported.body.results.successful.map((s) => s.id), ['pulse', 'spacequiz', 'artset']);
  });
  await check('a bare id is read as the platform library', () => assert.strictEqual(triviaItem.scope, 'platform'));
  await check('the export wrote nothing to the main table', () => assert.strictEqual(h.writes.length, writesBefore));
  await check('the active version is what was archived, not the superseded one', () => {
    const env = envelopeOf(pollItem.archiveId);
    assert.strictEqual(env.exportedFrom.version, 2);
    assert.ok(!env.rows.some((row) => row.Title === 'Superseded'));
  });
  await check('the uploaded image went to the archive; the remote URL and the repo asset did not', () => {
    const env = envelopeOf(pollItem.archiveId);
    assert.deepStrictEqual(env.media.map((m) => m.key), ['sets/pulse/chart.png']);
    assert.strictEqual(h.objects.get(`${process.env.ARCHIVE_BUCKET}/${env.media[0].archiveKey}`).Body, 'PNG-CHART');
    assert.deepStrictEqual(envelopeOf(triviaItem.archiveId).media, []);
    assert.deepStrictEqual(envelopeOf(artItem.archiveId).media, []);
    assert.deepStrictEqual(pollItem.media, { copied: 1, missing: [], skipped: [] });
  });
  await check('the linked prompt travels by name as well as by id', () => {
    assert.deepStrictEqual(envelopeOf(pollItem.archiveId).links, { promptName: 'Workie - Pulse' });
    assert.ok(h.archive.get(pollItem.archiveId).item.Tags.includes('prompt:Workie - Pulse'));
  });
  await check('the item is titled with the set name, no tier suffix, and tagged with where it came from', () => {
    const { item } = h.archive.get(pollItem.archiveId);
    assert.strictEqual(item.Title, 'Pulse Check');
    for (const tag of ['dev', 'schema:engage.set/1', 'scope:platform', 'source:platform/pulse', 'poll', 'questions:2']) {
      assert.ok(item.Tags.includes(tag), `missing tag ${tag}`);
    }
  });

  console.log('\n2. lose the tier, restore everything');
  loseTheTier();
  h.seedPrompt({ promptId: 'p-pulse', row: { name: 'Workie - Pulse' } });
  let restored = await importItems(pollItem.archiveId, triviaItem.archiveId, artItem.archiveId);

  await check('all three come back under their original ids', () => {
    assert.deepStrictEqual(restored.body.results.failed, []);
    assert.deepStrictEqual(
      restored.body.results.successful.map((r) => [r.id, r.mode, r.version]),
      [['pulse', 'created', 1], ['spacequiz', 'created', 1], ['artset', 'created', 1]],
    );
  });
  for (const set of [POLL, TRIVIA, ART]) {
    // eslint-disable-next-line no-await-in-loop
    await check(`${set.setId}: every question and category attribute, in stored order`, () => {
      assert.deepStrictEqual(h.rows(setPartition(platform(set.setId), 1)).map(({ PK, ...rest }) => rest), set.rows);
    });
    // eslint-disable-next-line no-await-in-loop
    await check(`${set.setId}: every setting, the status and the creator, with no suffix`, () => {
      const row = metaRow(set.setId);
      for (const [attr, value] of Object.entries(set.meta)) {
        if (attr !== 'versions') assert.deepStrictEqual(row[attr], value, attr);
      }
    });
  }
  await check('the deactivated set stayed deactivated; only the two active sets are reported as live', () => {
    assert.strictEqual(metaRow('pulse').active, false);
    assert.deepStrictEqual(restored.body.becameActive.map((s) => s.id), ['spacequiz', 'artset']);
  });
  await check('the image is back in the tier media bucket', () => {
    assert.strictEqual(h.objects.get(`${MEDIA}/sets/pulse/chart.png`).Body, 'PNG-CHART');
    assert.deepStrictEqual(restored.body.media, { copied: 1, kept: 0, missing: [], skipped: [] });
  });

  console.log('\n3. a second round trip is identical to the first');
  const first = envelopeOf(pollItem.archiveId);
  exported = await exportSets({ scope: 'platform', id: 'pulse' });
  const second = envelopeOf(exported.body.results.successful[0].archiveId);
  const VOLATILE = ['restoredFrom', 'restoredAt', 'restoredBy', 'updatedAt', 'activeVersion', 'versions'];
  const stable = (meta) => Object.fromEntries(Object.entries(meta).filter(([k]) => !VOLATILE.includes(k)));
  await check('the rows are identical', () => assert.deepStrictEqual(second.rows, first.rows));
  await check('the metadata is identical apart from the restore bookkeeping', () => assert.deepStrictEqual(stable(second.metadata), stable(first.metadata)));

  console.log('\n4. restoring over a set that still exists');
  h.put({ ...metaRow('pulse'), name: 'Pulse Check (edited)', personaId: 'persona-other', ...setMetadataKey(platform('pulse')) });
  restored = await importItems(pollItem.archiveId);
  const now = metaRow('pulse');
  await check('it becomes a new version and is made current', () => {
    assert.deepStrictEqual(restored.body.results.successful.map((r) => [r.mode, r.version]), [['new-version', 2]]);
    assert.strictEqual(now.activeVersion, 2);
    assert.deepStrictEqual(now.versions.map((v) => v.version), [1, 2]);
  });
  await check('the edited settings are back to the snapshot', () => {
    assert.deepStrictEqual([now.name, now.personaId], ['Pulse Check', 'persona-7']);
  });
  await check('a game pinned to the version it replaced still reads that version', async () => {
    const resolved = await resolveSetPartition(DynamoDBDocumentClient.from(), h.TABLE, 'pulse', 1);
    assert.strictEqual(resolved.pk, setPartition(platform('pulse'), 1));
    assert.strictEqual(h.rows(resolved.pk).length, 4);
  });
  await check('the image that already existed was kept, not overwritten', () => {
    assert.deepStrictEqual(restored.body.media, { copied: 0, kept: 1, missing: [], skipped: [] });
  });

  console.log('\n5. a public set is archived and comes back as a house copy');
  h.reset();
  h.seedSet({
    scope: 'public', setId: 'acme-retro', version: 1,
    meta: { name: 'Team Retro', engagementType: 'call-and-answer', active: true, scope: 'public', orgId: '', sourceOrgId: 'acme', sourceSetId: 'retro', publishedAt: '2026-09-01T00:00:00.000Z' },
    rows: [{ SK: 'CATEGORY#c001', Name: 'Went well' }, { SK: 'QUESTION#c001#001', Title: 'What worked?', Category: 'Went well' }, { SK: 'REVIEW', status: 'approved' }],
  });
  exported = await exportSets({ scope: 'public', id: 'acme-retro' });
  const publicItem = exported.body.results.successful[0];
  await check('it exports, tagged as public, without its review row', () => {
    assert.ok(h.archive.get(publicItem.archiveId).item.Tags.includes('scope:public'));
    assert.deepStrictEqual(envelopeOf(publicItem.archiveId).rows.map((r) => r.SK), ['CATEGORY#c001', 'QUESTION#c001#001']);
  });
  loseTheTier();
  restored = await importItems(publicItem.archiveId);
  await check("it is restored into Engage's library, with its provenance nested rather than stamped", () => {
    const house = metaRow('acme-retro');
    assert.ok(house, 'no platform row');
    for (const attr of ['scope', 'orgId', 'sourceOrgId', 'publishedAt']) assert.strictEqual(house[attr], undefined, attr);
    assert.deepStrictEqual([house.restoredFrom.scope, house.restoredFrom.sourceOrgId], ['public', 'acme']);
  });

  console.log('\n6. export details');
  h.reset();
  h.seedSet({ setId: 'gappy', version: 1, meta: { name: 'Gappy', active: true }, rows: [{ SK: 'CATEGORY#c001', Name: 'A' }, { SK: 'QUESTION#c001#001', Title: 'Lost image', Category: 'A', Image: 'sets/gappy/gone.png' }] });
  exported = await exportSets('gappy');
  await check('a missing image is reported, and the backup still happens', () => {
    assert.strictEqual(exported.body.results.successful.length, 1);
    assert.deepStrictEqual(exported.body.results.successful[0].media, { copied: 0, missing: ['sets/gappy/gone.png'], skipped: [] });
  });
  h.reset();
  h.seedSet({
    setId: 'stray',
    version: 1,
    meta: { name: 'Stray', active: true },
    rows: [
      { SK: 'CATEGORY#c001', Name: 'A' },
      { SK: 'QUESTION#c001#001', Title: 'Kept image', Category: 'A', Image: 'sets/stray/ok.png' },
      { SK: 'QUESTION#c001#002', Title: 'Stray image', Category: 'A', Image: 'images/legacy.png' },
    ],
  });
  h.objects.set(`${MEDIA}/sets/stray/ok.png`, { Body: 'PNG-OK', ContentType: 'image/png' });
  h.objects.set(`${MEDIA}/images/legacy.png`, { Body: 'PNG-LEGACY', ContentType: 'image/png' });
  exported = await exportSets('stray');
  await check('an image stored outside sets/ is named as skipped, never copied, and the backup still happens', () => {
    // rejects: export's role reads only sets/*, so on a live tier this copy is an AccessDenied that failed the whole set.
    assert.strictEqual(exported.body.results.successful.length, 1);
    assert.deepStrictEqual(exported.body.results.successful[0].media, { copied: 1, missing: [], skipped: ['images/legacy.png'] });
    const env = envelopeOf(exported.body.results.successful[0].archiveId);
    assert.deepStrictEqual(env.media.map((m) => m.key), ['sets/stray/ok.png']);
    const archived = [...h.objects.keys()].filter((key) => key.startsWith(`${process.env.ARCHIVE_BUCKET}/`));
    assert.ok(!archived.some((key) => key.endsWith('/images/legacy.png')), `the stray image was copied to the archive: ${archived.join(', ')}`);
  });
  h.reset();
  const bulky = Array.from({ length: 600 }, (_, i) => ({ SK: `QUESTION#c001#${String(i).padStart(3, '0')}`, Title: 'x'.repeat(10000), Category: 'A' }));
  h.seedSet({ setId: 'huge', version: 1, meta: { name: 'Huge' }, rows: [{ SK: 'CATEGORY#c001', Name: 'A' }, ...bulky] });
  exported = await exportSets('huge');
  await check("a snapshot over the archive's request limit is refused by name, before any upload", () => {
    assert.strictEqual(exported.body.results.successful.length, 0);
    assert.match(exported.body.results.failed[0].error, /6 MB/);
    assert.strictEqual(h.archive.size, 0);
  });

  finish();
})().catch((e) => { console.error('harness error:', e); process.exit(2); });
