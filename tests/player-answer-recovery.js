/**
 * Can a player who backgrounded the tab get their own answer back?
 *
 * THE BUG THIS PINS. PlayerPage answers, then re-runs its state check on every
 * tab focus, socket reopen and page load. That check calls
 *
 *     GET /games/{id}/answers?player=<name>&question=<n>
 *     …and reads `answerData.hasAnswer`
 *
 * and get-answers.js has never produced a `hasAnswer` field. So the read was
 * permanently `undefined`, `setHasAnswered(false)` ran every time, and the phone
 * went back to the blank form with the submitted answer gone — while the answer
 * sat safely in DynamoDB the whole time. The same code path also clears
 * `selectedTriviaAnswer`, so a re-focus mid-question un-picked an option the
 * player had tapped but not yet submitted.
 *
 * Client-side state preservation cannot fix this: a page reload wipes it. Only
 * the server can answer "did I already submit?", so that is what is asserted
 * here.
 *
 * FIXTURES ARE PRODUCED, NOT WRITTEN. The PLAYER# row comes from running the
 * real join-game.js, and the ANSWER row from running the real websocket
 * message.js. Neither shape is typed out in this file. A test that invents its
 * own row would keep passing after the writers changed key or field names,
 * which is precisely the failure it is supposed to catch.
 */
const path = require('path');
const assert = require('assert');

const REPO = path.join(__dirname, '..');

// ---- Stubs, installed before any handler loads -----------------------------
class PutCommand { constructor(i) { this.input = i; this.type = 'put'; } }
class GetCommand { constructor(i) { this.input = i; this.type = 'get'; } }
class QueryCommand { constructor(i) { this.input = i; this.type = 'query'; } }
class DeleteCommand { constructor(i) { this.input = i; this.type = 'delete'; } }
class UpdateCommand { constructor(i) { this.input = i; this.type = 'update'; } }
class PostToConnectionCommand { constructor(i) { this.input = i; } }

const store = new Map();                 // "PK|SK" -> item
const key = (pk, sk) => `${pk}|${sk}`;

/** Frames a handler tried to push, in order. */
let sent = [];

