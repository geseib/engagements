/**
 * `GET /games` is the session DIRECTORY, and it was public.
 *
 * One unauthenticated request returned every game in the environment: the
 * four-digit `gameId` — which IS the join code, the only thing a participant
 * ever types — plus the title the host wrote, the host's name, and `started`
 * and `visibility` flags naming which of them are live right now and which
 * have no access code. Four-digit codes were only ever protected by the cost
 * of guessing 10,000 of them noisily; this published the answer key, sorted.
 *
 * Closing it takes TWO changes and neither works alone:
 *
 *   1. `template-clean.yaml` attaches `CognitoAuthorizer` to the route.
 *   2. `authorizer.js`'s `requiredGroupsForRoute` names the route explicitly.
 *
 * WITHOUT (2), (1) IS A FALSE FIX, AND IT LOOKS LIKE A REAL ONE. The generic
 * rule in that function is
 *
 *     if (... || (method === 'GET' && path.includes('games'))) return [];
 *
 * so `GET /games` matched "public, no groups required" and the authorizer would
 * have authenticated the caller and waved through ANY account in the pool —
 * including one still sitting in `pending`, unapproved, who signed up ninety
 * seconds ago. Authentication doing the work of authorisation, the same failure
 * require-admin.js:19-24 records for /admin/users/*. The route would have gone
 * from "public to the internet" to "public to anyone who can fill in a signup
 * form", and read as done. Section 3 is the only thing that catches it.
 *
 * AND THE OPPOSITE MISTAKE TAKES THE WHOLE PRODUCT DOWN. The new branch must
 * match `path === 'games'` EXACTLY. `startsWith('games')` or `includes('games')`
 * would also catch `GET /games/{gameId}` — the session brief the root page
 * checks a typed code against — and every `GET /games/{gameId}/*` under it:
 * /state, /players, /answers, /question, /votes. Those are the participant
 * journey, they carry no token, and they would all begin returning 401.
 * Sections 2 and 4 exist to fail loudly the moment that happens.
 *
 * THE EVENT SHAPE IN SECTIONS 3 AND 4 IS NOT INVENTED. `CognitoAuthorizer` is
 * a CUSTOM Lambda authorizer despite the name (payload format 2.0,
 * `EnableSimpleResponses: true`), not a Cognito JWT authorizer. It is handed
 * `routeKey` ("GET /games") and `identitySource` and returns
 * `{ isAuthorized, context }` with groups COMMA-JOINED into a string. An
 * earlier round of tests on this API asserted `.jwt.claims` — a shape this API
 * never produces — and eighteen of them passed green against a broken guard.
 * The fixtures below are built from what authorizer.js actually reads and
 * actually emits, and section 3 drives the REAL exported handler so that the
 * literal `'games'` is checked against the path the handler really derives,
 * not against one this file made up.
 */
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const REPO = path.join(__dirname, '..');

// ---- Stubs, installed before the authorizer loads --------------------------
// @aws-sdk/client-cognito-identity-provider is not installed anywhere this
// file can resolve it from, so it MUST be intercepted by request string.
const Module = require('module');
const stubs = new Map();
const realLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (stubs.has(request)) return stubs.get(request);
  return realLoad.call(this, request, parent, isMain);
};

/** Groups the stubbed Cognito returns for the next call. */
let userGroups = [];
class AdminListGroupsForUserCommand { constructor(i) { this.input = i; } }

stubs.set('@aws-sdk/client-cognito-identity-provider', {
  CognitoIdentityProviderClient: class {
    async send() { return { Groups: userGroups.map((GroupName) => ({ GroupName })) }; }
  },
  AdminListGroupsForUserCommand,
});

// The token in these fixtures is a JSON blob of the claims; the stub "verifies"
// it by parsing. Signature verification is not what this file is about — who
// is allowed through which route is.
stubs.set('jsonwebtoken', {
  decode: () => ({ header: { kid: 'test-kid' } }),
  verify: (token) => JSON.parse(token),
});
stubs.set('jwk-to-pem', () => 'stub-pem');
stubs.set('axios', { get: async () => ({ data: { keys: [{ kid: 'test-kid' }] } }) });

