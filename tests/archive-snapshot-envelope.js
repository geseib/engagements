/**
 * WHAT A BACKUP IS, AND WHAT MAY NEVER BE RESTORED FROM ONE.
 *
 * shared/archive-snapshot.js is the one definition both sides of the archive share:
 * export-to-archive.js builds envelopes with it and shared/archive-restore.js reads them
 * back. Pure functions, so these are plain unit checks.
 *
 * // rejects: an allow-list creeping back into the envelope; PK travelling with a row; a
 * //          lifecycle row archived as content; an org, public-prompt or ciphertext backup
 * //          passing refusalFor; org-shaped attributes surviving onto a platform row.
 */
const assert = require('assert');
const path = require('path');

const REPO = path.join(__dirname, '..');
const snap = require(path.join(REPO, 'lambda-functions/admin/shared/archive-snapshot.js'));

let pass = 0; let fail = 0;
const check = (label, fn) => {
  try { fn(); console.log(`  ok   - ${label}`); pass += 1; } catch (e) {
    console.log(`  FAIL - ${label}\n         ${e.message}`); fail += 1;
  }
};

const CIPHERTEXT = { v: 1, iv: 'aXY=', tag: 'dGFn', ct: 'Y3Q=' }; // tenant-crypto's envelope shape
const META = {
  PK: 'SETS', SK: 'SET#pulse', name: 'Pulse', active: false, customInstruction: 'Be kind',
  roundKind: 'produce', Quickstart: true, isAIGenerated: false, futureField: { nested: [1, 2] },
};
const ROWS = [
  { PK: 'SET#pulse#v2', SK: 'CATEGORY#c001', Name: 'Zeta' },
  { PK: 'SET#pulse#v2', SK: 'QUESTION#c001#001', Title: 'Q', options: ['Yes', 'No'], allowMultiple: true },
  { PK: 'SET#pulse#v2', SK: 'REVIEW', status: 'approved' },
  { PK: 'SET#pulse#v2', SK: 'PUBLISHED', publicSetId: 'x' },
];
const envelope = () => snap.buildSetEnvelope({
  tier: 'prod', scope: 'platform', setId: 'pulse', version: 2, metadata: META, rows: ROWS,
  media: [{ key: 'sets/pulse/a.png', archiveKey: 'archive/media/snap-1/sets/pulse/a.png' }],
  snapshotId: 'snap-1', exportedAt: '2026-09-15T12:00:00.000Z', promptName: 'Workie - Pulse',
});

console.log('1. the envelope copies wholesale');
check('every metadata attribute travels, including one nobody has written a reader for', () => {
  assert.deepStrictEqual(envelope().metadata, {
    name: 'Pulse', active: false, customInstruction: 'Be kind', roundKind: 'produce',
    Quickstart: true, isAIGenerated: false, futureField: { nested: [1, 2] },
  });
});
check('rows keep SK and every attribute, and drop PK', () => {
  const env = envelope();
  assert.deepStrictEqual(env.rows[1], { SK: 'QUESTION#c001#001', Title: 'Q', options: ['Yes', 'No'], allowMultiple: true });
  assert.ok(env.rows.every((row) => !('PK' in row)));
});
check('REVIEW and PUBLISHED rows are not archived', () => {
  assert.deepStrictEqual(envelope().rows.map((row) => row.SK), ['CATEGORY#c001', 'QUESTION#c001#001']);
});
check('the envelope names its schema, where it came from, its snapshot id and its prompt link', () => {
  const env = envelope();
  assert.strictEqual(env.schema, 'engage.set/1');
  assert.deepStrictEqual(env.exportedFrom, { tier: 'prod', scope: 'platform', setId: 'pulse', version: 2 });
  assert.strictEqual(env.snapshotId, 'snap-1');
  assert.deepStrictEqual(env.links, { promptName: 'Workie - Pulse' });
});
check('building does not mutate the rows it was given', () => {
  envelope();
  assert.strictEqual(ROWS[0].PK, 'SET#pulse#v2');
});
check('a prompt envelope carries the row and body verbatim, or null for a row-only prompt', () => {
  const withBody = snap.buildPromptEnvelope({
    tier: 'dev', scope: 'platform', promptId: 'p1', exportedAt: 't',
    metadata: { PK: 'AIPROMPTS', SK: 'AIPROMPT#p1', name: 'P' }, body: { instructions: 'x' },
  });
  assert.strictEqual(withBody.schema, 'engage.prompt/1');
  assert.deepStrictEqual(withBody.metadata, { name: 'P' });
  assert.deepStrictEqual(withBody.body, { instructions: 'x' });
  const rowOnly = snap.buildPromptEnvelope({ tier: 'dev', scope: 'platform', promptId: 'g1', metadata: {}, body: null, exportedAt: 't' });
  assert.strictEqual(rowOnly.body, null);
});

