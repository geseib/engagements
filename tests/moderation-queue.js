// tests/moderation-queue.js
const path = require('path');
const assert = require('assert');
const H = require('./helpers/moderation-harness');
H.install();
const { DynamoDBDocumentClient } = require('@aws-sdk/lib-dynamodb');
const db = DynamoDBDocumentClient.from({});
const Q = require(path.join(H.REPO, 'lambda-functions/admin/shared/moderation-queue.js'));
const ORG = { scope: 'org', orgId: 'org_acme', setId: 'pricing' };
(async () => {
  console.log('\nmoderation queue\n');
  await H.test('the SK is stable per set version and carries no timestamp', () => {
    assert.strictEqual(Q.queueSk(ORG, 2), 'org_acme#pricing#v2');
    assert.strictEqual(Q.queueSk({ scope: 'platform', setId: 'lessons' }), 'PLATFORM#lessons');
    assert.strictEqual(Q.queueSk({ scope: 'public', setId: 'orgacme-pricing' }), 'PUBLIC#orgacme-pricing');
    assert.strictEqual(Q.queueSk(ORG, 'not-a-number'), 'org_acme#pricing#v0');
  });
  await H.test('a repeat upsert bumps the row: reasons union, latestAt moves, waitingSince stays', async () => {
    H.reset();
    const t1 = new Date('2026-09-17T10:00:00.000Z'); const t2 = new Date('2026-09-18T10:00:00.000Z');
    await Q.upsertQueueRow(db, 'engage-test', { ref: ORG, version: 2, reason: 'escalated', title: 'Pricing', orgName: 'Acme', questionCount: 30, bands: { VIOLENCE: 'MEDIUM' } }, { now: t1 });
    await Q.upsertQueueRow(db, 'engage-test', { ref: ORG, version: 2, reason: 'appealed', appealMessage: 'It is a history set.' }, { now: t2 });
    const rows = H.rowsWhere((r) => r.PK === 'MODERATION');
    assert.strictEqual(rows.length, 1, 'a repeat made a second row');
    assert.deepStrictEqual([...rows[0].reasons].sort(), ['appealed', 'escalated']);
    assert.strictEqual(rows[0].waitingSince, t1.toISOString());
    assert.strictEqual(rows[0].latestAt, t2.toISOString());
    assert.strictEqual(rows[0].title, 'Pricing', 'a bump dropped the pointer fields');
    assert.strictEqual(rows[0].appealMessage, 'It is a history set.');
    assert.strictEqual(rows[0].version, 2);
  });
  await H.test('listQueue returns oldest-waiting first and deleteQueueRow removes one', async () => {
    H.reset();
    await Q.upsertQueueRow(db, 'engage-test', { ref: { scope: 'org', orgId: 'org_b', setId: 'x' }, version: 1, reason: 'escalated', title: 'B' }, { now: new Date('2026-09-17T00:00:00.000Z') });
    await Q.upsertQueueRow(db, 'engage-test', { ref: ORG, version: 2, reason: 'escalated', title: 'A' }, { now: new Date('2026-09-18T00:00:00.000Z') });
    const list = await Q.listQueue(db, 'engage-test');
    assert.deepStrictEqual(list.map((r) => r.title), ['B', 'A']);
    await Q.deleteQueueRow(db, 'engage-test', Q.queueSk(ORG, 2));
    assert.strictEqual((await Q.listQueue(db, 'engage-test')).length, 1);
  });
  await H.test('a row never carries question text', async () => {
    H.reset();
    await Q.upsertQueueRow(db, 'engage-test', { ref: ORG, version: 2, reason: 'escalated', title: 'T', questions: [{ Title: 'secret' }], snapshot: { x: 1 } });
    const [row] = H.rowsWhere((r) => r.PK === 'MODERATION');
    assert.strictEqual(row.questions, undefined);
    assert.strictEqual(row.snapshot, undefined);
  });
  H.summary();
})();
