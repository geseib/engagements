/**
 * THE REST OF THE HOST CONTROLS BELONG TO THE ORGANISATION THAT OWNS THE ROOM.
 *
 * ── THE HOLE ───────────────────────────────────────────────────────────────
 *
 * `session-org-ownership.js` closed this for `next-question`, `update-game` and
 * `start-game`; `session-beat-org-scope.js` closed it for `stage-beat` and
 * `reveal-authors`. Seven Cognito-gated session routes were still left behind,
 * and between them they close a round, drive the room, name the people in it
 * and enumerate what it has not been asked yet:
 *
 *     POST /games/{gameId}/close-round     resolves the round (get-results.js)
 *     GET  /games/{gameId}/up-next         the unasked questions
 *     POST /games/{gameId}/stage-focus     one named person, full-screen
 *     GET  /games/{gameId}/queue           the running order
 *     POST /games/{gameId}/queue           …and reorders it
 *     GET  /games/{gameId}/exclusions      the disabled questions
 *     POST /games/{gameId}/exclusions      …and disables more
 *     POST /games/{gameId}/start-question  moves the room into ASK
 *     POST /games/{gameId}/start-vote      moves it into VOTE, and answers
 *                                          with every author's name
 *
 * All of them carry the Cognito authorizer, so the boundary was "any `hosts`
 * account", and not one compared the caller's organisation to the session's.
 * Game ids are four digits (create-game.js), so the whole id space is 9,000
 * values and a rival's live session is found by walking it.
 *
 * ── WHY close-round IS THE SHARP ONE ───────────────────────────────────────
 *
 * `session-beat-org-scope.js` closed `/reveal-authors`, which ends a round's
 * anonymity. It did not close the OTHER route that does the same thing.
 * `get-results.js` on the close-round route flips `AuthorsRevealed`, awards the
 * scores and writes `RESULTS#nnn` — so the anonymity break that commit fixed
 * stayed reachable, by a different door, for anyone holding four digits.
 *
 * That is what section 1 asserts, and it is why the reveal assertion here is
 * about the round record and not merely about a status code.
 *
 * ── AND WHY start-vote IS THE SECOND ───────────────────────────────────────
 *
 * `start-vote` hands back the ballot. On a session that is not hiding authors
 * that ballot is every participant's NAME against their ANSWER, which is the
 * same disclosure `/reveal-authors` is gated for — reached without ever asking
 * for the reveal. Section 8 pins that the refusal returns no names at all.
 *
 * // rejects: a cross-org caller closing a round, reading a running order,
 * //          driving a room, or being handed a roster — and any of these
 * //          handlers calling the guard and then acting anyway.
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

/** Frames the handler tried to push, in order. A refused call must push none. */
let sent = [];

/**
 * A real UpdateCommand applier, not a `return {}` stub — the same one
 * `session-beat-org-scope.js` and `stage-beat-flow.js` use, and for the same
 * reason. Half the assertions here are that a record was NEVER TOUCHED, and a
 * stub which swallowed writes would let a handler that ignores the guard pass.
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
    sent.push({ connectionId: cmd.input.ConnectionId, message: JSON.parse(cmd.input.Data) });
    return {};
  }
}

/*
  @aws-sdk/client-kms cannot go through require.cache the way the others do —
  it is not installed anywhere this file can resolve it from. Same interception
  tests/plan-gating.js uses. The sessions here are owned by an organisation, so
  get-results reaches tenant-crypto on the paths that actually close a round.
*/
const Module = require('module');
const moduleStubs = new Map();
const realLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (moduleStubs.has(request)) return moduleStubs.get(request);
  return realLoad.call(this, request, parent, isMain);
};
const nodeCrypto = require('crypto');
class GenerateDataKeyCommand { constructor(i) { this.input = i; } }
class DecryptCommand { constructor(i) { this.input = i; } }
const wrapKey = (orgId, k) =>
  Buffer.from(JSON.stringify({ orgId, key: k.toString('base64') }), 'utf8');