process.env.USER_POOL_ID = 'us-east-1_TEST';
process.env.CLIENT_ID = 'test-client-id';
process.env.REGION = 'us-east-1';

const authorizer = require(path.join(REPO, 'lambda-functions/auth/authorizer.js'));
const { requiredGroupsForRoute, handler } = authorizer;

// ---- Tiny harness ----------------------------------------------------------
let pass = 0, fail = 0;
const say = (s) => console.log(s);
async function check(label, fn) {
  try { await fn(); console.log(`  PASS  ${label}`); pass++; }
  catch (e) { console.log(`  FAIL  ${label}\n        ${e.message}`); fail++; }
}

/**
 * A real payload-2.0 REQUEST authorizer event, as API Gateway builds it.
 *
 * `routeKey` is stamped from the route that actually matched, so it is the one
 * thing here a caller cannot forge — which is exactly why the group table is
 * keyed off it. `identitySource[0]` is the configured Authorization header.
 */
const authEvent = (routeKey, claims = {}) => {
  const token = JSON.stringify({
    sub: 'user-sub-1',
    'cognito:username': 'ada',
    email: 'ada@example.invalid',
    ...claims,
  });
  const rawPath = routeKey.split(' ')[1];
  return {
    version: '2.0',
    type: 'REQUEST',
    routeKey,
    rawPath,
    identitySource: [`Bearer ${token}`],
    headers: { authorization: `Bearer ${token}` },
    requestContext: { routeKey, http: { method: routeKey.split(' ')[0], path: rawPath } },
  };
};

/** Drive the real handler as `groups`, and report whether it was let in. */
async function authorizeAs(groups, routeKey) {
  userGroups = groups;
  return handler(authEvent(routeKey));
}

/** Every GET a participant's client makes, by its real route key. */
const PARTICIPANT_GETS = [
  'games/{gameId}',
  'games/{gameId}/state',
  'games/{gameId}/state/{playerId}',
  'games/{gameId}/players',
  'games/{gameId}/answers',
  'games/{gameId}/question',
  'games/{gameId}/votes',
];

