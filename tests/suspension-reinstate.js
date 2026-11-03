/**
 * SUSPEND AND REINSTATE AN ACCOUNT, END TO END THROUGH THE AUTHORIZER (#40).
 *
 * One modelled table and one modelled Cognito pool, shared by the three
 * handlers that take part: manage-users.js (staff press Suspend / Reinstate),
 * the authorizer (every request after), and list-my-orgs.js (the console
 * asking why it was refused).
 *
 *   1. Suspend keeps the account's groups, flags PROFILE, and turns Cognito off
 *   2. the authorizer then refuses the account on host and admin routes
 *   3. GET /orgs answers 403 with code ACCOUNT_SUSPENDED and provisions nothing
 *   4. the Accounts list carries the reason
 *   5. Reinstate turns Cognito on, clears the flag, keeps the groups
 *   6. ...and the authorizer admits the very next request
 *   7. a group-less account (an old Disable, a rejected applicant) comes back
 *      as pending, and says so
 *   8. the guards still stand: nobody suspends themselves
 *   9. GET /orgs for a member of a suspended org: 200, the list, and the code
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

/* ── The pool: username -> { sub, enabled, groups } ── */
const pool = new Map();
const cmd = (type) => class { constructor(i) { this.input = i; this.type = type; } };
const C = {
  ListUsersCommand: cmd('listUsers'),
  AdminListGroupsForUserCommand: cmd('listGroups'),
  AdminAddUserToGroupCommand: cmd('addToGroup'),
  AdminRemoveUserFromGroupCommand: cmd('removeFromGroup'),
  AdminDeleteUserCommand: cmd('deleteUser'),
  AdminDisableUserCommand: cmd('disableUser'),
  AdminEnableUserCommand: cmd('enableUser'),
  AdminGetUserCommand: cmd('getUser'),
  ListUsersInGroupCommand: cmd('listUsersInGroup'),
};
const userFor = (username) => {
  const u = pool.get(username) || [...pool.values()].find((x) => x.sub === username);
  if (!u) { const e = new Error('User does not exist.'); e.name = 'UserNotFoundException'; throw e; }
  return u;
};
stubs.set('@aws-sdk/client-cognito-identity-provider', {
  ...C,
  CognitoIdentityProviderClient: class {
    async send(c) {
      const i = c.input || {};
      switch (c.type) {
        case 'listUsers':
          return { Users: [...pool.entries()].map(([Username, u]) => ({
            Username, Enabled: u.enabled, UserStatus: 'CONFIRMED',
            Attributes: [{ Name: 'sub', Value: u.sub }, { Name: 'email', Value: `${Username}@x.example` }],
          })) };
        case 'listGroups': return { Groups: userFor(i.Username).groups.map((GroupName) => ({ GroupName })) };
        case 'getUser': {
          const u = userFor(i.Username);
          return { Enabled: u.enabled, UserAttributes: [{ Name: 'sub', Value: u.sub }, { Name: 'email', Value: `${i.Username}@x.example` }] };
        }
        case 'addToGroup': { const u = userFor(i.Username); if (!u.groups.includes(i.GroupName)) u.groups.push(i.GroupName); return {}; }
        case 'removeFromGroup': { const u = userFor(i.Username); u.groups = u.groups.filter((g) => g !== i.GroupName); return {}; }
        case 'disableUser': userFor(i.Username).enabled = false; return {};
        case 'enableUser': userFor(i.Username).enabled = true; return {};
        case 'listUsersInGroup':
          return { Users: [...pool.entries()].filter(([, u]) => u.groups.includes(i.GroupName)).map(([Username, u]) => ({ Username, Enabled: u.enabled })) };
        default: return {};
      }
    }
  },
});
stubs.set('jsonwebtoken', { decode: () => ({ header: { kid: 'k' } }), verify: (t) => JSON.parse(t) });
stubs.set('jwk-to-pem', () => 'pem');
stubs.set('axios', { get: async () => ({ data: { keys: [{ kid: 'k' }] } }) });

const { createPagedTable } = require('./helpers/paged-table');
const { dynamoModules } = require('./helpers/ddb-module-stub');
const table = createPagedTable({ pageSize: 50 });
const ddb = dynamoModules(table);
stubs.set('@aws-sdk/lib-dynamodb', ddb.lib);
stubs.set('@aws-sdk/client-dynamodb', ddb.client);

