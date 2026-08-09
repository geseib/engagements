/**
 * When voting opens, does the room hear about it — and does the frame say enough
 * for a listener to act on it?
 *
 * Runs the REAL start-vote handler against a stubbed DynamoDB and a stubbed API
 * Gateway Management API. Sibling of results-state-broadcast.js, and it exists
 * for the same class of bug one phase earlier.
 *
 * THE BUG THIS PINS. start-vote broadcast `votingStarted` with `state` and
 * `questionNumber` but no `newState`. GameHostPage's handler read exactly one
 * field:
 *
 *     webSocketClient.onMessage('votingStarted', (data) => {
 *       if (data.newState) { setGameState(data.newState); }
 *     });
 *
 * `newState` existed only in the HTTP *response body*, which only the caller
 * sees. So the host page did literally nothing on this frame. Driving the
 * session from the phone remote moved every player into VOTE and left the
 * projector sitting on ASK — the host screen "stuck" while the room moved on.
 * It looked fine when the host clicked its own button only because
 * handleFinishQuestion sets the state locally from the response it got back.
 *
 * So the assertions here are about the WIRE, not the response body: the frame
 * has to carry the new phase, and it has to reach the HOST connection, because
 * the host connection is the projector.
 *
 * get-results.js already emits `newState` on its `gameStateChanged` frame — the
 * convention existed, start-vote just didn't follow it.
 */
const path = require('path');
const assert = require('assert');

const REPO = path.join(__dirname, '..');

// ---- Stubs, installed before the handler loads -----------------------------
class PutCommand { constructor(i) { this.input = i; this.type = 'put'; } }
class GetCommand { constructor(i) { this.input = i; this.type = 'get'; } }
class QueryCommand { constructor(i) { this.input = i; this.type = 'query'; } }
class DeleteCommand { constructor(i) { this.input = i; this.type = 'delete'; } }
class UpdateCommand { constructor(i) { this.input = i; this.type = 'update'; } }
class PostToConnectionCommand { constructor(i) { this.input = i; } }

const store = new Map();                 // "PK|SK" -> item
const key = (pk, sk) => `${pk}|${sk}`;

/** Frames the handler tried to push, in order. */
let sent = [];
/** Connection ids the stub should reject with 410 Gone. */
let goneConnections = new Set();

/**
 * A minimal, honest UpdateCommand applier — the real client mutates the stored
 * item. A stub returning {} would let a handler that never writes the state
 * pass, which is the whole family of bug this file guards.
 */
function applyUpdate(input) {
  const k = key(input.Key.PK, input.Key.SK);
  const item = store.get(k) || { ...input.Key };
  const names = input.ExpressionAttributeNames || {};
  const values = input.ExpressionAttributeValues || {};

  const setClause = String(input.UpdateExpression || '').replace(/^\s*SET\s+/i, '');
  for (const pair of setClause.split(',')) {
    const [lhs, rhs] = pair.split('=').map((s) => s.trim());
    if (!lhs || !rhs) continue;
    const attr = names[lhs] || lhs;
    item[attr] = values[rhs];
  }
  store.set(k, item);
  return {};
}

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
      case 'update':
        return applyUpdate(inp);
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
    if (goneConnections.has(ConnectionId)) {
      const err = new Error('Gone');
      err.name = 'GoneException';
      err.statusCode = 410;
      throw err;
    }
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
  path.join(REPO, 'lambda-functions', 'game'),
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
  PutCommand, GetCommand, QueryCommand, DeleteCommand, UpdateCommand,
});
stub('@aws-sdk/client-apigatewaymanagementapi', {
  ApiGatewayManagementApiClient: FakeApiGatewayClient,
  PostToConnectionCommand,
});

process.env.TABLE_NAME = 'test-table';
process.env.WEBSOCKET_API_ENDPOINT = 'https://ws.test.invalid/dev';

const { handler } = require(path.join(REPO, 'lambda-functions/websocket/start-vote.js'));

// ---- Tiny harness ----------------------------------------------------------
let pass = 0, fail = 0;
function check(label, fn) {
  try { fn(); console.log(`  PASS  ${label}`); pass++; }
  catch (e) { console.log(`  FAIL  ${label}\n        ${e.message}`); fail++; }
}

const put = (item) => store.set(key(item.PK, item.SK), item);
const stateOf = (gameId) => store.get(key(`GAME#${gameId}`, 'STATE'));

/** Seed one call-and-answer game sitting on ASK with two answers in. */
function seedGame(gameId, { answers = ['Ada', 'Grace'], connections = true } = {}) {
  store.clear();
  sent = [];
  goneConnections = new Set();

  put({ PK: `GAME#${gameId}`, SK: 'METADATA', GameType: 'call-and-answer', Title: 'Test session' });
  put({ PK: `GAME#${gameId}`, SK: 'STATE', State: 'ASK#001', LessonNumber: 1, CurrentQuestionId: '001' });

  if (connections) {
    put({ PK: `GAME#${gameId}`, SK: 'CONNECTION#host-1', ConnectionId: 'host-1', ConnectionType: 'HOST' });
    put({ PK: `GAME#${gameId}`, SK: 'CONNECTION#player-1', ConnectionId: 'player-1', ConnectionType: 'PLAYER', PlayerName: 'Ada' });
  }

  for (const player of answers) {
    put({
      PK: `GAME#${gameId}`, SK: `QUESTION#001#ANSWER#${player}`,
      PlayerName: player, Answer: `${player}'s answer`, SubmittedAt: '2026-01-01T00:00:00.000Z',
    });
  }
}

