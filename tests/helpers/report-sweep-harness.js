/**
 * A small in-memory table for the automatic report sweep's suites
 * (tests/report-sweep.js, tests/report-sweep-tenancy.js, tests/report-auto-access.js).
 *
 * It understands exactly the conditional writes the sweep and its neighbours
 * make, and fails loudly on any it does not, so a new condition cannot pass by
 * being ignored:
 *   - Put   `attribute_not_exists(PK)`                      (index row, usage day)
 *   - Put   `attribute_not_exists(PK) OR StartedAt < :stale` (summary-job.js)
 *   - Update the sweep's claim and marker writes            (report-sweep.js)
 *   - Delete with `JobId = :id`                              (summary-job.js release)
 *
 * Every send yields to the event loop first, so two sweeps started together
 * genuinely interleave — the race the claim exists for.
 *
 * Requiring this installs the SDK stubs (DynamoDB, KMS with the test key
 * loader, Lambda) before any handler loads.
 */
const Module = require('module');
const { makeKmsStub, installTestKeyLoader } = require('./tenant-crypto-stub');

const stubs = new Map();
const realLoad = Module._load;
Module._load = function load(request, parent, isMain) {
  if (stubs.has(request)) return stubs.get(request);
  return realLoad.call(this, request, parent, isMain);
};

const cmd = (type) => class { constructor(input) { this.input = input; this.type = type; } };
const GetCommand = cmd('get');
const PutCommand = cmd('put');
const DeleteCommand = cmd('delete');
const QueryCommand = cmd('query');
const UpdateCommand = cmd('update');
const ScanCommand = cmd('scan');
const BatchGetCommand = cmd('batchGet');
const BatchWriteCommand = cmd('batchWrite');

const store = new Map();
const key = (pk, sk) => `${pk}|${sk}`;
const put = (item) => store.set(key(item.PK, item.SK), item);
const get = (pk, sk) => store.get(key(pk, sk));
const log = [];

const conditionFailed = () => Object.assign(new Error('The conditional request failed'), { name: 'ConditionalCheckFailedException' });

function checkPut(inp, existing) {
  const c = inp.ConditionExpression;
  if (!c) return;
  if (c === 'attribute_not_exists(PK)') { if (existing) throw conditionFailed(); return; }
  if (c === 'attribute_not_exists(PK) OR StartedAt < :stale') {
    if (existing && !(existing.StartedAt < inp.ExpressionAttributeValues[':stale'])) throw conditionFailed();
    return;
  }
  throw new Error(`harness: unknown Put condition ${c}`);
}

/** The sweep's UpdateExpressions: `SET a = b, c = if_not_exists(c, :z) + :o`. */
function applySet(item, inp) {
  const names = inp.ExpressionAttributeNames || {};
  const values = inp.ExpressionAttributeValues || {};
  const expr = String(inp.UpdateExpression || '');
  if (!/^SET /.test(expr)) throw new Error(`harness: unknown UpdateExpression ${expr}`);
  const n = (t) => names[t] || t;
  for (const part of expr.slice(4).split(/,\s*(?![^(]*\))/)) {
    const [lhs, rhs] = part.split(/\s*=\s*/);
    let m = /^if_not_exists\((\S+), (:\w+)\) \+ (:\w+)$/.exec(rhs);
    if (m) { item[n(lhs)] = (item[n(m[1])] ?? values[m[2]]) + values[m[3]]; continue; }
    m = /^if_not_exists\((\S+), (:\w+)\)$/.exec(rhs);
    if (m) { item[n(lhs)] = item[n(m[1])] ?? values[m[2]]; continue; }
    if (!(rhs in values)) throw new Error(`harness: unknown SET value ${rhs}`);
    item[n(lhs)] = values[rhs];
  }
}

function checkUpdate(inp, existing) {
  const c = inp.ConditionExpression;
  if (!c) return;
  const names = inp.ExpressionAttributeNames || {};
  const v = inp.ExpressionAttributeValues || {};
  const cur = existing || {};
  if (c === 'attribute_not_exists(#built) AND (attribute_not_exists(#until) OR #until < :now)') {
    const built = cur[names['#built']] !== undefined;
    const until = cur[names['#until']];
    if (built || !(until === undefined || until < v[':now'])) throw conditionFailed();
    return;
  }
  if (c === '#tok = :tok') { if (cur[names['#tok']] !== v[':tok']) throw conditionFailed(); return; }
  throw new Error(`harness: unknown Update condition ${c}`);
}

const fakeDoc = {
  send: async (command) => {
    await new Promise((r) => setImmediate(r));
    const inp = command.input || {};
    log.push({ type: command.type, input: inp });
    if (command.type === 'get') return { Item: get(inp.Key.PK, inp.Key.SK) };
    if (command.type === 'put') {
      checkPut(inp, get(inp.Item.PK, inp.Item.SK));
      put(inp.Item);
      return {};
    }
    if (command.type === 'delete') {
      const existing = get(inp.Key.PK, inp.Key.SK);
      if (inp.ConditionExpression === 'JobId = :id') {
        if (!existing || existing.JobId !== inp.ExpressionAttributeValues[':id']) throw conditionFailed();
      } else if (inp.ConditionExpression) throw new Error(`harness: unknown Delete condition ${inp.ConditionExpression}`);
      store.delete(key(inp.Key.PK, inp.Key.SK));
      return {};
    }
    if (command.type === 'update') {
      const existing = get(inp.Key.PK, inp.Key.SK);
      checkUpdate(inp, existing);
      const item = { ...(existing || { PK: inp.Key.PK, SK: inp.Key.SK }) };
      applySet(item, inp);
      put(item);
      return inp.ReturnValues === 'ALL_NEW' ? { Attributes: { ...item } } : {};
    }
    if (command.type === 'query') {
      const v = inp.ExpressionAttributeValues || {};
      const prefix = /begins_with/.test(inp.KeyConditionExpression || '') ? String(v[':sk'] ?? '') : '';
      const items = [...store.values()]
        .filter((i) => i.PK === v[':pk'] && String(i.SK).startsWith(prefix))
        .sort((a, b) => String(a.SK).localeCompare(String(b.SK)));
      return { Items: items, Count: items.length };
    }
    if (command.type === 'batchGet') {
      const out = {};
      for (const [table, req] of Object.entries(inp.RequestItems || {})) {
        out[table] = req.Keys.map((k) => get(k.PK, k.SK)).filter(Boolean);
      }
      return { Responses: out };
    }
    return { Items: [], Count: 0 };
  },
};

