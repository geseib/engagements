/**
 * LOCK AGAIN AND NOT NOW — the two host answers the Session panel adds to the
 * name handover (grant-handover.js, join-game.js).
 *
 *   Lock again   revoke a name the host unlocked and nobody has taken yet.
 *   Not now      refuse a pending request; the asking device learns it on its
 *                next try as "The host said not now".
 *
 * Both ride the existing host-only route (POST .../players/{name}/handover) as
 * body flags, so no new function or auth rule is added. tests/name-handover.js
 * keeps proving the grant itself; this file proves only the new answers.
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
const requestHandover = require(path.join(REPO, 'lambda-functions/game/request-handover.js'));
const grantHandover = require(path.join(REPO, 'lambda-functions/game/grant-handover.js'));
const getPlayers = require(path.join(REPO, 'lambda-functions/game/get-players.js'));
const { handoverOpenFor, publicHandoverState } = require(path.join(REPO, 'lambda-functions/game/handover.js'));

let pass = 0, fail = 0;
async function check(label, fn) {
  try { await fn(); console.log(`  PASS  ${label}`); pass++; }
  catch (e) { console.log(`  FAIL  ${label}\n        ${e.message}`); fail++; }
}

const GAME = '4821';
const PK = `GAME#${GAME}`;
function reset() {
  table.clear();
  sent.length = 0;
  store.set(key(PK, 'METADATA'), { PK, SK: 'METADATA', Started: true, Visibility: 'public', AccessCode: null });
  store.set(key(PK, 'CONNECTION#host-1'), { PK, SK: 'CONNECTION#host-1', ConnectionId: 'host-1', ConnectionType: 'HOST' });
}
const join = (body) => joinGame.handler({ pathParameters: { gameId: GAME }, body: JSON.stringify(body) });
const ask = (playerName, body) => requestHandover.handler({ pathParameters: { gameId: GAME, playerName }, body: JSON.stringify(body || {}) });
const HOST = { authorizer: { lambda: { userId: 'host-1', groups: 'hosts' } } };
const act = (playerName, body, requestContext = HOST) => grantHandover.handler({
  requestContext, pathParameters: { gameId: GAME, playerName }, body: JSON.stringify(body || {}),
});
const bodyOf = (res) => JSON.parse(res.body);
const row = (name) => store.get(key(PK, `PLAYER#${name}`));

(async () => {
  console.log('\nlock again');

  await check('locking an unlocked, untaken name closes it, and the grant no longer works', async () => {
    reset();
    await join({ playerName: 'Chris', clientId: 'old' });
    await act('Chris', {});
    assert.ok(row('Chris').HandoverExpiresAt);
    const res = await act('Chris', { lock: true });
    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(row('Chris').HandoverExpiresAt, undefined);
    assert.strictEqual(row('Chris').HandoverForClientId, undefined);
    assert.strictEqual(bodyOf(res).handover.open, false);
    const late = await join({ playerName: 'Chris', clientId: 'new', claimExisting: true });
    assert.strictEqual(late.statusCode, 409, 'a locked name was still takeable');
    assert.strictEqual(row('Chris').ClientId, 'old');
  });

  await check('locking a bound grant removes the binding as well', async () => {
    reset();
    await join({ playerName: 'Chris', clientId: 'old' });
    await ask('Chris', { clientId: 'new' });
    await act('Chris', { bindToRequester: true });
    assert.strictEqual(row('Chris').HandoverForClientId, 'new');
    await act('Chris', { lock: true });
    assert.strictEqual(row('Chris').HandoverForClientId, undefined);
    assert.strictEqual(handoverOpenFor(row('Chris'), 'new'), false);
  });

  await check('a name that was already taken cannot be locked again (nothing to revoke)', async () => {
    reset();
    await join({ playerName: 'Chris', clientId: 'old' });
    await act('Chris', {});
    await join({ playerName: 'Chris', clientId: 'new', claimExisting: true });
    const res = await act('Chris', { lock: true });
    assert.strictEqual(res.statusCode, 409);
    assert.strictEqual(row('Chris').ClientId, 'new', 'locking moved the name');
  });

  await check('locking a name that was never unlocked is a 409, and an absent name a 404', async () => {
    reset();
    await join({ playerName: 'Chris', clientId: 'old' });
    assert.strictEqual((await act('Chris', { lock: true })).statusCode, 409);
    assert.strictEqual((await act('Nobody', { lock: true })).statusCode, 404);
    assert.strictEqual(row('Nobody'), undefined, 'locking created a phantom row');
  });

  await check('locking is host-only: no identity is a 404 and changes nothing', async () => {
    reset();
    await join({ playerName: 'Chris', clientId: 'old' });
    await act('Chris', {});
    const res = await act('Chris', { lock: true }, {});
    assert.strictEqual(res.statusCode, 404);
    assert.ok(row('Chris').HandoverExpiresAt, 'an unauthenticated lock closed the door');
  });

  console.log('\nnot now');

  await check('refusing a pending request clears it', async () => {
    reset();
    await join({ playerName: 'Chris', clientId: 'old' });
    await ask('Chris', { clientId: 'new' });
    const res = await act('Chris', { refuse: true });
    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(row('Chris').HandoverRequestedBy, undefined);
    assert.strictEqual(row('Chris').HandoverRequestedAt, undefined);
    assert.strictEqual(row('Chris').HandoverRefusedFor, 'new');
    assert.ok(row('Chris').HandoverRefusedAt);
    assert.strictEqual(bodyOf(res).handover.requested, false);
  });

  await check('with nothing pending there is nothing to refuse', async () => {
    reset();
    await join({ playerName: 'Chris', clientId: 'old' });
    assert.strictEqual((await act('Chris', { refuse: true })).statusCode, 409);
    assert.strictEqual(row('Chris').HandoverRefusedFor, undefined);
  });

  await check('the asking device learns "The host said not now" on its next try', async () => {
    reset();
    await join({ playerName: 'Chris', clientId: 'old' });
    await ask('Chris', { clientId: 'new' });
    await act('Chris', { refuse: true });
    const res = await join({ playerName: 'Chris', clientId: 'new', claimExisting: true });
    assert.strictEqual(res.statusCode, 409);
    const b = bodyOf(res);
    assert.strictEqual(b.code, 'NAME_TAKEN');
    assert.strictEqual(b.handoverRefused, true);
    assert.ok(/The host said not now/.test(b.message), b.message);
    assert.strictEqual(row('Chris').ClientId, 'old');
  });

  await check('somebody else hitting the same name is not told about the refusal', async () => {
    reset();
    await join({ playerName: 'Chris', clientId: 'old' });
    await ask('Chris', { clientId: 'new' });
    await act('Chris', { refuse: true });
    const b = bodyOf(await join({ playerName: 'Chris', clientId: 'stranger', claimExisting: true }));
    assert.strictEqual(b.handoverRefused, undefined);
    assert.ok(!/not now/.test(b.message));
  });

  await check('refusing also closes a grant bound to that asker', async () => {
    reset();
    await join({ playerName: 'Chris', clientId: 'old' });
    await ask('Chris', { clientId: 'new' });
    await act('Chris', { bindToRequester: true });
    await act('Chris', { refuse: true });
    assert.strictEqual(handoverOpenFor(row('Chris'), 'new'), false, 'the refused asker could still take the name');
    const taken = await join({ playerName: 'Chris', clientId: 'new', claimExisting: true });
    assert.strictEqual(taken.statusCode, 409);
  });

  await check('a fresh ask after a refusal clears the refusal; a later grant is taken normally', async () => {
    reset();
    await join({ playerName: 'Chris', clientId: 'old' });
    await ask('Chris', { clientId: 'new' });
    await act('Chris', { refuse: true });
    await ask('Chris', { clientId: 'new' });
    assert.strictEqual(row('Chris').HandoverRefusedFor, undefined);
    assert.ok(row('Chris').HandoverRequestedBy);
    await act('Chris', { bindToRequester: true });
    const taken = await join({ playerName: 'Chris', clientId: 'new', claimExisting: true });
    assert.strictEqual(taken.statusCode, 200);
    assert.strictEqual(row('Chris').ClientId, 'new');
    assert.strictEqual(row('Chris').HandoverRefusedFor, undefined);
  });

  await check('refusing is host-only and the refusal never reaches the public roster shape', async () => {
    reset();
    await join({ playerName: 'Chris', clientId: 'old' });
    await ask('Chris', { clientId: 'new' });
    assert.strictEqual((await act('Chris', { refuse: true }, {})).statusCode, 404);
    assert.ok(row('Chris').HandoverRequestedBy, 'an unauthenticated refusal cleared the ask');
    await act('Chris', { refuse: true });
    assert.deepStrictEqual(Object.keys(publicHandoverState(row('Chris'))).sort(), ['expiresAt', 'open', 'requested', 'requestedAt']);
    const list = bodyOf(await getPlayers.handler({ pathParameters: { gameId: GAME } }));
    assert.ok(!JSON.stringify(list).includes('"new"'), 'a clientId reached the roster');
  });

  console.log(`\n${pass} passed, ${fail} failed`);
  suiteFinished();
  process.exit(fail ? 1 : 0);
})();
