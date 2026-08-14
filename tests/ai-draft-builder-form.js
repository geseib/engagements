/**
 * THE AI HELPER THAT FILLS IN A BUILDER FORM.
 *
 * The owner: *"i do wish there was an AI helper that filled out the forms for
 * the user based on some prelim info they offered. So say they only filled on
 * the description box of what they wanted. the AI could come up with a title,
 * categories, Instructions etc. or if the user filled those in the ai would
 * refine (unless locked, a small icon lock/unlock on cells."*
 *
 * FIVE CLAIMS ARE UNDER TEST and the third is the one that matters most:
 *
 *   1. THE GUARD. This route spends Bedrock budget, so it is admins-only — NOT
 *      on auth/authorizer.js's HOST_ADMIN_ROUTES — and the handler checks again
 *      itself. The context shape is the part that has been got wrong before:
 *      `CognitoAuthorizer` is a CUSTOM Lambda authorizer despite the name, so
 *      groups arrive COMMA-JOINED INTO A STRING at
 *      `event.requestContext.authorizer.lambda.groups`, not at `.jwt.claims`.
 *   2. FILL vs REFINE. A blank field and a written field must reach the model as
 *      DIFFERENT instructions, or "refine" is just "write it again".
 *   3. THE LOCK IS STRUCTURAL. A locked field must be absent from the tool
 *      SCHEMA — never offered to the model at all — and stripped from the
 *      response if it appears anyway. Testing the UI would prove nothing here:
 *      the operator's guarantee has to survive the browser being wrong.
 *   4. NOTHING IS WRITTEN. No set is created, no row is touched but the job's.
 *   5. THE REFUSALS ARE FREE. An empty form and an all-locked form are refused
 *      before a single token is spent.
 */
const path = require('path');
const assert = require('assert');
const harness = require('./helpers/generation-job-harness');

const REPO = path.join(__dirname, '..');
harness.install();                                     // MUST precede the require below

const { handler } = require(path.join(REPO, 'lambda-functions/admin/ai-draft-builder-form.js'));
const { FORMS } = require(path.join(REPO, 'lambda-functions/admin/shared/builder-form-fields.js'));
const fieldDrafting = require(path.join(REPO, 'lambda-functions/admin/shared/field-drafting.js'));
const { PER_ITEM_TOKENS } = require(path.join(REPO, 'lambda-functions/admin/shared/structured-generation.js'));

const { state, reset, toolResponse, test, summary } = harness;

const FUNCTION_NAME = 'engagedev-admin-ai-draft-builder-form';
const ctx = (remainingMs = 900000) => ({
  functionName: FUNCTION_NAME,
  getRemainingTimeInMillis: () => remainingMs,
});

/**
 * THE REAL EVENT SHAPE. A simple-response Lambda authorizer's `context` lands at
 * `requestContext.authorizer.lambda` with `groups` comma-joined into a STRING.
 * Every event in this file is built here so no test can quietly invent a shape
 * the API does not produce.
 */
const authorizer = (groups, extra = {}) => ({
  lambda: {
    userId: 'sub-admin-1', username: 'ada', email: 'ada@example.com',
    groups, status: 'active', role: 'admin', ...extra,
  },
});

const postEvent = (body, groups = 'admins') => ({
  requestContext: { http: { method: 'POST' }, authorizer: authorizer(groups) },
  body: JSON.stringify(body),
});

const getEvent = (jobId, groups = 'admins') => ({
  requestContext: { http: { method: 'GET' }, authorizer: authorizer(groups) },
  pathParameters: { jobId },
});

/** The realistic case the owner described: only the description box filled in. */
const SEEDED = {
  formId: 'scenario',
  current: {
    customTitle: '',
    context: 'Our support team keeps escalating billing disputes to engineering because nobody owns refunds.',
    audience: '',
    mustHaveCategories: '',
    customPrompt: '',
  },
  locked: [],
};

const DRAFT = {
  customTitle: 'Owning The Refund Path',
  context: 'Support escalates billing disputes to engineering because refunds have no owner.',
  audience: 'Support leads and engineering managers',
  mustHaveCategories: 'Escalation, Ownership, Customer Trust',
  customPrompt: 'Write scenarios where the ownership gap is the real problem, not the software.',
};

const drafts = (item = DRAFT) => () => toolResponse([item]);

