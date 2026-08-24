/**
 * THE AUTHORIZER HANDS EVERY HANDLER ITS TENANT, THE WAY IT ALREADY HANDS THEM
 * `userId`.
 *
 * `game/tenant.js` reads `orgId`, `orgRole` and `orgIds` out of
 * `event.requestContext.authorizer.lambda` and treats them as settled fact:
 * `canManageScope` compares `callerOrgId(event)` against the org a row belongs
 * to, and that comparison is the ONLY thing standing between two customers'
 * question sets. Nothing downstream re-derives them. So whatever this file
 * pins is the tenant boundary.
 *
 * THREE FAILURE DIRECTIONS, ALL PINNED BELOW, IN DESCENDING ORDER OF DAMAGE:
 *
 *   1. The context names an org the caller did not ask for (section 3). A
 *      write lands in the wrong tenant and nobody is told. Worst outcome
 *      available, which is why `pick-active-org.js` refuses rather than
 *      substitutes and why section 3 asserts the ID rather than just falsiness.
 *   2. A membership lookup failure DENIES the request (section 4). This
 *      function gates every authorized route, so a DynamoDB blip would become
 *      a full API outage caused by a table the authorizer did not need last
 *      week. Org resolution is an enrichment, not a second auth factor.
 *   3. The fields are absent or the wrong shape (sections 1, 2, 6). A Lambda
 *      authorizer context is a flat string map — an array in `orgIds` does not
 *      survive the trip. `groups` already comma-joins for exactly this reason
 *      and `tenant.js:callerOrgIds` splits it back.
 *
 * THE EVENT SHAPE IS THE REAL ONE, for the reason
 * tests/games-list-authorization.js records at length: `CognitoAuthorizer` is
 * a CUSTOM Lambda authorizer despite the name (payload 2.0, simple responses),
 * so it is handed `routeKey`/`identitySource`/`headers` and returns
 * `{ isAuthorized, context }`. Eighteen tests once passed green against a
 * `.jwt.claims` shape this API has never produced. Everything below drives the
 * REAL exported handler.
 */
const path = require('path');
const assert = require('assert');

const REPO = path.join(__dirname, '..');

// ---- Stubs, installed before the authorizer loads --------------------------
// Intercepted by REQUEST STRING, like games-list-authorization.js: the AWS SDK
// packages resolve from lambda-functions/auth/node_modules and we want none of
// their real network behaviour here.
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

// ---- The DynamoDB stub, which is what this file is really about ------------
// `membershipItems` is what the ORG# query returns, `profileItem` what the
// PROFILE get returns, and either can be told to throw. Every command the
// authorizer sends is recorded in `sent` so section 5 can assert the QUERY
// ITSELF — a query that scanned the wrong partition would otherwise return the
// stub's rows regardless and every other assertion here would still be green.
let membershipItems = [];
let profileItem = null;
let queryThrows = null;
let getThrows = null;
let sent = [];

class QueryCommand { constructor(input) { this.kind = 'query'; this.input = input; } }
class GetCommand { constructor(input) { this.kind = 'get'; this.input = input; } }

stubs.set('@aws-sdk/client-dynamodb', { DynamoDBClient: class {} });
stubs.set('@aws-sdk/lib-dynamodb', {
  QueryCommand,
  GetCommand,
  DynamoDBDocumentClient: {
    from: () => ({
      async send(command) {
        sent.push(command);
        if (command.kind === 'query') {
          if (queryThrows) throw queryThrows;
          return { Items: membershipItems };
        }
        if (getThrows) throw getThrows;
        return { Item: profileItem };
      },
    }),
  },
});

process.env.USER_POOL_ID = 'us-east-1_TEST';
process.env.CLIENT_ID = 'test-client-id';
process.env.REGION = 'us-east-1';
// Set BEFORE the require: authorizer.js reads TABLE_NAME at module load, the
// same way every other lambda in this repo does.
process.env.TABLE_NAME = 'engage-test-table';

