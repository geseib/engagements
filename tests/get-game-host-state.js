/**
 * THE HOST'S VIEW OF A LIVE SESSION IS THE HOST'S TO READ:
 * GET /games/{gameId}/host-state.
 *
 * `GET /games/{gameId}/state` is PUBLIC and must stay public: every phone in
 * the room reads the round from it with no identity at all. It had a host
 * branch, reached by `?includeHostData=true` — a QUERY PARAMETER, a claim
 * anyone can type — and, worse, by simply leaving the player id off the path.
 * That branch returned, to anyone holding a four-digit code:
 *
 *   questionQueue     the running order the host has lined up: the questions
 *                     the room has NOT been asked yet. The same data
 *                     `GET /games/{id}/queue` returns, and that route was put
 *                     behind sign-in on 23 Sep. This walked around the lock.
 *   categoryCounts    how many questions are left in each category;
 *   categoryState     the host's category masks;
 *   answerProgress    who has answered, by name;
 *   votingProgress    who has voted, by name.
 *
 * A team's questions may be a customer's private material. A player in the
 * room, or anyone who guesses a code, must not see what is coming next.
 *
 * The fix, three halves like every closed route here (560ef2f7, 3ae0d2bd,
 * e76850b0):
 *   - the template gives GetGameStateFunction a third event, the host's door,
 *     with CognitoAuthorizer; the two public events keep none;
 *   - authorizer.js names the door for hosts|admins. The generic rule
 *     "GET + games is public" would otherwise let any account in, `pending`
 *     included;
 *   - get-game-state.js refuses no identity outright and asks
 *     callerMayDriveSession, every refusal the same 404 as a code that names
 *     nothing. The public route never assembles the host block, whatever the
 *     query says.
 *
 * rejects: any host field on the public route, under any claim, with or
 * without a player id or a forged identity; the door left public or open to
 * `pending`; another team's host (or no identity) getting anything but the
 * same "Game not found"; a refused caller costing a decrypt or a read past
 * METADATA; the owning host refused, or handed a different shape.
 */
const suiteFinished = require('./helpers/finish-guard');
const path = require('path');
const assert = require('assert');
const REPO = path.join(__dirname, '..');

const Module = require('module');
const stubs = new Map();
const realLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (stubs.has(request)) return stubs.get(request);
  return realLoad.call(this, request, parent, isMain);
};
const stub = (name, exports) => stubs.set(name, exports);

process.env.TABLE_NAME = 'engage-test';
process.env.TENANT_KMS_KEY_ID = 'alias/test-tenant-key';
process.env.AWS_REGION = 'us-east-1';

// ---- an in-memory table that records what was read --------------------------
const store = new Map();
const key = (pk, sk) => `${pk}|${sk}`;
const put = (item) => store.set(key(item.PK, item.SK), item);
const reads = [];

class GetCommand { constructor(i) { this.input = i; this.type = 'get'; } }
class QueryCommand { constructor(i) { this.input = i; this.type = 'query'; } }

const fakeDoc = {
  send: async (cmd) => {
    const inp = cmd.input || {};
    if (cmd.type === 'get') {
      reads.push(inp.Key.SK);
      return { Item: store.get(key(inp.Key.PK, inp.Key.SK)) };
    }
    const pk = inp.ExpressionAttributeValues[':pk'];
    const prefix = inp.ExpressionAttributeValues[':sk'];
    reads.push(`query:${prefix}`);
    const Items = [...store.values()].filter((i) => i.PK === pk && String(i.SK).startsWith(prefix));
    return { Items, Count: Items.length };
  },
};
stub('@aws-sdk/client-dynamodb', { DynamoDBClient: class {} });
stub('@aws-sdk/lib-dynamodb', { DynamoDBDocumentClient: { from: () => fakeDoc }, GetCommand, QueryCommand });

const { makeKmsStub, installTestKeyLoader, forgetAllOrgs } = require('./helpers/tenant-crypto-stub');
const kms = makeKmsStub();
stub('@aws-sdk/client-kms', kms.exports);
installTestKeyLoader();

