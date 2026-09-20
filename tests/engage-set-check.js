// tests/engage-set-check.js
/**
 * ENGAGE'S OWN SHARED SETS ARE CHECKED TOO.
 *
 * `docs/superpowers/specs/2026-09-17-public-library-moderation-design.md` §10.5
 * ends "Reached from every queue row, from the staff Public library, and from
 * the Shared library for Engage's own sets", and nothing has ever checked one.
 * A platform set is served to EVERY organisation, so it is the widest-reaching
 * content in the product and the only library with no measurement at all.
 *
 * The owner's decision: an Engage set is checked when it becomes servable, and
 * on demand from its card. What that check must and must not do:
 *
 *   P1  it publishes nothing. There is no public copy of an Engage set, no
 *       public version to mint and no share stamp to move — the set is already
 *       the thing every organisation reads.
 *   P2  only Engage staff ACTING AS ENGAGE can ask for one. An organisation
 *       cannot reach a platform set through this route, and neither can a
 *       member of staff standing inside a customer's team.
 *   P3  it charges no organisation. There is no org whose daily cap could be
 *       spent and no org ledger the spend belongs on.
 *   P4  an outcome worse than passed goes to a PERSON — flagged included, since
 *       unlike an organisation's own submission there is no author to tell —
 *       on the queue key §3.2 reserves for Engage's own set, `PLATFORM#<setId>`,
 *       and it is answerable there with a decision that already exists.
 *   P5  a platform row is PLAINTEXT. Reaching for tenant-crypto with no orgId
 *       throws, so a check that comes back `passed` with a tally is also the
 *       proof that the worker did not try to decrypt Engage's own library.
 *   P6  switching a set on answers at once and cannot fail because of a check.
 *
 * X1 — an organisation's own share path is untouched — is guarded in full by
 * tests/set-check-job.js and tests/public-recheck.js, which both still pass;
 * the last case here is a short restatement so this file fails too if it moves.
 *
 * // rejects: a platform check that publishes, stamps, decrypts, charges an
 * //          organisation, raises a row nobody can answer, or raises none at
 * //          all; an activation that waits for, or fails on, a check.
 */
const path = require('path');
const assert = require('assert');
const H = require('./helpers/moderation-harness');
H.install();
const { DynamoDBDocumentClient } = require('@aws-sdk/lib-dynamodb');
const db = DynamoDBDocumentClient.from({});
const T = 'engage-test';
const V = require(path.join(H.REPO, 'lambda-functions/admin/shared/set-version.js'));
const R = require(path.join(H.REPO, 'lambda-functions/admin/shared/set-review.js'));
const L = require(path.join(H.REPO, 'lambda-functions/admin/shared/review-log.js'));
const Q = require(path.join(H.REPO, 'lambda-functions/admin/shared/moderation-queue.js'));
const C = require(path.join(H.REPO, 'lambda-functions/admin/shared/tenant-crypto.js'));
const J = require(path.join(H.REPO, 'lambda-functions/admin/shared/generation-jobs.js'));
const { handler } = require(path.join(H.REPO, 'lambda-functions/admin/check-question-set.js'));
// P4 is a property of what the row it raises can reach, so the three surfaces
// that act on a queue row are driven from here too.
const { handler: decideHandler } = require(path.join(H.REPO, 'lambda-functions/admin/moderation-decide.js'));
const { handler: getHandler } = require(path.join(H.REPO, 'lambda-functions/admin/moderation-get.js'));
const { handler: listHandler } = require(path.join(H.REPO, 'lambda-functions/admin/moderation-list.js'));
// P6 is a property of the route that switches a set on.
const { handler: toggleHandler } = require(path.join(H.REPO, 'lambda-functions/admin/toggle-question-set.js'));

const SET = 'warmups';
const REF = { scope: 'platform', orgId: '', setId: SET };
const ORG = 'org_acme';
const ORGSET = 'safety';
const ORGREF = { scope: 'org', orgId: ORG, setId: ORGSET };

