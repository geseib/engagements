/**
 * ACCOUNTS THAT ARRIVE THROUGH A TEAM INVITATION, AND THE TEAM THAT APPROVES THEM.
 *
 * The owner, 2026-10-11 (docs/design/admin-landing, open question 1):
 *   - "if the account is a team it's a 'paid' account; it's their
 *     responsibility." A team owner or admin may approve hosting for people
 *     who joined through THAT team's invitation; audited first; Engage can
 *     still reject.
 *   - "it should be possible to create an account if invited to a team but
 *     not have an individual account." An account created from a team
 *     invitation gets no personal space; existing accounts are unchanged.
 *
 * Files under test: admin/orgs/accept-invite.js, shared/personal-org.js,
 * list-my-orgs.js, create-org.js (`personal: true`), orgs/approve-member.js
 * mounted in manage-users.js, and list-members.js's `canHost`.
 *
 * Every check carries a `// rejects:` line naming the change it catches.
 */
const suiteFinished = require('./helpers/finish-guard');
const path = require('path');
const assert = require('assert');

const REPO = path.join(__dirname, '..');

const store = new Map();
const key = (pk, sk) => `${pk}|${sk}`;
const counts = { put: 0, get: 0, query: 0, update: 0, delete: 0, transactWrite: 0 };
const control = { failNextTransact: null };

class PutCommand { constructor(i) { this.input = i; this.type = 'put'; } }
class GetCommand { constructor(i) { this.input = i; this.type = 'get'; } }
class QueryCommand { constructor(i) { this.input = i; this.type = 'query'; } }
class DeleteCommand { constructor(i) { this.input = i; this.type = 'delete'; } }
class UpdateCommand { constructor(i) { this.input = i; this.type = 'update'; } }
class BatchWriteCommand { constructor(i) { this.input = i; this.type = 'batchWrite'; } }
class TransactWriteCommand { constructor(i) { this.input = i; this.type = 'transactWrite'; } }

function ddbError(name) {
  const e = new Error(name);
  e.name = name;
  return e;
}

/** Split on TOP-LEVEL commas only — `if_not_exists(a, :b)` must stay whole. */
function splitTop(s) {
  const out = [];
  let depth = 0, cur = '';
  for (const ch of s) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ',' && depth === 0) { out.push(cur); cur = ''; continue; }
    cur += ch;
  }
  if (cur.trim()) out.push(cur);
  return out.map((x) => x.trim()).filter(Boolean);
}

const resolveName = (n, names) => (n.startsWith('#') ? names[n] : n);

/**
 * Only the forms the handlers actually use are understood, and ANYTHING ELSE
 * THROWS. A harness that quietly ignores an expression it does not recognise
 * turns a real condition into a no-op and every test below into theatre.
 */
