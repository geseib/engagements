// tests/moderation-unversioned-set.js
/**
 * 7a — A QUEUE ROW FOR A LEGACY UNVERSIONED ORG SET CAN BE OPENED AND DECIDED.
 *
 * check-question-set.js resolves `version = null` for a set with no
 * `activeVersion` and no pin (set-version.js `resolvePartitionFromMeta`,
 * source: 'legacy') — the permanently supported READ state for a set that
 * predates versioning; it is never migrated. moderation-queue.js's `queueSk`
 * used to write `#v0` for it (`versionOf(null) === 0`), and both
 * moderation-get.js and moderation-decide.js refuse to parse anything but
 * `#v([1-9]\d*)` — deliberately, since `v0` is not a real version. So the row
 * LISTED (moderation-list.js reads the queue partition raw) but could be
 * neither opened nor decided: a 400 either way.
 *
 * The fix makes the writer and both readers agree on one key form for
 * "unversioned": no `#v` suffix at all, rather than `#v0`.
 */
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
const V = require(path.join(H.REPO, 'lambda-functions/admin/shared/set-version.js'));
const { publicSetIdFor } = require(path.join(H.REPO, 'lambda-functions/admin/shared/publish-set.js'));
const { handler: getHandler } = require(path.join(H.REPO, 'lambda-functions/admin/moderation-get.js'));
const { handler: decideHandler } = require(path.join(H.REPO, 'lambda-functions/admin/moderation-decide.js'));
const parse = (res) => JSON.parse(res.body || '{}');

const SRC = { scope: 'org', orgId: 'org_acme', setId: 'legacyset' };
const PUB = publicSetIdFor('org_acme', 'legacyset');
const KEY = 'moderation/org_acme/legacyset/vnull/2026-09-17T10-00-00-000Z.json';
const SNAPSHOT = {
  version: null, contentHash: 'c'.repeat(64), source: SRC,
  meta: { name: 'Legacy set', description: 'Predates versioning', engagementType: 'trivia' },
  categories: [{ SK: 'CATEGORY#c001', Name: 'General' }],
  questions: [
    { SK: 'QUESTION#c001#001', Category: 'General', Title: 'Q1', Detail: 'd1', optionA: 'A', optionB: 'B', correctAnswer: 'OptionA' },
  ],
};

async function seed() {
  H.reset();
  H.state.s3.set(`prompts-test/${KEY}`, JSON.stringify(SNAPSHOT));
  // No activeVersion, no versions[] — the legacy shape resolvePartitionFromMeta
  // reads as `source: 'legacy'` (check-question-set.js's version = null).
  H.seedRow({ ...V.setMetadataKey(SRC), name: 'Legacy set', share: { status: 'escalated' } });
  await R.writeReview(db, T, SRC, null, {
    status: R.STATUS.ESCALATED,
    reasons: ['guardrail'],
    snapshotKey: KEY,
    contentHash: 'c'.repeat(64),
    findings: [{ questionId: 'c001#001', category: 'VIOLENCE', band: 'MEDIUM', explanation: 'x' }],
  });
  await Q.upsertQueueRow(db, T, {
    ref: SRC, version: null, reason: 'escalated', orgName: 'Acme', title: 'Legacy set',
    gameType: 'trivia', questionCount: 1, snapshotKey: KEY, contentHash: 'c'.repeat(64),
  });
}
const get = (sk) => getHandler(H.platformEvent({ method: 'GET', path: { sk: encodeURIComponent(sk) } }), H.ctx());
const decide = (body) => decideHandler(H.platformEvent({ method: 'POST', body, username: 'dai' }), H.ctx());

(async () => {
  console.log('\nan unversioned org set can be queued, opened and decided\n');

  await H.test('the queued row lists at the bare key, with no #v suffix', async () => {
    await seed();
    const rows = H.rowsWhere((r) => r.PK === Q.QUEUE_PK);
    assert.strictEqual(rows.length, 1);
    assert.strictEqual(rows[0].SK, 'org_acme#legacyset');
  });

  await H.test('GET opens it — pointer, review and snapshot all come back', async () => {
    await seed();
    const res = await get('org_acme#legacyset');
    assert.strictEqual(res.statusCode, 200, res.body);
    const body = parse(res);
    assert.strictEqual(body.pointer.sk, 'org_acme#legacyset');
    assert.strictEqual(body.review.status, 'escalated');
    assert.strictEqual(body.snapshot.meta.name, 'Legacy set');
    assert.strictEqual(body.snapshot.questions[0].questionId, 'c001#001');
  });

  await H.test('DECIDE approves it: published, stamped, logged, the queue clears', async () => {
    await seed();
    const res = await decide({ sk: 'org_acme#legacyset', decision: 'approve', note: 'Fine.' });
    assert.strictEqual(res.statusCode, 200, res.body);
    assert.deepStrictEqual(parse(res), { decision: 'approve', publicSetId: PUB, publicVersion: 1 });
    const review = await R.readReview(db, T, SRC, null);
    assert.strictEqual(review.status, 'passed');
    assert.strictEqual(H.rowsWhere((r) => r.PK === Q.QUEUE_PK).length, 0, 'the queue row is gone');
    const pubMeta = (await db.send(new GetCommand({
      TableName: T, Key: V.setMetadataKey({ scope: 'public', orgId: '', setId: PUB }),
    }))).Item;
    assert.strictEqual(pubMeta.activeVersion, 1);
  });

  await H.test('DECIDE rejects it too, and clears the queue', async () => {
    await seed();
    const res = await decide({ sk: 'org_acme#legacyset', decision: 'reject', note: 'No.' });
    assert.strictEqual(res.statusCode, 200, res.body);
    const review = await R.readReview(db, T, SRC, null);
    assert.strictEqual(review.status, 'flagged');
    assert.strictEqual(H.rowsWhere((r) => r.PK === Q.QUEUE_PK).length, 0);
  });

  H.summary();
})();
