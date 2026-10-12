/**
 * THE VOTE NAVIGATOR'S SERVER HALF — `POST /games/{gameId}/stage-focus`
 * during VOTE (two-surface PLAN 1.10, D5; the owner's ruling of 2026-10-12).
 *
 * During voting the host may put one response on the wall, numbered by the
 * voting order every ballot shows, names always hidden. That makes the focus
 * index mean two different orders in two phases (voting order in VOTE, tally
 * order at RESULTS), so the SERVER stamps which phase a focus was set in —
 * from STATE, never from the client — and get-game-state hands a focus back
 * only in the phase it was stamped for. A VOTE focus on "Response 3" can then
 * never become tally rank 4, a named response, after Show results.
 *
 * Also here: the long-response part (`part` of `parts`, Phase 2 measures
 * them), the focus `rev`, a focus outside a round refused, and the closed
 * FOCUS_PHASES held equal to its frontend mirror.
 *
 * Harness: stage-focus-flow.js's, with tests/helpers/stage-table.js applying
 * updates and conditions for real.
 */
const suiteFinished = require('./helpers/finish-guard');
const path = require('path');
const assert = require('assert');

const REPO = path.join(__dirname, '..');

// ---- Stubs, installed before either handler loads --------------------------
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

// A real UpdateCommand applier (tests/helpers/stage-table.js): SET, ADD,
// if_not_exists and conditions. A stub returning `{}` would let a handler that
// broadcasts the focus but never writes it pass every assertion here.
const stageTable = require('./helpers/stage-table');
const applyUpdate = (input) => stageTable.applyUpdate(store, key, input);

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


const { handler: stageFocus } = require(path.join(REPO, 'lambda-functions/game/stage-focus.js'));
const { handler: getState } = require(path.join(REPO, 'lambda-functions/game/get-game-state.js'));

// ---- Tiny harness ----------------------------------------------------------
let pass = 0, fail = 0;
function check(label, fn) {
  try { fn(); console.log(`  PASS  ${label}`); pass++; }
  catch (e) { console.log(`  FAIL  ${label}\n        ${e.message}`); fail++; }
}

const put = (item) => store.set(key(item.PK, item.SK), item);
const roundOf = (gameId, padded) => store.get(key(`GAME#${gameId}`, `ROUND#${padded}`));

function seedGame(gameId, { lessonNumber = 1 } = {}) {
  store.clear();
  sent = [];
  goneConnections = new Set();

  put({ PK: `GAME#${gameId}`, SK: 'METADATA', GameType: 'call-and-answer', Title: 'Test session' });
  put({
    PK: `GAME#${gameId}`, SK: 'STATE',
    State: `RESULTS#${String(lessonNumber).padStart(3, '0')}`,
    LessonNumber: lessonNumber, CurrentQuestionId: 'QUESTION#1#001',
  });
  put({ PK: `GAME#${gameId}`, SK: 'CONNECTION#host-1', ConnectionId: 'host-1', ConnectionType: 'HOST' });
  put({ PK: `GAME#${gameId}`, SK: 'CONNECTION#player-1', ConnectionId: 'player-1', ConnectionType: 'PLAYER', PlayerName: 'Ada' });
}

const post = (gameId, body) => stageFocus({
  requestContext: { http: { method: 'POST' } },
  pathParameters: { gameId },
  body: JSON.stringify(body),
});

const readState = async (gameId) => JSON.parse(
  (await getState({ pathParameters: { gameId }, queryStringParameters: { role: 'host' } })).body
);


const setState = (gameId, State, LessonNumber = 1) => {
  const row = store.get(key(`GAME#${gameId}`, 'STATE'));
  store.set(key(`GAME#${gameId}`, 'STATE'), { ...row, State, LessonNumber });
};

