/**
 * Admin handlers check WHO is calling — a SECOND time, on purpose.
 *
 * A correction is recorded here because the first version of this file
 * asserted the wrong thing. `manage-users.js` carries the comment "Skip
 * authorization for now", which reads like an open door and is not one:
 * `CognitoAuthorizer` is a custom Lambda authorizer, not a Cognito JWT one, and
 * `lambda-functions/auth/authorizer.js:103-105` already gates every `/admin/*`
 * route to the `admins` group. There was no privilege-escalation hole.
 *
 * The guard is defence in depth. The upstream check routes by STRING PREFIX
 * (`path.startsWith('admin')`), so a route mounted at a path that does not
 * begin with `admin` — or a refactor of that one function — silently opens
 * every handler behind it. A handler that knows its own requirement does not
 * depend on how it was reached.
 *
 * THE EVENT SHAPE BELOW IS THE POINT. A simple-response Lambda authorizer puts
 * its context at `event.requestContext.authorizer.lambda`, with groups
 * COMMA-JOINED into a string. The first version of these tests built
 * `.jwt.claims['cognito:groups']` events — a shape this API never produces — so
 * they passed green against a guard that would have returned 403 to every real
 * administrator and broken the Users tab outright. Tests that assert a fixture
 * nothing generates prove nothing.
 *
 * These run the REAL handler against a stubbed Cognito client.
 */
const path = require('path');
const assert = require('assert');

const REPO = path.join(__dirname, '..');

// ---- Stub the Cognito SDK before the handler loads ------------------------
const Module = require('module');
const stubs = new Map();
const realLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (stubs.has(request)) return stubs.get(request);
  return realLoad.call(this, request, parent, isMain);
};

let sent = [];
class ListUsersCommand { constructor(i) { this.input = i; this.type = 'listUsers'; } }
class AdminListGroupsForUserCommand { constructor(i) { this.input = i; this.type = 'listGroups'; } }
class AdminAddUserToGroupCommand { constructor(i) { this.input = i; this.type = 'addToGroup'; } }
class AdminRemoveUserFromGroupCommand { constructor(i) { this.input = i; this.type = 'removeFromGroup'; } }
class AdminDeleteUserCommand { constructor(i) { this.input = i; this.type = 'deleteUser'; } }

stubs.set('@aws-sdk/client-cognito-identity-provider', {
  CognitoIdentityProviderClient: class {
    async send(cmd) {
      sent.push(cmd);
      if (cmd.type === 'listUsers') return { Users: [] };
      if (cmd.type === 'listGroups') return { Groups: [] };
      return {};
    }
  },
  ListUsersCommand,
  AdminListGroupsForUserCommand,
  AdminAddUserToGroupCommand,
  AdminRemoveUserFromGroupCommand,
  AdminDeleteUserCommand,
});

process.env.USER_POOL_ID = 'us-east-1_TEST';

const { handler } = require(path.join(REPO, 'lambda-functions', 'admin', 'manage-users.js'));
const { callerGroups, isAdminCaller } = require(path.join(REPO, 'lambda-functions', 'admin', 'shared', 'require-admin.js'));

const say = (...a) => process.stdout.write(a.join(' ') + '\n');
let pass = 0, fail = 0;
function check(label, fn) {
  try { fn(); say(`  PASS  ${label}`); pass++; }
  catch (e) { say(`  FAIL  ${label}\n        ${e.message}`); fail++; }
}

/**
 * An event in THIS API'S REAL SHAPE: a simple-response Lambda authorizer's
 * context at `.authorizer.lambda`, groups comma-joined, exactly as
 * `auth/authorizer.js:156-166` returns them.
 */
const eventAs = (groups, { method = 'POST', path: p = '/admin/users/list', body } = {}) => ({
  requestContext: {
    http: { method, path: p },
    authorizer: { lambda: {
      username: 'mallory',
      userId: 'sub-mallory',
      status: 'enabled',
      ...(groups === undefined ? {} : { groups }),
    } },
  },
  rawPath: p,
  body: body ? JSON.stringify(body) : undefined,
  pathParameters: { username: 'mallory' },
});

/** The same request as a native JWT authorizer would deliver it. */
const jwtEventAs = (groups, { method = 'POST', path: p = '/admin/users/list' } = {}) => ({
  requestContext: {
    http: { method, path: p },
    authorizer: { jwt: { claims: {
      'cognito:username': 'mallory',
      ...(groups === undefined ? {} : { 'cognito:groups': groups }),
    } } },
  },
  rawPath: p,
  pathParameters: { username: 'mallory' },
});

