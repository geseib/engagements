/**
 * A SOCKET IS A HOST SOCKET ONLY WHEN THE SERVER SAYS SO.
 *
 * ── THE HOLE ───────────────────────────────────────────────────────────────
 *
 * The WebSocket `$connect` route carries no authorizer, and `connect.js` stored
 * `ConnectionType: 'HOST'` for any socket whose query string said `isHost=true`.
 * Every host-only frame in the product picks its recipients by exactly that
 * attribute — `surveyProgress` (game/survey-broadcast.js), `playerJoined`
 * (game/join-game.js), vote progress (game/submit-vote.js), the player→host
 * relays in websocket/message.js — so anyone holding a session's four-digit
 * code could open
 *
 *     wss://…/dev?gameId=4821&isHost=true
 *
 * and watch the host's private feed: every name as it joins, every vote as it
 * lands, and a survey's live counts. In Who finished mode those counts, read
 * beside the names, hint at who answered what (IMPLEMENTATION-phase-2.md §5
 * item 12). Found in the Survey Phase 2 dev smoke test, 2026-09-23; it predates
 * that work. The same forged connect also EVICTED the real host's row, because
 * connect.js retires older HOST rows for the game — so it doubled as a way to
 * deafen the host screen.
 *
 * ── THE FIX ────────────────────────────────────────────────────────────────
 *
 * `POST /games/{gameId}/host-ticket` sits behind the Cognito authorizer and asks
 * `callerMayDriveSession`, the one rule for who may drive a room. It answers
 * with a random single-use ticket stored under the game (60s). The host page
 * fetches one before EVERY connect — reconnects included — and puts it on the
 * socket URL. connect.js spends it with one conditional Delete: a ticket that
 * exists under THIS game and has not expired makes the row HOST; anything else
 * — absent, malformed, expired, spent, another game's — makes it PLAYER.
 *
 * The connection is never refused for a bad ticket: a phone that asked for
 * `isHost` still gets a working player socket. Why a stored nonce and not a
 * signed token: a nonce needs no secret provisioned per tier, cannot be
 * replayed, and a URL that leaks into a log is spent by the time anyone reads
 * it.
 *
 * rejects: a socket becoming HOST on the query string alone; a ticket minted for
 *          one game opening another; a ticket spent twice; an expired ticket;
 *          a cross-org host minting a ticket; the ticket reaching the logs; the
 *          host page connecting without asking for one.
 */
const suiteFinished = require('./helpers/finish-guard');
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const REPO = path.join(__dirname, '..');
const {
  routesFromTemplate, findRoute, assertScannerWorks,
} = require('./helpers/template-routes');

/* ---- A fake table that honours the conditions the two handlers send --------- */

class GetCommand { constructor(i) { this.input = i; this.type = 'get'; } }
class PutCommand { constructor(i) { this.input = i; this.type = 'put'; } }
class QueryCommand { constructor(i) { this.input = i; this.type = 'query'; } }
class DeleteCommand { constructor(i) { this.input = i; this.type = 'delete'; } }

const store = new Map();
const key = (pk, sk) => `${pk}|${sk}`;
const calls = [];
/** Set to an Error to make the next Delete fail the way DynamoDB can. */
let failNextDelete = null;

const conditionFailed = () => {
  const e = new Error('The conditional request failed');
  e.name = 'ConditionalCheckFailedException';
  return e;
};

/**
 * Only the condition shapes the handlers actually send are understood. Anything
 * else throws, so a handler that changes its condition cannot pass by having the
 * fake quietly ignore it — the spend's whole guarantee lives in the condition.
 */
function conditionHolds(expr, item, values) {
  if (!expr) return true;
  if (expr === 'attribute_not_exists(PK)') return !item;
  if (expr === 'attribute_exists(PK) AND ExpiresAt > :now') {
    return !!item && typeof item.ExpiresAt === 'number' && item.ExpiresAt > values[':now'];
  }
  throw new Error(`fake table: unsupported ConditionExpression ${expr}`);
}

function applyFilter(items, input) {
  const expr = input.FilterExpression;
  const values = input.ExpressionAttributeValues || {};
  if (!expr) return items;
  if (expr === 'ConnectionType = :ct') return items.filter((i) => i.ConnectionType === values[':ct']);
  if (expr === 'ConnectionType = :ct AND PlayerName = :pn') {
    return items.filter((i) => i.ConnectionType === values[':ct'] && i.PlayerName === values[':pn']);
  }
  throw new Error(`fake table: unsupported FilterExpression ${expr}`);
}

