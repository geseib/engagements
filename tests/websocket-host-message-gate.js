/**
 * ONLY THE HOST'S OWN SOCKET MAY DRIVE ITS ROOM.
 *
 * ── THE HOLE ───────────────────────────────────────────────────────────────
 *
 * `lambda-functions/websocket/message.js` routed on `body.messageType` and
 * `body.gameId` exactly as the frame stated them. Every host frame — `ASK#…`,
 * `VOTE#…`, `RESULT#…`, `END`, `REQUEST_VOTE`, `CREATE_RESULTS` — went straight
 * to handleHostMessage without asking who sent it, and the `$connect` route has
 * no authorizer. So any socket at all, including one connected to no game or to
 * a different game, could send
 *
 *     { "messageType": "REQUEST_VOTE", "gameId": "4821" }
 *
 * and move that room from ASK to VOTE; send CREATE_RESULTS and move it from VOTE
 * to RESULTS, writing a results row; or send `ASK#…` / `RESULT#…` / `END` and
 * have a forged `hostMessage` fanned out to every phone in the room.
 *
 * ── THE FIX ────────────────────────────────────────────────────────────────
 *
 * Since dc4aefb1 a connection row is stored HOST only when the handshake spent
 * a single-use ticket minted for that room (tests/websocket-host-ticket.js), so
 * `ConnectionType` is finally a fact. Before any host frame is acted on, the
 * handler reads the SENDER's own row — `GAME#<body.gameId>` /
 * `CONNECTION#<requestContext.connectionId>` — and goes on only if it says
 * HOST. Keyed on the frame's gameId, so a host socket for one room finds no row
 * under another. Anything else is refused with 403 and logged without the
 * frame's body. Player frames are not touched.
 *
 * rejects: a PLAYER socket moving its room or broadcasting as the host; a socket
 *          with no row for the game doing the same; a frame that merely claims
 *          to be the host; one room's host socket driving another room; a table
 *          error on the lookup falling through to the broadcast; a refused
 *          frame's body reaching the logs.
 */
const suiteFinished = require('./helpers/finish-guard');
const path = require('path');
const assert = require('assert');

const REPO = path.join(__dirname, '..');

/* ---- A fake table that understands only what the handler sends ------------ */

class GetCommand { constructor(i) { this.input = i; this.type = 'get'; } }
class PutCommand { constructor(i) { this.input = i; this.type = 'put'; } }
class QueryCommand { constructor(i) { this.input = i; this.type = 'query'; } }
class DeleteCommand { constructor(i) { this.input = i; this.type = 'delete'; } }
class UpdateCommand { constructor(i) { this.input = i; this.type = 'update'; } }
class PostToConnectionCommand { constructor(i) { this.input = i; } }

const store = new Map();
const key = (pk, sk) => `${pk}|${sk}`;
const calls = [];
/** Frames the handler pushed down a socket, in order. */
let sent = [];
/**
 * `{ sk, error }` makes the next Get of that SK fail the way DynamoDB can. Aimed
 * at one row, so a failure on some other read cannot pass for the one tested.
 */
let failGet = null;

const conditionFailed = () => {
  const e = new Error('The conditional request failed');
  e.name = 'ConditionalCheckFailedException';
  return e;
};

