// tests/share-projection.js
const path = require('path');
const assert = require('assert');
const H = require('./helpers/moderation-harness');
H.install();
const { DynamoDBDocumentClient } = require('@aws-sdk/lib-dynamodb');
const db = DynamoDBDocumentClient.from({});
const T = 'engage-test';
const C = require(path.join(H.REPO, 'lambda-functions/admin/shared/tenant-crypto.js'));
const R = require(path.join(H.REPO, 'lambda-functions/admin/shared/set-review.js'));
const versions = require(path.join(H.REPO, 'lambda-functions/admin/get-set-versions.js')).handler;
const list = require(path.join(H.REPO, 'lambda-functions/admin/get-question-sets.js')).handler;
const ORG = 'org_acme'; const SET = 'safety';
const SRC = { scope: 'org', orgId: ORG, setId: SET };
const parse = (res) => JSON.parse(res.body || '{}');
async function seed() {
  H.reset();
  H.seedRow(await C.encryptItem(ORG, 'set', {
    PK: `ORG#${ORG}#SETS`, SK: `SET#${SET}`, name: 'Safety', engagementType: 'trivia', scope: 'org', orgId: ORG,
    activeVersion: 3, versions: [{ version: 2, questionCount: 30 }, { version: 3, questionCount: 31 }], questionCount: 31,
    share: { version: 3, status: 'flagged', at: '2026-09-17T10:00:00.000Z', contentHash: 'c'.repeat(64) },
  }));
  await R.writeReview(db, T, SRC, 2, { status: R.STATUS.PASSED, checkedAt: '2026-09-01T10:00:00.000Z' });
  H.seedRow({ ...R.publishedKey(SRC, 2), publicSetId: 'orgacme-safety', publicVersion: 1, at: '2026-09-01T10:01:00.000Z' });
  // Seed v3 review with a specific past checkedAt time so isUnfinished detects staleness
  H.seedRow({ ...R.reviewKey(SRC, 3), status: R.STATUS.CHECKING, checkedAt: '2026-09-17T09:00:00.000Z', reasons: [], version: 3 });
}
const ev = (method, extra = {}) => H.orgEvent({ orgId: ORG, role: 'member', method, setId: SET, ...extra });
(async () => {
  console.log('\nshare projections\n');
  await H.test('the version list says which version is public, and which check never finished', async () => {
    await seed();
    const res = await versions(ev('GET'), H.ctx());
    assert.strictEqual(res.statusCode, 200, res.body);
    const [v2, v3] = parse(res);
    assert.deepStrictEqual(v2.published, { publicSetId: 'orgacme-safety', publicVersion: 1, at: '2026-09-01T10:01:00.000Z' });
    assert.strictEqual(v2.review, 'passed');
    assert.strictEqual(v3.published, null);
    assert.strictEqual(v3.review, 'checking');
    assert.strictEqual(v3.unfinished, true, 'a check from hours ago still reads as running');
    assert.strictEqual(v3.checkedAt, '2026-09-17T09:00:00.000Z');
    assert.deepStrictEqual(v3.reasons, []);
  });
  await H.test('the set list carries the share stamp verbatim', async () => {
    await seed();
    const res = await list(ev('GET', { path: {} }), H.ctx());
    assert.strictEqual(res.statusCode, 200, res.body);
    const set = parse(res).questionSets.find((s) => s.id === SET);
    assert.ok(set, 'the org set is not listed');
    assert.deepStrictEqual(set.share, { version: 3, status: 'flagged', at: '2026-09-17T10:00:00.000Z', contentHash: 'c'.repeat(64) });
    assert.strictEqual(set.activeVersion, 3);
  });
  H.summary();
})();
