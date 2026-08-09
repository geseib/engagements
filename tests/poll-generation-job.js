const path = require('path');
const assert = require('assert');
const harness = require('./helpers/generation-job-harness');

const REPO = path.join(__dirname, '..');
harness.install();                                     // MUST precede the require below

const { handler } = require(path.join(REPO, 'lambda-functions/admin/ai-generate-polls.js'));

const { state, reset, toolResponse, test, summary } = harness;
const { postEvent, ctx, runJob } = harness.makeRunner(handler, 'engagedev-admin-ai-generate-polls');

const SUBJECTS = [
  'hybrid work schedules', 'meeting-free Fridays', 'open plan offices', 'annual review cadence',
  'internal tooling budget', 'on-call compensation', 'team offsite formats', 'promotion transparency',
];

const makePolls = (n, prefix, extra = {}) =>
  Array.from({ length: n }, (_, i) => ({
    title: `${prefix} ${SUBJECTS[i % SUBJECTS.length]}`,
    category: `Category ${(i % 3) + 1}`,
    detail: 'Some background for the question.',
    school: 'General Context',
    customInstructions: 'Pick the option closest to your view.',
    options: ['Strongly agree', 'Agree', 'Neutral', 'Disagree'],
    allowMultiple: false,
    tags: ['Workplace', 'team culture'],
    ...extra,
  }));

const makeItems = makePolls;

const BASE = { topic: 'workplace preferences', difficulty: 'medium', allowMultiple: false };

