// tests/public-recheck.js
/**
 * STAFF RE-RUN THE CHECK ON WHAT THE LIBRARY ALREADY SERVES — the platform
 * re-check on POST /question-sets/{publicSetId}/check with `{ recheck: true }`.
 *
 * The owner, of their existing public sets: the score card shows nothing, and
 * there is no way to fill it. The card's read was one bug (tests/score-card-
 * standing.js); the other is that those checks were run before the check
 * MEASURED anything, so there is nothing to read. They need the check run
 * again — and the ordinary route publishes, which is the one thing a re-check
 * of a live listing must never do.
 *
 * So this path is defined by what it must NOT disturb:
 *
 *   R1  it publishes nothing: no new public version, no change to the active
 *       version, no change to any row the library serves.
 *   R2  it never erases a human decision: `reviewer`, `decidedAt`, `notice`
 *       and the reviewer's own `note` survive it — through the lock row, the
 *       worker's write, and a dispatch that failed.
 *   R3  it does not move the author's share stamp: their set still reads
 *       `published` to them afterwards.
 *   R4  only the version the PUBLIC row names may be re-checked, and only by
 *       Engage staff acting as Engage. Any other version, and any other
 *       caller, is refused — this is not a way to read an organisation's
 *       other content.
 *   R5  it lands in the organisation's own review log, naming the staff
 *       member who ran it.
 *   R6  a set shared before versioning existed (version NULL) works end to end.
 *   R7  an outcome worse than `passed` takes nothing down; it queues the entry
 *       for a person.
 *   R8  the organisation's daily check cap is not charged for staff's work.
 */
const path = require('path');
const assert = require('assert');
const H = require('./helpers/moderation-harness');
H.install();
const { DynamoDBDocumentClient } = require('@aws-sdk/lib-dynamodb');
const { S3Client } = require('@aws-sdk/client-s3');
const { BedrockRuntimeClient } = require('@aws-sdk/client-bedrock-runtime');
const db = DynamoDBDocumentClient.from({});
const T = 'engage-test';
const V = require(path.join(H.REPO, 'lambda-functions/admin/shared/set-version.js'));
const R = require(path.join(H.REPO, 'lambda-functions/admin/shared/set-review.js'));
const L = require(path.join(H.REPO, 'lambda-functions/admin/shared/review-log.js'));
const S = require(path.join(H.REPO, 'lambda-functions/admin/shared/share-stamp.js'));
const Q = require(path.join(H.REPO, 'lambda-functions/admin/shared/moderation-queue.js'));
const C = require(path.join(H.REPO, 'lambda-functions/admin/shared/tenant-crypto.js'));
const J = require(path.join(H.REPO, 'lambda-functions/admin/shared/generation-jobs.js'));
const { publicSetIdFor } = require(path.join(H.REPO, 'lambda-functions/admin/shared/publish-set.js'));
const { handler } = require(path.join(H.REPO, 'lambda-functions/admin/check-question-set.js'));

const ORG = 'org_acme'; const SET = 'crime';
const SRC = { scope: 'org', orgId: ORG, setId: SET };
const PUB = publicSetIdFor(ORG, SET);
const PUBREF = { scope: 'public', orgId: '', setId: PUB };
const HASH = 'c'.repeat(64);
const DAY = () => new Date().toISOString().slice(0, 10);

const parse = (res) => JSON.parse(res.body || '{}');
/** Engage staff, acting as Engage, asking for the re-check of one public entry. */
const post = (body = { recheck: true }, publicSetId = PUB) => handler(H.platformEvent({ method: 'POST', path: { setId: publicSetId }, body }), H.ctx());
const poll = (jobId) => handler(H.platformEvent({ method: 'GET', path: { setId: PUB, jobId } }), H.ctx());
const review = (version) => R.readReview(db, T, SRC, version);
const stampOf = async () => S.readShareStamp(await C.decryptItem(ORG, 'set', H.state.ddb.get(`ORG#${ORG}#SETS|SET#${SET}`)));
const queue = () => H.rowsWhere((r) => r.PK === Q.QUEUE_PK);
const logOf = () => L.readReviewLog(db, T, SRC);
const publicRows = () => H.rowsWhere((r) => String(r.PK).startsWith('PUBLIC#'));
const clean = (n) => Array.from({ length: n }, () => H.guardrailFull());

