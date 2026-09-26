/**
 * TASK 2 FIX ROUND 1, Important finding: ROUND# rows carry no ttl, so the
 * "any row in this partition means the code is taken" rule the fresh-draw
 * check now applies (websocket/schema-compliant-manager.js, tests/
 * code-reuse-isolation.js) retires a code FOREVER the moment a session ever
 * reaches results — not just for the 90/30 days everything else in the
 * partition eventually clears on its own.
 *
 * `ROUND#<padded>` rows are written by four unconditional UpdateCommand
 * upserts, none of which ever stamped a ttl:
 *   - game/get-results.js's enterResultsState (every resolved round)
 *   - game/reveal-authors.js (an explicit reveal before RESULTS)
 *   - game/stage-beat.js (the RESULTS beat: tally / field-notes / feedback)
 *   - game/stage-focus.js (spotlighting one answer or the question)
 *
 * The fix: each of the four now sets `ttl` with `if_not_exists(#ttl, :ttl)`,
 * so whichever one touches a round FIRST stamps the clock (30 days —
 * session-ttl.js's `ROUND_RECORD_DAYS`, the same life already hardcoded onto
 * PLAYER#x#SCORE and QUESTION#nnn#AISummary) and the other three, touching
 * the same round later, leave it alone.
 *
 * This suite drives all four REAL handlers against an in-memory DynamoDB
 * fake with a proper `if_not_exists()` — a fake that merely `values[rhs]`s
 * the SET clause literally (several existing suites' fakes do, e.g.
 * tests/results-state-broadcast.js, tests/stage-beat-flow.js,
 * tests/stage-focus-flow.js) would silently write `undefined` for
 * `if_not_exists(#ttl, :ttl)` and could not tell a stamped ttl from a bug, so
 * this file borrows the parsing tests/update-game.js and
 * tests/code-reuse-isolation.js already use.
 *
 * Every fixture is an ORGLESS game (no `orgId` on METADATA), so
 * `callerMayDriveSession` passes for any caller — the same pattern
 * tests/stage-beat-flow.js and tests/stage-focus-flow.js already use, and
 * tenancy is not this file's subject.
 */
const suiteFinished = require('./helpers/finish-guard');
const path = require('path');
const assert = require('assert');

const REPO = path.join(__dirname, '..');

// ---- module stubbing: intercept by request name -----------------------------
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

class GetCommand { constructor(i) { this.input = i; this.type = 'get'; } }
class PutCommand { constructor(i) { this.input = i; this.type = 'put'; } }
class QueryCommand { constructor(i) { this.input = i; this.type = 'query'; } }
class UpdateCommand { constructor(i) { this.input = i; this.type = 'update'; } }
class DeleteCommand { constructor(i) { this.input = i; this.type = 'delete'; } }
class PostToConnectionCommand { constructor(i) { this.input = i; } }

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
            // `if_not_exists(#ttl, :ttl)` — the whole reason this fake exists
            // rather than reusing a simpler one already in the repo (see the
            // header). A fake that does `values[rhs]` literally here writes
            // `undefined`, silently, for every one of the four SETs this
            // suite is testing.
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
        return {};
      }
      case 'query': {
        const v = inp.ExpressionAttributeValues || {};
        const pk = v[':pk'] ?? v[':PK'];
        const prefix = v[':sk'] ?? v[':prefix'] ?? '';
        const items = [...store.values()].filter(
          (i) => i.PK === pk && String(i.SK).startsWith(String(prefix))
        );
        return { Items: items, Count: items.length };
      }
      default:
        return {};
    }
  },
};

class FakeApiGatewayClient {
  async send() { return {}; } // no live connections seeded — every broadcast is a harmless no-op
}

stub('@aws-sdk/client-dynamodb', { DynamoDBClient: class {} });
stub('@aws-sdk/lib-dynamodb', {
  DynamoDBDocumentClient: { from: () => fakeDoc },
  GetCommand, PutCommand, QueryCommand, UpdateCommand, DeleteCommand,
});
stub('@aws-sdk/client-apigatewaymanagementapi', {
  ApiGatewayManagementApiClient: FakeApiGatewayClient,
  PostToConnectionCommand,
});
// get-results.js also touches Bedrock (wavelength) and set-version — never on
// the plain call-and-answer path this suite exercises, but it still requires
// the SDK client at module load time.
stub('@aws-sdk/client-bedrock-runtime', {
  BedrockRuntimeClient: class {},
  InvokeModelCommand: class { constructor(i) { this.input = i; } },
});

process.env.TABLE_NAME = 'test-table';
process.env.WEBSOCKET_API_ENDPOINT = 'https://ws.test.invalid/dev';