function evalCondition(expr, item, values = {}, names = {}) {
  if (!expr) return true;
  let m;
  if ((m = /^attribute_not_exists\(([#\w]+)\)$/.exec(expr.trim()))) {
    const f = resolveName(m[1], names);
    return !item || item[f] === undefined;
  }
  if ((m = /^attribute_exists\(([#\w]+)\)$/.exec(expr.trim()))) {
    const f = resolveName(m[1], names);
    return !!item && item[f] !== undefined;
  }
  if ((m = /^([#\w]+)\s*=\s*(:\w+)$/.exec(expr.trim()))) {
    const f = resolveName(m[1], names);
    return !!item && item[f] === values[m[2]];
  }
  throw new Error(`test harness: unsupported ConditionExpression ${JSON.stringify(expr)}`);
}

function applyUpdate(existing, keyObj, expr, values = {}, names = {}) {
  const item = { ...(existing || keyObj) };
  const sections = expr.split(/\b(SET|REMOVE)\b/i).map((s) => s.trim()).filter(Boolean);
  for (let i = 0; i < sections.length; i += 2) {
    const kind = String(sections[i]).toUpperCase();
    const body = sections[i + 1] || '';
    if (kind === 'SET') {
      for (const clause of splitTop(body)) {
        const eq = clause.indexOf('=');
        if (eq === -1) throw new Error(`test harness: bad SET clause ${clause}`);
        const field = resolveName(clause.slice(0, eq).trim(), names);
        const rhs = clause.slice(eq + 1).trim();
        let value;
        let m;
        if (rhs.startsWith(':')) {
          if (!(rhs in values)) throw new Error(`test harness: no value for ${rhs}`);
          value = values[rhs];
        } else if ((m = /^if_not_exists\(\s*([#\w]+)\s*,\s*(:\w+)\s*\)$/.exec(rhs))) {
          const f = resolveName(m[1], names);
          value = item[f] !== undefined ? item[f] : values[m[2]];
        } else {
          throw new Error(`test harness: unsupported SET value ${JSON.stringify(rhs)}`);
        }
        item[field] = value;
      }
    } else if (kind === 'REMOVE') {
      for (const f of splitTop(body)) delete item[resolveName(f, names)];
    } else {
      throw new Error(`test harness: unsupported UpdateExpression section ${kind}`);
    }
  }
  return item;
}

const fakeDoc = {
  send: async (cmd) => {
    const inp = cmd.input || {};
    counts[cmd.type] = (counts[cmd.type] || 0) + 1;
    switch (cmd.type) {
      case 'put': {
        const cur = store.get(key(inp.Item.PK, inp.Item.SK));
        if (!evalCondition(inp.ConditionExpression, cur, inp.ExpressionAttributeValues, inp.ExpressionAttributeNames)) {
          throw ddbError('ConditionalCheckFailedException');
        }
        store.set(key(inp.Item.PK, inp.Item.SK), inp.Item);
        return {};
      }
      case 'get':
        return { Item: store.get(key(inp.Key.PK, inp.Key.SK)) };
      case 'delete': {
        const cur = store.get(key(inp.Key.PK, inp.Key.SK));
        if (!evalCondition(inp.ConditionExpression, cur, inp.ExpressionAttributeValues, inp.ExpressionAttributeNames)) {
          throw ddbError('ConditionalCheckFailedException');
        }
        store.delete(key(inp.Key.PK, inp.Key.SK));
        return {};
      }
      case 'update': {
        const k = key(inp.Key.PK, inp.Key.SK);
        const cur = store.get(k);
        if (!evalCondition(inp.ConditionExpression, cur, inp.ExpressionAttributeValues, inp.ExpressionAttributeNames)) {
          throw ddbError('ConditionalCheckFailedException');
        }
        store.set(k, applyUpdate(cur, inp.Key, inp.UpdateExpression,
          inp.ExpressionAttributeValues, inp.ExpressionAttributeNames));
        return {};
      }
      case 'query': {
        const pk = inp.ExpressionAttributeValues[':pk'];
        const prefix = inp.ExpressionAttributeValues[':sk'] ?? '';
        const items = [...store.values()].filter(
          (i) => i.PK === pk && String(i.SK).startsWith(String(prefix)),
        );
        // No LastEvaluatedKey: one page. queryPartition's loop is exercised by
        // simply terminating, which is the behaviour that matters here.
        return { Items: items, Count: items.length };
      }
      case 'transactWrite': {
        if (control.failNextTransact) {
          const name = control.failNextTransact;
          control.failNextTransact = null;
          throw ddbError(name);
        }
        const items = inp.TransactItems || [];
        // PHASE 1 — every condition is evaluated against the state BEFORE the
        // transaction, exactly as DynamoDB does it. Nothing is written yet.
        for (const it of items) {
          const op = it.Put || it.Update || it.Delete;
          const k = it.Put ? key(it.Put.Item.PK, it.Put.Item.SK) : key(op.Key.PK, op.Key.SK);
          if (!evalCondition(op.ConditionExpression, store.get(k),
            op.ExpressionAttributeValues, op.ExpressionAttributeNames)) {
            throw ddbError('TransactionCanceledException');
          }
        }
        // PHASE 2 — all or nothing.
        for (const it of items) {
          if (it.Put) store.set(key(it.Put.Item.PK, it.Put.Item.SK), it.Put.Item);
          else if (it.Delete) store.delete(key(it.Delete.Key.PK, it.Delete.Key.SK));
          else if (it.Update) {
            const k = key(it.Update.Key.PK, it.Update.Key.SK);
            store.set(k, applyUpdate(store.get(k), it.Update.Key, it.Update.UpdateExpression,
              it.Update.ExpressionAttributeValues, it.Update.ExpressionAttributeNames));
          }
        }
        return {};
      }
      default:
        return {};
    }
  },
};

// Each lambda-functions/<group>/ may carry its own node_modules, and Node
// resolves from the requiring file's directory upward — so stub every copy or
// the real SDK loads and the test dies on credentials instead of assertions.
const STUB_PATHS = [
  REPO,
  path.join(REPO, 'lambda-functions'),
  path.join(REPO, 'lambda-functions', 'admin'),
  path.join(REPO, 'lambda-functions', 'admin', 'orgs'),
  path.join(REPO, 'lambda-functions', 'game'),
  path.join(REPO, 'lambda-functions', 'websocket'),
];

function stub(name, exports) {
  const seen = new Set();
  for (const base of STUB_PATHS) {
    let p;
    try { p = require.resolve(name, { paths: [base] }); } catch { continue; }
    if (seen.has(p)) continue;
    seen.add(p);
    require.cache[p] = { id: p, filename: p, loaded: true, exports };
  }
  if (!seen.size) throw new Error(`stub(): could not resolve ${name} from any of ${STUB_PATHS.join(', ')}`);
}
// ── TENANT CRYPTO ──────────────────────────────────────────────────────────
// Creating an organisation now mints its data key — one GenerateDataKey, whose
// wrapped blob goes onto METADATA — because tenant-crypto THROWS rather than
// writing plaintext for a tenant that believes it is encrypted. So this suite
// needs a KMS and a key id. The stub refuses a Decrypt with a missing or
// mismatched encryption context, exactly as the key policy will.
const { makeKmsStub } = require('./helpers/tenant-crypto-stub');
const kmsStub = makeKmsStub();
process.env.TENANT_KMS_KEY_ID = 'alias/test-tenant-key';
stub('@aws-sdk/client-kms', kmsStub.exports);
stub('@aws-sdk/client-dynamodb', { DynamoDBClient: class {} });
stub('@aws-sdk/lib-dynamodb', {
  DynamoDBDocumentClient: { from: () => fakeDoc },
  PutCommand, GetCommand, QueryCommand, DeleteCommand, UpdateCommand,
  BatchWriteCommand, TransactWriteCommand,
});

process.env.TABLE_NAME = 'test-table';
// ── COGNITO ───────────────────────────────────────────────────────────────
// A pool of accounts by username: sub, email, enabled, groups. Every call is
// logged with the order it happened in, against the DynamoDB writes, so a
// check can prove the audit entry came FIRST.
const pool = new Map();
const order = [];
class Cmd { constructor(i) { this.input = i; this.name = this.constructor.name; } }
const cognitoClasses = {};
for (const n of ['ListUsersCommand', 'AdminListGroupsForUserCommand', 'AdminAddUserToGroupCommand',
  'AdminRemoveUserFromGroupCommand', 'AdminDeleteUserCommand', 'AdminDisableUserCommand',
  'AdminEnableUserCommand', 'ListUsersInGroupCommand', 'AdminGetUserCommand', 'AdminUpdateUserAttributesCommand']) {
  cognitoClasses[n] = ({ [n]: class extends Cmd {} })[n];
}
const userOf = (username) => {
  const u = pool.get(username);
  if (!u) { const e = new Error('User does not exist.'); e.name = 'UserNotFoundException'; throw e; }
  return u;
};
stub('@aws-sdk/client-cognito-identity-provider', {
  ...cognitoClasses,
  CognitoIdentityProviderClient: class {
    async send(cmd) {
      const i = cmd.input;
      order.push(`cognito:${cmd.name}`);
      switch (cmd.name) {
        case 'ListUsersCommand': {
          const m = /^sub = "(.+)"$/.exec(i.Filter || '');
          const all = [...pool.entries()].map(([Username, u]) => ({ Username, Enabled: u.enabled, Attributes: [{ Name: 'sub', Value: u.sub }, { Name: 'email', Value: u.email }] }));
          return { Users: m ? all.filter((u) => u.Attributes[0].Value === m[1]) : all };
        }
        case 'AdminGetUserCommand': {
          const u = userOf(i.Username);
          return { Enabled: u.enabled, UserAttributes: [{ Name: 'sub', Value: u.sub }, { Name: 'email', Value: u.email }] };
        }
        case 'AdminListGroupsForUserCommand':
          return { Groups: [...userOf(i.Username).groups].map((GroupName) => ({ GroupName })) };
        case 'AdminAddUserToGroupCommand': userOf(i.Username).groups.add(i.GroupName); return {};
        case 'AdminRemoveUserFromGroupCommand': userOf(i.Username).groups.delete(i.GroupName); return {};
        case 'AdminDisableUserCommand': userOf(i.Username).enabled = false; return {};
        case 'AdminEnableUserCommand': userOf(i.Username).enabled = true; return {};
        case 'ListUsersInGroupCommand': return { Users: [] };
        default: return {};
      }
    }
  },
});
process.env.USER_POOL_ID = 'us-east-1_test';

const ORGS = path.join(REPO, 'lambda-functions/admin/orgs');
const listMyOrgs = require(path.join(ORGS, 'list-my-orgs.js')).handler;
const createOrg = require(path.join(ORGS, 'create-org.js')).handler;
const acceptInvite = require(path.join(ORGS, 'accept-invite.js')).handler;
const listMembers = require(path.join(ORGS, 'list-members.js')).handler;
const manageUsers = require(path.join(REPO, 'lambda-functions/admin/manage-users.js')).handler;

if (!process.env.DEBUG) { console.log = () => {}; console.warn = () => {}; console.error = () => {}; }
const say = (...a) => process.stdout.write(`${a.join(' ')}\n`);

// The audit write can be made to fail, and every write is logged in order.
const control2 = { failAudit: false };
const passThrough = fakeDoc.send;
fakeDoc.send = async (cmd) => {
  const inp = cmd.input || {};
  if (cmd.type === 'put' && inp.Item && inp.Item.RecordType === 'AUDIT') {
    order.push('ddb:audit');
    if (control2.failAudit) { const e = new Error('throttled'); e.name = 'ProvisionedThroughputExceededException'; throw e; }
  } else if (cmd.type !== 'get' && cmd.type !== 'query') {
    order.push(`ddb:${cmd.type}`);
  }
  return passThrough(cmd);
};

let pass = 0;
let fail = 0;
async function check(label, fn) {
  try { await fn(); say(`  ok   - ${label}`); pass += 1; } catch (e) { say(`  FAIL - ${label}\n         ${e.message}`); fail += 1; }
}

const TEAM = 'org_2222222222222222222222';
const OTHER = 'org_3333333333333333333333';

function evt({ method = 'GET', path: p = '/orgs', sub, email = '', name = '', orgId = '', role = '',
  groups = 'hosts', pathParams = {}, body } = {}) {
  return {
    rawPath: p,
    requestContext: {
      http: { method, path: p },
      authorizer: { lambda: { userId: sub, username: sub, email, emailVerified: 'true', name, orgId, orgRole: role, groups } },
    },
    pathParameters: pathParams,
    body: body === undefined ? undefined : JSON.stringify(body),
  };
}
const bodyOf = (res) => JSON.parse(res.body || '{}');
const rowsIn = (pk) => [...store.values()].filter((i) => i.PK === pk);
const profileOf = (sub) => store.get(key(`USER#${sub}`, 'PROFILE'));
const memberOf = (orgId, sub) => store.get(key(`ORG#${orgId}`, `MEMBER#${sub}`));
const personalOrgsOf = (sub) => rowsIn(`USER#${sub}`)
  .map((r) => store.get(key(`ORG#${r.orgId}`, 'METADATA')))
  .filter((m) => m && m.type === 'personal');

const OWNER = { sub: 'u_owner', email: 'maya@northwind.example', name: 'Maya Reyes' };
const ADMIN = { sub: 'u_admin', email: 'tom@northwind.example', name: 'Tom Becker' };
const MEMBER = { sub: 'u_member', email: 'jo@northwind.example', name: 'Jo Adeyemi' };
const PRIYA = { sub: 'u_priya', email: 'priya@northwind.example', name: 'Priya Shah' };
const OUTSIDER = { sub: 'u_other', email: 'lee@harbour.example', name: 'Lee Park' };

function seedTeam(orgId, name, members) {
  store.set(key(`ORG#${orgId}`, 'METADATA'), { PK: `ORG#${orgId}`, SK: 'METADATA', orgId, name, plan: 'team', status: 'active', type: 'team' });
  store.set(key('ORGS', `ORG#${orgId}`), { PK: 'ORGS', SK: `ORG#${orgId}`, orgId, name, plan: 'team', type: 'team', status: 'active' });
  for (const m of members) {
    store.set(key(`ORG#${orgId}`, `MEMBER#${m.sub}`), { PK: `ORG#${orgId}`, SK: `MEMBER#${m.sub}`, orgId, userId: m.sub, role: m.role, email: m.email, ...(m.extra || {}) });
    store.set(key(`USER#${m.sub}`, `ORG#${orgId}`), { PK: `USER#${m.sub}`, SK: `ORG#${orgId}`, orgId, userId: m.sub, role: m.role });
  }
}
function seedInvite(orgId, email, role = 'member') {
  const tok = `${orgId}.${'k'.repeat(32)}`;
  const row = { orgId, token: tok, email, role, invitedBy: OWNER.sub, invitedAt: new Date(Date.now() - 86400000).toISOString(), expiresAt: new Date(Date.now() + 5 * 86400000).toISOString() };
  store.set(key(`ORG#${orgId}`, `INVITE#${tok}`), { PK: `ORG#${orgId}`, SK: `INVITE#${tok}`, ...row });
  return tok;
}
function account(who, groups, enabled = true) {
  pool.set(`user-${who.sub}`, { sub: who.sub, email: who.email, enabled, groups: new Set(groups) });
}
function reset() {
  store.clear();
  pool.clear();
  order.length = 0;
  control.failNextTransact = null;
  control2.failAudit = false;
  seedTeam(TEAM, 'Northwind Learning', [
    { ...OWNER, role: 'owner' }, { ...ADMIN, role: 'admin' }, { ...MEMBER, role: 'member' },
  ]);
  seedTeam(OTHER, 'Harbour School', [{ ...OUTSIDER, role: 'owner' }]);
  account(OWNER, ['hosts']); account(ADMIN, ['hosts']); account(MEMBER, ['hosts']); account(OUTSIDER, ['hosts']);
}

/** Priya signs up (pending) and accepts Northwind's invitation. */
async function priyaJoins() {
  account(PRIYA, ['pending']);
  const tok = seedInvite(TEAM, PRIYA.email);
  const res = await acceptInvite(evt({ method: 'POST', path: `/invites/${tok}/accept`, ...PRIYA, groups: 'pending', pathParams: { token: tok } }));
  assert.strictEqual(res.statusCode, 200, res.body);
}
const approve = (who, role, orgId = TEAM, sub = PRIYA.sub, extra = {}) => manageUsers(evt({
  method: 'POST', path: `/orgs/${orgId}/members/${sub}/approve`, ...who, orgId: extra.activeOrg || orgId, role,
  groups: extra.groups || 'hosts', pathParams: { orgId, sub },
}));
const priyaGroups = () => [...pool.get(`user-${PRIYA.sub}`).groups].sort();

(async () => {
  say('\n1. an account that arrives through a team invitation has no personal space');

  await check('accepting while pending stamps the membership and the profile', async () => {
    reset();
    await priyaJoins();
    const m = memberOf(TEAM, PRIYA.sub);
    // rejects: no proof of WHICH team brought them in, so any team could approve anybody
    assert.strictEqual(m.joinedByInvite, true);
    assert.strictEqual(m.awaitingHostApproval, true);
    assert.strictEqual(profileOf(PRIYA.sub).joinedByInvite, TEAM);
  });

  await check('after approval GET /orgs shows that team only, and makes no personal space', async () => {
    reset();
    await priyaJoins();
    pool.get(`user-${PRIYA.sub}`).groups = new Set(['hosts']);
    const res = await listMyOrgs(evt({ ...PRIYA, groups: 'hosts' }));
    const body = bodyOf(res);
    // rejects: ensurePersonalOrg ignoring the stamp, minting a home nobody asked for
    assert.deepStrictEqual(body.orgs.map((o) => o.orgId), [TEAM]);
    assert.strictEqual(personalOrgsOf(PRIYA.sub).length, 0);
    assert.strictEqual(body.canCreatePersonal, true, 'the console is told it may offer one');
  });

  await check('normal signup is unchanged: an approved account with no stamp gets its home', async () => {
    reset();
    const fresh = { sub: 'u_fresh', email: 'fresh@x.example', name: 'Fresh Host' };
    const body = bodyOf(await listMyOrgs(evt({ ...fresh })));
    // rejects: skipping provisioning for everybody, not just invitees
    assert.strictEqual(personalOrgsOf(fresh.sub).length, 1);
    assert.strictEqual(body.canCreatePersonal, false);
  });

  await check('an already approved account joining a team is unchanged: no stamps', async () => {
    reset();
    const lena = { sub: 'u_lena', email: 'lena@x.example', name: 'Lena Ortiz' };
    await listMyOrgs(evt({ ...lena }));
    const tok = seedInvite(TEAM, lena.email);
    await acceptInvite(evt({ method: 'POST', ...lena, pathParams: { token: tok } }));
    // rejects: stamping every join, which would let a team approve a host Engage already approved
    assert.strictEqual(memberOf(TEAM, lena.sub).joinedByInvite, undefined);
    assert.strictEqual(memberOf(TEAM, lena.sub).awaitingHostApproval, undefined);
    assert.strictEqual(profileOf(lena.sub).joinedByInvite, undefined);
  });

  await check('removed from their only team, an invite-only account gets a home, never nowhere', async () => {
    reset();
    await priyaJoins();
    store.delete(key(`ORG#${TEAM}`, `MEMBER#${PRIYA.sub}`));
    store.delete(key(`USER#${PRIYA.sub}`, `ORG#${TEAM}`));
    await listMyOrgs(evt({ ...PRIYA, groups: 'hosts' }));
    // rejects: an approved account stranded with no organisation at all
    assert.strictEqual(personalOrgsOf(PRIYA.sub).length, 1);
  });

  await check('POST /orgs {personal: true} makes exactly one personal space, however often it is pressed', async () => {
    reset();
    await priyaJoins();
    const ask = () => createOrg(evt({ method: 'POST', ...PRIYA, groups: 'hosts', body: { personal: true } }));
    const first = await ask();
    assert.strictEqual(first.statusCode, 201, first.body);
    const second = await ask();
    assert.strictEqual(second.statusCode, 200, second.body);
    assert.strictEqual(personalOrgsOf(PRIYA.sub).length, 1);
    assert.strictEqual(bodyOf(await listMyOrgs(evt({ ...PRIYA, groups: 'hosts' }))).canCreatePersonal, false);
  });

  await check('POST /orgs {personal: true} is refused while still pending', async () => {
    reset();
    await priyaJoins();
    const res = await createOrg(evt({ method: 'POST', ...PRIYA, groups: 'pending', body: { personal: true } }));
    assert.strictEqual(res.statusCode, 403);
    assert.strictEqual(personalOrgsOf(PRIYA.sub).length, 0);
  });

  say('\n2. the team that invited them approves their hosting');

  await check('the roster says who cannot host yet', async () => {
    reset();
    await priyaJoins();
    const res = await listMembers(evt({ ...OWNER, orgId: TEAM, role: 'owner', path: `/orgs/${TEAM}/members`, pathParams: { orgId: TEAM } }));
    const priya = bodyOf(res).members.find((m) => m.userId === PRIYA.sub);
    assert.strictEqual(priya.canHost, false);
    assert.strictEqual(priya.awaitingHostApproval, true);
    assert.strictEqual(bodyOf(res).members.find((m) => m.userId === OWNER.sub).canHost, true);
  });

  await check('the owner approves: audit FIRST, then pending -> hosts, then the queue clears', async () => {
    reset();
    await priyaJoins();
    order.length = 0;
    const res = await approve(OWNER, 'owner');
    assert.strictEqual(res.statusCode, 200, res.body);
    assert.deepStrictEqual(priyaGroups(), ['hosts']);
    assert.strictEqual(memberOf(TEAM, PRIYA.sub).awaitingHostApproval, undefined);
    assert.ok(memberOf(TEAM, PRIYA.sub).hostApprovedAt);
    const audit = rowsIn(`ORG#${TEAM}#AUDIT`).concat([...store.values()].filter((r) => r.RecordType === 'AUDIT'));
    assert.ok(audit.some((r) => r.Action === 'member.approve-hosting' && r.Actor.Role === 'org-owner'), 'no entry in the team log');
    // rejects: moving the account and writing the entry afterwards
    const a = order.indexOf('ddb:audit');
    const c = order.indexOf('cognito:AdminAddUserToGroupCommand');
    assert.ok(a !== -1 && c !== -1 && a < c, `order was ${order.join(', ')}`);
  });

  await check('an admin of the team may approve', async () => {
    reset();
    await priyaJoins();
    assert.strictEqual((await approve(ADMIN, 'admin')).statusCode, 200);
    assert.deepStrictEqual(priyaGroups(), ['hosts']);
  });

  await check('a member of the team may not', async () => {
    reset();
    await priyaJoins();
    const res = await approve(MEMBER, 'member');
    // rejects: authorizeOrg at member level
    assert.strictEqual(res.statusCode, 403);
    assert.deepStrictEqual(priyaGroups(), ['pending']);
  });

  await check('another team\'s owner may not, by changing the URL either way', async () => {
    reset();
    await priyaJoins();
    // Their own team in the context, Northwind in the path.
    const a = await approve(OUTSIDER, 'owner', TEAM, PRIYA.sub, { activeOrg: OTHER });
    assert.strictEqual(a.statusCode, 403, a.body);
    // Their own team in both, Northwind's invitee as the sub.
    const b = await approve(OUTSIDER, 'owner', OTHER, PRIYA.sub);
    assert.strictEqual(b.statusCode, 404, b.body);
    assert.deepStrictEqual(priyaGroups(), ['pending']);
  });

  await check('somebody the team did not invite is Engage\'s to approve, not the team\'s', async () => {
    reset();
    const walkIn = { sub: 'u_walk', email: 'walk@x.example', name: 'Walk In' };
    account(walkIn, ['pending']);
    seedTeam(TEAM, 'Northwind Learning', [{ ...walkIn, role: 'member', extra: { awaitingHostApproval: true } }]);
    const res = await approve(OWNER, 'owner', TEAM, walkIn.sub);
    // rejects: trusting awaitingHostApproval without the invitation stamp
    assert.strictEqual(res.statusCode, 403, res.body);
    assert.deepStrictEqual([...pool.get(`user-${walkIn.sub}`).groups], ['pending']);
  });

  await check('a failed audit write refuses the approval and changes nothing', async () => {
    reset();
    await priyaJoins();
    control2.failAudit = true;
    const res = await approve(OWNER, 'owner');
    assert.strictEqual(res.statusCode, 503, res.body);
    assert.deepStrictEqual(priyaGroups(), ['pending']);
    assert.strictEqual(memberOf(TEAM, PRIYA.sub).awaitingHostApproval, true);
  });

  await check('an account Engage rejected cannot be approved by the team; the box clears', async () => {
    reset();
    await priyaJoins();
    pool.get(`user-${PRIYA.sub}`).enabled = false;
    pool.get(`user-${PRIYA.sub}`).groups = new Set();
    const res = await approve(OWNER, 'owner');
    // rejects: a team undoing Engage's rejection
    assert.strictEqual(res.statusCode, 409, res.body);
    assert.strictEqual(pool.get(`user-${PRIYA.sub}`).enabled, false);
    assert.strictEqual(memberOf(TEAM, PRIYA.sub).awaitingHostApproval, undefined);
  });

  await check('Engage can still reject after the team approved', async () => {
    reset();
    await priyaJoins();
    await approve(OWNER, 'owner');
    const staff = { sub: 'u_staff', email: 'staff@engage.example', name: 'Staff' };
    account(staff, ['admins']);
    account({ sub: 'u_staff2', email: 'staff2@engage.example' }, ['admins']);
    const res = await manageUsers(evt({
      method: 'PUT', path: `/admin/users/user-${PRIYA.sub}/state`, ...staff, groups: 'admins',
      pathParams: { username: `user-${PRIYA.sub}` }, body: { newState: 'disabled' },
    }));
    assert.strictEqual(res.statusCode, 200, res.body);
    assert.strictEqual(pool.get(`user-${PRIYA.sub}`).enabled, false);
  });

  await check('Engage approving first takes the person out of every team\'s queue', async () => {
    reset();
    await priyaJoins();
    const staff = { sub: 'u_staff', email: 'staff@engage.example', name: 'Staff' };
    account(staff, ['admins']);
    const res = await manageUsers(evt({
      method: 'PUT', path: `/admin/users/user-${PRIYA.sub}/state`, ...staff, groups: 'admins',
      pathParams: { username: `user-${PRIYA.sub}` }, body: { newState: 'hosts' },
    }));
    assert.strictEqual(res.statusCode, 200, res.body);
    // rejects: a team box offering to approve somebody Engage already decided about
    assert.strictEqual(memberOf(TEAM, PRIYA.sub).awaitingHostApproval, undefined);
  });

  await check('a pending account cannot reach the approve route for itself', async () => {
    reset();
    await priyaJoins();
    const res = await approve(PRIYA, 'member', TEAM, PRIYA.sub, { groups: 'pending' });
    assert.strictEqual(res.statusCode, 403);
    assert.deepStrictEqual(priyaGroups(), ['pending']);
  });

  await check('the staff gate still guards every other route on the function', async () => {
    reset();
    const res = await manageUsers(evt({ method: 'POST', path: '/admin/users/list', ...OWNER, groups: 'hosts' }));
    assert.strictEqual(res.statusCode, 403);
  });

  say(`\n${pass} passed, ${fail} failed`);
  suiteFinished();
  process.exit(fail ? 1 : 0);
})();
