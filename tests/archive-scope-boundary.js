/**
 * THE ARCHIVE HOLDS ENGAGE AND PUBLIC CONTENT ONLY — enforced by rule, not by accident.
 *
 * spec §2.3 and §6.1. Export used to refuse org content only because it read the platform key
 * and an org id was therefore "not found". Import wrote to platform unconditionally, and an
 * Engage admin standing in a customer team could reach both routes.
 *
 * // rejects: an org set or prompt being read or uploaded; an org-scoped or encrypted envelope
 * //          being restored; either route answering a host or an admin inside an org; any
 * //          restore writing an ORG# or PUBLIC# key.
 */
const h = require('./helpers/archive-harness');
const assert = require('assert');
const path = require('path');

const REPO = path.join(__dirname, '..');
const snap = require(path.join(REPO, 'lambda-functions/admin/shared/archive-snapshot.js'));
const exportHandler = require(path.join(REPO, 'lambda-functions/admin/export-to-archive.js')).handler;
const importHandler = require(path.join(REPO, 'lambda-functions/admin/import-from-archive.js')).handler;

const { check, finish } = h.checker();
const parse = (res) => ({ status: res.statusCode, body: JSON.parse(res.body) });
const CIPHERTEXT = { v: 1, iv: 'aQ==', tag: 'dA==', ct: 'Yw==' };
const ORG_MESSAGE = 'Organisation content is not archived: it is encrypted per organisation.';
const setEnvelope = (scope, setId, metadata) => snap.buildSetEnvelope({
  tier: 'dev', scope, setId, version: 1, metadata,
  rows: [{ SK: 'CATEGORY#c001', Name: 'A' }, { SK: 'QUESTION#c001#001', Title: 'Q', Category: 'A' }],
  media: [], snapshotId: 's', exportedAt: '2026-09-14T09:00:00.000Z',
});
const seedEnvelope = (envelope) => h.seedArchiveItem({
  contentType: envelope.schema === snap.PROMPT_SCHEMA ? 'prompt' : 'questionset',
  title: 'Seeded', tags: snap.envelopeTags(envelope), content: JSON.stringify(envelope),
});

(async () => {
  console.log('1. export refuses organisation content by name, before reading it');
  h.reset();
  h.seedSet({ scope: 'org', orgId: 'acme', setId: 'retro', version: 1, meta: { name: 'Acme Retro', scope: 'org', orgId: 'acme' }, rows: [{ SK: 'QUESTION#c001#001', Title: 'Secret' }] });
  let res = parse(await exportHandler(h.adminEvent({ selectedItems: [{ scope: 'org', id: 'retro' }], exportType: 'questionsets' })));
  await check('an org set is refused with the reason, and nothing is uploaded or even read', () => {
    assert.deepStrictEqual(res.body.results.failed, [{ id: 'retro', scope: 'org', refused: true, error: ORG_MESSAGE }]);
    assert.strictEqual(h.archive.size, 0);
    assert.ok(h.reads.every((r) => !String(r.PK).startsWith('ORG#')), JSON.stringify(h.reads));
  });
  res = parse(await exportHandler(h.adminEvent({ selectedItems: [{ scope: 'org', id: 'p1' }], exportType: 'prompts' })));
  await check('an org prompt is refused the same way', () => {
    assert.deepStrictEqual(res.body.results.failed, [{ id: 'p1', scope: 'org', refused: true, error: ORG_MESSAGE }]);
  });
  res = parse(await exportHandler(h.adminEvent({ selectedItems: [{ scope: 'public', id: 'p1' }], exportType: 'prompts' })));
  await check('a public prompt is refused: nothing writes one', () => assert.match(res.body.results.failed[0].error, /Public prompts/));

  console.log('\n2. encrypted content is never archived and never restored');
  h.reset();
  h.seedSet({ scope: 'public', setId: 'acme-sealed', version: 1, meta: { name: CIPHERTEXT, scope: 'public', sourceOrgId: 'acme' }, rows: [{ SK: 'QUESTION#c001#001', Title: 'Q' }] });
  res = parse(await exportHandler(h.adminEvent({ selectedItems: [{ scope: 'public', id: 'acme-sealed' }], exportType: 'questionsets' })));
  await check('a public set whose name is ciphertext is refused on export', () => {
    assert.strictEqual(res.body.results.failed[0].refused, true);
    assert.match(res.body.results.failed[0].error, /encrypted/);
    assert.strictEqual(h.archive.size, 0);
  });
  h.reset();
  const orgItem = seedEnvelope(setEnvelope('org', 'retro', { name: 'Acme Retro' }));
  const sealedItem = seedEnvelope(setEnvelope('public', 'acme-sealed', { name: 'Sealed', aiContextInstruction: CIPHERTEXT }));
  res = parse(await importHandler(h.adminEvent({ selectedItems: [orgItem, sealedItem] })));
  await check('an org-scoped or encrypted backup is refused on import, and nothing is written', () => {
    assert.deepStrictEqual(res.body.results.failed.map((f) => [f.archiveId, f.refused]), [[orgItem, true], [sealedItem, true]]);
    assert.strictEqual(res.body.results.failed[0].error, ORG_MESSAGE);
    assert.deepStrictEqual(h.writes, []);
  });

  console.log('\n3. only Engage staff acting as Engage may use either route');
  for (const [who, make] of [['a host', h.hostEvent], ['an Engage admin inside a customer team', (body) => h.orgAdminEvent('acme', body)]]) {
    h.reset();
    // eslint-disable-next-line no-await-in-loop
    const exported = parse(await exportHandler(make({ selectedItems: ['anything'], exportType: 'questionsets' })));
    // eslint-disable-next-line no-await-in-loop
    const imported = parse(await importHandler(make({ selectedItems: ['arc-1'] })));
    // eslint-disable-next-line no-await-in-loop
    await check(`${who} is refused by both, before the archive is touched`, () => {
      assert.deepStrictEqual([exported.status, imported.status], [403, 403]);
      assert.strictEqual(h.fetchLog.length, 0);
    });
  }

  console.log('\n4. no restore ever writes into an organisation or the public library');
  h.reset();
  const items = [
    seedEnvelope(setEnvelope('platform', 'house', { name: 'House', active: false })),
    seedEnvelope(setEnvelope('public', 'acme-shared', { name: 'Shared', scope: 'public', sourceOrgId: 'acme', active: false })),
    seedEnvelope(snap.buildPromptEnvelope({ tier: 'dev', scope: 'platform', promptId: 'p9', metadata: { name: 'P9', gameType: 'trivia', status: 'active' }, body: { instructions: 'x' }, exportedAt: 't' })),
    h.seedArchiveItem({ contentType: 'questionset', title: 'Legacy (dev)', tags: ['dev'], content: 'Category,Title\nA,Q' }),
  ];
  res = parse(await importHandler(h.adminEvent({ selectedItems: items })));
  await check('four mixed items restore, and every key written is a platform key', () => {
    assert.deepStrictEqual(res.body.results.failed, []);
    assert.strictEqual(res.body.results.successful.length, 4);
    const leaked = h.writes.filter((w) => /^(ORG#|PUBLIC#)/.test(String(w.PK)));
    assert.deepStrictEqual(leaked, []);
  });

  finish();
})().catch((e) => { console.error('harness error:', e); process.exit(2); });
