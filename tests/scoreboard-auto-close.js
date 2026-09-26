/**
 * THE SCOREBOARD CLOSES ITSELF WHEN A NEW QUESTION STARTS.
 *
 * Owner, 2026-09-25: "yes, auto close" (spec §3). The close is the SERVER's,
 * in next-question.js — the one writer that opens a round — so every path that
 * starts a question agrees: the dock, the phone remote, auto mode, "Choose
 * next question" and skip all go through it. A client-only close would leave a
 * refreshed host page, and the phone polling /state, showing a board the stage
 * had put away.
 *
 *   §1  an open board: next question → STATE.Scoreboard.open is false, the
 *       revision counts up, `scoreboardChanged` says closed (sent before
 *       `questionStarted`), and get-game-state reads it closed — which is what
 *       the phone's /state poll sees.
 *   §2  a closed board: nothing is written for it and no frame is sent.
 *   §3  the look survives the close, so reopening comes back in it.
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
const getGameState = require(path.join(REPO, 'lambda-functions/game/get-game-state.js')).handler;

if (!process.env.DEBUG) { console.log = () => {}; console.warn = () => {}; console.error = () => {}; }
const say = (...a) => process.stdout.write(a.join(' ') + '\n');

let pass = 0, fail = 0;
async function check(label, fn) {
  try { await fn(); say(`  PASS  ${label}`); pass++; }
  catch (e) { say(`  FAIL  ${label}\n        ${e.message}`); fail++; }
}

const ACME = 'org_acme';
const SET = 'set-alpha';
const SETPK = `SET#${SET}`;

const asHost = (orgId, extra = {}) => ({
  requestContext: { authorizer: { lambda: { userId: `user-${orgId}`, orgId, orgRole: 'admin', groups: 'hosts' } } },
  ...extra,
});
const row = (pk, sk) => store.get(table.keyOf(pk, sk));

/** A trivia session with one category of three questions, as round-ref-lives-with-session.js builds it. */
async function session() {
  store.clear();
  sent.length = 0;
  const res = await createGame(asHost(ACME, {
    body: JSON.stringify({ eventTitle: 'Quiz night', gameType: 'trivia' }),
  }));
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
  table.put({ PK, SK: 'STATE#CATS#COUNTS', '1-8': [3], '9-16': [], '17-24': [], TotalEnabled: 3, TotalRemaining: 3, Version: 1 });
  table.put({ PK: SETPK, SK: 'CATEGORY#c001', Name: 'Pricing' });
  // Somebody listening, so the frames have somewhere to go.
  table.put({ PK, SK: 'CONNECTION#host-1', ConnectionId: 'host-1', ConnectionType: 'HOST' });
  for (const n of ['001', '002', '003']) {
    table.put({ PK: SETPK, SK: `QUESTION#c001#${n}`, Category: 'Pricing', Title: `Question ${n}` });
  }
  return gameId;
}

const press = (gameId) => nextQuestion(asHost(ACME, { pathParameters: { gameId }, body: JSON.stringify({}) }));
const readState = async (gameId) => JSON.parse((await getGameState({
  pathParameters: { gameId }, queryStringParameters: { role: 'host' },
})).body);

(async () => {
  say('\n1. an open board closes when the next question starts');
  const gameId = await session();
  const PK = `GAME#${gameId}`;
  const first = await press(gameId);
  assert.strictEqual(first.statusCode, 200, `round 1 did not start: ${first.body}`);
  // Round 1 is over and the host has the board up, in the tote look.
  Object.assign(row(PK, 'STATE'), {
    State: 'RESULTS#001',
    Scoreboard: { open: true, style: 'tote', page: 1, openedAt: '2026-09-25T19:00:00.000Z' },
    ScoreboardRev: 4,
  });
  sent.length = 0;

  const second = await press(gameId);
  await check('the question starts', () => {
    assert.strictEqual(second.statusCode, 200, second.body);
    assert.strictEqual(row(PK, 'STATE').State, 'ASK#002');
  });
  await check('STATE.Scoreboard.open is false', () => assert.strictEqual(row(PK, 'STATE').Scoreboard.open, false));
  await check('the close counts a revision (4 → 5)', () => assert.strictEqual(row(PK, 'STATE').ScoreboardRev, 5));
  await check('the look survives, so reopening comes back in it', () =>
    assert.strictEqual(row(PK, 'STATE').Scoreboard.style, 'tote'));
  const frame = sent.find((m) => m.type === 'scoreboardChanged');
  await check('the room is told: scoreboardChanged, closed, with the revision', () => {
    assert.ok(frame, `no scoreboardChanged frame among ${sent.map((m) => m.type).join(', ')}`);
    assert.strictEqual(frame.open, false);
    assert.strictEqual(frame.rev, 5);
    assert.strictEqual(frame.gameId, gameId);
  });
  await check('...before the question itself, so the board is down when it lands', () => {
    const closeAt = sent.findIndex((m) => m.type === 'scoreboardChanged');
    const askAt = sent.findIndex((m) => m.type === 'questionStarted');
    assert.ok(closeAt !== -1, 'scoreboardChanged was sent');
    assert.ok(askAt !== -1, 'questionStarted was sent');
    assert.ok(closeAt < askAt, `scoreboardChanged at ${closeAt}, questionStarted at ${askAt}`);
  });
  const back = await readState(gameId);
  await check('get-game-state — the phone\'s poll and a reload — reads it closed', () => {
    assert.strictEqual(back.scoreboard.open, false);
    assert.strictEqual(back.scoreboard.rev, 5);
    assert.strictEqual(back.state, 'ASK#002');
  });

  say('\n2. a closed board is left alone');
  sent.length = 0;
  Object.assign(row(PK, 'STATE'), { State: 'RESULTS#002' });
  const third = await press(gameId);
  await check('the question starts', () => assert.strictEqual(third.statusCode, 200, third.body));
  await check('no revision is spent on a board that was already down', () =>
    assert.strictEqual(row(PK, 'STATE').ScoreboardRev, 5));
  await check('and no frame is sent for it', () =>
    assert.strictEqual(sent.filter((m) => m.type === 'scoreboardChanged').length, 0));

  say('\n3. a session that never opened a board');
  const fresh = await session();
  sent.length = 0;
  await press(fresh);
  await check('nothing is written for the board', () => {
    assert.strictEqual(row(`GAME#${fresh}`, 'STATE').Scoreboard, undefined);
    assert.strictEqual(row(`GAME#${fresh}`, 'STATE').ScoreboardRev, undefined);
  });

  say(`\n${pass} passed, ${fail} failed`);
  suiteFinished();
  process.exit(fail === 0 ? 0 : 1);
})().catch((e) => { say(e && e.stack); process.exit(1); });
