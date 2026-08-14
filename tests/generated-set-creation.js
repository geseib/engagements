/**
 * THE SET A GENERATION JOB LEAVES BEHIND — integration test.
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
 * than decorative: `attribute_not_exists(setCreationClaimedAt)` is the whole
 * idempotency guard, and a stub that ignored conditions would let a broken
 * guard pass.
 */
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

/** Only the one condition this code writes. Anything else is a test bug. */
function conditionHolds(condition, item) {
  const match = String(condition).match(/^attribute_not_exists\((\w+)\)$/);
  if (!match) throw new Error(`stub cannot evaluate ConditionExpression: ${condition}`);
  return item[match[1]] === undefined;
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
      if (cmd.input.ConditionExpression && !conditionHolds(cmd.input.ConditionExpression, existing)) {
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

// ---- The real handlers ----------------------------------------------------
const scenarios = require(path.join(REPO, 'lambda-functions/admin/ai-generate-scenarios.js')).handler;
const trivia = require(path.join(REPO, 'lambda-functions/admin/ai-generate-trivia.js')).handler;
const polls = require(path.join(REPO, 'lambda-functions/admin/ai-generate-polls.js')).handler;
const questions = require(path.join(REPO, 'lambda-functions/admin/ai-generate-questions.js')).handler;
const survey = require(path.join(REPO, 'lambda-functions/admin/ai-generate-survey.js')).handler;

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
}

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
async function runJob(handler, body, workerCtx = ctx()) {
  const started = await handler(adminEvent(body), ctx());
  const { jobId } = JSON.parse(started.body);
  const dispatch = dispatched[dispatched.length - 1].payload;
  await handler(dispatch, workerCtx);
  const polled = await handler(
    { requestContext: { http: { method: 'GET' } }, pathParameters: { jobId } }, ctx());
  return { started, jobId, dispatch, job: JSON.parse(polled.body) };
}

const setRows = () => [...ddb.values()].filter((row) => row.PK === 'SETS');
const questionRows = (setId) => [...ddb.values()]
  .filter((row) => row.PK === `SET#${setId}` && String(row.SK).startsWith('QUESTION#'))
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

  await test('the set and every question row are INACTIVE', async () => {
    // rejects: dropping `isAIGenerated: true` from the synthetic upload. That
    // one flag is what upload-questions.js:702 and :800 turn into
    // `active: false`, and without it the worker would publish a LIVE set
    // nobody has read — skipping the "AI-Generated Content - Review Required"
    // banner that is the entire point of landing it as a draft.
    reset();
    bedrockHandler = () => toolResponse(scenarioItems(3, 'draft'));
    await runJob(scenarios, scenarioBody({ count: 3 }));
    const set = setRows()[0];
    assert.strictEqual(set.active, false, 'the set was created live, not as a draft');
    assert.strictEqual(set.isAIGenerated, true, 'the set is not flagged as AI-written');
    const rows = questionRows(set.SK.replace('SET#', ''));
    assert.ok(rows.length > 0, 'no question rows were written');
    for (const row of rows) {
      assert.strictEqual(row.Active, false, `question ${row.SK} was created active`);
    }
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

  await test('an unidentifiable caller leaves the set unowned rather than owned by ""', async () => {
    // rejects: falling back to a username or to an empty string. isSetOwner
    // requires both halves to be non-empty precisely because `'' === ''` would
    // hand every legacy set to every unauthenticated request.
    reset();
    bedrockHandler = () => toolResponse(scenarioItems(2, 'anon'));
    const started = await scenarios(
      { requestContext: { http: { method: 'POST' } }, body: JSON.stringify(scenarioBody({ count: 2 })) },
      ctx());
    const { jobId } = JSON.parse(started.body);
    await scenarios(dispatched[dispatched.length - 1].payload, ctx());
    const set = setRows()[0];
    assert.ok(set, 'no set was created for an anonymous caller');
    assert.strictEqual(set.createdBy, undefined, 'an unattributable write recorded an owner of ""');
    assert.ok(jobId);
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
    const { job } = await runJob(scenarios, scenarioBody({ count: 2, roundKind: 'sideways' }));
    const set = setRows()[0];
    assert.ok(set, 'a typo in the round kind destroyed the whole set');
    assert.strictEqual(set.roundKind, undefined, 'an unrecognised kind was written to the row');
    assert.ok(job.createdSet, 'the job does not report the set it made');
  });

  await test('the poll worker carries its direction as well', async () => {
    // rejects: wiring the direction for scenarios only. A poll round can hand
    // the room somebody else's material exactly as a call-and-answer round can
    // — roundKindApplies lists both — so a poll set that forgets its kind has
    // the same defect.
    reset();
    bedrockHandler = () => toolResponse([
      { title: 'Which reading lands here', category: 'Ops', detail: 'A passage.',
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
    // rejects: removing the conditional `attribute_not_exists` claim on the job
    // row. Lambda retries an Event invoke by itself, so a second run of the
    // same worker is not hypothetical — and without the claim the second one
    // reaches the importer, is refused for a name already taken, and replaces a
    // job that had a set with a job that reports a failure.
    reset();
    bedrockHandler = () => toolResponse(scenarioItems(3, 'retry'));
    const { dispatch, jobId } = await runJob(scenarios, scenarioBody({ count: 3 }));

    await scenarios(dispatch, ctx());   // the platform's retry, byte-identical

    assert.strictEqual(setRows().length, 1, 'a retry minted a second set');
    const row = ddb.get(rowKey('AIJOBS', `AIJOB#${jobId}`));
    assert.strictEqual(row.setCreationError, undefined,
      `the retry reported "${row.setCreationError}" over a set that already existed`);
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
    const { jobId } = await runJob(scenarios, scenarioBody({ count: 2 }));
    const updates = writeLog.filter((w) => w.op === 'update' && w.sk === `AIJOB#${jobId}`);
    const createdAt = updates.findIndex((w) => /createdSetId/.test(w.expr));
    const terminalAt = updates.findIndex((w) => /:status/.test(w.expr) && /#items/.test(w.expr));
    assert.ok(createdAt >= 0, 'the set was never recorded on the job');
    assert.ok(terminalAt >= 0, 'the job never went terminal');
    assert.ok(createdAt < terminalAt,
      'the job went terminal before it carried its set — the client would create a second one');
  });

  await test('the poll payload names the set so the client need not make one', async () => {
    // rejects: creating the set server-side and not telling the client. The
    // review step would still show "Load N into System", the operator would
    // press it, and the importer would refuse — reporting a failure over a set
    // that exists.
    reset();
    bedrockHandler = () => toolResponse(scenarioItems(2, 'named'));
    const { job } = await runJob(scenarios, scenarioBody({ count: 2 }));
    assert.deepStrictEqual(job.createdSet, { setId: 'worldleaders', setName: 'World Leaders' });
    assert.strictEqual(job.setCreationError, null);
  });

  await test('a set that could not be created is reported, not hidden', async () => {
    // rejects: swallowing the importer's refusal. Without `setCreationError`
    // the client would see no set and no reason, and its fallback would look
    // like the builder had simply forgotten to do anything.
    reset();
    ddb.set(rowKey('SETS', 'SET#worldleaders'), { PK: 'SETS', SK: 'SET#worldleaders', name: 'World Leaders' });
    bedrockHandler = () => toolResponse(scenarioItems(2, 'clash'));
    const { job } = await runJob(scenarios, scenarioBody({ count: 2 }));
    assert.strictEqual(job.createdSet, null, 'an existing set was reported as newly created');
    assert.match(job.setCreationError, /already exists/i);
    assert.strictEqual(job.status, 'complete', 'a failed set creation must not fail the generation');
    assert.strictEqual(job.items.length, 2, 'the items were thrown away with the set');
  });

  await test('no title means no set, and the job says why', async () => {
    // rejects: inventing a title server-side. Every set id is a slug of its
    // title, so a made-up name collides with the next run's made-up name and
    // the second one is refused — a defect that only appears on the second use.
    reset();
    bedrockHandler = () => toolResponse(scenarioItems(2, 'untitled'));
    const { job } = await runJob(scenarios, { scenarioType: 'custom', engagementType: 'call-and-answer', count: 2 });
    assert.strictEqual(setRows().length, 0, 'a set was created with no title');
    assert.match(job.setCreationError, /title/i);
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

  await test('a survey generation creates NO set', async () => {
    // rejects: opting survey in. Survey is not a playable type and
    // upload-questions.js refuses it outright, which is why SurveyAIBuilder
    // exports JSON instead of loading — a worker trying to create one would be
    // asking for a 400 on every single run.
    reset();
    bedrockHandler = () => toolResponse([{
      question: 'How was it?', type: 'scale', category: 'Feedback', required: true, tags: ['feedback'],
    }]);
    const { job } = await runJob(survey, {
      count: 1,
      setMetadata: { title: 'Feedback Survey', description: 'd', customInstructions: 'c', aiContextInstructions: 'a' },
    });
    assert.strictEqual(setRows().length, 0, 'a survey set was created; nothing can play it');
    assert.strictEqual(job.createdSet, null);
    // Not merely "no set": no ATTEMPT. Opting survey in would reach the
    // importer, be refused for the engagement type, and leave a
    // setCreationError describing a problem nobody asked to have.
    assert.strictEqual(job.setCreationError, null,
      `survey tried to create a set and was refused: ${job.setCreationError}`);
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
    const { job } = await runJob(scenarios, scenarioBody({ count: perCall + 4 }));
    assert.strictEqual(job.status, 'error', 'the fixture did not actually fail');
    assert.ok(job.items.length > 0, 'the fixture produced nothing to save');
    assert.ok(job.createdSet, 'a partial run left no draft at all');
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
      title: 'Which release cadence', category: 'Delivery', detail: 'Pick one.',
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

  say(`\n${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exit(1);
})();
