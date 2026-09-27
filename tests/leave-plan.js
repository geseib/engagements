// tests/leave-plan.js
/**
 * LEAVING A PAID PLAN — admin/orgs/leave-plan.js, routed from plan-requests.js.
 *
 * The owner, 27 Sep 2026: "also you should be able to leave plan. when doing so
 * they will be given a list of their team or individual sets and be told how
 * many they have to delete to get down to 5 free. they can before deleting also
 * click a make public button (but they will be told they will not be deleted
 * until they are accepted into public (a copy) or they come back and uncheck
 * make public".
 *
 * Driven END TO END through the real handlers: the leave routes, the check
 * route they re-enter (a RequestResponse invoke, answered here by calling
 * check-question-set.js itself), its worker, Moderation's decision, the usage
 * stream and the free-tier gate. The harness is moderation-harness.js, whose
 * fake table evaluates conditions, honours a FilterExpression and applies a
 * transaction all-or-nothing — a fake that ignored any of those would pass the
 * tests of the one thing each of them guards.
 *
 * rejects: the plan changing before the kept sets fit; a hard-coded 5; a held
 * set counted (or a released one not counted); a hold with nothing moving; the
 * private set surviving its public copy, or deleted before it; a flagged or
 * declined hold never released; the hold's who/when leaking into the public
 * row; one org row changed and not the other; an open plan request left
 * waiting; a mid-period leave breaking the bill.
 */
const path = require('path');
const fs = require('fs');
const assert = require('assert');
const H = require('./helpers/moderation-harness');

H.install();
const { DynamoDBDocumentClient } = require('@aws-sdk/lib-dynamodb');

const db = DynamoDBDocumentClient.from({});
const T = 'engage-test';
const A = (rel) => require(path.join(H.REPO, 'lambda-functions/admin', rel));
const C = A('shared/tenant-crypto.js');
const R = A('shared/set-review.js');
const V = A('shared/set-version.js');
const U = A('shared/usage.js');
const P = A('shared/pricing.js');
const Q = A('shared/moderation-queue.js');
const I = A('shared/invoices.js');
const HOLD = A('shared/public-hold.js');
const { publicSetIdFor } = A('shared/publish-set.js');
const planRequests = A('orgs/plan-requests.js').handler;
const check = A('check-question-set.js').handler;
const decide = A('moderation-decide.js').handler;
const usageStream = A('usage-stream.js').handler;

if (!process.env.DEBUG) { console.log = () => {}; console.error = () => {}; console.warn = () => {}; }
const say = (...a) => process.stdout.write(`${a.join(' ')}\n`);

const ORG = 'org_AcmeTeamPLan123456789Z';
const OWNER = { sub: 'sub-amara', role: 'owner' };
const ADMIN = { sub: 'sub-bo', role: 'admin' };
const MEMBER = { sub: 'sub-cy', role: 'member' };
const ALLOWANCE = P.PERSONAL_PLAN.includedSets;
const parse = (res) => JSON.parse(res.body || '{}');
const ref = (setId) => ({ scope: 'org', orgId: ORG, setId });
const metaOf = (setId) => H.state.ddb.get(`ORG#${ORG}#SETS|SET#${setId}`);
const orgRow = () => H.state.ddb.get(`ORG#${ORG}|METADATA`);
const indexRow = () => H.state.ddb.get(`ORGS|ORG#${ORG}`);
const rowsUnder = (prefix) => H.rowsWhere((r) => String(r.PK).startsWith(prefix));
const ledger = () => H.rowsWhere((r) => r.PK === `ORG#${ORG}` && String(r.SK).includes('#PLAN_CHANGE#'));

/** Every leave route, as API Gateway delivers it: an HTTP API v2 event with
 *  this API's CUSTOM authorizer context and the concrete rawPath. */
function call({ method = 'GET', who = OWNER, suffix = '', body, orgId = ORG, actingFor = ORG } = {}) {
  return planRequests({
    ...H.orgEvent({ orgId: actingFor, role: who.role, userId: who.sub, username: who.sub, method, body, path: { orgId } }),
    rawPath: `/orgs/${orgId}/plan/leave${suffix}`,
  });
}
const preview = (who) => call({ who });
const leave = (who) => call({ method: 'POST', who });
const hold = (setId, on, extra = {}, who = OWNER) => call({ method: 'POST', who, suffix: '/hold', body: { setId, hold: on, ...extra } });

