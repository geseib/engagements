/**
 * THE END OF A ROUND SERVES THE HEAD OF THE HOST'S QUEUE — and everything that
 * has to keep working when it does not.
 *
 * The owner asked for questions that *"are not triggered until the end of the
 * round is selected by the host"*. `next-question.js` is where that trigger
 * lands, and the risk of putting it there is not the happy path — it is that
 * `next-question.js` is the busiest handler in the product and every session
 * that has never touched this feature goes through the same function.
 *
 * So §1 is the load-bearing section: an EMPTY queue must leave the automatic
 * selection byte-for-byte as it was. Everything else in this file is a way for
 * a queued question to be unservable, and the whole point is that the three
 * ways do NOT get the same treatment:
 *
 *   §3 already asked          -> DROPPED. It is spent; leaving it means a row
 *                               that will silently be skipped forever.
 *   §4 category switched off  -> SKIPPED AND LEFT. A skipped question was never
 *                               asked, and deleting a host's explicit choice
 *                               because they toggled a chip is a reduction with
 *                               no recovery — the chip comes back with one tap,
 *                               the queue does not come back at all.
 *   §6 set version replaced   -> NOTHING is served from the queue, and the
 *                               response says staleSet.
 *
 * §5 pins the one that would be easiest to get catastrophically wrong: a queue
 * where nothing is servable must fall through to automatic selection, NOT end
 * the session. A queue that can close a room down is worse than no queue.
 *
 * §7 pins the guard interaction. A repeat press during ASK# still answers
 * "Already asking a question" and must NOT consume the queue — swallowing the
 * next queued question on a double-tap would lose it with no error anywhere.
 *
 * §8 is the regression fence around `7ddb0e0a`. A queued pick is a SPECIFIC
 * pick, so it must not write ActiveIndex or zero an AvailMask bit; doing so
 * once per queued question is the same damage that commit removed, at speed.
 */
const path = require('path');
const assert = require('assert');

const REPO = path.join(__dirname, '..');
const { createTable, installStubs } = require('./helpers/player-table');

const table = createTable();
const store = table.store;
const sent = [];

installStubs({ table, sent });

process.env.TABLE_NAME = 'test-table';
process.env.WEBSOCKET_API_ENDPOINT = 'https://ws.test.invalid/dev';

const nextQuestion = require(path.join(REPO, 'lambda-functions/game/next-question.js'));

/* ---- Harness -------------------------------------------------------------- */

let pass = 0, fail = 0;
async function check(label, fn) {
  try { await fn(); console.log(`  PASS  ${label}`); pass++; }
  catch (e) { console.log(`  FAIL  ${label}\n        ${e.message}`); fail++; }
}

const GAME = '6042';
const SET = 'set-alpha';
const PK = `GAME#${GAME}`;
const SETPK = `SET#${SET}#v2`;

const put = (item) => { store.set(table.keyOf(item.PK, item.SK), item); };
const get = (sk) => store.get(table.keyOf(PK, sk));
const queueRow = () => get('QUEUE');

/**
 * Built from what the WRITERS write. Two categories so a switched-off one can
 * be proven not to take the other down with it; the set is VERSIONED (v2, with
 * the game pinned to it) because the stale-set guard is meaningless against a
 * legacy partition where every version is null.
 */
