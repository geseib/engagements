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
// near-duplicate guard. The survey-specific cases below mock batches of up
// to 10 (`makeSurvey(10, 'kept')`), which need at least 10 unique subjects for
// the same reason — 8 would still collide within that one call.
const SUBJECTS = [
  'onboarding', 'tooling', 'communication', 'workload', 'growth', 'recognition',
  'compensation', 'leadership', 'work-life balance', 'collaboration', 'mentorship',
  'psychological safety', 'career development', 'team culture', 'performance reviews',
  'diversity and inclusion', 'remote work', 'meeting efficiency', 'decision making',
  'transparency', 'innovation', 'customer focus', 'process efficiency', 'wellbeing',
];

/**
 * Contract-shaped survey items (docs/design/survey-redesign/
 * IMPLEMENTATION-phase-0-1.md), cycling through the five kinds so every pass
 * exercises every kind's normalisation.
 */
const KIND_CYCLE = ['rating', 'choice', 'yesno', 'rank', 'text'];
const KIND_FIELDS = {
  rating: { scale: '1-5', lowLabel: 'Not at all', highLabel: 'Completely' },
  choice: { options: ['Yes', 'No', 'Unsure'], allowMultiple: false },
  yesno: { unsure: true, followUpWhen: 'no', followUpPrompt: 'What would change your mind?' },
  rank: { options: ['Speed', 'Quality', 'Cost', 'Scope'], rankTop: 2 },
  text: { textLength: 'long', placeholder: 'A sentence or two' },
};
const makeSurvey = (n, prefix, extra = {}) =>
  Array.from({ length: n }, (_, i) => {
    const kind = KIND_CYCLE[i % KIND_CYCLE.length];
    return {
      kind,
      title: `${prefix} how satisfied are you with ${SUBJECTS[i % SUBJECTS.length]}?`,
      detail: '',
      required: true,
      ...KIND_FIELDS[kind],
      tags: ['Employee Experience', 'onboarding'],
      ...extra,
    };
  });

const makeItems = makeSurvey;

// The harness's toolResponse takes tool-input extras as its third argument.
const toolResponseWithMeta = (items, meta = {}) => toolResponse(items, 'tool_use', meta);

