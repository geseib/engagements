/**
 * BUILD ROOM REMOTE SHARE — the handler (lambda-functions/game/build-room.js)
 * against a fake table. Plan docs/superpowers/plans/2026-10-16-build-room-remote-share.md
 * Task 2; spec docs/superpowers/specs/2026-10-16-build-room-remote-share-design.md §4.3.
 *
 * The host's switch, the plugin's report and what it is answered (key HASHES
 * only), the plugin's check of a key it has not heard of yet, and the phone's
 * own link. A key ends when its person is removed (both doors), moves devices,
 * or is given a newer one. The harness is tests/build-crew.js's.
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
  const removePart = (/^REMOVE (.*)$/.exec(expr) || [])[1];
  if (removePart) for (const a of removePart.split(',')) delete item[n(a.trim())];
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
const removePlayer = require(path.join(REPO, 'lambda-functions/game/remove-player.js'));

let pass = 0;
let failed = 0;
async function check(label, fn) {
  try { await fn(); console.log(`  PASS  ${label}`); pass++; } catch (e) { console.log(`  FAIL  ${label}\n        ${e.stack.split('\n').slice(0, 3).join('\n        ')}`); failed++; }
}

const L = require(path.join(REPO, 'lambda-functions/game/build-lan.js'));
const GAME = '4821';
const PK = `GAME#${GAME}`;
const put = (item) => store.set(key(item.PK, item.SK), item);
const row = (sk) => store.get(key(PK, sk));
function seed() {
  store.clear(); bucket.clear(); sent = [];
  put({ PK, SK: 'METADATA', GameType: 'build', Title: 'Food bank sign-up', Details: 'Sign up in a minute', ttl: 2000000000 });
  put({ PK, SK: 'STATE', State: 'STARTED' });
  put({ PK, SK: 'CONNECTION#h1', ConnectionId: 'h1', ConnectionType: 'HOST' });
  for (const n of ['Priya', 'Sam', 'Ana']) put({ PK, SK: `PLAYER#${n}`, PlayerName: n, ClientId: `c-${n}` });
  put({ PK, SK: 'BUILD#LOG#0000000000001#aaaa', By: 'agent', Kind: 'showing', Text: 'The board', Link: 'http://localhost:5173/board', CreatedAt: '2026-10-16T11:00:00.000Z' });
}
const HOST = { userId: 'host-1', groups: 'hosts', orgId: '', orgIds: '' };
const CLAUDE = { agent: 'build', agentGameId: GAME, agentKeyHash: 'h', agentRole: 'host', groups: '' };
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
const host = (m, p, b) => call('build', m, p, b, HOST);
const claude = (m, p, b) => call('build', m, p, b, CLAUDE);
const phone = (name, clientId = `c-${name}`) => (m, p, b) => call('build-play', m, p, m === 'GET' ? undefined : { playerName: name, clientId, ...(b || {}) }, null, m === 'GET' ? { playerName: name, clientId } : undefined);

const ADDRESS = 'https://window-jpg-you-quiet.trycloudflare.com';
const REPORTER = 'reporter-aaaaaaaa';
const wifiLive = { status: 'live', key: 'abcdefghijklmnopqrstuv', open: 0, map: [{ local: 'http://localhost:5173', lan: 'http://192.168.1.20:4900' }], reporter: REPORTER };
const report = (remote, over = {}) => claude('POST', 'share/report', { ...wifiLive, ...(remote === undefined ? {} : { remote }), ...over });
const remoteLive = (devices = {}) => ({ status: 'live', address: ADDRESS, target: 'http://localhost:5173', error: '', devices });
/** Claude's replies carry its inbox too; only the check's own fields matter here. */
const checked = async (hash) => { const r = await claude('POST', 'share/remote-check', { hash }); const { ok, player } = r.body; return player ? { ok, player } : { ok }; };
const rkeys = () => [...store.values()].filter((x) => String(x.SK).startsWith('BUILD#RKEY#'));

