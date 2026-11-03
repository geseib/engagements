/**
 * SUSPENSION IS ENFORCED, AT THE AUTHORIZER (#40, #43).
 *
 * Suspend used to ask for a reason, audit it, write `status: 'suspended'` —
 * and nothing read it, so the members of a suspended organisation and a
 * suspended account carried on working. auth/standing.js is now the one choke
 * point for signed-in callers; this file drives the REAL authorizer handler
 * (payload 2.0, simple responses) against a modelled table and pins:
 *
 *   1. the pure decision table (standing.js)
 *   2. a suspended ACCOUNT is refused on host routes AND staff routes
 *   3. ...and admitted to GET /orgs alone, carrying ACCOUNT_SUSPENDED
 *   4. a suspended ORG's members are refused acting for it, on every route kind
 *   5. ...but keep their other organisations, minus the suspended one in orgIds
 *   6. other organisations are unaffected
 *   7. Engage staff keep the staff routes (Reinstate) while standing in it
 *   8. reinstating restores access on the very next request (no cache)
 *   9. a failed standing read does not deny (outage rule)
 *  10. the Build Room session key closes with the org or the minter
 *  11. caching stays off in the template (ReauthorizeEvery: 0)
 *  12. GET /orgs answers the codes, with the same spelling as standing.js
 */
const suiteFinished = require('./helpers/finish-guard');
const path = require('path');
const fs = require('fs');
const assert = require('assert');

const REPO = path.join(__dirname, '..');

// ---- Stubs, installed before the authorizer loads --------------------------
const Module = require('module');
const stubs = new Map();
const realLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (stubs.has(request)) return stubs.get(request);
  return realLoad.call(this, request, parent, isMain);
};

let userGroups = [];
stubs.set('@aws-sdk/client-cognito-identity-provider', {
  CognitoIdentityProviderClient: class {
    async send() { return { Groups: userGroups.map((GroupName) => ({ GroupName })) }; }
  },
  AdminListGroupsForUserCommand: class { constructor(i) { this.input = i; } },
});
stubs.set('jsonwebtoken', {
  decode: () => ({ header: { kid: 'test-kid' } }),
  verify: (token) => JSON.parse(token),
});
stubs.set('jwk-to-pem', () => 'stub-pem');
stubs.set('axios', { get: async () => ({ data: { keys: [{ kid: 'test-kid' }] } }) });

/* A keyed table: `rows` maps "PK|SK" to an item. Query answers begins_with on
   SK within one PK. `failGets` makes every GetItem throw (section 9). */
let rows = new Map();
let failGets = false;
const keyOf = (k) => `${k.PK}|${k.SK}`;
class QueryCommand { constructor(input) { this.kind = 'query'; this.input = input; } }
class GetCommand { constructor(input) { this.kind = 'get'; this.input = input; } }
stubs.set('@aws-sdk/client-dynamodb', { DynamoDBClient: class {} });
stubs.set('@aws-sdk/lib-dynamodb', {
  QueryCommand,
  GetCommand,
  DynamoDBDocumentClient: {
    from: () => ({
      async send(command) {
        if (command.kind === 'query') {
          const v = command.input.ExpressionAttributeValues;
          return { Items: [...rows.values()].filter((r) => r.PK === v[':pk'] && String(r.SK).startsWith(v[':sk'])) };
        }
        if (failGets) throw new Error('ProvisionedThroughputExceededException');
        return { Item: rows.get(keyOf(command.input.Key)) };
      },
    }),
  },
});

process.env.USER_POOL_ID = 'us-east-1_TEST';
process.env.CLIENT_ID = 'test-client-id';
process.env.REGION = 'us-east-1';
process.env.TABLE_NAME = 'engage-test-table';

const authorizer = require(path.join(REPO, 'lambda-functions/auth/authorizer.js'));
const standing = require(path.join(REPO, 'lambda-functions/auth/standing.js'));
const { handler } = authorizer;

let pass = 0, fail = 0;
const say = (s) => console.log(s);
async function check(label, fn) {
  try { await fn(); console.log(`  PASS  ${label}`); pass++; }
  catch (e) { console.log(`  FAIL  ${label}\n        ${e.message}`); fail++; }
}

const SUB = 'sub-ada';
const authEvent = (routeKey, headers = {}, pathParameters = undefined) => {
  const token = JSON.stringify({ sub: SUB, 'cognito:username': 'ada', email: 'ada@example.invalid' });
  const rawPath = routeKey.split(' ')[1];
  return {
    version: '2.0', type: 'REQUEST', routeKey, rawPath,
    identitySource: [`Bearer ${token}`],
    headers: { authorization: `Bearer ${token}`, ...headers },
    pathParameters,
    requestContext: { routeKey, http: { method: routeKey.split(' ')[0], path: rawPath } },
  };
};

