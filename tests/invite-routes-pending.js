/**
 * A PERSON STILL WAITING FOR APPROVAL CAN SEE AND ACCEPT A TEAM INVITATION,
 * AND NOTHING ELSE (owner, 2026-10-10: docs/design/pending-invite-notice).
 *
 * The two invite routes — `GET /invites` and `POST /invites/{token}/accept` —
 * now let the `pending` group knock. Accepting joins the team; it does NOT
 * approve hosting (no Cognito group changes). Every other host route still
 * refuses a pending account.
 *
 * `pending` is anyone who has signed up, so the handler checks carry the whole
 * weight. This file pins them where they bite:
 *
 *   1. The authorizer, driven through its REAL handler: pending gets in on the
 *      two invite routes and is refused on a representative set of host routes.
 *   2. The address an invitation is matched against is the VERIFIED one.
 *      Cognito lets a signed-in user change their own `email` attribute; the
 *      new value rides in the next ID token with `email_verified: false`. An
 *      unapproved account could otherwise set its email to someone else's
 *      address and accept that person's invitation. So the authorizer reports
 *      `emailVerified`, and both invite handlers ignore an unverified address.
 *      A federated (Google) sign-in carries `identities` and its address comes
 *      from Google, so it counts as verified.
 *   3. The handlers: someone else's invitation is refused, an unverified
 *      address is refused, an expired one is 410, and a used one is gone.
 */
const suiteFinished = require('./helpers/finish-guard');
const path = require('path');
const assert = require('assert');
const Module = require('module');

const REPO = path.join(__dirname, '..');

// ---- Stubs, installed before anything loads ---------------------------------
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

// One in-memory table serves both the authorizer and the org handlers.
const table = new Map();
const k = (key) => `${key.PK}|${key.SK}`;
class GetCommand { constructor(input) { this.kind = 'get'; this.input = input; } }
class QueryCommand { constructor(input) { this.kind = 'query'; this.input = input; } }
class PutCommand { constructor(input) { this.kind = 'put'; this.input = input; } }
class UpdateCommand { constructor(input) { this.kind = 'update'; this.input = input; } }
class DeleteCommand { constructor(input) { this.kind = 'delete'; this.input = input; } }
class TransactWriteCommand { constructor(input) { this.kind = 'tx'; this.input = input; } }
class TransactionCanceledException extends Error { constructor() { super('cancelled'); this.name = 'TransactionCanceledException'; } }
const doc = {
  async send(cmd) {
    const i = cmd.input;
    if (cmd.kind === 'get') return { Item: table.get(k(i.Key)) };
    if (cmd.kind === 'query') {
      const pk = i.ExpressionAttributeValues[':pk'];
      const prefix = Object.entries(i.ExpressionAttributeValues).find(([n]) => n !== ':pk');
      const items = [...table.values()].filter((it) => it.PK === pk
        && (!prefix || String(it.SK).startsWith(prefix[1])));
      return { Items: items };
    }
    if (cmd.kind === 'tx') {
      for (const t of i.TransactItems) {
        if (t.Delete && t.Delete.ConditionExpression && !table.has(k(t.Delete.Key))) throw new TransactionCanceledException();
        if (t.Put && t.Put.ConditionExpression && table.has(k(t.Put.Item))) throw new TransactionCanceledException();
      }
      for (const t of i.TransactItems) {
        if (t.Put) table.set(k(t.Put.Item), { ...t.Put.Item });
        if (t.Delete) table.delete(k(t.Delete.Key));
        if (t.Update) table.set(k(t.Update.Key), { ...(table.get(k(t.Update.Key)) || t.Update.Key) });
      }
      return {};
    }
    return {};
  },
};
stubs.set('@aws-sdk/client-dynamodb', { DynamoDBClient: class {} });
stubs.set('@aws-sdk/lib-dynamodb', {
  GetCommand, QueryCommand, PutCommand, UpdateCommand, DeleteCommand, TransactWriteCommand,
  DynamoDBDocumentClient: { from: () => doc },
});

process.env.USER_POOL_ID = 'us-east-1_TEST';
process.env.CLIENT_ID = 'test-client-id';
process.env.REGION = 'us-east-1';
process.env.TABLE_NAME = 'engage-test-table';

const { handler: authorize } = require(path.join(REPO, 'lambda-functions/auth/authorizer.js'));
const ORGS = path.join(REPO, 'lambda-functions/admin/orgs');
const acceptInvite = require(path.join(ORGS, 'accept-invite.js')).handler;
const listMyInvites = require(path.join(ORGS, 'list-my-invites.js')).handler;
const G = require(path.join(ORGS, 'shared/org-guards.js'));
const tenant = require(path.join(REPO, 'lambda-functions/admin/shared/tenant.js'));

