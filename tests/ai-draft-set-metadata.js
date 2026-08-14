/**
 * DRAFTING A QUESTION SET'S OWN FOUR FIELDS.
 *
 * The owner: *"there is no ai button to update fix the question set fields."*
 *
 * `name`, `description`, `customInstruction` and `aiContextInstruction` are what
 * `QuestionsPanel.buildAiContext()` hands to `admin/ai-generate-questions` as
 * `context.title` / `description` / `customInstructions` /
 * `aiContextInstructions`, so a thin description is not cosmetic: it silently
 * degrades every question drafted for the set afterwards. This endpoint repairs
 * the INPUT to the generator.
 *
 * FOUR CLAIMS ARE UNDER TEST and they are not independent:
 *
 *   1. THE GUARD. This route spends Bedrock budget, so it is admins-only — NOT
 *      on auth/authorizer.js's HOST_ADMIN_ROUTES — and the handler checks again
 *      itself. The context shape is the part that has been got wrong before:
 *      `CognitoAuthorizer` is a CUSTOM Lambda authorizer despite the name, so
 *      groups arrive COMMA-JOINED INTO A STRING at
 *      `event.requestContext.authorizer.lambda.groups`, not at `.jwt.claims`.
 *      Eighteen tests once passed against that non-existent shape while the
 *      guard they covered would have 403'd every real admin, so section 1 drives
 *      the REAL shape and section 1b proves the wrong one denies.
 *   2. NOTHING IS WRITTEN. The response is a draft. A full run must leave the
 *      SETS row byte-for-byte as it found it — the human confirms in the console
 *      and `edit-question-set` is still the only writer.
 *   3. THE CALLER'S QUESTIONS ARE THE MATERIAL. The console shows the author the
 *      very list it sends; re-reading the questions here would make that screen
 *      a claim about a DIFFERENT list. So the table's questions must NOT reach
 *      the prompt, and the caller's must.
 *   4. ONE CALL, FOUR FIELDS. Four separate generations would be four Bedrock
 *      spends producing four fields that can contradict each other.
 */
const path = require('path');
const assert = require('assert');
const harness = require('./helpers/generation-job-harness');

const REPO = path.join(__dirname, '..');
harness.install();                                     // MUST precede the require below

const mod = require(path.join(REPO, 'lambda-functions/admin/ai-draft-set-metadata.js'));
const { handler, DRAFT_FIELDS, LIMITS, MAX_QUESTIONS, MAX_DETAIL } = mod;
const { PER_ITEM_TOKENS } = require(path.join(REPO, 'lambda-functions/admin/shared/structured-generation.js'));

const { state, reset, toolResponse, test, summary } = harness;

const FUNCTION_NAME = 'engagedev-admin-ai-draft-set-metadata';
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

const SET_ID = 'lessons-learned';
const SET_ROW = {
  PK: 'SETS', SK: `SET#${SET_ID}`, name: 'Lessons Learned',
  engagementType: 'call-and-answer', description: 'Thin.',
  createdBy: 'sub-someone-else', createdByName: 'bob',
  totalQuestions: 4, active: true,
};

/** Seed the SETS row the handler reads for existence and ownership. */
function seedSet(overrides = {}) {
  const row = { ...SET_ROW, ...overrides };
  state.ddb.set(`SETS|${row.SK}`, row);
  return row;
}

const CALLER_QUESTIONS = [
  { title: 'WHAT WENT WRONG', category: 'Retro', detail: 'Pick one incident.', customInstructions: 'From your own experience.' },
  { title: 'ARE WE SHIPPING', category: 'Delivery', detail: 'Weekly, or when it is ready?' },
];

const BASE = {
  setId: SET_ID,
  engagementType: 'call-and-answer',
  current: { name: 'Lessons Learned', description: '', customInstruction: '', aiContextInstruction: '' },
  questions: CALLER_QUESTIONS,
  totalQuestions: 4,
  categories: ['Retro', 'Delivery'],
};

const DRAFT = {
  name: 'Delivery Retrospectives',
  description: 'What a delivery team learns the hard way, for teams running their first retro.',
  customInstruction: 'Answer from something you actually lived through, not from theory.',
  aiContextInstruction: 'Software delivery retrospectives for mixed engineering and product teams. Use delivery vocabulary. Never name individuals.',
};

