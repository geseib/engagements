/**
 * `GET`/`POST /games/{gameId}/queue`, end to end against a DynamoDB fake that
 * really evaluates ConditionExpressions.
 *
 * The race — two surfaces editing the queue at the same instant — has its own
 * file, `question-queue-race.js`, because it needs the latch and because it is
 * the one property a plausible-looking implementation gets wrong. This file
 * covers everything else, and three of its sections exist because of specific
 * ways this could ship broken and look fine:
 *
 *   §3 THE TTL. A queue built a week before the session must still be there on
 *      the day. `QUESTION#<nnn>#REF` uses 24 hours, and copying that number
 *      here would delete the host's running order overnight — a failure that
 *      reads as "the feature never worked", not as an expiry. The constant is
 *      pinned against the one `schema-compliant-manager.js` actually exports,
 *      because the game handler cannot import across Lambda package roots and
 *      an unpinned copy is a number that drifts in silence.
 *
 *   §4 THE WIRE. `questionQueueChanged` and never `gameStateChanged` — the trap
 *      stage-beat.js:40-43 documents: gameStateChanged makes GameHostPage call
 *      restoreGameState, which rewrites currentQuestionId and throws round-local
 *      state away. Reordering a queue must not re-sync the room.
 *
 *   §6 THE NO-OP. A press that cannot do anything must cost zero writes and
 *      still say WHY. An implementation that writes anyway bumps the version on
 *      every duplicate tap, which invalidates every other surface's
 *      expectedVersion for no reason at all.
 */
const path = require('path');
const assert = require('assert');

const REPO = path.join(__dirname, '..');
const { createTable, installStubs } = require('./helpers/player-table');

const table = createTable();
const store = table.store;
const sent = [];
const frames = [];
const gone = new Set();

installStubs({ table, sent, frames, gone });

process.env.TABLE_NAME = 'test-table';
process.env.WEBSOCKET_API_ENDPOINT = 'https://ws.test.invalid/dev';

const queueHandler = require(path.join(REPO, 'lambda-functions/game/question-queue.js'));
const { handler: getState } = require(path.join(REPO, 'lambda-functions/game/get-game-state.js'));
// Required for its CONSTANT only, and only a test may do this — see the note in
// question-queue.js on why the handler carries its own copy.
const schema = require(path.join(REPO, 'lambda-functions/websocket/schema-compliant-manager.js'));

/* ---- Harness -------------------------------------------------------------- */

let pass = 0, fail = 0;
async function check(label, fn) {
  try { await fn(); console.log(`  PASS  ${label}`); pass++; }
  catch (e) { console.log(`  FAIL  ${label}\n        ${e.message}`); fail++; }
}

const GAME = '7310';
const SET = 'set-alpha';
const PK = `GAME#${GAME}`;

const put = (item) => { store.set(table.keyOf(item.PK, item.SK), item); };
const queueRow = () => store.get(table.keyOf(PK, 'QUEUE'));

function seed({ setVersion = 3, connections = ['host-1', 'player-1'] } = {}) {
  store.clear();
  sent.length = 0;
  frames.length = 0;
  gone.clear();

  put({ PK, SK: 'METADATA', QuestionSetId: SET, QuestionSetVersion: setVersion });
  put({ PK, SK: 'STATE', State: 'RESULTS#001', LessonNumber: 1 });
  // The SETS metadata row the resolver reads. Recorded as the writer writes it
  // so the resolution really is the product's 1-2-3, not a fixture shortcut.
  put({
    PK: 'SETS', SK: `SET#${SET}`,
    activeVersion: 4, versions: [{ version: 3 }, { version: 4 }],
  });

  for (const id of connections) {
    put({
      PK, SK: `CONNECTION#${id}`, ConnectionId: id,
      ConnectionType: id.startsWith('host') ? 'HOST' : 'PLAYER',
    });
  }
}

const post = (body, gameId = GAME) => queueHandler.handler({
  requestContext: { http: { method: 'POST' } },
  pathParameters: { gameId },
  body: JSON.stringify(body),
});

const get = (gameId = GAME) => queueHandler.handler({
  requestContext: { http: { method: 'GET' } },
  pathParameters: { gameId },
});

const readState = async () => {
  const res = await getState({
    requestContext: { http: { method: 'GET' } },
    pathParameters: { gameId: GAME },
    queryStringParameters: { includeHostData: 'true' },
  });
  return JSON.parse(res.body);
};

