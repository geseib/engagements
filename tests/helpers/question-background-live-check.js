/**
 * SECTION 3 OF tests/question-background.js: "never served live".
 *
 * A copy of the harness in tests/round-ref-lives-with-session.js — the KMS
 * stub, `createTable`/`installStubs`, `createGame`, `nextQuestion`,
 * `getQuestion`, `getGameState`, `createdSession`, `press` — because opening a
 * round is the only way to prove a Background never reaches a live payload:
 * asserting against a handler in isolation would only prove it isn't in the
 * fields that handler happens to name, not that no path serves it.
 *
 * THE KMS STUB MUST BE IN require.cache BEFORE ANY HANDLER LOADS. This module
 * does that at require-time, below, which is why tests/question-background.js
 * requires it at the very top of the file — before section 2 requires any
 * tenant-crypto.js copy. createGame encrypts the session's Title/HostName
 * under the org's data key (ENCRYPTED_FIELDS.session), which calls
 * `kms().send(new DecryptCommand(...))`; without the stub registered first,
 * that reaches the real AWS SDK.
 */
const path = require('path');
const assert = require('assert');

const REPO = path.join(__dirname, '..', '..');
const { createTable, installStubs } = require('./player-table');

const kmsStubs = require('./tenant-crypto-stub');
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
const getQuestion = require(path.join(REPO, 'lambda-functions/game/get-question.js')).handler;
const getGameState = require(path.join(REPO, 'lambda-functions/game/get-game-state.js')).handler;

if (!process.env.DEBUG) { console.log = () => {}; console.warn = () => {}; console.error = () => {}; }

/* ---- Fixture: one org session, one category of three questions ------------ */

const ACME = 'org_acme';
const SET = 'set-alpha';
const SETPK = `SET#${SET}`;

const asHost = (orgId, extra = {}) => ({
  requestContext: { authorizer: { lambda: { userId: `user-${orgId}`, orgId, orgRole: 'admin', groups: 'hosts' } } },
  ...extra,
});

const row = (pk, sk) => store.get(table.keyOf(pk, sk));

/**
 * A CREATED call-and-answer session with one category of three questions.
 * Each row carries a `Background` (Workie's-eyes-only) beside an
 * `AnswerDetails` (the room's-eyes-later reveal) — the two sentinels section 3
 * checks never leave the row they were seeded on.
 */
async function createdSession() {
  store.clear();
  sent.length = 0;
  const res = await createGame(asHost(ACME, {
    body: JSON.stringify({ eventTitle: 'Background never served', gameType: 'call-and-answer' }),
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
  // A connected host and player, so next-question's broadcastToGame actually
  // has somewhere to send — with none, it returns before posting anything
  // (next-question.js's connections.length === 0 guard) and the "no websocket
  // frame carries Background" check below would pass on an empty `sent`
  // whether or not a frame ever leaked it. Shape from
  // tests/answer-content-not-logged.js's seedRoom.
  table.put({ PK, SK: 'CONNECTION#host-conn', ConnectionId: 'host-conn', ConnectionType: 'HOST', GameId: gameId });
  table.put({ PK, SK: 'CONNECTION#player-conn', ConnectionId: 'player-conn', ConnectionType: 'PLAYER', GameId: gameId, PlayerName: 'Ada' });
  // Keyed as upload-questions.js keys them, category first — the same shape
  // round-ref-lives-with-session.js's fixture uses.
  for (const n of ['001', '002', '003']) {
    table.put({
      PK: SETPK, SK: `QUESTION#c001#${n}`, Category: 'Pricing', Title: `Question ${n}`,
      Background: 'zqbackground-sentinel', AnswerDetails: 'zqreveal-sentinel',
    });
  }
  return gameId;
}

const press = (gameId, body = {}) => nextQuestion(asHost(ACME, {
  pathParameters: { gameId },
  body: JSON.stringify(body),
}));

/* ========================================================================== */

module.exports = async (check) => {
  const gameId = await createdSession();
  const openRes = await press(gameId);
  // Not itself one of the pinned checks below — a fixture that failed to open
  // its round would otherwise pass every "carries no Background" assertion
  // for having served nothing at all, proving nothing.
  assert.strictEqual(openRes.statusCode, 200, `round did not open: ${openRes.body}`);

  await check('next-question\'s response carries no Background', () =>
    assert.ok(!JSON.stringify(openRes).includes('zqbackground-sentinel')));
  for (const role of ['player', 'host']) {
    await check(`get-question role=${role} carries no Background`, async () => {
      const res = await getQuestion({ pathParameters: { gameId }, queryStringParameters: { role } });
      assert.strictEqual(res.statusCode, 200, res.body);
      assert.ok(!res.body.includes('zqbackground-sentinel'), res.body);
    });
  }
  await check('get-game-state carries no Background', async () => {
    const res = await getGameState({ pathParameters: { gameId } });
    assert.ok(!res.body.includes('zqbackground-sentinel'), res.body.slice(0, 400));
  });
  // Not itself one of the pinned checks, same reason as the statusCode guard
  // above: with no connections in the room, broadcastToGame returns before
  // posting anything (next-question.js's connections.length === 0 branch),
  // `sent` stays [], and "no websocket frame carries Background" would pass
  // for having sent nothing at all. The CONNECTION# rows above exist so this
  // can never go quiet again.
  assert.ok(sent.length > 0, `next-question broadcast nothing — sent is empty, so the check below is vacuous`);
  await check('no websocket frame carries Background', () =>
    assert.ok(!JSON.stringify(sent).includes('zqbackground-sentinel')));
};
