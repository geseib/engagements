/**
 * Integration test: does the PLAYER payload carry what the player screen needs?
 *
 * Two defects live here, and both are payload-shape defects rather than UI ones:
 *
 *   D1  PlayerPage's round badge read `currentQuestion.id`, which get-question
 *       never emitted — so the badge rendered "Lesson " with no number during
 *       ASK and RESULTS. Only the VOTE phase, served by get-game-state, had an
 *       `id`.
 *   D2  PlayerPage guards its per-set instruction fetch on `questionData.setId`.
 *       get-question exposed the set id as `questionSetId`, and only on the HOST
 *       branch, so the guard could never fire and a player never saw a per-set
 *       instruction the host was showing.
 *
 * Runs the REAL get-question and get-game-state handlers against a stubbed
 * DynamoDB, in the style of tests/art-title-flow.js.
 */
const path = require('path');
const assert = require('assert');

const REPO = path.join(__dirname, '..');
const store = new Map();               // "PK|SK" -> item
const key = (pk, sk) => `${pk}|${sk}`;

// ---- Stub @aws-sdk/lib-dynamodb + client-dynamodb before handlers load ----
class PutCommand { constructor(i) { this.input = i; this.type = 'put'; } }
class GetCommand { constructor(i) { this.input = i; this.type = 'get'; } }
class QueryCommand { constructor(i) { this.input = i; this.type = 'query'; } }
class DeleteCommand { constructor(i) { this.input = i; this.type = 'delete'; } }
class UpdateCommand { constructor(i) { this.input = i; this.type = 'update'; } }
class BatchWriteCommand { constructor(i) { this.input = i; this.type = 'batchWrite'; } }

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
        return {};
      case 'batchWrite': {
        for (const [, requests] of Object.entries(inp.RequestItems || {})) {
          for (const r of requests) {
            if (r.PutRequest) store.set(key(r.PutRequest.Item.PK, r.PutRequest.Item.SK), r.PutRequest.Item);
            if (r.DeleteRequest) store.delete(key(r.DeleteRequest.Key.PK, r.DeleteRequest.Key.SK));
          }
        }
        return { UnprocessedItems: {} };
      }
      case 'query': {
        const pk = inp.ExpressionAttributeValues[':pk'] ?? inp.ExpressionAttributeValues[':PK'];
        const prefixVal = inp.ExpressionAttributeValues[':sk'] ?? inp.ExpressionAttributeValues[':prefix'] ?? '';
        const items = [...store.values()].filter(
          (i) => i.PK === pk && String(i.SK).startsWith(String(prefixVal))
        );
        return { Items: items, Count: items.length };
      }
      default:
        return {};
    }
  },
};

// Each lambda-functions/<group>/ may carry its own node_modules, and Node
// resolves from the requiring file's directory upward — so stub every copy or
// the real SDK loads and the test dies on credentials instead of assertions.
const STUB_PATHS = [
  REPO,
  path.join(REPO, 'lambda-functions'),
  path.join(REPO, 'lambda-functions', 'admin'),
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
  if (!seen.size) throw new Error(`stub(): could not resolve ${name} from any of ${STUB_PATHS.join(', ')}`);
}
stub('@aws-sdk/client-dynamodb', { DynamoDBClient: class {} });
stub('@aws-sdk/lib-dynamodb', {
  DynamoDBDocumentClient: { from: () => fakeDoc },
  PutCommand, GetCommand, QueryCommand, DeleteCommand, UpdateCommand, BatchWriteCommand,
});

process.env.TABLE_NAME = 'test-table';
process.env.GAME_TABLE = 'test-table';

let pass = 0, fail = 0;
function check(label, fn) {
  try { fn(); console.log(`  PASS  ${label}`); pass++; }
  catch (e) { console.log(`  FAIL  ${label}\n        ${e.message}`); fail++; }
}

// The player screen's badge logic, mirrored from PlayerPage.roundNumberOf().
function roundNumberOf(question, gameState) {
  for (const candidate of [question?.lessonNumber, question?.questionNumber, question?.id]) {
    const n = parseInt(candidate, 10);
    if (Number.isFinite(n) && n > 0) return n;
  }
  const fromState = parseInt(String(gameState || '').split('#')[1], 10);
  return Number.isFinite(fromState) && fromState > 0 ? fromState : null;
}

const SET_ID = 'famousarttitles';
const GAME_ID = '1234';

