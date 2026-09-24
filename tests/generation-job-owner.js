/**
 * A GENERATION JOB IS ITS STARTER'S, AND AN ORGANISATION'S IS SEALED.
 *
 * ── THE POLL ANSWERED ANY JOB ID ───────────────────────────────────────────
 *
 * Every AI builder polls `GET admin/ai-<builder>/{jobId}`, and
 * auth/authorizer.js opens those seven polls to HOSTS as well as admins
 * (AI_JOB_POLL) so a host can collect what they started. The handlers then
 * handed back whatever job the id named: shared/generation-handler.js's poll
 * and ai-generate-scenarios.js's inline copy went straight from `getJob` to
 * `jobToResponse`, with no question of who was asking. A job id is kept in
 * localStorage (rememberGenerationJob) and sits in every network panel; it was
 * a bearer token for another organisation's generated content.
 *
 * The rule is the advisor's (ai-prompt-advisor.js, 10486738): a job is read
 * only by the user who started it, acting for the same organisation, through
 * the builder that started it. Anything else is a bare 404 that carries
 * nothing of the job — "not found", never "not yours".
 *
 * ── AND AT REST ────────────────────────────────────────────────────────────
 *
 * `ENCRYPTED_FIELDS.job` has always named `request`, `items` and `meta`, and
 * nothing sealed them: an org's generated questions sat in plaintext on the
 * PK=AIJOBS row for its three-day TTL, beside an encrypted copy of the same
 * set. They are sealed under the caller's organisation on every write — the
 * row's birth, each progress update, completion and failure — and opened on
 * the owner's poll. Engage's own library (no organisation) is plaintext by
 * decision, as every platform row is.
 *
 * rejects: a poll that answers another user's job id; one that answers the
 * right user standing in another organisation, or in none; a 404 that carries
 * anything of the job; a job of another kind read through a builder's poll; a
 * POST that starts a job nobody could ever read; request, items or meta
 * readable at rest for an org job — at birth, in flight, on completion, on
 * failure; sealing under the wrong organisation; the owner reading envelopes
 * back; sealing Engage's own jobs.
 */
const suiteFinished = require('./helpers/finish-guard');
const path = require('path');
const assert = require('assert');
const nodeCrypto = require('crypto');
const Module = require('module');

const REPO = path.join(__dirname, '..');
const kmsStub = require('./helpers/tenant-crypto-stub');

// ---- stubs, registered before anything under test is required --------------
const stubs = new Map();
const realLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (stubs.has(request)) return stubs.get(request);
  return realLoad.call(this, request, parent, isMain);
};
const stub = (name, exports) => stubs.set(name, exports);

// DynamoDB: an in-memory table. Rows are deep-copied in and out, so a handler
// can never see a later write through an object it already holds.
const store = new Map();
const rowKey = (pk, sk) => `${pk}|${sk}`;
const clone = (v) => (v === undefined ? v : JSON.parse(JSON.stringify(v)));
class GetCommand { constructor(i) { this.input = i; this.type = 'get'; } }
class PutCommand { constructor(i) { this.input = i; this.type = 'put'; } }
class UpdateCommand { constructor(i) { this.input = i; this.type = 'update'; } }
class QueryCommand { constructor(i) { this.input = i; this.type = 'query'; } }

function applySet(item, input) {
  const expr = String(input.UpdateExpression).replace(/^SET\s+/i, '');
  const names = input.ExpressionAttributeNames || {};
  for (const part of expr.split(/,\s*/)) {
    const [lhs, rhs] = part.split(/\s*=\s*/);
    item[names[lhs] || lhs] = input.ExpressionAttributeValues[rhs];
  }
}

const fakeDoc = {
  send: async (cmd) => {
    const inp = cmd.input || {};
    switch (cmd.type) {
      case 'get': return { Item: clone(store.get(rowKey(inp.Key.PK, inp.Key.SK))) };
      case 'put': store.set(rowKey(inp.Item.PK, inp.Item.SK), clone(inp.Item)); return {};
      case 'update': {
        if (inp.ConditionExpression) throw new Error(`stub cannot evaluate ${inp.ConditionExpression}`);
        const k = rowKey(inp.Key.PK, inp.Key.SK);
        const item = store.get(k) || { ...inp.Key };
        applySet(item, inp);
        store.set(k, clone(item));
        return {};
      }
      case 'query': return { Items: [], Count: 0 };
      default: throw new Error(`unexpected DynamoDB command ${cmd.type}`);
    }
  },
};
stub('@aws-sdk/client-dynamodb', { DynamoDBClient: class {} });
stub('@aws-sdk/lib-dynamodb', {
  DynamoDBDocumentClient: { from: () => fakeDoc },
  GetCommand, PutCommand, UpdateCommand, QueryCommand,
});

