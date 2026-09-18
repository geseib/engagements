// tests/review-log.js
const path = require('path');
const assert = require('assert');
const H = require('./helpers/moderation-harness');
H.install();
const { DynamoDBDocumentClient } = require('@aws-sdk/lib-dynamodb');
const db = DynamoDBDocumentClient.from({});
const L = require(path.join(H.REPO, 'lambda-functions/admin/shared/review-log.js'));
const ORG = { scope: 'org', orgId: 'org_acme', setId: 'pricing' };
(async () => {
  console.log('\nreview log\n');
  await H.test('the partition names the set once per scope, and platform has no org segment', () => {
    assert.strictEqual(L.reviewLogPk(ORG), 'REVIEWLOG#org#org_acme#pricing');
    assert.strictEqual(L.reviewLogPk({ scope: 'platform', setId: 'lessons' }), 'REVIEWLOG#platform#-#lessons');
    assert.strictEqual(L.reviewLogPk({ scope: 'public', setId: 'orgacme-pricing' }), 'REVIEWLOG#public#-#orgacme-pricing');
  });
  await H.test('events append in order, even inside one millisecond, and read back oldest first', async () => {
    H.reset();
    const now = new Date('2026-09-17T10:00:00.000Z');
    await L.appendReviewEvent(db, 'engage-test', ORG, 'escalated', { version: 2 }, { now });
    await L.appendReviewEvent(db, 'engage-test', ORG, 'checked', { version: 2, outcome: 'escalated' }, { now });
    await L.appendReviewEvent(db, 'engage-test', ORG, 'decided', { version: 2, decision: 'approve' }, { now: new Date('2026-09-18T10:00:00.000Z') });
    const log = await L.readReviewLog(db, 'engage-test', ORG);
    assert.deepStrictEqual(log.map((e) => e.event), ['escalated', 'checked', 'decided']);
    assert.strictEqual(log[1].outcome, 'escalated');
    assert.strictEqual(log[0].ttl, undefined, 'the record must not expire');
    const forged = await L.appendReviewEvent(db, 'engage-test', ORG, 'checked', { event: 'looked-at', PK: 'ELSEWHERE', at: '1999-01-01T00:00:00.000Z' }, { now: new Date('2026-09-19T10:00:00.000Z') });
    assert.strictEqual(forged.event, 'checked');
    assert.strictEqual(forged.PK, L.reviewLogPk(ORG));
    assert.strictEqual(forged.at, '2026-09-19T10:00:00.000Z');
  });
  await H.test('an unknown event name is refused rather than stored', async () => {
    H.reset();
    await assert.rejects(() => L.appendReviewEvent(db, 'engage-test', ORG, 'looked-at', {}), /refusing/);
  });
  H.summary();
})();
