const path = require('path');
const assert = require('assert');
const harness = require('./helpers/generation-job-harness');

const REPO = path.join(__dirname, '..');
harness.install();                                     // MUST precede the require below

const { handler } = require(path.join(REPO, 'lambda-functions/admin/ai-generate-questions.js'));

const { state, reset, toolResponse, test, summary } = harness;
const { postEvent, ctx, runJob } = harness.makeRunner(handler, 'engagedev-admin-ai-generate-questions');

// 8 distinct subjects, matching the TOPICS/SUBJECTS list size used by the
// trivia/poll fixtures — the shared common test cases mock a batch of 8
// items per Bedrock call regardless of requested chunk size, and fewer than
// 8 unique titles here would make items 6-7 exact-duplicate items 0-1 and
// get legitimately dropped by the handler's near-duplicate guard.
const SUBJECTS = [
  'delegation', 'prioritisation', 'feedback', 'conflict',
  'scoping', 'estimation', 'time management', 'change management',
];

const makeQuestions = (n, prefix, extra = {}) =>
  Array.from({ length: n }, (_, i) => ({
    title: `${prefix} ${SUBJECTS[i % SUBJECTS.length]}`,
    category: `Category ${(i % 3) + 1}`,
    detail: 'A short scenario for discussion.',
    school: 'Business School',
    customInstructions: 'Discuss with your team.',
    tags: ['Leadership', 'team dynamics'],
    ...extra,
  }));

const makeItems = makeQuestions;

const BASE = { engagementType: 'call-and-answer', userInput: 'leadership scenarios for new managers' };

