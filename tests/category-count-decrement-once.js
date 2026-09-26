/**
 * A ROUND TAKES ONE QUESTION OFF ITS CATEGORY'S COUNT — ONCE, WHEN IT IS ASKED.
 *
 * STATE#CATS#COUNTS is what the host's category picker and "questions left"
 * read. next-question.js decrements it the moment a round is ASKED and stamps
 * `CategoryCountDecremented` on QUESTION#nnn#RESULTS so it is never done twice.
 *
 * get-results.js carried a second copy that ran when the round was CLOSED, and
 * it trusted that flag to stand it down. It could not: the call-and-answer
 * branch PUTS QUESTION#nnn#RESULTS whole just before the call, which throws
 * the flag away, and so does every participant's read of the resolved round
 * on the public route (PlayerPage fetches it the moment the room enters
 * RESULTS). The only thing that kept that copy from decrementing again — once
 * on close, and again per phone — was a temporal-dead-zone ReferenceError
 * (`const totalRemaining = totalEnabled` above `let totalEnabled`), thrown on
 * every call-and-answer close and swallowed into the log.
 *
 * So the ask-time decrement is the one that counts, and nothing at close may
 * touch the count at all:
 *
 *   §1  call-and-answer: asked → the count drops by one. Closed by the host,
 *       then read by two phones → the count does not move, get-results never
 *       reads or writes STATE#CATS#COUNTS, and nothing is logged as an error.
 *   §2  trivia: the same, through handleTriviaResults.
 *   §3  a second round drops it by exactly one more.
 *
 * WHY DELETE RATHER THAN FIX THE ORDERING. With the TDZ line moved below the
 * loops, this suite's §1 took round 001 from 2 left to 0 — the host's close
 * and each phone's read each took one — and the next press ENDED the session
 * with two questions unplayed.
 *
 * rejects: any decrement in get-results.js, working or broken.
 */
const suiteFinished = require('./helpers/finish-guard');
const path = require('path');
const assert = require('assert');

const REPO = path.join(__dirname, '..');
const { createTable, installStubs } = require('./helpers/player-table');

const kmsStubs = require('./helpers/tenant-crypto-stub');
const kms = kmsStubs.makeKmsStub();
for (const base of [REPO, path.join(REPO, 'lambda-functions'), path.join(REPO, 'lambda-functions', 'game'), path.join(REPO, 'lambda-functions', 'websocket')]) {
  let p;
  try { p = require.resolve('@aws-sdk/client-kms', { paths: [base] }); } catch { continue; }
  require.cache[p] = { id: p, filename: p, loaded: true, exports: kms.exports };
}

const table = createTable();
const store = table.store;
const sent = [];
installStubs({ table, sent });
process.env.TABLE_NAME = 'test-table';
process.env.WEBSOCKET_API_ENDPOINT = 'https://ws.test.invalid/dev';
kmsStubs.installTestKeyLoader();

const createGame = require(path.join(REPO, 'lambda-functions/websocket/create-game.js')).handler;
const nextQuestion = require(path.join(REPO, 'lambda-functions/game/next-question.js')).handler;
const getResults = require(path.join(REPO, 'lambda-functions/game/get-results.js')).handler;
const { encryptItem } = require(path.join(REPO, 'lambda-functions/game/tenant-crypto.js'));

// Quiet, but the errors are kept: a swallowed ReferenceError is the evidence.
const errors = [];
console.error = (...a) => { errors.push(a.map(String).join(' ')); if (process.env.DEBUG) process.stderr.write(`${a.map((x) => (x && x.stack) || x).join(' ')}\n`); };
if (!process.env.DEBUG) { console.log = () => {}; console.warn = () => {}; }
const say = (...a) => process.stdout.write(a.join(' ') + '\n');

let pass = 0, fail = 0;
async function check(label, fn) {
  try { await fn(); say(`  PASS  ${label}`); pass++; }
  catch (e) { say(`  FAIL  ${label}\n        ${e.message}`); fail++; }
}

