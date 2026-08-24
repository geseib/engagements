/**
 * ORGANISATION LIFECYCLE — create, read, list, roles, removal.
 *
 * Runs the REAL handlers under `lambda-functions/admin/orgs/` against a stubbed
 * DynamoDB, in the style of tests/player-question-payload.js. The stub here
 * understands TransactWriteItems, because almost everything worth asserting in
 * this group is about what happens when a multi-row write does NOT complete.
 *
 * THE FOUR FAILURES THIS FILE EXISTS TO MAKE LOUD:
 *
 *   1. A MEMBERSHIP WRITTEN IN ONE PLACE. `ORG#{org}/MEMBER#{sub}` and
 *      `USER#{sub}/ORG#{org}` are the same fact stored twice — the Team screen
 *      reads the first, `auth/authorizer.js` reads the second. Update one
 *      alone and what somebody is SHOWN to be able to do stops matching what
 *      they CAN do, and nothing in the system notices.
 *   2. A HALF-CREATED ORGANISATION. Three of the five create writes landing
 *      leaves a tenant with no members: unenterable, unadministrable, and
 *      un-invitable-to, because inviting needs an admin it does not have.
 *   3. THE PATH BEING BELIEVED. Every route below takes an orgId in the URL. If
 *      a handler acts on it without checking it against the caller's own
 *      organisation, an admin of one tenant administers another by editing a
 *      URL — the single worst failure this whole redesign exists to prevent.
 *   4. THE LAST OWNER BEING DEMOTED OR REMOVED. 03-team.html hides the buttons;
 *      a hidden button is not a permission, and the screen decided from a list
 *      that may be seconds out of date.
 *
 * rejects: writing the member and reverse rows outside one transaction; using
 * sequential Puts in create-org; trusting the path orgId; skipping the DB
 * re-check of the caller's role; letting the last owner be demoted or removed;
 * deriving an orgId from the organisation's name; a plain SET on defaultOrgId
 * instead of if_not_exists; guarding before the OPTIONS preflight.
 */
const path = require('path');
const assert = require('assert');

const REPO = path.join(__dirname, '..');

// ─────────────────────────────────────────────────────────────────────────────
// The stub. Put/Get/Query/Update/Delete plus TransactWrite, over one Map.
// ─────────────────────────────────────────────────────────────────────────────
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

const ORGS = path.join(REPO, 'lambda-functions/admin/orgs');
const createOrg = require(path.join(ORGS, 'create-org.js')).handler;
const getOrg = require(path.join(ORGS, 'get-org.js')).handler;
const listMyOrgs = require(path.join(ORGS, 'list-my-orgs.js')).handler;
const listMembers = require(path.join(ORGS, 'list-members.js')).handler;
const changeRole = require(path.join(ORGS, 'change-member-role.js')).handler;
const removeMember = require(path.join(ORGS, 'remove-member.js')).handler;
const G = require(path.join(ORGS, 'shared/org-guards.js'));

let pass = 0, fail = 0;
async function check(label, fn) {
  try { await fn(); console.log(`  ok   - ${label}`); pass++; }
  catch (e) { console.log(`  FAIL - ${label}\n         ${e.message}`); fail++; }
}

/** An API Gateway HTTP API v2 event carrying this API's real authorizer shape:
 *  a CUSTOM Lambda authorizer's context at `.authorizer.lambda`. */
function evt({ method = 'POST', sub = '', email = '', name = '', orgId = '', role = '', groups = '', pathParams = {}, body } = {}) {
  return {
    requestContext: {
      http: { method },
      authorizer: { lambda: { userId: sub, email, name, orgId, orgRole: role, groups } },
    },
    pathParameters: pathParams,
    body: body === undefined ? undefined : JSON.stringify(body),
  };
}
const bodyOf = (res) => JSON.parse(res.body || '{}');

function reset() {
  store.clear();
  for (const k of Object.keys(counts)) counts[k] = 0;
  control.failNextTransact = null;
}

/** Seed an organisation directly, bypassing the handlers, so that a test of
 *  (say) removal does not depend on creation passing. */