const TEAM = 'org_Team1';
const HOME = 'org_Home1';
const OTHER = 'org_Other1';
function world({ groups = ['hosts'], accountSuspended = false, teamStatus = 'active', otherStatus = 'active', memberships = [TEAM, HOME] } = {}) {
  userGroups = groups;
  failGets = false;
  rows = new Map();
  const put = (item) => rows.set(keyOf(item), item);
  put({ PK: `USER#${SUB}`, SK: 'PROFILE', defaultOrgId: HOME, ...(accountSuspended ? { suspended: true, suspendedReason: 'abuse' } : {}) });
  for (const orgId of memberships) {
    put({ PK: `USER#${SUB}`, SK: `ORG#${orgId}`, orgId, role: orgId === HOME ? 'owner' : 'member' });
  }
  put({ PK: `ORG#${TEAM}`, SK: 'METADATA', orgId: TEAM, status: teamStatus });
  put({ PK: `ORG#${HOME}`, SK: 'METADATA', orgId: HOME, status: 'active', type: 'personal' });
  put({ PK: `ORG#${OTHER}`, SK: 'METADATA', orgId: OTHER, status: otherStatus });
}
const asTeam = { 'x-engage-org': TEAM };

const HOST_ROUTES = [
  'POST /games',                              // create a session
  'GET /games',                               // the sessions list
  'GET /question-sets',                       // sets
  'POST /admin/upload-questions',             // a host's /admin route
  'GET /games/{gameId}/report',               // reports
  'GET /orgs/{orgId}',                        // the org's own settings
  'POST /events',                             // events
];
const STAFF_ROUTES = [
  'PUT /platform/orgs/{orgId}/status',        // Reinstate an org
  'PUT /admin/users/{username}/state',        // Reinstate an account
  'GET /platform/orgs',
];

