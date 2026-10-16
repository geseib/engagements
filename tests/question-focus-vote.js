/**
 * A QUESTION PUT UP AT ASK COMES DOWN WHEN VOTING OPENS (coordinator, 16 Oct
 * 2026: the same class of bug as tests/question-focus-results.js, one phase
 * earlier). A stored 'question' focus survived ASK -> VOTE, so the wall showed
 * the question while the dock and the Remote said Voting. start-vote.js (and
 * message.js's legacy REQUEST_VOTE) now clear it through
 * websocket/question-focus.js, an identical copy of game/question-focus.js
 * (separate deploy bundles), held equal here.
 *
 * Runs the REAL start-vote handler on vote-state-broadcast.js's harness, with
 * updates and conditions applied for real (tests/helpers/stage-table.js).
 *
 * rejects: a question focus surviving into VOTE; the clear taking down a
 * response; the two copies drifting.
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
class UpdateCommand { constructor(i) { this.input = i; this.type = 'update'; } }
class PostToConnectionCommand { constructor(i) { this.input = i; } }

const store = new Map();                 // "PK|SK" -> item
const key = (pk, sk) => `${pk}|${sk}`;

/** Frames the handler tried to push, in order. */
let sent = [];
/** Connection ids the stub should reject with 410 Gone. */
let goneConnections = new Set();

/**
 * An honest UpdateCommand applier (tests/helpers/stage-table.js, in fakeDoc) — the real client mutates the stored
 * item. A stub returning {} would let a handler that never writes the state
 * pass, which is the whole family of bug this file guards.
 */

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
        // The real applier (tests/helpers/stage-table.js), conditions included:
        // the conditional clear of a question focus (question-focus.js) must
        // fail on a round with none, as it does in DynamoDB.
        return require('./helpers/stage-table').applyUpdate(store, key, inp);
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
  const roundOf = (gameId) => store.get(key(`GAME#${gameId}`, 'ROUND#001'));

  console.log('\n1. a question focus at ASK, then start vote');
  seedGame('3101');
  put({ PK: 'GAME#3101', SK: 'ROUND#001', StageFocus: 'question', StageFocusIndex: null, StageFocusRev: 2 });
  const res = await invoke('3101');
  check('responds 200 and the room is on VOTE#001', () => {
    assert.strictEqual(res.statusCode, 200, res.body);
    assert.strictEqual(stateOf('3101').State, 'VOTE#001');
  });
  check('the stored focus is cleared and its rev moves on', () => {
    assert.strictEqual(roundOf('3101').StageFocus, 'none');
    assert.strictEqual(roundOf('3101').StageFocusRev, 3);
  });
  check('every connection, host included, is told, before votingStarted', () => {
    const focusFrames = sent.filter((s) => s.message.type === 'stageFocusChanged');
    assert.deepStrictEqual(focusFrames.map((s) => s.connectionId).sort(), ['host-1', 'player-1']);
    assert.strictEqual(focusFrames[0].message.focus, 'none');
    assert.strictEqual(focusFrames[0].message.questionNumber, '001');
    assert.strictEqual(focusFrames[0].message.rev, 3);
    const firstFocus = sent.findIndex((s) => s.message.type === 'stageFocusChanged');
    const firstVote = sent.findIndex((s) => s.message.type === 'votingStarted');
    assert.ok(firstFocus < firstVote, 'the clear must come before votingStarted');
  });

  console.log('\n2. a response focus is left alone');
  seedGame('3102');
  put({ PK: 'GAME#3102', SK: 'ROUND#001', StageFocus: 'answer', StageFocusIndex: 1, StageFocusPhase: 'VOTE', StageFocusRev: 5 });
  await invoke('3102');
  check('the response focus is untouched and nothing about it is sent', () => {
    assert.strictEqual(roundOf('3102').StageFocus, 'answer');
    assert.strictEqual(roundOf('3102').StageFocusIndex, 1);
    assert.strictEqual(roundOf('3102').StageFocusRev, 5);
    assert.ok(!sent.some((s) => s.message.type === 'stageFocusChanged'));
  });

  console.log('\n3. no round row at all');
  seedGame('3103');
  await invoke('3103');
  check('no focus row is created and no focus frame sent', () => {
    assert.strictEqual(roundOf('3103'), undefined);
    assert.ok(!sent.some((s) => s.message.type === 'stageFocusChanged'));
  });

  console.log('\n4. the copies and the other door');
  const fs = require('fs');
  const read = (...p) => fs.readFileSync(path.join(REPO, 'lambda-functions', ...p), 'utf8');
  check('the two copies of question-focus.js are identical', () => {
    assert.strictEqual(read('websocket', 'question-focus.js'), read('game', 'question-focus.js'));
  });
  check('message.js clears it on its legacy REQUEST_VOTE and CREATE_RESULTS paths too', () => {
    const src = read('websocket', 'message.js');
    for (const fn of ['handleRequestVote', 'handleCreateResults']) {
      const at = src.indexOf(`async function ${fn}(`);
      const next = src.indexOf('\nasync function ', at + 10);
      assert.ok(/clearQuestionFocus\(/.test(src.slice(at, next)), `${fn} does not clear a question focus`);
    }
  });

  console.log(`\n${pass} passed, ${fail} failed`);
  suiteFinished();
  process.exit(fail === 0 ? 0 : 1);
})();