const { encryptItem } = require(path.join(REPO, 'lambda-functions/game/tenant-crypto.js'));
const { handler } = require(path.join(REPO, 'lambda-functions/game/get-game-state.js'));
const { requiredGroupsForRoute, hasPermission } = require(path.join(REPO, 'lambda-functions/auth/authorizer.js'));
const { routesFromTemplate, findRoute, assertScannerWorks } = require('./helpers/template-routes');

if (!process.env.DEBUG) { console.log = () => {}; console.warn = () => {}; console.error = () => {}; }
const say = (...a) => process.stdout.write(a.join(' ') + '\n');

let pass = 0; let fail = 0;
async function check(label, fn) {
  try { await fn(); pass += 1; say(`  PASS  ${label}`); }
  catch (e) { fail += 1; say(`  FAIL  ${label}\n        ${e.message}`); }
}

// ---- the rooms ---------------------------------------------------------------
const ORG = 'org_acme';
const RIVAL = 'org_globex';
const TITLE = 'Leeds support review';

// What must never cross the public route. Distinctive, so a substring check on
// the raw body means something.
const QUEUED = ['c007#031', 'c007#032'];
const QUEUED_TITLES = ['Should-we-close-Leeds-before-Q4', 'Which-two-leads-are-leaving'];
const QUEUE_SET = 'set-leeds-private-agenda';
const ANSWERERS = ['Ada-Lovelace-9', 'Grace-Hopper-9'];
const VOTERS = ['Hedy-Lamarr-9', 'Katherine-Johnson-9'];
const EVERYONE = [...ANSWERERS, ...VOTERS, 'Mary-Jackson-9'];

const ASK_GAME = '6101';     // org-owned, answering
const VOTE_GAME = '6102';    // org-owned, voting
const ORGLESS_GAME = '6103'; // pre-tenancy, answering
const NO_GAME = '9999';

async function seedSession(gameId, { orgId, state, round }) {
  const meta = {
    PK: `GAME#${gameId}`, SK: 'METADATA',
    ...(orgId ? { orgId } : {}),
    Title: TITLE,
    HostName: 'Ada',
    GameType: 'call-and-answer',
    QuestionSetId: QUEUE_SET,
    QuestionSetScope: 'org',
    CreatedAt: '2026-09-26T09:00:00.000Z',
    Started: true,
  };
  put(orgId ? await encryptItem(orgId, 'session', meta) : meta);
  put({ PK: `GAME#${gameId}`, SK: 'STATE', State: state, LessonNumber: round });
  put({
    PK: `GAME#${gameId}`, SK: 'QUEUE',
    Queue: QUEUED.slice(), Version: 3, SetId: QUEUE_SET, SetVersion: 2,
    UpdatedAt: '2026-09-26T09:10:00.000Z',
  });
  put({
    PK: `GAME#${gameId}`, SK: 'STATE#CATS',
    'HostMask1-8': '10110000', 'HostMask9-16': '00000001', 'HostMask17-24': '00000000',
  });
  put({
    PK: `GAME#${gameId}`, SK: 'STATE#CATS#COUNTS',
    '1-8': [4, 0, 7, 3], '9-16': [1], '17-24': [], TotalRemaining: 15,
  });
  for (const name of EVERYONE) {
    put({ PK: `GAME#${gameId}`, SK: `PLAYER#${name}`, PlayerName: name, JoinedAt: '2026-09-26T09:05:00.000Z' });
  }
  const padded = String(round).padStart(3, '0');
  for (const name of ANSWERERS) {
    put({ PK: `GAME#${gameId}`, SK: `QUESTION#${padded}#ANSWER#${name}`, PlayerName: name, Answer: 'x' });
  }
  for (const name of VOTERS) {
    put({ PK: `GAME#${gameId}`, SK: `QUESTION#${padded}#VOTE#${name}`, PlayerName: name, Votes: { 0: 1 } });
  }
}