(async () => {
  say('1. The escalation that was possible');

  // REJECTS: removing the requireAdmin guard from the handler. This is the
  // exact request a pending user would have sent.
  sent = [];
  let res = await handler(eventAs('pending', {
    method: 'PUT', path: '/admin/users/mallory/state', body: { state: 'admins' },
  }));
  check('a pending user cannot promote themselves to admins', () =>
    assert.strictEqual(res.statusCode, 403));
  check('...and no Cognito group write was attempted', () =>
    assert.strictEqual(sent.filter((c) => c.type === 'addToGroup').length, 0));

  // REJECTS: treating "signed in" as "allowed". A host is a legitimate,
  // approved account and still must not administer.
  sent = [];
  res = await handler(eventAs('hosts', {
    method: 'PUT', path: '/admin/users/mallory/state', body: { state: 'admins' },
  }));
  check('an approved host cannot promote themselves either', () =>
    assert.strictEqual(res.statusCode, 403));

  // REJECTS: leaving /list open. Enumerating the pool is its own harm.
  sent = [];
  res = await handler(eventAs('hosts'));
  check('a host cannot enumerate every account', () =>
    assert.strictEqual(res.statusCode, 403));
  check('...and no ListUsers call was made', () =>
    assert.strictEqual(sent.filter((c) => c.type === 'listUsers').length, 0));

  say('\n2. Failing closed');

  for (const [label, claim] of [
    ['no cognito:groups claim at all', undefined],
    ['an empty groups claim', ''],
    ['a group list that does not include admins', '[hosts pending]'],
  ]) {
    res = await handler(eventAs(claim));
    check(`denied: ${label}`, () => assert.strictEqual(res.statusCode, 403));
  }

  // REJECTS: reading claims from a shape that does not exist and defaulting to
  // allow. An event with no requestContext at all must deny.
  res = await handler({ requestContext: { http: { method: 'POST', path: '/admin/users/list' } }, rawPath: '/admin/users/list' });
  check('denied: an event carrying no authorizer at all', () =>
    assert.strictEqual(res.statusCode, 403));

  say('\n3. An admin still gets through');

  // REJECTS: a guard so strict it locks admins out — the failure that would
  // send someone back to deleting the check entirely.
  sent = [];
  res = await handler(eventAs('admins'));
  check('an admin may list users', () => assert.strictEqual(res.statusCode, 200));
  check('...and the ListUsers call really happened', () =>
    assert.strictEqual(sent.filter((c) => c.type === 'listUsers').length, 1));

  say('\n4. The shapes — reading the wrong one fails CLOSED and locks admins out');

  // REJECTS: reading .jwt.claims only. THAT IS THE BUG THIS FILE SHIPPED WITH:
  // this API has no JWT authorizer, so every real admin would have got a 403
  // and the Users tab would have stopped working entirely. This is the single
  // most load-bearing assertion here.
  check('the Lambda-authorizer context (this API) is read', () =>
    assert.ok(isAdminCaller(eventAs('hosts,admins'))));
  check('...and a non-admin in that same shape is refused', () =>
    assert.ok(!isAdminCaller(eventAs('hosts,pending'))));

  // REJECTS: dropping the JWT fallbacks, so a route later moved onto a native
  // JWT authorizer silently locks out its admins.
  check('a native JWT authorizer still works',  () => assert.ok(isAdminCaller(jwtEventAs('[hosts admins]'))));
  check('...as an array claim',                 () => assert.ok(isAdminCaller(jwtEventAs(['admins']))));

  check('bare single group',      () => assert.ok(isAdminCaller(eventAs('admins'))));

  // REJECTS: a substring match. 'administrators' or 'not-admins' must not pass.
  check('a lookalike group name does not pass', () =>
    assert.ok(!isAdminCaller(eventAs('[administrators superadmins]'))));

  check('groups parse to a clean list', () =>
    assert.deepStrictEqual(callerGroups(eventAs('[hosts admins]')), ['hosts', 'admins']));

  say('\n5. Preflight must not be refused');

  // REJECTS: putting the guard above the OPTIONS branch. A preflight carries no
  // credentials, so a 403 there breaks the browser before the real call.
  res = await handler({
    requestContext: { http: { method: 'OPTIONS', path: '/admin/users/list' } },
    rawPath: '/admin/users/list',
  });
  check('OPTIONS preflight is answered, not refused', () =>
    assert.ok(res.statusCode >= 200 && res.statusCode < 300));

  say(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('harness error:', e); process.exit(2); });
