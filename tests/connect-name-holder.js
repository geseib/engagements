/**
 * $connect ASKS WHO HOLDS THE NAME BEFORE IT RETIRES ANYONE.
 *
 * rejects: dev QA 1 Nov — after "Let them", Sam's OLD phone dropped off the
 * network and reconnected while still on its live page. connect.js retired
 * every older CONNECTION# row under PlayerName "Sam", which was the NEW
 * phone's row; the new phone stopped hearing the room and sat on "Answer
 * received" until a reload.
 *
 * The player page now sends `clientId` on the socket URL. A named socket
 * whose id is not the PLAYER# row's (name-holder.js) is neither registered
 * nor allowed to retire anything; the page's NAME_CHECK straight after the
 * reopen gets the `nameMoved` frame from message.js.
 *
 *   §1  the new device's row survives the old device's reconnect
 *   §2  a same-device reconnect still replaces its own stale row
 *   §3  a connect with no client id behaves exactly as before
 *   §4  an event seat (AttendeeId) dedups as before, whatever the id
 *   §5  a failed holder read registers and retires nobody
 *   §6  the player page and the client send the id
 */
const suiteFinished = require('./helpers/finish-guard');
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const REPO = path.join(__dirname, '..');

class PutCommand { constructor(i) { this.input = i; this.type = 'put'; } }
class QueryCommand { constructor(i) { this.input = i; this.type = 'query'; } }
class DeleteCommand { constructor(i) { this.input = i; this.type = 'delete'; } }
class GetCommand { constructor(i) { this.input = i; this.type = 'get'; } }

const store = new Map();
const key = (pk, sk) => `${pk}|${sk}`;
let failGets = false;
const gets = [];

function applyFilter(items, input) {
  const expr = input.FilterExpression;
  const v = input.ExpressionAttributeValues || {};
  if (expr === 'ConnectionType = :ct') return items.filter((i) => i.ConnectionType === v[':ct']);
  if (expr === 'ConnectionType = :ct AND PlayerName = :pn AND attribute_not_exists(ViewerId)') {
    return items.filter((i) => i.ConnectionType === v[':ct'] && i.PlayerName === v[':pn'] && !('ViewerId' in i));
  }
  throw new Error(`fake query: unsupported FilterExpression ${expr}`);
}