process.env.USER_POOL_ID = 'us-east-1_TEST';
process.env.CLIENT_ID = 'client';
process.env.REGION = 'us-east-1';
process.env.TABLE_NAME = 'engage-test-table';

const manageUsers = require(path.join(REPO, 'lambda-functions/admin/manage-users.js')).handler;
const authorize = require(path.join(REPO, 'lambda-functions/auth/authorizer.js')).handler;
const listMyOrgs = require(path.join(REPO, 'lambda-functions/admin/orgs/list-my-orgs.js')).handler;

let pass = 0, fail = 0;
const say = (s) => console.log(s);
async function check(label, fn) {
  try { await fn(); console.log(`  PASS  ${label}`); pass++; }
  catch (e) { console.log(`  FAIL  ${label}\n        ${e.message}`); fail++; }
}

const TEAM = `org_${'T'.repeat(22)}`;
const HOME = `org_${'H'.repeat(22)}`;

function reset() {
  table.store.clear();
  pool.clear();
  pool.set('staff', { sub: 'sub-staff', enabled: true, groups: ['admins'] });
  pool.set('staff2', { sub: 'sub-staff2', enabled: true, groups: ['admins'] });
  pool.set('ada', { sub: 'sub-ada', enabled: true, groups: ['hosts'] });
  table.put({ PK: 'USER#sub-ada', SK: 'PROFILE', userId: 'sub-ada', personalOrgId: HOME, defaultOrgId: HOME });
  table.put({ PK: `ORG#${HOME}`, SK: 'METADATA', orgId: HOME, name: 'Ada', type: 'personal', status: 'active' });
  table.put({ PK: `ORG#${HOME}`, SK: 'MEMBER#sub-ada', orgId: HOME, sub: 'sub-ada', role: 'owner' });
  table.put({ PK: 'USER#sub-ada', SK: `ORG#${HOME}`, orgId: HOME, role: 'owner' });
  table.put({ PK: `ORG#${TEAM}`, SK: 'METADATA', orgId: TEAM, name: 'Northwind', type: 'team', status: 'active' });
  table.put({ PK: `ORG#${TEAM}`, SK: 'MEMBER#sub-ada', orgId: TEAM, sub: 'sub-ada', role: 'member' });
  table.put({ PK: 'USER#sub-ada', SK: `ORG#${TEAM}`, orgId: TEAM, role: 'member' });
}

const staffEvent = (username, body, caller = 'staff') => ({
  requestContext: {
    http: { method: 'PUT', path: `/admin/users/${username}/state` },
    authorizer: { lambda: { username: caller, userId: pool.get(caller).sub, groups: 'admins', email: `${caller}@x.example` } },
  },
  pathParameters: { username },
  body: JSON.stringify(body),
});
const listEvent = () => ({
  requestContext: { http: { method: 'POST', path: '/admin/users/list' },
    authorizer: { lambda: { username: 'staff', userId: 'sub-staff', groups: 'admins' } } },
});
const tokenFor = (username) => JSON.stringify({ sub: pool.get(username).sub, 'cognito:username': username });
const asCaller = (username, routeKey, headers = {}) => authorize({
  routeKey,
  identitySource: [`Bearer ${tokenFor(username)}`],
  headers: { authorization: `Bearer ${tokenFor(username)}`, ...headers },
});
const handlerEvent = (context) => ({ requestContext: { http: { method: 'GET', path: '/orgs' }, authorizer: { lambda: context } } });
const body = (res) => JSON.parse(res.body || '{}');