function seed({ queue = null, queueSetVersion = 2, hostMask = '11000000', activeIndex = 5 } = {}) {
  store.clear();
  sent.length = 0;

  put({ PK, SK: 'METADATA', QuestionSetId: SET, QuestionSetVersion: 2 });
  put({ PK, SK: 'STATE', State: 'RESULTS#001', LessonNumber: 1 });
  put({ PK: 'SETS', SK: `SET#${SET}`, activeVersion: 2, versions: [{ version: 2 }, { version: 3 }] });

  put({
    PK, SK: 'STATE#CATS',
    'AvailMask1-8': '11000000', 'AvailMask9-16': '00000000', 'AvailMask17-24': '00000000',
    'HostMask1-8': hostMask, 'HostMask9-16': '00000000', 'HostMask17-24': '00000000',
  });

  put({ PK: SETPK, SK: 'CATEGORY#c001', Name: 'Pricing' });
  put({ PK: SETPK, SK: 'CATEGORY#c002', Name: 'Packaging' });

  // The automatic cursor, deliberately not 0 or 1 — the damage 7ddb0e0a fixed
  // wrote exactly 1, so a fixture starting at 0 hides it.
  put({ PK, SK: 'CATEGORY#c001#ACTIVE', ActiveIndex: activeIndex, QuestionCount: 40 });
  put({ PK, SK: 'CATEGORY#c002#ACTIVE', ActiveIndex: 0, QuestionCount: 3 });
  put({ PK, SK: 'CATEGORY#c001#ORDER', QuestionOrder: ['090', '091'], IsRandom: false });
  put({ PK, SK: 'CATEGORY#c002#ORDER', QuestionOrder: ['031'], IsRandom: false });

  put({ PK: SETPK, SK: 'QUESTION#017', Category: 'Pricing', title: 'Seventeen' });
  put({ PK: SETPK, SK: 'QUESTION#018', Category: 'Pricing', title: 'Eighteen' });
  put({ PK: SETPK, SK: 'QUESTION#031', Category: 'Packaging', title: 'Thirty-one' });
  put({ PK: SETPK, SK: 'QUESTION#090', Category: 'Pricing', title: 'Ninety' });

  put({
    PK, SK: 'STATE#CATS#COUNTS',
    '1-8': [40, 3], '9-16': [], '17-24': [],
    TotalEnabled: 43, TotalRemaining: 43, Version: 1,
  });

  if (queue) {
    put({
      PK, SK: 'QUEUE', Queue: [...queue], Version: 4,
      SetId: SET, SetVersion: queueSetVersion, UpdatedAt: '2026-08-16T00:00:00.000Z',
      ttl: Math.floor(Date.now() / 1000) + 90 * 24 * 60 * 60,
    });
  }
}

/** Mark a round as already asked, the way the handler itself writes it. */
const alreadyAsked = (roundNumber, sourceQuestionId) => put({
  PK, SK: `QUESTION#${roundNumber}#REF`,
  SourceQuestionId: sourceQuestionId, QuestionNumber: roundNumber,
});

const ask = (body = {}) => nextQuestion.handler({
  pathParameters: { gameId: GAME },
  body: JSON.stringify(body),
});

const bodyOf = (res) => JSON.parse(res.body);

/* ========================================================================== */

