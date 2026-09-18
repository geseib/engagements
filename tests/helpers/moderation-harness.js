/**
 * STUB HARNESS FOR THE MODERATION PIPELINE — check job, appeal, publish-from-
 * snapshot, and (later) the queue decisions.
 *
 * Why not reuse generation-job-harness.js: its DynamoDB stub knows Get/Put/
 * Update only and evaluates no conditions, and the whole point of the check
 * job's lock is a ConditionExpression. A harness that ignores conditions would
 * pass the lock test whether or not the lock existed.
 *
 * `install()` MUST run before the handler under test is required.
 */
const Module = require('module');
const path = require('path');
const REPO = path.join(__dirname, '..', '..');
const cryptoStub = require('./tenant-crypto-stub');

const state = {
  ddb: new Map(), s3: new Map(),
  guardrailReplies: [], sentGuardrail: [],
  haikuReplies: [], sentHaiku: [],
  dispatched: [], lambdaShouldFail: false,
  passed: 0, failed: 0,
};
const rowKey = (pk, sk) => `${pk}|${sk}`;
class Cmd { constructor(kind, input) { this.kind = kind; this.input = input; } }
class GetCommand extends Cmd { constructor(i) { super('get', i); } }
class PutCommand extends Cmd { constructor(i) { super('put', i); } }
class UpdateCommand extends Cmd { constructor(i) { super('update', i); } }
class DeleteCommand extends Cmd { constructor(i) { super('delete', i); } }
class QueryCommand extends Cmd { constructor(i) { super('query', i); } }
class BatchWriteCommand extends Cmd { constructor(i) { super('batchWrite', i); } }

const conditionFailed = () => Object.assign(new Error('The conditional request failed'), { name: 'ConditionalCheckFailedException' });
const resolveName = (token, names) => (names && names[token]) || token;
const resolveValue = (token, values) => (values && token in values ? values[token] : token);

/** One-level `A OR B OR C` / `A AND B`; clauses: attribute_(not_)exists, =, <>, <, <=, >, >=, IN. */
function evalCondition(expr, item, names, values) {
  const or = expr.split(/\s+OR\s+/);
  if (or.length > 1) return or.some((c) => evalCondition(c, item, names, values));
  const and = expr.split(/\s+AND\s+/);
  if (and.length > 1) return and.every((c) => evalCondition(c, item, names, values));
  const c = expr.trim().replace(/^\((.*)\)$/, '$1');
  let m;
  if ((m = /^attribute_not_exists\((.+)\)$/.exec(c))) return !item || !(resolveName(m[1], names) in item);
  if ((m = /^attribute_exists\((.+)\)$/.exec(c))) return Boolean(item) && resolveName(m[1], names) in item;
  if ((m = /^(\S+)\s+IN\s+\((.+)\)$/.exec(c))) {
    const v = item ? item[resolveName(m[1], names)] : undefined;
    return m[2].split(',').map((s) => resolveValue(s.trim(), values)).includes(v);
  }
  if ((m = /^(\S+)\s*(<>|<=|>=|=|<|>)\s*(\S+)$/.exec(c))) {
    const left = item ? item[resolveName(m[1], names)] : undefined;
    const right = resolveValue(m[3], values);
    if (left === undefined) return false;
    switch (m[2]) {
      case '=': return left === right; case '<>': return left !== right;
      case '<': return left < right; case '<=': return left <= right;
      case '>': return left > right; case '>=': return left >= right;
      default: return false;
    }
  }
  throw new Error(`moderation-harness: unsupported condition ${JSON.stringify(c)}`);
}

/** `SET a = :x, #n = :y ADD c :n REMOVE d` — each keyword section optional. */
function applyUpdate(item, input) {
  const expr = String(input.UpdateExpression);
  const names = input.ExpressionAttributeNames || {};
  const values = input.ExpressionAttributeValues || {};
  const sections = {};
  const re = /\b(SET|ADD|REMOVE)\b/g;
  const parts = expr.split(re).map((s) => s.trim()).filter(Boolean);
  for (let i = 0; i < parts.length; i += 2) sections[parts[i]] = parts[i + 1] || '';
  for (const assignment of (sections.SET || '').split(/,\s*/).filter(Boolean)) {
    const [lhs, rhs] = assignment.split(/\s*=\s*/);
    item[resolveName(lhs, names)] = resolveValue(rhs, values);
  }
  for (const add of (sections.ADD || '').split(/,\s*/).filter(Boolean)) {
    const [lhs, rhs] = add.trim().split(/\s+/);
    const k = resolveName(lhs, names);
    item[k] = (Number(item[k]) || 0) + Number(resolveValue(rhs, values));
  }
  for (const rem of (sections.REMOVE || '').split(/,\s*/).filter(Boolean)) delete item[resolveName(rem, names)];
}

