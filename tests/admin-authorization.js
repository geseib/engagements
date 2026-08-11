/**
 * Admin routes must check WHO is calling, not merely THAT someone is.
 *
 * `manage-users.js` sat behind `CognitoAuthorizer` with the comment
 * "Skip authorization for now" and no check. That authorizer admits any account
 * in the pool — including one still in `pending` — so any registered user could
 * PUT their own username's state to `admins` and become an administrator, or
 * list every account in the pool.
 *
 * These run the REAL handler against a stubbed Cognito client, so they exercise
 * the actual routing and the actual guard rather than a reimplementation.
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

/** An HTTP-API v2 event with the given cognito:groups claim. */
const eventAs = (groups, { method = 'POST', path: p = '/admin/users/list', body } = {}) => ({
  requestContext: {
    http: { method, path: p },
    authorizer: { jwt: { claims: {
      'cognito:username': 'mallory',
      ...(groups === undefined ? {} : { 'cognito:groups': groups }),
    } } },
  },
  rawPath: p,
  body: body ? JSON.stringify(body) : undefined,
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

  say('\n4. The claim shapes, which is where this fails open if got wrong');

  // REJECTS: handling only one serialisation. cognito:groups arrives as a real
  // array, a bracketed space-joined string, or a comma-joined string depending
  // on the payload version and the path it took.
  check('array claim',            () => assert.ok(isAdminCaller(eventAs(['admins']))));
  check('bracketed space-joined', () => assert.ok(isAdminCaller(eventAs('[hosts admins]'))));
  check('comma-joined',           () => assert.ok(isAdminCaller(eventAs('hosts,admins'))));
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