const { handler } = require(path.join(REPO, 'lambda-functions/auth/authorizer.js'));

// ---- Tiny harness ----------------------------------------------------------
let pass = 0, fail = 0;
const say = (s) => console.log(s);
async function check(label, fn) {
  try { await fn(); console.log(`  PASS  ${label}`); pass++; }
  catch (e) { console.log(`  FAIL  ${label}\n        ${e.message}`); fail++; }
}

const SUB = 'user-sub-1';

/** A real payload-2.0 REQUEST authorizer event. */
const authEvent = (routeKey, headers = {}) => {
  const token = JSON.stringify({
    sub: SUB, 'cognito:username': 'ada', email: 'ada@example.invalid',
  });
  const rawPath = routeKey.split(' ')[1];
  return {
    version: '2.0',
    type: 'REQUEST',
    routeKey,
    rawPath,
    identitySource: [`Bearer ${token}`],
    headers: { authorization: `Bearer ${token}`, ...headers },
    requestContext: { routeKey, http: { method: routeKey.split(' ')[0], path: rawPath } },
  };
};

/**
 * Drive the real handler with a given world. Resets every stub first so one
 * scenario cannot leak its memberships into the next and quietly pass.
 */
async function authorize({
  groups = ['hosts'], memberships = [], profile = null,
  headers = {}, routeKey = 'GET /games', throwOnQuery = null, throwOnGet = null,
} = {}) {
  userGroups = groups;
  membershipItems = memberships;
  profileItem = profile;
  queryThrows = throwOnQuery;
  getThrows = throwOnGet;
  sent = [];
  return handler(authEvent(routeKey, headers));
}

const ACME = { PK: `USER#${SUB}`, SK: 'ORG#org_acme', orgId: 'org_acme', role: 'owner' };
const NW = { PK: `USER#${SUB}`, SK: 'ORG#org_northwind', orgId: 'org_northwind', role: 'member' };

