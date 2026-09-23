/**
 * A SESSION STARTED FROM THE LOBBY IS A STARTED SESSION.
 *
 * Two doors start play, and until this suite only one of them said so:
 *
 *   POST /games/{id}/start          start-game.js — history's Start, Quickstart
 *   POST /games/{id}/next-question  from CREATED — the phone remote's
 *                                   "Start First Round" (config/hostRemote.js
 *                                   primaryAction, which takes any typed code
 *                                   and is not gated on a player count), and a
 *                                   host page reached on an unstarted code
 *
 * next-question.js lists CREATED among the states it advances from, so the
 * second door moved a session CREATED → ASK#001 without anything start-game
 * does. That was more than the 7-day TTL (session-ttl.js) failing to land:
 *
 *   - all four rows kept `created + 90 days`, so a room that had been played
 *     sat in the list for three months instead of one week;
 *   - METADATA.Started was never set, and that flag is session-gate.js's
 *     second gate, so every phone got "Game not started" while the round was
 *     live on the wall;
 *   - the org's index row said Started: false, so the host's own list called
 *     a played session unstarted.
 *
 * The fix routes both doors through session-start.js. §1 and §2 drive the lobby
 * door through the real create and next-question handlers and read the ROWS;
 * §3 pins that it happens once, at the start, and not on every round; §4 is
 * the structural half — one writer, so the two doors cannot drift apart again.
 *
 * Every check carries a `// rejects:` line naming the change it catches.
 */
const path = require('path');
const fs = require('fs');
const assert = require('assert');

const REPO = path.join(__dirname, '..');
const { createTable, installStubs } = require('./helpers/player-table');

// KMS, faked, and registered before any handler loads: the org's index row is
// an envelope at rest, and tenant-crypto throws rather than write plaintext.
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

const { GAMES_RESERVATION_PK, gamesIndexPk } = require(path.join(REPO, 'lambda-functions/game/tenant.js'));
const { unstartedTtl, startedTtl, DAY } = require(path.join(REPO, 'lambda-functions/game/session-ttl.js'));
const createGame = require(path.join(REPO, 'lambda-functions/websocket/create-game.js')).handler;
const startGame = require(path.join(REPO, 'lambda-functions/game/start-game.js')).handler;
const nextQuestion = require(path.join(REPO, 'lambda-functions/game/next-question.js')).handler;
const joinGame = require(path.join(REPO, 'lambda-functions/game/join-game.js')).handler;

if (!process.env.DEBUG) { console.log = () => {}; console.warn = () => {}; console.error = () => {}; }
const say = (...a) => process.stdout.write(a.join(' ') + '\n');

let pass = 0, fail = 0;
async function check(label, fn) {
  try { await fn(); say(`  PASS  ${label}`); pass++; }
  catch (e) { say(`  FAIL  ${label}\n        ${e.message}`); fail++; }
}

/* ---- Fixtures ------------------------------------------------------------- */

const ACME = 'org_acme';
const SET = 'set-alpha';
const SETPK = `SET#${SET}`;

/** The shape the Lambda authorizer really emits — see tenant-session-scoping.js. */
const asHost = (orgId, extra = {}) => ({
  requestContext: { authorizer: { lambda: { userId: `user-${orgId}`, orgId, orgRole: 'admin', groups: 'hosts' } } },
  ...extra,
});

const row = (pk, sk) => store.get(table.keyOf(pk, sk));
const fourRows = (id) => ({
  reservation: row(GAMES_RESERVATION_PK, `GAME#${id}`),
  index: row(gamesIndexPk(ACME), `GAME#${id}`),
  metadata: row(`GAME#${id}`, 'METADATA'),
  state: row(`GAME#${id}`, 'STATE'),
});

/**
 * A CREATED session, made by the real creator so every row carries exactly the
 * `ttl` creation writes, then given one category of a legacy platform set to
 * play — the same set rows specific-selection-damage.js builds. The set is laid
 * on afterwards because what is under test is the start, not set resolution.
 */
