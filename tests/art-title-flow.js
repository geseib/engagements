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
// upload-questions.js batches its writes (165 items -> 9 calls), so the stub has
// to speak BatchWrite too. Without it the handler 500s and every assertion below
// fails for a reason that has nothing to do with what this file is testing.
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
  PutCommand, GetCommand, QueryCommand, DeleteCommand, UpdateCommand, BatchWriteCommand,
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

  // The reveal. Title is the TEASER ("THE ENIGMATIC SMILE"), School is the
  // artist credit — neither is the real title, so before this the real title
  // was nowhere in the system and Workie could not possibly reveal it.
  // AnswerDetails is the only column that is read by game/get-ai-summary.js and
  // by no player or host payload, so it is where the reveal has to live.
  check('every artwork carries a reveal in AnswerDetails', () => {
    const missing = questionItems.filter((i) => !i.AnswerDetails);
    assert.strictEqual(missing.length, 0, `${missing.length} artwork(s) with no reveal`);
  });
  check('the reveal names the real title, not the teaser', () => {
    const mona = questionItems.find((i) => i.Title === 'THE ENIGMATIC SMILE');
    assert.ok(mona, 'the Mona Lisa round is missing from the set');
    assert.ok(/Mona Lisa/i.test(mona.AnswerDetails), mona.AnswerDetails);
    assert.ok(!/Mona Lisa/i.test(mona.Title), 'the teaser gives the answer away');
  });
  check('every reveal is labelled so the prompt can find the title', () =>
    assert.ok(questionItems.every((i) => /Real title:/i.test(i.AnswerDetails)),
      'a reveal is not in the "Real title: ... Trivia: ..." shape the art prompt reads'));
  check('a trivia hook is present (or deliberately blank, never invented)', () => {
    const withTrivia = questionItems.filter((i) => /Trivia:\s*\S/.test(i.AnswerDetails));
    assert.ok(withTrivia.length === questionItems.length,
      `${questionItems.length - withTrivia.length} artwork(s) have an empty trivia hook`);
  });

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

  // The reveal must not reach the room before RESULTS. It is not in
  // get-game-state's currentQuestionData projection at all, which is the
  // property that makes AnswerDetails the safe home for it — Detail_lesson
  // would have been shown to players during ASK and ended the round instantly.
  const payloadText = stateRes.body;
  check('the real title is NOT in the player payload', () =>
    assert.ok(!/Mona Lisa/i.test(payloadText), 'the answer leaked to players before RESULTS'));
  check('the trivia is NOT in the player payload', () =>
    assert.ok(!/Vincenzo Peruggia/i.test(payloadText)));
  check('AnswerDetails is not projected under any spelling', () => {
    assert.strictEqual(cq.answerDetails, undefined);
    assert.strictEqual(cq.AnswerDetails, undefined);
    assert.ok(!/answerdetails/i.test(payloadText), payloadText.slice(0, 200));
  });

  // ---------- 4. neither role sees the reveal, in any state ----------
  console.log('\n4. the reveal is withheld from player AND host in every state');
  const questionHandler = require(path.join(REPO, 'lambda-functions/game/get-question.js')).handler;

  const leaks = (body) => /Mona Lisa/i.test(body) || /Vincenzo Peruggia/i.test(body);

  // get-question only serves the ASK state (it 400s otherwise), so it is checked
  // there for both roles.
  for (const role of ['player', 'host']) {
    store.set(key('GAME#1234', 'STATE'), {
      PK: 'GAME#1234', SK: 'STATE', State: 'ASK#001',
      LessonNumber: 1, CurrentQuestionId: artQ.SK,
    });
    const qRes = await questionHandler({
      pathParameters: { gameId: '1234' },
      queryStringParameters: { role },
    });
    check(`get-question, ${role} @ ASK: no reveal in the payload`, () => {
      assert.strictEqual(qRes.statusCode, 200, `got ${qRes.statusCode}: ${qRes.body}`);
      assert.ok(!leaks(qRes.body), 'the reveal leaked to the client');
    });
  }

  // get-game-state is the payload that drives the player through the whole
  // round, so it is checked in every state the round passes through.
  for (const state of ['ASK#001', 'VOTE#001', 'RESULTS#001']) {
    store.set(key('GAME#1234', 'STATE'), {
      PK: 'GAME#1234', SK: 'STATE', State: state,
      LessonNumber: 1, CurrentQuestionId: artQ.SK,
    });
    const sRes = await stateHandler({ pathParameters: { gameId: '1234' } });
    check(`get-game-state @ ${state}: no reveal in the payload`, () => {
      assert.strictEqual(sRes.statusCode, 200, `got ${sRes.statusCode}: ${sRes.body}`);
      assert.ok(!leaks(sRes.body), 'the reveal leaked to the client');
    });
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('harness error:', e); process.exit(2); });
