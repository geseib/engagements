/**
 * A ROUND'S QUESTION POINTER LIVES AS LONG AS THE SESSION THAT IS PLAYING IT.
 *
 * ── THE BUG ──────────────────────────────────────────────────────────────────
 *
 * next-question.js writes `GAME#{id} / QUESTION#nnn#REF` when a round opens.
 * It is the ONLY record of which question the round is asking: get-question.js
 * and get-game-state.js both find the question through it, and nothing else
 * does. It was written with `ttl: now + 24 hours`, while the session it belongs
 * to lives `started + 7 days` (session-ttl.js).
 *
 * So a room left open overnight woke up with STATE still `ASK#001`, the player
 * still listed, and the pointer gone. Seen on dev 2026-09-25, game 8924: the
 * host's wall showed "1 (Joe) to answer" over a blank question, refreshing did
 * nothing, and the phone fell through PlayerPage's round branches to "Nothing
 * to do here." get-question.js logged 249 of 373 in-round calls in three days
 * ending at its REF lookup; games 7610, 3906 and 8924 each read their REF
 * fine on 09-23 and missed it from 24–25.5 hours after the round opened.
 *
 * ── THE RULE ────────────────────────────────────────────────────────────────
 *
 * The REF row expires WITH the session: it carries the session's own `ttl`,
 * the one session-start.js stamped on STATE. Not a second clock — a shorter one
 * strands a live round, and a fresh `now + 7 days` would let the pointer
 * outlive the session it points from.
 *
 * rejects: a REF written with any expiry other than the session's — 24 hours,
 *          a fresh week from the round, or none; and, end to end, a round
 *          whose question cannot be read back a day later while its session
 *          still stands.
 */
const suiteFinished = require('./helpers/finish-guard');
const path = require('path');
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

const { startedTtl, DAY } = require(path.join(REPO, 'lambda-functions/game/session-ttl.js'));
const createGame = require(path.join(REPO, 'lambda-functions/websocket/create-game.js')).handler;
const startGame = require(path.join(REPO, 'lambda-functions/game/start-game.js')).handler;
const nextQuestion = require(path.join(REPO, 'lambda-functions/game/next-question.js')).handler;
const getQuestion = require(path.join(REPO, 'lambda-functions/game/get-question.js')).handler;
const getGameState = require(path.join(REPO, 'lambda-functions/game/get-game-state.js')).handler;

if (!process.env.DEBUG) { console.log = () => {}; console.warn = () => {}; console.error = () => {}; }
const say = (...a) => process.stdout.write(a.join(' ') + '\n');

let pass = 0, fail = 0;
async function check(label, fn) {
  try { await fn(); say(`  PASS  ${label}`); pass++; }
  catch (e) { say(`  FAIL  ${label}\n        ${e.message}`); fail++; }
}

/* ---- Fixtures (the session tests/lobby-start-ttl.js builds) ---------------- */

const ACME = 'org_acme';
const SET = 'set-alpha';
const SETPK = `SET#${SET}`;

const asHost = (orgId, extra = {}) => ({
  requestContext: { authorizer: { lambda: { userId: `user-${orgId}`, orgId, orgRole: 'admin', groups: 'hosts' } } },
  ...extra,
});

const row = (pk, sk) => store.get(table.keyOf(pk, sk));
const stateOf = (id) => row(`GAME#${id}`, 'STATE');
const refOf = (id, n) => row(`GAME#${id}`, `QUESTION#${n}#REF`);

