/**
 * Who does the server think the host is?
 *
 * Every broadcast in this system is a Query for `CONNECTION#` rows under the
 * game, so a socket that has no row receives nothing — while the browser
 * holding it still reports `readyState === OPEN` and paints a green
 * "WebSocket Connected" badge. That failure is silent by construction, and it
 * is the whole reason this file exists.
 *
 * connect.js deliberately retires older connections for the same identity (one
 * host screen, one row per player). The defect is the ORDER it did that in: it
 * deleted every existing HOST row *before* writing its own, unconditionally. So
 * when two `$connect` invocations overlapped — a reconnect, a second /host tab,
 * or `ensureConnected()` firing while a handshake was still in flight — the one
 * that happened to execute LAST won, regardless of which socket the client was
 * actually holding. An older connection landing late deleted the newer row and
 * left the live host screen deaf for the rest of the session.
 *
 * Reproduced against dev before writing this: two isHost=true sockets, the
 * first stayed OPEN and received none of `questionStarted` / `votingStarted`
 * while the second received both.
 *
 * The rule asserted here: the NEWEST connection for an identity always keeps
 * its row. A late-landing older `$connect` may retire itself, never its
 * successor.
 */
const path = require('path');
const assert = require('assert');

const REPO = path.join(__dirname, '..');

/* ---- Stubs, installed before the handler loads ---------------------------- */

class PutCommand { constructor(i) { this.input = i; this.type = 'put'; } }
class QueryCommand { constructor(i) { this.input = i; this.type = 'query'; } }
class DeleteCommand { constructor(i) { this.input = i; this.type = 'delete'; } }

const store = new Map();
const key = (pk, sk) => `${pk}|${sk}`;

/**
 * The fake honours FilterExpression, because connect.js's whole identity model
 * lives in it. A stub that ignored the filter would return every connection row
 * for the game and let a handler that deduped players by nothing at all pass.
 * Only the two shapes connect.js actually sends are supported; anything else
 * throws rather than quietly matching everything.
 */
function applyFilter(items, input) {
  const expr = input.FilterExpression;
  const values = input.ExpressionAttributeValues || {};
  if (!expr) return items;
  if (expr === 'ConnectionType = :ct') {
    return items.filter((i) => i.ConnectionType === values[':ct']);
  }
  if (expr === 'ConnectionType = :ct AND PlayerName = :pn') {
    return items.filter(
      (i) => i.ConnectionType === values[':ct'] && i.PlayerName === values[':pn']
    );
  }
  throw new Error(`fake query: unsupported FilterExpression ${expr}`);
}

const fakeDoc = {
  send: async (cmd) => {
    const inp = cmd.input || {};
    switch (cmd.type) {
      case 'put':
        store.set(key(inp.Item.PK, inp.Item.SK), inp.Item);
        return {};
      case 'delete':
        store.delete(key(inp.Key.PK, inp.Key.SK));
        return {};
      case 'query': {
        const pk = inp.ExpressionAttributeValues[':pk'];
        const prefix = inp.ExpressionAttributeValues[':sk'] ?? '';
        const items = [...store.values()].filter(
          (i) => i.PK === pk && String(i.SK).startsWith(String(prefix))
        );
        return { Items: applyFilter(items, inp) };
      }
      default:
        return {};
    }
  },
};

const STUB_PATHS = [
  REPO,
  path.join(REPO, 'lambda-functions'),
  path.join(REPO, 'lambda-functions', 'websocket'),
];

function stub(name, exports) {
  const seen = new Set();
  for (const base of STUB_PATHS) {
    let p;
    try { p = require.resolve(name, { paths: [base] }); } catch { continue; }
    if (seen.has(p)) continue;
    seen.add(p);
    require.cache[p] = { id: p, filename: p, loaded: true, exports };
  }
  if (!seen.size) throw new Error(`stub(): could not resolve ${name}`);
}

stub('@aws-sdk/client-dynamodb', { DynamoDBClient: class {} });
stub('@aws-sdk/lib-dynamodb', {
  DynamoDBDocumentClient: { from: () => fakeDoc },
  PutCommand, QueryCommand, DeleteCommand,
});

process.env.TABLE_NAME = 'test-table';

const { handler } = require(path.join(REPO, 'lambda-functions/websocket/connect.js'));

/* ---- Harness -------------------------------------------------------------- */

let pass = 0, fail = 0;
async function check(label, fn) {
  try { await fn(); console.log(`  PASS  ${label}`); pass++; }
  catch (e) { console.log(`  FAIL  ${label}\n        ${e.message}`); fail++; }
}

const GAME = '4821';

const connectEvent = (connectionId, query) => ({
  requestContext: { connectionId },
  queryStringParameters: { gameId: GAME, ...query },
});

const put = (item) => store.set(key(item.PK, item.SK), item);

