/**
 * Integration test: does an Image column survive the whole pipeline?
 *
 * Runs the REAL upload-questions and get-game-state handlers against a stubbed
 * DynamoDB, so it exercises the actual CSV parsing and the actual projections
 * rather than a reimplementation of them.
 *
 *   CSV -> upload-questions -> SET#/QUESTION# item -> get-game-state -> player payload
 */
const fs = require('fs');
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

// The handlers live in lambda-functions/<group>/, and each of those directories
// may carry its own node_modules (they're deployed as independent bundles). Node
// resolves from the *requiring* file's directory upward, so stubbing only the
// repo-root copy silently misses whenever a handler dir has its own install —
// the real AWS SDK then loads and the test dies on missing credentials rather
// than on anything it means to assert. Poison every resolvable copy.
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
  PutCommand, GetCommand, QueryCommand, DeleteCommand, UpdateCommand,
});

process.env.TABLE_NAME = 'test-table';
process.env.GAME_TABLE = 'test-table';

let pass = 0, fail = 0;
function check(label, fn) {
  try { fn(); console.log(`  PASS  ${label}`); pass++; }
  catch (e) { console.log(`  FAIL  ${label}\n        ${e.message}`); fail++; }
}

(async () => {
  // ---------- 1. Upload the real art CSV through the real handler ----------
  console.log('\n1. upload-questions: CSV with an Image column');
  const uploadHandler = require(path.join(REPO, 'lambda-functions/admin/upload-questions.js')).handler;
  const csv = fs.readFileSync(path.join(REPO, 'sets/famous-art-titles.csv'), 'utf8');

  const uploadRes = await uploadHandler({
    body: JSON.stringify({
      fileName: 'famous-art-titles.csv',
      fileContent: csv,
      customTitle: 'Famous Art Titles',
      customDescription: 'Public-domain masterpieces',
      engagementType: 'call-and-answer',
    }),
  });
  check('upload returns 200', () =>
    assert.strictEqual(uploadRes.statusCode, 200, `got ${uploadRes.statusCode}: ${uploadRes.body}`));

  const questionItems = [...store.values()].filter((i) => String(i.SK).startsWith('QUESTION#'));
  check('all 10 rows stored as questions', () =>
    assert.strictEqual(questionItems.length, 10, `stored ${questionItems.length}`));
  check('every stored question has a non-empty Image', () => {
    const missing = questionItems.filter((i) => !i.Image);
    assert.strictEqual(missing.length, 0, `${missing.length} without Image`);
  });
  check('Image is the artwork URL, not another column', () => {
    const bad = questionItems.filter((i) => !/^https?:\/\//.test(i.Image));
    assert.strictEqual(bad.length, 0, `bad: ${bad.map((b) => b.Image).join(', ')}`);
  });
  check('School (artist credit) preserved', () =>
    assert.ok(questionItems.every((i) => i.School && i.School.length), 'a School was empty'));
  check('Detail left blank so the artwork is not spoiled', () =>
    assert.ok(questionItems.every((i) => !i.Detail), 'a Detail was populated'));

  // ---------- 2. Regression: a normal set must be unaffected ----------
  console.log('\n2. upload-questions: ordinary set with NO Image column');
  const plainCsv = [
    'Category,Question#,Title,Detail_lesson,School,CustomInstruction',
    '"Leadership",1,"A LESSON","Some detail here","School of Management","Apply it"',
  ].join('\n');
  const plainRes = await uploadHandler({
    body: JSON.stringify({
      fileName: 'plain.csv', fileContent: plainCsv,
      customTitle: 'Plain Set', engagementType: 'call-and-answer',
    }),
  });
  check('upload returns 200', () =>
    assert.strictEqual(plainRes.statusCode, 200, `got ${plainRes.statusCode}: ${plainRes.body}`));
  const plainQ = [...store.values()].find((i) => i.PK === 'SET#plainset' && String(i.SK).startsWith('QUESTION#'));
  check('stored with empty Image (not undefined/crash)', () =>
    assert.strictEqual(plainQ.Image, '', `got ${JSON.stringify(plainQ.Image)}`));
  check('its Detail still populated as before', () =>
    assert.strictEqual(plainQ.Detail, 'Some detail here'));

  // ---------- 3. Read path: does image reach the player? ----------
  console.log('\n3. get-game-state: image reaches the player payload');
  const artQ = questionItems.find((i) => i.PK === 'SET#famousarttitles');
  const setId = artQ.PK.replace('SET#', '');

  store.set(key('GAME#1234', 'METADATA'), {
    PK: 'GAME#1234', SK: 'METADATA', GameId: '1234',
    Title: 'Art Night', gameType: 'call-and-answer', QuestionSetId: setId,
  });
  // get-game-state derives the question number from LessonNumber, and the #REF
  // record is keyed with SourceQuestionId + SetId (matching every reader in game/).
  store.set(key('GAME#1234', 'STATE'), {
    PK: 'GAME#1234', SK: 'STATE', State: 'ASK#001',
    LessonNumber: 1, CurrentQuestionId: artQ.SK,
  });
  store.set(key('GAME#1234', 'QUESTION#001#REF'), {
    PK: 'GAME#1234', SK: 'QUESTION#001#REF',
    SourceQuestionId: artQ.SK, SetId: setId, StartedAt: new Date(0).toISOString(),
  });

  const stateHandler = require(path.join(REPO, 'lambda-functions/game/get-game-state.js')).handler;
  const stateRes = await stateHandler({ pathParameters: { gameId: '1234' } });
  check('get-game-state returns 200', () =>
    assert.strictEqual(stateRes.statusCode, 200, `got ${stateRes.statusCode}: ${stateRes.body}`));

  const body = JSON.parse(stateRes.body);
  const cq = body.currentQuestionData || body.question || {};
  check('payload carries the image URL', () =>
    assert.ok(cq.image && cq.image.startsWith('http'), `image was ${JSON.stringify(cq.image)}`));
  check('image matches what was uploaded', () =>
    assert.strictEqual(cq.image, artQ.Image));
  check('school (artist credit) also carried', () =>
    assert.strictEqual(cq.school, artQ.School));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('harness error:', e); process.exit(2); });