/** A CREATED call-and-answer session with one category of three questions. */
async function createdSession() {
  store.clear();
  sent.length = 0;
  const res = await createGame(asHost(ACME, {
    body: JSON.stringify({ eventTitle: 'Overnight room', gameType: 'call-and-answer' }),
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
  // Keyed as upload-questions.js keys them, category first: the REF records
  // this SK and get-question.js reads it back verbatim.
  for (const n of ['001', '002', '003']) {
    table.put({ PK: SETPK, SK: `QUESTION#c001#${n}`, Category: 'Pricing', Title: `Question ${n}` });
  }
  return gameId;
}

const press = (gameId, body = {}) => nextQuestion(asHost(ACME, {
  pathParameters: { gameId },
  body: JSON.stringify(body),
}));

/** What DynamoDB's TTL sweeper would have removed by `atSeconds`. */
function sweepExpired(atSeconds) {
  for (const [k, item] of store) {
    if (typeof item.ttl === 'number' && item.ttl <= atSeconds) store.delete(k);
  }
}

function assertRefExpiresWithSession(gameId, n) {
  const state = stateOf(gameId);
  const ref = refOf(gameId, n);
  assert.ok(ref, `QUESTION#${n}#REF was not written`);
  assert.ok(typeof state.ttl === 'number', `the fixture's STATE carries no ttl: ${JSON.stringify(state)}`);
  const hours = (t) => (typeof t === 'number' ? `${((t - Date.now() / 1000) / 3600).toFixed(1)}h from now` : String(t));
  assert.strictEqual(ref.ttl, state.ttl,
    `REF ttl is ${hours(ref.ttl)}, the session's is ${hours(state.ttl)} — they must expire together`);
}

/* ========================================================================== */

(async () => {
  say('\nround pointer: a round\'s QUESTION#nnn#REF expires with its session\n');

  say('1. the first round, opened from the lobby (CREATED -> ASK#001)');
  const lobby = await createdSession();
  const lobbyRes = await press(lobby);
  await check('the round is served', () => {
    assert.strictEqual(lobbyRes.statusCode, 200, lobbyRes.body);
    assert.strictEqual(stateOf(lobby).State, 'ASK#001');
  });
  // rejects: the 24-hour REF, on the door that starts the session and the round at once.
  await check('its REF carries the session\'s ttl, not a day', () => assertRefExpiresWithSession(lobby, '001'));

  say('\n2. the first round of a session started three days ago');
  const aged = await createdSession();
  await check('start-game starts it', async () => {
    const res = await startGame(asHost(ACME, { pathParameters: { gameId: aged } }));
    assert.strictEqual(res.statusCode, 200, res.body);
  });
  {
    // Backdate the start so the session's expiry is four days out, not seven —
    // a REF stamped `now + 7 days` would then outlive its session by three.
    const state = stateOf(aged);
    state.StartedAt = new Date(Date.now() - 3 * DAY * 1000).toISOString();
    state.ttl = startedTtl(state.StartedAt);
  }
  const agedRes = await press(aged);
  await check('the round is served', () => {
    assert.strictEqual(agedRes.statusCode, 200, agedRes.body);
    assert.strictEqual(stateOf(aged).State, 'ASK#001');
  });
  // rejects: a fresh week from the round — a second clock, drifting from the session's.
  await check('its REF expires when the session does, four days out', () => assertRefExpiresWithSession(aged, '001'));

  say('\n3. a later round');
  stateOf(aged).State = 'RESULTS#001';
  const laterRes = await press(aged);
  await check('round two is served', () => {
    assert.strictEqual(laterRes.statusCode, 200, laterRes.body);
    assert.strictEqual(stateOf(aged).State, 'ASK#002');
  });
  await check('its REF carries the session\'s ttl too', () => assertRefExpiresWithSession(aged, '002'));

  say('\n4. the room left open overnight: a day and an hour later, the question is still there');
  const overnight = await createdSession();
  const openRes = await press(overnight);
  await check('the round is served', () => assert.strictEqual(openRes.statusCode, 200, openRes.body));
  sweepExpired(Math.floor(Date.now() / 1000) + 25 * 3600);
  await check('the session itself is still standing, mid-round', () => {
    const state = stateOf(overnight);
    assert.ok(state, 'the fixture\'s STATE was swept — the session should live seven days');
    assert.strictEqual(state.State, 'ASK#001');
  });
  // rejects: the observed symptom — the phone's "Nothing to do here." and the host's blank wall.
  for (const role of ['player', 'host']) {
    await check(`GET /games/{id}/question?role=${role} still names the question`, async () => {
      const res = await getQuestion({ pathParameters: { gameId: overnight }, queryStringParameters: { role } });
      assert.strictEqual(res.statusCode, 200, res.body);
      assert.strictEqual(JSON.parse(res.body).title, 'Question 001', res.body);
    });
  }
  await check('GET /games/{id}/state still carries the current question', async () => {
    const res = await getGameState({ pathParameters: { gameId: overnight } });
    assert.strictEqual(res.statusCode, 200, res.body);
    const body = JSON.parse(res.body);
    assert.ok(body.currentQuestionData, `no currentQuestionData: ${res.body.slice(0, 300)}`);
    assert.strictEqual(body.currentQuestionData.title, 'Question 001');
  });

  say(`\n${pass} passed, ${fail} failed`);
  suiteFinished();
  process.exit(fail ? 1 : 0);
})().catch((e) => { say(`CRASH ${e.stack}`); process.exit(1); });
