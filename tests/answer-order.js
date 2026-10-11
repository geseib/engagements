/**
 * THE ROOM'S ANSWER ORDER — shuffled per round, the same on every screen, and
 * the ballot still lands on the answer the voter saw (answer-order.js).
 *
 * Relay pilot, test game 6497: the anonymous numbering was 1 Lena, 2 Maya,
 * 3 Omar, 4 Theo in every round, because every reader Queried the answer rows
 * (`QUESTION#nnn#ANSWER#<name>`) and showed them in sort-key order, which is
 * alphabetical by author. Anyone who knew the roster could read the numbers.
 *
 * Pinned here:
 *   - the order is a pure function of game, round and the answer rows: stable
 *     for a round, different between rounds, not alphabetical;
 *   - the stage's door, every phone's door and start-vote's reply draw the
 *     SAME order (and reveal-authors after them);
 *   - a phone's ballot is keyed by what it SAW, and submit-vote stores it in
 *     the canonical (sort-key) order every tally reads — so the points land on
 *     the answer that was ranked, and a ballot stored before this change still
 *     counts as it did;
 *   - get-results and the report emit ties in the room's order, and still
 *     credit every answer to its author;
 *   - the module's two copies are byte-identical.
 *
 * rejects: an alphabetical or per-request order; two screens disagreeing; a
 *          ballot stored in display positions; points credited to the answer
 *          that happened to sit at the same SK position.
 */
const suiteFinished = require('./helpers/finish-guard');
const path = require('path');
const fs = require('fs');
const assert = require('assert');

const REPO = path.join(__dirname, '..');

const Module = require('module');
const stubs = new Map();
const realLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (stubs.has(request)) return stubs.get(request);
  return realLoad.call(this, request, parent, isMain);
};
const stub = (name, exports) => stubs.set(name, exports);

// ---- in-memory table, Query sorted by SK as DynamoDB sorts it ---------------
const store = new Map();
const key = (pk, sk) => `${pk}|${sk}`;
const put = (item) => store.set(key(item.PK, item.SK), item);

class GetCommand { constructor(i) { this.input = i; this.type = 'get'; } }
class PutCommand { constructor(i) { this.input = i; this.type = 'put'; } }
class QueryCommand { constructor(i) { this.input = i; this.type = 'query'; } }
class UpdateCommand { constructor(i) { this.input = i; this.type = 'update'; } }
class DeleteCommand { constructor(i) { this.input = i; this.type = 'delete'; } }
class ScanCommand { constructor(i) { this.input = i; this.type = 'scan'; } }
class TransactWriteCommand { constructor(i) { this.input = i; this.type = 'transact'; } }
class BatchWriteCommand { constructor(i) { this.input = i; this.type = 'batch'; } }

const fakeDoc = {
  send: async (cmd) => {
    const inp = cmd.input || {};
    switch (cmd.type) {
      case 'put': put(inp.Item); return {};
      case 'get': return { Item: store.get(key(inp.Key.PK, inp.Key.SK)) };
      case 'delete': store.delete(key(inp.Key.PK, inp.Key.SK)); return {};
      case 'query': {
        const v = inp.ExpressionAttributeValues || {};
        const items = [...store.values()]
          .filter((i) => i.PK === v[':pk'] && String(i.SK).startsWith(String(v[':sk'] ?? '')))
          .sort((a, b) => (a.SK < b.SK ? -1 : a.SK > b.SK ? 1 : 0));
        return { Items: items, Count: items.length };
      }
      default: return {};
    }
  },
};
stub('@aws-sdk/client-dynamodb', { DynamoDBClient: class {} });
stub('@aws-sdk/lib-dynamodb', {
  DynamoDBDocumentClient: { from: () => fakeDoc },
  GetCommand, PutCommand, QueryCommand, UpdateCommand, DeleteCommand, ScanCommand,
  TransactWriteCommand, BatchWriteCommand,
});
const noopClient = class { async send() { return {}; } };
stub('@aws-sdk/client-apigatewaymanagementapi', {
  ApiGatewayManagementApiClient: noopClient, PostToConnectionCommand: class {},
});
stub('@aws-sdk/client-lambda', { LambdaClient: noopClient, InvokeCommand: class {} });
stub('@aws-sdk/client-bedrock-runtime', { BedrockRuntimeClient: noopClient, InvokeModelCommand: class {} });
stub('@aws-sdk/client-s3', { S3Client: noopClient, GetObjectCommand: class {} });
stub('@aws-sdk/client-kms', {
  KMSClient: class { async send() { throw new Error('no KMS: every row here is platform'); } },
  GenerateDataKeyCommand: class {}, DecryptCommand: class {},
});