const ACME = 'org_acme';
const SET = 'set-alpha';
const SETPK = `SET#${SET}`;
const COUNTS = 'STATE#CATS#COUNTS';

const asHost = (extra = {}) => ({
  requestContext: { authorizer: { lambda: { userId: `user-${ACME}`, orgId: ACME, orgRole: 'admin', groups: 'hosts' } } },
  ...extra,
});
const row = (pk, sk) => store.get(table.keyOf(pk, sk));

/** One category of three questions, as scoreboard-auto-close.js builds it. */
async function session(gameType) {
  store.clear();
  sent.length = 0;
  const res = await createGame(asHost({ body: JSON.stringify({ eventTitle: 'Count night', gameType }) }));
  assert.strictEqual(res.statusCode, 201, `create failed: ${res.body}`);
  const { gameId } = JSON.parse(res.body);
  const PK = `GAME#${gameId}`;
  Object.assign(row(PK, 'METADATA'), { QuestionSetId: SET });
  table.put({
    PK, SK: 'STATE#CATS',
    'AvailMask1-8': '10000000', 'AvailMask9-16': '00000000', 'AvailMask17-24': '00000000',
    'HostMask1-8': '10000000', 'HostMask9-16': '00000000', 'HostMask17-24': '00000000',
  });
  table.put({ PK, SK: 'CATEGORY#c001#ACTIVE', ActiveIndex: 0, QuestionCount: 3 });
  table.put({ PK, SK: 'CATEGORY#c001#ORDER', QuestionOrder: ['001', '002', '003'], IsRandomized: false });
  table.put({ PK, SK: COUNTS, '1-8': [3], '9-16': [], '17-24': [], TotalEnabled: 3, TotalRemaining: 3, Version: 1 });
  table.put({ PK: SETPK, SK: 'CATEGORY#c001', Name: 'Pricing' });
  table.put({ PK, SK: 'CONNECTION#host-1', ConnectionId: 'host-1', ConnectionType: 'HOST' });
  for (const n of ['001', '002', '003']) {
    table.put({ PK: SETPK, SK: `QUESTION#c001#${n}`, Category: 'Pricing', Title: `Question ${n}`, correctAnswer: 'OptionA', optionA: 'Yes', optionB: 'No' });
  }
  return gameId;
}

