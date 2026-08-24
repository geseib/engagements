/**
 * WHOSE SESSION IS THIS? — the scoping contract, driven through the real
 * handlers.
 *
 * Before this change a session had no owner attribute of any kind. Not
 * `hostId`, not `createdBy`, nothing: `HostName` is free text typed into the
 * create form and identifies nobody. `GET /games` therefore had nothing to
 * scope by and returned EVERY session in the environment — every four-digit
 * join code, every title, every host name, every `started` flag — to any
 * caller who asked.
 *
 * THE SCHEME, and the three rows that make it work:
 *
 *   PK: GAMES              SK: GAME#{id}   the GLOBAL code reservation.
 *                                          `{orgId, ttl}` and nothing else.
 *   PK: ORG#{org}#GAMES    SK: GAME#{id}   the brief a host lists.
 *   PK: GAME#{id}          SK: METADATA…   stays GLOBAL, gains an `orgId`.
 *
 * The reservation stays global because a participant types four digits with no
 * idea which organisation they belong to — the code space is one space — and
 * because `attribute_not_exists(PK)` on that row is the uniqueness lock that
 * stops a fresh draw from overwriting a living session (issue #26).
 *
 * The brief moved because the isolation must be STRUCTURAL. §1 does not check
 * that org B's sessions were filtered out of org A's list; it checks that the
 * Query org A issues cannot name org B's partition at all. A filter is a line
 * somebody can delete. A partition boundary is not.
 *
 * And §3 is the other half, which is easy to break while fixing the first: the
 * participant journey is PUBLIC. A player types a code, carries no token and
 * belongs to no organisation. Every row they touch must stay in the global
 * `GAME#{id}` partition, reachable by code alone.
 *
 * Every check below carries a `// rejects:` line naming the change it catches,
 * and every one of them was watched failing against a deliberately broken
 * implementation before being kept.
 */
const path = require('path');
const assert = require('assert');

const REPO = path.join(__dirname, '..');

// ---- The fake table --------------------------------------------------------
const store = new Map();
const log = [];
const key = (pk, sk) => `${pk}|${sk}`;
/** "PK|SK" values whose next Put should blow up — for the rollback checks. */
let failPutOn = new Set();

class PutCommand { constructor(i) { this.input = i; this.type = 'put'; } }
class GetCommand { constructor(i) { this.input = i; this.type = 'get'; } }
class QueryCommand { constructor(i) { this.input = i; this.type = 'query'; } }
class DeleteCommand { constructor(i) { this.input = i; this.type = 'delete'; } }
class UpdateCommand { constructor(i) { this.input = i; this.type = 'update'; } }
class ScanCommand { constructor(i) { this.input = i; this.type = 'scan'; } }
class BatchWriteCommand { constructor(i) { this.input = i; this.type = 'batchWrite'; } }
class BatchGetCommand { constructor(i) { this.input = i; this.type = 'batchGet'; } }

function conditionFailed(message) {
  const err = new Error(message);
  err.name = 'ConditionalCheckFailedException';
  return err;
}

/**
 * A SET-only UpdateExpression applier. Enough for start-game and update-game,
 * which is the point: the tests below assert on the ROW that changed, not on
 * the command that was issued, so a handler that writes the right expression
 * to the wrong partition is caught.
 */
function applyUpdate(item, inp) {
  const names = inp.ExpressionAttributeNames || {};
  const values = inp.ExpressionAttributeValues || {};
  const setClause = /SET\s+(.*?)(\s+REMOVE\s+|$)/is.exec(inp.UpdateExpression || '');
  if (setClause) {
    for (const pair of setClause[1].split(',')) {
      const [lhs, rhs] = pair.split('=').map((s) => s.trim());
      if (!lhs || !rhs) continue;
      const attr = names[lhs] || lhs;
      // Nested paths (HostPreferences.anonymousUntilReveal) — one level is enough.
      const parts = attr.split('.').map((p) => names[p] || p);
      let target = item;
      while (parts.length > 1) {
        const head = parts.shift();
        target[head] = target[head] || {};
        target = target[head];
      }
      target[parts[0]] = values[rhs];
    }
  }
  const removeClause = /REMOVE\s+(.*)$/is.exec(inp.UpdateExpression || '');
  if (removeClause) {
    for (const raw of removeClause[1].split(',')) {
      const attr = names[raw.trim()] || raw.trim();
      delete item[attr];
    }
  }
  return item;
}