process.env.TABLE_NAME = 'test-table';
process.env.WEBSOCKET_API_ENDPOINT = 'https://ws.test.invalid/dev';

const order = require(path.join(REPO, 'lambda-functions/game/answer-order.js'));
const getAnswers = require(path.join(REPO, 'lambda-functions/game/get-answers.js')).handler;
const submitVote = require(path.join(REPO, 'lambda-functions/game/submit-vote.js')).handler;
const getResults = require(path.join(REPO, 'lambda-functions/game/get-results.js')).handler;
const revealAuthors = require(path.join(REPO, 'lambda-functions/game/reveal-authors.js')).handler;
const startVote = require(path.join(REPO, 'lambda-functions/websocket/start-vote.js')).handler;

if (!process.env.DEBUG) { console.log = () => {}; console.warn = () => {}; console.error = () => {}; }
const say = (...a) => process.stdout.write(a.join(' ') + '\n');

let pass = 0, fail = 0;
async function check(label, fn) {
  try { await fn(); say(`  PASS  ${label}`); pass++; }
  catch (e) { say(`  FAIL  ${label}\n        ${e.message}`); fail++; }
}

// ---- fixtures ---------------------------------------------------------------
const GAME = '6497';
const NAMES = ['Ada', 'Ben', 'Cleo', 'Dev', 'Eli', 'Fay'];
const textOf = (name, round) => `${name}'s answer to round ${round}`;
const HOST = { lambda: { userId: 'u-host', groups: 'hosts' } };

function seedRound(round, { state = `VOTE#${round}`, hidden = false } = {}) {
  put({ PK: `GAME#${GAME}`, SK: 'METADATA', GameType: 'call-and-answer', Title: 'Relay',
        ...(hidden ? { Anonymous: true } : {}) });
  put({ PK: `GAME#${GAME}`, SK: 'STATE', State: state, LessonNumber: Number(round) });
  put({ PK: `GAME#${GAME}`, SK: `ROUND#${round}`, QuestionNumber: round, AuthorsRevealed: !hidden });
  for (const name of NAMES) {
    put({ PK: `GAME#${GAME}`, SK: `QUESTION#${round}#ANSWER#${name}`, PlayerName: name,
          Answer: textOf(name, round), SubmittedAt: '2026-10-11T11:00:00.000Z' });
  }
}

const body = (res) => JSON.parse(res.body);
const hostAnswers = async (round) => body(await getAnswers({
  routeKey: 'GET /games/{gameId}/answers/host',
  pathParameters: { gameId: GAME }, queryStringParameters: { questionId: round },
  requestContext: { routeKey: 'GET /games/{gameId}/answers/host', authorizer: HOST },
})).answers;
const phoneAnswers = async (round) => body(await getAnswers({
  pathParameters: { gameId: GAME }, queryStringParameters: { question: round },
})).answers;
const texts = (list) => list.map((a) => a.answer);
const alphabetical = (round) => NAMES.map((n) => textOf(n, round));