let pass = 0, fail = 0;
async function check(label, fn) {
  try { await fn(); console.log(`  PASS  ${label}`); pass++; }
  catch (e) { console.log(`  FAIL  ${label}\n        ${e.message}`); fail++; }
}

const TOKEN_FOR = (claims) => JSON.stringify({
  sub: 'u_dev', 'cognito:username': 'dev', email: 'dev@x.example', ...claims,
});
function authEvent(routeKey, claims = {}) {
  const token = TOKEN_FOR(claims);
  const rawPath = routeKey.split(' ')[1];
  return {
    version: '2.0', type: 'REQUEST', routeKey, rawPath,
    identitySource: [`Bearer ${token}`],
    headers: { authorization: `Bearer ${token}` },
    requestContext: { routeKey, http: { method: routeKey.split(' ')[0], path: rawPath } },
  };
}
async function knock(routeKey, groups, claims = { email_verified: true }) {
  userGroups = groups;
  return authorize(authEvent(routeKey, claims));
}

const ORG = 'org_9xK4Fq7Pz2mNbVc8dQwLxR';
function seedInvite(email, { daysLeft = 9, tokenTail = 'a' } = {}) {
  const token = `${ORG}.${tokenTail.repeat(32)}`;
  const expiresAt = new Date(Date.now() + daysLeft * 86400000).toISOString();
  const row = { orgId: ORG, token, email, role: 'member', orgName: 'Northwind Learning', invitedByEmail: 'jonah@x.example', expiresAt };
  table.set(k({ PK: tenant.orgPk(ORG), SK: G.inviteSk(token) }), { PK: tenant.orgPk(ORG), SK: G.inviteSk(token), ...row });
  table.set(k({ PK: G.inviteePk(email), SK: G.inviteSk(token) }), { PK: G.inviteePk(email), SK: G.inviteSk(token), ...row });
  table.set(k({ PK: tenant.orgPk(ORG), SK: 'METADATA' }), { PK: tenant.orgPk(ORG), SK: 'METADATA', orgId: ORG, name: 'Northwind Learning', type: 'team' });
  return token;
}
/** The context the authorizer hands a handler, built from its REAL output. */
async function ctxFor(routeKey, groups, claims) {
  const res = await knock(routeKey, groups, claims);
  assert.ok(res.isAuthorized, `authorizer refused ${routeKey}`);
  return res.context;
}
const handlerEvent = (method, context, pathParameters = {}) => ({
  requestContext: { http: { method }, authorizer: { lambda: context } },
  pathParameters,
});

