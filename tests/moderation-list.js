// tests/moderation-list.js
const path = require('path');
const assert = require('assert');
const H = require('./helpers/moderation-harness');
H.install();
const { DynamoDBDocumentClient } = require('@aws-sdk/lib-dynamodb');
const db = DynamoDBDocumentClient.from({});
const T = 'engage-test';
const Q = require(path.join(H.REPO, 'lambda-functions/admin/shared/moderation-queue.js'));
const { handler } = require(path.join(H.REPO, 'lambda-functions/admin/moderation-list.js'));
const parse = (res) => JSON.parse(res.body || '{}');
async function seed() {
  H.reset();
  await Q.upsertQueueRow(db, T, { ref: { scope: 'org', orgId: 'org_acme', setId: 'safety' }, version: 2, reason: 'escalated', orgName: 'Acme', title: 'Safety walkthrough', gameType: 'trivia', questionCount: 30, bands: { HIGH: 0, MEDIUM: 2 }, uncertainQuestionIds: ['q014', 'q022'] }, { now: new Date('2026-09-15T10:00:00.000Z') });
  await Q.upsertQueueRow(db, T, { ref: { scope: 'org', orgId: 'org_beta', setId: 'onboarding' }, version: 1, reason: 'appealed', orgName: 'Beta', title: 'Onboarding', gameType: 'poll', questionCount: 12, appealMessage: 'It is a clinical set.' }, { now: new Date('2026-09-17T09:00:00.000Z') });
}
(async () => {
  console.log('\nGET /admin/moderation\n');
  await H.test('staff in platform mode see the queue oldest first, with the head facts', async () => {
    await seed();
    const res = await handler(H.platformEvent({ method: 'GET' }), H.ctx());
    assert.strictEqual(res.statusCode, 200, res.body);
    const body = parse(res);
    assert.strictEqual(body.count, 2);
    assert.deepStrictEqual(body.items.map((i) => i.setId), ['safety', 'onboarding']);
    assert.strictEqual(body.oldestWaitingSince, '2026-09-15T10:00:00.000Z');
    assert.strictEqual(body.items[0].sk, 'org_acme#safety#v2');
    assert.deepStrictEqual(body.items[0].reasons, ['escalated']);
    assert.strictEqual(body.items[1].appealMessage, 'It is a clinical set.');
  });
  await H.test('an empty queue is an empty list, not an error', async () => {
    H.reset();
    const res = await handler(H.platformEvent({ method: 'GET' }), H.ctx());
    assert.strictEqual(res.statusCode, 200);
    assert.deepStrictEqual(parse(res), { items: [], count: 0, oldestWaitingSince: null });
  });
  await H.test('an org admin is refused, and so is staff standing inside an org', async () => {
    await seed();
    const org = await handler(H.orgEvent({ orgId: 'org_acme', role: 'owner', method: 'GET' }), H.ctx());
    assert.strictEqual(org.statusCode, 403, org.body);
    const staffInOrg = await handler(H.orgEvent({ orgId: 'org_acme', role: 'owner', method: 'GET', groups: 'admins' }), H.ctx());
    assert.strictEqual(staffInOrg.statusCode, 403, staffInOrg.body);
  });
  H.summary();
})();
