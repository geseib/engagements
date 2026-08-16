/**
 * NAMING ONE QUESTION USED TO BREAK THE CATEGORY IT CAME FROM.
 *
 * `Ask next` in the session panel sends `action: 'select_specific'` (or
 * `skip_to_specific` mid-round). The handler could not answer "where is the
 * auto-selector up to?" for a question the host reached past it to name, so it
 * invented an answer:
 *
 *     activeIndex: 0,       // Will be updated when we increment it
 *     questionCount: 1,     // Not relevant for specific selection
 *
 * The comment on the second is correct about the intent and wrong about the
 * effect, because two blocks downstream read both as though they were real:
 *
 *   §1  `SET ActiveIndex = activeIndex + 1` wrote **1** onto
 *       `CATEGORY#<id>#ACTIVE`, overwriting wherever the cursor actually was.
 *       A category worked through to position 5 was reset to 1, and the next
 *       five automatic picks re-served questions the room had already answered.
 *
 *   §2  `if (activeIndex + 1 >= questionCount)` is `1 >= 1` — TRUE for every
 *       specific pick ever made — so each one zeroed that category's AvailMask
 *       bit and the automatic path never offered the category again. Pick one
 *       question out of forty and the other thirty-nine become unreachable.
 *
 * §3 is the other half of the fix, and the half a careless repair would break:
 * a category the AUTOMATIC path genuinely exhausts must still be marked. A test
 * that only proves the two writes stopped happening would pass just as well
 * against a handler that never marks anything exhausted at all.
 *
 * §4 pins the bookkeeping that SHOULD still happen, for the same reason.
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

/* ---- Harness -------------------------------------------------------------- */

let pass = 0, fail = 0;
async function check(label, fn) {
  try { await fn(); console.log(`  PASS  ${label}`); pass++; }
  catch (e) { console.log(`  FAIL  ${label}\n        ${e.message}`); fail++; }
}

const GAME = '4821';
const SET = 'set-alpha';
const PK = `GAME#${GAME}`;
const SETPK = `SET#${SET}`;

const put = (item) => { store.set(table.keyOf(item.PK, item.SK), item); };
const get = (sk) => store.get(table.keyOf(PK, sk));

/**
 * The fixture is built from what the WRITERS actually write, not from what the
 * handler under test happens to read — `config/sessionHistory.js:170-195`
 * records what an invented fixture cost this repo once already.
 *
 * Two categories, so §2 can prove the damage is confined to the one the picked
 * question belongs to, and §3 can exhaust the other one honestly.
 */
function seed({ activeIndex = 5 } = {}) {
  store.clear();
  sent.length = 0;

  put({ PK, SK: 'METADATA', QuestionSetId: SET });
  put({ PK, SK: 'STATE', State: 'RESULTS#001', LessonNumber: 1 });

  // Both categories available: bit 1 = c001, bit 2 = c002.
  put({
    PK, SK: 'STATE#CATS',
    'AvailMask1-8': '11000000',
    'AvailMask9-16': '00000000',
    'AvailMask17-24': '00000000',
    'HostMask1-8': '11000000',
    'HostMask9-16': '00000000',
    'HostMask17-24': '00000000',
  });

  put({ PK: SETPK, SK: 'CATEGORY#c001', Name: 'Pricing' });
  put({ PK: SETPK, SK: 'CATEGORY#c002', Name: 'Packaging' });

  // The cursor the bug destroyed. 5 is deliberately not 0 and not 1 — with the
  // fabricated pair the handler wrote exactly 1, so a fixture starting at 0
  // would make the clobber almost invisible.
  put({ PK, SK: 'CATEGORY#c001#ACTIVE', ActiveIndex: activeIndex, QuestionCount: 40 });
  put({ PK, SK: 'CATEGORY#c002#ACTIVE', ActiveIndex: 0, QuestionCount: 3 });

  put({ PK: SETPK, SK: 'QUESTION#017', Category: 'Pricing', title: 'Seventeen' });
  put({ PK: SETPK, SK: 'QUESTION#018', Category: 'Pricing', title: 'Eighteen' });

  put({
    PK, SK: 'STATE#CATS#COUNTS',
    '1-8': [40, 3], '9-16': [], '17-24': [],
    TotalEnabled: 43, TotalRemaining: 43, Version: 1,
  });
}

const ask = (body) => nextQuestion.handler({
  pathParameters: { gameId: GAME },
  body: JSON.stringify(body),
});

/* ========================================================================== */

