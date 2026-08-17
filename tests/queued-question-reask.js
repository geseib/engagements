/**
 * A QUESTION THE HOST ALREADY ASKED MUST NOT COME BACK.
 *
 * Reported: *"items you queue up and ask, dont seem to get removed from the
 * question pool and get asked again."*
 *
 * The seam is between this handler's two ways of choosing a question, and both
 * halves were individually correct:
 *
 *   - The AUTOMATIC path walks a per-category cursor (`CATEGORY#<id>#ACTIVE`
 *     .ActiveIndex into `#ORDER`.QuestionOrder) and advances it by one a round.
 *     It keeps no record of WHICH questions went out, because while every round
 *     comes from the cursor the cursor IS the record.
 *
 *   - A QUEUED or hand-picked round names its question directly and
 *     deliberately does not touch the cursor. `specific-selection-damage.js`
 *     is the suite that made it stop touching it: moving the cursor from a
 *     specific pick reset a 40-question category to position 1 and zeroed its
 *     AvailMask bit, costing the host the other 39.
 *
 * So nothing moved the cursor and nothing else remembered, and the cursor
 * eventually walked onto the question the host had already put on screen and
 * served it a second time.
 *
 * The fix consults the record that already existed: the QUESTION#nnn#REF rows,
 * written for EVERY round however it was chosen, which the queue drain had been
 * reading to discard spent entries since the queue shipped.
 *
 * THE TWO PROPERTIES HERE PULL AGAINST EACH OTHER and that is the point of
 * testing them in one file: the cursor must be stepped OVER an asked question
 * (§1-§3) while still not being CLOBBERED by the specific pick that asked it
 * (§4). Fixing either one alone re-breaks the other.
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

const nextQuestion = require(path.join(REPO, 'lambda-functions/game/next-question.js'));

let pass = 0, fail = 0;
async function check(label, fn) {
  try { await fn(); console.log(`  PASS  ${label}`); pass++; }
  catch (e) { console.log(`  FAIL  ${label}\n        ${e.message}`); fail++; }
}

const GAME = '7311';
const SET = 'set-alpha';
const PK = `GAME#${GAME}`;
const SETPK = `SET#${SET}`;

const put = (item) => { store.set(table.keyOf(item.PK, item.SK), item); };
const get = (sk) => store.get(table.keyOf(PK, sk));

/**
 * One category of five questions, in a KNOWN order, cursor at the top.
 *
 * The order is explicit rather than left to the `activeIndex + 1` fallback so
 * that "the cursor skipped one" and "the cursor happened to land elsewhere" are
 * distinguishable — with an implicit order they are the same observation.
 */
function seed() {
  store.clear();
  sent.length = 0;

  put({ PK, SK: 'METADATA', QuestionSetId: SET });
  put({ PK, SK: 'STATE', State: 'RESULTS#001', LessonNumber: 1 });

  put({
    PK, SK: 'STATE#CATS',
    'AvailMask1-8': '10000000', 'AvailMask9-16': '00000000', 'AvailMask17-24': '00000000',
    'HostMask1-8': '10000000', 'HostMask9-16': '00000000', 'HostMask17-24': '00000000',
  });

  put({ PK: SETPK, SK: 'CATEGORY#c001', Name: 'Pricing' });

  put({ PK, SK: 'CATEGORY#c001#ACTIVE', ActiveIndex: 0, QuestionCount: 5 });
  put({
    PK, SK: 'CATEGORY#c001#ORDER',
    QuestionOrder: ['001', '002', '003', '004', '005'],
    IsRandomized: false,
  });

  for (const n of ['001', '002', '003', '004', '005']) {
    put({ PK: SETPK, SK: `QUESTION#c001#${n}`, Category: 'Pricing', title: `Q${n}` });
  }

  put({
    PK, SK: 'STATE#CATS#COUNTS',
    '1-8': [5], '9-16': [], '17-24': [],
    TotalEnabled: 5, TotalRemaining: 5, Version: 1,
  });
}

/** Record a round as served, exactly as the handler's own REF write does. */
const markAsked = (roundNumber, sourceQuestionId) => {
  put({
    PK, SK: `QUESTION#${String(roundNumber).padStart(3, '0')}#REF`,
    SourceQuestionId: sourceQuestionId,
    SetId: SET,
    QuestionNumber: String(roundNumber).padStart(3, '0'),
  });
};

const ask = (body = {}) => nextQuestion.handler({
  pathParameters: { gameId: GAME },
  body: JSON.stringify(body),
});

/** Which source question the round just served resolved to. */
const servedNow = () => {
  const state = get('STATE');
  const round = String(state.LessonNumber).padStart(3, '0');
  return get(`QUESTION#${round}#REF`).SourceQuestionId;
};

/* ========================================================================== */

