/**
 * THE METER IS WIRED: A SESSION SOMEBODY JOINED IS COUNTED, ONCE.
 *
 * From 6730ce9a (2026-08-23) until this file, `recordBillableSession` was
 * exported from three copies of usage.js and CALLED BY NOTHING. Its own tests
 * (tests/usage-metering.js) called it directly and passed, so the meter looked
 * finished — while every environment wrote zero `LEDGER#…#SESSION#` rows,
 * `sessionsRun` never left 0, the free plan's session gate in create-game.js
 * could not fire, and invoices counted no sessions. The multitenant handoff
 * recorded it the day it shipped ("Nothing is ever billed") and it stayed so.
 *
 * So this file drives the REAL handlers — create-game, start-game, join-game —
 * and reads the rows they leave, instead of calling the meter by hand. A test
 * that calls `recordBillableSession` itself cannot tell whether anything else
 * does, which is exactly how the gap survived a month.
 *
 * WHERE THE CALL LIVES, AND WHY THERE. The billable moment is the FIRST
 * SUCCESSFUL PLAYER JOIN (usage.js header): a session somebody actually joined
 * ran in front of a room; a session created, or started for a rehearsal, and
 * abandoned used nothing. A join is only possible after /start
 * (session-gate.js refuses until METADATA.Started), so "joined" is strictly
 * "started AND somebody came" — and it covers every route a session can go
 * live by, with one call site. The meter never refuses the join
 * (RATIONALE.md §3, "Nothing is ever blocked").
 *
 * Every check carries a `// rejects:` line naming the change it catches.
 */
const path = require('path');
const assert = require('assert');

const REPO = path.join(__dirname, '..');

// ---- KMS, intercepted by request string (as tests/plan-gating.js) ----------
// create-game encrypts a session with a per-org data key, so a real create
// cannot finish without one. Real AES, fake KMS.
const Module = require('module');
const moduleStubs = new Map();
const realLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (moduleStubs.has(request)) return moduleStubs.get(request);
  return realLoad.call(this, request, parent, isMain);
};
const nodeCrypto = require('crypto');
class GenerateDataKeyCommand { constructor(i) { this.input = i; } }
class DecryptCommand { constructor(i) { this.input = i; } }
const wrapKey = (orgId, k) => Buffer.from(JSON.stringify({ orgId, key: k.toString('base64') }), 'utf8');
moduleStubs.set('@aws-sdk/client-kms', {
  KMSClient: class {
    async send(command) {
      if (command instanceof GenerateDataKeyCommand) {
        const orgId = command.input.EncryptionContext?.orgId;
        const k = nodeCrypto.randomBytes(32);
        return { Plaintext: k, CiphertextBlob: wrapKey(orgId, k) };
      }
      if (command instanceof DecryptCommand) {
        const blob = JSON.parse(Buffer.from(command.input.CiphertextBlob).toString('utf8'));
        return { Plaintext: Buffer.from(blob.key, 'base64') };
      }
      throw new Error('unexpected KMS command');
    }
  },
  GenerateDataKeyCommand,
  DecryptCommand,
});
process.env.TENANT_KMS_KEY_ID = 'alias/engage-tenant';

// ---- A fake table that EVALUATES conditions --------------------------------
// The whole claim under test is idempotency, and a stub that accepted every
// conditional write would make "the room bills once" pass unconditionally.
// So every condition these handlers emit is evaluated, and an unknown one
// throws rather than passing as true.
const store = new Map();
const key = (pk, sk) => `${pk}|${sk}`;

class PutCommand { constructor(i) { this.input = i; this.type = 'put'; } }
class GetCommand { constructor(i) { this.input = i; this.type = 'get'; } }
class QueryCommand { constructor(i) { this.input = i; this.type = 'query'; } }
class DeleteCommand { constructor(i) { this.input = i; this.type = 'delete'; } }
class UpdateCommand { constructor(i) { this.input = i; this.type = 'update'; } }
class ScanCommand { constructor(i) { this.input = i; this.type = 'scan'; } }
class BatchWriteCommand { constructor(i) { this.input = i; this.type = 'batchWrite'; } }
class BatchGetCommand { constructor(i) { this.input = i; this.type = 'batchGet'; } }

function conditionFailed() {
  const e = new Error('The conditional request failed');
  e.name = 'ConditionalCheckFailedException';
  return e;
}

