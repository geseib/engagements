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
// Per-test stub state: accounts the pool "contains", each account's groups,
// and accounts every Admin* call must fail to find (the stale-row case).
let poolUsers = [];
let groupsByUser = {};
let missingUsers = new Set();
class ListUsersCommand { constructor(i) { this.input = i; this.type = 'listUsers'; } }
class AdminListGroupsForUserCommand { constructor(i) { this.input = i; this.type = 'listGroups'; } }
class AdminAddUserToGroupCommand { constructor(i) { this.input = i; this.type = 'addToGroup'; } }
class AdminRemoveUserFromGroupCommand { constructor(i) { this.input = i; this.type = 'removeFromGroup'; } }
class AdminDeleteUserCommand { constructor(i) { this.input = i; this.type = 'deleteUser'; } }
class AdminDisableUserCommand { constructor(i) { this.input = i; this.type = 'disableUser'; } }
class AdminEnableUserCommand { constructor(i) { this.input = i; this.type = 'enableUser'; } }

stubs.set('@aws-sdk/client-cognito-identity-provider', {
  CognitoIdentityProviderClient: class {
    async send(cmd) {
      sent.push(cmd);
      if (cmd.input?.Username && missingUsers.has(cmd.input.Username)) {
        const e = new Error('User does not exist.');
        e.name = 'UserNotFoundException';
        throw e;
      }
      if (cmd.type === 'listUsers') return { Users: poolUsers };
      if (cmd.type === 'listGroups') {
        return { Groups: (groupsByUser[cmd.input.Username] || []).map((g) => ({ GroupName: g })) };
      }
      return {};
    }
  },
  ListUsersCommand,
  AdminListGroupsForUserCommand,
  AdminAddUserToGroupCommand,
  AdminRemoveUserFromGroupCommand,
  AdminDeleteUserCommand,
  AdminDisableUserCommand,
  AdminEnableUserCommand,
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
/*
  `target` NAMES THE ACCOUNT BEING ACTED ON, and it defaults to the caller only
  because that is how this fixture was written.

  Every state-change case below used to leave it there, so the request was an
  Engage admin acting on THEMSELVES — invisible while the handler had no
  self-check, and refused the moment it grew one (manage-users.js now blocks
  disabling or deleting your own account, because nothing in the product undoes
  either). The subject of this file is which GROUPS may call these routes, not
  who the target is, so the state-change cases now name somebody else.
*/
const eventAs = (groups, {
  method = 'POST', path: p = '/admin/users/list', body, target = 'mallory',
} = {}) => ({
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
  pathParameters: { username: target },
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

  say('\n6. Reject disables the ACCOUNT — there is no group named "disabled"');

  // REJECTS: AdminAddUserToGroup with GroupName 'disabled'. No template has
  // ever created that group (only admins/hosts/pending exist), so every
  // reject answered Cognito's raw "Group not found" — the owner's report.
  // And a group could not keep the confirm dialog's "cannot sign in" promise
  // anyway; only the account flag does. Nothing in this path reads
  // email_verified, which is why an unverified registrant is just as
  // rejectable — the owner's other half of the report.
  sent = []; groupsByUser = { registrant: ['pending'] };
  res = await handler(eventAs('admins', {
    method: 'PUT', path: '/admin/users/registrant/state', target: 'registrant', body: { newState: 'disabled' },
  }));
  check('reject answers 200', () => assert.strictEqual(res.statusCode, 200));
  check('the account is disabled at the Cognito level', () =>
    assert.strictEqual(sent.filter((c) => c.type === 'disableUser').length, 1));
  check('no group write is attempted for the phantom "disabled" group', () =>
    assert.strictEqual(sent.filter((c) => c.type === 'addToGroup').length, 0));
  check('the pending membership is removed', () =>
    assert.ok(sent.some((c) => c.type === 'removeFromGroup' && c.input.GroupName === 'pending')));

  // REJECTS: leaving a re-approved account switched off — the hosts group
  // with Enabled=false is a person who was told they were approved and still
  // cannot sign in.
  sent = []; groupsByUser = {};
  res = await handler(eventAs('admins', {
    method: 'PUT', path: '/admin/users/registrant/state', target: 'registrant', body: { newState: 'hosts' },
  }));
  check('moving back to hosts re-enables the account', () =>
    assert.strictEqual(sent.filter((c) => c.type === 'enableUser').length, 1));
  check('...and lands exactly the one group', () =>
    assert.deepStrictEqual(
      sent.filter((c) => c.type === 'addToGroup').map((c) => c.input.GroupName),
      ['hosts'],
    ));

  // REJECTS: the raw 500 for a row that outlived its account.
  /* The TARGET is what vanished, and the target is no longer the caller — see
     the note on `eventAs`. Naming the caller here made the account under test
     exist perfectly well, and the case asserted a 404 that could not happen. */
  sent = []; missingUsers = new Set(['registrant']);
  res = await handler(eventAs('admins', {
    method: 'PUT', path: '/admin/users/registrant/state', target: 'registrant', body: { newState: 'disabled' },
  }));
  check('a vanished account answers 404, not a raw 500', () =>
    assert.strictEqual(res.statusCode, 404));
  check('...and tells the admin to refresh', () =>
    assert.match(JSON.parse(res.body).error, /no longer exists/i));
  missingUsers = new Set();

  // REJECTS: a rejected (group-less, disabled) account defaulting to
  // 'pending' in the list and reappearing in the approval queue.
  sent = []; poolUsers = [
    { Username: 'rejected-one', Enabled: false, Attributes: [{ Name: 'email', Value: 'r@x.com' }] },
  ];
  res = await handler(eventAs('admins'));
  check('a disabled account lists as disabled, never as pending', () =>
    assert.strictEqual(JSON.parse(res.body).users[0].state, 'disabled'));
  poolUsers = [];

  say(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('harness error:', e); process.exit(2); });