const bodyOf = (res) => JSON.parse(res.body);

/* ========================================================================== */

(async () => {
  console.log('\n1. reading a queue nobody has built yet');

  seed();
  const empty = await get();
  await check('a game with no QUEUE row answers 200, not 404', () =>
    assert.strictEqual(empty.statusCode, 200, `got ${empty.statusCode}: ${empty.body}`));
  await check('it reads as an empty queue at version 0', () => {
    // The panel must render before the host has pressed anything. An absent
    // field would make every surface distinguish "no queue yet" from "queue of
    // none", and one of them would get it wrong on first render.
    const payload = bodyOf(empty);
    assert.deepStrictEqual(payload.queue, []);
    assert.strictEqual(payload.version, 0);
  });

  console.log('\n2. the write');

  seed();
  const added = await post({ op: 'add', questionKey: 'QUESTION#c001#017' });
  await check('add responds 200', () =>
    assert.strictEqual(added.statusCode, 200, `got ${added.statusCode}: ${added.body}`));
  await check('the key is stored canonically, prefix stripped', () =>
    assert.deepStrictEqual(queueRow().Queue, ['c001#017'],
      `stored ${JSON.stringify(queueRow() && queueRow().Queue)}`));
  await check('the first write lands at version 1', () =>
    assert.strictEqual(queueRow().Version, 1));
  await check('the row records which SET and VERSION it was built against', () => {
    // next-question.js refuses to serve from a queue whose set has been
    // replaced underneath it. Without these two attributes it cannot tell.
    assert.strictEqual(queueRow().SetId, SET);
    assert.strictEqual(queueRow().SetVersion, 3, 'the game PIN wins over activeVersion');
  });
  await check('UpdatedAt is written', () =>
    assert.ok(queueRow().UpdatedAt, 'no UpdatedAt on the queue row'));

  await post({ op: 'add', questionKey: 'c001#018' });
  await post({ op: 'add', questionKey: 'c002#001' });
  await check('adds append in press order', () =>
    assert.deepStrictEqual(queueRow().Queue, ['c001#017', 'c001#018', 'c002#001']));
  await check('each change bumps the version by exactly one', () =>
    assert.strictEqual(queueRow().Version, 3));

  const moved = await post({ op: 'earlier', questionKey: 'c002#001' });
  await check('a move is persisted as a neighbour swap', () =>
    assert.deepStrictEqual(bodyOf(moved).queue, ['c001#017', 'c002#001', 'c001#018']));
  const removed = await post({ op: 'remove', questionKey: 'c001#017' });
  await check('a remove is persisted', () =>
    assert.deepStrictEqual(bodyOf(removed).queue, ['c002#001', 'c001#018']));

  console.log('\n3. the TTL — 90 days, and pinned to the constant that means it');

  await check('the handler\'s TTL is schema-compliant-manager\'s TTL_CREATION_PHASE', () =>
    // The handler cannot require that module: a Lambda package is rooted at its
    // CodeUri, so `require('../websocket/…')` resolves in this repo and throws
    // MODULE_NOT_FOUND once deployed. This assertion IS the import, in the only
    // form that survives packaging.
    assert.strictEqual(queueHandler.TTL_CREATION_PHASE, schema.TTL_CREATION_PHASE,
      'the copied TTL has drifted from the constant it copies'));

  await check('TTL_CREATION_PHASE really is 90 days', () =>
    assert.strictEqual(schema.TTL_CREATION_PHASE, 90 * 24 * 60 * 60));

  await check('the stored ttl is ~90 days out, NOT the 24h a round reference gets', () => {
    const seconds = queueRow().ttl - Math.floor(Date.now() / 1000);
    // A queue is built before the session, sometimes days before. 24 hours —
    // the number `QUESTION#<nnn>#REF` uses, and the easiest one to copy from
    // next-question.js — would delete the running order overnight.
    assert.ok(seconds > 89 * 24 * 60 * 60, `ttl is only ${Math.round(seconds / 3600)}h away`);
    assert.ok(seconds <= 90 * 24 * 60 * 60 + 5, `ttl is ${Math.round(seconds / 3600)}h away`);
  });

  console.log('\n4. the wire');

  seed();
  const announced = await post({ op: 'add', questionKey: 'c001#017' });

  await check('every connection is told, host included', () => {
    // The stage is the host connection. If it is not told, queueing on the
    // phone changes a row and nothing else, which is the whole point of the
    // endpoint.
    const ids = frames.map((f) => f.connectionId).sort();
    assert.deepStrictEqual(ids, ['host-1', 'player-1'], `announced to [${ids}]`);
  });

  await check('the frame is questionQueueChanged with the version and the list', () => {
    const frame = frames[0].message;
    assert.strictEqual(frame.type, 'questionQueueChanged', `type was '${frame.type}'`);
    assert.strictEqual(frame.gameId, GAME);
    assert.strictEqual(frame.version, 1, `version was ${frame.version}`);
    assert.deepStrictEqual(frame.queue, ['c001#017']);
  });

  await check('it NEVER reuses gameStateChanged', () =>
    // gameStateChanged makes GameHostPage call restoreGameState, which rewrites
    // currentQuestionId and takes every dependent piece of round state with it.
    // Reordering a queue must not re-sync the room. See stage-beat.js:40-43.
    assert.ok(!sent.some((m) => m.type === 'gameStateChanged'),
      'a gameStateChanged frame would knock the stage back through a full re-sync'));

  await check('the response carries the new version for the next expectedVersion', () =>
    assert.strictEqual(bodyOf(announced).version, 1));

  console.log('\n5. a dead projector must not fail the host\'s press');

  seed();
  gone.add('host-1');
  const withDead = await post({ op: 'add', questionKey: 'c001#017' });

  await check('410 Gone still returns 200', () =>
    assert.strictEqual(withDead.statusCode, 200, `got ${withDead.statusCode}: ${withDead.body}`));
  await check('410 Gone still persists the queue', () =>
    assert.deepStrictEqual(queueRow().Queue, ['c001#017']));
  await check('410 Gone still reaches the live connection', () =>
    assert.deepStrictEqual(frames.map((f) => f.connectionId), ['player-1']));
  await check('410 Gone REAPS the dead connection row', () =>
    // This delete is why the SAM policy is DynamoDBCrudPolicy and not
    // Read+Write: DynamoDBWritePolicy has no DeleteItem, and the AccessDenied
    // would land inside a catch that deliberately never throws. Nothing would
    // surface; the row would just be retried on every broadcast forever.
    assert.strictEqual(store.get(table.keyOf(PK, 'CONNECTION#host-1')), undefined,
      'the stale connection row survived'));

  console.log('\n6. a press that cannot do anything costs nothing, and says why');

  seed();
  await post({ op: 'add', questionKey: 'c001#017' });
  sent.length = 0;
  frames.length = 0;
  const duplicate = await post({ op: 'add', questionKey: 'QUESTION#c001#017' });

  await check('a duplicate answers 200 with refused:duplicate', () => {
    assert.strictEqual(duplicate.statusCode, 200);
    assert.strictEqual(bodyOf(duplicate).changed, false);
    assert.strictEqual(bodyOf(duplicate).refused, 'duplicate');
  });
  await check('a duplicate does NOT bump the version', () =>
    // Writing anyway would invalidate every other surface's expectedVersion on
    // every double-tap, for nothing.
    assert.strictEqual(queueRow().Version, 1, `version is ${queueRow().Version}`));
  await check('a duplicate announces nothing', () =>
    assert.strictEqual(frames.length, 0, `${frames.length} frame(s) went out`));

  seed();
  await post({ op: 'add', questionKey: 'a' });
  await post({ op: 'add', questionKey: 'b' });
  const edge = await post({ op: 'earlier', questionKey: 'a' });
  await check('earlier at the head is refused as at-edge, and never wraps', () => {
    assert.strictEqual(bodyOf(edge).refused, 'at-edge');
    assert.deepStrictEqual(queueRow().Queue, ['a', 'b']);
  });

  const missing = await post({ op: 'remove', questionKey: 'never-queued' });
  await check('an op on a key that is not queued is refused as not-queued', () =>
    // A stale row on the phone must not resurrect what the stage removed.
    assert.strictEqual(bodyOf(missing).refused, 'not-queued'));

  console.log('\n7. what the endpoint refuses outright');

  seed();
  const unknownOp = await post({ op: 'shuffle', questionKey: 'a' });
  await check('an op outside the enum is a 400, not a cheerful no-op', () =>
    // stage-beat.js gives an unknown beat the same 400 for the same reason: on
    // the wire an unrecognised op means a client from a different deploy, and
    // a 200 is how a half-finished rename goes unnoticed for a week.
    assert.strictEqual(unknownOp.statusCode, 400, `got ${unknownOp.statusCode}`));
  await check('the refused op wrote nothing', () =>
    assert.strictEqual(queueRow(), undefined, 'a QUEUE row was written anyway'));

  for (const bad of [undefined, null, '', '   ']) {
    seed();
    const res = await post({ op: 'add', questionKey: bad });
    await check(`questionKey ${JSON.stringify(bad)} → 400`, () =>
      assert.strictEqual(res.statusCode, 400, `got ${res.statusCode}`));
    await check(`questionKey ${JSON.stringify(bad)} wrote nothing`, () =>
      assert.strictEqual(queueRow(), undefined));
  }

  seed();
  const noGame = await post({ op: 'add', questionKey: 'a' }, '9999');
  await check('a game that does not exist is a 404', () =>
    assert.strictEqual(noGame.statusCode, 404, `got ${noGame.statusCode}`));
  await check('the 404 wrote no QUEUE row for a phantom game', () =>
    assert.strictEqual(store.get(table.keyOf('GAME#9999', 'QUEUE')), undefined));

  seed();
  const noId = await queueHandler.handler({
    requestContext: { http: { method: 'POST' } },
    pathParameters: {},
    body: JSON.stringify({ op: 'add', questionKey: 'a' }),
  });
  await check('a missing gameId is a 400, not a crash', () =>
    assert.strictEqual(noId.statusCode, 400));

  console.log('\n8. expectedVersion is ADVISORY');

  seed();
  await post({ op: 'add', questionKey: 'a' });   // version 1
  await post({ op: 'add', questionKey: 'b' });   // version 2

  const stale = await post({ op: 'add', questionKey: 'c', expectedVersion: 1 });
  await check('a stale expectedVersion still APPLIES the op', () =>
    // Refusing would mean a phone two seconds behind — which is every phone,
    // by design; it polls /state every 2s — can never press a button. The
    // host's intent is still meaningful against a list that has moved.
    assert.deepStrictEqual(bodyOf(stale).queue, ['a', 'b', 'c'],
      `queue came back ${JSON.stringify(bodyOf(stale).queue)}`));
  await check('...and says so with staleView', () =>
    assert.strictEqual(bodyOf(stale).staleView, true));

  const fresh = await post({ op: 'add', questionKey: 'd', expectedVersion: 3 });
  await check('a current expectedVersion is not flagged stale', () =>
    assert.strictEqual(bodyOf(fresh).staleView, false));

  const absent = await post({ op: 'add', questionKey: 'e' });
  await check('omitting expectedVersion is not stale either', () =>
    // The stage sends it; a curl or an older client may not. Absent means "did
    // not say", which is not the same as "said the wrong thing".
    assert.strictEqual(bodyOf(absent).staleView, false));

  console.log('\n9. the polling remote can see the queue at all');

  seed();
  await post({ op: 'add', questionKey: 'QUESTION#c001#017' });
  await post({ op: 'add', questionKey: 'c001#018' });
  const state = await readState();

  await check('/state?includeHostData=true carries questionQueue', () =>
    // The remote holds NO socket (HostRemote.jsx explains why) and polls this
    // endpoint every 2s. Without this field the queue is invisible on the
    // surface the host is actually holding.
    assert.ok(state.questionQueue, 'no questionQueue block on the state payload'));

  await check('it carries the list, in order', () =>
    assert.deepStrictEqual(state.questionQueue.queue, ['c001#017', 'c001#018']));

  await check('it carries the version the phone will post back', () =>
    assert.strictEqual(state.questionQueue.version, 2));

  const direct = bodyOf(await get());
  await check('the state block is the SAME shape the GET returns', () => {
    // One fact, one parser. Two shapes would be two parsers on a surface that
    // reads both.
    const { gameId: _ignored, ...shape } = direct;
    assert.deepStrictEqual(state.questionQueue, shape);
  });

  seed();
  const noQueueYet = await readState();
  await check('a session that has never queued reads as an empty queue', () =>
    assert.deepStrictEqual(noQueueYet.questionQueue.queue, []));
  await check('...at version 0', () =>
    assert.strictEqual(noQueueYet.questionQueue.version, 0));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
})();
