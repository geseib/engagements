/**
 * The RESULTS beat, server-side and bidirectional.
 *
 * RESULTS is two beats — the tally, then "What We Heard". Until now which beat
 * was on screen was CLIENT-ONLY React state in GameHostPage (`resultsBeat`),
 * which meant three things:
 *
 *   - the phone remote could not drive it, and did not even offer it: the
 *     remote's RESULTS action went straight to "Next Round" and skipped the AI
 *     beat entirely (config/hostRemote.js);
 *   - the stage could not tell the phone it had moved;
 *   - a host page reload landed back on the tally with the room still reading
 *     the discussion prompt.
 *
 * So the beat becomes a durable fact on the ROUND# record, written by
 * `POST /games/{gameId}/stage-beat` and announced as `stageBeatChanged`, and
 * read back by `get-game-state` so BOTH surfaces poll/subscribe to one source
 * of truth. This file runs both real handlers against a stubbed DynamoDB and a
 * stubbed API Gateway Management API.
 *
 * The assertions are deliberately about the PERSISTED record and the WIRE, not
 * the response body — the response body is the one thing a host never sees.
 */
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

/**
 * A real UpdateCommand applier, not a `return {}` stub.
 *
 * A stub that returns an empty object would let a handler which broadcasts the
 * beat but never writes it pass every assertion in this file — and that is
 * precisely the defect being fixed, since a beat that is only broadcast is lost
 * on the next reload.
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

const { handler: stageBeat } = require(path.join(REPO, 'lambda-functions/game/stage-beat.js'));
const { handler: getState } = require(path.join(REPO, 'lambda-functions/game/get-game-state.js'));

// ---- Tiny harness ----------------------------------------------------------
let pass = 0, fail = 0;
function check(label, fn) {
  try { fn(); console.log(`  PASS  ${label}`); pass++; }
  catch (e) { console.log(`  FAIL  ${label}\n        ${e.message}`); fail++; }
}

const put = (item) => store.set(key(item.PK, item.SK), item);
const roundOf = (gameId, padded) => store.get(key(`GAME#${gameId}`, `ROUND#${padded}`));

/** One game showing round 1's results, with a host and a player attached. */
function seedGame(gameId, { lessonNumber = 1, gameType = 'call-and-answer' } = {}) {
  store.clear();
  sent = [];
  goneConnections = new Set();

  put({ PK: `GAME#${gameId}`, SK: 'METADATA', GameType: gameType, Title: 'Test session' });
  put({
    PK: `GAME#${gameId}`, SK: 'STATE',
    State: `RESULTS#${String(lessonNumber).padStart(3, '0')}`,
    LessonNumber: lessonNumber, CurrentQuestionId: 'QUESTION#1#001',
  });
  put({ PK: `GAME#${gameId}`, SK: 'CONNECTION#host-1', ConnectionId: 'host-1', ConnectionType: 'HOST' });
  put({ PK: `GAME#${gameId}`, SK: 'CONNECTION#player-1', ConnectionId: 'player-1', ConnectionType: 'PLAYER', PlayerName: 'Ada' });
}

const post = (gameId, body) => stageBeat({
  requestContext: { http: { method: 'POST' } },
  pathParameters: { gameId },
  body: JSON.stringify(body),
});

const readState = async (gameId) => {
  const res = await getState({
    requestContext: { http: { method: 'GET' } },
    pathParameters: { gameId },
  });
  return { statusCode: res.statusCode, payload: JSON.parse(res.body) };
};

