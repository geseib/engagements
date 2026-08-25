/**
 * THE PLATFORM CONSOLE CANNOT BE LOCKED SHUT FROM INSIDE IT.
 *
 * ── WHAT WAS POSSIBLE ──────────────────────────────────────────────────────
 *
 * `changeUserState` removed every group a person was in and then added the one
 * asked for, with no guard of any kind. So on the Accounts screen — which is
 * itself only reachable from the Engage console — an Engage admin could press
 * "Make host", "Disable" or "Delete" on the LAST remaining Engage admin,
 * including themselves, and the platform console became unreachable for
 * everybody.
 *
 * Nothing in the product could undo it. Organisations, Moderation and Accounts
 * all live behind the `admins` group, and the one screen that grants that group
 * is behind it too. Recovery means the AWS console or the CLI against Cognito.
 *
 * This got sharper with tenancy, not milder: before the split "admin" was a
 * single role that mostly meant "can use the admin screens", and now it is the
 * only route to approving organisations and approving new accounts at all.
 *
 * ── AND YOU CANNOT DELETE YOUR OWN ACCOUNT ─────────────────────────────────
 *
 * A separate, smaller foot-gun on the same screen with the same non-existent
 * undo. Demoting yourself while other admins remain is allowed — somebody
 * stepping back from the role is a real thing, and another admin can reverse
 * it. Deleting or disabling yourself is not reversible by anyone but AWS.
 *
 * // rejects: any change that would leave the pool with zero Engage admins, and
 * //          any caller destroying their own account.
 */
const path = require('path');
const assert = require('assert');
const Module = require('module');

const REPO = path.join(__dirname, '..');

/* ── A Cognito stub, driven by one in-memory pool ────────────────────────── */

const pool = new Map();          // username -> { groups:Set, enabled:bool }
const calls = [];

class ListUsersCommand { constructor(i) { this.input = i; this.name = 'ListUsers'; } }
class ListUsersInGroupCommand { constructor(i) { this.input = i; this.name = 'ListUsersInGroup'; } }
class AdminListGroupsForUserCommand { constructor(i) { this.input = i; this.name = 'AdminListGroupsForUser'; } }
class AdminAddUserToGroupCommand { constructor(i) { this.input = i; this.name = 'AdminAddUserToGroup'; } }
class AdminRemoveUserFromGroupCommand { constructor(i) { this.input = i; this.name = 'AdminRemoveUserFromGroup'; } }
class AdminDeleteUserCommand { constructor(i) { this.input = i; this.name = 'AdminDeleteUser'; } }
class AdminDisableUserCommand { constructor(i) { this.input = i; this.name = 'AdminDisableUser'; } }
class AdminEnableUserCommand { constructor(i) { this.input = i; this.name = 'AdminEnableUser'; } }

class CognitoIdentityProviderClient {
  async send(cmd) {
    calls.push(cmd.name);
    const u = cmd.input.Username;
    switch (cmd.name) {
      case 'ListUsers':
        return {
          Users: [...pool.entries()].map(([Username, r]) => ({
            Username, Enabled: r.enabled, Attributes: [], UserStatus: 'CONFIRMED',
          })),
        };
      case 'ListUsersInGroup': {
        /* Paginated on purpose: the handler's count must survive a page
           boundary, and a stub that returns everything at once would let a
           single-page implementation pass. One user per page. */
        const all = [...pool.entries()]
          .filter(([, r]) => r.groups.has(cmd.input.GroupName))
          .map(([Username, r]) => ({ Username, Enabled: r.enabled }));
        const from = Number(cmd.input.NextToken || 0);
        const slice = all.slice(from, from + 1);
        return {
          Users: slice,
          NextToken: from + 1 < all.length ? String(from + 1) : undefined,
        };
      }
      case 'AdminListGroupsForUser':
        return { Groups: [...(pool.get(u)?.groups || [])].map((GroupName) => ({ GroupName })) };
      case 'AdminAddUserToGroup':
        pool.get(u).groups.add(cmd.input.GroupName); return {};
      case 'AdminRemoveUserFromGroup':
        pool.get(u).groups.delete(cmd.input.GroupName); return {};
      case 'AdminDeleteUser':
        pool.delete(u); return {};
      case 'AdminDisableUser':
        pool.get(u).enabled = false; return {};
      case 'AdminEnableUser':
        pool.get(u).enabled = true; return {};
      default:
        throw new Error(`unexpected command ${cmd.name}`);
    }
  }
}