const fakeDoc = {
  send: async (cmd) => {
    const inp = cmd.input || {};
    log.push({ type: cmd.type, input: inp });
    switch (cmd.type) {
      case 'put': {
        const k = key(inp.Item.PK, inp.Item.SK);
        if (failPutOn.has(k)) {
          failPutOn.delete(k);
          throw new Error(`injected write failure on ${k}`);
        }
        // The uniqueness lock, honoured for real — §8 and §9 depend on it.
        if (/attribute_not_exists\(PK\)/.test(inp.ConditionExpression || '') && store.has(k)) {
          throw conditionFailed(`row ${k} already exists`);
        }
        store.set(k, inp.Item);
        return {};
      }
      case 'get': {
        const item = store.get(key(inp.Key.PK, inp.Key.SK));
        return { Item: item ? { ...item } : undefined };
      }
      case 'delete':
        store.delete(key(inp.Key.PK, inp.Key.SK));
        return {};
      case 'update': {
        const k = key(inp.Key.PK, inp.Key.SK);
        const existing = store.get(k);
        if (/attribute_exists\(PK\)/.test(inp.ConditionExpression || '') && !existing) {
          throw conditionFailed(`row ${k} does not exist`);
        }
        const item = existing || { PK: inp.Key.PK, SK: inp.Key.SK };
        store.set(k, applyUpdate({ ...item }, inp));
        return {};
      }
      case 'batchWrite': {
        for (const [, requests] of Object.entries(inp.RequestItems || {})) {
          for (const r of requests) {
            if (r.PutRequest) store.set(key(r.PutRequest.Item.PK, r.PutRequest.Item.SK), r.PutRequest.Item);
            if (r.DeleteRequest) store.delete(key(r.DeleteRequest.Key.PK, r.DeleteRequest.Key.SK));
          }
        }
        return { UnprocessedItems: {} };
      }
      case 'batchGet': {
        const out = {};
        for (const [table, req] of Object.entries(inp.RequestItems || {})) {
          out[table] = (req.Keys || [])
            .map((kk) => store.get(key(kk.PK, kk.SK)))
            .filter(Boolean)
            .map((i) => ({ ...i }));
        }
        return { Responses: out };
      }
      case 'scan':
        return { Items: [...store.values()].map((i) => ({ ...i })) };
      case 'query': {
        const v = inp.ExpressionAttributeValues || {};
        const pk = v[':pk'] !== undefined ? v[':pk'] : v[':setpk'];
        const prefix = v[':sk'] !== undefined ? v[':sk'] : (v[':prefix'] || '');
        const items = [...store.values()]
          .filter((i) => i.PK === pk && String(i.SK).startsWith(String(prefix)))
          .map((i) => ({ ...i }));
        return { Items: items, Count: items.length };
      }
      default:
        return {};
    }
  },
};

// Each lambda-functions/<group>/ may carry its own node_modules, and Node
// resolves from the requiring file's directory upward — so stub every copy or
// the real SDK loads and the test dies on credentials instead of assertions.
const STUB_PATHS = [
  REPO,
  path.join(REPO, 'lambda-functions'),
  path.join(REPO, 'lambda-functions', 'admin'),
  path.join(REPO, 'lambda-functions', 'game'),
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
  if (!seen.size) throw new Error(`stub(): could not resolve ${name} from any of ${STUB_PATHS.join(', ')}`);
}

