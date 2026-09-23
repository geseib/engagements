/**
 * THE PLATFORM METRICS ARE RECORDED BY THE REAL HANDLERS.
 *
 * tests/platform-metrics.js proves the recorders count correctly when called.
 * This proves they ARE called, from the four places the events happen, by
 * driving the real handlers over one fake table and reading the counter rows:
 *
 *   created   websocket/create-game.js     POST /games
 *   started   game/session-start.js        both doors: POST start, and
 *                                          next-question from CREATED
 *   served    game/next-question.js        each round put on screen
 *   answered  websocket/message.js         each NEW answer row
 *
 * A usage meter that was defined and never called is exactly what shipped once
 * already here: recordBillableSession had no call site for a month
 * (tests/billable-session-wiring.js). A counter nobody calls reads as "nobody
 * used Engage", which is worse than no counter.
 *
 * Every check carries a `// rejects:` line naming the change it catches.
 */
const path = require('path');
const fs = require('fs');
const assert = require('assert');

const REPO = path.join(__dirname, '..');
const { createTable, installStubs } = require('./helpers/player-table');

// KMS, faked, and registered before any handler loads: the org's index row and
// an org session's answers are envelopes at rest.
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

const M = require(path.join(REPO, 'lambda-functions/game/platform-metrics.js'));
const createGame = require(path.join(REPO, 'lambda-functions/websocket/create-game.js')).handler;
const startGame = require(path.join(REPO, 'lambda-functions/game/start-game.js')).handler;
const nextQuestion = require(path.join(REPO, 'lambda-functions/game/next-question.js')).handler;
const wsMessage = require(path.join(REPO, 'lambda-functions/websocket/message.js')).handler;

if (!process.env.DEBUG) { console.log = () => {}; console.warn = () => {}; console.error = () => {}; }
const say = (...a) => process.stdout.write(`${a.join(' ')}\n`);

let pass = 0; let fail = 0;
async function check(label, fn) {
  try { await fn(); say(`  PASS  ${label}`); pass += 1; } catch (e) { say(`  FAIL  ${label}\n        ${e.message}`); fail += 1; }
}

/* ---- fixtures ------------------------------------------------------------- */

const ACME = 'org_acme';
const SET = 'set-alpha';
const SETPK = `SET#${SET}`;
const SECRET = 'Acme Restructure Q3';

const asHost = (orgId, extra = {}) => ({
  requestContext: { authorizer: { lambda: { userId: `user-${orgId}`, orgId, orgRole: 'admin', groups: 'hosts' } } },
  ...extra,
});

const period = M.periodOf(new Date());
const month = () => store.get(table.keyOf(M.METRICS_PK, M.monthSk(period))) || {};
const category = (key) => store.get(table.keyOf(M.METRICS_PK, M.categorySk(period, key))) || {};

/** A CREATED session made by the real creator, playing a legacy platform set. */
async function createdSession() {
  const res = await createGame(asHost(ACME, {
    body: JSON.stringify({ eventTitle: SECRET, gameType: 'call-and-answer' }),
  }));
  assert.strictEqual(res.statusCode, 201, `create failed: ${res.body}`);
  const { gameId } = JSON.parse(res.body);
  const PK = `GAME#${gameId}`;
  Object.assign(store.get(table.keyOf(PK, 'METADATA')), { QuestionSetId: SET });
  table.put({
    PK, SK: 'STATE#CATS',
    'AvailMask1-8': '10000000', 'AvailMask9-16': '00000000', 'AvailMask17-24': '00000000',
    'HostMask1-8': '10000000', 'HostMask9-16': '00000000', 'HostMask17-24': '00000000',
  });
  table.put({ PK, SK: 'CATEGORY#c001#ACTIVE', ActiveIndex: 0, QuestionCount: 3 });
  table.put({ PK, SK: 'CATEGORY#c001#ORDER', QuestionOrder: ['001', '002', '003'], IsRandomized: false });
  table.put({ PK, SK: 'STATE#CATS#COUNTS', '1-8': [3], '9-16': [], '17-24': [], TotalEnabled: 3, TotalRemaining: 3, Version: 1 });
  table.put({ PK: SETPK, SK: 'CATEGORY#c001', Name: 'Pricing' });
  for (const n of ['001', '002', '003']) {
    // The real shape: QUESTION#<categoryId>#<nnn> (admin/upload-questions.js).
    table.put({ PK: SETPK, SK: `QUESTION#c001#${n}`, Category: 'Pricing', title: `Question ${n}` });
  }
  return gameId;
}

const press = (gameId, body = {}) => nextQuestion(asHost(ACME, {
  pathParameters: { gameId },
  body: JSON.stringify(body),
}));

const answer = (gameId, playerName, text, q = '001') => wsMessage({
  requestContext: { connectionId: `conn-${playerName}` },
  body: JSON.stringify({ messageType: `ANSWER#${q}`, gameId, playerName, answer: text, answerType: 'text' }),
});

/* ========================================================================== */

