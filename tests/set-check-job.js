// tests/set-check-job.js
/**
 * THE CHECK IS A JOB — admin/check-question-set.js + shared/set-check-worker.js
 * Spec §4 (the check), §2 (the lifecycle), §11 (edge cases).
 */
const path = require('path');
const assert = require('assert');
const H = require('./helpers/moderation-harness');
H.install();
const { DynamoDBDocumentClient } = require('@aws-sdk/lib-dynamodb');
const { S3Client } = require('@aws-sdk/client-s3');
const { BedrockRuntimeClient } = require('@aws-sdk/client-bedrock-runtime');
const db = DynamoDBDocumentClient.from({});
const s3 = new S3Client({});
const bedrock = new BedrockRuntimeClient({});
const T = 'engage-test';
const REPO = H.REPO;
const C = require(path.join(REPO, 'lambda-functions/admin/shared/tenant-crypto.js'));
const R = require(path.join(REPO, 'lambda-functions/admin/shared/set-review.js'));
const J = require(path.join(REPO, 'lambda-functions/admin/shared/generation-jobs.js'));
const W = require(path.join(REPO, 'lambda-functions/admin/shared/set-check-worker.js'));

const ORG = 'org_acme'; const SET = 'safety';
const SRC = { scope: 'org', orgId: ORG, setId: SET };
const deps = { db, tableName: T, s3, bucket: 'prompts-test', bedrock };

/** An org set at v2 with three questions, encrypted the way upload writes them. */
async function seed({ questions = 3, image = false, promptId = 'p-org', platformPrompt = false, questionCount } = {}) {
  H.reset();
  H.seedRow({ PK: `ORG#${ORG}`, SK: 'METADATA', orgId: ORG, name: 'Acme Learning' });
  const meta = await C.encryptItem(ORG, 'set', {
    PK: `ORG#${ORG}#SETS`, SK: `SET#${SET}`, name: 'Safety walkthrough', description: 'Site induction.',
    engagementType: 'trivia', scope: 'org', orgId: ORG, promptId, activeVersion: 2,
    versions: [{ version: 1 }, { version: 2 }], questionCount: questionCount ?? questions, createdBy: 'sub-amara',
  });
  H.seedRow(meta);
  H.seedRow({ PK: `ORG#${ORG}#SET#${SET}#v2`, SK: 'CATEGORY#c001', Name: 'Injuries', QuestionCount: questions });
  for (let i = 1; i <= questions; i += 1) {
    const q = await C.encryptItem(ORG, 'question', { // eslint-disable-line no-await-in-loop
      PK: `ORG#${ORG}#SET#${SET}#v2`, SK: `QUESTION#q00${i}`, Title: `Question ${i} title`, Detail: `Detail ${i}`,
      AnswerDetails: `Reveal ${i}`, optionA: 'A', optionB: 'B', correctAnswer: 'A', Category: 'c001',
      Image: image && i === 1 ? 'sets/safety/q1.png' : '', Active: true, points: 10,
    });
    H.seedRow(q);
  }
  if (platformPrompt) H.seedRow({ PK: 'AIPROMPTS', SK: 'AIPROMPT#p-plat', name: 'House coach' });
}
async function job(extra = {}) {
  const jobId = J.newJobId();
  await J.createJob(db, T, {
    jobId, kind: 'set-check', requested: 3,
    request: { setId: SET, version: 2, publish: true, declaredNotice: [], ...extra },
    caller: { userId: 'sub-amara', username: 'amara', orgId: ORG, orgRole: 'owner' },
  });
  return jobId;
}
const clean = (n) => Array.from({ length: n }, () => H.guardrailClean());
const review = () => R.readReview(db, T, SRC, 2);
const stamp = () => H.state.ddb.get(`ORG#${ORG}#SETS|SET#${SET}`).share;
const queue = () => H.rowsWhere((r) => r.PK === 'MODERATION');
const logEvents = () => H.rowsWhere((r) => r.PK === `REVIEWLOG#org#${ORG}#${SET}`).map((e) => e.event).sort();
const publicRows = () => H.rowsWhere((r) => String(r.PK).startsWith('PUBLIC#'));

