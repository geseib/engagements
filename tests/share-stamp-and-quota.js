// tests/share-stamp-and-quota.js
const path = require('path');
const assert = require('assert');
const H = require('./helpers/moderation-harness');
H.install();
const { DynamoDBDocumentClient } = require('@aws-sdk/lib-dynamodb');
const db = DynamoDBDocumentClient.from({});
const S = require(path.join(H.REPO, 'lambda-functions/admin/shared/share-stamp.js'));
const K = require(path.join(H.REPO, 'lambda-functions/admin/shared/check-quota.js'));
const ORG = { scope: 'org', orgId: 'org_acme', setId: 'pricing' };
(async () => {
  console.log('\nshare stamp and check quota\n');
  await H.test('the stamp is written by UpdateCommand onto the metadata row and touches nothing else', async () => {
    H.reset();
    H.seedRow({ PK: 'ORG#org_acme#SETS', SK: 'SET#pricing', name: { iv: 'x', ct: 'y', tag: 'z' }, activeVersion: 2 });
    await S.writeShareStamp(db, 'engage-test', ORG, { version: 2, status: 'checking', jobId: 'j1' }, { now: new Date('2026-09-17T10:00:00.000Z') });
    const row = H.state.ddb.get('ORG#org_acme#SETS|SET#pricing');
    assert.deepStrictEqual(row.share, { version: 2, status: 'checking', jobId: 'j1', at: '2026-09-17T10:00:00.000Z' });
    assert.deepStrictEqual(row.name, { iv: 'x', ct: 'y', tag: 'z' }, 'the ciphertext name was rewritten');
    assert.strictEqual(row.activeVersion, 2);
  });
  await H.test('a later stamp replaces the map rather than merging stale fields into it', async () => {
    H.reset();
    H.seedRow({ PK: 'ORG#org_acme#SETS', SK: 'SET#pricing' });
    await S.writeShareStamp(db, 'engage-test', ORG, { version: 2, status: 'published', publicSetId: 'orgacme-pricing', publicVersion: 1 });
    await S.writeShareStamp(db, 'engage-test', ORG, { version: 3, status: 'flagged' });
    const row = H.state.ddb.get('ORG#org_acme#SETS|SET#pricing');
    assert.strictEqual(row.share.publicSetId, undefined, 'a flagged v3 still claimed a public id');
    assert.strictEqual(row.share.status, 'flagged');
  });
  await H.test('an unknown status is refused', async () => {
    H.reset();
    await assert.rejects(() => S.writeShareStamp(db, 'engage-test', ORG, { version: 1, status: 'live' }), /refusing/);
  });
  await H.test('the daily cap admits `cap` submits and refuses the next', async () => {
    H.reset();
    const now = new Date('2026-09-17T10:00:00.000Z');
    for (let i = 1; i <= 3; i += 1) {
      const r = await K.reserveSubmit(db, 'engage-test', 'org_acme', { cap: 3, now }); // eslint-disable-line no-await-in-loop
      assert.deepStrictEqual(r, { ok: true, submits: i });
    }
    assert.deepStrictEqual(await K.reserveSubmit(db, 'engage-test', 'org_acme', { cap: 3, now }), { ok: false, cap: 3 });
    const nextDay = await K.reserveSubmit(db, 'engage-test', 'org_acme', { cap: 3, now: new Date('2026-09-18T00:00:01.000Z') });
    assert.deepStrictEqual(nextDay, { ok: true, submits: 1 }, 'the cap did not reset with the UTC day');
    assert.ok(H.state.ddb.has('ORG#org_acme|CHECKS#2026-09-17'), 'the counter is not on the org partition');
  });
  await H.test('units accumulate on the same day row', async () => {
    H.reset();
    const now = new Date('2026-09-17T10:00:00.000Z');
    await K.reserveSubmit(db, 'engage-test', 'org_acme', { cap: 20, now });
    await K.recordUnits(db, 'engage-test', 'org_acme', 31, { now });
    await K.recordUnits(db, 'engage-test', 'org_acme', 2, { now });
    assert.strictEqual(H.state.ddb.get('ORG#org_acme|CHECKS#2026-09-17').units, 33);
  });
  H.summary();
})();
