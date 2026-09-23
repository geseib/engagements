/**
 * A JOIN TELLS THE HOST, AND DOES NOT WRITE A DIARY ABOUT IT.
 *
 * `notifyHostOfPlayerJoin` in game/join-game.js logged the whole API Gateway
 * management client's configuration (`apigateway.config` — credentials
 * provider, retry strategy, endpoint resolver, middleware stack) on EVERY join,
 * plus a run of `WEBSOCKET DEBUG` lines around it: about sixteen CloudWatch
 * lines per person arriving, measured on dev in the Survey Phase 2 smoke test
 * (2026-09-23). When no host was connected it also ran a SECOND Query, over
 * every connection row in the game, purely to print them — player names and
 * connection ids into the log of a public route.
 *
 * What is kept is what an operator needs: that the host could not be told, and
 * why a send failed.
 *
 * rejects: the client config or the WEBSOCKET DEBUG chatter coming back; the
 *          diagnostic connection scan coming back; the host no longer being
 *          told at all.
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
process.env.WEBSOCKET_API_ENDPOINT = 'https://ws.test.invalid/dev';

const { handler } = require(path.join(REPO, 'lambda-functions/game/join-game.js'));

let pass = 0, fail = 0;
async function check(label, fn) {
  try { await fn(); console.log(`  ok   - ${label}`); pass++; }
  catch (e) { console.log(`  FAIL - ${label}\n         ${e.message}`); fail++; }
}

const GAME = '4821';

function reset({ withHost }) {
  table.clear();
  sent.length = 0;
  store.set(key(`GAME#${GAME}`, 'METADATA'), {
    PK: `GAME#${GAME}`, SK: 'METADATA', Started: true, Visibility: 'public', AccessCode: null,
  });
  if (withHost) {
    store.set(key(`GAME#${GAME}`, 'CONNECTION#host-1'), {
      PK: `GAME#${GAME}`, SK: 'CONNECTION#host-1', ConnectionId: 'host-1', ConnectionType: 'HOST',
    });
  }
}

/** Join once, returning what the handler printed and what it answered. */
async function joinCapturing(name) {
  const lines = [];
  const orig = { log: console.log, error: console.error, warn: console.warn };
  const grab = (...args) => lines.push(args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a) ?? String(a))).join(' '));
  console.log = grab; console.error = grab; console.warn = grab;
  let res;
  try {
    res = await handler({
      pathParameters: { gameId: GAME },
      body: JSON.stringify({ playerName: name, clientId: `client-${name}` }),
    });
  } finally {
    Object.assign(console, orig);
  }
  return { res, logs: lines };
}

(async () => {
  console.log('\njoin → host notification, without the noise');

  await check('the host is still told when someone joins', async () => {
    reset({ withHost: true });
    const { res } = await joinCapturing('Ada');
    assert.strictEqual(res.statusCode, 200, res.body);
    assert.ok(sent.some((m) => m.type === 'playerJoined' && m.player && m.player.playerName === 'Ada'),
      `no playerJoined reached the host: ${JSON.stringify(sent)}`);
  });

  await check('a join logs no WEBSOCKET DEBUG lines and never the API client', async () => {
    reset({ withHost: true });
    const { logs } = await joinCapturing('Ada');
    const noisy = logs.filter((l) => /WEBSOCKET DEBUG|ApiGateway client configured/.test(l));
    assert.deepStrictEqual(noisy, [], `still logged:\n${noisy.join('\n')}`);
  });

  await check('with no host connected, the join does not scan every connection just to print it', async () => {
    reset({ withHost: false });
    const { res, logs } = await joinCapturing('Ada');
    assert.strictEqual(res.statusCode, 200, res.body);
    const connectionQueries = table.log.filter((c) => c.type === 'query'
      && (c.input.ExpressionAttributeValues || {})[':sk'] === 'CONNECTION#');
    assert.strictEqual(connectionQueries.filter((c) => !c.input.FilterExpression).length, 0,
      'an unfiltered CONNECTION# scan ran — the old diagnostic dump');
    assert.ok(!logs.some((l) => /All connections for game/.test(l)), 'the connection rows were printed');
  });

  console.log(`\n${pass} passed, ${fail} failed\n`);
  suiteFinished();
  if (fail) process.exit(1);
})();