function seedOrg(orgId, name, members) {
  store.set(key(`ORG#${orgId}`, 'METADATA'), {
    PK: `ORG#${orgId}`, SK: 'METADATA', orgId, name, plan: 'free', status: 'active',
    createdAt: '2026-02-01T00:00:00.000Z', createdBy: members[0].sub,
  });
  store.set(key('ORGS', `ORG#${orgId}`), {
    PK: 'ORGS', SK: `ORG#${orgId}`, orgId, name, plan: 'free', status: 'active',
  });
  for (const m of members) {
    store.set(key(`ORG#${orgId}`, `MEMBER#${m.sub}`), {
      PK: `ORG#${orgId}`, SK: `MEMBER#${m.sub}`, orgId, userId: m.sub,
      role: m.role, email: m.email || `${m.sub}@x.example`,
      displayName: m.name || m.sub, joinedAt: '2026-02-01T00:00:00.000Z',
    });
    store.set(key(`USER#${m.sub}`, `ORG#${orgId}`), {
      PK: `USER#${m.sub}`, SK: `ORG#${orgId}`, orgId, userId: m.sub,
      role: m.role, joinedAt: '2026-02-01T00:00:00.000Z',
    });
  }
}

const ORG_A = 'org_1111111111111111111111';
const ORG_B = 'org_2222222222222222222222';

