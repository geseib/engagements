/**
 * THE BUILD ROOM WALL'S TEST HARNESS (docs/design/parity/PLAN.md §2.2-§2.3,
 * tasks B1-B4). The fake table of tests/build-room.js and tests/build-provenance.js,
 * copied once here for the three wall suites (build-wall-key, build-wall-read,
 * build-wall-screen), plus what they need beyond it:
 *
 *   - UpdateItem honours `attribute_not_exists(X)` conditions (the lazy wall key);
 *   - Query honours the `Viewer = :viewer` filter and `Select: 'COUNT'`
 *     (room-counts.js presentingCount / presentingDetail);
 *   - every UpdateItem is recorded, so a suite can check what was written.
 *
 * Requiring it stubs the AWS SDK and loads the handler; a suite must require
 * it before anything else under lambda-functions/.
 */
const path = require('path');

const REPO = path.join(__dirname, '..', '..');

class PutCommand { constructor(i) { this.input = i; this.type = 'put'; } }
class GetCommand { constructor(i) { this.input = i; this.type = 'get'; } }
class QueryCommand { constructor(i) { this.input = i; this.type = 'query'; } }
class DeleteCommand { constructor(i) { this.input = i; this.type = 'delete'; } }
class UpdateCommand { constructor(i) { this.input = i; this.type = 'update'; } }
class PostToConnectionCommand { constructor(i) { this.input = i; } }

const store = new Map();
const key = (pk, sk) => `${pk}|${sk}`;
const sent = [];
const updates = [];

function condFail() { const e = new Error('cond'); e.name = 'ConditionalCheckFailedException'; return e; }