const parse = (res) => JSON.parse(res.body || '{}');
const metaRow = (ref) => H.state.ddb.get(`${V.setMetadataKey(ref).PK}|${V.setMetadataKey(ref).SK}`);
const queue = () => H.rowsWhere((r) => r.PK === Q.QUEUE_PK);
const platformRow = () => queue().find((r) => r.SK === `PLATFORM#${SET}`);
const publicRows = () => H.rowsWhere((r) => String(r.PK).startsWith('PUBLIC#'));
const checksRows = () => H.rowsWhere((r) => String(r.SK).startsWith('CHECKS#'));
const logEvents = (ref) => H.rowsWhere((r) => r.PK === L.reviewLogPk(ref)).map((e) => e.event).sort();
const review = (version = null) => R.readReview(db, T, REF, version);
const clean = (n) => Array.from({ length: n }, () => H.guardrailFull());

/**
 * One of Engage's own sets, as the importer leaves it: PLAINTEXT, in the
 * platform partition, with no organisation anywhere on it. `[null]` is the
 * unversioned partition, which is where most of Engage's library still lives.
 */
function seedEngageSet({ versions = [null], activeVersion = null, questions = 2, active = true } = {}) {
  H.reset();
  const numbered = versions.filter((v) => v !== null);
  H.seedRow({
    ...V.setMetadataKey(REF),
    name: 'Warm ups', description: 'Openers for a cold room.', engagementType: 'call-and-answer',
    scope: 'platform', questionCount: questions, active,
    ...(activeVersion ? { activeVersion } : {}),
    ...(numbered.length ? { versions: numbered.map((v) => ({ version: v, questionCount: questions })) } : {}),
  });
  for (const v of versions) {
    const pk = V.setPartition(REF, v);
    H.seedRow({ PK: pk, SK: 'CATEGORY#c001', Name: 'Openers', QuestionCount: questions });
    for (let i = 1; i <= questions; i += 1) {
      H.seedRow({
        PK: pk, SK: `QUESTION#c001#${String(i).padStart(3, '0')}`,
        Title: `Opener ${i} of ${v === null ? 'the unversioned set' : `version ${v}`}`,
        Detail: 'Say one word.', Category: 'c001', Image: '', Active: true,
      });
    }
  }
}

/** An organisation's own set, encrypted the way upload writes it. */
async function seedOrgSet({ questions = 2 } = {}) {
  H.seedRow({ PK: `ORG#${ORG}`, SK: 'METADATA', orgId: ORG, name: 'Acme Learning' });
  H.seedRow(await C.encryptItem(ORG, 'set', {
    ...V.setMetadataKey(ORGREF), name: 'Safety walkthrough', description: 'Site induction.',
    engagementType: 'trivia', scope: 'org', orgId: ORG, activeVersion: 2,
    versions: [{ version: 2, questionCount: questions }], questionCount: questions, createdBy: 'sub-amara',
  }));
  for (let i = 1; i <= questions; i += 1) {
    H.seedRow(await C.encryptItem(ORG, 'question', { // eslint-disable-line no-await-in-loop
      PK: V.setPartition(ORGREF, 2), SK: `QUESTION#q00${i}`, Title: `Hazard ${i}`, Detail: 'Name it.',
      optionA: 'A', optionB: 'B', correctAnswer: 'A', Category: 'c001', Image: '', Active: true,
    }));
  }
}

/** Engage staff, acting as Engage, asking for the check of one of their sets. */
const post = (body = {}, setId = SET) => handler(H.platformEvent({ method: 'POST', path: { setId }, body }), H.ctx());
/** The POST, then the worker it dispatched — the whole check, as production runs it. */
async function runCheck(body = {}, setId = SET) {
  const res = await post(body, setId);
  assert.strictEqual(res.statusCode, 202, res.body);
  const { jobId } = parse(res);
  await handler({ __workerMode: true, jobId }, H.ctx());
  return { res, jobId };
}
const decide = (body) => decideHandler(H.platformEvent({ method: 'POST', body }), H.ctx());
const open = (sk) => getHandler(H.platformEvent({ method: 'GET', path: { sk } }), H.ctx());
const list = () => listHandler(H.platformEvent({ method: 'GET' }), H.ctx());
const toggle = (event) => toggleHandler(event, H.ctx());