const docClient = {
  send: async (cmd) => {
    const inp = cmd.input || {};
    switch (cmd.kind) {
      case 'get': { const it = state.ddb.get(rowKey(inp.Key.PK, inp.Key.SK)); return { Item: it ? JSON.parse(JSON.stringify(it)) : undefined }; }
      case 'put': {
        const k = rowKey(inp.Item.PK, inp.Item.SK);
        if (inp.ConditionExpression && !evalCondition(inp.ConditionExpression, state.ddb.get(k), inp.ExpressionAttributeNames, inp.ExpressionAttributeValues)) throw conditionFailed();
        state.ddb.set(k, JSON.parse(JSON.stringify(inp.Item))); return {};
      }
      case 'update': {
        const k = rowKey(inp.Key.PK, inp.Key.SK);
        const existing = state.ddb.get(k);
        if (inp.ConditionExpression && !evalCondition(inp.ConditionExpression, existing, inp.ExpressionAttributeNames, inp.ExpressionAttributeValues)) throw conditionFailed();
        const item = existing ? JSON.parse(JSON.stringify(existing)) : { ...inp.Key };
        applyUpdate(item, inp);
        state.ddb.set(k, item);
        return { Attributes: JSON.parse(JSON.stringify(item)) };
      }
      case 'delete': {
        const k = rowKey(inp.Key.PK, inp.Key.SK);
        if (inp.ConditionExpression && !evalCondition(inp.ConditionExpression, state.ddb.get(k), inp.ExpressionAttributeNames, inp.ExpressionAttributeValues)) throw conditionFailed();
        state.ddb.delete(k); return {};
      }
      case 'batchWrite': {
        for (const reqs of Object.values(inp.RequestItems || {})) {
          for (const r of reqs) {
            if (r.PutRequest) state.ddb.set(rowKey(r.PutRequest.Item.PK, r.PutRequest.Item.SK), JSON.parse(JSON.stringify(r.PutRequest.Item)));
            else if (r.DeleteRequest) state.ddb.delete(rowKey(r.DeleteRequest.Key.PK, r.DeleteRequest.Key.SK));
          }
        }
        return { UnprocessedItems: {} };
      }
      case 'query': {
        const v = inp.ExpressionAttributeValues || {};
        // ddb-delete.js's collectPartitionKeys names its placeholder `:setpk`,
        // not `:pk` — accept either so a caller that queries a whole partition
        // for deletion (unpublishSet among them) is not silently answered [].
        const pk = v[':pk'] !== undefined ? v[':pk'] : v[':setpk'];
        const prefix = v[':sk'] || '';
        const items = [...state.ddb.values()]
          .filter((i) => i.PK === pk && String(i.SK).startsWith(String(prefix)))
          .sort((a, b) => (a.SK < b.SK ? -1 : a.SK > b.SK ? 1 : 0))
          .map((i) => JSON.parse(JSON.stringify(i)));
        if (inp.ScanIndexForward === false) items.reverse();
        return { Items: items, Count: items.length };
      }
      default: throw new Error(`moderation-harness: unexpected command ${cmd.kind}`);
    }
  },
};

class S3Client {
  async send(cmd) {
    const { Bucket, Key, Body } = cmd.input;
    const k = `${Bucket}/${Key}`;
    if (cmd.kind === 'putObject') { state.s3.set(k, String(Body)); return {}; }
    if (cmd.kind === 'getObject') {
      if (!state.s3.has(k)) throw Object.assign(new Error('NoSuchKey'), { name: 'NoSuchKey' });
      const body = state.s3.get(k);
      return { Body: { transformToString: async () => body } };
    }
    if (cmd.kind === 'deleteObject') { state.s3.delete(k); return {}; }
    throw new Error(`moderation-harness: unexpected S3 command ${cmd.kind}`);
  }
}
class PutObjectCommand extends Cmd { constructor(i) { super('putObject', i); } }
class GetObjectCommand extends Cmd { constructor(i) { super('getObject', i); } }
class DeleteObjectCommand extends Cmd { constructor(i) { super('deleteObject', i); } }

class ApplyGuardrailCommand extends Cmd { constructor(i) { super('guardrail', i); } }
class InvokeModelCommand extends Cmd { constructor(i) { super('invokeModel', i); } }
class BedrockRuntimeClient {
  async send(cmd) {
    if (cmd.kind === 'guardrail') {
      state.sentGuardrail.push(cmd.input);
      const next = state.guardrailReplies.shift();
      if (next instanceof Error) throw next;
      return next || { action: 'NONE', assessments: [] };
    }
    if (cmd.kind === 'invokeModel') {
      state.sentHaiku.push(JSON.parse(Buffer.from(cmd.input.body).toString('utf8')));
      const next = state.haikuReplies.shift();
      if (next instanceof Error) throw next;
      const text = typeof next === 'string' ? next : 'Flagged for its treatment, not its subject.';
      return { body: new TextEncoder().encode(JSON.stringify({ content: [{ type: 'text', text }] })) };
    }
    throw new Error(`moderation-harness: unexpected Bedrock command ${cmd.kind}`);
  }
}
class InvokeCommand extends Cmd { constructor(i) { super('invoke', i); } }
class LambdaClient {
  async send(cmd) {
    if (state.lambdaShouldFail) throw new Error('AccessDeniedException');
    state.dispatched.push({
      FunctionName: cmd.input.FunctionName, InvocationType: cmd.input.InvocationType,
      payload: JSON.parse(Buffer.from(cmd.input.Payload).toString('utf8')),
    });
    return {};
  }
}