(async () => {
  say('\n1. the decision table (standing.js, pure)');
  {
    const d = (over) => standing.decideStanding({
      accountSuspended: false, suspendedOrgIds: [], active: { orgId: TEAM, role: 'member' },
      memberships: [{ orgId: TEAM }, { orgId: HOME }], groups: ['hosts'], requiredGroups: ['hosts', 'admins'],
      method: 'POST', path: 'games', ...over,
    });
    await check('good standing: admitted, nothing set', () => {
      const r = d({});
      assert.strictEqual(r.refuse, ''); assert.strictEqual(r.suspension, ''); assert.strictEqual(r.orgIds, `${TEAM},${HOME}`);
    });
    await check('suspended account: refused ACCOUNT_SUSPENDED', () =>
      assert.strictEqual(d({ accountSuspended: true }).refuse, 'ACCOUNT_SUSPENDED'));
    await check('suspended account on the standing route: admitted with the code and no org', () => {
      const r = d({ accountSuspended: true, method: 'GET', path: 'orgs' });
      assert.strictEqual(r.refuse, ''); assert.strictEqual(r.suspension, 'ACCOUNT_SUSPENDED');
      assert.strictEqual(r.orgId, ''); assert.strictEqual(r.orgIds, '');
    });
    await check('suspended account is refused even on a staff route, as staff', () =>
      assert.strictEqual(d({ accountSuspended: true, groups: ['admins'], requiredGroups: ['admins'] }).refuse, 'ACCOUNT_SUSPENDED'));
    await check('acting for a suspended org: refused ORG_SUSPENDED', () =>
      assert.strictEqual(d({ suspendedOrgIds: [TEAM] }).refuse, 'ORG_SUSPENDED'));
    await check('staff on a staff route in a suspended org: admitted', () =>
      assert.strictEqual(d({ suspendedOrgIds: [TEAM], groups: ['admins'], requiredGroups: ['admins'] }).refuse, ''));
    await check('staff on a HOST route in a suspended org: refused (staff is not membership)', () =>
      assert.strictEqual(d({ suspendedOrgIds: [TEAM], groups: ['admins'] }).refuse, 'ORG_SUSPENDED'));
    await check('acting elsewhere: admitted, the suspended org left out of orgIds', () => {
      const r = d({ suspendedOrgIds: [TEAM], active: { orgId: HOME, role: 'owner' } });
      assert.strictEqual(r.refuse, ''); assert.strictEqual(r.orgIds, HOME);
    });
  }

  say('\n2. a suspended ACCOUNT is refused on host and staff routes');
  for (const routeKey of HOST_ROUTES) {
    world({ accountSuspended: true });
    // eslint-disable-next-line no-await-in-loop
    const res = await handler(authEvent(routeKey));
    // eslint-disable-next-line no-await-in-loop
    await check(`refused: ${routeKey}`, () => assert.strictEqual(res.isAuthorized, false));
  }
  for (const routeKey of STAFF_ROUTES) {
    world({ accountSuspended: true, groups: ['admins'] });
    // eslint-disable-next-line no-await-in-loop
    const res = await handler(authEvent(routeKey));
    // eslint-disable-next-line no-await-in-loop
    await check(`refused even as Engage staff: ${routeKey}`, () => assert.strictEqual(res.isAuthorized, false));
  }

  say('\n3. ...and admitted to GET /orgs alone, to learn why');
  {
    world({ accountSuspended: true });
    const res = await handler(authEvent('GET /orgs'));
    await check('admitted', () => assert.strictEqual(res.isAuthorized, true));
    await check('carrying ACCOUNT_SUSPENDED', () => assert.strictEqual(res.context.suspension, 'ACCOUNT_SUSPENDED'));
    await check('and no organisation to act for', () => {
      assert.strictEqual(res.context.orgId, ''); assert.strictEqual(res.context.orgIds, '');
    });
    const notif = await handler(authEvent('GET /me/notifications/{proxy+}'));
    await check('the bell, beside it on the same function, is still refused', () => assert.strictEqual(notif.isAuthorized, false));
  }

  say('\n4. a suspended ORG\'s members are refused acting for it');
  for (const routeKey of HOST_ROUTES) {
    world({ teamStatus: 'suspended' });
    // eslint-disable-next-line no-await-in-loop
    const res = await handler(authEvent(routeKey, asTeam));
    // eslint-disable-next-line no-await-in-loop
    await check(`refused: ${routeKey}`, () => assert.strictEqual(res.isAuthorized, false));
  }
  {
    world({ teamStatus: 'suspended', memberships: [TEAM] });
    const res = await handler(authEvent('POST /games'));
    await check('a member whose ONLY org is suspended is refused with no header too', () =>
      assert.strictEqual(res.isAuthorized, false));
    world({ teamStatus: 'suspended' });
    const st = await handler(authEvent('GET /orgs', asTeam));
    await check('GET /orgs admitted, carrying ORG_SUSPENDED and which org', () => {
      assert.strictEqual(st.isAuthorized, true);
      assert.strictEqual(st.context.suspension, 'ORG_SUSPENDED');
      assert.strictEqual(st.context.suspendedOrgId, TEAM);
      assert.strictEqual(st.context.orgId, '');
    });
  }

  say('\n5. ...but keep their other organisations');
  {
    world({ teamStatus: 'suspended' });
    const res = await handler(authEvent('POST /games', { 'x-engage-org': HOME }));
    await check('acting for the personal space: admitted', () => assert.strictEqual(res.isAuthorized, true));
    await check('orgId is the personal space', () => assert.strictEqual(res.context.orgId, HOME));
    await check('the suspended team is NOT in orgIds (callerMayDriveSession cannot reach it)', () =>
      assert.strictEqual(res.context.orgIds, HOME));
    await check('and no suspension is reported off the standing route', () =>
      assert.strictEqual(res.context.suspension, ''));
  }

  say('\n6. other organisations are unaffected');
  {
    world({ teamStatus: 'active', otherStatus: 'suspended' });
    const res = await handler(authEvent('POST /games', asTeam));
    await check('a member of an active team is admitted while another org is suspended', () =>
      assert.strictEqual(res.isAuthorized, true));
    await check('with every membership in orgIds', () => assert.strictEqual(res.context.orgIds, `${TEAM},${HOME}`));
  }

  say('\n7. Engage staff keep the staff routes, so they can reinstate');
  for (const routeKey of STAFF_ROUTES) {
    world({ groups: ['admins'], teamStatus: 'suspended' });
    // eslint-disable-next-line no-await-in-loop
    const res = await handler(authEvent(routeKey, asTeam));
    // eslint-disable-next-line no-await-in-loop
    await check(`admitted while standing in the suspended org: ${routeKey}`, () => assert.strictEqual(res.isAuthorized, true));
  }
  {
    world({ groups: ['admins'], teamStatus: 'suspended' });
    const res = await handler(authEvent('POST /games', asTeam));
    await check('...but not a HOST route acting for it', () => assert.strictEqual(res.isAuthorized, false));
  }

  say('\n8. reinstating restores access on the very next request');
  {
    world({ teamStatus: 'suspended' });
    const before = await handler(authEvent('POST /games', asTeam));
    rows.get(`ORG#${TEAM}|METADATA`).status = 'active';     // platform-orgs.js Reinstate
    const after = await handler(authEvent('POST /games', asTeam));
    await check('org: refused, then admitted with no wait', () => {
      assert.strictEqual(before.isAuthorized, false); assert.strictEqual(after.isAuthorized, true);
    });
    world({ accountSuspended: true });
    const b2 = await handler(authEvent('POST /games', asTeam));
    delete rows.get(`USER#${SUB}|PROFILE`).suspended;       // manage-users.js Reinstate
    const a2 = await handler(authEvent('POST /games', asTeam));
    await check('account: refused, then admitted with no wait', () => {
      assert.strictEqual(b2.isAuthorized, false); assert.strictEqual(a2.isAuthorized, true);
    });
    world({});
    const live = await handler(authEvent('POST /games', asTeam));
    rows.get(`ORG#${TEAM}|METADATA`).status = 'suspended';
    const cut = await handler(authEvent('POST /games', asTeam));
    await check('and a suspension cuts off a caller who was working a moment ago', () => {
      assert.strictEqual(live.isAuthorized, true); assert.strictEqual(cut.isAuthorized, false);
    });
  }

  say('\n9. a failed standing read does not deny');
  {
    world({ teamStatus: 'suspended' });
    failGets = true;
    const res = await handler(authEvent('POST /games', asTeam));
    await check('a throttled table reads as good standing (outage rule, logged)', () =>
      assert.strictEqual(res.isAuthorized, true));
    failGets = false;
  }

  say('\n10. the Build Room session key closes with the org, or with its minter');
  {
    const crypto = require('crypto');
    const token = `eng_4321_${'A'.repeat(43)}`;
    const hash = crypto.createHash('sha256').update(token).digest('hex');
    const keyEvent = {
      routeKey: 'GET /games/{gameId}/build/{proxy+}',
      identitySource: [`Bearer ${token}`],
      headers: { authorization: `Bearer ${token}` },
      pathParameters: { gameId: '4321' },
    };
    const seedKey = (teamStatus, minterSuspended) => {
      world({ teamStatus, accountSuspended: minterSuspended });
      rows.set(`GAME#4321|BUILD#KEY#${hash}`, { PK: 'GAME#4321', SK: `BUILD#KEY#${hash}`, MintedBy: SUB, Role: 'host' });
      rows.set('GAME#4321|METADATA', { PK: 'GAME#4321', SK: 'METADATA', orgId: TEAM, GameType: 'build' });
    };
    seedKey('active', false);
    const ok = await handler(keyEvent);
    await check('a good key on an active org: admitted', () => assert.strictEqual(ok.isAuthorized, true));
    seedKey('suspended', false);
    const org = await handler(keyEvent);
    await check('the session\'s org suspended: refused', () => assert.strictEqual(org.isAuthorized, false));
    seedKey('active', true);
    const minter = await handler(keyEvent);
    await check('the minting host suspended: refused', () => assert.strictEqual(minter.isAuthorized, false));
  }

  say('\n11. authorizer caching stays OFF, so a suspension bites on the next request');
  {
    const template = fs.readFileSync(path.join(REPO, 'template-clean.yaml'), 'utf8');
    const start = template.indexOf('CognitoAuthorizer:');
    const block = template.slice(start, template.indexOf('\n      Tags:', start)).replace(/^\s*#.*$/gm, '');
    await check('ReauthorizeEvery is pinned to 0', () => assert.match(block, /ReauthorizeEvery:\s*0\s*$/m));
    await check('no TTL above 0 anywhere in the block', () =>
      assert.ok(!/(ReauthorizeEvery|AuthorizerResultTtlInSeconds):\s*[1-9]/.test(block)));
    const src = fs.readFileSync(path.join(REPO, 'lambda-functions/auth/authorizer.js'), 'utf8');
    await check('the authorizer keeps no in-memory copy of a standing', () =>
      assert.ok(!/standingCache|suspendedCache/.test(src)));
  }

  say('\n12. GET /orgs answers the codes standing.js names');
  {
    const src = fs.readFileSync(path.join(REPO, 'lambda-functions/admin/orgs/list-my-orgs.js'), 'utf8');
    await check('list-my-orgs spells ACCOUNT_SUSPENDED as standing.js does', () =>
      assert.ok(src.includes(`'${standing.CODES.ACCOUNT}'`)));
    await check('list-my-orgs spells ORG_SUSPENDED as standing.js does', () =>
      assert.ok(src.includes(`'${standing.CODES.ORG}'`)));
    await check('the standing route is GET orgs', () => assert.strictEqual(standing.STANDING_ROUTE, 'GET orgs'));
  }

  say(`\n${pass} passed, ${fail} failed`);
  suiteFinished();
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('harness error:', e); process.exit(2); });