const getResultsHandler = require(path.join(REPO, 'lambda-functions/game/get-results.js')).handler;
const revealAuthorsHandler = require(path.join(REPO, 'lambda-functions/game/reveal-authors.js')).handler;
const stageBeatHandler = require(path.join(REPO, 'lambda-functions/game/stage-beat.js')).handler;
const stageFocusHandler = require(path.join(REPO, 'lambda-functions/game/stage-focus.js')).handler;
const { ROUND_RECORD_DAYS } = require(path.join(REPO, 'lambda-functions/game/session-ttl.js'));

let pass = 0, fail = 0;
async function acheck(label, fn) {
  try { await fn(); console.log(`  PASS  ${label}`); pass++; }
  catch (e) { console.log(`  FAIL  ${label}\n        ${e.message}`); fail++; }
}

const put = (item) => store.set(key(item.PK, item.SK), item);
const roundOf = (gameId, padded) => store.get(key(`GAME#${gameId}`, `ROUND#${padded}`));
function reset() { store.clear(); }

/** An orgless game with just METADATA — enough for reveal-authors, stage-beat
 *  and stage-focus, none of which gate on the STATE row. */
function seedBareGame(gameId) {
  put({ PK: `GAME#${gameId}`, SK: 'METADATA', GameType: 'call-and-answer', Title: 'Test session' });
}

/** An orgless call-and-answer game sitting in VOTE#001 with one answer and one
 *  vote — the minimal fixture results-state-broadcast.js uses to reach
 *  enterResultsState without a 400/404 anywhere on the way. */
function seedForResults(gameId) {
  put({ PK: `GAME#${gameId}`, SK: 'METADATA', GameType: 'call-and-answer', Title: 'Test session' });
  put({ PK: `GAME#${gameId}`, SK: 'STATE', State: 'VOTE#001', LessonNumber: 1, CurrentQuestionId: '001' });
  put({
    PK: `GAME#${gameId}`, SK: 'QUESTION#001#ANSWER#Ada',
    PlayerName: 'Ada', Answer: 'a splendid answer', SubmittedAt: '2026-01-01T00:00:00.000Z',
  });
  put({ PK: `GAME#${gameId}`, SK: 'QUESTION#001#VOTE#Ada', PlayerName: 'Ada', Votes: { 1: 1 } });
}

const closeRound = (gameId, questionNumber = 1) => getResultsHandler({
  requestContext: { routeKey: 'POST /games/{gameId}/close-round' },
  pathParameters: { gameId },
  body: JSON.stringify({ questionNumber }),
});
const reveal = (gameId, questionNumber = 1) => revealAuthorsHandler({
  pathParameters: { gameId },
  body: JSON.stringify({ questionNumber }),
});
const beat = (gameId, questionNumber = 1, which = 'results') => stageBeatHandler({
  pathParameters: { gameId },
  body: JSON.stringify({ beat: which, questionNumber }),
});
const focus = (gameId, questionNumber = 1) => stageFocusHandler({
  pathParameters: { gameId },
  body: JSON.stringify({ focus: 'none', questionNumber }),
});

/** Loose enough for "the process took a moment", tight enough to catch a
 *  wrong unit (ms vs seconds) or a wrong day count. */
function assertFreshRoundTtl(ttl, label) {
  assert.strictEqual(typeof ttl, 'number', `${label}: ttl is ${typeof ttl}, not a number — got ${JSON.stringify(ttl)}`);
  const expected = Math.floor(Date.now() / 1000) + ROUND_RECORD_DAYS * 24 * 60 * 60;
  assert.ok(Math.abs(ttl - expected) < 30,
    `${label}: ttl ${ttl} is not within 30s of now + ${ROUND_RECORD_DAYS} days (${expected})`);
}