(async function run() {
  // ---- the eight common cases from the "Shared test harness" section ----

  console.log('\nthe HTTP request no longer generates');

  await test('POST returns 202 with a jobId instead of items', async () => {
    reset();
    const res = await handler(postEvent({ ...BASE, count: 10 }), ctx());
    assert.strictEqual(res.statusCode, 202, `expected 202, got ${res.statusCode}`);
    const body = JSON.parse(res.body);
    assert.ok(body.jobId, 'no jobId returned');
    assert.strictEqual(body.requested, 10);
  });

  await test('the HTTP request performs ZERO Bedrock calls (this is the 503 fix)', async () => {
    reset();
    await handler(postEvent({ ...BASE, count: 40 }), ctx());
    assert.strictEqual(state.bedrockCalls.length, 0,
      `request path called Bedrock ${state.bedrockCalls.length} times; it must not touch the 30s gateway budget`);
  });

  await test('the worker is dispatched as an async Event invoke', async () => {
    reset();
    await handler(postEvent({ ...BASE, count: 5 }), ctx());
    assert.strictEqual(state.dispatched.length, 1);
    assert.strictEqual(state.dispatched[0].InvocationType, 'Event',
      'RequestResponse would put the 900s worker back inside the 30s request');
    assert.strictEqual(state.dispatched[0].payload.__workerMode, true);
  });

  await test('a failed self-invoke marks the job with a readable error', async () => {
    reset();
    state.lambdaShouldFail = true;
    const res = await handler(postEvent({ ...BASE, count: 5 }), ctx());
    assert.strictEqual(res.statusCode, 500);
    const { jobId } = JSON.parse(res.body);
    const polled = await handler({ requestContext: { http: { method: 'GET' } }, pathParameters: { jobId } }, ctx());
    const job = JSON.parse(polled.body);
    assert.strictEqual(job.status, 'error');
    assert.match(job.error, /Could not start generation worker/);
  });

  console.log('\nlong runs behave');

  await test('later passes are told what earlier passes produced', async () => {
    reset();
    let call = 0;
    state.bedrockHandler = () => { call += 1; return toolResponse(makeItems(8, `pass${call}`)); };
    await runJob({ ...BASE, count: 16 });
    assert.ok(state.bedrockCalls.length >= 2, 'expected more than one pass');
    assert.match(state.bedrockCalls[1].prompt, /ALREADY (GENERATED|ASKED)/,
      'parallel batches blind to each other is what produced duplicates');
    assert.match(state.bedrockCalls[1].prompt, /pass1/);
  });

  await test('truncation halves the pass instead of failing the job', async () => {
    reset();
    let call = 0;
    state.bedrockHandler = (n) => {
      call = n;
      if (n === 1) return toolResponse([], 'max_tokens');
      return toolResponse(makeItems(4, 'halved'));
    };
    const { job } = await runJob({ ...BASE, count: 8 });
    assert.ok(call >= 2, 'a truncated pass must be retried smaller, not surfaced as a parse error');
    assert.strictEqual(job.status, 'complete');
    assert.ok(job.warnings.some((w) => /output budget/.test(w)));
  });

  await test('a mid-run Bedrock failure keeps what was already generated', async () => {
    reset();
    state.bedrockHandler = (n) => {
      if (n === 1) return toolResponse(makeItems(8, 'kept'));
      throw new Error('Bedrock is having a day');
    };
    const { job } = await runJob({ ...BASE, count: 24 });
    assert.strictEqual(job.status, 'error');
    assert.strictEqual(job.items.length, 8, 'partial output and an explanation beats a bare error');
  });

  await test('the worker stops cleanly when the function is nearly out of time', async () => {
    reset();
    state.bedrockHandler = () => toolResponse(makeItems(8, 'rush'));
    const { job } = await runJob({ ...BASE, count: 40 }, ctx(5000));
    assert.strictEqual(job.status, 'complete', 'running out of time must not lose the run');
    assert.ok(job.warnings.some((w) => /time limit/.test(w)));
  });

  // ---- poll-specific cases ----

  console.log('\npolls keep their own item shape');

  await test('options survive as an array and are never empty', async () => {
    reset();
    state.bedrockHandler = () => toolResponse(makePolls(3, 'p'));
    const { job } = await runJob({ ...BASE, count: 3 });
    for (const item of job.items) {
      assert.ok(Array.isArray(item.options), 'options must stay an array');
      assert.ok(item.options.length >= 2, 'a poll with fewer than two options is not a poll');
      assert.strictEqual(item.allowMultiple, false);
    }
  });

  await test('a poll returning too few options is dropped, not shipped broken', async () => {
    reset();
    state.bedrockHandler = () => toolResponse([
      ...makePolls(2, 'ok'),
      { ...makePolls(1, 'bad')[0], options: ['Only one'] },
    ]);
    const { job } = await runJob({ ...BASE, count: 3 });
    assert.strictEqual(job.items.length, 2,
      'the bad poll (one option) must be dropped, not kept and padded — 3 requested, 1 unusable, 2 survive');
    assert.ok(job.items.every((i) => i.options.length >= 2),
      'the old handler substituted ["Option 1","Option 2","Option 3"] and shipped a placeholder poll');
    assert.ok(job.items.every((i) => i.options.every((o) => !/^Option \d+$/.test(o))),
      'a placeholder-padded poll would satisfy options.length >= 2 just as well as a genuine one');
  });

  await test('allowMultiple is requested and preserved', async () => {
    reset();
    state.bedrockHandler = () => toolResponse(makePolls(2, 'multi', { allowMultiple: true }));
    const { job } = await runJob({ ...BASE, count: 2, allowMultiple: true });
    assert.match(state.bedrockCalls[0].prompt, /multiple selections/);
    assert.ok(job.items.every((i) => i.allowMultiple === true));
  });

  await test('allowMultiple stays false when the request did not ask for it', async () => {
    reset();
    state.bedrockHandler = () => toolResponse(makePolls(2, 'single', { allowMultiple: true }));
    const { job } = await runJob({ ...BASE, count: 2, allowMultiple: false });
    assert.ok(job.items.every((i) => i.allowMultiple === false),
      'a model volunteering multi-select must not override an explicit single-select request');
  });

  await test('tags are normalised onto every poll', async () => {
    reset();
    state.bedrockHandler = () => toolResponse(makePolls(3, 'tagged'));
    const { job } = await runJob({ ...BASE, count: 3 });
    for (const item of job.items) {
      assert.deepStrictEqual(item.tags, ['workplace', 'team-culture']);
    }
  });

  summary();
})();
