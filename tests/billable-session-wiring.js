/**
 * A SESSION COUNTS AT ITS SECOND ANSWERED QUESTION — driven through the real
 * handlers, read off the rows they leave.
 *
 * The owner, 2026-09-23: "the session only counts if at least 2 questions get
 * answered by 1 or more people. otherwise we chalk it up to test, or something
 * was not correct and they likely will restart" — and, asked again, "i want to
 * keep it at two answered questions".
 *
 * THE MOMENT: the first answer to the second DIFFERENT question that gets any
 * answer at all. Round numbers do not matter and neither do skips: questions
 * 1-3 skipped, 4 answered, 5 skipped, 6 answered — the session counts on the
 * first answer to 6 (§3 walks exactly that).
 *
 * HISTORY. `recordBillableSession` was exported and called by nothing from
 * 6730ce9a (2026-08-23); 4b39c871 wired it into join-game.js on the first join.
 * The owner then moved the moment: a join happens in every rehearsal and QR
 * test. The call now lives in websocket/session-count.js, behind the answer
 * write in websocket/message.js, and join-game.js bills nothing (§3, §6).
 *
 * WHY THE REAL HANDLERS. A test that calls the meter by hand cannot tell
 * whether anything else does, which is how the first gap survived a month.
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
  // session-count.js claims the first answered question on METADATA.
  const absent = /^attribute_not_exists\(([A-Za-z]+)\)$/.exec(src);
  if (absent) return !item || item[absent[1]] === undefined;
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
const wsMessage = require(path.join(REPO, 'lambda-functions/websocket/message.js')).handler;
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

/**
 * One category of a legacy platform set with `n` questions to play — the rows
 * tests/lobby-start-ttl.js lays down for the same handler.
 */
function layDownSet(gameId, n = 8) {
  const PK = `GAME#${gameId}`;
  const SETPK = 'SET#set-alpha';
  Object.assign(store.get(key(PK, 'METADATA')), { QuestionSetId: 'set-alpha' });
  const put = (item) => store.set(key(item.PK, item.SK), item);
  const ids = Array.from({ length: n }, (_, i) => String(i + 1).padStart(3, '0'));
  put({
    PK, SK: 'STATE#CATS',
    'AvailMask1-8': '10000000', 'AvailMask9-16': '00000000', 'AvailMask17-24': '00000000',
    'HostMask1-8': '10000000', 'HostMask9-16': '00000000', 'HostMask17-24': '00000000',
  });
  put({ PK, SK: 'CATEGORY#c001#ACTIVE', ActiveIndex: 0, QuestionCount: n });
  put({ PK, SK: 'CATEGORY#c001#ORDER', QuestionOrder: ids, IsRandomized: false });
  put({ PK, SK: 'STATE#CATS#COUNTS', '1-8': [n], '9-16': [], '17-24': [], TotalEnabled: n, TotalRemaining: n, Version: 1 });
  put({ PK: SETPK, SK: 'CATEGORY#c001', Name: 'Pricing' });
  for (const id of ids) put({ PK: SETPK, SK: `QUESTION#${id}`, Category: 'Pricing', title: `Question ${id}` });
}

/** A created-and-started session, owned by `orgId`, with questions to ask. */
async function liveSession(orgId) {
  const { res, gameId } = await create(orgId);
  assert.strictEqual(res.statusCode, 201, `create failed: ${res.body}`);
  const started = await start(orgId, gameId);
  assert.strictEqual(started.statusCode, 200, `start failed: ${started.body}`);
  layDownSet(gameId);
  return gameId;
}

const stateOf = (gameId) => store.get(key(`GAME#${gameId}`, 'STATE')).State;
const metadataOf = (gameId) => store.get(key(`GAME#${gameId}`, 'METADATA'));

/**
 * The host's next round: "Start First Round" from the lobby, else Skip — the
 * one press that moves on whether or not anybody answered.
 */
