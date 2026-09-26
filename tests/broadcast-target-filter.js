/**
 * broadcastToGame's HOST/PARTICIPANTS filters must read a field a writer
 * actually sets.
 *
 * THE BUG THIS PINS. schema-compliant-manager.js's broadcastToGame filtered
 * targeted sends on `conn.IsHost === true` / `conn.IsHost !== true`. The only
 * writer of a connection row, connect.js, has never written `IsHost` — it
 * writes `ConnectionType: 'HOST' | 'PLAYER'` (the field survey-broadcast.js's
 * `toHosts` already filters on). No caller passes a targetType today, so the
 * bug was silent; the first caller that asks for HOST or PARTICIPANTS would
 * get an empty list back — a host-only frame reaching nobody, or a
 * participants-only frame reaching everyone including the host.
 *
 * Runs the REAL broadcastToGame against a stubbed DynamoDB and a stubbed API
 * Gateway Management API. Sibling of tests/vote-state-broadcast.js, whose stub
 * preamble this is copied from.
 */
const suiteFinished = require('./helpers/finish-guard');
const path = require('path');
const assert = require('assert');

const REPO = path.join(__dirname, '..');

// ---- Stubs, installed before the handler loads -----------------------------
class PutCommand { constructor(i) { this.input = i; this.type = 'put'; } }
class GetCommand { constructor(i) { this.input = i; this.type = 'get'; } }
class QueryCommand { constructor(i) { this.input = i; this.type = 'query'; } }
class DeleteCommand { constructor(i) { this.input = i; this.type = 'delete'; } }
class PostToConnectionCommand { constructor(i) { this.input = i; } }

const store = new Map();                 // "PK|SK" -> item
const key = (pk, sk) => `${pk}|${sk}`;

/** Frames the handler tried to push, in order. */
let sent = [];

const fakeDoc = {
  send: async (cmd) => {
    const inp = cmd.input || {};
    switch (cmd.type) {
      case 'put':
        store.set(key(inp.Item.PK, inp.Item.SK), inp.Item);
        return {};
      case 'get':
        return { Item: store.get(key(inp.Key.PK, inp.Key.SK)) };
      case 'delete':
        store.delete(key(inp.Key.PK, inp.Key.SK));
        return {};
      case 'query': {
        const pk = inp.ExpressionAttributeValues[':pk'];
        const prefix = inp.ExpressionAttributeValues[':sk'] ?? '';
        const items = [...store.values()].filter(
          (i) => i.PK === pk && String(i.SK).startsWith(String(prefix))
        );
        return { Items: items, Count: items.length };
      }
      default:
        return {};
    }
  },
};

class FakeApiGatewayClient {
  async send(cmd) {
    const { ConnectionId, Data } = cmd.input;
    sent.push({ connectionId: ConnectionId, message: JSON.parse(Data) });
    return {};
  }
}

// Handlers live in lambda-functions/<group>/, each of which may carry its own
// node_modules. Node resolves from the requiring file upward, so poison every
// resolvable copy or the real SDK loads and the test dies on credentials.
const STUB_PATHS = [
  REPO,
  path.join(REPO, 'lambda-functions'),
  path.join(REPO, 'lambda-functions', 'websocket'),
];

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

stub('@aws-sdk/client-dynamodb', { DynamoDBClient: class {} });
stub('@aws-sdk/lib-dynamodb', {
  DynamoDBDocumentClient: { from: () => fakeDoc },
  PutCommand, GetCommand, QueryCommand, DeleteCommand,
});
stub('@aws-sdk/client-apigatewaymanagementapi', {
  ApiGatewayManagementApiClient: FakeApiGatewayClient,
  PostToConnectionCommand,
});
stub('@aws-sdk/client-kms', { KMSClient: class {}, DecryptCommand: class {}, GenerateDataKeyCommand: class {} });

process.env.TABLE_NAME = 'test-table';
process.env.WEBSOCKET_API_ENDPOINT = 'https://ws.test.invalid/dev';

const { broadcastToGame } = require(path.join(REPO, 'lambda-functions/websocket/schema-compliant-manager.js'));

// ---- Tiny harness ----------------------------------------------------------
let pass = 0, fail = 0;
function check(label, fn) {
  try { fn(); console.log(`  PASS  ${label}`); pass++; }
  catch (e) { console.log(`  FAIL  ${label}\n        ${e.message}`); fail++; }
}

const put = (item) => store.set(key(item.PK, item.SK), item);

/** Seed one HOST and one PLAYER connection row exactly as connect.js writes
 * them today — ConnectionType only, never IsHost. */
function seedConnections(gameId) {
  store.clear();
  sent = [];
  put({ PK: `GAME#${gameId}`, SK: 'CONNECTION#host-1', ConnectionId: 'host-1', ConnectionType: 'HOST', GameId: gameId, PlayerName: null });
  put({ PK: `GAME#${gameId}`, SK: 'CONNECTION#player-1', ConnectionId: 'player-1', ConnectionType: 'PLAYER', GameId: gameId, PlayerName: 'Ada' });
}

(async () => {
  console.log('\n1. targetType HOST reaches the HOST connection, not the player');
  seedConnections('4001');
  await broadcastToGame('4001', { type: 'hostOnlyFrame' }, 'HOST');
  check('exactly one frame sent', () => assert.strictEqual(sent.length, 1, `sent ${sent.length} frames`));
  check('it reached the HOST connection', () =>
    assert.strictEqual(sent[0]?.connectionId, 'host-1',
      `HOST target reached [${sent.map((s) => s.connectionId)}] — connect.js never writes IsHost, so filtering on it strands host-only frames`));

  console.log('\n2. targetType PARTICIPANTS reaches the player, not the host');
  seedConnections('4002');
  await broadcastToGame('4002', { type: 'participantsOnlyFrame' }, 'PARTICIPANTS');
  check('exactly one frame sent', () => assert.strictEqual(sent.length, 1, `sent ${sent.length} frames`));
  check('it reached the PLAYER connection', () =>
    assert.strictEqual(sent[0]?.connectionId, 'player-1',
      `PARTICIPANTS target reached [${sent.map((s) => s.connectionId)}] — it should exclude the host`));

  console.log('\n3. default target (ALL) still reaches everyone');
  seedConnections('4003');
  await broadcastToGame('4003', { type: 'everyoneFrame' });
  check('both connections reached', () =>
    assert.deepStrictEqual(sent.map((s) => s.connectionId).sort(), ['host-1', 'player-1']));

  console.log(`\n${pass} passed, ${fail} failed`);
  suiteFinished();
  process.exit(fail === 0 ? 0 : 1);
})();
