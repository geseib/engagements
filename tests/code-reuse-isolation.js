/**
 * TASK 2 (bug sweep, 2026-09-26): a join code whose old rows still exist is
 * not handed out again.
 *
 * THE BUG. The only lock on a 4-digit code has been the conditional Put of the
 * `GAMES` reservation row (`attribute_not_exists(PK)`,
 * schema-compliant-manager.js's first write) — drawn in the retry loop at
 * create-game.js (`MAX_ID_ATTEMPTS = 8`). That reservation expires 7 days
 * after start (session-ttl.js). But several `GAME#<code>` rows outlive it:
 * `PLAYER#x#SCORE` and `QUESTION#nnn#AISummary` both carry a 30-day ttl. A
 * code drawn again between day 7 and day 30 inherited those rows untouched —
 * a NEW session silently playing on top of another session's leaderboard and
 * cached Workie summary.
 *
 * THE FIX pins one new rule: the draw treats a candidate as taken when its
 * `GAME#<code>` partition holds ANY row at all, reservation or not. These
 * tests exercise the REAL create-game.js handler end to end (same style as
 * tests/update-game.js's "the 4-digit id cannot silently take over a living
 * session" section, which this borrows its fake table and Math.random control
 * from) rather than unit-testing the query in isolation, because the bug was
 * never in the query — it was in never asking.
 *
 * Every fixture is an ORGLESS create (no requestContext.authorizer). That
 * skips the allowance gate and the per-org encryption entirely — neither is
 * this task's subject, and schema-compliant-manager.js's own comments say an
 * orgless session is created and read exactly like any other.
 */
const suiteFinished = require('./helpers/finish-guard');
const path = require('path');
const assert = require('assert');

const REPO = path.join(__dirname, '..');

// ---- module stubbing: intercept by request name, same as tests/update-game.js
// (poisoning require.cache by resolved path silently misses a second copy).
const Module = require('module');
const stubs = new Map();
const realLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (stubs.has(request)) return stubs.get(request);
  return realLoad.call(this, request, parent, isMain);
};
function stub(name, exports) { stubs.set(name, exports); }

// ---- in-memory table --------------------------------------------------------
const store = new Map();
const key = (pk, sk) => `${pk}|${sk}`;

/** Every Query input the fake ever received, in order. Round-1 review found
 *  that a fake this permissive (no ConsistentRead/Limit/FilterExpression
 *  enforcement) would pass an eventually-consistent read or a `ttl > :now`
 *  filter just as happily as the real, correct Query — so the input itself
 *  is recorded here and asserted on below, not inferred from behaviour. */
const queries = [];

class GetCommand { constructor(i) { this.input = i; this.type = 'get'; } }
class PutCommand { constructor(i) { this.input = i; this.type = 'put'; } }
class QueryCommand { constructor(i) { this.input = i; this.type = 'query'; } }
class UpdateCommand { constructor(i) { this.input = i; this.type = 'update'; } }
class DeleteCommand { constructor(i) { this.input = i; this.type = 'delete'; } }
class ScanCommand { constructor(i) { this.input = i; this.type = 'scan'; } }
class TransactWriteCommand { constructor(i) { this.input = i; this.type = 'transact'; } }
class BatchWriteCommand { constructor(i) { this.input = i; this.type = 'batchWrite'; } }

const conditionalFailure = () => {
  const e = new Error('The conditional request failed');
  e.name = 'ConditionalCheckFailedException';
  return e;
};

/** Split "a = :a, b = if_not_exists(#p, :q)" on top-level commas only. */
function splitClauses(part) {
  const out = [];
  let depth = 0, cur = '';
  for (const ch of part) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ',' && depth === 0) { out.push(cur); cur = ''; continue; }
    cur += ch;
  }
  if (cur.trim()) out.push(cur);
  return out.map((c) => c.trim());
}