const PUBLIC_ROUTE = 'GET /games/{gameId}/state';
const PLAYER_ROUTE = 'GET /games/{gameId}/state/{playerId}';
const HOST_ROUTE = 'GET /games/{gameId}/host-state';
/** The custom lambda authorizer's context: groups comma-joined, at `.lambda`. */
const hostOf = (orgId, groups = 'hosts') => ({ lambda: { userId: 'u-1', groups, orgId, orgIds: orgId } });

const rawPathOf = (routeKey, gameId, playerId) => {
  if (routeKey === HOST_ROUTE) return `/games/${gameId}/host-state`;
  if (routeKey === PLAYER_ROUTE) return `/games/${gameId}/state/${playerId}`;
  return `/games/${gameId}/state`;
};

async function call(routeKey, gameId, { query = null, authorizer = null, playerId = null } = {}) {
  reads.length = 0;
  const res = await handler({
    version: '2.0',
    routeKey,
    rawPath: rawPathOf(routeKey, gameId, playerId),
    pathParameters: { gameId, ...(playerId ? { playerId } : {}) },
    ...(query ? { queryStringParameters: query } : {}),
    requestContext: { routeKey, http: { method: 'GET' }, ...(authorizer ? { authorizer } : {}) },
  });
  let body = {};
  try { body = JSON.parse(res.body || '{}'); } catch { body = { unparsed: res.body }; }
  return { status: res.statusCode, body, raw: String(res.body || ''), read: reads.slice() };
}

const HOST_FIELDS = ['questionQueue', 'categoryCounts', 'categoryState', 'answerProgress', 'votingProgress'];

/** None of the host block is in the reply, by field or by value. */
function assertNothingHostOnly(r, { except = [] } = {}) {
  const present = HOST_FIELDS.filter((f) => Object.prototype.hasOwnProperty.call(r.body, f));
  assert.deepStrictEqual(present, [], `the reply carries ${present.join(', ')}`);
  for (const secret of [...QUEUED, ...QUEUED_TITLES, ...EVERYONE]) {
    if (except.includes(secret)) continue;
    assert.ok(!r.raw.includes(secret), `the reply carries "${secret}": ${r.raw.slice(0, 240)}`);
  }
}