function conditionHolds(expr, item, names) {
  if (!expr) return true;
  const m = /^attribute_not_exists\(\s*(#?\w+)\s*\)$/.exec(expr);
  if (m) {
    const attr = m[1].startsWith('#') ? names[m[1]] : m[1];
    return !item || item[attr] === undefined;
  }
  throw new Error(`fake table: unsupported ConditionExpression ${expr}`);
}

/** `SET a = :x, #b = :y` — the only update shape the paths under test send. */
function applyUpdate(input) {
  const k = key(input.Key.PK, input.Key.SK);
  const existing = store.get(k);
  const names = input.ExpressionAttributeNames || {};
  const values = input.ExpressionAttributeValues || {};
  if (!conditionHolds(input.ConditionExpression, existing, names)) throw conditionFailed();
  const expr = String(input.UpdateExpression || '');
  if (!/^\s*SET\s+/i.test(expr)) throw new Error(`fake table: unsupported UpdateExpression ${expr}`);
  const item = { ...(existing || input.Key) };
  for (const clause of expr.replace(/^\s*SET\s+/i, '').split(',')) {
    const [lhs, rhs] = clause.split('=').map((s) => s.trim());
    const attr = lhs.startsWith('#') ? names[lhs] : lhs;
    if (!attr || !(rhs in values)) throw new Error(`fake table: cannot apply "${clause}"`);
    item[attr] = values[rhs];
  }
  store.set(k, item);
  return {};
}

function applyFilter(items, input) {
  const expr = input.FilterExpression;
  const values = input.ExpressionAttributeValues || {};
  if (!expr) return items;
  if (expr === 'ConnectionType = :type') return items.filter((i) => i.ConnectionType === values[':type']);
  throw new Error(`fake table: unsupported FilterExpression ${expr}`);
}

const fakeDoc = {
  send: async (cmd) => {
    const inp = cmd.input || {};
    calls.push({ type: cmd.type, input: inp });
    switch (cmd.type) {
      case 'get':
        if (failGet && inp.Key.SK === failGet.sk) { const e = failGet.error; failGet = null; throw e; }
        return { Item: store.get(key(inp.Key.PK, inp.Key.SK)) };
      case 'put': {
        const k = key(inp.Item.PK, inp.Item.SK);
        if (!conditionHolds(inp.ConditionExpression, store.get(k), inp.ExpressionAttributeNames || {})) {
          throw conditionFailed();
        }
        store.set(k, inp.Item);
        return {};
      }
      case 'update':
        return applyUpdate(inp);
      case 'delete':
        store.delete(key(inp.Key.PK, inp.Key.SK));
        return {};
      case 'query': {
        if (inp.KeyConditionExpression !== 'PK = :pk AND begins_with(SK, :sk)') {
          throw new Error(`fake table: unsupported KeyConditionExpression ${inp.KeyConditionExpression}`);
        }
        const pk = inp.ExpressionAttributeValues[':pk'];
        const prefix = inp.ExpressionAttributeValues[':sk'];
        const items = [...store.values()].filter(
          (i) => i.PK === pk && String(i.SK).startsWith(String(prefix))
        );
        return { Items: applyFilter(items, inp) };
      }
      default:
        throw new Error(`fake table: unexpected command ${cmd.type}`);
    }
  },
};

class FakeApiGatewayClient {
  async send(cmd) {
    sent.push({ connectionId: cmd.input.ConnectionId, message: JSON.parse(cmd.input.Data) });
    return {};
  }
}

// Handlers live in lambda-functions/<group>/, each of which may carry its own
// node_modules. Poison every resolvable copy, or the real SDK loads.
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
  GetCommand, PutCommand, QueryCommand, DeleteCommand, UpdateCommand,
});
stub('@aws-sdk/client-apigatewaymanagementapi', {
  ApiGatewayManagementApiClient: FakeApiGatewayClient,
  PostToConnectionCommand,
});

process.env.TABLE_NAME = 'test-table';
process.env.WEBSOCKET_API_ENDPOINT = 'https://ws.test.invalid/dev';

const wsMessage = require(path.join(REPO, 'lambda-functions/websocket/message.js')).handler;

/* ---- Harness -------------------------------------------------------------- */

let pass = 0, fail = 0;
async function check(label, fn) {
  try { await fn(); console.log(`  ok   - ${label}`); pass++; }
  catch (e) { console.log(`  FAIL - ${label}\n         ${e.message}`); fail++; }
}

const GAME_A = '4821';
const GAME_B = '7310';

function put(item) { store.set(key(item.PK, item.SK), item); }

function connection(gameId, connectionId, type, playerName = null) {
  put({
    PK: `GAME#${gameId}`, SK: `CONNECTION#${connectionId}`,
    ConnectionId: connectionId, ConnectionType: type,
    GameId: gameId, PlayerName: playerName, ConnectedAt: '2026-09-23T10:00:00.000Z',
  });
}

/**
 * Two live rooms, each with its own host screen and one phone. Room A's host
 * row sits beside room A's player row, so every refusal below is refused with
 * a genuine HOST row in the same partition — the lookup has to be the
 * SENDER's row, not "is there a host here".
 */
function seedRooms({ state = 'ASK#001' } = {}) {
  store.clear(); calls.length = 0; sent = []; failGet = null;
  for (const gameId of [GAME_A, GAME_B]) {
    put({ PK: `GAME#${gameId}`, SK: 'METADATA', GameType: 'call-and-answer', Title: `Room ${gameId}` });
    put({ PK: `GAME#${gameId}`, SK: 'STATE', State: state, CurrentQuestionId: '001', LessonNumber: 1 });
  }
  connection(GAME_A, 'host-a', 'HOST');
  connection(GAME_A, 'phone-a', 'PLAYER', 'Ada');
  connection(GAME_B, 'host-b', 'HOST');
  connection(GAME_B, 'phone-b', 'PLAYER', 'Grace');
}