const ask = async (gameId) => {
  const res = await nextQuestion(asHost({ pathParameters: { gameId }, body: JSON.stringify({}) }));
  assert.strictEqual(res.statusCode, 200, `the round did not start: ${res.body}`);
  // The round number, as the room spells it: ASK#001 → '001'.
  const state = row(`GAME#${gameId}`, 'STATE').State;
  assert.match(state, /^ASK#\d{3}$/, `STATE is ${state}`);
  return state.split('#')[1];
};
const closeAsHost = (gameId, q) => getResults(asHost({
  routeKey: 'POST /games/{gameId}/close-round',
  requestContext: {
    routeKey: 'POST /games/{gameId}/close-round',
    authorizer: { lambda: { userId: `user-${ACME}`, orgId: ACME, orgRole: 'admin', groups: 'hosts' } },
  },
  pathParameters: { gameId },
  body: JSON.stringify({ questionNumber: q }),
}));
const readAsPhone = (gameId, q) => getResults({ body: JSON.stringify({ gameId, questionNumber: q }) });

/** Somebody answered, and (call-and-answer) somebody else ranked it first. */
async function seedRound(gameId, q, gameType) {
  const PK = `GAME#${gameId}`;
  table.put(await encryptItem(ACME, 'answer', {
    PK, SK: `QUESTION#${q}#ANSWER#Ada`, PlayerName: 'Ada', Answer: gameType === 'trivia' ? 'A' : 'Sell the barn',
    ...(gameType === 'trivia' ? { IsCorrect: true, PointsEarned: 10, BasePoints: 10 } : {}),
    SubmittedAt: new Date().toISOString(),
  }));
  if (gameType !== 'trivia') {
    table.put(await encryptItem(ACME, 'vote', { PK, SK: `QUESTION#${q}#VOTE#Bob`, PlayerName: 'Bob', Votes: { 0: 1 } }));
  }
}

const counts = (gameId) => {
  const c = row(`GAME#${gameId}`, COUNTS);
  return { left: c['1-8'][0], totalRemaining: c.TotalRemaining, totalEnabled: c.TotalEnabled };
};
/** Every command the table saw since `from` that read or wrote the count row. */
const countTouches = (from) => table.log.slice(from)
  .filter((c) => (c.input.Key && c.input.Key.SK === COUNTS) || (c.input.Item && c.input.Item.SK === COUNTS))
  .map((c) => c.type);

async function closeAndRead(label, gameId, q, expectLeft) {
  const logFrom = table.log.length;
  const errorsFrom = errors.length;
  const closed = await closeAsHost(gameId, q);
  await check(`${label}: the host closes the round`, () => {
    assert.strictEqual(closed.statusCode, 200, closed.body);
    assert.strictEqual(row(`GAME#${gameId}`, 'STATE').State, `RESULTS#${q}`);
  });
  for (const phone of ['phone 1', 'phone 2']) {
    const read = await readAsPhone(gameId, q);
    await check(`${label}: ${phone} reads the resolved round`, () => assert.strictEqual(read.statusCode, 200, read.body));
  }
  await check(`${label}: the count has not moved since the question was asked (${expectLeft} left)`, () => {
    const c = counts(gameId);
    assert.strictEqual(c.left, expectLeft, `category count is ${c.left}, expected ${expectLeft}`);
    assert.strictEqual(c.totalRemaining, expectLeft, `TotalRemaining is ${c.totalRemaining}, expected ${expectLeft}`);
    assert.strictEqual(c.totalEnabled, expectLeft, `TotalEnabled is ${c.totalEnabled}, expected ${expectLeft}`);
  });
  await check(`${label}: closing and reading never reads or writes ${COUNTS}`, () => {
    const touched = countTouches(logFrom);
    assert.deepStrictEqual(touched, [], `get-results touched the count row: ${touched.join(', ')}`);
  });
  await check(`${label}: nothing is logged as an error`, () => {
    const logged = errors.slice(errorsFrom);
    assert.deepStrictEqual(logged, [], `logged:\n        ${logged.join('\n        ')}`);
  });
}

(async () => {
  for (const [n, gameType] of [[1, 'call-and-answer'], [2, 'trivia']]) {
    say(`\n${n}. ${gameType}: asking takes one off the count, closing takes none`);
    const gameId = await session(gameType);
    const q = await ask(gameId);
    await check(`${gameType}: asking round ${q} takes exactly one question off (3 → 2)`, () => {
      const c = counts(gameId);
      assert.strictEqual(c.left, 2, `category count is ${c.left}`);
      assert.strictEqual(c.totalRemaining, 2, `TotalRemaining is ${c.totalRemaining}`);
    });
    await check(`${gameType}: …and marks the round so it is never taken twice`, () =>
      assert.strictEqual(row(`GAME#${gameId}`, `QUESTION#${q}#RESULTS`).CategoryCountDecremented, true));
    await seedRound(gameId, q, gameType);
    await closeAndRead(`${gameType} round ${q}`, gameId, q, 2);

    if (gameType === 'call-and-answer') {
      say('\n3. a second round takes exactly one more');
      const q2 = await ask(gameId);
      await check(`round ${q2}: asking takes one more off (2 → 1)`, () => assert.strictEqual(counts(gameId).left, 1));
      await seedRound(gameId, q2, gameType);
      await closeAndRead(`call-and-answer round ${q2}`, gameId, q2, 1);
    }
  }

  say(`\n${pass} passed, ${fail} failed`);
  suiteFinished();
  process.exit(fail === 0 ? 0 : 1);
})().catch((e) => { say(e && e.stack); process.exit(1); });