(async () => {
  console.log('\n1. a pending account reaches the two invite routes, and only those');
  const TOKEN_PATH = `invites/${ORG}.${'b'.repeat(32)}/accept`;
  for (const routeKey of ['GET /invites', 'POST /invites/{token}/accept', `POST /${TOKEN_PATH}`]) {
    await check(`pending is let in: ${routeKey.slice(0, 50)}`, async () => {
      const res = await knock(routeKey, ['pending']);
      assert.strictEqual(res.isAuthorized, true);
    });
    await check(`hosts and admins still are: ${routeKey.slice(0, 40)}`, async () => {
      assert.strictEqual((await knock(routeKey, ['hosts'])).isAuthorized, true);
      assert.strictEqual((await knock(routeKey, ['admins'])).isAuthorized, true);
    });
    // rejects: widening "pending" into "anyone signed in".
    await check(`an account in no group is still refused: ${routeKey.slice(0, 40)}`, async () => {
      assert.strictEqual((await knock(routeKey, [])).isAuthorized, false);
    });
  }

  // rejects: the invite clause swallowing its neighbours, or a prefix match.
  const HOST_ROUTES = [
    'POST /games', 'GET /orgs', 'POST /orgs', 'GET /orgs/{orgId}/members',
    'POST /orgs/{orgId}/invites', 'DELETE /orgs/{orgId}/invites/{token}',
    'POST /invites/{token}/decline', 'GET /invites/{token}', 'POST /question-sets',
    'GET /events', 'POST /games/{gameId}/start',
  ];
  for (const routeKey of HOST_ROUTES) {
    await check(`pending is refused: ${routeKey}`, async () => {
      assert.strictEqual((await knock(routeKey, ['pending'])).isAuthorized, false);
    });
  }

  console.log('\n2. the authorizer says whether the address is verified');
  await check('email_verified true -> "true"', async () => {
    assert.strictEqual((await ctxFor('GET /invites', ['pending'], { email_verified: true })).emailVerified, 'true');
  });
  await check('email_verified "true" (a string claim) -> "true"', async () => {
    assert.strictEqual((await ctxFor('GET /invites', ['pending'], { email_verified: 'true' })).emailVerified, 'true');
  });
  // rejects: trusting an address the user typed into their own profile.
  await check('email_verified false -> "false"', async () => {
    assert.strictEqual((await ctxFor('GET /invites', ['pending'], { email_verified: false })).emailVerified, 'false');
  });
  await check('no claim at all -> "false"', async () => {
    assert.strictEqual((await ctxFor('GET /invites', ['pending'], {})).emailVerified, 'false');
  });
  // rejects: locking out every Google sign-in, whose token may carry no claim.
  await check('a Google sign-in (identities) -> "true"', async () => {
    const identities = [{ providerName: 'Google', providerType: 'Google', userId: '1' }];
    assert.strictEqual((await ctxFor('GET /invites', ['pending'], { identities })).emailVerified, 'true');
  });

  console.log('\n3. the handlers match the VERIFIED address, from the token');
  await check('pending, verified, own invitation: listed', async () => {
    table.clear();
    seedInvite('dev@x.example');
    seedInvite('someone@else.example', { tokenTail: 'c' });
    const ctx = await ctxFor('GET /invites', ['pending'], { email_verified: true });
    const res = await listMyInvites(handlerEvent('GET', ctx));
    assert.strictEqual(res.statusCode, 200);
    const { invites } = JSON.parse(res.body);
    assert.deepStrictEqual(invites.map((i) => i.orgName), ['Northwind Learning']);
    assert.ok(invites.every((i) => !String(i.token).includes('c'.repeat(32))), 'someone else\'s invitation was listed');
  });
  await check('unverified address: lists nothing', async () => {
    table.clear();
    seedInvite('victim@x.example');
    const ctx = await ctxFor('GET /invites', ['pending'], { email: 'victim@x.example', email_verified: false });
    const res = await listMyInvites(handlerEvent('GET', ctx));
    assert.strictEqual(res.statusCode, 200);
    assert.deepStrictEqual(JSON.parse(res.body).invites, []);
  });
  await check('pending, verified, own invitation: accepted, 200', async () => {
    table.clear();
    const token = seedInvite('dev@x.example');
    const ctx = await ctxFor('POST /invites/{token}/accept', ['pending'], { email_verified: true });
    const res = await acceptInvite(handlerEvent('POST', ctx, { token }));
    assert.strictEqual(res.statusCode, 200, res.body);
    assert.strictEqual(JSON.parse(res.body).accepted, true);
  });
  // rejects: the attack this whole file exists for.
  await check('unverified address set to the invitee\'s: refused 403, nothing written', async () => {
    table.clear();
    const token = seedInvite('victim@x.example');
    const ctx = await ctxFor('POST /invites/{token}/accept', ['pending'], { email: 'victim@x.example', email_verified: false });
    const res = await acceptInvite(handlerEvent('POST', ctx, { token }));
    assert.strictEqual(res.statusCode, 403);
    assert.ok(![...table.keys()].some((key) => key.includes('MEMBER#')), 'a membership was written');
  });
  await check('someone else\'s invitation: refused 403', async () => {
    table.clear();
    const token = seedInvite('victim@x.example');
    const ctx = await ctxFor('POST /invites/{token}/accept', ['pending'], { email_verified: true });
    const res = await acceptInvite(handlerEvent('POST', ctx, { token }));
    assert.strictEqual(res.statusCode, 403);
  });
  // rejects: an address taken from the request body instead of the token.
  await check('an email in the body changes nothing', async () => {
    table.clear();
    const token = seedInvite('victim@x.example');
    const ctx = await ctxFor('POST /invites/{token}/accept', ['pending'], { email_verified: true });
    const res = await acceptInvite({ ...handlerEvent('POST', ctx, { token }), body: JSON.stringify({ email: 'victim@x.example' }) });
    assert.strictEqual(res.statusCode, 403);
  });
  await check('expired: 410', async () => {
    table.clear();
    const token = seedInvite('dev@x.example', { daysLeft: -1 });
    const ctx = await ctxFor('POST /invites/{token}/accept', ['pending'], { email_verified: true });
    assert.strictEqual((await acceptInvite(handlerEvent('POST', ctx, { token }))).statusCode, 410);
  });
  await check('single use: the invitation rows are gone after accepting', async () => {
    table.clear();
    const token = seedInvite('dev@x.example');
    const ctx = await ctxFor('POST /invites/{token}/accept', ['pending'], { email_verified: true });
    await acceptInvite(handlerEvent('POST', ctx, { token }));
    assert.ok(![...table.keys()].some((key) => key.includes('INVITE#')), 'an invitation row survived');
    // a second account with the same address cannot take it again
    const other = await ctxFor('POST /invites/{token}/accept', ['pending'], { sub: 'u_other', email_verified: true });
    assert.strictEqual((await acceptInvite(handlerEvent('POST', other, { token }))).statusCode, 404);
  });

  console.log(`\n${pass} passed, ${fail} failed`);
  suiteFinished();
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('harness error:', e); process.exit(2); });
