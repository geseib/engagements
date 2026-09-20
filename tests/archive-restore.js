/**
 * PUTTING A BACKUP BACK — shared/archive-restore.js against an in-memory table and bucket.
 *
 * spec §4.3 with amendments A9–A11. Every restore lands in Engage's library. A set that does
 * not exist comes back under its original id. A set that does gets a new version, and only
 * then becomes current.
 *
 * // rejects: a restore that renames, re-ids or publishes; one that overwrites the version it
 * //          supersedes; one that strands legacy content; one that leaves half a version when
 * //          a write fails; org-shaped attributes on a platform row; a restore that changes
 * //          which prompt is the default.
 */
const h = require('./helpers/archive-harness');
const assert = require('assert');
const path = require('path');

const SHARED = path.join(__dirname, '..', 'lambda-functions', 'admin', 'shared');
const tenant = require(path.join(SHARED, 'tenant.js'));
const { setMetadataKey, setPartition, resolveSetPartition } = require(path.join(SHARED, 'set-version.js'));
const { promptKey, promptBodyKey } = require(path.join(SHARED, 'prompt-access.js'));
const snap = require(path.join(SHARED, 'archive-snapshot.js'));
const { restoreSetSnapshot, restorePromptSnapshot } = require(path.join(SHARED, 'archive-restore.js'));
const { DynamoDBDocumentClient } = require('@aws-sdk/lib-dynamodb');
const { S3Client } = require('@aws-sdk/client-s3');

const { check, finish } = h.checker();
const db = DynamoDBDocumentClient.from();
const deps = {
  db, s3: new S3Client({}), tableName: h.TABLE, promptsBucket: process.env.AI_PROMPTS_BUCKET,
  mediaBucket: process.env.MEDIA_BUCKET, archiveBucket: process.env.ARCHIVE_BUCKET, now: () => '2026-09-15T12:00:00.000Z',
};
const ctx = { archiveId: 'arc-7', restoredBy: 'staff-1' };
const platform = (setId) => ({ scope: tenant.PLATFORM, setId });
const metaRow = (setId) => h.get(setMetadataKey(platform(setId)).PK, `SET#${setId}`);
const contentOf = (setId, version) => h.rows(setPartition(platform(setId), version)).map(({ PK, ...rest }) => rest);
const promptRow = (promptId) => { const k = promptKey({ scope: 'platform', promptId }); return h.get(k.PK, k.SK); };

const ROWS = [
  { SK: 'CATEGORY#c001', Name: 'Zeta', QuestionCount: 1 },
  { SK: 'CATEGORY#c002', Name: 'Alpha', QuestionCount: 1 },
  { SK: 'QUESTION#c001#001', Title: 'First', Category: 'Zeta', options: ['Yes', 'No'], allowMultiple: true, Image: 'sets/pulse/chart.png' },
  { SK: 'QUESTION#c002#001', Title: 'Second', Category: 'Alpha', optionE: 'E', correctAnswer: 'OptionE' },
  { SK: 'REVIEW', status: 'approved' },
];
const META = {
  name: 'Pulse', description: 'How we are', customInstruction: 'Be kind', roundKind: 'produce', Quickstart: true,
  isAIGenerated: false, engagementType: 'poll', active: false, createdBy: 'author-9', createdByName: 'Nine', promptId: 'p-pulse',
};
const setEnvelope = (overrides = {}) => snap.buildSetEnvelope({
  tier: 'prod', scope: 'platform', setId: 'pulse', version: 4, metadata: META, rows: ROWS,
  media: [{ key: 'sets/pulse/chart.png', archiveKey: 'archive/media/snap-1/sets/pulse/chart.png' }],
  snapshotId: 'snap-1', exportedAt: '2026-09-14T09:00:00.000Z', promptName: 'Workie - Pulse', ...overrides,
});