// Lambda: record the self-invoke.
let dispatched = [];
class InvokeCommand { constructor(i) { this.input = i; } }
stub('@aws-sdk/client-lambda', {
  LambdaClient: class {
    async send(cmd) {
      dispatched.push(JSON.parse(Buffer.from(cmd.input.Payload).toString('utf8')));
      return { StatusCode: 202 };
    }
  },
  InvokeCommand,
});

// Bedrock: each case installs a handler; every call is counted.
let bedrockCalls = 0;
let bedrockHandler = () => { throw new Error('no bedrock handler installed'); };
class InvokeModelCommand { constructor(i) { this.input = i; } }
stub('@aws-sdk/client-bedrock-runtime', {
  BedrockRuntimeClient: class {
    async send(cmd) {
      bedrockCalls += 1;
      return bedrockHandler(bedrockCalls, JSON.parse(cmd.input.body));
    }
  },
  InvokeModelCommand,
});

// KMS: the policy-enforcing stub every sealed-content suite uses.
stub('@aws-sdk/client-kms', kmsStub.makeKmsStub().exports);

process.env.TABLE_NAME = 'test-table';
process.env.ACCOUNT_ID = '123456789012';
process.env.AWS_REGION = 'us-east-1';
process.env.TENANT_KMS_KEY_ID = 'alias/engage-tenant';

kmsStub.installTestKeyLoader();
const admin = (name) => require(path.join(REPO, 'lambda-functions/admin', name));
const { makeGenerationHandler } = admin('shared/generation-handler.js');
const { itemsPerCall } = admin('shared/structured-generation.js');

/** Every poll auth/authorizer.js opens to hosts (AI_JOB_POLL), and the job kind each one writes. */
const ROUTES = [
  { route: 'ai-generate-questions', kind: 'question' },
  { route: 'ai-generate-polls', kind: 'poll' },
  { route: 'ai-generate-trivia', kind: 'trivia' },
  { route: 'ai-generate-survey', kind: 'survey' },
  { route: 'ai-generate-scenarios', kind: 'scenarios' },
  { route: 'ai-draft-builder-form', kind: 'builder-form' },
  { route: 'ai-draft-set-metadata', kind: 'set-metadata' },
].map((r) => ({ ...r, handler: admin(`${r.route}.js`).handler }));
const byRoute = (route) => ROUTES.find((r) => r.route === route).handler;
const questions = byRoute('ai-generate-questions');
const scenarios = byRoute('ai-generate-scenarios');

/**
 * The factory itself, with the one feature no real handler exposes cheaply:
 * set-level `meta` (the survey builder's improved title) without the set
 * creation that comes with it there.
 */
const probe = makeGenerationHandler({
  kind: 'probe',
  tokenKind: 'question',
  parseRequest: (p) => ({ total: Number(p.count) || 1, config: p }),
  buildTool: () => ({ name: 'emit_items', description: 'emit', input_schema: { type: 'object', properties: {} } }),
  buildPrompt: ({ count }) => `Write ${count}.`,
  normalizeItem: (raw) => (raw && raw.title ? { title: raw.title, detail: raw.detail || '' } : null),
  extractMeta: (result) => (result.surveyTitle ? { title: result.surveyTitle } : null),
});

// ---- harness ---------------------------------------------------------------
const say = (...a) => process.stdout.write(a.join(' ') + '\n');
let pass = 0, fail = 0;
async function check(label, fn) {
  try { await fn(); say(`  PASS  ${label}`); pass++; }
  catch (e) { say(`  FAIL  ${label}\n        ${e.message}`); fail++; }
}
/** The handlers log job ids and phases; the verdicts are what matter here. */
async function quietly(fn) {
  const orig = {};
  for (const level of ['log', 'info', 'warn', 'error']) { orig[level] = console[level]; console[level] = () => {}; }
  try { return await fn(); } finally { Object.assign(console, orig); }
}