/** A guardrail reply that flags `category` at `band`. */
const guardrailHit = (category, band) => ({
  action: 'GUARDRAIL_INTERVENED',
  assessments: [{ contentPolicy: { filters: [{ type: category, confidence: band, action: 'BLOCKED' }] } }],
});
const guardrailClean = () => ({ action: 'NONE', assessments: [] });

function install() {
  process.env.TABLE_NAME = 'engage-test';
  process.env.AWS_REGION = 'us-east-1';
  process.env.ACCOUNT_ID = '000000000000';
  process.env.TENANT_KMS_KEY_ID = 'alias/test-tenant-key';
  process.env.CONTENT_GUARDRAIL_ID = 'gr-test';
  process.env.CONTENT_GUARDRAIL_VERSION = 'DRAFT';
  process.env.AI_PROMPTS_BUCKET = 'prompts-test';
  const kms = cryptoStub.makeKmsStub();
  const stubs = new Map([
    ['@aws-sdk/client-dynamodb', { DynamoDBClient: class {} }],
    ['@aws-sdk/lib-dynamodb', {
      DynamoDBDocumentClient: { from: () => docClient },
      GetCommand, PutCommand, UpdateCommand, DeleteCommand, QueryCommand, BatchWriteCommand,
    }],
    ['@aws-sdk/client-kms', kms.exports],
    ['@aws-sdk/client-s3', { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand }],
    ['@aws-sdk/client-bedrock-runtime', { BedrockRuntimeClient, ApplyGuardrailCommand, InvokeModelCommand }],
    ['@aws-sdk/client-lambda', { LambdaClient, InvokeCommand }],
  ]);
  const realLoad = Module._load;
  Module._load = function (request, parent, isMain) {
    if (stubs.has(request)) return stubs.get(request);
    return realLoad.call(this, request, parent, isMain);
  };
  cryptoStub.installTestKeyLoader();
}
function reset() {
  state.ddb.clear(); state.s3.clear();
  state.guardrailReplies = []; state.sentGuardrail = [];
  state.haikuReplies = []; state.sentHaiku = [];
  state.dispatched = []; state.lambdaShouldFail = false;
  cryptoStub.forgetAllOrgs();
  cryptoStub.installTestKeyLoader();
}
const seedRow = (item) => state.ddb.set(rowKey(item.PK, item.SK), JSON.parse(JSON.stringify(item)));
const rowsWhere = (fn) => [...state.ddb.values()].filter(fn);

/** An authorised HTTP event from an org member. `role` defaults to owner. */
function orgEvent({
  orgId, role = 'owner', method = 'POST', setId = '', body, jobId, path: pathParams = {},
  userId = 'sub-amara', username = 'amara', groups = 'hosts',
} = {}) {
  return {
    requestContext: {
      http: { method },
      authorizer: { lambda: { username, userId, groups, status: 'enabled', orgId, orgRole: role, orgIds: orgId } },
    },
    pathParameters: { ...(setId ? { setId } : {}), ...(jobId ? { jobId } : {}), ...pathParams },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  };
}
/** Engage staff in platform mode: `admins`, no active org. */
function platformEvent({ method = 'GET', body, path: pathParams = {}, userId = 'sub-dai', username = 'dai' } = {}) {
  return {
    requestContext: {
      http: { method },
      authorizer: { lambda: { username, userId, groups: 'admins', status: 'enabled', orgId: '', orgRole: '' } },
    },
    pathParameters: pathParams,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  };
}
const ctx = ({ functionName = 'engagetest-check-question-set', remainingMs = 800000 } = {}) => ({
  functionName, getRemainingTimeInMillis: () => remainingMs,
});
async function test(name, fn) {
  try { await fn(); state.passed += 1; console.log(`  PASS  ${name}`); }
  catch (error) { state.failed += 1; console.log(`  FAIL  ${name}\n        ${error.message}`); }
}
function summary() {
  console.log(`\n${state.passed} passed, ${state.failed} failed\n`);
  if (state.failed > 0) process.exit(1);
}
module.exports = {
  REPO, state, install, reset, seedRow, rowsWhere, orgEvent, platformEvent, ctx, test, summary,
  guardrailHit, guardrailClean, plainRow: cryptoStub.plainRow, plainRowAuto: cryptoStub.plainRowAuto,
};
