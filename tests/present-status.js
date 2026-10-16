#!/usr/bin/env node
/**
 * THE ROOM'S WINDOW REPORTS ITS STATE (host console spec §4.2).
 * A Present viewer's PRESENT_STATUS writes Fullscreen/Visible/StatusAt onto
 * its OWN connection row only; a player socket sending it changes nothing;
 * non-boolean values are not written; the host is told with presentChanged.
 * The host door's presentDetail and hostNotes are tested in
 * tests/get-game-host-state.js; /state carrying neither in
 * tests/present-public-reads.js.
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
const sent = [];
const frames = [];
installStubs({ table, sent, frames });
process.env.TABLE_NAME = 'test-table';
process.env.WEBSOCKET_API_ENDPOINT = 'https://ws.test.invalid/dev';

const wsMessage = require(path.join(REPO, 'lambda-functions/websocket/message.js')).handler;
const { presentingDetail } = require(path.join(REPO, 'lambda-functions/game/room-counts.js'));
kmsStubs.installTestKeyLoader();

let pass = 0; let fail = 0;
async function check(label, fn) {
  try { await fn(); pass += 1; console.log(`  ok   - ${label}`); } catch (e) { fail += 1; console.log(`  FAIL - ${label}\n         ${e.message}`); }
}

const put = (item) => table.store.set(table.keyOf(item.PK, item.SK), item);
const get = (pk, sk) => table.store.get(table.keyOf(pk, sk));
const GAME = '6601';
const PK = `GAME#${GAME}`;
const VIEW = 'view-1'; const PHONE = 'phone-1'; const HOST = 'host-1';

function seed() {
  table.store.clear(); sent.length = 0; frames.length = 0;
  put({ PK, SK: 'METADATA', GameType: 'call-and-answer', Started: true });
  put({ PK, SK: 'STATE', State: 'ASK#001', LessonNumber: 1 });
  put({ PK, SK: `CONNECTION#${VIEW}`, ConnectionId: VIEW, ConnectionType: 'PLAYER', Viewer: 'present', ViewerId: 'abcdefgh1', GameId: GAME });
  put({ PK, SK: `CONNECTION#${PHONE}`, ConnectionId: PHONE, ConnectionType: 'PLAYER', PlayerName: 'Ada', GameId: GAME });
  put({ PK, SK: `CONNECTION#${HOST}`, ConnectionId: HOST, ConnectionType: 'HOST', GameId: GAME });
}
const frame = (connectionId, body) => wsMessage({
  requestContext: { connectionId, domainName: 'ws.test.invalid', stage: 'dev' },
  body: JSON.stringify({ messageType: 'PRESENT_STATUS', gameId: GAME, ...body }),
});

(async () => {
  console.log('\npresent-status\n');
  await check('a viewer reports full screen and visible onto its own row, and the host is told', async () => {
    seed();
    const res = await frame(VIEW, { fullscreen: true, visible: true });
    assert.strictEqual(res.statusCode, 200);
    const row = get(PK, `CONNECTION#${VIEW}`);
    assert.strictEqual(row.Fullscreen, true);
    assert.strictEqual(row.Visible, true);
    assert.ok(row.StatusAt);
    assert.ok(frames.some((f) => f.connectionId === HOST && f.message.type === 'presentChanged' && f.message.gameId === GAME));
  });
  await check('a player socket sending PRESENT_STATUS changes nothing, and tells no one', async () => {
    seed();
    await frame(PHONE, { fullscreen: true, visible: true });
    assert.strictEqual(get(PK, `CONNECTION#${PHONE}`).Fullscreen, undefined);
    assert.strictEqual(get(PK, `CONNECTION#${VIEW}`).Fullscreen, undefined);
    assert.ok(!frames.some((f) => f.message.type === 'presentChanged'));
  });
  await check('non-boolean values are not written: no StatusAt, and the host is told nothing', async () => {
    seed();
    await frame(VIEW, { fullscreen: 'yes', visible: 1 });
    const row = get(PK, `CONNECTION#${VIEW}`);
    assert.strictEqual(row.Fullscreen, undefined);
    assert.strictEqual(row.Visible, undefined);
    assert.strictEqual(row.StatusAt, undefined);
    assert.ok(!frames.some((f) => f.message.type === 'presentChanged'));
  });
  await check('a frame carrying neither value at all writes nothing and tells no one', async () => {
    seed();
    await frame(VIEW, {});
    assert.strictEqual(get(PK, `CONNECTION#${VIEW}`).StatusAt, undefined);
    assert.ok(!frames.some((f) => f.message.type === 'presentChanged'));
  });
  await check('one boolean is enough: it is written with StatusAt, and the host is told', async () => {
    seed();
    await frame(VIEW, { fullscreen: 'yes', visible: true });
    const row = get(PK, `CONNECTION#${VIEW}`);
    assert.strictEqual(row.Visible, true);
    assert.strictEqual(row.Fullscreen, undefined);
    assert.ok(row.StatusAt);
    assert.ok(frames.some((f) => f.connectionId === HOST && f.message.type === 'presentChanged'));
  });
  await check('a later report overwrites the earlier one', async () => {
    seed();
    await frame(VIEW, { fullscreen: true, visible: true });
    await frame(VIEW, { fullscreen: false, visible: false });
    const row = get(PK, `CONNECTION#${VIEW}`);
    assert.strictEqual(row.Fullscreen, false);
    assert.strictEqual(row.Visible, false);
  });
  await check('room-counts exports presentingDetail (its behaviour is tested through the host door)', async () => {
    assert.strictEqual(typeof presentingDetail, 'function');
  });

  console.log(`\n${pass} passed, ${fail} failed`);
  suiteFinished();
  process.exit(fail ? 1 : 0);
})();