/**
 * The organisation's set, with content in one partition per version named.
 * `null` in `versions` is the LEGACY partition — no `#v` suffix, no
 * `activeVersion`, which is the state three of the four public sets on dev
 * were shared from. Every question's text names its partition, so a check that
 * judged the wrong one says so.
 */
async function seedOrg({ versions = [null], active = null, questions = 2 } = {}) {
  H.reset();
  H.seedRow({ PK: `ORG#${ORG}`, SK: 'METADATA', orgId: ORG, name: 'Acme Learning' });
  const numbered = versions.filter((v) => v !== null);
  H.seedRow(await C.encryptItem(ORG, 'set', {
    ...V.setMetadataKey(SRC), name: 'True crime', description: 'Infamous cases.', engagementType: 'trivia',
    scope: 'org', orgId: ORG, questionCount: questions, createdBy: 'sub-amara',
    ...(active ? { activeVersion: active } : {}),
    ...(numbered.length ? { versions: numbered.map((v) => ({ version: v, questionCount: questions })) } : {}),
  }));
  for (const v of versions) {
    const pk = V.setPartition(SRC, v);
    H.seedRow({ PK: pk, SK: 'CATEGORY#c001', Name: 'Cases', QuestionCount: questions });
    for (let i = 1; i <= questions; i += 1) {
      H.seedRow(await C.encryptItem(ORG, 'question', { // eslint-disable-line no-await-in-loop
        PK: pk, SK: `QUESTION#c001#${String(i).padStart(3, '0')}`,
        Title: `Case ${i} of ${v === null ? 'the unversioned set' : `version ${v}`}`,
        Detail: 'Solved, or not.', optionA: 'A', optionB: 'B', correctAnswer: 'A', Category: 'c001', Image: '', Active: true,
      }));
    }
  }
}

/**
 * …and its public copy, as a share left it: escalated on a declared notice,
 * approved by a person at Engage, published as public v1. `sourceVersion` null
 * is the legacy entry the owner actually has.
 */
async function seedPublished({ sourceVersion = null, questions = 2, reviewer = 'dai' } = {}) {
  await R.writeReview(db, T, SRC, sourceVersion, {
    status: R.STATUS.ESCALATED, findings: [], note: `${questions}/${questions + 1} clean`,
    reasons: ['declared'], declaredNotice: ['graphic-violence'], contentHash: HASH, checkedBy: 'sub-amara',
  });
  if (reviewer) {
    await R.transitionReview(db, T, SRC, sourceVersion, R.STATUS.ESCALATED, {
      status: R.STATUS.PASSED, reviewer, decidedAt: '2026-09-18T09:55:00.000Z', note: 'Historical, not gratuitous.', notice: ['graphic-violence'],
    });
  }
  await S.writeShareStamp(db, T, SRC, {
    version: sourceVersion, status: 'published', publicSetId: PUB, publicVersion: 1, contentHash: HASH,
  });
  H.seedRow({
    ...V.setMetadataKey(PUBREF), name: 'True crime', description: 'Infamous cases.', engagementType: 'trivia',
    scope: 'public', orgId: '', activeVersion: 1, versions: [{ version: 1, createdAt: '2026-09-18T10:00:00.000Z', questionCount: questions }],
    sourceOrgId: ORG, sourceOrgName: 'Acme Learning', sourceSetId: SET, sourceVersion, contentHash: HASH,
    questionCount: questions, sensitivity: ['graphic-violence'],
  });
  const pk = V.setPartition(PUBREF, 1);
  for (let i = 1; i <= questions; i += 1) {
    H.seedRow({ PK: pk, SK: `QUESTION#c001#${String(i).padStart(3, '0')}`, Title: `Case ${i} as the library serves it`, Detail: 'Solved, or not.' });
  }
  H.seedRow({ ...R.publishedKey(SRC, sourceVersion), publicSetId: PUB, publicVersion: 1, at: '2026-09-18T10:00:00.000Z' });
}