async function createdSession() {
  store.clear();
  sent.length = 0;
  const res = await createGame(asHost(ACME, {
    body: JSON.stringify({ eventTitle: 'Lobby start', gameType: 'call-and-answer' }),
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
  for (const n of ['001', '002', '003']) {
    table.put({ PK: SETPK, SK: `QUESTION#${n}`, Category: 'Pricing', title: `Question ${n}` });
  }
  return gameId;
}

const press = (gameId, body = {}) => nextQuestion(asHost(ACME, {
  pathParameters: { gameId },
  body: JSON.stringify(body),
}));

function assertStartedRows(gameId) {
  const rows = fourRows(gameId);
  const startedAt = rows.state.StartedAt;
  assert.ok(startedAt, 'STATE carries no StartedAt — the session was never started');
  const expected = startedTtl(startedAt);
  for (const [name, r] of Object.entries(rows)) {
    assert.ok(r, `the ${name} row is missing`);
    assert.strictEqual(r.ttl, expected,
      `${name} ttl=${r.ttl}, expected started + 7 days (${expected}); `
      + `created + 90 days would be ${unstartedTtl(rows.metadata.CreatedAt)}`);
  }
  assert.ok(Math.abs(expected - (Date.now() / 1000 + 7 * DAY)) < 60, 'not ~7 days out');
  return rows;
}

/* ========================================================================== */

(async () => {
  say('\nlobby start: every door that starts play starts the session\n');

  say('1. "Start First Round" from CREATED (POST next-question, empty body)');
  const lobbyGame = await createdSession();

  await check('the fixture is a CREATED session on the 90-day clock', () => {
    const rows = fourRows(lobbyGame);
    assert.strictEqual(rows.state.State, 'CREATED');
    const expected = unstartedTtl(rows.metadata.CreatedAt);
    for (const [name, r] of Object.entries(rows)) assert.strictEqual(r.ttl, expected, `${name} ttl`);
  });

  const lobbyRes = await press(lobbyGame);
  await check('the round is served', () => {
    assert.strictEqual(lobbyRes.statusCode, 200, lobbyRes.body);
    assert.strictEqual(fourRows(lobbyGame).state.State, 'ASK#001');
  });
  // rejects: next-question advancing out of CREATED without the start writes.
  await check('all four rows move to started + 7 days', () => {
    assertStartedRows(lobbyGame);
  });
  // rejects: the TTL carried over but the Started flags left behind.
  await check('METADATA and the org index row say Started, with LastPlayedAt', () => {
    const { state, metadata, index } = fourRows(lobbyGame);
    assert.strictEqual(state.Started, true, 'STATE.Started');
    assert.strictEqual(metadata.Started, true, 'METADATA.Started');
    assert.strictEqual(index.Started, true, 'index row Started — the host list would call it unstarted');
    assert.strictEqual(metadata.LastPlayedAt, state.StartedAt);
    assert.strictEqual(index.LastPlayedAt, state.StartedAt);
  });
  // rejects: the consequence the TTL hid — a live round nobody can join.
  await check('a player can join the round that is on the wall', async () => {
    const res = await joinGame({
      pathParameters: { gameId: lobbyGame },
      body: JSON.stringify({ playerName: 'Ada', clientId: 'browser-1' }),
    });
    assert.notStrictEqual(res.statusCode, 403, `join refused: ${res.body}`);
    assert.strictEqual(res.statusCode, 200, res.body);
  });

  say('\n2. "Ask next" on one named question from CREATED (select_specific)');
  const namedGame = await createdSession();
  const namedRes = await press(namedGame, { questionId: '002', action: 'select_specific' });
  // rejects: only the automatic path starting the session — the specific
  // actions skip next-question's state check entirely.
  await check('served, and all four rows move to started + 7 days', () => {
    assert.strictEqual(namedRes.statusCode, 200, namedRes.body);
    assert.strictEqual(fourRows(namedGame).state.State, 'ASK#001');
    assertStartedRows(namedGame);
    assert.strictEqual(fourRows(namedGame).metadata.Started, true);
  });

  say('\n3. it happens once, at the start');
  const startedGame = await createdSession();
  await check('start-game still starts it the same way', async () => {
    const res = await startGame(asHost(ACME, { pathParameters: { gameId: startedGame } }));
    assert.strictEqual(res.statusCode, 200, res.body);
    const rows = assertStartedRows(startedGame);
    assert.strictEqual(rows.state.State, 'STARTED');
    assert.strictEqual(rows.metadata.Started, true);
    assert.strictEqual(rows.index.Started, true);
  });
  // rejects: next-question "starting" every session it touches, which would
  // push the expiry a week on with every round and restamp StartedAt.
  await check('the first round of a started session leaves the start alone', async () => {
    const before = fourRows(startedGame);
    const stamp = { startedAt: before.state.StartedAt, ttl: before.state.ttl };
    // Backdate the start so a rewrite cannot hide inside the same second.
    const earlier = new Date(Date.parse(stamp.startedAt) - 3 * DAY * 1000).toISOString();
    const earlierTtl = startedTtl(earlier);
    before.state.StartedAt = earlier;
    for (const r of Object.values(before)) r.ttl = earlierTtl;

    const res = await press(startedGame);
    assert.strictEqual(res.statusCode, 200, res.body);
    const after = fourRows(startedGame);
    assert.strictEqual(after.state.State, 'ASK#001');
    assert.strictEqual(after.state.StartedAt, earlier, 'StartedAt was restamped');
    for (const [name, r] of Object.entries(after)) {
      assert.strictEqual(r.ttl, earlierTtl, `${name} ttl was rewritten by an ordinary round`);
    }
  });

  say('\n4. one writer');
  const strip = (rel) => fs.readFileSync(path.join(REPO, rel), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');
  // rejects: a second hand-copied set of start writes in any game handler.
  await check('only session-start.js computes a started TTL', () => {
    const dir = path.join(REPO, 'lambda-functions/game');
    const writers = fs.readdirSync(dir)
      .filter((f) => f.endsWith('.js') && f !== 'session-ttl.js')
      .filter((f) => /\bstartedTtl\b/.test(strip(path.join('lambda-functions/game', f))));
    assert.deepStrictEqual(writers, ['session-start.js']);
  });
  // rejects: either door bypassing the shared function.
  await check('both doors call it', () => {
    for (const rel of ['lambda-functions/game/start-game.js', 'lambda-functions/game/next-question.js']) {
      assert.ok(/\bstartSession\s*\(/.test(strip(rel)), `${rel} does not call startSession()`);
    }
  });

  say(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