const BASE = {
  title: 'Q3 Team Health Check',
  description: 'A short pulse survey.',
  source: 'Q3 all-hands outline: the new console demo, three customer case studies, the FY27 pricing roadmap.',
  goal: 'find what landed and what to change next time',
  kinds: ['rating', 'choice', 'yesno', 'rank', 'text'],
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

  console.log('\nthe request: kinds, how many, the material and the goal');

  /** The tool schema the worker handed Bedrock on its first call. */
  const firstTool = () => state.bedrockCalls[0].body.tools[0];
  const kindEnum = () => firstTool().input_schema.properties.items.items.properties.kind.enum;

  await test('the chosen kinds are the schema enum, in the contract order', async () => {
    reset();
    state.bedrockHandler = () => toolResponseWithMeta(makeSurvey(3, 'enum').filter((i) => ['rating', 'text'].includes(i.kind)));
    await runJob({ ...BASE, questionCount: 2, kinds: ['text', 'rating'] });
    assert.deepStrictEqual(kindEnum(), ['rating', 'text']);
  });

  await test('only the chosen kinds are described in the prompt, and it asks for a mix', async () => {
    reset();
    state.bedrockHandler = () => toolResponseWithMeta(makeSurvey(2, 'mix'));
    await runJob({ ...BASE, questionCount: 2, kinds: ['rating', 'choice'] });
    const prompt = state.bedrockCalls[0].prompt;
    assert.match(prompt, /rating:/);
    assert.match(prompt, /choice:/);
    for (const unchosen of ['yesno:', 'rank:', 'text:']) {
      assert.ok(!prompt.includes(unchosen), 'an unchosen kind (' + unchosen + ') was described to the model');
    }
    assert.match(prompt, /[Mm]ix/, 'the prompt does not ask for a mix of kinds');
  });

  await test('no kinds means all five', async () => {
    reset();
    state.bedrockHandler = () => toolResponseWithMeta(makeSurvey(5, 'all'));
    await runJob({ ...BASE, questionCount: 5, kinds: [] });
    assert.deepStrictEqual(kindEnum(), ['rating', 'choice', 'yesno', 'rank', 'text']);
  });

  await test('an unknown kind in the list is ignored, and a legacy spelling maps', async () => {
    reset();
    state.bedrockHandler = () => toolResponseWithMeta(makeSurvey(1, 'odd'));
    await runJob({ ...BASE, questionCount: 1, kinds: ['slider', 'multiple_choice', 'text'] });
    assert.deepStrictEqual(kindEnum(), ['choice', 'text']);
  });

  await test('the legacy include* flags are still honoured when kinds is absent', async () => {
    reset();
    state.bedrockHandler = () => toolResponseWithMeta(makeSurvey(2, 'legacy'));
    const { kinds, ...withoutKinds } = BASE; // eslint-disable-line no-unused-vars
    await runJob({ ...withoutKinds, questionCount: 2, includeRating: true, includeMultipleChoice: true, includeTextEntry: false });
    assert.deepStrictEqual(kindEnum(), ['rating', 'choice']);
  });

  await test('how many is capped at 20', async () => {
    reset();
    const res = await handler(postEvent({ ...BASE, questionCount: 50 }), ctx());
    assert.strictEqual(JSON.parse(res.body).requested, 20);
  });

  await test('the pasted material reaches the prompt as the MATERIAL, and the goal as the PURPOSE', async () => {
    reset();
    state.bedrockHandler = () => toolResponseWithMeta(makeSurvey(1, 'src'));
    await runJob({ ...BASE, questionCount: 1 });
    const prompt = state.bedrockCalls[0].prompt;
    assert.ok(prompt.includes(BASE.source), 'the source material is missing from the prompt');
    assert.ok(prompt.includes(BASE.goal), 'the goal is missing from the prompt');
    assert.ok(prompt.indexOf('MATERIAL') < prompt.indexOf(BASE.source), 'the source is not introduced as the material');
  });

  await test('a pasted source is capped at 50,000 characters (the parse-document cap)', async () => {
    reset();
    state.bedrockHandler = () => toolResponseWithMeta(makeSurvey(1, 'long'));
    await runJob({ ...BASE, questionCount: 1, source: 'x'.repeat(60000) + 'THE-TAIL' });
    const prompt = state.bedrockCalls[0].prompt;
    assert.ok(!prompt.includes('THE-TAIL'), 'the source was not capped');
    assert.ok(prompt.includes('x'.repeat(50000)), 'the first 50,000 characters were not kept');
  });

  console.log('\nthe items are contract-shaped');

  await test('every item has kind, title, required and only its kind\'s fields', async () => {
    reset();
    state.bedrockHandler = () => toolResponseWithMeta(makeSurvey(5, 'shape', { scale: '1-10', options: ['a', 'b', 'c'] }));
    const { job } = await runJob({ ...BASE, questionCount: 5 });
    const byKind = Object.fromEntries(job.items.map((i) => [i.kind, i]));
    const keysOf = (i) => Object.keys(i).filter((k) => !['id', 'title', 'detail', 'tags'].includes(k)).sort();
    assert.deepStrictEqual(keysOf(byKind.rating), ['highLabel', 'kind', 'lowLabel', 'required', 'scale']);
    assert.deepStrictEqual(keysOf(byKind.choice), ['allowMultiple', 'allowOther', 'kind', 'options', 'required', 'shuffle']);
    assert.deepStrictEqual(keysOf(byKind.yesno), ['followUpPrompt', 'followUpWhen', 'kind', 'noLabel', 'required', 'unsure', 'yesLabel']);
    assert.deepStrictEqual(keysOf(byKind.rank), ['kind', 'options', 'rankTop', 'required']);
    assert.deepStrictEqual(keysOf(byKind.text), ['kind', 'maxLength', 'placeholder', 'required', 'textLength', 'themes']);
    assert.strictEqual(byKind.rating.scale, '1-10');
    assert.strictEqual(byKind.text.maxLength, 500, 'a long answer defaults to 500');
    assert.strictEqual(byKind.text.themes, true, 'themes default ON');
  });

  await test('question ids are sequential from 1', async () => {
    reset();
    state.bedrockHandler = () => toolResponseWithMeta(makeSurvey(5, 'seq'));
    const { job } = await runJob({ ...BASE, questionCount: 5 });
    assert.deepStrictEqual(job.items.map((i) => i.id), [1, 2, 3, 4, 5],
      'the builder renders by index; ids must not be timestamps');
  });

  await test('what can be repaired is repaired', async () => {
    reset();
    state.bedrockHandler = () => toolResponseWithMeta([
      { kind: 'rating', title: 'repair a scale nobody offers', required: false, scale: '1-7', tags: [] },
      { kind: 'rank', title: 'repair nine items to seven', required: false, options: ['1', '2', '3', '4', '5', '6', '7', '8', '9'], rankTop: 8, tags: [] },
      { kind: 'choice', title: 'repair picks from a single-pick list', required: false, options: ['a', 'b', 'c'], allowMultiple: true, maxPicks: 9, tags: [] },
      { kind: 'yesno', title: 'repair a follow-up with no question', required: false, followUpWhen: 'no', tags: [] },
      { kind: 'text', title: 'repair an answer limit out of range', required: false, textLength: 'short', maxLength: 5, tags: [] },
    ]);
    const { job } = await runJob({ ...BASE, questionCount: 5 });
    const [rating, rank, choice, yesno, text] = job.items;
    assert.strictEqual(job.items.length, 5);
    assert.strictEqual(rating.scale, '1-5');
    assert.strictEqual(rank.options.length, 7);
    assert.ok(!('rankTop' in rank), 'a rank-top past the list is dropped, so all are ranked');
    assert.ok(!('maxPicks' in choice), 'an impossible pick limit is dropped');
    assert.strictEqual(yesno.followUpWhen, '', 'a follow-up with no question is switched off');
    assert.strictEqual(text.maxLength, 280, 'an impossible limit falls back to the length\'s default');
  });

  await test('what cannot be repaired is dropped, not shipped', async () => {
    reset();
    state.bedrockHandler = () => toolResponseWithMeta([
      { kind: 'choice', title: 'a choice with one option', required: false, options: ['only'], tags: [] },
      { kind: 'rank', title: 'a ranking of two', required: false, options: ['a', 'b'], tags: [] },
      { kind: 'slider', title: 'a kind that does not exist', required: false, tags: [] },
      { kind: 'rating', title: '', required: false, tags: [] },
      { kind: 'text', title: 'the one good question', required: false, tags: [] },
    ]);
    const { job } = await runJob({ ...BASE, questionCount: 5 });
    assert.deepStrictEqual(job.items.map((i) => i.title), ['the one good question']);
  });

  await test('a kind the host did not choose is dropped', async () => {
    reset();
    state.bedrockHandler = () => toolResponseWithMeta(makeSurvey(5, 'unchosen'));
    const { job } = await runJob({ ...BASE, questionCount: 5, kinds: ['rating', 'text'] });
    assert.deepStrictEqual(job.items.map((i) => i.kind).sort(), ['rating', 'text']);
  });

  await test('a title longer than 200 characters is cut to 200', async () => {
    reset();
    state.bedrockHandler = () => toolResponseWithMeta([{ kind: 'text', title: 'y'.repeat(260), required: false, tags: [] }]);
    const { job } = await runJob({ ...BASE, questionCount: 1 });
    assert.strictEqual(job.items[0].title.length, 200);
  });

  await test('the old shape (question/type) is still read, so a model that slips is not wasted', async () => {
    reset();
    state.bedrockHandler = () => toolResponseWithMeta([
      { question: 'an old-shape multiple choice', type: 'multiple_choice', options: ['a', 'b'], required: true, tags: [] },
    ]);
    const { job } = await runJob({ ...BASE, questionCount: 1 });
    assert.strictEqual(job.items[0].kind, 'choice');
    assert.strictEqual(job.items[0].title, 'an old-shape multiple choice');
  });

  await test('the draft-set CSV built from the items validates with zero problems', async () => {
    reset();
    state.bedrockHandler = () => toolResponseWithMeta(makeSurvey(10, 'csv'));
    const { job } = await runJob({ ...BASE, questionCount: 10 });
    const K = require(path.join(REPO, 'lambda-functions/admin/shared/survey-kinds.js'));
    const lines = K.itemsToSurveyCsv(job.items).trim().split('\n');
    const header = lines[0].split(',');
    const parseLine = (text) => {
      const out = []; let cur = ''; let q = false;
      for (let i = 0; i < text.length; i++) {
        const c = text[i];
        if (c === '"') { if (q && text[i + 1] === '"') { cur += '"'; i++; } else q = !q; }
        else if (c === ',' && !q) { out.push(cur); cur = ''; }
        else cur += c;
      }
      out.push(cur);
      return out;
    };
    assert.strictEqual(lines.length - 1, 10);
    for (const line of lines.slice(1)) {
      const values = parseLine(line);
      const get = (col) => values[header.indexOf(col)] || '';
      assert.deepStrictEqual(K.validateSurvey(K.surveyFieldsFromCells(get)), [], line);
    }
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
      return toolResponseWithMeta(makeSurvey(10, `pass${n}`), n === 1
        ? { surveyTitle: 'First', surveyDescription: 'First description' }
        : {});
    };
    const { job } = await runJob({ ...BASE, questionCount: 20 });
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
      if (n === 1) return toolResponseWithMeta(makeSurvey(10, 'kept'), { surveyTitle: 'Survived', surveyDescription: 'd' });
      throw new Error('Bedrock is having a day');
    };
    const { job } = await runJob({ ...BASE, questionCount: 20 });
    assert.strictEqual(job.status, 'error');
    assert.strictEqual(job.meta.title, 'Survived');
    assert.strictEqual(job.items.length, 10);
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