(async () => {
  say('\n1. Suspend keeps the groups, flags PROFILE, turns Cognito off');
  reset();
  {
    const before = await asCaller('ada', 'POST /games');
    await check('ada hosts before', () => assert.strictEqual(before.isAuthorized, true));
    const res = await manageUsers(staffEvent('ada', { newState: 'disabled', reason: 'Abuse report #12' }));
    await check('Suspend answers 200', () => assert.strictEqual(res.statusCode, 200, res.body));
    await check('the hosts group is KEPT (so Reinstate can restore it)', () =>
      assert.deepStrictEqual(pool.get('ada').groups, ['hosts']));
    await check('the Cognito account is off', () => assert.strictEqual(pool.get('ada').enabled, false));
    const prof = table.get('USER#sub-ada', 'PROFILE');
    await check('PROFILE carries suspended, when, by whom and why', () => {
      assert.strictEqual(prof.suspended, true);
      assert.ok(prof.suspendedAt);
      assert.strictEqual(prof.suspendedBy, 'staff@x.example');
      assert.strictEqual(prof.suspendedReason, 'Abuse report #12');
    });
    await check('the rest of PROFILE is untouched', () => assert.strictEqual(prof.personalOrgId, HOME));
  }

  say('\n2. the authorizer refuses the suspended account (its token is still valid)');
  for (const rk of ['POST /games', 'GET /question-sets', 'POST /admin/upload-questions', 'GET /orgs/{orgId}', 'GET /me/attention']) {
    // eslint-disable-next-line no-await-in-loop
    const r = await asCaller('ada', rk);
    // eslint-disable-next-line no-await-in-loop
    await check(`refused: ${rk}`, () => assert.strictEqual(r.isAuthorized, false));
  }

  say('\n3. GET /orgs says why, and provisions nothing');
  {
    const r = await asCaller('ada', 'GET /orgs');
    await check('the authorizer admits GET /orgs with ACCOUNT_SUSPENDED', () => {
      assert.strictEqual(r.isAuthorized, true);
      assert.strictEqual(r.context.suspension, 'ACCOUNT_SUSPENDED');
    });
    const putsBefore = table.calls('put').length + table.calls('update').length;
    const res = await listMyOrgs(handlerEvent(r.context));
    await check('list-my-orgs answers 403 with code ACCOUNT_SUSPENDED', () => {
      assert.strictEqual(res.statusCode, 403);
      assert.strictEqual(body(res).code, 'ACCOUNT_SUSPENDED');
      assert.match(body(res).error, /suspended/i);
    });
    await check('and writes nothing (no personal space is provisioned)', () =>
      assert.strictEqual(table.calls('put').length + table.calls('update').length, putsBefore));
  }

  say('\n4. the Accounts list carries the reason for the Reinstate row');
  {
    const res = await manageUsers(listEvent());
    const ada = body(res).users.find((u) => u.username === 'ada');
    await check('ada reads as disabled, with her groups', () => {
      assert.strictEqual(ada.state, 'disabled'); assert.deepStrictEqual(ada.groups, ['hosts']);
    });
    await check('and the reason and time', () => {
      assert.strictEqual(ada.suspendedReason, 'Abuse report #12'); assert.ok(ada.suspendedAt);
    });
  }

  say('\n5. Reinstate is the exact inverse');
  {
    const res = await manageUsers(staffEvent('ada', { newState: 'reinstate' }));
    await check('Reinstate answers 200', () => assert.strictEqual(res.statusCode, 200, res.body));
    await check('Cognito on', () => assert.strictEqual(pool.get('ada').enabled, true));
    await check('groups as they were', () => assert.deepStrictEqual(pool.get('ada').groups, ['hosts']));
    await check('the answer names the restored role', () => {
      assert.strictEqual(body(res).state, 'hosts'); assert.deepStrictEqual(body(res).groups, ['hosts']);
    });
    const prof = table.get('USER#sub-ada', 'PROFILE');
    await check('the flag and its reason are gone; PROFILE otherwise kept', () => {
      assert.strictEqual(prof.suspended, undefined);
      assert.strictEqual(prof.suspendedReason, undefined);
      assert.strictEqual(prof.personalOrgId, HOME);
    });
    const audit = [...table.store.values()].filter((r) => r.Action === 'user.reinstate');
    await check('audited as user.reinstate (the person\'s log and the platform index)', () => assert.ok(audit.length >= 1));
  }

  say('\n6. ...and the very next request is admitted');
  {
    const r = await asCaller('ada', 'POST /games');
    await check('ada hosts again', () => assert.strictEqual(r.isAuthorized, true));
    const o = await asCaller('ada', 'GET /orgs');
    await check('GET /orgs carries no suspension', () => assert.strictEqual(o.context.suspension, ''));
  }

  say('\n7. a group-less account comes back as pending, and says so');
  {
    pool.set('old', { sub: 'sub-old', enabled: false, groups: [] });   // an old-style Disable
    const res = await manageUsers(staffEvent('old', { newState: 'reinstate' }));
    await check('Reinstate answers 200', () => assert.strictEqual(res.statusCode, 200, res.body));
    await check('the account is on, waiting for approval', () => {
      assert.strictEqual(pool.get('old').enabled, true); assert.deepStrictEqual(pool.get('old').groups, ['pending']);
    });
    await check('the message tells staff to approve it', () => assert.match(body(res).message, /approv/i));
    await check('no PROFILE row was minted by clearing a flag that was never there', () =>
      assert.strictEqual(table.get('USER#sub-old', 'PROFILE'), undefined));
  }
  {
    pool.set('applicant', { sub: 'sub-app', enabled: true, groups: ['pending'] });
    const res = await manageUsers(staffEvent('applicant', { newState: 'disabled' }));
    await check('Reject still removes the pending group (unchanged)', () => {
      assert.strictEqual(res.statusCode, 200); assert.deepStrictEqual(pool.get('applicant').groups, []);
    });
    await manageUsers(staffEvent('applicant', { newState: 'reinstate' }));
    await check('and Reinstate undoes a Reject: back in the queue', () =>
      assert.deepStrictEqual(pool.get('applicant').groups, ['pending']));
  }
  {
    pool.set('fed', { sub: 'sub-fed', enabled: true, groups: ['hosts'] });   // federated, never opened the console
    const res = await manageUsers(staffEvent('fed', { newState: 'disabled' }));
    await check('suspending an account with no PROFILE row still lands the flag', () => {
      assert.strictEqual(res.statusCode, 200, res.body);
      assert.strictEqual(table.get('USER#sub-fed', 'PROFILE').suspended, true);
    });
  }

  say('\n8. the guards still stand');
  {
    const res = await manageUsers(staffEvent('staff', { newState: 'disabled' }, 'staff'));
    await check('nobody suspends themselves', () => assert.strictEqual(res.statusCode, 409));
    await check('...and nothing was written', () => assert.strictEqual(table.get('USER#sub-staff', 'PROFILE'), undefined));
  }

  say('\n9. GET /orgs for a member of a suspended organisation');
  reset();
  {
    table.get(`ORG#${TEAM}`, 'METADATA').status = 'suspended';     // platform-orgs.js Suspend
    const refused = await asCaller('ada', 'POST /games', { 'x-engage-org': TEAM });
    await check('acting for the suspended team: refused', () => assert.strictEqual(refused.isAuthorized, false));
    const home = await asCaller('ada', 'POST /games', { 'x-engage-org': HOME });
    await check('acting for her own space: admitted', () => assert.strictEqual(home.isAuthorized, true));
    const r = await asCaller('ada', 'GET /orgs', { 'x-engage-org': TEAM });
    const res = await listMyOrgs(handlerEvent(r.context));
    const b = body(res);
    await check('200, with the list so she can go elsewhere', () => {
      assert.strictEqual(res.statusCode, 200, res.body);
      assert.deepStrictEqual(b.orgs.map((o) => o.orgId).sort(), [HOME, TEAM].sort());
    });
    await check('the list marks the team suspended', () =>
      assert.strictEqual(b.orgs.find((o) => o.orgId === TEAM).status, 'suspended'));
    await check('and the code, the org and its name', () => {
      assert.strictEqual(b.suspension.code, 'ORG_SUSPENDED');
      assert.strictEqual(b.suspension.orgId, TEAM);
      assert.strictEqual(b.suspension.orgName, 'Northwind');
    });
    table.get(`ORG#${TEAM}`, 'METADATA').status = 'active';        // platform-orgs.js Reinstate
    const back = await asCaller('ada', 'POST /games', { 'x-engage-org': TEAM });
    await check('reinstated: the team is hers again on the next request', () => assert.strictEqual(back.isAuthorized, true));
  }

  say(`\n${pass} passed, ${fail} failed`);
  suiteFinished();
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('harness error:', e); process.exit(2); });
