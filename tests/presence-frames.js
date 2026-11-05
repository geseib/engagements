/**
 * "Away" is live: a named player's page opening or closing tells the host.
 *
 * // rejects: dev QA 5 Nov — a player's tab closed and the host's room tile
 * // kept "Waiting on Ben, Cy" until the console was reloaded. disconnect.js
 * // deleted the connection row (so get-players' deviceConnected was already
 * // right) and told nobody; connect.js likewise.
 *
 * Covers websocket/presence.js through the real connect.js and disconnect.js:
 *   - $disconnect of a named PLAYER socket sends every host `presenceChanged`
 *     { playerName, connected: false };
 *   - with another page still open under the name it says connected: true;
 *   - $connect of a named PLAYER socket sends connected: true;
 *   - the host's own socket, the room's window (Viewer) and a lobby socket
 *     send nothing;
 *   - a host that cannot be reached never fails the $disconnect;
 *   - websocket/host-notify.js is game/host-notify.js, byte for byte.
 */
const suiteFinished = require('./helpers/finish-guard');
const path = require('path');
const fs = require('fs');
const assert = require('assert');
const Module = require('module');
const { createPagedTable, commands } = require('./helpers/paged-table');

const REPO = path.join(__dirname, '..');
const WS = path.join(REPO, 'lambda-functions', 'websocket');

const posts = [];
let postFails = false;
class PostToConnectionCommand { constructor(input) { this.input = input; } }
class ApiGatewayManagementApiClient {
  async send(cmd) {
    if (postFails) { const e = new Error('boom'); e.statusCode = 500; throw e; }
    posts.push({ to: cmd.input.ConnectionId, body: JSON.parse(cmd.input.Data) });
    return {};
  }
}

const table = createPagedTable({ pageSize: 50 });
const stubs = new Map([
  ['@aws-sdk/client-dynamodb', { DynamoDBClient: class {} }],
  ['@aws-sdk/lib-dynamodb', { DynamoDBDocumentClient: { from: () => table }, ...commands }],
  ['@aws-sdk/client-apigatewaymanagementapi', { ApiGatewayManagementApiClient, PostToConnectionCommand }],
]);
const realLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (stubs.has(request)) return stubs.get(request);
  return realLoad.call(this, request, parent, isMain);
};

process.env.TABLE_NAME = 'test-table';
process.env.WEBSOCKET_API_ENDPOINT = 'https://ws.example/dev';

const disconnect = require(path.join(WS, 'disconnect.js')).handler;
const connect = require(path.join(WS, 'connect.js')).handler;

const G = '4821';
const conn = (id, extra) => ({ PK: `GAME#${G}`, SK: `CONNECTION#${id}`, ConnectionId: id, GameId: G, ...extra });
const seed = (...rows) => {
  table.store.clear();
  table.log.length = 0;
  posts.length = 0;
  postFails = false;
  table.put({ PK: `GAME#${G}`, SK: 'METADATA' });
  table.put(conn('host-1', { ConnectionType: 'HOST', PlayerName: null }));
  table.put(conn('host-2', { ConnectionType: 'HOST', PlayerName: null }));
  rows.forEach((r) => table.put(r));
};
const presence = () => posts.filter((p) => p.body.type === 'presenceChanged');

let pass = 0, fail = 0;
async function check(label, fn) {
  try { await fn(); console.log(`  PASS  ${label}`); pass++; }
  catch (e) { console.log(`  FAIL  ${label}\n        ${e.message}`); fail++; }
}

