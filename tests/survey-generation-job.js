const path = require('path');
const assert = require('assert');
const harness = require('./helpers/generation-job-harness');

const REPO = path.join(__dirname, '..');
harness.install();                                     // MUST precede the require below

const { handler } = require(path.join(REPO, 'lambda-functions/admin/ai-generate-survey.js'));

const { state, reset, toolResponse, test, summary } = harness;
const { postEvent, ctx, runJob } = harness.makeRunner(handler, 'engagedev-admin-ai-generate-survey');

// Distinct subjects, extended well past the brief's 6 (and past the 8 used
// by the trivia/poll/question suites' common-case fixtures). The shared
// common test cases mock a batch of 8 items per Bedrock call regardless of
// requested chunk size, so fewer than 8 unique subjects would make items 6-7
// exact-duplicate items 0-1 and get legitimately dropped by the handler's
// near-duplicate guard. The survey-specific "framing survives a failure"
// case below mocks a single 20-item batch (`makeSurvey(20, 'kept')`), which
// needs at least 20 unique subjects for the same reason — 8 would still
// collide within that one call.
const SUBJECTS = [
  'onboarding', 'tooling', 'communication', 'workload', 'growth', 'recognition',
  'compensation', 'leadership', 'work-life balance', 'collaboration', 'mentorship',
  'psychological safety', 'career development', 'team culture', 'performance reviews',
  'diversity and inclusion', 'remote work', 'meeting efficiency', 'decision making',
  'transparency', 'innovation', 'customer focus', 'process efficiency', 'wellbeing',
];

const makeSurvey = (n, prefix, extra = {}) =>
  Array.from({ length: n }, (_, i) => ({
    question: `${prefix} how satisfied are you with ${SUBJECTS[i % SUBJECTS.length]}?`,
    type: ['rating', 'multiple_choice', 'text_entry'][i % 3],
    scale: { type: '1-5', lowLabel: 'Low', highLabel: 'High' },
    options: ['Yes', 'No', 'Unsure'],
    allowMultiple: false,
    textType: 'short',
    placeholder: 'Your answer',
    required: true,
    tags: ['Employee Experience', 'onboarding'],
    ...extra,
  }));

const makeItems = makeSurvey;

// The harness's toolResponse takes tool-input extras as its third argument.
const toolResponseWithMeta = (items, meta = {}) => toolResponse(items, 'tool_use', meta);

const BASE = {
  title: 'Q3 Team Health Check',
  description: 'A short pulse survey.',
  topic: 'team health',
  audience: 'engineering',
  purpose: 'find friction',
  includeRating: true, includeMultipleChoice: true, includeTextEntry: true,
};

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

  // ---- survey-specific cases ----

  console.log('\nsurvey keeps its own question shape');

  await test('question types, scales and text types survive', async () => {
    reset();
    state.bedrockHandler = () => toolResponseWithMeta(makeSurvey(6, 'q'));
    const { job } = await runJob({ ...BASE, questionCount: 6 });
    assert.strictEqual(job.items.length, 6);
    for (const item of job.items) {
      assert.ok(['rating', 'multiple_choice', 'text_entry'].includes(item.type));
      assert.ok(item.scale && item.scale.type, 'a rating question is useless without its scale');
      assert.ok(typeof item.required === 'boolean');
    }
  });

  await test('question ids are sequential from 1', async () => {
    reset();
    state.bedrockHandler = () => toolResponseWithMeta(makeSurvey(5, 'seq'));
    const { job } = await runJob({ ...BASE, questionCount: 5 });
    assert.deepStrictEqual(job.items.map((i) => i.id), [1, 2, 3, 4, 5],
      'SurveyAIBuilder renders by index; ids must not be timestamps');
  });

  await test('excluded question types are not requested', async () => {
    reset();
    state.bedrockHandler = () => toolResponseWithMeta(makeSurvey(3, 'norating'));
    await runJob({ ...BASE, questionCount: 3, includeRating: false });
    const prompt = state.bedrockCalls[0].prompt;
    assert.ok(!/rating scale questions/.test(prompt), 'a type the admin unticked must not be requested');
    assert.match(prompt, /multiple choice questions/);
  });

  console.log('\nthe AI may improve the survey framing');

  await test('an improved title and description reach the poll payload', async () => {
    reset();
    state.bedrockHandler = () => toolResponseWithMeta(makeSurvey(4, 'meta'), {
      surveyTitle: 'Q3 Engineering Health Pulse',
      surveyDescription: 'Twelve questions on tooling, workload and growth.',
    });
    const { job } = await runJob({ ...BASE, questionCount: 4 });
    assert.deepStrictEqual(job.meta, {
      title: 'Q3 Engineering Health Pulse',
      description: 'Twelve questions on tooling, workload and growth.',
    });
  });

  await test('framing is asked for on the FIRST pass only', async () => {
    reset();
    let call = 0;
    state.bedrockHandler = (n) => {
      call = n;
      return toolResponseWithMeta(makeSurvey(20, `pass${n}`), n === 1
        ? { surveyTitle: 'First', surveyDescription: 'First description' }
        : {});
    };
    const { job } = await runJob({ ...BASE, questionCount: 40 });
    assert.ok(call >= 2, 'expected more than one pass');
    assert.match(state.bedrockCalls[0].prompt, /surveyTitle/,
      'the first pass must be asked for the framing');
    assert.ok(!/surveyTitle/.test(state.bedrockCalls[1].prompt),
      're-deriving the framing per pass invites the model to contradict itself');
    assert.strictEqual(job.meta.title, 'First');
  });

  await test('no framing returned leaves meta null so the client falls back', async () => {
    reset();
    state.bedrockHandler = () => toolResponseWithMeta(makeSurvey(3, 'nometa'));
    const { job } = await runJob({ ...BASE, questionCount: 3 });
    assert.strictEqual(job.meta, null,
      'an improved title is an improvement, not a dependency');
  });

  await test('blank framing is treated as no framing', async () => {
    reset();
    state.bedrockHandler = () => toolResponseWithMeta(makeSurvey(3, 'blank'), {
      surveyTitle: '   ', surveyDescription: '',
    });
    const { job } = await runJob({ ...BASE, questionCount: 3 });
    assert.strictEqual(job.meta, null, 'a blank title must not overwrite the typed one');
  });

  await test('framing written on pass 1 survives a failure on pass 2', async () => {
    reset();
    state.bedrockHandler = (n) => {
      if (n === 1) return toolResponseWithMeta(makeSurvey(20, 'kept'), { surveyTitle: 'Survived', surveyDescription: 'd' });
      throw new Error('Bedrock is having a day');
    };
    const { job } = await runJob({ ...BASE, questionCount: 40 });
    assert.strictEqual(job.status, 'error');
    assert.strictEqual(job.meta.title, 'Survived');
    assert.strictEqual(job.items.length, 20);
  });

  await test('tags are normalised onto every survey question', async () => {
    reset();
    state.bedrockHandler = () => toolResponseWithMeta(makeSurvey(3, 'tagged'));
    const { job } = await runJob({ ...BASE, questionCount: 3 });
    for (const item of job.items) {
      assert.deepStrictEqual(item.tags, ['employee-experience', 'onboarding']);
    }
  });

  summary();
})();