const invokes = [];
class InvokeCommand { constructor(input) { this.input = input; } }
class LambdaClient { async send(c) { invokes.push(JSON.parse(Buffer.from(c.input.Payload).toString('utf8'))); return {}; } }

stubs.set('@aws-sdk/client-kms', makeKmsStub().exports);
installTestKeyLoader();
stubs.set('@aws-sdk/client-dynamodb', { DynamoDBClient: class {} });
stubs.set('@aws-sdk/lib-dynamodb', {
  DynamoDBDocumentClient: { from: () => fakeDoc },
  GetCommand, PutCommand, DeleteCommand, QueryCommand, UpdateCommand, ScanCommand, BatchGetCommand, BatchWriteCommand,
});
stubs.set('@aws-sdk/client-lambda', { LambdaClient, InvokeCommand });
stubs.set('@aws-sdk/client-s3', {
  S3Client: class { async send() { return {}; } },
  PutObjectCommand: cmd('s3put'),
  DeleteObjectCommand: cmd('s3delete'),
  GetObjectCommand: cmd('s3get'),
});

process.env.TABLE_NAME = process.env.TABLE_NAME || 'test-table';
process.env.AI_SUMMARY_FUNCTION_NAME = 'test-get-ai-summary';

const HOUR = 3600 * 1000;

/**
 * Seed a session. `startedAt`/`endedAt` are ISO; `ttl` epoch seconds
 * (default started + 7 days). `rounds` is a list of
 * { n: '001', results: true, ai: true, opened: true }.
 */
function seedSession({
  gameId, orgId = '', title = 'Retro Night', gameType = 'call-and-answer', started = true,
  startedAt, state = 'ENDED', endedAt = null, updatedAt = null, ttl = null, createdBy = 'sub-host',
  rounds = [], currentQuestionId = null, eventRef = null,
}) {
  const startedMs = Date.parse(startedAt);
  const sessionTtl = ttl || Math.floor(startedMs / 1000) + 7 * 86400;
  put({ PK: 'GAMES', SK: `GAME#${gameId}`, ...(orgId ? { orgId } : {}), ttl: sessionTtl });
  put({
    PK: `GAME#${gameId}`, SK: 'METADATA', GameId: gameId, Title: title, HostName: 'Ada', GameType: gameType,
    QuestionSetId: 'retro', CreatedAt: startedAt, Started: started, ttl: sessionTtl,
    ...(started ? { OpenedAt: startedAt, LastPlayedAt: startedAt } : {}),
    ...(orgId ? { orgId } : {}),
    ...(createdBy ? { CreatedBy: createdBy } : {}),
    ...(eventRef ? { EventRef: eventRef, EventItem: 'item-1' } : {}),
  });
  put({
    PK: `GAME#${gameId}`, SK: 'STATE', State: started ? state : 'CREATED',
    ...(started ? { StartedAt: startedAt } : {}),
    UpdatedAt: updatedAt || endedAt || startedAt,
    ...(endedAt ? { EndedAt: endedAt } : {}),
    ...(currentQuestionId ? { CurrentQuestionId: currentQuestionId } : {}),
    ttl: sessionTtl,
  });
  for (const r of rounds) {
    if (r.opened !== false) put({ PK: `GAME#${gameId}`, SK: `QUESTION#${r.n}#REF`, StartedAt: startedAt });
    if (r.results) {
      put({ PK: `GAME#${gameId}`, SK: `ROUND#${r.n}`, QuestionNumber: r.n, AuthorsRevealed: true, ResultsShownAt: startedAt });
      put({ PK: `GAME#${gameId}`, SK: `QUESTION#${r.n}#RESULTS`, SourceQuestionId: `QUESTION#${r.n}`, Winners: [] });
    }
    if (r.ai) put({ PK: `GAME#${gameId}`, SK: `QUESTION#${r.n}#AISummary`, SummaryText: `Read of ${r.n}` });
  }
  return sessionTtl;
}

function reset() { store.clear(); invokes.length = 0; log.length = 0; }

let pass = 0;
let fail = 0;
const say = (...a) => process.stdout.write(`${a.join(' ')}\n`);
async function check(label, fn) {
  try { await fn(); say(`  PASS  ${label}`); pass += 1; } catch (e) { say(`  FAIL  ${label}\n        ${e.message}`); fail += 1; }
}
const counts = () => ({ pass, fail });

module.exports = {
  store, put, get, fakeDoc, invokes, log, reset, seedSession, check, say, counts, HOUR,
};
