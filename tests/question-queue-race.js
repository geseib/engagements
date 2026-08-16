/**
 * TWO HOST SURFACES EDIT THE QUEUE AT THE SAME INSTANT. BOTH EDITS MUST LAND.
 *
 * This is the file the whole design of `question-queue.js` exists for, and the
 * one property that an implementation can get wrong while passing every other
 * test in the repo.
 *
 * The setup is not hypothetical. A host runs a session with the projector in
 * front of them and their phone in their hand. The phone holds NO WebSocket —
 * `HostRemote.jsx` says why — so it polls `/state` every 2s and is a beat
 * behind by construction. Queue something on the stage and something on the
 * phone within the same second and you have this race, on ordinary hardware,
 * on the first day anybody uses the feature.
 *
 * ── THE THREE IMPLEMENTATIONS, AND WHY ONLY THE THIRD SURVIVES ─────────────
 *
 *   1. LAST WRITE WINS. Both surfaces PUT their whole array. The loser's edit
 *      is gone, with a 200 and no sign anywhere. Fails §1 immediately.
 *
 *   2. OPTIMISTIC LOCK, RE-SENDING THE ARRAY. The conditional write catches the
 *      collision — and then the loser retries with the SAME array it built
 *      before it knew, which is the pre-collision list. It re-reads, sees the
 *      winner's edit, and overwrites it. This one is the trap: it looks like
 *      careful concurrency control, it passes every single-caller test, and it
 *      loses data ONLY under a real interleaving. §1 is what tells the two
 *      apart, and it is the reason `table.hold()` exists in the fake at all.
 *
 *   3. OPTIMISTIC LOCK, RE-APPLYING THE OPERATION. The client never sends an
 *      array; it sends `{ op, questionKey }`, and the retry replays that op
 *      against the list it has JUST RE-READ. Both edits land.
 *
 * §3 pins the giving-up behaviour, because a retry loop with no bound is a
 * Lambda that burns its 30s timeout on a hot key, and a loop that retries the
 * WRITE without re-reading is implementation 2 wearing a hat.
 */
const path = require('path');
const assert = require('assert');

const REPO = path.join(__dirname, '..');
const { createTable, installStubs, conditionalFailure } = require('./helpers/player-table');

const table = createTable();
const store = table.store;
const sent = [];

installStubs({ table, sent });

process.env.TABLE_NAME = 'test-table';
process.env.WEBSOCKET_API_ENDPOINT = 'https://ws.test.invalid/dev';

const queueHandler = require(path.join(REPO, 'lambda-functions/game/question-queue.js'));

/* ---- Harness -------------------------------------------------------------- */

let pass = 0, fail = 0;
async function check(label, fn) {
  try { await fn(); console.log(`  PASS  ${label}`); pass++; }
  catch (e) { console.log(`  FAIL  ${label}\n        ${e.message}`); fail++; }
}

const GAME = '5150';
const SET = 'set-alpha';
const PK = `GAME#${GAME}`;

const put = (item) => { store.set(table.keyOf(item.PK, item.SK), item); };
const queueRow = () => store.get(table.keyOf(PK, 'QUEUE'));

function seed(queue) {
  store.clear();
  table.log.length = 0;
  sent.length = 0;

  put({ PK, SK: 'METADATA', QuestionSetId: SET });
  put({ PK, SK: 'STATE', State: 'RESULTS#001', LessonNumber: 1 });
  put({ PK: 'SETS', SK: `SET#${SET}` });
  put({ PK, SK: 'CONNECTION#host-1', ConnectionId: 'host-1', ConnectionType: 'HOST' });

  if (queue) {
    put({
      PK, SK: 'QUEUE', Queue: [...queue], Version: 1,
      SetId: SET, SetVersion: null, UpdatedAt: '2026-08-16T00:00:00.000Z',
    });
  }
}

const post = (body) => queueHandler.handler({
  requestContext: { http: { method: 'POST' } },
  pathParameters: { gameId: GAME },
  body: JSON.stringify(body),
});

const bodyOf = (res) => JSON.parse(res.body);

/** Every conditional write aimed at the QUEUE row, in the order it was issued. */
const queueWrites = () => table.log
  .filter((entry) => entry.type === 'update' && entry.input.Key.SK === 'QUEUE');