(async () => {
  console.log('\nthe check job — the worker\n');

  await H.test('a clean set passes and is published in the same run, and every record is written', async () => {
    await seed({ promptId: 'p-plat', platformPrompt: true });
    H.state.guardrailReplies = clean(4); // 3 questions + the set prose
    const jobId = await job();
    await W.runSetCheck(deps, { jobId }, H.ctx());
    const r = await review();
    assert.strictEqual(r.status, R.STATUS.PASSED, `review is ${r.status}: ${r.note}`);
    assert.match(r.contentHash, /^[0-9a-f]{64}$/);
    assert.ok(r.snapshotKey && H.state.s3.has(`prompts-test/${r.snapshotKey}`), 'no snapshot in S3');
    assert.strictEqual(stamp().status, 'published');
    assert.strictEqual(stamp().publicSetId, 'orgacme-safety');
    assert.ok(publicRows().some((row) => row.SK === 'QUESTION#q001' && row.Title === 'Question 1 title'), 'the public copy is missing or ciphertext');
    assert.deepStrictEqual(logEvents(), ['checked', 'published']);
    const j = await J.getJob(db, T, jobId);
    assert.strictEqual(j.status, 'complete');
    assert.strictEqual(j.meta.outcome, 'passed');
    assert.strictEqual(j.meta.publicVersion, 1);
    assert.strictEqual(H.state.ddb.get(`ORG#${ORG}|CHECKS#${new Date().toISOString().slice(0, 10)}`).units, 4, 'units were not recorded');
    assert.strictEqual(queue().length, 0);
  });

  await H.test('the guardrail is sent the published surface: the reveal and the options, not just title and body', async () => {
    await seed({ questions: 1 });
    H.state.guardrailReplies = clean(2);
    await W.runSetCheck(deps, { jobId: await job() }, H.ctx());
    const sent = H.state.sentGuardrail.map((c) => c.content[0].text.text);
    assert.ok(sent[0].includes('Reveal 1') && sent[0].includes('A\nB'), `judged text was ${JSON.stringify(sent[0])}`);
    assert.ok(sent[1].includes('Safety walkthrough') && sent[1].includes('Injuries'), 'the set prose and category name were not judged');
  });

  await H.test('a HIGH band flags the version, names the question with an explanation, and publishes nothing', async () => {
    await seed();
    H.state.guardrailReplies = [H.guardrailHit('VIOLENCE', 'HIGH'), ...clean(3)];
    H.state.haikuReplies = ['Asking a room to describe injuries in detail is what was flagged, not the safety topic.'];
    const jobId = await job();
    await W.runSetCheck(deps, { jobId }, H.ctx());
    const r = await review();
    assert.strictEqual(r.status, R.STATUS.FLAGGED);
    assert.strictEqual(r.findings[0].questionId, 'q001');
    assert.match(r.findings[0].explanation, /injuries in detail/);
    assert.strictEqual(H.state.sentHaiku.length, 1, 'one explanation per flagged question');
    assert.deepStrictEqual(publicRows(), []);
    assert.strictEqual(stamp().status, 'flagged');
    assert.strictEqual(queue().length, 0, 'a flagged set is not a queue item');
    const j = await J.getJob(db, T, jobId);
    assert.strictEqual(j.meta.outcome, 'flagged');
    assert.ok(!JSON.stringify(j.items).includes('Question 1 title'), 'question text leaked into the job items');
    assert.deepStrictEqual(Object.keys(j.items[0]).sort(), ['band', 'category', 'questionId']);
  });

  await H.test('a MEDIUM band escalates: a pointer in the queue, no text on it, nothing published', async () => {
    await seed();
    H.state.guardrailReplies = [H.guardrailClean(), H.guardrailHit('HATE', 'MEDIUM'), ...clean(2)];
    await W.runSetCheck(deps, { jobId: await job() }, H.ctx());
    assert.strictEqual((await review()).status, R.STATUS.ESCALATED);
    const [row] = queue();
    assert.ok(row, 'no queue row');
    assert.strictEqual(row.SK, `${ORG}#${SET}#v2`);
    assert.deepStrictEqual(row.reasons, ['escalated']);
    assert.strictEqual(row.title, 'Safety walkthrough');
    assert.strictEqual(row.orgName, 'Acme Learning');
    assert.deepStrictEqual(row.bands, { HATE: 'MEDIUM' });
    assert.ok(row.snapshotKey, 'the queue row does not point at the snapshot');
    assert.ok(!JSON.stringify(row).includes('Question 2 title'), 'question text on the queue row');
    assert.strictEqual(stamp().status, 'escalated');
    assert.deepStrictEqual(logEvents(), ['checked', 'escalated']);
    assert.deepStrictEqual(publicRows(), []);
  });

  await H.test('a declared notice, or an image, sends a clean set to a person with the reason named', async () => {
    await seed();
    H.state.guardrailReplies = clean(4);
    await W.runSetCheck(deps, { jobId: await job({ declaredNotice: ['graphic-medical'] }) }, H.ctx());
    assert.strictEqual((await review()).status, R.STATUS.ESCALATED);
    assert.deepStrictEqual((await review()).reasons, ['declared']);
    await seed({ image: true });
    H.state.guardrailReplies = clean(4);
    await W.runSetCheck(deps, { jobId: await job() }, H.ctx());
    assert.deepStrictEqual((await review()).reasons, ['images']);
    assert.deepStrictEqual(publicRows(), []);
  });

  await H.test('an org Workie is dropped from the public copy; the dialog was told in advance', async () => {
    await seed({ promptId: 'p-org' });
    H.state.guardrailReplies = clean(4);
    const jobId = await job();
    await W.runSetCheck(deps, { jobId }, H.ctx());
    const pub = publicRows().find((r) => r.PK === 'PUBLIC#SETS');
    assert.strictEqual(pub.promptId, undefined);
    assert.strictEqual(pub.promptDropped, true);
    assert.strictEqual((await J.getJob(db, T, jobId)).meta.promptDropped, true);
  });

  await H.test('running out of budget stops cleanly, escalates with the reason, and spends no more time on Haiku', async () => {
    await seed({ questions: 3 });
    // q1 is a real HIGH hit — so `findings` is non-empty and status lands on
    // FLAGGED — and the budget still runs out before q2, so `result.stopped`
    // is true. Haiku must not run either way: BUDGET_FLOOR_MS is 20s and up to
    // 12 Haiku calls do not fit in a budget already this thin.
    H.state.guardrailReplies = [H.guardrailHit('VIOLENCE', 'HIGH'), ...clean(3)];
    let remaining = 100000;
    const ctx = { functionName: 'fn', getRemainingTimeInMillis: () => { const r = remaining; remaining = 1000; return r; } };
    await W.runSetCheck(deps, { jobId: await job() }, ctx);
    const r = await review();
    assert.strictEqual(r.status, R.STATUS.FLAGGED, `status was ${r.status}: ${r.note}`);
    assert.ok(r.reasons.includes('timeout'), `reasons were ${r.reasons}`);
    assert.strictEqual(H.state.sentGuardrail.length, 1, 'the loop did not stop after the first question');
    assert.strictEqual(H.state.sentHaiku.length, 0, 'Haiku ran after the budget was already spent');
  });

  await H.test('a snapshot upload failure escalates and publishes nothing', async () => {
    await seed();
    H.state.guardrailReplies = clean(4);
    const failingS3 = { send: async () => { throw new Error('AccessDenied'); } };
    await W.runSetCheck({ ...deps, s3: failingS3 }, { jobId: await job() }, H.ctx());
    assert.strictEqual((await review()).status, R.STATUS.ESCALATED);
    assert.deepStrictEqual((await review()).reasons, ['snapshot']);
    assert.deepStrictEqual(publicRows(), []);
  });

  await H.test('an unexpected error fails toward a person and fails the job with a reason', async () => {
    H.reset();
    const jobId = await job(); // no set rows at all
    await W.runSetCheck(deps, { jobId }, H.ctx());
    const r = await review();
    assert.strictEqual(r.status, R.STATUS.ESCALATED);
    assert.deepStrictEqual(r.reasons, ['error']);
    assert.strictEqual(queue().length, 1);
    const j = await J.getJob(db, T, jobId);
    assert.strictEqual(j.status, 'error');
    assert.match(j.errorMessage, /no longer exists/);
  });

  await H.test('a failure after the upload still leaves the reviewer a pointer', async () => {
    await seed();
    H.state.guardrailReplies = clean(4);
    const jobId = await job();
    // The upload succeeds; the failure is engineered to land AFTER it, in
    // recordUnits — the first (and only) UpdateCommand whose expression adds to
    // a unit counter. The counter is NAMED (`#counter`, so a staff re-check can
    // send its calls to `staffUnits` without interpolating an attribute name
    // into the expression), so the trap matches the alias, not the attribute.
    // Everything else passes through to the real stub.
    const realSend = db.send.bind(db);
    let tripped = false;
    db.send = async (cmd) => {
      if (!tripped && cmd && cmd.kind === 'update' && String((cmd.input || {}).UpdateExpression || '').startsWith('ADD #counter')) {
        tripped = true;
        throw new Error('quota store down');
      }
      return realSend(cmd);
    };
    try {
      await W.runSetCheck(deps, { jobId }, H.ctx());
    } finally {
      db.send = realSend;
    }
    const r = await review();
    assert.strictEqual(r.status, R.STATUS.ESCALATED);
    assert.deepStrictEqual(r.reasons, ['error']);
    assert.ok(r.snapshotKey && /^moderation\/org_acme\/safety\/v2\//.test(r.snapshotKey), `snapshotKey was ${r.snapshotKey}`);
    assert.match(r.contentHash, /^[0-9a-f]{64}$/);
    const [row] = queue();
    assert.strictEqual(row.snapshotKey, r.snapshotKey);
    assert.strictEqual(row.title, 'Safety walkthrough');
    assert.strictEqual(row.questionCount, 3);
    assert.strictEqual(row.gameType, 'trivia', 'the catch path had the snapshot in hand and still left gameType off the queue row');
    assert.ok(H.state.s3.has(`prompts-test/${r.snapshotKey}`), 'the object is orphaned');
    const j = await J.getJob(db, T, jobId);
    assert.strictEqual(j.status, 'error');
  });

  // Part B (the handler) is appended by Task 11 below this line.
  console.log('\nthe check job — the handler\n');
  const handler = require(path.join(REPO, 'lambda-functions/admin/check-question-set.js')).handler;
  const parse = (res) => JSON.parse(res.body || '{}');
  const post = (extra = {}) => H.orgEvent({ orgId: ORG, role: 'owner', method: 'POST', setId: SET, body: { version: 2, ...extra } });
  const get = (jobId, orgId = ORG) => H.orgEvent({ orgId, role: 'member', method: 'GET', setId: SET, jobId });

  await H.test('a plain member cannot submit', async () => {
    await seed();
    const res = await handler(H.orgEvent({ orgId: ORG, role: 'member', method: 'POST', setId: SET, body: { version: 2 } }), H.ctx());
    assert.strictEqual(res.statusCode, 403);
    assert.strictEqual(H.state.dispatched.length, 0);
  });
  await H.test('an owner gets 202, a lock, a job carrying the org, a dispatch, and a checking stamp', async () => {
    await seed();
    const res = await handler(post(), H.ctx());
    assert.strictEqual(res.statusCode, 202, res.body);
    const { jobId } = parse(res);
    assert.ok(jobId);
    assert.strictEqual((await review()).status, R.STATUS.CHECKING);
    assert.strictEqual((await review()).jobId, jobId);
    const j = await J.getJob(db, T, jobId);
    assert.strictEqual(j.callerOrgId, ORG);
    assert.strictEqual(j.kind, 'set-check');
    assert.deepStrictEqual(j.request, { setId: SET, version: 2, publish: true, declaredNotice: [] });
    assert.deepStrictEqual(H.state.dispatched[0].payload, { __workerMode: true, jobId });
    assert.strictEqual(H.state.dispatched[0].InvocationType, 'Event');
    assert.strictEqual(stamp().status, 'checking');
  });
  await H.test('a second submit while one runs is refused with 409', async () => {
    await seed();
    await handler(post(), H.ctx());
    const res = await handler(post(), H.ctx());
    assert.strictEqual(res.statusCode, 409);
    assert.strictEqual(parse(res).status, 'checking');
    assert.strictEqual(H.state.dispatched.length, 1);
  });
  await H.test('the poll is tenant-scoped: another org gets 404, the same org reads the job', async () => {
    await seed();
    const { jobId } = parse(await handler(post(), H.ctx()));
    assert.strictEqual((await handler(get(jobId, 'org_rival'), H.ctx())).statusCode, 404);
    const mine = await handler(get(jobId), H.ctx());
    assert.strictEqual(mine.statusCode, 200);
    assert.strictEqual(parse(mine).jobId, jobId);
    assert.strictEqual((await handler(get('nope'), H.ctx())).statusCode, 404);
  });
  await H.test('a dispatch failure releases the lock and fails the job with a reason', async () => {
    await seed();
    H.state.lambdaShouldFail = true;
    const res = await handler(post(), H.ctx());
    assert.strictEqual(res.statusCode, 500);
    assert.strictEqual((await review()).status, R.STATUS.UNREVIEWED, 'the lock outlived the failed dispatch');
    const j = await J.getJob(db, T, parse(res).jobId);
    assert.strictEqual(j.status, 'error');
  });
  await H.test('the daily cap answers 429 and leaves no lock', async () => {
    await seed();
    process.env.CHECK_DAILY_CAP = '1';
    await handler(post(), H.ctx());
    await R.abandonCheck(db, T, SRC, 2, { jobId: (await review()).jobId });
    const res = await handler(post(), H.ctx());
    delete process.env.CHECK_DAILY_CAP;
    assert.strictEqual(res.statusCode, 429);
    assert.strictEqual(parse(res).cap, 1);
    assert.strictEqual((await review()).status, R.STATUS.UNREVIEWED);
  });
  await H.test('worker mode runs the check end to end through the handler', async () => {
    await seed({ promptId: '' });
    H.state.guardrailReplies = clean(4);
    const { jobId } = parse(await handler(post(), H.ctx()));
    await handler({ __workerMode: true, jobId }, H.ctx());
    assert.strictEqual((await review()).status, R.STATUS.PASSED);
    assert.strictEqual(stamp().status, 'published');
  });
  await H.test('a job row that cannot be written releases the lock and answers 500', async () => {
    await seed();
    const realSend = db.send.bind(db);
    let tripped = false;
    db.send = async (cmd) => {
      if (!tripped && cmd && cmd.kind === 'put' && cmd.input && cmd.input.Item && cmd.input.Item.PK === 'AIJOBS') {
        tripped = true;
        throw new Error('jobs table down');
      }
      return realSend(cmd);
    };
    try {
      const res = await handler(post(), H.ctx());
      assert.strictEqual(res.statusCode, 500);
      assert.strictEqual((await review()).status, R.STATUS.UNREVIEWED, 'the lock outlived the failed job write');
      assert.strictEqual(H.state.dispatched.length, 0);
    } finally {
      db.send = realSend;
    }
  });
  await H.test('a stamp that cannot be written after the dispatch is not a failed submit', async () => {
    await seed();
    const realSend = db.send.bind(db);
    let tripped = false;
    db.send = async (cmd) => {
      if (!tripped && cmd && cmd.kind === 'update' && cmd.input && String(cmd.input.UpdateExpression || '').includes('#share')) {
        tripped = true;
        throw new Error('stamp write down');
      }
      return realSend(cmd);
    };
    try {
      const res = await handler(post(), H.ctx());
      assert.strictEqual(res.statusCode, 202, res.body);
      const { jobId } = parse(res);
      assert.ok(jobId);
      assert.strictEqual(H.state.dispatched.length, 1);
      assert.strictEqual((await review()).status, R.STATUS.CHECKING, 'the lock stays — the worker owns it now');
    } finally {
      db.send = realSend;
    }
  });

  H.summary();
})();
