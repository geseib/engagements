/**
 * AN IN-MEMORY AWS FOR THE ARCHIVE SUITES — DynamoDB, S3 and the archive service itself.
 *
 * Require it FIRST, before any handler. It installs Module._load stubs for the three AWS SDK
 * packages the archive code imports, replaces global fetch, and sets the environment the
 * handlers read when they load.
 *
 * THE FAKE ARCHIVE REFUSES UNSIGNED REQUESTS, as the locked one does in Phase 2. A suite that
 * passes here signed every archive call it made. tests/archive-client-sigv4.js is where the
 * signature itself is checked against an independent computation.
 *
 * Only what the archive code issues is implemented. Anything else throws by name, because a
 * stub that quietly accepts a command it does not understand hides the bug under test. Scan
 * throws on purpose: the archive code reads partitions by Query, and a Scan is the bug that
 * once exported nothing (tests/export-to-archive-read.js).
 */
const path = require('path');
const Module = require('module');

const TABLE = 'engage-archive-suite';
Object.assign(process.env, {
  TABLE_NAME: TABLE,
  ENVIRONMENT: 'dev',
  ARCHIVE_SERVICE_URL: 'https://archtest01.execute-api.us-east-1.amazonaws.com',
  ARCHIVE_BUCKET: 'engage2-archive-content',
  MEDIA_BUCKET: 'engagedev-media',
  AI_PROMPTS_BUCKET: 'engagedev-ai-prompts',
  AWS_REGION: 'us-east-1',
  AWS_ACCESS_KEY_ID: 'AKIDARCHIVESUITE',
  AWS_SECRET_ACCESS_KEY: 'archive-suite-secret',
  AWS_SESSION_TOKEN: 'archive-suite-token',
  BATCH_RETRY_BASE_MS: '1',
  DELETE_RETRY_BASE_MS: '1',
  CHECK_FUNCTION_NAME: 'engage-archive-suite-check-question-set',
});

const table = new Map();
const objects = new Map();
const archive = new Map();
const writes = [];
const reads = [];
const fetchLog = [];
const dispatched = [];
const options = { queryPageSize: 1000, throwAfterNextBatchWrite: false, lambdaShouldFail: false };
let nextArchive = 1;

const key = (pk, sk) => `${pk}|${sk}`;
const clone = (value) => (value === undefined ? undefined : JSON.parse(JSON.stringify(value)));
const bySK = (a, b) => (a.SK < b.SK ? -1 : a.SK > b.SK ? 1 : 0);

// ---- DynamoDB ---------------------------------------------------------------
function conditionFails(existing, expression) {
  if (!expression) return false;
  if (/^attribute_not_exists\((PK|SK)\)$/.test(expression)) return existing !== undefined;
  if (/^attribute_exists\((PK|SK)\)$/.test(expression)) return existing === undefined;
  throw new Error(`archive-harness: unsupported ConditionExpression ${expression}`);
}
const conditionalFailure = () => Object.assign(new Error('The conditional request failed'), { name: 'ConditionalCheckFailedException' });

