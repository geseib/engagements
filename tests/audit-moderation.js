/**
 * THE AUDIT LOG, for Engage staff acting on a team's SHARED sets: deciding a
 * publish request (approve / reject), leaving a re-checked listing serving, and
 * taking a published set down. Each is written to the sharing organisation's
 * log before the first write of the decision, with the note as the reason —
 * and a decision whose entry cannot be written changes nothing.
 *
 * The rest of the audit log is pinned by tests/audit-log.js.
 *
 * rejects: a moderation decision or takedown with no entry in the team's log;
 * an entry naming the wrong actor, role or set; a decision that lands although
 * its entry could not be written.
 */
const path = require('path');
const assert = require('assert');
const H = require('./helpers/moderation-harness');
H.install();
const { DynamoDBDocumentClient } = require('@aws-sdk/lib-dynamodb');
const db = DynamoDBDocumentClient.from({});
const T = 'engage-test';
const Q = require(path.join(H.REPO, 'lambda-functions/admin/shared/moderation-queue.js'));
const R = require(path.join(H.REPO, 'lambda-functions/admin/shared/set-review.js'));
const S = require(path.join(H.REPO, 'lambda-functions/admin/shared/share-stamp.js'));
const V = require(path.join(H.REPO, 'lambda-functions/admin/shared/set-version.js'));
const { publicSetIdFor } = require(path.join(H.REPO, 'lambda-functions/admin/shared/publish-set.js'));
const { isEnvelope } = require(path.join(H.REPO, 'lambda-functions/admin/shared/tenant-crypto.js'));
const decideHandler = require(path.join(H.REPO, 'lambda-functions/admin/moderation-decide.js')).handler;
const libraryHandler = require(path.join(H.REPO, 'lambda-functions/admin/public-library-item.js')).handler;

const ORG = 'org_acme';
const SRC = { scope: 'org', orgId: ORG, setId: 'safety' };
const PUB = publicSetIdFor(ORG, 'safety');
const PUBREF = { scope: 'public', orgId: '', setId: PUB };
const KEY = 'moderation/org_acme/safety/v2/2026-09-17T10-00-00-000Z.json';
const SNAPSHOT = {
  version: 2, contentHash: 'c'.repeat(64), source: SRC,
  meta: { name: 'Safety walkthrough', description: 'Site safety', engagementType: 'trivia' },
  categories: [{ SK: 'CATEGORY#c001', Name: 'Injuries' }],
  questions: [{ SK: 'QUESTION#c001#001', Category: 'Injuries', Title: 'A clean one', Detail: 'Which glove?', optionA: 'Nitrile', optionB: 'None', correctAnswer: 'OptionA' }],
};
const AUDIT = `ORG#${ORG}#AUDIT`;
const auditRows = () => H.rowsWhere((r) => r.PK === AUDIT);

/** Staff in platform mode, with the email the authorizer passes. */
const staff = (method, body, pathParameters = {}) => {
  const e = H.platformEvent({ method, body, path: pathParameters, username: 'dai' });
  e.requestContext.authorizer.lambda.email = 'dai@engage.example';
  return e;
};

async function seedRequest() {
  H.reset();
  H.state.s3.set(`prompts-test/${KEY}`, JSON.stringify(SNAPSHOT));
  H.seedRow({ ...V.setMetadataKey(SRC), name: 'x', activeVersion: 2, versions: [{ version: 2 }], share: { status: 'escalated', version: 2 } });
  await R.writeReview(db, T, SRC, 2, { status: R.STATUS.ESCALATED, reasons: ['guardrail'], snapshotKey: KEY, contentHash: 'c'.repeat(64), findings: [] });
  await Q.upsertQueueRow(db, T, { ref: SRC, version: 2, reason: 'escalated', orgName: 'Acme', title: 'Safety walkthrough', gameType: 'trivia', questionCount: 1, snapshotKey: KEY, contentHash: 'c'.repeat(64) });
}

async function withAuditWritesFailing(fn) {
  const map = H.state.ddb;
  const realSet = map.set.bind(map);
  map.set = (k, v) => {
    if (/AUDIT\|/.test(k)) throw Object.assign(new Error('simulated throttle'), { name: 'ProvisionedThroughputExceededException' });
    return realSet(k, v);
  };
  try { return await fn(); } finally { map.set = realSet; }
}