const invoke = (gameId, questionNumber = 1) =>
  handler({ pathParameters: { gameId }, body: JSON.stringify({ questionNumber }) });

(async () => {
  // ---------- 1. the ordinary path ----------
  console.log('\n1. opening the vote on a call-and-answer round');
  seedGame('2001');
  const res = await invoke('2001');

  check('responds 200', () =>
    assert.strictEqual(res.statusCode, 200, `got ${res.statusCode}: ${res.body}`));

  check('STATE record moved to VOTE#001', () => {
    const state = stateOf('2001');
    assert.ok(state, 'no STATE record at all');
    assert.strictEqual(state.State, 'VOTE#001',
      `state is '${state.State}' — the room never entered the vote`);
  });

  check('announced to BOTH connections, host included', () => {
    const ids = sent.map((s) => s.connectionId).sort();
    assert.deepStrictEqual(ids, ['host-1', 'player-1'],
      `announced to [${ids}] — the projector only follows if the HOST connection is told`);
  });

  check('frame is a votingStarted', () =>
    assert.strictEqual(sent[0].message.type, 'votingStarted', `type was '${sent[0].message.type}'`));

  // THE REGRESSION. Without this field the host page's handler no-ops and the
  // projector stays on ASK while every phone moves to VOTE.
  check('frame carries newState, the field the host actually reads', () => {
    const frame = sent[0].message;
    assert.strictEqual(frame.newState, 'VOTE#001',
      `newState was ${JSON.stringify(frame.newState)} — GameHostPage reads this field and only this field`);
  });

  check('frame carries the gameId and the legacy state string', () => {
    const frame = sent[0].message;
    assert.strictEqual(frame.gameId, '2001');
    assert.ok(String(frame.state).includes('VOTE#001'), `state was '${frame.state}'`);
  });

  check('frame carries a zero-padded questionNumber', () =>
    assert.strictEqual(sent[0].message.questionNumber, '001',
      `questionNumber was '${sent[0].message.questionNumber}'`));

  check('response still returns the answers to vote on', () => {
    const body = JSON.parse(res.body);
    assert.strictEqual(body.answers.length, 2, `got ${body.answers.length} answers`);
    assert.strictEqual(body.newState, 'VOTE#001');
  });

  // ---------- 2. every connection hears the same frame ----------
  console.log('\n2. host and players hear the same thing');
  // The host page and the player page must not be able to disagree about the
  // phase because they were told different things.
  check('both frames are byte-identical', () =>
    assert.deepStrictEqual(sent[0].message, sent[1].message));

  // ---------- 3. a round nobody answered ----------
  console.log('\n3. nobody answered');
  // Opening a vote on an empty round is a host's prerogative — the phase must
  // still move, and the room must still be told, or the host is stranded with
  // no way back.
  seedGame('2002', { answers: [] });
  const empty = await invoke('2002');

  check('empty round: still 200', () =>
    assert.strictEqual(empty.statusCode, 200, `got ${empty.statusCode}`));
  check('empty round: state still transitions', () =>
    assert.strictEqual(stateOf('2002').State, 'VOTE#001'));
  check('empty round: still announced with newState', () =>
    assert.strictEqual(sent[0]?.message?.newState, 'VOTE#001'));

  // ---------- 4. a dead connection must not sink the phase ----------
  console.log('\n4. resilience');
  seedGame('2003');
  goneConnections = new Set(['host-1']);
  const withDead = await invoke('2003');

  check('410 Gone on one connection still returns 200', () =>
    assert.strictEqual(withDead.statusCode, 200, `got ${withDead.statusCode}`));
  check('410 Gone still transitions the state', () =>
    assert.strictEqual(stateOf('2003').State, 'VOTE#001'));
  check('410 Gone still reaches the live connection', () =>
    assert.deepStrictEqual(sent.map((s) => s.connectionId), ['player-1']));

  // ---------- 5. a room with nobody connected ----------
  console.log('\n5. nobody connected');
  seedGame('2004', { connections: false });
  const noConns = await invoke('2004');

  check('no connections: still 200', () =>
    assert.strictEqual(noConns.statusCode, 200, `got ${noConns.statusCode}`));
  check('no connections: state still transitions', () =>
    // Persisting the transition is what lets a reconnecting client read the
    // right phase back with no live socket at the moment it happened.
    assert.strictEqual(stateOf('2004').State, 'VOTE#001'));
  check('no connections: nothing sent', () =>
    assert.strictEqual(sent.length, 0));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
})();