(async () => {
  // ---------- 1. the write ----------
  console.log('\n1. POST /stage-beat persists the beat on the ROUND# record');
  seedGame('2001');
  // The round is already resolved, so get-results has already revealed it.
  put({ PK: 'GAME#2001', SK: 'ROUND#001', QuestionNumber: '001', AuthorsRevealed: true });
  const moved = await post('2001', { beat: 'field-notes', questionNumber: 1 });

  check('responds 200', () =>
    assert.strictEqual(moved.statusCode, 200, `got ${moved.statusCode}: ${moved.body}`));

  check('writes StageBeat onto ROUND#001', () => {
    // Broadcast-only would make the projector follow ONCE and lose the beat on
    // the next reload or re-sync, which is the client-only behaviour being
    // replaced. The durable fact is the point.
    const round = roundOf('2001', '001');
    assert.ok(round, 'no ROUND#001 record was written at all');
    assert.strictEqual(round.StageBeat, 'field-notes', `StageBeat is '${round.StageBeat}'`);
  });

  check('leaves AuthorsRevealed alone', () => {
    // The beat and the anonymity reveal live on the SAME item. A handler that
    // PUT the record rather than UPDATE-ing it would silently un-reveal a round
    // get-results had already revealed — every attributed answer on the stage
    // would go back in the box the moment the host asked for the AI read-back.
    assert.strictEqual(roundOf('2001', '001').AuthorsRevealed, true,
      'the reveal was clobbered — this must be an UpdateCommand, not a Put');
  });

  // ---------- 2. the wire ----------
  console.log('\n2. it announces the beat to the whole room');
  check('announced to BOTH connections, host included', () => {
    // The host connection is the projector. If it is not told, tapping "What We
    // Heard" on the phone changes a database row and nothing else — which is
    // the entire point of the endpoint.
    const ids = sent.map((s) => s.connectionId).sort();
    assert.deepStrictEqual(ids, ['host-1', 'player-1'], `announced to [${ids}]`);
  });

  check('frame is a stageBeatChanged carrying the beat and the round', () => {
    const frame = sent[0].message;
    assert.strictEqual(frame.type, 'stageBeatChanged', `type was '${frame.type}'`);
    assert.strictEqual(frame.beat, 'field-notes', `beat was '${frame.beat}'`);
    assert.strictEqual(frame.gameId, '2001');
    assert.strictEqual(frame.questionNumber, '001', `questionNumber was '${frame.questionNumber}'`);
  });

  check('does NOT reuse gameStateChanged', () => {
    // gameStateChanged makes GameHostPage call restoreGameState, and restoring
    // rewrites currentQuestionId — the exact dependency that re-fires the
    // resultsBeat reset effect (GameHostPage.jsx:313) and threw the beat away.
    // A distinct type is what lets the host set the beat WITHOUT a re-sync.
    assert.ok(!sent.some((s) => s.message.type === 'gameStateChanged'),
      'a gameStateChanged frame would knock the stage back to the tally');
  });

  // ---------- 3. the read back ----------
  console.log('\n3. get-game-state hands the beat to whoever polls');
  const afterMove = await readState('2001');
  check('state payload carries stageBeat', () => {
    // The remote holds no socket — it polls /state every 2s. Without this field
    // a beat pushed from the stage never reaches the phone.
    assert.strictEqual(afterMove.payload.stageBeat, 'field-notes',
      `stageBeat was '${afterMove.payload.stageBeat}'`);
  });

  console.log('\n4. a round that has never been moved reads as the tally beat');
  seedGame('2002');
  const fresh = await readState('2002');
  check('defaults to "results" with no ROUND# record', () =>
    assert.strictEqual(fresh.payload.stageBeat, 'results',
      `stageBeat was '${fresh.payload.stageBeat}'`));

  console.log('\n5. the beat is PER ROUND, not per game');
  seedGame('2003');
  await post('2003', { beat: 'field-notes', questionNumber: 1 });
  // The host advances: LessonNumber moves to 2, and round 2 has its own record.
  put({
    PK: 'GAME#2003', SK: 'STATE',
    State: 'RESULTS#002', LessonNumber: 2, CurrentQuestionId: 'QUESTION#1#002',
  });
  const roundTwo = await readState('2003');
  check('round 2 opens on the tally even though round 1 ended on field notes', () =>
    // Storing the beat on the STATE record instead would open every subsequent
    // round's results already showing the previous round's discussion prompt.
    assert.strictEqual(roundTwo.payload.stageBeat, 'results',
      `stageBeat was '${roundTwo.payload.stageBeat}'`));
  check('round 1 still says field-notes', () =>
    assert.strictEqual(roundOf('2003', '001').StageBeat, 'field-notes'));

  // ---------- 6. going back ----------
  console.log('\n6. the beat moves both ways');
  seedGame('2004');
  await post('2004', { beat: 'field-notes', questionNumber: 1 });
  sent = [];
  const back = await post('2004', { beat: 'results', questionNumber: 1 });
  check('back to results responds 200', () =>
    assert.strictEqual(back.statusCode, 200, `got ${back.statusCode}: ${back.body}`));
  check('back to results rewrites the record', () =>
    // The stage's own control is a two-way toggle (‹ Results / Next Round in
    // 09-field-notes.html). One-way would strand the room on the prompt.
    assert.strictEqual(roundOf('2004', '001').StageBeat, 'results'));
  check('back to results is announced too', () =>
    assert.strictEqual(sent[0]?.message.beat, 'results'));

  // ---------- 7. input the SK cannot survive ----------
  console.log('\n7. it refuses input that would corrupt the partition');
  for (const bad of [undefined, null, '', '   ', 'one', '1.5', '-1', {}]) {
    seedGame('2005');
    const res = await post('2005', { beat: 'field-notes', questionNumber: bad });
    check(`questionNumber ${JSON.stringify(bad)} → 400`, () =>
      // `''` used to pass a bare presence check and pad to '000'; anything else
      // writes a ROUND#<junk> item nothing will ever read again. Same guard
      // reveal-authors.js carries, for the same reason.
      assert.strictEqual(res.statusCode, 400, `got ${res.statusCode}`));
    check(`questionNumber ${JSON.stringify(bad)} writes nothing`, () =>
      assert.strictEqual([...store.keys()].filter((k) => k.includes('ROUND#')).length, 0,
        'a junk ROUND# item was written'));
  }

  console.log('\n8. it refuses a beat it does not know');
  for (const bad of [undefined, null, '', 'FIELD-NOTES', 'fieldnotes', 'tally', 42]) {
    seedGame('2006');
    const res = await post('2006', { beat: bad, questionNumber: 1 });
    check(`beat ${JSON.stringify(bad)} → 400`, () =>
      // An open enum is the worst outcome here: the write succeeds, the frame
      // goes out, every client compares it against 'field-notes', and the host
      // watches a button do nothing with no error anywhere.
      assert.strictEqual(res.statusCode, 400, `got ${res.statusCode}`));
    check(`beat ${JSON.stringify(bad)} writes nothing`, () =>
      assert.strictEqual(roundOf('2006', '001'), undefined, 'the bad beat was persisted'));
  }

  console.log('\n9. a missing game id is a 400, not a crash');
  seedGame('2007');
  const noGame = await stageBeat({ pathParameters: {}, body: JSON.stringify({ beat: 'results', questionNumber: 1 }) });
  check('no gameId → 400', () => assert.strictEqual(noGame.statusCode, 400));

  // ---------- 10. resilience ----------
  console.log('\n10. a dead projector must not fail the host\'s tap');
  seedGame('2008');
  goneConnections = new Set(['host-1']);
  const withDead = await post('2008', { beat: 'field-notes', questionNumber: 1 });

  check('410 Gone still returns 200', () =>
    // The write succeeded. Reporting a failure here would train the host to tap
    // again, and the second tap is the one that looks broken.
    assert.strictEqual(withDead.statusCode, 200, `got ${withDead.statusCode}: ${withDead.body}`));
  check('410 Gone still persists the beat', () =>
    assert.strictEqual(roundOf('2008', '001').StageBeat, 'field-notes'));
  check('410 Gone still reaches the live connection', () =>
    assert.deepStrictEqual(sent.map((s) => s.connectionId), ['player-1']));
  check('410 Gone reaps the dead connection row', () =>
    assert.strictEqual(store.get(key('GAME#2008', 'CONNECTION#host-1')), undefined,
      'stale connection row survived; it would be retried on every future broadcast'));

  console.log('\n11. a room with nobody connected still records the beat');
  seedGame('2009');
  store.delete(key('GAME#2009', 'CONNECTION#host-1'));
  store.delete(key('GAME#2009', 'CONNECTION#player-1'));
  const noConns = await post('2009', { beat: 'field-notes', questionNumber: 1 });
  check('no connections: still 200', () =>
    assert.strictEqual(noConns.statusCode, 200, `got ${noConns.statusCode}`));
  check('no connections: beat still persisted', () =>
    // Whoever reconnects reads the right beat back, with no live socket needed
    // at the moment it happened.
    assert.strictEqual(roundOf('2009', '001').StageBeat, 'field-notes'));
  check('no connections: nothing sent', () => assert.strictEqual(sent.length, 0));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
})();