/** Start a job over HTTP, run the worker the way Lambda's Event invoke would, poll. */
async function runJob(body, opts = {}) {
  const { groups = 'admins', workerCtx = ctx() } = opts;
  const started = await handler(postEvent(body, groups), ctx());
  const { jobId } = JSON.parse(started.body);
  await handler({ __workerMode: true, jobId, payload: body }, workerCtx);
  const polled = await handler(getEvent(jobId, groups), ctx());
  return { started, jobId, job: JSON.parse(polled.body) };
}

/** The tool schema the model was actually offered on the last Bedrock call. */
const lastSchema = () => state.bedrockCalls.at(-1).body.tools[0].input_schema.properties.items.items;
const lastPrompt = () => state.bedrockCalls.at(-1).prompt;

(async function run() {
  // =========================================================================
  console.log('\n1. the guard — this route spends Bedrock budget');

  await test('an admin, in the shape this API actually produces, is admitted', async () => {
    // rejects: reading groups from `.jwt.claims['cognito:groups']`. This API has
    // no JWT authorizer — CognitoAuthorizer is a CUSTOM Lambda authorizer
    // despite the name — so that read finds nothing and the guard fails CLOSED,
    // 403ing every real administrator while its tests pass against a shape the
    // gateway never sends. That has happened in this repo before.
    reset();
    const res = await handler(postEvent(SEEDED), ctx());
    assert.strictEqual(res.statusCode, 202, `an admin was refused with ${res.statusCode}: ${res.body}`);
  });

  await test('an admin carrying several groups, comma-joined, is admitted', async () => {
    // rejects: an equality test on the groups string. The authorizer joins with
    // commas ('hosts,admins'), so `groups === 'admins'` refuses anyone who is
    // also a host — which is most real administrators.
    reset();
    const res = await handler(postEvent(SEEDED, 'hosts,admins'), ctx());
    assert.strictEqual(res.statusCode, 202, `a hosts,admins caller was refused: ${res.body}`);
  });

  await test('a HOST is refused, and nothing is spent', async () => {
    // rejects: adding this route to HOST_ADMIN_ROUTES, or dropping the handler's
    // own requireAdmin, because "the AI builders are a host feature". Reaching
    // this route is a Bedrock spend; a host's question-set permissions say
    // nothing about budget.
    reset();
    const res = await handler(postEvent(SEEDED, 'hosts'), ctx());
    assert.strictEqual(res.statusCode, 403);
    assert.match(JSON.parse(res.body).error, /Administrator access required/);
    assert.strictEqual(state.dispatched.length, 0, 'a refused caller must not start a worker');
    assert.strictEqual(state.bedrockCalls.length, 0, 'a refused caller must not reach Bedrock');
  });

  await test('a `pending` account is refused', async () => {
    // rejects: treating "signed in" as "allowed". A newly registered account has
    // passed authentication and has been approved for nothing.
    reset();
    assert.strictEqual((await handler(postEvent(SEEDED, 'pending'), ctx())).statusCode, 403);
  });

  await test('a caller with no authorizer context at all is refused', async () => {
    // rejects: failing OPEN on a missing or unreadable shape. An empty event must
    // deny, not sail through.
    reset();
    const res = await handler({ requestContext: { http: { method: 'POST' } }, body: JSON.stringify(SEEDED) }, ctx());
    assert.strictEqual(res.statusCode, 403);
    assert.strictEqual(state.dispatched.length, 0);
  });

  await test('the job POLL is guarded too, not just the start', async () => {
    // rejects: guarding the POST and leaving the {jobId} GET open. The job row
    // carries the finished draft, so an unguarded poll hands any signed-in
    // account the paid-for output of somebody else's generation.
    reset();
    state.bedrockHandler = drafts();
    const { jobId } = await runJob(SEEDED);
    assert.strictEqual((await handler(getEvent(jobId, 'hosts'), ctx())).statusCode, 403);
  });

  await test('the CORS preflight is answered without demanding a group', async () => {
    // rejects: putting requireAdmin ahead of the OPTIONS branch. A 403 on the
    // preflight makes the browser report a CORS failure, which looks like a
    // deploy problem rather than an authorization one.
    reset();
    assert.strictEqual((await handler({ requestContext: { http: { method: 'OPTIONS' } } }, ctx())).statusCode, 200);
  });

  // =========================================================================
  console.log('\n2. the refusals that cost nothing');

  await test('an unknown formId is a 400 and starts nothing', async () => {
    // rejects: falling through to the factory with no field spec. The worker
    // would then generate against an empty schema, spend a Bedrock call and
    // report a job that produced nothing — a paid-for way of saying "no".
    reset();
    const res = await handler(postEvent({ ...SEEDED, formId: 'wavelength' }), ctx());
    assert.strictEqual(res.statusCode, 400);
    assert.match(JSON.parse(res.body).error, /formId must be one of/);
    assert.strictEqual(state.dispatched.length, 0);
  });

  await test('a form with nothing typed in it at all is refused, before Bedrock', async () => {
    // rejects: letting the model write the whole form from nothing. It will
    // happily invent a session about a company that does not exist, and the
    // operator has no way to tell an invention from a proposal. The owner's
    // premise is "based on some prelim info they offered" — no info, no offer.
    reset();
    const res = await handler(postEvent({ formId: 'scenario', current: {}, locked: [] }), ctx());
    assert.strictEqual(res.statusCode, 400);
    assert.match(JSON.parse(res.body).error, /Context \/ background/i);
    assert.strictEqual(state.bedrockCalls.length, 0);
    assert.strictEqual(state.dispatched.length, 0);
  });

  await test('whitespace is not content', async () => {
    // rejects: `if (value)` on an untrimmed string. "   " is truthy and would
    // buy a generation from an empty form.
    reset();
    const res = await handler(postEvent({
      formId: 'scenario', current: { context: '   \n  ' }, locked: [],
    }), ctx());
    assert.strictEqual(res.statusCode, 400);
    assert.strictEqual(state.bedrockCalls.length, 0);
  });

  await test('a form with EVERY field locked is refused, before Bedrock', async () => {
    // rejects: generating anyway and discarding the whole result on arrival.
    // That is a Bedrock spend whose entire output is thrown away by design.
    reset();
    const res = await handler(postEvent({
      ...SEEDED, locked: FORMS.scenario.fields.map((f) => f.key),
    }), ctx());
    assert.strictEqual(res.statusCode, 400);
    assert.match(JSON.parse(res.body).error, /Every field is locked/);
    assert.strictEqual(state.bedrockCalls.length, 0);
  });

  await test('a lock on a field this form does not have is ignored, not fatal', async () => {
    // rejects: trusting the caller's key list. An older console sending a key a
    // newer form dropped must not 400, and must not lock a field by accident
    // through a partial string match.
    reset();
    state.bedrockHandler = drafts();
    const { job } = await runJob({ ...SEEDED, locked: ['setId', 'custom'] });
    assert.strictEqual(job.status, 'complete', JSON.stringify(job));
    assert.ok(job.items[0].customTitle, '`custom` must not have locked `customTitle`');
    assert.ok(job.items[0].customPrompt, '`custom` must not have locked `customPrompt`');
  });

  // =========================================================================
  console.log('\n3. THE LOCK — structural, not cosmetic');

  await test('a locked field is absent from the tool schema the model is offered', async () => {
    // rejects: sending the full schema and filtering the answer. A field in the
    // schema is a field the model will fill; filtering afterwards makes the lock
    // depend on a second step remembering to run, and depends on the model not
    // being asked to reason about a field the operator wanted untouched.
    reset();
    state.bedrockHandler = drafts();
    await runJob({ ...SEEDED, current: { ...SEEDED.current, audience: 'New managers' }, locked: ['audience', 'customTitle'] });
    const schema = lastSchema();
    assert.ok(!('audience' in schema.properties), 'the model was offered a locked field');
    assert.ok(!('customTitle' in schema.properties), 'the model was offered a locked field');
    assert.ok(!schema.required.includes('audience'), 'a locked field was REQUIRED of the model');
    assert.ok('context' in schema.properties, 'an unlocked field went missing from the schema');
  });

  await test('a locked field the model returns anyway is stripped from the job', async () => {
    // rejects: relying on the schema alone. Models emit unrequested keys, a job
    // payload can be replayed, and a caller can lie about what it asked for. The
    // operator's guarantee must not depend on any of that.
    reset();
    state.bedrockHandler = drafts({ ...DRAFT, audience: 'Whoever the model felt like' });
    const { job } = await runJob({
      ...SEEDED,
      current: { ...SEEDED.current, audience: 'Support leads only' },
      locked: ['audience'],
    });
    assert.strictEqual(job.status, 'complete', JSON.stringify(job));
    assert.strictEqual(job.items[0].audience, undefined,
      'a locked field reached the client — the lock is decoration');
  });

  await test('the locked field is NAMED to the model, so the rest agrees with it', async () => {
    // rejects: silently omitting a locked field from the prompt. The model then
    // writes a title and categories for a different audience from the one the
    // operator locked, and the form ends up internally inconsistent — which is
    // a subtler failure than overwriting, and harder to spot.
    reset();
    state.bedrockHandler = drafts();
    await runJob({
      ...SEEDED,
      current: { ...SEEDED.current, audience: 'Frontline support only' },
      locked: ['audience'],
    });
    const prompt = lastPrompt();
    assert.match(prompt, /LOCKED/);
    assert.match(prompt, /Frontline support only/);
  });

  await test('a field locked while EMPTY stays empty and is never proposed', async () => {
    // rejects: classifying on content before checking the lock — `if (empty)
    // fill` ahead of `if (locked) skip`. "Do not invent an audience for me" is
    // an ordinary thing to want, and it is the case a content-first branch gets
    // exactly backwards.
    reset();
    state.bedrockHandler = drafts();
    const { job } = await runJob({ ...SEEDED, locked: ['audience'] });
    assert.ok(!('audience' in lastSchema().properties), 'an empty locked field was offered to the model');
    assert.strictEqual(job.items[0].audience, undefined);
  });

  // =========================================================================
  console.log('\n4. FILL vs REFINE — two different instructions');

  await test('an empty field is put under "FIELDS TO WRITE"', async () => {
    // rejects: one undifferentiated "here is the form, improve it" prompt. A
    // blank field and a written field then get the same instruction, and
    // whichever wording that instruction uses is wrong for one of them.
    reset();
    state.bedrockHandler = drafts();
    await runJob(SEEDED);
    const prompt = lastPrompt();
    assert.match(prompt, /FIELDS TO WRITE — these are EMPTY/);
    assert.ok(prompt.indexOf('Target audience') > prompt.indexOf('FIELDS TO WRITE'),
      'an empty field was not listed as one to write');
  });

  await test('a written field is put under "FIELDS TO REFINE", with the operator\'s exact words', async () => {
    // rejects: describing the field without quoting what the operator wrote. A
    // model told "refine the audience" with no audience in front of it can only
    // write a new one — which is the replacement the owner asked us not to do.
    reset();
    state.bedrockHandler = drafts();
    await runJob({
      ...SEEDED,
      current: { ...SEEDED.current, audience: 'Support leads at BillingCo, six months in' },
    });
    const prompt = lastPrompt();
    assert.match(prompt, /FIELDS TO REFINE — the operator ALREADY WROTE these/);
    assert.match(prompt, /What they wrote: Support leads at BillingCo, six months in/);
  });

  await test('the refine instruction forbids swapping their specifics out', async () => {
    // rejects: softening the refine rules to "improve this text". The whole
    // difference between refine and replace is whether the operator's proper
    // nouns, numbers and examples are still there afterwards, and the prompt has
    // to say so in those words.
    reset();
    state.bedrockHandler = drafts();
    await runJob({ ...SEEDED, current: { ...SEEDED.current, audience: 'Support leads' } });
    const prompt = lastPrompt();
    assert.match(prompt, /KEEP their subject, their specifics, their proper nouns/);
    assert.match(prompt, /RETURN IT UNCHANGED/);
  });

  await test('a form with nothing to refine carries no REFINE section at all', async () => {
    // rejects: emitting the "FIELDS TO REFINE" heading unconditionally. A
    // heading with nothing under it invites the model to find something to put
    // there. Reached here by locking the only written field, which is also the
    // combination that proves the two sections are driven by the PLAN and not by
    // "did the operator type anything".
    reset();
    state.bedrockHandler = () => toolResponse([{ audience: 'Space buffs', mustHaveCategories: 'Missions, Hardware', customPrompt: 'Stay factual.' }]);
    await runJob({ formId: 'trivia', current: { topic: 'The Apollo programme' }, locked: ['topic'] });
    const prompt = lastPrompt();
    assert.ok(!/FIELDS TO REFINE/.test(prompt), 'a REFINE section appeared with nothing in it');
    assert.match(prompt, /FIELDS TO WRITE/);
    assert.match(prompt, /LOCKED/);
  });

  await test('what the operator typed is quoted back as the material', async () => {
    // rejects: sending the field list and dropping the values. The description
    // box IS the input — a prompt that lists which fields exist but not what the
    // operator said has nothing to draft from.
    reset();
    state.bedrockHandler = drafts();
    await runJob(SEEDED);
    assert.match(lastPrompt(), /nobody owns refunds/);
  });

  await test('read-only hints reach the prompt and are never proposed', async () => {
    // rejects: turning the category COUNT or the chosen topic card into drafted
    // fields. They are enums and pointers the operator already set on a previous
    // step; a model moving one silently changes what gets generated.
    reset();
    state.bedrockHandler = drafts();
    await runJob({ ...SEEDED, hints: ['The operator asked for 4 categories.'] });
    assert.match(lastPrompt(), /The operator asked for 4 categories\./);
    assert.ok(!('numberOfCategories' in lastSchema().properties));
    assert.ok(!('difficulty' in lastSchema().properties));
    assert.ok(!('count' in lastSchema().properties));
    assert.ok(!('roundKind' in lastSchema().properties));
  });

  // =========================================================================
  console.log('\n5. one call, and nothing written');

  await test('all five fields come from ONE Bedrock call', async () => {
    // rejects: a call per field. Five spends for one screen, producing five
    // fields written without sight of each other — a title that disagrees with
    // the categories underneath it.
    reset();
    state.bedrockHandler = drafts();
    const { job } = await runJob(SEEDED);
    assert.strictEqual(state.bedrockCalls.length, 1, `${state.bedrockCalls.length} calls for one form`);
    assert.strictEqual(job.items.length, 1);
    assert.strictEqual(Object.keys(job.items[0]).length, 5);
  });

  await test('no question set is created', async () => {
    // rejects: copying `setCreation` across from a whole-set generator. This
    // proposes values for a generation that has not been started; minting a set
    // here would create one every time somebody asked for help with a text box.
    reset();
    state.bedrockHandler = drafts();
    const { job } = await runJob(SEEDED);
    assert.ok(!job.createdSet, `a set was created by a form helper: ${JSON.stringify(job.createdSet)}`);
    const setRows = [...state.ddb.keys()].filter((k) => k.startsWith('SETS|'));
    assert.deepStrictEqual(setRows, [], `rows written under SETS: ${setRows}`);
  });

  await test('the only row written is the job itself', async () => {
    // rejects: persisting the draft anywhere. The response is a proposal the
    // operator accepts field by field; a stored draft is a second source of
    // truth nobody asked for and nothing clears.
    reset();
    state.bedrockHandler = drafts();
    const { jobId } = await runJob(SEEDED);
    const keys = [...state.ddb.keys()];
    assert.strictEqual(keys.length, 1, `rows written: ${keys}`);
    assert.ok(keys[0].includes(jobId), `unexpected row ${keys[0]}`);
  });

  await test('a model answer with nothing usable in it lands ZERO items', async () => {
    // rejects: `normalizeItem` returning `{}` for an all-blank answer. The
    // factory counts anything non-null as an item, so `{}` would arrive as a
    // complete job holding one empty object — and `interpretGenerationJob` reads
    // complete-with-items as success, so the console would report a draft that
    // changed nothing. Zero items is what makes it read as 'empty-failure'
    // instead (utils/generationJob.js), which is the truth.
    reset();
    state.bedrockHandler = drafts({ customTitle: '   ', context: '' });
    const { job } = await runJob(SEEDED);
    assert.strictEqual(job.items.length, 0, `an empty draft landed as ${JSON.stringify(job.items)}`);
  });

  await test('a value longer than the field allows is clipped to the ceiling', async () => {
    // rejects: dropping the per-field limits. `customTitle` goes into a set name;
    // a 900-character title is not a title, and the browser would paste it
    // straight into the input.
    reset();
    state.bedrockHandler = drafts({ ...DRAFT, customTitle: 'x'.repeat(500) });
    const { job } = await runJob(SEEDED);
    const limit = FORMS.scenario.fields.find((f) => f.key === 'customTitle').limit;
    assert.ok(job.items[0].customTitle.length <= limit,
      `title came back ${job.items[0].customTitle.length} characters against a limit of ${limit}`);
  });

  await test('a key the form does not have is dropped, not passed through', async () => {
    // rejects: spreading the model's object into the response. A hallucinated
    // `promptId` or `engagementType` would land in the builder's config state and
    // be sent to the generator on the next click.
    reset();
    state.bedrockHandler = drafts({ ...DRAFT, engagementType: 'trivia', promptId: 'made-up' });
    const { job } = await runJob(SEEDED);
    assert.strictEqual(job.items[0].engagementType, undefined);
    assert.strictEqual(job.items[0].promptId, undefined);
  });

  await test('each form drafts its own fields and no others', async () => {
    // rejects: one shared field list across three different builders. The poll
    // form has `category` and no `mustHaveCategories`; drafting the wrong key
    // writes into a field that does not exist and silently does nothing.
    reset();
    state.bedrockHandler = () => toolResponse([{ topic: 'Team rituals', category: 'Ways Of Working', audience: 'The whole team', customPrompt: 'Keep the options blunt.' }]);
    await runJob({ formId: 'poll', current: { topic: 'Team rituals' }, locked: [] });
    const props = Object.keys(lastSchema().properties).sort();
    assert.deepStrictEqual(props, ['audience', 'category', 'customPrompt', 'topic']);
  });

  await test('the token budget is sized for this kind, not left on the default', async () => {
    // rejects: forgetting the PER_ITEM_TOKENS entry. The 420-token default is
    // roughly a third of what five prose fields need, so `customPrompt` — the
    // longest field, and the one that steers the whole generation afterwards —
    // gets truncated, and a truncated draft is a failed one.
    assert.ok(PER_ITEM_TOKENS['builder-form'] >= 1000,
      `builder-form is budgeted at ${PER_ITEM_TOKENS['builder-form']}`);
  });

  // =========================================================================
  console.log('\n6. the shared decision, directly');

  await test('planFields puts lock ahead of content, both ways round', async () => {
    // rejects: `if (has content) refine else fill` written before the lock check.
    // A locked field with content would be refined and a locked empty one filled
    // — the lock working for neither case, which is every case.
    const specs = FORMS.scenario.fields;
    const plan = fieldDrafting.planFields(specs, { context: 'x', audience: 'y' }, ['audience', 'customTitle']);
    assert.deepStrictEqual(plan.locked, ['customTitle', 'audience']);
    assert.deepStrictEqual(plan.refine, ['context']);
    assert.deepStrictEqual(plan.fill, ['mustHaveCategories', 'customPrompt']);
  });

  await test('normalizeLocked keeps only this form\'s keys, deduped, in spec order', async () => {
    // rejects: forwarding the caller's array as it arrives. Found by mutation —
    // dropping the filter left every endpoint test green, because `planFields`
    // matches keys exactly and an unknown entry is inert TODAY. It stops being
    // inert the moment anyone reaches for a prefix or substring match, which is
    // exactly the mistake this repo already made once in `authorizer.js`
    // (`path.startsWith('admin/question-sets')` in place of an exact route
    // match). Asserting the normalised list directly is what keeps the guarantee
    // where it is stated instead of where it is currently harmless.
    const specs = FORMS.scenario.fields;
    assert.deepStrictEqual(
      fieldDrafting.normalizeLocked(['customPrompt', 'nonsense', 'custom', 'context', 'context'], specs),
      ['customPrompt', 'context'],
    );
    assert.deepStrictEqual(fieldDrafting.normalizeLocked(null, specs), []);
    assert.deepStrictEqual(fieldDrafting.normalizeLocked(['  context  '], specs), ['context']);
  });

  await test('enforceLocks rebuilds from the spec rather than deleting from the model', async () => {
    // rejects: `delete item[key]` on the model's own object. Anything the model
    // invented then survives, because deletion only removes what you thought to
    // name.
    const specs = FORMS.trivia.fields;
    const out = fieldDrafting.enforceLocks(
      { topic: 'A', audience: 'B', somethingElse: 'C' }, specs, ['audience'],
    );
    assert.deepStrictEqual(Object.keys(out), ['topic']);
  });

  summary();
}());