const marker = (tag) => `zq${tag}${nodeCrypto.randomBytes(4).toString('hex')}`;
const isEnvelope = (v) => !!v && typeof v === 'object' && !Array.isArray(v)
  && typeof v.v === 'number' && typeof v.iv === 'string'
  && typeof v.tag === 'string' && typeof v.ct === 'string';
const hasEnvelope = (v) => isEnvelope(v)
  || (!!v && typeof v === 'object' && Object.values(v).some(hasEnvelope));

const ORG = 'org_9xK4Fq7Pz2mNbVc8dQwLxR';
const OTHER_ORG = 'org_2222222222222222222222';

/** This API's real authorizer shape (require-admin.js's header). */
const who = ({ userId = 'sub-ada', groups = 'admins', orgId = '', orgRole = '' } = {}) => ({
  authorizer: { lambda: {
    userId, username: `${userId}-name`, groups, status: 'enabled',
    ...(orgId ? { orgId, orgRole, orgIds: orgId } : {}),
  } },
});
const STAFF = who();                                                   // Engage, acting as Engage
const ORG_OWNER = who({ orgId: ORG, orgRole: 'owner' });
const ORG_HOST = who({ userId: 'sub-hal', groups: 'hosts', orgId: ORG, orgRole: 'member' });
const ANON = { authorizer: { lambda: {} } };

const postEvent = (body, caller) => ({
  requestContext: { http: { method: 'POST' }, ...caller },
  body: JSON.stringify(body),
});
const pollEvent = (jobId, caller) => ({
  requestContext: { http: { method: 'GET' }, ...caller },
  pathParameters: { jobId },
});
const ctx = (fn = 'generation') => ({ functionName: `engagedev-admin-${fn}`, getRemainingTimeInMillis: () => 900000 });

const toolResponse = (items, extra = {}) => ({
  body: new TextEncoder().encode(JSON.stringify({
    stop_reason: 'tool_use',
    content: [{ type: 'tool_use', name: 'emit_items', input: { items, ...extra } }],
  })),
});
/** Distinct titles: the worker drops near-duplicates, which would starve a pass. */
const WORDS = ['alpha', 'bravo', 'charlie', 'delta', 'echo', 'foxtrot', 'golf', 'hotel', 'india', 'juliet',
  'kilo', 'lima', 'mike', 'november', 'oscar', 'papa', 'quebec', 'romeo', 'sierra', 'tango'];
const itemsFor = (n, tag) => Array.from({ length: n }, (_, i) => ({
  title: `${tag} ${WORDS[i % WORDS.length]}`,
  category: 'Category 1',
  detail: `${tag} detail ${i + 1}`,
  customInstructions: 'Discuss.',
  tags: ['Leadership', 'teams'],
}));

function reset() {
  store.clear();
  dispatched = [];
  bedrockCalls = 0;
  bedrockHandler = () => { throw new Error('no bedrock handler installed'); };
  kmsStub.forgetAllOrgs();
}

const body = (res) => JSON.parse(res.body);
const jobRow = (jobId) => store.get(rowKey('AIJOBS', `AIJOB#${jobId}`));

/** Start a job over HTTP as `caller`, run the worker as Lambda's Event invoke would, then poll as `caller`. */
async function runJob(handler, request, caller, fn) {
  return quietly(async () => {
    const started = await handler(postEvent(request, caller), ctx(fn));
    assert.strictEqual(started.statusCode, 202, `the POST answered ${started.statusCode}: ${started.body}`);
    const { jobId } = body(started);
    const atBirth = clone(jobRow(jobId));
    await handler(dispatched[dispatched.length - 1], ctx(fn));
    const polled = await handler(pollEvent(jobId, caller), ctx(fn));
    return { jobId, atBirth, polled, job: body(polled) };
  });
}

/** A finished job row as the worker leaves it, written straight into the table. */
function seedJob({ kind, userId = 'sub-ada', orgId = '', tag }) {
  const jobId = `seed${nodeCrypto.randomBytes(5).toString('hex')}`;
  const now = new Date().toISOString();
  store.set(rowKey('AIJOBS', `AIJOB#${jobId}`), {
    PK: 'AIJOBS', SK: `AIJOB#${jobId}`, jobId, kind,
    status: 'complete', phase: 'Generated 1 of 1', requested: 1, completed: 1,
    request: { kind, count: 1, note: tag },
    items: [{ title: `${tag} item` }], warnings: [], meta: { title: `${tag} meta` },
    callerUserId: userId, callerUsername: `${userId}-name`,
    ...(orgId ? { callerOrgId: orgId, callerOrgRole: 'owner' } : {}),
    createdAt: now, updatedAt: now,
  });
  return jobId;
}

