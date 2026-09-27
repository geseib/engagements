/**
 * EVERY BALLOT IN A ROUND, WITH ITS VOTER, IS THE HOST'S TO READ:
 * GET /games/{gameId}/votes/host.
 *
 * `GET /games/{gameId}/votes` is PUBLIC: it takes a four-digit id and no
 * identity, and its player branch returns a count and nothing else.
 *
 * Its `?role=host` branch was reached by a QUERY PARAMETER, a claim anyone
 * can type, and it returned every ballot in the round, DECRYPTED (`Votes` is
 * ciphertext at rest per organisation), each with the voter's name, at any
 * phase. Ballots are positional over the round's answers, so who voted for
 * what is one join away from who wrote what. The same class of hole as
 * `?role=host` on /answers and `?includeHostData=true` on /state, found by the
 * audit in the same sweep.
 *
 * The fix, three halves like every closed route here (560ef2f7, 3ae0d2bd):
 *   - the template gives GetVotesFunction a second event, the host's door,
 *     with CognitoAuthorizer; the public event keeps none;
 *   - authorizer.js names the door for hosts|admins. Two generic rules would
 *     otherwise let any account in: "GET + games is public", and the older
 *     `path.includes('vote')`;
 *   - get-votes.js refuses no identity outright and asks
 *     callerMayDriveSession, every refusal the same 404 as a code that names
 *     nothing. The public route answers `role=host` with a count.
 *
 * rejects: a ballot or a voter's name on the public route, under any role
 * claim, with or without a forged identity; the door left public or open to
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
      const item = store.get(key(inp.Key.PK, inp.Key.SK));
      if (item && inp.ProjectionExpression) {
        const out = {};
        for (const f of inp.ProjectionExpression.split(',').map((s) => s.trim())) {
          if (f in item) out[f] = item[f];
        }
        return { Item: out };
      }
      return { Item: item };
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
const { handler } = require(path.join(REPO, 'lambda-functions/game/get-votes.js'));
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

// Distinctive, so a substring check on the raw body means something. A ballot
// ranks the round's answers by position.
const BALLOTS = [
  ['Hedy-Lamarr-9', { 0: 1, 1: 2 }],
  ['Katherine-Johnson-9', { 1: 1, 0: 2 }],
];
const VOTERS = BALLOTS.map(([n]) => n);

const VOTE_GAME = '6301';     // org-owned, voting
const RESULTS_GAME = '6302';  // org-owned, results showing
const ORGLESS_GAME = '6303';  // pre-tenancy, voting
const NO_GAME = '9999';

async function seedSession(gameId, { orgId, state }) {
  const meta = {
    PK: `GAME#${gameId}`, SK: 'METADATA',
    ...(orgId ? { orgId } : {}),
    Title: 'Leeds support review',
    GameType: 'call-and-answer',
  };
  put(orgId ? await encryptItem(orgId, 'session', meta) : meta);
  put({ PK: `GAME#${gameId}`, SK: 'STATE', State: state, LessonNumber: 1 });
  for (const [name, votes] of BALLOTS) {
    const row = {
      PK: `GAME#${gameId}`, SK: `QUESTION#001#VOTE#${name}`,
      PlayerName: name, VoterName: name, QuestionNumber: '001', Votes: votes,
      SubmittedAt: '2026-09-26T09:08:00.000Z',
    };
    put(orgId ? await encryptItem(orgId, 'vote', row) : row);
  }
}

const PUBLIC_ROUTE = 'GET /games/{gameId}/votes';
const HOST_ROUTE = 'GET /games/{gameId}/votes/host';
/** The custom lambda authorizer's context: groups comma-joined, at `.lambda`. */
const hostOf = (orgId, groups = 'hosts') => ({ lambda: { userId: 'u-1', groups, orgId, orgIds: orgId } });

