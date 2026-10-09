/**
 * EVERY HOST DEVICE HEARS ABOUT THE ROSTER (Session panel, fix round 1, I1).
 *
 * host-notify.js used to send to the first HOST connection only, so a host with
 * two devices open saw a name request on one of them. Now it sends to all,
 * paging the query, and grant-handover.js tells every host that the roster
 * moved (`playersChanged`) after a grant, a Not now or a Lock again, so a strip
 * raised on both devices clears on both when either answers.
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
const frames = [];
const gone = new Set();
installStubs({ table, sent, frames, gone });
process.env.TABLE_NAME = 'test-table';

const joinGame = require(path.join(REPO, 'lambda-functions/game/join-game.js'));
const requestHandover = require(path.join(REPO, 'lambda-functions/game/request-handover.js'));
const grantHandover = require(path.join(REPO, 'lambda-functions/game/grant-handover.js'));

let pass = 0, fail = 0;
async function check(label, fn) {
  try { await fn(); console.log(`  PASS  ${label}`); pass++; }
  catch (e) { console.log(`  FAIL  ${label}\n        ${e.message}`); fail++; }
}

const GAME = '4821';
const PK = `GAME#${GAME}`;
function reset(hosts = ['host-1', 'host-2']) {
  table.clear();
  table.pageSize = undefined;
  sent.length = 0; frames.length = 0; gone.clear();
  store.set(key(PK, 'METADATA'), { PK, SK: 'METADATA', Started: true, Visibility: 'public', AccessCode: null });
  hosts.forEach((id) => store.set(key(PK, `CONNECTION#${id}`), { PK, SK: `CONNECTION#${id}`, ConnectionId: id, ConnectionType: 'HOST' }));
  store.set(key(PK, 'CONNECTION#phone'), { PK, SK: 'CONNECTION#phone', ConnectionId: 'phone', ConnectionType: 'PARTICIPANT' });
}
const join = (body) => joinGame.handler({ pathParameters: { gameId: GAME }, body: JSON.stringify(body) });
const ask = (playerName, body) => requestHandover.handler({ pathParameters: { gameId: GAME, playerName }, body: JSON.stringify(body || {}) });
const HOST = { authorizer: { lambda: { userId: 'host-1', groups: 'hosts' } } };
const act = (playerName, body) => grantHandover.handler({
  requestContext: HOST, pathParameters: { gameId: GAME, playerName }, body: JSON.stringify(body || {}),
});
const to = (type) => frames.filter((f) => f.message.type === type).map((f) => f.connectionId).sort();

(async () => {
  await check('a name request reaches both HOST connections, and no phone', async () => {
    reset();
    await join({ playerName: 'Chris', clientId: 'old' });
    frames.length = 0;
    await ask('Chris', { clientId: 'new' });
    assert.deepStrictEqual(to('handoverRequested'), ['host-1', 'host-2']);
  });

  await check('every host is reached even when the connection rows span pages', async () => {
    reset(['host-1', 'host-2', 'host-3']);
    await join({ playerName: 'Chris', clientId: 'old' });
    frames.length = 0;
    table.pageSize = 1;
    await ask('Chris', { clientId: 'new' });
    assert.deepStrictEqual(to('handoverRequested'), ['host-1', 'host-2', 'host-3']);
  });

  await check('a dead host connection is reaped and the live one still hears', async () => {
    reset();
    await join({ playerName: 'Chris', clientId: 'old' });
    frames.length = 0;
    gone.add('host-1');
    await ask('Chris', { clientId: 'new' });
    assert.deepStrictEqual(to('handoverRequested'), ['host-2']);
    assert.ok(!store.has(key(PK, 'CONNECTION#host-1')), 'the dead row stayed');
  });

  for (const [label, body] of [['a grant', { bindToRequester: true }], ['Not now', { refuse: true }]]) {
    await check(`${label} tells every host the roster moved, so a strip on the other device clears`, async () => {
      reset();
      await join({ playerName: 'Chris', clientId: 'old' });
      await ask('Chris', { clientId: 'new' });
      frames.length = 0;
      assert.strictEqual((await act('Chris', body)).statusCode, 200);
      assert.deepStrictEqual(to('playersChanged'), ['host-1', 'host-2']);
    });
  }

  await check('Lock again tells every host too', async () => {
    reset();
    await join({ playerName: 'Chris', clientId: 'old' });
    await act('Chris', {});
    frames.length = 0;
    await act('Chris', { lock: true });
    assert.deepStrictEqual(to('playersChanged'), ['host-1', 'host-2']);
  });

  await check('a refused action tells nobody', async () => {
    reset();
    await join({ playerName: 'Chris', clientId: 'old' });
    frames.length = 0;
    await act('Chris', { lock: true });
    assert.deepStrictEqual(to('playersChanged'), []);
  });

  console.log(`\n${pass} passed, ${fail} failed`);
  suiteFinished();
  process.exit(fail ? 1 : 0);
})();