const stubExports = {
  CognitoIdentityProviderClient,
  ListUsersCommand,
  ListUsersInGroupCommand,
  AdminListGroupsForUserCommand,
  AdminAddUserToGroupCommand,
  AdminRemoveUserFromGroupCommand,
  AdminDeleteUserCommand,
  AdminDisableUserCommand,
  AdminEnableUserCommand,
};

const realResolve = Module._resolveFilename;
Module._resolveFilename = function patched(request, ...rest) {
  if (request === '@aws-sdk/client-cognito-identity-provider') return request;
  return realResolve.call(this, request, ...rest);
};
require.cache['@aws-sdk/client-cognito-identity-provider'] = {
  id: '@aws-sdk/client-cognito-identity-provider',
  filename: '@aws-sdk/client-cognito-identity-provider',
  loaded: true,
  exports: stubExports,
};

process.env.USER_POOL_ID = 'us-east-1_TEST';

const { handler } = require(path.join(REPO, 'lambda-functions/admin/manage-users.js'));

/* ── Harness ─────────────────────────────────────────────────────────────── */

let pass = 0; let fail = 0;
async function check(label, fn) {
  try { await fn(); console.log(`  ok   - ${label}`); pass += 1; } catch (e) {
    console.log(`  FAIL - ${label}\n         ${e.message}`); fail += 1;
  }
}

/** A request from a signed-in Engage admin. */
const req = (username, newState, caller = 'u_boss') => ({
  requestContext: {
    http: { method: 'PUT', path: `/admin/users/${username}/state` },
    authorizer: { lambda: { userId: caller, username: caller, groups: 'admins,hosts' } },
  },
  pathParameters: { username },
  body: JSON.stringify({ newState }),
});

function seed(rows) {
  pool.clear();
  calls.length = 0;
  for (const [username, groups, enabled = true] of rows) {
    pool.set(username, { groups: new Set(groups), enabled });
  }
}

const groupsOf = (u) => [...(pool.get(u)?.groups || [])].sort();
const bodyOf = (res) => JSON.parse(res.body || '{}');

