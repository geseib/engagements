/**
 * PRESENTATION SOCKETS (two-surface PLAN 2.1, D4).
 *
 * The Presentation (`/present?gameId=`) connects with no name. Every name-less
 * socket used to be stored `PlayerName: null`, and connect.js retires older
 * PLAYER rows with the same PlayerName — so a second Presentation evicted the
 * first, which then went silent while still showing "connected".
 *
 * A Presentation now connects as a VIEWER: `viewer=present&viewerId=<uuid per
 * tab>`. The row stays `ConnectionType: 'PLAYER'`, so every public broadcast
 * still reaches it, and gains `Viewer: 'present'` and `ViewerId`.
 *
 *   §1  two viewers survive each other
 *   §2  a reconnecting viewer retires only its own older row
 *   §3  a name-less ordinary socket no longer retires a viewer, and a player
 *       named "null" is unaffected by viewers
 *   §4  a viewer is never HOST, whatever it asks for
 *   §5  host dedup is unchanged
 *   §6  `presentingCount` counts viewer rows across every page, and the host's
 *       door of get-game-state reports it as `presenting`
 */
const suiteFinished = require('./helpers/finish-guard');
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const REPO = path.join(__dirname, '..');

/* ---- connect.js against a fake that honours its filters ------------------- */

class PutCommand { constructor(i) { this.input = i; this.type = 'put'; } }
class QueryCommand { constructor(i) { this.input = i; this.type = 'query'; } }
class DeleteCommand { constructor(i) { this.input = i; this.type = 'delete'; } }

const store = new Map();
const key = (pk, sk) => `${pk}|${sk}`;

/**
 * Only the filter shapes connect.js sends are understood; anything else
 * throws, so a handler that dropped its filter cannot pass by matching
 * everything.
 */
function applyFilter(items, input) {
  const expr = input.FilterExpression;
  const v = input.ExpressionAttributeValues || {};
  if (!expr) return items;
  if (expr === 'ConnectionType = :ct') return items.filter((i) => i.ConnectionType === v[':ct']);
  if (expr === 'ConnectionType = :ct AND ViewerId = :vid') {
    return items.filter((i) => i.ConnectionType === v[':ct'] && i.ViewerId === v[':vid']);
  }
  if (expr === 'ConnectionType = :ct AND PlayerName = :pn AND attribute_not_exists(ViewerId)') {
    return items.filter((i) => i.ConnectionType === v[':ct'] && i.PlayerName === v[':pn'] && !('ViewerId' in i));
  }
  throw new Error(`fake query: unsupported FilterExpression ${expr}`);
}

const fakeDoc = {
  send: async (cmd) => {
    const inp = cmd.input || {};
    if (cmd.type === 'put') { store.set(key(inp.Item.PK, inp.Item.SK), inp.Item); return {}; }
    if (cmd.type === 'delete') {
      const k = key(inp.Key.PK, inp.Key.SK);
      if (inp.ConditionExpression) {
        const item = store.get(k);
        if (!item || !(item.ExpiresAt > inp.ExpressionAttributeValues[':now'])) {
          const e = new Error('The conditional request failed');
          e.name = 'ConditionalCheckFailedException';
          throw e;
        }
      }
      store.delete(k);
      return {};
    }
    if (cmd.type === 'query') {
      const pk = inp.ExpressionAttributeValues[':pk'];
      const prefix = inp.ExpressionAttributeValues[':sk'] ?? '';
      const items = [...store.values()].filter((i) => i.PK === pk && String(i.SK).startsWith(String(prefix)));
      return { Items: applyFilter(items, inp) };
    }
    return {};
  },
};

const Module = require('module');
const stubs = new Map();
const realLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (stubs.has(request)) return stubs.get(request);
  return realLoad.call(this, request, parent, isMain);
};
stubs.set('@aws-sdk/client-dynamodb', { DynamoDBClient: class {} });
stubs.set('@aws-sdk/lib-dynamodb', { DynamoDBDocumentClient: { from: () => fakeDoc }, PutCommand, QueryCommand, DeleteCommand });

process.env.TABLE_NAME = 'test-table';
if (!process.env.DEBUG) { console.log = () => {}; console.error = () => {}; console.warn = () => {}; }
const say = (...a) => process.stdout.write(a.join(' ') + '\n');

const { handler } = require(path.join(REPO, 'lambda-functions/websocket/connect.js'));

let pass = 0; let fail = 0;
async function check(label, fn) {
  try { await fn(); pass += 1; say(`  PASS  ${label}`); } catch (e) { fail += 1; say(`  FAIL  ${label}\n        ${e.message}`); }
}