/** Connection rows for the game, in insertion order. */
const rows = () => [...store.values()].filter((i) => String(i.SK).startsWith('CONNECTION#'));
const idsOf = () => rows().map((i) => i.ConnectionId).sort();

/* ---- Cases ---------------------------------------------------------------- */

(async () => {
  console.log('\nhost connection dedup');

  await check('a host connection is stored with its own row', async () => {
    store.clear();
    await handler(connectEvent('host-1', { isHost: 'true' }));
    assert.deepStrictEqual(idsOf(), ['host-1']);
    assert.strictEqual(rows()[0].ConnectionType, 'HOST');
  });

  await check('a second host connection retires the first', async () => {
    store.clear();
    put({
      PK: `GAME#${GAME}`, SK: 'CONNECTION#host-1', ConnectionId: 'host-1',
      ConnectionType: 'HOST', GameId: GAME, PlayerName: null,
      ConnectedAt: new Date(Date.now() - 60_000).toISOString(),
    });
    await handler(connectEvent('host-2', { isHost: 'true' }));
    assert.deepStrictEqual(idsOf(), ['host-2']);
  });

  // Deliberate, and the safer half of the trade: two $connect invocations
  // stamped in the same millisecond retire nobody. Two live rows cost nothing —
  // every broadcast is a Query over all of them, and player notifications now
  // go to every HOST row — whereas picking a winner by anything other than time
  // means a coin flip over which socket the client is holding, which is the
  // silent-deafness bug this file exists for.
  await check('simultaneous host connects both survive rather than one going deaf', async () => {
    store.clear();
    const same = new Date().toISOString();
    put({
      PK: `GAME#${GAME}`, SK: 'CONNECTION#host-a', ConnectionId: 'host-a',
      ConnectionType: 'HOST', GameId: GAME, PlayerName: null, ConnectedAt: same,
    });
    await handler(connectEvent('host-b', { isHost: 'true' }));
    const ids = idsOf();
    assert.ok(ids.includes('host-b'), 'the connecting socket lost its own row');
    assert.ok(ids.includes('host-a'), 'a same-millisecond peer was evicted on a coin flip');
  });

  // A legacy row written before ConnectedAt existed has no claim on the future.
  await check('a row with no ConnectedAt is retired', async () => {
    store.clear();
    put({
      PK: `GAME#${GAME}`, SK: 'CONNECTION#host-legacy', ConnectionId: 'host-legacy',
      ConnectionType: 'HOST', GameId: GAME, PlayerName: null,
    });
    await handler(connectEvent('host-2', { isHost: 'true' }));
    assert.deepStrictEqual(idsOf(), ['host-2']);
  });

  // The one that was broken. `host-new` already holds the row; `host-old`
  // shook hands earlier but its $connect runs afterwards. It must not evict
  // the connection the client is actually holding.
  await check('a late-landing OLDER host connect does not evict the newer row', async () => {
    store.clear();
    const future = new Date(Date.now() + 60_000).toISOString();
    put({
      PK: `GAME#${GAME}`, SK: 'CONNECTION#host-new', ConnectionId: 'host-new',
      ConnectionType: 'HOST', GameId: GAME, PlayerName: null, ConnectedAt: future,
    });

    await handler(connectEvent('host-old', { isHost: 'true' }));

    assert.ok(
      idsOf().includes('host-new'),
      `the live host row was deleted by a stale $connect — rows: ${JSON.stringify(idsOf())}`
    );
  });

  await check('player dedup stays scoped to that player', async () => {
    store.clear();
    const earlier = new Date(Date.now() - 60_000).toISOString();
    put({
      PK: `GAME#${GAME}`, SK: 'CONNECTION#ada-1', ConnectionId: 'ada-1',
      ConnectionType: 'PLAYER', GameId: GAME, PlayerName: 'Ada', ConnectedAt: earlier,
    });
    put({
      PK: `GAME#${GAME}`, SK: 'CONNECTION#bob-1', ConnectionId: 'bob-1',
      ConnectionType: 'PLAYER', GameId: GAME, PlayerName: 'Bob', ConnectedAt: earlier,
    });
    await handler(connectEvent('ada-2', { playerName: 'Ada' }));
    assert.deepStrictEqual(idsOf(), ['ada-2', 'bob-1']);
  });

  await check('a player connect never touches the host row', async () => {
    store.clear();
    await handler(connectEvent('host-1', { isHost: 'true' }));
    await handler(connectEvent('ada-1', { playerName: 'Ada' }));
    assert.deepStrictEqual(idsOf(), ['ada-1', 'host-1']);
  });

  await check('every stored connection carries a ConnectedAt to order by', async () => {
    store.clear();
    await handler(connectEvent('host-1', { isHost: 'true' }));
    assert.ok(rows()[0].ConnectedAt, 'ConnectedAt missing — dedup has nothing to compare');
  });

  console.log(`\n${pass} passed, ${fail} failed\n`);
  if (fail) process.exit(1);
})();