const stateOf = (gameId) => store.get(key(`GAME#${gameId}`, 'STATE')).State;
const updates = () => calls.filter((c) => c.type === 'update');
const framesTo = (connectionId) => sent.filter((s) => s.connectionId === connectionId).map((s) => s.message);

const frame = (connectionId, body) => wsMessage({
  requestContext: { connectionId, domainName: 'ws.test.invalid', stage: 'dev' },
  body: JSON.stringify(body),
});

/** A frame exactly as WebSocketClient.sendCleanMessage builds it. */
const clean = (messageType, gameId, extra = {}) => ({
  messageType, gameId, playerName: null, timestamp: '2026-09-23T10:05:00.000Z', ...extra,
});

/** Everything console.log/warn/error print while `fn` runs. */
async function captureLogs(fn) {
  const lines = [];
  const orig = { log: console.log, error: console.error, warn: console.warn };
  const grab = (...args) => lines.push(args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' '));
  console.log = grab; console.error = grab; console.warn = grab;
  try { await fn(); } finally { Object.assign(console, orig); }
  return lines.join('\n');
}

/** Run the handler with its logging swallowed, so the report stays readable. */
const quietly = async (fn) => { let out; await captureLogs(async () => { out = await fn(); }); return out; };

/* The spoofable broadcasts GameHostPage and the old host screen send. */
const BROADCASTS = ['ASK#002', 'VOTE#001', 'RESULT#001', 'END'];

