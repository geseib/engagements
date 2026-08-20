/**
 * UP NEXT, END TO END — `GET /games/{gameId}/up-next`, the real handler.
 *
 * `question-plan.js` is tested as arithmetic in `question-plan.js`'s own suite.
 * What THAT cannot see is whether this handler assembles the snapshot correctly
 * from the rows the writers actually write — which cursor it reads, which mask
 * it honours, whether a queued key resolves to a real question. Every bug left
 * after a green planner suite lives in this seam, so these assertions are about
 * the READS.
 *
 * The property under all of them: THE PREVIEW MUST MATCH THE SERVE. §4 pins it
 * directly by running both against one fixture.
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

const upNext = require(path.join(REPO, 'lambda-functions/game/up-next.js'));
const nextQuestion = require(path.join(REPO, 'lambda-functions/game/next-question.js'));

let pass = 0, fail = 0;
async function check(label, fn) {
  try { await fn(); console.log(`  PASS  ${label}`); pass++; }
  catch (e) { console.log(`  FAIL  ${label}\n        ${e.message}`); fail++; }
}

const GAME = '5150';
const SET = 'set-alpha';
const PK = `GAME#${GAME}`;
const SETPK = `SET#${SET}`;

const put = (item) => { store.set(table.keyOf(item.PK, item.SK), item); };
const get = (sk) => store.get(table.keyOf(PK, sk));

/**
 * Two categories of four, both enabled, cursors at the top.
 *
 * Built from what the WRITERS write — CATEGORY#<id>#ORDER carries QuestionOrder
 * and IsRandom, #ACTIVE carries ActiveIndex and QuestionCount, and the set
 * partition carries Title/Category on each question row.
 */
function seed({ isRandom = false, hostMask = '11000000' } = {}) {
  store.clear();
  sent.length = 0;

  put({ PK, SK: 'METADATA', QuestionSetId: SET, RandomSeed: 'fixed-seed' });
  put({ PK, SK: 'STATE', State: 'RESULTS#000', LessonNumber: 0 });
  put({
    PK, SK: 'STATE#CATS',
    'AvailMask1-8': '11000000', 'AvailMask9-16': '00000000', 'AvailMask17-24': '00000000',
    'HostMask1-8': hostMask, 'HostMask9-16': '00000000', 'HostMask17-24': '00000000',
  });

  for (const [cid, name] of [['c001', 'Pricing'], ['c002', 'Packaging']]) {
    put({ PK: SETPK, SK: `CATEGORY#${cid}`, Name: name });
    put({
      PK, SK: `CATEGORY#${cid}#ORDER`,
      QuestionOrder: ['001', '002', '003', '004'], IsRandom: isRandom,
    });
    put({ PK, SK: `CATEGORY#${cid}#ACTIVE`, ActiveIndex: 0, QuestionCount: 4 });
    for (const n of ['001', '002', '003', '004']) {
      put({
        PK: SETPK, SK: `QUESTION#${cid}#${n}`,
        Category: name, Title: `${name} ${n}`,
      });
    }
  }

  put({
    PK, SK: 'STATE#CATS#COUNTS',
    '1-8': [4, 4], '9-16': [], '17-24': [],
    TotalEnabled: 8, TotalRemaining: 8, Version: 1,
  });
}

const peek = async (count) => {
  const res = await upNext.handler({
    pathParameters: { gameId: GAME },
    queryStringParameters: count ? { count: String(count) } : null,
  });
  return { statusCode: res.statusCode, body: JSON.parse(res.body) };
};

const ids = (body) => body.upNext.map((u) => u.questionId);