(async () => {
  console.log('1. a set that does not exist comes back under its original id');
  h.reset();
  h.objects.set(`${process.env.ARCHIVE_BUCKET}/archive/media/snap-1/sets/pulse/chart.png`, { Body: 'PNG' });
  h.seedPrompt({ promptId: 'p-pulse', row: { name: 'Workie - Pulse' } });
  let outcome = await restoreSetSnapshot(deps, setEnvelope(), ctx);
  const created = metaRow('pulse');
  await check('it is created as version 1 of "pulse"', () => {
    assert.deepStrictEqual(outcome, {
      kind: 'set', id: 'pulse', name: 'Pulse', mode: 'created', version: 1, active: false, wasActive: false,
      media: { copied: 1, kept: 0, missing: [], skipped: [] },
    });
    assert.strictEqual(created.activeVersion, 1);
  });
  await check('every row is back, in SK order, without the lifecycle row', () => {
    assert.deepStrictEqual(contentOf('pulse', 1), ROWS.filter((row) => row.SK !== 'REVIEW'));
  });
  await check('settings, status, creator and prompt link come from the snapshot, with no suffix', () => {
    for (const [attr, value] of Object.entries(META)) assert.deepStrictEqual(created[attr], value, attr);
  });
  await check('the version entry and provenance say where it came from', () => {
    assert.strictEqual(created.versions.length, 1);
    assert.match(created.versions[0].note, /arc-7/);
    assert.strictEqual(created.versions[0].sourceFile, 'archive:arc-7');
    assert.deepStrictEqual(created.restoredFrom, { archiveId: 'arc-7', scope: 'platform', setId: 'pulse', tier: 'prod', exportedAt: '2026-09-14T09:00:00.000Z' });
    assert.strictEqual(created.restoredBy, 'staff-1');
    assert.deepStrictEqual([created.questionCount, created.categoryCount, created.hasImages], [2, 2, true]);
  });
  await check('its image is back in the tier media bucket', () => {
    assert.strictEqual(h.objects.get(`${process.env.MEDIA_BUCKET}/sets/pulse/chart.png`).Body, 'PNG');
  });

  console.log('\n2. a set that exists gets a new version, and only then becomes current');
  h.reset();
  h.seedSet({
    setId: 'pulse', version: 2, rows: [{ SK: 'QUESTION#c001#001', Title: 'Live v2' }],
    meta: { name: 'Pulse (edited live)', personaId: 'persona-live', active: true, versions: [{ version: 1 }, { version: 2 }] },
  });
  h.put({ PK: setPartition(platform('pulse'), 1), SK: 'QUESTION#c001#001', Title: 'Live v1' });
  outcome = await restoreSetSnapshot(deps, setEnvelope({ media: [] }), ctx);
  const flipped = metaRow('pulse');
  await check('v3 is written and made current', () => {
    assert.deepStrictEqual([outcome.mode, outcome.version, flipped.activeVersion], ['new-version', 3, 3]);
    assert.deepStrictEqual(flipped.versions.map((v) => v.version), [1, 2, 3]);
    assert.strictEqual(contentOf('pulse', 3).length, 4);
  });
  await check('the version it supersedes is untouched', () => {
    assert.deepStrictEqual(contentOf('pulse', 2), [{ SK: 'QUESTION#c001#001', Title: 'Live v2' }]);
  });
  await check('a game pinned to v2 still reads v2', async () => {
    const resolved = await resolveSetPartition(db, h.TABLE, 'pulse', 2);
    assert.strictEqual(resolved.pk, setPartition(platform('pulse'), 2));
  });
  await check('the live row now matches the snapshot: settings set, absent ones removed, status applied', () => {
    assert.strictEqual(flipped.name, 'Pulse');
    assert.strictEqual(flipped.customInstruction, 'Be kind');
    assert.strictEqual(flipped.personaId, undefined, 'personaId was not in the snapshot and must not survive');
    assert.strictEqual(flipped.active, false);
    assert.strictEqual(outcome.wasActive, true);
  });

  console.log('\n3. a set that was never versioned keeps its old content as v1');
  h.reset();
  h.seedSet({ setId: 'pulse', rows: [{ SK: 'QUESTION#c001#001', Title: 'Legacy row' }], meta: { name: 'Legacy', active: true, questionCount: 1 } });
  outcome = await restoreSetSnapshot(deps, setEnvelope({ media: [] }), ctx);
  await check('the legacy rows are copied to v1 and the restore becomes v2', () => {
    assert.strictEqual(outcome.version, 2);
    assert.deepStrictEqual(metaRow('pulse').versions.map((v) => v.version), [1, 2]);
    assert.deepStrictEqual(contentOf('pulse', 1), [{ SK: 'QUESTION#c001#001', Title: 'Legacy row' }]);
    assert.strictEqual(contentOf('pulse', null).length, 1, 'the legacy partition itself is left in place');
  });

  console.log('\n4. a public backup comes back as a house copy');
  h.reset();
  outcome = await restoreSetSnapshot(deps, setEnvelope({
    scope: 'public', setId: 'acme-retro', media: [],
    metadata: { ...META, scope: 'public', orgId: '', sourceOrgId: 'acme', sourceSetId: 'retro', publishedAt: '2026-09-01T00:00:00.000Z' },
  }), ctx);
  const house = metaRow('acme-retro');
  await check('it lands in the platform library with no org-shaped attribute at the top level', () => {
    assert.ok(house, 'no platform row');
    for (const attr of ['scope', 'orgId', 'sourceOrgId', 'publishedAt']) assert.strictEqual(house[attr], undefined, attr);
    assert.deepStrictEqual(house.restoredFrom, {
      archiveId: 'arc-7', scope: 'public', setId: 'acme-retro', tier: 'prod', exportedAt: '2026-09-14T09:00:00.000Z', sourceOrgId: 'acme',
    });
    assert.ok(!h.writes.some((w) => /^(ORG#|PUBLIC#)/.test(w.PK)), JSON.stringify(h.writes));
  });

  console.log('\n5. a failed write leaves the live set as it was');
  h.reset();
  h.seedSet({ setId: 'pulse', version: 2, meta: { name: 'Live', active: true }, rows: [{ SK: 'QUESTION#c001#001', Title: 'Live v2' }] });
  h.options.throwAfterNextBatchWrite = true;
  await check('the error says the live set is untouched', async () => {
    await assert.rejects(() => restoreSetSnapshot(deps, setEnvelope({ media: [] }), ctx), /v3 of "pulse" failed.*untouched/);
  });
  await check('no v3 row survives and the pointer still names v2', () => {
    assert.strictEqual(contentOf('pulse', 3).length, 0);
    assert.strictEqual(metaRow('pulse').activeVersion, 2);
  });

  console.log('\n6. the prompt link');
  h.reset();
  h.seedPrompt({ promptId: 'p-local-7', row: { name: 'workie  -  PULSE' } });
  await restoreSetSnapshot(deps, setEnvelope({ media: [] }), ctx);
  await check('an id that does not exist here is relinked by name', () => assert.strictEqual(metaRow('pulse').promptId, 'p-local-7'));
  h.reset();
  await restoreSetSnapshot(deps, setEnvelope({ media: [] }), ctx);
  await check('with no match by id or by name, the set is left unlinked rather than dangling', () => {
    assert.strictEqual(metaRow('pulse').promptId, undefined);
  });

  console.log('\n7. prompts');
  const BODY = { instructions: 'Read {responsesText}', outputFormat: '## Out', variables: { responsesText: 'answers' }, version: 2, isDefault: true };
  const promptEnvelope = (overrides = {}) => snap.buildPromptEnvelope({
    tier: 'prod', scope: 'platform', promptId: 'p-transfer', exportedAt: '2026-09-14T09:00:00.000Z', body: BODY,
    metadata: {
      name: 'Workie — Transfer', gameType: 'callandanswer', status: 'active', version: 2, isDefault: true,
      questionSetIds: ['pulse'], promptType: 'analysis', createdBy: 'author-9', s3Key: 'prompts/call-and-answer/p-transfer/v2.json',
    },
    ...overrides,
  });

  h.reset();
  outcome = await restorePromptSnapshot(deps, promptEnvelope(), ctx);
  const recreated = promptRow('p-transfer');
  await check('a prompt that does not exist is recreated under its id — canonical type, never a default', () => {
    assert.deepStrictEqual(outcome, { kind: 'prompt', id: 'p-transfer', name: 'Workie — Transfer', mode: 'created', version: 3, status: 'active', isDefault: false });
    assert.strictEqual(recreated.gameType, 'call-and-answer');
    assert.strictEqual(recreated.isDefault, false);
    assert.deepStrictEqual(recreated.questionSetIds, ['pulse']);
    assert.strictEqual(recreated.createdBy, 'author-9');
    assert.strictEqual(recreated.s3Key, promptBodyKey({ scope: 'platform', promptId: 'p-transfer' }, 'call-and-answer', 3));
  });
  await check('its body is the snapshot body, with identity fields reset', () => {
    const stored = JSON.parse(h.objects.get(`${process.env.AI_PROMPTS_BUCKET}/${recreated.s3Key}`).Body);
    assert.strictEqual(stored.instructions, BODY.instructions);
    assert.deepStrictEqual(stored.variables, BODY.variables);
    assert.deepStrictEqual([stored.id, stored.version, stored.isDefault], ['p-transfer', 3, false]);
  });

  h.reset();
  const live = h.seedPrompt({ promptId: 'p-transfer', row: { name: 'Live default', isDefault: true, version: 5 }, body: { instructions: 'live text' } });
  outcome = await restorePromptSnapshot(deps, promptEnvelope(), ctx);
  await check('restoring over the live default makes a new version and leaves it the default', () => {
    assert.deepStrictEqual([outcome.mode, outcome.version], ['new-version', 6]);
    assert.strictEqual(promptRow('p-transfer').isDefault, true);
    assert.strictEqual(JSON.parse(h.objects.get(`${process.env.AI_PROMPTS_BUCKET}/${live.s3Key}`).Body).instructions, 'live text');
  });

  h.reset();
  await restorePromptSnapshot(deps, promptEnvelope({
    promptId: 'gen-trivia', body: null,
    metadata: { name: 'Custom Trivia', gameType: 'trivia', promptType: 'generation', basePrompt: 'Generate {count}', status: 'active' },
  }), ctx);
  await check('a row-only generation prompt comes back as a row with no body', () => {
    const row = promptRow('gen-trivia');
    assert.strictEqual(row.basePrompt, 'Generate {count}');
    assert.strictEqual(row.s3Key, undefined);
    assert.ok(![...h.objects.keys()].some((k) => k.startsWith(`${process.env.AI_PROMPTS_BUCKET}/`)));
  });

  h.reset();
  await check('a backup with no body and no text on its row is refused before anything is written', async () => {
    await assert.rejects(
      () => restorePromptSnapshot(deps, promptEnvelope({ promptId: 'hollow', body: null, metadata: { name: 'Hollow' } }), ctx),
      /no body and no text/,
    );
    assert.deepStrictEqual(h.writes, []);
  });

  console.log('\n8. stray rows from unfinished writes are never mixed in');
  h.reset();
  h.seedSet({
    setId: 'pulse', version: 2, rows: [{ SK: 'QUESTION#c001#001', Title: 'Live v2' }],
    meta: { name: 'Live', active: true, versions: [{ version: 1 }, { version: 2 }] },
  });
  h.put({ PK: setPartition(platform('pulse'), 3), SK: 'QUESTION#c009#001', Title: 'stray' });
  outcome = await restoreSetSnapshot(deps, setEnvelope({ media: [] }), ctx);
  await check('a new version steps over a partition that already holds rows', () => {
    assert.strictEqual(outcome.version, 4);
    assert.strictEqual(metaRow('pulse').activeVersion, 4);
    const restored = contentOf('pulse', 4);
    assert.strictEqual(restored.length, 4);
    assert.ok(!restored.some((row) => row.Title === 'stray'), 'the stray row was mixed into the restored version');
  });
  await check('the stray rows are left where they were, neither deleted nor overwritten', () => {
    assert.deepStrictEqual(contentOf('pulse', 3), [{ SK: 'QUESTION#c009#001', Title: 'stray' }]);
  });

  h.reset();
  h.put({ PK: setPartition(platform('pulse'), 1), SK: 'QUESTION#c009#001', Title: 'stray' });
  outcome = await restoreSetSnapshot(deps, setEnvelope({ media: [] }), ctx);
  await check('a set that does not exist is created at the first empty version, not a literal 1', () => {
    assert.strictEqual(outcome.mode, 'created');
    assert.strictEqual(outcome.version, 2);
    assert.strictEqual(metaRow('pulse').activeVersion, 2);
    assert.deepStrictEqual(metaRow('pulse').versions.map((v) => v.version), [2]);
    assert.deepStrictEqual(contentOf('pulse', 1), [{ SK: 'QUESTION#c009#001', Title: 'stray' }]);
    assert.deepStrictEqual(contentOf('pulse', 2), ROWS.filter((row) => row.SK !== 'REVIEW'));
  });

  h.reset();
  const noMediaDeps = { ...deps, mediaBucket: '' };
  await check('images are copied before any row is written, so a media fault writes nothing', async () => {
    await assert.rejects(() => restoreSetSnapshot(noMediaDeps, setEnvelope(), ctx), /MEDIA_BUCKET/);
    assert.deepStrictEqual(h.writes, []);
  });

  /*
   * 9. A BACKUP TAKEN BEFORE THE SHELF EXISTED CANNOT TAKE A LIVE SET OFF ITS OWN.
   *
   * // rejects: the REMOVE branch above stripping `topic` and `tags` from a live row
   * //          because the snapshot has no value for them. That branch is right about
   * //          every other setting — a snapshot with no personaId describes a set that
   * //          had none — and wrong about these two: an envelope exported before the
   * //          field existed says nothing about filing, and a set unfiled by a restore
   * //          falls out of every topic filter and has its next share refused.
   */
  console.log('\n9. a restore can put a set on a shelf, and can never take it off one');
  h.reset();
  h.seedSet({
    setId: 'pulse', version: 2, rows: [{ SK: 'QUESTION#c001#001', Title: 'Live v2' }],
    meta: {
      name: 'Live', topic: 'history', tags: ['1980s'], personaId: 'persona-live',
      active: true, versions: [{ version: 1 }, { version: 2 }],
    },
  });
  // META predates the field: it carries neither attribute, exactly like the envelopes
  // already sitting in the archive.
  outcome = await restoreSetSnapshot(deps, setEnvelope({ media: [] }), ctx);
  await check('a pre-feature snapshot leaves the live set filed where it was', () => {
    const row = metaRow('pulse');
    assert.strictEqual(outcome.mode, 'new-version');
    assert.strictEqual(row.topic, 'history', 'the restore unfiled a live set');
    assert.deepStrictEqual(row.tags, ['1980s'], "the restore dropped the set's own words");
    assert.strictEqual(row.personaId, undefined, 'every OTHER absent setting must still be removed');
  });

  h.reset();
  h.seedSet({
    setId: 'pulse', version: 2, rows: [{ SK: 'QUESTION#c001#001', Title: 'Live v2' }],
    meta: { name: 'Live', topic: 'history', tags: ['1980s'], active: true, versions: [{ version: 1 }, { version: 2 }] },
  });
  await restoreSetSnapshot(deps, setEnvelope({
    media: [], metadata: { ...META, topic: 'music', tags: ['synths'] },
  }), ctx);
  await check('a snapshot that carries a shelf still restores it over the live one', () => {
    assert.strictEqual(metaRow('pulse').topic, 'music');
    assert.deepStrictEqual(metaRow('pulse').tags, ['synths']);
  });

  h.reset();
  await restoreSetSnapshot(deps, setEnvelope({
    media: [], metadata: { ...META, topic: 'music', tags: ['synths'] },
  }), ctx);
  await check('a set created by a restore arrives on the shelf the snapshot named', () => {
    assert.strictEqual(metaRow('pulse').topic, 'music');
    assert.deepStrictEqual(metaRow('pulse').tags, ['synths']);
  });

  finish();
})().catch((e) => { console.error('harness error:', e); process.exit(2); });