(async () => {
  say('\n1. the order itself');
  const rows = (round) => NAMES.map((n) => ({ SK: `QUESTION#${round}#ANSWER#${n}`, PlayerName: n }));
  await check('the two copies are byte-identical', () => {
    const a = fs.readFileSync(path.join(REPO, 'lambda-functions/game/answer-order.js'), 'utf8');
    const b = fs.readFileSync(path.join(REPO, 'lambda-functions/websocket/answer-order.js'), 'utf8');
    assert.strictEqual(a, b);
  });
  await check('stable: the same game and round give the same order every time', () => {
    const first = order.displayOrder(rows('001'), GAME, '001');
    for (let i = 0; i < 5; i++) assert.deepStrictEqual(order.displayOrder(rows('001'), GAME, '001'), first);
    assert.deepStrictEqual(order.displayOrder(rows('001'), GAME, 1), first, 'an unpadded round reads differently');
  });
  await check('a permutation of every answer, with none lost or doubled', () => {
    const o = order.displayOrder(rows('001'), GAME, '001');
    assert.deepStrictEqual([...o].sort(), [0, 1, 2, 3, 4, 5]);
  });
  await check('not alphabetical, in any of the first six rounds', () => {
    for (const r of ['001', '002', '003', '004', '005', '006']) {
      assert.notDeepStrictEqual(order.displayOrder(rows(r), GAME, r), [0, 1, 2, 3, 4, 5], `round ${r}`);
    }
  });
  await check('different between rounds, and between games', () => {
    const seen = new Set(['001', '002', '003', '004', '005', '006']
      .map((r) => order.displayOrder(rows(r), GAME, r).join(',')));
    assert.ok(seen.size >= 5, `only ${seen.size} distinct orders in six rounds`);
    assert.notDeepStrictEqual(order.displayOrder(rows('001'), '6498', '001'), order.displayOrder(rows('001'), GAME, '001'));
  });
  await check('raw rows and decrypted rows agree (the sort key decides, not the name field)', () => {
    const raw = NAMES.map((n) => ({ SK: `QUESTION#001#ANSWER#${n}`, PlayerName: { v: 1, ct: 'sealed' } }));
    assert.deepStrictEqual(order.displayOrder(raw, GAME, '001'), order.displayOrder(rows('001'), GAME, '001'));
  });
  await check('removing one answer moves no other answer past another', () => {
    const all = order.inDisplayOrder(rows('003'), GAME, '003').map((a) => a.PlayerName);
    const less = order.inDisplayOrder(rows('003').filter((a) => a.PlayerName !== 'Cleo'), GAME, '003').map((a) => a.PlayerName);
    assert.deepStrictEqual(less, all.filter((n) => n !== 'Cleo'));
  });

  say('\n2. every reader draws the same order');
  seedRound('001');
  const expected = order.inDisplayOrder(rows('001'), GAME, '001').map((a) => textOf(a.PlayerName, '001'));
  const stage = await hostAnswers('001');
  const phone = await phoneAnswers('001');
  const phoneAgain = await phoneAnswers('1');
  const opened = body(await startVote({
    pathParameters: { gameId: GAME }, body: JSON.stringify({ questionNumber: 1 }),
    requestContext: { authorizer: HOST },
  }));
  await check('the stage (host door) is in the room\'s order, not alphabetical', () => {
    assert.deepStrictEqual(texts(stage), expected);
    assert.notDeepStrictEqual(texts(stage), alphabetical('001'));
  });
  await check('every phone gets the same order and therefore the same numbers', () => {
    assert.deepStrictEqual(texts(phone), expected);
    assert.deepStrictEqual(texts(phoneAgain), expected, 'a reload with ?question=1 drew another order');
  });
  await check('start-vote hands the stage the same list', () =>
    assert.deepStrictEqual(texts(opened.answers), expected));
  await check('reveal-authors names them in the same order', async () => {
    const revealed = body(await revealAuthors({
      pathParameters: { gameId: GAME }, body: JSON.stringify({ questionNumber: '1' }),
      requestContext: { authorizer: HOST },
    }));
    assert.deepStrictEqual(texts(revealed.answers), expected);
  });
  seedRound('002');
  await check('the next round is drawn in a different order', async () =>
    assert.notDeepStrictEqual((await phoneAnswers('002')).map((a) => a.playerName),
      (await phoneAnswers('001')).map((a) => a.playerName)));

  say('\n3. the ballot lands on the answer the voter saw');
  seedRound('003');
  const shown = await phoneAnswers('003');
  // Each voter ranks what sits at display positions 0, 1, 2 on their screen.
  for (const voter of ['V1', 'V2']) {
    const res = await submitVote({ pathParameters: { gameId: GAME },
      body: JSON.stringify({ playerName: voter, questionNumber: '3', votes: { 0: 1, 1: 2, 2: 3 } }) });
    assert.strictEqual(res.statusCode, 200, res.body);
  }
  const stored = store.get(key(`GAME#${GAME}`, 'QUESTION#003#VOTE#V1')).Votes;
  const canonical = NAMES; // SK order
  await check('the stored ballot is in canonical (sort-key) positions', () => {
    const named = Object.fromEntries(Object.entries(stored).map(([i, r]) => [canonical[i], r]));
    assert.deepStrictEqual(named, {
      [shown[0].playerName]: 1, [shown[1].playerName]: 2, [shown[2].playerName]: 3,
    });
  });
  await check('a position that names no answer is dropped, and a ballot of nothing but those is refused', async () => {
    const res = await submitVote({ pathParameters: { gameId: GAME },
      body: JSON.stringify({ playerName: 'V9', questionNumber: '3', votes: { 7: 1, 8: 2 } }) });
    assert.strictEqual(res.statusCode, 400, res.body);
    assert.ok(!store.has(key(`GAME#${GAME}`, 'QUESTION#003#VOTE#V9')));
  });
  // A ballot stored BEFORE the shuffle: canonical positions, as phones used to send.
  put({ PK: `GAME#${GAME}`, SK: 'QUESTION#003#VOTE#Old', VoterName: 'Old', QuestionNumber: '003',
        Votes: { 5: 1 } }); // Fay, first place
  put({ PK: `GAME#${GAME}`, SK: 'STATE', State: 'RESULTS#003', LessonNumber: 3 });
  const results = body(await getResults({ pathParameters: { gameId: GAME }, body: JSON.stringify({ questionNumber: 3 }) }));
  const pointsOf = (name) => Object.values(results.voteTallies).find((t) => t.playerName === name).totalScore;
  await check('the points go to the authors of the answers that were ranked', () => {
    const expectedPoints = Object.fromEntries(NAMES.map((n) => [n, 0]));
    expectedPoints[shown[0].playerName] += 6;
    expectedPoints[shown[1].playerName] += 4;
    expectedPoints[shown[2].playerName] += 2;
    expectedPoints.Fay += 3; // the old ballot
    for (const n of NAMES) assert.strictEqual(pointsOf(n), expectedPoints[n], `${n}: ${pointsOf(n)}`);
  });
  await check('each tally still pairs an answer with its own author', () => {
    for (const t of Object.values(results.voteTallies)) assert.strictEqual(t.answerText, textOf(t.playerName, '003'));
  });
  await check('results come out keyed in the room\'s order, so ties read that way', () => {
    assert.deepStrictEqual(Object.values(results.voteTallies).map((t) => t.answerText), texts(shown));
  });

  say('\n4. the report breaks ties in the room\'s order');
  await check('create-report sorts equal scores by display position, not by name', () => {
    const src = fs.readFileSync(path.join(REPO, 'lambda-functions/game/create-report.js'), 'utf8');
    assert.match(src, /shownPlace\.get\(a\.answerIndex\) - shownPlace\.get\(b\.answerIndex\)/);
    assert.match(src, /displayOrder\(questionAnswers, gameId, questionNumber\)/);
  });

  say(`\n${pass} passed, ${fail} failed`);
  suiteFinished();
  process.exit(fail ? 1 : 0);
})().catch((e) => { say(`CRASH ${e.stack}`); process.exit(1); });
