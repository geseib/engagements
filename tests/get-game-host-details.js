/**
 * A SESSION'S WORKIE CONTEXT AND BRIEFING ARE THE HOST'S TO READ:
 * GET /games/{gameId}/host-details.
 *
 * `GET /games/{gameId}` is PUBLIC and must stay public — every phone reads the
 * session brief there, and RootPage checks a typed code against it before
 * anyone has signed in (tests/get-game-access-code.js §3). Its `?role=host`
 * branch is reached by a QUERY PARAMETER, a claim anyone can type, and it
 * returned two fields no phone is ever shown, both DECRYPTED:
 *
 *   aiContext   what the host told Workie about their own organisation
 *   briefing    a Call & Answer summary of a customer's document, file name
 *               and all
 *
 * Both are ciphertext at rest per organisation (tenant-crypto.js,
 * ENCRYPTED_FIELDS.session). So anyone who knew or walked a four-digit code
 * could read a team's private context with one curl. 9df1d5ec took
 * `accessCode` off the same branch for the same reason.
 *
 * The fix, three halves like every closed route here (3ae0d2bd, e76850b0):
 *   - the template gives GetGameFunction a second event, the host's door, with
 *     CognitoAuthorizer; the public event keeps none;
 *   - authorizer.js names the door for hosts|admins. The generic rule
 *     "GET + games is public" would otherwise let any account in, `pending`
 *     included;
 *   - get-game.js refuses no identity outright and asks callerMayDriveSession,
 *     every refusal the same 404 as a code that names nothing.
 * The public `?role=host` branch keeps everything else it returned, because
 * the host page's two public reads (checkGameStatus, the category restore)
 * still use it and none of what is left is content a phone is not shown.
 *
 * rejects: aiContext or briefing on the public route, under any role claim,
 * with or without a forged identity; the host door left public or open to
 * `pending`; another team's host (or no identity) getting anything but the
 * same "Game not found"; a refused caller costing a decrypt; the owning host
 * refused, or handed ciphertext.
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
    return { Items: [], Count: 0 };
  },
};
stub('@aws-sdk/client-dynamodb', { DynamoDBClient: class {} });
stub('@aws-sdk/lib-dynamodb', { DynamoDBDocumentClient: { from: () => fakeDoc }, GetCommand, QueryCommand });

const { makeKmsStub, installTestKeyLoader, forgetAllOrgs } = require('./helpers/tenant-crypto-stub');
const kms = makeKmsStub();
stub('@aws-sdk/client-kms', kms.exports);
installTestKeyLoader();

const { encryptItem } = require(path.join(REPO, 'lambda-functions/game/tenant-crypto.js'));
const { handler } = require(path.join(REPO, 'lambda-functions/game/get-game.js'));
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
// What must never cross the public route. Distinctive, so a substring check on
// the raw body means something.
const AI_CONTEXT = 'Acme-is-closing-the-Leeds-office-in-Q4';
const BRIEF_TEXT = 'Support backlog up 15 percent.\n- Two leads are leaving.';
const BRIEF_FILE = 'leeds-closure-v3.pdf';
const DETAILS = 'Bring last quarter numbers.';

const ORG_GAME = '5101';
const ORGLESS_GAME = '5102';
const NO_GAME = '9999';

async function seedSession(gameId, { orgId }) {
  const meta = {
    PK: `GAME#${gameId}`, SK: 'METADATA',
    ...(orgId ? { orgId } : {}),
    Title: 'Leeds support review',
    HostName: 'Ada',
    GameType: 'call-and-answer',
    QuestionSetId: 'set-support',
    QuestionSetScope: 'org',
    Details: DETAILS,
    AIContext: AI_CONTEXT,
    Briefing: {
      text: BRIEF_TEXT,
      source: { name: BRIEF_FILE, pages: 4, chars: 9000, truncated: false },
      namesRemoved: 2,
      draftedAt: '2026-09-23T10:00:00.000Z',
    },
    PersonaId: 'coach',
    PromptId: 'cna-standard',
    CreatedAt: '2026-09-26T09:00:00.000Z',
    Visibility: 'public',
    Started: false,
    HostPreferences: { anonymousUntilReveal: false, randomizeQuestions: false },
  };
  put(orgId ? await encryptItem(orgId, 'session', meta) : meta);
  put({ PK: `GAME#${gameId}`, SK: 'STATE', State: 'CREATED', UsedQuestions: [], PlayedQuestions: [] });
  put({
    PK: `GAME#${gameId}`, SK: 'STATE#CATS',
    'HostMask1-8': 255, 'HostMask9-16': 3, 'HostMask17-24': 0,
    'AvailMask1-8': 255, 'AvailMask9-16': 7, 'AvailMask17-24': 0,
  });
}

const PUBLIC_ROUTE = 'GET /games/{gameId}';
const HOST_ROUTE = 'GET /games/{gameId}/host-details';
/** The custom lambda authorizer's context: groups comma-joined, at `.lambda`. */
const hostOf = (orgId, groups = 'hosts') => ({ lambda: { userId: 'u-1', groups, orgId, orgIds: orgId } });

