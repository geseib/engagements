/**
 * BUILD ROOM — talking points, research and ideas: Task 1 (server).
 * docs/superpowers/specs/2026-10-09-build-room-talking-points-design.md §1, §2, §5, §7
 *
 * Points and Research/Ideas requests: what Claude (the host's and every
 * builder's) may post, what the host does with it, who may touch whose
 * request, what is sealed in a team room, and that every row dies with the
 * session (ttl). Expectations are written by hand.
 */
const suiteFinished = require('./helpers/finish-guard');
const path = require('path');
const assert = require('assert');

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

const fakeDoc = {
  send: async (cmd) => {
    const inp = cmd.input || {};
    switch (cmd.type) {
      case 'put': store.set(key(inp.Item.PK, inp.Item.SK), JSON.parse(JSON.stringify(inp.Item))); return {};
      case 'get': return { Item: store.get(key(inp.Key.PK, inp.Key.SK)) };
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

function seed({ orgId = '' } = {}) {
  store.clear();
  sent = [];
  put({ PK: `GAME#${GAME}`, SK: 'METADATA', GameType: 'build', Title: 'Food bank sign-up', Details: 'Build a volunteer sign-up site', ttl: 2000000000, ...(orgId ? { orgId } : {}) });
  put({ PK: `GAME#${GAME}`, SK: 'STATE', State: 'STARTED' });
  for (const n of ['Priya', 'Sam', 'Marcus']) put({ PK: `GAME#${GAME}`, SK: `PLAYER#${n}`, PlayerName: n, ClientId: `c-${n}` });
  put({ PK: `GAME#${GAME}`, SK: 'CONNECTION#host-1', ConnectionId: 'host-1', ConnectionType: 'HOST' });
  put({ PK: `GAME#${GAME}`, SK: 'CONNECTION#p-1', ConnectionId: 'p-1', ConnectionType: 'PLAYER' });
}

const HOST = { userId: 'user-1', groups: 'hosts', orgId: '', orgIds: '' };
const TEAM_HOST = { userId: 'user-1', groups: 'hosts', orgId: ORG, orgIds: ORG };
const CLAUDE = { agent: 'build', agentGameId: GAME, agentKeyHash: 'h', agentRole: 'host', groups: '' };
const builderAuth = (name) => ({ agent: 'build', agentGameId: GAME, agentKeyHash: `b-${name}`, agentRole: 'builder', builderName: name, groups: '' });

async function call(route, method, proxy, body, auth, query) {
  const r = await handler({
    routeKey: `${method} /games/{gameId}/${route}/{proxy+}`,
    requestContext: { http: { method }, ...(auth ? { authorizer: { lambda: auth } } : {}) },
    pathParameters: { gameId: GAME, proxy },
    queryStringParameters: query,
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: r.statusCode, body: JSON.parse(r.body) };
}
let HA = HOST; // the host's auth for this section (a team room uses TEAM_HOST)
const host = (m, p, b) => call('build', m, p, b, HA);
const claude = (m, p, b, q) => call('build', m, p, b, CLAUDE, q);
const as = (name) => (m, p, b, q) => call('build', m, p, b, builderAuth(name), q);
const phone = (name) => (m, p, b) => call('build-play', m, p, m === 'GET' ? undefined : { playerName: name, clientId: `c-${name}`, ...(b || {}) }, null, m === 'GET' ? { playerName: name, clientId: `c-${name}` } : undefined);
const priya = as('Priya'); const sam = as('Sam');

const rowsOf = (prefix) => [...store.values()].filter((x) => String(x.SK).startsWith(prefix));
const pt = (text, extra) => ({ kind: 'talk', text, ...(extra || {}) });
const finding = (text) => ({ kind: 'finding', text, sources: [{ title: 'WebAIM', url: 'https://webaim.org/articles/contrast/' }] });
const raw = () => JSON.stringify(rowsOf('BUILD#'));

(async () => {
  console.log('\nClaude posts points');
  seed();
  let ids;
  await check('the host\'s Claude posts 3 points: stored with the session ttl, By=claude, status new', async () => {
    const r = await claude('POST', 'points', { points: [pt('Why a calm header matters'), finding('Contrast of 4.5:1 is the AA floor'), { kind: 'idea', text: 'Add a volunteer map', about: 'next steps' }] });
    assert.strictEqual(r.status, 201, JSON.stringify(r.body));
    ids = r.body.posted;
    assert.strictEqual(ids.length, 3);
    const rows = rowsOf('BUILD#POINT#');
    assert.strictEqual(rows.length, 3);
    for (const row of rows) {
      assert.strictEqual(row.ttl, 2000000000, 'ttl');
      assert.strictEqual(row.By, 'claude');
      assert.strictEqual(row.Status, 'new');
    }
    assert.deepStrictEqual(rows.map((x) => x.Kind).sort(), ['finding', 'idea', 'talk']);
    assert.strictEqual(new Set(rows.map((x) => x.BatchId)).size, 1, 'one post is one batch');
  });
  await check('the host sees them all, with sources; the open count is 3', async () => {
    const h = (await host('GET', 'state')).body;
    assert.strictEqual(h.points.open, 3);
    assert.strictEqual(h.points.items.length, 3);
    const f = h.points.items.find((x) => x.kind === 'finding');
    assert.deepStrictEqual(f.sources, [{ title: 'WebAIM', url: 'https://webaim.org/articles/contrast/' }]);
    assert.strictEqual(f.by, 'claude');
    assert.deepStrictEqual(h.points.requests, []);
  });

  console.log('\nwhat Claude may not post');
  await check('a finding with no source is refused with a plain sentence', async () => {
    const r = await claude('POST', 'points', { points: [{ kind: 'finding', text: 'Everyone prefers blue' }] });
    assert.strictEqual(r.status, 400);
    assert.ok(/source/i.test(r.body.error), r.body.error);
    const r2 = await claude('POST', 'points', { points: [{ kind: 'finding', text: 'x', sources: [] }] });
    assert.strictEqual(r2.status, 400);
  });
  await check('a source link that is not http(s) is refused, for a finding or any other kind', async () => {
    for (const url of ['javascript:alert(1)', 'ftp://x.test/a', 'data:text/html,hi', '/relative', 'file:///etc/passwd']) {
      const r = await claude('POST', 'points', { points: [{ kind: 'finding', text: 'x', sources: [{ title: 't', url }] }] });
      assert.strictEqual(r.status, 400, url);
      assert.ok(/http/i.test(r.body.error), r.body.error);
    }
    const t = await claude('POST', 'points', { points: [pt('x', { sources: [{ title: 't', url: 'javascript:alert(1)' }] })] });
    assert.strictEqual(t.status, 400);
  });
  await check('text over 280, empty text, an unknown kind, more than 3 sources, more than 8 points: all 400', async () => {
    assert.strictEqual((await claude('POST', 'points', { points: [pt('x'.repeat(281))] })).status, 400);
    assert.strictEqual((await claude('POST', 'points', { points: [pt('   ')] })).status, 400);
    assert.strictEqual((await claude('POST', 'points', { points: [{ kind: 'essay', text: 'x' }] })).status, 400);
    const four = Array.from({ length: 4 }, (_, i) => ({ title: `s${i}`, url: `https://example.test/${i}` }));
    assert.strictEqual((await claude('POST', 'points', { points: [{ kind: 'finding', text: 'x', sources: four }] })).status, 400);
    assert.strictEqual((await claude('POST', 'points', { points: Array.from({ length: 9 }, (_, i) => pt(`p${i}`)) })).status, 400);
    assert.strictEqual((await claude('POST', 'points', { points: [] })).status, 400);
    assert.strictEqual((await claude('POST', 'points', {})).status, 400);
    assert.strictEqual(rowsOf('BUILD#POINT#').length, 3, 'a refused post writes nothing');
  });
  await check('one bad point refuses the whole post; nothing is half-written', async () => {
    const r = await claude('POST', 'points', { points: [pt('fine'), { kind: 'finding', text: 'no source' }] });
    assert.strictEqual(r.status, 400);
    assert.strictEqual(rowsOf('BUILD#POINT#').length, 3);
  });
  await check('exactly 280 characters and 8 points are fine; detail over 1200 is cut, not refused', async () => {
    seed();
    const r = await claude('POST', 'points', { points: [pt('y'.repeat(280), { detail: 'd'.repeat(1500) })] });
    assert.strictEqual(r.status, 201, JSON.stringify(r.body));
    assert.strictEqual(rowsOf('BUILD#POINT#')[0].Detail.length, 1200);
    const eight = await claude('POST', 'points', { points: Array.from({ length: 8 }, (_, i) => pt(`p${i}`)) });
    assert.strictEqual(eight.status, 201);
  });

  console.log('\nthe 40 open points limit');
  await check('the 41st open point is refused 409 "Remove or save some first"; removing or saving frees room', async () => {
    seed();
    for (let i = 0; i < 5; i += 1) assert.strictEqual((await claude('POST', 'points', { points: Array.from({ length: 8 }, (_, j) => pt(`point ${i}-${j}`)) })).status, 201);
    assert.strictEqual((await host('GET', 'state')).body.points.open, 40);
    const over = await claude('POST', 'points', { points: [pt('one too many')] });
    assert.strictEqual(over.status, 409);
    assert.strictEqual(over.body.error, 'Remove or save some first');
    const items = (await host('GET', 'state')).body.points.items;
    assert.strictEqual((await host('POST', `points/${items[0].id}`, { action: 'remove' })).status, 200);
    assert.strictEqual((await host('GET', 'state')).body.points.open, 39);
    assert.strictEqual((await claude('POST', 'points', { points: [pt('now it fits')] })).status, 201);
    assert.strictEqual((await claude('POST', 'points', { points: [pt('and again')] })).status, 409);
    assert.strictEqual((await host('POST', `points/${items[1].id}`, { action: 'later' })).status, 200);
    assert.strictEqual((await claude('POST', 'points', { points: [pt('saved one frees room')] })).status, 201);
  });
  await check('a post that would cross 40 is refused whole', async () => {
    seed();
    for (let i = 0; i < 4; i += 1) await claude('POST', 'points', { points: Array.from({ length: 8 }, (_, j) => pt(`q ${i}-${j}`)) });
    await claude('POST', 'points', { points: Array.from({ length: 7 }, (_, j) => pt(`r ${j}`)) });
    const r = await claude('POST', 'points', { points: [pt('a'), pt('b')] });
    assert.strictEqual(r.status, 409);
    assert.strictEqual(rowsOf('BUILD#POINT#').length, 39);
  });

  console.log('\nResearch and Ideas requests: the host asks, Claude hears');
  let reqId;
  await check('a host request is stored with the ttl and reaches the agent inbox as {kind, requestId, subject}', async () => {
    seed();
    const r = await host('POST', 'points/requests', { kind: 'research', subject: 'Accessible colour contrast' });
    assert.strictEqual(r.status, 201, JSON.stringify(r.body));
    reqId = r.body.request.id;
    assert.deepStrictEqual([r.body.request.kind, r.body.request.subject, r.body.request.status], ['research', 'Accessible colour contrast', 'waiting']);
    const row = rowsOf('BUILD#PREQ#')[0];
    assert.strictEqual(row.ttl, 2000000000);
    assert.strictEqual(row.Status, 'waiting');
    const inbox = (await claude('GET', 'inbox')).body.inbox;
    assert.strictEqual(inbox.length, 1);
    assert.deepStrictEqual([inbox[0].kind, inbox[0].requestId, inbox[0].subject], ['research', reqId, 'Accessible colour contrast']);
    assert.deepStrictEqual((await claude('GET', 'inbox')).body.inbox, [], 'delivered once');
    assert.strictEqual(rowsOf('BUILD#PREQ#')[0].Status, 'working');
  });
  await check('Claude not connected: the request waits (host sees waiting) and is delivered on the next inbox read', async () => {
    seed();
    const h0 = (await host('GET', 'state')).body;
    assert.strictEqual(h0.agent.connected, false);
    await host('POST', 'points/requests', { kind: 'ideas', subject: 'Where next' });
    await host('POST', 'points/requests', { kind: 'research', subject: 'Parking rules' });
    const h = (await host('GET', 'state')).body;
    assert.deepStrictEqual(h.points.requests.map((x) => [x.kind, x.status]), [['ideas', 'waiting'], ['research', 'waiting']]);
    assert.strictEqual(h.agent.connected, false, 'still not connected');
    const inbox = (await claude('GET', 'inbox')).body.inbox;
    assert.deepStrictEqual(inbox.map((x) => [x.kind, x.subject]), [['ideas', 'Where next'], ['research', 'Parking rules']]);
    assert.deepStrictEqual((await host('GET', 'state')).body.points.requests.map((x) => x.status), ['working', 'working']);
  });
  await check('a request with no subject, an unknown kind, or a subject over 200: 400; too many open requests: 409', async () => {
    seed();
    assert.strictEqual((await host('POST', 'points/requests', { kind: 'research', subject: '  ' })).status, 400);
    assert.strictEqual((await host('POST', 'points/requests', { kind: 'poem', subject: 'x' })).status, 400);
    assert.strictEqual((await host('POST', 'points/requests', { kind: 'ideas', subject: 'x'.repeat(201) })).status, 400);
    for (let i = 0; i < 10; i += 1) assert.strictEqual((await host('POST', 'points/requests', { kind: 'ideas', subject: `s${i}` })).status, 201);
    assert.strictEqual((await host('POST', 'points/requests', { kind: 'ideas', subject: 'eleven' })).status, 409);
  });
  await check('posting with the requestId moves it to working; done:true closes it; a closed one takes no more; a stranger id is 404', async () => {
    seed();
    const q = (await host('POST', 'points/requests', { kind: 'research', subject: 'Contrast' })).body.request.id;
    await claude('GET', 'inbox');
    const r = await claude('POST', 'points', { requestId: q, points: [finding('AA is 4.5:1')], batchId: 'b1' });
    assert.strictEqual(r.status, 201, JSON.stringify(r.body));
    assert.strictEqual(rowsOf('BUILD#POINT#')[0].BatchId, 'b1');
    assert.strictEqual(rowsOf('BUILD#POINT#')[0].RequestId, q);
    let h = (await host('GET', 'state')).body;
    assert.strictEqual(h.points.requests[0].status, 'working');
    assert.strictEqual(h.points.requests[0].count, 1);
    const d = await claude('POST', 'points', { requestId: q, points: [finding('AAA is 7:1')], done: true });
    assert.strictEqual(d.status, 201);
    h = (await host('GET', 'state')).body;
    assert.strictEqual(h.points.requests[0].status, 'done');
    assert.strictEqual(h.points.requests[0].count, 2);
    assert.strictEqual((await claude('POST', 'points', { requestId: q, points: [pt('late')] })).status, 409);
    assert.strictEqual((await claude('POST', 'points', { requestId: 'nope', points: [pt('x')] })).status, 404);
    assert.strictEqual((await claude('POST', 'points', { done: true })).status, 400, 'done needs a requestId');
  });
  await check('done with no points closes the request (nothing found)', async () => {
    seed();
    const q = (await host('POST', 'points/requests', { kind: 'ideas', subject: 'x' })).body.request.id;
    const d = await claude('POST', 'points', { requestId: q, done: true });
    assert.strictEqual(d.status, 201, JSON.stringify(d.body));
    assert.deepStrictEqual(d.body.posted, []);
    assert.strictEqual((await host('GET', 'state')).body.points.requests[0].status, 'done');
  });

  console.log('\nthe host curates');
  await check('host-only: the agent cannot request, act on a point, or send', async () => {
    seed();
    const p = (await claude('POST', 'points', { points: [pt('one'), pt('two')] })).body.posted;
    assert.strictEqual((await claude('POST', 'points/requests', { kind: 'research', subject: 'x' })).status, 403);
    assert.strictEqual((await claude('POST', `points/${p[0]}`, { action: 'remove' })).status, 403);
    assert.strictEqual((await claude('POST', 'points/send', { ids: p })).status, 403);
    assert.strictEqual((await priya('POST', `points/${p[0]}`, { action: 'remove' })).status, 403);
    assert.strictEqual((await priya('POST', 'points/requests', { kind: 'research', subject: 'x' })).status, 403);
    assert.strictEqual((await host('POST', `points/${p[0]}`, { action: 'explode' })).status, 400);
    assert.strictEqual((await host('POST', 'points/nope', { action: 'remove' })).status, 404);
    assert.strictEqual(rowsOf('BUILD#POINT#').every((x) => x.Status === 'new'), true);
  });
  await check('send: one point goes to Claude as a direction (do-now) and is marked sent; sources travel with it', async () => {
    seed();
    const p = (await claude('POST', 'points', { points: [finding('AA is 4.5:1')] })).body.posted;
    await claude('GET', 'inbox');
    const r = await host('POST', `points/${p[0]}`, { action: 'send' });
    assert.strictEqual(r.status, 200, JSON.stringify(r.body));
    assert.strictEqual(r.body.point.status, 'sent');
    const inbox = (await claude('GET', 'inbox')).body.inbox;
    assert.strictEqual(inbox.length, 1);
    assert.strictEqual(inbox[0].as, 'do-now');
    assert.ok(inbox[0].text.includes('AA is 4.5:1') && inbox[0].text.includes('https://webaim.org/articles/contrast/'), inbox[0].text);
    assert.strictEqual((await host('POST', `points/${p[0]}`, { action: 'send' })).status, 409, 'already sent');
  });
  await check('send several: ONE direction, all marked sent; an unknown or removed id refuses the lot', async () => {
    seed();
    const p = (await claude('POST', 'points', { points: [pt('first'), pt('second'), pt('third')] })).body.posted;
    await host('POST', `points/${p[2]}`, { action: 'remove' });
    assert.strictEqual((await host('POST', 'points/send', { ids: [p[0], p[2]] })).status, 409);
    assert.strictEqual((await host('POST', 'points/send', { ids: [p[0], 'nope'] })).status, 404);
    assert.strictEqual((await host('POST', 'points/send', { ids: [] })).status, 400);
    assert.strictEqual((await claude('GET', 'inbox')).body.inbox.length, 0, 'a refused send sends nothing');
    const r = await host('POST', 'points/send', { ids: [p[0], p[1]] });
    assert.strictEqual(r.status, 200, JSON.stringify(r.body));
    const inbox = (await claude('GET', 'inbox')).body.inbox;
    assert.strictEqual(inbox.length, 1, 'one direction');
    assert.ok(inbox[0].text.includes('first') && inbox[0].text.includes('second') && !inbox[0].text.includes('third'));
    const h = (await host('GET', 'state')).body;
    assert.deepStrictEqual(h.points.items.map((x) => x.status), ['sent', 'sent'], 'removed points leave the host list');
  });
  await check('later: the point joins the Later list (held, nothing reaches Claude) and leaves the open count', async () => {
    seed();
    const p = (await claude('POST', 'points', { points: [pt('Talk about wayfinding')] })).body.posted;
    const r = await host('POST', `points/${p[0]}`, { action: 'later' });
    assert.strictEqual(r.status, 200);
    const h = (await host('GET', 'state')).body;
    assert.deepStrictEqual(h.brief.later.map((x) => x.text), ['Talk about wayfinding']);
    assert.strictEqual(h.points.open, 0);
    assert.deepStrictEqual((await claude('GET', 'inbox')).body.inbox, []);
  });
  await check('show puts one point up (any other comes down); hide takes it down', async () => {
    seed();
    const p = (await claude('POST', 'points', { points: [pt('one'), pt('two')] })).body.posted;
    await host('POST', `points/${p[0]}`, { action: 'show' });
    await host('POST', `points/${p[1]}`, { action: 'show' });
    let items = (await host('GET', 'state')).body.points.items;
    assert.deepStrictEqual(items.map((x) => x.status), ['new', 'shown']);
    assert.strictEqual((await host('POST', `points/${p[1]}`, { action: 'hide' })).status, 200);
    items = (await host('GET', 'state')).body.points.items;
    assert.deepStrictEqual(items.map((x) => x.status), ['new', 'new']);
    assert.strictEqual((await host('POST', `points/${p[1]}`, { action: 'hide' })).status, 409);
  });
  await check('the session ended: a point cannot be posted', async () => {
    seed();
    store.get(key(`GAME#${GAME}`, 'STATE')).State = 'ENDED';
    assert.strictEqual((await claude('POST', 'points', { points: [pt('late')] })).status, 409);
    assert.strictEqual((await host('POST', 'points/requests', { kind: 'ideas', subject: 'x' })).status, 409);
  });

  console.log('\nviews: Claude sees its own, the room sees nothing yet');
  await check('Claude\'s view has a digest of ITS points and ITS requests, never the host\'s curation or a builder\'s points', async () => {
    seed();
    await host('POST', 'crew/settings', { enabled: true, modes: ['fork'] });
    await phone('Priya')('POST', 'crew/builder-key');
    const mine = (await claude('POST', 'points', { points: [pt('Claude point one'), pt('Claude point two')] })).body.posted;
    const hers = (await priya('POST', 'points', { points: [pt('Priya point')] })).body.posted;
    await host('POST', 'points/requests', { kind: 'ideas', subject: 'host ask' });
    await host('POST', `points/${mine[0]}`, { action: 'later' });
    const v = (await claude('GET', 'state')).body;
    assert.deepStrictEqual(v.points.digest.map((x) => [x.id, x.status]), [[mine[0], 'later'], [mine[1], 'new']]);
    assert.ok(typeof v.points.digest[0].outcome === 'string');
    assert.ok(!hers.some((id) => JSON.stringify(v.points).includes(id)), 'a builder\'s point is not in Claude\'s digest');
    assert.deepStrictEqual(v.points.requests.map((x) => x.subject), ['host ask']);
    assert.strictEqual(v.points.items, undefined);
    assert.ok(!JSON.stringify(v.points).includes('Claude point one'), 'the digest carries ids and status, not the host list');
  });
  await check('the phones\' and the Stage\'s view carries no points or requests yet', async () => {
    const h = (await host('GET', 'state')).body;
    assert.ok(h.points.items.length >= 3);
    const p = (await phone('Marcus')('GET', 'state')).body;
    assert.strictEqual(p.points, undefined);
    const text = JSON.stringify(p);
    assert.ok(!text.includes('Claude point one') && !text.includes('Priya point') && !text.includes('host ask'));
  });

  console.log('\nbuilders: the same help, for themselves only');
  await check('a builder\'s Claude posts points tagged with the builder\'s name, with the ttl', async () => {
    seed();
    await host('POST', 'crew/settings', { enabled: true, modes: ['fork'] });
    await phone('Priya')('POST', 'crew/builder-key');
    await phone('Sam')('POST', 'crew/builder-key');
    const r = await priya('POST', 'points', { points: [pt('Priya\'s idea'), { kind: 'idea', text: 'Try a map' }] });
    assert.strictEqual(r.status, 201, JSON.stringify(r.body));
    const rows = rowsOf('BUILD#POINT#');
    assert.deepStrictEqual(rows.map((x) => x.By), ['Priya', 'Priya']);
    assert.ok(rows.every((x) => x.ttl === 2000000000));
    const items = (await host('GET', 'state')).body.points.items;
    assert.deepStrictEqual(items.map((x) => [x.by, x.fromBuilder]), [['Priya', true], ['Priya', true]]);
  });
  await check('a builder named "claude" is still a builder: not mixed up with the host\'s Claude', async () => {
    seed();
    put({ PK: `GAME#${GAME}`, SK: 'PLAYER#claude', PlayerName: 'claude', ClientId: 'c-claude' });
    await host('POST', 'crew/settings', { enabled: true, modes: ['fork'] });
    await call('build-play', 'POST', 'crew/builder-key', { playerName: 'claude', clientId: 'c-claude' }, null);
    await as('claude')('POST', 'points', { points: [pt('from the builder')] });
    await claude('POST', 'points', { points: [pt('from the agent')] });
    const v = (await claude('GET', 'state')).body;
    assert.strictEqual(v.points.digest.length, 1);
    const b = (await as('claude')('GET', 'state')).body;
    assert.strictEqual(b.points.digest.length, 1);
  });
  await check('a builder screen asks for Research/Ideas for themselves only; it goes to their Claude alone', async () => {
    seed();
    await host('POST', 'crew/settings', { enabled: true, modes: ['fork'] });
    await phone('Priya')('POST', 'crew/builder-key');
    await phone('Sam')('POST', 'crew/builder-key');
    const r = await phone('Priya')('POST', 'crew/points/requests', { kind: 'research', subject: 'Map libraries', for: 'Sam', For: 'Sam', forBuilder: 'Sam' });
    assert.strictEqual(r.status, 201, JSON.stringify(r.body));
    const row = rowsOf('BUILD#PREQ#')[0];
    assert.strictEqual(row.ForBuilder, 'Priya', 'the body cannot choose whose request it is');
    assert.strictEqual(row.ttl, 2000000000);
    assert.deepStrictEqual((await sam('GET', 'inbox')).body.inbox, [], 'not Sam\'s Claude');
    assert.deepStrictEqual((await claude('GET', 'inbox')).body.inbox, [], 'not the host\'s Claude');
    const mine = (await priya('GET', 'inbox')).body.inbox;
    assert.deepStrictEqual(mine.map((x) => [x.kind, x.requestId, x.subject]), [['research', r.body.request.id, 'Map libraries']]);
    assert.deepStrictEqual((await priya('GET', 'inbox')).body.inbox, []);
    const h = (await host('GET', 'state')).body;
    assert.deepStrictEqual(h.points.requests.map((x) => [x.for, x.status]), [['Priya', 'working']]);
  });
  await check('a phone that is not a builder cannot ask; a bad request is 400', async () => {
    seed();
    await host('POST', 'crew/settings', { enabled: true, modes: ['fork'] });
    assert.strictEqual((await phone('Marcus')('POST', 'crew/points/requests', { kind: 'ideas', subject: 'x' })).status, 409);
    await phone('Priya')('POST', 'crew/builder-key');
    assert.strictEqual((await phone('Priya')('POST', 'crew/points/requests', { kind: 'ideas', subject: ' ' })).status, 400);
    assert.strictEqual((await phone('Priya')('POST', 'crew/points/requests', { kind: 'other', subject: 'x' })).status, 400);
    assert.strictEqual((await call('build-play', 'POST', 'crew/points/requests', { playerName: 'Priya', clientId: 'wrong', kind: 'ideas', subject: 'x' }, null)).status, 403);
  });
  await check('a builder cannot post against, or close, another builder\'s request, nor the host\'s (403)', async () => {
    seed();
    await host('POST', 'crew/settings', { enabled: true, modes: ['fork'] });
    await phone('Priya')('POST', 'crew/builder-key');
    await phone('Sam')('POST', 'crew/builder-key');
    const q = (await phone('Priya')('POST', 'crew/points/requests', { kind: 'ideas', subject: 'Priya\'s' })).body.request.id;
    const hq = (await host('POST', 'points/requests', { kind: 'ideas', subject: 'Host\'s' })).body.request.id;
    assert.strictEqual((await sam('POST', 'points', { requestId: q, points: [pt('hijack')] })).status, 403);
    assert.strictEqual((await sam('POST', 'points', { requestId: q, done: true })).status, 403);
    assert.strictEqual((await sam('POST', 'points', { requestId: hq, points: [pt('hijack')] })).status, 403);
    assert.strictEqual((await claude('POST', 'points', { requestId: q, points: [pt('hijack')] })).status, 403, 'the host\'s Claude cannot answer a builder\'s request');
    assert.strictEqual((await priya('POST', 'points', { requestId: hq, points: [pt('hijack')] })).status, 403);
    assert.strictEqual(rowsOf('BUILD#POINT#').length, 0);
    assert.strictEqual((await priya('POST', 'points', { requestId: q, points: [pt('mine')], done: true })).status, 201);
  });
  await check('a builder\'s own state carries their digest and requests only', async () => {
    seed();
    await host('POST', 'crew/settings', { enabled: true, modes: ['fork'] });
    await phone('Priya')('POST', 'crew/builder-key');
    await phone('Sam')('POST', 'crew/builder-key');
    const a = (await priya('POST', 'points', { points: [pt('Priya one')] })).body.posted;
    await sam('POST', 'points', { points: [pt('Sam one')] });
    await claude('POST', 'points', { points: [pt('Claude one')] });
    await phone('Sam')('POST', 'crew/points/requests', { kind: 'ideas', subject: 'Sam ask' });
    await host('POST', `points/${a[0]}`, { action: 'send' });
    const v = (await priya('GET', 'state')).body;
    assert.deepStrictEqual(v.points.digest.map((x) => [x.id, x.status]), [[a[0], 'sent']]);
    assert.deepStrictEqual(v.points.requests, []);
    const text = JSON.stringify(v);
    assert.ok(!text.includes('Sam one') && !text.includes('Claude one') && !text.includes('Sam ask'));
  });

  console.log('\nteam rooms: sealed at rest, read back through the API');
  await check('Point and request rows are ciphertext at rest (text, detail, sources, about, subject) and read back', async () => {
    seed({ orgId: ORG });
    HA = TEAM_HOST;
    const r = await claude('POST', 'points', { points: [{ kind: 'finding', text: 'Secret finding text', detail: 'Secret detail', about: 'Secret about', sources: [{ title: 'Secret source title', url: 'https://secret.example/page' }] }] });
    assert.strictEqual(r.status, 201, JSON.stringify(r.body));
    const q = await host('POST', 'points/requests', { kind: 'research', subject: 'Secret subject' });
    assert.strictEqual(q.status, 201, JSON.stringify(q.body));
    const at = raw();
    for (const s of ['Secret finding text', 'Secret detail', 'Secret about', 'Secret source title', 'secret.example', 'Secret subject']) assert.ok(!at.includes(s), `${s} is plaintext at rest`);
    assert.ok(rowsOf('BUILD#POINT#')[0].By === 'claude', 'By is structure');
    assert.strictEqual(rowsOf('BUILD#POINT#')[0].ttl, 2000000000);
    assert.strictEqual(rowsOf('BUILD#PREQ#')[0].ttl, 2000000000);
    const h = (await host('GET', 'state')).body;
    assert.strictEqual(h.points.items[0].text, 'Secret finding text');
    assert.strictEqual(h.points.items[0].detail, 'Secret detail');
    assert.strictEqual(h.points.items[0].about, 'Secret about');
    assert.deepStrictEqual(h.points.items[0].sources, [{ title: 'Secret source title', url: 'https://secret.example/page' }]);
    assert.strictEqual(h.points.requests[0].subject, 'Secret subject');
    const inbox = (await claude('GET', 'inbox')).body.inbox;
    assert.strictEqual(inbox[0].subject, 'Secret subject', 'delivery reads the sealed subject');
    assert.ok(!raw().includes('Secret subject'), 'still sealed after the delivery update');
    HA = HOST;
  });
  await check('a builder request in a team room is sealed too', async () => {
    seed({ orgId: ORG });
    HA = TEAM_HOST;
    await host('POST', 'crew/settings', { enabled: true, modes: ['fork'] });
    await phone('Priya')('POST', 'crew/builder-key');
    const q = await phone('Priya')('POST', 'crew/points/requests', { kind: 'ideas', subject: 'Secret builder subject' });
    assert.strictEqual(q.status, 201, JSON.stringify(q.body));
    await priya('POST', 'points', { points: [pt('Secret builder point')] });
    assert.ok(!raw().includes('Secret builder'), 'plaintext at rest');
    assert.strictEqual(rowsOf('BUILD#POINT#')[0].By, 'Priya');
    HA = HOST;
  });

  console.log('\nevery new row type carries ttl');
  await check('Point and request rows: ttl is the session\'s, also when the session has none (the default record window)', async () => {
    seed();
    delete store.get(key(`GAME#${GAME}`, 'METADATA')).ttl;
    await claude('POST', 'points', { points: [pt('no session ttl')] });
    await host('POST', 'points/requests', { kind: 'ideas', subject: 'x' });
    for (const row of [...rowsOf('BUILD#POINT#'), ...rowsOf('BUILD#PREQ#')]) assert.ok(Number(row.ttl) > Date.now() / 1000, `${row.SK} has a future ttl`);
    const id = rowsOf('BUILD#POINT#')[0].PointId;
    await host('POST', `points/${id}`, { action: 'remove' });
    assert.ok(Number(rowsOf('BUILD#POINT#')[0].ttl) > 0);
    await claude('GET', 'inbox');
    assert.ok(Number(rowsOf('BUILD#PREQ#')[0].ttl) > 0);
  });

  console.log(`\n${pass} passed, ${failed} failed`);
  suiteFinished();
  process.exit(failed ? 1 : 0);
})();