(async () => {
  console.log('\n§1  the automatic cursor steps over a question already asked');

  await check('a question asked out of order is not served again', async () => {
    seed();
    // The host queued Q003 and it went out as round 1 — the exact scenario in
    // the report. The cursor is untouched at 0, which is correct and is what
    // specific-selection-damage.js pins.
    markAsked(1, 'QUESTION#c001#003');
    put({ PK, SK: 'STATE', State: 'RESULTS#001', LessonNumber: 1 });

    await ask();
    assert.strictEqual(servedNow(), 'QUESTION#c001#001', 'round 2 should open on Q001');

    put({ PK, SK: 'STATE', State: `RESULTS#002`, LessonNumber: 2 });
    await ask();
    assert.strictEqual(servedNow(), 'QUESTION#c001#002', 'round 3 should open on Q002');

    put({ PK, SK: 'STATE', State: `RESULTS#003`, LessonNumber: 3 });
    await ask();
    // THE BUG: before the fix this served Q003 a second time, because the
    // cursor had walked to index 2 and nothing told it Q003 was spent.
    assert.strictEqual(servedNow(), 'QUESTION#c001#004',
      'round 4 must skip the already-asked Q003 and open on Q004');
  });

  await check('the cursor lands PAST the skipped question, not on it', async () => {
    seed();
    markAsked(1, 'QUESTION#c001#001');
    put({ PK, SK: 'STATE', State: 'RESULTS#001', LessonNumber: 1 });

    await ask();
    // rejects: returning the index the walk STARTED from. The caller writes
    // `activeIndex + 1`, so a stale index re-walks the same run every round and
    // the cursor never gets past it — quadratic, and permanently stuck.
    assert.strictEqual(get('CATEGORY#c001#ACTIVE').ActiveIndex, 2,
      'cursor should sit after Q002, having stepped over the spent Q001');
  });

  await check('a whole run of asked questions is stepped over at once', async () => {
    seed();
    // A host who queued three in a row — the running order the queue exists for.
    markAsked(1, 'QUESTION#c001#001');
    markAsked(2, 'QUESTION#c001#002');
    markAsked(3, 'QUESTION#c001#003');
    put({ PK, SK: 'STATE', State: 'RESULTS#003', LessonNumber: 3 });

    await ask();
    assert.strictEqual(servedNow(), 'QUESTION#c001#004');
    assert.strictEqual(get('CATEGORY#c001#ACTIVE').ActiveIndex, 4);
  });

  console.log('\n§2  a category whose remaining questions were all asked is exhausted');

  await check('no question is served twice rather than reporting exhaustion', async () => {
    seed();
    for (const [round, n] of [[1, '001'], [2, '002'], [3, '003'], [4, '004'], [5, '005']]) {
      markAsked(round, `QUESTION#c001#${n}`);
    }
    put({ PK, SK: 'STATE', State: 'RESULTS#005', LessonNumber: 5 });

    const res = await ask();
    const payload = JSON.parse(res.body);

    /*
      IT ENDS THE SESSION, and that is the right answer rather than an error —
      running out of questions is how a session finishes, not a fault. (An
      earlier draft of this assertion demanded a non-200 and was simply wrong
      about the contract.)

      What matters is the half that WOULD have been a bug: no sixth round was
      opened on a question the room had already answered. Repeating one is worse
      than declaring the set spent, and before the fix the walk had no way to
      know the difference.
    */
    assert.strictEqual(res.statusCode, 200, res.body);
    assert.strictEqual(payload.gameEnded, true,
      `expected the session to end when every question is spent, got: ${res.body}`);
    assert.strictEqual(get('STATE').State, 'ENDED');
    assert.strictEqual(get('QUESTION#006#REF'), undefined,
      'a sixth round was opened on an already-answered question');
  });

  console.log('\n§3  an unasked session is completely unaffected');

  await check('with nothing asked, the cursor walks normally from the top', async () => {
    seed();
    // The load-bearing property: this fix is a skip on an existing path, never
    // a replacement for it. A session that has never queued anything must
    // behave exactly as before.
    await ask();
    assert.strictEqual(servedNow(), 'QUESTION#c001#001');
    assert.strictEqual(get('CATEGORY#c001#ACTIVE').ActiveIndex, 1);
  });

  await check('the cursor still advances by one on an ordinary round', async () => {
    seed();
    put({ PK, SK: 'CATEGORY#c001#ACTIVE', ActiveIndex: 2, QuestionCount: 5 });
    await ask();
    assert.strictEqual(servedNow(), 'QUESTION#c001#003');
    assert.strictEqual(get('CATEGORY#c001#ACTIVE').ActiveIndex, 3);
  });

  console.log('\n§4  and the specific pick still does not move the cursor');

  await check('asking a question by hand leaves ActiveIndex alone', async () => {
    seed();
    put({ PK, SK: 'CATEGORY#c001#ACTIVE', ActiveIndex: 2, QuestionCount: 5 });

    await ask({ questionId: 'c001#005', action: 'select_specific' });

    // The property specific-selection-damage.js exists for, re-pinned HERE
    // because the skip above is the change most likely to break it: a fix that
    // "removes the question from the pool" by advancing the cursor would pass
    // every assertion in §1 and silently restore the 40-questions-lost bug.
    assert.strictEqual(get('CATEGORY#c001#ACTIVE').ActiveIndex, 2,
      'a specific pick must not move the automatic cursor');
  });

  await check('and the question it picked is skipped by the next automatic round', async () => {
    seed();
    put({ PK, SK: 'CATEGORY#c001#ACTIVE', ActiveIndex: 0, QuestionCount: 5 });

    await ask({ questionId: 'c001#002', action: 'select_specific' });
    const round = String(get('STATE').LessonNumber).padStart(3, '0');
    assert.strictEqual(get(`QUESTION#${round}#REF`).SourceQuestionId, 'QUESTION#c001#002');

    put({ PK, SK: 'STATE', State: `RESULTS#${round}`, LessonNumber: Number(round) });
    await ask();
    assert.strictEqual(servedNow(), 'QUESTION#c001#001');

    const r2 = String(get('STATE').LessonNumber).padStart(3, '0');
    put({ PK, SK: 'STATE', State: `RESULTS#${r2}`, LessonNumber: Number(r2) });
    await ask();
    // The end-to-end shape of the report: pick one by hand, then let the
    // session run on, and never see it again.
    assert.strictEqual(servedNow(), 'QUESTION#c001#003',
      'the hand-picked Q002 must not come back round');
  });

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
})();
