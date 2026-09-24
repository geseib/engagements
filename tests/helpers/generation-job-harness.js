/**
 * Shared stub harness for the async generation-job Lambdas.
 *
 * The four converted builders (trivia, polls, questions, survey) differ only in
 * their tool schema, prompt and item shape — the AWS surface they touch is
 * identical, so stubbing it four times would mean four places to fix a stub bug.
 *
 * `install()` MUST run before the handler under test is required: it patches
 * Module._load to intercept the AWS SDK by module name, which only affects
 * requires that happen afterwards.
 *
 * tests/scenario-generation-job.js deliberately keeps its own inline copy. It is
 * the reference suite for the pattern and predates this helper; coupling it here
 * would mean a bug in this file could mask a regression in the one handler that
 * is already deployed.
 */
const Module = require('module');
const suiteFinished = require('./finish-guard');
const kmsStub = require('./tenant-crypto-stub');

const state = {
  ddb: new Map(),
  bedrockCalls: [],
  bedrockHandler: () => { throw new Error('no bedrock handler installed'); },
  dispatched: [],
  lambdaShouldFail: false,
  passed: 0,
  failed: 0,
};

const rowKey = (pk, sk) => `${pk}|${sk}`;

class GetCommand { constructor(input) { this.kind = 'get'; this.input = input; } }
class PutCommand { constructor(input) { this.kind = 'put'; this.input = input; } }
class UpdateCommand { constructor(input) { this.kind = 'update'; this.input = input; } }
class InvokeModelCommand { constructor(input) { this.input = input; } }
class InvokeCommand { constructor(input) { this.input = input; } }

/** Minimal `SET a = :x, #n = :y` applier — enough for the job record. */
function applyUpdate(item, input) {
  const expr = String(input.UpdateExpression).replace(/^SET\s+/i, '');
  for (const part of expr.split(/,\s*/)) {
    const [lhs, rhs] = part.split(/\s*=\s*/);
    const name = (input.ExpressionAttributeNames || {})[lhs] || lhs;
    item[name] = input.ExpressionAttributeValues[rhs];
  }
}

const docClient = {
  send: async (cmd) => {
    const { Key, Item } = cmd.input;
    if (cmd.kind === 'get') return { Item: state.ddb.get(rowKey(Key.PK, Key.SK)) || undefined };
    if (cmd.kind === 'put') { state.ddb.set(rowKey(Item.PK, Item.SK), { ...Item }); return {}; }
    if (cmd.kind === 'update') {
      const k = rowKey(Key.PK, Key.SK);
      const existing = state.ddb.get(k) || { ...Key };
      applyUpdate(existing, cmd.input);
      state.ddb.set(k, existing);
      return {};
    }
    throw new Error(`unexpected command ${cmd.kind}`);
  },
};

class BedrockRuntimeClient {
  async send(cmd) {
    const body = JSON.parse(cmd.input.body);
    state.bedrockCalls.push({ modelId: cmd.input.modelId, body, prompt: body.messages[0].content });
    return state.bedrockHandler(state.bedrockCalls.length, body);
  }
}

class LambdaClient {
  async send(cmd) {
    if (state.lambdaShouldFail) throw new Error('AccessDeniedException');
    state.dispatched.push({
      FunctionName: cmd.input.FunctionName,
      InvocationType: cmd.input.InvocationType,
      payload: JSON.parse(Buffer.from(cmd.input.Payload).toString('utf8')),
    });
    return {};
  }
}

/** Patch the AWS SDK by module name. Call BEFORE requiring the handler. */
function install() {
  process.env.TABLE_NAME = 'engage-test';
  process.env.ACCOUNT_ID = '000000000000';
  process.env.AWS_REGION = 'us-east-1';
  // A job started by a caller acting inside an organisation is sealed under
  // that organisation's key from its first write (shared/generation-jobs.js),
  // so every suite here needs a KMS that behaves like the key policy.
  process.env.TENANT_KMS_KEY_ID = 'alias/engage-tenant';

  const stubs = new Map([
    ['@aws-sdk/client-dynamodb', { DynamoDBClient: class {} }],
    ['@aws-sdk/lib-dynamodb', {
      DynamoDBDocumentClient: { from: () => docClient },
      GetCommand, PutCommand, UpdateCommand,
    }],
    ['@aws-sdk/client-bedrock-runtime', { BedrockRuntimeClient, InvokeModelCommand }],
    ['@aws-sdk/client-lambda', { LambdaClient, InvokeCommand }],
    ['@aws-sdk/client-kms', kmsStub.makeKmsStub().exports],
  ]);

  const realLoad = Module._load;
  Module._load = function (request, parent, isMain) {
    if (stubs.has(request)) return stubs.get(request);
    return realLoad.call(this, request, parent, isMain);
  };
  // Every org gets a stable, per-org test key with no METADATA row to seed.
  kmsStub.installTestKeyLoader();
}

function reset() {
  state.ddb.clear();
  state.bedrockCalls = [];
  state.dispatched = [];
  state.lambdaShouldFail = false;
}

/** Shape a Bedrock tool-use response. `extra` merges into the tool input. */
const toolResponse = (items, stopReason = 'tool_use', extra = {}) => ({
  body: new TextEncoder().encode(JSON.stringify({
    stop_reason: stopReason,
    content: [{ type: 'tool_use', name: 'emit_items', input: { items, ...extra } }],
  })),
});

async function test(name, fn) {
  try { await fn(); state.passed += 1; console.log(`  PASS  ${name}`); }
  catch (error) { state.failed += 1; console.log(`  FAIL  ${name}\n        ${error.message}`); }
}

/** Print the tally in the format the repo's aggregate command greps for. */
function summary() {
  suiteFinished();
  console.log(`\n${state.passed} passed, ${state.failed} failed\n`);
  if (state.failed > 0) process.exit(1);
}

/**
 * THE CALLER every POST and poll here carries, in this API's real authorizer
 * shape (require-admin.js's header). A job is read only by the user who started
 * it (shared/generation-jobs.js, isCallersJob), so the poll must be the same
 * person as the POST, and a POST with no user is refused. No groups and no
 * organisation, so a set the worker creates is filed exactly as before.
 */
const CALLER = { authorizer: { lambda: { userId: 'sub-harness', username: 'harness' } } };

/**
 * Build the POST/worker/poll driver for one handler. Each suite calls this once
 * with its own handler and function name.
 */
function makeRunner(handler, functionName) {
  const postEvent = (body, caller = CALLER) => ({
    requestContext: { http: { method: 'POST' }, ...caller },
    body: JSON.stringify(body),
  });
  const pollEvent = (jobId, caller = CALLER) => ({
    requestContext: { http: { method: 'GET' }, ...caller },
    pathParameters: { jobId },
  });
  const ctx = (remainingMs = 900000) => ({ functionName, getRemainingTimeInMillis: () => remainingMs });

  /** Start a job over HTTP, then run the worker the way Lambda's Event invoke would. */
  async function runJob(body, workerCtx = ctx()) {
    const started = await handler(postEvent(body), ctx());
    const { jobId } = JSON.parse(started.body);
    await handler({ __workerMode: true, jobId, payload: body }, workerCtx);
    const polled = await handler(pollEvent(jobId), ctx());
    return { started, jobId, job: JSON.parse(polled.body) };
  }

  return { postEvent, pollEvent, ctx, runJob };
}

module.exports = { state, install, reset, toolResponse, test, summary, makeRunner, docClient, CALLER };