// ── TENANT CRYPTO ──────────────────────────────────────────────────────────
// The handlers this suite drives now encrypt org content, and tenant-crypto
// THROWS on an org with no data key rather than quietly writing plaintext. The
// shared stub refuses a Decrypt with a missing or mismatched encryption context,
// exactly as the key policy will, so this does not weaken anything here.
// Org rows are envelopes at rest since tenancy. `plainRow` unwraps them with
// the real cipher so the assertions below stay about CONTENT — and it is
// synchronous, so a suite that is not about encryption needs no new awaits.
const { makeKmsStub, installTestKeyLoader, plainRowAuto } = require('./helpers/tenant-crypto-stub');
const kmsStub = makeKmsStub();
stub('@aws-sdk/client-kms', kmsStub.exports);
// Every org gets a deterministic data key, no ORG#<id>/METADATA row needed —
// otherwise every reset() in this file would have to re-seed one.
installTestKeyLoader();
stub('@aws-sdk/client-dynamodb', { DynamoDBClient: class {} });
stub('@aws-sdk/lib-dynamodb', {
  DynamoDBDocumentClient: { from: () => fakeDoc },
  PutCommand, GetCommand, QueryCommand, DeleteCommand, UpdateCommand,
  ScanCommand, BatchWriteCommand, BatchGetCommand,
});
stub('@aws-sdk/client-apigatewaymanagementapi', {
  ApiGatewayManagementApiClient: class { async send() { return {}; } },
  PostToConnectionCommand: class { constructor(i) { this.input = i; } },
});

process.env.TABLE_NAME = 'test-table';
process.env.GAME_TABLE = 'test-table';
process.env.WEBSOCKET_API_ENDPOINT = 'https://ws.test.invalid/dev';
process.env.DELETE_RETRY_BASE_MS = '1';

const { GAMES_RESERVATION_PK, gamesIndexPk } = require(path.join(REPO, 'lambda-functions/game/tenant.js'));
const createGameHandler = require(path.join(REPO, 'lambda-functions/websocket/create-game.js')).handler;
const { createGame } = require(path.join(REPO, 'lambda-functions/websocket/schema-compliant-manager.js'));
const startGame = require(path.join(REPO, 'lambda-functions/game/start-game.js')).handler;
const updateGame = require(path.join(REPO, 'lambda-functions/game/update-game.js')).handler;
const gamesList = require(path.join(REPO, 'lambda-functions/game/get-games-list.js')).handler;
const getGame = require(path.join(REPO, 'lambda-functions/game/get-game.js')).handler;
const joinGame = require(path.join(REPO, 'lambda-functions/game/join-game.js')).handler;
const deleteGame = require(path.join(REPO, 'lambda-functions/admin/delete-game.js')).handler;
const clearAllGames = require(path.join(REPO, 'lambda-functions/admin/clear-all-games.js')).handler;

if (!process.env.DEBUG) { console.log = () => {}; console.warn = () => {}; console.error = () => {}; }
const say = (...a) => process.stdout.write(a.join(' ') + '\n');

let pass = 0, fail = 0;
async function check(label, fn) {
  try { await fn(); say(`  PASS  ${label}`); pass++; }
  catch (e) { say(`  FAIL  ${label}\n        ${e.message}`); fail++; }
}

// ---- Fixtures --------------------------------------------------------------
const ACME = 'org_acme';
const GLOBEX = 'org_globex';

/**
 * The event shape the CUSTOM Lambda authorizer really produces. `CognitoAuthorizer`
 * is a REQUEST authorizer with payload format 2.0 and simple responses despite
 * its name, so its context lands at `.authorizer.lambda` — NOT `.jwt.claims`.
 * Eighteen tests once passed green against a shape this API has never emitted.
 */
const asHost = (orgId, extra = {}) => ({
  requestContext: { authorizer: { lambda: { userId: `user-${orgId}`, orgId, orgRole: 'admin', groups: 'hosts' } } },
  ...extra,
});
/** A participant: no authorizer block at all. */
const asParticipant = (extra = {}) => ({ ...extra });