(async () => {
  say('\nplatform-metrics wiring: the real handlers record what happened\n');

  say('1. a session is created');
  store.clear();
  const gameId = await createdSession();
  // rejects: create-game.js not calling recordSessionCreated after a create.
  await check('POST /games counts one session created', () => {
    assert.strictEqual(month().sessionsCreated, 1);
  });

  say('\n2. it is started, once');
  const started = await startGame(asHost(ACME, { pathParameters: { gameId } }));
  await check('POST start counts one session started', () => {
    assert.strictEqual(started.statusCode, 200, started.body);
    assert.strictEqual(month().sessionsStarted, 1);
  });
  // rejects: a refused second start (the session is not CREATED any more)
  // counting anyway.
  await check('a second Start is refused and counts nothing', async () => {
    const again = await startGame(asHost(ACME, { pathParameters: { gameId } }));
    assert.strictEqual(again.statusCode, 400, again.body);
    assert.strictEqual(month().sessionsStarted, 1);
  });

  say('\n3. questions are served');
  const first = await press(gameId);
  // rejects: next-question.js not calling recordRoundServed on a served round.
  await check('the first round is one question served, by one session', () => {
    assert.strictEqual(first.statusCode, 200, first.body);
    assert.strictEqual(month().roundsServed, 1);
    assert.strictEqual(month().sessionsServed, 1);
  });
  await check('…counted under the platform set’s category name', () => {
    const rows = [...store.values()].filter((r) => r.PK === M.METRICS_PK).map((r) => `${r.SK}:${r.label || ''}`);
    assert.strictEqual(category('platform#pricing').rounds, 1, `metrics rows: ${rows.join(' | ')}`);
  });
  // rejects: counting a press that served nothing new.
  await check('pressing again mid-round serves nothing and counts nothing', async () => {
    const dup = await press(gameId);
    assert.strictEqual(JSON.parse(dup.body).message, 'Already asking a question');
    assert.strictEqual(month().roundsServed, 1);
  });

  say('\n4. answers arrive');
  await answer(gameId, 'Ada', 'first thought');
  await answer(gameId, 'Bob', 'another view');
  // rejects: message.js not calling recordAnswerStored after the Put.
  await check('two players answering is two answers', () => {
    assert.strictEqual(month().answersStored, 2);
    assert.strictEqual(category('platform#pricing').answers, 2);
  });
  // rejects: the answer Put not asking for ALL_OLD, which makes every
  // resubmission look new.
  await check('Ada changing her answer does not count again', async () => {
    await answer(gameId, 'Ada', 'second thought');
    assert.strictEqual(month().answersStored, 2);
  });

  const second = await press(gameId, { action: 'skip' });
  await check('round two is a second question, from the SAME session', () => {
    assert.strictEqual(second.statusCode, 200, second.body);
    assert.strictEqual(month().roundsServed, 2);
    assert.strictEqual(month().sessionsServed, 1);
  });

  say('\n5. the lobby door starts it too');
  const lobbyGame = await createdSession();
  const lobby = await press(lobbyGame);
  // rejects: counting a start only on POST start — the phone remote's
  // "Start First Round" is next-question from CREATED.
  await check('"Start First Round" from CREATED counts a start AND a question', () => {
    assert.strictEqual(lobby.statusCode, 200, lobby.body);
    assert.strictEqual(month().sessionsCreated, 2);
    assert.strictEqual(month().sessionsStarted, 2);
    assert.strictEqual(month().sessionsServed, 2);
    assert.strictEqual(month().roundsServed, 3);
  });

  say('\n6. what the counters hold');
  // rejects: a session title, org id or answer riding into a metrics row.
  await check('no metrics row carries a title, an org, a session code or an answer', () => {
    const text = JSON.stringify([...store.values()].filter((r) => r.PK === M.METRICS_PK));
    for (const s of [SECRET, ACME, gameId, lobbyGame, 'first thought', 'Ada']) {
      assert.ok(!text.includes(s), `a metrics row contains ${JSON.stringify(s)}`);
    }
  });

  say('\n7. one call per event site');
  // rejects: a second call slipped in beside the first (a double count), or
  // the call moved out of the module into hand-rolled writes.
  const calls = (file, fn) => (fs.readFileSync(path.join(REPO, file), 'utf8').match(new RegExp(`\\b${fn}\\(`, 'g')) || []).length;
  for (const [file, fn] of [
    ['lambda-functions/websocket/create-game.js', 'recordSessionCreated'],
    ['lambda-functions/game/session-start.js', 'recordSessionStarted'],
    ['lambda-functions/game/next-question.js', 'recordRoundServed'],
    ['lambda-functions/websocket/message.js', 'recordAnswerStored'],
  ]) {
    await check(`${file} calls ${fn} exactly once`, () => assert.strictEqual(calls(file, fn), 1));
  }
  await check('start-game.js does not count on its own — session-start.js does, for both doors', () => {
    assert.strictEqual(calls('lambda-functions/game/start-game.js', 'recordSessionStarted'), 0);
  });

  say(`\n${pass} passed, ${fail} failed\n`);
  if (fail) process.exit(1);
})().catch((e) => { say(e.stack); process.exit(1); });
