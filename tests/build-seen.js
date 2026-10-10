const suiteFinished = require('./helpers/finish-guard');
const path = require('path');
const assert = require('assert');
const fs = require('fs');

const REPO = path.join(__dirname, '..');

class PutCommand { constructor(i) { this.input = i; this.type = 'put'; } }
class GetCommand { constructor(i) { this.input = i; this.type = 'get'; } }
class QueryCommand { constructor(i) { this.input = i; this.type = 'query'; } }
class DeleteCommand { constructor(i) { this.input = i; this.type = 'delete'; } }
class UpdateCommand { constructor(i) { this.input = i; this.type = 'update'; } }
class PostToConnectionCommand { constructor(i) { this.input = i; } }

const store = new Map();
const key = (pk, sk) => `${pk}|${sk}`;
let sent = [];

/** Just enough of UpdateExpression for build-room.js: SET a = :v, … ADD b :n, … */
function applyUpdate(inp) {
  const k = key(inp.Key.PK, inp.Key.SK);
  const cur = store.get(k);
  if (inp.ConditionExpression === 'attribute_exists(PK)' && !cur) {
    const e = new Error('cond'); e.name = 'ConditionalCheckFailedException'; throw e;
  }
  if (inp.ConditionExpression === 'attribute_not_exists(DeliveredAt)' && cur && cur.DeliveredAt) {
    const e = new Error('cond'); e.name = 'ConditionalCheckFailedException'; throw e;
  }
  const item = { ...(cur || { PK: inp.Key.PK, SK: inp.Key.SK }) };
  const names = inp.ExpressionAttributeNames || {};
  const vals = inp.ExpressionAttributeValues || {};
  const n = (x) => names[x] || x;
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

const hooks = { failSeenPut: false, readBarrier: null };
const fakeDoc = {
  send: async (cmd) => {
    const inp = cmd.input || {};
    switch (cmd.type) {
      case 'put': {
        if (inp.Item.SK === 'BUILD#SEEN' && hooks.failSeenPut) { const e = new Error('cond'); e.name = 'ConditionalCheckFailedException'; throw e; }
        if (inp.ConditionExpression) {
          const cur = store.get(key(inp.Item.PK, inp.Item.SK));
          const ok = /attribute_not_exists/.test(inp.ConditionExpression)
            ? !cur
            : Boolean(cur) && cur.V === inp.ExpressionAttributeValues[':v'];
          if (!ok) { const e = new Error('cond'); e.name = 'ConditionalCheckFailedException'; throw e; }
        }
        store.set(key(inp.Item.PK, inp.Item.SK), JSON.parse(JSON.stringify(inp.Item))); return {};
      }
      case 'get': {
        if (hooks.readBarrier && inp.Key.SK === 'BUILD#SEEN') { const item = store.get(key(inp.Key.PK, inp.Key.SK)); await hooks.readBarrier(); return { Item: item }; }
        return { Item: store.get(key(inp.Key.PK, inp.Key.SK)) };
      }
      case 'delete': store.delete(key(inp.Key.PK, inp.Key.SK)); return {};
      case 'update': return applyUpdate(inp);
      case 'query': {
        const pk = inp.ExpressionAttributeValues[':pk'];
        const prefix = inp.ExpressionAttributeValues[':sk'] ?? '';
        let items = [...store.values()]
          .filter((i) => i.PK === pk && String(i.SK).startsWith(String(prefix)))
          .sort((a, b) => String(a.SK).localeCompare(String(b.SK)));
        if (inp.ExpressionAttributeValues[':type']) items = items.filter((i) => i.ConnectionType === inp.ExpressionAttributeValues[':type']);
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

const { makeKmsStub, installTestKeyLoader } = require('./helpers/tenant-crypto-stub');
stub('@aws-sdk/client-kms', makeKmsStub().exports);
stub('@aws-sdk/client-dynamodb', { DynamoDBClient: class {} });
stub('@aws-sdk/lib-dynamodb', {
  DynamoDBDocumentClient: { from: () => fakeDoc },
  PutCommand, GetCommand, QueryCommand, DeleteCommand, UpdateCommand,
});
// S3, for the room's screenshots.
const bucket = new Map();
class S3PutObjectCommand { constructor(i) { this.input = i; this.op = 'put'; } }
class S3GetObjectCommand { constructor(i) { this.input = i; this.op = 'get'; } }
class S3DeleteObjectCommand { constructor(i) { this.input = i; this.op = 'delete'; } }
class FakeS3 {
  async send(cmd) {
    const { Key, Body, Metadata, ContentType } = cmd.input;
    if (cmd.op === 'put') { bucket.set(Key, { Body: Buffer.from(Body), Metadata, ContentType }); return {}; }
    if (cmd.op === 'delete') { bucket.delete(Key); return {}; }
    const o = bucket.get(Key);
    if (!o) { const e = new Error('NoSuchKey'); e.name = 'NoSuchKey'; throw e; }
    return { Metadata: o.Metadata, Body: { transformToByteArray: async () => new Uint8Array(o.Body) } };
  }
}
stub('@aws-sdk/client-s3', { S3Client: FakeS3, PutObjectCommand: S3PutObjectCommand, GetObjectCommand: S3GetObjectCommand, DeleteObjectCommand: S3DeleteObjectCommand });
process.env.MEDIA_BUCKET = 'test-media';

stub('@aws-sdk/client-apigatewaymanagementapi', { ApiGatewayManagementApiClient: FakeApiGatewayClient, PostToConnectionCommand });

process.env.TABLE_NAME = 'test-table';
process.env.WEBSOCKET_API_ENDPOINT = 'https://ws.test.invalid/dev';

installTestKeyLoader();
const { handler } = require(path.join(REPO, 'lambda-functions/game/build-room.js'));
const S = require(path.join(REPO, 'lambda-functions/game/build-store.js'));

let pass = 0;
let failed = 0;
async function check(label, fn) {
  try { await fn(); console.log(`  PASS  ${label}`); pass++; } catch (e) { console.log(`  FAIL  ${label}\n        ${e.stack.split('\n').slice(0, 3).join('\n        ')}`); failed++; }
}

const GAME = '4821';
const ORG = 'org_TestOrg1';
const put = (item) => store.set(key(item.PK, item.SK), item);

function seed({ orgId = '', createdBy = '' } = {}) {
  store.clear();
  sent = [];
  put({ PK: `GAME#${GAME}`, SK: 'METADATA', GameType: 'build', Title: 'Food bank sign-up', Details: 'Build a volunteer sign-up site', ttl: 2000000000, ...(orgId ? { orgId } : {}), ...(createdBy ? { CreatedBy: createdBy } : {}) });
  put({ PK: `GAME#${GAME}`, SK: 'STATE', State: 'STARTED' });
  put({ PK: `GAME#${GAME}`, SK: 'PLAYER#Priya', PlayerName: 'Priya', ClientId: 'c-priya' });
  put({ PK: `GAME#${GAME}`, SK: 'PLAYER#Marcus', PlayerName: 'Marcus', ClientId: 'c-marcus' });
  put({ PK: `GAME#${GAME}`, SK: 'PLAYER#Marcus#SCORE', PlayerName: 'Marcus' });
  put({ PK: `GAME#${GAME}`, SK: 'CONNECTION#host-1', ConnectionId: 'host-1', ConnectionType: 'HOST' });
  put({ PK: `GAME#${GAME}`, SK: 'CONNECTION#p-1', ConnectionId: 'p-1', ConnectionType: 'PLAYER' });
}

const HOST = { userId: 'user-1', groups: 'hosts', orgId: '', orgIds: '' };
const agentCtx = (gameId = GAME) => ({ agent: 'build', agentGameId: gameId, agentKeyHash: 'h', groups: '', orgId: '', orgIds: '' });

function hostCall(method, proxy, body, auth = HOST) {
  return handler({
    routeKey: `${method} /games/{gameId}/build/{proxy+}`,
    requestContext: { http: { method }, authorizer: { lambda: auth } },
    pathParameters: { gameId: GAME, proxy },
    body: body ? JSON.stringify(body) : undefined,
  }).then((r) => ({ status: r.statusCode, body: JSON.parse(r.body) }));
}
const agentCall = (method, proxy, body, gameId) => hostCall(method, proxy, body, agentCtx(gameId));
function playCall(method, proxy, input) {
  return handler({
    routeKey: `${method} /games/{gameId}/build-play/{proxy+}`,
    requestContext: { http: { method } },
    pathParameters: { gameId: GAME, proxy },
    ...(method === 'GET' ? { queryStringParameters: input } : { body: JSON.stringify(input) }),
  }).then((r) => ({ status: r.statusCode, body: JSON.parse(r.body) }));
}
const priya = { playerName: 'Priya', clientId: 'c-priya' };
const marcus = { playerName: 'Marcus', clientId: 'c-marcus' };


/*
 * BUILD ROOM: the Host alert's "seen" (docs/design/build-room-host-alert,
 * plan 2026-10-10). Seen is kept ON THE ROOM so every device of the host
 * agrees: the ids opened, and the time of the last Mark all seen. One small
 * host-only route, POST build/seen {ids?, all?}. Expectations written by hand.
 */
const STATE = () => store.get(key(`GAME#${GAME}`, 'BUILD#STATE'));
const SEEN = () => store.get(key(`GAME#${GAME}`, 'BUILD#SEEN'));
const barrier = (n) => { let c = 0; let go; const p = new Promise((r) => { go = r; }); return () => { c += 1; if (c >= n) go(); return p; }; };
const seenOf = async () => (await hostCall('GET', 'state')).body.seen;

(async () => {
  console.log('\nseen: the route');
  await check('a room starts with nothing seen', async () => {
    seed();
    assert.deepStrictEqual(await seenOf(), { ids: [], allAt: '' });
  });
  await check('ids are kept, merged and de-duplicated, and the room hears about it', async () => {
    seed();
    sent = [];
    const r = await hostCall('POST', 'seen', { ids: ['ask:1-a', 'idea:2-b'] });
    assert.strictEqual(r.status, 200);
    assert.deepStrictEqual(r.body.seen.ids, ['ask:1-a', 'idea:2-b']);
    await hostCall('POST', 'seen', { ids: ['idea:2-b', 'share:s1'] });
    assert.deepStrictEqual((await seenOf()).ids, ['ask:1-a', 'idea:2-b', 'share:s1']);
    assert.ok(sent.some((m) => m.connectionId === 'host-1' && m.message.type === 'buildChanged'), 'a second host device is told');
  });
  await check('seen is shared: a fresh read from another device sees it; the revision moves', async () => {
    seed();
    const before = (await hostCall('GET', 'state')).body.rev;
    await hostCall('POST', 'seen', { ids: ['ask:1-a'] });
    const after = await hostCall('GET', 'state');
    assert.ok(after.body.rev > before);
    assert.deepStrictEqual(after.body.seen.ids, ['ask:1-a']);
  });
  await check('all: true stamps the time and drops the individual ids', async () => {
    seed();
    await hostCall('POST', 'seen', { ids: ['ask:1-a'] });
    const t0 = Date.now();
    const r = await hostCall('POST', 'seen', { all: true });
    assert.strictEqual(r.status, 200);
    assert.ok(Math.abs(new Date(r.body.seen.allAt).getTime() - t0) < 5000, r.body.seen.allAt);
    assert.deepStrictEqual(r.body.seen.ids, []);
    assert.strictEqual((await seenOf()).allAt, r.body.seen.allAt);
  });
  await check('ids after a mark-all are kept again', async () => {
    seed();
    await hostCall('POST', 'seen', { all: true });
    const at = (await seenOf()).allAt;
    await hostCall('POST', 'seen', { ids: ['idea:9-z'] });
    assert.deepStrictEqual(await seenOf(), { ids: ['idea:9-z'], allAt: at });
  });
  await check('the list is capped at 200, newest kept', async () => {
    seed();
    for (let b = 0; b < 5; b += 1) await hostCall('POST', 'seen', { ids: Array.from({ length: 50 }, (_, i) => `idea:${b}-${i}`) });
    const ids = (await seenOf()).ids;
    assert.strictEqual(ids.length, 200);
    assert.strictEqual(ids[ids.length - 1], 'idea:4-49');
    assert.ok(!ids.includes('idea:0-0'));
  });
  await check('seen lives on its own row, BUILD#SEEN, with a ttl and a version; the state row only moves its revision', async () => {
    seed();
    await hostCall('POST', 'seen', { ids: ['ask:1-a'] });
    const first = SEEN();
    assert.ok(first.ttl > 0);
    assert.strictEqual(first.V, 1);
    assert.deepStrictEqual(first.Ids, ['ask:1-a']);
    assert.ok(STATE().Rev >= 1);
    assert.strictEqual(STATE().SeenIds, undefined);
    await hostCall('POST', 'seen', { ids: ['ask:2-b'] });
    assert.strictEqual(SEEN().V, 2);
  });
  await check('two devices post at the same instant: both sets of ids are kept (conditional write, retried)', async () => {
    seed();
    hooks.readBarrier = barrier(2);
    const [a, b] = await Promise.all([hostCall('POST', 'seen', { ids: ['ask:1-a', 'idea:1-x'] }), hostCall('POST', 'seen', { ids: ['idea:2-y'] })]);
    hooks.readBarrier = null;
    assert.strictEqual(a.status, 200);
    assert.strictEqual(b.status, 200);
    assert.deepStrictEqual([...(await seenOf()).ids].sort(), ['ask:1-a', 'idea:1-x', 'idea:2-y']);
    assert.strictEqual(SEEN().V, 2);
  });
  await check('a mark-all racing an ids post keeps the mark and the ids made after it', async () => {
    seed();
    hooks.readBarrier = barrier(2);
    await Promise.all([hostCall('POST', 'seen', { all: true }), hostCall('POST', 'seen', { ids: ['idea:2-y'] })]);
    hooks.readBarrier = null;
    const s = await seenOf();
    assert.ok(s.allAt);
    assert.ok(s.ids.includes('idea:2-y') || s.ids.length === 0, 'the id is kept or was folded into the mark');
  });
  await check('three conflicts in a row give up with 409 and write nothing', async () => {
    seed();
    hooks.failSeenPut = true;
    const r = await hostCall('POST', 'seen', { ids: ['ask:1-a'] });
    hooks.failSeenPut = false;
    assert.strictEqual(r.status, 409);
    assert.strictEqual(SEEN(), undefined);
  });

  console.log('\nmockups ready: the view the alert counts');
  await check('an AskForMockups ask the host made (Source host) is ready when every picture is in, and says when', async () => {
    seed();
    const base = { PK: `GAME#${GAME}`, ttl: 2000000000 };
    store.set(key(base.PK, 'BUILD#ASK#009'), { ...base, SK: 'BUILD#ASK#009', AskId: '009', Kind: 'choice', Prompt: 'Which look?', Options: [{ label: 'A', title: 'Bold', detail: '', url: '' }, { label: 'B', title: 'Calm', detail: '', url: '' }], MaxPicks: 1, Status: 'proposed', Source: 'host', AskForMockups: true, CreatedAt: '2026-10-10T12:00:00.000Z' });
    let ask = (await hostCall('GET', 'state')).body.asks.find((a) => a.askId === '009');
    assert.strictEqual(ask.source, 'host');
    assert.strictEqual(ask.mockups.ready, false);
    assert.strictEqual(ask.mockups.readyAt, '');
    store.set(key(base.PK, 'BUILD#IMG#1'), { ...base, SK: 'BUILD#IMG#1', ImageId: 'i1', AskId: '009', Label: 'A', Kind: 'mockup', CreatedAt: '2026-10-10T12:05:00.000Z' });
    store.set(key(base.PK, 'BUILD#IMG#2'), { ...base, SK: 'BUILD#IMG#2', ImageId: 'i2', AskId: '009', Label: 'B', Kind: 'mockup', CreatedAt: '2026-10-10T12:09:00.000Z' });
    ask = (await hostCall('GET', 'state')).body.asks.find((a) => a.askId === '009');
    assert.strictEqual(ask.mockups.ready, true);
    assert.strictEqual(ask.mockups.readyAt, '2026-10-10T12:09:00.000Z', 'the newest picture');
  });

  console.log('\nseen: refusals');
  await check('bad bodies are 400: nothing, a non-list, a non-string, text with spaces or quotes, too many, too long', async () => {
    seed();
    for (const bad of [{}, { ids: 'ask:1' }, { ids: [4] }, { ids: ['ask:1 with a space'] }, { ids: ['"quoted"'] }, { ids: ['nope:1'] }, { ids: Array.from({ length: 51 }, (_, i) => `idea:${i}`) }, { ids: [`idea:${'x'.repeat(200)}`] }]) {
      const r = await hostCall('POST', 'seen', bad);
      assert.strictEqual(r.status, 400, JSON.stringify(bad).slice(0, 60));
    }
    assert.deepStrictEqual(await seenOf(), { ids: [], allAt: '' });
  });
  await check('only the host: Claude gets 403, a phone has no such route', async () => {
    seed();
    assert.strictEqual((await agentCall('POST', 'seen', { all: true })).status, 403);
    assert.notStrictEqual((await playCall('POST', 'seen', { ...priya, all: true })).status, 200);
    assert.deepStrictEqual(await seenOf(), { ids: [], allAt: '' });
  });
  await check('an ended session refuses it', async () => {
    seed();
    store.set(key(`GAME#${GAME}`, 'STATE'), { PK: `GAME#${GAME}`, SK: 'STATE', State: 'ENDED' });
    assert.strictEqual((await hostCall('POST', 'seen', { all: true })).status, 409);
  });

  console.log('\nseen: who can read it');
  await check("Claude's view and a phone's view carry no `seen`", async () => {
    seed();
    await hostCall('POST', 'seen', { ids: ['ask:1-a'] });
    assert.strictEqual((await agentCall('GET', 'state')).body.seen, undefined);
    assert.strictEqual(JSON.stringify((await playCall('GET', 'state', priya)).body).includes('ask:1-a'), false);
  });

  console.log(`\n${pass} passed, ${failed} failed`);
  suiteFinished();
  process.exit(failed ? 1 : 0);
})();