const fakeDoc = {
  send: async (cmd) => {
    const inp = cmd.input || {};
    calls.push({ type: cmd.type, input: inp });
    switch (cmd.type) {
      case 'get':
        return { Item: store.get(key(inp.Key.PK, inp.Key.SK)) };
      case 'put': {
        const k = key(inp.Item.PK, inp.Item.SK);
        if (!conditionHolds(inp.ConditionExpression, store.get(k), inp.ExpressionAttributeValues || {})) {
          throw conditionFailed();
        }
        store.set(k, inp.Item);
        return {};
      }
      case 'delete': {
        if (failNextDelete) { const e = failNextDelete; failNextDelete = null; throw e; }
        const k = key(inp.Key.PK, inp.Key.SK);
        const item = store.get(k);
        if (!conditionHolds(inp.ConditionExpression, item, inp.ExpressionAttributeValues || {})) {
          throw conditionFailed();
        }
        store.delete(k);
        return inp.ReturnValues === 'ALL_OLD' ? { Attributes: item } : {};
      }
      case 'query': {
        const pk = inp.ExpressionAttributeValues[':pk'];
        const prefix = inp.ExpressionAttributeValues[':sk'] ?? '';
        const items = [...store.values()].filter(
          (i) => i.PK === pk && String(i.SK).startsWith(String(prefix))
        );
        return { Items: applyFilter(items, inp) };
      }
      default:
        throw new Error(`fake table: unexpected command ${cmd.type}`);
    }
  },
};

const STUB_PATHS = [
  REPO,
  path.join(REPO, 'lambda-functions'),
  path.join(REPO, 'lambda-functions', 'websocket'),
  path.join(REPO, 'lambda-functions', 'game'),
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
  GetCommand, PutCommand, QueryCommand, DeleteCommand,
});

process.env.TABLE_NAME = 'test-table';

const connect = require(path.join(REPO, 'lambda-functions/websocket/connect.js')).handler;
const mint = require(path.join(REPO, 'lambda-functions/game/mint-host-ticket.js')).handler;

/* ---- Harness -------------------------------------------------------------- */

let pass = 0, fail = 0;
async function check(label, fn) {
  try { await fn(); console.log(`  ok   - ${label}`); pass++; }
  catch (e) { console.log(`  FAIL - ${label}\n         ${e.message}`); fail++; }
}

const GAME = '4821';
const OTHER_GAME = '7310';
const ORG_A = 'org_AAAAAAAA';
const ORG_B = 'org_BBBBBBBB';

const nowSec = () => Math.floor(Date.now() / 1000);

function seedGame(gameId, orgId) {
  store.set(key(`GAME#${gameId}`, 'METADATA'), {
    PK: `GAME#${gameId}`, SK: 'METADATA', ...(orgId ? { orgId } : {}),
  });
}

/** A request as it arrives behind the Cognito (Lambda) authorizer. */
function mintEvent(gameId, { groups = 'hosts', orgId = ORG_A, orgIds = '', userId = 'user-host-a', authed = true } = {}) {
  return {
    pathParameters: gameId === undefined ? {} : { gameId },
    requestContext: authed
      ? { authorizer: { lambda: { userId, groups, orgId, orgIds } } }
      : {},
    body: null,
  };
}

const connectEvent = (connectionId, query) => ({
  requestContext: { connectionId },
  queryStringParameters: { gameId: GAME, ...query },
});

const ticketRows = (gameId) => [...store.values()].filter(
  (i) => i.PK === `GAME#${gameId}` && String(i.SK).startsWith('HOSTTICKET#')
);
const connectionRow = (connectionId, gameId = GAME) =>
  store.get(key(`GAME#${gameId}`, `CONNECTION#${connectionId}`));

async function mintFor(gameId, opts) {
  const res = await mint(mintEvent(gameId, opts));
  assert.strictEqual(res.statusCode, 200, `mint answered ${res.statusCode}: ${res.body}`);
  return JSON.parse(res.body).ticket;
}

/** Everything console.log/console.error print while `fn` runs. */
async function captureLogs(fn) {
  const lines = [];
  const orig = { log: console.log, error: console.error, warn: console.warn };
  const grab = (...args) => lines.push(args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' '));
  console.log = grab; console.error = grab; console.warn = grab;
  try { await fn(); } finally { Object.assign(console, orig); }
  return lines.join('\n');
}