async function call(routeKey, gameId, query, authorizer = null) {
  reads.length = 0;
  const res = await handler({
    version: '2.0',
    routeKey,
    rawPath: routeKey === HOST_ROUTE ? `/games/${gameId}/host-details` : `/games/${gameId}`,
    pathParameters: { gameId },
    ...(query ? { queryStringParameters: query } : {}),
    requestContext: { routeKey, http: { method: 'GET' }, ...(authorizer ? { authorizer } : {}) },
  });
  let body = {};
  try { body = JSON.parse(res.body || '{}'); } catch { body = { unparsed: res.body }; }
  return { status: res.statusCode, body, raw: String(res.body || ''), read: reads.slice() };
}

/** Every key name in a payload, at every depth. */
function allKeys(value, out = []) {
  if (Array.isArray(value)) { value.forEach((v) => allKeys(v, out)); return out; }
  if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) { out.push(k); allKeys(v, out); }
  }
  return out;
}
const PRIVATE_KEY = /ai[\s_-]*context|briefing/i;

/** Neither private field is anywhere in the reply, by name or by value. */
function assertNothingPrivate(r) {
  const offenders = allKeys(r.body).filter((k) => PRIVATE_KEY.test(k));
  assert.deepStrictEqual(offenders, [], `the reply carries ${offenders.join(', ')}`);
  for (const secret of [AI_CONTEXT, BRIEF_TEXT.split('\n')[0], BRIEF_FILE]) {
    assert.ok(!r.raw.includes(secret), `the reply carries "${secret}": ${r.raw.slice(0, 200)}`);
  }
}