console.log('\n2. tags say what and where');
check('tier, schema, scope, source and export time come first, then the extras', () => {
  assert.deepStrictEqual(snap.envelopeTags(envelope(), ['trivia']), [
    'prod', 'schema:engage.set/1', 'scope:platform', 'source:platform/pulse',
    'exportedAt:2026-09-15T12:00:00.000Z', 'trivia',
  ]);
});

console.log('\n3. reading stored content');
check('a set snapshot, a prompt snapshot, a legacy CSV, a legacy prompt, an unknown schema', () => {
  assert.strictEqual(snap.parseArchiveContent(JSON.stringify(envelope())).kind, 'set');
  assert.strictEqual(snap.parseArchiveContent(JSON.stringify({ schema: 'engage.prompt/1' })).kind, 'prompt');
  assert.strictEqual(snap.parseArchiveContent('"Category","Title"\n"A","B"').kind, 'legacy');
  const legacyPrompt = snap.parseArchiveContent(JSON.stringify({ metadata: { name: 'x' }, prompt: {} }));
  assert.strictEqual(legacyPrompt.kind, 'legacy');
  assert.deepStrictEqual(legacyPrompt.doc.metadata, { name: 'x' });
  // rejects: reading a FUTURE schema as legacy, which would hand a JSON envelope to the CSV importer.
  assert.deepStrictEqual(snap.parseArchiveContent(JSON.stringify({ schema: 'engage.set/2' })), { kind: 'unknown', schema: 'engage.set/2' });
});

console.log('\n4. what is never restored');
check('an org backup is refused by name', () => {
  const env = { ...envelope(), exportedFrom: { tier: 'dev', scope: 'org', setId: 'x' } };
  assert.strictEqual(snap.refusalFor(env), 'Organisation content is not archived: it is encrypted per organisation.');
});
check('a public prompt is refused; a public set is not', () => {
  assert.match(snap.refusalFor({ schema: 'engage.prompt/1', exportedFrom: { scope: 'public', promptId: 'p' }, metadata: {} }), /Public prompts/);
  assert.strictEqual(snap.refusalFor({ ...envelope(), exportedFrom: { tier: 'dev', scope: 'public', setId: 'acme-x' } }), '');
});
check('an unknown library is refused', () => {
  assert.match(snap.refusalFor({ ...envelope(), exportedFrom: { scope: 'galaxy', setId: 'x' } }), /library/);
});
check('an encrypted value ANYWHERE refuses the backup, and the reason says where', () => {
  const env = envelope();
  env.rows[1].Title = CIPHERTEXT;
  const reason = snap.refusalFor(env);
  assert.match(reason, /encrypted/);
  assert.ok(reason.includes('$.rows[1].Title'), reason);
});
check('findCiphertext finds nothing in plaintext and every nested envelope otherwise', () => {
  assert.deepStrictEqual(snap.findCiphertext({ a: [{ b: 'x' }], c: 1 }), []);
  assert.deepStrictEqual(snap.findCiphertext({ a: [{ b: CIPHERTEXT }], c: CIPHERTEXT }), ['$.a[0].b', '$.c']);
});
check('a clean platform backup is not refused', () => assert.strictEqual(snap.refusalFor(envelope()), ''));

console.log('\n5. a platform row after a restore');
check('org-shaped attributes and ttl are dropped, and provenance nests in restoredFrom', () => {
  const env = {
    ...envelope(),
    exportedFrom: { tier: 'prod', scope: 'public', setId: 'acme-retro' },
    metadata: { name: 'Retro', scope: 'public', orgId: '', sourceOrgId: 'acme', publishedAt: '2026-09-01', ttl: 1 },
  };
  const row = snap.platformMetadata(env.metadata, snap.provenance(env, 'arc-9'));
  assert.deepStrictEqual(row, {
    name: 'Retro',
    restoredFrom: { archiveId: 'arc-9', scope: 'public', setId: 'acme-retro', tier: 'prod', exportedAt: '2026-09-15T12:00:00.000Z', sourceOrgId: 'acme' },
  });
});
check('settingsFrom keeps set settings that hold a value, false included', () => {
  assert.deepStrictEqual(
    snap.settingsFrom({ name: 'N', personaId: '', Quickstart: false, isAIGenerated: false, roundKind: null, unrelated: 'x' }),
    { name: 'N', Quickstart: false, isAIGenerated: false },
  );
});
check('rowCarriesPromptText: a generation row yes, an empty pointer no', () => {
  assert.strictEqual(snap.rowCarriesPromptText({ basePrompt: 'Generate {count}' }), true);
  assert.strictEqual(snap.rowCarriesPromptText({ name: 'hollow' }), false);
});
check('currentTier reads ENVIRONMENT and never guesses', () => {
  const saved = process.env.ENVIRONMENT;
  process.env.ENVIRONMENT = 'prod';
  assert.strictEqual(snap.currentTier(), 'prod');
  process.env.ENVIRONMENT = 'production';
  assert.strictEqual(snap.currentTier(), 'unknown');
  if (saved === undefined) delete process.env.ENVIRONMENT; else process.env.ENVIRONMENT = saved;
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