/** Just enough of UpdateExpression for build-room.js: SET a = :v, … ADD b :n, … */
const hooks = { beforeUpdate: null, beforeQuery: null };
function applyUpdate(inp) {
  updates.push(JSON.parse(JSON.stringify(inp)));
  if (hooks.beforeUpdate) hooks.beforeUpdate(inp);
  const k = key(inp.Key.PK, inp.Key.SK);
  const cur = store.get(k);
  const names = inp.ExpressionAttributeNames || {};
  const vals = inp.ExpressionAttributeValues || {};
  const n = (x) => names[x] || x;
  const cond = inp.ConditionExpression || '';
  if (cond === 'attribute_exists(PK)' && !cur) throw condFail();
  if (cond === 'attribute_not_exists(DeliveredAt)' && cur && cur.DeliveredAt) throw condFail();
  const notExists = /^attribute_not_exists\((#?\w+)\)$/.exec(cond);
  if (notExists && cur && cur[n(notExists[1])] !== undefined) throw condFail();
  const item = { ...(cur || { PK: inp.Key.PK, SK: inp.Key.SK }) };
  const expr = inp.UpdateExpression;
  const setPart = (/SET (.*?)(?: ADD |$)/.exec(expr) || [])[1];
  const addPart = (/ADD (.*)$/.exec(expr) || [])[1];
  if (setPart) for (const clause of setPart.split(',')) {
    const [l, r] = clause.split('=').map((s) => s.trim());
    item[n(l)] = vals[r];
  }
  if (addPart) for (const clause of addPart.split(',')) {
    const [l, r] = clause.trim().split(/\s+/);
    item[n(l)] = (Number(item[n(l)]) || 0) + Number(vals[r]);
  }
  store.set(k, item);
  return { Attributes: inp.ReturnValues === 'UPDATED_OLD' ? (cur || {}) : item };
}

const fakeDoc = {
  send: async (cmd) => {
    const inp = cmd.input || {};
    switch (cmd.type) {
      case 'put': store.set(key(inp.Item.PK, inp.Item.SK), JSON.parse(JSON.stringify(inp.Item))); return {};
      case 'get': return { Item: store.get(key(inp.Key.PK, inp.Key.SK)) };
      case 'delete': store.delete(key(inp.Key.PK, inp.Key.SK)); return {};
      case 'update': return applyUpdate(inp);
      case 'query': {
        if (hooks.beforeQuery) hooks.beforeQuery(inp);
        const v = inp.ExpressionAttributeValues;
        const pk = v[':pk'];
        const prefix = v[':sk'] ?? '';
        let items = [...store.values()]
          .filter((i) => i.PK === pk && String(i.SK).startsWith(String(prefix)))
          .sort((a, b) => String(a.SK).localeCompare(String(b.SK)));
        if (v[':type']) items = items.filter((i) => i.ConnectionType === v[':type']);
        if (v[':viewer']) items = items.filter((i) => i.Viewer === v[':viewer']);
        if (inp.Select === 'COUNT') return { Count: items.length };
        return { Items: items, Count: items.length };
      }
      default: return {};
    }
  },
};

class FakeApiGatewayClient {
  async send(cmd) { sent.push({ connectionId: cmd.input.ConnectionId, message: JSON.parse(cmd.input.Data) }); return {}; }
}

const STUB_PATHS = [REPO, path.join(REPO, 'lambda-functions'), path.join(REPO, 'lambda-functions', 'game')];
function stub(name, exports) {
  const seen = new Set();
  for (const base of STUB_PATHS) {
    let p;
    try { p = require.resolve(name, { paths: [base] }); } catch { continue; }
    if (seen.has(p)) continue;
    seen.add(p);
    require.cache[p] = { id: p, filename: p, loaded: true, exports };
  }
  if (!seen.size) throw new Error(`stub(): could not resolve ${name}`);
}

const { makeKmsStub, installTestKeyLoader } = require('./tenant-crypto-stub');
stub('@aws-sdk/client-kms', makeKmsStub().exports);
stub('@aws-sdk/client-dynamodb', { DynamoDBClient: class {} });
stub('@aws-sdk/lib-dynamodb', {
  DynamoDBDocumentClient: { from: () => fakeDoc },
  PutCommand, GetCommand, QueryCommand, DeleteCommand, UpdateCommand,
});
const bucket = new Map();
class S3PutObjectCommand { constructor(i) { this.input = i; this.op = 'put'; } }
class S3GetObjectCommand { constructor(i) { this.input = i; this.op = 'get'; } }
class S3DeleteObjectCommand { constructor(i) { this.input = i; this.op = 'delete'; } }
class FakeS3 {
  async send(cmd) {
    const { Key, Body, Metadata } = cmd.input;
    if (cmd.op === 'put') { bucket.set(Key, { Body: Buffer.from(Body), Metadata }); return {}; }
    if (cmd.op === 'delete') { bucket.delete(Key); return {}; }
    const o = bucket.get(Key);
    if (!o) { const e = new Error('NoSuchKey'); e.name = 'NoSuchKey'; throw e; }
    return { Metadata: o.Metadata, Body: { transformToByteArray: async () => new Uint8Array(o.Body) } };
  }
}
stub('@aws-sdk/client-s3', { S3Client: FakeS3, PutObjectCommand: S3PutObjectCommand, GetObjectCommand: S3GetObjectCommand, DeleteObjectCommand: S3DeleteObjectCommand });
stub('@aws-sdk/client-apigatewaymanagementapi', { ApiGatewayManagementApiClient: FakeApiGatewayClient, PostToConnectionCommand });

process.env.MEDIA_BUCKET = 'test-media';
process.env.TABLE_NAME = 'test-table';
process.env.WEBSOCKET_API_ENDPOINT = 'https://ws.test.invalid/dev';

installTestKeyLoader();
const { handler } = require(path.join(REPO, 'lambda-functions/game/build-room.js'));
const S = require(path.join(REPO, 'lambda-functions/game/build-store.js'));

const GAME = '4821';
const PK = `GAME#${GAME}`;
const TTL = 2000000000;
const put = (item) => store.set(key(item.PK, item.SK), item);
const row = (sk) => store.get(key(PK, sk));

/** A build session with two phones, one host socket and one player socket. */
function seed({ players = ['Priya', 'Marcus'], gameType = 'build', state = 'STARTED' } = {}) {
  store.clear(); bucket.clear(); sent.length = 0; updates.length = 0;
  put({ PK, SK: 'METADATA', GameType: gameType, Title: 'Food bank sign-up', Details: 'Build a volunteer sign-up site', ttl: TTL, IdSecret: 'SECRET-ID-SECRET-NEVER-SENT-0123456789abcdef' });
  put({ PK, SK: 'STATE', State: state });
  for (const p of players) put({ PK, SK: `PLAYER#${p}`, PlayerName: p, ClientId: `c-${p}` });
  put({ PK, SK: 'CONNECTION#host-1', ConnectionId: 'host-1', ConnectionType: 'HOST' });
  put({ PK, SK: 'CONNECTION#p-1', ConnectionId: 'p-1', ConnectionType: 'PLAYER', PlayerName: players[0] || null });
}

const HOST = { userId: 'user-1', groups: 'hosts', orgId: '', orgIds: '' };
const AGENT = { agent: 'build', agentGameId: GAME, agentKeyHash: 'h', agentRole: 'host', groups: '', orgId: '', orgIds: '' };
const builderAuth = (name) => ({ agent: 'build', agentGameId: GAME, agentKeyHash: 'b', agentRole: 'builder', builderName: name, groups: '' });

const parse = (r) => {
  if (r.isBase64Encoded) return { status: r.statusCode, headers: r.headers, raw: Buffer.from(r.body, 'base64') };
  return { status: r.statusCode, headers: r.headers, body: JSON.parse(r.body), text: r.body };
};

async function call(route, method, proxy, { body, auth, query } = {}) {
  return parse(await handler({
    routeKey: `${method} /games/{gameId}/${route}/{proxy+}`,
    requestContext: { http: { method }, ...(auth ? { authorizer: { lambda: auth } } : {}) },
    pathParameters: { gameId: GAME, proxy },
    queryStringParameters: query,
    body: body ? JSON.stringify(body) : undefined,
  }));
}
const hostCall = (method, proxy, body, query) => call('build', method, proxy, { body, auth: HOST, query });
const agentCall = (method, proxy, body, query) => call('build', method, proxy, { body, auth: AGENT, query });
const builderCall = (name) => (method, proxy, body, query) => call('build', method, proxy, { body, auth: builderAuth(name), query });
const playCall = (method, proxy, who, input = {}) => (method === 'GET'
  ? call('build-play', method, proxy, { query: { ...(who || {}), ...input } })
  : call('build-play', method, proxy, { body: { ...(who || {}), ...input } }));
const seat = (name) => ({ playerName: name, clientId: `c-${name}` });
/** The wall read, as the window makes it: no seat, just the key. */
const wallCall = (k, proxy = 'wall') => call('build-play', 'GET', proxy, { query: k === undefined ? {} : { k } });

let pass = 0;
let failed = 0;
async function check(label, fn) {
  try { await fn(); console.log(`  PASS  ${label}`); pass++; } catch (e) { console.log(`  FAIL  ${label}\n        ${e.stack.split('\n').slice(0, 4).join('\n        ')}`); failed++; }
}
const results = () => ({ pass, failed });

const PNG = Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), Buffer.from('wall test pixels')]);

module.exports = {
  REPO, S, handler, store, bucket, sent, updates, hooks, GAME, PK, TTL, put, row, seed,
  HOST, AGENT, builderAuth, call, hostCall, agentCall, builderCall, playCall, seat, wallCall, check, results, PNG,
};