moduleStubs.set('@aws-sdk/client-kms', {
  KMSClient: class {
    async send(command) {
      if (command instanceof GenerateDataKeyCommand) {
        const orgId = command.input.EncryptionContext?.orgId;
        assert.ok(orgId, 'GenerateDataKey must bind an orgId');
        const k = nodeCrypto.randomBytes(32);
        return { Plaintext: k, CiphertextBlob: wrapKey(orgId, k) };
      }
      if (command instanceof DecryptCommand) {
        const ctx = command.input.EncryptionContext?.orgId;
        if (!ctx) throw new Error('AccessDeniedException: no orgId in encryption context');
        const blob = JSON.parse(Buffer.from(command.input.CiphertextBlob).toString('utf8'));
        return { Plaintext: Buffer.from(blob.key, 'base64') };
      }
      throw new Error('unexpected KMS command');
    }
  },
  GenerateDataKeyCommand,
  DecryptCommand,
});

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

const { handler: getResults } = require(path.join(REPO, 'lambda-functions/game/get-results.js'));
const { handler: upNext } = require(path.join(REPO, 'lambda-functions/game/up-next.js'));
const { handler: stageFocus } = require(path.join(REPO, 'lambda-functions/game/stage-focus.js'));
const { handler: questionQueue } = require(path.join(REPO, 'lambda-functions/game/question-queue.js'));
const { handler: questionExclusions } = require(path.join(REPO, 'lambda-functions/game/question-exclusions.js'));
const { handler: startQuestion } = require(path.join(REPO, 'lambda-functions/websocket/start-question.js'));
const { handler: startVote } = require(path.join(REPO, 'lambda-functions/websocket/start-vote.js'));

// ---- Harness ---------------------------------------------------------------
let pass = 0; let fail = 0;
const check = (label, fn) => {
  try { fn(); console.log(`  ok   - ${label}`); pass += 1; } catch (e) {
    console.log(`  FAIL - ${label}\n         ${e.message}`); fail += 1;
  }
};

const ORG_A = 'org_9xK4Fq7Pz2mNbVc8dQwLxR';   // owns the room
const ORG_B = 'org_Tb2VnQ8sLxK4WmC7gRdYpF';   // the rival, holding only the code

const GAME = '4242';
const SET = 'teamretro';
const PK = `GAME#${GAME}`;
const SETPK = `SET#${SET}`;

const put = (item) => store.set(key(item.PK, item.SK), item);
const at = (sk) => store.get(key(PK, sk));

/** An authenticated host in `orgId`. Matches the Lambda authorizer context. */
const host = (orgId, method = 'POST') => ({
  requestContext: {
    http: { method },
    authorizer: { lambda: { userId: 'u', groups: 'hosts', orgId } },
  },
});

/**
 * One live session owned by ORG_A, mid-round, with a queue, an exclusion list,
 * a set to draw from and two named participants who have already answered.
 * Everything the seven routes read, so that "the owning org is unaffected"
 * is a real 200 and not an accident of a thin fixture.
 */
function seedGame({ orgId = ORG_A, state = 'ASK#001', gameType = 'trivia' } = {}) {
  store.clear();
  sent = [];

  put({
    PK, SK: 'METADATA', Title: 'Their session', GameType: gameType,
    QuestionSetId: SET, RandomSeed: 'fixed-seed', HideAuthors: false,
    ...(orgId ? { orgId } : {}),
  });
  put({ PK, SK: 'STATE', State: state, LessonNumber: 1, CurrentQuestionId: '001' });
  put({ PK, SK: 'ROUND#001', QuestionNumber: '001' });
  put({
    PK, SK: 'STATE#CATS',
    'AvailMask1-8': '11000000', 'AvailMask9-16': '00000000', 'AvailMask17-24': '00000000',
    'HostMask1-8': '11000000', 'HostMask9-16': '00000000', 'HostMask17-24': '00000000',
  });
  put({
    PK, SK: 'STATE#CATS#COUNTS',
    '1-8': [4, 4], '9-16': [], '17-24': [],
    TotalEnabled: 8, TotalRemaining: 8, Version: 1,
  });

  for (const [cid, name] of [['c001', 'Pricing'], ['c002', 'Packaging']]) {
    put({ PK: SETPK, SK: `CATEGORY#${cid}`, Name: name });
    put({ PK, SK: `CATEGORY#${cid}#ORDER`, QuestionOrder: ['001', '002', '003', '004'], IsRandom: false });
    put({ PK, SK: `CATEGORY#${cid}#ACTIVE`, ActiveIndex: 0, QuestionCount: 4 });
    for (const n of ['001', '002', '003', '004']) {
      put({ PK: SETPK, SK: `QUESTION#${cid}#${n}`, Category: name, Title: `${name} ${n}` });
    }
  }

  put({ PK, SK: 'QUEUE', Queue: ['c002#003'], Version: 1 });
  put({ PK, SK: 'EXCLUDED', Keys: ['c002#004'], Version: 1 });

  // Two people in the room, by name, who have answered.
  put({
    PK, SK: 'QUESTION#001#ANSWER#Ada',
    PlayerName: 'Ada', Answer: 'a private answer', SubmittedAt: '2026-08-27T10:00:00.000Z',
    IsCorrect: true, PointsEarned: 10,
  });
  put({
    PK, SK: 'QUESTION#001#ANSWER#Grace',
    PlayerName: 'Grace', Answer: 'another private answer', SubmittedAt: '2026-08-27T10:00:01.000Z',
    IsCorrect: false, PointsEarned: 0,
  });

  put({ PK, SK: 'CONNECTION#host-1', ConnectionId: 'host-1', ConnectionType: 'HOST' });
  put({ PK, SK: 'CONNECTION#player-1', ConnectionId: 'player-1', ConnectionType: 'PLAYER', PlayerName: 'Ada' });
}