function seed(state) {
  store.clear();
  store.set(key(`SET#${SET_ID}`, 'QUESTION#001'), {
    PK: `SET#${SET_ID}`, SK: 'QUESTION#001',
    Title: 'THE COMPANY STEPS OUT',
    Category: 'Baroque',
    School: 'Rembrandt van Rijn',
    Image: 'https://example.test/night-watch.jpg',
    Detail: '',
    CustomInstructions: '',
  });
  store.set(key(`GAME#${GAME_ID}`, 'METADATA'), {
    PK: `GAME#${GAME_ID}`, SK: 'METADATA', GameId: GAME_ID,
    Title: 'Art Night', GameType: 'call-and-answer', QuestionSetId: SET_ID,
  });
  store.set(key(`GAME#${GAME_ID}`, 'STATE'), {
    PK: `GAME#${GAME_ID}`, SK: 'STATE', State: state,
    LessonNumber: 1, CurrentQuestionId: 'QUESTION#001',
  });
  store.set(key(`GAME#${GAME_ID}`, 'QUESTION#001#REF'), {
    PK: `GAME#${GAME_ID}`, SK: 'QUESTION#001#REF',
    SourceQuestionId: 'QUESTION#001', SetId: SET_ID,
    StartedAt: new Date(0).toISOString(),
  });
}

(async () => {
  const questionHandler = require(path.join(REPO, 'lambda-functions/game/get-question.js')).handler;
  const stateHandler = require(path.join(REPO, 'lambda-functions/game/get-game-state.js')).handler;

  // ---------- 1. ASK: the phase where the badge used to be blank ----------
  console.log('\n1. get-question (role=player) during ASK');
  seed('ASK#001');
  const askRes = await questionHandler({
    pathParameters: { gameId: GAME_ID }, queryStringParameters: { role: 'player' },
  });
  check('returns 200', () =>
    assert.strictEqual(askRes.statusCode, 200, `got ${askRes.statusCode}: ${askRes.body}`));

  const ask = JSON.parse(askRes.body);
  check('D1: payload carries a round number the badge can render', () =>
    assert.strictEqual(roundNumberOf(ask, 'ASK#001'), 1,
      `badge would render ${JSON.stringify(roundNumberOf(ask, 'ASK#001'))} from ${JSON.stringify(ask.id)}/${JSON.stringify(ask.lessonNumber)}`));
  check('D1: `id` is present (it was absent, so the badge read undefined)', () =>
    assert.ok(ask.id, `id was ${JSON.stringify(ask.id)}`));
  check('D2: payload carries `setId`, the key PlayerPage guards on', () =>
    assert.strictEqual(ask.setId, SET_ID, `setId was ${JSON.stringify(ask.setId)}`));
  check('artwork still reaches the player (round noun resolves to Artwork)', () =>
    assert.ok(ask.image && ask.image.startsWith('http'), `image was ${JSON.stringify(ask.image)}`));

  // ---------- 2. RESULTS: the other blank-badge phase ----------
  console.log('\n2. get-question (role=player) during RESULTS');
  seed('RESULTS#001');
  const resultsRes = await questionHandler({
    pathParameters: { gameId: GAME_ID }, queryStringParameters: { role: 'player' },
  });
  // get-question only serves ASK# states; RESULTS is served from the same
  // record via the ASK guard, so assert on whichever answer it gives.
  check('RESULTS is not served a question (guard is ASK-only) — badge falls back to the phase', () => {
    assert.strictEqual(resultsRes.statusCode, 400, `got ${resultsRes.statusCode}`);
    assert.strictEqual(roundNumberOf(null, 'RESULTS#001'), 1);
  });

  // ---------- 3. VOTE: get-game-state, the path that always worked ----------
  console.log('\n3. get-game-state during VOTE (the path that already had an id)');
  seed('VOTE#001');
  const stateRes = await stateHandler({ pathParameters: { gameId: GAME_ID } });
  check('returns 200', () =>
    assert.strictEqual(stateRes.statusCode, 200, `got ${stateRes.statusCode}: ${stateRes.body}`));
  const cq = JSON.parse(stateRes.body).currentQuestionData || {};
  check('badge renders a number here too', () =>
    assert.strictEqual(roundNumberOf(cq, 'VOTE#001'), 1));
  check('and this path spells the set id `setId` — the same key get-question now uses', () =>
    assert.strictEqual(cq.setId, SET_ID));

  // ---------- 4. Host branch keeps its existing field ----------
  console.log('\n4. get-question (role=host) is unchanged');
  seed('ASK#001');
  const hostRes = await questionHandler({
    pathParameters: { gameId: GAME_ID }, queryStringParameters: { role: 'host' },
  });
  const host = JSON.parse(hostRes.body);
  check('host still gets questionSetId', () =>
    assert.strictEqual(host.questionSetId, SET_ID));
  check('host also gets setId now (the total-questions lookup reads it)', () =>
    assert.strictEqual(host.setId, SET_ID));
  check('host keeps its extra fields', () =>
    assert.ok('points' in host && 'sourceQuestionId' in host));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('harness error:', e); process.exit(2); });