/** Everything the library serves, as one comparable value. */
const libraryState = () => JSON.stringify(publicRows().sort((a, b) => `${a.PK}${a.SK}`.localeCompare(`${b.PK}${b.SK}`)));

/** The POST, then the worker it dispatched — the whole re-check, as production runs it. */
async function recheck(body = { recheck: true }) {
  const res = await post(body);
  assert.strictEqual(res.statusCode, 202, res.body);
  const { jobId } = parse(res);
  await handler({ __workerMode: true, jobId }, H.ctx());
  return { res, jobId };
}

(async () => {
  console.log('\nthe platform re-check\n');

  // rejects: a re-check that publishes (a second public version of identical
  // content — publish-set.js bumps without `resume`), or that moves the active
  // version, or that touches a row the library serves.
  await H.test('a legacy entry is re-checked, is measured, and the library is left exactly as it was', async () => {
    await seedOrg();
    await seedPublished();
    const before = libraryState();
    H.state.guardrailReplies = clean(3);
    await recheck();
    const r = await review(null);
    assert.strictEqual(r.status, R.STATUS.PASSED, `review is ${r.status}: ${r.note}`);
    assert.ok(r.tally, 'the re-check recorded no tally — the card still has nothing to show');
    assert.strictEqual(r.tally.questions, 2);
    assert.strictEqual(r.version, null, 'the review row was relabelled with a version the set does not have');
    assert.strictEqual(libraryState(), before, 'the re-check changed what the library serves');
    // The org-side record of where the share went is part of "published" too.
    const marker = H.state.ddb.get(`${R.publishedKey(SRC, null).PK}|PUBLISHED`);
    assert.strictEqual(marker.publicVersion, 1, 'the PUBLISHED marker moved');
    assert.strictEqual(queue().length, 0, 'a clean re-check queued something');
  });

  /*
    THE CASE THE PIN IS FOR. The entry was shared from the UNVERSIONED set, and
    the organisation has since replaced it — so there is now an `activeVersion`,
    and `resolvePartitionFromMeta(source, meta, null)` answers with it, because
    for a session that is the right answer (set-version.js: 1. the pin, 2.
    activeVersion, 3. legacy). Here it is the wrong one twice over: the check
    would judge content the library does not serve, and `writeReview` would file
    the verdict under the version it was ASKED for — the unsuffixed one — so the
    score card would show a measurement of questions nobody published.
  */
  await H.test('a legacy entry whose organisation has since versioned the set is still judged on the unversioned content', async () => {
    await seedOrg({ versions: [null, 1], active: 1 });
    await seedPublished();
    H.state.guardrailReplies = clean(3);
    await recheck();
    const judged = H.state.sentGuardrail.map((c) => c.content[0].text.text).join('\n');
    assert.ok(judged.includes('the unversioned set'), `the check judged: ${judged.slice(0, 200)}`);
    assert.ok(!judged.includes('version 1'), 'the check judged the version the organisation replaced it with');
    assert.strictEqual((await review(null)).status, R.STATUS.PASSED);
    assert.strictEqual((await review(1)).status, R.STATUS.UNREVIEWED, 'a version nobody published was given a review');
  });

  // rejects: judging the set's CURRENT active version. The library serves v2;
  // resolvePartitionFromMeta would hand the worker v3 the moment a pin is not
  // recorded, and the review row would then describe content nobody published.
  await H.test('a versioned entry is judged on the version the library serves, not the organisation\'s newest', async () => {
    await seedOrg({ versions: [2, 3], active: 3 });
    await seedPublished({ sourceVersion: 2 });
    H.state.guardrailReplies = clean(3);
    await recheck();
    const judged = H.state.sentGuardrail.map((c) => c.content[0].text.text).join('\n');
    assert.ok(judged.includes('version 2'), `the check judged: ${judged.slice(0, 200)}`);
    assert.ok(!judged.includes('version 3'), 'the check judged the organisation\'s newest version, not the published one');
    assert.strictEqual((await review(2)).status, R.STATUS.PASSED);
    assert.strictEqual((await review(3)).status, R.STATUS.UNREVIEWED, 'a version nobody published was given a review');
  });

  // rejects: writeReview's whitelist replacing the row from the check's facts
  // alone, which erases the record that a person looked at this and approved it.
  await H.test('the person who approved it, when, their notice and their words all survive the re-check', async () => {
    await seedOrg();
    await seedPublished();
    H.state.guardrailReplies = clean(3);
    await recheck();
    const r = await review(null);
    assert.strictEqual(r.reviewer, 'dai');
    assert.strictEqual(r.decidedAt, '2026-09-18T09:55:00.000Z');
    assert.deepStrictEqual(r.notice, ['graphic-violence']);
    assert.strictEqual(r.note, 'Historical, not gratuitous.', 'the reviewer\'s own words were overwritten by the check\'s count');
  });

  // rejects: carrying a decision that does not exist. A set that was never
  // decided on by a person must take the re-check's own note and no reviewer.
  await H.test('a set no person ever decided on takes the re-check\'s own note', async () => {
    await seedOrg();
    await seedPublished({ reviewer: '' });
    H.state.guardrailReplies = clean(3);
    await recheck();
    const r = await review(null);
    assert.strictEqual(r.reviewer, undefined);
    assert.strictEqual(r.note, '3/3 clean', `the note was ${JSON.stringify(r.note)}`);
  });

  // rejects: the author's set reading as "checked" or "passed" again, or
  // dropping out of `published`, because staff ran a check they never asked for.
  await H.test('the author\'s set still reads as published throughout', async () => {
    await seedOrg();
    await seedPublished();
    H.state.guardrailReplies = clean(3);
    const res = await post();
    assert.strictEqual(res.statusCode, 202, res.body);
    assert.strictEqual((await stampOf()).status, 'published', 'the POST moved the author\'s stamp to checking');
    await handler({ __workerMode: true, jobId: parse(res).jobId }, H.ctx());
    const stamp = await stampOf();
    assert.strictEqual(stamp.status, 'published');
    assert.strictEqual(stamp.publicSetId, PUB);
  });

  // rejects: a re-check that bills the organisation's cap for Engage's own
  // work — twenty re-checks would lock an author out of sharing for a day.
  await H.test('the organisation\'s daily cap is not charged, and the guardrail calls are still recorded', async () => {
    await seedOrg();
    await seedPublished();
    H.state.guardrailReplies = clean(3);
    await recheck();
    const row = H.state.ddb.get(`ORG#${ORG}|CHECKS#${DAY()}`);
    assert.strictEqual(row && row.submits, undefined, 'the re-check charged the organisation a submit');
    assert.strictEqual(row && row.staffUnits, 3, `staff units were ${row && row.staffUnits}`);
    assert.strictEqual(row && row.units, undefined, 'the organisation\'s own unit ledger was charged for staff\'s work');
  });

  // rejects: a check the customer cannot account for. Their log is where they
  // see what Engage did to their set.
  await H.test('the organisation\'s log records the re-check and who ran it', async () => {
    await seedOrg();
    await seedPublished();
    H.state.guardrailReplies = clean(3);
    await recheck();
    const checked = (await logOf()).filter((e) => e.event === 'checked');
    assert.strictEqual(checked.length, 1);
    assert.strictEqual(checked[0].recheck, true, 'the log does not say this was a staff re-check');
    assert.strictEqual(checked[0].reviewer, 'dai', 'the log does not name who ran it');
    assert.strictEqual(checked[0].publicSetId, PUB);
    assert.strictEqual(checked[0].version, null);
    assert.ok(!(await logOf()).some((e) => e.event === 'published'), 'the re-check logged a publish');
  });

  /*
    R7. A re-check that comes out worse is the interesting case: the library is
    serving content today's check would hold. Nothing is taken down — that is a
    person's decision, and an automatic unpublish on a guardrail that has since
    been tightened would empty the library without anyone seeing it. So the
    entry is QUEUED, which is the only mechanism that puts it in front of one.
  */
  await H.test('a re-check that escalates queues the entry and takes nothing down', async () => {
    await seedOrg();
    await seedPublished();
    const before = libraryState();
    H.state.guardrailReplies = [H.guardrailFull({ HATE: 'MEDIUM' }, { HATE: true }), ...clean(2)];
    await recheck();
    assert.strictEqual((await review(null)).status, R.STATUS.ESCALATED);
    assert.strictEqual((await review(null)).reviewer, 'dai', 'the escalation erased the approval it superseded');
    const [row] = queue();
    assert.ok(row, 'nothing was queued: no person will ever see this');
    assert.strictEqual(row.SK, `${ORG}#${SET}#v0`, `the queue row is keyed ${row.SK}`);
    assert.strictEqual(row.publicSetId, PUB, 'the queue row does not name the public entry it is about');
    assert.strictEqual(libraryState(), before, 'the library changed on an escalation');
    assert.strictEqual((await stampOf()).status, 'published');
  });

  // rejects: treating a FLAGGED re-check the way a flagged ORDINARY check is
  // treated — told to the author and left. There is no author in this loop:
  // nobody asked for the re-check, and a flagged listing nobody is shown is a
  // finding thrown away.
  await H.test('a re-check that flags is queued too, and still takes nothing down', async () => {
    await seedOrg();
    await seedPublished();
    const before = libraryState();
    H.state.guardrailReplies = [H.guardrailFull({ VIOLENCE: 'HIGH' }, { VIOLENCE: true }), ...clean(2)];
    await recheck();
    assert.strictEqual((await review(null)).status, R.STATUS.FLAGGED);
    assert.strictEqual(queue().length, 1, 'a flagged re-check reached nobody');
    assert.strictEqual(libraryState(), before);
    assert.strictEqual((await stampOf()).status, 'published');
  });

  console.log('\nwho may run it, and on what\n');

  // rejects: a re-check of any version the caller names — which would be a
  // read of an organisation's private content through a platform route.
  await H.test('only the version the public row names may be re-checked', async () => {
    await seedOrg({ versions: [2, 3], active: 3 });
    await seedPublished({ sourceVersion: 2 });
    const res = await post({ recheck: true, version: 3 });
    assert.strictEqual(res.statusCode, 400, res.body);
    assert.match(parse(res).error, /version/i);
    assert.strictEqual(H.state.dispatched.length, 0);
    assert.strictEqual((await review(3)).status, R.STATUS.UNREVIEWED);
    assert.strictEqual((await review(2)).status, R.STATUS.PASSED, 'the refusal disturbed the published version');
  });
  await H.test('naming a version for a legacy entry is refused too, and naming its own is accepted', async () => {
    await seedOrg();
    await seedPublished();
    assert.strictEqual((await post({ recheck: true, version: 1 })).statusCode, 400);
    H.state.guardrailReplies = clean(3);
    const res = await post({ recheck: true, version: null });
    assert.strictEqual(res.statusCode, 202, res.body);
    assert.strictEqual(parse(res).version, null);
  });
  await H.test('an id with no public entry is not found, and neither is a source set that has gone', async () => {
    await seedOrg();
    await seedPublished();
    assert.strictEqual((await post({ recheck: true }, 'nobody-here')).statusCode, 404);
    H.state.ddb.delete(`ORG#${ORG}#SETS|SET#${SET}`);
    const gone = await post();
    assert.strictEqual(gone.statusCode, 404, gone.body);
    assert.strictEqual(H.state.dispatched.length, 0);
  });
  // rejects: a re-check of a version whose content the organisation has since
  // emptied — the check would judge nothing and write "0/0 clean" over a real
  // review, which is worse than refusing.
  await H.test('an entry whose source content is gone is refused rather than judged empty', async () => {
    await seedOrg();
    await seedPublished();
    // The QUESTION rows only: the REVIEW row shares this partition, and the
    // point of the test is that a refusal leaves it exactly as it was.
    for (const row of H.rowsWhere((r) => r.PK === V.setPartition(SRC, null) && String(r.SK).startsWith('QUESTION#'))) {
      H.state.ddb.delete(`${row.PK}|${row.SK}`);
    }
    const res = await post();
    assert.strictEqual(res.statusCode, 409, res.body);
    assert.strictEqual((await review(null)).status, R.STATUS.PASSED, 'the refusal overwrote the review');
    assert.strictEqual(H.state.dispatched.length, 0);
  });
  await H.test('an organisation admin cannot run a platform re-check, on their own set or anyone\'s', async () => {
    await seedOrg();
    await seedPublished();
    const res = await handler(H.orgEvent({ orgId: ORG, role: 'owner', method: 'POST', setId: PUB, body: { recheck: true } }), H.ctx());
    assert.strictEqual(res.statusCode, 403, res.body);
    assert.match(parse(res).error, /Engage staff/, 'refused for some other reason than who asked');
    assert.strictEqual(H.state.dispatched.length, 0);
    assert.strictEqual((await review(null)).status, R.STATUS.PASSED);
  });
  // rejects: reading the staff GROUP as permission. tenant.canManageScope's
  // interlock is the group AND no active organisation — an Engage admin
  // standing inside a customer's team is acting as that customer, and the
  // reason that interlock exists is a rename of the shared library made by
  // somebody who thought they were editing a copy.
  await H.test('Engage staff standing inside a customer\'s team cannot run it either', async () => {
    await seedOrg();
    await seedPublished();
    const inside = H.orgEvent({ orgId: ORG, role: 'owner', method: 'POST', setId: PUB, body: { recheck: true }, groups: 'admins' });
    const res = await handler(inside, H.ctx());
    assert.strictEqual(res.statusCode, 403, res.body);
    assert.match(parse(res).error, /acting as Engage/, 'refused for some other reason than the interlock');
    assert.strictEqual(H.state.dispatched.length, 0);
  });
  // rejects: platform mode alone being read as a re-check. Staff acting as
  // Engage with no org must still be told to choose one for an ordinary check.
  await H.test('staff who do not ask for a re-check still get the old answer', async () => {
    await seedOrg();
    await seedPublished();
    const res = await handler(H.platformEvent({ method: 'POST', path: { setId: SET }, body: { version: 2 } }), H.ctx());
    assert.strictEqual(res.statusCode, 400, res.body);
    assert.match(parse(res).error, /organisation/i);
  });

  // rejects: the re-check quietly changing what an organisation's own submit
  // does — their cap, their stamp, their publish.
  await H.test('an organisation\'s own check is unchanged: it charges the cap, stamps checking, and may publish', async () => {
    await seedOrg({ versions: [2], active: 2 });
    H.state.guardrailReplies = clean(3);
    const res = await handler(H.orgEvent({ orgId: ORG, role: 'owner', method: 'POST', setId: SET, body: { version: 2 } }), H.ctx());
    assert.strictEqual(res.statusCode, 202, res.body);
    assert.strictEqual((await stampOf()).status, 'checking');
    assert.strictEqual(H.state.ddb.get(`ORG#${ORG}|CHECKS#${DAY()}`).submits, 1);
    await handler({ __workerMode: true, jobId: parse(res).jobId }, H.ctx());
    assert.strictEqual((await review(2)).status, R.STATUS.PASSED);
    assert.strictEqual((await stampOf()).status, 'published', 'the organisation\'s own share stopped publishing');
    assert.strictEqual(H.state.ddb.get(`ORG#${ORG}|CHECKS#${DAY()}`).units, 3);
  });

  console.log('\nthe job, and what happens when it cannot run\n');

  await H.test('staff can poll the re-check they started, and the organisation can see it too', async () => {
    await seedOrg();
    await seedPublished();
    const { jobId } = parse(await post());
    const mine = await poll(jobId);
    assert.strictEqual(mine.statusCode, 200, mine.body);
    assert.strictEqual(parse(mine).jobId, jobId);
    const theirs = await handler(H.orgEvent({ orgId: ORG, role: 'member', method: 'GET', setId: SET, jobId }), H.ctx());
    assert.strictEqual(theirs.statusCode, 200, 'the organisation cannot see a check run against its own set');
    const other = await handler(H.orgEvent({ orgId: 'org_rival', role: 'owner', method: 'GET', setId: SET, jobId }), H.ctx());
    assert.strictEqual(other.statusCode, 404, 'another organisation could read the job');
    assert.strictEqual((await poll('nope')).statusCode, 404);
  });

  // rejects: the lock's Put wiping the review row and abandonCheck then
  // DELETING it — which loses the approval, the notice and the passed status of
  // a set the library is still serving, over a dispatch that never happened.
  await H.test('a dispatch that fails puts the review row back exactly as it was', async () => {
    await seedOrg();
    await seedPublished();
    const before = await review(null);
    H.state.lambdaShouldFail = true;
    const res = await post();
    assert.strictEqual(res.statusCode, 500, res.body);
    assert.deepStrictEqual(await review(null), before, 'the review row did not survive the failed dispatch');
    assert.strictEqual((await stampOf()).status, 'published');
  });

  // rejects: a re-check racing the organisation's own check, both writing the
  // review row. The lock is shared, and it is the whole reason it exists.
  await H.test('a re-check while a check is already running is refused with 409', async () => {
    await seedOrg();
    await seedPublished();
    assert.strictEqual((await post()).statusCode, 202);
    const second = await post();
    assert.strictEqual(second.statusCode, 409, second.body);
    assert.strictEqual(parse(second).status, 'checking');
    assert.strictEqual(H.state.dispatched.length, 1);
  });

  // rejects: a worker that crashes taking the human decision with it. The
  // catch path writes its own row from a fixed list of facts.
  await H.test('a re-check that fails mid-run escalates and still keeps the approval it found', async () => {
    await seedOrg();
    await seedPublished();
    const { jobId } = parse(await post());
    const real = db.send.bind(db);
    let tripped = false;
    db.send = async (cmd) => {
      if (!tripped && cmd && cmd.kind === 'query' && String((cmd.input || {}).ExpressionAttributeValues[':pk'] || '').includes(`SET#${SET}`)) {
        tripped = true;
        throw new Error('the table went away');
      }
      return real(cmd);
    };
    try {
      await handler({ __workerMode: true, jobId }, H.ctx());
    } finally {
      db.send = real;
    }
    const r = await review(null);
    assert.strictEqual(r.status, R.STATUS.ESCALATED);
    assert.deepStrictEqual(r.reasons, ['error']);
    assert.strictEqual(r.reviewer, 'dai', 'the failure erased the approval');
    assert.deepStrictEqual(r.notice, ['graphic-violence']);
    assert.strictEqual((await J.getJob(db, T, jobId)).status, 'error');
    assert.strictEqual((await stampOf()).status, 'published', 'a failed re-check moved the author\'s stamp');
  });

  H.summary();
})();
