/**
 * THE ROUND TIMER AS A ROUND OPENS (experience plan 2f; round-timer.js).
 * next-question.js is the one writer that opens a round, so it writes the
 * answering timer: PhaseStartedAt always, the time given when the host chose
 * one (the body's `time`, else the session's last choice), and a previous
 * round's timer removed when this one has No limit. The room hears only what
 * the wall needs; the host's screens hear the whole timer.
 *
 * Drives the real create and next-question handlers on the player-table
 * harness (the same fixture as tests/lobby-start-ttl.js).
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
const wire = [];
installStubs({ table, sent, frames: wire });
process.env.TABLE_NAME = 'test-table';
process.env.WEBSOCKET_API_ENDPOINT = 'https://ws.test.invalid/dev';
kmsStubs.installTestKeyLoader();

const createGame = require(path.join(REPO, 'lambda-functions/websocket/create-game.js')).handler;
const nextQuestion = require(path.join(REPO, 'lambda-functions/game/next-question.js')).handler;

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
const MIN = 60000;
const asHost = (orgId, extra = {}) => ({
  requestContext: { authorizer: { lambda: { userId: `user-${orgId}`, orgId, orgRole: 'admin', groups: 'hosts' } } },
  ...extra,
});
const row = (pk, sk) => store.get(table.keyOf(pk, sk));

async function createdSession() {
  store.clear();
  sent.length = 0;
  wire.length = 0;
  const res = await createGame(asHost(ACME, { body: JSON.stringify({ eventTitle: 'Timer start', gameType: 'call-and-answer' }) }));
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
  for (const n of ['001', '002', '003']) table.put({ PK: SETPK, SK: `QUESTION#${n}`, Category: 'Pricing', title: `Question ${n}` });
  table.put({ PK, SK: 'CONNECTION#host-1', ConnectionId: 'host-1', ConnectionType: 'HOST' });
  table.put({ PK, SK: 'CONNECTION#player-1', ConnectionId: 'player-1', ConnectionType: 'PLAYER', PlayerName: 'Ada' });
  return gameId;
}

const press = (gameId, body = {}) => nextQuestion(asHost(ACME, { pathParameters: { gameId }, body: JSON.stringify(body) }));
const stateOf = (id) => row(`GAME#${id}`, 'STATE');
const frames = (type) => wire.filter((f) => f.message.type === type).map((f) => ({ id: f.connectionId, m: f.message }));
/** Moves the room to RESULTS so the next press opens a new round. */
const toResults = (id, n) => Object.assign(stateOf(id), { State: `RESULTS#${String(n).padStart(3, '0')}` });

(async () => {
  say('\nround timer: the round opens with its time\n');

  const id = await createdSession();
  const before = Date.now();
  const res = await press(id, { time: { limitMs: 2 * MIN, onWall: true, closes: true } });
  await check('Start round 1 with 2 min: TimeLimitMs, TimeExtendedMs 0, TimeOnWall, TimeCloses, TimePhase ASK#001', () => {
    assert.strictEqual(res.statusCode, 200, res.body);
    const s = stateOf(id);
    assert.strictEqual(s.State, 'ASK#001');
    assert.strictEqual(s.TimePhase, 'ASK#001');
    assert.strictEqual(s.TimeLimitMs, 2 * MIN);
    assert.strictEqual(s.TimeExtendedMs, 0);
    assert.strictEqual(s.TimeOnWall, true);
    assert.strictEqual(s.TimeCloses, true);
  });
  await check('PhaseStartedAt is the server\'s clock at the opening', () => {
    const at = Date.parse(stateOf(id).PhaseStartedAt);
    assert.ok(at >= before - 5 && at <= Date.now() + 5, stateOf(id).PhaseStartedAt);
  });
  await check('questionStarted carries the public timer only, and serverNow', () => {
    const qs = frames('questionStarted');
    assert.deepStrictEqual(qs.map((f) => f.id).sort(), ['host-1', 'player-1']);
    const t = qs[0].m.time;
    assert.deepStrictEqual(Object.keys(t).sort(), ['extendedMs', 'limitMs', 'phase', 'startedAt']);
    assert.ok(Number.isFinite(qs[0].m.serverNow));
  });
  await check('the host\'s screens alone hear the whole timer (closes at zero)', () => {
    const rt = frames('roundTimeChanged');
    assert.deepStrictEqual(rt.map((f) => f.id), ['host-1']);
    assert.strictEqual(rt[0].m.time.closes, true);
    assert.strictEqual(JSON.parse(res.body).hostTime.closes, true, 'and the response that opened it');
  });

  toResults(id, 1);
  wire.length = 0;
  await press(id, {});
  await check('round 2 opened with no time (the Remote): the session\'s last choice carries over', () => {
    const s = stateOf(id);
    assert.strictEqual(s.State, 'ASK#002');
    assert.strictEqual(s.TimePhase, 'ASK#002');
    assert.strictEqual(s.TimeLimitMs, 2 * MIN);
    assert.strictEqual(s.TimeExtendedMs, 0, 'a fresh round starts with nothing added');
  });

  Object.assign(stateOf(id), { TimeExtendedMs: MIN });
  toResults(id, 2);
  wire.length = 0;
  await press(id, { time: { limitMs: 0 } });
  await check('round 3 with No limit: the last round\'s timer is removed, PhaseStartedAt still stamped', () => {
    const s = stateOf(id);
    assert.strictEqual(s.State, 'ASK#003');
    for (const f of ['TimeLimitMs', 'TimeExtendedMs', 'TimeOnWall', 'TimeCloses']) assert.ok(!(f in s), `${f} survived`);
    assert.strictEqual(s.TimePhase, 'ASK#003');
    assert.ok(s.PhaseStartedAt);
    assert.strictEqual(frames('questionStarted')[0].m.time, null);
    assert.strictEqual(frames('roundTimeChanged').length, 0);
  });

  const hidden = await createdSession();
  await press(hidden, { time: { limitMs: MIN, onWall: false } });
  await check('"show the time" off: the room\'s frame carries no time, the host\'s does', () => {
    assert.strictEqual(frames('questionStarted')[0].m.time, null);
    assert.strictEqual(frames('roundTimeChanged')[0].m.time.onWall, false);
  });

  const junk = await createdSession();
  await press(junk, { time: { limitMs: 45000, closes: true } });
  await check('a time that is not a preset is No limit, and closes nothing', () => {
    const s = stateOf(junk);
    assert.ok(!('TimeLimitMs' in s));
    assert.ok(!('TimeCloses' in s));
  });

  suiteFinished();
  say(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail ? 1 : 0);
})();