async function call(routeKey, gameId, query, authorizer = null) {
  reads.length = 0;
  const res = await handler({
    version: '2.0',
    routeKey,
    rawPath: routeKey === HOST_ROUTE ? `/games/${gameId}/votes/host` : `/games/${gameId}/votes`,
    pathParameters: { gameId },
    ...(query ? { queryStringParameters: query } : {}),
    requestContext: { routeKey, http: { method: 'GET' }, ...(authorizer ? { authorizer } : {}) },
  });
  let body = {};
  try { body = JSON.parse(res.body || '{}'); } catch { body = { unparsed: res.body }; }
  return { status: res.statusCode, body, raw: String(res.body || ''), read: reads.slice() };
}

/** No ballot and no voter anywhere in the reply. */
function assertNoBallots(r) {
  assert.ok(!('votes' in r.body), `the reply carries a votes list: ${r.raw.slice(0, 240)}`);
  for (const secret of VOTERS) {
    assert.ok(!r.raw.includes(secret), `the reply carries "${secret}": ${r.raw.slice(0, 240)}`);
  }
}

(async () => {
  await seedSession(VOTE_GAME, { orgId: ORG, state: 'VOTE#001' });
  await seedSession(RESULTS_GAME, { orgId: ORG, state: 'RESULTS#001' });
  await seedSession(ORGLESS_GAME, { state: 'VOTE#001' });

  say('\n1. the template: the count stays public, the host door is closed');
  const routes = routesFromTemplate();
  await check('the template scanner parses routes and sees Auth', () => assertScannerWorks(routes));
  for (const [method, p] of [['GET', '/games/{gameId}/votes'], ['POST', '/games/{gameId}/votes']]) {
    await check(`${method} ${p} carries no authorizer (phones hold no token)`, () => {
      const r = findRoute(routes, method, p);
      assert.ok(r, 'the public route is gone');
      assert.strictEqual(r.authorizer, null);
    });
  }
  await check('GET /games/{gameId}/votes/host carries CognitoAuthorizer', () => {
    const r = findRoute(routes, 'GET', '/games/{gameId}/votes/host');
    assert.ok(r, 'no votes/host route in the template');
    assert.strictEqual(r.authorizer, 'CognitoAuthorizer');
  });

  say('\n2. the authorizer demands a host on the door, and nobody on the count');
  // `includes('vote')` in the generic public rule is why the door must be
  // named before it: the door's own path contains the word.
  for (const p of ['games/{gameId}/votes/host', 'games/1234/votes/host']) {
    await check(`GET ${p} requires hosts or admins`, () =>
      assert.deepStrictEqual(requiredGroupsForRoute('GET', p), ['hosts', 'admins']));
    await check(`GET ${p} refuses a pending account`, () =>
      assert.strictEqual(hasPermission(['pending'], requiredGroupsForRoute('GET', p)), false));
    await check(`GET ${p} refuses an account in no group`, () =>
      assert.strictEqual(hasPermission([], requiredGroupsForRoute('GET', p)), false));
  }
  for (const p of ['games/{gameId}/votes', 'games/1234/votes']) {
    await check(`GET ${p} stays public`, () => assert.deepStrictEqual(requiredGroupsForRoute('GET', p), []));
  }

  say('\n3. the public route, as anyone can call it');
  const CLAIMS = [
    { role: 'host' }, { role: 'HOST' }, { role: 'host', questionNumber: '001' },
    { role: 'host', questionNumber: '1' }, { role: 'player' }, null,
  ];
  for (const [label, gameId] of [['org, voting', VOTE_GAME], ['org, results', RESULTS_GAME], ['orgless, voting', ORGLESS_GAME]]) {
    for (const query of CLAIMS) {
      forgetAllOrgs();
      const decryptsBefore = kms.calls.decrypt;
      const r = await call(PUBLIC_ROUTE, gameId, query);
      await check(`${label}, ${query ? JSON.stringify(query) : 'no query'}: 200, a count, no ballots and no voters`, () => {
        assert.strictEqual(r.status, 200, r.raw);
        assert.strictEqual(r.body.voteCount, 2);
        assertNoBallots(r);
      });
      await check(`${label}, ${query ? JSON.stringify(query) : 'no query'}: and no ballot was decrypted to say so`, () =>
        assert.strictEqual(kms.calls.decrypt, decryptsBefore, 'a count cost a KMS decrypt'));
    }
  }
  const forged = await call(PUBLIC_ROUTE, VOTE_GAME, { role: 'host' }, hostOf(ORG));
  await check('a host identity on the PUBLIC route changes nothing', () => {
    assert.strictEqual(forged.status, 200, forged.raw);
    assertNoBallots(forged);
  });

  say('\n4. the host door, for the owning team');
  const own = await call(HOST_ROUTE, VOTE_GAME, { questionNumber: '001' }, hostOf(ORG));
  await check('during VOTE: 200, every ballot, decrypted, with its voter', () => {
    assert.strictEqual(own.status, 200, own.raw);
    assert.strictEqual(own.body.voteCount, 2);
    const rows = own.body.votes.map((v) => [v.voter, v.votes]).sort();
    assert.deepStrictEqual(rows, BALLOTS.slice().sort());
  });
  await check('the shape the stage already reads, unchanged', () => {
    assert.deepStrictEqual(Object.keys(own.body).sort(), ['gameId', 'questionNumber', 'timestamp', 'voteCount', 'votes']);
    assert.deepStrictEqual(Object.keys(own.body.votes[0]).sort(), ['questionNumber', 'submittedAt', 'voter', 'votes']);
    assert.strictEqual(own.body.questionNumber, '001');
  });
  const current = await call(HOST_ROUTE, RESULTS_GAME, null, hostOf(ORG));
  await check('with no questionNumber it reads the current round, at RESULTS too', () => {
    assert.strictEqual(current.status, 200, current.raw);
    assert.strictEqual(current.body.questionNumber, '001');
    assert.strictEqual(current.body.votes.length, 2);
  });
  const admin = await call(HOST_ROUTE, VOTE_GAME, { questionNumber: '001' }, hostOf(ORG, 'admins'));
  await check('an admin acting for the owning team: 200 with the ballots', () => {
    assert.strictEqual(admin.status, 200, admin.raw);
    assert.strictEqual(admin.body.votes.length, 2);
  });
  const orgless = await call(HOST_ROUTE, ORGLESS_GAME, { questionNumber: '001' }, hostOf(ORG));
  await check('a signed-in host on an orgless session: 200 (callerMayDriveSession\'s rule)', () => {
    assert.strictEqual(orgless.status, 200, orgless.raw);
    assert.strictEqual(orgless.body.votes.length, 2);
  });

  say('\n5. the host door, for everyone else: the same "not found" as a code that names nothing');
  const nothing = await call(HOST_ROUTE, NO_GAME, { questionNumber: '001' }, hostOf(ORG));
  await check('a code that names no session: 404', () => assert.strictEqual(nothing.status, 404, nothing.raw));
  const cases = [
    ['no identity at all', VOTE_GAME, null],
    ['no identity, claiming role=host', VOTE_GAME, null, { role: 'host', questionNumber: '001' }],
    ['no identity on an orgless session (callerMayDriveSession alone would pass it)', ORGLESS_GAME, null],
    ['another team\'s host', VOTE_GAME, hostOf(RIVAL)],
    ['another team\'s admin', RESULTS_GAME, hostOf(RIVAL, 'admins')],
  ];
  for (const [label, gameId, who, query] of cases) {
    forgetAllOrgs();
    const decryptsBefore = kms.calls.decrypt;
    const r = await call(HOST_ROUTE, gameId, query || { questionNumber: '001' }, who);
    await check(`${label}: the same 404, and no ballots`, () => {
      assert.strictEqual(r.status, 404, r.raw);
      assert.deepStrictEqual(r.body, nothing.body);
      assertNoBallots(r);
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
