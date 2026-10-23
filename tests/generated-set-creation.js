/**
 * THE SET A GENERATION JOB LEAVES BEHIND — integration test.
 *
 * SINCE 2026-10-21 A RUN LEAVES A DRAFT, AND A PERSON MAKES THE SET. The
 * owner: "an approval to accept the work that was created". Every whole-set
 * run now writes into a draft (shared/generation-drafts.js) and the set is
 * made when its creator accepts it (admin/generation-drafts.js) — through the
 * same importer and CSV writers this suite has always held to. `runJob` below
 * therefore presses accept after every run, as the same person. The history
 * that follows is why leaving must still produce something; it now does, as a
 * draft that is notified and kept for thirty days.
 *
 * THE COMPLAINT THIS EXISTS FOR. The owner ran the AI scenario builder for a
 * set called "World Leaders", was told *"Close — this keeps running"*, left,
 * and came back to no set. Nothing had crashed. The worker wrote ITEMS into the
 * job record and the SET was only ever created client-side, when a human
 * returned and pressed "Load N into System". The panel's promise was true about
 * the job and false about the outcome.
 *
 * So the worker creates the set itself, as an inactive AI-flagged draft owned
 * by whoever started the job, BEFORE the job goes terminal. Everything below
 * drives the REAL handlers — ai-generate-scenarios, ai-generate-trivia,
 * ai-generate-polls, ai-generate-questions, ai-generate-survey — and the REAL
 * upload-questions importer they invoke, against one in-memory table, with only
 * Bedrock and the self-invoke stubbed. Nothing here asserts against a copy of
 * the logic.
 *
 * The stubbing follows tests/scenario-generation-job.js: hook Module._load BY
 * MODULE NAME, because several @aws-sdk packages exist only in the deployed
 * bundle and cannot be resolved from the repo root at all.
 *
 * THE TABLE STUB ENFORCES ConditionExpression, and that is load-bearing rather
 * than decorative: the worker's `#status = :queued` job claim and
 * `attribute_not_exists(setCreationClaimedAt)` behind it are the whole
 * idempotency guard, and a stub that ignored conditions would let a broken
 * guard pass.
 */
const suiteFinished = require('./helpers/finish-guard');
const path = require('path');
const assert = require('assert');

const REPO = path.join(__dirname, '..');

// ---- Stub the AWS SDK by module name before any handler loads -------------
const Module = require('module');
const stubs = new Map();
const realLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (stubs.has(request)) return stubs.get(request);
  return realLoad.call(this, request, parent, isMain);
};
function stub(name, exports) { stubs.set(name, exports); }

process.env.TABLE_NAME = 'engage-test';
// tenant-crypto refuses to mint a data key without one, and org-scoped set
// content is encrypted — see the KMS stub registered below.
process.env.TENANT_KMS_KEY_ID = 'alias/test-tenant-key';
process.env.ACCOUNT_ID = '000000000000';
process.env.AWS_REGION = 'us-east-1';

// ---- DynamoDB -------------------------------------------------------------
const ddb = new Map();
const rowKey = (pk, sk) => `${pk}|${sk}`;
/** Ordered log of every write, so "before the job went terminal" is testable. */
let writeLog = [];

class GetCommand { constructor(input) { this.kind = 'get'; this.input = input; } }
class PutCommand { constructor(input) { this.kind = 'put'; this.input = input; } }
class UpdateCommand { constructor(input) { this.kind = 'update'; this.input = input; } }
class QueryCommand { constructor(input) { this.kind = 'query'; this.input = input; } }
class BatchWriteCommand { constructor(input) { this.kind = 'batchWrite'; this.input = input; } }
class DeleteCommand { constructor(input) { this.kind = 'delete'; this.input = input; } }

class ConditionalCheckFailedException extends Error {
  constructor() { super('The conditional request failed'); this.name = 'ConditionalCheckFailedException'; }
}

/** Minimal `SET a = :x, #n = :y` applier, plus the list_append the flip uses. */
function applyUpdate(item, input) {
  const names = input.ExpressionAttributeNames || {};
  const values = input.ExpressionAttributeValues || {};
  const body = String(input.UpdateExpression).replace(/^\s*SET\s+/i, '');
  for (const clause of body.split(/,(?![^(]*\))/)) {
    const [lhsRaw, rhsRaw] = clause.split('=');
    if (!rhsRaw) continue;
    const attr = names[lhsRaw.trim()] || lhsRaw.trim();
    const rhs = rhsRaw.trim();
    const listAppend = rhs.match(/^list_append\(\s*if_not_exists\(([^,]+),\s*([^)]+)\)\s*,\s*(\S+)\s*\)$/);
    if (listAppend) {
      const existing = item[names[listAppend[1].trim()] || listAppend[1].trim()];
      const seed = values[listAppend[2].trim()];
      const entry = values[listAppend[3].trim()];
      item[attr] = [...(Array.isArray(existing) ? existing : seed), ...entry];
      continue;
    }
    item[attr] = values[rhs];
  }
}

/**
 * Only the two conditions this code writes: createSetForJob's
 * `attribute_not_exists(setCreationClaimedAt)` and the worker's
 * `#status = :queued` claim (generation-jobs.js, claimJob). Anything else is a
 * test bug.
 */