function conditionHolds(expr, item) {
  const src = String(expr).trim();
  if (src === 'attribute_not_exists(PK)' || src === 'attribute_not_exists(SK)') return !item;
  if (src === 'attribute_not_exists(ClientId)') return !item || item.ClientId === undefined;
  if (src === 'attribute_exists(RemovedAt)') return !!item && item.RemovedAt !== undefined;
  if (src === 'attribute_exists(PK)') return !!item;
  throw new Error(`test stub: unevaluated ConditionExpression ${JSON.stringify(src)}`);
}

/** SET / ADD / REMOVE, in any order — the forms these handlers emit. */
function applyUpdate(item, inp) {
  const names = inp.ExpressionAttributeNames || {};
  const values = inp.ExpressionAttributeValues || {};
  const src = String(inp.UpdateExpression || '');
  const clause = (kw) => {
    const m = new RegExp(`(?:^|\\s)${kw}\\s+(.*?)(?=\\s+(?:SET|ADD|REMOVE)\\s+|$)`, 'is').exec(src);
    return m ? m[1].split(',').map((s) => s.trim()).filter(Boolean) : [];
  };
  const attr = (n) => names[n] || n;
  const next = { ...item };
  for (const pair of clause('SET')) {
    const [lhs, rhs] = pair.split('=').map((s) => s.trim());
    next[attr(lhs)] = values[rhs];
  }
  for (const pair of clause('ADD')) {
    const [lhs, rhs] = pair.split(/\s+/);
    next[attr(lhs)] = (Number(next[attr(lhs)]) || 0) + values[rhs];
  }
  for (const a of clause('REMOVE')) delete next[attr(a)];
  return next;
}

/** Writes whose SK starts with one of these throw a plain (non-condition)
 *  error — "DynamoDB is having a day" for the meter only. */
const failWritesTo = new Set();
const failing = (sk) => [...failWritesTo].some((p) => String(sk).startsWith(p));