/** Start a job over HTTP, run the worker the way Lambda's Event invoke would, poll. */
async function runJob(body, opts = {}) {
  const { groups = 'admins', workerCtx = ctx() } = opts;
  const started = await handler(postEvent(body, groups), ctx());
  const { jobId } = JSON.parse(started.body);
  await handler({ __workerMode: true, jobId, payload: body }, workerCtx);
  const polled = await handler(getEvent(jobId, groups), ctx());
  return { started, jobId, job: JSON.parse(polled.body) };
}

const drafts = (item = DRAFT) => () => toolResponse([item]);

(async function run() {
  // =========================================================================
  console.log('\n1. the guard — this route spends Bedrock budget');

  await test('an admin, in the shape this API actually produces, is admitted', async () => {
    // rejects: reading groups from `.jwt.claims['cognito:groups']`. This API has
    // no JWT authorizer — CognitoAuthorizer is a CUSTOM Lambda authorizer
    // despite the name — so that read finds nothing and the guard fails CLOSED,
    // 403ing every real administrator while its tests pass against a shape the
    // gateway never sends. That has happened here before.
    reset(); seedSet();
    const res = await handler(postEvent(BASE), ctx());
    assert.strictEqual(res.statusCode, 202, `an admin was refused with ${res.statusCode}: ${res.body}`);
  });

  await test('an admin carrying several groups, comma-joined, is admitted', async () => {
    // rejects: an equality test on the groups string. The authorizer joins with
    // commas ('hosts,admins'), so `groups === 'admins'` refuses anyone who is
    // also a host — which is most real administrators.
    reset(); seedSet();
    const res = await handler(postEvent(BASE, 'hosts,admins'), ctx());
    assert.strictEqual(res.statusCode, 202, `a hosts,admins caller was refused: ${res.body}`);
  });

  await test('a HOST is refused, and nothing is spent', async () => {
    // rejects: adding this route to HOST_ADMIN_ROUTES, or dropping the handler's
    // own requireAdmin. A host may manage question sets they created; that says
    // nothing about whether they may spend Bedrock budget. The AI routes are
    // excluded from the host list for exactly that reason (authorizer.js).
    reset(); seedSet();
    const res = await handler(postEvent(BASE, 'hosts'), ctx());
    assert.strictEqual(res.statusCode, 403);
    assert.match(JSON.parse(res.body).error, /Administrator access required/);
    assert.strictEqual(state.dispatched.length, 0, 'a refused caller must not start a worker');
    assert.strictEqual(state.bedrockCalls.length, 0, 'a refused caller must not reach Bedrock');
  });

  await test('a `pending` account is refused', async () => {
    // rejects: treating "signed in" as "allowed". A newly registered account has
    // passed authentication and has been approved for nothing.
    reset(); seedSet();
    const res = await handler(postEvent(BASE, 'pending'), ctx());
    assert.strictEqual(res.statusCode, 403);
  });

  await test('a caller with no authorizer context at all is refused', async () => {
    // rejects: failing OPEN on a missing or unreadable shape. An empty event must
    // deny, not sail through.
    reset(); seedSet();
    const res = await handler({ requestContext: { http: { method: 'POST' } }, body: JSON.stringify(BASE) }, ctx());
    assert.strictEqual(res.statusCode, 403);
    assert.strictEqual(state.dispatched.length, 0);
  });

  await test('the job POLL is guarded too, not just the start', async () => {
    // rejects: guarding the POST and leaving the {jobId} GET open. The job row
    // carries the finished draft, so an unguarded poll hands any signed-in
    // account the paid-for output of somebody else's generation.
    reset(); seedSet();
    state.bedrockHandler = drafts();
    const { jobId } = await runJob(BASE);
    const res = await handler(getEvent(jobId, 'hosts'), ctx());
    assert.strictEqual(res.statusCode, 403, 'a host could read the drafted metadata');
  });

  await test('the CORS preflight is answered without demanding a group', async () => {
    // rejects: putting requireAdmin ahead of the OPTIONS branch. A 403 on the
    // preflight makes the browser report a CORS failure, which looks like a
    // deploy problem rather than an authorization one.
    reset();
    const res = await handler({ requestContext: { http: { method: 'OPTIONS' } } }, ctx());
    assert.strictEqual(res.statusCode, 200);
  });

  console.log('\n1b. the row, and the request');

  await test('a set that does not exist is a 404, and starts nothing', async () => {
    // rejects: taking the caller's word for the setId. Without the read there is
    // no 404 at all: the job runs, Bedrock is paid, and the console shows a
    // confident draft for a set that is not there.
    reset();
    const res = await handler(postEvent({ ...BASE, setId: 'no-such-set' }), ctx());
    assert.strictEqual(res.statusCode, 404);
    assert.strictEqual(state.dispatched.length, 0, 'a 404 must not spend a generation');
  });

  await test('a missing setId is a 400, and starts nothing', async () => {
    // rejects: defaulting the setId to '' and reading SET# — which is a row that
    // does not exist, so the 404 above would fire with a confusing message.
    reset(); seedSet();
    const res = await handler(postEvent({ ...BASE, setId: '' }), ctx());
    assert.strictEqual(res.statusCode, 400);
    assert.match(JSON.parse(res.body).error, /setId is required/);
    assert.strictEqual(state.dispatched.length, 0);
  });

  await test('an admin may draft for a set somebody else created', async () => {
    // rejects: reusing the host ownership rule verbatim. `requireSetManager` is
    // here so that opening this route to hosts stays a one-line edit rather than
    // a security review — it must never refuse an admin, who may manage every
    // set by rule. SET_ROW is deliberately owned by someone else.
    reset(); seedSet({ createdBy: 'sub-not-ada' });
    const res = await handler(postEvent(BASE), ctx());
    assert.strictEqual(res.statusCode, 202);
  });

  console.log('\n2. the HTTP request does not generate');

  await test('POST returns 202 with a jobId instead of a draft', async () => {
    // rejects: generating inside the request. API Gateway's 30s integration
    // timeout is a hard ceiling; a cold start plus one throttle retry plus the
    // Haiku fallback is three generations and two sleeps on an 8-second happy
    // path, and the failure is a non-JSON 503 the client cannot read.
    reset(); seedSet();
    const res = await handler(postEvent(BASE), ctx());
    assert.strictEqual(res.statusCode, 202);
    const body = JSON.parse(res.body);
    assert.ok(body.jobId, 'no jobId returned');
    assert.strictEqual(body.requested, 1, 'there is exactly one metadata object to draft');
  });

  await test('the HTTP request performs ZERO Bedrock calls', async () => {
    // rejects: any synchronous generation path surviving on this route.
    reset(); seedSet();
    await handler(postEvent(BASE), ctx());
    assert.strictEqual(state.bedrockCalls.length, 0,
      `the request path called Bedrock ${state.bedrockCalls.length} times`);
  });

  await test('the worker is dispatched as an async Event invoke', async () => {
    // rejects: InvocationType 'RequestResponse', which puts the 900s worker back
    // inside the 30s request and undoes the whole design.
    reset(); seedSet();
    await handler(postEvent(BASE), ctx());
    assert.strictEqual(state.dispatched.length, 1);
    assert.strictEqual(state.dispatched[0].InvocationType, 'Event');
    assert.strictEqual(state.dispatched[0].payload.__workerMode, true);
  });

  console.log('\n3. NOTHING IS WRITTEN — the response is a draft');

  await test('a full run leaves the SETS row exactly as it found it', async () => {
    // rejects: THE ONE THAT MATTERS. An endpoint that "fixes" the fields by
    // writing them. The rule is the same as the question drafter's: the model
    // proposes, a human confirms in the console, and edit-question-set.js is
    // still the only writer. Saving directly would overwrite an author's own
    // description with a machine's paraphrase and offer no way back.
    reset();
    const before = JSON.parse(JSON.stringify(seedSet()));
    state.bedrockHandler = drafts();
    const { job } = await runJob(BASE);
    assert.strictEqual(job.status, 'complete');
    assert.deepStrictEqual(state.ddb.get(`SETS|SET#${SET_ID}`), before,
      'the handler wrote the draft to the set instead of returning it');
  });

  await test('the drafted values come back on the job, not in the table', async () => {
    // rejects: returning a bare 200 and expecting the console to re-read the set.
    reset(); seedSet();
    state.bedrockHandler = drafts();
    const { job } = await runJob(BASE);
    assert.strictEqual(job.items.length, 1);
    assert.strictEqual(job.items[0].description, DRAFT.description);
  });

  console.log('\n4. one call, four fields');

  await test('all four fields arrive from ONE generation', async () => {
    // rejects: a field-at-a-time loop. Four calls are four Bedrock spends for one
    // screen, and — worse — a description written without knowing the
    // participant instruction contradicts it. A set whose metadata disagrees with
    // itself is precisely the degraded generator input this endpoint exists to
    // repair.
    reset(); seedSet();
    state.bedrockHandler = drafts();
    const { job } = await runJob(BASE);
    assert.strictEqual(state.bedrockCalls.length, 1, `expected one Bedrock call, got ${state.bedrockCalls.length}`);
    for (const field of DRAFT_FIELDS) {
      assert.strictEqual(job.items[0][field], DRAFT[field], `${field} missing from the single draft`);
    }
  });

  await test('the tool schema asks for exactly the four fields and no enums', async () => {
    // rejects: adding engagementType, promptId, personaId or roundKind "while we
    // are here". Those are enums and pointers whose wrong value silently changes
    // which phases a session runs and which prompt resolves — a different feature
    // with a different failure mode. These four are prose about the set's content.
    reset(); seedSet();
    state.bedrockHandler = drafts();
    await runJob(BASE);
    const tool = state.bedrockCalls[0].body.tools[0];
    const props = tool.input_schema.properties.items.items.properties;
    assert.deepStrictEqual(Object.keys(props).sort(), [...DRAFT_FIELDS].sort());
    assert.deepStrictEqual([...tool.input_schema.properties.items.items.required].sort(),
      [...DRAFT_FIELDS].sort());
    assert.ok(!props.engagementType && !props.promptId && !props.personaId && !props.roundKind);
  });

  await test('set-metadata gets a bigger per-item budget than a question', async () => {
    // rejects: leaving this kind on PER_ITEM_TOKENS.default. Four prose fields
    // against a question's one, and the longest of the four — the AI context that
    // conditions every later generation — would be the one that runs out of room.
    // A truncated draft is a failed one.
    assert.ok(PER_ITEM_TOKENS['set-metadata'] > PER_ITEM_TOKENS.question,
      'four prose fields cannot share a single question\'s token budget');
    reset(); seedSet();
    state.bedrockHandler = drafts();
    await runJob(BASE);
    const asked = state.bedrockCalls[0].body.max_tokens;
    const chars = DRAFT_FIELDS.reduce((n, f) => n + LIMITS[f], 0);
    assert.ok(asked > chars / 4,
      `max_tokens ${asked} cannot hold ${chars} characters of output`);
  });

  console.log('\n5. the material — the CALLER\'s questions, never the table\'s');

  await test('the questions the caller sent reach the prompt', async () => {
    // rejects: accepting `questions` and dropping them on the floor. The console
    // renders that exact array under "Drafted from these questions"; a handler
    // that ignores it makes the screen a lie, which is worse than no screen.
    reset(); seedSet();
    state.bedrockHandler = drafts();
    await runJob(BASE);
    const { prompt } = state.bedrockCalls[0];
    assert.match(prompt, /THE QUESTIONS THEMSELVES/);
    assert.match(prompt, /WHAT WENT WRONG/);
    assert.match(prompt, /Pick one incident\./);
    assert.match(prompt, /ARE WE SHIPPING/);
    assert.match(prompt, /\[Retro\]/, 'the category is part of what the model is matching');
  });

  await test('the TABLE\'s questions do not reach the prompt', async () => {
    // rejects: re-reading the set's questions here "to be safe". That would make
    // the console's list a claim about a DIFFERENT list — the one on screen comes
    // from the working copy the author is looking at, and the two can legitimately
    // differ. One of them has to be authoritative and it is the caller's.
    reset(); seedSet();
    state.ddb.set(`SET#${SET_ID}|QUESTION#c001#001`,
      { PK: `SET#${SET_ID}`, SK: 'QUESTION#c001#001', Title: 'A QUESTION ONLY THE TABLE KNOWS' });
    state.bedrockHandler = drafts();
    await runJob(BASE);
    assert.ok(!/ONLY THE TABLE KNOWS/.test(state.bedrockCalls[0].prompt),
      'the handler re-read the questions instead of using the ones it was shown');
  });

  await test('a set with no questions says so instead of inventing content', async () => {
    // rejects: emitting an empty "THE QUESTIONS THEMSELVES:" header. A heading
    // with nothing under it is an instruction to summarise nothing, and the model
    // fills the silence.
    reset(); seedSet();
    state.bedrockHandler = drafts();
    await runJob({ ...BASE, questions: [], totalQuestions: 0 });
    const { prompt } = state.bedrockCalls[0];
    assert.match(prompt, /THIS SET HAS NO QUESTIONS YET/);
    assert.match(prompt, /do not invent content the set does not contain/);
    assert.ok(!/THE QUESTIONS THEMSELVES/.test(prompt));
  });

  await test('a sample is declared as a sample', async () => {
    // rejects: showing sixty of four hundred questions and letting the model
    // describe the sample as if it were the set.
    reset(); seedSet();
    state.bedrockHandler = drafts();
    await runJob({ ...BASE, totalQuestions: 400 });
    assert.match(state.bedrockCalls[0].prompt, /2 of 400 questions shown/);
  });

  await test('a null totalQuestions does not become "a set of 0 questions"', async () => {
    // rejects: `Number.isFinite(Number(x))` as the guard. Number(null) is 0 and
    // finite, so a caller sending totalQuestions:null alongside two questions
    // would have told the model the set holds none — in the line directly above
    // the list of them.
    reset(); seedSet();
    state.bedrockHandler = drafts();
    await runJob({ ...BASE, totalQuestions: null });
    assert.match(state.bedrockCalls[0].prompt, /set of 2 questions/);
  });

  await test('the question list is capped, and the cap is the one the console mirrors', async () => {
    // rejects: sending a 400-question set whole — ~25k tokens of input in front
    // of a 1500-token answer. The cap has to be the number QuestionSetEditor
    // applies too, or the screen shows a list longer than the one that was sent.
    reset(); seedSet();
    state.bedrockHandler = drafts();
    const many = Array.from({ length: MAX_QUESTIONS + 20 }, (_, i) => ({
      title: `QUESTION NUMBER ${i}`, category: 'Bulk', detail: 'd',
    }));
    await runJob({ ...BASE, questions: many, totalQuestions: many.length });
    const { prompt } = state.bedrockCalls[0];
    assert.match(prompt, new RegExp(`QUESTION NUMBER ${MAX_QUESTIONS - 1}\\b`));
    assert.ok(!new RegExp(`QUESTION NUMBER ${MAX_QUESTIONS}\\b`).test(prompt),
      `more than ${MAX_QUESTIONS} questions reached the prompt`);
  });

  await test('an over-long question detail is clipped to the console\'s ceiling', async () => {
    // rejects: letting one 5,000-character question detail dominate the input.
    // The console clips at the same number before it renders, so the server's
    // clip must be a no-op on what a real client sends — if the two ever differ,
    // the screen is showing text that was not transmitted.
    reset(); seedSet();
    state.bedrockHandler = drafts();
    await runJob({ ...BASE, questions: [{ title: 'LONG', category: 'X', detail: 'z'.repeat(MAX_DETAIL + 500) }] });
    const { prompt } = state.bedrockCalls[0];
    assert.ok(!/z{241}/.test(prompt), `a detail longer than ${MAX_DETAIL} characters was sent whole`);
    assert.match(prompt, /z{200}/, 'the detail was dropped rather than clipped');
  });

  console.log('\n6. the author\'s own words');

  await test('what the author has already written reaches the prompt', async () => {
    // rejects: drafting from the questions alone. A description the author spent
    // an afternoon on is the strongest signal about what the set is FOR, and a
    // model that never sees it will contradict them by accident.
    reset(); seedSet();
    state.bedrockHandler = drafts();
    await runJob({
      ...BASE,
      current: {
        name: 'Lessons Learned',
        description: 'Deliberately about delivery, never about sport.',
        customInstruction: 'Answer from your own experience.',
        aiContextInstruction: '',
      },
    });
    const { prompt } = state.bedrockCalls[0];
    assert.match(prompt, /WHAT THE AUTHOR HAS WRITTEN SO FAR/);
    assert.match(prompt, /Deliberately about delivery, never about sport\./);
    assert.match(prompt, /Answer from your own experience\./);
    assert.match(prompt, /AI context instruction: \(blank\)/,
      'a blank field must be declared blank, not omitted — omission reads as "there is no such field"');
  });

  await test('the prompt tells the model to improve the author\'s wording, not replace it', async () => {
    // rejects: a prompt that asks for a rewrite from scratch. The console holds
    // back any field the author already wrote and asks before replacing it, but
    // a draft that ignores their terminology makes that choice pointless — the
    // author is offered a stranger's paragraph and can only take it or leave it.
    reset(); seedSet();
    state.bedrockHandler = drafts();
    await runJob(BASE);
    const { prompt } = state.bedrockCalls[0];
    assert.match(prompt, /keep their intent, their terminology and their voice/);
    assert.match(prompt, /Do not contradict them/);
  });

  await test('the author\'s optional brief steers the summary', async () => {
    // rejects: dropping `brief`. "Say it is for new managers" is the one piece of
    // intent the questions themselves cannot carry.
    reset(); seedSet();
    state.bedrockHandler = drafts();
    await runJob({ ...BASE, brief: 'say plainly that it is for first-time managers' });
    assert.match(state.bedrockCalls[0].prompt, /WHAT THE AUTHOR ASKED FOR: say plainly that it is for first-time managers/);
  });

  await test('the set\'s categories reach the prompt', async () => {
    reset(); seedSet();
    state.bedrockHandler = drafts();
    await runJob(BASE);
    assert.match(state.bedrockCalls[0].prompt, /categories: Retro, Delivery/);
  });

  console.log('\n7. what comes back');

  await test('each field is clipped to its own limit', async () => {
    // rejects: one shared ceiling. A title and an AI context instruction have
    // nothing in common: 700 characters of title is unusable, and 80 characters
    // of AI context is the vague conditioning this feature exists to fix.
    reset(); seedSet();
    state.bedrockHandler = drafts(Object.fromEntries(DRAFT_FIELDS.map((f) => [f, 'w'.repeat(2000)])));
    const { job } = await runJob(BASE);
    for (const field of DRAFT_FIELDS) {
      assert.strictEqual(job.items[0][field].length, LIMITS[field],
        `${field} was not clipped to ${LIMITS[field]}`);
    }
  });

  await test('a draft with a blank name is still a draft of the other three', async () => {
    // rejects: the generic worker's "no title, drop the item" rule applying here.
    // There is only ever ONE item, and a blank `name` is a field the console will
    // simply not offer — throwing the whole draft away for it discards a good
    // description, instruction and AI context with it.
    reset(); seedSet();
    state.bedrockHandler = drafts({ ...DRAFT, name: '' });
    const { job } = await runJob(BASE);
    assert.strictEqual(job.status, 'complete');
    assert.strictEqual(job.items.length, 1, 'the draft was dropped for want of a title');
    assert.strictEqual(job.items[0].name, '');
    assert.strictEqual(job.items[0].aiContextInstruction, DRAFT.aiContextInstruction);
  });

  await test('a draft with nothing usable in it is not reported as a success', async () => {
    // rejects: handing the console four empty strings and letting it draw a
    // "Drafted." banner over them. `interpretGenerationJob` reads complete-with-
    // zero-items as an empty-failure, which is what the operator needs to see.
    reset(); seedSet();
    state.bedrockHandler = drafts({ name: '  ', description: '', customInstruction: '', aiContextInstruction: '' });
    const { job } = await runJob(BASE);
    assert.strictEqual(job.items.length, 0);
  });

  await test('a Bedrock failure fails the job with a readable error', async () => {
    // rejects: swallowing the failure into an empty success.
    reset(); seedSet();
    state.bedrockHandler = () => { throw new Error('Bedrock is having a day'); };
    const { job } = await runJob(BASE);
    assert.strictEqual(job.status, 'error');
    assert.match(job.error, /Bedrock is having a day/);
    assert.deepStrictEqual(state.ddb.get(`SETS|SET#${SET_ID}`).description, SET_ROW.description,
      'a failed draft must not have half-written the set either');
  });

  await test('a failed self-invoke marks the job instead of stranding the client', async () => {
    // rejects: returning a jobId for a worker that was never dispatched — the
    // client would poll a job that can never move.
    reset(); seedSet();
    state.lambdaShouldFail = true;
    const res = await handler(postEvent(BASE), ctx());
    assert.strictEqual(res.statusCode, 500);
    const { jobId } = JSON.parse(res.body);
    const job = JSON.parse((await handler(getEvent(jobId), ctx())).body);
    assert.strictEqual(job.status, 'error');
    assert.match(job.error, /Could not start generation worker/);
  });

  summary();
})();
