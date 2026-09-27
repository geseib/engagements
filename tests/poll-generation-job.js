/**
 * THE POLL GENERATOR — lambda-functions/admin/ai-generate-polls.js.
 *
 * The eight common job cases every converted builder is held to, then the
 * poll's own: since the owner's redesign (27 Sep 2026) a poll question is a
 * survey question the host asks — choice, rating, yes/no or an open answer,
 * typed by shared/survey-kinds.js — and the generator writes it that way. The
 * defect that made it concrete: "an example AI rendered medium Poll item but
 * didn't give options but open text box".
 */
const path = require('path');
const assert = require('assert');
const harness = require('./helpers/generation-job-harness');

const REPO = path.join(__dirname, '..');
harness.install();                                     // MUST precede the require below

const polls = require(path.join(REPO, 'lambda-functions/admin/ai-generate-polls.js'));
const { handler } = polls;
const K = require(path.join(REPO, 'lambda-functions/admin/shared/survey-kinds.js'));
const { pollsToCsv } = require(path.join(REPO, 'lambda-functions/admin/shared/generated-set.js'));

const { state, reset, toolResponse, test, summary } = harness;
const { postEvent, pollEvent, ctx, runJob } = harness.makeRunner(handler, 'engagedev-admin-ai-generate-polls');

const SUBJECTS = [
  'hybrid work schedules', 'meeting-free Fridays', 'open plan offices', 'annual review cadence',
  'internal tooling budget', 'on-call compensation', 'team offsite formats', 'promotion transparency',
];