(async () => {
  /* ======================================================================== */
  console.log('\n1. a PLAYER socket cannot drive its own room');

  await check('REQUEST_VOTE from a phone leaves the room on ASK and tells nobody', async () => {
    seedRooms();
    const res = await quietly(() => frame('phone-a', clean('REQUEST_VOTE', GAME_A)));
    assert.strictEqual(res.statusCode, 403, `answered ${res.statusCode}: ${res.body}`);
    assert.strictEqual(stateOf(GAME_A), 'ASK#001', 'a phone moved the room to voting');
    assert.deepStrictEqual(updates(), [], 'a phone\'s frame wrote to the table');
    assert.deepStrictEqual(sent, [], `a phone's frame was broadcast: ${JSON.stringify(sent)}`);
  });

  await check('CREATE_RESULTS from a phone leaves the room on VOTE and writes no results', async () => {
    seedRooms({ state: 'VOTE#001' });
    put({ PK: `GAME#${GAME_A}`, SK: 'QUESTION#001#VOTE#Ada', VotedFor: 'Grace' });
    const res = await quietly(() => frame('phone-a', clean('CREATE_RESULTS', GAME_A)));
    assert.strictEqual(res.statusCode, 403, `answered ${res.statusCode}: ${res.body}`);
    assert.strictEqual(stateOf(GAME_A), 'VOTE#001', 'a phone closed the vote');
    assert.ok(!store.get(key(`GAME#${GAME_A}`, 'QUESTION#001#RESULTS')), 'a phone wrote the results row');
    assert.deepStrictEqual(sent, []);
  });

  for (const messageType of BROADCASTS) {
    await check(`a phone's ${messageType} is not fanned out to the room`, async () => {
      seedRooms();
      const res = await quietly(() => frame('phone-a', clean(messageType, GAME_A, { gameState: messageType })));
      assert.strictEqual(res.statusCode, 403, `answered ${res.statusCode}: ${res.body}`);
      assert.deepStrictEqual(sent, [], `forged hostMessage reached ${sent.map((s) => s.connectionId)}`);
    });
  }

  await check('a frame that SAYS it is the host is not believed', async () => {
    seedRooms();
    const res = await quietly(() => frame('phone-a', clean('REQUEST_VOTE', GAME_A, {
      isHost: true, role: 'host', ConnectionType: 'HOST', connectionType: 'HOST',
    })));
    assert.strictEqual(res.statusCode, 403);
    assert.strictEqual(stateOf(GAME_A), 'ASK#001');
    assert.deepStrictEqual(sent, []);
  });

  /* ======================================================================== */
  console.log('\n2. a socket with no row for the game is refused');

  await check('a socket that joined no game cannot open the vote', async () => {
    seedRooms();
    connection('LOBBY', 'lobby-1', 'PLAYER');
    const res = await quietly(() => frame('lobby-1', clean('REQUEST_VOTE', GAME_A)));
    assert.strictEqual(res.statusCode, 403, `answered ${res.statusCode}: ${res.body}`);
    assert.strictEqual(stateOf(GAME_A), 'ASK#001');
    assert.deepStrictEqual(sent, []);
  });

  await check('a socket with no row anywhere cannot broadcast END', async () => {
    seedRooms();
    const res = await quietly(() => frame('stranger-1', clean('END', GAME_A)));
    assert.strictEqual(res.statusCode, 403, `answered ${res.statusCode}: ${res.body}`);
    assert.deepStrictEqual(sent, []);
  });

  /* ======================================================================== */
  console.log('\n3. the host\'s own socket still drives its room');

  await check('REQUEST_VOTE from the host opens the vote and reaches the phones', async () => {
    seedRooms();
    const res = await quietly(() => frame('host-a', clean('REQUEST_VOTE', GAME_A)));
    assert.strictEqual(res.statusCode, 200, `answered ${res.statusCode}: ${res.body}`);
    assert.strictEqual(stateOf(GAME_A), 'VOTE#001');
    const got = framesTo('phone-a');
    assert.strictEqual(got.length, 1, `phone-a got ${got.length} frames`);
    assert.strictEqual(got[0].type, 'hostMessage');
    assert.strictEqual(got[0].messageType, 'REQUEST_VOTE');
  });

  await check('CREATE_RESULTS from the host tallies the vote and moves to RESULTS', async () => {
    seedRooms({ state: 'VOTE#001' });
    put({ PK: `GAME#${GAME_A}`, SK: 'QUESTION#001#VOTE#Ada', VotedFor: 'Grace' });
    const res = await quietly(() => frame('host-a', clean('CREATE_RESULTS', GAME_A)));
    assert.strictEqual(res.statusCode, 200, `answered ${res.statusCode}: ${res.body}`);
    assert.strictEqual(stateOf(GAME_A), 'RESULTS#001');
    const results = store.get(key(`GAME#${GAME_A}`, 'QUESTION#001#RESULTS'));
    assert.ok(results, 'no results row');
    assert.deepStrictEqual(results.VoteTallies, { Grace: 1 });
    assert.strictEqual(framesTo('phone-a').length, 1);
  });

  // The two frames GameHostPage.jsx sends today (select-question and
  // handleShowResults), shaped as sendCleanMessage shapes them.
  await check('the host page\'s ASK# frame reaches the phones with its question', async () => {
    seedRooms();
    const res = await quietly(() => frame('host-a', clean('ASK#002', GAME_A, {
      lessonNumber: 2, gameState: 'ASK#002', currentQuestion: { title: 'Q2' },
    })));
    assert.strictEqual(res.statusCode, 200, `answered ${res.statusCode}: ${res.body}`);
    const [got] = framesTo('phone-a');
    assert.ok(got, 'phone-a got nothing');
    assert.strictEqual(got.messageType, 'ASK#002');
    assert.strictEqual(got.gameState, 'ASK#002');
    assert.deepStrictEqual(got.currentQuestion, { title: 'Q2' });
  });

  await check('the host page\'s RESULT# frame reaches the phones', async () => {
    seedRooms({ state: 'RESULTS#001' });
    const res = await quietly(() => frame('host-a', clean('RESULT#001', GAME_A, {
      questionNumber: '001', gameState: 'RESULTS#001', gameType: 'call-and-answer',
    })));
    assert.strictEqual(res.statusCode, 200, `answered ${res.statusCode}: ${res.body}`);
    const [got] = framesTo('phone-a');
    assert.ok(got, 'phone-a got nothing');
    assert.strictEqual(got.messageType, 'RESULT#001');
  });

  // Strongly consistent because a host that has just reconnected sends its next
  // frame moments after its row was written; an eventually consistent read can
  // miss that row and refuse the real host.
  await check('the check reads the SENDER\'s own row, strongly consistent', async () => {
    seedRooms();
    await quietly(() => frame('host-a', clean('END', GAME_A)));
    const lookup = calls.find((c) => c.type === 'get'
      && c.input.Key.SK === 'CONNECTION#host-a');
    assert.ok(lookup, `no read of the sender's row; reads were ${JSON.stringify(calls.filter((c) => c.type === 'get').map((c) => c.input.Key))}`);
    assert.strictEqual(lookup.input.Key.PK, `GAME#${GAME_A}`);
    assert.strictEqual(lookup.input.ConsistentRead, true);
  });

  /* ======================================================================== */
  console.log('\n4. one room\'s host cannot drive another room');

  await check('host A\'s REQUEST_VOTE aimed at room B moves neither room', async () => {
    seedRooms();
    const res = await quietly(() => frame('host-a', clean('REQUEST_VOTE', GAME_B)));
    assert.strictEqual(res.statusCode, 403, `answered ${res.statusCode}: ${res.body}`);
    assert.strictEqual(stateOf(GAME_B), 'ASK#001', 'room A\'s host moved room B');
    assert.strictEqual(stateOf(GAME_A), 'ASK#001');
    assert.deepStrictEqual(sent, []);
  });

  await check('host A\'s CREATE_RESULTS aimed at room B writes nothing there', async () => {
    seedRooms({ state: 'VOTE#001' });
    const res = await quietly(() => frame('host-a', clean('CREATE_RESULTS', GAME_B)));
    assert.strictEqual(res.statusCode, 403);
    assert.strictEqual(stateOf(GAME_B), 'VOTE#001');
    assert.ok(!store.get(key(`GAME#${GAME_B}`, 'QUESTION#001#RESULTS')));
    assert.deepStrictEqual(sent, []);
  });

  await check('host A\'s RESULT# aimed at room B reaches no phone in B', async () => {
    seedRooms();
    const res = await quietly(() => frame('host-a', clean('RESULT#001', GAME_B)));
    assert.strictEqual(res.statusCode, 403);
    assert.deepStrictEqual(framesTo('phone-b'), []);
    assert.deepStrictEqual(sent, []);
  });

  /* ======================================================================== */
  console.log('\n5. player frames are unchanged');

  await check('a phone\'s ANSWER# is still stored and still reaches the host', async () => {
    seedRooms();
    const res = await quietly(() => frame('phone-a', {
      messageType: 'ANSWER#001', gameId: GAME_A, playerName: 'Ada', answer: 'Blue', answerType: 'text',
    }));
    assert.strictEqual(res.statusCode, 200, `answered ${res.statusCode}: ${res.body}`);
    const row = store.get(key(`GAME#${GAME_A}`, 'QUESTION#001#ANSWER#Ada'));
    assert.ok(row, 'the answer was not stored');
    assert.strictEqual(row.Answer, 'Blue');
    const toHost = framesTo('host-a');
    assert.strictEqual(toHost.length, 1, `host got ${toHost.length} frames`);
    assert.strictEqual(toHost[0].type, 'playerAnswered');
  });

  await check('the heartbeat is still answered, with no row lookup', async () => {
    seedRooms();
    const res = await quietly(() => frame('stranger-1', { action: 'ping' }));
    assert.strictEqual(res.statusCode, 200);
    assert.deepStrictEqual(framesTo('stranger-1'), [{ type: 'pong' }]);
    assert.deepStrictEqual(calls, []);
  });

  /* ======================================================================== */
  console.log('\n6. refusals and failures');

  await check('a refused frame is logged, without its body', async () => {
    seedRooms();
    const MARKER = 'body-marker-9c41e7';
    const logs = await captureLogs(() => frame('phone-a', clean('REQUEST_VOTE', GAME_A, {
      note: MARKER, currentQuestion: { title: MARKER },
    })));
    assert.ok(!logs.includes(MARKER), `the refused frame's body reached the logs:\n${logs}`);
    assert.ok(/refus/i.test(logs), `nothing says the frame was refused:\n${logs}`);
    assert.ok(logs.includes('phone-a'), 'the refusal does not name the connection');
  });

  await check('a table error on the lookup refuses rather than broadcasts', async () => {
    seedRooms();
    failGet = {
      sk: 'CONNECTION#host-a',
      error: Object.assign(new Error('Throughput exceeds the current capacity'), {
        name: 'ProvisionedThroughputExceededException',
      }),
    };
    const res = await quietly(() => frame('host-a', clean('REQUEST_VOTE', GAME_A)));
    assert.notStrictEqual(res.statusCode, 200, 'a failed lookup was treated as a pass');
    assert.strictEqual(stateOf(GAME_A), 'ASK#001');
    assert.deepStrictEqual(sent, []);
  });

  console.log(`\n${pass} passed, ${fail} failed`);
  suiteFinished();
  process.exit(fail === 0 ? 0 : 1);
})();