(async () => {
  console.log('presence: a named player page opening or closing tells every host device\n');

  seed(conn('ben-1', { ConnectionType: 'PLAYER', PlayerName: 'Ben' }));
  let res = await disconnect({ requestContext: { connectionId: 'ben-1' } });
  await check('a closed tab: 200, the row gone, both host devices told Ben is away', () => {
    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(table.has(`GAME#${G}`, 'CONNECTION#ben-1'), false);
    const sent = presence();
    assert.deepStrictEqual(sent.map((p) => p.to).sort(), ['host-1', 'host-2']);
    sent.forEach((p) => {
      assert.strictEqual(p.body.playerName, 'Ben');
      assert.strictEqual(p.body.connected, false);
      assert.strictEqual(p.body.gameId, G);
    });
  });

  seed(
    conn('ben-1', { ConnectionType: 'PLAYER', PlayerName: 'Ben' }),
    conn('ben-2', { ConnectionType: 'PLAYER', PlayerName: 'Ben' }),
  );
  await disconnect({ requestContext: { connectionId: 'ben-1' } });
  await check('one of two tabs closed: Ben is still here (connected: true), never a false "away"', () => {
    const sent = presence();
    assert.ok(sent.length > 0, 'nothing sent');
    sent.forEach((p) => assert.strictEqual(p.body.connected, true));
  });

  for (const [label, row] of [
    ['the host\'s own socket', conn('host-3', { ConnectionType: 'HOST', PlayerName: null })],
    ['the room\'s window (a viewer)', conn('wall-1', { ConnectionType: 'PLAYER', PlayerName: null, Viewer: 'present', ViewerId: 'abcdefgh12' })],
    ['a name-less player socket', conn('anon-1', { ConnectionType: 'PLAYER', PlayerName: null })],
    ['a lobby socket with no game', { PK: 'GAME#LOBBY', SK: 'CONNECTION#lob-1', ConnectionId: 'lob-1', ConnectionType: 'PLAYER', GameId: null, PlayerName: 'Ben' }],
  ]) {
    seed(row);
    // eslint-disable-next-line no-await-in-loop
    await disconnect({ requestContext: { connectionId: row.ConnectionId } });
    // eslint-disable-next-line no-await-in-loop
    await check(`${label} closing sends nothing`, () => assert.strictEqual(presence().length, 0));
  }

  seed(conn('ben-1', { ConnectionType: 'PLAYER', PlayerName: 'Ben' }));
  postFails = true;
  res = await disconnect({ requestContext: { connectionId: 'ben-1' } });
  await check('a host that cannot be reached never fails the disconnect', () => {
    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(table.has(`GAME#${G}`, 'CONNECTION#ben-1'), false);
  });

  seed();
  res = await connect({ requestContext: { connectionId: 'cy-9' }, queryStringParameters: { gameId: G, playerName: 'Cy' } });
  await check('a page opening: 200, the row stored, the hosts told Cy is here (connected: true)', () => {
    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(table.has(`GAME#${G}`, 'CONNECTION#cy-9'), true);
    const sent = presence();
    assert.deepStrictEqual(sent.map((p) => p.to).sort(), ['host-1', 'host-2']);
    sent.forEach((p) => { assert.strictEqual(p.body.playerName, 'Cy'); assert.strictEqual(p.body.connected, true); });
  });

  seed();
  await connect({ requestContext: { connectionId: 'wall-2' }, queryStringParameters: { gameId: G, viewer: 'present', viewerId: 'abcdefgh12' } });
  await check('the room\'s window opening sends nothing', () => assert.strictEqual(presence().length, 0));

  await check('websocket/host-notify.js is game/host-notify.js, byte for byte', () => {
    const a = fs.readFileSync(path.join(REPO, 'lambda-functions', 'game', 'host-notify.js'), 'utf8');
    const b = fs.readFileSync(path.join(WS, 'host-notify.js'), 'utf8');
    assert.strictEqual(b, a, 'the two copies drifted; edit both');
  });

  await check('the template lets $connect and $disconnect post to the hosts\' sockets', () => {
    const t = fs.readFileSync(path.join(REPO, 'template-clean.yaml'), 'utf8');
    for (const fn of ['ConnectFunction', 'DisconnectFunction']) {
      const at = t.indexOf(`  ${fn}:\n`);
      assert.ok(at >= 0, `${fn} not found`);
      const block = t.slice(at, t.indexOf('\n  ', t.indexOf('Tags:', at)) );
      assert.ok(/execute-api:ManageConnections/.test(block), `${fn} cannot post to a connection`);
    }
  });

  console.log(`\n${pass} passed, ${fail} failed`);
  suiteFinished();
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('harness error:', e); process.exit(1); });
