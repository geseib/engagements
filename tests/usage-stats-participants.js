/**
 * PARTICIPANTS, EXACTLY — usage stats, SPEC §5 E9 ("Participants, exactly").
 *
 * One per new player seat in a session, at the moment the seat is first
 * written (game/join-game.js, after its conditional put). A reconnect, a
 * phone refresh, a handover and a removed player rejoining all reuse the seat,
 * so none counts again. Two people are two; one person in two sessions is two
 * (the owner's example: 10 + 2 = 12).
 *
 * The event attendee's half (one registration, however many items they play)
 * is proven in tests/event-run.js, which already drives attendees through
 * three items.
 *
 * Every check carries a `// rejects:` line naming the change it catches.
 */
const suiteFinished = require('./helpers/finish-guard');
const path = require('path');
const assert = require('assert');

const REPO = path.join(__dirname, '..');
const { createTable, installStubs } = require('./helpers/player-table');

const table = createTable();
const store = table.store;
const key = table.keyOf;
const sent = [];
installStubs({ table, sent });
process.env.TABLE_NAME = 'test-table';

const joinGame = require(path.join(REPO, 'lambda-functions/game/join-game.js'));
const removePlayer = require(path.join(REPO, 'lambda-functions/game/remove-player.js'));
const requestHandover = require(path.join(REPO, 'lambda-functions/game/request-handover.js'));
const grantHandover = require(path.join(REPO, 'lambda-functions/game/grant-handover.js'));
const M = require(path.join(REPO, 'lambda-functions/game/platform-metrics.js'));

if (!process.env.DEBUG) { console.log = () => {}; console.warn = () => {}; console.error = () => {}; }
const say = (...a) => process.stdout.write(`${a.join(' ')}\n`);
let pass = 0; let fail = 0;
async function check(label, fn) {
  try { await fn(); say(`  PASS  ${label}`); pass += 1; } catch (e) { say(`  FAIL  ${label}\n        ${e.message}`); fail += 1; }
}

const HOST = { authorizer: { lambda: { userId: 'host-1', groups: 'hosts' } } };
const period = () => M.periodOf(new Date());
// Orgless sessions, which any host may drive (player-removal.js says why):
// the counts land on the platform row and the creator's `#ORG#-` row.
function session(gameId) {
  const PK = `GAME#${gameId}`;
  store.set(key(PK, 'METADATA'), { PK, SK: 'METADATA', Started: true, Visibility: 'public', GameType: 'trivia', CreatedBy: 'u-host' });
  store.set(key(PK, 'CONNECTION#host-1'), { PK, SK: 'CONNECTION#host-1', ConnectionId: 'host-1', ConnectionType: 'HOST' });
}
const join = (gameId, body) => joinGame.handler({ pathParameters: { gameId }, body: JSON.stringify(body) });
const remove = (gameId, playerName) => removePlayer.handler({ requestContext: HOST, pathParameters: { gameId, playerName }, body: '{}' });
const ask = (gameId, playerName, body) => requestHandover.handler({ pathParameters: { gameId, playerName }, body: JSON.stringify(body) });
const grant = (gameId, playerName, body) => grantHandover.handler({ requestContext: HOST, pathParameters: { gameId, playerName }, body: JSON.stringify(body) });
const participants = () => {
  const r = store.get(key('USER#u-host', `STATS#${period()}#TYPE#trivia#ORG#-`)) || {};
  return r.participants || 0;
};
const platformParticipants = () => (store.get(key('PLATFORM#METRICS', `MONTH#${period()}#TYPE#trivia`)) || {}).participants || 0;

(async () => {
  say('\nusage stats: participants\n');
  table.clear();
  session('4821');

  // rejects: join-game.js not calling recordParticipant on a new seat.
  await check('a first join is one participant', async () => {
    const res = await join('4821', { playerName: 'Ada', clientId: 'ada-phone' });
    assert.strictEqual(res.statusCode, 200, res.body);
    assert.strictEqual(participants(), 1);
    assert.strictEqual(platformParticipants(), 1);
  });
  // rejects: counting on the reconnect path — every refresh would add one.
  await check('the same browser rejoining, or refreshing, adds nothing', async () => {
    await join('4821', { playerName: 'Ada', clientId: 'ada-phone' });
    await join('4821', { playerName: 'Ada', clientId: 'ada-phone' });
    assert.strictEqual(participants(), 1);
  });
  // rejects: counting a handover — it is the same person on a new device.
  await check('a handover to a new device adds nothing', async () => {
    await ask('4821', 'Ada', { clientId: 'ada-laptop' });
    await grant('4821', 'Ada', { bindToRequester: true });
    const res = await join('4821', { playerName: 'Ada', clientId: 'ada-laptop', claimExisting: true });
    assert.strictEqual(res.statusCode, 200, res.body);
    assert.strictEqual(participants(), 1);
  });
  // rejects: counting a removed player's rejoin as a new seat.
  await check('removed, then rejoined: still one', async () => {
    const out = await remove('4821', 'Ada');
    assert.strictEqual(out.statusCode, 200, out.body);
    await join('4821', { playerName: 'Ada', clientId: 'ada-laptop' });
    assert.strictEqual(participants(), 1);
  });
  // rejects: a lost name race counted — the loser got no seat.
  await check('a refused name (somebody else holds it) adds nothing', async () => {
    const res = await join('4821', { playerName: 'Ada', clientId: 'a-different-ada' });
    assert.strictEqual(res.statusCode, 409);
    assert.strictEqual(participants(), 1);
  });
  // rejects: participants counted per session rather than per seat.
  await check('a second name is a second participant', async () => {
    await join('4821', { playerName: 'Bob', clientId: 'bob-phone' });
    assert.strictEqual(participants(), 2);
  });
  // rejects: de-duplicating a person across sessions — the owner's 10 + 2 = 12.
  await check('the same person in a second session counts again', async () => {
    session('4822');
    await join('4822', { playerName: 'Ada', clientId: 'ada-phone' });
    assert.strictEqual(participants(), 3);
  });

  suiteFinished();
  say(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { say(e.stack); process.exit(1); });