const GAME = '5479';
const connect = (connectionId, query) => handler({
  requestContext: { connectionId },
  queryStringParameters: { gameId: GAME, ...query },
});
const put = (item) => store.set(key(item.PK, item.SK), item);
const rows = () => [...store.values()].filter((i) => String(i.SK).startsWith('CONNECTION#'));
const ids = () => rows().map((i) => i.ConnectionId).sort();
const row = (id) => rows().find((i) => i.ConnectionId === id);
const earlier = () => new Date(Date.now() - 60_000).toISOString();

let ticketSeq = 0;
const asHost = () => {
  ticketSeq += 1;
  const hostTicket = ticketSeq.toString(16).padStart(64, '0');
  const expiresAt = Math.floor(Date.now() / 1000) + 60;
  put({ PK: `GAME#${GAME}`, SK: `HOSTTICKET#${hostTicket}`, GameId: GAME, ExpiresAt: expiresAt, ttl: expiresAt });
  return { isHost: 'true', hostTicket };
};

const VIEWER_A = '0f8e6d2c-1111-4a5b-9c3d-aaaaaaaaaaaa';
const VIEWER_B = '0f8e6d2c-2222-4a5b-9c3d-bbbbbbbbbbbb';

(async () => {
  say('\n§1. two Presentations survive each other');
  await check('both viewer rows stay, each marked as a viewer', async () => {
    store.clear();
    await connect('wall-a', { viewer: 'present', viewerId: VIEWER_A });
    await connect('wall-b', { viewer: 'present', viewerId: VIEWER_B });
    assert.deepStrictEqual(ids(), ['wall-a', 'wall-b']);
    for (const [id, vid] of [['wall-a', VIEWER_A], ['wall-b', VIEWER_B]]) {
      assert.strictEqual(row(id).ConnectionType, 'PLAYER', 'a viewer must still get every public broadcast');
      assert.strictEqual(row(id).Viewer, 'present');
      assert.strictEqual(row(id).ViewerId, vid);
      assert.strictEqual(row(id).PlayerName, null);
    }
  });

  say('\n§2. a reconnecting Presentation retires only its own older row');
  await check('the same tab reconnecting replaces its row and leaves the other tab alone', async () => {
    store.clear();
    put({ PK: `GAME#${GAME}`, SK: 'CONNECTION#wall-a1', ConnectionId: 'wall-a1', ConnectionType: 'PLAYER',
      GameId: GAME, PlayerName: null, Viewer: 'present', ViewerId: VIEWER_A, ConnectedAt: earlier() });
    put({ PK: `GAME#${GAME}`, SK: 'CONNECTION#wall-b1', ConnectionId: 'wall-b1', ConnectionType: 'PLAYER',
      GameId: GAME, PlayerName: null, Viewer: 'present', ViewerId: VIEWER_B, ConnectedAt: earlier() });
    await connect('wall-a2', { viewer: 'present', viewerId: VIEWER_A });
    assert.deepStrictEqual(ids(), ['wall-a2', 'wall-b1']);
  });
  await check('a viewerId that is not an id is refused as a viewer identity (no shared dedup key)', async () => {
    store.clear();
    await connect('wall-x', { viewer: 'present', viewerId: 'x'.repeat(500) });
    await connect('wall-y', { viewer: 'present', viewerId: 'x'.repeat(500) });
    // Each falls back to its own connection id, so neither can evict the other.
    assert.deepStrictEqual(ids(), ['wall-x', 'wall-y']);
    assert.ok(String(row('wall-x').ViewerId).length <= 64);
  });

  say('\n§3. ordinary sockets and viewers do not retire each other');
  await check('a name-less ordinary socket does not evict a Presentation', async () => {
    store.clear();
    put({ PK: `GAME#${GAME}`, SK: 'CONNECTION#wall-a', ConnectionId: 'wall-a', ConnectionType: 'PLAYER',
      GameId: GAME, PlayerName: null, Viewer: 'present', ViewerId: VIEWER_A, ConnectedAt: earlier() });
    await connect('anon-1', {});
    assert.deepStrictEqual(ids(), ['anon-1', 'wall-a']);
  });
  await check('a Presentation does not evict a name-less ordinary socket', async () => {
    store.clear();
    put({ PK: `GAME#${GAME}`, SK: 'CONNECTION#anon-1', ConnectionId: 'anon-1', ConnectionType: 'PLAYER',
      GameId: GAME, PlayerName: null, ConnectedAt: earlier() });
    await connect('wall-a', { viewer: 'present', viewerId: VIEWER_A });
    assert.deepStrictEqual(ids(), ['anon-1', 'wall-a']);
  });
  await check('a player named "null" keeps their own dedup and is untouched by viewers', async () => {
    store.clear();
    put({ PK: `GAME#${GAME}`, SK: 'CONNECTION#null-1', ConnectionId: 'null-1', ConnectionType: 'PLAYER',
      GameId: GAME, PlayerName: 'null', ConnectedAt: earlier() });
    await connect('wall-a', { viewer: 'present', viewerId: VIEWER_A });
    assert.deepStrictEqual(ids(), ['null-1', 'wall-a']);
    await connect('null-2', { playerName: 'null' });
    assert.deepStrictEqual(ids(), ['null-2', 'wall-a']);
  });
  await check('player dedup still retires the same name\'s older row', async () => {
    store.clear();
    put({ PK: `GAME#${GAME}`, SK: 'CONNECTION#ada-1', ConnectionId: 'ada-1', ConnectionType: 'PLAYER',
      GameId: GAME, PlayerName: 'Ada', ConnectedAt: earlier() });
    await connect('ada-2', { playerName: 'Ada' });
    assert.deepStrictEqual(ids(), ['ada-2']);
    assert.ok(!('Viewer' in row('ada-2')), 'an ordinary player was marked as a viewer');
  });

  say('\n§4. a viewer is never the host');
  await check('viewer=present with a live host ticket still stores PLAYER, and leaves the ticket unspent', async () => {
    store.clear();
    const host = asHost();
    await connect('wall-a', { viewer: 'present', viewerId: VIEWER_A, ...host });
    assert.strictEqual(row('wall-a').ConnectionType, 'PLAYER');
    assert.ok(store.has(key(`GAME#${GAME}`, `HOSTTICKET#${host.hostTicket}`)), 'a viewer spent a host ticket');
  });
  await check('a viewer carries no player name even if one is sent', async () => {
    store.clear();
    await connect('wall-a', { viewer: 'present', viewerId: VIEWER_A, playerName: 'Ada' });
    assert.strictEqual(row('wall-a').PlayerName, null);
  });

  say('\n§5. host dedup is unchanged');
  await check('a second host retires the first, and leaves viewers', async () => {
    store.clear();
    put({ PK: `GAME#${GAME}`, SK: 'CONNECTION#host-1', ConnectionId: 'host-1', ConnectionType: 'HOST',
      GameId: GAME, PlayerName: null, ConnectedAt: earlier() });
    put({ PK: `GAME#${GAME}`, SK: 'CONNECTION#wall-a', ConnectionId: 'wall-a', ConnectionType: 'PLAYER',
      GameId: GAME, PlayerName: null, Viewer: 'present', ViewerId: VIEWER_A, ConnectedAt: earlier() });
    await connect('host-2', asHost());
    assert.deepStrictEqual(ids(), ['host-2', 'wall-a']);
    assert.strictEqual(row('host-2').ConnectionType, 'HOST');
  });

  say('\n§6. presenting: how many Presentations are open');
  const { createPagedTable } = require('./helpers/paged-table');
  const { presentingCount } = require(path.join(REPO, 'lambda-functions/game/room-counts.js'));
  const paged = createPagedTable({ pageSize: 2 });
  const PK = `GAME#${GAME}`;
  for (let i = 0; i < 3; i += 1) {
    paged.put({ PK, SK: `CONNECTION#wall-${i}`, ConnectionType: 'PLAYER', Viewer: 'present', ViewerId: `v-${i}` });
  }
  paged.put({ PK, SK: 'CONNECTION#ada', ConnectionType: 'PLAYER', PlayerName: 'Ada' });
  paged.put({ PK, SK: 'CONNECTION#host', ConnectionType: 'HOST' });
  paged.put({ PK, SK: 'CONNECTION#anon', ConnectionType: 'PLAYER', PlayerName: null });
  await check('counts viewer rows only, across every page', async () => {
    assert.strictEqual(await presentingCount(paged, 'test-table', GAME), 3);
  });
  await check('0 for a game with no Presentation', async () => {
    assert.strictEqual(await presentingCount(paged, 'test-table', '0000'), 0);
  });
  await check('get-game-state reports it on the host door, not as a constant', () => {
    const src = fs.readFileSync(path.join(REPO, 'lambda-functions/game/get-game-state.js'), 'utf8');
    assert.ok(/response\.presenting\s*=\s*await\s+presentingCount\(/.test(src), 'presenting is not read from viewer rows');
  });

  say(`\n${pass} passed, ${fail} failed\n`);
  suiteFinished();
  process.exit(fail ? 1 : 0);
})();