(async () => {
  await seedSession(ORG_GAME, { orgId: ORG });
  await seedSession(ORGLESS_GAME, {});

  say('\n1. the template: the session brief stays public, the host door is closed');
  const routes = routesFromTemplate();
  await check('the template scanner parses routes and sees Auth', () => assertScannerWorks(routes));
  await check('GET /games/{gameId} carries no authorizer (phones hold no token)', () => {
    const r = findRoute(routes, 'GET', '/games/{gameId}');
    assert.ok(r, 'the public route is gone');
    assert.strictEqual(r.authorizer, null);
  });
  await check('GET /games/{gameId}/host-details carries CognitoAuthorizer', () => {
    const r = findRoute(routes, 'GET', '/games/{gameId}/host-details');
    assert.ok(r, 'no host-details route in the template');
    assert.strictEqual(r.authorizer, 'CognitoAuthorizer');
  });

  say('\n2. the authorizer demands a host on the door, and nobody on the brief');
  for (const p of ['games/{gameId}/host-details', 'games/1234/host-details']) {
    await check(`GET ${p} requires hosts or admins`, () =>
      assert.deepStrictEqual(requiredGroupsForRoute('GET', p), ['hosts', 'admins']));
    await check(`GET ${p} refuses a pending account`, () =>
      assert.strictEqual(hasPermission(['pending'], requiredGroupsForRoute('GET', p)), false));
    await check(`GET ${p} refuses an account in no group`, () =>
      assert.strictEqual(hasPermission([], requiredGroupsForRoute('GET', p)), false));
  }
  for (const p of ['games/{gameId}', 'games/1234']) {
    await check(`GET ${p} stays public`, () => assert.deepStrictEqual(requiredGroupsForRoute('GET', p), []));
  }

  say('\n3. the public route, as anyone can call it');
  // Swept, because `role` is an unvalidated string: a guard written as
  // `role !== 'player'`, or one that lowercases, leaves a spelling through.
  const CLAIMS = [{ role: 'host' }, { role: 'HOST' }, { role: 'player' }, { role: '' }, null];
  for (const gameId of [ORG_GAME, ORGLESS_GAME]) {
    for (const query of CLAIMS) {
      const r = await call(PUBLIC_ROUTE, gameId, query);
      await check(`${gameId === ORG_GAME ? 'org' : 'orgless'} session, ${query ? `?role=${JSON.stringify(query.role)}` : 'no query'}: 200 with no aiContext and no briefing`, () => {
        assert.strictEqual(r.status, 200, r.raw);
        assertNothingPrivate(r);
      });
    }
  }
  // The ROUTE decides, not a token: the public event carries no authorizer, so
  // an identity on it can only be forged in a test — and must change nothing.
  const forged = await call(PUBLIC_ROUTE, ORG_GAME, { role: 'host' }, hostOf(ORG));
  await check('a host identity on the PUBLIC route changes nothing', () => {
    assert.strictEqual(forged.status, 200, forged.raw);
    assertNothingPrivate(forged);
  });
  const hostView = await call(PUBLIC_ROUTE, ORG_GAME, { role: 'host' });
  await check('the public ?role=host still carries what the host page\'s public reads use', () => {
    assert.strictEqual(hostView.body.started, false);
    assert.strictEqual(hostView.body.anonymousUntilReveal, false);
    assert.strictEqual(hostView.body.categoryState.hostMask1_8, 255);
  });

  say('\n4. the host door, for the owning team');
  const own = await call(HOST_ROUTE, ORG_GAME, null, hostOf(ORG));
  await check('200, with aiContext decrypted', () => {
    assert.strictEqual(own.status, 200, own.raw);
    assert.strictEqual(own.body.aiContext, AI_CONTEXT);
  });
  await check('and the briefing decrypted, file name and all', () => {
    assert.strictEqual(own.body.briefing && own.body.briefing.text, BRIEF_TEXT);
    assert.strictEqual(own.body.briefing.source.name, BRIEF_FILE);
    assert.strictEqual(own.body.briefing.namesRemoved, 2);
  });
  await check('and everything else the edit dialog seeds from, in one read', () => {
    const b = own.body;
    assert.strictEqual(b.gameId, ORG_GAME);
    assert.strictEqual(b.title, 'Leeds support review');
    assert.strictEqual(b.details, DETAILS);
    assert.strictEqual(b.gameType, 'call-and-answer');
    assert.strictEqual(b.questionSetId, 'set-support');
    assert.strictEqual(b.questionSetScope, 'org');
    assert.strictEqual(b.personaId, 'coach');
    assert.strictEqual(b.promptId, 'cna-standard');
    assert.strictEqual(b.randomizeQuestions, false);
    assert.strictEqual(b.anonymousUntilReveal, false);
    assert.strictEqual(b.started, false);
    assert.strictEqual(b.categoryState.availMask9_16, 7);
    assert.ok(!allKeys(b).some((k) => /access[\s_-]*code/i.test(k)), 'the access code came back');
  });
  const admin = await call(HOST_ROUTE, ORG_GAME, null, hostOf(ORG, 'admins'));
  await check('an admin acting for the owning team: 200 with aiContext', () => {
    assert.strictEqual(admin.status, 200, admin.raw);
    assert.strictEqual(admin.body.aiContext, AI_CONTEXT);
  });
  const orgless = await call(HOST_ROUTE, ORGLESS_GAME, null, hostOf(ORG));
  await check('a signed-in host on an orgless session: 200 (callerMayDriveSession\'s rule)', () => {
    assert.strictEqual(orgless.status, 200, orgless.raw);
    assert.strictEqual(orgless.body.aiContext, AI_CONTEXT);
  });

  say('\n5. the host door, for everyone else: the same "not found" as a code that names nothing');
  const nothing = await call(HOST_ROUTE, NO_GAME, null, hostOf(ORG));
  await check('a code that names no session: 404', () => assert.strictEqual(nothing.status, 404, nothing.raw));
  const cases = [
    ['no identity at all', ORG_GAME, null],
    ['no identity, claiming ?role=host', ORG_GAME, null, { role: 'host' }],
    ['no identity on an orgless session (callerMayDriveSession alone would pass it)', ORGLESS_GAME, null],
    ['another team\'s host', ORG_GAME, hostOf(RIVAL)],
    ['another team\'s admin', ORG_GAME, hostOf(RIVAL, 'admins')],
  ];
  for (const [label, gameId, who, query] of cases) {
    forgetAllOrgs();
    const decryptsBefore = kms.calls.decrypt;
    const r = await call(HOST_ROUTE, gameId, query || null, who);
    await check(`${label}: the same 404, and nothing private`, () => {
      assert.strictEqual(r.status, 404, r.raw);
      assert.deepStrictEqual(r.body, nothing.body);
      assertNothingPrivate(r);
      assert.ok(!r.raw.includes(DETAILS), 'the session details reached an outsider');
    });
    await check(`${label}: refused before any decrypt, and before the round state is read`, () => {
      assert.strictEqual(kms.calls.decrypt, decryptsBefore, 'a refused caller cost a KMS decrypt');
      assert.deepStrictEqual(r.read.filter((sk) => sk !== 'METADATA'), [], `read ${r.read.join(', ')}`);
    });
  }

  say(`\n${pass} passed, ${fail} failed`);
  suiteFinished();
  process.exit(fail ? 1 : 0);
})().catch((e) => { say(`CRASH ${e.stack}`); process.exit(1); });