(async () => {
  console.log('\nROUND# records carry a ttl — a 30-day life, stamped once, not extended\n');

  await acheck('get-results (close-round) stamps ~30 days on a fresh ROUND# row', async () => {
    reset();
    seedForResults('1001');
    const res = await closeRound('1001');
    assert.strictEqual(res.statusCode, 200, JSON.stringify(res.body));
    assertFreshRoundTtl(roundOf('1001', '001').ttl, 'get-results');
  });

  await acheck('reveal-authors stamps ~30 days on a fresh ROUND# row', async () => {
    reset();
    seedBareGame('1002');
    const res = await reveal('1002');
    assert.strictEqual(res.statusCode, 200, JSON.stringify(res.body));
    assertFreshRoundTtl(roundOf('1002', '001').ttl, 'reveal-authors');
  });

  await acheck('stage-beat stamps ~30 days on a fresh ROUND# row', async () => {
    reset();
    seedBareGame('1003');
    const res = await beat('1003');
    assert.strictEqual(res.statusCode, 200, JSON.stringify(res.body));
    assertFreshRoundTtl(roundOf('1003', '001').ttl, 'stage-beat');
  });

  await acheck('stage-focus stamps ~30 days on a fresh ROUND# row', async () => {
    reset();
    seedBareGame('1004');
    const res = await focus('1004');
    assert.strictEqual(res.statusCode, 200, JSON.stringify(res.body));
    assertFreshRoundTtl(roundOf('1004', '001').ttl, 'stage-focus');
  });

  console.log('\nif_not_exists: whichever writer touches a round FIRST stamps the clock; later writers do not reset it\n');

  const SENTINEL_TTL = 1893456000; // an arbitrary, far-future epoch second — nothing computes this by accident

  await acheck('get-results does not push the ttl out on a round it did not create', async () => {
    reset();
    seedForResults('2001');
    put({ PK: 'GAME#2001', SK: 'ROUND#001', QuestionNumber: '001', ttl: SENTINEL_TTL });
    const res = await closeRound('2001');
    assert.strictEqual(res.statusCode, 200, JSON.stringify(res.body));
    const round = roundOf('2001', '001');
    assert.strictEqual(round.ttl, SENTINEL_TTL, `ttl moved from the sentinel to ${round.ttl} — if_not_exists is not in effect`);
    // The rest of the write still happened — this is not "the update no-oped".
    assert.strictEqual(round.AuthorsRevealed, true, 'the reveal itself did not happen');
  });

  await acheck('reveal-authors does not push the ttl out on a round it did not create', async () => {
    reset();
    seedBareGame('2002');
    put({ PK: 'GAME#2002', SK: 'ROUND#001', QuestionNumber: '001', ttl: SENTINEL_TTL });
    const res = await reveal('2002');
    assert.strictEqual(res.statusCode, 200, JSON.stringify(res.body));
    const round = roundOf('2002', '001');
    assert.strictEqual(round.ttl, SENTINEL_TTL, `ttl moved from the sentinel to ${round.ttl}`);
    assert.strictEqual(round.AuthorsRevealed, true, 'the reveal itself did not happen');
  });

  await acheck('stage-beat does not push the ttl out on a round it did not create', async () => {
    reset();
    seedBareGame('2003');
    put({ PK: 'GAME#2003', SK: 'ROUND#001', QuestionNumber: '001', ttl: SENTINEL_TTL });
    const res = await beat('2003', 1, 'field-notes');
    assert.strictEqual(res.statusCode, 200, JSON.stringify(res.body));
    const round = roundOf('2003', '001');
    assert.strictEqual(round.ttl, SENTINEL_TTL, `ttl moved from the sentinel to ${round.ttl}`);
    assert.strictEqual(round.StageBeat, 'field-notes', 'the beat itself did not happen');
  });

  await acheck('stage-focus does not push the ttl out on a round it did not create', async () => {
    reset();
    seedBareGame('2004');
    put({ PK: 'GAME#2004', SK: 'ROUND#001', QuestionNumber: '001', ttl: SENTINEL_TTL });
    const res = await focus('2004');
    assert.strictEqual(res.statusCode, 200, JSON.stringify(res.body));
    const round = roundOf('2004', '001');
    assert.strictEqual(round.ttl, SENTINEL_TTL, `ttl moved from the sentinel to ${round.ttl}`);
    assert.strictEqual(round.StageFocus, 'none', 'the focus itself did not happen');
  });

  await acheck('a chain of all four on ONE round: the first stamps it, the other three leave it alone', async () => {
    reset();
    seedBareGame('3001');
    // stage-focus first — nothing has touched this round yet.
    const r1 = await focus('3001');
    assert.strictEqual(r1.statusCode, 200, JSON.stringify(r1.body));
    const stamped = roundOf('3001', '001').ttl;
    assertFreshRoundTtl(stamped, 'stage-focus (first mover)');

    const r2 = await beat('3001', 1, 'feedback');
    assert.strictEqual(r2.statusCode, 200, JSON.stringify(r2.body));
    assert.strictEqual(roundOf('3001', '001').ttl, stamped, 'stage-beat moved a ttl it did not create');

    const r3 = await reveal('3001');
    assert.strictEqual(r3.statusCode, 200, JSON.stringify(r3.body));
    assert.strictEqual(roundOf('3001', '001').ttl, stamped, 'reveal-authors moved a ttl it did not create');

    // get-results needs its own VOTE#001 fixture to reach enterResultsState —
    // add it without touching the ROUND# row this check is about.
    put({ PK: 'GAME#3001', SK: 'STATE', State: 'VOTE#001', LessonNumber: 1, CurrentQuestionId: '001' });
    put({ PK: 'GAME#3001', SK: 'QUESTION#001#ANSWER#Ada', PlayerName: 'Ada', Answer: 'x' });
    put({ PK: 'GAME#3001', SK: 'QUESTION#001#VOTE#Ada', PlayerName: 'Ada', Votes: { 1: 1 } });
    const r4 = await closeRound('3001');
    assert.strictEqual(r4.statusCode, 200, JSON.stringify(r4.body));
    assert.strictEqual(roundOf('3001', '001').ttl, stamped, 'get-results moved a ttl it did not create');
  });

  console.log(`\n${pass} passed, ${fail} failed`);
  suiteFinished();
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('harness error:', e); process.exit(1); });
