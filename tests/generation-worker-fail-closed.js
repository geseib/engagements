/**
 * A GENERATION WORKER THAT CANNOT SAY WHO ASKED DOES NOTHING.
 *
 * The async AI workers are self-invoked with `InvocationType: 'Event'`, which
 * carries no authorizer context, so they read WHO ASKED off their own job row
 * (shared/generated-set.js, note 3). Both copies of that read —
 * shared/generation-handler.js's `runWorker` and ai-generate-scenarios.js's
 * inline one — caught a failed read, logged it, and carried on with
 * `caller = {}`. A row that was absent, or that named no user, did the same.
 *
 * An empty caller is not a neutral default. It is two defects at once:
 *
 *   1. `sealFor` became '', so every write the worker made — progress,
 *      completion, failure, the created set's name — put the organisation's
 *      generated content on the PK=AIJOBS row in PLAINTEXT, although
 *      ENCRYPTED_FIELDS.job says it is sealed under the org's key.
 *   2. `createSetForJob` replayed that empty caller into the importer, and
 *      `createSetRef` reads no-groups-AND-no-org as an INTERNAL invocation: the
 *      set was filed in Engage's shared PLATFORM library, readable by every
 *      organisation. The same tenancy leak generated-set.js exists to close,
 *      reached through a failed read instead of through the POST.
 *
 * So the worker fails CLOSED, before Bedrock and before any write:
 *
 *   - a read that THROWS is rethrown. The handler rejects, and Lambda's async
 *     retry re-reads the row. Nothing has been spent or written yet, so the
 *     retry pays for Bedrock exactly once.
 *   - a row that is ABSENT is the end of it: nothing to write to (an update
 *     would create an un-expiring orphan row) and nothing a retry would change.
 *     The read is strongly consistent, so "absent" is the truth and not a
 *     replica that has not yet seen the POST's write.
 *   - a row that names NO USER is failed with a sentence and generates nothing:
 *     a job nobody owns can never be read back (isCallersJob), and its set
 *     would be filed as an internal write.
 *
 * AND A WORKER GENERATES ONLY FOR A JOB IT TOOK. The caller read cannot tell a
 * first delivery from a second — the row names the same user either way — and
 * everything after Bedrock can throw: completeJob or failJob (DynamoDB, or KMS
 * sealing the items), or a progress write. That escaped runWorker, Lambda
 * retried the invoke, and the retry paid for the whole generation again; a
 * duplicate dispatch did the same with no failure at all. So after the caller
 * read, the worker moves its job 'queued' → 'running' with a conditional write
 * (generation-jobs.js, claimJob), and a delivery that loses does nothing.
 *
 * Both workers are driven for real — the factory through ai-generate-trivia and
 * the inline copy through ai-generate-scenarios — with the REAL upload-questions
 * importer behind them, so "no platform set" is asserted against the code that
 * would have written one. Only DynamoDB, Bedrock, the self-invoke and KMS are
 * stubbed, by module name, as tests/generated-set-creation.js does.
 *
 * rejects: a worker that generates after its caller read threw; one that
 * swallows that throw so Lambda never retries; one that writes an org's content
 * to its job row in plaintext; one that files a set in the platform library for
 * a caller it could not establish; one that recreates a job row that is gone;
 * one that generates for a row naming no user; one that loses a job to a stale
 * read of the row its own POST just wrote; a retry that pays for Bedrock twice;
 * a second delivery, or two at once, generating a job already taken; the retry
 * of a run whose completeJob or failJob threw generating again; a claim that
 * swallows an unreachable table; createSetForJob filing a set for an empty
 * caller, or for an organisation it holds no role in.
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
process.env.TENANT_KMS_KEY_ID = 'alias/test-tenant-key';
process.env.ACCOUNT_ID = '000000000000';
process.env.AWS_REGION = 'us-east-1';

// ---- DynamoDB -------------------------------------------------------------
const ddb = new Map();
const rowKey = (pk, sk) => `${pk}|${sk}`;
/** Every write, in order, so "the worker wrote nothing" is a checkable claim. */
let writeLog = [];
/** Every read of a job row, with the input it was made with. */
let jobReads = [];