(async () => {
  console.log('\n§1  it reads the session and reports a plan');

  await check('a plan of the requested length, in order', async () => {
    seed();
    const { statusCode, body } = await peek(3);
    assert.strictEqual(statusCode, 200, JSON.stringify(body));
    assert.strictEqual(body.upNext.length, 3);
    assert.deepStrictEqual(ids(body), [
      'QUESTION#c001#001', 'QUESTION#c001#002', 'QUESTION#c001#003',
    ]);
  });

  await check('each row carries a title and a category name to show', async () => {
    seed();
    const { body } = await peek(1);
    // rejects: returning bare ids. A running order the host cannot read is not
    // a running order.
    assert.strictEqual(body.upNext[0].title, 'Pricing 001');
    assert.strictEqual(body.upNext[0].categoryName, 'Pricing');
  });

  await check('it writes nothing at all', async () => {
    seed();
    const before = JSON.stringify([...store.entries()].sort());
    await peek(5);
    // rejects: a peek that spends a question or advances a cursor. Checking
    // what is coming would change what is coming, and it would present as
    // "questions go missing when I look at the list".
    assert.strictEqual(JSON.stringify([...store.entries()].sort()), before,
      'the peek mutated stored state');
  });

  await check('the count is clamped, not trusted', async () => {
    seed();
    const { body } = await peek(500);
    assert.ok(body.upNext.length <= 20, `got ${body.upNext.length}`);
  });

  console.log('\n§2  it honours the same state the selector honours');

  await check('a category the host switched off contributes nothing', async () => {
    seed({ hostMask: '10000000' });   // c002 off
    const { body } = await peek(8);
    // rejects: reading the set's categories and ignoring the game's HostMask,
    // which would preview questions the session cannot reach.
    assert.ok(body.upNext.every((u) => u.categoryId === 'c001'),
      `off category leaked in: ${JSON.stringify(ids(body))}`);
  });

  await check('an already-asked question never appears', async () => {
    seed();
    put({
      PK, SK: 'QUESTION#001#REF',
      SourceQuestionId: 'QUESTION#c001#001', SetId: SET, QuestionNumber: '001',
    });
    const { body } = await peek(3);
    assert.ok(!ids(body).includes('QUESTION#c001#001'),
      `asked question previewed: ${JSON.stringify(ids(body))}`);
  });

  await check('the cursor is read from the game, not assumed to be zero', async () => {
    seed();
    put({ PK, SK: 'CATEGORY#c001#ACTIVE', ActiveIndex: 2, QuestionCount: 4 });
    const { body } = await peek(1);
    assert.strictEqual(body.upNext[0].questionId, 'QUESTION#c001#003');
  });

  console.log('\n§3  the host\'s running order leads, and is tagged');

  await check('a queued question comes first and says so', async () => {
    seed();
    put({ PK, SK: 'QUEUE', Queue: ['c002#003'], Version: 1 });
    const { body } = await peek(3);
    assert.strictEqual(body.upNext[0].questionId, 'QUESTION#c002#003');
    assert.strictEqual(body.upNext[0].source, 'queued');
    assert.strictEqual(body.upNext[0].title, 'Packaging 003');
    // rejects: tagging everything the same. The tag is the whole point of the
    // request — "an obvious tag when the user queued it up just to distinguish".
    assert.deepStrictEqual(body.upNext.slice(1).map((u) => u.source), ['auto', 'auto']);
  });

  await check('a queued question in a SWITCHED-OFF category takes no round, and is reported parked', async () => {
    /*
      The drain skips-and-leaves such an entry (next-question.js), so a preview
      that placed it advertised a round that never happens and shifted every
      later round by one. Reported: "if i queue a question that is in a
      category that is disabled, it will stay in the queue but not get asked,
      just skipped... the running order queue listed is not actually used."
    */
    seed({ hostMask: '10000000' });   // c002 off
    put({ PK, SK: 'QUEUE', Queue: ['c002#003'], Version: 1 });
    const { body } = await peek(3);
    assert.ok(!ids(body).includes('QUESTION#c002#003'),
      `parked question previewed as a round: ${JSON.stringify(ids(body))}`);
    assert.deepStrictEqual(body.blocked, [{
      key: 'c002#003',
      questionId: 'QUESTION#c002#003',
      reason: 'category-off',
      title: 'Packaging 003',
      categoryName: 'Packaging',
    }]);
    // And the rounds that ARE shown are the ones the serve will take — the
    // parked entry must not offset the seeded walk.
    assert.strictEqual(body.upNext[0].source, 'auto');
  });

  await check('a parked queued question does not desync preview from serve', async () => {
    seed({ isRandom: true, hostMask: '10000000' });
    put({ PK, SK: 'QUEUE', Queue: ['c002#002'], Version: 1 });
    const { body } = await peek(2);
    const predicted = ids(body);

    const served = [];
    for (let i = 0; i < 2; i += 1) {
      await nextQuestion.handler({
        pathParameters: { gameId: GAME }, body: JSON.stringify({}),
      });
      const round = String(get('STATE').LessonNumber).padStart(3, '0');
      served.push(get(`QUESTION#${round}#REF`).SourceQuestionId);
      put({ PK, SK: 'STATE', State: `RESULTS#${round}`, LessonNumber: Number(round) });
    }
    assert.deepStrictEqual(served, predicted,
      'the parked entry offset the preview from what the room got');
  });

  await check('a queued question is not ALSO shown as an automatic pick', async () => {
    seed();
    put({ PK, SK: 'QUEUE', Queue: ['c001#002'], Version: 1 });
    const { body } = await peek(4);
    const appearances = ids(body).filter((id) => id === 'QUESTION#c001#002').length;
    // The reported bug, in the preview: once, not twice.
    assert.strictEqual(appearances, 1, JSON.stringify(ids(body)));
  });

  console.log('\n§4  the preview and the serve agree — the whole point');

  await check('an in-order session serves exactly what was previewed', async () => {
    seed({ isRandom: false });
    const { body } = await peek(3);
    const predicted = ids(body);

    const served = [];
    for (let i = 0; i < 3; i += 1) {
      await nextQuestion.handler({
        pathParameters: { gameId: GAME }, body: JSON.stringify({}),
      });
      const round = String(get('STATE').LessonNumber).padStart(3, '0');
      served.push(get(`QUESTION#${round}#REF`).SourceQuestionId);
      put({ PK, SK: 'STATE', State: `RESULTS#${round}`, LessonNumber: Number(round) });
    }
    assert.deepStrictEqual(served, predicted);
  });

  await check('a RANDOMISED session serves exactly what was previewed', async () => {
    /*
      THE ASSERTION THE SEEDING EXISTS FOR.

      With `Math.random()` this could not pass except by luck: the preview would
      draw one category and the serve another, and the Up Next would be a guess
      wearing the clothes of a plan. It passes because both call the same
      `pickIndex(seed, round, n)`.
    */
    seed({ isRandom: true });
    const { body } = await peek(4);
    const predicted = ids(body);

    const served = [];
    for (let i = 0; i < 4; i += 1) {
      await nextQuestion.handler({
        pathParameters: { gameId: GAME }, body: JSON.stringify({}),
      });
      const round = String(get('STATE').LessonNumber).padStart(3, '0');
      served.push(get(`QUESTION#${round}#REF`).SourceQuestionId);
      put({ PK, SK: 'STATE', State: `RESULTS#${round}`, LessonNumber: Number(round) });
    }
    assert.deepStrictEqual(served, predicted,
      'the room got a different order from the one the host was shown');
  });

  await check('and a queued question is served where the preview put it', async () => {
    seed({ isRandom: true });
    put({ PK, SK: 'QUEUE', Queue: ['c002#004'], Version: 1 });
    const { body } = await peek(2);
    const predicted = ids(body);

    const served = [];
    for (let i = 0; i < 2; i += 1) {
      await nextQuestion.handler({
        pathParameters: { gameId: GAME }, body: JSON.stringify({}),
      });
      const round = String(get('STATE').LessonNumber).padStart(3, '0');
      served.push(get(`QUESTION#${round}#REF`).SourceQuestionId);
      put({ PK, SK: 'STATE', State: `RESULTS#${round}`, LessonNumber: Number(round) });
    }
    assert.deepStrictEqual(served, predicted);
  });

  console.log('\n§5  the edges');

  await check('an unknown game is a 404, not a crash', async () => {
    store.clear();
    const res = await upNext.handler({ pathParameters: { gameId: '0000' } });
    assert.strictEqual(res.statusCode, 404);
  });

  await check('a missing gameId is a 400', async () => {
    const res = await upNext.handler({ pathParameters: {} });
    assert.strictEqual(res.statusCode, 400);
  });

  await check('a spent set returns a SHORT list, not padding', async () => {
    seed({ hostMask: '10000000' });
    for (let i = 1; i <= 4; i += 1) {
      put({
        PK, SK: `QUESTION#00${i}#REF`,
        SourceQuestionId: `QUESTION#c001#00${i}`, SetId: SET, QuestionNumber: `00${i}`,
      });
    }
    const { body } = await peek(5);
    // rejects: inventing rows to reach `count`. Running out is the fact the
    // host most wants to see coming.
    assert.strictEqual(body.upNext.length, 0);
  });

  await check('OPTIONS is answered', async () => {
    const res = await upNext.handler({
      requestContext: { http: { method: 'OPTIONS' } }, pathParameters: { gameId: GAME },
    });
    assert.strictEqual(res.statusCode, 200);
  });

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
})();