(async function run() {
  // ---- the eight common cases from the "Shared test harness" section ----
  // (BASE uses `questionCount`, not `count`)

  console.log('\nthe HTTP request no longer generates');

  await test('POST returns 202 with a jobId instead of items', async () => {
    reset();
    const res = await handler(postEvent({ ...BASE, questionCount: 10 }), ctx());
    assert.strictEqual(res.statusCode, 202, `expected 202, got ${res.statusCode}`);
    const body = JSON.parse(res.body);
    assert.ok(body.jobId, 'no jobId returned');
    assert.strictEqual(body.requested, 10);
  });

  await test('the HTTP request performs ZERO Bedrock calls (this is the 503 fix)', async () => {
    reset();
    await handler(postEvent({ ...BASE, questionCount: 40 }), ctx());
    assert.strictEqual(state.bedrockCalls.length, 0,
      `request path called Bedrock ${state.bedrockCalls.length} times; it must not touch the 30s gateway budget`);
  });

  await test('the worker is dispatched as an async Event invoke', async () => {
    reset();
    await handler(postEvent({ ...BASE, questionCount: 5 }), ctx());
    assert.strictEqual(state.dispatched.length, 1);
    assert.strictEqual(state.dispatched[0].InvocationType, 'Event',
      'RequestResponse would put the 900s worker back inside the 30s request');
    assert.strictEqual(state.dispatched[0].payload.__workerMode, true);
  });

  await test('a failed self-invoke marks the job with a readable error', async () => {
    reset();
    state.lambdaShouldFail = true;
    const res = await handler(postEvent({ ...BASE, questionCount: 5 }), ctx());
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
    await runJob({ ...BASE, questionCount: 16 });
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
    const { job } = await runJob({ ...BASE, questionCount: 8 });
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
    const { job } = await runJob({ ...BASE, questionCount: 24 });
    assert.strictEqual(job.status, 'error');
    assert.strictEqual(job.items.length, 8, 'partial output and an explanation beats a bare error');
  });

  await test('the worker stops cleanly when the function is nearly out of time', async () => {
    reset();
    state.bedrockHandler = () => toolResponse(makeItems(8, 'rush'));
    const { job } = await runJob({ ...BASE, questionCount: 40 }, ctx(5000));
    assert.strictEqual(job.status, 'complete', 'running out of time must not lose the run');
    assert.ok(job.warnings.some((w) => /time limit/.test(w)));
  });

  // ---- question-specific cases ----

  console.log('\nthe item shape follows the engagement type');

  await test('trivia questions get options and an option-id answer', async () => {
    reset();
    state.bedrockHandler = () => toolResponse(makeQuestions(2, 'triv', {
      optionA: 'A', optionB: 'B', optionC: 'C', optionD: 'D',
      correctAnswer: 'OptionB', answerDetails: 'Because B.', difficulty: 'medium',
    }));
    const { job } = await runJob({ ...BASE, engagementType: 'trivia', questionCount: 2 });
    for (const item of job.items) {
      assert.match(item.correctAnswer, /^Option[A-D]$/);
      assert.ok(item.optionA && item.optionD);
      assert.ok(item.answerDetails);
    }
    const props = state.bedrockCalls[0].body.tools[0].input_schema.properties.items.items.properties;
    assert.ok(props.optionA, 'the trivia tool schema must expose options');
  });

  await test('poll questions get options, and the schema does NOT offer trivia fields', async () => {
    reset();
    state.bedrockHandler = () => toolResponse(makeQuestions(2, 'poll', { options: ['Yes', 'No', 'Unsure'] }));
    const { job } = await runJob({ ...BASE, engagementType: 'poll', questionCount: 2 });
    assert.ok(job.items.every((i) => Array.isArray(i.options) && i.options.length >= 2));
    const props = state.bedrockCalls[0].body.tools[0].input_schema.properties.items.items.properties;
    assert.ok(!props.correctAnswer, 'a poll has no correct answer; the schema must not invite one');
  });

  await test('wavelength gets subject-sized guidance, not scenario-sized', async () => {
    reset();
    state.bedrockHandler = () => toolResponse(makeQuestions(4, 'wave'));
    await runJob({ ...BASE, engagementType: 'wavelength', questionCount: 4 });
    assert.match(state.bedrockCalls[0].prompt, /1-4 words/,
      'a wavelength subject is a short phrase, not a question');
  });

  await test('game-type spellings are normalised, not string-compared', async () => {
    reset();
    state.bedrockHandler = () => toolResponse(makeQuestions(2, 'alias', {
      optionA: 'A', optionB: 'B', optionC: 'C', optionD: 'D', correctAnswer: 'OptionA',
    }));
    // Whatever legacy spelling the client sends must resolve to the same shape.
    const { job } = await runJob({ ...BASE, engagementType: 'Trivia', questionCount: 2 });
    assert.ok(job.items.every((i) => /^Option[A-D]$/.test(i.correctAnswer)),
      'comparing raw game-type strings is exactly what silently breaks these lookups');
  });

  console.log('\nrefining one existing question');

  await test('refine mode forwards the existing question into the prompt', async () => {
    reset();
    state.bedrockHandler = () => toolResponse(makeQuestions(1, 'refined'));
    const { job } = await runJob({
      ...BASE,
      questionCount: 1,
      existingQuestion: { title: 'Original title', category: 'Ops', detail: 'Original detail' },
      userInput: 'make it more concrete',
    });
    assert.strictEqual(job.items.length, 1, 'refine produces exactly one replacement');
    assert.match(state.bedrockCalls[0].prompt, /EXISTING QUESTION/);
    assert.match(state.bedrockCalls[0].prompt, /Original title/);
    assert.match(state.bedrockCalls[0].prompt, /make it more concrete/);
  });

  await test('refine mode ignores a count above one', async () => {
    reset();
    state.bedrockHandler = () => toolResponse(makeQuestions(5, 'many'));
    const { job } = await runJob({
      ...BASE, questionCount: 5,
      existingQuestion: { title: 'Original', category: 'Ops', detail: 'd' },
    });
    assert.strictEqual(job.items.length, 1, 'refining one question cannot produce five');
  });

  await test('refine mode never sends the ALREADY GENERATED block', async () => {
    reset();
    state.bedrockHandler = () => toolResponse(makeQuestions(1, 'r'));
    await runJob({
      ...BASE, questionCount: 1,
      existingQuestion: { title: 'Original', category: 'Ops', detail: 'd' },
    });
    assert.ok(!/ALREADY GENERATED/.test(state.bedrockCalls[0].prompt),
      'there is nothing to avoid when replacing a single question');
  });

  await test('tags are normalised onto every question', async () => {
    reset();
    state.bedrockHandler = () => toolResponse(makeQuestions(3, 'tagged'));
    const { job } = await runJob({ ...BASE, questionCount: 3 });
    for (const item of job.items) {
      assert.deepStrictEqual(item.tags, ['leadership', 'team-dynamics']);
    }
  });

  summary();
})();