/** Split on commas that are not inside parentheses. */
function splitTopLevel(text) {
  const parts = [];
  let depth = 0;
  let current = '';
  for (const ch of text) {
    if (ch === '(') depth += 1;
    if (ch === ')') depth -= 1;
    if (ch === ',' && depth === 0) { parts.push(current.trim()); current = ''; } else { current += ch; }
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}

/** `SET a = :a, b = list_append(if_not_exists(b, :seed), :entry) REMOVE c, d` — what the archive code writes. */
function applyUpdate(item, input) {
  const names = input.ExpressionAttributeNames || {};
  const values = input.ExpressionAttributeValues || {};
  const attr = (token) => names[token.trim()] || token.trim();
  const operand = (token) => {
    const t = token.trim();
    if (t.startsWith(':')) {
      if (!(t in values)) throw new Error(`archive-harness: ${t} is used but not defined`);
      return clone(values[t]);
    }
    const listAppend = /^list_append\(([\s\S]*)\)$/.exec(t);
    if (listAppend) {
      const [a, b] = splitTopLevel(listAppend[1]);
      return [...operand(a), ...operand(b)];
    }
    const ifNotExists = /^if_not_exists\(([\s\S]*)\)$/.exec(t);
    if (ifNotExists) {
      const [name, fallback] = splitTopLevel(ifNotExists[1]);
      return item[attr(name)] === undefined ? operand(fallback) : clone(item[attr(name)]);
    }
    throw new Error(`archive-harness: unsupported update operand ${t}`);
  };
  const match = /^\s*SET\s+([\s\S]*?)(?:\s+REMOVE\s+([\s\S]*))?\s*$/.exec(input.UpdateExpression);
  if (!match) throw new Error(`archive-harness: unsupported UpdateExpression ${input.UpdateExpression}`);
  const next = { ...item };
  for (const assignment of splitTopLevel(match[1])) {
    const eq = assignment.indexOf('=');
    next[attr(assignment.slice(0, eq))] = operand(assignment.slice(eq + 1));
  }
  for (const removed of match[2] ? splitTopLevel(match[2]) : []) delete next[attr(removed)];
  return next;
}

function query(input) {
  const values = input.ExpressionAttributeValues || {};
  const pkToken = (/=\s*(:\w+)/.exec(input.KeyConditionExpression) || [])[1];
  const skToken = (/begins_with\(\s*\S+\s*,\s*(:\w+)\s*\)/.exec(input.KeyConditionExpression) || [])[1];
  if (!pkToken) throw new Error(`archive-harness: unsupported KeyConditionExpression ${input.KeyConditionExpression}`);
  const pk = values[pkToken];
  const prefix = skToken ? values[skToken] : '';
  reads.push({ op: 'Query', PK: pk });
  const all = [...table.values()].filter((row) => row.PK === pk && String(row.SK).startsWith(prefix)).sort(bySK);
  const start = input.ExclusiveStartKey ? all.findIndex((row) => row.SK === input.ExclusiveStartKey.SK) + 1 : 0;
  const page = all.slice(start, start + options.queryPageSize);
  const more = start + page.length < all.length;
  return { Items: clone(page), ...(more ? { LastEvaluatedKey: { PK: pk, SK: page[page.length - 1].SK } } : {}) };
}

const dynamoCommand = (name) => class { constructor(input) { this.input = input; this.name = name; } };
const lib = {
  GetCommand: dynamoCommand('Get'),
  PutCommand: dynamoCommand('Put'),
  UpdateCommand: dynamoCommand('Update'),
  QueryCommand: dynamoCommand('Query'),
  BatchWriteCommand: dynamoCommand('BatchWrite'),
  DeleteCommand: dynamoCommand('Delete'),
  ScanCommand: dynamoCommand('Scan'),
};
const db = {
  async send(cmd) {
    const { input } = cmd;
    switch (cmd.name) {
      case 'Get':
        reads.push({ op: 'Get', PK: input.Key.PK });
        return { Item: clone(table.get(key(input.Key.PK, input.Key.SK))) };
      case 'Put': {
        const k = key(input.Item.PK, input.Item.SK);
        if (conditionFails(table.get(k), input.ConditionExpression)) throw conditionalFailure();
        table.set(k, clone(input.Item));
        writes.push({ op: 'Put', PK: input.Item.PK, SK: input.Item.SK });
        return {};
      }
      case 'Update': {
        const k = key(input.Key.PK, input.Key.SK);
        const existing = table.get(k);
        if (conditionFails(existing, input.ConditionExpression)) throw conditionalFailure();
        table.set(k, applyUpdate(existing || { ...input.Key }, input));
        writes.push({ op: 'Update', PK: input.Key.PK, SK: input.Key.SK });
        return {};
      }
      case 'Delete':
        table.delete(key(input.Key.PK, input.Key.SK));
        writes.push({ op: 'Delete', PK: input.Key.PK, SK: input.Key.SK });
        return {};
      case 'Query':
        return query(input);
      case 'BatchWrite': {
        for (const requests of Object.values(input.RequestItems)) {
          for (const request of requests) {
            if (request.PutRequest) {
              const row = request.PutRequest.Item;
              table.set(key(row.PK, row.SK), clone(row));
              writes.push({ op: 'Put', PK: row.PK, SK: row.SK });
            }
            if (request.DeleteRequest) {
              const k = request.DeleteRequest.Key;
              table.delete(key(k.PK, k.SK));
              writes.push({ op: 'Delete', PK: k.PK, SK: k.SK });
            }
          }
        }
        if (options.throwAfterNextBatchWrite) {
          options.throwAfterNextBatchWrite = false;
          throw Object.assign(new Error('Throughput exceeds the current capacity'), { name: 'ProvisionedThroughputExceededException' });
        }
        return { UnprocessedItems: {} };
      }
      case 'Scan':
        throw new Error('archive-harness: a Scan was issued — the archive code must read partitions by Query');
      default:
        throw new Error(`archive-harness: unstubbed DynamoDB command ${cmd.name}`);
    }
  },
};

// ---- S3 ---------------------------------------------------------------------
const s3Command = (name) => class { constructor(input) { this.input = input; this.name = name; } };
const missingObject = (name, what) => Object.assign(new Error(`${name}: ${what}`), { name, $metadata: { httpStatusCode: 404 } });
const s3 = {
  async send(cmd) {
    const { Bucket, Key } = cmd.input;
    if (!Bucket) throw Object.assign(new Error('Bucket name is required'), { name: 'InvalidBucketName' });
    const at = `${Bucket}/${Key}`;
    switch (cmd.name) {
      case 'PutObject':
        objects.set(at, { Body: String(cmd.input.Body), ContentType: cmd.input.ContentType });
        return {};
      case 'GetObject': {
        const found = objects.get(at);
        if (!found) throw missingObject('NoSuchKey', at);
        return { Body: { transformToString: async () => found.Body } };
      }
      case 'HeadObject':
        if (!objects.has(at)) throw missingObject('NotFound', at);
        return {};
      case 'CopyObject': {
        const source = String(cmd.input.CopySource);
        const slash = source.indexOf('/');
        const from = `${source.slice(0, slash)}/${source.slice(slash + 1).split('/').map(decodeURIComponent).join('/')}`;
        if (!objects.has(from)) throw missingObject('NoSuchKey', from);
        objects.set(at, { ...objects.get(from) });
        return {};
      }
      case 'DeleteObject':
        objects.delete(at);
        return {};
      default:
        throw new Error(`archive-harness: unstubbed S3 command ${cmd.name}`);
    }
  },
};

// ---- Lambda ------------------------------------------------------------------
/**
 * The routes that change one of Engage's own sets dispatch its content check
 * themselves (`admin/shared/house-check.js`). Nothing here runs the check — an
 * `InvocationType: 'Event'` send returns the moment the Lambda service accepts
 * it — so what a suite can see is exactly what production sees at that instant:
 * that a request went, to which function, carrying whose authorizer. Set
 * `options.lambdaShouldFail` to prove the write survives a dispatch that does
 * not go.
 */
class InvokeCommand { constructor(input) { this.input = input; } }
class LambdaClient {
  async send(cmd) {
    if (options.lambdaShouldFail) throw Object.assign(new Error('User is not authorized to perform: lambda:InvokeFunction'), { name: 'AccessDeniedException' });
    dispatched.push({
      FunctionName: cmd.input.FunctionName,
      InvocationType: cmd.input.InvocationType,
      payload: JSON.parse(Buffer.from(cmd.input.Payload).toString('utf8')),
    });
    return { StatusCode: 202 };
  }
}

const stubs = new Map([
  ['@aws-sdk/client-dynamodb', { DynamoDBClient: class {} }],
  ['@aws-sdk/client-lambda', { LambdaClient, InvokeCommand }],
  ['@aws-sdk/lib-dynamodb', { DynamoDBDocumentClient: { from: () => db }, ...lib }],
  ['@aws-sdk/client-s3', {
    S3Client: class { send(cmd) { return s3.send(cmd); } },
    GetObjectCommand: s3Command('GetObject'),
    PutObjectCommand: s3Command('PutObject'),
    CopyObjectCommand: s3Command('CopyObject'),
    HeadObjectCommand: s3Command('HeadObject'),
    DeleteObjectCommand: s3Command('DeleteObject'),
  }],
]);
const realLoad = Module._load;
Module._load = function load(request, parent, isMain) {
  if (stubs.has(request)) return stubs.get(request);
  return realLoad.call(this, request, parent, isMain);
};

// ---- the archive service, signed requests only ------------------------------
const DOWNLOAD = 'https://archive-download.test.invalid/';
function respond(status, body) {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  return { ok: status >= 200 && status < 300, status, text: async () => text, json: async () => JSON.parse(text), headers: { get: () => 'application/json' } };
}
function isSigned(headers) {
  const auth = String(headers.authorization || headers.Authorization || '');
  return auth.startsWith('AWS4-HMAC-SHA256 Credential=') && auth.includes('/execute-api/aws4_request') && Boolean(headers['x-amz-date']);
}
function storedItem(data, archiveId) {
  return {
    PK: 'ARCHIVE', SK: `ITEM#${archiveId}`, ArchiveId: archiveId, Title: data.title, Description: data.description || '',
    ContentType: data.contentType, Category: data.category || 'general', Tags: data.tags || [],
    FileName: data.fileName || data.title, FileSize: Buffer.byteLength(String(data.content), 'utf8'),
    CreatedAt: new Date(Date.UTC(2026, 8, 15, 12, 0, nextArchive)).toISOString(),
  };
}
global.fetch = async (rawUrl, init = {}) => {
  const url = new URL(String(rawUrl));
  const method = String(init.method || 'GET').toUpperCase();
  const headers = { ...(init.headers || {}) };
  fetchLog.push({ url: url.href, method, headers, body: init.body });
  if (url.href.startsWith(DOWNLOAD)) {
    if (headers.authorization || headers.Authorization) return respond(400, 'Only one auth mechanism allowed');
    const record = archive.get(url.pathname.slice(1));
    return record ? respond(200, record.content) : respond(404, 'NoSuchKey');
  }
  if (url.origin !== new URL(process.env.ARCHIVE_SERVICE_URL).origin) return respond(599, `archive-harness: unexpected fetch to ${url.href}`);
  if (!isSigned(headers)) return respond(403, { message: 'Forbidden' });
  const itemId = (/^\/archive\/items\/([^/]+)$/.exec(url.pathname) || [])[1];
  if (method === 'POST' && url.pathname === '/archive/items') {
    const data = JSON.parse(init.body);
    const archiveId = `arc-${nextArchive}`;
    const item = storedItem(data, archiveId);
    nextArchive += 1;
    archive.set(archiveId, { item, content: data.content });
    return respond(200, { success: true, archiveId, item });
  }
  if (method === 'GET' && url.pathname === '/archive/items') {
    const type = url.searchParams.get('type');
    const items = [...archive.values()].map((r) => r.item).filter((i) => !type || i.ContentType === type)
      .sort((a, b) => (a.CreatedAt < b.CreatedAt ? 1 : -1));
    return respond(200, { success: true, items, count: items.length });
  }
  if (method === 'POST' && url.pathname === '/archive/search') {
    const { query: text = '' } = JSON.parse(init.body || '{}');
    const items = [...archive.values()].map((r) => r.item).filter((i) => i.Title.toLowerCase().includes(String(text).toLowerCase()));
    return respond(200, { success: true, items, count: items.length });
  }
  if (itemId && method === 'GET') {
    const record = archive.get(decodeURIComponent(itemId));
    return record
      ? respond(200, { success: true, item: record.item, downloadUrl: `${DOWNLOAD}${record.item.ArchiveId}` })
      : respond(404, { error: 'Archive item not found' });
  }
  if (itemId && method === 'DELETE') {
    const id = decodeURIComponent(itemId);
    if (!archive.has(id)) return respond(404, { error: 'Archive item not found' });
    archive.delete(id);
    return respond(200, { success: true, archiveId: id });
  }
  return respond(404, { error: `archive-harness: no route ${method} ${url.pathname}` });
};

// ---- seeding and events -----------------------------------------------------
const ADMIN = path.join(__dirname, '..', '..', 'lambda-functions', 'admin', 'shared');
const { setMetadataKey, setPartition } = require(path.join(ADMIN, 'set-version.js'));
const { promptKey, promptBodyKey } = require(path.join(ADMIN, 'prompt-access.js'));

function put(item) { table.set(key(item.PK, item.SK), clone(item)); return item; }
function get(pk, sk) { return clone(table.get(key(pk, sk))); }
function rows(pk) { return [...table.values()].filter((row) => row.PK === pk).sort(bySK).map(clone); }

function seedSet({ scope = 'platform', orgId = '', setId, version = null, meta = {}, rows: content = [] }) {
  const ref = { scope, orgId, setId };
  put({
    ...(version ? { activeVersion: version, versions: [{ version, createdAt: '2026-09-01T00:00:00.000Z' }] } : {}),
    ...meta,
    ...setMetadataKey(ref),
  });
  const pk = setPartition(ref, version);
  for (const row of content) put({ ...row, PK: pk });
  return { ref, pk };
}

function seedPrompt({ promptId, row = {}, body }) {
  const ref = { scope: 'platform', promptId };
  const base = { gameType: 'call-and-answer', status: 'active', isDefault: false, version: 1, ...row };
  const s3Key = body ? promptBodyKey(ref, base.gameType, base.version) : undefined;
  put({ promptId, ...base, ...promptKey(ref), ...(s3Key ? { s3Key } : {}) });
  if (body) objects.set(`${process.env.AI_PROMPTS_BUCKET}/${s3Key}`, { Body: JSON.stringify(body), ContentType: 'application/json' });
  return { ref, s3Key };
}

function seedArchiveItem({ contentType = 'questionset', title = 'Seeded', description = '', tags = [], content }) {
  const archiveId = `arc-${nextArchive}`;
  const item = storedItem({ title, description, contentType, tags, content }, archiveId);
  nextArchive += 1;
  archive.set(archiveId, { item, content });
  return archiveId;
}

function event(context, body, extra = {}) {
  return {
    requestContext: { authorizer: { lambda: context }, ...(extra.routeKey ? { routeKey: extra.routeKey } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    ...(extra.pathParameters ? { pathParameters: extra.pathParameters } : {}),
    ...(extra.queryStringParameters ? { queryStringParameters: extra.queryStringParameters } : {}),
  };
}
const adminEvent = (body, extra) => event({ groups: 'admins', userId: 'staff-1', username: 'staff@engage.test' }, body, extra);
const orgAdminEvent = (orgId, body, extra) => event({ groups: 'admins', userId: 'staff-1', orgId, orgRole: 'owner' }, body, extra);
const hostEvent = (body, extra) => event({ groups: 'hosts', userId: 'host-1' }, body, extra);

function reset() {
  table.clear(); objects.clear(); archive.clear();
  writes.length = 0; reads.length = 0; fetchLog.length = 0; dispatched.length = 0;
  nextArchive = 1;
  options.queryPageSize = 1000;
  options.throwAfterNextBatchWrite = false;
  options.lambdaShouldFail = false;
}

function checker() {
  let pass = 0;
  let fail = 0;
  return {
    async check(label, fn) {
      try { await fn(); console.log(`  ok   - ${label}`); pass += 1; } catch (e) {
        console.log(`  FAIL - ${label}\n         ${e.message}`); fail += 1;
      }
    },
    finish() {
      console.log(`\n${pass} passed, ${fail} failed`);
      process.exit(fail ? 1 : 0);
    },
  };
}

module.exports = {
  TABLE, DOWNLOAD, table, objects, archive, writes, reads, fetchLog, dispatched, options,
  reset, put, get, rows, seedSet, seedPrompt, seedArchiveItem,
  adminEvent, orgAdminEvent, hostEvent, checker,
};