(async () => {
  console.log('\n1. NO QUEUE, NO CHANGE — the property everything else rests on');

  await check('with no QUEUE row at all, automatic selection still serves', async () => {
    seed();
    const res = await ask({});
    assert.strictEqual(res.statusCode, 200, res.body);
    // c001's cursor is at 5 and its ORDER names 090 there... the automatic
    // path is exercised exactly as it was before the queue existed.
    assert.match(get('STATE').State, /^ASK#/, 'the game did not advance');
    assert.strictEqual(bodyOf(res).fromQueue, false);
  });

  await check('an EMPTY queue row is the same as none', async () => {
    seed({ queue: [] });
    const res = await ask({});
    assert.strictEqual(res.statusCode, 200, res.body);
    assert.match(get('STATE').State, /^ASK#/);
    assert.strictEqual(bodyOf(res).fromQueue, false);
  });

  await check('an empty queue leaves the automatic cursor moving as it always did', async () => {
    seed({ queue: [] });
    await ask({});
    // The automatic path DOES advance ActiveIndex — that is its whole job, and
    // a drain that accidentally marked every pick specific would freeze it.
    assert.notStrictEqual(get('CATEGORY#c001#ACTIVE').ActiveIndex, 5,
      'the automatic cursor stopped advancing');
  });

  await check('an empty queue row is not rewritten for no reason', async () => {
    seed({ queue: [] });
    const before = queueRow().Version;
    await ask({});
    assert.strictEqual(queueRow().Version, before,
      'the queue version moved under a host who is mid-edit elsewhere');
  });

  await check('a session with no queue says NOTHING about a queue on the wire', async () => {
    // Every session that has never used the feature comes through this handler
    // on every round. A questionQueueChanged frame for a queue that does not
    // exist would have every surface re-render an empty list — and would throw
    // away whatever the panel was holding optimistically at the time.
    seed();
    put({ PK, SK: 'CONNECTION#host-1', ConnectionId: 'host-1', ConnectionType: 'HOST' });
    await ask({});
    assert.ok(sent.length > 0, 'nothing was broadcast at all — the fixture is wrong');
    assert.ok(!sent.some((m) => m.type === 'questionQueueChanged'),
      `a phantom queue frame went out: ${JSON.stringify(sent.map((m) => m.type))}`);
  });

  await check('...and nothing about a queue in the response either', async () => {
    seed();
    const body = bodyOf(await ask({}));
    assert.strictEqual(body.queue, undefined, `response carried queue ${JSON.stringify(body.queue)}`);
    assert.strictEqual(body.queueVersion, undefined);
    assert.strictEqual(body.staleSet, undefined);
  });

  console.log('\n2. the head is served, and popped');

  await check('the queued question is the one asked', async () => {
    seed({ queue: ['018', '017'] });
    const res = await ask({});
    assert.strictEqual(res.statusCode, 200, res.body);
    assert.strictEqual(bodyOf(res).questionId, 'QUESTION#018',
      `served ${bodyOf(res).questionId} — the HEAD is 018`);
    assert.strictEqual(get('STATE').CurrentQuestionId, 'QUESTION#018');
  });

  await check('...and it is gone from the queue, with the rest intact', async () => {
    seed({ queue: ['018', '017'] });
    await ask({});
    assert.deepStrictEqual(queueRow().Queue, ['017'],
      `queue is ${JSON.stringify(queueRow().Queue)}`);
  });

  await check('the pop bumps the queue version', async () => {
    seed({ queue: ['018', '017'] });
    await ask({});
    assert.strictEqual(queueRow().Version, 5, `version is ${queueRow().Version}`);
  });

  await check('the response says it came from the queue, and what is left', async () => {
    seed({ queue: ['018', '017'] });
    const body = bodyOf(await ask({}));
    assert.strictEqual(body.fromQueue, true);
    assert.deepStrictEqual(body.queue, ['017']);
    assert.strictEqual(body.queueVersion, 5);
  });

  await check('the room is told the queue moved, on its own message type', async () => {
    seed({ queue: ['018', '017'] });
    // A player connection so there is somebody to tell.
    put({ PK, SK: 'CONNECTION#host-1', ConnectionId: 'host-1', ConnectionType: 'HOST' });
    await ask({});
    const frame = sent.find((m) => m.type === 'questionQueueChanged');
    assert.ok(frame, `no questionQueueChanged frame; sent ${JSON.stringify(sent.map((m) => m.type))}`);
    assert.deepStrictEqual(frame.queue, ['017']);
    // Never gameStateChanged — see stage-beat.js:40-43.
    assert.ok(!sent.some((m) => m.type === 'gameStateChanged'));
  });

  await check('a queued key spelled with the QUESTION# prefix still resolves', async () => {
    // Both spellings are on the wire; setupPanel.js:154 records what comparing
    // them cost the "Unasked only" filter.
    seed({ queue: ['QUESTION#018'] });
    const res = await ask({});
    assert.strictEqual(bodyOf(res).questionId, 'QUESTION#018', res.body);
  });

  await check('draining twice in a row works through the list in order', async () => {
    seed({ queue: ['018', '017'] });
    await ask({});
    store.get(table.keyOf(PK, 'STATE')).State = 'RESULTS#002';
    const second = await ask({});
    assert.strictEqual(bodyOf(second).questionId, 'QUESTION#017', second.body);
    assert.deepStrictEqual(queueRow().Queue, []);
  });

  console.log('\n3. a question already asked is DROPPED, not served again');

  await check('the spent entry is skipped and the next one served', async () => {
    seed({ queue: ['018', '017'] });
    alreadyAsked('001', 'QUESTION#018');
    const res = await ask({});
    assert.strictEqual(bodyOf(res).questionId, 'QUESTION#017', res.body);
  });

  await check('...and the spent entry is removed from the queue too', async () => {
    seed({ queue: ['018', '017'] });
    alreadyAsked('001', 'QUESTION#018');
    await ask({});
    // Both go in ONE conditional write: the spent one because it can never be
    // served, the served one because it just was.
    assert.deepStrictEqual(queueRow().Queue, [],
      `queue is ${JSON.stringify(queueRow().Queue)}`);
  });

  await check('a queue of nothing but spent entries is emptied, not served from', async () => {
    seed({ queue: ['018'] });
    alreadyAsked('001', 'QUESTION#018');
    const res = await ask({});
    assert.strictEqual(bodyOf(res).fromQueue, false, res.body);
    assert.deepStrictEqual(queueRow().Queue, []);
    assert.match(get('STATE').State, /^ASK#/, 'the automatic path did not take over');
  });

  console.log('\n4. a switched-off category is SKIPPED — and stays queued');

  await check('a question in a disabled category is not served', async () => {
    // Only c001 (Pricing) is on. 031 is Packaging.
    seed({ queue: ['031', '018'], hostMask: '10000000' });
    const res = await ask({});
    assert.strictEqual(bodyOf(res).questionId, 'QUESTION#018', res.body);
  });

  await check('...and it is STILL THERE afterwards', async () => {
    seed({ queue: ['031', '018'], hostMask: '10000000' });
    await ask({});
    // The chip goes back on with one tap. The host's queued choice does not
    // come back at all, so it is never deleted for a reason they can undo.
    assert.deepStrictEqual(queueRow().Queue, ['031'],
      `queue is ${JSON.stringify(queueRow().Queue)}`);
  });

  await check('turning the category back on makes it servable again', async () => {
    seed({ queue: ['031'], hostMask: '10000000' });
    await ask({});                                   // skipped; auto-selected
    assert.deepStrictEqual(queueRow().Queue, ['031']);

    store.get(table.keyOf(PK, 'STATE')).State = 'RESULTS#002';
    store.get(table.keyOf(PK, 'STATE#CATS'))['HostMask1-8'] = '11000000';
    const res = await ask({});
    assert.strictEqual(bodyOf(res).questionId, 'QUESTION#031', res.body);
  });

  await check('a queued key that is not in the set is skipped and left alone', async () => {
    seed({ queue: ['999', '018'] });
    const res = await ask({});
    assert.strictEqual(bodyOf(res).questionId, 'QUESTION#018', res.body);
    // A set restored from a backup brings 999 back. An emptied queue does not.
    assert.deepStrictEqual(queueRow().Queue, ['999']);
  });

  console.log('\n5. everything blocked falls through — it does NOT end the session');

  await check('a fully blocked queue still serves a question automatically', async () => {
    seed({ queue: ['031'], hostMask: '10000000' });
    const res = await ask({});
    assert.strictEqual(res.statusCode, 200, res.body);
    assert.notStrictEqual(bodyOf(res).state, 'ENDED',
      'a queue full of switched-off categories closed the room down');
    assert.match(get('STATE').State, /^ASK#/);
  });

  await check('the blocked entry survives that round untouched', async () => {
    seed({ queue: ['031'], hostMask: '10000000' });
    const before = queueRow().Version;
    await ask({});
    assert.deepStrictEqual(queueRow().Queue, ['031']);
    assert.strictEqual(queueRow().Version, before,
      'a round where nothing was drained still moved the queue version');
  });

  console.log('\n6. a queue built against another version of the set serves nothing');

  await check('a SetVersion mismatch is refused wholesale', async () => {
    // The game is pinned to v2; this queue was built while the set was v1.
    seed({ queue: ['018'], queueSetVersion: 1 });
    const res = await ask({});
    // The keys would name different questions in a different partition — the
    // host's chosen title over somebody else's question on the projector.
    assert.strictEqual(bodyOf(res).fromQueue, false, res.body);
    assert.strictEqual(bodyOf(res).staleSet, true, res.body);
  });

  await check('...and it is left completely alone, not tidied', async () => {
    seed({ queue: ['018'], queueSetVersion: 1 });
    const before = queueRow().Version;
    await ask({});
    assert.deepStrictEqual(queueRow().Queue, ['018']);
    assert.strictEqual(queueRow().Version, before);
  });

  await check('a stale queue still lets the round happen', async () => {
    seed({ queue: ['018'], queueSetVersion: 1 });
    await ask({});
    assert.match(get('STATE').State, /^ASK#/, 'a stale queue stopped the session advancing');
  });

  console.log('\n7. the ASK# duplicate guard still wins, and does not eat the queue');

  await check('a repeat press mid-round still says "Already asking a question"', async () => {
    seed({ queue: ['018'] });
    store.get(table.keyOf(PK, 'STATE')).State = 'ASK#001';
    const res = await ask({});
    assert.strictEqual(bodyOf(res).message, 'Already asking a question', res.body);
  });

  await check('...and the queue is untouched by it', async () => {
    seed({ queue: ['018'] });
    store.get(table.keyOf(PK, 'STATE')).State = 'ASK#001';
    await ask({});
    // A double-tap that quietly swallowed the next queued question would lose
    // it with no error and no way to tell it had happened.
    assert.deepStrictEqual(queueRow().Queue, ['018']);
    assert.strictEqual(queueRow().Version, 4);
  });

  await check('an explicit skip DOES take the queued question', async () => {
    seed({ queue: ['018'] });
    store.get(table.keyOf(PK, 'STATE')).State = 'ASK#001';
    const res = await ask({ action: 'skip' });
    assert.strictEqual(bodyOf(res).questionId, 'QUESTION#018', res.body);
  });

  console.log('\n8. a queued pick is a SPECIFIC pick — 7ddb0e0a must not come back');

  await check('the automatic cursor is left where it was', async () => {
    seed({ queue: ['018'], activeIndex: 5 });
    await ask({});
    // Writing it would reset a category the room had worked through to 5 back
    // to 1, and the next five automatic picks would re-serve answered
    // questions — once per queued question, this time.
    assert.strictEqual(get('CATEGORY#c001#ACTIVE').ActiveIndex, 5,
      'the queued pick moved the automatic selector');
  });

  await check('the category is not marked exhausted', async () => {
    seed({ queue: ['018'] });
    await ask({});
    assert.strictEqual(get('STATE#CATS')['AvailMask1-8'], '11000000',
      'the queued pick disabled the category it came from');
  });

  await check('the remaining count still drops — the question WAS asked', async () => {
    seed({ queue: ['018'] });
    const before = get('STATE#CATS#COUNTS')['1-8'][0];
    await ask({});
    assert.strictEqual(get('STATE#CATS#COUNTS')['1-8'][0], before - 1,
      'honest bookkeeping was gated along with the cursor writes');
  });

  await check('a queued round writes its REF row with the set version pinned', async () => {
    seed({ queue: ['018'] });
    await ask({});
    const ref = get('QUESTION#002#REF');
    assert.ok(ref, 'no QUESTION#002#REF row was written for the queued round');
    assert.strictEqual(ref.SourceQuestionId, 'QUESTION#018');
    assert.strictEqual(ref.SetVersion, 2);
  });

  console.log('\n9. the host edits the queue WHILE the round is ending');

  /*
    THE POP IS CONDITIONAL, AND THIS IS THE ONLY THING THAT PROVES IT.

    Ending a round is not instant, and the host has a phone in their hand. So
    the sequence below is ordinary: the drain reads ['018','017'], decides on
    018 — and before its write lands, the host removes 018 from the other
    surface. Version moves from 4 to 5 underneath it.

    Without the condition on that write, the drain overwrites the host's edit
    with its own remainder AND asks the question they just deleted, in front of
    the room. With it, the write is rejected, the drain goes round again, and
    re-picks from the list as it now is — so 017 is served and 018 stays
    deleted.

    An earlier version of this file had every other assertion here and none of
    this one: removing the ConditionExpression entirely changed nothing and the
    suite stayed green.
  */
  seed({ queue: ['018', '017'] });

  const latch = table.hold(
    (command) => command.type === 'update' && command.input.Key.SK === 'QUEUE'
  );
  const roundEnding = ask({});
  await latch.reached;

  // The host, on the other surface, takes 018 off the list.
  store.set(table.keyOf(PK, 'QUEUE'), {
    ...queueRow(), Queue: ['017'], Version: 5,
  });
  latch.release();
  const raced = await roundEnding;

  await check('the question the host just removed is NOT asked', () =>
    assert.strictEqual(bodyOf(raced).questionId, 'QUESTION#017',
      `served ${bodyOf(raced).questionId} — 018 was removed mid-flight`));

  await check('the drain re-read and re-picked rather than forcing its list', () =>
    assert.deepStrictEqual(queueRow().Queue, [],
      `queue is ${JSON.stringify(queueRow().Queue)}`));

  await check('the host\'s edit was not clobbered — version moved 5 -> 6', () =>
    // A blind write would have stored its own version 5 over the host's, and
    // the two surfaces would then disagree about which edit happened.
    assert.strictEqual(queueRow().Version, 6, `version is ${queueRow().Version}`));

  await check('the round still went ahead', () =>
    assert.match(get('STATE').State, /^ASK#/, 'the contention stopped the session advancing'));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
})();