/*
  THE FAULTS THIS SUITE INJECTS, all on reads of a PK=AIJOBS row.

  `jobReadThrows` — the next N reads throw, as a GetItem does when DynamoDB is
  unreachable or throttles past the SDK's own retries.

  `staleJobRead` — an EVENTUALLY consistent read returns no item. That is what a
  replica that has not yet applied the POST's put answers, and the worker's read
  happens moments after it. A `ConsistentRead: true` read always sees the row,
  which is DynamoDB's documented guarantee and the only one this models.

  And on WRITES to a PK=AIJOBS row, the faults that strike after Bedrock has
  been paid for:

  `terminalWriteThrows` — the next N writes that take the job to that status
  throw: `complete` is completeJob, `error` is failJob. That is DynamoDB
  refusing the write, or KMS failing to seal the items it carries.

  `claimWriteThrows` — the next N CONDITIONAL writes to a job row throw with
  something other than a failed condition: the table unreachable at the moment
  the worker takes the job.
*/
const faults = {
  jobReadThrows: 0,
  staleJobRead: false,
  terminalWriteThrows: { complete: 0, error: 0 },
  claimWriteThrows: 0,
};
const serviceUnavailable = () => Object.assign(new Error('Service unavailable'), { name: 'ServiceUnavailable' });

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
 * `attribute_not_exists(x)` and the worker's `#status = :queued` claim.
 * Anything else is a test bug.
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
    if (cmd.kind === 'get') {
      if (Key.PK === 'AIJOBS') {
        jobReads.push({ ...cmd.input });
        if (faults.jobReadThrows > 0) {
          faults.jobReadThrows -= 1;
          throw serviceUnavailable();
        }
        if (faults.staleJobRead && cmd.input.ConsistentRead !== true) return { Item: undefined };
      }
      return { Item: ddb.get(rowKey(Key.PK, Key.SK)) || undefined };
    }
    if (cmd.kind === 'put') {
      ddb.set(rowKey(Item.PK, Item.SK), { ...Item });
      writeLog.push({ op: 'put', pk: Item.PK, sk: Item.SK });
      return {};
    }
    if (cmd.kind === 'update') {
      if (Key.PK === 'AIJOBS') {
        const status = (cmd.input.ExpressionAttributeValues || {})[':status'];
        if (faults.terminalWriteThrows[status] > 0) {
          faults.terminalWriteThrows[status] -= 1;
          throw serviceUnavailable();
        }
        if (cmd.input.ConditionExpression && faults.claimWriteThrows > 0) {
          faults.claimWriteThrows -= 1;
          throw serviceUnavailable();
        }
      }
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
let bedrockCalls = 0;
let bedrockItems = [];
/** The next N calls fail as the model would, after they have been paid for. */
let bedrockThrows = 0;
class InvokeModelCommand { constructor(input) { this.input = input; } }
class BedrockRuntimeClient {
  async send() {
    bedrockCalls += 1;
    if (bedrockThrows > 0) {
      bedrockThrows -= 1;
      throw Object.assign(new Error('ModelErrorException: the model failed'), { name: 'ModelErrorException' });
    }
    return {
      body: new TextEncoder().encode(JSON.stringify({
        stop_reason: 'tool_use',
        content: [{ type: 'tool_use', name: 'emit_items', input: { items: bedrockItems } }],
      })),
    };
  }
}
stub('@aws-sdk/client-bedrock-runtime', { BedrockRuntimeClient, InvokeModelCommand });

// ---- Lambda (self-invoke) -------------------------------------------------
let dispatched = [];
class InvokeCommand { constructor(input) { this.input = input; } }
class LambdaClient {
  async send(cmd) {
    dispatched.push(JSON.parse(Buffer.from(cmd.input.Payload).toString('utf8')));
    return {};
  }
}
stub('@aws-sdk/client-lambda', { LambdaClient, InvokeCommand });

// ---- KMS: refuses a Decrypt whose context disagrees, like the key policy ---
const { makeKmsStub, mintOrg, forgetAllOrgs } = require('./helpers/tenant-crypto-stub');
stub('@aws-sdk/client-kms', makeKmsStub().exports);

// ---- The real handlers ----------------------------------------------------
const trivia = require(path.join(REPO, 'lambda-functions/admin/ai-generate-trivia.js')).handler;
const scenarios = require(path.join(REPO, 'lambda-functions/admin/ai-generate-scenarios.js')).handler;
const { createSetForJob, scenariosToCsv } = require(path.join(REPO, 'lambda-functions/admin/shared/generated-set.js'));

// The handlers narrate every step; this suite's own lines go to stdout directly.
if (!process.env.DEBUG) { console.log = () => {}; console.error = () => {}; console.warn = () => {}; }
const say = (...a) => process.stdout.write(a.join(' ') + '\n');

let passed = 0; let failed = 0;
async function test(name, fn) {
  try { await fn(); passed += 1; say(`  PASS  ${name}`); }
  catch (error) { failed += 1; say(`  FAIL  ${name}\n        ${error.message}`); }
}

const ORG = 'org_acme';

function reset() {
  ddb.clear();
  writeLog = [];
  jobReads = [];
  dispatched = [];
  bedrockCalls = 0;
  bedrockItems = [];
  bedrockThrows = 0;
  faults.jobReadThrows = 0;
  faults.staleJobRead = false;
  faults.terminalWriteThrows = { complete: 0, error: 0 };
  faults.claimWriteThrows = 0;
  forgetAllOrgs();
}

/** Give the org a wrapped data key, so its job row can be sealed at birth. */
const mint = () => mintOrg((item) => ddb.set(rowKey(item.PK, item.SK), item), ORG);

/** A customer's host acting inside their organisation, in the authorizer's real shape. */
const hostAuthorizer = {
  lambda: {
    username: 'hal', userId: 'sub-hal', groups: 'hosts', status: 'enabled',
    orgId: ORG, orgRole: 'owner', orgIds: ORG,
  },
};
const post = (body) => ({
  requestContext: { http: { method: 'POST' }, authorizer: hostAuthorizer },
  body: JSON.stringify(body),
});
const ctx = () => ({ functionName: 'engagedev-admin-ai-generate', getRemainingTimeInMillis: () => 900000 });

const jobRow = (jobId) => ddb.get(rowKey('AIJOBS', `AIJOB#${jobId}`));
const platformSets = () => [...ddb.values()].filter((row) => row.PK === 'SETS');
const orgSets = () => [...ddb.values()].filter((row) => row.PK === `ORG#${ORG}#SETS`);
const isEnvelope = (v) => !!v && typeof v === 'object' && !Array.isArray(v)
  && typeof v.v === 'number' && typeof v.iv === 'string'
  && typeof v.tag === 'string' && typeof v.ct === 'string';
/** Writes to a job row made AFTER index `from` in the write log. */
const jobWritesSince = (jobId, from) => writeLog.slice(from)
  .filter((w) => w.pk === 'AIJOBS' && w.sk === `AIJOB#${jobId}`);

/** Every job-row field ENCRYPTED_FIELDS.job names must be an envelope when present. */
function assertSealedAtRest(row, when) {
  for (const field of ['items', 'request', 'meta']) {
    if (row[field] === undefined) continue;
    assert.ok(isEnvelope(row[field]),
      `${when}: the org's "${field}" sat on the job row in plaintext: ${JSON.stringify(row[field]).slice(0, 120)}`);
  }
}

const SUBJECTS = ['onboarding a remote hire', 'escalating a security incident', 'renegotiating a vendor contract'];

/*
  The two workers. `factory` is shared/generation-handler.js's runWorker, driven
  through ai-generate-trivia; `inline` is ai-generate-scenarios.js's own copy.
  Both generate a whole set, so both reach createSetForJob — which is the path
  that files an empty caller's set in the platform library.
*/
const WORKERS = [
  {
    name: 'factory worker (trivia)',
    handler: trivia,
    body: () => ({
      topic: 'Leadership', count: 2,
      setMetadata: { title: 'Leadership Trivia', description: 'd', customInstructions: 'c', aiContextInstructions: 'a' },
    }),
    items: () => SUBJECTS.slice(0, 2).map((subject, i) => ({
      title: `Trivia about ${subject}`, questionDetail: `Question ${i + 1}?`, category: 'General',
      optionA: 'Yes', optionB: 'No', optionC: 'Maybe', optionD: 'Never',
      correctAnswer: 'OptionA', answerDetails: 'Because.', difficulty: 'easy', tags: ['leadership'],
    })),
  },
  {
    name: 'inline worker (scenarios)',
    handler: scenarios,
    body: () => ({
      scenarioType: 'custom', engagementType: 'call-and-answer', count: 2,
      setMetadata: { title: 'World Leaders', description: 'd', customInstructions: 'c', aiContextInstructions: 'a' },
    }),
    items: () => SUBJECTS.slice(0, 2).map((subject, i) => ({
      title: `Scenario: ${subject}`, category: 'Category 1',
      detail: `Detail ${i + 1}.`, customInstructions: 'Discuss.', tags: ['leadership'],
    })),
  },
];

/** POST as the org host; return the job id and the payload the worker would get. */
async function start(worker) {
  const started = await worker.handler(post(worker.body()), ctx());
  assert.strictEqual(started.statusCode, 202, `the POST did not start a job: ${started.body}`);
  const { jobId } = JSON.parse(started.body);
  return { jobId, dispatch: dispatched[dispatched.length - 1] };
}

/** Run the worker as Lambda's Event invoke would. Resolves to 'ok' or the error it threw. */
async function invokeWorker(worker, dispatch) {
  try {
    await worker.handler(dispatch, ctx());
    return 'ok';
  } catch (error) {
    return error;
  }
}

// ===========================================================================
(async function run() {
  for (const worker of WORKERS) {
    say(`\n${worker.name}`);

    await test('a caller read that THROWS spends nothing, writes nothing, and rethrows for a retry', async () => {
      // rejects: catching the failed read and carrying on with `caller = {}` —
      // which paid for Bedrock, wrote the org's items to the job row in
      // plaintext, and filed its set in Engage's platform library. Also rejects
      // swallowing the throw: the invocation must FAIL so Lambda re-reads.
      reset();
      await mint();
      bedrockItems = worker.items();
      const { jobId, dispatch } = await start(worker);
      const before = writeLog.length;

      faults.jobReadThrows = 1;
      const outcome = await invokeWorker(worker, dispatch);

      assert.notStrictEqual(outcome, 'ok',
        'the worker swallowed its failed caller read, so Lambda will never retry it');
      assert.strictEqual(bedrockCalls, 0, 'Bedrock was paid for a job whose caller was unknown');
      assert.deepStrictEqual(jobWritesSince(jobId, before), [],
        'the worker wrote to its job row without knowing whose content it was');
      assertSealedAtRest(jobRow(jobId), 'after the failed read');
      assert.strictEqual(jobRow(jobId).status, 'queued', 'the job moved on without a caller');
      assert.deepStrictEqual(platformSets(), [],
        'an org\'s generated set was filed in Engage\'s shared platform library');
      assert.deepStrictEqual(orgSets(), [], 'a set was created for a job that never ran');
    });

    await test('the retry after a thrown read generates ONCE, sealed, into the org', async () => {
      // rejects: a design in which the first attempt spent anything, so that
      // Lambda's retry pays for Bedrock a second time; and a retry that lands
      // anywhere but the asking organisation.
      reset();
      await mint();
      bedrockItems = worker.items();
      const { jobId, dispatch } = await start(worker);

      faults.jobReadThrows = 1;
      await invokeWorker(worker, dispatch);
      const retried = await invokeWorker(worker, dispatch);

      assert.strictEqual(retried, 'ok', `the retry failed: ${retried && retried.message}`);
      assert.strictEqual(bedrockCalls, 1, `Bedrock was called ${bedrockCalls} times across the retry`);
      const row = jobRow(jobId);
      assert.strictEqual(row.status, 'complete');
      assertSealedAtRest(row, 'after the retry');
      assert.deepStrictEqual(platformSets(), [], 'the retry filed the set in the platform library');
      assert.strictEqual(orgSets().length, 1, 'the retry did not create the org\'s set');
    });

    await test('an ABSENT row is the end of it: nothing generated, nothing recreated', async () => {
      // rejects: generating for a job row that does not exist — an invocation
      // nobody authorised — and upserting a fresh AIJOBS row with no owner and
      // no ttl, which would never expire.
      reset();
      await mint();
      bedrockItems = worker.items();
      const { jobId, dispatch } = await start(worker);
      ddb.delete(rowKey('AIJOBS', `AIJOB#${jobId}`));
      const before = writeLog.length;

      const outcome = await invokeWorker(worker, dispatch);

      assert.strictEqual(outcome, 'ok',
        `an absent row is not worth a retry — nothing will have changed: ${outcome && outcome.message}`);
      assert.strictEqual(bedrockCalls, 0, 'Bedrock was paid for a job with no row');
      assert.deepStrictEqual(jobWritesSince(jobId, before), [], 'the worker recreated a job row that was gone');
      assert.strictEqual(jobRow(jobId), undefined, 'an orphan job row now exists');
      assert.deepStrictEqual(platformSets(), [], 'a set was filed in the platform library');
      assert.deepStrictEqual(orgSets(), []);
    });

    await test('a row that names NO USER generates nothing and is failed with a sentence', async () => {
      // rejects: generating for a row written before anonymous POSTs were
      // refused with 401. Nobody can ever read that job back (isCallersJob),
      // and its set would be filed as an internal write, in the platform
      // library. Also rejects the refusal writing any content.
      reset();
      await mint();
      bedrockItems = worker.items();
      const { jobId, dispatch } = await start(worker);
      const row = jobRow(jobId);
      delete row.callerUserId;
      delete row.callerUsername;

      const outcome = await invokeWorker(worker, dispatch);

      assert.strictEqual(outcome, 'ok', 'a row with no user is a refusal, not a fault to retry');
      assert.strictEqual(bedrockCalls, 0, 'Bedrock was paid for a job nobody owns');
      const after = jobRow(jobId);
      assert.strictEqual(after.status, 'error', `the unowned job was left "${after.status}"`);
      assert.match(String(after.errorMessage), /\S/, 'the refusal carries no sentence');
      assertSealedAtRest(after, 'after the refusal');
      assert.deepStrictEqual(platformSets(), [], 'an unowned job filed its set in the platform library');
      assert.deepStrictEqual(orgSets(), []);
    });

    await test('a stale replica cannot lose the job: the worker reads its own row consistently', async () => {
      // rejects: an eventually consistent read of a row the POST wrote moments
      // earlier. A replica that has not applied the put answers "no item", and
      // a worker that trusted it either dropped a real job or — before this
      // change — ran it as nobody.
      reset();
      await mint();
      bedrockItems = worker.items();
      const { jobId, dispatch } = await start(worker);

      faults.staleJobRead = true;
      const outcome = await invokeWorker(worker, dispatch);

      assert.strictEqual(outcome, 'ok', `the worker failed: ${outcome && outcome.message}`);
      assert.strictEqual(bedrockCalls, 1, 'the job was lost to a stale read');
      assert.strictEqual(jobRow(jobId).status, 'complete');
      assertSealedAtRest(jobRow(jobId), 'after a stale-replica start');
      assert.strictEqual(orgSets().length, 1);
      assert.deepStrictEqual(platformSets(), []);
    });

    // ---- A JOB IS GENERATED ONCE, however often its worker is delivered ----
    //
    // Lambda delivers an Event invoke at least once and retries a failed one
    // twice, and the caller read above is not the only thing that can fail:
    // everything after Bedrock can throw too. Each of these rejects a worker
    // that generates for a job it did not take from 'queued' itself.

    await test('a SECOND DELIVERY of a finished job pays for nothing and writes nothing', async () => {
      // rejects: a worker that re-reads its caller and generates again. The
      // row names the same user either way, so the caller read alone cannot
      // tell a first delivery from a second.
      reset();
      await mint();
      bedrockItems = worker.items();
      const { jobId, dispatch } = await start(worker);
      assert.strictEqual(await invokeWorker(worker, dispatch), 'ok', 'the first delivery failed');
      const finished = { ...jobRow(jobId) };
      const before = writeLog.length;

      const again = await invokeWorker(worker, dispatch);

      assert.strictEqual(again, 'ok', `a job already taken is not a fault to retry: ${again && again.message}`);
      assert.strictEqual(bedrockCalls, 1, `Bedrock was called ${bedrockCalls} times for one job`);
      assert.deepStrictEqual(jobWritesSince(jobId, before), [], 'the second delivery wrote to a finished job');
      assert.deepStrictEqual(jobRow(jobId), finished, 'the second delivery changed a finished job');
      assert.strictEqual(orgSets().length, 1);
    });

    await test('two deliveries AT ONCE generate once between them', async () => {
      // rejects: checking the status with a read and then generating. Both
      // deliveries read 'queued' before either writes 'running'; only a
      // conditional write lets exactly one of them through.
      reset();
      await mint();
      bedrockItems = worker.items();
      const { jobId, dispatch } = await start(worker);

      const outcomes = await Promise.all([invokeWorker(worker, dispatch), invokeWorker(worker, dispatch)]);

      assert.deepStrictEqual(outcomes, ['ok', 'ok'], `a delivery failed: ${outcomes.map((o) => o && o.message)}`);
      assert.strictEqual(bedrockCalls, 1, `Bedrock was called ${bedrockCalls} times for one job`);
      assert.strictEqual(jobRow(jobId).status, 'complete');
      assertSealedAtRest(jobRow(jobId), 'after two deliveries');
      assert.strictEqual(orgSets().length, 1);
      assert.deepStrictEqual(platformSets(), []);
    });

    await test('a completeJob that THROWS, then Lambda\'s retry, pays for Bedrock once', async () => {
      // rejects: letting the retry of a run that failed only while sealing its
      // result generate the whole thing again. The first attempt paid for
      // Bedrock and created the set; the retry finds the job already taken.
      reset();
      await mint();
      bedrockItems = worker.items();
      const { jobId, dispatch } = await start(worker);

      faults.terminalWriteThrows.complete = 1;
      const first = await invokeWorker(worker, dispatch);
      assert.notStrictEqual(first, 'ok', 'the fixture\'s completeJob did not throw, so Lambda would not retry');
      const retried = await invokeWorker(worker, dispatch);

      assert.strictEqual(retried, 'ok', `the retry failed: ${retried && retried.message}`);
      assert.strictEqual(bedrockCalls, 1, `Bedrock was called ${bedrockCalls} times across the retry`);
      assertSealedAtRest(jobRow(jobId), 'after the retry');
      assert.strictEqual(orgSets().length, 1, 'the set the first attempt created is gone, or doubled');
      assert.deepStrictEqual(platformSets(), []);
    });

    await test('a failJob that THROWS, then Lambda\'s retry, pays for Bedrock once', async () => {
      // rejects: the same on the failure path. Bedrock was called and failed —
      // still paid for — and the write recording that failure threw.
      reset();
      await mint();
      bedrockItems = worker.items();
      const { jobId, dispatch } = await start(worker);

      // Two: invokeStructured falls back from Sonnet to Haiku before a pass fails.
      bedrockThrows = 2;
      faults.terminalWriteThrows.error = 1;
      const first = await invokeWorker(worker, dispatch);
      assert.notStrictEqual(first, 'ok', 'the fixture\'s failJob did not throw, so Lambda would not retry');
      const paid = bedrockCalls;
      const retried = await invokeWorker(worker, dispatch);

      assert.strictEqual(retried, 'ok', `the retry failed: ${retried && retried.message}`);
      assert.strictEqual(bedrockCalls - paid, 0, `the retry called Bedrock ${bedrockCalls - paid} more times`);
      assertSealedAtRest(jobRow(jobId), 'after the retry');
      assert.deepStrictEqual(orgSets(), [], 'the retry generated a set the first attempt never had');
      assert.deepStrictEqual(platformSets(), []);
    });

    await test('a claim that THROWS spends nothing and rethrows, and the retry generates once', async () => {
      // rejects: treating any failed claim as "somebody else has it". Only a
      // failed CONDITION means that; an unreachable table means nobody has
      // it yet, and swallowing that would strand the job at 'queued'.
      reset();
      await mint();
      bedrockItems = worker.items();
      const { jobId, dispatch } = await start(worker);

      faults.claimWriteThrows = 1;
      const first = await invokeWorker(worker, dispatch);

      assert.notStrictEqual(first, 'ok', 'the worker swallowed a failed claim, so Lambda will never retry it');
      assert.strictEqual(bedrockCalls, 0, 'Bedrock was paid for a job the worker never took');
      assert.strictEqual(jobRow(jobId).status, 'queued');

      const retried = await invokeWorker(worker, dispatch);
      assert.strictEqual(retried, 'ok', `the retry failed: ${retried && retried.message}`);
      assert.strictEqual(bedrockCalls, 1);
      assert.strictEqual(jobRow(jobId).status, 'complete');
      assertSealedAtRest(jobRow(jobId), 'after the retry');
      assert.strictEqual(orgSets().length, 1);
    });
  }

  say('\ncreateSetForJob, on its own');

  const spec = { engagementType: 'call-and-answer', toCsv: (items) => scenariosToCsv(items) };
  const payload = { setMetadata: { title: 'Nobody\'s Set', description: 'd' } };
  const items = WORKERS[1].items();

  await test('an EMPTY caller files no set anywhere', async () => {
    // rejects: replaying `{}` into the importer, which createSetRef reads as an
    // internal invocation and files in Engage's shared platform library. A
    // generated set always has somebody who asked; with nobody, there is none.
    reset();
    const created = await createSetForJob({
      dynamodb: docClient, tableName: 'engage-test', jobId: 'job-empty', spec, payload, items, caller: {},
    });
    assert.strictEqual(created, null, `a set was created for nobody: ${JSON.stringify(created)}`);
    assert.deepStrictEqual(platformSets(), [], 'an empty caller filed a set in the platform library');
  });

  await test('an organisation WITHOUT a role files no set anywhere', async () => {
    // rejects: syntheticUploadEvent dropping an org it holds no role for, which
    // leaves no groups and no org — the internal shape — and files the org's
    // generated set in the platform library instead of refusing it.
    reset();
    await mint();
    const created = await createSetForJob({
      dynamodb: docClient, tableName: 'engage-test', jobId: 'job-norole', spec, payload, items,
      caller: { userId: 'sub-hal', username: 'hal', orgId: ORG },
    });
    assert.strictEqual(created, null, `a set was created with no role: ${JSON.stringify(created)}`);
    assert.deepStrictEqual(platformSets(), [], 'an org\'s set was filed in the platform library');
    assert.deepStrictEqual(orgSets(), []);
  });

  say(`\n${passed} passed, ${failed} failed\n`);
  suiteFinished();
  if (failed > 0) process.exit(1);
})();
