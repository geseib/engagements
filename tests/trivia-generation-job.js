const path = require('path');
const assert = require('assert');
const harness = require('./helpers/generation-job-harness');

const REPO = path.join(__dirname, '..');
harness.install();                                     // MUST precede the require below

const { handler } = require(path.join(REPO, 'lambda-functions/admin/ai-generate-trivia.js'));

const { state, reset, toolResponse, test, summary } = harness;
const { postEvent, ctx, runJob } = harness.makeRunner(handler, 'engagedev-admin-ai-generate-trivia');

const TOPICS = [
  'photosynthesis', 'the Bretton Woods system', 'plate tectonics', 'the Silk Road',
  'antibiotic resistance', 'the Marshall Plan', 'binary search trees', 'the Doppler effect',
];

const makeTrivia = (n, prefix, extra = {}) =>
  Array.from({ length: n }, (_, i) => ({
    title: `${prefix} ${TOPICS[i % TOPICS.length]}`,
    questionDetail: `What is the significance of ${TOPICS[i % TOPICS.length]}?`,
    category: `Category ${(i % 3) + 1}`,
    answerDetails: 'Because of the reason given.',
    school: 'General Knowledge',
    optionA: 'First', optionB: 'Second', optionC: 'Third', optionD: 'Fourth',
    correctAnswer: 'OptionA',
    difficulty: 'medium',
    tags: ['Science', 'general knowledge'],
    ...extra,
  }));

const makeItems = makeTrivia;

const BASE = { topic: 'general science', difficulty: 'medium', numChoices: 4, numCorrect: 1 };

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

  // ---- trivia-specific cases ----

  console.log('\ntrivia keeps its own item shape');

  await test('correctAnswer stays an OptionX id, not the answer text', async () => {
    reset();
    state.bedrockHandler = () => toolResponse(makeTrivia(3, 'q'));
    const { job } = await runJob({ ...BASE, count: 3 });
    assert.strictEqual(job.items.length, 3);
    for (const item of job.items) {
      assert.match(item.correctAnswer, /^Option[A-F]$/, `correctAnswer must be an option id, got ${item.correctAnswer}`);
      assert.ok(item.questionDetail, 'questionDetail is what players actually see');
      assert.ok(item.optionA && item.optionD, 'four choices requested, four expected');
    }
  });

  await test('numCorrect > 1 produces an array of option ids', async () => {
    reset();
    state.bedrockHandler = () => toolResponse(makeTrivia(2, 'multi', { correctAnswer: ['OptionA', 'OptionC'] }));
    const { job } = await runJob({ ...BASE, count: 2, numCorrect: 2 });
    for (const item of job.items) {
      assert.ok(Array.isArray(item.correctAnswer), 'multi-answer trivia must keep an array');
      assert.deepStrictEqual(item.correctAnswer, ['OptionA', 'OptionC']);
    }
  });

  await test('the tool schema asks for exactly numChoices options', async () => {
    reset();
    state.bedrockHandler = () => toolResponse(makeTrivia(2, 'six', { optionE: 'Fifth', optionF: 'Sixth' }));
    await runJob({ ...BASE, count: 2, numChoices: 6 });
    const props = state.bedrockCalls[0].body.tools[0].input_schema.properties.items.items.properties;
    assert.ok(props.optionE && props.optionF, 'numChoices=6 must expose optionE/optionF');
    reset();
    state.bedrockHandler = () => toolResponse(makeTrivia(2, 'four'));
    await runJob({ ...BASE, count: 2, numChoices: 4 });
    const four = state.bedrockCalls[0].body.tools[0].input_schema.properties.items.items.properties;
    assert.ok(!four.optionE, 'numChoices=4 must NOT offer a fifth option');
  });

  console.log('\ncategory configuration is finally honoured');

  await test('numberOfCategories reaches the prompt (it never used to)', async () => {
    reset();
    state.bedrockHandler = () => toolResponse(makeTrivia(5, 'cat'));
    await runJob({ ...BASE, count: 5, numberOfCategories: 4, mustHaveCategories: 'Physics, Chemistry' });
    const prompt = state.bedrockCalls[0].prompt;
    assert.match(prompt, /EXACTLY 4 categories/, 'the trivia UI has always sent this and the handler always dropped it');
    assert.match(prompt, /Physics, Chemistry/);
  });

  await test('the category clamp uses the TOTAL, never the chunk size', async () => {
    reset();
    // One item per pass is the case that used to collapse the clamp to 1.
    state.bedrockHandler = () => toolResponse(makeTrivia(1, 'solo'));
    await runJob({ ...BASE, count: 1, numberOfCategories: 5 });
    const prompt = state.bedrockCalls[0].prompt;
    assert.match(prompt, /EXACTLY 1 categories/,
      'one item genuinely cannot span 5 categories — but the clamp must come from the total, not the chunk');

    reset();
    state.bedrockHandler = () => toolResponse(makeTrivia(20, 'many'));
    await runJob({ ...BASE, count: 20, numberOfCategories: 5 });
    assert.match(state.bedrockCalls[0].prompt, /EXACTLY 5 categories/,
      'a 20-item request must keep all 5 categories even though it is generated in passes');
  });

  console.log('\ntags');

  await test('tags are normalised onto every question', async () => {
    reset();
    state.bedrockHandler = () => toolResponse(makeTrivia(3, 'tagged'));
    const { job } = await runJob({ ...BASE, count: 3 });
    for (const item of job.items) {
      assert.deepStrictEqual(item.tags, ['science', 'general-knowledge'],
        'normalise on write: "Science" and "general knowledge" are stored canonical');
    }
  });

  await test('the prompt asks for tags', async () => {
    reset();
    state.bedrockHandler = () => toolResponse(makeTrivia(2, 'tp'));
    await runJob({ ...BASE, count: 2 });
    assert.match(state.bedrockCalls[0].prompt, /TAGS:/);
    assert.match(state.bedrockCalls[0].prompt, /kebab-case/);
  });

  summary();
})();