(async () => {
  console.log('\n§1  the automatic cursor survives a specific pick');

  await check('ActiveIndex is left where it was, not reset to 1', async () => {
    seed({ activeIndex: 5 });
    const res = await ask({ questionId: '017', action: 'select_specific' });
    assert.strictEqual(res.statusCode, 200, res.body);
    assert.strictEqual(get('CATEGORY#c001#ACTIVE').ActiveIndex, 5,
      'the specific pick moved the automatic selector');
  });

  await check('a mid-round skip_to_specific leaves it alone too', async () => {
    seed({ activeIndex: 5 });
    store.get(table.keyOf(PK, 'STATE')).State = 'ASK#001';
    const res = await ask({ questionId: '017', action: 'skip_to_specific' });
    assert.strictEqual(res.statusCode, 200, res.body);
    assert.strictEqual(get('CATEGORY#c001#ACTIVE').ActiveIndex, 5);
  });

  await check('a cursor at 0 is still not advanced', async () => {
    // The value the old code coincidentally almost got right. Without this the
    // whole section passes against a handler that writes `activeIndex` back
    // unchanged instead of not writing at all.
    seed({ activeIndex: 0 });
    await ask({ questionId: '017', action: 'select_specific' });
    assert.strictEqual(get('CATEGORY#c001#ACTIVE').ActiveIndex, 0);
  });

  console.log('\n§2  the category is not marked exhausted');

  await check('its AvailMask bit is still set after one specific pick', async () => {
    seed();
    await ask({ questionId: '017', action: 'select_specific' });
    assert.strictEqual(get('STATE#CATS')['AvailMask1-8'], '11000000',
      'the specific pick disabled the category it came from');
  });

  await check('two specific picks in a row still leave it available', async () => {
    seed();
    await ask({ questionId: '017', action: 'select_specific' });
    store.get(table.keyOf(PK, 'STATE')).State = 'RESULTS#002';
    await ask({ questionId: '018', action: 'select_specific' });
    assert.strictEqual(get('STATE#CATS')['AvailMask1-8'], '11000000');
  });

  await check('the OTHER category is untouched as well', async () => {
    seed();
    await ask({ questionId: '017', action: 'select_specific' });
    assert.strictEqual(get('CATEGORY#c002#ACTIVE').ActiveIndex, 0);
  });

  console.log('\n§3  a genuinely exhausted category is STILL marked');

  await check('the automatic path zeroes the bit on the last question', async () => {
    /*
      THE HALF A CARELESS FIX BREAKS. Everything above is satisfied by a
      handler that simply never writes AvailMask — including one that has
      stopped marking exhaustion entirely. This drives the automatic path to
      the end of a category and requires the bit to drop.
    */
    seed();
    // c002 has 3 questions and the cursor is at its last one.
    store.set(table.keyOf(PK, 'CATEGORY#c002#ACTIVE'),
      { PK, SK: 'CATEGORY#c002#ACTIVE', ActiveIndex: 2, QuestionCount: 3 });
    // Only c002 is host-enabled, so the automatic selector must choose it.
    const cats = store.get(table.keyOf(PK, 'STATE#CATS'));
    cats['HostMask1-8'] = '01000000';
    cats['AvailMask1-8'] = '01000000';
    put({ PK: SETPK, SK: 'QUESTION#031', Category: 'Packaging', title: 'Thirty-one' });
    put({ PK, SK: 'CATEGORY#c002#ORDER', QuestionOrder: ['031'], IsRandomized: false });

    const res = await ask({});
    assert.strictEqual(res.statusCode, 200, res.body);
    assert.strictEqual(get('STATE#CATS')['AvailMask1-8'], '00000000',
      'an exhausted category was left available — the fix went too far');
  });

  console.log('\n§4  the bookkeeping that SHOULD still happen, does');

  await check('the question is served and the state advances', async () => {
    seed();
    const res = await ask({ questionId: '017', action: 'select_specific' });
    const body = JSON.parse(res.body);
    assert.strictEqual(body.success, true, res.body);
    assert.match(get('STATE').State, /^ASK#/,
      'a specific pick must still put the game into ASK');
    assert.strictEqual(get('STATE').CurrentQuestionId, 'QUESTION#017');
  });

  await check('the remaining-count still drops — the question WAS asked', async () => {
    seed();
    const before = get('STATE#CATS#COUNTS')['1-8'][0];
    await ask({ questionId: '017', action: 'select_specific' });
    const after = get('STATE#CATS#COUNTS')['1-8'][0];
    assert.strictEqual(after, before - 1,
      'gating the cursor writes must not also gate the honest count');
  });

  /* ---- summary ----------------------------------------------------------- */
  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail === 0 ? 1 && 0 : 1);
})();
