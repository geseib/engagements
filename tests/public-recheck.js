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
// R1 and R3 are not properties of the re-check alone: they are properties of
// everything the queue row it raises can reach. The review dialog is the only
// other surface that acts on a queue row, so its route is driven from here.
const { handler: decideHandler } = require(path.join(H.REPO, 'lambda-functions/admin/moderation-decide.js'));
// R3 reaches the AUTHOR too: a FLAGGED re-check leaves their REVIEW row in the
// one state the appeal route takes, and an appeal writes the share stamp a
// re-check must never write.
const { handler: appealHandler } = require(path.join(H.REPO, 'lambda-functions/admin/appeal-question-set.js'));
// …and the takedown, which is the other thing that can act on the row it raises.
const { handler: libraryHandler } = require(path.join(H.REPO, 'lambda-functions/admin/public-library-item.js'));

const ORG = 'org_acme'; const SET = 'crime';
const SRC = { scope: 'org', orgId: ORG, setId: SET };
const PUB = publicSetIdFor(ORG, SET);
const PUBREF = { scope: 'public', orgId: '', setId: PUB };
const HASH = 'c'.repeat(64);
const DAY = () => new Date().toISOString().slice(0, 10);

const parse = (res) => JSON.parse(res.body || '{}');
/** Engage staff, acting as Engage, asking for the re-check of one public entry. */
const post = (body = { recheck: true }, publicSetId = PUB) => handler(H.platformEvent({ method: 'POST', path: { setId: publicSetId }, body }), H.ctx());
/** The review dialog's route, against a queue row the re-check raised. */
const decide = (body) => decideHandler(H.platformEvent({ method: 'POST', body }), H.ctx());
/** The author, asking a person to look at what the re-check made of their set. */
const appeal = (body) => appealHandler(H.orgEvent({ orgId: ORG, role: 'owner', method: 'POST', setId: SET, body }), H.ctx());
const poll = (jobId) => handler(H.platformEvent({ method: 'GET', path: { setId: PUB, jobId } }), H.ctx());
const review = (version) => R.readReview(db, T, SRC, version);
const stampOf = async () => S.readShareStamp(await C.decryptItem(ORG, 'set', H.state.ddb.get(`ORG#${ORG}#SETS|SET#${SET}`)));
const queue = () => H.rowsWhere((r) => r.PK === Q.QUEUE_PK);
/** The one row raised over the LISTING — a re-check's own key, never the organisation's. */
const listingRow = () => queue().find((r) => r.SK === `PUBLIC#${PUB}`);
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

  /*
    R2 COVERS WHAT THE AUTHOR DECLARED TOO, and it is the one thing on the row
    no check can re-derive: `declaredNotice` is the author's own statement about
    their own content, made when they shared it, and the content says nothing
    about it. A re-check that wrote its own empty list over it would erase it
    for good — and with it the score card's "Why a person was needed: Declared:
    graphic violence", which is the whole account of why a person was ever in
    this set's history.

    It must come back WITHOUT holding the set a second time. A version carrying
    a declaration reaches the library only because a person ruled on it, and
    that ruling is what this re-check is carrying forward; re-escalating on it
    would queue every declared listing in the library on every staff re-check
    and bury the findings that are real.
  */
  await H.test('what the author declared survives the re-check, and does not hold the set a second time', async () => {
    await seedOrg();
    await seedPublished();
    H.state.guardrailReplies = clean(3);
    await recheck();
    const r = await review(null);
    assert.deepStrictEqual(r.declaredNotice, ['graphic-violence'], 'the author\'s declaration was erased');
    assert.ok(Array.isArray(r.reasons) && r.reasons.includes('declared'), `the card's reasons line lost the declaration: ${JSON.stringify(r.reasons)}`);
    assert.strictEqual(r.status, R.STATUS.PASSED, `a declaration a person already ruled on escalated again: ${r.status}`);
    assert.strictEqual(queue().length, 0, 'a carried declaration queued an approved listing again');
  });

  // rejects: the exemption above being read as "a declaration never holds a
  // set". With nobody's ruling to carry, the declaration is still a reason a
  // person is needed, exactly as it is on an organisation's own check.
  await H.test('a declaration no person has ruled on still holds the set and queues it', async () => {
    await seedOrg();
    await seedPublished({ reviewer: '' });
    H.state.guardrailReplies = clean(3);
    await recheck();
    const r = await review(null);
    assert.deepStrictEqual(r.declaredNotice, ['graphic-violence']);
    assert.strictEqual(r.status, R.STATUS.ESCALATED, `an undecided declaration passed: ${r.status}`);
    assert.strictEqual(queue().length, 1, 'nobody will ever see an undecided declaration');
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
    // The LISTING's key, not the organisation's version key — see the collision
    // test below for what sharing that key cost, and for a legacy entry like
    // this one it is the only shape either queue route can name at all.
    assert.strictEqual(row.SK, `PUBLIC#${PUB}`, `the queue row is keyed ${row.SK}`);
    assert.strictEqual(row.publicSetId, PUB, 'the queue row does not name the public entry it is about');
    assert.strictEqual(row.orgId, ORG, 'the row does not name whose set it is');
    assert.strictEqual(row.title, 'True crime', 'the row does not name the set');
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

  /*
    R1 AND R3 REACH PAST THE RE-CHECK, into the worklist it feeds.

    A queue row raised over a listing the library is already serving is not a
    publish request, and the review dialog's two buttons are the only things
    that act on a queue row. APPROVE would run moderation-decide's ordinary
    path — `escalated` is open, so nothing resumes — and publishSnapshot without
    `resume` mints a SECOND public version of content already live, flips
    `activeVersion` onto it and rewrites the author's share stamp: the exact
    "every card becomes Public v2" R1 exists to prevent. REJECT would stamp the
    author `flagged`, with a note they read, for a check nobody told them about
    — while the library goes on serving the set, so the finding is dismissed as
    well. Whichever button staff press the result is wrong, so neither decides
    here: the surface that acts on this row is the score card, which shows the
    escalation, what held it, and Take down.
  */
  await H.test('the queue row a re-check raised is not decided in the review dialog: neither button publishes it again or tells its author off', async () => {
    await seedOrg({ versions: [2, 3], active: 3 });
    await seedPublished({ sourceVersion: 2 });
    H.state.guardrailReplies = [H.guardrailFull({ HATE: 'MEDIUM' }, { HATE: true }), ...clean(2)];
    await recheck();
    const [row] = queue();
    // The precondition that makes this a real test rather than a vacuous one:
    // the snapshot approve would publish is really in S3, so a refusal is the
    // route's own decision and not the absence of anything to publish.
    assert.ok(H.state.s3.has(`prompts-test/${row.snapshotKey}`), 'no snapshot: approve would refuse for the wrong reason');
    assert.strictEqual((await review(2)).status, R.STATUS.ESCALATED);
    const before = libraryState();

    for (const decision of ['approve', 'reject']) {
      const res = await decide({ sk: row.SK, decision, note: 'Looks fine to me.' }); // eslint-disable-line no-await-in-loop
      assert.ok(res.statusCode === 400 || res.statusCode === 409, `${decision}: ${res.body}`);
      assert.ok(parse(res).error, `${decision} refused without saying anything`);
    }
    assert.strictEqual(libraryState(), before, 'a decision on the re-check\'s row changed what the library serves');
    const meta = V.setMetadataKey(PUBREF);
    assert.strictEqual(H.state.ddb.get(`${meta.PK}|${meta.SK}`).activeVersion, 1, 'the active version moved');
    assert.strictEqual((await stampOf()).status, 'published', 'the author was told off for a check nobody told them about');
    assert.strictEqual((await review(2)).status, R.STATUS.ESCALATED, 'the refusal decided the review anyway');
    assert.strictEqual(queue().length, 1, 'the refusal cleared the row a person still has to look at');
  });

  /*
    THE COLLISION THE LISTING'S OWN KEY EXISTS TO PREVENT.

    An organisation may submit a version the library is already serving — a
    re-share of the same content, or an escalation they are waiting on — and
    that submission IS a publish request: the review dialog decides it, and its
    author reads "waiting for a person at Engage" until somebody does.

    Keyed by the version, a staff re-check landed on that very row and stamped
    `recheck: true` onto it, and moderation-decide then refused BOTH decisions
    there. Their pending share became one no member of staff could answer, from a
    button whose dialog promises "It changes nothing anyone can see". So a
    re-check is keyed by the LISTING it is about and the two rows cannot meet.
  */
  await H.test('a re-check does not land on the organisation\'s own pending publish request', async () => {
    await seedOrg({ versions: [2], active: 2 });
    await seedPublished({ sourceVersion: 2 });
    // THEIRS: the organisation submits the served version again and it escalates.
    H.state.guardrailReplies = [H.guardrailFull({ HATE: 'MEDIUM' }, { HATE: true }), ...clean(2)];
    const theirs = await handler(H.orgEvent({ orgId: ORG, role: 'owner', method: 'POST', setId: SET, body: { version: 2 } }), H.ctx());
    assert.strictEqual(theirs.statusCode, 202, theirs.body);
    await handler({ __workerMode: true, jobId: parse(theirs).jobId }, H.ctx());
    assert.strictEqual((await stampOf()).status, 'escalated', 'fixture: the author is waiting on a person');
    // OURS: staff re-check the same version.
    H.state.guardrailReplies = [H.guardrailFull({ HATE: 'MEDIUM' }, { HATE: true }), ...clean(2)];
    await recheck();

    const theirRow = queue().find((r) => r.SK === `${ORG}#${SET}#v2`);
    assert.ok(theirRow, 'the organisation\'s own publish request was taken over by the re-check');
    assert.strictEqual(theirRow.recheck, false, 'the re-check flagged the organisation\'s own row undecidable');
    assert.ok(listingRow(), 'the re-check raised nothing of its own');
    assert.strictEqual(queue().length, 2, `two subjects, two rows: ${queue().map((r) => r.SK)}`);
    // …and theirs is still decided exactly as it always was.
    const decided = await decide({ sk: theirRow.SK, decision: 'approve', note: 'Historical.' });
    assert.strictEqual(decided.statusCode, 200, decided.body);
    assert.strictEqual(parse(decided).publicSetId, PUB);
    assert.ok(listingRow(), 'deciding their share cleared the re-check\'s row too');
  });

  // rejects: leaning on the key alone. moderation-decide's own refusal is the
  // second lock, for a row that carries the flag by any other route.
  await H.test('an org-keyed row that carries the re-check flag is still refused both decisions', async () => {
    await seedOrg({ versions: [2], active: 2 });
    await seedPublished({ sourceVersion: 2 });
    await Q.upsertQueueRow(db, T, {
      ref: SRC, version: 2, reason: 'escalated', orgId: ORG, title: 'True crime', publicSetId: PUB, recheck: true,
    });
    const before = libraryState();
    for (const decision of ['approve', 'reject']) {
      const res = await decide({ sk: `${ORG}#${SET}#v2`, decision, note: 'Looks fine to me.' }); // eslint-disable-line no-await-in-loop
      assert.strictEqual(res.statusCode, 409, `${decision}: ${res.body}`);
      assert.match(parse(res).error, /score card/i, `${decision} did not say where the decision belongs`);
    }
    assert.strictEqual(libraryState(), before);
    assert.strictEqual((await stampOf()).status, 'published');
  });

  /*
    R7's OTHER HALF: THE EXIT THAT IS NOT A TAKEDOWN.

    Nothing is taken down automatically, so a re-check that comes out worse
    raises a row for a person. Neither ordinary decision answers it, and before
    "Leave it serving" existed the only control left was Take down — the
    destructive one, on content a person had already approved. The likely outcome
    of exactly the re-checks the owner wants is a MEDIUM band somebody already
    ruled on (content-guardrail.js escalates on MEDIUM), so "the approval stands"
    is the COMMON case, and with no way to say it the row and the nav badge it
    feeds aged for ever.
  */
  await H.test('a re-check\'s row can be left serving: the row goes, and nothing else moves', async () => {
    await seedOrg();
    await seedPublished();
    H.state.guardrailReplies = [H.guardrailFull({ HATE: 'MEDIUM' }, { HATE: true }), ...clean(2)];
    await recheck();
    const raised = listingRow();
    assert.ok(raised, 'fixture: the re-check raised a row');
    const before = libraryState();
    const reviewBefore = JSON.stringify(await review(null));
    const res = await decide({ sk: raised.SK, decision: 'leave', note: 'Historical, as the approval says.' });
    assert.strictEqual(res.statusCode, 200, res.body);
    assert.strictEqual(parse(res).leftServing, PUB);
    assert.strictEqual(queue().length, 0, 'the row a person has now answered is still in the worklist');
    assert.strictEqual(JSON.stringify(await review(null)), reviewBefore, 'leaving it serving rewrote the review row');
    assert.strictEqual(libraryState(), before, 'leaving it serving changed what the library serves');
    assert.strictEqual((await stampOf()).status, 'published', 'leaving it serving moved the author\'s stamp');
    assert.ok(H.state.s3.has(`prompts-test/${raised.snapshotKey}`), 'the snapshot was deleted');
    // The customer's log: what Engage did to their set, and who did it.
    const left = (await logOf()).filter((e) => e.event === 'left-serving');
    assert.strictEqual(left.length, 1, 'the organisation\'s log does not record it');
    assert.strictEqual(left[0].reviewer, 'dai');
    assert.strictEqual(left[0].publicSetId, PUB);
    assert.strictEqual(left[0].version, null, 'the log named a version this set does not have');
    assert.strictEqual(left[0].note, 'Historical, as the approval says.');
  });
  // rejects: a general-purpose delete button. An organisation's own escalated
  // publish request is a decision somebody owes them, not a row to sweep away.
  await H.test('an organisation\'s own waiting row cannot be left serving', async () => {
    await seedOrg({ versions: [2], active: 2 });
    H.state.guardrailReplies = [H.guardrailFull({ HATE: 'MEDIUM' }, { HATE: true }), ...clean(2)];
    const theirs = await handler(H.orgEvent({ orgId: ORG, role: 'owner', method: 'POST', setId: SET, body: { version: 2 } }), H.ctx());
    await handler({ __workerMode: true, jobId: parse(theirs).jobId }, H.ctx());
    const [row] = queue();
    const res = await decide({ sk: row.SK, decision: 'leave' });
    assert.strictEqual(res.statusCode, 409, res.body);
    assert.match(parse(res).error, /re-check/i, 'the refusal did not say why');
    assert.strictEqual(queue().length, 1, 'the refusal cleared their row anyway');
  });
  await H.test('only Engage staff, acting as Engage, can leave one serving', async () => {
    await seedOrg();
    await seedPublished();
    H.state.guardrailReplies = [H.guardrailFull({ HATE: 'MEDIUM' }, { HATE: true }), ...clean(2)];
    await recheck();
    const sk = listingRow().SK;
    const res = await decideHandler(H.orgEvent({ orgId: ORG, role: 'owner', method: 'POST', body: { sk, decision: 'leave' } }), H.ctx());
    assert.strictEqual(res.statusCode, 403, res.body);
    assert.strictEqual(queue().length, 1);
    // …and a row that is no longer there is not an error to fix, it is gone.
    assert.strictEqual((await decide({ sk: `PUBLIC#${PUB}`, decision: 'leave' })).statusCode, 200);
    assert.strictEqual((await decide({ sk: `PUBLIC#${PUB}`, decision: 'leave' })).statusCode, 404);
  });

  // rejects: a row keyed where the takedown does not look. Taking the listing
  // down is one of the two exits from a re-check's row, and it clears exactly
  // this key (public-library-item.js) — for a legacy entry included, which the
  // organisation's own version key could never express.
  await H.test('taking the listing down clears the row the re-check raised', async () => {
    await seedOrg();
    await seedPublished();
    H.state.guardrailReplies = [H.guardrailFull({ VIOLENCE: 'HIGH' }, { VIOLENCE: true }), ...clean(2)];
    await recheck();
    assert.ok(listingRow(), 'fixture: the re-check raised a row');
    const res = await libraryHandler(H.platformEvent({
      method: 'DELETE', path: { publicSetId: PUB }, body: { note: 'The re-check found a high band.' },
    }), H.ctx());
    assert.strictEqual(res.statusCode, 200, res.body);
    assert.strictEqual(queue().length, 0, `the row outlived the listing it pointed at: ${queue().map((r) => r.SK)}`);
  });

  // rejects: a row raised over a listing that has just been taken down. Its
  // `Score card` button would open a 404, and the takedown that would have
  // cleared the row ran before the row existed.
  await H.test('a re-check whose listing is taken down mid-run raises nothing', async () => {
    await seedOrg();
    await seedPublished();
    H.state.guardrailReplies = [H.guardrailFull({ VIOLENCE: 'HIGH' }, { VIOLENCE: true }), ...clean(2)];
    const res = await post();
    assert.strictEqual(res.statusCode, 202, res.body);
    // The takedown, while the worker is between the POST and its own run.
    const meta = V.setMetadataKey(PUBREF);
    H.state.ddb.delete(`${meta.PK}|${meta.SK}`);
    await handler({ __workerMode: true, jobId: parse(res).jobId }, H.ctx());
    assert.strictEqual((await review(null)).status, R.STATUS.FLAGGED, 'the check still records what it saw');
    assert.strictEqual(queue().length, 0, `a row was raised over a listing that is gone: ${queue().map((r) => r.SK)}`);
  });

  // rejects: the resumed-reject branch being reachable on a FLAGGED re-check.
  // `flagged` is not open, so approve answers "already decided" and resumed
  // reject is the ONLY branch a reject reaches — and it writes the author a
  // `flagged` stamp and DELETES the snapshot a person still has to look at.
  await H.test('a re-check that flagged is refused the same way, the resumed reject included', async () => {
    await seedOrg({ versions: [2], active: 2 });
    await seedPublished({ sourceVersion: 2 });
    H.state.guardrailReplies = [H.guardrailFull({ VIOLENCE: 'HIGH' }, { VIOLENCE: true }), ...clean(2)];
    await recheck();
    const [row] = queue();
    assert.strictEqual((await review(2)).status, R.STATUS.FLAGGED);
    const res = await decide({ sk: row.SK, decision: 'reject', note: 'Down it goes.' });
    assert.ok(res.statusCode === 400 || res.statusCode === 409, res.body);
    assert.ok(parse(res).error, 'refused without saying anything');
    assert.strictEqual((await stampOf()).status, 'published');
    assert.ok(H.state.s3.has(`prompts-test/${row.snapshotKey}`), 'the snapshot a person still needs was deleted');
    assert.strictEqual(queue().length, 1);
  });

  /*
    …AND PAST THE AUTHOR, who is the one person the re-check never told.

    A FLAGGED re-check leaves the organisation's REVIEW row reading `flagged`,
    and `flagged` is exactly the state the appeal route takes. Down that route
    the author reached every outcome R1 and R3 forbid without staff touching
    anything: the share stamp went to `appealed`, moving their own live set out
    of the published state R3 promises them; the queue row was bumped, which
    cleared the `recheck` flag moderation-decide.js refuses on; and Approve then
    minted a second public version of content already live.

    Two locks, because the door has two sides. The appeal is refused for a
    version the library is serving, and a raising that says nothing about
    `recheck` — which is every appeal and every report — no longer clears it.
  */
  await H.test('the author cannot appeal a re-check\'s verdict, and their set is untouched by the refusal', async () => {
    await seedOrg({ versions: [2], active: 2 });
    await seedPublished({ sourceVersion: 2 });
    const before = libraryState();
    H.state.guardrailReplies = [H.guardrailFull({ VIOLENCE: 'HIGH' }, { VIOLENCE: true }), ...clean(2)];
    await recheck();
    assert.strictEqual((await review(2)).status, R.STATUS.FLAGGED, 'not the state an appeal is taken from');
    const res = await appeal({ version: 2, message: 'Nobody told us about this.' });
    assert.strictEqual(res.statusCode, 409, res.body);
    assert.match(parse(res).error, /public library/i, 'the refusal did not say why');
    assert.strictEqual((await stampOf()).status, 'published', 'the appeal moved the author out of published');
    assert.strictEqual((await review(2)).status, R.STATUS.FLAGGED, 'the refusal appealed it anyway');
    assert.strictEqual(libraryState(), before, 'the refusal changed what the library serves');
    assert.strictEqual(queue()[0].recheck, true, 'the guard on the re-check\'s row was cleared');
  });

  // rejects: leaning on the appeal route alone. A raising from the author's side
  // of the same version must not be able to reach the re-check's row — before
  // the key separated them, the bump turned off the very flag the decide route
  // consults, and Approve then published content already live a second time.
  await H.test('an appeal-shaped raising cannot reach the re-check\'s row at all', async () => {
    await seedOrg({ versions: [2], active: 2 });
    await seedPublished({ sourceVersion: 2 });
    H.state.guardrailReplies = [H.guardrailFull({ HATE: 'MEDIUM' }, { HATE: true }), ...clean(2)];
    await recheck();
    const raised = listingRow();
    const before = libraryState();
    // Exactly the shape appeal-question-set.js raises, were it ever reached.
    await Q.upsertQueueRow(db, T, {
      ref: SRC, version: 2, reason: 'appealed', appealMessage: 'Nobody told us about this.',
    });
    const still = listingRow();
    assert.strictEqual(still.latestAt, raised.latestAt, 'the raising bumped the re-check\'s row');
    assert.strictEqual(still.recheck, true, 'the raising cleared the guard');
    assert.deepStrictEqual(still.reasons, ['escalated'], 'the raising joined itself to the re-check\'s row');
    assert.strictEqual(still.appealMessage, undefined, 'the author\'s words landed on staff\'s own row');
    const theirs = queue().find((r) => r.SK === `${ORG}#${SET}#v2`);
    assert.ok(theirs, 'the raising went nowhere');
    assert.strictEqual(theirs.appealMessage, 'Nobody told us about this.');
    assert.strictEqual(theirs.recheck, false, 'a row no re-check raised reads as one');
    assert.strictEqual(libraryState(), before);
  });

  // rejects: the refusal above catching every queue row. An organisation's own
  // escalated share is still decided in the dialog, and still publishes.
  await H.test('an ordinary escalated row is still decided in the dialog, and still publishes', async () => {
    await seedOrg({ versions: [2], active: 2 });
    H.state.guardrailReplies = [H.guardrailFull({ HATE: 'MEDIUM' }, { HATE: true }), ...clean(2)];
    const res = await handler(H.orgEvent({ orgId: ORG, role: 'owner', method: 'POST', setId: SET, body: { version: 2 } }), H.ctx());
    assert.strictEqual(res.statusCode, 202, res.body);
    await handler({ __workerMode: true, jobId: parse(res).jobId }, H.ctx());
    const [row] = queue();
    assert.strictEqual(row.SK, `${ORG}#${SET}#v2`);
    const decided = await decide({ sk: row.SK, decision: 'approve', note: 'Historical.' });
    assert.strictEqual(decided.statusCode, 200, decided.body);
    assert.strictEqual(parse(decided).publicSetId, PUB);
    assert.strictEqual(queue().length, 0);
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
    assert.deepStrictEqual(r.declaredNotice, ['graphic-violence'], 'the failure erased what the author declared');
    assert.strictEqual((await J.getJob(db, T, jobId)).status, 'error');
    assert.strictEqual((await stampOf()).status, 'published', 'a failed re-check moved the author\'s stamp');
  });

  H.summary();
})();
