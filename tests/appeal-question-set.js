const path = require('path');
const assert = require('assert');
const H = require('./helpers/moderation-harness');
H.install();
const { DynamoDBDocumentClient } = require('@aws-sdk/lib-dynamodb');
const db = DynamoDBDocumentClient.from({});
const T = 'engage-test';
const C = require(path.join(H.REPO, 'lambda-functions/admin/shared/tenant-crypto.js'));
const R = require(path.join(H.REPO, 'lambda-functions/admin/shared/set-review.js'));
const V = require(path.join(H.REPO, 'lambda-functions/admin/shared/set-version.js'));
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
const PUB = 'orgacme-safety';
const PUBREF = { scope: 'public', orgId: '', setId: PUB };
/** The listing, as a publish of `version` leaves it: the public row AND the source's marker. */
function seedListing(version) {
  H.seedRow({ ...R.publishedKey(SRC, version), publicSetId: PUB, publicVersion: 1, at: '2026-09-18T10:00:00.000Z' });
  H.seedRow({
    ...V.setMetadataKey(PUBREF), name: 'Safety walkthrough', scope: 'public', orgId: '',
    activeVersion: 1, versions: [{ version: 1, questionCount: 30 }],
    sourceOrgId: ORG, sourceSetId: SET, sourceVersion: version,
  });
}
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
    // The score card's timeline quotes the author from this event, as `message`.
    const [appealed] = H.rowsWhere((x) => x.PK === `REVIEWLOG#org#${ORG}#${SET}` && x.event === 'appealed');
    assert.strictEqual(appealed.message, 'It is a clinical safety set.');
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
  /*
    THERE IS NOTHING TO APPEAL ABOUT A SET THE LIBRARY IS SERVING, and letting
    one through re-opens the publish path a staff re-check exists to keep shut.

    Engage staff can re-run the content check on the version the public library
    already serves. A HIGH band writes FLAGGED onto this very REVIEW row — and
    from FLAGGED this route would take the appeal, write the author a share stamp
    reading `appealed` (knocking their own live set out of its published state),
    and bump the queue row the re-check raised. That bump used to clear the
    `recheck` flag moderation-decide.js refuses on, so Approve then minted a
    SECOND public version of content already live.

    The refusal is right on its own terms too: the library serves this version,
    so approving an appeal of it could only ever publish it twice.
  */
  await H.test('a version the library is serving cannot be appealed', async () => {
    await seed();
    seedListing(2);
    const res = await handler(post({ version: 2, message: 'Please look again.' }), H.ctx());
    assert.strictEqual(res.statusCode, 409, res.body);
    assert.match(parse(res).error, /public library/i, 'the refusal did not say why');
    assert.strictEqual((await R.readReview(db, T, SRC, 2)).status, R.STATUS.FLAGGED, 'the refusal moved the review anyway');
    assert.strictEqual(H.state.ddb.get(`ORG#${ORG}#SETS|SET#${SET}`).share, undefined, 'the refusal stamped the author anyway');
    assert.strictEqual(H.rowsWhere((x) => x.PK === 'MODERATION').length, 0, 'the refusal queued it anyway');
    assert.strictEqual(H.rowsWhere((x) => x.PK === `REVIEWLOG#org#${ORG}#${SET}`).length, 0, 'the refusal logged it anyway');
  });
  // rejects: refusing every appeal once the set has ever been published. The
  // marker is deleted when a listing is taken down (publish-set.unpublishSet),
  // and a later version of the same set never had one.
  await H.test('a version the library is not serving is appealed as before', async () => {
    await seed();
    H.seedRow({ ...R.publishedKey(SRC, 1), publicSetId: 'orgacme-safety', publicVersion: 1 });
    assert.strictEqual((await handler(post({ version: 2 }), H.ctx())).statusCode, 200);
  });
  /*
    …AND THE REFUSAL IS THE LISTING'S TO MAKE, NOT A MARKER'S.

    The marker is a fact about where a publish WENT; the listing is the fact
    about what the library serves, and the two can come apart. `unpublishSet`
    used to find the source's markers by walking the set's `versions` array, so
    a set shared before versioning existed — three of the four on dev — kept its
    unsuffixed marker after its listing was taken down. Read as the answer, that
    orphan refused the author's appeal for ever, and said the library was serving
    a set it had removed. So the marker is only the hint; whether the listing
    exists and still names this exact version is the answer.
  */
  await H.test('a marker the takedown left behind does not refuse a legacy author for ever', async () => {
    H.reset();
    H.seedRow({ PK: `ORG#${ORG}`, SK: 'METADATA', orgId: ORG, name: 'Acme Learning' });
    // LEGACY: no activeVersion, no versions — the state the orphan comes from.
    H.seedRow(await C.encryptItem(ORG, 'set', {
      PK: `ORG#${ORG}#SETS`, SK: `SET#${SET}`, name: 'Safety walkthrough', engagementType: 'trivia', scope: 'org', orgId: ORG, questionCount: 30,
    }));
    await R.writeReview(db, T, SRC, null, {
      status: R.STATUS.FLAGGED, findings: [{ questionId: 'q014', category: 'VIOLENCE', band: 'HIGH', explanation: 'x' }], contentHash: 'a'.repeat(64),
    });
    H.seedRow({ ...R.publishedKey(SRC, null), publicSetId: PUB, publicVersion: 1, at: '2026-09-18T10:00:00.000Z' });
    const res = await handler(post({ version: null, message: 'It was taken down; please look again.' }), H.ctx());
    assert.strictEqual(res.statusCode, 200, res.body);
    assert.strictEqual((await R.readReview(db, T, SRC, null)).status, R.STATUS.APPEALED);
    // …and with the listing back, the same appeal is refused again.
    H.reset();
    H.seedRow({ PK: `ORG#${ORG}`, SK: 'METADATA', orgId: ORG, name: 'Acme Learning' });
    H.seedRow(await C.encryptItem(ORG, 'set', {
      PK: `ORG#${ORG}#SETS`, SK: `SET#${SET}`, name: 'Safety walkthrough', engagementType: 'trivia', scope: 'org', orgId: ORG, questionCount: 30,
    }));
    await R.writeReview(db, T, SRC, null, { status: R.STATUS.FLAGGED, findings: [], contentHash: 'a'.repeat(64) });
    seedListing(null);
    const served = await handler(post({ version: null }), H.ctx());
    assert.strictEqual(served.statusCode, 409, served.body);
    assert.match(parse(served).error, /public library/i);
  });
  // rejects: reading any listing as this version's. A listing serving v1 says
  // nothing about v2, and an appeal of v2 is exactly what the author needs.
  await H.test('a listing serving a different version of the same set does not refuse this one', async () => {
    await seed();
    H.seedRow({ ...R.publishedKey(SRC, 2), publicSetId: PUB, publicVersion: 1, at: '2026-09-18T10:00:00.000Z' });
    H.seedRow({
      ...V.setMetadataKey(PUBREF), name: 'Safety walkthrough', scope: 'public', orgId: '', activeVersion: 1,
      versions: [{ version: 1, questionCount: 30 }], sourceOrgId: ORG, sourceSetId: SET, sourceVersion: 1,
    });
    const res = await handler(post({ version: 2, message: 'Please look again.' }), H.ctx());
    assert.strictEqual(res.statusCode, 200, res.body);
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
