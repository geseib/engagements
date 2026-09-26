/**
 * EVERY ANSWER TO A ROUND, AT ANY PHASE, IS THE HOST'S TO READ:
 * GET /games/{gameId}/answers/host.
 *
 * `GET /games/{gameId}/answers` is PUBLIC and must stay public: a phone reads
 * the answers it is about to vote on there, and a returning player asks for
 * their own answer back with `?player=&clientId=`. The player branch shows the
 * answers only during VOTE, and otherwise a bare count.
 *
 * Its `?role=host` branch was reached by a QUERY PARAMETER, a claim anyone can
 * type, and it returned every answer to the round, decrypted, with the
 * author's name on a round that is not anonymous — during ASK, while the room
 * was still answering, and at any phase after. So anyone holding a four-digit
 * code could watch every response land, by name.
 *
 * The fix, three halves like every closed route here (560ef2f7, 3ae0d2bd):
 *   - the template gives GetAnswersFunction a second event, the host's door,
 *     with CognitoAuthorizer; the public event keeps none;
 *   - authorizer.js names the door for hosts|admins. Two generic rules would
 *     otherwise let any account in: "GET + games is public", and the older
 *     `path.includes('answer')`;
 *   - get-answers.js refuses no identity outright and asks
 *     callerMayDriveSession, every refusal the same 404 as a code that names
 *     nothing. The public route answers `role=host` exactly as it answers a
 *     player.
 *
 * rejects: answer text or a name on the public route outside VOTE, under any
 * role claim, with or without a forged identity; the phone's own recovery
 * read broken; the door left public or open to `pending`; another team's host
 * (or no identity) getting anything but the same "Game not found"; a refused
 * caller costing a decrypt or a read past METADATA; the owning host refused,
 * or handed a different shape.
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
const { handler } = require(path.join(REPO, 'lambda-functions/game/get-answers.js'));
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

// Distinctive, so a substring check on the raw body means something.
const ANSWERS = [
  ['Ada-Lovelace-9', 'Close-Leeds-and-move-support-to-Bristol'],
  ['Grace-Hopper-9', 'Keep-Leeds-but-cut-the-night-shift'],
];
const NAMES = ANSWERS.map(([n]) => n);
const TEXTS = ANSWERS.map(([, t]) => t);

const ASK_GAME = '6201';       // org-owned, named round, answering
const RESULTS_GAME = '6202';   // org-owned, named round, results showing
const VOTE_GAME = '6203';      // org-owned, named round, voting
const ORGLESS_GAME = '6204';   // pre-tenancy, named round, answering
const NO_GAME = '9999';

async function seedSession(gameId, { orgId, state }) {
  const meta = {
    PK: `GAME#${gameId}`, SK: 'METADATA',
    ...(orgId ? { orgId } : {}),
    Title: 'Leeds support review',
    GameType: 'call-and-answer',
    HostPreferences: { anonymousUntilReveal: false },
  };
  put(orgId ? await encryptItem(orgId, 'session', meta) : meta);
  put({ PK: `GAME#${gameId}`, SK: 'STATE', State: state, LessonNumber: 1 });
  put({ PK: `GAME#${gameId}`, SK: 'ROUND#001', AuthorsRevealed: false });
  for (const [name, text] of ANSWERS) {
    const row = {
      PK: `GAME#${gameId}`, SK: `QUESTION#001#ANSWER#${name}`,
      PlayerName: name, Answer: text, AnswerType: 'text', SubmittedAt: '2026-09-26T09:06:00.000Z',
    };
    put(orgId ? await encryptItem(orgId, 'answer', row) : row);
    put({ PK: `GAME#${gameId}`, SK: `PLAYER#${name}`, PlayerName: name, ClientId: `client-${name}` });
  }
}

const PUBLIC_ROUTE = 'GET /games/{gameId}/answers';
const HOST_ROUTE = 'GET /games/{gameId}/answers/host';
/** The custom lambda authorizer's context: groups comma-joined, at `.lambda`. */
const hostOf = (orgId, groups = 'hosts') => ({ lambda: { userId: 'u-1', groups, orgId, orgIds: orgId } });