(async () => {
  console.log('1. the last Engage admin is not removable, by any route');

  /*
    THE CALLER IS THE TARGET IN TWO OF THESE FOUR, AND IT CANNOT BE OTHERWISE.

    When there is exactly one Engage admin left, the only person who can reach
    this route IS that admin — the route is `admins`-only. So for `delete` and
    `disabled` the self rule fires first and the refusal says "your own account"
    rather than "the last Engage admin".

    Both are correct and both refuse. Asserting `/last/i` on all four was the
    test being more specific than the system, so it asserts the OUTCOME (409,
    nothing written) and accepts either reason.
  */
  for (const [state, verb] of [['hosts', 'demoted'], ['disabled', 'disabled'], ['delete', 'deleted'], ['pending', 'sent back to pending']]) {
    // rejects: the shipped behaviour — every one of these four left the pool
    // with zero Engage admins and no way back in through the product.
    await check(`the only admin cannot be ${verb}`, async () => {
      seed([['u_boss', ['admins']], ['u_host', ['hosts']]]);
      const res = await handler(req('u_boss', state));
      assert.strictEqual(res.statusCode, 409, res.body);
      assert.match(bodyOf(res).error, /last Engage admin|your own account/i);
      assert.deepStrictEqual(groupsOf('u_boss'), ['admins'], 'the group must be untouched');
      assert.strictEqual(pool.has('u_boss'), true, 'and the account must still exist');
      assert.strictEqual(pool.get('u_boss').enabled, true, 'and still be enabled');
    });
  }

  /* The pool rule on its own, with a caller who is NOT the target — the shape
     the self rule cannot mask. */
  // rejects: a guard that only ever fires because of the self check, which
  // would leave the last admin removable by anybody else the moment a second
  // admin existed and was then removed first.
  await check('the last admin is protected from OTHER callers too', async () => {
    seed([['u_boss', ['admins']], ['u_host', ['hosts']]]);
    const res = await handler(req('u_boss', 'delete', 'u_someone_else'));
    assert.strictEqual(res.statusCode, 409, res.body);
    assert.match(bodyOf(res).error, /last Engage admin/i);
    assert.strictEqual(pool.has('u_boss'), true);
  });

  await check('the refusal happens BEFORE any group is removed', async () => {
    seed([['u_boss', ['admins']]]);
    await handler(req('u_boss', 'hosts'));
    // rejects: checking after the destructive step — the handler removes every
    // group first, so a late guard would leave the account in NO group, which
    // is worse than either outcome it was choosing between.
    assert.ok(!calls.includes('AdminRemoveUserFromGroup'),
      `a group was removed before the refusal: ${calls.join(', ')}`);
  });

  console.log('\n2. with a second admin, the same moves are allowed');

  await check('one of two admins can be demoted', async () => {
    seed([['u_boss', ['admins']], ['u_two', ['admins']]]);
    const res = await handler(req('u_two', 'hosts'));
    assert.strictEqual(res.statusCode, 200, res.body);
    assert.deepStrictEqual(groupsOf('u_two'), ['hosts']);
  });

  // rejects: a guard so broad that stepping back from the role is impossible.
  // Somebody handing over is a real thing, and another admin can reverse it.
  await check('an admin may step back while another remains', async () => {
    seed([['u_boss', ['admins']], ['u_two', ['admins']]]);
    const res = await handler(req('u_boss', 'hosts', 'u_boss'));
    assert.strictEqual(res.statusCode, 200, res.body);
    assert.deepStrictEqual(groupsOf('u_boss'), ['hosts']);
  });

  console.log('\n3. nobody destroys their own account');

  for (const state of ['delete', 'disabled']) {
    // rejects: a self-inflicted state with no undo inside the product. Demotion
    // is reversible by another admin; these are not reversible by anyone but
    // AWS, so they are refused even when other admins remain.
    await check(`an admin cannot ${state === 'delete' ? 'delete' : 'disable'} themselves`, async () => {
      seed([['u_boss', ['admins']], ['u_two', ['admins']]]);
      const res = await handler(req('u_boss', state, 'u_boss'));
      assert.strictEqual(res.statusCode, 409, res.body);
      assert.match(bodyOf(res).error, /your own/i);
      assert.strictEqual(pool.has('u_boss'), true);
      assert.strictEqual(pool.get('u_boss').enabled, true);
    });
  }

  await check('but they can still act on somebody else', async () => {
    seed([['u_boss', ['admins']], ['u_two', ['admins']], ['u_host', ['hosts']]]);
    const res = await handler(req('u_host', 'disabled'));
    assert.strictEqual(res.statusCode, 200, res.body);
    assert.strictEqual(pool.get('u_host').enabled, false);
  });

  console.log('\n4. the count is right past a page boundary, and ignores disabled admins');

  // rejects: a single-page count. The stub above returns ONE admin per page, so
  // an implementation that reads only the first page sees 1 and refuses every
  // change on this screen for a pool that has plenty of admins.
  await check('three admins across three pages still allows a demotion', async () => {
    seed([['u_a', ['admins']], ['u_b', ['admins']], ['u_c', ['admins']]]);
    const res = await handler(req('u_b', 'hosts', 'u_a'));
    assert.strictEqual(res.statusCode, 200, res.body);
    assert.deepStrictEqual(groupsOf('u_b'), ['hosts']);
  });

  // rejects: counting an account that cannot sign in. A disabled admin is not a
  // way back into the platform console, so leaving one behind is the same
  // lockout this guard exists to prevent.
  await check('a DISABLED admin does not count as the one holding the door', async () => {
    seed([['u_boss', ['admins']], ['u_ghost', ['admins'], false]]);
    const res = await handler(req('u_boss', 'hosts', 'u_other'));
    assert.strictEqual(res.statusCode, 409, res.body);
    assert.match(bodyOf(res).error, /last Engage admin/i);
  });

  console.log('\n5. promoting is unaffected');

  await check('a host can be made an Engage admin', async () => {
    seed([['u_boss', ['admins']], ['u_host', ['hosts']]]);
    const res = await handler(req('u_host', 'admins'));
    assert.strictEqual(res.statusCode, 200, res.body);
    assert.deepStrictEqual(groupsOf('u_host'), ['admins']);
  });

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
