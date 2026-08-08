/**
 * Does resolving a round actually resolve it — in the database, and out loud?
 *
 * Runs the REAL get-results handler against a stubbed DynamoDB and a stubbed
 * API Gateway Management API, once per exit path, and asserts two things every
 * time:
 *
 *   1. the STATE record ends up on RESULTS#nnn
 *   2. a `gameStateChanged` frame goes out to every live connection
 *
 * Why this file exists: get-results has FOUR exits and only two of them used to
 * write the state, and none of them broadcast.
 *
 *   - wavelength returned the word cloud with the game still on ASK#nnn
 *   - call-and-answer with zero votes returned "No votes found" and left VOTE#
 *   - nothing told the room at all; the only notification was GameHostPage
 *     firing RESULT#nnn down its own socket AFTER the fetch came back
 *
 * All four were invisible from the host page, because it sets RESULTS#nnn in
 * its own React state regardless of what the server did. Anything that reads
 * the state back instead — a refresh, a second screen, the Host Remote —
 * saw the round stuck. So the assertions here are deliberately about the
 * PERSISTED state and the WIRE, not about the response body.
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
 * A minimal, honest UpdateCommand applier. The real client mutates the stored
 * item; a stub that returns {} (as most suites here do) would let a handler
 * that never writes the state pass this file, which is exactly the bug.
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

const { handler } = require(path.join(REPO, 'lambda-functions/game/get-results.js'));

// ---- Tiny harness ----------------------------------------------------------
let pass = 0, fail = 0;
function check(label, fn) {
  try { fn(); console.log(`  PASS  ${label}`); pass++; }
  catch (e) { console.log(`  FAIL  ${label}\n        ${e.message}`); fail++; }
}

const put = (item) => store.set(key(item.PK, item.SK), item);
const stateOf = (gameId) => store.get(key(`GAME#${gameId}`, 'STATE'));

/**
 * Seed one game sitting mid-round with two connections attached.
 * `phase` is what the STATE record says BEFORE results are calculated.
 */
function seedGame(gameId, gameType, phase, extras = {}) {
  store.clear();
  sent = [];
  goneConnections = new Set();

  put({ PK: `GAME#${gameId}`, SK: 'METADATA', GameType: gameType, Title: 'Test session' });
  put({ PK: `GAME#${gameId}`, SK: 'STATE', State: phase, LessonNumber: 1, CurrentQuestionId: '001' });
  put({ PK: `GAME#${gameId}`, SK: 'CONNECTION#host-1', ConnectionId: 'host-1', ConnectionType: 'HOST' });
  put({ PK: `GAME#${gameId}`, SK: 'CONNECTION#player-1', ConnectionId: 'player-1', ConnectionType: 'PLAYER', PlayerName: 'Ada' });

  for (const item of extras.items || []) put(item);
}

const answer = (gameId, player, text) => ({
  PK: `GAME#${gameId}`, SK: `QUESTION#001#ANSWER#${player}`,
  PlayerName: player, Answer: text, SubmittedAt: '2026-01-01T00:00:00.000Z',
});

const invoke = (gameId, questionNumber = 1) =>
  handler({ body: JSON.stringify({ gameId, questionNumber }) });

/** Every assertion that must hold on EVERY exit path. */
function assertResolved(gameId, label) {
  check(`${label}: responds 200`, () => assert.strictEqual(lastStatus, 200, `got ${lastStatus}: ${lastBody}`));

  check(`${label}: STATE record moved to RESULTS#001`, () => {
    const state = stateOf(gameId);
    assert.ok(state, 'no STATE record at all');
    assert.strictEqual(state.State, 'RESULTS#001',
      `state is '${state.State}' — the room is stuck on the previous screen`);
  });

  check(`${label}: LessonNumber preserved as a number`, () =>
    assert.strictEqual(stateOf(gameId).LessonNumber, 1, `got ${stateOf(gameId).LessonNumber}`));

  check(`${label}: marks the game Started`, () =>
    assert.strictEqual(stateOf(gameId).Started, true));

  check(`${label}: announced to BOTH connections, host included`, () => {
    const ids = sent.map((s) => s.connectionId).sort();
    assert.deepStrictEqual(ids, ['host-1', 'player-1'],
      `announced to [${ids}] — the projector only follows if the HOST connection is told`);
  });

  check(`${label}: frame is a gameStateChanged carrying RESULTS#001`, () => {
    const frame = sent[0].message;
    // Both GameHostPage and PlayerPage already handle `gameStateChanged` by
    // re-fetching state, so this shape needs no new client handler anywhere.
    assert.strictEqual(frame.type, 'gameStateChanged', `type was '${frame.type}'`);
    assert.strictEqual(frame.newState, 'RESULTS#001');
    assert.strictEqual(frame.gameId, gameId);
    assert.ok(String(frame.state).includes('RESULTS#001'), `state was '${frame.state}'`);
  });
}