async function serve(orgId, gameId) {
  const inLobby = ['CREATED', 'STARTED'].includes(stateOf(gameId));
  const res = await nextQuestion(asHost(orgId, {
    pathParameters: { gameId },
    body: JSON.stringify(inLobby ? {} : { action: 'skip' }),
  }));
  assert.strictEqual(res.statusCode, 200, `serve failed: ${res.body}`);
  assert.match(stateOf(gameId), /^ASK#\d{3}$/);
  return stateOf(gameId).slice(4);
}

/** A player's answer to the round on screen, over the real WebSocket route. */
async function answer(gameId, playerName, text = 'an answer') {
  const round = stateOf(gameId).slice(4);
  const res = await wsMessage({
    requestContext: { connectionId: `conn-${playerName}` },
    body: JSON.stringify({ messageType: `ANSWER#${round}`, gameId, playerName, answer: text, answerType: 'text' }),
  });
  assert.strictEqual(res.statusCode, 200, `answer refused: ${res.body}`);
  return round;
}
const answerRow = (gameId, round, playerName) =>
  store.get(key(`GAME#${gameId}`, `QUESTION#${round}#ANSWER#${playerName}`));

/** Serve a round and have each named player answer it. */
async function answeredRound(orgId, gameId, players = ['Ada']) {
  const round = await serve(orgId, gameId);
  for (const p of players) await answer(gameId, p);
  return round;
}

/** A session that COUNTS: started, joined, two questions answered. */
async function countedSession(orgId) {
  const gameId = await liveSession(orgId);
  await join(gameId, 'Ada');
  await answeredRound(orgId, gameId);
  await answeredRound(orgId, gameId);
  return gameId;
}

/** Every session ledger row, whatever the period — so a run that straddles
 *  midnight on the last of the month cannot miscount. */
const sessionRows = (orgId) => [...store.values()].filter((i) => i.PK === `ORG#${orgId}`
  && /^LEDGER#\d{4}-\d{2}#SESSION#/.test(String(i.SK)));
const sessionsRun = (orgId) => [...store.values()]
  .filter((i) => i.PK === `ORG#${orgId}` && String(i.SK).startsWith('USAGE#'))
  .reduce((n, i) => n + (Number(i.sessionsRun) || 0), 0);

(async () => {
  say('\nbillable sessions: a session counts at its second answered question\n');

  // ── 1. The moment ─────────────────────────────────────────────────────────
  say('1. the second answered question counts the session');

  await check('one answered question bills nothing; the second bills the session once', async () => {
    reset();
    await seedOrg(SOLO);
    const gameId = await liveSession(SOLO);
    await join(gameId, 'Ada');
    await answeredRound(SOLO, gameId);
    // rejects: counting on the first answer — one question is a sound check.
    assert.strictEqual(sessionRows(SOLO).length, 0, 'billed on the FIRST answered question');
    assert.strictEqual(metadataOf(gameId).CountedAt, undefined);
    await answeredRound(SOLO, gameId);
    // rejects: the meter left uncalled on the answer path.
    const rows = sessionRows(SOLO);
    assert.strictEqual(rows.length, 1, `expected one SESSION ledger row, found ${rows.length}`);
    assert.strictEqual(rows[0].gameId, gameId);
    assert.strictEqual(rows[0].orgId, SOLO);
    assert.strictEqual(rows[0].kind, 'SESSION');
    // rejects: stamping a ttl on a financial record (usage.js header).
    assert.strictEqual(rows[0].ttl, undefined, 'the ledger row carries a ttl');
    assert.strictEqual(sessionsRun(SOLO), 1);
    assert.ok(metadataOf(gameId).CountedAt, 'METADATA.CountedAt was not stamped');
  });

  await check('the counter the gate reads agrees with the ledger — nothing for the reconciler to repair', async () => {
    reset();
    await seedOrg(SOLO);
    await countedSession(SOLO);
    const period = usage.periodOf(new Date());
    // rejects: raising the counter by a path that writes no ledger row. The
    // reconciler rebuilds sessionsRun FROM the ledger.
    assert.strictEqual(await usage.countBilledSessions(SOLO, period), 1);
    assert.strictEqual((await usage.readUsage(SOLO, period)).sessionsRun, 1);
    const allowance = await usage.readAllowance(SOLO);
    assert.strictEqual(allowance.sessionsUsed, 1, JSON.stringify(allowance));
  });

  await check('a session started from the phone remote (next-question from CREATED) counts the same way', async () => {
    reset();
    await seedOrg(SOLO);
    const { res, gameId } = await create(SOLO);
    assert.strictEqual(res.statusCode, 201, res.body);
    layDownSet(gameId);
    await serve(SOLO, gameId);                              // Start First Round, from CREATED
    const joined = await join(gameId, 'Ada');
    assert.strictEqual(joined.statusCode, 200, joined.body);
    await answer(gameId, 'Ada');
    assert.strictEqual(sessionRows(SOLO).length, 0, 'billed on the first answered question');
    await answeredRound(SOLO, gameId);
    // rejects: a meter reached by only one of the two doors that start play.
    assert.strictEqual(sessionRows(SOLO).length, 1);
    assert.strictEqual(sessionsRun(SOLO), 1);
  });

  // ── 2. Idempotent ─────────────────────────────────────────────────────────
  say('\n2. it is one charge however many times the room touches it');

  await check('a whole room answering five questions bills the session ONCE', async () => {
    reset();
    await seedOrg(SOLO);
    const gameId = await liveSession(SOLO);
    const room = Array.from({ length: 12 }, (_, i) => `Player ${i}`);
    for (const p of room) await join(gameId, p);
    for (let r = 0; r < 5; r++) await answeredRound(SOLO, gameId, room);
    // rejects: an unconditional ledger put, or a meter that runs on every
    // answer past the second question — sixty answers, sixty sessions.
    assert.strictEqual(sessionRows(SOLO).length, 1);
    assert.strictEqual(sessionsRun(SOLO), 1);
  });

  await check('a changed answer, a resent answer and a later round do not bill again', async () => {
    reset();
    await seedOrg(SOLO);
    const gameId = await countedSession(SOLO);
    await answer(gameId, 'Ada', 'changed my mind');          // same question, again
    await answer(gameId, 'Ada', 'changed my mind');          // a redelivered frame
    await answeredRound(SOLO, gameId);                        // a third question
    assert.strictEqual(sessionRows(SOLO).length, 1);
    assert.strictEqual(sessionsRun(SOLO), 1);
  });

  await check('two sessions are two charges, and two orgs are metered apart', async () => {
    reset();
    await seedOrg(SOLO);
    await seedOrg(OTHER);
    await countedSession(SOLO);
    await countedSession(SOLO);
    const c = await countedSession(OTHER);
    // rejects: billing to anything but the SESSION's owning org — a player's
    // answer carries no org at all; it must come from METADATA.
    assert.strictEqual(sessionsRun(SOLO), 2);
    assert.strictEqual(sessionsRun(OTHER), 1);
    assert.strictEqual(sessionRows(OTHER)[0].gameId, c);
  });

  // ── 3. What does NOT count ────────────────────────────────────────────────
  say('\n3. a rehearsal, a look around, or one question: nothing is written');

  await check('creating, starting and joining a session bills nothing', async () => {
    reset();
    await seedOrg(SOLO);
    const gameId = await liveSession(SOLO);
    for (let i = 0; i < 20; i++) await join(gameId, `Player ${i}`);
    await create(SOLO);                                      // never started
    // rejects: first-join billing (4b39c871), or a meter in create/start —
    // everybody scanning the QR in a rehearsal is not a session.
    assert.strictEqual(sessionRows(SOLO).length, 0);
    assert.strictEqual(sessionsRun(SOLO), 0);
  });

  await check('questions served and skipped with no answers bill nothing', async () => {
    reset();
    await seedOrg(SOLO);
    const gameId = await liveSession(SOLO);
    await join(gameId, 'Ada');
    for (let r = 0; r < 4; r++) await serve(SOLO, gameId);   // somebody just looking
    // rejects: counting served rounds instead of answered ones.
    assert.strictEqual(sessionRows(SOLO).length, 0);
  });

  await check('a whole room answering ONE question bills nothing', async () => {
    reset();
    await seedOrg(SOLO);
    const gameId = await liveSession(SOLO);
    const room = ['Ada', 'Grace', 'Alan', 'Edsger'];
    for (const p of room) await join(gameId, p);
    await answeredRound(SOLO, gameId, room);
    await serve(SOLO, gameId);                               // skipped
    // rejects: counting ANSWERS (four of them) rather than answered QUESTIONS.
    assert.strictEqual(sessionRows(SOLO).length, 0);
  });

  await check('skip 1-3, answer 4, skip 5, answer 6: it counts on 6, not before', async () => {
    reset();
    await seedOrg(SOLO);
    const gameId = await liveSession(SOLO);
    await join(gameId, 'Ada');
    for (let r = 0; r < 3; r++) await serve(SOLO, gameId);
    const four = await answeredRound(SOLO, gameId);
    assert.strictEqual(four, '004');
    await serve(SOLO, gameId);
    // rejects: "the second answer" read as "an answer on round 2", or as any
    // answer once two rounds exist.
    assert.strictEqual(sessionRows(SOLO).length, 0, 'counted before a second question was answered');
    const six = await answeredRound(SOLO, gameId);
    assert.strictEqual(six, '006');
    assert.strictEqual(sessionRows(SOLO).length, 1);
    assert.strictEqual(metadataOf(gameId).FirstAnsweredRound, '004');
  });

  await check('a session with no owning organisation records nothing', async () => {
    reset();
    // A platform demo, or a row from before tenancy: METADATA with no orgId.
    store.set(key('GAME#4321', 'METADATA'), {
      PK: 'GAME#4321', SK: 'METADATA', Title: 'Platform demo', Started: true, Visibility: 'public',
    });
    store.set(key('GAME#4321', 'STATE'), { PK: 'GAME#4321', SK: 'STATE', State: 'ASK#001', LessonNumber: 1 });
    await answer('4321', 'Ada');
    store.get(key('GAME#4321', 'STATE')).State = 'ASK#002';
    await answer('4321', 'Ada');
    // rejects: inventing a partition (ORG#undefined, ORG#) for an unscoped
    // session, which would pool strangers' sessions into one bill.
    const metered = [...store.values()].filter((i) => /^(LEDGER|USAGE)#/.test(String(i.SK)));
    assert.deepStrictEqual(metered, [], `wrote ${JSON.stringify(metered)}`);
    assert.ok(![...store.keys()].some((k) => /^ORG#(undefined|null)?\|/.test(k)), 'an ORG# partition with no id');
  });

  // ── 4. It never blocks the room ───────────────────────────────────────────
  say('\n4. a broken meter never loses an answer, and tries again');

  await check('the ledger write failing still stores the answer — and the next answer bills', async () => {
    reset();
    await seedOrg(SOLO);
    const gameId = await liveSession(SOLO);
    await join(gameId, 'Ada');
    await join(gameId, 'Grace');
    await answeredRound(SOLO, gameId);
    const second = await serve(SOLO, gameId);
    failWritesTo.add('LEDGER#');
    failWritesTo.add('USAGE#');
    await answer(gameId, 'Ada');
    // rejects: awaiting the meter without its own catch — a metering blip
    // turned into a lost answer (RATIONALE.md §3).
    assert.ok(answerRow(gameId, second, 'Ada'), 'the answer row was not written');
    // rejects: stamping CountedAt before the charge landed — the session
    // would never be billed and the reconciler has no row to rebuild from.
    assert.strictEqual(metadataOf(gameId).CountedAt, undefined, 'marked counted without a charge');
    failWritesTo.clear();
    await answer(gameId, 'Grace');
    assert.strictEqual(sessionRows(SOLO).length, 1, 'the retry on the next answer did not bill');
  });

  // ── 5. The gate reads counted sessions ────────────────────────────────────
  say('\n5. five counted sessions close a free plan\'s door; five rehearsals do not');

  await check('five rehearsals — joined, one question answered — leave the sixth CREATE open', async () => {
    reset();
    await seedOrg(SOLO);
    for (let i = 0; i < 5; i++) {
      const g = await liveSession(SOLO);
      await join(g, 'Ada');
      await answeredRound(SOLO, g);
    }
    const sixth = await create(SOLO);
    // rejects: a rehearsal using up a free plan's allowance.
    assert.strictEqual(sixth.res.statusCode, 201, sixth.res.body);
  });

  await check('after five counted sessions the sixth CREATE is refused with 402', async () => {
    reset();
    await seedOrg(SOLO);
    for (let i = 0; i < 5; i++) await countedSession(SOLO);
    const sixth = await create(SOLO);
    assert.strictEqual(sixth.res.statusCode, 402, sixth.res.body);
    assert.strictEqual(parse(sixth.res).limit.kind, 'sessions');
    assert.strictEqual(parse(sixth.res).limit.used, 5);
  });

  await check('a session already running keeps taking answers past the allowance', async () => {
    reset();
    await seedOrg(SOLO);
    const running = await liveSession(SOLO);
    await join(running, 'Grace');
    await answeredRound(SOLO, running);
    for (let i = 0; i < 5; i++) await countedSession(SOLO);
    // The org is now at its five; the room that was already open is not stopped.
    const round = await serve(SOLO, running);
    await answer(running, 'Grace');
    // rejects: the meter consulting the allowance on the answer path. It bills
    // the sixth session; it never stops it.
    assert.ok(answerRow(running, round, 'Grace'), 'the answer was refused');
    assert.strictEqual(sessionsRun(SOLO), 6);
  });

  // ── 6. One place ──────────────────────────────────────────────────────────
  say('\n6. the meter is called from the answer path and nowhere else');

  // A SURVEY HAS NO ROUNDS AND NO SOCKET ANSWER PATH: its answers arrive by
  // HTTP (PUT /games/{id}/survey/answers, game/survey-answers.js), a different
  // bundle. So game/ carries the same counter, byte for byte, and bills a
  // survey at its second distinct answered question exactly as message.js
  // bills a round-based session. Two copies of ONE rule, not two rules.
  // rejects: a survey-only billing rule drifting from the round one.
  await check('game/session-count.js is byte-identical to websocket/session-count.js', () => {
    const fs = require('fs');
    const read = (rel) => fs.readFileSync(path.join(REPO, 'lambda-functions', rel), 'utf8');
    assert.strictEqual(read('game/session-count.js'), read('websocket/session-count.js'));
  });
  // rejects: a survey answer path that never reaches the meter — survey
  // sessions would run free (IMPLEMENTATION-phase-2.md §5.4).
  await check('the survey answer path calls the game/ copy of countAnsweredQuestion', () => {
    const fs = require('fs');
    const src = fs.readFileSync(path.join(REPO, 'lambda-functions/game/survey-answers.js'), 'utf8');
    assert.ok(/require\(['"]\.\/session-count['"]\)/.test(src), 'survey-answers.js does not require ./session-count');
    assert.ok(/\bcountAnsweredQuestion\s*\(/.test(src), 'survey-answers.js never calls countAnsweredQuestion');
  });

  // A SURVEY'S TWO QUESTIONS CAN RACE. Answers to different questions arrive
  // at once, both try to claim FirstAnsweredRound, and the loser re-reads
  // METADATA to find the winner's question. An eventually-consistent re-read
  // can miss the write it just lost to — it comes back with no
  // FirstAnsweredRound, the loser concludes "same question", and the session
  // that has now answered two questions is not counted at that moment.
  // rejects: the loser's re-read made without ConsistentRead, in either copy.
  for (const copy of ['game', 'websocket']) {
    await check(`${copy}/session-count.js: the loser of the FirstAnsweredRound claim re-reads strongly, and counts`, async () => {
      const { countAnsweredQuestion } = require(path.join(REPO, 'lambda-functions', copy, 'session-count.js'));
      const sentCommands = [];
      const racingDb = {
        send: async (cmd) => {
          sentCommands.push(cmd);
          if (cmd.type === 'update' && /FirstAnsweredRound/.test(cmd.input.UpdateExpression)) throw conditionFailed();
          if (cmd.type === 'get') return { Item: cmd.input.ConsistentRead === true ? { FirstAnsweredRound: 'c001#001' } : {} };
          return {};
        },
      };
      const out = await countAnsweredQuestion(racingDb, 'test-table', '5555', 'c001#002', { orgId: '' });
      const reads = sentCommands.filter((c) => c.type === 'get');
      assert.strictEqual(reads.length, 1);
      assert.strictEqual(reads[0].input.ConsistentRead, true, 'the re-read is eventually consistent');
      assert.strictEqual(out.counted, true, `not counted: ${out.reason}`);
    });
  }

  await check('only the two session-count.js copies call recordBillableSession', () => {
    const fs = require('fs');
    const strip = (src) => src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');
    const callers = [];
    for (const dir of ['game', 'websocket', 'admin']) {
      const abs = path.join(REPO, 'lambda-functions', dir);
      for (const f of fs.readdirSync(abs)) {
        if (!f.endsWith('.js') || f === 'usage.js') continue;
        if (/\brecordBillableSession\s*\(/.test(strip(fs.readFileSync(path.join(abs, f), 'utf8')))) {
          callers.push(`${dir}/${f}`);
        }
      }
    }
    // rejects: a second billable moment — join-game (4b39c871), start-game or
    // next-question — which would bill rehearsals the answer path forgives.
    assert.deepStrictEqual(callers.sort(), ['game/session-count.js', 'websocket/session-count.js']);
  });

  say(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { say(`crashed: ${e.stack}`); process.exit(1); });