/** The check route RE-ENTERED (RequestResponse) is answered by the real handler;
 *  its own worker dispatch (Event) is recorded, and `runWorker` plays it. */
const reentries = [];
function route() {
  H.state.invokeRouter = async (input) => {
    const payload = JSON.parse(Buffer.from(input.Payload).toString('utf8'));
    if (input.InvocationType === 'RequestResponse') {
      reentries.push({ FunctionName: input.FunctionName, payload });
      const res = await check(payload, H.ctx());
      return { StatusCode: 200, Payload: Buffer.from(JSON.stringify(res)) };
    }
    H.state.dispatched.push({ FunctionName: input.FunctionName, InvocationType: input.InvocationType, payload });
    return {};
  };
}
async function runWorker(replies) {
  const job = H.state.dispatched.filter((d) => d.payload && d.payload.__workerMode).pop();
  assert.ok(job, 'no check worker was dispatched');
  H.state.guardrailReplies = replies;
  await check({ __workerMode: true, jobId: job.payload.jobId }, H.ctx());
}
const clean = (n) => Array.from({ length: n }, () => H.guardrailClean());

/** A set at v1 with two questions, encrypted the way upload writes it. */
async function seedSet(setId, { topic = 'history', name = `Set ${setId}`, version = 1 } = {}) {
  const meta = await C.encryptItem(ORG, 'set', {
    PK: `ORG#${ORG}#SETS`, SK: `SET#${setId}`, name, description: `About ${setId}.`,
    ...(topic ? { topic } : {}),
    engagementType: 'trivia', scope: 'org', orgId: ORG, activeVersion: version,
    versions: Array.from({ length: version }, (_, i) => ({ version: i + 1 })), questionCount: 2, createdBy: OWNER.sub,
  });
  H.seedRow(meta);
  const pk = `ORG#${ORG}#SET#${setId}#v${version}`;
  H.seedRow({ PK: pk, SK: 'CATEGORY#c001', Name: 'General', QuestionCount: 2 });
  for (let i = 1; i <= 2; i += 1) {
    H.seedRow(await C.encryptItem(ORG, 'question', { // eslint-disable-line no-await-in-loop
      PK: pk, SK: `QUESTION#q00${i}`, Title: `${setId} question ${i}`, Detail: `Detail ${i}`,
      AnswerDetails: `Reveal ${i}`, optionA: 'A', optionB: 'B', correctAnswer: 'OptionA', Category: 'c001', Image: '', Active: true,
    }));
  }
}

async function seedOrg({ plan = 'team', type = 'team', sets = 8, unfiled = [] } = {}) {
  H.reset();
  route();
  reentries.length = 0;
  H.seedRow({ PK: `ORG#${ORG}`, SK: 'METADATA', orgId: ORG, name: 'Acme Learning', plan, type, status: 'active' });
  H.seedRow({ PK: 'ORGS', SK: `ORG#${ORG}`, orgId: ORG, name: 'Acme Learning', plan, type, status: 'active' });
  for (const m of [OWNER, ADMIN, MEMBER]) {
    H.seedRow({ PK: `ORG#${ORG}`, SK: `MEMBER#${m.sub}`, orgId: ORG, userId: m.sub, role: m.role, email: `${m.sub}@acme.example` });
  }
  for (let i = 1; i <= sets; i += 1) {
    const id = `set${i}`;
    await seedSet(id, { topic: unfiled.includes(id) ? '' : 'history', name: `Set ${String(i).padStart(2, '0')}` }); // eslint-disable-line no-await-in-loop
  }
}

/** What the usage stream does when a set's metadata row changes. */
const restream = () => usageStream({ Records: [{ dynamodb: { Keys: { PK: { S: `ORG#${ORG}#SETS` }, SK: { S: 'SET#set1' } } } }] });

/** H.test's bookkeeping, printed through `say` because console.log is muted
 *  above; H.summary() at the end marks the finish guard and sets the exit code. */
async function test(name, fn) {
  try { await fn(); H.state.passed += 1; say(`  ok   - ${name}`); } catch (e) { H.state.failed += 1; say(`  FAIL - ${name}\n         ${e.stack || e.message}`); }
}

