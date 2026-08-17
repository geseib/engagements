/**
 * THE STAGE FOCUS, SERVER-SIDE — `POST /games/{gameId}/stage-focus`.
 *
 * The owner asked that the phone remote be able to *"enlarge a question, a
 * specific response, etc."* on the ROOM's screen. Both of those are client-only
 * React state in GameHostPage (`lessonExpanded`, `spotlightIndex`), reachable
 * from elsewhere only by a `postMessage` that needs a window handle — so it
 * works only when the remote itself opened the projector, and is dead across
 * devices. Across devices is the entire point of scanning the QR.
 *
 * This is `stage-beat.js`'s sibling and the harness below is that suite's,
 * unchanged: a real UpdateCommand applier over a Map, a fake API Gateway
 * Management client that records frames and can refuse one with 410 Gone.
 *
 * A REAL UPDATE APPLIER MATTERS HERE. A stub returning `{}` would let a handler
 * that broadcasts the focus but never writes it pass every assertion — and a
 * focus that is only broadcast is lost on the next reload, which is one of the
 * three faults this whole mechanism exists to fix.
 *
 * The assertions are about the PERSISTED RECORD and the WIRE. The response body
 * is the one thing a host never sees.
 */
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

(async () => {
  console.log('\n1. enlarging one response persists it, indexed and round-addressed');
  seedGame('3001');
  const one = await post('3001', { focus: 'answer', index: 2, questionNumber: 1 });
  check('200', () => assert.strictEqual(one.statusCode, 200, `got ${one.statusCode}: ${one.body}`));
  check('the kind is stored', () => assert.strictEqual(roundOf('3001', '001').StageFocus, 'answer'));
  check('the index is stored', () => assert.strictEqual(roundOf('3001', '001').StageFocusIndex, 2));
  check('it lands on the ROUND record, not on STATE', () =>
    // PER ROUND, and the reason is sharper than the beat's: a focus is an index
    // INTO A ROUND'S ANSWERS. Stored per game, round 4 would open on "response
    // 2" meaning whatever is now second — a real answer, attributed to a real
    // person, that the host never chose.
    assert.strictEqual(store.get(key('GAME#3001', 'STATE')).StageFocus, undefined));

  console.log('\n2. the room is told, with its own message type');
  check('every connection got a frame', () =>
    assert.deepStrictEqual(sent.map((s) => s.connectionId).sort(), ['host-1', 'player-1']));
  check('the type is stageFocusChanged', () =>
    // NOT gameStateChanged: that type makes GameHostPage call restoreGameState,
    // which rewrites currentQuestionId and throws the beat away. Same trap
    // stage-beat.js documents.
    assert.strictEqual(sent[0].message.type, 'stageFocusChanged'));
  check('the frame carries the round', () =>
    // Without this the receiver cannot tell a live frame from a late one.
    assert.strictEqual(sent[0].message.questionNumber, '001'));
  check('the frame carries kind and index', () => {
    assert.strictEqual(sent[0].message.focus, 'answer');
    assert.strictEqual(sent[0].message.index, 2);
  });

  console.log('\n3. index 0 is a real index, not a missing one');
  seedGame('3002');
  const zero = await post('3002', { focus: 'answer', index: 0, questionNumber: 1 });
  check('200', () => assert.strictEqual(zero.statusCode, 200, `got ${zero.statusCode}: ${zero.body}`));
  check('0 is persisted as 0', () =>
    // The FIRST response is the one a host is most likely to enlarge, and every
    // truthiness check in the chain erases exactly this case.
    assert.strictEqual(roundOf('3002', '001').StageFocusIndex, 0));
  check('0 is on the wire as 0', () => assert.strictEqual(sent[0].message.index, 0));

  console.log('\n4. an answer focus with no index is refused, never defaulted');
  seedGame('3003');
  const noIndex = await post('3003', { focus: 'answer', questionNumber: 1 });
  check('400', () =>
    // Defaulting to 0 would put a specific person's response on a wall because
    // a client forgot a field.
    assert.strictEqual(noIndex.statusCode, 400, `got ${noIndex.statusCode}: ${noIndex.body}`));
  check('nothing was written', () => assert.strictEqual(roundOf('3003', '001'), undefined));
  check('nothing was broadcast', () => assert.strictEqual(sent.length, 0));

  for (const bad of [-1, 1.5, 'two', null]) {
    seedGame('3003');
    const res = await post('3003', { focus: 'answer', index: bad, questionNumber: 1 });
    check(`index ${JSON.stringify(bad)} is refused`, () =>
      assert.strictEqual(res.statusCode, 400, `got ${res.statusCode}: ${res.body}`));
  }

  console.log('\n5. the question focus carries no index');
  seedGame('3004');
  const q = await post('3004', { focus: 'question', index: 7, questionNumber: 1 });
  check('200', () => assert.strictEqual(q.statusCode, 200, `got ${q.statusCode}: ${q.body}`));
  check('the kind is question', () => assert.strictEqual(roundOf('3004', '001').StageFocus, 'question'));
  check('a stray index is discarded, not stored', () =>
    // A number sitting beside a non-answer focus is a trap for the next reader.
    assert.strictEqual(roundOf('3004', '001').StageFocusIndex, null));

  console.log('\n6. closing travels — "none" is a value, not an absence');
  seedGame('3005');
  await post('3005', { focus: 'answer', index: 1, questionNumber: 1 });
  sent = [];
  const closed = await post('3005', { focus: 'none', questionNumber: 1 });
  check('200', () => assert.strictEqual(closed.statusCode, 200, `got ${closed.statusCode}: ${closed.body}`));
  check('the record says none rather than losing the attribute', () =>
    // Deleting it would make "the host closed it" and "nobody opened one this
    // round" the same state on the wire, and the phone could not draw a close
    // button that reflects reality.
    assert.strictEqual(roundOf('3005', '001').StageFocus, 'none'));
  check('the index is cleared with it', () =>
    assert.strictEqual(roundOf('3005', '001').StageFocusIndex, null));
  check('the close is announced', () => assert.strictEqual(sent[0].message.focus, 'none'));

  console.log('\n7. a closed enum, refused out loud');
  seedGame('3006');
  const zoom = await post('3006', { focus: 'zoom', questionNumber: 1 });
  check('an unknown kind is a 400', () =>
    // An open enum's worst failure is that everything succeeds: the write
    // lands, the frame goes out, every client compares against three strings,
    // and the host watches a button do nothing with no error anywhere.
    assert.strictEqual(zoom.statusCode, 400, `got ${zoom.statusCode}`));
  check('nothing was written', () => assert.strictEqual(roundOf('3006', '001'), undefined));

  console.log('\n8. a non-numeric round is refused rather than padded');
  seedGame('3007');
  for (const qn of ['', 'abc', null, undefined, '1a']) {
    const res = await post('3007', { focus: 'question', questionNumber: qn });
    check(`questionNumber ${JSON.stringify(qn)} is a 400`, () =>
      // '' passes a bare presence check and pads to '000'; anything else writes
      // a ROUND#<junk> row nothing will ever read again.
      assert.strictEqual(res.statusCode, 400, `got ${res.statusCode}: ${res.body}`));
  }
  check('no junk round rows exist', () =>
    assert.strictEqual([...store.keys()].filter((k) => k.includes('ROUND#')).length, 0));

  console.log('\n9. the write is an UPDATE, so it cannot un-reveal or un-beat a round');
  seedGame('3008');
  put({
    PK: 'GAME#3008', SK: 'ROUND#001',
    AuthorsRevealed: true, StageBeat: 'field-notes', QuestionNumber: '001',
  });
  await post('3008', { focus: 'answer', index: 0, questionNumber: 1 });
  check('AuthorsRevealed survives', () =>
    // A PUT here would put every attributed answer on the stage back in the box
    // the moment the host enlarged one of them.
    assert.strictEqual(roundOf('3008', '001').AuthorsRevealed, true));
  check('StageBeat survives', () =>
    // …and would throw the room back from the read-back to the tally.
    assert.strictEqual(roundOf('3008', '001').StageBeat, 'field-notes'));

  console.log('\n10. get-game-state reads it back for the polling phone');
  seedGame('3009');
  await post('3009', { focus: 'answer', index: 3, questionNumber: 1 });
  const withFocus = await readState('3009');
  check('the state carries the focus', () =>
    // The remote holds no WebSocket (HostRemote.jsx explains why), so this
    // field is the ONLY way a spotlight opened on the projector reaches it.
    assert.deepStrictEqual(withFocus.stageFocus, { focus: 'answer', index: 3 }));

  seedGame('3010');
  const noFocus = await readState('3010');
  check('a round nobody has focused reads as none, not undefined', () =>
    // A client inventing its own default is how two surfaces come to disagree.
    assert.deepStrictEqual(noFocus.stageFocus, { focus: 'none', index: null }));

  console.log('\n11. a stored kind this build does not know resolves to none');
  seedGame('3011');
  put({ PK: 'GAME#3011', SK: 'ROUND#001', StageFocus: 'hologram', StageFocusIndex: 2 });
  const unknown = await readState('3011');
  check('an unknown stored kind is not passed on', () =>
    // A value from another deploy must stop here rather than travelling to a
    // client that will compare it against three strings and silently do nothing.
    assert.deepStrictEqual(unknown.stageFocus, { focus: 'none', index: null }));

  seedGame('3012');
  put({ PK: 'GAME#3012', SK: 'ROUND#001', StageFocus: 'answer', StageFocusIndex: 'two' });
  const badIndex = await readState('3012');
  check('a stored non-integer index is not passed on', () =>
    assert.deepStrictEqual(badIndex.stageFocus, { focus: 'none', index: null }));

  seedGame('3013');
  put({ PK: 'GAME#3013', SK: 'ROUND#001', StageFocus: 'answer', StageFocusIndex: 0 });
  const zeroBack = await readState('3013');
  check('a stored index of 0 IS passed on', () =>
    // The read-back half of the same truthiness trap as case 3.
    assert.deepStrictEqual(zeroBack.stageFocus, { focus: 'answer', index: 0 }));

  console.log('\n12. a dead socket does not cost the focus');
  seedGame('3014');
  goneConnections = new Set(['host-1']);
  const withDead = await post('3014', { focus: 'question', questionNumber: 1 });
  check('410 Gone: still 200', () =>
    assert.strictEqual(withDead.statusCode, 200, `got ${withDead.statusCode}: ${withDead.body}`));
  check('410 Gone: the focus still persisted', () =>
    assert.strictEqual(roundOf('3014', '001').StageFocus, 'question'));
  check('410 Gone: the live connection still heard it', () =>
    assert.deepStrictEqual(sent.map((s) => s.connectionId), ['player-1']));
  check('410 Gone: the dead row is reaped', () =>
    // Needs DeleteItem, which SAM's DynamoDBWritePolicy does NOT grant — hence
    // DynamoDBCrudPolicy on this function in template-clean.yaml.
    assert.strictEqual(store.get(key('GAME#3014', 'CONNECTION#host-1')), undefined,
      'stale connection row survived; it would be retried on every future broadcast'));

  console.log('\n13. a room with nobody connected still records the focus');
  seedGame('3015');
  store.delete(key('GAME#3015', 'CONNECTION#host-1'));
  store.delete(key('GAME#3015', 'CONNECTION#player-1'));
  const nobody = await post('3015', { focus: 'answer', index: 1, questionNumber: 1 });
  check('no connections: still 200', () =>
    assert.strictEqual(nobody.statusCode, 200, `got ${nobody.statusCode}`));
  check('no connections: focus still persisted', () =>
    assert.strictEqual(roundOf('3015', '001').StageFocus, 'answer'));
  check('no connections: nothing sent', () => assert.strictEqual(sent.length, 0));

  console.log('\n14. a double-tap is a no-op that still answers 200');
  seedGame('3016');
  await post('3016', { focus: 'answer', index: 1, questionNumber: 1 });
  const again = await post('3016', { focus: 'answer', index: 1, questionNumber: 1 });
  check('the second tap is 200', () =>
    // The host is in front of a room; a double-tap must not be something they
    // have to understand.
    assert.strictEqual(again.statusCode, 200, `got ${again.statusCode}`));
  check('the record is unchanged', () => {
    assert.strictEqual(roundOf('3016', '001').StageFocus, 'answer');
    assert.strictEqual(roundOf('3016', '001').StageFocusIndex, 1);
  });

  console.log('\n15. a body that is not JSON, and a missing gameId');
  seedGame('3017');
  const junk = await stageFocus({
    requestContext: { http: { method: 'POST' } },
    pathParameters: { gameId: '3017' },
    body: 'not json',
  });
  check('a non-JSON body is a 400, not a throw', () =>
    assert.strictEqual(junk.statusCode, 400, `got ${junk.statusCode}`));

  const noGame = await stageFocus({
    requestContext: { http: { method: 'POST' } },
    pathParameters: {},
    body: JSON.stringify({ focus: 'question', questionNumber: 1 }),
  });
  check('a missing gameId is a 400', () =>
    assert.strictEqual(noGame.statusCode, 400, `got ${noGame.statusCode}`));

  const preflight = await stageFocus({
    requestContext: { http: { method: 'OPTIONS' } },
    pathParameters: { gameId: '3017' },
  });
  check('OPTIONS is answered', () => assert.strictEqual(preflight.statusCode, 200));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
})();