(async () => {
  // ── 1. Creating an organisation ─────────────────────────────────────────
  console.log('\n1. POST /orgs writes a whole tenant, or nothing');

  await check('all five rows land, in ONE transaction and no loose Puts', async () => {
    reset();
    const res = await createOrg(evt({
      sub: 'u_amara', email: 'Amara.Reyes@northwind.example', name: 'Amara Reyes',
      body: { name: 'Northwind Learning' },
    }));
    assert.strictEqual(res.statusCode, 201, res.body);
    const { org } = bodyOf(res);
    assert.ok(G.isOrgId(org.orgId), `minted id looks wrong: ${org.orgId}`);
    // The five rows of the approved data model.
    assert.ok(store.get(key('ORGS', `ORG#${org.orgId}`)), 'no platform index row');
    assert.ok(store.get(key(`ORG#${org.orgId}`, 'METADATA')), 'no METADATA row');
    assert.ok(store.get(key(`ORG#${org.orgId}`, 'MEMBER#u_amara')), 'no MEMBER row');
    assert.ok(store.get(key('USER#u_amara', `ORG#${org.orgId}`)), 'no USER reverse row');
    assert.ok(store.get(key('USER#u_amara', 'PROFILE')), 'no PROFILE row');
    // rejects: replacing the transaction with five sequential writes.
    assert.strictEqual(counts.transactWrite, 1, 'expected exactly one transaction');
    assert.strictEqual(counts.put, 0, 'a bare Put escaped the transaction');
  });

  await check('the creator is an OWNER, in both rows', async () => {
    reset();
    const res = await createOrg(evt({ sub: 'u_amara', email: 'a@x.example', body: { name: 'Northwind' } }));
    const { org } = bodyOf(res);
    assert.strictEqual(store.get(key(`ORG#${org.orgId}`, 'MEMBER#u_amara')).role, 'owner');
    assert.strictEqual(store.get(key(`USER#u_amara`, `ORG#${org.orgId}`)).role, 'owner');
  });

  await check('the id is MINTED — two organisations of the same name do not collide', async () => {
    reset();
    const a = bodyOf(await createOrg(evt({ sub: 'u_a', email: 'a@x.example', body: { name: 'Team Retro' } })));
    const b = bodyOf(await createOrg(evt({ sub: 'u_b', email: 'b@x.example', body: { name: 'Team Retro' } })));
    // upload-questions.js:298 slugs a title into an id and two "Team Retro"s
    // destroy each other. One level up that would be a whole tenant.
    assert.notStrictEqual(a.org.orgId, b.org.orgId);
    assert.notStrictEqual(a.org.slug, undefined);
    assert.strictEqual(a.org.slug, b.org.slug, 'the SLUG may collide — it is display only');
    assert.ok(store.get(key(`ORG#${a.org.orgId}`, 'METADATA')));
    assert.ok(store.get(key(`ORG#${b.org.orgId}`, 'METADATA')));
  });

  await check('defaultOrgId is set when there is none, and NOT moved when there is', async () => {
    reset();
    const first = bodyOf(await createOrg(evt({ sub: 'u_amara', email: 'a@x.example', body: { name: 'One' } })));
    assert.strictEqual(store.get(key('USER#u_amara', 'PROFILE')).defaultOrgId, first.org.orgId);
    const second = bodyOf(await createOrg(evt({ sub: 'u_amara', email: 'a@x.example', body: { name: 'Two' } })));
    // rejects: `SET defaultOrgId = :orgId` instead of if_not_exists — which
    // would silently move somebody's home every time they made a second team.
    assert.strictEqual(store.get(key('USER#u_amara', 'PROFILE')).defaultOrgId, first.org.orgId,
      `defaultOrgId moved to ${second.org.orgId}`);
  });

  await check('a failed transaction leaves NOTHING behind', async () => {
    reset();
    control.failNextTransact = 'TransactionCanceledException';
    const res = await createOrg(evt({ sub: 'u_amara', email: 'a@x.example', body: { name: 'Northwind' } }));
    assert.strictEqual(res.statusCode, 409, res.body);
    // The state the transaction exists to make impossible: an organisation
    // with no members.
    assert.strictEqual(store.size, 0, 'a partial tenant survived the failure');
  });

  await check('an anonymous caller is refused', async () => {
    reset();
    const res = await createOrg({ requestContext: { http: { method: 'POST' } }, body: '{"name":"X"}' });
    assert.strictEqual(res.statusCode, 403);
    assert.strictEqual(store.size, 0);
  });

  await check('a blank name and an unknown plan are refused, not defaulted', async () => {
    reset();
    assert.strictEqual((await createOrg(evt({ sub: 'u', body: { name: '   ' } }))).statusCode, 400);
    assert.strictEqual((await createOrg(evt({ sub: 'u', body: { name: 'X', plan: 'enterprise' } }))).statusCode, 400);
    assert.strictEqual(store.size, 0);
  });

  await check('OPTIONS answers 200 with no credentials at all', async () => {
    reset();
    // rejects: moving the auth guard above the preflight — which 403s every
    // browser's preflight and breaks the route for every caller at once.
    const res = await createOrg({ requestContext: { http: { method: 'OPTIONS' } } });
    assert.strictEqual(res.statusCode, 200);
  });

  // ── 2. Reading one organisation ─────────────────────────────────────────
  console.log('\n2. GET /orgs/{orgId} — members only, and the path is not trusted');

  await check('a member of that org gets it', async () => {
    reset();
    seedOrg(ORG_A, 'Northwind Learning', [{ sub: 'u_amara', role: 'owner' }]);
    const res = await getOrg(evt({
      method: 'GET', sub: 'u_amara', orgId: ORG_A, role: 'owner', pathParams: { orgId: ORG_A },
    }));
    assert.strictEqual(res.statusCode, 200, res.body);
    const b = bodyOf(res);
    assert.strictEqual(b.org.name, 'Northwind Learning');
    assert.strictEqual(b.yourRole, 'owner');
    assert.strictEqual(b.memberCount, 1);
  });

  await check('an ADMIN OF ANOTHER ORG is refused — the URL is not a permission', async () => {
    reset();
    seedOrg(ORG_A, 'Northwind', [{ sub: 'u_amara', role: 'owner' }]);
    seedOrg(ORG_B, 'Halcyon', [{ sub: 'u_jonah', role: 'owner' }]);
    // Jonah is a genuine owner — of B — and asks for A.
    const res = await getOrg(evt({
      method: 'GET', sub: 'u_jonah', orgId: ORG_B, role: 'owner', pathParams: { orgId: ORG_A },
    }));
    assert.strictEqual(res.statusCode, 403, res.body);
  });

  await check('a STALE context with no membership row is refused', async () => {
    reset();
    seedOrg(ORG_A, 'Northwind', [{ sub: 'u_amara', role: 'owner' }]);
    // Priya was removed a minute ago; her live token still says otherwise.
    // rejects: trusting the authorizer context alone and skipping the Get.
    const res = await getOrg(evt({
      method: 'GET', sub: 'u_priya', orgId: ORG_A, role: 'member', pathParams: { orgId: ORG_A },
    }));
    assert.strictEqual(res.statusCode, 403, res.body);
  });

  await check('a member of BOTH orgs, acting for one, cannot read the other', async () => {
    reset();
    seedOrg(ORG_A, 'Northwind', [{ sub: 'u_amara', role: 'owner' }]);
    seedOrg(ORG_B, 'Halcyon', [{ sub: 'u_amara', role: 'member' }]);
    // Amara genuinely belongs to A, so the MEMBER-row check alone would let
    // this through. The context check is what refuses it: the switcher decides
    // which organisation a request is acting for, and a request that reaches
    // past it is one the person did not knowingly make.
    // rejects: dropping tenant.canManageScope and relying on the row alone.
    const res = await getOrg(evt({
      method: 'GET', sub: 'u_amara', orgId: ORG_B, role: 'member', pathParams: { orgId: ORG_A },
    }));
    assert.strictEqual(res.statusCode, 403, res.body);
  });

  await check('being Engage staff is not a way in', async () => {
    reset();
    seedOrg(ORG_A, 'Northwind', [{ sub: 'u_amara', role: 'owner' }]);
    // tenant.js is explicit: platform admin adds no scope. Reading a
    // customer's organisation is a granted, logged act (08-privacy.html).
    const res = await getOrg(evt({
      method: 'GET', sub: 'u_staff', groups: 'admins', pathParams: { orgId: ORG_A },
    }));
    assert.strictEqual(res.statusCode, 403, res.body);
  });

  // ── 3. The switcher ─────────────────────────────────────────────────────
  console.log('\n3. GET /orgs — the topbar switcher');

  await check('only the caller\'s organisations, with the caller\'s role in each', async () => {
    reset();
    seedOrg(ORG_A, 'Northwind Learning', [{ sub: 'u_amara', role: 'admin' }]);
    seedOrg(ORG_B, 'Halcyon Coaching', [{ sub: 'u_amara', role: 'member' }, { sub: 'u_jonah', role: 'owner' }]);
    const res = await listMyOrgs(evt({ method: 'GET', sub: 'u_amara', orgId: ORG_A, role: 'admin' }));
    const b = bodyOf(res);
    assert.strictEqual(b.orgs.length, 2, JSON.stringify(b.orgs));
    assert.deepStrictEqual(b.orgs.map((o) => o.name), ['Halcyon Coaching', 'Northwind Learning']);
    assert.deepStrictEqual(b.orgs.map((o) => o.yourRole), ['member', 'admin']);
    assert.strictEqual(b.activeOrgId, ORG_A);
  });

  await check('the NAME comes from METADATA, not from the reverse row', async () => {
    reset();
    seedOrg(ORG_A, 'Northwind Learning', [{ sub: 'u_amara', role: 'owner' }]);
    // Renaming writes METADATA. If the switcher read a denormalised copy off
    // the membership row, every member would see the old name for ever.
    store.get(key(`ORG#${ORG_A}`, 'METADATA')).name = 'Northwind Group';
    store.get(key('USER#u_amara', `ORG#${ORG_A}`)).name = 'STALE COPY';
    const b = bodyOf(await listMyOrgs(evt({ method: 'GET', sub: 'u_amara' })));
    assert.strictEqual(b.orgs[0].name, 'Northwind Group');
  });

  await check('a membership pointing at a deleted org is dropped, not rendered blank', async () => {
    reset();
    seedOrg(ORG_A, 'Northwind', [{ sub: 'u_amara', role: 'owner' }]);
    store.delete(key(`ORG#${ORG_A}`, 'METADATA'));
    const b = bodyOf(await listMyOrgs(evt({ method: 'GET', sub: 'u_amara' })));
    assert.deepStrictEqual(b.orgs, []);
  });

  await check('an anonymous caller gets none, never all', async () => {
    reset();
    seedOrg(ORG_A, 'Northwind', [{ sub: 'u_amara', role: 'owner' }]);
    const res = await listMyOrgs({ requestContext: { http: { method: 'GET' } } });
    assert.strictEqual(res.statusCode, 403, res.body);
  });

  // ── 4. The Team screen ──────────────────────────────────────────────────
  console.log('\n4. GET /orgs/{orgId}/members — two lists, and the last-owner flag');

  await check('members and invites come back as separate lists', async () => {
    reset();
    seedOrg(ORG_A, 'Northwind', [
      { sub: 'u_amara', role: 'owner', name: 'Amara Reyes' },
      { sub: 'u_jonah', role: 'admin', name: 'Jonah Osei' },
      { sub: 'u_priya', role: 'member', name: 'Priya Kaur' },
    ]);
    const tok = `${ORG_A}.aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa`;
    store.set(key(`ORG#${ORG_A}`, `INVITE#${tok}`), {
      PK: `ORG#${ORG_A}`, SK: `INVITE#${tok}`, orgId: ORG_A, token: tok,
      email: 'dev.mensah@northwind.example', role: 'member',
      invitedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 3 * 86400000).toISOString(),
    });
    const b = bodyOf(await listMembers(evt({
      method: 'GET', sub: 'u_priya', orgId: ORG_A, role: 'member', pathParams: { orgId: ORG_A },
    })));
    assert.strictEqual(b.members.length, 3);
    assert.strictEqual(b.invites.length, 1);
    // Owners first, then admins, then members — 03-team.html's order.
    assert.deepStrictEqual(b.members.map((m) => m.role), ['owner', 'admin', 'member']);
    // "expires in 3" — the arithmetic, done once, server-side.
    assert.strictEqual(b.invites[0].daysUntilExpiry, 3);
    assert.strictEqual(b.invites[0].expired, false);
    assert.strictEqual(b.outstandingInvites, 1);
  });

  await check('an expired invitation is listed but NOT counted as outstanding', async () => {
    reset();
    seedOrg(ORG_A, 'Northwind', [{ sub: 'u_amara', role: 'owner' }]);
    for (const [suffix, days] of [['b', 4], ['c', -2]]) {
      const tok = `${ORG_A}.${suffix.repeat(32)}`;
      store.set(key(`ORG#${ORG_A}`, `INVITE#${tok}`), {
        PK: `ORG#${ORG_A}`, SK: `INVITE#${tok}`, orgId: ORG_A, token: tok,
        email: `${suffix}@x.example`, role: 'member',
        invitedAt: `2026-0${suffix === 'b' ? 3 : 2}-01T00:00:00.000Z`,
        expiresAt: new Date(Date.now() + days * 86400000).toISOString(),
      });
    }
    const b = bodyOf(await listMembers(evt({
      method: 'GET', sub: 'u_amara', orgId: ORG_A, role: 'owner', pathParams: { orgId: ORG_A },
    })));
    // Both rows are RETURNED — an expired invitation is the only kind an admin
    // can revoke, and DynamoDB's sweep may be up to 48 hours behind.
    assert.strictEqual(b.invites.length, 2);
    // …but "Two invitations are outstanding" must not count a dead one.
    assert.strictEqual(b.outstandingInvites, 1);
    assert.deepStrictEqual(b.invites.map((i) => i.expired), [true, false]);
    assert.strictEqual(b.invites.find((i) => i.expired).daysUntilExpiry, 0);
  });

  await check('the sole owner is flagged un-demotable and un-removable', async () => {
    reset();
    seedOrg(ORG_A, 'Northwind', [
      { sub: 'u_amara', role: 'owner' }, { sub: 'u_jonah', role: 'admin' },
    ]);
    const b = bodyOf(await listMembers(evt({
      method: 'GET', sub: 'u_amara', orgId: ORG_A, role: 'owner', pathParams: { orgId: ORG_A },
    })));
    const amara = b.members.find((m) => m.userId === 'u_amara');
    const jonah = b.members.find((m) => m.userId === 'u_jonah');
    assert.strictEqual(amara.isLastOwner, true);
    assert.strictEqual(amara.canDemote, false);
    assert.strictEqual(amara.canRemove, false);
    assert.strictEqual(amara.lockReason, 'the last owner');
    assert.strictEqual(jonah.canRemove, true);
  });

  await check('with two owners neither is the last one', async () => {
    reset();
    seedOrg(ORG_A, 'Northwind', [
      { sub: 'u_amara', role: 'owner' }, { sub: 'u_jonah', role: 'owner' },
    ]);
    const b = bodyOf(await listMembers(evt({
      method: 'GET', sub: 'u_amara', orgId: ORG_A, role: 'owner', pathParams: { orgId: ORG_A },
    })));
    assert.deepStrictEqual(b.members.map((m) => m.isLastOwner), [false, false]);
  });

  // ── 5. Changing a role ──────────────────────────────────────────────────
  console.log('\n5. PUT /orgs/{orgId}/members/{sub}/role');

  await check('promotion moves BOTH rows, in one transaction', async () => {
    reset();
    seedOrg(ORG_A, 'Northwind', [
      { sub: 'u_amara', role: 'owner' }, { sub: 'u_priya', role: 'member' },
    ]);
    const res = await changeRole(evt({
      method: 'PUT', sub: 'u_amara', orgId: ORG_A, role: 'owner',
      pathParams: { orgId: ORG_A, sub: 'u_priya' }, body: { role: 'admin' },
    }));
    assert.strictEqual(res.statusCode, 200, res.body);
    assert.strictEqual(store.get(key(`ORG#${ORG_A}`, 'MEMBER#u_priya')).role, 'admin');
    // THE ONE THE AUTHORIZER READS. rejects: updating only the MEMBER row,
    // which changes what the Team screen says without changing what Priya can
    // actually do.
    assert.strictEqual(store.get(key('USER#u_priya', `ORG#${ORG_A}`)).role, 'admin');
    assert.strictEqual(counts.transactWrite, 1);
    assert.strictEqual(counts.update, 0, 'a bare Update escaped the transaction');
  });

  await check('THE LAST OWNER CANNOT BE DEMOTED, whatever the screen drew', async () => {
    reset();
    seedOrg(ORG_A, 'Northwind', [
      { sub: 'u_amara', role: 'owner' }, { sub: 'u_jonah', role: 'admin' },
    ]);
    const res = await changeRole(evt({
      method: 'PUT', sub: 'u_amara', orgId: ORG_A, role: 'owner',
      pathParams: { orgId: ORG_A, sub: 'u_amara' }, body: { role: 'member' },
    }));
    assert.strictEqual(res.statusCode, 409, res.body);
    assert.match(bodyOf(res).error, /last owner/i);
    assert.strictEqual(store.get(key(`ORG#${ORG_A}`, 'MEMBER#u_amara')).role, 'owner');
    assert.strictEqual(store.get(key('USER#u_amara', `ORG#${ORG_A}`)).role, 'owner');
  });

  await check('…but with a second owner present the demotion goes through', async () => {
    reset();
    seedOrg(ORG_A, 'Northwind', [
      { sub: 'u_amara', role: 'owner' }, { sub: 'u_jonah', role: 'owner' },
    ]);
    const res = await changeRole(evt({
      method: 'PUT', sub: 'u_amara', orgId: ORG_A, role: 'owner',
      pathParams: { orgId: ORG_A, sub: 'u_amara' }, body: { role: 'member' },
    }));
    assert.strictEqual(res.statusCode, 200, res.body);
    assert.strictEqual(store.get(key(`ORG#${ORG_A}`, 'MEMBER#u_amara')).role, 'member');
  });

  await check('a plain member cannot change anybody\'s role', async () => {
    reset();
    seedOrg(ORG_A, 'Northwind', [
      { sub: 'u_amara', role: 'owner' }, { sub: 'u_priya', role: 'member' },
    ]);
    const res = await changeRole(evt({
      method: 'PUT', sub: 'u_priya', orgId: ORG_A, role: 'member',
      pathParams: { orgId: ORG_A, sub: 'u_priya' }, body: { role: 'admin' },
    }));
    assert.strictEqual(res.statusCode, 403, res.body);
    assert.strictEqual(store.get(key(`ORG#${ORG_A}`, 'MEMBER#u_priya')).role, 'member');
  });

  await check('an admin cannot make themselves an owner, nor demote the owner', async () => {
    reset();
    seedOrg(ORG_A, 'Northwind', [
      { sub: 'u_amara', role: 'owner' }, { sub: 'u_jonah', role: 'admin' },
    ]);
    // The takeover this restriction exists to stop: promote self, demote them.
    const grab = await changeRole(evt({
      method: 'PUT', sub: 'u_jonah', orgId: ORG_A, role: 'admin',
      pathParams: { orgId: ORG_A, sub: 'u_jonah' }, body: { role: 'owner' },
    }));
    assert.strictEqual(grab.statusCode, 403, grab.body);
    const push = await changeRole(evt({
      method: 'PUT', sub: 'u_jonah', orgId: ORG_A, role: 'admin',
      pathParams: { orgId: ORG_A, sub: 'u_amara' }, body: { role: 'member' },
    }));
    assert.strictEqual(push.statusCode, 403, push.body);
    assert.strictEqual(store.get(key(`ORG#${ORG_A}`, 'MEMBER#u_jonah')).role, 'admin');
    assert.strictEqual(store.get(key(`ORG#${ORG_A}`, 'MEMBER#u_amara')).role, 'owner');
  });

  await check('an unknown role is refused, never defaulted', async () => {
    reset();
    seedOrg(ORG_A, 'Northwind', [
      { sub: 'u_amara', role: 'owner' }, { sub: 'u_priya', role: 'member' },
    ]);
    const res = await changeRole(evt({
      method: 'PUT', sub: 'u_amara', orgId: ORG_A, role: 'owner',
      pathParams: { orgId: ORG_A, sub: 'u_priya' }, body: { role: 'superuser' },
    }));
    assert.strictEqual(res.statusCode, 400, res.body);
    assert.strictEqual(store.get(key(`ORG#${ORG_A}`, 'MEMBER#u_priya')).role, 'member');
  });

  await check('a stranger is a 404 and is NOT resurrected as a member', async () => {
    reset();
    seedOrg(ORG_A, 'Northwind', [{ sub: 'u_amara', role: 'owner' }]);
    const res = await changeRole(evt({
      method: 'PUT', sub: 'u_amara', orgId: ORG_A, role: 'owner',
      pathParams: { orgId: ORG_A, sub: 'u_nobody' }, body: { role: 'admin' },
    }));
    assert.strictEqual(res.statusCode, 404, res.body);
    // An Update creates the row it cannot find; that is why both Updates carry
    // attribute_exists.
    assert.strictEqual(store.get(key(`ORG#${ORG_A}`, 'MEMBER#u_nobody')), undefined);
  });

  // ── 6. Removing somebody ────────────────────────────────────────────────
  console.log('\n6. DELETE /orgs/{orgId}/members/{sub}');

  await check('both rows go, and a defaultOrgId pointing here is cleared', async () => {
    reset();
    seedOrg(ORG_A, 'Northwind', [
      { sub: 'u_amara', role: 'owner' }, { sub: 'u_priya', role: 'member' },
    ]);
    store.set(key('USER#u_priya', 'PROFILE'), {
      PK: 'USER#u_priya', SK: 'PROFILE', defaultOrgId: ORG_A,
    });
    const res = await removeMember(evt({
      method: 'DELETE', sub: 'u_amara', orgId: ORG_A, role: 'owner',
      pathParams: { orgId: ORG_A, sub: 'u_priya' },
    }));
    assert.strictEqual(res.statusCode, 200, res.body);
    assert.strictEqual(store.get(key(`ORG#${ORG_A}`, 'MEMBER#u_priya')), undefined);
    // rejects: deleting only the MEMBER row — Priya would vanish from the Team
    // screen while the authorizer still handed her a context for Northwind.
    assert.strictEqual(store.get(key('USER#u_priya', `ORG#${ORG_A}`)), undefined);
    // A default pointing at a place she cannot enter is the "my sets
    // disappeared" support thread.
    assert.strictEqual(store.get(key('USER#u_priya', 'PROFILE')).defaultOrgId, undefined);
  });

  await check('a defaultOrgId pointing SOMEWHERE ELSE is left alone', async () => {
    reset();
    seedOrg(ORG_A, 'Northwind', [
      { sub: 'u_amara', role: 'owner' }, { sub: 'u_priya', role: 'member' },
    ]);
    store.set(key('USER#u_priya', 'PROFILE'), {
      PK: 'USER#u_priya', SK: 'PROFILE', defaultOrgId: ORG_B,
    });
    const res = await removeMember(evt({
      method: 'DELETE', sub: 'u_amara', orgId: ORG_A, role: 'owner',
      pathParams: { orgId: ORG_A, sub: 'u_priya' },
    }));
    assert.strictEqual(res.statusCode, 200, res.body);
    assert.strictEqual(store.get(key('USER#u_priya', 'PROFILE')).defaultOrgId, ORG_B);
  });

  await check('THE LAST OWNER CANNOT BE REMOVED', async () => {
    reset();
    seedOrg(ORG_A, 'Northwind', [
      { sub: 'u_amara', role: 'owner' }, { sub: 'u_jonah', role: 'admin' },
    ]);
    const res = await removeMember(evt({
      method: 'DELETE', sub: 'u_amara', orgId: ORG_A, role: 'owner',
      pathParams: { orgId: ORG_A, sub: 'u_amara' },
    }));
    assert.strictEqual(res.statusCode, 409, res.body);
    assert.ok(store.get(key(`ORG#${ORG_A}`, 'MEMBER#u_amara')), 'the last owner was removed');
    assert.ok(store.get(key('USER#u_amara', `ORG#${ORG_A}`)));
  });

  await check('an admin cannot remove an owner', async () => {
    reset();
    seedOrg(ORG_A, 'Northwind', [
      { sub: 'u_amara', role: 'owner' }, { sub: 'u_ruth', role: 'owner' },
      { sub: 'u_jonah', role: 'admin' },
    ]);
    const res = await removeMember(evt({
      method: 'DELETE', sub: 'u_jonah', orgId: ORG_A, role: 'admin',
      pathParams: { orgId: ORG_A, sub: 'u_amara' },
    }));
    assert.strictEqual(res.statusCode, 403, res.body);
    assert.ok(store.get(key(`ORG#${ORG_A}`, 'MEMBER#u_amara')));
  });

  await check('a plain member cannot remove anybody', async () => {
    reset();
    seedOrg(ORG_A, 'Northwind', [
      { sub: 'u_amara', role: 'owner' }, { sub: 'u_priya', role: 'member' },
    ]);
    const res = await removeMember(evt({
      method: 'DELETE', sub: 'u_priya', orgId: ORG_A, role: 'member',
      pathParams: { orgId: ORG_A, sub: 'u_amara' },
    }));
    assert.strictEqual(res.statusCode, 403, res.body);
    assert.ok(store.get(key(`ORG#${ORG_A}`, 'MEMBER#u_amara')));
  });

  await check('an admin of another org cannot remove across the boundary', async () => {
    reset();
    seedOrg(ORG_A, 'Northwind', [{ sub: 'u_amara', role: 'owner' }, { sub: 'u_priya', role: 'member' }]);
    seedOrg(ORG_B, 'Halcyon', [{ sub: 'u_jonah', role: 'owner' }]);
    const res = await removeMember(evt({
      method: 'DELETE', sub: 'u_jonah', orgId: ORG_B, role: 'owner',
      pathParams: { orgId: ORG_A, sub: 'u_priya' },
    }));
    assert.strictEqual(res.statusCode, 403, res.body);
    assert.ok(store.get(key(`ORG#${ORG_A}`, 'MEMBER#u_priya')));
  });

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