/** Every read of the QUEUE row. */
const queueReads = () => table.log
  .filter((entry) => entry.type === 'get' && entry.input.Key.SK === 'QUEUE');

/** The predicate the latch catches: a conditional write of the queue row. */
const isQueueWrite = (command) =>
  command.type === 'update' && command.input.Key.SK === 'QUEUE';

/* ========================================================================== */

(async () => {
  console.log('\n1. two adds, interleaved — the loser re-reads, RE-APPLIES, and both land');

  seed(['a']);

  // Hold the stage's write mid-flight. It has already read version 1 and
  // computed its new list; it has not yet committed.
  const latch = table.hold(isQueueWrite);
  const stage = post({ op: 'add', questionKey: 'b' });
  await latch.reached;

  // The phone, holding the same version 1, runs to completion while the stage
  // is frozen. This is the interleaving, not a simulation of one.
  const phone = await post({ op: 'add', questionKey: 'c' });
  await check('the phone (the winner) succeeds', () =>
    assert.strictEqual(phone.statusCode, 200, `got ${phone.statusCode}: ${phone.body}`));
  await check('the phone\'s edit is at version 2', () =>
    assert.strictEqual(queueRow().Version, 2, `version is ${queueRow().Version}`));

  latch.release();
  const stageRes = await stage;

  await check('the stage (the loser) also succeeds — 200, not a 409', () =>
    // The host pressed a legal button. Handing them a conflict to resolve is
    // not a design, it is the collision made their problem.
    assert.strictEqual(stageRes.statusCode, 200, `got ${stageRes.statusCode}: ${stageRes.body}`));

  await check('BOTH questions are queued — this is the whole point', () => {
    // Implementation 2 — re-sending the array it built before the collision —
    // ends here with ['a','b'] and the phone's 'c' silently gone. Nothing else
    // in this repo would notice.
    const queue = queueRow().Queue;
    assert.ok(queue.includes('b'), `the stage's add was lost: ${JSON.stringify(queue)}`);
    assert.ok(queue.includes('c'), `the phone's add was lost: ${JSON.stringify(queue)}`);
  });

  await check('the loser\'s op was applied to the WINNER\'S list, in order', () =>
    // Re-applying 'add' means appending to what is actually there now, so the
    // phone's 'c' keeps the position it earned and the stage's 'b' goes after.
    assert.deepStrictEqual(queueRow().Queue, ['a', 'c', 'b'],
      `queue is ${JSON.stringify(queueRow().Queue)}`));

  await check('the queue ends at version 3 — two changes, two bumps', () =>
    assert.strictEqual(queueRow().Version, 3, `version is ${queueRow().Version}`));

  await check('the losing write really WAS rejected by the condition', () => {
    // Three conditional writes were issued: the stage's doomed one, the
    // phone's winning one, and the stage's replay. If only two appear, no
    // condition ever failed and this file has been testing nothing.
    const expectations = queueWrites().map((w) => w.input.ExpressionAttributeValues[':expected']);
    assert.deepStrictEqual(expectations, [1, 1, 2],
      `conditional writes expected versions ${JSON.stringify(expectations)}`);
  });

  await check('the retry RE-READ before it re-applied', () =>
    // Three reads: stage, phone, stage-again. A loop that retries the WRITE
    // without a fresh read is implementation 2 with extra steps — it would
    // show two.
    assert.strictEqual(queueReads().length, 3,
      `${queueReads().length} reads of the QUEUE row`));

  await check('the loser announced the FINAL list, not its own idea of it', () => {
    // The other surface applies what it is handed. A frame carrying the
    // pre-collision list would put the winner's edit back on screen as
    // missing, which is the data loss reappearing as a display bug.
    const last = sent[sent.length - 1];
    assert.strictEqual(last.type, 'questionQueueChanged');
    assert.deepStrictEqual(last.queue, ['a', 'c', 'b']);
    assert.strictEqual(last.version, 3);
  });

  console.log('\n2. a reorder racing a removal — the survivor is re-derived, not re-sent');

  seed(['a', 'b', 'c']);

  const latch2 = table.hold(isQueueWrite);
  const reorder = post({ op: 'later', questionKey: 'a' });   // wants ['b','a','c']
  await latch2.reached;

  const drop = await post({ op: 'remove', questionKey: 'c' });  // wins: ['a','b']
  await check('the removal wins', () =>
    assert.deepStrictEqual(queueRow().Queue, ['a', 'b']));

  latch2.release();
  const reorderRes = await reorder;

  await check('the reorder replays against the shortened list', () => {
    // Re-sending ['b','a','c'] would resurrect the removed question — the
    // worst version of this bug, because the host watches something they
    // deleted come back and has no idea why.
    assert.strictEqual(reorderRes.statusCode, 200, `got ${reorderRes.statusCode}: ${reorderRes.body}`);
    assert.deepStrictEqual(queueRow().Queue, ['b', 'a'],
      `queue is ${JSON.stringify(queueRow().Queue)}`);
  });

  await check('the removed question stays removed', () =>
    assert.ok(!queueRow().Queue.includes('c'),
      'a removed question was resurrected by the loser\'s replay'));

  console.log('\n3. a move that becomes impossible is refused, not forced');

  seed(['a', 'b']);

  const latch3 = table.hold(isQueueWrite);
  const promote = post({ op: 'earlier', questionKey: 'b' });  // wants ['b','a']
  await latch3.reached;

  // The other surface removes 'a' first, so by the time the promotion replays,
  // 'b' is already the head and cannot go earlier.
  await post({ op: 'remove', questionKey: 'a' });
  latch3.release();
  const promoteRes = await promote;

  await check('the replay notices the op no longer applies', () =>
    assert.strictEqual(bodyOf(promoteRes).refused, 'at-edge',
      `refused was '${bodyOf(promoteRes).refused}'`));
  await check('and it changes nothing rather than inventing a position', () =>
    // The alternative — forcing the pre-collision list — would re-insert 'a'.
    assert.deepStrictEqual(queueRow().Queue, ['b'],
      `queue is ${JSON.stringify(queueRow().Queue)}`));

  console.log('\n4. the loop is BOUNDED, and re-reads on every attempt');

  seed(['a']);
  const realSend = table.doc.send;
  let refusedWrites = 0;
  // A permanently hot key: every conditional write of the QUEUE row fails, as
  // it would with a client hammering the endpoint. Nothing else is disturbed.
  table.doc.send = async (command) => {
    if (isQueueWrite(command)) {
      table.log.push({ type: command.type, input: command.input });
      refusedWrites += 1;
      throw conditionalFailure();
    }
    return realSend.call(table.doc, command);
  };

  const startedAt = Date.now();
  const givenUp = await post({ op: 'add', questionKey: 'b' });
  const elapsed = Date.now() - startedAt;
  table.doc.send = realSend;

  await check('it gives up with a 409 rather than looping forever', () =>
    // A Lambda has 30 seconds. An unbounded retry on a hot key spends all of
    // them and then times out, which the host sees as the button hanging.
    assert.strictEqual(givenUp.statusCode, 409, `got ${givenUp.statusCode}: ${givenUp.body}`));

  await check('it tried exactly 3 times', () =>
    assert.strictEqual(refusedWrites, queueHandler.MAX_ATTEMPTS,
      `${refusedWrites} attempts, MAX_ATTEMPTS is ${queueHandler.MAX_ATTEMPTS}`));

  await check('each attempt re-read the row first', () =>
    assert.strictEqual(queueReads().length, queueHandler.MAX_ATTEMPTS,
      `${queueReads().length} reads across ${queueHandler.MAX_ATTEMPTS} attempts`));

  await check('it backed off between attempts instead of spinning', () =>
    // 100ms then 200ms. Retrying instantly three times is three collisions in
    // the same millisecond — the retry loop as a way of losing faster.
    assert.ok(elapsed >= 250, `the three attempts took only ${elapsed}ms`));

  await check('giving up left the stored queue exactly as it was', () =>
    assert.deepStrictEqual(queueRow().Queue, ['a']));

  await check('giving up announced nothing', () =>
    // A frame for a change that did not happen would put the question on the
    // other surface's list and leave it there until the next poll disagreed.
    assert.strictEqual(sent.length, 0, `${sent.length} frame(s) went out`));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
})();
