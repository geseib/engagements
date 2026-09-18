const path = require('path');
const assert = require('assert');
const H = require('./helpers/moderation-harness');
H.install();
const { DynamoDBDocumentClient } = require('@aws-sdk/lib-dynamodb');
const db = DynamoDBDocumentClient.from({});
const T = 'engage-test';
const C = require(path.join(H.REPO, 'lambda-functions/admin/shared/tenant-crypto.js'));
const R = require(path.join(H.REPO, 'lambda-functions/admin/shared/set-review.js'));
const handler = require(path.join(H.REPO, 'lambda-functions/admin/appeal-question-set.js')).handler;
const ORG = 'org_acme'; const SET = 'safety';
const SRC = { scope: 'org', orgId: ORG, setId: SET };
const parse = (res) => JSON.parse(res.body || '{}');
async function seed(status = R.STATUS.FLAGGED) {
  H.reset();
  H.seedRow({ PK: `ORG#${ORG}`, SK: 'METADATA', orgId: ORG, name: 'Acme Learning' });
  H.seedRow(await C.encryptItem(ORG, 'set', {
    PK: `ORG#${ORG}#SETS`, SK: `SET#${SET}`, name: 'Safety walkthrough', engagementType: 'trivia', scope: 'org', orgId: ORG,
    activeVersion: 2, versions: [{ version: 2 }], questionCount: 30,
  }));
  await R.writeReview(db, T, SRC, 2, {
    status, findings: [{ questionId: 'q014', category: 'VIOLENCE', band: 'HIGH', explanation: 'x' }],
    contentHash: 'a'.repeat(64), snapshotKey: 'moderation/org_acme/safety/v2/t.json',
  });
}
const post = (body, role = 'owner') => H.orgEvent({ orgId: ORG, role, method: 'POST', setId: SET, body });
(async () => {
  console.log('\nappealing a flagged version\n');
  await H.test('a flagged version becomes appealed, keeps its findings, and joins the queue with the message', async () => {
    await seed();
    const res = await handler(post({ version: 2, message: 'It is a clinical safety set.' }), H.ctx());
    assert.strictEqual(res.statusCode, 200, res.body);
    const r = await R.readReview(db, T, SRC, 2);
    assert.strictEqual(r.status, R.STATUS.APPEALED);
    assert.strictEqual(r.findings.length, 1, 'findings lost');
    assert.strictEqual(r.appealMessage, 'It is a clinical safety set.');
    const [row] = H.rowsWhere((x) => x.PK === 'MODERATION');
    assert.ok(row, 'no queue row');
    assert.deepStrictEqual(row.reasons, ['appealed']);
    assert.strictEqual(row.appealMessage, 'It is a clinical safety set.');
    assert.strictEqual(row.title, 'Safety walkthrough');
    assert.strictEqual(row.snapshotKey, 'moderation/org_acme/safety/v2/t.json');
    assert.strictEqual(H.state.ddb.get(`ORG#${ORG}#SETS|SET#${SET}`).share.status, 'appealed');
    assert.ok(H.rowsWhere((x) => x.PK === `REVIEWLOG#org#${ORG}#${SET}` && x.event === 'appealed').length === 1);
  });
  await H.test('only a flagged version can be appealed', async () => {
    for (const status of [R.STATUS.PASSED, R.STATUS.ESCALATED, R.STATUS.CHECKING]) {
      await seed(status); // eslint-disable-line no-await-in-loop
      const res = await handler(post({ version: 2 }), H.ctx()); // eslint-disable-line no-await-in-loop
      assert.strictEqual(res.statusCode, 409, `${status} was appealable`);
      assert.strictEqual(parse(res).status, status);
    }
  });
  await H.test('a lost race answers with the status as it now stands, not the one already gone', async () => {
    await seed(); // flagged
    // Simulate a concurrent write landing between the handler's own readReview
    // (line 48) and transitionReview's internal re-read: intercept the SECOND
    // Get of the REVIEW row (the first is the handler's) and mutate the row
    // before it is returned, exactly as a racing writer would have.
    const realSend = db.send.bind(db);
    let reviewGets = 0;
    db.send = async (cmd) => {
      if (cmd && cmd.kind === 'get' && cmd.input && cmd.input.Key && cmd.input.Key.SK === 'REVIEW') {
        reviewGets += 1;
        if (reviewGets === 2) {
          const k = `${cmd.input.Key.PK}|${cmd.input.Key.SK}`;
          const row = H.state.ddb.get(k);
          H.state.ddb.set(k, { ...row, status: 'escalated' });
        }
      }
      return realSend(cmd);
    };
    try {
      const res = await handler(post({ version: 2 }), H.ctx());
      assert.strictEqual(res.statusCode, 409, res.body);
      assert.strictEqual(parse(res).status, 'escalated', 'echoed the pre-race status instead of the current one');
    } finally {
      db.send = realSend;
    }
  });
  await H.test('a member cannot appeal; the message is capped at 500 characters', async () => {
    await seed();
    assert.strictEqual((await handler(post({ version: 2 }, 'member'), H.ctx())).statusCode, 403);
    const res = await handler(post({ version: 2, message: 'x'.repeat(900) }), H.ctx());
    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual((await R.readReview(db, T, SRC, 2)).appealMessage.length, 500);
  });
  H.summary();
})();