const parse = (res) => JSON.parse(res.body);
const rowsIn = (pk) => [...store.values()].filter((i) => i.PK === pk);
const reservationOf = (id) => store.get(key(GAMES_RESERVATION_PK, `GAME#${id}`));
// DECRYPTED, keyed off the row's own partition. This suite runs two
// organisations against each other, so the key has to follow the row rather
// than a name typed at the call site.
const indexRowOf = (orgId, id) => plainRowAuto(store.get(key(gamesIndexPk(orgId), `GAME#${id}`)));
const metadataOf = (id) => store.get(key(`GAME#${id}`, 'METADATA'));

async function createFor(orgId, body = {}, extra = {}) {
  const res = await createGameHandler(asHost(orgId, {
    body: JSON.stringify({ eventTitle: 'Session', gameType: 'call-and-answer', ...body }),
    ...extra,
  }));
  assert.strictEqual(res.statusCode, 201, `create failed: ${res.body}`);
  return parse(res);
}

function reset() { store.clear(); log.length = 0; failPutOn = new Set(); }

(async () => {
  say('\ntenant session scoping: whose session is this?\n');

  // ------------------------------------------------------------------------
  say('1. one org cannot see another org\'s sessions');
  reset();
  const acmeGame = await createFor(ACME, { eventTitle: 'Acme Kickoff' });
  const globexGame = await createFor(GLOBEX, { eventTitle: 'Globex Retro' });

  await check('host A lists only host A\'s session', async () => {
    const body = parse(await gamesList(asHost(ACME)));
    assert.deepStrictEqual(body.games.map((g) => g.gameId), [acmeGame.gameId],
      `Acme was shown ${JSON.stringify(body.games.map((g) => g.title))}`);
  });
  // rejects: get-games-list querying PK='GAMES' again, or "filtering by orgId
  // in application code" over a global result.
  await check('host B cannot see host A\'s session', async () => {
    const body = parse(await gamesList(asHost(GLOBEX)));
    const ids = body.games.map((g) => g.gameId);
    assert.ok(!ids.includes(acmeGame.gameId), `Globex was shown Acme's session ${acmeGame.gameId}`);
    assert.deepStrictEqual(ids, [globexGame.gameId]);
  });
  // rejects: an implementation that scopes the read but leaks the WRITE — if
  // both briefs land in one partition, no read-side fix can separate them.
  await check('the two briefs are in two different partitions', () => {
    assert.ok(indexRowOf(ACME, acmeGame.gameId), 'Acme has no index row');
    assert.ok(indexRowOf(GLOBEX, globexGame.gameId), 'Globex has no index row');
    assert.strictEqual(indexRowOf(ACME, globexGame.gameId), undefined,
      'Globex\'s session is sitting in Acme\'s partition');
  });
  // rejects: putting the session brief back on the global reservation row,
  // which is what made `GET /games` a directory of every code in the estate.
  await check('the global partition carries codes, not briefs', () => {
    const reservations = rowsIn(GAMES_RESERVATION_PK);
    assert.strictEqual(reservations.length, 2, 'expected one reservation per session');
    for (const row of reservations) {
      assert.deepStrictEqual(
        Object.keys(row).sort(), ['PK', 'SK', 'orgId', 'ttl'].sort(),
        `the reservation row carries ${Object.keys(row).join(', ')}`);
    }
  });
  // rejects: dropping the owner stamp — the attribute every other handler
  // reads to find out which org's index row to maintain.
  await check('METADATA names the owning org', () => {
    assert.strictEqual(metadataOf(acmeGame.gameId).orgId, ACME);
    assert.strictEqual(metadataOf(globexGame.gameId).orgId, GLOBEX);
  });
  // rejects: pinning the set id without its scope — `teamretro` names a
  // different partition in each of platform, org and public.
  await check('METADATA pins the question set\'s SCOPE, not just its id', () => {
    assert.strictEqual(metadataOf(acmeGame.gameId).QuestionSetScope, 'platform',
      'no scope pinned: the set id alone no longer names one partition');
  });
  await check('an explicit scope on the create payload is the one pinned', async () => {
    const scoped = await createFor(ACME, { questionSetScope: 'org', questionSetId: 'teamretro' });
    assert.strictEqual(metadataOf(scoped.gameId).QuestionSetScope, 'org');
  });
  // rejects: an orgless caller falling back to the global partition, which is
  // the "returns everything" bug wearing a different hat.
  await check('a caller with no org gets an empty list, not everything', async () => {
    const body = parse(await gamesList(asParticipant()));
    assert.deepStrictEqual(body.games, [], `an orgless caller was shown ${body.games.length} sessions`);
    assert.strictEqual(body.count, 0);
  });

  // ------------------------------------------------------------------------
  say('\n2. the session brief is maintained where the list reads it');
  reset();
  const live = await createFor(ACME, { eventTitle: 'Before' });

  await check('start-game marks the org\'s index row started', async () => {
    const res = await startGame(asHost(ACME, { pathParameters: { gameId: live.gameId } }));
    assert.strictEqual(res.statusCode, 200, res.body);
    assert.strictEqual(indexRowOf(ACME, live.gameId).Started, true,
      'the host\'s list still shows this session as not started');
  });
  // rejects: start-game writing Started/LastPlayedAt onto PK='GAMES' — a row
  // no list reads, leaving every session list permanently stale.
  await check('start-game does not write session state onto the code registry', () => {
    assert.deepStrictEqual(Object.keys(reservationOf(live.gameId)).sort(),
      ['PK', 'SK', 'orgId', 'ttl'].sort(),
      'the reservation row grew session attributes');
  });

  reset();
  const editable = await createFor(ACME, { eventTitle: 'Before' });
  // rejects: update-game mirroring Title/Visibility onto the old global key —
  // the edit lands, and every list goes on showing the old title.
  await check('an edit is mirrored onto the org\'s index row', async () => {
    const res = await updateGame(asHost(ACME, {
      pathParameters: { gameId: editable.gameId },
      body: JSON.stringify({ eventTitle: 'After', visibility: 'private' }),
    }));
    assert.strictEqual(res.statusCode, 200, res.body);
    assert.strictEqual(indexRowOf(ACME, editable.gameId).Title, 'After');
    assert.strictEqual(indexRowOf(ACME, editable.gameId).Visibility, 'private');
  });
  await check('and the edited title is what the list returns', async () => {
    const body = parse(await gamesList(asHost(ACME)));
    assert.deepStrictEqual(body.games.map((g) => g.title), ['After']);
  });

  // ------------------------------------------------------------------------
  say('\n3. the participant journey did not move');
  reset();
  const room = await createFor(ACME, { eventTitle: 'Open Room' });
  await startGame(asHost(ACME, { pathParameters: { gameId: room.gameId } }));

  // rejects: moving METADATA/STATE into an org partition. A participant types
  // four digits, carries no token and belongs to no organisation — every row
  // the journey touches has to be reachable by code alone.
  await check('a code check works with no token and no org', async () => {
    const res = await getGame(asParticipant({ pathParameters: { gameId: room.gameId } }));
    assert.strictEqual(res.statusCode, 200, res.body);
    assert.strictEqual(parse(res).title, 'Open Room');
  });
  await check('a participant joins by code alone', async () => {
    const res = await joinGame(asParticipant({
      pathParameters: { gameId: room.gameId },
      body: JSON.stringify({ playerName: 'Ada', clientId: 'browser-1' }),
    }));
    assert.strictEqual(res.statusCode, 200, res.body);
    assert.ok(store.get(key(`GAME#${room.gameId}`, 'PLAYER#Ada')), 'no player row was written');
  });
  // rejects: org-scoping ANY row the journey depends on. A participant has no
  // organisation to name, so every row between a typed code and a seat in the
  // room has to be keyed by the code alone — `GAME#{id}` and the reservation.
  await check('every row the journey needs is keyed by the code alone', () => {
    for (const sk of ['METADATA', 'STATE', 'PLAYER#Ada']) {
      assert.ok(store.get(key(`GAME#${room.gameId}`, sk)),
        `GAME#${room.gameId} / ${sk} is not in the global partition a participant can reach`);
    }
    assert.ok(reservationOf(room.gameId), 'the code itself is not globally registered');
  });

  // ------------------------------------------------------------------------
  say('\n4. the four-digit code space does not leak');
  reset();
  const doomed = await createFor(ACME, { eventTitle: 'Delete Me' });
  const doomedId = doomed.gameId;

  // rejects: delete-game dropping only one of the two pointer rows. Missing the
  // reservation burns one of 9,000 codes for 90 days; missing the index row
  // leaves a deleted session listed and offered.
  await check('deleting a session frees its code AND unlists it', async () => {
    const res = await deleteGame({ pathParameters: { gameId: doomedId } });
    assert.strictEqual(res.statusCode, 200, res.body);
    assert.strictEqual(reservationOf(doomedId), undefined, 'the code is still reserved');
    assert.strictEqual(indexRowOf(ACME, doomedId), undefined, 'the session is still listed');
    assert.strictEqual(rowsIn(`GAME#${doomedId}`).length, 0, 'the session partition survived');
  });
  await check('the freed code can be handed to a new session', async () => {
    await createGame(doomedId, { title: 'Reused', orgId: GLOBEX });
    assert.ok(reservationOf(doomedId), 'the reservation could not be retaken');
    assert.strictEqual(indexRowOf(GLOBEX, doomedId).Title, 'Reused');
  });
  await check('the count reported includes both pointer rows', async () => {
    reset();
    const g = await createFor(ACME);
    const before = rowsIn(`GAME#${g.gameId}`).length;
    const res = await deleteGame({ pathParameters: { gameId: g.gameId } });
    assert.strictEqual(parse(res).itemsDeleted, before + 2,
      `reported ${parse(res).itemsDeleted}, expected ${before + 2} (session rows + index + reservation)`);
  });

  /*
    ── THIS TEST USED TO REQUIRE THE CROSS-TENANT WIPE ──────────────────────

    It asserted that ONE call to clear-all-games emptied BOTH Acme's and
    Globex's session indexes. That was a faithful description of the handler —
    it Scanned the whole table and matched `/^ORG#.+#GAMES$/`, so it destroyed
    every organisation's sessions — and the control that fires it sits on the
    org Sessions screen under a list that IS org-scoped, behind a dialog reading
    "Delete all 3 sessions? Everything below goes at once."

    The wipe is now scoped to the caller's own organisation, so the assertion is
    inverted: the OTHER org's sessions must SURVIVE.
  */
  // rejects: a wipe that reaches another organisation's sessions, and a wipe
  // that leaves the caller's own index full of sessions whose rows are gone.
  await check('clear-all-games clears the caller\'s org and spares every other', async () => {
    reset();
    const mine = await createFor(ACME);
    const theirs = await createFor(GLOBEX);
    store.set(key('SETS', 'SET#keepme'), { PK: 'SETS', SK: 'SET#keepme' });
    store.set(key(`ORG#${ACME}`, 'METADATA'), { PK: `ORG#${ACME}`, SK: 'METADATA', name: 'Acme' });
    store.set(key(`ORG#${ACME}`, 'MEMBER#u1'), { PK: `ORG#${ACME}`, SK: 'MEMBER#u1' });

    const res = await clearAllGames({
      requestContext: { authorizer: { lambda: { userId: 'u1', groups: 'admins,hosts', orgId: ACME } } },
    });
    assert.strictEqual(res.statusCode, 200, res.body);

    assert.strictEqual(rowsIn(gamesIndexPk(ACME)).length, 0, "the caller's own index survived");
    assert.strictEqual(rowsIn(`GAME#${mine.gameId}`).length, 0, "the caller's session rows survived");
    assert.strictEqual(
      rowsIn(GAMES_RESERVATION_PK).filter((r) => r.SK === `GAME#${mine.gameId}`).length, 0,
      'the four-digit code was never released back to the pool');

    // THE POINT OF THE CHANGE.
    assert.strictEqual(rowsIn(gamesIndexPk(GLOBEX)).length, 1,
      "another organisation's session index was destroyed");
    assert.ok(rowsIn(`GAME#${theirs.gameId}`).length > 0,
      "another organisation's session rows were destroyed");
  });

  // rejects: matching `ORG#` loosely — that is not a game wipe, it is the
  // customer list.
  await check('a wipe spares the organisations themselves and their sets', () => {
    assert.ok(store.get(key('SETS', 'SET#keepme')), 'question sets were wiped');
    assert.ok(store.get(key(`ORG#${ACME}`, 'METADATA')), 'the organisation itself was wiped');
    assert.ok(store.get(key(`ORG#${ACME}`, 'MEMBER#u1')), 'the membership rows were wiped');
  });

  // rejects: falling back to "everything" when no organisation resolves, which
  // is how a scoped delete turns back into a global one.
  await check('it refuses outright when no organisation is active', async () => {
    reset();
    await createFor(ACME);
    const res = await clearAllGames({});
    assert.strictEqual(res.statusCode, 403, res.body);
    assert.strictEqual(rowsIn(gamesIndexPk(ACME)).length, 1, 'it deleted something anyway');
  });


  // ------------------------------------------------------------------------
  say('\n5. the reservation is still the lock, and still releases');
  reset();
  await createGame('4242', { title: 'First', orgId: ACME });

  // rejects: dropping attribute_not_exists(PK) from the reservation, which is
  // what let a colliding draw overwrite a living session row by row (#26).
  await check('a colliding id fails on the lock, before anything is touched', async () => {
    await assert.rejects(
      () => createGame('4242', { title: 'Second', orgId: GLOBEX }),
      (e) => e.name === 'ConditionalCheckFailedException');
    assert.strictEqual(indexRowOf(ACME, '4242').Title, 'First', 'the living session was overwritten');
    assert.strictEqual(indexRowOf(GLOBEX, '4242'), undefined, 'the loser left a row behind');
  });

  // rejects: taking the lock and not releasing it when a later write fails —
  // a burnt code plus a half-built partition no list shows and no delete finds.
  await check('a create that falls over after the lock releases the code', async () => {
    reset();
    failPutOn = new Set([key('GAME#5150', 'METADATA')]);
    await assert.rejects(() => createGame('5150', { title: 'Doomed', orgId: ACME }));
    assert.strictEqual(reservationOf('5150'), undefined, 'the code stayed reserved after a failed create');
    assert.strictEqual(indexRowOf(ACME, '5150'), undefined, 'a half-created session is listed');
  });

  // ------------------------------------------------------------------------
  say('\n6. the join link points at the site the host is actually using');
  reset();
  // rejects: the hardcoded `https://eng.dev.seibtribe.us/play?...` — the RETIRED
  // off-pipeline twin (CLAUDE.md), frozen at a July 2 bundle with its own
  // Cognito pool. It was handed to hosts on test and prod too.
  await check('joinUrl never names the retired dead twin', async () => {
    const g = await createFor(ACME, {}, { headers: { origin: 'https://engage.test.seibtribe.us' } });
    assert.ok(!/eng\.dev\.seibtribe\.us/.test(g.joinUrl), `joinUrl is ${g.joinUrl}`);
  });
  await check('joinUrl is built from the caller\'s own origin', async () => {
    const g = await createFor(ACME, {}, { headers: { origin: 'https://engage.test.seibtribe.us' } });
    assert.strictEqual(g.joinUrl, `https://engage.test.seibtribe.us/play?gameId=${g.gameId}`);
  });
  await check('a Referer serves when there is no Origin', async () => {
    const g = await createFor(ACME, {}, { headers: { Referer: 'https://engage.seibtribe.us/host/setup?x=1' } });
    assert.strictEqual(g.joinUrl, `https://engage.seibtribe.us/play?gameId=${g.gameId}`);
  });
  await check('with neither, the link is relative rather than a wrong host', async () => {
    const g = await createFor(ACME);
    assert.strictEqual(g.joinUrl, `/play?gameId=${g.gameId}`);
  });

  say(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