const fakeDoc = {
  send: async (cmd) => {
    const inp = cmd.input || {};
    switch (cmd.type) {
      case 'put':
        // attribute_not_exists(PK) is the id-reservation lock (issue #26) —
        // honour it, or the collision tests test a fake that cannot collide.
        if (/attribute_not_exists\(PK\)/.test(inp.ConditionExpression || '')
            && store.has(key(inp.Item.PK, inp.Item.SK))) {
          throw conditionalFailure();
        }
        store.set(key(inp.Item.PK, inp.Item.SK), inp.Item);
        return {};
      case 'get':
        return { Item: store.get(key(inp.Key.PK, inp.Key.SK)) };
      case 'delete':
        store.delete(key(inp.Key.PK, inp.Key.SK));
        return {};
      case 'update': {
        const k = key(inp.Key.PK, inp.Key.SK);
        let item = store.get(k);
        if (/attribute_exists\(PK\)/.test(inp.ConditionExpression || '') && !item) {
          throw conditionalFailure();
        }
        if (!item) { item = { PK: inp.Key.PK, SK: inp.Key.SK }; store.set(k, item); }

        const expr = inp.UpdateExpression || '';
        const names = inp.ExpressionAttributeNames || {};
        const values = inp.ExpressionAttributeValues || {};
        const resolveSeg = (s) => (s.startsWith('#') ? names[s] : s);
        const pathOf = (t) => t.trim().split('.').map(resolveSeg);
        const getPath = (obj, p) => p.reduce((o, seg) => (o == null ? undefined : o[seg]), obj);
        const setPath = (obj, p, value) => {
          let o = obj;
          for (let i = 0; i < p.length - 1; i++) {
            if (o[p[i]] === null || typeof o[p[i]] !== 'object') o[p[i]] = {};
            o = o[p[i]];
          }
          o[p[p.length - 1]] = value;
        };

        const setPart = (expr.match(/SET\s+(.*?)(?=\s*REMOVE\b|$)/is) || [])[1];
        if (setPart) {
          for (const clause of splitClauses(setPart)) {
            const eq = clause.indexOf('=');
            const lhs = clause.slice(0, eq).trim();
            const rhs = clause.slice(eq + 1).trim();
            const ifne = rhs.match(/^if_not_exists\(([^,]+),\s*(:[\w]+)\)$/);
            let value;
            if (ifne) {
              const existing = getPath(item, pathOf(ifne[1]));
              value = existing !== undefined ? existing : values[ifne[2]];
            } else {
              value = values[rhs];
            }
            setPath(item, pathOf(lhs), value);
          }
        }
        const removePart = (expr.match(/REMOVE\s+(.+)$/i) || [])[1];
        if (removePart) {
          for (const t of removePart.split(',')) {
            const p = pathOf(t);
            const parent = p.length > 1 ? getPath(item, p.slice(0, -1)) : item;
            if (parent && typeof parent === 'object') delete parent[p[p.length - 1]];
          }
        }
        return {};
      }
      case 'query': {
        queries.push({ ...inp });
        const v = inp.ExpressionAttributeValues || {};
        const pk = v[':pk'] ?? v[':PK'];
        const prefix = v[':sk'] ?? v[':prefix'] ?? '';
        const items = [...store.values()].filter(
          (i) => i.PK === pk && String(i.SK).startsWith(String(prefix))
        );
        return { Items: items, Count: items.length };
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
      case 'transact': {
        for (const t of inp.TransactItems || []) {
          if (t.Put) await fakeDoc.send({ type: 'put', input: t.Put });
          if (t.Update) await fakeDoc.send({ type: 'update', input: t.Update });
          if (t.Delete) await fakeDoc.send({ type: 'delete', input: t.Delete });
        }
        return {};
      }
      default:
        return { Items: [], Count: 0 };
    }
  },
};

stub('@aws-sdk/client-dynamodb', { DynamoDBClient: class {} });
stub('@aws-sdk/lib-dynamodb', {
  DynamoDBDocumentClient: { from: () => fakeDoc },
  GetCommand, PutCommand, QueryCommand, UpdateCommand, DeleteCommand, ScanCommand,
  TransactWriteCommand, BatchWriteCommand,
});
stub('@aws-sdk/client-apigatewaymanagementapi', {
  ApiGatewayManagementApiClient: class { async send() { return {}; } },
  PostToConnectionCommand: class { constructor(i) { this.input = i; } },
});

process.env.TABLE_NAME = 'test-table';

const createGameHandler = require(path.join(REPO, 'lambda-functions', 'websocket', 'create-game.js')).handler;

let pass = 0, fail = 0;
async function acheck(label, fn) {
  try { await fn(); console.log(`  PASS  ${label}`); pass++; }
  catch (e) { console.log(`  FAIL  ${label}\n        ${e.message}`); fail++; }
}

const realLog = console.log;
const realWarn = console.warn;
const realError = console.error;
const quiet = () => { console.log = () => {}; console.warn = () => {}; console.error = () => {}; };
const loud = () => { console.log = realLog; console.warn = realWarn; console.error = realError; };

/** An orgless create — no requestContext at all, exactly like a caller with no
 *  authorizer context (schema-compliant-manager.js's documented safe path). */
const createGame = async (body) => {
  const res = await createGameHandler({ body: JSON.stringify(body) });
  return { status: res.statusCode, body: JSON.parse(res.body || '{}') };
};

/** The `Math.random()` value whose draw (`floor(1000 + r*9000)`) lands on
 *  exactly `code`. The +0.5 keeps it off the floor boundary. */
const randFor = (code) => (code - 1000 + 0.5) / 9000;

function reset() { store.clear(); queries.length = 0; }

/** A stale session's leftover rows — a SCORE row and an AISummary row — with
 *  deliberately NO `GAMES` reservation row, the exact shape day-8-to-30 of a
 *  played, unrestarted session leaves behind. */
function seedStaleGame(code) {
  const past = Math.floor(Date.now() / 1000) - 3600; // expired an hour ago, not yet swept
  store.set(key(`GAME#${code}`, 'PLAYER#Ada#SCORE'), {
    PK: `GAME#${code}`, SK: 'PLAYER#Ada#SCORE',
    PlayerName: 'Ada', score: 40, afterRound: '003', ttl: past,
  });
  store.set(key(`GAME#${code}`, 'QUESTION#001#AISummary'), {
    PK: `GAME#${code}`, SK: 'QUESTION#001#AISummary',
    Summary: 'a stale room\'s cached Workie summary', ttl: past,
  });
}

/** A code already spoken for at the reservation level — a live or still-
 *  running session, or simply another draw that just won it. */
function seedReservedGame(code) {
  store.set(key('GAMES', `GAME#${code}`), { PK: 'GAMES', SK: `GAME#${code}`, ttl: Math.floor(Date.now() / 1000) + 999999 });
}

(async () => {
  loud();
  console.log('\ncode reuse isolation: a code with rows still on it is never handed out again\n');

  const realRandom = Math.random;

  await acheck('a stale partition with NO reservation is skipped, and left untouched', async () => {
    reset();
    seedStaleGame('4242');
    // First draw lands on the stale code; the second lands on a clean one.
    const seq = [randFor(4242), randFor(5100)];
    let call = 0;
    Math.random = () => seq[Math.min(call++, seq.length - 1)];
    try {
      quiet();
      let res;
      try {
        res = await createGame({ eventTitle: 'New room', gameType: 'call-and-answer', randomizeQuestions: false });
      } finally {
        // In `finally`, not right after the await: a throw from createGame()
        // must not leave console.log muted for every check that runs after
        // this one — that swallows their PASS/FAIL lines too, silently.
        loud();
      }
      assert.strictEqual(res.status, 201, JSON.stringify(res.body));
      assert.strictEqual(res.body.gameId, '5100',
        `the stale code was handed out — got gameId ${res.body.gameId}`);

      // The stale rows are untouched — same values, still there.
      const score = store.get(key('GAME#4242', 'PLAYER#Ada#SCORE'));
      const summary = store.get(key('GAME#4242', 'QUESTION#001#AISummary'));
      assert.ok(score, 'the stale SCORE row was deleted');
      assert.strictEqual(score.score, 40, 'the stale SCORE row was overwritten');
      assert.ok(summary, 'the stale AISummary row was deleted');
      assert.strictEqual(summary.Summary, 'a stale room\'s cached Workie summary',
        'the stale AISummary row was overwritten');

      // No reservation was ever written for the stale code — it was skipped
      // before the conditional Put, not raced into and lost.
      assert.strictEqual(store.get(key('GAMES', 'GAME#4242')), undefined,
        'a GAMES reservation was written for a code that was supposed to be skipped');
    } finally {
      Math.random = realRandom;
    }
  });

  await acheck('every attempt collides (stale rows or reservations): the existing 503, and no new game', async () => {
    reset();
    // Four codes are stale partitions with no reservation, four are already
    // reserved outright — both flavours of "taken" must retry, not just one.
    const staleCodes = [3001, 3002, 3003, 3004];
    const reservedCodes = [3005, 3006, 3007, 3008];
    staleCodes.forEach(seedStaleGame);
    reservedCodes.forEach(seedReservedGame);
    const allCodes = [...staleCodes, ...reservedCodes];
    assert.strictEqual(allCodes.length, 8, 'MAX_ID_ATTEMPTS is 8 — this fixture must exercise all eight');

    const seq = allCodes.map(randFor);
    let call = 0;
    Math.random = () => seq[Math.min(call++, seq.length - 1)];
    try {
      quiet();
      let res;
      try {
        res = await createGame({ eventTitle: 'No room left', gameType: 'call-and-answer', randomizeQuestions: false });
      } finally {
        loud();
      }
      assert.strictEqual(res.status, 503, JSON.stringify(res.body));
      assert.strictEqual(call, 8, `expected all 8 attempts to be drawn, saw ${call}`);
      // Nothing was written for any of the eight — a give-up must not leave a
      // half-built session behind, and must not disturb the rows it found.
      for (const code of allCodes) {
        assert.strictEqual(store.get(key(`GAME#${code}`, 'METADATA')), undefined,
          `a METADATA row was written for ${code} despite the 503`);
      }
      assert.strictEqual(store.get(key('GAME#3001', 'PLAYER#Ada#SCORE')).score, 40,
        'a stale row was touched during the exhausted draw');
    } finally {
      Math.random = realRandom;
    }
  });

  await acheck('an empty partition with no reservation is accepted on the FIRST draw', async () => {
    reset();
    const seq = [randFor(6100)];
    let call = 0;
    Math.random = () => seq[Math.min(call++, seq.length - 1)];
    try {
      quiet();
      let res;
      try {
        res = await createGame({ eventTitle: 'Fresh room', gameType: 'call-and-answer', randomizeQuestions: false });
      } finally {
        loud();
      }
      assert.strictEqual(res.status, 201, JSON.stringify(res.body));
      assert.strictEqual(res.body.gameId, '6100');
      // Exactly one draw — a correct implementation must not retry a clean id.
      assert.strictEqual(call, 1, `expected exactly one draw, saw ${call}`);
      assert.ok(store.get(key('GAMES', 'GAME#6100')), 'no reservation was written for the accepted code');
    } finally {
      Math.random = realRandom;
    }
  });

  await acheck('the collision check is a strongly consistent, unfiltered, Limit-1 Query', async () => {
    // This fake's `query` case ignores ConsistentRead/Limit/FilterExpression
    // entirely — it would return the same Items for an eventually consistent
    // read, for a Limit of 1000, or for a `ttl > :now` filter that quietly
    // reintroduces the bug this task fixes (a filter is exactly how a stale-
    // but-not-yet-swept row could be made to look absent again). So the
    // INPUT of the Query the fix issues is asserted directly, not inferred
    // from behaviour the fake cannot tell apart.
    reset();
    const seq = [randFor(7100)];
    let call = 0;
    Math.random = () => seq[Math.min(call++, seq.length - 1)];
    try {
      quiet();
      let res;
      try {
        res = await createGame({ eventTitle: 'Checked room', gameType: 'call-and-answer', randomizeQuestions: false });
      } finally {
        loud();
      }
      assert.strictEqual(res.status, 201, JSON.stringify(res.body));

      const collisionQuery = queries.find((q) => (q.ExpressionAttributeValues || {})[':pk'] === 'GAME#7100');
      assert.ok(collisionQuery, 'no Query was ever issued against GAME#7100 — the collision check did not run');
      assert.strictEqual(collisionQuery.ConsistentRead, true,
        'the collision check must read strongly consistent — DynamoDB deletes lazily, so an eventually consistent read can miss a row that is still there');
      assert.strictEqual(collisionQuery.Limit, 1,
        'the collision check only needs to know ANY row exists — a larger Limit reads more than the question requires');
      assert.strictEqual(collisionQuery.FilterExpression, undefined,
        'a FilterExpression here (e.g. ttl > :now) would let a row past its ttl look absent — exactly the bug this task fixes');
    } finally {
      Math.random = realRandom;
    }
  });

  console.log(`\n${pass} passed, ${fail} failed`);
  suiteFinished();
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('harness error:', e); process.exit(1); });
