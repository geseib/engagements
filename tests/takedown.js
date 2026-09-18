// tests/takedown.js
const path = require('path');
const assert = require('assert');
const H = require('./helpers/moderation-harness');
H.install();
const { DynamoDBDocumentClient, GetCommand } = require('@aws-sdk/lib-dynamodb');
const db = DynamoDBDocumentClient.from({});
const T = 'engage-test';
const V = require(path.join(H.REPO, 'lambda-functions/admin/shared/set-version.js'));
const R = require(path.join(H.REPO, 'lambda-functions/admin/shared/set-review.js'));
const L = require(path.join(H.REPO, 'lambda-functions/admin/shared/review-log.js'));
const S = require(path.join(H.REPO, 'lambda-functions/admin/shared/share-stamp.js'));
const Q = require(path.join(H.REPO, 'lambda-functions/admin/shared/moderation-queue.js'));
const { publicSetIdFor } = require(path.join(H.REPO, 'lambda-functions/admin/shared/publish-set.js'));
const { handler } = require(path.join(H.REPO, 'lambda-functions/admin/public-library-item.js'));
const parse = (res) => JSON.parse(res.body || '{}');
const SRC = { scope: 'org', orgId: 'org_acme', setId: 'safety' };
const PUB = publicSetIdFor('org_acme', 'safety');
const PUBREF = { scope: 'public', orgId: '', setId: PUB };
const FINDINGS = [{ questionId: 'c001#014', category: 'VIOLENCE', band: 'MEDIUM', explanation: 'x' }];
async function seed({ versions = 5, questions = 200 } = {}) {
  H.reset();
  H.seedRow({ ...V.setMetadataKey(SRC), name: 'x', activeVersion: 2, versions: [{ version: 2 }] });
  await R.writeReview(db, T, SRC, 2, { status: R.STATUS.PASSED, findings: FINDINGS, contentHash: 'c'.repeat(64), checkedBy: 'guardrail' });
  await S.writeShareStamp(db, T, SRC, { version: 2, status: 'published', publicSetId: PUB, publicVersion: versions, contentHash: 'c'.repeat(64) });
  H.seedRow({ ...V.setMetadataKey(PUBREF), name: 'Safety walkthrough', description: 'Site safety', engagementType: 'trivia', activeVersion: versions, versions: Array.from({ length: versions }, (_, i) => ({ version: i + 1, createdAt: '2026-09-17T10:00:00.000Z', questionCount: questions })), sourceOrgId: 'org_acme', sourceOrgName: 'Acme', sourceSetId: 'safety', sourceVersion: 2, contentHash: 'c'.repeat(64), questionCount: questions, sensitivity: ['graphic-medical'] });
  for (let v = 1; v <= versions; v += 1) {
    const pk = V.setPartition(PUBREF, v);
    H.seedRow({ PK: pk, SK: 'CATEGORY#c001', Name: 'Injuries' });
    for (let n = 1; n <= questions; n += 1) H.seedRow({ PK: pk, SK: `QUESTION#c001#${String(n).padStart(3, '0')}`, Title: `Q${n}` });
    H.seedRow({ ...R.reviewKey(PUBREF, v), status: 'passed', contentHash: 'c'.repeat(64), version: v });
    H.seedRow({ ...R.publishedKey(SRC, 2), publicSetId: PUB, publicVersion: v, at: '2026-09-17T10:00:00.000Z' });
  }
  await L.appendReviewEvent(db, T, SRC, 'published', { version: 2, publicSetId: PUB, publicVersion: versions });
  await Q.upsertQueueRow(db, T, { ref: SRC, version: 2, reason: 'reported', orgName: 'Acme', title: 'Safety walkthrough', publicSetId: PUB });
}
const publicRows = () => H.rowsWhere((r) => String(r.PK).startsWith(`PUBLIC#SET#${PUB}`) || (r.PK === V.setMetadataKey(PUBREF).PK && r.SK === V.setMetadataKey(PUBREF).SK));
// R8: S.readShareStamp is a pure projector `(meta) => meta.share || null`, not
// an async `(db, table, ref)` reader — fetch the org metadata row first and
// project through it, exactly as Task 4's test does.
const stampOf = async () => S.readShareStamp((await db.send(new GetCommand({ TableName: T, Key: V.setMetadataKey(SRC) }))).Item);
const get = () => handler(H.platformEvent({ method: 'GET', path: { publicSetId: PUB } }), H.ctx());
const del = (body, event) => handler(event || H.platformEvent({ method: 'DELETE', body, path: { publicSetId: PUB }, username: 'dai' }), H.ctx());
(async () => {
  console.log('\nGET|DELETE /admin/public-library/{publicSetId}\n');
  await H.test('GET is the standing of a public set: source, versions, review, notice, log', async () => {
    await seed({ versions: 2, questions: 3 });
    const res = await get();
    assert.strictEqual(res.statusCode, 200, res.body);
    const b = parse(res);
    assert.strictEqual(b.publicSetId, PUB);
    assert.strictEqual(b.sourceOrgName, 'Acme');
    assert.strictEqual(b.sourceVersion, 2);
    assert.strictEqual(b.publicVersion, 2);
    assert.deepStrictEqual(b.sensitivity, ['graphic-medical']);
    assert.strictEqual(b.review.status, 'passed');
    assert.strictEqual(b.review.findings.length, 1);
    assert.strictEqual(b.log[0].event, 'published');
  });
  await H.test('takedown deletes every public row in batches, logs the note, flags the org stamp, and never touches the org REVIEW row', async () => {
    await seed();
    const before = publicRows().length;
    assert.ok(before > 1000, `fixture too small: ${before}`);
    const reviewBefore = JSON.stringify(await R.readReview(db, T, SRC, 2));
    const res = await del({ note: 'Reported for graphic detail; taken down pending an edit.' });
    assert.strictEqual(res.statusCode, 200, res.body);
    assert.deepStrictEqual(parse(res), { takenDown: PUB });
    assert.strictEqual(publicRows().length, 0, 'the public partition is gone');
    assert.strictEqual(JSON.stringify(await R.readReview(db, T, SRC, 2)), reviewBefore, 'the org REVIEW row is untouched (D11)');
    const stamp = await stampOf();
    assert.strictEqual(stamp.status, 'flagged');
    assert.strictEqual(stamp.note, 'Reported for graphic detail; taken down pending an edit.');
    assert.strictEqual(stamp.version, 2);
    const events = await L.readReviewLog(db, T, SRC);
    const td = events.find((e) => e.event === 'taken-down');
    assert.ok(td, 'taken-down is logged');
    assert.strictEqual(td.note, 'Reported for graphic detail; taken down pending an edit.');
    assert.strictEqual(td.reviewer, 'dai');
    assert.strictEqual(H.rowsWhere((r) => r.PK === Q.QUEUE_PK).length, 0, 'nothing left to decide');
    assert.strictEqual((await get()).statusCode, 404, 'gone for everyone');
  });
  await H.test('a stale stamp is left alone: the org already re-shared as a different public set', async () => {
    await seed({ versions: 1, questions: 2 });
    await S.writeShareStamp(db, T, SRC, { version: 3, status: 'published', publicSetId: 'somebody-else', publicVersion: 1 });
    const res = await del({ note: 'x' });
    assert.strictEqual(res.statusCode, 200, res.body);
    const stamp = await stampOf();
    assert.strictEqual(stamp.publicSetId, 'somebody-else', 'the condition on share.publicSetId did not apply');
    assert.strictEqual(stamp.status, 'published');
  });
  await H.test('a takedown needs a note, an unknown set is 404, and an org admin is refused', async () => {
    await seed({ versions: 1, questions: 2 });
    assert.strictEqual((await del({})).statusCode, 400);
    assert.strictEqual((await del({ note: 'x'.repeat(501) })).statusCode, 400);
    assert.strictEqual((await handler(H.platformEvent({ method: 'DELETE', body: { note: 'x' }, path: { publicSetId: 'nope' } }), H.ctx())).statusCode, 404);
    const org = await handler(H.orgEvent({ orgId: 'org_acme', role: 'owner', method: 'DELETE', body: { note: 'x' }, path: { publicSetId: PUB } }), H.ctx());
    assert.strictEqual(org.statusCode, 403);
  });
  H.summary();
})();