(async () => {
  /* ======================================================================== */
  console.log('\n1. POST /games/{gameId}/host-ticket mints for the room\'s own hosts');

  await check('a host of the owning org gets a single-use ticket, stored under the game', async () => {
    store.clear(); seedGame(GAME, ORG_A);
    const res = await mint(mintEvent(GAME));
    assert.strictEqual(res.statusCode, 200, res.body);
    const body = JSON.parse(res.body);
    assert.ok(/^[0-9a-f]{64}$/.test(body.ticket), `ticket is not 32 random bytes of hex: ${body.ticket}`);
    const rows = ticketRows(GAME);
    assert.strictEqual(rows.length, 1);
    assert.strictEqual(rows[0].SK, `HOSTTICKET#${body.ticket}`);
    assert.strictEqual(rows[0].MintedBy, 'user-host-a');
    const life = rows[0].ExpiresAt - nowSec();
    assert.ok(life > 0 && life <= 120, `ticket lives ${life}s — it is spent within a second of minting`);
    assert.strictEqual(rows[0].ttl, rows[0].ExpiresAt, 'the row must also carry the table TTL, or spent-by-nobody tickets pile up');
  });

  await check('the response is never cached', async () => {
    store.clear(); seedGame(GAME, ORG_A);
    const res = await mint(mintEvent(GAME));
    assert.ok(/no-store/.test((res.headers || {})['Cache-Control'] || ''), 'a cached ticket would be a replayed ticket');
  });

  await check('two mints give two different tickets', async () => {
    store.clear(); seedGame(GAME, ORG_A);
    const a = await mintFor(GAME);
    const b = await mintFor(GAME);
    assert.notStrictEqual(a, b);
    assert.strictEqual(ticketRows(GAME).length, 2);
  });

  await check('a member of the owning org acting for another of their orgs still gets one', async () => {
    store.clear(); seedGame(GAME, ORG_A);
    const res = await mint(mintEvent(GAME, { orgId: ORG_B, orgIds: `${ORG_B},${ORG_A}` }));
    assert.strictEqual(res.statusCode, 200, 'membership, not the active library, decides who may drive (tenant.callerMayDriveSession)');
  });

  await check('a host of ANOTHER org is refused with 404, and nothing is written', async () => {
    store.clear(); seedGame(GAME, ORG_A);
    const res = await mint(mintEvent(GAME, { orgId: ORG_B, orgIds: ORG_B }));
    assert.strictEqual(res.statusCode, 404);
    assert.strictEqual(JSON.parse(res.body).ticket, undefined, 'a refusal carried a ticket');
    assert.strictEqual(ticketRows(GAME).length, 0);
  });

  await check('a caller with no identity is refused, even on an orgless session', async () => {
    store.clear(); seedGame(GAME, '');
    const res = await mint(mintEvent(GAME, { authed: false }));
    assert.strictEqual(res.statusCode, 404,
      'callerMayDriveSession waves an anonymous caller through, so the handler must refuse one itself');
    assert.strictEqual(ticketRows(GAME).length, 0);
  });

  await check('a session that does not exist gets no ticket', async () => {
    store.clear();
    const res = await mint(mintEvent(GAME));
    assert.strictEqual(res.statusCode, 404);
    assert.strictEqual(ticketRows(GAME).length, 0);
  });

  await check('no game id is a 400', async () => {
    store.clear();
    const res = await mint(mintEvent(undefined));
    assert.strictEqual(res.statusCode, 400);
  });

  /* ======================================================================== */
  console.log('\n2. $connect: HOST only with a live ticket for THIS game');

  await check('isHost=true with no ticket is stored as PLAYER, and the socket still connects', async () => {
    store.clear(); seedGame(GAME, ORG_A);
    const res = await connect(connectEvent('snoop-1', { isHost: 'true' }));
    assert.strictEqual(res.statusCode, 200, 'a player socket must never be refused');
    assert.strictEqual(connectionRow('snoop-1').ConnectionType, 'PLAYER');
  });

  await check('isHost=true with a made-up ticket is stored as PLAYER', async () => {
    store.clear(); seedGame(GAME, ORG_A);
    await connect(connectEvent('snoop-2', { isHost: 'true', hostTicket: 'a'.repeat(64) }));
    assert.strictEqual(connectionRow('snoop-2').ConnectionType, 'PLAYER');
  });

  await check('a malformed ticket is refused before it reaches the table', async () => {
    store.clear(); seedGame(GAME, ORG_A);
    calls.length = 0;
    await connect(connectEvent('snoop-3', { isHost: 'true', hostTicket: 'x#CONNECTION#host-1' }));
    assert.strictEqual(connectionRow('snoop-3').ConnectionType, 'PLAYER');
    assert.ok(!calls.some((c) => c.type === 'delete' && String(c.input.Key.SK).startsWith('HOSTTICKET#')),
      'a ticket that is not 64 hex characters must never be used to build a key');
  });

  await check('a valid ticket for this game makes the socket HOST, and is spent', async () => {
    store.clear(); seedGame(GAME, ORG_A);
    const ticket = await mintFor(GAME);
    const res = await connect(connectEvent('host-1', { isHost: 'true', hostTicket: ticket }));
    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(connectionRow('host-1').ConnectionType, 'HOST');
    assert.strictEqual(ticketRows(GAME).length, 0, 'the ticket survived its use');
  });

  await check('a spent ticket does not open a second host socket', async () => {
    store.clear(); seedGame(GAME, ORG_A);
    const ticket = await mintFor(GAME);
    await connect(connectEvent('host-1', { isHost: 'true', hostTicket: ticket }));
    await connect(connectEvent('replay-1', { isHost: 'true', hostTicket: ticket }));
    assert.strictEqual(connectionRow('replay-1').ConnectionType, 'PLAYER');
    assert.strictEqual(connectionRow('host-1').ConnectionType, 'HOST', 'the replay must not have evicted the real host');
  });

  await check('a ticket minted for ANOTHER game is stored as PLAYER, and that game\'s ticket is untouched', async () => {
    store.clear(); seedGame(GAME, ORG_A); seedGame(OTHER_GAME, ORG_B);
    const theirs = await mintFor(OTHER_GAME, { orgId: ORG_B, orgIds: ORG_B, userId: 'user-host-b' });
    await connect(connectEvent('crosser-1', { isHost: 'true', hostTicket: theirs }));
    assert.strictEqual(connectionRow('crosser-1').ConnectionType, 'PLAYER');
    assert.strictEqual(ticketRows(OTHER_GAME).length, 1);
  });

  await check('an expired ticket still sitting in the table (TTL lags) is stored as PLAYER', async () => {
    store.clear(); seedGame(GAME, ORG_A);
    const stale = 'b'.repeat(64);
    store.set(key(`GAME#${GAME}`, `HOSTTICKET#${stale}`), {
      PK: `GAME#${GAME}`, SK: `HOSTTICKET#${stale}`, GameId: GAME,
      ExpiresAt: nowSec() - 5, ttl: nowSec() - 5,
    });
    await connect(connectEvent('late-1', { isHost: 'true', hostTicket: stale }));
    assert.strictEqual(connectionRow('late-1').ConnectionType, 'PLAYER');
  });

  await check('an unticketed isHost connect no longer evicts the real host', async () => {
    store.clear(); seedGame(GAME, ORG_A);
    const ticket = await mintFor(GAME);
    await connect(connectEvent('host-1', { isHost: 'true', hostTicket: ticket }));
    // Stamp the real host a minute ago, so a HOST dedup would retire it.
    connectionRow('host-1').ConnectedAt = new Date(Date.now() - 60_000).toISOString();
    await connect(connectEvent('snoop-1', { isHost: 'true' }));
    assert.ok(connectionRow('host-1'), 'a forged isHost connect deleted the host screen\'s row');
    assert.strictEqual(connectionRow('host-1').ConnectionType, 'HOST');
  });

  await check('a ticketed host connect still retires the older host row', async () => {
    store.clear(); seedGame(GAME, ORG_A);
    store.set(key(`GAME#${GAME}`, 'CONNECTION#host-old'), {
      PK: `GAME#${GAME}`, SK: 'CONNECTION#host-old', ConnectionId: 'host-old', ConnectionType: 'HOST',
      GameId: GAME, PlayerName: null, ConnectedAt: new Date(Date.now() - 60_000).toISOString(),
    });
    const ticket = await mintFor(GAME);
    await connect(connectEvent('host-new', { isHost: 'true', hostTicket: ticket }));
    assert.ok(!connectionRow('host-old'), 'the one-host-screen dedup stopped working');
    assert.strictEqual(connectionRow('host-new').ConnectionType, 'HOST');
  });

  await check('a ticket without isHost=true does not make a host, and is not spent', async () => {
    store.clear(); seedGame(GAME, ORG_A);
    const ticket = await mintFor(GAME);
    await connect(connectEvent('ada-1', { playerName: 'Ada', hostTicket: ticket }));
    assert.strictEqual(connectionRow('ada-1').ConnectionType, 'PLAYER');
    assert.strictEqual(ticketRows(GAME).length, 1);
  });

  await check('a table error while spending a ticket refuses the connect rather than guessing', async () => {
    store.clear(); seedGame(GAME, ORG_A);
    const ticket = await mintFor(GAME);
    const e = new Error('Rate exceeded'); e.name = 'ProvisionedThroughputExceededException';
    failNextDelete = e;
    const res = await connect(connectEvent('host-1', { isHost: 'true', hostTicket: ticket }));
    assert.strictEqual(res.statusCode, 500,
      'the host page reconnects with a fresh ticket on a refused handshake; a silent PLAYER row would leave it deaf');
    assert.ok(!connectionRow('host-1'), 'a row was written for a connect that was refused');
  });

  await check('the ticket never reaches the logs', async () => {
    store.clear(); seedGame(GAME, ORG_A);
    const ticket = await mintFor(GAME);
    const reused = 'c'.repeat(64);
    const logs = await captureLogs(async () => {
      await connect(connectEvent('host-1', { isHost: 'true', hostTicket: ticket }));
      await connect(connectEvent('snoop-1', { isHost: 'true', hostTicket: reused }));
    });
    assert.ok(!logs.includes(ticket), 'a live ticket was logged');
    assert.ok(!logs.includes(reused), 'a presented ticket was logged');
  });

  await check('minting never logs the ticket either', async () => {
    store.clear(); seedGame(GAME, ORG_A);
    let body;
    const logs = await captureLogs(async () => { body = JSON.parse((await mint(mintEvent(GAME))).body); });
    assert.ok(!logs.includes(body.ticket));
  });

  /* ======================================================================== */
  console.log('\n3. the route is closed, the copies agree, and the host page asks');

  const routes = routesFromTemplate();
  await check('scanner finds routes, sees Auth, and is not matching everything', () => assertScannerWorks(routes));

  await check('POST /games/{gameId}/host-ticket carries CognitoAuthorizer', () => {
    const hit = findRoute(routes, 'POST', '/games/{gameId}/host-ticket');
    assert.ok(hit, 'the route is not in template-clean.yaml');
    assert.strictEqual(hit.authorizer, 'CognitoAuthorizer');
  });

  await check('the authorizer demands hosts or admins for it, and refuses a pending account', () => {
    const { requiredGroupsForRoute, hasPermission } =
      require(path.join(REPO, 'lambda-functions/auth/authorizer.js'));
    const groups = requiredGroupsForRoute('POST', 'games/{gameId}/host-ticket');
    assert.deepStrictEqual(groups, ['hosts', 'admins']);
    assert.strictEqual(hasPermission(['pending'], groups), false);
  });

  await check('the ticket rules are one file, identical in the game and websocket bundles', () => {
    const a = fs.readFileSync(path.join(REPO, 'lambda-functions/game/host-tickets.js'), 'utf8');
    const b = fs.readFileSync(path.join(REPO, 'lambda-functions/websocket/host-tickets.js'), 'utf8');
    assert.strictEqual(a, b, 'the minting and spending sides disagree about what a ticket is');
  });

  await check('the host page fetches a ticket, with its token, for every host connect', () => {
    const src = fs.readFileSync(path.join(REPO, 'src/src/GameHostPage.jsx'), 'utf8');
    assert.ok(/webSocketClient\.connect\(\s*gameId\s*,\s*null\s*,\s*true\s*,\s*\{\s*hostTicket\b/.test(src),
      'GameHostPage connects as host without handing the client a ticket provider — it would land as PLAYER');
    assert.ok(/requestHostTicket\(\s*\{[^}]*fetchFn:\s*authFetch/.test(src),
      'the ticket must be requested with authFetch — plain fetch carries no token and the route 401s');
  });

  console.log(`\n${pass} passed, ${fail} failed\n`);
  suiteFinished();
  if (fail) process.exit(1);
})();