/** A batch of choice polls — the shape the common cases need is "several valid items". */
const makePolls = (n, prefix, extra = {}) =>
  Array.from({ length: n }, (_, i) => ({
    kind: 'choice',
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

/** One of each kind, as a model following the new schema returns them. */
const TYPED = [
  {
    kind: 'choice', title: 'Which release cadence suits us', category: 'Delivery',
    options: ['Weekly', 'Fortnightly', 'Monthly'], allowMultiple: false, tags: ['delivery'],
  },
  {
    kind: 'rating', title: 'How ready is the launch plan', category: 'Delivery',
    scale: '1-5', lowLabel: 'Not at all ready', highLabel: 'Ready today', tags: ['launch'],
  },
  {
    kind: 'yesno', title: 'Should we adopt the new review rule', category: 'Process',
    yesLabel: 'Approve', noLabel: 'Decline', unsure: true, tags: ['process'],
  },
  {
    kind: 'text', title: 'One word for this quarter', category: 'Mood',
    textLength: 'short', placeholder: 'One word', tags: ['mood'],
  },
];

const BASE = { topic: 'workplace preferences', difficulty: 'medium' };

/** The item schema the worker handed Bedrock on its first call. */
const itemSchema = () => state.bedrockCalls[0].body.tools[0].input_schema.properties.items.items;

/** A minimal RFC 4180 reader: quoted cells, doubled quotes, newlines inside quotes. */
function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i += 1; }
      else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += c;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

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
    const polled = await handler(pollEvent(jobId), ctx());
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

  console.log('\nthe tool schema offers exactly the kinds the host ticked');

  // rejects: a fixed enum, which lets the model write a text box into a set
  // whose host asked only for choices — the owner's reported defect.
  await test('two kinds ticked: the enum is those two, and only their fields are offered', async () => {
    reset();
    state.bedrockHandler = () => toolResponse(TYPED.slice(1, 3));
    await runJob({ ...BASE, count: 2, kinds: ['yesno', 'rating'] });
    const schema = itemSchema();
    assert.deepStrictEqual(schema.properties.kind.enum, ['rating', 'yesno'],
      'the enum must be the chosen kinds, in the contract order');
    for (const field of ['scale', 'lowLabel', 'highLabel', 'yesLabel', 'noLabel', 'unsure']) {
      assert.ok(schema.properties[field], `the ${field} field of a chosen kind is missing`);
    }
    for (const field of ['options', 'allowMultiple', 'textLength', 'placeholder']) {
      assert.ok(!schema.properties[field], `${field} belongs to a kind the host did not tick`);
    }
    assert.ok(schema.required.includes('kind'), 'the kind must be required, or an item can arrive untyped');
  });

  await test('nothing ticked means all four, and rank is never a poll kind', async () => {
    reset();
    state.bedrockHandler = () => toolResponse(TYPED);
    await runJob({ ...BASE, count: 4 });
    assert.deepStrictEqual(itemSchema().properties.kind.enum, ['choice', 'rating', 'yesno', 'text']);

    reset();
    state.bedrockHandler = () => toolResponse(TYPED);
    await runJob({ ...BASE, count: 4, kinds: ['rank'] });
    assert.deepStrictEqual(itemSchema().properties.kind.enum, ['choice', 'rating', 'yesno', 'text'],
      'a ranking is a ballot, not a glance: asking for only rank must not produce an empty or rank enum');
  });

  await test('a poll is not offered the fields that slow a glance down', async () => {
    reset();
    state.bedrockHandler = () => toolResponse(TYPED);
    await runJob({ ...BASE, count: 4 });
    const { properties } = itemSchema();
    for (const field of ['followUpWhen', 'followUpPrompt', 'maxLength', 'themes', 'rankTop', 'required']) {
      assert.ok(!properties[field], `${field} was offered to the model for a poll`);
    }
    assert.match(properties.options.description, /2-5 short options/);
  });

  console.log('\nthe prompt asks for instant feedback, in the chosen kinds');

  await test('the prompt describes only the ticked kinds and asks for a sensible mix', async () => {
    reset();
    state.bedrockHandler = () => toolResponse(TYPED.slice(0, 3));
    await runJob({ ...BASE, count: 3, kinds: ['choice', 'yesno'] });
    const { prompt } = state.bedrockCalls[0];
    assert.match(prompt, /instant-feedback polls/);
    assert.match(prompt, /One idea per question/);
    assert.match(prompt, /projected screen/);
    assert.match(prompt, /- choice — /);
    assert.match(prompt, /- yesno — /);
    assert.match(prompt, /Approve \/ Decline, True \/ False, Agree \/ Disagree/);
    assert.match(prompt, /mix them sensibly/);
    assert.ok(!/- rating — /.test(prompt) && !/- text — /.test(prompt), 'an unticked kind was described to the model');
  });

  await test('one kind ticked is described as the only kind, with no mix to make', async () => {
    reset();
    state.bedrockHandler = () => toolResponse([TYPED[3]]);
    await runJob({ ...BASE, count: 1, kinds: ['text'] });
    const { prompt } = state.bedrockCalls[0];
    assert.match(prompt, /every question is this kind/);
    assert.ok(!/mix them/.test(prompt));
    // The owner's defect, answered in the prompt as well as in normalizeItem.
    assert.match(prompt, /never as a stand-in for options you did not write/);
  });

  console.log('\nnormalizeItem keeps a valid poll of a chosen kind, and nothing else');

  await test('a choice with fewer than two options is dropped, not shipped broken', async () => {
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

  await test('a yes/no with Approve / Decline labels is kept, labels and all', async () => {
    reset();
    state.bedrockHandler = () => toolResponse([TYPED[2]]);
    const { job } = await runJob({ ...BASE, count: 1, kinds: ['yesno'] });
    assert.strictEqual(job.items.length, 1, 'a valid yes/no was dropped');
    const item = job.items[0];
    assert.strictEqual(item.kind, 'yesno');
    assert.strictEqual(item.yesLabel, 'Approve');
    assert.strictEqual(item.noLabel, 'Decline');
    assert.strictEqual(item.unsure, true);
    assert.strictEqual(item.options, undefined, 'a yes/no must not carry a choice\'s options');
  });

  await test('every kind comes back in the contract\'s shape: kind, required, and only its own fields', async () => {
    reset();
    state.bedrockHandler = () => toolResponse(TYPED);
    const { job } = await runJob({ ...BASE, count: 4 });
    assert.deepStrictEqual(job.items.map((i) => i.kind), ['choice', 'rating', 'yesno', 'text']);
    for (const item of job.items) {
      const own = K.itemFields(K.pollFieldsOf(item));
      for (const [field, value] of Object.entries(own)) {
        assert.deepStrictEqual(item[field], value, `${item.kind}.${field} is not the contract's value`);
      }
      assert.deepStrictEqual(K.validatePoll(K.pollFieldsOf(item)), [], `${item.kind} would be skipped on import`);
    }
    const text = job.items.find((i) => i.kind === 'text');
    assert.strictEqual(text.textLength, 'short', 'an open answer in a poll is short');
    assert.strictEqual(text.maxLength, 280);
    const rating = job.items.find((i) => i.kind === 'rating');
    assert.strictEqual(rating.lowLabel, 'Not at all ready');
    assert.strictEqual(rating.options, undefined);
  });

  // rejects: reading a kindless, optionless item as the open answer
  // pollFieldsOf would make of a STORED row. That is the owner's defect —
  // "didn't give options but open text box" — and it must not ship.
  await test('an item with neither a kind nor options is dropped, not turned into a text box', async () => {
    reset();
    const { kind, options, ...untyped } = makePolls(1, 'bare')[0];
    state.bedrockHandler = () => toolResponse([untyped, TYPED[1]]);
    const { job } = await runJob({ ...BASE, count: 2 });
    assert.deepStrictEqual(job.items.map((i) => i.kind), ['rating']);
  });

  await test('an item with no kind but real options is the choice it plainly is', async () => {
    reset();
    const { kind, ...legacy } = makePolls(1, 'legacy')[0];
    state.bedrockHandler = () => toolResponse([legacy]);
    const { job } = await runJob({ ...BASE, count: 1 });
    assert.strictEqual(job.items.length, 1);
    assert.strictEqual(job.items[0].kind, 'choice');
    assert.deepStrictEqual(job.items[0].options, ['Strongly agree', 'Agree', 'Neutral', 'Disagree']);
  });

  await test('a kind the host did not tick, or a ranking, is dropped', async () => {
    reset();
    state.bedrockHandler = () => toolResponse([
      TYPED[0],
      TYPED[3],
      { kind: 'rank', title: 'Rank these priorities', category: 'Delivery', options: ['A', 'B', 'C'], tags: [] },
    ]);
    const { job } = await runJob({ ...BASE, count: 3, kinds: ['choice'] });
    assert.deepStrictEqual(job.items.map((i) => i.kind), ['choice']);
  });

  await test('what has a sensible value is repaired rather than dropped', async () => {
    reset();
    state.bedrockHandler = () => toolResponse([
      { ...TYPED[0], options: ['A', 'B', 'C', 'D', 'E', 'F', 'G'], allowMultiple: true, maxPicks: 9 },
      { ...TYPED[1], scale: 'out of ten' },
      { ...TYPED[2], title: 'A lone label', yesLabel: 'Approve', noLabel: '' },
      { ...TYPED[3], textLength: 'medium' },
    ]);
    const { job } = await runJob({ ...BASE, count: 4 });
    const [choice, rating, yesno, text] = job.items;
    assert.strictEqual(choice.options.length, 5, 'a poll\'s options are cut to the five that fit at a glance');
    assert.strictEqual(choice.maxPicks, undefined, 'an impossible pick limit is dropped');
    assert.strictEqual(rating.scale, '1-5');
    assert.strictEqual(yesno.yesLabel, '', '"Approve / No" is a slip: a lone label goes back to Yes / No');
    assert.strictEqual(yesno.noLabel, '');
    assert.strictEqual(text.textLength, 'short');
  });

  console.log('\nthe old allowMultiple flag, from a builder that still sends it');

  await test('allowMultiple: false keeps every choice single-select, and says so', async () => {
    reset();
    state.bedrockHandler = () => toolResponse(makePolls(2, 'single', { allowMultiple: true }));
    const { job } = await runJob({ ...BASE, count: 2, allowMultiple: false });
    assert.match(state.bedrockCalls[0].prompt, /single-select/);
    assert.ok(job.items.every((i) => i.allowMultiple === false),
      'a model volunteering multi-select must not override an explicit single-select request');
  });

  await test('absent, the question decides: a "pick all that apply" choice keeps its several picks', async () => {
    reset();
    state.bedrockHandler = () => toolResponse(makePolls(2, 'multi', { allowMultiple: true }));
    const { job } = await runJob({ ...BASE, count: 2 });
    assert.ok(job.items.every((i) => i.allowMultiple === true));
  });

  await test('tags are normalised onto every poll', async () => {
    reset();
    state.bedrockHandler = () => toolResponse(makePolls(3, 'tagged'));
    const { job } = await runJob({ ...BASE, count: 3 });
    for (const item of job.items) {
      assert.deepStrictEqual(item.tags, ['workplace', 'team-culture']);
    }
  });

  console.log('\nthe set\'s CSV is the survey contract\'s, and reads back to the same poll');

  // rejects: the old Options,AllowMultiple writer, which has nowhere to put a
  // scale, a label or a kind — a rating poll written by it imports as a
  // choice with no options, which is the owner's text box again.
  await test('a generated set\'s CSV has a Kind column and round-trips through the survey-kinds reader', async () => {
    reset();
    state.bedrockHandler = () => toolResponse(TYPED);
    const { job } = await runJob({ ...BASE, count: 4 });
    assert.strictEqual(job.items.length, 4);

    const [header, ...rows] = parseCsv(pollsToCsv(job.items));
    assert.strictEqual(header.join(','), `${K.SURVEY_CSV_HEADER},Tags`,
      'the poll CSV must be the survey contract\'s header, column for column');
    assert.strictEqual(rows.length, job.items.length);

    const byTitle = new Map(job.items.map((item) => [item.title, item]));
    const categories = [];
    for (const row of rows) {
      const get = (column) => row[header.indexOf(column)];
      const item = byTitle.get(get('Title'));
      assert.ok(item, `a row came back that no item wrote: ${get('Title')}`);
      const read = K.surveyFieldsFromCells(get);
      assert.deepStrictEqual(K.validatePoll(read), [], `the importer would skip "${item.title}"`);
      assert.deepStrictEqual(K.itemFields(read), K.itemFields(K.pollFieldsOf(item)),
        `"${item.title}" read back as different fields`);
      assert.strictEqual(get('Category'), item.category, 'a poll keeps its own category, never "Survey"');
      categories.push(get('Category'));
    }
    // Grouped in first-seen order, as every builder's CSV is.
    assert.deepStrictEqual(categories, ['Delivery', 'Delivery', 'Process', 'Mood']);
  });

  summary();
})();