const fakeDoc = {
  send: async (cmd) => {
    const inp = cmd.input || {};
    switch (cmd.type) {
      case 'put': {
        const k = key(inp.Item.PK, inp.Item.SK);
        if (failing(inp.Item.SK)) throw new Error(`injected write failure on ${k}`);
        if (inp.ConditionExpression && !conditionHolds(inp.ConditionExpression, store.get(k))) {
          throw conditionFailed();
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
        if (failing(inp.Key.SK)) throw new Error(`injected write failure on ${k}`);
        const existing = store.get(k);
        if (inp.ConditionExpression && !conditionHolds(inp.ConditionExpression, existing)) {
          throw conditionFailed();
        }
        store.set(k, { ...applyUpdate(existing || { PK: inp.Key.PK, SK: inp.Key.SK }, inp), PK: inp.Key.PK, SK: inp.Key.SK });
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
          out[table] = (req.Keys || []).map((kk) => store.get(key(kk.PK, kk.SK))).filter(Boolean).map((i) => ({ ...i }));
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
        return inp.Select === 'COUNT' ? { Count: items.length, Items: [] } : { Items: items, Count: items.length };
      }
      default:
        return {};
    }
  },
};

// Each lambda-functions/<group>/ may carry its own node_modules; stub every copy.
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

const createGameHandler = require(path.join(REPO, 'lambda-functions/websocket/create-game.js')).handler;
const startGame = require(path.join(REPO, 'lambda-functions/game/start-game.js')).handler;
const joinGame = require(path.join(REPO, 'lambda-functions/game/join-game.js')).handler;
const nextQuestion = require(path.join(REPO, 'lambda-functions/game/next-question.js')).handler;
const usage = require(path.join(REPO, 'lambda-functions/admin/shared/usage.js'));

const cryptos = ['websocket', 'game', 'admin/shared']
  .map((d) => require(path.join(REPO, 'lambda-functions', d, 'tenant-crypto.js')));
const blobs = new Map();
for (const c of cryptos) c.setCiphertextLoader(async (orgId) => blobs.get(orgId) || '');
async function mintKey(orgId) {
  if (!blobs.has(orgId)) blobs.set(orgId, await cryptos[0].createOrgDataKey(orgId));
  for (const c of cryptos) c.forgetOrg(orgId);
}

if (!process.env.DEBUG) { console.log = () => {}; console.warn = () => {}; console.error = () => {}; }
const say = (...a) => process.stdout.write(a.join(' ') + '\n');

let pass = 0, fail = 0;
async function check(label, fn) {
  try { await fn(); say(`  ok   - ${label}`); pass++; }
  catch (e) { say(`  FAIL - ${label}\n         ${e.message}`); fail++; }
}

// ---- Fixtures --------------------------------------------------------------
const SOLO = 'org_solo';     // a personal organisation on the free plan
const OTHER = 'org_other';   // a second one, to prove the meter keeps them apart

const asHost = (orgId, extra = {}) => ({
  requestContext: {
    authorizer: {
      lambda: {
        userId: `user-${orgId}`, username: 'host', email: 'host@x.example',
        orgId, orgRole: 'admin', groups: 'hosts',
      },
    },
    http: { method: 'POST' },
  },
  ...extra,
});
const parse = (res) => JSON.parse(res.body || '{}');

async function seedOrg(orgId, { type = 'personal', plan = 'free' } = {}) {
  store.set(key(`ORG#${orgId}`, 'METADATA'), {
    PK: `ORG#${orgId}`, SK: 'METADATA', orgId, name: orgId, type, plan, status: 'active',
  });
  await mintKey(orgId);
}

function reset() { store.clear(); failWritesTo.clear(); }

async function create(orgId) {
  const res = await createGameHandler(asHost(orgId, {
    body: JSON.stringify({ eventTitle: 'Session', gameType: 'call-and-answer' }),
  }));
  return { res, gameId: parse(res).gameId };
}
const start = (orgId, gameId) => startGame(asHost(orgId, { pathParameters: { gameId } }));
const join = (gameId, playerName, clientId = `browser-${playerName}`) => joinGame({
  pathParameters: { gameId },
  body: JSON.stringify({ playerName, clientId }),
});

/** A created-and-started session, owned by `orgId`. */
async function liveSession(orgId) {
  const { res, gameId } = await create(orgId);
  assert.strictEqual(res.statusCode, 201, `create failed: ${res.body}`);
  const started = await start(orgId, gameId);
  assert.strictEqual(started.statusCode, 200, `start failed: ${started.body}`);
  return gameId;
}

/**
 * The phone remote's "Start First Round": POST next-question on a CREATED
 * session, which never passes through start-game.js (d3446e6b made it start
 * the session). Gives the session one category of a legacy platform set to
 * play — the rows tests/lobby-start-ttl.js lays down for the same door.
 */
async function startFromRemote(orgId, gameId) {
  const PK = `GAME#${gameId}`;
  const SETPK = 'SET#set-alpha';
  Object.assign(store.get(key(PK, 'METADATA')), { QuestionSetId: 'set-alpha' });
  const put = (item) => store.set(key(item.PK, item.SK), item);
  put({
    PK, SK: 'STATE#CATS',
    'AvailMask1-8': '10000000', 'AvailMask9-16': '00000000', 'AvailMask17-24': '00000000',
    'HostMask1-8': '10000000', 'HostMask9-16': '00000000', 'HostMask17-24': '00000000',
  });
  put({ PK, SK: 'CATEGORY#c001#ACTIVE', ActiveIndex: 0, QuestionCount: 3 });
  put({ PK, SK: 'CATEGORY#c001#ORDER', QuestionOrder: ['001', '002', '003'], IsRandomized: false });
  put({ PK, SK: 'STATE#CATS#COUNTS', '1-8': [3], '9-16': [], '17-24': [], TotalEnabled: 3, TotalRemaining: 3, Version: 1 });
  put({ PK: SETPK, SK: 'CATEGORY#c001', Name: 'Pricing' });
  for (const n of ['001', '002', '003']) put({ PK: SETPK, SK: `QUESTION#${n}`, Category: 'Pricing', title: `Question ${n}` });
  return nextQuestion(asHost(orgId, { pathParameters: { gameId }, body: JSON.stringify({}) }));
}

/** Every session ledger row, whatever the period — so a run that straddles
 *  midnight on the last of the month cannot miscount. */
const sessionRows = (orgId) => [...store.values()].filter((i) => i.PK === `ORG#${orgId}`
  && /^LEDGER#\d{4}-\d{2}#SESSION#/.test(String(i.SK)));
const sessionsRun = (orgId) => [...store.values()]
  .filter((i) => i.PK === `ORG#${orgId}` && String(i.SK).startsWith('USAGE#'))
  .reduce((n, i) => n + (Number(i.sessionsRun) || 0), 0);

(async () => {
  say('\nbillable sessions: the meter is called by the join, once per session\n');

  // ── 1. One session, one row, one count ───────────────────────────────────
  say('1. a session somebody joined is billed');

  await check('create, start, one join: one SESSION ledger row and sessionsRun 1', async () => {
    reset();
    await seedOrg(SOLO);
    const gameId = await liveSession(SOLO);
    const joined = await join(gameId, 'Ada');
    assert.strictEqual(joined.statusCode, 200, joined.body);
    // rejects: recordBillableSession exported and called by nothing — the state
    // of every environment from 6730ce9a until this change.
    const rows = sessionRows(SOLO);
    assert.strictEqual(rows.length, 1, `expected one SESSION ledger row, found ${rows.length}`);
    assert.strictEqual(rows[0].gameId, gameId);
    assert.strictEqual(rows[0].orgId, SOLO);
    assert.strictEqual(rows[0].kind, 'SESSION');
    // rejects: stamping a ttl on a financial record (usage.js header).
    assert.strictEqual(rows[0].ttl, undefined, 'the ledger row carries a ttl');
    assert.strictEqual(sessionsRun(SOLO), 1);
  });

  await check('the counter the gate reads agrees with the ledger — nothing for the reconciler to repair', async () => {
    reset();
    await seedOrg(SOLO);
    const gameId = await liveSession(SOLO);
    await join(gameId, 'Ada');
    const period = usage.periodOf(new Date());
    // rejects: raising the counter by a path that writes no ledger row. The
    // reconciler rebuilds sessionsRun FROM the ledger, so a counter the ledger
    // cannot account for is shouted about and never repaired.
    assert.strictEqual(await usage.countBilledSessions(SOLO, period), 1);
    assert.strictEqual((await usage.readUsage(SOLO, period)).sessionsRun, 1);
    const allowance = await usage.readAllowance(SOLO);
    assert.strictEqual(allowance.sessionsUsed, 1, JSON.stringify(allowance));
  });

  await check('a session started from the phone remote (next-question from CREATED) is billed on its join too', async () => {
    reset();
    await seedOrg(SOLO);
    const { res, gameId } = await create(SOLO);
    assert.strictEqual(res.statusCode, 201, res.body);
    const served = await startFromRemote(SOLO, gameId);
    assert.strictEqual(served.statusCode, 200, served.body);
    assert.strictEqual(sessionRows(SOLO).length, 0, 'billed before anybody joined');
    const joined = await join(gameId, 'Ada');
    assert.strictEqual(joined.statusCode, 200, joined.body);
    await join(gameId, 'Grace');
    // rejects: metering in start-game.js. This door never calls it, so a
    // session run from the remote would never be billed; the join is the one
    // place every door leads through.
    assert.strictEqual(sessionRows(SOLO).length, 1);
    assert.strictEqual(sessionsRun(SOLO), 1);
  });

  // ── 2. Idempotent ─────────────────────────────────────────────────────────
  say('\n2. it is one charge however many times the room touches it');

  await check('the whole room joining bills the session ONCE', async () => {
    reset();
    await seedOrg(SOLO);
    const gameId = await liveSession(SOLO);
    for (let i = 0; i < 20; i++) {
      const r = await join(gameId, `Player ${i}`);
      assert.strictEqual(r.statusCode, 200, r.body);
    }
    // rejects: an unconditional ledger put or an ADD with no guard — twenty
    // players would be twenty sessions on the invoice.
    assert.strictEqual(sessionRows(SOLO).length, 1);
    assert.strictEqual(sessionsRun(SOLO), 1);
  });

  await check('a reconnect, a refreshed phone and a lost name race do not bill again', async () => {
    reset();
    await seedOrg(SOLO);
    const gameId = await liveSession(SOLO);
    await join(gameId, 'Ada', 'browser-1');
    const again = await join(gameId, 'Ada', 'browser-1');        // same phone, back again
    assert.strictEqual(again.statusCode, 200, again.body);
    assert.strictEqual(parse(again).isReconnection, true);
    const clash = await join(gameId, 'Ada', 'browser-2');        // someone else, same name
    assert.strictEqual(clash.statusCode, 409, clash.body);
    assert.strictEqual(sessionRows(SOLO).length, 1);
    assert.strictEqual(sessionsRun(SOLO), 1);
  });

  await check('a re-start (the Start button pressed again, a retried request) does not bill twice', async () => {
    reset();
    await seedOrg(SOLO);
    const gameId = await liveSession(SOLO);
    await join(gameId, 'Ada');
    // start-game only moves CREATED -> STARTED, so a second press is refused;
    // the room carries on and another player arrives.
    const second = await start(SOLO, gameId);
    assert.strictEqual(second.statusCode, 400, second.body);
    await join(gameId, 'Grace');
    // rejects: metering on start AND join without one shared key, or keying the
    // row on anything but the session (a clientId, a timestamp).
    assert.strictEqual(sessionRows(SOLO).length, 1);
    assert.strictEqual(sessionsRun(SOLO), 1);
  });

  await check('two sessions are two charges, and two orgs are metered apart', async () => {
    reset();
    await seedOrg(SOLO);
    await seedOrg(OTHER);
    const a = await liveSession(SOLO);
    const b = await liveSession(SOLO);
    const c = await liveSession(OTHER);
    for (const g of [a, b, c]) await join(g, 'Ada');
    // rejects: billing to the caller's org rather than the SESSION's owning org
    // (a join carries no org at all — it must come from METADATA).
    assert.strictEqual(sessionsRun(SOLO), 2);
    assert.strictEqual(sessionsRun(OTHER), 1);
    assert.strictEqual(sessionRows(OTHER)[0].gameId, c);
  });

  // ── 3. What is NOT billed ─────────────────────────────────────────────────
  say('\n3. nobody joined, or nobody to bill: nothing is written');

  await check('creating and starting a session nobody joins bills nothing', async () => {
    reset();
    await seedOrg(SOLO);
    await liveSession(SOLO);
    await create(SOLO);                                          // never started
    // rejects: moving the meter to create-game or start-game. A rehearsal, or a
    // session set up and abandoned, ran in front of nobody (usage.js header:
    // "charging for it teaches them not to experiment").
    assert.strictEqual(sessionRows(SOLO).length, 0);
    assert.strictEqual(sessionsRun(SOLO), 0);
  });

  await check('a session with no owning organisation records nothing', async () => {
    reset();
    // A platform demo, or a row from before tenancy: METADATA with no orgId.
    store.set(key('GAME#4321', 'METADATA'), {
      PK: 'GAME#4321', SK: 'METADATA', Title: 'Platform demo', Started: true, Visibility: 'public',
    });
    store.set(key('GAME#4321', 'STATE'), { PK: 'GAME#4321', SK: 'STATE', State: 'STARTED' });
    const joined = await join('4321', 'Ada');
    assert.strictEqual(joined.statusCode, 200, joined.body);
    // rejects: inventing a partition (ORG#undefined, ORG#) for an unscoped
    // session, which would pool strangers' sessions into one bill.
    const metered = [...store.values()].filter((i) => /^(LEDGER|USAGE)#/.test(String(i.SK)));
    assert.deepStrictEqual(metered, [], `wrote ${JSON.stringify(metered)}`);
    assert.ok(![...store.keys()].some((k) => /^ORG#(undefined|null)?\|/.test(k)), 'an ORG# partition with no id');
  });

  // ── 4. It never blocks the room ───────────────────────────────────────────
  say('\n4. a broken meter never refuses a join');

  await check('the ledger write failing still lets the player in', async () => {
    reset();
    await seedOrg(SOLO);
    const gameId = await liveSession(SOLO);
    failWritesTo.add('LEDGER#');
    failWritesTo.add('USAGE#');
    const joined = await join(gameId, 'Ada');
    // rejects: awaiting the meter without its own catch, or a transaction that
    // ties the player row to the ledger row — both turn a metering blip into
    // "the room cannot get in" (RATIONALE.md §3).
    assert.strictEqual(joined.statusCode, 200, joined.body);
    assert.ok(store.has(key(`GAME#${gameId}`, 'PLAYER#Ada')), 'the player row was not written');
  });

  // ── 5. The gate now has something to read ─────────────────────────────────
  say('\n5. five joined sessions close a free plan\'s door; five unjoined ones do not');

  await check('after five real joined sessions the sixth CREATE is refused with 402', async () => {
    reset();
    await seedOrg(SOLO);
    for (let i = 0; i < 5; i++) {
      const g = await liveSession(SOLO);
      await join(g, 'Ada');
    }
    const sixth = await create(SOLO);
    // rejects: the gate reading a counter nothing raises — before this change a
    // free org could run sessions without end, because sessionsRun stayed 0.
    assert.strictEqual(sixth.res.statusCode, 402, sixth.res.body);
    assert.strictEqual(parse(sixth.res).limit.kind, 'sessions');
    assert.strictEqual(parse(sixth.res).limit.used, 5);
  });

  await check('a session already running keeps admitting players past the allowance', async () => {
    reset();
    await seedOrg(SOLO);
    const running = await liveSession(SOLO);
    for (let i = 0; i < 5; i++) {
      const g = await liveSession(SOLO);
      await join(g, 'Ada');
    }
    // The org is now over its five; the room that was already open is not.
    const late = await join(running, 'Grace');
    // rejects: the meter (or anything beside it) consulting the allowance on
    // join. It bills the sixth session; it never stops it.
    assert.strictEqual(late.statusCode, 200, late.body);
    assert.strictEqual(sessionsRun(SOLO), 6);
  });

  say(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { say(`crashed: ${e.stack}`); process.exit(1); });