(async () => {
  console.log('\naudit log: moderation and takedowns\n');

  for (const [decision, action, after] of [['approve', 'publish.approve', 'passed'], ['reject', 'publish.reject', 'flagged']]) {
    // eslint-disable-next-line no-await-in-loop
    await H.test(`${decision} is written to the team's log, sealed, as ${action}`, async () => {
      await seedRequest();
      const res = await decideHandler(staff('POST', { sk: `${ORG}#safety#v2`, decision, note: 'Read every question.' }), H.ctx());
      assert.strictEqual(res.statusCode, 200, res.body);
      const [row] = auditRows();
      assert.ok(row, 'no entry in the team\'s log');
      assert.strictEqual(row.Action, action);
      assert.strictEqual(row.Actor.Sub, 'sub-dai');
      assert.strictEqual(row.Actor.Email, 'dai@engage.example');
      assert.strictEqual(row.Actor.Role, 'platform-admin');
      assert.deepStrictEqual(row.Target, { Type: 'set', Id: 'safety' });
      assert.strictEqual(row.Detail.version, 2);
      assert.ok(isEnvelope(row.Title) && isEnvelope(row.Reason), 'stored readable');
      assert.strictEqual(H.plainRow(ORG, row).Reason, 'Read every question.');
      assert.strictEqual(H.plainRow(ORG, row).Title, 'Safety walkthrough');
      assert.strictEqual((await R.readReview(db, T, SRC, 2)).status, after);
      assert.strictEqual(H.rowsWhere((r) => r.PK === 'PLATFORM#AUDIT').length, 1, 'not in the staff index');
    });
  }

  await H.test('a decision whose entry cannot be written is refused, and the request still waits', async () => {
    await seedRequest();
    const res = await withAuditWritesFailing(() => decideHandler(staff('POST', { sk: `${ORG}#safety#v2`, decision: 'approve', note: 'x' }), H.ctx()));
    assert.strictEqual(res.statusCode, 503, res.body);
    assert.strictEqual((await R.readReview(db, T, SRC, 2)).status, R.STATUS.ESCALATED);
    assert.ok(H.rowsWhere((r) => r.PK === Q.QUEUE_PK).length === 1, 'the queue row moved');
    assert.ok(!H.rowsWhere((r) => String(r.PK).startsWith(`PUBLIC#SET#${PUB}`)).length, 'it was published anyway');
    assert.strictEqual(auditRows().length, 0);
  });

  await H.test('a decision someone else already made is refused before any entry is written', async () => {
    await seedRequest();
    await R.transitionReview(db, T, SRC, 2, R.STATUS.ESCALATED, { status: R.STATUS.PASSED, reviewer: 'dee', decidedAt: new Date().toISOString(), note: '' });
    const res = await decideHandler(staff('POST', { sk: `${ORG}#safety#v2`, decision: 'reject', note: 'x' }), H.ctx());
    assert.strictEqual(res.statusCode, 409);
    assert.strictEqual(auditRows().length, 0);
  });

  await H.test('leaving a re-checked listing serving is written to the sharing team\'s log', async () => {
    await seedRequest();
    H.seedRow({ ...V.setMetadataKey(PUBREF), name: 'Safety walkthrough', scope: 'public', orgId: '', activeVersion: 1, versions: [{ version: 1 }], sourceOrgId: ORG, sourceSetId: 'safety', sourceVersion: 2 });
    await Q.upsertQueueRow(db, T, { ref: PUBREF, version: 2, reason: 'escalated', orgId: ORG, title: 'Safety walkthrough', publicSetId: PUB, recheck: true });
    const res = await decideHandler(staff('POST', { sk: `PUBLIC#${PUB}`, decision: 'leave', note: 'The approval stands.' }), H.ctx());
    assert.strictEqual(res.statusCode, 200, res.body);
    const [row] = auditRows();
    assert.strictEqual(row && row.Action, 'publish.leave-serving');
    assert.strictEqual(row.Detail.publicSetId, PUB);
    assert.strictEqual(H.plainRow(ORG, row).Reason, 'The approval stands.');
  });

  /* ── Takedown (public-library-item.js DELETE) ── */
  async function seedListing() {
    H.reset();
    H.seedRow({ ...V.setMetadataKey(SRC), name: 'x', activeVersion: 2, versions: [{ version: 2 }] });
    await S.writeShareStamp(db, T, SRC, { version: 2, status: 'published', publicSetId: PUB, publicVersion: 1, contentHash: 'c'.repeat(64) });
    H.seedRow({ ...V.setMetadataKey(PUBREF), name: 'Safety walkthrough', activeVersion: 1, versions: [{ version: 1 }], sourceOrgId: ORG, sourceOrgName: 'Acme', sourceSetId: 'safety', sourceVersion: 2 });
    H.seedRow({ PK: V.setPartition(PUBREF, 1), SK: 'QUESTION#c001#001', Title: 'Q1' });
  }
  const takeDown = (note) => libraryHandler(staff('DELETE', { note }, { publicSetId: PUB }), H.ctx());

  await H.test('a takedown is written to the sharing team\'s log with its note', async () => {
    await seedListing();
    const res = await takeDown('Copied from a paid course.');
    assert.strictEqual(res.statusCode, 200, res.body);
    const [row] = auditRows();
    assert.strictEqual(row && row.Action, 'library.take-down');
    assert.deepStrictEqual(row.Target, { Type: 'public-set', Id: PUB });
    assert.strictEqual(row.Actor.Role, 'platform-admin');
    assert.strictEqual(row.Detail.setId, 'safety');
    assert.strictEqual(H.plainRow(ORG, row).Reason, 'Copied from a paid course.');
    assert.ok(!H.state.ddb.has(`${V.setMetadataKey(PUBREF).PK}|${V.setMetadataKey(PUBREF).SK}`), 'the listing is still there');
  });

  await H.test('a takedown whose entry cannot be written leaves the set published', async () => {
    await seedListing();
    const res = await withAuditWritesFailing(() => takeDown('x'));
    assert.strictEqual(res.statusCode, 503, res.body);
    assert.ok(H.state.ddb.has(`${V.setMetadataKey(PUBREF).PK}|${V.setMetadataKey(PUBREF).SK}`), 'the listing was removed');
    assert.strictEqual(H.state.ddb.get(`${V.setMetadataKey(SRC).PK}|${V.setMetadataKey(SRC).SK}`).share.status, 'published');
  });

  H.summary();
})();