(async () => {
  console.log('\nthe host\'s switch');
  seed();
  await check('remote cannot be turned on before the demo is shared', async () => {
    const r = await host('POST', 'share', { remote: true });
    assert.strictEqual(r.status, 409);
  });
  await check('sharing on with remote on: both wanted, the remote fields cleared', async () => {
    const r = await host('POST', 'share', { on: true, remote: true });
    assert.strictEqual(r.status, 200, JSON.stringify(r.body));
    const lan = row('BUILD#LAN');
    assert.strictEqual(lan.Wanted, true);
    assert.strictEqual(lan.RemoteWanted, true);
    assert.deepStrictEqual([lan.RemoteStatus, lan.RemoteAddress, lan.RemoteTarget, lan.RemoteError], ['off', '', '', '']);
    assert.deepStrictEqual(lan.RemoteDevices, {});
    assert.deepStrictEqual(r.body.lan.remote, { wanted: true, status: 'starting', error: '', people: [] });
  });
  await check('remote alone off leaves the Wi-Fi share on; on again works', async () => {
    await host('POST', 'share', { remote: false });
    assert.deepStrictEqual([row('BUILD#LAN').Wanted, row('BUILD#LAN').RemoteWanted], [true, false]);
    await host('POST', 'share', { remote: true });
    assert.strictEqual(row('BUILD#LAN').RemoteWanted, true);
  });
  await check('sharing off turns remote off too; sharing on again starts with remote off', async () => {
    await host('POST', 'share', { on: false });
    assert.deepStrictEqual([row('BUILD#LAN').Wanted, row('BUILD#LAN').RemoteWanted], [false, false]);
    await host('POST', 'share', { on: true });
    assert.strictEqual(row('BUILD#LAN').RemoteWanted, false);
  });
  await check('only the host turns it on; not on an ended session', async () => {
    assert.strictEqual((await claude('POST', 'share', { remote: true })).status, 403);
    put({ PK, SK: 'STATE', State: 'ENDED' });
    assert.strictEqual((await host('POST', 'share', { remote: true })).status, 409);
    put({ PK, SK: 'STATE', State: 'STARTED' });
  });

  console.log('\nthe plugin\'s report and its answer');
  seed();
  await host('POST', 'share', { on: true, remote: true });
  await check('remote wanted: the answer says so, with no keys yet', async () => {
    const r = await report({ status: 'off', address: '', target: '', error: '', devices: {} });
    assert.strictEqual(r.status, 200, JSON.stringify(r.body));
    assert.deepStrictEqual([r.body.wanted, r.body.remoteWanted, r.body.remoteKeys], [true, true, []]);
  });
  await check('a live remote report is stored; it went live now', async () => {
    const r = await report(remoteLive());
    assert.strictEqual(r.status, 200);
    const lan = row('BUILD#LAN');
    assert.deepStrictEqual([lan.RemoteStatus, lan.RemoteAddress, lan.RemoteTarget, lan.RemoteSupported], ['live', ADDRESS, 'http://localhost:5173', true]);
    assert.ok(lan.RemoteLiveSince);
  });
  await check('a phone sees remote live, with no address and no key', async () => {
    const v = (await phone('Ana')('GET', 'state')).body;
    assert.strictEqual(v.lan.remote, 'live');
    assert.strictEqual(v.lan.remotePath, '/board');
    // The History tab's links still carry the Wi-Fi room key, as before remote
    // existed; nothing anywhere carries the tunnel's address or a remote key.
    assert.ok(!/trycloudflare/.test(JSON.stringify(v)));
    assert.ok(!/[?&]k=/.test(JSON.stringify(v.lan)), JSON.stringify(v.lan));
  });
  await check('the host sees remote live and never the address', async () => {
    const v = (await host('GET', 'state')).body;
    assert.strictEqual(v.lan.remote.status, 'live');
    assert.ok(!/trycloudflare/.test(JSON.stringify(v)));
  });
  await check('a bad remote report is refused whole', async () => {
    assert.strictEqual((await report({ ...remoteLive(), address: 'https://evil.example' })).status, 400);
  });
  await check('an old plugin (no remote block) reads as failed to the host, with what to do', async () => {
    await report(undefined);
    const v = (await host('GET', 'state')).body;
    assert.strictEqual(v.lan.remote.status, 'failed');
    assert.match(v.lan.remote.error, /Update/);
    await report(remoteLive());
  });
  await check('a second plugin copy is told remote is not wanted either', async () => {
    const r = await report(remoteLive(), { reporter: 'reporter-bbbbbbbb' });
    assert.deepStrictEqual(r.body, { wanted: false, targets: [], another: true }, 'no remote fields: absent means not wanted');
  });

  console.log('\na phone\'s own link');
  let priya;
  await check('Priya gets the tunnel\'s origin, a fresh key and when it went live; only its hash is stored', async () => {
    const r = await phone('Priya')('POST', 'remote-key');
    assert.strictEqual(r.status, 200, JSON.stringify(r.body));
    priya = r.body;
    assert.strictEqual(priya.origin, ADDRESS);
    assert.match(priya.key, /^[A-Za-z0-9_-]{22}$/);
    assert.strictEqual(priya.since, row('BUILD#LAN').RemoteLiveSince);
    const stored = row('BUILD#RKEY#Priya');
    assert.deepStrictEqual([stored.PlayerName, stored.Hash, stored.ClientId], ['Priya', L.hashKey(priya.key), 'c-Priya']);
    assert.ok(!JSON.stringify(stored).includes(priya.key), 'the raw key is never stored');
  });
  await check('the next report answers Priya\'s hash, and only hashes', async () => {
    const r = await report(remoteLive());
    assert.deepStrictEqual(r.body.remoteKeys, [{ hash: L.hashKey(priya.key), player: 'Priya' }]);
    assert.ok(!JSON.stringify(r.body).includes(priya.key));
  });
  await check('asking again mints a new key and ends the old one', async () => {
    const again = (await phone('Priya')('POST', 'remote-key')).body;
    assert.notStrictEqual(again.key, priya.key);
    const r = await report(remoteLive());
    assert.deepStrictEqual(r.body.remoteKeys.map((k) => k.hash), [L.hashKey(again.key)]);
    priya = again;
  });
  await check('a phone that is not in the session gets nothing', async () => {
    assert.strictEqual((await phone('Nobody')('POST', 'remote-key')).status, 403);
    assert.strictEqual((await phone('Sam', 'someone-else')('POST', 'remote-key')).status, 403);
  });
  await check('remote not live: 409 not-live, and nothing minted', async () => {
    const before = rkeys().length;
    await report({ status: 'failed', address: '', target: '', error: 'Cloudflare said no', devices: {} });
    const r = await phone('Sam')('POST', 'remote-key');
    assert.deepStrictEqual([r.status, r.body.code], [409, 'not-live']);
    assert.strictEqual(rkeys().length, before);
    await report(remoteLive());
  });

  console.log('\nthe plugin checks a key it has not heard of');
  await check('a live key: yes, and whose; anything else: no', async () => {
    assert.deepStrictEqual(await checked(L.hashKey(priya.key)), { ok: true, player: 'Priya' });
    assert.deepStrictEqual(await checked(L.hashKey('guess')), { ok: false });
    assert.strictEqual((await claude('POST', 'share/remote-check', { hash: 'short' })).status, 400);
  });
  await check('only Claude Code may ask', async () => {
    assert.strictEqual((await host('POST', 'share/remote-check', { hash: L.hashKey(priya.key) })).status, 403);
    const p = await phone('Priya')('POST', 'share/remote-check', { hash: L.hashKey(priya.key) });
    assert.notStrictEqual(p.status, 200);
    assert.ok(!p.body.ok);
  });

  console.log('\nwhen a key ends');
  await check('Priya moves devices (handover): her old key is gone from the answer at once', async () => {
    put({ ...row('PLAYER#Priya'), ClientId: 'c-Priya-laptop' });
    const r = await report(remoteLive());
    assert.deepStrictEqual(r.body.remoteKeys, []);
    assert.deepStrictEqual((await checked(L.hashKey(priya.key))), { ok: false });
    // The new device gets its own.
    const fresh = (await phone('Priya', 'c-Priya-laptop')('POST', 'remote-key')).body;
    assert.deepStrictEqual((await report(remoteLive())).body.remoteKeys.map((k) => k.player), ['Priya']);
    priya = fresh;
  });
  await check('the host removes Sam (remove-player): his key opens nothing', async () => {
    const sam = (await phone('Sam')('POST', 'remote-key')).body;
    assert.deepStrictEqual((await report(remoteLive())).body.remoteKeys.map((k) => k.player).sort(), ['Priya', 'Sam']);
    put({ ...row('PLAYER#Sam'), RemovedAt: '2026-10-16T12:00:00.000Z' });
    assert.deepStrictEqual((await report(remoteLive())).body.remoteKeys.map((k) => k.player), ['Priya']);
    assert.deepStrictEqual((await checked(L.hashKey(sam.key))), { ok: false });
  });
  await check('remote turned off: no keys are answered, whatever is stored', async () => {
    await host('POST', 'share', { remote: false });
    const r = await report({ status: 'off', address: '', target: '', error: '', devices: {} });
    assert.deepStrictEqual([r.body.remoteWanted, r.body.remoteKeys], [undefined, undefined], 'absent means not wanted');
    assert.deepStrictEqual((await checked(L.hashKey(priya.key))), { ok: false });
  });

  console.log('\nthe release gate (§2c)');
  await check('a demo Claude posted that is still held is not what remote forwards to', async () => {
    put({ PK, SK: 'BUILD#LOG#0000000000009#held', By: 'agent', Kind: 'showing', Text: 'New demo', Link: 'http://localhost:6006/demo/', Role: 'demo', Released: false, CreatedAt: '2026-10-16T11:30:00.000Z' });
    await host('POST', 'share', { remote: true });
    const r = await report(remoteLive());
    assert.strictEqual(r.body.remoteTarget, 'http://localhost:5173');
    put({ ...row('BUILD#LOG#0000000000009#held'), Released: true });
    const after = await report(remoteLive());
    assert.strictEqual(after.body.remoteTarget, 'http://localhost:6006');
    store.delete(key(PK, 'BUILD#LOG#0000000000009#held'));
    await host('POST', 'share', { remote: false });
  });

  console.log('\nwhich plugin (owner, 18 Oct)');
  await check('Claude\'s state names the latest plugin and nothing else of the host\'s; the host\'s view keeps its plugin line', async () => {
    const S = require(path.join(REPO, 'lambda-functions/game/build-store.js'));
    const c = (await claude('GET', 'state')).body;
    assert.strictEqual(c.pluginLatest, S.LATEST_PLUGIN);
    assert.strictEqual(c.plugin, undefined);
    const h = (await host('GET', 'state')).body;
    assert.strictEqual(h.plugin.latest, S.LATEST_PLUGIN);
    assert.strictEqual(h.pluginLatest, undefined);
  });

  console.log('\nwho opened it');
  await check('the plugin\'s device counts reach the host by name, most first', async () => {
    await host('POST', 'share', { remote: true });
    await report(remoteLive({ Priya: 1, Ana: 2 }));
    const v = (await host('GET', 'state')).body;
    assert.deepStrictEqual(v.lan.remote.people, [{ name: 'Ana', devices: 2 }, { name: 'Priya', devices: 1 }]);
  });
  await check('a reopened tunnel (new address) is a new since, so phones refetch', async () => {
    const before = row('BUILD#LAN').RemoteLiveSince;
    await new Promise((r) => setTimeout(r, 5));
    await report({ ...remoteLive(), address: 'https://other-name-here.trycloudflare.com' });
    assert.notStrictEqual(row('BUILD#LAN').RemoteLiveSince, before);
    const k = (await phone('Ana')('POST', 'remote-key')).body;
    assert.strictEqual(k.origin, 'https://other-name-here.trycloudflare.com');
  });

  console.log(`\n${pass} passed, ${failed} failed`);
  suiteFinished();
  process.exit(failed ? 1 : 0);
})();