(async () => {
  console.log('\nEngage\'s own sets are checked too\n');

  // ── ON DEMAND ────────────────────────────────────────────────────────────

  // rejects: a worker that reaches for tenant-crypto with no orgId (which
  // throws, so the review row would read `escalated` with reasons ['error']).
  await H.test('an Engage set is checked on demand, and what the check measured is on its review row', async () => {
    seedEngageSet();
    H.state.guardrailReplies = clean(3);
    await runCheck();
    const r = await review();
    assert.strictEqual(r.status, R.STATUS.PASSED, `review is ${r.status}: ${r.note}`);
    assert.ok(r.tally, 'the check recorded no tally — the card would have nothing to show');
    assert.strictEqual(r.tally.questions, 2);
    assert.strictEqual(r.version, null, 'the review row was relabelled with a version the set does not have');
    assert.ok(r.snapshotKey && H.state.s3.has(`prompts-test/${r.snapshotKey}`), 'no snapshot in S3');
    const judged = H.state.sentGuardrail.map((c) => c.content[0].text.text).join('\n');
    assert.ok(judged.includes('Opener 1'), `the check judged: ${judged.slice(0, 200)}`);
  });

  // P1. rejects: the ordinary publish tail running for a platform set.
  await H.test('the check publishes nothing and stamps nothing on the set', async () => {
    seedEngageSet();
    H.state.guardrailReplies = clean(3);
    await runCheck();
    assert.deepStrictEqual(publicRows(), [], 'a platform check minted a public copy');
    assert.strictEqual(metaRow(REF).share, undefined, 'a platform set was given a share stamp');
    assert.strictEqual(H.state.ddb.get(`${R.publishedKey(REF, null).PK}|PUBLISHED`), undefined, 'a PUBLISHED marker was written');
  });

  // P3. rejects: recordUnits or reserveSubmit landing on `ORG#` — an
  // organisation-shaped row for a set no organisation owns.
  await H.test('no organisation\'s cap or ledger is touched by Engage checking its own set', async () => {
    seedEngageSet();
    H.state.guardrailReplies = clean(3);
    await runCheck();
    assert.deepStrictEqual(checksRows(), [], `a check counter was written: ${JSON.stringify(checksRows())}`);
  });

  // P5's other half: the set's own log is where Engage's library records this.
  await H.test('the check is recorded in the set\'s own review log', async () => {
    seedEngageSet();
    H.state.guardrailReplies = clean(3);
    await runCheck();
    assert.deepStrictEqual(logEvents(REF), ['checked']);
  });

  await H.test('a versioned Engage set is checked on the version it is serving', async () => {
    seedEngageSet({ versions: [1, 2], activeVersion: 2 });
    H.state.guardrailReplies = clean(3);
    await runCheck();
    const judged = H.state.sentGuardrail.map((c) => c.content[0].text.text).join('\n');
    assert.ok(judged.includes('version 2'), `the check judged: ${judged.slice(0, 200)}`);
    assert.ok(!judged.includes('version 1'), 'the check judged a version the library is not serving');
    assert.strictEqual((await review(2)).status, R.STATUS.PASSED);
    assert.strictEqual((await review(1)).status, R.STATUS.UNREVIEWED, 'a version nobody is serving was given a review');
  });

  // ── WHO MAY ASK ──────────────────────────────────────────────────────────

  // P2. rejects: a route that lets an organisation read Engage's library
  // through the check, or that treats the `admins` group alone as permission.
  await H.test('an organisation cannot check an Engage set, and neither can staff standing inside one', async () => {
    seedEngageSet();
    const member = await handler(H.orgEvent({ orgId: ORG, role: 'owner', method: 'POST', setId: SET, body: {} }), H.ctx());
    assert.strictEqual(member.statusCode, 404, member.body);
    const staffInsideOrg = await handler(
      H.orgEvent({ orgId: ORG, role: 'admin', method: 'POST', setId: SET, body: {}, groups: 'admins' }), H.ctx(),
    );
    assert.strictEqual(staffInsideOrg.statusCode, 404, staffInsideOrg.body);
    assert.strictEqual((await review()).status, R.STATUS.UNREVIEWED, 'somebody outside Engage started a check');
    assert.deepStrictEqual(H.state.dispatched, [], 'a worker was dispatched for a caller who may not ask');
  });

  await H.test('a host with no organisation is still told to choose one', async () => {
    seedEngageSet();
    const res = await handler(H.orgEvent({ orgId: '', method: 'POST', setId: SET, body: {}, groups: 'hosts' }), H.ctx());
    assert.strictEqual(res.statusCode, 400, res.body);
    assert.match(parse(res).error, /Choose an organisation/);
  });

  await H.test('a set that is not in Engage\'s library is not found', async () => {
    seedEngageSet();
    const res = await post({}, 'no-such-set');
    assert.strictEqual(res.statusCode, 404, res.body);
  });

  /*
    P2's sharp edge. `platform: true` on the REQUEST is what tells the worker
    the rows are plaintext and that nothing publishes — so if an organisation
    could put it there, their own encrypted questions would be fed to the
    guardrail as ciphertext and their share would silently stop happening. It is
    not read from the body anywhere: each branch builds its own request.
  */
  await H.test('an organisation asking for a platform check is still checked as an organisation', async () => {
    H.reset();
    await seedOrgSet();
    H.state.guardrailReplies = clean(3);
    const res = await handler(
      H.orgEvent({ orgId: ORG, role: 'owner', method: 'POST', setId: ORGSET, body: { platform: true } }), H.ctx(),
    );
    assert.strictEqual(res.statusCode, 202, res.body);
    assert.strictEqual(parse(res).platform, undefined, 'the route answered as though this were Engage\'s own set');
    await handler({ __workerMode: true, jobId: parse(res).jobId }, H.ctx());
    const judged = H.state.sentGuardrail.map((c) => c.content[0].text.text).join('\n');
    assert.ok(judged.includes('Hazard 1'), `the guardrail was sent ciphertext: ${judged.slice(0, 200)}`);
    assert.ok(publicRows().length, 'the organisation\'s share was skipped');
    assert.ok(checksRows().length, 'the organisation\'s check went unmetered');
  });

  await H.test('a second check while one is running is refused, not doubled', async () => {
    seedEngageSet();
    const first = await post();
    assert.strictEqual(first.statusCode, 202, first.body);
    const second = await post();
    assert.strictEqual(second.statusCode, 409, second.body);
    assert.strictEqual(parse(second).status, 'checking');
    assert.strictEqual(H.state.dispatched.length, 1, 'two workers were dispatched for one version');
  });

  await H.test('staff can poll the job they started, and an organisation cannot', async () => {
    seedEngageSet();
    H.state.guardrailReplies = clean(3);
    const { jobId } = await runCheck();
    const mine = await handler(H.platformEvent({ method: 'GET', path: { setId: SET, jobId } }), H.ctx());
    assert.strictEqual(mine.statusCode, 200, mine.body);
    assert.strictEqual(parse(mine).status, 'complete');
    const theirs = await handler(H.orgEvent({ orgId: ORG, method: 'GET', setId: SET, jobId }), H.ctx());
    assert.strictEqual(theirs.statusCode, 404, theirs.body);
  });

  // ── WHEN IT COMES OUT WORSE ──────────────────────────────────────────────

  // P4. rejects: a row keyed so that nothing can open or answer it.
  await H.test('a MEDIUM band raises a row on the set\'s own key, with no organisation on it', async () => {
    seedEngageSet();
    H.state.guardrailReplies = [H.guardrailFull({ HATE: 'MEDIUM' }, { HATE: true }), ...clean(2)];
    H.state.haikuReplies = ['A mild edge in the phrasing, not the subject.'];
    await runCheck();
    assert.strictEqual((await review()).status, R.STATUS.ESCALATED);
    const row = platformRow();
    assert.ok(row, `no row on PLATFORM#${SET}: ${JSON.stringify(queue().map((r) => r.SK))}`);
    assert.strictEqual(row.scope, 'platform');
    assert.strictEqual(row.title, 'Warm ups');
    assert.strictEqual(row.orgId, undefined, 'an organisation was named on Engage\'s own row');
    assert.deepStrictEqual(row.reasons, ['escalated']);
    assert.ok(row.snapshotKey, 'the row does not point at the snapshot');
    assert.ok(!JSON.stringify(row).includes('Opener 1'), 'question text on the queue row');
    assert.deepStrictEqual(logEvents(REF), ['checked', 'escalated']);
  });

  // P4 again: `flagged` is not a queue item for an organisation because its
  // author is told to fix it. An Engage set has no author in the loop.
  await H.test('a flagged Engage set reaches a person too, because nobody else is told', async () => {
    seedEngageSet();
    H.state.guardrailReplies = [H.guardrailFull({ VIOLENCE: 'HIGH' }, { VIOLENCE: true }), ...clean(2)];
    H.state.haikuReplies = ['Flagged for its treatment, not its subject.'];
    await runCheck();
    assert.strictEqual((await review()).status, R.STATUS.FLAGGED);
    assert.ok(platformRow(), 'a flagged Engage set was left with nobody looking at it');
    assert.deepStrictEqual(publicRows(), [], 'a flagged set published something');
  });

  await H.test('a clean check raises nothing', async () => {
    seedEngageSet();
    H.state.guardrailReplies = clean(3);
    await runCheck();
    assert.deepStrictEqual(queue(), [], 'a passing check queued something');
  });

  // rejects: a row whose score card would open a 404, the same silence a
  // re-check keeps when the listing it is about is taken down mid-run.
  await H.test('a set deleted while its check runs raises nothing at all', async () => {
    seedEngageSet();
    H.state.guardrailReplies = [H.guardrailFull({ HATE: 'MEDIUM' }, { HATE: true }), ...clean(2)];
    H.state.haikuReplies = ['A mild edge in the phrasing, not the subject.'];
    const res = await post();
    const key = V.setMetadataKey(REF);
    H.state.ddb.delete(`${key.PK}|${key.SK}`);
    await handler({ __workerMode: true, jobId: parse(res).jobId }, H.ctx());
    assert.deepStrictEqual(queue(), [], 'a row was raised over a set that is no longer there');
  });

  await H.test('the row lists as Engage\'s own and opens with what the check found', async () => {
    seedEngageSet();
    H.state.guardrailReplies = [H.guardrailFull({ HATE: 'MEDIUM' }, { HATE: true }), ...clean(2)];
    H.state.haikuReplies = ['A mild edge in the phrasing, not the subject.'];
    await runCheck();
    const listed = parse(await list());
    assert.strictEqual(listed.count, 1);
    assert.strictEqual(listed.items[0].scope, 'platform', 'the queue does not say which library the row is from');
    const opened = await open(`PLATFORM#${SET}`);
    assert.strictEqual(opened.statusCode, 200, opened.body);
    const body = parse(opened);
    assert.strictEqual(body.review.status, R.STATUS.ESCALATED, 'the row opens saying nothing was ever checked');
    assert.strictEqual(body.review.findings.length, 1);
    assert.ok(body.snapshot, 'the snapshot the person has to read was not returned');
  });

  // P4's second half: the answer. `leave` clears the row and nothing else,
  // which is the only decision that fits — there is nothing to approve into the
  // public library and no author to reject.
  await H.test('a person can leave an Engage set serving, and that clears the row and nothing else', async () => {
    seedEngageSet();
    H.state.guardrailReplies = [H.guardrailFull({ HATE: 'MEDIUM' }, { HATE: true }), ...clean(2)];
    H.state.haikuReplies = ['A mild edge in the phrasing, not the subject.'];
    await runCheck();
    const res = await decide({ decision: 'leave', sk: `PLATFORM#${SET}`, note: 'Read it. Fine.' });
    assert.strictEqual(res.statusCode, 200, res.body);
    assert.deepStrictEqual(queue(), [], 'the row is still waiting');
    assert.strictEqual((await review()).status, R.STATUS.ESCALATED, 'the measurement was thrown away with the row');
    assert.ok(metaRow(REF), 'the set itself was touched');
    assert.deepStrictEqual(logEvents(REF), ['checked', 'escalated', 'left-serving']);
  });

  // rejects: approve/reject reaching a row that has nothing to publish and
  // nobody to reject.
  await H.test('neither publish decision is offered on an Engage set\'s row', async () => {
    seedEngageSet();
    H.state.guardrailReplies = [H.guardrailFull({ HATE: 'MEDIUM' }, { HATE: true }), ...clean(2)];
    H.state.haikuReplies = ['A mild edge in the phrasing, not the subject.'];
    await runCheck();
    for (const decision of ['approve', 'reject']) {
      const res = await decide({ decision, sk: `PLATFORM#${SET}` }); // eslint-disable-line no-await-in-loop
      assert.strictEqual(res.statusCode, 400, `${decision}: ${res.body}`);
    }
    assert.ok(platformRow(), 'a refused decision cleared the row anyway');
    assert.deepStrictEqual(publicRows(), [], 'a refused approve published something');
  });

  // ── A DISPATCH THAT DOES NOT GO ──────────────────────────────────────────

  // rejects: beginCheck's lock outliving a dispatch that failed, which would
  // leave Engage's library reading `checking` for the stale window and would
  // erase the outcome of the check before it.
  await H.test('a dispatch that fails leaves the set\'s previous review exactly where it was', async () => {
    seedEngageSet();
    await R.writeReview(db, T, REF, null, { status: R.STATUS.PASSED, note: '2/3 clean', findings: [] });
    H.state.lambdaShouldFail = true;
    const res = await post();
    assert.strictEqual(res.statusCode, 500, res.body);
    const r = await review();
    assert.strictEqual(r.status, R.STATUS.PASSED, `the failed dispatch left the review ${r.status}`);
    assert.strictEqual(r.note, '2/3 clean');
  });

  // ── SWITCHED ON ──────────────────────────────────────────────────────────

  // P6. The toggle route starts the check itself, with the narrow
  // `lambda:InvokeFunction` grant template-clean.yaml gives it — and starts it
  // AFTER the row has moved, with `InvocationType: 'Event'`, so the activation
  // neither waits for the check nor can be failed by it. The review row is
  // still UNREVIEWED when the activation answers, which is the proof: an
  // Event-type send returns the moment the request is accepted and nothing has
  // run yet.
  await H.test('switching an Engage set on says its check is due, and the set is active either way', async () => {
    seedEngageSet({ active: false });
    const res = await toggle(H.platformEvent({ method: 'POST', path: { setId: SET }, body: { active: true } }));
    assert.strictEqual(res.statusCode, 200, res.body);
    assert.strictEqual(parse(res).checkDue, true, 'switching Engage\'s set on asked for no check');
    assert.strictEqual(metaRow(REF).active, true, 'the set was not switched on');
    assert.strictEqual((await review()).status, R.STATUS.UNREVIEWED, 'the activation waited on a check');
  });

  // rejects: the console being the only thing that fires it, which left a set
  // live and unchecked whenever the tab was closed between the two calls. What
  // the activation dispatches is a real request to the check route, so it is
  // played back here through the handler that would have received it — and the
  // whole check runs off it, on Engage's own set, with nobody charged.
  await H.test('and what it dispatched really starts the check, end to end', async () => {
    seedEngageSet({ active: false });
    H.state.guardrailReplies = clean(3);
    const res = await toggle(H.platformEvent({ method: 'POST', path: { setId: SET }, body: { active: true } }));
    assert.strictEqual(res.statusCode, 200, res.body);
    assert.strictEqual(H.state.dispatched.length, 1, `${H.state.dispatched.length} checks were dispatched by one activation`);
    const [sent] = H.state.dispatched;
    assert.strictEqual(sent.InvocationType, 'Event', 'the activation waits on the check');
    assert.strictEqual(sent.FunctionName, 'engagetest-check-question-set');

    const started = await handler(sent.payload, H.ctx());
    assert.strictEqual(started.statusCode, 202, started.body);
    assert.strictEqual(parse(started).platform, true, 'the activation\'s request was not read as Engage\'s own');
    await handler({ __workerMode: true, jobId: parse(started).jobId }, H.ctx());
    const r = await review();
    assert.strictEqual(r.status, R.STATUS.PASSED, `review is ${r.status}: ${r.note}`);
    assert.strictEqual(publicRows().length, 0, 'the activation\'s check published something');
  });

  // rejects: an activation that fails, or half-completes, because the check
  // could not be started. The grant may not be deployed yet, the invoke may be
  // throttled — the set still goes live, and the Versions panel can run the
  // check by hand.
  await H.test('an activation whose dispatch is refused still switches the set on', async () => {
    seedEngageSet({ active: false });
    H.state.lambdaShouldFail = true;
    const res = await toggle(H.platformEvent({ method: 'POST', path: { setId: SET }, body: { active: true } }));
    assert.strictEqual(res.statusCode, 200, res.body);
    assert.strictEqual(metaRow(REF).active, true, 'a dispatch that would not go undid the activation');
    H.state.lambdaShouldFail = false;
  });

  await H.test('switching an Engage set off asks for no check', async () => {
    seedEngageSet({ active: true });
    const res = await toggle(H.platformEvent({ method: 'POST', path: { setId: SET }, body: { active: false } }));
    assert.strictEqual(res.statusCode, 200, res.body);
    assert.strictEqual(parse(res).checkDue, false);
    assert.strictEqual(metaRow(REF).active, false);
  });

  await H.test('switching on a set that was already serving asks for no check', async () => {
    seedEngageSet({ active: true });
    const res = await toggle(H.platformEvent({ method: 'POST', path: { setId: SET }, body: { active: true } }));
    assert.strictEqual(res.statusCode, 200, res.body);
    assert.strictEqual(parse(res).checkDue, false, 'nothing became servable, so nothing is due');
  });

  // X1. rejects: an organisation's own set acquiring a platform trigger, and
  // Engage starting to check customer content on its own. Theirs is checked
  // when they share it, on their own quota, by their own action.
  await H.test('switching an organisation\'s own set on asks for nothing new', async () => {
    H.reset();
    await seedOrgSet();
    metaRow(ORGREF).active = false;
    const res = await toggle(H.orgEvent({ orgId: ORG, role: 'owner', method: 'POST', setId: ORGSET, body: { active: true } }));
    assert.strictEqual(res.statusCode, 200, res.body);
    assert.strictEqual(parse(res).checkDue, false, 'an organisation\'s set was given Engage\'s trigger');
    assert.strictEqual(metaRow(ORGREF).active, true);
    assert.strictEqual(H.state.dispatched.length, 0, 'a check was started on an organisation\'s own content');
  });

  // ── X1 ───────────────────────────────────────────────────────────────────

  // The full guard is tests/set-check-job.js and tests/public-recheck.js. This
  // is the short version, so this file fails too if the org path moves.
  await H.test('an organisation\'s own check still publishes, stamps and keys its row by the version', async () => {
    H.reset();
    await seedOrgSet();
    H.state.guardrailReplies = clean(3);
    const res = await handler(H.orgEvent({ orgId: ORG, role: 'owner', method: 'POST', setId: ORGSET, body: {} }), H.ctx());
    assert.strictEqual(res.statusCode, 202, res.body);
    await handler({ __workerMode: true, jobId: parse(res).jobId }, H.ctx());
    const r = await R.readReview(db, T, ORGREF, 2);
    assert.strictEqual(r.status, R.STATUS.PASSED, `review is ${r.status}: ${r.note}`);
    const stamp = (await C.decryptItem(ORG, 'set', metaRow(ORGREF))).share;
    assert.strictEqual(stamp.status, 'published', 'the organisation\'s share stamp did not move');
    assert.ok(publicRows().length, 'the organisation\'s set was not published');
    assert.ok(checksRows().length, 'the organisation\'s own check stopped being metered');
    assert.deepStrictEqual(queue(), []);
  });

  await H.test('an escalated organisation set still raises its row on the version\'s key', async () => {
    H.reset();
    await seedOrgSet();
    H.state.guardrailReplies = [H.guardrailFull({ HATE: 'MEDIUM' }, { HATE: true }), ...clean(2)];
    H.state.haikuReplies = ['A mild edge in the phrasing, not the subject.'];
    const res = await handler(H.orgEvent({ orgId: ORG, role: 'owner', method: 'POST', setId: ORGSET, body: {} }), H.ctx());
    await handler({ __workerMode: true, jobId: parse(res).jobId }, H.ctx());
    assert.deepStrictEqual(queue().map((r) => r.SK), [`${ORG}#${ORGSET}#v2`]);
  });

  H.summary();
})().catch((e) => { console.error('harness error:', e); process.exit(2); });
