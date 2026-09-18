// tests/moderation-decide.js
const path = require('path');
const assert = require('assert');
const H = require('./helpers/moderation-harness');
H.install();
const { DynamoDBDocumentClient, GetCommand } = require('@aws-sdk/lib-dynamodb');
const db = DynamoDBDocumentClient.from({});
const T = 'engage-test';
process.env.AI_PROMPTS_BUCKET = 'prompts-test';
const Q = require(path.join(H.REPO, 'lambda-functions/admin/shared/moderation-queue.js'));
const R = require(path.join(H.REPO, 'lambda-functions/admin/shared/set-review.js'));
const L = require(path.join(H.REPO, 'lambda-functions/admin/shared/review-log.js'));
const S = require(path.join(H.REPO, 'lambda-functions/admin/shared/share-stamp.js'));
const V = require(path.join(H.REPO, 'lambda-functions/admin/shared/set-version.js'));
const { publicSetIdFor } = require(path.join(H.REPO, 'lambda-functions/admin/shared/publish-set.js'));
const { handler } = require(path.join(H.REPO, 'lambda-functions/admin/moderation-decide.js'));
const parse = (res) => JSON.parse(res.body || '{}');
const SRC = { scope: 'org', orgId: 'org_acme', setId: 'safety' };
const PUB = publicSetIdFor('org_acme', 'safety');
const KEY = 'moderation/org_acme/safety/v2/2026-09-17T10-00-00-000Z.json';
// Ruling R5: publishSnapshot derives the public set id from snapshot.source
// (setRef(snapshot.source) -> publicSetIdFor(source.orgId, source.setId)), and
// every real snapshot carries one (shared/publishable.js buildSnapshot writes
// source: {scope, orgId, setId}). A sourceless fixture would still "pass" by
// silently publishing to publicSetIdFor('', '') = '-' instead of PUB.
const SNAPSHOT = {
  version: 2, contentHash: 'c'.repeat(64), source: SRC,
  meta: { name: 'Safety walkthrough', description: 'Site safety', engagementType: 'trivia', promptId: 'org-workie' },
  categories: [{ SK: 'CATEGORY#c001', Name: 'Injuries' }],
  questions: [
    { SK: 'QUESTION#c001#001', Category: 'Injuries', Title: 'A clean one', Detail: 'Which glove?', optionA: 'Nitrile', optionB: 'None', correctAnswer: 'OptionA' },
    { SK: 'QUESTION#c001#014', Category: 'Injuries', Title: 'Describe the injury', Detail: 'In detail.', optionA: 'A', optionB: 'B', correctAnswer: 'OptionA' },
  ],
};
const ORG_ROW = { PK: V.setPartition(SRC, 2), SK: 'QUESTION#c001#001', Title: 'ENCRYPTED-LOOKING', Detail: 'the org copy, untouched' };
async function seed(status = R.STATUS.ESCALATED) {
  H.reset();
  H.state.s3.set(`prompts-test/${KEY}`, JSON.stringify(SNAPSHOT));
  H.seedRow({ ...V.setMetadataKey(SRC), name: 'x', activeVersion: 2, versions: [{ version: 2 }], share: { status: 'escalated', version: 2 } });
  H.seedRow({ ...ORG_ROW });
  await R.writeReview(db, T, SRC, 2, { status, reasons: ['guardrail'], snapshotKey: KEY, contentHash: 'c'.repeat(64), promptDropped: true, findings: [{ questionId: 'c001#014', category: 'VIOLENCE', band: 'MEDIUM', explanation: 'x' }] });
  await Q.upsertQueueRow(db, T, { ref: SRC, version: 2, reason: status === R.STATUS.APPEALED ? 'appealed' : 'escalated', orgName: 'Acme', title: 'Safety walkthrough', gameType: 'trivia', questionCount: 2, snapshotKey: KEY, contentHash: 'c'.repeat(64) });
}
const decide = (body, event = H.platformEvent({ method: 'POST', body, username: 'dai' })) => handler(event, H.ctx());
const rowsUnder = (pk) => H.rowsWhere((r) => r.PK === pk);
(async () => {
  console.log('\nPOST /admin/moderation/decide\n');
  await H.test('approve publishes the snapshot byte for byte, records who decided, and clears the queue', async () => {
    await seed();
    const res = await decide({ sk: 'org_acme#safety#v2', decision: 'approve', note: 'Clinical, not gratuitous.', notice: ['graphic-medical'] });
    assert.strictEqual(res.statusCode, 200, res.body);
    assert.deepStrictEqual(parse(res), { decision: 'approve', publicSetId: PUB, publicVersion: 1 });
    const review = await R.readReview(db, T, SRC, 2);
    assert.strictEqual(review.status, 'passed');
    assert.strictEqual(review.reviewer, 'dai');
    assert.strictEqual(review.note, 'Clinical, not gratuitous.');
    assert.deepStrictEqual(review.notice, ['graphic-medical']);
    assert.strictEqual(review.findings.length, 1, 'the findings survive the decision');
    const pubMeta = (await db.send(new GetCommand({ TableName: T, Key: V.setMetadataKey({ scope: 'public', orgId: '', setId: PUB }) }))).Item;
    assert.strictEqual(pubMeta.sourceOrgName, 'Acme');
    assert.deepStrictEqual(pubMeta.sensitivity, ['graphic-medical']);
    assert.strictEqual(pubMeta.promptDropped, true, 'the org Workie never reaches the public copy');
    const pubRows = rowsUnder(V.setPartition({ scope: 'public', orgId: '', setId: PUB }, 1)).filter((r) => String(r.SK).startsWith('QUESTION#'));
    assert.strictEqual(pubRows.length, 2);
    assert.strictEqual(pubRows.find((r) => r.SK === 'QUESTION#c001#014').Detail, 'In detail.', 'published from the snapshot');
    assert.deepStrictEqual(rowsUnder(ORG_ROW.PK).find((r) => r.SK === ORG_ROW.SK), ORG_ROW, 'the org partition is untouched');
    const srcMeta = (await db.send(new GetCommand({ TableName: T, Key: V.setMetadataKey(SRC) }))).Item;
    const stamp = S.readShareStamp(srcMeta);
    assert.strictEqual(stamp.status, 'published');
    assert.strictEqual(stamp.publicSetId, PUB);
    const events = (await L.readReviewLog(db, T, SRC)).map((e) => e.event);
    assert.ok(events.includes('decided') && events.includes('published'), `log: ${events}`);
    assert.strictEqual(H.rowsWhere((r) => r.PK === Q.QUEUE_PK).length, 0, 'the queue row is gone');
    assert.ok(H.state.s3.has(`prompts-test/${KEY}`), 'the snapshot is kept on approve (D9)');
  });
  await H.test('reject flags the version with the note, deletes the snapshot, and clears the queue', async () => {
    await seed(R.STATUS.APPEALED);
    const res = await decide({ sk: 'org_acme#safety#v2', decision: 'reject', note: 'Q14 needs the injury detail removed.' });
    assert.strictEqual(res.statusCode, 200, res.body);
    const review = await R.readReview(db, T, SRC, 2);
    assert.strictEqual(review.status, 'flagged');
    assert.strictEqual(review.note, 'Q14 needs the injury detail removed.');
    assert.strictEqual(review.findings.length, 1);
    const srcMeta = (await db.send(new GetCommand({ TableName: T, Key: V.setMetadataKey(SRC) }))).Item;
    const stamp = S.readShareStamp(srcMeta);
    assert.strictEqual(stamp.status, 'flagged');
    assert.strictEqual(stamp.note, 'Q14 needs the injury detail removed.');
    assert.ok(!H.state.s3.has(`prompts-test/${KEY}`), 'the snapshot is deleted on reject');
    assert.strictEqual(H.rowsWhere((r) => r.PK === Q.QUEUE_PK).length, 0);
    assert.strictEqual(rowsUnder(V.setPartition({ scope: 'public', orgId: '', setId: PUB }, 1)).length, 0, 'nothing published');
  });
  await H.test('two reviewers cannot both decide: the second sees who did', async () => {
    await seed();
    const first = await decide({ sk: 'org_acme#safety#v2', decision: 'reject', note: 'no' });
    assert.strictEqual(first.statusCode, 200);
    const second = await decide({ sk: 'org_acme#safety#v2', decision: 'approve' }, H.platformEvent({ method: 'POST', body: { sk: 'org_acme#safety#v2', decision: 'approve' }, username: 'ana' }));
    assert.strictEqual(second.statusCode, 404, 'the queue row is gone, so the second reviewer is told nothing is waiting');
    await seed();
    await R.writeReview(db, T, SRC, 2, { status: R.STATUS.PASSED, reviewer: 'dai', findings: [] });
    const stale = await decide({ sk: 'org_acme#safety#v2', decision: 'reject', note: 'late' });
    assert.strictEqual(stale.statusCode, 409, stale.body);
    assert.match(parse(stale).error, /already decided by dai/i);
  });
  await H.test('approve without a snapshot is refused, and nothing changes', async () => {
    await seed();
    H.state.s3.clear();
    const res = await decide({ sk: 'org_acme#safety#v2', decision: 'approve' });
    assert.strictEqual(res.statusCode, 409, res.body);
    assert.strictEqual((await R.readReview(db, T, SRC, 2)).status, 'escalated');
    assert.strictEqual(H.rowsWhere((r) => r.PK === Q.QUEUE_PK).length, 1, 'still queued');
    // Ruling R5(4): a snapshot that exists but whose provenance names a
    // DIFFERENT org/set is exactly as gone — the judged content is not this
    // set's, so nothing may be changed on its behalf.
    H.state.s3.set(`prompts-test/${KEY}`, JSON.stringify({ ...SNAPSHOT, source: { scope: 'org', orgId: 'org_other', setId: 'safety' } }));
    const res2 = await decide({ sk: 'org_acme#safety#v2', decision: 'approve' });
    assert.strictEqual(res2.statusCode, 409, res2.body);
    assert.strictEqual((await R.readReview(db, T, SRC, 2)).status, 'escalated');
    assert.strictEqual(H.rowsWhere((r) => r.PK === Q.QUEUE_PK).length, 1, 'still queued');
  });
  await H.test('a bad body, a reported-row sk, and a non-staff caller are refused', async () => {
    await seed();
    assert.strictEqual((await decide({ sk: 'org_acme#safety#v2', decision: 'maybe' })).statusCode, 400);
    assert.strictEqual((await decide({ sk: 'org_acme#safety#v2', decision: 'approve', note: 'x'.repeat(501) })).statusCode, 400);
    assert.strictEqual((await decide({ sk: 'PUBLIC#orgacme-safety', decision: 'approve' })).statusCode, 400, 'reported rows are decided in Stage 3');
    const org = await handler(H.orgEvent({ orgId: 'org_acme', role: 'owner', method: 'POST', body: { sk: 'org_acme#safety#v2', decision: 'approve' } }), H.ctx());
    assert.strictEqual(org.statusCode, 403);
  });
  H.summary();
})();
