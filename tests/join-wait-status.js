/**
 * "STILL WAITING" AS A 200 FOR THE QUIET RETRY (join-game.js `waitStatus`).
 *
 * rejects: dev QA 1 Nov — while a phone waited on the host, its background
 * join retry printed a red HTTP 409 in the console every four seconds, for an
 * answer the page expected. A claim that sends `waitStatus: true` now gets the
 * same refusal body with 200 and `waiting: true`; nothing else changes.
 *
 *   §1  a waiting claim: 200, `waiting`, the refusal's code and message
 *   §2  Not now still reaches the asker, as `handoverRefused`, on a 200
 *   §3  without `waitStatus`, or without `claimExisting`, the 409 is unchanged
 *   §4  a grant still lands the phone in; other failures keep their status
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
if (!process.env.DEBUG) { console.error = () => {}; }

const joinGame = require(path.join(REPO, 'lambda-functions/game/join-game.js'));
const requestHandover = require(path.join(REPO, 'lambda-functions/game/request-handover.js'));
const grantHandover = require(path.join(REPO, 'lambda-functions/game/grant-handover.js'));

const realLog = console.log;
const say = (...a) => process.stdout.write(a.join(' ') + '\n');
if (!process.env.DEBUG) console.log = () => {};

let pass = 0, fail = 0;
async function check(label, fn) {
  try { await fn(); say(`  PASS  ${label}`); pass++; }
  catch (e) { say(`  FAIL  ${label}\n        ${e.message}`); fail++; }
}

const GAME = '4821';
const PK = `GAME#${GAME}`;
function reset() {
  table.clear();
  sent.length = 0;
  store.set(key(PK, 'METADATA'), { PK, SK: 'METADATA', Started: true, Visibility: 'public', AccessCode: null });
  store.set(key(PK, 'CONNECTION#host-1'), { PK, SK: 'CONNECTION#host-1', ConnectionId: 'host-1', ConnectionType: 'HOST' });
}
const join = (body, gameId = GAME) => joinGame.handler({ pathParameters: { gameId }, body: JSON.stringify(body) });
const ask = (playerName, body) => requestHandover.handler({ pathParameters: { gameId: GAME, playerName }, body: JSON.stringify(body || {}) });
const HOST = { authorizer: { lambda: { userId: 'host-1', groups: 'hosts' } } };
const act = (playerName, body) => grantHandover.handler({
  requestContext: HOST, pathParameters: { gameId: GAME, playerName }, body: JSON.stringify(body || {}),
});
const bodyOf = (res) => JSON.parse(res.body);
const claim = (extra = {}) => join({ playerName: 'Sam', clientId: 'new', claimExisting: true, waitStatus: true, ...extra });

(async () => {
  say('\n§1. a waiting claim is a 200 that says so');
  await check('same code and message as the 409, plus waiting: true', async () => {
    reset();
    await join({ playerName: 'Sam', clientId: 'old' });
    await ask('Sam', { clientId: 'new' });
    const plain = await join({ playerName: 'Sam', clientId: 'new', claimExisting: true });
    const quiet = await claim();
    assert.strictEqual(plain.statusCode, 409);
    assert.strictEqual(quiet.statusCode, 200);
    const { waiting, ...rest } = bodyOf(quiet);
    assert.strictEqual(waiting, true);
    assert.deepStrictEqual(rest, bodyOf(plain));
    assert.strictEqual(store.get(key(PK, 'PLAYER#Sam')).ClientId, 'old', 'nothing moved');
  });

  say('\n§2. Not now still reaches the asker');
  await check('handoverRefused rides the 200', async () => {
    reset();
    await join({ playerName: 'Sam', clientId: 'old' });
    await ask('Sam', { clientId: 'new' });
    await act('Sam', { refuse: true });
    const res = await claim();
    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(bodyOf(res).waiting, true);
    assert.strictEqual(bodyOf(res).handoverRefused, true);
    assert.strictEqual(bodyOf(res).code, 'NAME_TAKEN');
  });

  say('\n§3. callers that do not ask get the 409 they always got');
  await check('no waitStatus: 409', async () => {
    reset();
    await join({ playerName: 'Sam', clientId: 'old' });
    const res = await join({ playerName: 'Sam', clientId: 'new', claimExisting: true });
    assert.strictEqual(res.statusCode, 409);
    assert.strictEqual(bodyOf(res).waiting, undefined);
  });
  await check('waitStatus without claimExisting (a plain join): 409', async () => {
    reset();
    await join({ playerName: 'Sam', clientId: 'old' });
    const res = await join({ playerName: 'Sam', clientId: 'new', waitStatus: true });
    assert.strictEqual(res.statusCode, 409);
  });
  await check('waitStatus as a string is not true: 409', async () => {
    reset();
    await join({ playerName: 'Sam', clientId: 'old' });
    const res = await claim({ waitStatus: 'true' });
    assert.strictEqual(res.statusCode, 409);
  });

  say('\n§4. a grant still lands; other failures keep their status');
  await check('after Let them, the waiting claim joins with 200 and no waiting flag', async () => {
    reset();
    await join({ playerName: 'Sam', clientId: 'old' });
    await ask('Sam', { clientId: 'new' });
    await act('Sam', {});
    const res = await claim();
    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(bodyOf(res).waiting, undefined);
    assert.strictEqual(store.get(key(PK, 'PLAYER#Sam')).ClientId, 'new');
  });
  await check('a session that does not exist is still a 404', async () => {
    reset();
    const res = await join({ playerName: 'Sam', clientId: 'new', claimExisting: true, waitStatus: true }, '9999');
    assert.strictEqual(res.statusCode, 404);
  });

  console.log = realLog;
  say(`\n${pass} passed, ${fail} failed`);
  suiteFinished();
  process.exit(fail ? 1 : 0);
})();