(async () => {
  // ------------------------------------------------------------------------
  say('\n1. the LIST requires a host or an admin');
  // REJECTS: shipping the template's `Auth:` block without adding the branch to
  // requiredGroupsForRoute. Without the branch this returns [] — "no groups
  // required" — and every pending account reads the directory.

  await check("GET 'games' requires ['hosts','admins']", () =>
    assert.deepStrictEqual(requiredGroupsForRoute('GET', 'games'), ['hosts', 'admins']));

  // REJECTS: returning a bare string instead of an array. hasPermission calls
  // .some() on it, which throws, which the handler catches and turns into a
  // silent blanket denial — every real host locked out of Game History.
  await check('and it returns an array, which is what hasPermission needs', () =>
    assert.ok(Array.isArray(requiredGroupsForRoute('GET', 'games'))));

  // ------------------------------------------------------------------------
  say('\n2. a SINGLE game does not — this is the regression that would end the product');
  // REJECTS: `path.startsWith('games')` or `path.includes('games')` in place of
  // `path === 'games'`. Each of these is a route a phone in the room calls with
  // no token; requiring a group on any of them 401s the join flow outright.

  await check("GET 'games/{gameId}' still requires no groups (the code check)", () =>
    assert.deepStrictEqual(requiredGroupsForRoute('GET', 'games/{gameId}'), []));

  for (const p of PARTICIPANT_GETS) {
    await check(`GET '${p}' still requires no groups`, () =>
      assert.deepStrictEqual(requiredGroupsForRoute('GET', p), [],
        `a participant route now demands groups — the join flow is down`));
  }

  // REJECTS: a prefix match written the other way round, e.g. matching any path
  // that merely BEGINS the word. 'games-archive' is not the list either.
  await check("a path that only starts with 'games' is not the list", () =>
    assert.deepStrictEqual(requiredGroupsForRoute('GET', 'games-archive'), []));

  // ------------------------------------------------------------------------
  say('\n3. the REAL handler, on the REAL routeKey — pending is refused, hosts are not');
  // REJECTS: writing the literal as '/games' (with the slash) or otherwise
  // failing to match the path the handler actually derives. requiredGroupsForRoute
  // is called with routeKey's path stripped of its leading slash, and section 1
  // alone cannot prove the literal agrees with that derivation — it asserts the
  // function against a string this file chose. This drives the handler end to
  // end so API Gateway's routeKey picks the string instead.

  {
    const res = await authorizeAs(['pending'], 'GET /games');
    await check('a `pending` account is REFUSED the directory', () =>
      assert.strictEqual(res.isAuthorized, false,
        'a signed-up-but-unapproved account read every join code in the environment'));
  }

  {
    // No groups at all — a pool account that was never put anywhere.
    const res = await authorizeAs([], 'GET /games');
    await check('an account in no group is refused', () =>
      assert.strictEqual(res.isAuthorized, false));
  }

  for (const group of ['hosts', 'admins']) {
    const res = await authorizeAs([group], 'GET /games');
    await check(`a '${group}' account is allowed`, () =>
      assert.strictEqual(res.isAuthorized, true,
        `${group} was locked out of Game History and the Sessions tab`));
    // The context shape the backing lambdas read: groups COMMA-JOINED, at
    // event.requestContext.authorizer.lambda. Asserted so the allow-path is
    // checked for more than a boolean.
    await check(`'${group}' still gets its groups comma-joined in the context`, () =>
      assert.strictEqual(res.context.groups, group));
  }

  // ------------------------------------------------------------------------
  say('\n4. the same handler leaves the participant routes alone');
  // REJECTS: the same prefix-match slip as section 2, but proven through the
  // handler's own path derivation rather than against a hand-written string.
  // A pending account is used deliberately: these routes carry no authorizer at
  // all in the template, so if one is ever moved behind it, the weakest signed-in
  // caller must still get through.

  for (const p of PARTICIPANT_GETS) {
    const res = await authorizeAs(['pending'], `GET /${p}`);
    await check(`GET /${p} admits the weakest signed-in caller`, () =>
      assert.strictEqual(res.isAuthorized, true,
        `GET /${p} now refuses participants — the room cannot join or play`));
  }

  // ------------------------------------------------------------------------
  say('\n5. the neighbouring rules were not disturbed');
  // REJECTS: inserting the new branch in the wrong place. It sits between the
  // /admin/* block and the write-methods block; dropped in above the admin
  // rules, or below the public rule, the answers here change.

  await check('POST /games (create) still requires host or admin', () =>
    assert.deepStrictEqual(requiredGroupsForRoute('POST', 'games'), ['hosts', 'admins']));
  await check('POST /games/{gameId}/close-round still requires host or admin', () =>
    assert.deepStrictEqual(
      requiredGroupsForRoute('POST', 'games/{gameId}/close-round'), ['hosts', 'admins']));
  await check('admin/clear-game is still open to hosts', () =>
    assert.deepStrictEqual(
      requiredGroupsForRoute('POST', 'admin/clear-game/{gameId}'), ['hosts', 'admins']));
  await check('every other admin route is still admins-only', () =>
    assert.deepStrictEqual(requiredGroupsForRoute('GET', 'admin/users/list'), ['admins']));

  // ------------------------------------------------------------------------
  say('\n6. the route in the template actually carries the authorizer');
  // REJECTS: the branch above shipping alone. A group rule on a route with no
  // authorizer attached is dead code — the authorizer lambda is never invoked,
  // and GET /games stays open to the internet while every test above passes.
  // The two halves only close the hole together, so they are pinned together.

  const template = fs.readFileSync(path.join(REPO, 'template-clean.yaml'), 'utf8');
  const start = template.indexOf('GetGamesListEvent:');
  await check('GetGamesListEvent exists in the template', () =>
    assert.ok(start !== -1, 'the route event was renamed or removed'));

  // Bound the slice at the next top-level resource key (two-space indent), so
  // this reads only GetGamesListFunction's own event and cannot be satisfied by
  // an `Auth:` block belonging to some other route further down the file.
  const rest = template.slice(start);
  const nextResource = rest.slice(1).search(/\n {2}\S/);
  const block = nextResource === -1 ? rest : rest.slice(0, nextResource + 1);

  await check('the block is the /games route and only that route', () => {
    const paths = block.match(/^\s*Path:.*$/gm) || [];
    assert.deepStrictEqual(paths.map((s) => s.trim()), ['Path: /games']);
  });
  await check('it is the GET', () =>
    assert.ok(/^\s*Method:\s*GET\s*$/m.test(block), block));
  await check('and it names CognitoAuthorizer', () =>
    assert.ok(/^\s*Auth:\s*$/m.test(block) && /^\s*Authorizer:\s*CognitoAuthorizer\s*$/m.test(block),
      'GET /games has no authorizer attached — the group rule above is dead code'));

  // ------------------------------------------------------------------------
  say('\n7. the host page sends a token to it');
  // REJECTS: the backend gaining an authorizer while GameHostPage still sends a
  // bare fetch — a 401 that surfaces only when a host opens Game History or
  // Reports mid-session, long after the deploy looked clean. GameHostPage is
  // ~5,000 lines and cannot be mounted here, so this is a source-shape check,
  // the same move src/src/__tests__/gameSetupCallSite.test.js makes.

  const hostPage = fs.readFileSync(path.join(REPO, 'src/src/GameHostPage.jsx'), 'utf8');

  await check('fetchGamesList calls authFetch', () =>
    assert.ok(/await\s+authFetch\(`\$\{API_BASE\}games`\)/.test(hostPage),
      'the games-list call site does not send a token'));

  // The closing paren immediately after the template literal is what keeps this
  // off the POST /games CREATE call a few hundred lines up, which is
  // fetch(`${API_BASE}games`, { ... } — a second argument, so no match. That
  // route is public and is a separate question; this must not drag it in.
  await check('and no bare fetch of the list survives', () =>
    assert.ok(!/await\s+fetch\(`\$\{API_BASE\}games`\)/.test(hostPage),
      'a bare fetch of GET /games is still in the file — it will 401'));

  await check('the POST /games create call is untouched by that assertion', () =>
    assert.ok(/fetch\(`\$\{API_BASE\}games`,\s*\{/.test(hostPage),
      'the create call changed shape — re-read the negative assertion above'));

  await check('authFetch is imported', () =>
    assert.ok(/import\s*\{[^}]*\bauthFetch\b[^}]*\}\s*from\s*'\.\/auth\/authFetch'/.test(hostPage)));

  // REJECTS: dropping the expired-session branch, which turns a 401 into
  // `res.json()` throwing on an error body and a misleading "please try again".
  await check('a refusal is handled distinctly from a network failure', () =>
    assert.ok(/res\.status\s*===\s*401\s*\|\|\s*res\.status\s*===\s*403/.test(hostPage)));

  // ------------------------------------------------------------------------
  say('\n8. the admin Sessions tab already sent one, and still does');
  // REJECTS: "fixing" the other caller by reverting it to a bare fetch.

  const sessions = fs.readFileSync(path.join(REPO, 'src/src/components/SessionsPanel.jsx'), 'utf8');
  await check('SessionsPanel loads the list with authFetch', () =>
    assert.ok(/await\s+authFetch\(adminApiUrl\('games'\)\)/.test(sessions),
      'the admin Sessions tab stopped sending a token'));

  say(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('harness error:', e); process.exit(2); });