(async () => {
  await seedSession(ASK_GAME, { orgId: ORG, state: 'ASK#002', round: 2 });
  await seedSession(VOTE_GAME, { orgId: ORG, state: 'VOTE#001', round: 1 });
  await seedSession(ORGLESS_GAME, { state: 'ASK#002', round: 2 });
  // The queued questions themselves, titled, in the set they would be served
  // from — so a projection that ever grows titles into the queue block is
  // caught by the substring search, not only one that leaks the keys.
  QUEUED.forEach((k, i) => put({ PK: `SET#${QUEUE_SET}`, SK: k, Title: QUEUED_TITLES[i] }));

  say('\n1. the template: the round stays public, the host door is closed');
  const routes = routesFromTemplate();
  await check('the template scanner parses routes and sees Auth', () => assertScannerWorks(routes));
  for (const p of ['/games/{gameId}/state', '/games/{gameId}/state/{playerId}']) {
    await check(`GET ${p} carries no authorizer (phones hold no token)`, () => {
      const r = findRoute(routes, 'GET', p);
      assert.ok(r, 'the public route is gone');
      assert.strictEqual(r.authorizer, null);
    });
  }
  await check('GET /games/{gameId}/host-state carries CognitoAuthorizer', () => {
    const r = findRoute(routes, 'GET', '/games/{gameId}/host-state');
    assert.ok(r, 'no host-state route in the template');
    assert.strictEqual(r.authorizer, 'CognitoAuthorizer');
  });

  say('\n2. the authorizer demands a host on the door, and nobody on the round');
  for (const p of ['games/{gameId}/host-state', 'games/1234/host-state']) {
    await check(`GET ${p} requires hosts or admins`, () =>
      assert.deepStrictEqual(requiredGroupsForRoute('GET', p), ['hosts', 'admins']));
    await check(`GET ${p} refuses a pending account`, () =>
      assert.strictEqual(hasPermission(['pending'], requiredGroupsForRoute('GET', p)), false));
    await check(`GET ${p} refuses an account in no group`, () =>
      assert.strictEqual(hasPermission([], requiredGroupsForRoute('GET', p)), false));
  }
  for (const p of ['games/{gameId}/state', 'games/1234/state', 'games/{gameId}/state/{playerId}', 'games/1234/state/host']) {
    await check(`GET ${p} stays public`, () => assert.deepStrictEqual(requiredGroupsForRoute('GET', p), []));
  }

  say('\n3. the public route, as anyone can call it');
  // Swept, because the flag is an unvalidated string, and because leaving the
  // player id off the path used to count as asking for host data.
  const CLAIMS = [
    { includeHostData: 'true' }, { includeHostData: 'TRUE' }, { includeHostData: '1' },
    { role: 'host' }, { includeHostData: 'true', role: 'host' }, null,
  ];
  for (const [label, gameId] of [['org, answering', ASK_GAME], ['org, voting', VOTE_GAME], ['orgless', ORGLESS_GAME]]) {
    for (const query of CLAIMS) {
      const r = await call(PUBLIC_ROUTE, gameId, { query });
      await check(`${label}, ${query ? JSON.stringify(query) : 'no query'}: 200 with no host block`, () => {
        assert.strictEqual(r.status, 200, r.raw);
        assertNothingHostOnly(r);
      });
    }
  }
  const asPlayer = await call(PLAYER_ROUTE, ASK_GAME, { query: { includeHostData: 'true' }, playerId: 'Mary-Jackson-9' });
  await check('a player\'s own read, claiming host data: their own row and nothing of the host\'s', () => {
    assert.strictEqual(asPlayer.status, 200, asPlayer.raw);
    assert.strictEqual(asPlayer.body.playerData.playerName, 'Mary-Jackson-9');
    assert.strictEqual(asPlayer.body.playerQuestionState.hasAnswered, false);
    assertNothingHostOnly(asPlayer, { except: ['Mary-Jackson-9'] });
  });
  // The ROUTE decides, not a token: the public events carry no authorizer, so
  // an identity on them can only be forged in a test, and must change nothing.
  const forged = await call(PUBLIC_ROUTE, ASK_GAME, { query: { includeHostData: 'true' }, authorizer: hostOf(ORG) });
  await check('a host identity on the PUBLIC route changes nothing', () => {
    assert.strictEqual(forged.status, 200, forged.raw);
    assertNothingHostOnly(forged);
  });
  const plain = await call(PUBLIC_ROUTE, ASK_GAME);
  await check('the public round still carries what every phone reads', () => {
    assert.strictEqual(plain.body.state, 'ASK#002');
    assert.strictEqual(plain.body.currentQuestion, 2);
    assert.strictEqual(plain.body.gameType, 'call-and-answer');
    assert.strictEqual(plain.body.gameMetadata.title, TITLE);
    assert.strictEqual(plain.body.stageBeat, 'results');
    assert.ok(plain.body.scoreboard && typeof plain.body.scoreboard === 'object');
  });
  await check('and it costs no read of the queue, the categories or the room', () => {
    const hostReads = plain.read.filter((sk) => /^(QUEUE|STATE#CATS)|^query:/.test(sk));
    assert.deepStrictEqual(hostReads, [], `read ${hostReads.join(', ')}`);
  });

  say('\n4. the host door, for the owning team');
  const own = await call(HOST_ROUTE, ASK_GAME, { authorizer: hostOf(ORG) });
  await check('200, with the running order, in order, at its version', () => {
    assert.strictEqual(own.status, 200, own.raw);
    assert.deepStrictEqual(own.body.questionQueue, {
      queue: QUEUED, version: 3, setId: QUEUE_SET, setVersion: 2, updatedAt: '2026-09-26T09:10:00.000Z',
    });
  });
  await check('and the category counts and masks', () => {
    assert.deepStrictEqual(own.body.categoryCounts, { '1-8': [4, 0, 7, 3], '9-16': [1], '17-24': [], totalRemaining: 15 });
    assert.deepStrictEqual(own.body.categoryState, {
      'HostMask1-8': '10110000', 'HostMask9-16': '00000001', 'HostMask17-24': '00000000',
    });
  });
  await check('and who has answered, by name, during ASK', () => {
    assert.strictEqual(own.body.answerProgress.answersReceived, 2);
    assert.strictEqual(own.body.answerProgress.totalPlayers, EVERYONE.length);
    assert.deepStrictEqual(own.body.answerProgress.answererIds.slice().sort(), ANSWERERS.slice().sort());
  });
  await check('and everything the public round carries, in the same read (one request per poll)', () => {
    for (const k of Object.keys(plain.body)) {
      assert.deepStrictEqual(own.body[k], plain.body[k], `field ${k} differs from the public round`);
    }
  });
  const voting = await call(HOST_ROUTE, VOTE_GAME, { authorizer: hostOf(ORG) });
  await check('during VOTE: who has voted, by name', () => {
    assert.strictEqual(voting.status, 200, voting.raw);
    assert.strictEqual(voting.body.votingProgress.votesReceived, 2);
    assert.deepStrictEqual(voting.body.votingProgress.votersIds.slice().sort(), VOTERS.slice().sort());
  });
  const admin = await call(HOST_ROUTE, ASK_GAME, { authorizer: hostOf(ORG, 'admins') });
  await check('an admin acting for the owning team: 200 with the queue', () => {
    assert.strictEqual(admin.status, 200, admin.raw);
    assert.deepStrictEqual(admin.body.questionQueue.queue, QUEUED);
  });
  const orgless = await call(HOST_ROUTE, ORGLESS_GAME, { authorizer: hostOf(ORG) });
  await check('a signed-in host on an orgless session: 200 (callerMayDriveSession\'s rule)', () => {
    assert.strictEqual(orgless.status, 200, orgless.raw);
    assert.deepStrictEqual(orgless.body.questionQueue.queue, QUEUED);
  });

  say('\n5. the host door, for everyone else: the same "not found" as a code that names nothing');
  const nothing = await call(HOST_ROUTE, NO_GAME, { authorizer: hostOf(ORG) });
  await check('a code that names no session: 404', () => assert.strictEqual(nothing.status, 404, nothing.raw));
  const cases = [
    ['no identity at all', ASK_GAME, null],
    ['no identity, claiming includeHostData', ASK_GAME, null, { includeHostData: 'true' }],
    ['no identity on an orgless session (callerMayDriveSession alone would pass it)', ORGLESS_GAME, null],
    ['another team\'s host', ASK_GAME, hostOf(RIVAL)],
    ['another team\'s admin', VOTE_GAME, hostOf(RIVAL, 'admins')],
  ];
  for (const [label, gameId, who, query] of cases) {
    forgetAllOrgs();
    const decryptsBefore = kms.calls.decrypt;
    const r = await call(HOST_ROUTE, gameId, { query: query || null, authorizer: who });
    await check(`${label}: the same 404, and nothing of the room`, () => {
      assert.strictEqual(r.status, 404, r.raw);
      assert.deepStrictEqual(r.body, nothing.body);
      assertNothingHostOnly(r);
      assert.ok(!r.raw.includes(TITLE), 'the session title reached an outsider');
    });
    await check(`${label}: refused before any decrypt, and before anything past METADATA is read`, () => {
      assert.strictEqual(kms.calls.decrypt, decryptsBefore, 'a refused caller cost a KMS decrypt');
      assert.deepStrictEqual(r.read.filter((sk) => sk !== 'METADATA'), [], `read ${r.read.join(', ')}`);
    });
  }

  say(`\n${pass} passed, ${fail} failed`);
  suiteFinished();
  process.exit(fail ? 1 : 0);
})().catch((e) => { say(`CRASH ${e.stack}`); process.exit(1); });