/** No name from the room may appear in a refusal. */
const namesLeaked = (res) => /Ada|Grace/.test(String(res && res.body));

/** The four-digit space must not be turned into an existence oracle. */
const saysItExists = (res) =>
  /forbidden|not your|permission|organisation|organization/i.test(String(res && res.body));

const CLOSE_ROUND_ROUTE = 'POST /games/{gameId}/close-round';
const closeRound = (event) => getResults({
  ...event,
  routeKey: CLOSE_ROUND_ROUTE,
  pathParameters: { gameId: GAME },
  requestContext: { ...event.requestContext, routeKey: CLOSE_ROUND_ROUTE },
  body: JSON.stringify({ questionNumber: 1 }),
});

(async () => {
  console.log('1. POST /close-round is scoped to the owning organisation');

  seedGame();
  const foreignClose = await closeRound(host(ORG_B));

  // rejects: THE HOLE, on the route that matters most.
  check('a rival organisation is refused', () =>
    assert.strictEqual(foreignClose.statusCode, 404,
      `got ${foreignClose.statusCode}: ${foreignClose.body}`));

  check('...as "not found", never as "not yours"', () =>
    assert.ok(!saysItExists(foreignClose),
      `the body leaks that the session exists: ${foreignClose.body}`));

  /* The whole point. /reveal-authors was scoped and this route flips the same
     flag, so the anonymity break stayed reachable through a second door. */
  // rejects: closing one door on the reveal and leaving the other open.
  check('AuthorsRevealed is NOT flipped', () =>
    assert.strictEqual(at('ROUND#001').AuthorsRevealed, undefined,
      'the refused call still ended the round\'s anonymity'));

  check('the round is NOT resolved', () =>
    assert.strictEqual(at('STATE').State, 'ASK#001',
      `the refused call still moved the room to ${at('STATE').State}`));

  /* Awarding the scores is the other half of closing a round, and unlike the
     state move it is not one flag to put back: the score row carries
     `afterRound`, so a second close of the same round is skipped as already
     scored. A rival who closes round 1 does not merely move the room — they
     spend it. */
  check('no score is awarded', () =>
    assert.strictEqual(at('PLAYER#Ada#SCORE'), undefined,
      'the refused call still awarded the round\'s points'));

  check('no author name is returned', () =>
    assert.ok(!namesLeaked(foreignClose),
      `the refusal handed over the roster: ${foreignClose.body}`));

  check('the room is told nothing', () =>
    assert.strictEqual(sent.length, 0, `broadcast ${sent.length} frame(s) on a refused call`));

  seedGame();
  const ownClose = await closeRound(host(ORG_A));
  // rejects: closing the hole by breaking the feature.
  check('its own host still closes the round', () =>
    assert.strictEqual(ownClose.statusCode, 200, `got ${ownClose.statusCode}: ${ownClose.body}`));

  check('and the room moves to RESULTS', () =>
    assert.strictEqual(at('STATE').State, 'RESULTS#001'));

  console.log('\n2. the public read is NOT gated (the participant journey)');

  /*
    `POST /games/get-results` carries no authorizer and never can — PlayerPage
    calls it with a plain fetch the moment the room enters RESULTS. The guard
    must not reach it: a participant has no organisation, and gating them would
    end the journey the whole product is for.
  */
  seedGame({ state: 'RESULTS#001' });
  const publicRead = await getResults({
    version: '2.0',
    routeKey: 'POST /games/get-results',
    requestContext: {
      routeKey: 'POST /games/get-results',
      http: { method: 'POST', path: '/dev/games/get-results' },
    },
    body: JSON.stringify({ gameId: GAME, questionNumber: 1 }),
  });
  // rejects: gating a room full of people out of a session that is running.
  check('a participant still reads the resolved round', () =>
    assert.strictEqual(publicRead.statusCode, 200,
      `got ${publicRead.statusCode}: ${publicRead.body}`));

  console.log('\n3. GET /up-next is scoped (it enumerates unasked questions)');

  seedGame();
  const foreignPeek = await upNext({
    ...host(ORG_B, 'GET'), pathParameters: { gameId: GAME }, queryStringParameters: null,
  });
  // rejects: THE HOLE. On trivia, the next questions are most of the next answers.
  check('a rival organisation is refused', () =>
    assert.strictEqual(foreignPeek.statusCode, 404,
      `got ${foreignPeek.statusCode}: ${foreignPeek.body}`));

  check('...and is handed no question at all', () =>
    assert.ok(!/Pricing|Packaging/.test(foreignPeek.body),
      `the refusal still listed the running order: ${foreignPeek.body}`));

  const ownPeek = await upNext({
    ...host(ORG_A, 'GET'), pathParameters: { gameId: GAME }, queryStringParameters: null,
  });
  // rejects: closing the hole by breaking the feature.
  check('its own host still sees what is coming', () =>
    assert.strictEqual(ownPeek.statusCode, 200, `got ${ownPeek.statusCode}: ${ownPeek.body}`));

  console.log('\n4. POST /stage-focus is scoped (it spotlights one named person)');

  seedGame();
  const foreignFocus = await stageFocus({
    ...host(ORG_B), pathParameters: { gameId: GAME },
    body: JSON.stringify({ focus: 'answer', index: 0, questionNumber: 1 }),
  });
  // rejects: THE HOLE.
  check('a rival organisation is refused', () =>
    assert.strictEqual(foreignFocus.statusCode, 404,
      `got ${foreignFocus.statusCode}: ${foreignFocus.body}`));

  check('the focus is NOT written to the round record', () =>
    assert.strictEqual(at('ROUND#001').StageFocus, undefined,
      'the refused call still put somebody on the wall'));

  check('the room is told nothing', () =>
    assert.strictEqual(sent.length, 0, `broadcast ${sent.length} frame(s) on a refused call`));

  seedGame();
  const ownFocus = await stageFocus({
    ...host(ORG_A), pathParameters: { gameId: GAME },
    body: JSON.stringify({ focus: 'answer', index: 0, questionNumber: 1 }),
  });
  // rejects: closing the hole by breaking the feature.
  check('its own host still sets the focus', () =>
    assert.strictEqual(ownFocus.statusCode, 200, `got ${ownFocus.statusCode}: ${ownFocus.body}`));

  check('and it lands on the round record', () =>
    assert.strictEqual(at('ROUND#001').StageFocus, 'answer'));

  console.log('\n5. /queue is scoped on BOTH halves');

  seedGame();
  const foreignQueueRead = await questionQueue({
    ...host(ORG_B, 'GET'), pathParameters: { gameId: GAME },
  });
  // rejects: THE HOLE on the read — the queue names unasked questions.
  check('GET: a rival organisation is refused', () =>
    assert.strictEqual(foreignQueueRead.statusCode, 404,
      `got ${foreignQueueRead.statusCode}: ${foreignQueueRead.body}`));

  check('...and is handed no running order', () =>
    assert.ok(!/c002#003/.test(foreignQueueRead.body),
      `the refusal still listed the queue: ${foreignQueueRead.body}`));

  const foreignQueueWrite = await questionQueue({
    ...host(ORG_B), pathParameters: { gameId: GAME },
    body: JSON.stringify({ op: 'remove', questionKey: 'c002#003' }),
  });
  // rejects: THE HOLE on the write — this decides what the room is asked next.
  check('POST: a rival organisation is refused', () =>
    assert.strictEqual(foreignQueueWrite.statusCode, 404,
      `got ${foreignQueueWrite.statusCode}: ${foreignQueueWrite.body}`));

  check('the queue row is untouched', () =>
    assert.deepStrictEqual(at('QUEUE').Queue, ['c002#003'],
      'the refused call still reordered somebody else\'s session'));

  check('the room is told nothing', () =>
    assert.strictEqual(sent.length, 0, `broadcast ${sent.length} frame(s) on a refused call`));

  seedGame();
  const ownQueueRead = await questionQueue({
    ...host(ORG_A, 'GET'), pathParameters: { gameId: GAME },
  });
  // rejects: closing the hole by breaking the feature.
  check('its own host still reads the queue', () =>
    assert.strictEqual(ownQueueRead.statusCode, 200,
      `got ${ownQueueRead.statusCode}: ${ownQueueRead.body}`));

  const ownQueueWrite = await questionQueue({
    ...host(ORG_A), pathParameters: { gameId: GAME },
    body: JSON.stringify({ op: 'remove', questionKey: 'c002#003' }),
  });
  check('…and still changes it', () =>
    assert.strictEqual(ownQueueWrite.statusCode, 200,
      `got ${ownQueueWrite.statusCode}: ${ownQueueWrite.body}`));

  console.log('\n6. /exclusions is scoped on BOTH halves');

  seedGame();
  const foreignExclRead = await questionExclusions({
    ...host(ORG_B, 'GET'), pathParameters: { gameId: GAME },
  });
  // rejects: THE HOLE on the read — the veto list names unasked questions too.
  check('GET: a rival organisation is refused', () =>
    assert.strictEqual(foreignExclRead.statusCode, 404,
      `got ${foreignExclRead.statusCode}: ${foreignExclRead.body}`));

  check('...and is handed no veto list', () =>
    assert.ok(!/c002#004/.test(foreignExclRead.body),
      `the refusal still listed the exclusions: ${foreignExclRead.body}`));

  const foreignExclWrite = await questionExclusions({
    ...host(ORG_B), pathParameters: { gameId: GAME },
    body: JSON.stringify({ op: 'add', questionKey: 'c001#001' }),
  });
  // rejects: THE HOLE on the write.
  check('POST: a rival organisation is refused', () =>
    assert.strictEqual(foreignExclWrite.statusCode, 404,
      `got ${foreignExclWrite.statusCode}: ${foreignExclWrite.body}`));

  check('the exclusion row is untouched', () =>
    assert.deepStrictEqual(at('EXCLUDED').Keys, ['c002#004'],
      'the refused call still disabled a question in somebody else\'s session'));

  seedGame();
  const ownExclRead = await questionExclusions({
    ...host(ORG_A, 'GET'), pathParameters: { gameId: GAME },
  });
  // rejects: closing the hole by breaking the feature.
  check('its own host still reads the exclusions', () =>
    assert.strictEqual(ownExclRead.statusCode, 200,
      `got ${ownExclRead.statusCode}: ${ownExclRead.body}`));

  const ownExclWrite = await questionExclusions({
    ...host(ORG_A), pathParameters: { gameId: GAME },
    body: JSON.stringify({ op: 'add', questionKey: 'c001#001' }),
  });
  check('…and still disables one', () =>
    assert.strictEqual(ownExclWrite.statusCode, 200,
      `got ${ownExclWrite.statusCode}: ${ownExclWrite.body}`));

  console.log('\n7. POST /start-question is scoped (it moves the room into ASK)');

  seedGame();
  const foreignAsk = await startQuestion({
    ...host(ORG_B), pathParameters: { gameId: GAME },
    body: JSON.stringify({
      questionNumber: '002', questionRef: `${SETPK}/QUESTION#c001#002`,
      setId: SET, category: 'Pricing',
    }),
  });
  // rejects: THE HOLE.
  check('a rival organisation is refused', () =>
    assert.strictEqual(foreignAsk.statusCode, 404,
      `got ${foreignAsk.statusCode}: ${foreignAsk.body}`));

  check('the room is NOT moved', () =>
    assert.strictEqual(at('STATE').State, 'ASK#001',
      `the refused call still drove the room to ${at('STATE').State}`));

  check('no question pointer is written', () =>
    assert.strictEqual(at('QUESTION#002'), undefined,
      'the refused call still started a question in somebody else\'s session'));

  check('the room is told nothing', () =>
    assert.strictEqual(sent.length, 0, `broadcast ${sent.length} frame(s) on a refused call`));

  seedGame();
  const ownAsk = await startQuestion({
    ...host(ORG_A), pathParameters: { gameId: GAME },
    body: JSON.stringify({
      questionNumber: '002', questionRef: `${SETPK}/QUESTION#c001#002`,
      setId: SET, category: 'Pricing',
    }),
  });
  // rejects: closing the hole by breaking the feature.
  check('its own host still starts the question', () =>
    assert.strictEqual(ownAsk.statusCode, 200, `got ${ownAsk.statusCode}: ${ownAsk.body}`));

  check('and the pointer lands', () =>
    assert.ok(at('QUESTION#002'), 'the question was never started'));

  console.log('\n8. POST /start-vote is scoped (it answers WITH THE NAMES)');

  seedGame();
  const foreignVote = await startVote({
    ...host(ORG_B), pathParameters: { gameId: GAME },
    body: JSON.stringify({ questionNumber: 1 }),
  });
  // rejects: THE HOLE — and this one is the reveal by another route.
  check('a rival organisation is refused', () =>
    assert.strictEqual(foreignVote.statusCode, 404,
      `got ${foreignVote.statusCode}: ${foreignVote.body}`));

  /* HideAuthors is false on this session, so a successful call returns every
     participant's name against their answer — the disclosure /reveal-authors
     is gated for, reached without ever asking for the reveal. */
  check('no author name is returned', () =>
    assert.ok(!namesLeaked(foreignVote),
      `the refusal handed over the roster: ${foreignVote.body}`));

  check('the room is NOT moved into VOTE', () =>
    assert.strictEqual(at('STATE').State, 'ASK#001',
      `the refused call still drove the room to ${at('STATE').State}`));

  check('the room is told nothing', () =>
    assert.strictEqual(sent.length, 0, `broadcast ${sent.length} frame(s) on a refused call`));

  seedGame();
  const ownVote = await startVote({
    ...host(ORG_A), pathParameters: { gameId: GAME },
    body: JSON.stringify({ questionNumber: 1 }),
  });
  // rejects: closing the hole by breaking the feature.
  check('its own host still starts the vote', () =>
    assert.strictEqual(ownVote.statusCode, 200, `got ${ownVote.statusCode}: ${ownVote.body}`));

  check('and the room moves to VOTE', () =>
    assert.strictEqual(at('STATE').State, 'VOTE#001'));

  check('and the ballot still carries the names', () =>
    assert.ok(namesLeaked(ownVote), 'the owning host was not given the ballot'));

  console.log('\n9. what this deliberately does NOT refuse');

  /*
    A session with no orgId predates tenancy or was created by an orgless host.
    Refusing those would break running rooms to close a hole they are not part
    of — see tenant.callerMayDriveSession, which makes this choice once for
    every route rather than each route making it again.
  */
  // rejects: breaking every pre-tenancy room to close a new hole.
  seedGame({ orgId: '' });
  const orphanClose = await closeRound(host(ORG_B));
  check('close-round on an orgless session is left alone', () =>
    assert.strictEqual(orphanClose.statusCode, 200,
      `got ${orphanClose.statusCode}: ${orphanClose.body}`));

  seedGame({ orgId: '' });
  const orphanFocus = await stageFocus({
    ...host(ORG_B), pathParameters: { gameId: GAME },
    body: JSON.stringify({ focus: 'question', questionNumber: 1 }),
  });
  check('stage-focus on an orgless session is left alone', () =>
    assert.strictEqual(orphanFocus.statusCode, 200,
      `got ${orphanFocus.statusCode}: ${orphanFocus.body}`));

  seedGame({ orgId: '' });
  const orphanVote = await startVote({
    ...host(ORG_B), pathParameters: { gameId: GAME },
    body: JSON.stringify({ questionNumber: 1 }),
  });
  check('start-vote on an orgless session is left alone', () =>
    assert.strictEqual(orphanVote.statusCode, 200,
      `got ${orphanVote.statusCode}: ${orphanVote.body}`));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