function conditionHolds(input, item) {
  const condition = String(input.ConditionExpression);
  const notExists = condition.match(/^attribute_not_exists\((\w+)\)$/);
  if (notExists) return item[notExists[1]] === undefined;
  const equals = condition.match(/^\s*(#?\w+)\s*=\s*(:\w+)\s*$/);
  if (equals) {
    const attr = (input.ExpressionAttributeNames || {})[equals[1]] || equals[1];
    return item[attr] !== undefined && item[attr] === (input.ExpressionAttributeValues || {})[equals[2]];
  }
  throw new Error(`stub cannot evaluate ConditionExpression: ${condition}`);
}

const docClient = {
  send: async (cmd) => {
    const { Key, Item, TableName } = cmd.input;
    if (TableName) assert.strictEqual(TableName, 'engage-test', 'handler wrote to the wrong table');
    if (cmd.kind === 'get') return { Item: ddb.get(rowKey(Key.PK, Key.SK)) || undefined };
    if (cmd.kind === 'put') {
      ddb.set(rowKey(Item.PK, Item.SK), { ...Item });
      writeLog.push({ op: 'put', pk: Item.PK, sk: Item.SK });
      return {};
    }
    if (cmd.kind === 'update') {
      const k = rowKey(Key.PK, Key.SK);
      const existing = ddb.get(k) || { ...Key };
      if (cmd.input.ConditionExpression && !conditionHolds(cmd.input, existing)) {
        throw new ConditionalCheckFailedException();
      }
      applyUpdate(existing, cmd.input);
      ddb.set(k, existing);
      writeLog.push({ op: 'update', pk: Key.PK, sk: Key.SK, expr: cmd.input.UpdateExpression });
      return {};
    }
    if (cmd.kind === 'delete') { ddb.delete(rowKey(Key.PK, Key.SK)); return {}; }
    if (cmd.kind === 'batchWrite') {
      const requests = cmd.input.RequestItems['engage-test'] || [];
      assert.ok(requests.length <= 25, `BatchWrite over the 25-item limit: ${requests.length}`);
      for (const request of requests) {
        if (request.PutRequest) {
          const row = request.PutRequest.Item;
          ddb.set(rowKey(row.PK, row.SK), { ...row });
          writeLog.push({ op: 'put', pk: row.PK, sk: row.SK });
        } else if (request.DeleteRequest) {
          ddb.delete(rowKey(request.DeleteRequest.Key.PK, request.DeleteRequest.Key.SK));
        }
      }
      return { UnprocessedItems: {} };
    }
    if (cmd.kind === 'query') {
      const values = cmd.input.ExpressionAttributeValues || {};
      const pk = values[':pk'] ?? values[':setpk'];
      const prefix = values[':sk'] ?? values[':questionPrefix'];
      let items = [...ddb.values()].filter((row) => row.PK === pk);
      if (prefix) items = items.filter((row) => String(row.SK).startsWith(prefix));
      items.sort((a, b) => String(a.SK).localeCompare(String(b.SK)));
      return { Items: items, Count: items.length };
    }
    throw new Error(`unexpected command ${cmd.kind}`);
  },
};

stub('@aws-sdk/client-dynamodb', { DynamoDBClient: class {} });
stub('@aws-sdk/lib-dynamodb', {
  DynamoDBDocumentClient: { from: () => docClient },
  GetCommand, PutCommand, UpdateCommand, QueryCommand, BatchWriteCommand, DeleteCommand,
});

// ---- Bedrock --------------------------------------------------------------
let bedrockCalls = [];
let bedrockHandler = () => { throw new Error('no bedrock handler installed'); };

class InvokeModelCommand { constructor(input) { this.input = input; } }
class BedrockRuntimeClient {
  async send(cmd) {
    const body = JSON.parse(cmd.input.body);
    bedrockCalls.push({ body, prompt: body.messages[0].content });
    return bedrockHandler(bedrockCalls.length, body);
  }
}
stub('@aws-sdk/client-bedrock-runtime', { BedrockRuntimeClient, InvokeModelCommand });

const toolResponse = (items, stopReason = 'tool_use') => ({
  body: new TextEncoder().encode(JSON.stringify({
    stop_reason: stopReason,
    content: [{ type: 'tool_use', name: 'emit_items', input: { items } }],
  })),
});

// ---- Lambda (self-invoke) -------------------------------------------------
let dispatched = [];
class InvokeCommand { constructor(input) { this.input = input; } }
class LambdaClient {
  async send(cmd) {
    dispatched.push({
      FunctionName: cmd.input.FunctionName,
      InvocationType: cmd.input.InvocationType,
      payload: JSON.parse(Buffer.from(cmd.input.Payload).toString('utf8')),
    });
    return {};
  }
}
stub('@aws-sdk/client-lambda', { LambdaClient, InvokeCommand });

/*
  ORG CONTENT IS ENCRYPTED, so the moment a generated set stops going to the
  platform library this suite needs a KMS that behaves like the real key policy.
  The stub REFUSES a Decrypt whose encryption context disagrees with the blob,
  so an org-confusion bug fails here rather than passing quietly — see the
  helper's header. `mintOrg` below writes the ORG#<id>/METADATA row that carries
  the wrapped key; without it tenant-crypto throws by design rather than writing
  a tenant plaintext it believes is encrypted.
*/
const { makeKmsStub, mintOrg, forgetAllOrgs } = require('./helpers/tenant-crypto-stub');
const kmsStub = makeKmsStub();
stub('@aws-sdk/client-kms', kmsStub.exports);

// ---- The real handlers ----------------------------------------------------
const scenarios = require(path.join(REPO, 'lambda-functions/admin/ai-generate-scenarios.js')).handler;
const trivia = require(path.join(REPO, 'lambda-functions/admin/ai-generate-trivia.js')).handler;
const polls = require(path.join(REPO, 'lambda-functions/admin/ai-generate-polls.js')).handler;
const questions = require(path.join(REPO, 'lambda-functions/admin/ai-generate-questions.js')).handler;
const survey = require(path.join(REPO, 'lambda-functions/admin/ai-generate-survey.js')).handler;
const draftsRoute = require(path.join(REPO, 'lambda-functions/admin/generation-drafts.js')).handler;

if (!process.env.DEBUG) console.log = () => {};
const say = (...a) => process.stdout.write(a.join(' ') + '\n');

let passed = 0; let failed = 0;
async function test(name, fn) {
  try { await fn(); passed += 1; say(`  PASS  ${name}`); }
  catch (error) { failed += 1; say(`  FAIL  ${name}\n        ${error.message}`); }
}

function reset() {
  ddb.clear();
  writeLog = [];
  bedrockCalls = [];
  dispatched = [];
  bedrockHandler = () => toolResponse([]);
  // Every bundle's key cache, or a later assertion decrypts with a key whose
  // blob the cleared store no longer holds.
  forgetAllOrgs();
}

/** Give an org a wrapped data key, so org-scoped writes are encryptable. */
const mint = (org = 'org_acme') =>
  mintOrg((item) => ddb.set(rowKey(item.PK, item.SK), item), org);

/**
 * A real signed-in caller in THIS API'S REAL EVENT SHAPE.
 *
 * `CognitoAuthorizer` is a CUSTOM Lambda authorizer despite the name, so its
 * context arrives at `requestContext.authorizer.lambda` with groups
 * comma-joined into a string. It is NOT `.jwt.claims` — eighteen tests once
 * passed against that non-existent shape. See require-admin.js's header.
 */
const adminEvent = (body) => ({
  requestContext: {
    http: { method: 'POST' },
    authorizer: { lambda: { username: 'ada', userId: 'sub-ada', groups: 'admins', status: 'enabled' } },
  },
  body: JSON.stringify(body),
});
/*
  A CUSTOMER'S HOST, not Engage staff. The suite only ever ran as `admins` with
  NO organisation — which is the one caller for whom writing to the platform
  library is correct — so nothing here ever exercised the case every real
  customer is in. `orgRole` is required as well as `orgId`: tenant.canManageScope
  needs a role of at least `member` before it will let anyone write an org scope.
*/
const hostEvent = (body, org = 'org_acme') => ({
  requestContext: {
    http: { method: 'POST' },
    authorizer: {
      lambda: {
        username: 'hal', userId: 'sub-hal', groups: 'hosts', status: 'enabled',
        orgId: org, orgRole: 'owner', orgIds: org,
      },
    },
  },
  body: JSON.stringify(body),
});
const ctx = (remainingMs = 900000) => ({
  functionName: 'engagedev-admin-ai-generate-scenarios',
  getRemainingTimeInMillis: () => remainingMs,
});

/**
 * Start a job over HTTP, then run the worker EXACTLY as Lambda's Event invoke
 * would: with the payload the handler really dispatched, not a reconstruction
 * of it. That is what makes "the dispatch carries no identity" a real test —
 * a reconstructed event could smuggle one in and nobody would notice.
 */
async function runJob(handler, body, workerCtx = ctx(), starter = adminEvent, { accept = { activate: false } } = {}) {
  const started = await handler(starter(body), ctx());
  const { jobId, draftId } = JSON.parse(started.body);
  const dispatch = dispatched[dispatched.length - 1].payload;
  await handler(dispatch, workerCtx);
  // Polled AS THE STARTER: a job is read only by whoever started it, acting for
  // the same organisation (tests/generation-job-owner.js).
  const polled = await handler(
    { requestContext: { http: { method: 'GET' }, authorizer: starter(body).requestContext.authorizer }, pathParameters: { jobId } },
    ctx());
  /*
    A RUN WRITES A DRAFT, AND A PERSON MAKES THE SET (owner, 2026-10-21).
    Leaving the builder still produces something — the draft, notified and kept
    thirty days — and the SET is made when its creator accepts it, through the
    same importer and the same CSV writers this suite has always held to. So
    every run here is followed by the accept a person would press, as the same
    person, unless the case says otherwise. `activate: false` by default: the
    set lands switched off, which keeps the old draft-set expectations honest
    and needs no shelf; an active accept is tested on its own.
  */
  let accepted = null;
  if (draftId && accept) {
    const res = await draftsRoute({
      requestContext: {
        http: { method: 'POST', path: `/admin/generation-drafts/${draftId}/accept` },
        authorizer: starter(body).requestContext.authorizer,
      },
      pathParameters: { proxy: `${draftId}/accept` },
      body: JSON.stringify(accept),
    });
    accepted = { statusCode: res.statusCode, body: JSON.parse(res.body) };
  }
  return { started, jobId, draftId, dispatch, job: JSON.parse(polled.body), accepted };
}
const jobRow = (jobId) => ddb.get(rowKey('AIJOBS', `AIJOB#${jobId}`));
const isEnvelope = (v) => !!v && typeof v === 'object' && !Array.isArray(v)
  && typeof v.v === 'number' && typeof v.iv === 'string'
  && typeof v.tag === 'string' && typeof v.ct === 'string';

const setRows = () => [...ddb.values()].filter((row) => row.PK === 'SETS');
/** Set metadata rows in ONE organisation's library. tenant.js keys it this way. */
const orgSetRows = (org = 'org_acme') => [...ddb.values()].filter((row) => row.PK === `ORG#${org}#SETS`);
const questionRows = (setId) => [...ddb.values()]
  // #v1 — a generated set is created through upload-questions.js like any
  // other, and a new set is born at v1 (shared/set-version.js FIRST_VERSION).
  .filter((row) => row.PK === `SET#${setId}#v1` && String(row.SK).startsWith('QUESTION#'))
  .sort((a, b) => String(a.SK).localeCompare(String(b.SK)));

const SUBJECTS = [
  'onboarding a remote hire', 'escalating a security incident', 'renegotiating a vendor contract',
  'splitting a monolith service', 'running a blameless retrospective', 'handling a refund dispute',
];
const scenarioItems = (n, prefix) => Array.from({ length: n }, (_, i) => ({
  title: `${prefix}: ${SUBJECTS[i % SUBJECTS.length]}`,
  category: `Category ${(i % 2) + 1}`,
  detail: `Detail for ${prefix} ${i + 1}.`,
  customInstructions: 'Discuss with your team.',
  tags: ['Leadership', 'remote work'],
}));

const SCENARIO_META = {
  title: 'World Leaders',
  description: 'AI-generated scenarios for detailed difficulty level.',
  customInstructions: 'Answer from your own experience.',
  aiContextInstructions: 'These scenarios are designed for professional development.',
};

const scenarioBody = (overrides = {}) => ({
  scenarioType: 'custom',
  engagementType: 'call-and-answer',
  count: 4,
  setMetadata: SCENARIO_META,
  ...overrides,
});

// ===========================================================================
(async function run() {
  say('\nleaving the builder now produces something');

  await test('the worker creates the question set itself', async () => {
    // rejects: the shipped behaviour, where the worker wrote items into the job
    // record and the SET was only ever created client-side by
    // handleLoadIntoSystem. Somebody who took "Close — this keeps running" at
    // its word came back to a job full of scenarios and no set at all.
    reset();
    bedrockHandler = () => toolResponse(scenarioItems(4, 'leaders'));
    await runJob(scenarios, scenarioBody());
    const sets = setRows();
    assert.strictEqual(sets.length, 1, `expected one set, found ${sets.length}`);
    assert.strictEqual(sets[0].name, 'World Leaders');
    assert.strictEqual(sets[0].questionCount, 4);
  });

  await test('an appendOnly run hands back its items and creates NO set', async () => {
    // rejects: "Add questions" in the set editor leaving a stray inactive
    // duplicate set in the library after every run. The editor appends the
    // items to the set that already exists and saves a new VERSION of it.
    // Also rejects recording "No title was given" as an error on such a job:
    // a run that was never going to create a set has not failed to create one.
    reset();
    bedrockHandler = () => toolResponse(scenarioItems(3, 'more'));
    const { job } = await runJob(scenarios, scenarioBody({ count: 3, appendOnly: true, setMetadata: undefined }));
    assert.strictEqual(setRows().length + orgSetRows().length, 0, 'an append-only run must not create a set');
    assert.strictEqual(job.items.length, 3, 'the items still come back for the editor to append');
    assert.ok(!job.createdSet, 'no createdSet on an append-only job');
    assert.ok(!job.setCreationError, `no set-creation error either, got: ${job.setCreationError}`);
  });

  await test('the set and every question row are INACTIVE', async () => {
    // rejects: dropping `isAIGenerated: true` from the synthetic upload. That
    // one flag is what upload-questions.js:702 and :800 turn into
    // `active: false`, and without it the worker would publish a LIVE set
    // nobody has read — skipping the "AI-Generated Content - Review Required"
    // banner that is the entire point of landing it as a draft.
    //
    // SINCE DRAFTS (owner, 2026-10-21): nothing is a set until somebody accepts
    // it, so the run itself writes NO set row at all; and an accept that chose
    // "leave it off" lands the set switched off but REVIEWED — `aiReviewedAt`
    // set, so the list's "AI draft" chip does not ask for a review that has
    // already happened. Its rows are playable: switching the set on is all it
    // takes, exactly as a restored set's are.
    reset();
    bedrockHandler = () => toolResponse(scenarioItems(3, 'draft'));
    const { accepted } = await runJob(scenarios, scenarioBody({ count: 3 }), ctx(), adminEvent, { accept: null });
    assert.strictEqual(accepted, null);
    assert.strictEqual(setRows().length, 0, 'the run made a set before anybody accepted it');
    reset();
    bedrockHandler = () => toolResponse(scenarioItems(3, 'draft'));
    await runJob(scenarios, scenarioBody({ count: 3 }));
    const set = setRows()[0];
    assert.strictEqual(set.active, false, 'an accept that chose "leave it off" switched the set on');
    assert.strictEqual(set.isAIGenerated, true, 'the set is not flagged as AI-written');
    assert.ok(set.aiReviewedAt, 'an accepted draft still reads as unreviewed');
    const rows = questionRows(set.SK.replace('SET#', ''));
    assert.ok(rows.length > 0, 'no question rows were written');
  });

  await test('an accept that switches the set on needs a shelf, and with one it is live', async () => {
    // rejects: activating an unfiled set (upload-questions.js refuses to make
    // one servable), and an accept that ignores "switch it on".
    //
    // Since 23 Oct 2026 a run with no shelf of its own still ARRIVES with one:
    // the draft carries a suggested topic (shared/draft-topic.js), and an
    // accept that names none files the set there — so "switch it on" works
    // without a pick, and the set is never live unfiled.
    reset();
    bedrockHandler = () => toolResponse(scenarioItems(2, 'live'));
    const suggested = await runJob(scenarios, scenarioBody({ count: 2 }), ctx(), adminEvent, { accept: { activate: true } });
    assert.strictEqual(suggested.accepted.statusCode, 200, 'an accept with a suggested topic was refused');
    const filed = setRows()[0];
    assert.ok(filed && filed.topic, 'the set was switched on unfiled');
    assert.strictEqual(filed.active, true);
    reset();
    bedrockHandler = () => toolResponse(scenarioItems(2, 'live'));
    await runJob(scenarios, scenarioBody({ count: 2, setMetadata: { ...SCENARIO_META, topic: 'business-work' } }),
      ctx(), adminEvent, { accept: { activate: true } });
    const set = setRows()[0];
    assert.ok(set, 'no set');
    assert.strictEqual(set.active, true, 'an accepted, filed set was left off');
    for (const row of questionRows(set.SK.replace('SET#', ''))) assert.strictEqual(row.Active, true);
  });

  /*
    THE TOPIC A RUN PROPOSES (shared/draft-topic.js). Owner, 23 Oct 2026:
    "when ai generates question sets. it should auto tag (based on a list of
    categories) right now the user gets an error activating sets because they
    dont have a tag". The model is asked in the run's own call; keywords answer
    when it does not; the accept uses the person's choice, else the builder's,
    else the suggestion.
  */
  const withTopic = (items, input) => ({
    body: new TextEncoder().encode(JSON.stringify({
      stop_reason: 'tool_use',
      content: [{ type: 'tool_use', name: 'emit_items', input: { items, ...input } }],
    })),
  });
  const draftRow = (draftId) => [...ddb.values()].find((r) => r.SK === `DRAFT#${draftId}`);

  await test('the model is asked for the topic in the same call, and its pick files the set on accept', async () => {
    // rejects: a second model call for the topic; a suggestion that is never
    // used; "switch it on" refused for want of a pick the run already made.
    reset();
    bedrockHandler = () => withTopic(scenarioItems(2, 'model'), { setTopic: 'politics-society', setTags: ['Heads of State', 'diplomacy'] });
    const out = await runJob(scenarios, scenarioBody({ count: 2 }), ctx(), adminEvent, { accept: { activate: true } });
    assert.strictEqual(bedrockCalls.length, 1, 'the topic cost a second call');
    assert.match(bedrockCalls[0].prompt, /SET TOPIC/, 'the first pass did not ask for the topic');
    assert.deepStrictEqual(bedrockCalls[0].body.tools[0].input_schema.properties.setTopic.enum.length, 15);
    assert.ok(!bedrockCalls[0].body.tools[0].input_schema.required.includes('setTopic'), 'the topic became required');
    const d = draftRow(out.draftId);
    assert.strictEqual(d.suggestedTopic, 'politics-society');
    assert.strictEqual(d.suggestedTopicSource, 'model');
    assert.deepStrictEqual(d.suggestedTags, ['heads-of-state', 'diplomacy']);
    assert.strictEqual(out.accepted.statusCode, 200, JSON.stringify(out.accepted.body));
    const set = setRows()[0];
    assert.strictEqual(set.topic, 'politics-society');
    assert.deepStrictEqual(set.tags, ['heads-of-state', 'diplomacy']);
    assert.strictEqual(set.active, true);
  });

  await test('a model that omits or garbles the topic is answered by keywords', async () => {
    // rejects: a draft left unfiled because the model skipped an optional
    // field; a sixteenth shelf taken from the model's spelling.
    for (const input of [{}, { setTopic: 'leadership-studies' }, { setTopic: ['history'] }]) {
      reset();
      bedrockHandler = () => withTopic(scenarioItems(2, 'kw'), input);
      const out = await runJob(scenarios, scenarioBody({ count: 2 }), ctx(), adminEvent, { accept: { activate: true } });
      const d = draftRow(out.draftId);
      // "World Leaders" + items tagged Leadership / remote work.
      assert.strictEqual(d.suggestedTopic, 'business-work', JSON.stringify(input));
      assert.strictEqual(d.suggestedTopicSource, 'keywords');
      assert.ok(d.suggestedTags.includes('leadership'), d.suggestedTags.join(','));
      assert.strictEqual(out.accepted.statusCode, 200);
      assert.strictEqual(setRows()[0].topic, 'business-work');
      assert.strictEqual(setRows()[0].active, true);
    }
  });

  await test('the person\'s topic and tags at accept win over the suggestion', async () => {
    reset();
    bedrockHandler = () => withTopic(scenarioItems(2, 'mine'), { setTopic: 'history', setTags: ['empires'] });
    const out = await runJob(scenarios, scenarioBody({ count: 2 }), ctx(), adminEvent,
      { accept: { activate: true, topic: 'business-work', tags: [] } });
    assert.strictEqual(out.accepted.statusCode, 200);
    const set = setRows()[0];
    assert.strictEqual(set.topic, 'business-work', 'the suggestion overrode the person');
    assert.ok(!set.tags || set.tags.length === 0, 'tags the person removed came back');
  });

  await test('the set is owned by the caller, not by the Lambda role', async () => {
    // rejects: dispatching the worker without carrying the caller. The worker
    // has no authorizer context of its own, so an unstamped set has
    // `createdBy === undefined` — and question-set-access.js reads an unowned
    // set as admins-only house content, which means the HOST who asked for it
    // could not edit or delete the thing they just generated.
    reset();
    bedrockHandler = () => toolResponse(scenarioItems(2, 'owned'));
    await runJob(scenarios, scenarioBody({ count: 2 }));
    const set = setRows()[0];
    assert.strictEqual(set.createdBy, 'sub-ada',
      `set owner is "${set.createdBy}" — an unowned set is admins-only house content`);
    assert.strictEqual(set.createdByName, 'ada');
  });

  await test('the identity rides on the job row, never in the dispatch payload', async () => {
    // rejects: passing the caller through the worker payload. `__workerMode` is
    // an invocation path with NO authorizer, so an owner read out of the
    // payload is an owner whoever can invoke the function chose. The job row
    // can only be written by the POST that CognitoAuthorizer let through.
    reset();
    bedrockHandler = () => toolResponse(scenarioItems(2, 'carrier'));
    const { dispatch, jobId } = await runJob(scenarios, scenarioBody({ count: 2 }));
    const serialised = JSON.stringify(dispatch);
    assert.doesNotMatch(serialised, /sub-ada/, 'the caller id travelled in the dispatch payload');
    assert.doesNotMatch(serialised, /"ada"/, 'the caller name travelled in the dispatch payload');
    const row = ddb.get(rowKey('AIJOBS', `AIJOB#${jobId}`));
    assert.strictEqual(row.callerUserId, 'sub-ada', 'the job row does not carry the caller');
    assert.strictEqual(row.callerUsername, 'ada');
  });

  /*
    ── WHOSE LIBRARY DOES A GENERATED SET LAND IN? ──────────────────────────

    Reported: "as an individual when on my personal space i created a question
    set, it ends up being labled engage."

    It was not a label bug. `createSetRef` treats a caller with NO GROUPS AND NO
    ORG as an internal invocation — the seed scripts, the archive importer, the
    suite's own direct calls — and routes it to the platform library, which is
    documented and right for those. The generation worker was landing in that
    branch by accident: the job row captured `callerUserId`/`callerUsername` and
    nothing else, so the synthetic event it replays had no organisation to read.

    So EVERY set any customer generated was written into Engage's shared
    library: badged "Engage" in their own list, unmanageable by them (platform
    rows need the staff group), and readable by every other organisation on the
    platform. That last part is the one that matters — it is the exact failure
    tenant.js says it exists to prevent, and it happened through the front door.
  */
  await test('a host\'s generated set lands in THEIR org, not in Engage\'s library', async () => {
    // rejects: the worker's synthetic event losing the organisation, which puts
    // one customer's generated content in the library every customer reads.
    reset();
    await mint();
    bedrockHandler = () => toolResponse(scenarioItems(2, 'tenanted'));
    await runJob(scenarios, scenarioBody({ count: 2 }), ctx(), hostEvent);

    assert.deepStrictEqual(setRows(), [],
      'a customer\'s generated set was written into the shared platform library');
    const mine = orgSetRows();
    assert.strictEqual(mine.length, 1, `expected one set in the org's library, found ${mine.length}`);
    assert.strictEqual(mine[0].createdBy, 'sub-hal', 'the org set is not owned by the host who asked');
  });

  await test('the job row carries the organisation, not just the person', async () => {
    // rejects: capturing the caller at POST time without their org — the worker
    // has no authorizer of its own, so anything not on the job row is gone.
    reset();
    await mint();
    bedrockHandler = () => toolResponse(scenarioItems(2, 'jobrow'));
    const { jobId } = await runJob(scenarios, scenarioBody({ count: 2 }), ctx(), hostEvent);
    const row = ddb.get(rowKey('AIJOBS', `AIJOB#${jobId}`));
    assert.strictEqual(row.callerOrgId, 'org_acme', 'the job row does not carry the org');
    assert.strictEqual(row.callerOrgRole, 'owner',
      'the role is needed too — canManageScope refuses an org write without one');
  });

  await test('the organisation does not travel in the dispatch payload either', async () => {
    // rejects: moving the org into the worker payload, which is an invocation
    // path with no authorizer — an org read from there is an org whoever can
    // invoke the function chose.
    reset();
    await mint();
    bedrockHandler = () => toolResponse(scenarioItems(2, 'notpayload'));
    const { dispatch } = await runJob(scenarios, scenarioBody({ count: 2 }), ctx(), hostEvent);
    assert.doesNotMatch(JSON.stringify(dispatch), /org_acme/,
      'the organisation travelled in the dispatch payload');
  });

  await test('Engage staff with no org still author the shared library', async () => {
    // rejects: over-correcting. The platform library has to stay authorable, and
    // staff-with-no-org is the only caller for whom that is right.
    reset();
    bedrockHandler = () => toolResponse(scenarioItems(2, 'house'));
    await runJob(scenarios, scenarioBody({ count: 2 }));
    assert.strictEqual(setRows().length, 1, 'staff can no longer write the shared library');
    assert.deepStrictEqual(orgSetRows(), []);
  });

  await test('an unidentifiable caller starts nothing, so no set is ever owned by ""', async () => {
    // rejects: falling back to a username or to an empty string. isSetOwner
    // requires both halves to be non-empty precisely because `'' === ''` would
    // hand every legacy set to every unauthenticated request.
    //
    // Since a job is read only by the user who started it, a POST with no user
    // is refused outright (401): its job could never be handed over, and its
    // set would have landed in Engage's library through createSetRef's
    // no-groups-no-org "internal" branch. The authorizer always supplies one.
    reset();
    bedrockHandler = () => toolResponse(scenarioItems(2, 'anon'));
    const started = await scenarios(
      { requestContext: { http: { method: 'POST' } }, body: JSON.stringify(scenarioBody({ count: 2 })) },
      ctx());
    assert.strictEqual(started.statusCode, 401, `an anonymous POST answered ${started.statusCode}`);
    assert.strictEqual(dispatched.length, 0, 'an anonymous POST dispatched a worker');
    assert.deepStrictEqual(setRows(), [], 'an anonymous POST created a set');
    assert.strictEqual([...ddb.keys()].filter((k) => k.startsWith('AIJOBS|')).length, 0,
      'an anonymous POST wrote a job row');
  });

  /*
    THE SET'S NAME IS CONTENT, and the job row is a second copy of it. The set
    row seals `name` (ENCRYPTED_FIELDS.set); the job row carried the same title
    readable as `createdSetName`, and an importer refusal quotes it back in
    `setCreationError` ("Question set "World Leaders" already exists"). Both are
    sealed under the caller's organisation and opened on the owner's poll.
  */
  await test('an org job names its new set only under the org\'s key', async () => {
    reset();
    await mint();
    bedrockHandler = () => toolResponse(scenarioItems(2, 'sealedname'));
    const { jobId, draftId, accepted } = await runJob(scenarios, scenarioBody({ count: 2 }), ctx(), hostEvent);
    const row = jobRow(jobId);
    assert.ok(!JSON.stringify(row).includes('World Leaders'), 'the set\'s title is readable on the job row');
    const draft = ddb.get(rowKey('ORG#org_acme#GENDRAFTS', `DRAFT#${draftId}`));
    assert.ok(isEnvelope(draft.title), `the draft's title at rest was ${JSON.stringify(draft.title)}`);
    assert.ok(isEnvelope(draft.request), 'the draft\'s brief sat in plaintext');
    const items = [...ddb.values()].filter((r) => r.PK === `ORG#org_acme#GENDRAFT#${draftId}`);
    assert.ok(items.length === 2 && items.every((r) => isEnvelope(r.item)), 'a generated question sat in plaintext');
    assert.ok(!JSON.stringify([draft, ...items]).includes('sealedname'), 'generated content is readable at rest');
    assert.strictEqual(accepted.body.setId, 'worldleaders');
    assert.strictEqual(accepted.body.setName, 'World Leaders', 'the owner\'s accept did not open the set name');
  });

  await test('an org job\'s set-creation refusal is sealed too, and read back by its owner', async () => {
    reset();
    await mint();
    ddb.set(rowKey('ORG#org_acme#SETS', 'SET#worldleaders'),
      { PK: 'ORG#org_acme#SETS', SK: 'SET#worldleaders', orgId: 'org_acme' });
    bedrockHandler = () => toolResponse(scenarioItems(2, 'sealedclash'));
    const { jobId, draftId, accepted } = await runJob(scenarios, scenarioBody({ count: 2 }), ctx(), hostEvent);
    assert.strictEqual(accepted.statusCode, 400);
    assert.match(accepted.body.error || '', /already exists/i, `the refusal was ${JSON.stringify(accepted.body)}`);
    const row = jobRow(jobId);
    assert.ok(!JSON.stringify(row).includes('World Leaders'), 'the set\'s title is readable on the job row');
    const draft = ddb.get(rowKey('ORG#org_acme#GENDRAFTS', `DRAFT#${draftId}`));
    assert.strictEqual(draft.status, 'ready', 'a refused accept did not hand the draft back');
    assert.ok(!JSON.stringify(draft).includes('World Leaders'), 'the title is readable on the draft');
  });

  await test('Engage\'s own job names its set in plaintext, as every platform row is', async () => {
    reset();
    bedrockHandler = () => toolResponse(scenarioItems(2, 'plainname'));
    const { draftId, accepted } = await runJob(scenarios, scenarioBody({ count: 2 }));
    assert.strictEqual(ddb.get(rowKey('GENDRAFTS', `DRAFT#${draftId}`)).title, 'World Leaders');
    assert.strictEqual(accepted.body.setName, 'World Leaders');
  });

  say('\nthe direction travels with the set');

  await test('the round kind reaches the SETS row', async () => {
    // rejects: creating the set without roundKind. AIScenarioBuilder's own
    // comment on the client path spells out the consequence: the library, the
    // editor and every later regeneration would believe the set was Produce,
    // so a set generated as Apply reads back as something else entirely.
    reset();
    bedrockHandler = () => toolResponse(scenarioItems(2, 'apply'));
    await runJob(scenarios, scenarioBody({ count: 2, roundKind: 'apply' }));
    assert.strictEqual(setRows()[0].roundKind, 'apply');
  });

  await test('a custom kind carries its brief too', async () => {
    // rejects: sending roundKind and dropping roundKindBrief. `custom` has no
    // house direction at all — the brief IS the direction — so a set that keeps
    // the kind and loses the brief keeps a pointer to nothing.
    reset();
    bedrockHandler = () => toolResponse(scenarioItems(2, 'custom'));
    await runJob(scenarios, scenarioBody({
      count: 2, roundKind: 'custom', roundKindBrief: 'Land somebody else\'s checklist here.',
    }));
    const set = setRows()[0];
    assert.strictEqual(set.roundKind, 'custom');
    assert.strictEqual(set.roundKindBrief, 'Land somebody else\'s checklist here.');
  });

  await test('an unknown round kind is omitted, not forwarded into a 400', async () => {
    // rejects: passing the raw value through. upload-questions.js refuses an
    // unknown kind with a 400, so forwarding a typo would turn a successful
    // generation into no set at all — losing the items to protect a field that
    // is optional anyway.
    reset();
    bedrockHandler = () => toolResponse(scenarioItems(2, 'typo'));
    const { accepted } = await runJob(scenarios, scenarioBody({ count: 2, roundKind: 'sideways' }));
    const set = setRows()[0];
    assert.ok(set, 'a typo in the round kind destroyed the whole set');
    assert.strictEqual(set.roundKind, undefined, 'an unrecognised kind was written to the row');
    assert.strictEqual(accepted.body.setId, 'worldleaders', 'the accept does not report the set it made');
  });

  await test('the poll worker carries its direction as well', async () => {
    // rejects: wiring the direction for scenarios only. A poll round can hand
    // the room somebody else's material exactly as a call-and-answer round can
    // — roundKindApplies lists both — so a poll set that forgets its kind has
    // the same defect.
    reset();
    bedrockHandler = () => toolResponse([
      { kind: 'choice', title: 'Which reading lands here', category: 'Ops', detail: 'A passage.',
        customInstructions: 'Pick one.', options: ['One', 'Two', 'Three'], allowMultiple: false, tags: ['ops'] },
    ]);
    await runJob(polls, {
      topic: 'operations', count: 1, roundKind: 'improve',
      setMetadata: { title: 'Ops Polls', description: 'd', customInstructions: 'c', aiContextInstructions: 'a' },
    });
    const set = setRows()[0];
    assert.strictEqual(set.roundKind, 'improve');
    assert.strictEqual(set.engagementType, 'poll');
  });

  say('\nno double creation, ever');

  await test('a worker retry creates no second set', async () => {
    // rejects: a retry that reaches the importer at all. Lambda retries an
    // Event invoke by itself, so a second run of the same worker is not
    // hypothetical. The job claim (generation-jobs.js, claimJob) stops it
    // before Bedrock; the set-creation claim below is the guard behind that.
    reset();
    bedrockHandler = () => toolResponse(scenarioItems(3, 'retry'));
    const { dispatch, draftId } = await runJob(scenarios, scenarioBody({ count: 3 }), ctx(), adminEvent, { accept: null });
    const calls = bedrockCalls.length;

    await scenarios(dispatch, ctx());   // the platform's retry, byte-identical

    assert.strictEqual(bedrockCalls.length, calls, 'a retry paid for the generation again');
    const items = [...ddb.values()].filter((r) => r.PK === `GENDRAFT#${draftId}`);
    assert.strictEqual(items.length, 3, `a retry wrote the draft's questions twice (${items.length})`);
    assert.strictEqual(setRows().length, 0, 'a retry made a set nobody accepted');
  });

  await test('a draft is accepted once: a second press makes no second set', async () => {
    // rejects: an accept with no claim. A double click, or two tabs, would
    // import the same draft twice — the second refused for a taken name and
    // reported as a failure over a set that exists.
    reset();
    bedrockHandler = () => toolResponse(scenarioItems(3, 'twice'));
    const { draftId, accepted } = await runJob(scenarios, scenarioBody({ count: 3 }));
    assert.strictEqual(accepted.statusCode, 200);
    const again = await draftsRoute({
      requestContext: { http: { method: 'POST', path: `/admin/generation-drafts/${draftId}/accept` }, authorizer: adminEvent({}).requestContext.authorizer },
      pathParameters: { proxy: `${draftId}/accept` },
      body: JSON.stringify({ activate: false }),
    });
    assert.strictEqual(again.statusCode, 409, `a second accept answered ${again.statusCode}`);
    assert.strictEqual(setRows().length, 1, 'a second accept minted a second set');
  });

  await test('createSetForJob run twice for one job creates one set', async () => {
    // rejects: removing the conditional `attribute_not_exists` claim on the job
    // row. The worker's job claim keeps a second delivery from getting this
    // far, so this drives createSetForJob directly: without its own claim the
    // second call reaches the importer, is refused for a name already taken,
    // and replaces a job that had a set with a job that reports a failure.
    reset();
    const items = scenarioItems(3, 'twice');
    bedrockHandler = () => toolResponse(items);
    //
    // createSetForJob is reached by no generator today — every whole-set run
    // writes a draft — but it stays the creator for a handler that opts out of
    // drafts (`writesDrafts: false`), so its own guard is still held here.
    const { dispatch, jobId } = await runJob(scenarios, scenarioBody({ count: 3 }), ctx(), adminEvent, { accept: null });
    const { createSetForJob, scenariosToCsv } = require(path.join(REPO, 'lambda-functions/admin/shared/generated-set.js'));
    const spec = { engagementType: () => 'call-and-answer', toCsv: scenariosToCsv };
    const caller = { userId: 'sub-ada', username: 'ada' };
    const first = await createSetForJob({
      dynamodb: docClient, tableName: 'engage-test', jobId, spec, payload: dispatch.payload, items, caller,
    });
    assert.ok(first, 'the first call made no set');

    const again = await createSetForJob({
      dynamodb: docClient, tableName: 'engage-test', jobId,
      spec: { engagementType: () => 'call-and-answer', toCsv: scenariosToCsv },
      payload: dispatch.payload, items, caller: { userId: 'sub-ada', username: 'ada' },
    });

    assert.strictEqual(again, null, `the second call created a set: ${JSON.stringify(again)}`);
    assert.strictEqual(setRows().length, 1, 'a second call minted a second set');
    const row = ddb.get(rowKey('AIJOBS', `AIJOB#${jobId}`));
    assert.strictEqual(row.setCreationError, undefined,
      `the second call reported "${row.setCreationError}" over a set that already existed`);
    assert.strictEqual(row.createdSetId, 'worldleaders');
  });

  await test('the set is recorded on the job BEFORE the job goes terminal', async () => {
    // rejects: creating the set after completeJob/failJob. The client stops
    // polling the moment it sees a terminal status; a set written afterwards
    // arrives too late to be seen, so the client takes its fallback path and
    // posts the whole batch to upload-questions — which is the double creation
    // this ordering exists to prevent.
    reset();
    bedrockHandler = () => toolResponse(scenarioItems(2, 'order'));
    //
    // NOW: the DRAFT is ready before the job goes terminal, for the same
    // reason — a client that sees "complete" opens the review, and the review
    // must find the questions already there.
    const { jobId, draftId } = await runJob(scenarios, scenarioBody({ count: 2 }), ctx(), adminEvent, { accept: null });
    const draftReadyAt = writeLog.findIndex((w) => w.op === 'update' && w.sk === `DRAFT#${draftId}` && /#readyAt/.test(w.expr || ''));
    const terminalAt = writeLog.findIndex((w) => w.op === 'update' && w.sk === `AIJOB#${jobId}`
      && /:status/.test(w.expr) && /#items/.test(w.expr));
    assert.ok(draftReadyAt >= 0, 'the draft was never made ready');
    assert.ok(terminalAt >= 0, 'the job never went terminal');
    assert.ok(draftReadyAt < terminalAt, 'the job went terminal before its draft was ready to review');
  });

  await test('the poll payload names the set so the client need not make one', async () => {
    // rejects: creating the set server-side and not telling the client. The
    // review step would still show "Load N into System", the operator would
    // press it, and the importer would refuse — reporting a failure over a set
    // that exists.
    reset();
    bedrockHandler = () => toolResponse(scenarioItems(2, 'named'));
    //
    // NOW: the poll names the DRAFT, so the builder opens its review rather
    // than offering to "Load into System" — which would make a set behind the
    // draft's back.
    const { job, draftId } = await runJob(scenarios, scenarioBody({ count: 2 }), ctx(), adminEvent, { accept: null });
    assert.strictEqual(job.draftId, draftId, 'the poll does not name the draft');
    assert.strictEqual(job.createdSet, null, 'a set was reported before anybody accepted one');
  });

  await test('a generated question keeps its background on the stored row', async () => {
    // rejects: any hop between the model's tool call and the stored row dropping it.
    reset();
    const items = scenarioItems(2, 'bg').map((it, i) => ({ ...it, background: `zqbg-${i} Git records every change.` }));
    bedrockHandler = () => toolResponse(items);
    const { accepted } = await runJob(scenarios, scenarioBody({ count: 2 }));
    assert.strictEqual(accepted.statusCode, 200, `no set was created: ${JSON.stringify(accepted.body)}`);
    const questionRows = [...ddb.values()].filter((r) => String(r.SK).startsWith('QUESTION#'));
    assert.ok(questionRows.length === 2, `expected 2 question rows, saw ${questionRows.length}`);
    for (const r of questionRows) assert.ok(r.Background, `a row has no Background: ${r.SK}`);
  });

  await test('a set that could not be created is reported, not hidden', async () => {
    // rejects: swallowing the importer's refusal. Without `setCreationError`
    // the client would see no set and no reason, and its fallback would look
    // like the builder had simply forgotten to do anything.
    reset();
    ddb.set(rowKey('SETS', 'SET#worldleaders'), { PK: 'SETS', SK: 'SET#worldleaders', name: 'World Leaders' });
    bedrockHandler = () => toolResponse(scenarioItems(2, 'clash'));
    const { job, accepted, draftId } = await runJob(scenarios, scenarioBody({ count: 2 }));
    assert.strictEqual(accepted.statusCode, 400, 'an existing set was reported as newly created');
    assert.match(accepted.body.error, /already exists/i);
    assert.strictEqual(job.status, 'complete', 'a refused accept must not fail the generation');
    const items = [...ddb.values()].filter((r) => r.PK === `GENDRAFT#${draftId}`);
    assert.strictEqual(items.length, 2, 'the items were thrown away with the refusal');
  });

  await test('no title means no set, and the job says why', async () => {
    // rejects: inventing a title server-side. Every set id is a slug of its
    // title, so a made-up name collides with the next run's made-up name and
    // the second one is refused — a defect that only appears on the second use.
    reset();
    bedrockHandler = () => toolResponse(scenarioItems(2, 'untitled'));
    const { accepted, draftId } = await runJob(scenarios, { scenarioType: 'custom', engagementType: 'call-and-answer', count: 2 });
    assert.strictEqual(setRows().length, 0, 'a set was created with no title');
    assert.strictEqual(accepted.statusCode, 400);
    assert.match(accepted.body.error, /name/i);
    // …and naming it on the review screen is the way out.
    const named = await draftsRoute({
      requestContext: { http: { method: 'POST', path: `/admin/generation-drafts/${draftId}/accept` }, authorizer: adminEvent({}).requestContext.authorizer },
      pathParameters: { proxy: `${draftId}/accept` },
      body: JSON.stringify({ activate: false, title: 'Named On Review' }),
    });
    assert.strictEqual(named.statusCode, 200, named.body);
    assert.strictEqual(setRows()[0].name, 'Named On Review');
  });

  say('\nonly a whole-set generator may create a set');

  await test('a single-question generation creates NO set', async () => {
    // rejects: putting set creation in makeGenerationHandler unconditionally.
    // ai-generate-questions adds ONE question to a set that already exists, so
    // an unconditional creator would mint a new one-question set every time
    // somebody added a question to an existing set.
    reset();
    bedrockHandler = () => toolResponse([{
      title: 'One more question', category: 'Ops', detail: 'Some detail.',
      customInstructions: 'Answer it.', tags: ['ops'],
    }]);
    const { job } = await runJob(questions, {
      count: 1,
      engagementType: 'call-and-answer',
      setName: 'An Existing Set',
      // Deliberately present: even handed a perfectly good title, this handler
      // must not create anything.
      setMetadata: { title: 'An Existing Set', description: 'd', customInstructions: 'c', aiContextInstructions: 'a' },
    });
    assert.strictEqual(setRows().length, 0, 'adding one question minted a whole new set');
    assert.strictEqual(job.createdSet, null);
    assert.strictEqual(job.setCreationError, null,
      'a handler that must not create a set must not report a creation failure either');
  });

  /*
    SURVEY OPTS IN, since Phase 1 of the survey redesign. It was deliberately
    absent while upload-questions.js refused every survey — a worker creating
    one would have been asking for a 400 on every run — and SurveyAIBuilder
    could only export JSON. The importer now takes the contract's survey CSV
    (docs/design/survey-redesign/IMPLEMENTATION-phase-0-1.md), so a survey run
    leaves a draft survey set behind like every other whole-set builder.
  */
  const surveyItems = () => [
    { kind: 'rating', title: 'How useful was today for your work?', required: true, scale: '1-5', lowLabel: 'Not useful', highLabel: 'Very useful', tags: ['usefulness'] },
    { kind: 'choice', title: 'Which part was most valuable?', required: true, options: ['The live demo', 'The case studies', 'The Q&A'], allowOther: true, tags: ['content'] },
    { kind: 'yesno', title: 'Was the length about right?', required: false, unsure: true, followUpWhen: 'no', followUpPrompt: 'What would you cut or add?', tags: ['format'] },
    { kind: 'rank', title: 'Rank these for next time', required: false, options: ['Customer stories', 'Roadmap', 'Team wins'], tags: ['topics'] },
    { kind: 'text', title: 'What would you change?', required: false, textLength: 'short', placeholder: 'One idea is plenty', tags: ['ideas'] },
  ];
  const surveyBody = (overrides = {}) => ({
    questionCount: 5,
    kinds: ['rating', 'choice', 'yesno', 'rank', 'text'],
    source: 'The Q3 all-hands outline.',
    goal: 'what landed and what to change',
    setMetadata: { title: 'Feedback Survey', description: 'After the all-hands.', customInstructions: '', aiContextInstructions: '' },
    ...overrides,
  });

  await test('a survey generation creates a draft SURVEY set, every question imported', async () => {
    // rejects: leaving survey out of setCreation (the pre-Phase-1 behaviour),
    // and a toCsv that writes a row the importer would skip — a question the
    // host was shown in the builder and then silently lost from the set.
    reset();
    bedrockHandler = () => toolResponse(surveyItems());
    const { job, accepted } = await runJob(survey, surveyBody());
    assert.strictEqual(accepted.statusCode, 200, 'set creation failed: ' + JSON.stringify(accepted.body));
    const sets = setRows();
    assert.strictEqual(sets.length, 1, 'expected one set, found ' + sets.length);
    assert.strictEqual(sets[0].engagementType, 'survey');
    assert.strictEqual(sets[0].active, false, 'a survey accepted "left off" was switched on');
    assert.strictEqual(sets[0].isAIGenerated, true);
    assert.strictEqual(sets[0].questionCount, job.items.length, 'the importer skipped some of the generated rows');
    assert.strictEqual(accepted.body.setId, 'feedbacksurvey', 'the accept does not name the set it made');
  });

  await test('the survey rows carry their kinds and fields, filed under Survey', async () => {
    reset();
    bedrockHandler = () => toolResponse(surveyItems());
    await runJob(survey, surveyBody());
    const rows = questionRows('feedbacksurvey');
    assert.deepStrictEqual(rows.map((r) => r.kind), ['rating', 'choice', 'yesno', 'rank', 'text']);
    assert.ok(rows.every((r) => r.Category === 'Survey'));
    assert.strictEqual(rows[0].lowLabel, 'Not useful');
    assert.deepStrictEqual(rows[1].options, ['The live demo', 'The case studies', 'The Q&A']);
    assert.strictEqual(rows[1].allowOther, true);
    assert.strictEqual(rows[2].followUpPrompt, 'What would you cut or add?');
    assert.strictEqual(rows[4].maxLength, 280);
    assert.deepStrictEqual(rows[0].Tags, ['usefulness']);
    // Reviewed before it was saved, so its rows are playable the moment the
    // set is switched on; the set itself is what was left off.
    assert.ok(rows.every((r) => r.Active === true), 'an accepted survey\'s questions were left unplayable');
  });

  await test('a host\'s generated survey lands in their org, its options ciphertext at rest', async () => {
    reset();
    await mint();
    bedrockHandler = () => toolResponse(surveyItems());
    await runJob(survey, surveyBody(), ctx(), hostEvent);
    assert.deepStrictEqual(setRows(), [], 'a customer\'s survey went into the shared library');
    assert.strictEqual(orgSetRows().length, 1);
    const orgRows = [...ddb.values()].filter((row) => row.PK === 'ORG#org_acme#SET#feedbacksurvey#v1'
      && String(row.SK).startsWith('QUESTION#'));
    assert.strictEqual(orgRows.length, 5);
    const raw = JSON.stringify(orgRows);
    assert.ok(!raw.includes('The case studies'), 'an option is readable at rest');
    assert.ok(!raw.includes('What would you cut or add?'), 'a follow-up question is readable at rest');
  });

  say('\na partial run still leaves a draft');

  await test('a run that died mid-way still creates the set from what it had', async () => {
    // rejects: creating the set only on a clean completion. The person this
    // change exists for is the person who LEFT, and a run that dies while
    // nobody is watching is exactly the case they left for. The draft is
    // inactive, so a short set plays nowhere until a human looks at it.
    reset();
    const perCall = require(path.join(REPO, 'lambda-functions/admin/shared/structured-generation.js'))
      .itemsPerCall('call-and-answer');
    bedrockHandler = (n) => {
      if (n === 1) return toolResponse(scenarioItems(4, 'salvaged'));
      throw new Error('ValidationException: model unavailable');
    };
    const { job, accepted, draftId } = await runJob(scenarios, scenarioBody({ count: perCall + 4 }));
    assert.strictEqual(job.status, 'error', 'the fixture did not actually fail');
    assert.ok(job.items.length > 0, 'the fixture produced nothing to save');
    const draft = ddb.get(rowKey('GENDRAFTS', `DRAFT#${draftId}`));
    assert.ok(draft, 'a partial run left no draft at all');
    assert.strictEqual(accepted.statusCode, 200, 'a partial draft could not be accepted');
    assert.strictEqual(setRows()[0].active, false);
    assert.strictEqual(setRows()[0].questionCount, job.items.length);
  });

  await test('a run that produced nothing creates nothing', async () => {
    // rejects: creating an empty set. upload-questions.js would refuse it
    // ("No valid questions found in CSV") and the job would carry a
    // setCreationError that describes a non-problem — there was simply nothing
    // to save.
    reset();
    bedrockHandler = () => { throw new Error('ValidationException: model unavailable'); };
    const { job } = await runJob(scenarios, scenarioBody({ count: 2 }));
    assert.strictEqual(job.status, 'error');
    assert.strictEqual(job.items.length, 0);
    assert.strictEqual(setRows().length, 0, 'an empty set was created');
    assert.strictEqual(job.createdSet, null);
    assert.strictEqual(job.setCreationError, null,
      'nothing to save is not a set-creation failure and must not be reported as one');
  });

  say('\nthe importer is reused, not forked');

  await test('trivia options and the correct answer survive the server-built CSV', async () => {
    // rejects: a second CSV writer that drifts from the importer's contract.
    // The importer reads OptionA..OptionF by exact name and has NO fallback —
    // emitting WrongAnswer1/2/3 or Option1..5 loses every answer silently, with
    // a 200. See tests/question-set-roundtrip.js for the original defect.
    reset();
    bedrockHandler = () => toolResponse([{
      title: 'WHO SANG IT', questionDetail: 'Released in 1984.', category: 'Music',
      optionA: 'Prince', optionB: 'Madonna', optionC: 'Sting', optionD: 'Cyndi Lauper',
      correctAnswer: 'OptionA', answerDetails: 'Written in a single night.',
      school: 'Pop School', difficulty: 'easy', tags: ['music', '80s'],
    }]);
    await runJob(trivia, {
      topic: '80s music', count: 1,
      setMetadata: { title: '80s Music', description: 'd', customInstructions: 'c', aiContextInstructions: 'a' },
    });
    const row = questionRows('80smusic')[0];
    assert.ok(row, 'no trivia question row was written');
    assert.strictEqual(row.optionA, 'Prince');
    assert.strictEqual(row.optionD, 'Cyndi Lauper');
    assert.strictEqual(row.correctAnswer, 'OptionA');
    assert.strictEqual(row.AnswerDetails, 'Written in a single night.');
    assert.strictEqual(row.difficulty, 'easy');
    assert.deepStrictEqual(row.Tags, ['music', '80s']);
  });

  await test('poll options survive as ONE pipe-separated column', async () => {
    // rejects: restoring Option1..Option5. upload-questions.js reads a single
    // `Options` column split on `|` and knows no numbered fallback, which is
    // how every AI-generated poll set once imported with zero options.
    reset();
    bedrockHandler = () => toolResponse([{
      kind: 'choice', title: 'Which release cadence', category: 'Delivery', detail: 'Pick one.',
      customInstructions: 'Choose.', options: ['Weekly', 'Fortnightly', 'Monthly'],
      allowMultiple: false, school: 'Delivery', tags: ['delivery'],
    }]);
    await runJob(polls, {
      topic: 'delivery', count: 1,
      setMetadata: { title: 'Delivery Polls', description: 'd', customInstructions: 'c', aiContextInstructions: 'a' },
    });
    const row = questionRows('deliverypolls')[0];
    assert.deepStrictEqual(row.options, ['Weekly', 'Fortnightly', 'Monthly']);
    assert.strictEqual(row.allowMultiple, false);
    assert.strictEqual(row.kind, 'choice');
  });

  await test('a typed poll set stores each question\'s kind and fields, under its own category', async () => {
    // rejects: the old Options,AllowMultiple writer. It has no column for a
    // kind, a scale or a label, so a rating or a yes/no poll arrived as a
    // choice with no options — the "open text box" the owner reported — and
    // the importer has no way to tell. The poll CSV is the survey contract's
    // columns (shared/generated-set.js pollsToCsv), each row keeping its own
    // category rather than the survey's `Survey`.
    reset();
    bedrockHandler = () => toolResponse([
      { kind: 'rating', title: 'How ready is the launch', category: 'Launch', scale: '1-10',
        lowLabel: 'Not at all ready', highLabel: 'Ready today', tags: ['launch'] },
      { kind: 'yesno', title: 'Adopt the new review rule', category: 'Process',
        yesLabel: 'Approve', noLabel: 'Decline', unsure: true, tags: ['process'] },
      { kind: 'text', title: 'One word for the quarter', category: 'Launch', placeholder: 'One word', tags: ['mood'] },
    ]);
    const { accepted } = await runJob(polls, {
      topic: 'launch readiness', count: 3, kinds: ['rating', 'yesno', 'text'],
      setMetadata: { title: 'Launch Polls', description: 'd', customInstructions: 'c', aiContextInstructions: 'a' },
    });
    assert.strictEqual(accepted.statusCode, 200, `no set was created: ${JSON.stringify(accepted.body)}`);
    const rows = questionRows('launchpolls');
    assert.strictEqual(rows.length, 3, 'a typed poll was skipped on import');
    const byTitle = Object.fromEntries(rows.map((r) => [r.Title, r]));

    const rating = byTitle['How ready is the launch'];
    assert.strictEqual(rating.kind, 'rating');
    assert.strictEqual(rating.scale, '1-10');
    assert.strictEqual(rating.lowLabel, 'Not at all ready');
    assert.strictEqual(rating.highLabel, 'Ready today');
    assert.strictEqual(rating.Category, 'Launch');

    const yesno = byTitle['Adopt the new review rule'];
    assert.strictEqual(yesno.kind, 'yesno');
    assert.strictEqual(yesno.yesLabel, 'Approve');
    assert.strictEqual(yesno.noLabel, 'Decline');
    assert.strictEqual(yesno.unsure, true);
    assert.strictEqual(yesno.Category, 'Process', 'a poll keeps its own category, never "Survey"');

    const text = byTitle['One word for the quarter'];
    assert.strictEqual(text.kind, 'text');
    assert.strictEqual(text.textLength, 'short');
    assert.strictEqual(text.placeholder, 'One word');
    for (const r of rows) {
      assert.ok(!Array.isArray(r.options) || r.options.length === 0 || r.kind === 'choice',
        `${r.kind} "${r.Title}" carries a choice's options`);
    }
  });

  await test('a quote inside a title is escaped, not left to shift every column', async () => {
    // rejects: hand-rolled `"${value}"` interpolation in the server-side CSV
    // writer. A title like THE "RIGHT" CALL interpolates to three fields and
    // shifts everything after it — silent corruption with a 200, which is
    // exactly why src/src/utils/csv.js exists and why shared/csv.js mirrors it.
    reset();
    bedrockHandler = () => toolResponse([{
      title: 'THE "RIGHT" CALL', category: 'Judgement', detail: 'A hard one, with a comma, too.',
      customInstructions: 'Discuss.', tags: ['judgement'],
    }]);
    await runJob(scenarios, scenarioBody({ count: 1 }));
    const row = questionRows('worldleaders')[0];
    assert.strictEqual(row.Title, 'THE "RIGHT" CALL', 'the quote was eaten or the row was shifted');
    assert.strictEqual(row.Detail, 'A hard one, with a comma, too.');
    assert.strictEqual(row.Category, 'Judgement');
  });

  say('\na set refused at the plan limit says who can fix it');

  await test('the job carries the refusal itself, with the reader\'s way out', async () => {
    // rejects: flattening a 402 into `setCreationError` alone. The builder then
    // says "The set could not be created for you: This organisation cannot
    // store another question set yet…" with nothing to click — the plan limit
    // in a fault's voice, after the generation was already paid for
    // (22-plan-limit-notice.html).
    reset();
    await mint();
    const { periodOf } = require(path.join(REPO, 'lambda-functions/admin/shared/usage.js'));
    const period = periodOf(new Date());
    // MERGED onto the row `mint()` wrote, not over it: the real METADATA row
    // carries the plan AND the wrapped data key, and the job row is sealed
    // under that key from the POST onward.
    ddb.set(rowKey('ORG#org_acme', 'METADATA'), { ...ddb.get(rowKey('ORG#org_acme', 'METADATA')), PK: 'ORG#org_acme', SK: 'METADATA', orgId: 'org_acme', name: 'Acme', type: 'personal', plan: 'free', status: 'active' });
    ddb.set(rowKey('ORG#org_acme', `USAGE#${period}`), { PK: 'ORG#org_acme', SK: `USAGE#${period}`, orgId: 'org_acme', period, sessionsRun: 0, setsCurrent: 5, setsPeak: 5 });
    bedrockHandler = () => toolResponse(scenarioItems(2, 'capped'));
    //
    // NOW THE REFUSAL ARRIVES AT ACCEPT, which is when a set is made: the draft
    // itself never counted against the allowance, so generating was never
    // blocked by it. The accept answers with the importer's whole 402.
    const { job, accepted, draftId } = await runJob(scenarios, scenarioBody({ count: 2 }), ctx(), hostEvent);

    assert.strictEqual(accepted.statusCode, 402, 'a set was created past the allowance');
    assert.strictEqual(orgSetRows().length, 0);
    assert.strictEqual(accepted.body.code, 'upgrade_required');
    assert.strictEqual(accepted.body.limit.kind, 'sets');
    // The accept runs as the caller, so the voice is theirs.
    assert.strictEqual(accepted.body.resolve.role, 'owner');
    assert.match(accepted.body.error, /question set/i);
    assert.strictEqual(job.status, 'complete', 'a refused set must not fail the generation');
    const draft = ddb.get(rowKey('ORG#org_acme#GENDRAFTS', `DRAFT#${draftId}`));
    assert.strictEqual(draft.status, 'ready', 'the items were thrown away with the refused set');
  });

  await test('any other refusal carries no setCreationLimit', async () => {
    reset();
    ddb.set(rowKey('SETS', 'SET#worldleaders'), { PK: 'SETS', SK: 'SET#worldleaders', name: 'World Leaders' });
    bedrockHandler = () => toolResponse(scenarioItems(2, 'clash'));
    const { accepted } = await runJob(scenarios, scenarioBody({ count: 2 }));
    assert.match(accepted.body.error, /already exists/i);
    assert.notStrictEqual(accepted.body.code, 'upgrade_required');
    assert.strictEqual(accepted.statusCode, 400);
  });

  say(`\n${passed} passed, ${failed} failed\n`);
  suiteFinished();
  if (failed > 0) process.exit(1);
})();