/** A refusal must be the bare "not found" and nothing else. */
function assertBare404(res, tag, why) {
  assert.strictEqual(res.statusCode, 404, `${why}: answered ${res.statusCode} ${res.body}`);
  assert.deepStrictEqual(Object.keys(body(res)), ['error'], `${why}: the 404 carried more than an error`);
  assert.ok(!res.body.includes(tag), `${why}: the 404 carried the job's content`);
}

// ===========================================================================
(async () => {
  say('\nevery builder\'s poll answers only the caller who started the job');

  for (const { route, kind, handler } of ROUTES) {
    await check(`${route}: another user's job id is 404, and carries nothing of the job`, async () => {
      reset();
      const tag = marker('other');
      const jobId = seedJob({ kind, userId: 'sub-someone-else', orgId: ORG, tag });
      const res = await quietly(() => handler(pollEvent(jobId, ORG_OWNER), ctx(route)));
      assertBare404(res, tag, 'a job started by another member of the same organisation');
    });

    await check(`${route}: the right user standing in another organisation, or in none, is 404`, async () => {
      reset();
      const tag = marker('org');
      const jobId = seedJob({ kind, orgId: ORG, tag });
      const elsewhere = await quietly(() => handler(pollEvent(jobId, who({ orgId: OTHER_ORG, orgRole: 'owner' })), ctx(route)));
      assertBare404(elsewhere, tag, 'the starter, now acting for another organisation');
      const asEngage = await quietly(() => handler(pollEvent(jobId, STAFF), ctx(route)));
      assertBare404(asEngage, tag, 'the starter, now acting as Engage with no organisation');

      const platformJob = seedJob({ kind, tag });
      const inAnOrg = await quietly(() => handler(pollEvent(platformJob, ORG_OWNER), ctx(route)));
      assertBare404(inAnOrg, tag, 'an Engage job read by its starter standing inside an organisation');
    });

    await check(`${route}: a job of another kind is 404 even to its owner`, async () => {
      reset();
      const tag = marker('kind');
      const jobId = seedJob({ kind: kind === 'question' ? 'prompt-advice' : 'question', orgId: ORG, tag });
      const res = await quietly(() => handler(pollEvent(jobId, ORG_OWNER), ctx(route)));
      assertBare404(res, tag, 'a job started through a different builder');
    });

    await check(`${route}: the starter, in the same organisation, still reads it`, async () => {
      reset();
      const tag = marker('mine');
      const jobId = seedJob({ kind, orgId: ORG, tag });
      const res = await quietly(() => handler(pollEvent(jobId, ORG_OWNER), ctx(route)));
      assert.strictEqual(res.statusCode, 200, `the owner was refused: ${res.body}`);
      assert.strictEqual(body(res).items[0].title, `${tag} item`);
    });
  }

  await check('a poll carrying no signed-in user is 404', async () => {
    reset();
    const tag = marker('anon');
    const jobId = seedJob({ kind: 'question', userId: '', tag });
    const res = await quietly(() => questions(pollEvent(jobId, ANON), ctx()));
    assertBare404(res, tag, 'an anonymous poll of a job that recorded no user');
  });

  say('\na POST with no signed-in user starts nothing');

  for (const [label, handler, request] of [
    ['ai-generate-questions', questions, { engagementType: 'call-and-answer', userInput: 'x', questionCount: 2 }],
    ['ai-generate-scenarios', scenarios, { scenarioType: 'custom', engagementType: 'call-and-answer', count: 2 }],
  ]) {
    await check(`${label}: 401, with no job row, no dispatch and no Bedrock call`, async () => {
      // rejects: recording a job no poll could ever hand over, and paying for it.
      reset();
      const res = await quietly(() => handler(postEvent(request, ANON), ctx()));
      assert.strictEqual(res.statusCode, 401, `answered ${res.statusCode}: ${res.body}`);
      assert.strictEqual([...store.keys()].filter((k) => k.startsWith('AIJOBS|')).length, 0, 'a job row was written');
      assert.strictEqual(dispatched.length, 0, 'a worker was dispatched');
      assert.strictEqual(bedrockCalls, 0);
    });
  }

  say('\nan organisation\'s job is sealed at rest, and opened for its owner');

  await check('questions: request and items are envelopes from the row\'s birth', async () => {
    reset();
    const tag = marker('birth');
    bedrockHandler = () => toolResponse(itemsFor(2, tag));
    const { atBirth } = await runJob(questions, { engagementType: 'call-and-answer', userInput: tag, questionCount: 2 }, ORG_HOST);
    assert.ok(isEnvelope(atBirth.request), `request at birth was ${JSON.stringify(atBirth.request)}`);
    assert.ok(isEnvelope(atBirth.items), `items at birth were ${JSON.stringify(atBirth.items)}`);
    assert.deepStrictEqual(kmsStub.plainRow(ORG, atBirth).request, { kind: 'question', count: 2 });
  });

  await check('questions: the finished row holds no generated text, and is sealed under the caller\'s org', async () => {
    reset();
    const tag = marker('done');
    bedrockHandler = () => toolResponse(itemsFor(3, tag));
    const { jobId, job } = await runJob(questions, { engagementType: 'call-and-answer', userInput: 'brief', questionCount: 3 }, ORG_HOST);
    assert.strictEqual(job.status, 'complete', `job ended ${job.status}: ${job.error}`);
    const row = jobRow(jobId);
    assert.ok(isEnvelope(row.request), 'request is readable at rest');
    assert.ok(isEnvelope(row.items), 'items are readable at rest');
    assert.ok(!JSON.stringify(row).includes(tag), 'generated text is readable somewhere on the row');
    assert.strictEqual(row.completed, 3, 'the count is structure and stays plaintext');
    const opened = kmsStub.plainRow(ORG, row);
    assert.deepStrictEqual(opened.items.map((i) => i.title), itemsFor(3, tag).map((i) => i.title));
    assert.throws(() => kmsStub.plainRow(OTHER_ORG, row), /authenticate|unsupported/i,
      'another organisation\'s key opened the row');
  });

  await check('questions: the owner\'s poll reads the items in the clear', async () => {
    reset();
    const tag = marker('poll');
    bedrockHandler = () => toolResponse(itemsFor(2, tag));
    const { polled, job } = await runJob(questions, { engagementType: 'call-and-answer', userInput: 'brief', questionCount: 2 }, ORG_HOST);
    assert.strictEqual(polled.statusCode, 200);
    assert.ok(!hasEnvelope(job), `the poll handed back an envelope: ${polled.body.slice(0, 200)}`);
    assert.deepStrictEqual(job.items.map((i) => i.title), itemsFor(2, tag).map((i) => i.title));
  });

  await check('questions: a pass in flight, and a run that fails part-way, are sealed too', async () => {
    // rejects: sealing only on completion. The progress write is where the
    // items live for most of a long run, and a failed run keeps what it made.
    reset();
    const tag = marker('flight');
    const perCall = itemsPerCall('question');
    let inFlight = null;
    bedrockHandler = (n) => {
      if (n === 1) return toolResponse(itemsFor(perCall, tag));
      if (!inFlight) inFlight = clone([...store.values()].find((r) => r.PK === 'AIJOBS'));
      throw new Error('Bedrock is having a day');
    };
    const { jobId, job } = await runJob(questions, { engagementType: 'call-and-answer', userInput: 'brief', questionCount: perCall + 3 }, ORG_HOST);
    assert.ok(inFlight, 'the second pass never ran');
    assert.ok(isEnvelope(inFlight.items), 'the items written after the first pass were readable at rest');
    assert.ok(!JSON.stringify(inFlight).includes(tag), 'generated text readable mid-run');
    assert.strictEqual(job.status, 'error');
    const row = jobRow(jobId);
    assert.ok(isEnvelope(row.items), 'a failed run left its items readable at rest');
    assert.ok(!JSON.stringify(row).includes(tag), 'generated text readable after the failure');
    assert.strictEqual(job.items.length, perCall, 'the owner lost the partial result');
    assert.strictEqual(job.items[0].title, `${tag} alpha`);
  });

  await check('the factory seals set-level meta, and hands it back to the owner', async () => {
    reset();
    const tag = marker('meta');
    bedrockHandler = () => toolResponse(itemsFor(2, tag), { surveyTitle: `${tag} title` });
    const { jobId, job } = await runJob(probe, { count: 2 }, ORG_OWNER);
    assert.strictEqual(job.status, 'complete', `job ended ${job.status}: ${job.error}`);
    const row = jobRow(jobId);
    assert.ok(isEnvelope(row.meta), `meta at rest was ${JSON.stringify(row.meta)}`);
    assert.ok(!JSON.stringify(row).includes(tag), 'generated text is readable somewhere on the row');
    assert.deepStrictEqual(job.meta, { title: `${tag} title` });
  });

  await check('scenarios: request and items sealed, and opened for the owner', async () => {
    reset();
    const tag = marker('scen');
    bedrockHandler = () => toolResponse(itemsFor(2, tag));
    const { jobId, atBirth, job } = await runJob(scenarios,
      { scenarioType: 'custom', engagementType: 'call-and-answer', count: 2 }, ORG_HOST, 'ai-generate-scenarios');
    assert.ok(isEnvelope(atBirth.request), 'request readable at birth');
    assert.ok(isEnvelope(atBirth.items), 'items readable at birth');
    const row = jobRow(jobId);
    assert.ok(isEnvelope(row.request) && isEnvelope(row.items), 'the finished row is readable at rest');
    assert.ok(!JSON.stringify(row).includes(tag), 'generated text is readable somewhere on the row');
    assert.deepStrictEqual(kmsStub.plainRow(ORG, row).request,
      { scenarioType: 'custom', engagementType: 'call-and-answer', count: 2 });
    assert.ok(!hasEnvelope(job), 'the poll handed back an envelope');
    assert.deepStrictEqual(job.items.map((i) => i.title), itemsFor(2, tag).map((i) => i.title));
  });

  await check('scenarios: a run that fails part-way is sealed', async () => {
    reset();
    const tag = marker('scenfail');
    const perCall = itemsPerCall('call-and-answer');
    bedrockHandler = (n) => {
      if (n === 1) return toolResponse(itemsFor(perCall, tag));
      throw new Error('Bedrock is having a day');
    };
    const { jobId, job } = await runJob(scenarios,
      { scenarioType: 'custom', engagementType: 'call-and-answer', count: perCall + 3 }, ORG_HOST, 'ai-generate-scenarios');
    assert.strictEqual(job.status, 'error');
    assert.ok(isEnvelope(jobRow(jobId).items), 'a failed run left its items readable at rest');
    assert.strictEqual(job.items.length, perCall);
  });

  say('\nEngage\'s own jobs are unchanged');

  await check('questions, factory meta and scenarios: a platform job is plaintext at rest and reads back', async () => {
    reset();
    const tag = marker('plat');
    bedrockHandler = () => toolResponse(itemsFor(2, tag), { surveyTitle: `${tag} title` });

    const q = await runJob(questions, { engagementType: 'call-and-answer', userInput: 'brief', questionCount: 2 }, STAFF);
    const qRow = jobRow(q.jobId);
    assert.deepStrictEqual(qRow.request, { kind: 'question', count: 2 });
    assert.deepStrictEqual(qRow.items.map((i) => i.title), itemsFor(2, tag).map((i) => i.title));
    assert.strictEqual(qRow.callerOrgId, undefined);
    assert.deepStrictEqual(q.job.items.map((i) => i.title), itemsFor(2, tag).map((i) => i.title));

    const p = await runJob(probe, { count: 2 }, STAFF);
    assert.deepStrictEqual(jobRow(p.jobId).meta, { title: `${tag} title` });
    assert.deepStrictEqual(p.job.meta, { title: `${tag} title` });

    const s = await runJob(scenarios, { scenarioType: 'custom', engagementType: 'call-and-answer', count: 2 }, STAFF, 'ai-generate-scenarios');
    const sRow = jobRow(s.jobId);
    assert.deepStrictEqual(sRow.request, { scenarioType: 'custom', engagementType: 'call-and-answer', count: 2 });
    assert.ok(Array.isArray(sRow.items) && sRow.items.length === 2, 'platform items are not plaintext');
    assert.strictEqual(s.job.items.length, 2);
  });

  suiteFinished();
  say(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