(async () => {
  console.log('\n1. during VOTE an answer focus is allowed, and the server stamps VOTE');
  seedGame('4001');
  setState('4001', 'VOTE#001');
  const vote = await post('4001', { focus: 'answer', index: 2, questionNumber: 1 });
  check('200', () => assert.strictEqual(vote.statusCode, 200, vote.body));
  check('StageFocusPhase is VOTE', () => assert.strictEqual(roundOf('4001', '001').StageFocusPhase, 'VOTE'));
  check('the frame carries the phase', () => assert.strictEqual(sent[0].message.phase, 'VOTE'));

  console.log('\n2. a phase the client claims is ignored');
  seedGame('4002');
  setState('4002', 'VOTE#001');
  await post('4002', { focus: 'answer', index: 0, questionNumber: 1, phase: 'RESULTS' });
  check('stamped from STATE, not the body', () => assert.strictEqual(roundOf('4002', '001').StageFocusPhase, 'VOTE'));
  seedGame('4003');
  await post('4003', { focus: 'answer', index: 0, questionNumber: 1, phase: 'VOTE' });
  check('at RESULTS it is RESULTS, whatever the body says', () =>
    assert.strictEqual(roundOf('4003', '001').StageFocusPhase, 'RESULTS'));

  console.log('\n3. an answer focus outside its round\'s VOTE or RESULTS is refused');
  for (const [state, qn] of [['ASK#001', 1], ['CREATED', 1], ['STARTED', 1], ['ENDED', 1], ['RESULTS#002', 1], ['VOTE#002', 1], ['SURVEY#OPEN', 1]]) {
    seedGame('4004');
    setState('4004', state, 2);
    const res = await post('4004', { focus: 'answer', index: 0, questionNumber: qn });
    check(`${state}, round ${qn}: 409`, () => assert.strictEqual(res.statusCode, 409, res.body));
    check(`${state}, round ${qn}: nothing written or sent`, () => {
      assert.strictEqual((roundOf('4004', '001') || {}).StageFocus, undefined);
      assert.strictEqual(sent.length, 0);
    });
  }
  seedGame('4005');
  store.delete(key('GAME#4005', 'STATE'));
  const noState = await post('4005', { focus: 'answer', index: 0, questionNumber: 1 });
  check('no STATE at all: 409', () => assert.strictEqual(noState.statusCode, 409, noState.body));
  seedGame('4006');
  setState('4006', 'ASK#001');
  const question = await post('4006', { focus: 'question', questionNumber: 1 });
  check('the question may still be enlarged during ASK', () => assert.strictEqual(question.statusCode, 200, question.body));

  console.log('\n4. parts of a long response');
  seedGame('4007');
  const part = await post('4007', { focus: 'answer', index: 1, part: 1, parts: 2, questionNumber: 1 });
  check('part 1 of 2 is stored', () => {
    assert.strictEqual(part.statusCode, 200, part.body);
    const r = roundOf('4007', '001');
    assert.deepStrictEqual([r.StageFocusPart, r.StageFocusParts], [1, 2]);
    assert.deepStrictEqual([sent[0].message.part, sent[0].message.parts], [1, 2]);
  });
  seedGame('4008');
  await post('4008', { focus: 'answer', index: 1, questionNumber: 1 });
  check('no part given is part 0 of 1', () => {
    const r = roundOf('4008', '001');
    assert.deepStrictEqual([r.StageFocusPart, r.StageFocusParts], [0, 1]);
  });
  for (const [p, n] of [[2, 2], [-1, 2], [0, 0], [0, 10], [1.5, 3], ['1', 3], [0, '2']]) {
    seedGame('4009');
    const res = await post('4009', { focus: 'answer', index: 0, part: p, parts: n, questionNumber: 1 });
    check(`part ${JSON.stringify(p)} of ${JSON.stringify(n)} is 400`, () => assert.strictEqual(res.statusCode, 400, res.body));
  }
  seedGame('4010');
  await post('4010', { focus: 'question', part: 1, parts: 2, questionNumber: 1 });
  check('a question focus carries no part', () => {
    const r = roundOf('4010', '001');
    assert.deepStrictEqual([r.StageFocusPart, r.StageFocusParts, r.StageFocusPhase], [null, null, null]);
  });

  console.log('\n5. the focus rev only goes up');
  seedGame('4011');
  await post('4011', { focus: 'answer', index: 0, questionNumber: 1 });
  await post('4011', { focus: 'answer', index: 1, questionNumber: 1 });
  await post('4011', { focus: 'none', questionNumber: 1 });
  check('three writes, rev 3', () => assert.strictEqual(roundOf('4011', '001').StageFocusRev, 3));
  check('the frames carry 1, 2, 3', () =>
    assert.deepStrictEqual(sent.filter((x) => x.connectionId === 'host-1').map((x) => x.message.rev), [1, 2, 3]));
  check('the round keeps its ttl', () => assert.ok(Number.isInteger(roundOf('4011', '001').ttl)));

  console.log('\n6. get-game-state hands a focus back only in the phase it was stamped for');
  seedGame('4012');
  setState('4012', 'VOTE#001');
  await post('4012', { focus: 'answer', index: 2, questionNumber: 1 });
  const inVote = await readState('4012');
  check('during VOTE the VOTE focus is there, with its phase, part and rev', () =>
    assert.deepStrictEqual(inVote.stageFocus, { focus: 'answer', index: 2, part: 0, parts: 1, phase: 'VOTE', rev: 1 }));
  setState('4012', 'RESULTS#001');
  const afterResults = await readState('4012');
  check('after Show results the same row reads none: response 3 never becomes rank 3', () =>
    assert.deepStrictEqual(afterResults.stageFocus, { focus: 'none', index: null, part: 0, parts: 1, phase: null, rev: 1 }));
  seedGame('4013');
  put({ PK: 'GAME#4013', SK: 'ROUND#001', StageFocus: 'answer', StageFocusIndex: 1 });
  const legacy = await readState('4013');
  check('a legacy row with no stamp reads as RESULTS', () =>
    assert.deepStrictEqual(legacy.stageFocus, { focus: 'answer', index: 1, part: 0, parts: 1, phase: 'RESULTS', rev: 0 }));
  setState('4013', 'VOTE#001');
  const legacyInVote = await readState('4013');
  check('…and so reads none during VOTE', () => assert.strictEqual(legacyInVote.stageFocus.focus, 'none'));
  const pub = JSON.parse((await getState({ pathParameters: { gameId: '4013' } })).body);
  check('the public read carries the same focus shape', () => assert.strictEqual(pub.stageFocus.focus, 'none'));

  console.log('\n7. FOCUS_PHASES is closed and mirrored in config/stageFocus.js');
  const { FOCUS_PHASES } = require(path.join(REPO, 'lambda-functions/game/stage-focus.js'));
  check('the server set is VOTE and RESULTS', () => assert.deepStrictEqual(FOCUS_PHASES, ['VOTE', 'RESULTS']));
  check('the frontend mirror says the same', () => {
    const mirror = require('fs').readFileSync(path.join(REPO, 'src/src/config/stageFocus.js'), 'utf8');
    const m = /export const FOCUS_PHASES\s*=\s*(?:Object\.freeze\()?\[([^\]]*)\]/.exec(mirror);
    assert.ok(m, 'no FOCUS_PHASES in src/src/config/stageFocus.js');
    assert.deepStrictEqual(m[1].split(',').map((x) => x.trim().replace(/^'|'$/g, '')).filter(Boolean), FOCUS_PHASES);
  });

  console.log(`\n${pass} passed, ${fail} failed`);
  suiteFinished();
  process.exit(fail === 0 ? 0 : 1);
})();