(async () => {
  say('\n1. the preview: what there is, and how many must go');

  await test('an owner sees every set by name, the free allowance, and exactly how many to delete', async () => {
    // rejects: a preview counting from a literal 5 rather than the free plan's
    // own includedSets, names shown as ciphertext, or Leave offered at 8 kept.
    await seedOrg({ sets: 8 });
    const res = await preview(OWNER);
    assert.strictEqual(res.statusCode, 200, res.body);
    const body = parse(res);
    assert.strictEqual(body.allowance, ALLOWANCE);
    assert.strictEqual(body.freePlan.includedSets, ALLOWANCE);
    assert.strictEqual(body.total, 8);
    assert.strictEqual(body.kept, 8);
    assert.strictEqual(body.held, 0);
    assert.strictEqual(body.mustDelete, 8 - ALLOWANCE);
    assert.strictEqual(body.canLeave, false);
    assert.strictEqual(body.plan.paid, true);
    assert.deepStrictEqual(body.sets.map((s) => s.name).slice(0, 2), ['Set 01', 'Set 02'], 'names are decrypted and sorted');
    assert.ok(body.sets.every((s) => typeof s.name === 'string' && s.version === 1 && s.held === false));
  });

  await test('an admin may preview; a member, and somebody acting for another org, may not', async () => {
    // rejects: the leave routes open to every member, or steerable by the orgId
    // in the path while the caller acts for a different organisation.
    await seedOrg({ sets: 2 });
    assert.strictEqual((await preview(ADMIN)).statusCode, 200);
    assert.strictEqual((await preview(MEMBER)).statusCode, 403);
    assert.strictEqual((await call({ who: OWNER, actingFor: 'org_OtherTeamPLan12345678Z' })).statusCode, 403);
    assert.strictEqual((await leave(MEMBER)).statusCode, 403);
    assert.strictEqual((await hold('set1', true, {}, MEMBER)).statusCode, 403);
  });

  await test('leaving with more kept sets than the allowance is refused with the preview, and nothing changes', async () => {
    // rejects: the plan changing before the kept sets fit.
    await seedOrg({ sets: 8 });
    const res = await leave(OWNER);
    assert.strictEqual(res.statusCode, 409, res.body);
    const body = parse(res);
    assert.strictEqual(body.code, 'too_many_sets');
    assert.strictEqual(body.mustDelete, 8 - ALLOWANCE);
    assert.match(body.error, new RegExp(`delete ${8 - ALLOWANCE}`));
    assert.strictEqual(orgRow().plan, 'team');
    assert.strictEqual(indexRow().plan, 'team');
    assert.strictEqual(ledger().length, 0);
  });

  say('\n2. make public: held, checked, accepted, deleted');

  await test('an unfiled set is asked for a topic and NOT held', async () => {
    // rejects: holding a set the library cannot take — it would stop counting
    // while no library ever decided about it.
    await seedOrg({ sets: 3, unfiled: ['set2'] });
    const res = await hold('set2', true);
    assert.strictEqual(res.statusCode, 409, res.body);
    const body = parse(res);
    assert.strictEqual(body.needsTopic, true);
    assert.ok(Array.isArray(body.topics) && body.topics.some((t) => t.id === 'history'));
    assert.strictEqual(HOLD.isHeld(metaOf('set2')), false);
    assert.strictEqual(reentries.length, 0, 'no check was started for a set with no shelf');
    assert.strictEqual((await hold('set2', true, { topic: 'not-a-shelf' })).statusCode, 409);
  });

  await test('with a topic, the set is filed, held, sent to the check through its own route, and stops counting', async () => {
    // rejects: a hold that starts nothing; the check reached by some private
    // back door rather than its HTTP entry point; countSets counting a held set.
    await seedOrg({ sets: 3, unfiled: ['set2'] });
    const res = await hold('set2', true, { topic: 'science-technology' });
    assert.strictEqual(res.statusCode, 200, res.body);
    const body = parse(res);
    assert.strictEqual(body.state, 'checking');
    assert.strictEqual(body.held, true);
    assert.match(body.message, /Kept until a copy is accepted/);
    assert.strictEqual(metaOf('set2').topic, 'science-technology');
    assert.ok(HOLD.isHeld(metaOf('set2')));
    assert.strictEqual(reentries.length, 1);
    assert.strictEqual(reentries[0].FunctionName, process.env.CHECK_FUNCTION_NAME);
    assert.strictEqual(reentries[0].payload.pathParameters.setId, 'set2');
    assert.deepStrictEqual(JSON.parse(reentries[0].payload.body), { version: 1, publish: true });
    assert.strictEqual(body.preview.kept, 2);
    assert.strictEqual(body.preview.held, 1);
    assert.strictEqual(body.preview.sets.find((s) => s.setId === 'set2').holdState, 'checking');
    assert.strictEqual(await U.countSets(ORG, { db, tableName: T }), 2, 'the held set was counted');
  });

  await test('when the check passes, the public copy goes live and THEN the private set is deleted, every version', async () => {
    // rejects: the private copy surviving acceptance; a partition stranded; the
    // hold's who/when copied onto the public library's row.
    await seedOrg({ sets: 3 });
    await hold('set3', true);
    await runWorker(clean(3));
    const pub = publicSetIdFor(ORG, 'set3');
    const pubMeta = H.state.ddb.get(`PUBLIC#SETS|SET#${pub}`);
    assert.ok(pubMeta, 'no public copy');
    assert.strictEqual(pubMeta.publicHold, undefined, 'the hold leaked into the public row');
    assert.strictEqual(pubMeta.publicHoldReleased, undefined);
    assert.ok(rowsUnder(`PUBLIC#SET#${pub}#v1`).some((r) => r.SK === 'QUESTION#q001' && r.Title === 'set3 question 1'), 'the public questions are missing or ciphertext');
    assert.strictEqual(metaOf('set3'), undefined, 'the private set is still listed');
    assert.deepStrictEqual(rowsUnder(`ORG#${ORG}#SET#set3`), [], 'a content partition survived');
    assert.ok(metaOf('set1') && metaOf('set2'), 'a different set was touched');
  });

  await test('a version that already passed goes public at once: removed, and no check spent', async () => {
    // rejects: a set that can be published now being held instead; a check
    // (one of the day's twenty) spent on a version that already passed.
    await seedOrg({ sets: 6 });
    await R.writeReview(db, T, ref('set4'), 1, { status: R.STATUS.PASSED, note: '3/3 clean' });
    const res = await hold('set4', true);
    assert.strictEqual(res.statusCode, 200, res.body);
    const body = parse(res);
    assert.strictEqual(body.state, 'public');
    assert.strictEqual(body.deleted, true);
    assert.match(body.message, /The public copy of “Set 04” is live/);
    assert.strictEqual(reentries.length, 0);
    assert.strictEqual(metaOf('set4'), undefined);
    assert.ok(H.state.ddb.get(`PUBLIC#SETS|SET#${publicSetIdFor(ORG, 'set4')}`));
    assert.strictEqual(body.preview.total, 5);
    assert.strictEqual(body.preview.mustDelete, Math.max(0, 5 - ALLOWANCE));
  });

  await test('a flagged check releases the hold, says why on the row, and the set counts again', async () => {
    // rejects: a flagged set staying held — uncounted — for ever.
    await seedOrg({ sets: 3 });
    await hold('set1', true);
    H.state.haikuReplies = ['The detail of the injury is what was flagged.'];
    await runWorker([H.guardrailHit('VIOLENCE', 'HIGH'), ...clean(2)]);
    assert.strictEqual(HOLD.isHeld(metaOf('set1')), false);
    assert.strictEqual(HOLD.releasedOf(metaOf('set1')).reason, 'flagged');
    const view = parse(await preview(OWNER));
    assert.strictEqual(view.kept, 3);
    assert.strictEqual(view.sets.find((s) => s.setId === 'set1').released.reason, 'flagged');
    assert.strictEqual(await U.countSets(ORG, { db, tableName: T }), 3);
  });

  await test('an escalated check keeps it held and waiting; Moderation approving it publishes it and removes it', async () => {
    // rejects: an escalated hold released early; an approval that leaves the
    // private set behind.
    await seedOrg({ sets: 3 });
    await hold('set2', true);
    await runWorker([H.guardrailHit('VIOLENCE', 'MEDIUM'), ...clean(2)]);
    assert.ok(HOLD.isHeld(metaOf('set2')), 'released while a person was still deciding');
    assert.strictEqual(parse(await preview(OWNER)).sets.find((s) => s.setId === 'set2').holdState, 'waiting');
    assert.strictEqual(H.rowsWhere((r) => r.PK === Q.QUEUE_PK).length, 1, 'nothing reached Moderation');
    const res = await decide(H.platformEvent({ method: 'POST', body: { sk: `${ORG}#set2#v1`, decision: 'approve', note: 'Fine.' } }), H.ctx());
    assert.strictEqual(res.statusCode, 200, res.body);
    assert.strictEqual(metaOf('set2'), undefined, 'the private set survived its approval');
    assert.deepStrictEqual(rowsUnder(`ORG#${ORG}#SET#set2`), []);
    assert.ok(H.state.ddb.get(`PUBLIC#SETS|SET#${publicSetIdFor(ORG, 'set2')}`));
    assert.strictEqual(H.rowsWhere((r) => r.PK === Q.QUEUE_PK).length, 0);
  });

  await test('Moderation declining it releases it with the note — it counts again, and the free cap refuses a new set', async () => {
    // rejects: a declined set not counting again; the free-tier gate not
    // refusing a NEW set once the org is back over its allowance.
    await seedOrg({ plan: 'free', sets: ALLOWANCE });
    await hold('set1', true);
    await runWorker([H.guardrailHit('VIOLENCE', 'MEDIUM'), ...clean(2)]);
    await restream();
    const before = await U.readAllowance(ORG);
    assert.strictEqual(before.setsUsed, ALLOWANCE - 1);
    assert.strictEqual(before.mustUpgradeForSet, false, 'a held set blocked a new one');
    const res = await decide(H.platformEvent({ method: 'POST', body: { sk: `${ORG}#set1#v1`, decision: 'reject', note: 'Q2 needs the injury detail removed.' } }), H.ctx());
    assert.strictEqual(res.statusCode, 200, res.body);
    const released = HOLD.releasedOf(metaOf('set1'));
    assert.strictEqual(HOLD.isHeld(metaOf('set1')), false);
    assert.strictEqual(released.reason, 'declined');
    assert.strictEqual(released.note, 'Q2 needs the injury detail removed.');
    await restream();
    const after = await U.readAllowance(ORG);
    assert.strictEqual(after.setsUsed, ALLOWANCE);
    assert.strictEqual(after.mustUpgradeForSet, true, 'the cap did not refuse a new set');
  });

  await test('the library accepting a version the set has since moved past keeps the set and says so', async () => {
    // rejects: deleting content the public copy does not have.
    await seedOrg({ sets: 2 });
    await hold('set1', true);
    await runWorker([H.guardrailHit('VIOLENCE', 'MEDIUM'), ...clean(2)]);
    // A newer version uploaded while it waited in Moderation.
    const m = metaOf('set1');
    H.seedRow({ ...m, activeVersion: 2, versions: [{ version: 1 }, { version: 2 }] });
    H.seedRow({ PK: `ORG#${ORG}#SET#set1#v2`, SK: 'QUESTION#q001', Title: 'new', Detail: 'new' });
    const res = await decide(H.platformEvent({ method: 'POST', body: { sk: `${ORG}#set1#v1`, decision: 'approve', note: 'Fine.' } }), H.ctx());
    assert.strictEqual(res.statusCode, 200, res.body);
    assert.ok(metaOf('set1'), 'the set was deleted');
    assert.ok(rowsUnder(`ORG#${ORG}#SET#set1#v2`).length > 0, 'the newer version was deleted');
    assert.strictEqual(HOLD.isHeld(metaOf('set1')), false);
    assert.strictEqual(HOLD.releasedOf(metaOf('set1')).reason, 'changed');
  });

  await test('unticking releases the hold and the set counts again — and says a submission already made may still publish', async () => {
    // rejects: untick not restoring the count; an untick that pretends to have
    // recalled a check already running.
    await seedOrg({ sets: 3 });
    await hold('set1', true);
    assert.strictEqual(await U.countSets(ORG, { db, tableName: T }), 2);
    const res = await hold('set1', false);
    assert.strictEqual(res.statusCode, 200, res.body);
    const body = parse(res);
    assert.strictEqual(body.state, 'kept');
    assert.strictEqual(body.held, false);
    assert.match(body.message, /still with the public library/);
    assert.strictEqual(await U.countSets(ORG, { db, tableName: T }), 3);
    assert.strictEqual(body.preview.sets.find((s) => s.setId === 'set1').released, null, 'an untick is not news on the row');
  });

  await test('a flagged version nobody has changed is refused without holding it or spending a check', async () => {
    // rejects: spending one of the day's checks to be told no again; holding a
    // set the library has already declined.
    await seedOrg({ sets: 2 });
    await hold('set1', true);
    H.state.haikuReplies = ['flagged'];
    await runWorker([H.guardrailHit('VIOLENCE', 'HIGH'), ...clean(2)]);
    reentries.length = 0;
    const res = await hold('set1', true);
    assert.strictEqual(res.statusCode, 409, res.body);
    assert.match(parse(res).error, /flagged/);
    assert.strictEqual(HOLD.isHeld(metaOf('set1')), false);
    assert.strictEqual(reentries.length, 0);
  });

  await test("no checks left today: the check route's 429 is passed on and the hold given back", async () => {
    // rejects: a set left held with nothing moving — uncounted, undecided.
    await seedOrg({ sets: 2 });
    H.seedRow({ PK: `ORG#${ORG}`, SK: `CHECKS#${new Date().toISOString().slice(0, 10)}`, submits: 20 });
    const res = await hold('set1', true);
    assert.strictEqual(res.statusCode, 429, res.body);
    assert.match(parse(res).error, /checks/);
    assert.strictEqual(HOLD.isHeld(metaOf('set1')), false);
    assert.strictEqual(HOLD.releasedOf(metaOf('set1')), null, 'a hold this request took and could not use is not news');
  });

  await test('the check not reachable at all gives the hold back too', async () => {
    // rejects: a dispatch failure stranding a held set.
    await seedOrg({ sets: 2 });
    H.state.invokeRouter = null;
    H.state.lambdaShouldFail = true;
    const res = await hold('set1', true);
    assert.ok(res.statusCode >= 500, res.body);
    assert.strictEqual(HOLD.isHeld(metaOf('set1')), false);
  });

  say('\n3. leaving');

  await test('once the kept sets fit, leaving changes BOTH org rows, records it, and withdraws an open request', async () => {
    // rejects: the plan changing on one row only; no ledger record; an open
    // plan request left waiting in Engage's queue for an org that has left.
    await seedOrg({ sets: ALLOWANCE + 2 });
    const reqAt = '2026-09-20T10:00:00.000Z';
    H.seedRow({
      PK: `ORG#${ORG}`, SK: `PLANREQ#${reqAt}#req1`, RecordType: 'PLANREQ', reqId: 'req1', orgId: ORG,
      fromPlan: 'team', toPlan: 'team', status: 'requested', requestedAt: reqAt, requestedBy: OWNER.sub,
    });
    H.seedRow({ PK: 'ORGS', SK: `PLANREQ#requested#${reqAt}#${ORG}`, RecordType: 'PLANREQ_QUEUE', orgId: ORG, reqId: 'req1', toPlan: 'team', requestedAt: reqAt });
    // Two held for the library: they do not count, so ALLOWANCE are kept.
    await hold('set1', true);
    await hold('set2', true);
    const view = parse(await preview(OWNER));
    assert.strictEqual(view.kept, ALLOWANCE);
    assert.strictEqual(view.canLeave, true);

    const res = await leave(ADMIN);
    assert.strictEqual(res.statusCode, 200, res.body);
    const body = parse(res);
    assert.strictEqual(body.plan, 'free');
    assert.deepStrictEqual(body.withdrawn, ['req1']);
    assert.strictEqual(orgRow().plan, 'free');
    assert.strictEqual(indexRow().plan, 'free');
    assert.ok(orgRow().planChangedAt && indexRow().planChangedAt);
    const rows = ledger();
    assert.strictEqual(rows.length, 1);
    assert.strictEqual(rows[0].kind, 'PLAN_CHANGE');
    assert.strictEqual(rows[0].fromPlan, 'team');
    assert.strictEqual(rows[0].toPlan, 'free');
    assert.strictEqual(rows[0].by, ADMIN.sub);
    assert.strictEqual(H.state.ddb.get(`ORG#${ORG}|PLANREQ#${reqAt}#req1`).status, 'withdrawn');

    // The queue as Engage staff read it, through plan-requests.js's own reader.
    const staff = (status) => planRequests({ ...H.platformEvent({ method: 'GET' }), rawPath: '/platform/plan-requests', queryStringParameters: { status } });
    assert.strictEqual(parse(await staff('requested')).requests.length, 0);
    assert.strictEqual(parse(await staff('withdrawn')).requests.length, 1);
    // The held sets are still held after leaving: the promise was "until accepted".
    assert.ok(HOLD.isHeld(metaOf('set1')) && HOLD.isHeld(metaOf('set2')));
  });

  await test('leaving twice is refused the second time, with one ledger row', async () => {
    // rejects: a double change, or two PLAN_CHANGE rows for one leave.
    await seedOrg({ sets: 1 });
    assert.strictEqual((await leave(OWNER)).statusCode, 200);
    const again = await leave(OWNER);
    assert.strictEqual(again.statusCode, 409);
    assert.strictEqual(parse(again).code, 'not_on_paid_plan');
    assert.strictEqual(ledger().length, 1);
  });

  await test('the transaction is conditional on the plan it read: a change in between wins, and nothing half-lands', async () => {
    // rejects: two admins leaving at once producing two changes, or one org row
    // changed without the other.
    await seedOrg({ sets: 1 });
    const originalSend = db.send;
    let raced = false;
    db.send = async (cmd) => {
      if (!raced && cmd.kind === 'transactWrite') {
        raced = true;
        H.seedRow({ ...orgRow(), plan: 'free' }); // somebody else left a moment ago
      }
      return originalSend.call(db, cmd);
    };
    try {
      const res = await leave(OWNER);
      assert.strictEqual(res.statusCode, 409, res.body);
    } finally {
      db.send = originalSend;
    }
    assert.strictEqual(indexRow().plan, 'team', 'the index row changed without the org row');
    assert.strictEqual(ledger().length, 0);
  });

  await test('a mid-period leave: the gate reads the new count at once, and the bill still projects in whole cents', async () => {
    // rejects: the gate refusing on a stale counter the moment the free plan
    // starts; the PLAN_CHANGE row counted as a billable session; the month's
    // projection breaking (NaN, a throw) on the new plan; a closed invoice for
    // an earlier month moved.
    await seedOrg({ sets: ALLOWANCE - 1 });
    const period = U.periodOf(new Date());
    H.seedRow({ PK: `ORG#${ORG}`, SK: `USAGE#${period}`, orgId: ORG, period, sessionsRun: 12, setsCurrent: 9, setsPeak: 9 });
    H.seedRow({ PK: `ORG#${ORG}`, SK: `LEDGER#${period}#SESSION#g1`, RecordType: 'LEDGER', kind: 'SESSION', orgId: ORG, period, gameId: 'g1' });
    H.seedRow({ PK: `ORG#${ORG}`, SK: 'INVOICE#2026-08', RecordType: 'INVOICE', orgId: ORG, period: '2026-08', totalCents: 500, totalDisplay: '$5.00' });
    const res = await leave(OWNER);
    assert.strictEqual(res.statusCode, 200, res.body);

    const usage = await U.readUsage(ORG, period, { db, tableName: T });
    assert.strictEqual(usage.setsCurrent, ALLOWANCE - 1, 'the counter still says 9');
    assert.strictEqual(usage.setsPeak, 9, 'the peak is a record of the month and never lowered');
    assert.strictEqual(await U.countBilledSessions(ORG, period, { db, tableName: T }), 1);
    const gate = await U.readAllowance(ORG);
    assert.strictEqual(gate.metersOverage, false);
    assert.strictEqual(gate.mustUpgradeForSet, false);

    const { doc } = await I.buildInvoice({ db, tableName: T, orgId: ORG, period, now: new Date() });
    assert.strictEqual(doc.planId, P.planFor({ plan: 'free' }).id);
    assert.ok(Number.isInteger(doc.totalCents), `total is ${doc.totalCents}`);
    assert.ok(doc.lines.every((l) => Number.isInteger(l.amountCents)));
    assert.strictEqual(doc.totalCents, 0);
    assert.strictEqual((await I.getInvoice(db, T, ORG, '2026-08')).totalCents, 500);
  });

  await test("a personal space's owner may leave its paid plan; a free one is told it is already free", async () => {
    // rejects: the personal-space owner refused as "not an admin"; a free org
    // shown a Leave it cannot use.
    await seedOrg({ plan: 'standard', type: 'personal', sets: 1 });
    const paid = P.planFor({ plan: 'standard' }).metersOverage === true;
    const res = await leave(OWNER);
    // Written against pricing.js's own answer, so it holds before and after
    // the plan named 'standard' is defined there.
    assert.strictEqual(res.statusCode, paid ? 200 : 409, res.body);
    if (paid) assert.strictEqual(orgRow().plan, 'free');
    await seedOrg({ plan: 'free', sets: 1 });
    const view = parse(await preview(OWNER));
    assert.strictEqual(view.plan.paid, false);
    assert.strictEqual(view.canLeave, false);
  });

  say('\n4. the wiring');

  await test('every door a public copy goes out of settles a hold; every refusal releases one', async () => {
    // rejects: a publish or decline path added (or edited) without its settle —
    // the held set then stays uncounted for ever, or survives its public copy.
    const src = (rel) => fs.readFileSync(path.join(H.REPO, 'lambda-functions/admin', rel), 'utf8');
    const md = src('moderation-decide.js');
    assert.strictEqual((md.match(/settleHeldSet\(db, TABLE\(\), ref, \{ outcome: 'published'/g) || []).length, 3, 'approve, resumed approve, orphaned approve');
    assert.strictEqual((md.match(/settleHeldSet\(db, TABLE\(\), ref, \{ outcome: 'declined'/g) || []).length, 3, 'reject, resumed reject, orphaned reject');
    const worker = src('shared/set-check-worker.js');
    assert.match(worker, /settleHold\(db, tableName, source, \{ outcome: 'published'/);
    assert.match(worker, /outcome: 'declined', version, reason: 'flagged'/);
    assert.match(src('publish-question-set.js'), /settleHeldSet\(db, TABLE\(\), source, \{ outcome: 'published'/);
  });

  await test('the three routes are on PlanRequestsFunction behind the authorizer, with exactly the grants the code needs', async () => {
    // rejects: a route without the Cognito authorizer; the check invoked with
    // no grant (a production-only AccessDenied) or with a wildcard one.
    const tpl = fs.readFileSync(path.join(H.REPO, 'template-clean.yaml'), 'utf8');
    const start = tpl.indexOf('  PlanRequestsFunction:');
    const block = tpl.slice(start, tpl.indexOf('\n  # ──', start + 1));
    for (const [pathTpl, method] of [['/orgs/{orgId}/plan/leave', 'GET'], ['/orgs/{orgId}/plan/leave', 'POST'], ['/orgs/{orgId}/plan/leave/hold', 'POST']]) {
      const re = new RegExp(`Path: ${pathTpl.replace(/[{}/]/g, '\\$&')}\\n\\s+Method: ${method}\\n\\s+Auth:\\n\\s+Authorizer: CognitoAuthorizer`);
      assert.match(block, re, `${method} ${pathTpl}`);
    }
    assert.match(block, /CHECK_FUNCTION_NAME: !Sub '\$\{StackName\}-check-question-set'/);
    assert.match(block, /Action: lambda:InvokeFunction\n\s+Resource: !Sub 'arn:aws:lambda:\$\{AWS::Region\}:\$\{AWS::AccountId\}:function:\$\{StackName\}-check-question-set'/);
  });

  await test('countSets skips a held set in all three usage.js copies, which stay byte for byte', async () => {
    // rejects: the filter added to one bundle's copy and not the others, so the
    // session gate and the set gate count differently.
    const read = (d) => fs.readFileSync(path.join(H.REPO, 'lambda-functions', d, 'usage.js'), 'utf8');
    const a = read('admin/shared'); const b = read('game'); const c = read('websocket');
    assert.strictEqual(a, b); assert.strictEqual(a, c);
    assert.match(a, /FilterExpression: 'attribute_not_exists\(#hold\)'/);
    assert.match(a, /'#hold': 'publicHold'/);
    assert.strictEqual(HOLD.HOLD, 'publicHold', 'usage.js and public-hold.js must name the same attribute');
  });

  say(`\n${H.state.passed} passed, ${H.state.failed} failed`);
  H.summary();
})();