let lastStatus, lastBody;
async function run(gameId) {
  const res = await invoke(gameId);
  lastStatus = res.statusCode;
  lastBody = res.body;
  return res;
}

(async () => {
  // ---------- 1. call-and-answer, the ordinary path ----------
  console.log('\n1. call-and-answer with votes');
  seedGame('1001', 'call-and-answer', 'VOTE#001', {
    items: [
      answer('1001', 'Ada', 'a splendid answer'),
      answer('1001', 'Grace', 'another answer'),
      {
        PK: 'GAME#1001', SK: 'QUESTION#001#VOTE#Ada',
        PlayerName: 'Ada', Votes: { 1: 1 },
      },
    ],
  });
  await run('1001');
  assertResolved('1001', 'call-and-answer');

  // ---------- 2. call-and-answer, nobody voted ----------
  console.log('\n2. call-and-answer where nobody voted');
  // Previously returned "No votes found" and left the game on VOTE#001 forever.
  // A round nobody voted on is still a resolved round.
  seedGame('1002', 'call-and-answer', 'VOTE#001', {
    items: [answer('1002', 'Ada', 'unloved answer')],
  });
  const noVotes = await run('1002');
  assertResolved('1002', 'no votes');
  check('no votes: still reports the empty tally honestly', () =>
    assert.strictEqual(JSON.parse(noVotes.body).totalVotes, 0));

  // ---------- 3. trivia ----------
  console.log('\n3. trivia');
  seedGame('1003', 'trivia', 'ASK#001', {
    items: [
      {
        PK: 'GAME#1003', SK: 'QUESTION#001#ANSWER#Ada',
        PlayerName: 'Ada', Answer: 'A', IsCorrect: true, PointsEarned: 10,
      },
    ],
  });
  await run('1003');
  assertResolved('1003', 'trivia');

  // ---------- 4. wavelength ----------
  console.log('\n4. wavelength');
  // This branch never wrote the state at all — it computed the word cloud and
  // returned 200 with the game still on ASK#001.
  seedGame('1004', 'wavelength', 'ASK#001', {
    items: [
      { ...answer('1004', 'Ada', 'summit,ridge'), ProcessedWords: ['summit', 'ridge'] },
      { ...answer('1004', 'Grace', 'summit,valley'), ProcessedWords: ['summit', 'valley'] },
    ],
  });
  const wave = await run('1004');
  assertResolved('1004', 'wavelength');
  check('wavelength: still returns its word analysis', () =>
    assert.strictEqual(JSON.parse(wave.body).wordAnalysis.commonWords[0].word, 'summit'));

  // ---------- 5. a dead connection must not sink the round ----------
  console.log('\n5. resilience');
  seedGame('1005', 'trivia', 'ASK#001', {
    items: [{
      PK: 'GAME#1005', SK: 'QUESTION#001#ANSWER#Ada',
      PlayerName: 'Ada', Answer: 'A', IsCorrect: true, PointsEarned: 10,
    }],
  });
  goneConnections = new Set(['host-1']);
  const withDead = await run('1005');

  check('410 Gone on one connection still returns 200', () =>
    assert.strictEqual(withDead.statusCode, 200, `got ${withDead.statusCode}`));
  check('410 Gone still transitions the state', () =>
    assert.strictEqual(stateOf('1005').State, 'RESULTS#001'));
  check('410 Gone still reaches the live connection', () =>
    assert.deepStrictEqual(sent.map((s) => s.connectionId), ['player-1']));
  check('410 Gone reaps the dead connection row', () =>
    assert.strictEqual(store.get(key('GAME#1005', 'CONNECTION#host-1')), undefined,
      'stale connection row survived; it would be retried on every future broadcast'));

  // ---------- 6. a room with nobody connected ----------
  console.log('\n6. nobody connected');
  seedGame('1006', 'trivia', 'ASK#001', {
    items: [{
      PK: 'GAME#1006', SK: 'QUESTION#001#ANSWER#Ada',
      PlayerName: 'Ada', Answer: 'A', IsCorrect: true, PointsEarned: 10,
    }],
  });
  store.delete(key('GAME#1006', 'CONNECTION#host-1'));
  store.delete(key('GAME#1006', 'CONNECTION#player-1'));
  const noConns = await run('1006');

  check('no connections: still 200', () =>
    assert.strictEqual(noConns.statusCode, 200, `got ${noConns.statusCode}`));
  check('no connections: state still transitions', () =>
    // The whole point of persisting the transition: whoever reconnects reads
    // the right phase back, with no live socket needed at the moment it happened.
    assert.strictEqual(stateOf('1006').State, 'RESULTS#001'));
  check('no connections: nothing sent', () =>
    assert.strictEqual(sent.length, 0));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
})();
