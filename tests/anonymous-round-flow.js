/**
 * GET /games/{id}/answers must not hand out authorship while a round is
 * anonymous — to EITHER role. `role` is a client-supplied query parameter
 * (get-answers.js:11), not derived from auth, so "hide it from players but
 * show it to the host" is not a guarantee this API can keep: anybody can ask
 * for role=host. The only implementable contract is that the server does not
 * send the names at all while hidden, regardless of what role was requested.
 *
 * Runs the REAL get-answers handler against a stubbed DynamoDB. Sibling of
 * tests/anonymity-contract.js (which tests the redaction gate in isolation)
 * and tests/vote-state-broadcast.js (which this file's stub preamble is
 * copied from).
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

const { handler: getAnswers } = require(path.join(REPO, 'lambda-functions/game/get-answers.js'));

// ---- Tiny harness ----------------------------------------------------------
let pass = 0, fail = 0;
async function check(label, fn) {
  try { await fn(); console.log(`  PASS  ${label}`); pass++; }
  catch (e) { console.log(`  FAIL  ${label}\n        ${e.message}`); fail++; }
}

const put = (item) => store.set(key(item.PK, item.SK), item);

/** A call-and-answer game mid-ASK with two answers in. */
function seedAnonymousRound(gameId, { anonymous = true, revealed = false } = {}) {
  store.clear();
  sent = [];
  put({ PK: `GAME#${gameId}`, SK: 'METADATA', GameType: 'call-and-answer', Title: 'T',
        HostPreferences: { randomizeQuestions: true, anonymousUntilReveal: anonymous } });
  put({ PK: `GAME#${gameId}`, SK: 'STATE', State: 'ASK#001', LessonNumber: 1, CurrentQuestionId: '001' });
  put({ PK: `GAME#${gameId}`, SK: 'ROUND#001', QuestionNumber: '001', AuthorsRevealed: revealed });
  for (const n of ['Ada', 'Grace']) {
    put({ PK: `GAME#${gameId}`, SK: `QUESTION#001#ANSWER#${n}`,
          PlayerName: n, Answer: `${n}'s answer`, SubmittedAt: '2026-01-01T00:00:00.000Z' });
  }
}

const askAnswers = (gameId, role) => getAnswers({
  pathParameters: { gameId },
  queryStringParameters: { role, questionId: '001' }
});

(async () => {

console.log('\n1. GET /answers while hidden');

seedAnonymousRound('3001');
const asHost = JSON.parse((await askAnswers('3001', 'host')).body);
const asPlayer = JSON.parse((await askAnswers('3001', 'player')).body);

await check('the host payload carries no playerName', () =>
  assert.ok(asHost.answers.every(a => !('playerName' in a)),
    `leaked: ${JSON.stringify(asHost.answers[0])}`));
await check('the host payload carries no name', () =>
  assert.ok(asHost.answers.every(a => !('name' in a))));
// role is client-supplied, so "host" is not a trust boundary. Both branches
// must redact identically or the feature is a label on a leak.
await check('role=host and role=player return identical attribution', () =>
  assert.deepStrictEqual(
    asHost.answers.map(a => Object.keys(a).sort()),
    asPlayer.answers.map(a => Object.keys(a).sort())));
await check('the answers themselves survive, in order', () =>
  assert.deepStrictEqual(asHost.answers.map(a => a.answer),
    ["Ada's answer", "Grace's answer"]));
await check('the count is unchanged', () =>
  assert.strictEqual(asHost.answerCount, 2));

console.log('\n2. GET /answers once revealed');

seedAnonymousRound('3002', { revealed: true });
const revealed = JSON.parse((await askAnswers('3002', 'host')).body);
await check('revealed rounds carry playerName again', () =>
  assert.strictEqual(revealed.answers[0].playerName, 'Ada'));

console.log('\n3. GET /answers with anonymity turned off');

seedAnonymousRound('3003', { anonymous: false });
const plain = JSON.parse((await askAnswers('3003', 'host')).body);
await check('opting out carries playerName from the start', () =>
  assert.strictEqual(plain.answers[0].playerName, 'Ada'));

console.log('\n4. a game with no HostPreferences at all');

seedAnonymousRound('3004');
delete store.get(key('GAME#3004', 'METADATA')).HostPreferences;
const legacy = JSON.parse((await askAnswers('3004', 'host')).body);
// Games created before this feature must be anonymous, not accidentally open.
await check('a pre-feature game defaults to hidden', () =>
  assert.ok(!('playerName' in legacy.answers[0])));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);

})();