async function call(routeKey, gameId, query, authorizer = null) {
  reads.length = 0;
  const res = await handler({
    version: '2.0',
    routeKey,
    rawPath: routeKey === HOST_ROUTE ? `/games/${gameId}/answers/host` : `/games/${gameId}/answers`,
    pathParameters: { gameId },
    ...(query ? { queryStringParameters: query } : {}),
    requestContext: { routeKey, http: { method: 'GET' }, ...(authorizer ? { authorizer } : {}) },
  });
  let body = {};
  try { body = JSON.parse(res.body || '{}'); } catch { body = { unparsed: res.body }; }
  return { status: res.statusCode, body, raw: String(res.body || ''), read: reads.slice() };
}

/** No answer text and no author anywhere in the reply. */
function assertNoAnswers(r) {
  assert.ok(!('answers' in r.body), `the reply carries an answers list: ${r.raw.slice(0, 240)}`);
  for (const secret of [...NAMES, ...TEXTS]) {
    assert.ok(!r.raw.includes(secret), `the reply carries "${secret}": ${r.raw.slice(0, 240)}`);
  }
}

(async () => {
  await seedSession(ASK_GAME, { orgId: ORG, state: 'ASK#001' });
  await seedSession(RESULTS_GAME, { orgId: ORG, state: 'RESULTS#001' });
  await seedSession(VOTE_GAME, { orgId: ORG, state: 'VOTE#001' });
  await seedSession(ORGLESS_GAME, { state: 'ASK#001' });

  say('\n1. the template: the phone\'s read stays public, the host door is closed');
  const routes = routesFromTemplate();
  await check('the template scanner parses routes and sees Auth', () => assertScannerWorks(routes));
  await check('GET /games/{gameId}/answers carries no authorizer (phones hold no token)', () => {
    const r = findRoute(routes, 'GET', '/games/{gameId}/answers');
    assert.ok(r, 'the public route is gone');
    assert.strictEqual(r.authorizer, null);
  });
  await check('GET /games/{gameId}/answers/host carries CognitoAuthorizer', () => {
    const r = findRoute(routes, 'GET', '/games/{gameId}/answers/host');
    assert.ok(r, 'no answers/host route in the template');
    assert.strictEqual(r.authorizer, 'CognitoAuthorizer');
  });

  say('\n2. the authorizer demands a host on the door, and nobody on the phone\'s read');
  // `includes('answer')` in the generic public rule is exactly why the door
  // must be named before it: the door's own path contains the word.
  for (const p of ['games/{gameId}/answers/host', 'games/1234/answers/host']) {
    await check(`GET ${p} requires hosts or admins`, () =>
      assert.deepStrictEqual(requiredGroupsForRoute('GET', p), ['hosts', 'admins']));
    await check(`GET ${p} refuses a pending account`, () =>
      assert.strictEqual(hasPermission(['pending'], requiredGroupsForRoute('GET', p)), false));
    await check(`GET ${p} refuses an account in no group`, () =>
      assert.strictEqual(hasPermission([], requiredGroupsForRoute('GET', p)), false));
  }
  for (const p of ['games/{gameId}/answers', 'games/1234/answers']) {
    await check(`GET ${p} stays public`, () => assert.deepStrictEqual(requiredGroupsForRoute('GET', p), []));
  }

  say('\n3. the public route, as anyone can call it, outside VOTE');
  const CLAIMS = [
    { role: 'host' }, { role: 'HOST' }, { role: 'host', questionId: '001' },
    { role: 'host', question: '1' }, { role: 'player' }, null,
  ];
  for (const [label, gameId] of [['org, answering', ASK_GAME], ['org, results', RESULTS_GAME], ['orgless, answering', ORGLESS_GAME]]) {
    for (const query of CLAIMS) {
      const r = await call(PUBLIC_ROUTE, gameId, query);
      await check(`${label}, ${query ? JSON.stringify(query) : 'no query'}: 200, a count, no answers and no names`, () => {
        assert.strictEqual(r.status, 200, r.raw);
        assert.strictEqual(r.body.answerCount, 2);
        assertNoAnswers(r);
      });
    }
  }
  const forged = await call(PUBLIC_ROUTE, ASK_GAME, { role: 'host' }, hostOf(ORG));
  await check('a host identity on the PUBLIC route changes nothing', () => {
    assert.strictEqual(forged.status, 200, forged.raw);
    assertNoAnswers(forged);
  });

  say('\n4. the phone\'s own reads did not move');
  const voting = await call(PUBLIC_ROUTE, VOTE_GAME, { role: 'player', questionId: '001' });
  await check('during VOTE a phone still gets the answers to vote on', () => {
    assert.strictEqual(voting.status, 200, voting.raw);
    assert.deepStrictEqual(voting.body.answers.map((a) => a.answer).sort(), TEXTS.slice().sort());
  });
  const mine = await call(PUBLIC_ROUTE, ASK_GAME, { player: NAMES[0], question: '1', clientId: `client-${NAMES[0]}` });
  await check('a returning player still gets their own answer back, and only theirs', () => {
    assert.strictEqual(mine.status, 200, mine.raw);
    assert.strictEqual(mine.body.hasAnswer, true);
    assert.strictEqual(mine.body.answer, TEXTS[0]);
    assert.ok(!mine.raw.includes(TEXTS[1]) && !mine.raw.includes(NAMES[1]), 'another player\'s answer came back');
  });

  say('\n5. the host door, for the owning team');
  const own = await call(HOST_ROUTE, ASK_GAME, { questionId: '001' }, hostOf(ORG));
  await check('during ASK: 200, every answer, decrypted, with its author', () => {
    assert.strictEqual(own.status, 200, own.raw);
    assert.strictEqual(own.body.answerCount, 2);
    const rows = own.body.answers.map((a) => [a.playerName, a.answer]).sort();
    assert.deepStrictEqual(rows, ANSWERS.slice().sort());
    assert.ok(own.body.answers.every((a) => a.name === a.playerName && a.answerType === 'text' && a.submittedAt));
  });
  await check('the shape the stage and the remote already read, unchanged', () => {
    assert.deepStrictEqual(Object.keys(own.body).sort(), ['answerCount', 'answers', 'gameId', 'questionId', 'timestamp']);
    assert.strictEqual(own.body.gameId, ASK_GAME);
    assert.strictEqual(own.body.questionId, '001');
  });
  const current = await call(HOST_ROUTE, RESULTS_GAME, null, hostOf(ORG));
  await check('with no questionId it reads the current round, at RESULTS too', () => {
    assert.strictEqual(current.status, 200, current.raw);
    assert.strictEqual(current.body.questionId, '001');
    assert.strictEqual(current.body.answers.length, 2);
  });
  const admin = await call(HOST_ROUTE, ASK_GAME, { questionId: '001' }, hostOf(ORG, 'admins'));
  await check('an admin acting for the owning team: 200 with the answers', () => {
    assert.strictEqual(admin.status, 200, admin.raw);
    assert.strictEqual(admin.body.answers.length, 2);
  });
  const orgless = await call(HOST_ROUTE, ORGLESS_GAME, { questionId: '001' }, hostOf(ORG));
  await check('a signed-in host on an orgless session: 200 (callerMayDriveSession\'s rule)', () => {
    assert.strictEqual(orgless.status, 200, orgless.raw);
    assert.strictEqual(orgless.body.answers.length, 2);
  });

  say('\n6. the host door, for everyone else: the same "not found" as a code that names nothing');
  const nothing = await call(HOST_ROUTE, NO_GAME, { questionId: '001' }, hostOf(ORG));
  await check('a code that names no session: 404', () => assert.strictEqual(nothing.status, 404, nothing.raw));
  const cases = [
    ['no identity at all', ASK_GAME, null],
    ['no identity, claiming role=host', ASK_GAME, null, { role: 'host', questionId: '001' }],
    ['no identity on an orgless session (callerMayDriveSession alone would pass it)', ORGLESS_GAME, null],
    ['another team\'s host', ASK_GAME, hostOf(RIVAL)],
    ['another team\'s admin', RESULTS_GAME, hostOf(RIVAL, 'admins')],
  ];
  for (const [label, gameId, who, query] of cases) {
    forgetAllOrgs();
    const decryptsBefore = kms.calls.decrypt;
    const r = await call(HOST_ROUTE, gameId, query || { questionId: '001' }, who);
    await check(`${label}: the same 404, and no answers`, () => {
      assert.strictEqual(r.status, 404, r.raw);
      assert.deepStrictEqual(r.body, nothing.body);
      assertNoAnswers(r);
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