(async () => {
  // ------------------------------------------------------------------------
  say('\n1. the context carries the org, alongside the fields it always carried');
  // REJECTS: resolving the org and then forgetting to put it in the returned
  // context — the resolution runs, the logs look right, and every handler sees
  // a blank org.

  {
    const res = await authorize({ memberships: [ACME] });
    await check('a caller with one membership gets that orgId', () =>
      assert.strictEqual(res.context.orgId, 'org_acme'));
    await check('and the role FROM THE MEMBERSHIP ROW', () =>
      assert.strictEqual(res.context.orgRole, 'owner',
        'orgRole is what roleAtLeast gates every org write on'));

    // REJECTS: overwriting `role` (the Cognito custom:role, defaulting to
    // 'host') with the org role, or vice versa. They are different fields with
    // different vocabularies — 'host' is not an ORG_ROLE and 'owner' is not a
    // product role — and collapsing them would make roleAtLeast read 'host'.
    await check('the Cognito `role` field is untouched by any of this', () =>
      assert.strictEqual(res.context.role, 'host'));
    await check('and `groups` is still comma-joined as it was', () =>
      assert.strictEqual(res.context.groups, 'hosts'));
    await check('userId is still the sub', () =>
      assert.strictEqual(res.context.userId, SUB));
  }

  // ------------------------------------------------------------------------
  say('\n2. orgIds is a COMMA-JOINED STRING of every membership');
  // REJECTS: putting an array in the context. A Lambda authorizer context is a
  // flat map of strings; an array arrives at the handler in a shape nobody
  // agreed on, or not at all. `groups` comma-joins for the same reason and
  // tenant.js:callerOrgIds splits this back.

  {
    const res = await authorize({ memberships: [ACME, NW], headers: { 'x-engage-org': 'org_acme' } });
    await check('orgIds names both organisations', () =>
      assert.strictEqual(res.context.orgIds, 'org_acme,org_northwind'));
    await check('and it is a string, not an array', () =>
      assert.strictEqual(typeof res.context.orgIds, 'string',
        'an array does not survive the authorizer context'));

    // REJECTS: deriving orgIds from the ACTIVE org rather than from every
    // membership. They answer different questions — "may this caller switch to
    // X" is not "is this caller acting for X right now" — and collapsing them
    // would either hide the picker's other options or, far worse, invite a row
    // guard to accept any org in the list.
    await check('orgIds is every membership, not just the active one', () =>
      assert.ok(res.context.orgIds.split(',').length === 2 && res.context.orgId === 'org_acme'));
  }

  // ------------------------------------------------------------------------
  say('\n3. the x-engage-org header — honoured, or refused, never substituted');
  // REJECTS: reading the header with a capital (`X-Engage-Org`). HTTP API
  // lowercases header names, so the capitalised form is always undefined and
  // the caller's choice is silently ignored — which lands them on their
  // default org while the UI shows the one they picked.

  {
    const res = await authorize({
      memberships: [ACME, NW], headers: { 'x-engage-org': 'org_northwind' },
    });
    await check('a requested org the caller belongs to is the active one', () =>
      assert.strictEqual(res.context.orgId, 'org_northwind'));
    await check('with that membership\'s role', () =>
      assert.strictEqual(res.context.orgRole, 'member'));
  }

  // THE ONE THAT MATTERS. Asserts the ID, not merely falsiness: if the guard
  // is removed the failure message names the org the caller was silently
  // switched to, which is the incident, not "expected '' got truthy".
  {
    const res = await authorize({
      memberships: [ACME], headers: { 'x-engage-org': 'org_globex' },
    });
    await check('an org the caller is NOT in yields NO org — not their other one', () =>
      assert.strictEqual(res.context.orgId, '',
        `asked for org_globex, acted for ${res.context.orgId} — silent tenant swap`));
    await check('and no role with it', () =>
      assert.strictEqual(res.context.orgRole, ''));

    // REJECTS: blanking orgIds along with orgId on a refused request. The
    // caller's memberships are still true; only the ACTIVE org is unresolved,
    // and a picker needs the list in order to offer the correction.
    await check('but the memberships are still reported', () =>
      assert.strictEqual(res.context.orgIds, 'org_acme'));

    // REJECTS: turning an unresolvable org into a denial. The header is
    // attacker-controllable and a 401 from the authorizer is indistinguishable
    // from an expired session in the client, which logs the user out.
    await check('the request is still AUTHORIZED — the org is enrichment, not auth', () =>
      assert.strictEqual(res.isAuthorized, true));
  }

  // ------------------------------------------------------------------------
  say('\n4. a membership failure NEVER denies — it resolves to no org');
  // REJECTS: letting the DynamoDB call throw out of the handler, where the
  // outer catch turns it into `{ isAuthorized: false }`. That is a full API
  // outage — every authorized route, for every caller — caused by a table this
  // authorizer did not read at all last week.

  {
    const res = await authorize({
      memberships: [ACME], throwOnQuery: new Error('ProvisionedThroughputExceeded'),
    });
    await check('a throwing membership query still authorizes', () =>
      assert.strictEqual(res.isAuthorized, true,
        'a DynamoDB blip just took down every authorized route'));
    await check('and yields a blank orgId', () =>
      assert.strictEqual(res.context.orgId, ''));
    await check('and a blank orgIds, not undefined', () =>
      assert.strictEqual(res.context.orgIds, '',
        'undefined in a context field is not a string — handlers read it back as garbage'));
  }

  {
    const res = await authorize({ memberships: [ACME], throwOnGet: new Error('boom') });
    await check('a throwing PROFILE read does not lose the membership either', () =>
      assert.strictEqual(res.context.orgId, 'org_acme',
        'the default-org lookup is a tie-break; failing it must not erase a real membership'));
  }

  // REJECTS: treating "no memberships" as an error state. A host who has not
  // joined a team yet is ordinary, and platform/public content is readable
  // without an org — that is the whole existing product.
  {
    const res = await authorize({ memberships: [] });
    await check('a caller with no org at all is authorized', () =>
      assert.strictEqual(res.isAuthorized, true));
    await check('with blank org fields, all strings', () =>
      assert.deepStrictEqual(
        { orgId: res.context.orgId, orgRole: res.context.orgRole, orgIds: res.context.orgIds },
        { orgId: '', orgRole: '', orgIds: '' }));
  }

  // ------------------------------------------------------------------------
  say('\n5. the query itself — the right partition, the right prefix');
  // REJECTS: querying the wrong PK, dropping the begins_with, or reading a
  // different SK prefix. The stub answers ANY query with the same rows, so
  // every assertion above would stay green while the live authorizer scanned
  // some other user's partition — or the whole table. Only this section can
  // see that.

  {
    await authorize({ memberships: [ACME], profile: { defaultOrgId: 'org_acme' } });
    const query = sent.find((c) => c.kind === 'query');
    await check('a membership query was sent', () => assert.ok(query));
    await check('against the configured table', () =>
      assert.strictEqual(query.input.TableName, 'engage-test-table'));
    await check("on PK = USER#<sub> — this caller's partition only", () =>
      assert.strictEqual(query.input.ExpressionAttributeValues[':pk'], `USER#${SUB}`));
    await check("with begins_with(SK, 'ORG#')", () => {
      assert.ok(/begins_with\(SK,\s*:sk\)/.test(query.input.KeyConditionExpression),
        query.input.KeyConditionExpression);
      assert.strictEqual(query.input.ExpressionAttributeValues[':sk'], 'ORG#');
    });

    const get = sent.find((c) => c.kind === 'get');
    await check('and the PROFILE row is read by its exact key', () =>
      assert.deepStrictEqual(get.input.Key, { PK: `USER#${SUB}`, SK: 'PROFILE' }));
  }

  // REJECTS: reading the org before the group gate, which spends two table
  // reads on every refused request — including the unauthenticated flood a
  // public endpoint attracts.
  {
    const res = await authorize({ groups: ['pending'], memberships: [ACME], routeKey: 'GET /games' });
    await check('a refused caller is still refused', () =>
      assert.strictEqual(res.isAuthorized, false));
    await check('and cost no table reads', () =>
      assert.strictEqual(sent.length, 0,
        'the org lookup runs before the group gate — refused requests pay for it'));
  }

  // ------------------------------------------------------------------------
  say('\n6. defaultOrgId on the PROFILE row breaks a tie, and only a real one');
  // REJECTS: never reading the PROFILE row. With two memberships and no
  // header, nothing else can resolve an active org, so this is the only
  // assertion that proves the second read happens at all.

  {
    const res = await authorize({ memberships: [ACME, NW], profile: { defaultOrgId: 'org_northwind' } });
    await check('the default picks between two memberships', () =>
      assert.strictEqual(res.context.orgId, 'org_northwind'));
  }

  // REJECTS: trusting defaultOrgId without checking membership. The PROFILE
  // row outlives a membership row — remove someone from an org and a stale
  // default would hand them that org's context straight back.
  {
    const res = await authorize({ memberships: [ACME, NW], profile: { defaultOrgId: 'org_globex' } });
    await check('a stale default resolves to no org rather than to itself', () =>
      assert.strictEqual(res.context.orgId, '',
        `a removed org came back as ${res.context.orgId}`));
  }

  // REJECTS: letting an explicit header lose to the stored default. The header
  // is the caller's live choice; the default is a preference from last week.
  {
    const res = await authorize({
      memberships: [ACME, NW],
      profile: { defaultOrgId: 'org_northwind' },
      headers: { 'x-engage-org': 'org_acme' },
    });
    await check('an explicit header beats the stored default', () =>
      assert.strictEqual(res.context.orgId, 'org_acme'));
  }

  say(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('harness error:', e); process.exit(2); });
