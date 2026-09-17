// tests/set-check-lock.js
const path = require('path');
const assert = require('assert');
const H = require('./helpers/moderation-harness');
H.install();
const { DynamoDBDocumentClient } = require('@aws-sdk/lib-dynamodb');
const db = DynamoDBDocumentClient.from({});
const R = require(path.join(H.REPO, 'lambda-functions/admin/shared/set-review.js'));
const REF = { scope: 'org', orgId: 'org_acme', setId: 'pricing' };
const T = 'engage-test';
(async () => {
  console.log('\nthe check lock\n');
  await H.test('the first submit takes the lock; a second, ten minutes later, is refused', async () => {
    H.reset();
    const t0 = new Date('2026-09-17T10:00:00.000Z');
    assert.strictEqual(await R.beginCheck(db, T, REF, 2, { jobId: 'j1', now: t0 }), true);
    assert.strictEqual(await R.beginCheck(db, T, REF, 2, { jobId: 'j2', now: new Date(t0.getTime() + 10 * 60000) }), false);
    assert.strictEqual((await R.readReview(db, T, REF, 2)).jobId, 'j1', 'the second submit overwrote the first');
  });
  await H.test('a checking row older than fifteen minutes is stale and can be taken again', async () => {
    H.reset();
    const t0 = new Date('2026-09-17T10:00:00.000Z');
    await R.beginCheck(db, T, REF, 2, { jobId: 'j1', now: t0 });
    assert.strictEqual(await R.beginCheck(db, T, REF, 2, { jobId: 'j2', now: new Date(t0.getTime() + 16 * 60000) }), true);
    assert.strictEqual((await R.readReview(db, T, REF, 2)).jobId, 'j2');
  });
  await H.test('a flagged version can be re-submitted at once', async () => {
    H.reset();
    await R.writeReview(db, T, REF, 2, { status: R.STATUS.FLAGGED });
    assert.strictEqual(await R.beginCheck(db, T, REF, 2, { jobId: 'j3' }), true);
  });
  await H.test('abandonCheck removes only the checking row that carries the failed job', async () => {
    H.reset();
    await R.beginCheck(db, T, REF, 2, { jobId: 'j1' });
    await R.abandonCheck(db, T, REF, 2, { jobId: 'other' });
    assert.strictEqual((await R.readReview(db, T, REF, 2)).status, R.STATUS.CHECKING, 'a foreign jobId removed the lock');
    await R.abandonCheck(db, T, REF, 2, { jobId: 'j1' });
    assert.strictEqual((await R.readReview(db, T, REF, 2)).status, R.STATUS.UNREVIEWED);
  });
  await H.test('transitionReview moves flagged to appealed and refuses from any other state', async () => {
    H.reset();
    await R.writeReview(db, T, REF, 2, { status: R.STATUS.FLAGGED, findings: [{ questionId: 'q1', category: 'VIOLENCE', band: 'HIGH' }] });
    const moved = await R.transitionReview(db, T, REF, 2, R.STATUS.FLAGGED, { status: R.STATUS.APPEALED, appealMessage: 'history' });
    assert.strictEqual(moved.status, R.STATUS.APPEALED);
    assert.strictEqual(moved.findings.length, 1, 'the findings were lost on transition');
    assert.strictEqual(await R.transitionReview(db, T, REF, 2, R.STATUS.FLAGGED, { status: R.STATUS.APPEALED }), null);
    const passed = await R.transitionReview(db, T, REF, 2, [R.STATUS.ESCALATED, R.STATUS.APPEALED], { status: R.STATUS.PASSED, decidedBy: 'dai' });
    assert.strictEqual(passed.status, R.STATUS.PASSED);
    const moved2 = await R.transitionReview(db, T, REF, 2, R.STATUS.PASSED, { status: R.STATUS.FLAGGED, PK: 'ELSEWHERE', SK: 'NOTREVIEW', version: 99 });
    assert.deepStrictEqual({ PK: moved2.PK, SK: moved2.SK, version: moved2.version }, { ...R.reviewKey(REF, 2), version: 2 }, 'a patch moved the row or relabelled its version');
    assert.strictEqual((await R.readReview(db, T, REF, 2)).status, R.STATUS.FLAGGED);
    assert.strictEqual(H.state.ddb.has('ELSEWHERE|NOTREVIEW'), false, 'a row was written under the forged key');
  });
  await H.test('isUnfinished is true only for a checking row past the stale window', () => {
    const now = Date.parse('2026-09-17T10:20:00.000Z');
    assert.strictEqual(R.isUnfinished({ status: 'checking', checkedAt: '2026-09-17T10:00:00.000Z' }, now), true);
    assert.strictEqual(R.isUnfinished({ status: 'checking', checkedAt: '2026-09-17T10:10:00.000Z' }, now), false);
    assert.strictEqual(R.isUnfinished({ status: 'flagged', checkedAt: '2026-09-17T09:00:00.000Z' }, now), false);
  });
  H.summary();
})();
