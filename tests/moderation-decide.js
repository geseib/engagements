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
const { publicSetIdFor, publishSnapshot } = require(path.join(H.REPO, 'lambda-functions/admin/shared/publish-set.js'));
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
    // Ruling R9 rule 4: even if the queue row comes back (a stale
    // re-escalation), a DIFFERENT decision on an already-decided review is
    // refused -- flagged+approve is not the same decision replayed, so this
    // is not a resume, it is somebody else's call to make.
    await Q.upsertQueueRow(db, T, { ref: SRC, version: 2, reason: 'escalated', orgName: 'Acme', title: 'Safety walkthrough', gameType: 'trivia', questionCount: 2, snapshotKey: KEY, contentHash: 'c'.repeat(64) });
    const crossDecision = await decide({ sk: 'org_acme#safety#v2', decision: 'approve' }, H.platformEvent({ method: 'POST', body: { sk: 'org_acme#safety#v2', decision: 'approve' }, username: 'ana' }));
    assert.strictEqual(crossDecision.statusCode, 409, crossDecision.body);
    assert.match(parse(crossDecision).error, /already decided by dai/i);
    await seed();
    await R.writeReview(db, T, SRC, 2, { status: R.STATUS.PASSED, reviewer: 'dai', findings: [] });
    const stale = await decide({ sk: 'org_acme#safety#v2', decision: 'reject', note: 'late' });
    assert.strictEqual(stale.statusCode, 409, stale.body);
    assert.match(parse(stale).error, /already decided by dai/i);
  });
  await H.test('an approve that crashed after the decision is finished by the next approve, not refused', async () => {
    await seed();
    const movedRow = await R.transitionReview(db, T, SRC, 2, R.STATUS.ESCALATED, {
      status: R.STATUS.PASSED, reviewer: 'dai', decidedAt: '2026-09-17T10:05:00.000Z', note: 'Clinical.', notice: ['graphic-medical'],
    });
    // A first attempt that transitioned the REVIEW row and published the
    // snapshot -- the public set is already live -- but crashed before
    // anything was logged (Ruling R11 narrows this gap by moving `decided`
    // right after the transition, but does not close it: a throw between the
    // transition and that log write is still a throw).
    await publishSnapshot(db, T, SNAPSHOT, { review: movedRow, sourceOrgName: 'Acme', promptDropped: true });
    const metaAfterCrash = (await db.send(new GetCommand({ TableName: T, Key: V.setMetadataKey({ scope: 'public', orgId: '', setId: PUB }) }))).Item;
    assert.strictEqual(metaAfterCrash.activeVersion, 1, 'the crashed attempt already made the set live');

    const res = await decide({ sk: 'org_acme#safety#v2', decision: 'approve' }, H.platformEvent({ method: 'POST', body: { sk: 'org_acme#safety#v2', decision: 'approve' }, username: 'ana' }));
    assert.strictEqual(res.statusCode, 200, res.body);
    assert.deepStrictEqual(parse(res), { decision: 'approve', publicSetId: PUB, publicVersion: 1, resumed: true });

    const metaAfterResume = (await db.send(new GetCommand({ TableName: T, Key: V.setMetadataKey({ scope: 'public', orgId: '', setId: PUB }) }))).Item;
    assert.strictEqual(metaAfterResume.activeVersion, 1, 'no version bump on resume');
    assert.strictEqual(metaAfterResume.versions.length, 1, 'no duplicate versions entry');
    assert.deepStrictEqual(metaAfterResume.sensitivity, ['graphic-medical'], 'sensitivity comes from the REVIEW row -- the retry sent none');

    const srcMeta = (await db.send(new GetCommand({ TableName: T, Key: V.setMetadataKey(SRC) }))).Item;
    const stamp = S.readShareStamp(srcMeta);
    assert.strictEqual(stamp.status, 'published');
    assert.strictEqual(stamp.publicVersion, 1);

    assert.strictEqual(H.rowsWhere((r) => r.PK === Q.QUEUE_PK).length, 0, 'the queue row is gone');

    const events = await L.readReviewLog(db, T, SRC);
    const decided = events.filter((e) => e.event === 'decided');
    const published = events.filter((e) => e.event === 'published');
    assert.strictEqual(decided.length, 1, `exactly one decided event: ${JSON.stringify(decided)}`);
    assert.strictEqual(decided[0].reviewer, 'dai', 'named from the REVIEW row, not the retry caller ana');
    assert.strictEqual(published.length, 1);
    assert.strictEqual(published[0].resumed, true);

    const review = await R.readReview(db, T, SRC, 2);
    assert.strictEqual(review.reviewer, 'dai');

    // Ruling R11: a second resume attempt (the queue row is already gone, so
    // this is unrelated 404 territory -- unchanged behaviour) must not have
    // doubled up the decided back-fill.
    const secondResume = await decide({ sk: 'org_acme#safety#v2', decision: 'approve' }, H.platformEvent({ method: 'POST', body: { sk: 'org_acme#safety#v2', decision: 'approve' }, username: 'ana' }));
    assert.strictEqual(secondResume.statusCode, 404, secondResume.body);
    const eventsAfterSecond = await L.readReviewLog(db, T, SRC);
    const decidedAfterSecond = eventsAfterSecond.filter((e) => e.event === 'decided');
    assert.strictEqual(decidedAfterSecond.length, 1, `still exactly one decided event: ${JSON.stringify(decidedAfterSecond)}`);
  });
  await H.test('a reject that crashed after the decision is finished by the next reject', async () => {
    await seed();
    await R.transitionReview(db, T, SRC, 2, R.STATUS.ESCALATED, {
      status: R.STATUS.FLAGGED, reviewer: 'dai', decidedAt: '2026-09-17T10:05:00.000Z', note: 'no',
    });
    const res = await decide({ sk: 'org_acme#safety#v2', decision: 'reject', note: 'ignored' });
    assert.strictEqual(res.statusCode, 200, res.body);
    assert.deepStrictEqual(parse(res), { decision: 'reject', resumed: true });
    const srcMeta = (await db.send(new GetCommand({ TableName: T, Key: V.setMetadataKey(SRC) }))).Item;
    const stamp = S.readShareStamp(srcMeta);
    assert.strictEqual(stamp.status, 'flagged');
    assert.strictEqual(stamp.note, 'no', "the recorded note wins, not the retry's");
    assert.ok(!H.state.s3.has(`prompts-test/${KEY}`), 'the snapshot is gone');
    assert.strictEqual(H.rowsWhere((r) => r.PK === Q.QUEUE_PK).length, 0, 'the queue row is gone');
    const review = await R.readReview(db, T, SRC, 2);
    assert.strictEqual(review.note, 'no');
    // Ruling R11: the crashed-then-resumed reject still names who decided.
    const events = await L.readReviewLog(db, T, SRC);
    const decided = events.filter((e) => e.event === 'decided');
    assert.strictEqual(decided.length, 1, `exactly one decided event: ${JSON.stringify(decided)}`);
    assert.strictEqual(decided[0].reviewer, 'dai');
    // rejects: the reject back-fill copying the approve one's shape. A reject
    // attaches no content notices — there is nothing published for a notice to
    // sit on — so `notice` must be ABSENT from the event, not an empty array
    // that reads to the score card's timeline as "notices were considered".
    assert.ok(!('notice' in decided[0]), `the reject's decided carried a notice: ${JSON.stringify(decided[0])}`);
    // Ruling R11, the symmetric half of the approve test above: a second
    // resume (the queue row is gone by now, so this is 404 territory) must not
    // double up the back-fill.
    const secondResume = await decide({ sk: 'org_acme#safety#v2', decision: 'reject', note: 'again' });
    assert.strictEqual(secondResume.statusCode, 404, secondResume.body);
    const decidedAfterSecond = (await L.readReviewLog(db, T, SRC)).filter((e) => e.event === 'decided');
    assert.strictEqual(decidedAfterSecond.length, 1, `still exactly one decided event: ${JSON.stringify(decidedAfterSecond)}`);
  });
  /*
    RULING R19 — spec §11: the organisation deletes the version (or the whole
    set) while it is sitting in the queue. delete-set-version.js removes the
    version PARTITION, and the REVIEW row lives in it; the queue row has no TTL
    and the S3 snapshot is untouched. So readReview answers `unreviewed`, which
    is not OPEN — and both decisions used to 409 "not waiting for a decision",
    leaving a queue row NOTHING could ever clear.

    The wipe below is by partition key (V.setPartition(SRC, 2)), not by a
    literal: no handler or test in this repo spells a partition key out, and
    tests/no-global-partition-literals.js is the guard that says so.
  */
  const wipeVersionPartition = () => {
    const pk = V.setPartition(SRC, 2);
    for (const [k, row] of H.state.ddb) if (row.PK === pk) H.state.ddb.delete(k);
  };
  await H.test('a version deleted under a queued item is still approvable, and publishes the snapshot (R19)', async () => {
    await seed();
    wipeVersionPartition();
    assert.strictEqual((await R.readReview(db, T, SRC, 2)).status, 'unreviewed', 'the REVIEW row went with the partition');
    assert.strictEqual(H.rowsWhere((r) => r.PK === Q.QUEUE_PK).length, 1, 'but the queue row did not');

    const res = await decide({ sk: 'org_acme#safety#v2', decision: 'approve', note: 'Clinical, not gratuitous.', notice: ['graphic-medical'] });
    assert.strictEqual(res.statusCode, 200, res.body);
    assert.deepStrictEqual(parse(res), { decision: 'approve', publicSetId: PUB, publicVersion: 1, orphaned: true });

    // The snapshot is self-contained, so the publish is the same publish.
    const pubRows = rowsUnder(V.setPartition({ scope: 'public', orgId: '', setId: PUB }, 1)).filter((r) => String(r.SK).startsWith('QUESTION#'));
    assert.strictEqual(pubRows.length, 2);
    assert.strictEqual(pubRows.find((r) => r.SK === 'QUESTION#c001#014').Detail, 'In detail.');
    const pubMeta = (await db.send(new GetCommand({ TableName: T, Key: V.setMetadataKey({ scope: 'public', orgId: '', setId: PUB }) }))).Item;
    assert.deepStrictEqual(pubMeta.sensitivity, ['graphic-medical'], 'the notice this reviewer attached still lands');
    // rejects: reading promptDropped off the (absent) REVIEW row, which is
    // false every time — the org Workie `org-workie` would then ship to the
    // public copy as a reference nobody outside org_acme can resolve (D5).
    assert.strictEqual(pubMeta.promptDropped, true, 'the org Workie reached the public copy');
    assert.strictEqual(pubMeta.promptId, undefined);

    // rejects: transitionReview on the orphan path, which would write a REVIEW
    // row straight back into a partition the organisation deleted. The
    // PUBLISHED marker publishSnapshot writes IS tolerated (see the handler's
    // header) — so the partition holds that and nothing else.
    const left = rowsUnder(V.setPartition(SRC, 2)).map((r) => r.SK);
    assert.deepStrictEqual(left, ['PUBLISHED'], `an orphan row was recreated: ${left}`);

    // Only the version was deleted here, so the set's own row survives and the
    // stamp lands on it. (When the whole set is gone writeShareStamp is
    // conditional on the row and simply does not apply.)
    const stamp = S.readShareStamp((await db.send(new GetCommand({ TableName: T, Key: V.setMetadataKey(SRC) }))).Item);
    assert.strictEqual(stamp.status, 'published');
    assert.strictEqual(stamp.publicSetId, PUB);

    const events = await L.readReviewLog(db, T, SRC);
    const decided = events.filter((e) => e.event === 'decided');
    assert.strictEqual(decided.length, 1);
    assert.strictEqual(decided[0].reviewer, 'dai');
    assert.strictEqual(decided[0].orphaned, true, 'the record says the set was gone under it');
    assert.strictEqual(events.filter((e) => e.event === 'published').length, 1);
    assert.strictEqual(H.rowsWhere((r) => r.PK === Q.QUEUE_PK).length, 0, 'the queue row is finally clearable');
  });
  await H.test('a version deleted under a queued item is still rejectable, and the queue row clears (R19)', async () => {
    await seed();
    wipeVersionPartition();
    const res = await decide({ sk: 'org_acme#safety#v2', decision: 'reject', note: 'Q14 needs the injury detail removed.' });
    assert.strictEqual(res.statusCode, 200, res.body);
    assert.deepStrictEqual(parse(res), { decision: 'reject', orphaned: true });
    assert.ok(!H.state.s3.has(`prompts-test/${KEY}`), 'the snapshot is deleted on reject, orphan or not');
    assert.strictEqual(H.rowsWhere((r) => r.PK === Q.QUEUE_PK).length, 0, 'the queue row is finally clearable');
    assert.deepStrictEqual(rowsUnder(V.setPartition(SRC, 2)).map((r) => r.SK), [], 'nothing was written back into the deleted partition');
    assert.strictEqual(rowsUnder(V.setPartition({ scope: 'public', orgId: '', setId: PUB }, 1)).length, 0, 'nothing published');
    const decided = (await L.readReviewLog(db, T, SRC)).filter((e) => e.event === 'decided');
    assert.strictEqual(decided.length, 1);
    assert.strictEqual(decided[0].decision, 'reject');
    assert.strictEqual(decided[0].orphaned, true);
    // rejects: stamping the organisation's row `flagged` for a version they
    // have deleted. A reject publishes nothing for a stamp to point at, and
    // the seeded `escalated` stamp is the last true thing anyone wrote.
    const stamp = S.readShareStamp((await db.send(new GetCommand({ TableName: T, Key: V.setMetadataKey(SRC) }))).Item);
    assert.strictEqual(stamp.status, 'escalated', 'the stamp was rewritten about content that no longer exists');
  });
  await H.test('an orphaned approve with no snapshot is still refused (R5 outlives the REVIEW row)', async () => {
    await seed();
    wipeVersionPartition();
    H.state.s3.clear();
    const res = await decide({ sk: 'org_acme#safety#v2', decision: 'approve' });
    assert.strictEqual(res.statusCode, 409, res.body);
    assert.strictEqual(H.rowsWhere((r) => r.PK === Q.QUEUE_PK).length, 1, 'still queued — nothing was published');
    assert.strictEqual(rowsUnder(V.setPartition({ scope: 'public', orgId: '', setId: PUB }, 1)).length, 0);
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
    // rejects: `#v(\d+)`, which admits v0 — and setPartition(ref, 0) resolves
    // to the LEGACY UNVERSIONED partition, so `v0` would have published,
    // stamped and logged against a different set's content than any queue row
    // can name. `v01` goes with it: one spelling per version.
    assert.strictEqual((await decide({ sk: 'org_acme#safety#v0', decision: 'approve' })).statusCode, 400, 'v0 reached the unversioned partition');
    assert.strictEqual((await decide({ sk: 'org_acme#safety#v01', decision: 'approve' })).statusCode, 400, 'two spellings of one version');
    // Minor #4: a non-string note (e.g. an object) is refused rather than
    // coerced to the string '[object Object]'.
    const badNote = await decide({ sk: 'org_acme#safety#v2', decision: 'approve', note: {} });
    assert.strictEqual(badNote.statusCode, 400);
    assert.match(parse(badNote).error, /note must be text/i);
    const org = await handler(H.orgEvent({ orgId: 'org_acme', role: 'owner', method: 'POST', body: { sk: 'org_acme#safety#v2', decision: 'approve' } }), H.ctx());
    assert.strictEqual(org.statusCode, 403);
    // Minor #6: the acting-as-Engage interlock, not just "not an admin" --
    // an admins-group caller standing INSIDE an org is still refused.
    const orgAdmin = await handler(H.orgEvent({ orgId: 'org_acme', role: 'owner', groups: 'admins', method: 'POST', body: { sk: 'org_acme#safety#v2', decision: 'approve' } }), H.ctx());
    assert.strictEqual(orgAdmin.statusCode, 403);
  });
  /*
    `leave` — "LEAVE IT SERVING", the answer to a row a staff RE-CHECK raised.
    It is the only decision that addresses a listing-shaped sk, because it is the
    only one that is not about a publish request, and it must stay that narrow:
    a row an organisation is waiting on is a decision somebody owes them, and
    Stage 3's reports land on the same key.
  */
  await H.test('leave clears a re-check\'s row, logs it on the organisation\'s set, and touches nothing else', async () => {
    await seed();
    // The state a re-check leaves: the listing, and a row under its own key.
    H.seedRow({
      ...V.setMetadataKey({ scope: 'public', orgId: '', setId: PUB }), name: 'Safety walkthrough', scope: 'public', orgId: '',
      activeVersion: 1, versions: [{ version: 1, questionCount: 2 }],
      sourceOrgId: 'org_acme', sourceSetId: 'safety', sourceVersion: 2,
    });
    await Q.upsertQueueRow(db, T, {
      ref: { scope: 'public', orgId: '', setId: PUB }, version: 2, reason: 'escalated',
      orgId: 'org_acme', title: 'Safety walkthrough', publicSetId: PUB, snapshotKey: KEY, recheck: true,
    });
    const reviewBefore = JSON.stringify(await R.readReview(db, T, SRC, 2));
    const res = await decide({ sk: `PUBLIC#${PUB}`, decision: 'leave', note: 'The approval stands.' });
    assert.strictEqual(res.statusCode, 200, res.body);
    assert.strictEqual(parse(res).leftServing, PUB);
    // Only that row: the organisation's own escalated row is still waiting.
    assert.deepStrictEqual(H.rowsWhere((r) => r.PK === Q.QUEUE_PK).map((r) => r.SK), ['org_acme#safety#v2']);
    assert.strictEqual(JSON.stringify(await R.readReview(db, T, SRC, 2)), reviewBefore, 'the review row moved');
    assert.ok(H.state.s3.has(`prompts-test/${KEY}`), 'the snapshot was deleted');
    assert.strictEqual(S.readShareStamp((await db.send(new GetCommand({ TableName: T, Key: V.setMetadataKey(SRC) }))).Item).status, 'escalated', 'the author\'s stamp moved');
    const [left] = (await L.readReviewLog(db, T, SRC)).filter((e) => e.event === 'left-serving');
    assert.ok(left, 'the organisation\'s log does not record it');
    assert.strictEqual(left.reviewer, 'dai');
    assert.strictEqual(left.version, 2);
    assert.strictEqual(left.note, 'The approval stands.');
  });
  await H.test('leave is refused for a row no re-check raised, for a reported row, and for the wrong sk shape', async () => {
    await seed();
    // The organisation's own escalated publish request, under its version key.
    const theirs = await decide({ sk: 'org_acme#safety#v2', decision: 'leave' });
    assert.strictEqual(theirs.statusCode, 409, theirs.body);
    assert.match(parse(theirs).error, /re-check/i);
    // A listing's row carrying a report: Stage 3 answers that on the report.
    await Q.upsertQueueRow(db, T, {
      ref: { scope: 'public', orgId: '', setId: PUB }, version: 2, reason: 'reported', publicSetId: PUB, recheck: true,
    });
    const reported = await decide({ sk: `PUBLIC#${PUB}`, decision: 'leave' });
    assert.strictEqual(reported.statusCode, 409, reported.body);
    assert.match(parse(reported).error, /report/i);
    assert.strictEqual(H.rowsWhere((r) => r.PK === Q.QUEUE_PK).length, 2, 'a refusal deleted a row anyway');
    // Approve and reject do not reach a listing's row at all.
    assert.strictEqual((await decide({ sk: `PUBLIC#${PUB}`, decision: 'reject' })).statusCode, 400);
    assert.strictEqual((await decide({ sk: 'not a key', decision: 'leave' })).statusCode, 400);
  });
  // rejects: an orphan row — its listing taken down while it stood — being
  // unclearable because there is no organisation left to write the log to.
  await H.test('a row whose listing has gone is still cleared', async () => {
    await seed();
    await Q.upsertQueueRow(db, T, {
      ref: { scope: 'public', orgId: '', setId: PUB }, version: 2, reason: 'escalated', publicSetId: PUB, recheck: true,
    });
    const res = await decide({ sk: `PUBLIC#${PUB}`, decision: 'leave' });
    assert.strictEqual(res.statusCode, 200, res.body);
    assert.deepStrictEqual(H.rowsWhere((r) => r.PK === Q.QUEUE_PK).map((r) => r.SK), ['org_acme#safety#v2']);
    assert.strictEqual((await L.readReviewLog(db, T, SRC)).filter((e) => e.event === 'left-serving').length, 0, 'a log entry was written for a listing that is gone');
  });
  H.summary();
})();