const fakeDoc = {
  send: async (cmd) => {
    const inp = cmd.input || {};
    if (cmd.type === 'put') { store.set(key(inp.Item.PK, inp.Item.SK), inp.Item); return {}; }
    if (cmd.type === 'delete') { store.delete(key(inp.Key.PK, inp.Key.SK)); return {}; }
    if (cmd.type === 'get') {
      gets.push(inp);
      if (failGets) throw new Error('ProvisionedThroughputExceededException');
      return { Item: store.get(key(inp.Key.PK, inp.Key.SK)) };
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
stubs.set('@aws-sdk/lib-dynamodb', {
  DynamoDBDocumentClient: { from: () => fakeDoc }, PutCommand, QueryCommand, DeleteCommand, GetCommand,
});

process.env.TABLE_NAME = 'test-table';
if (!process.env.DEBUG) { console.log = () => {}; console.error = () => {}; console.warn = () => {}; }
const say = (...a) => process.stdout.write(a.join(' ') + '\n');

const { handler } = require(path.join(REPO, 'lambda-functions/websocket/connect.js'));

let pass = 0; let fail = 0;
async function check(label, fn) {
  try { await fn(); pass += 1; say(`  PASS  ${label}`); } catch (e) { fail += 1; say(`  FAIL  ${label}\n        ${e.message}`); }
}

const GAME = '5479';
const OLD = 'browser-old-1111';
const NEW = 'browser-new-2222';
const connect = (connectionId, query) => handler({
  requestContext: { connectionId },
  queryStringParameters: { gameId: GAME, ...query },
});
const put = (item) => store.set(key(item.PK, item.SK), item);
const rows = () => [...store.values()].filter((i) => String(i.SK).startsWith('CONNECTION#'));
const ids = () => rows().map((i) => i.ConnectionId).sort();
const earlier = () => new Date(Date.now() - 60_000).toISOString();
const playerRow = (extra) => put({ PK: `GAME#${GAME}`, SK: 'PLAYER#Sam', PlayerName: 'Sam', ...extra });
const connRow = (id, extra = {}) => put({
  PK: `GAME#${GAME}`, SK: `CONNECTION#${id}`, ConnectionId: id, ConnectionType: 'PLAYER',
  GameId: GAME, PlayerName: 'Sam', ConnectedAt: earlier(), ...extra,
});

(async () => {
  say('\n§1. the new device keeps its row when the old device reconnects');
  await check('old phone reconnecting retires nothing and is not registered', async () => {
    store.clear(); gets.length = 0;
    playerRow({ ClientId: NEW });          // the name moved to the new phone
    connRow('new-phone');                  // the new phone's live row
    const res = await connect('old-phone-2', { playerName: 'Sam', clientId: OLD });
    assert.strictEqual(res.statusCode, 200, 'the handshake is accepted so NAME_CHECK can be answered');
    assert.deepStrictEqual(ids(), ['new-phone']);
    assert.strictEqual(gets.length, 1);
    assert.strictEqual(gets[0].ConsistentRead, true, 'straight after a handover a stale read names the old browser');
    assert.strictEqual(gets[0].Key.SK, 'PLAYER#Sam');
  });

  say('\n§2. a same-device reconnect still cleans up its own stale row');
  await check('the holder reconnecting replaces its older row', async () => {
    store.clear();
    playerRow({ ClientId: NEW });
    connRow('new-phone');
    await connect('new-phone-2', { playerName: 'Sam', clientId: NEW });
    assert.deepStrictEqual(ids(), ['new-phone-2']);
  });
  await check('an id with stray whitespace is the same device', async () => {
    store.clear();
    playerRow({ ClientId: NEW });
    connRow('new-phone');
    await connect('new-phone-2', { playerName: 'Sam', clientId: ` ${NEW} ` });
    assert.deepStrictEqual(ids(), ['new-phone-2']);
  });

  say('\n§3. no client id: today\'s behaviour');
  await check('a page without an id dedups by name and reads nothing', async () => {
    store.clear(); gets.length = 0;
    playerRow({ ClientId: NEW });
    connRow('new-phone');
    await connect('legacy-2', { playerName: 'Sam' });
    assert.deepStrictEqual(ids(), ['legacy-2']);
    assert.strictEqual(gets.length, 0, 'no extra read for a page that sends no id');
  });
  await check('a player row with no ClientId lets any id through', async () => {
    store.clear();
    playerRow({});
    connRow('a');
    await connect('b', { playerName: 'Sam', clientId: OLD });
    assert.deepStrictEqual(ids(), ['b']);
  });
  await check('no player row at all lets the id through', async () => {
    store.clear();
    connRow('a');
    await connect('b', { playerName: 'Sam', clientId: OLD });
    assert.deepStrictEqual(ids(), ['b']);
  });

  say('\n§4. event seats unchanged');
  await check('an attendee on a second device dedups as before', async () => {
    store.clear();
    playerRow({ ClientId: NEW, AttendeeId: 'att-1' });
    connRow('laptop');
    await connect('phone', { playerName: 'Sam', clientId: OLD });
    assert.deepStrictEqual(ids(), ['phone']);
  });

  say('\n§5. a failed holder read deletes nothing');
  await check('registered, and the other row survives', async () => {
    store.clear(); failGets = true;
    connRow('new-phone');
    const res = await connect('old-phone-2', { playerName: 'Sam', clientId: OLD });
    failGets = false;
    assert.strictEqual(res.statusCode, 200);
    assert.deepStrictEqual(ids(), ['new-phone', 'old-phone-2']);
  });

  say('\n§6. the page sends the id');
  await check('WebSocketClient puts clientId on a named player URL and keeps it for reconnects', async () => {
    const src = fs.readFileSync(path.join(REPO, 'src/src/WebSocketClient.js'), 'utf8');
    assert.ok(/&clientId=\$\{encodeURIComponent\(this\.clientId\)\}/.test(src));
    assert.ok(/clientId: this\.clientId \}\);/.test(src), '_reconnect must carry the id');
  });
  await check('PlayerPage passes its client id to connect', async () => {
    const src = fs.readFileSync(path.join(REPO, 'src/src/PlayerPage.jsx'), 'utf8');
    assert.ok(/webSocketClient\.connect\(gameId, playerName, false, \{ clientId: getClientId\(gameId\)/.test(src));
  });

  say(`\n${pass} passed, ${fail} failed`);
  suiteFinished();
  process.exit(fail ? 1 : 0);
})();