/** A minimal, honest UpdateCommand applier — the real client mutates the item. */
function applyUpdate(input) {
  const k = key(input.Key.PK, input.Key.SK);
  const existing = store.get(k);
  if (input.ConditionExpression &&
      /attribute_not_exists\(\s*ClientId\s*\)/.test(input.ConditionExpression) &&
      existing && existing.ClientId !== undefined) {
    const err = new Error('The conditional request failed');
    err.name = 'ConditionalCheckFailedException';
    throw err;
  }
  const item = existing || { ...input.Key };
  const names = input.ExpressionAttributeNames || {};
  const values = input.ExpressionAttributeValues || {};
  const setClause = String(input.UpdateExpression || '').replace(/^\s*SET\s+/i, '');
  for (const pair of setClause.split(',')) {
    const [lhs, rhs] = pair.split('=').map((s) => s.trim());
    if (!lhs || !rhs) continue;
    item[names[lhs] || lhs] = values[rhs];
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
        let items = [...store.values()].filter(
          (i) => i.PK === pk && String(i.SK).startsWith(String(prefix))
        );
        // The two filter shapes these handlers actually send.
        const filter = String(inp.FilterExpression || '');
        if (/ConnectionType\s*=\s*:type/.test(filter)) {
          items = items.filter((i) => i.ConnectionType === inp.ExpressionAttributeValues[':type']);
        }
        if (/ConnectionType\s*=\s*:ct/.test(filter)) {
          items = items.filter((i) => i.ConnectionType === inp.ExpressionAttributeValues[':ct']);
        }
        return { Items: items, Count: items.length };
      }
      default:
        return {};
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

const getAnswers = require(path.join(REPO, 'lambda-functions/game/get-answers.js')).handler;
const joinGame = require(path.join(REPO, 'lambda-functions/game/join-game.js')).handler;
const wsMessage = require(path.join(REPO, 'lambda-functions/websocket/message.js')).handler;

// ---- Tiny harness ----------------------------------------------------------
let pass = 0, fail = 0;
function check(label, fn) {
  try { fn(); console.log(`  PASS  ${label}`); pass++; }
  catch (e) { console.log(`  FAIL  ${label}\n        ${e.message}`); fail++; }
}

const put = (item) => store.set(key(item.PK, item.SK), item);
const body = (res) => JSON.parse(res.body);

/**
 * A started call-and-answer game sitting on ASK#001, with a host socket and a
 * player socket attached. Only rows this file does not have a real writer for
 * are placed by hand: METADATA, STATE and CONNECTION#.
 */
function seedGame(gameId, { state = 'ASK#001', gameType = 'call-and-answer' } = {}) {
  store.clear();
  sent = [];
  put({
    PK: `GAME#${gameId}`, SK: 'METADATA',
    GameType: gameType, Title: 'Test session', Started: true, Visibility: 'public',
  });
  put({
    PK: `GAME#${gameId}`, SK: 'STATE',
    State: state, LessonNumber: 1, CurrentQuestionId: '001',
  });
  put({
    PK: `GAME#${gameId}`, SK: 'CONNECTION#host-1',
    ConnectionId: 'host-1', ConnectionType: 'HOST',
  });
  put({
    PK: `GAME#${gameId}`, SK: 'CONNECTION#player-1',
    ConnectionId: 'player-1', ConnectionType: 'PLAYER', PlayerName: 'Ada',
  });
}

/** Run the REAL join handler so the PLAYER# row is whatever join-game writes. */
const join = (gameId, playerName, clientId) =>
  joinGame({
    pathParameters: { gameId },
    body: JSON.stringify({ playerName, ...(clientId ? { clientId } : {}) }),
  });

/** Run the REAL websocket handler so the ANSWER row is whatever it writes. */
const answerOverSocket = (gameId, playerName, messageType, data) =>
  wsMessage({
    requestContext: { connectionId: 'player-1' },
    body: JSON.stringify({ messageType, gameId, playerName, ...data }),
  });

/** The recovery call PlayerPage makes on every focus / reopen / reload. */
const askForMyAnswer = (gameId, query) =>
  getAnswers({ pathParameters: { gameId }, queryStringParameters: query });

(async () => {
  // ---------- 1. the round trip that was broken ----------
  console.log('\n1. a player answers, then comes back and asks whether they did');
  seedGame('3001');
  const joined = await join('3001', 'Ada', 'client-ada');
  check('join succeeded (fixtures are real)', () =>
    assert.strictEqual(joined.statusCode, 200, `join returned ${joined.statusCode}: ${joined.body}`));

  await answerOverSocket('3001', 'Ada', 'ANSWER#001', { answer: 'a boat', answerType: 'text' });

  check('the answer really landed in the table', () =>
    assert.ok(store.get(key('GAME#3001', 'QUESTION#001#ANSWER#Ada')),
      'nothing was stored — the rest of this file would be testing a fantasy'));

  const mine = await askForMyAnswer('3001', {
    player: 'Ada', question: '001', clientId: 'client-ada',
  });

  check('responds 200', () =>
    assert.strictEqual(mine.statusCode, 200, `got ${mine.statusCode}: ${mine.body}`));

  // THE REGRESSION. PlayerPage reads this exact field name and nothing else to
  // decide whether to show the answered state.
  check('carries hasAnswer: true — the field the player client reads', () =>
    assert.strictEqual(body(mine).hasAnswer, true,
      `hasAnswer was ${JSON.stringify(body(mine).hasAnswer)}; ` +
      'undefined is falsy, which is how the phone forgot the player had answered'));

  check('hands the answer text back, so the submission can be redisplayed', () =>
    assert.strictEqual(body(mine).answer, 'a boat',
      `answer was ${JSON.stringify(body(mine).answer)}`));

  check('and its type, so the client knows how to render it', () =>
    assert.strictEqual(body(mine).answerType, 'text'));

  check('and when it was submitted', () =>
    assert.ok(body(mine).submittedAt, 'no submittedAt'));

  // A player is inside ASK when they ask this. Answering with the whole board
  // would hand them every other answer before the vote — the leak get-answers
  // spends its own comment block refusing to make.
  check('does NOT return the room\'s answers', () => {
    const payload = body(mine);
    assert.strictEqual(payload.answers, undefined,
      'own-answer mode returned the full answer list');
    assert.strictEqual(payload.answerCount, undefined,
      'own-answer mode returned the room\'s answer count');
  });

  // ---------- 2. a player who has not answered ----------
  console.log('\n2. a player who has not answered yet');
  seedGame('3002');
  await join('3002', 'Grace', 'client-grace');

  const notYet = await askForMyAnswer('3002', {
    player: 'Grace', question: '001', clientId: 'client-grace',
  });

  check('200, not 404 — "you have not answered" is an answer', () =>
    assert.strictEqual(notYet.statusCode, 200, `got ${notYet.statusCode}: ${notYet.body}`));

  check('hasAnswer is false, explicitly', () =>
    assert.strictEqual(body(notYet).hasAnswer, false,
      `hasAnswer was ${JSON.stringify(body(notYet).hasAnswer)} — a hardcoded true would ` +
      'lock an unanswered player out of the form entirely'));

  check('no answer text invented', () =>
    assert.strictEqual(body(notYet).answer, undefined));

  // ---------- 3. the identity gate ----------
  //
  // `player` is a query parameter. Without this gate, anyone holding the game
  // id could walk the roster and read every author's answer by name — the exact
  // attribution get-answers.js redacts for everyone else in the same file.
  console.log('\n3. the answer text is bound to the player who wrote it');
  seedGame('3003');
  await join('3003', 'Ada', 'client-ada');
  await answerOverSocket('3003', 'Ada', 'ANSWER#001', { answer: 'a boat', answerType: 'text' });

  const impostor = await askForMyAnswer('3003', {
    player: 'Ada', question: '001', clientId: 'client-somebody-else',
  });

  check('a mismatched clientId gets no answer text', () =>
    assert.strictEqual(body(impostor).answer, undefined,
      `handed out "${body(impostor).answer}" to a caller who is not Ada`));

  check('and is told the text was withheld, not that nothing exists', () => {
    assert.strictEqual(body(impostor).hasAnswer, true);
    assert.strictEqual(body(impostor).answerWithheld, true,
      'answerWithheld absent — a client cannot tell "no answer" from "not yours"');
  });

  const anonymous = await askForMyAnswer('3003', { player: 'Ada', question: '001' });

  check('no clientId at all gets no answer text either', () =>
    assert.strictEqual(body(anonymous).answer, undefined,
      `omitting clientId returned "${body(anonymous).answer}"`));

  // Deliberately still true: GET /state already publishes
  // answerProgress.answererIds — the whole list of who has answered — to any
  // caller with no identity. Withholding it here would protect nothing and
  // would break recovery for a legacy row join-game has not claimed.
  check('but hasAnswer stays truthful — it is already public via /state', () =>
    assert.strictEqual(body(anonymous).hasAnswer, true));

  // ---------- 4. the round-key padding ----------
  //
  // Every writer pads to three digits. A caller that sends `question=1` used to
  // read the prefix `QUESTION#1#ANSWER#`, match nothing, and get a confident
  // empty result — indistinguishable from "you never answered".
  console.log('\n4. an unpadded round number still finds the padded row');
  seedGame('3004');
  await join('3004', 'Ada', 'client-ada');
  await answerOverSocket('3004', 'Ada', 'ANSWER#001', { answer: 'a boat', answerType: 'text' });

  const unpadded = await askForMyAnswer('3004', {
    player: 'Ada', question: '1', clientId: 'client-ada',
  });

  check('question=1 finds the answer stored at QUESTION#001', () =>
    assert.strictEqual(body(unpadded).hasAnswer, true,
      'an unpadded round number missed the row — silently, which reads to the ' +
      'player as the system forgetting them'));

  check('and reports the padded id back, not the raw input', () =>
    assert.strictEqual(body(unpadded).questionId, '001',
      `questionId echoed as ${JSON.stringify(body(unpadded).questionId)}`));

  // Padding is guarded so it cannot manufacture a key nothing wrote.
  const junk = await askForMyAnswer('3004', {
    player: 'Ada', question: 'ab', clientId: 'client-ada',
  });
  check('a non-numeric round id is left alone, not zero-padded into "0ab"', () =>
    assert.strictEqual(body(junk).questionId, 'ab',
      `questionId became ${JSON.stringify(body(junk).questionId)}`));

  // ---------- 5. the list mode this branch sits in front of ----------
  console.log('\n5. the existing host/vote list mode is untouched');
  seedGame('3005', { state: 'VOTE#001' });
  await join('3005', 'Ada', 'client-ada');
  await join('3005', 'Grace', 'client-grace');
  store.set(key('GAME#3005', 'STATE'), {
    PK: 'GAME#3005', SK: 'STATE', State: 'ASK#001', LessonNumber: 1, CurrentQuestionId: '001',
  });
  await answerOverSocket('3005', 'Ada', 'ANSWER#001', { answer: 'a boat', answerType: 'text' });
  await answerOverSocket('3005', 'Grace', 'ANSWER#001', { answer: 'a bug', answerType: 'text' });

  const list = await getAnswers({
    pathParameters: { gameId: '3005' },
    queryStringParameters: { role: 'host', questionId: '001' },
  });

  check('a call with no `player` still returns the list', () => {
    const payload = body(list);
    assert.ok(Array.isArray(payload.answers), 'answers is not an array');
    assert.strictEqual(payload.answers.length, 2,
      `got ${payload.answers.length} answers — adding the own-answer branch must not ` +
      'shadow the list every other caller uses');
  });

  check('and still redacts authorship on it', () =>
    // Anonymity defaults ON for a call-and-answer round nobody has revealed.
    assert.strictEqual(body(list).answers[0].playerName, undefined,
      'the list mode started leaking author names'));

  // ---------- 6. the ground truth the recovery depends on ----------
  //
  // Recovery reads QUESTION#001#ANSWER#<name>. If the writer ever stopped
  // padding, every one of the assertions above would still pass against its own
  // unpadded key while the rest of the system — get-results, get-votes,
  // get-game-state, start-vote — read past it.
  console.log('\n6. the writer pads, even when the client does not');
  seedGame('3006');
  await join('3006', 'Ada', 'client-ada');
  await answerOverSocket('3006', 'Ada', 'ANSWER#1', { answer: 'a boat', answerType: 'text' });

  check('ANSWER#1 from the client is stored at QUESTION#001#ANSWER#Ada', () => {
    assert.ok(store.get(key('GAME#3006', 'QUESTION#001#ANSWER#Ada')),
      'the padded key is empty');
    assert.ok(!store.get(key('GAME#3006', 'QUESTION#1#ANSWER#Ada')),
      'an unpadded row was written — every reader in the system queries the padded prefix');
  });

  // ---------- 7. VOTE# is the host's frame, not a player's ----------
  //
  // GameHostPage sends its new state verbatim, so `VOTE#001` on this socket is
  // the host opening the vote. It must broadcast, and it must not write a vote
  // row: the deleted player-vote handler built its SK unpadded.
  console.log('\n7. a VOTE# frame is routed as the host broadcast it is');
  seedGame('3007', { state: 'VOTE#001' });
  await join('3007', 'Ada', 'client-ada');
  sent = [];
  await wsMessage({
    requestContext: { connectionId: 'host-1' },
    body: JSON.stringify({ messageType: 'VOTE#001', gameId: '3007', playerName: 'Ada', votedFor: 'Grace' }),
  });

  check('it reaches the player connections', () => {
    const ids = sent.map((s) => s.connectionId);
    assert.deepStrictEqual(ids, ['player-1'],
      `frame went to [${ids}] — VOTE# is the host telling the room to vote`);
  });

  check('and is delivered as a hostMessage', () =>
    assert.strictEqual(sent[0].message.type, 'hostMessage',
      `type was '${sent[0].message.type}'`));

  check('no vote row is written on this path, padded or not', () => {
    const voteRows = [...store.keys()].filter((k) => k.includes('#VOTE#'));
    assert.deepStrictEqual(voteRows, [],
      `wrote ${JSON.stringify(voteRows)} — votes belong to submit-vote.js, which pads; ` +
      'a writer here would bury them at a key nothing reads');
  });

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
})();
