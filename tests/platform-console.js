/**
 * THE PLATFORM CONSOLE'S TWO POWERS, AND THE ONE AN ORGANISATION GAINED.
 *
 * Three things were asked for together, and they are one design:
 *
 *   "i do need a super admin role that sees the overall system, can approve
 *    orgs, moderate etc. i think that is missing"
 *   "every org should get access to the basic default prompts and questions set
 *    from the system. as well as any public ones. org admins and host should be
 *    able to copy these and modify their creations and copies, but not the ones
 *    managed by the engage admin."
 *
 * The refusals already existed — `canManageSet` says no to a platform set for
 * anybody who is not Engage staff, and `canManageScope` gives staff no scope
 * inside a customer's organisation. What did not exist was either WAY OUT of
 * those refusals: staff could not administer an organisation at all, and an org
 * could see the shared library without being able to make anything of it.
 *
 * The most important assertions in this file are the ones about what the new
 * powers still CANNOT do, because a staff console is exactly where the
 * isolation guarantee would be quietly given away.
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
      /*
        BATCH WRITE, WHICH THE BORROWED HARNESS DECLARED AND DID NOT IMPLEMENT.

        `BatchWriteCommand` was in the class list but had no case here, so
        `send` fell through and returned undefined — every batched Put SILENTLY
        DID NOTHING. The copy handler reported "3 rows copied" and wrote none of
        them, and the first failure pointed at the assertion rather than at the
        fixture. Worth the comment: a stub that ignores a command is
        indistinguishable from a handler that never issued it.
      */
      case 'batchWrite': {
        const perTable = inp.RequestItems || {};
        for (const requests of Object.values(perTable)) {
          for (const r of requests) {
            if (r.PutRequest) {
              const it = r.PutRequest.Item;
              store.set(key(it.PK, it.SK), it);
            } else if (r.DeleteRequest) {
              const k = r.DeleteRequest.Key;
              store.delete(key(k.PK, k.SK));
            }
          }
        }
        // Nothing unprocessed: the real client's retry path is exercised by
        // tests/set-versioning-flow.js, not here.
        return { UnprocessedItems: {} };
      }
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
const platformOrgs = require(path.join(ORGS, 'platform-orgs.js')).handler;
const copySet = require(path.join(REPO, 'lambda-functions/admin/copy-question-set.js')).handler;
const G = require(path.join(ORGS, 'shared/org-guards.js'));
const {
  plainRow, forgetAllOrgs, installTestKeyLoader,
} = require('./helpers/tenant-crypto-stub');

/*
  THE DETERMINISTIC KEY LOADER, NOT `mintOrg`, AND THE DIFFERENCE MATTERS.

  Written first with `mintOrg`, which calls the real `createOrgDataKey` and so
  mints a RANDOM data key per organisation. `plainRow` — the assertion side —
  derives its key from the orgId instead. The two never matched, and every
  decrypt failed with "Unsupported state or unable to authenticate data", which
  reads exactly like a bug in the encryption rather than a fixture using two
  different keys for the same tenant.

  `installTestKeyLoader` makes both sides derive the same key from the orgId,
  which is also stable across the three bundle copies and across a `reset()`,
  and still DIFFERENT PER ORG — so a cross-tenant decrypt fails here exactly as
  it would in production.
*/
installTestKeyLoader();

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
  /* Every bundle's key cache too. Without this a later assertion decrypts with
     a key whose wrapped blob was cleared out of the store two tests ago, and
     the failure reads as a crypto bug rather than a fixture one. */
  forgetAllOrgs();
}


function reset() {
  store.clear();
  for (const k of Object.keys(counts)) counts[k] = 0;
  control.failNextTransact = null;
  /* Every bundle's key cache too. Without this a later assertion decrypts with
     a key whose wrapped blob was cleared out of the store two tests ago, and
     the failure reads as a crypto bug rather than a fixture one. */
  forgetAllOrgs();
}

/*
  REAL-SHAPED ORG IDS. `isOrgId` requires `org_` plus 22 base58 characters, and
  it is right to: an id that is not minted did not come from `mintOrgId`, and a
  route that accepts one accepts a guess. The first cut of this fixture used
  `org_nw`, every status change came back 400 "That is not an organisation id",
  and one assertion PASSED for that reason rather than the one it names — the
  refusal of an unknown status was really the refusal of the id.
*/
const NW = 'org_9xK4Fq7Pz2mNbVc8dQwLxR';
const HOME = 'org_3JtYs6WgHn5RkMqZaB7uEv';
const OTHER = 'org_Tb2VnQ8sLxK4WmC7gRdYpF';

const STAFF = { sub: 'u_staff', groups: 'admins,hosts' };
const HOST = { sub: 'u_host', groups: 'hosts' };

/**
 * Seed an organisation.
 *
 * No `dataKeyCiphertext` on the row: `installTestKeyLoader` above supplies the
 * blob for any org id, which is what lets a test invent an organisation halfway
 * through without re-seeding a METADATA row after every `reset()`.
 */
async function seedOrg(orgId, name, { type = 'team', status = 'active', members = ['u_host'] } = {}) {
  const existing = {};
  const row = {
    orgId, name, plan: 'free', status, type, createdAt: '2026-02-01T00:00:00.000Z',
  };
  store.set(key(`ORG#${orgId}`, 'METADATA'), {
    PK: `ORG#${orgId}`, SK: 'METADATA', ...existing, ...row,
  });
  store.set(key('ORGS', `ORG#${orgId}`), { PK: 'ORGS', SK: `ORG#${orgId}`, ...row });
  for (const sub of members) {
    store.set(key(`ORG#${orgId}`, `MEMBER#${sub}`), {
      PK: `ORG#${orgId}`, SK: `MEMBER#${sub}`, orgId, userId: sub, role: 'owner',
    });
  }
}

/** A platform set with two questions and one category, exactly as dev holds. */
function seedPlatformSet(setId, name) {
  store.set(key('SETS', `SET#${setId}`), {
    PK: 'SETS', SK: `SET#${setId}`, name, description: 'A shared set.',
    engagementType: 'trivia', questionCount: 2, categoryCount: 1,
    active: true, Quickstart: true,
  });
  store.set(key(`SET#${setId}`, 'CATEGORY#c001'), {
    PK: `SET#${setId}`, SK: 'CATEGORY#c001', Name: 'Pricing', QuestionCount: 2,
  });
  for (const n of ['q001', 'q002']) {
    store.set(key(`SET#${setId}`, `QUESTION#${n}`), {
      PK: `SET#${setId}`, SK: `QUESTION#${n}`, Title: `Question ${n}`,
      Detail: 'The body.', optionA: 'a', correctAnswer: 'OptionA',
    });
  }
}

const say = (s) => console.log(s);

(async () => {
  /* ── 1. WHO MAY OPEN THE STAFF CONSOLE ──────────────────────────────── */
  say('\n1. the staff console is for Engage staff, and being an owner is not that');

  await check('a platform admin lists every organisation', async () => {
    reset();
    await seedOrg(NW, 'Northwind');
    await seedOrg(HOME, 'Amara Reyes', { type: 'personal', members: ['u_host'] });
    const res = await platformOrgs(evt({ method: 'GET', ...STAFF }));
    assert.strictEqual(res.statusCode, 200, res.body);
    const { orgs, counts: c } = bodyOf(res);
    assert.strictEqual(orgs.length, 2);
    assert.strictEqual(c.teams, 1);
    assert.strictEqual(c.personal, 1);
  });

  // rejects: reading the platform group off an ORG role. Owning one
  // organisation must never list or suspend anybody else's — that is the whole
  // reason isAdminCaller was split into isPlatformAdmin and canManageScope.
  await check('the OWNER of an organisation cannot list the others', async () => {
    reset();
    await seedOrg(NW, 'Northwind');
    const res = await platformOrgs(evt({
      method: 'GET', ...HOST, orgId: NW, role: 'owner',
    }));
    assert.strictEqual(res.statusCode, 403, res.body);
  });

  // rejects: a staff list that buries paying teams under the personal spaces,
  // which outnumber them by construction — every account has one.
  await check('teams sort above personal spaces', async () => {
    reset();
    await seedOrg(HOME, 'Amara', { type: 'personal' });
    await seedOrg(NW, 'Northwind');
    const { orgs } = bodyOf(await platformOrgs(evt({ method: 'GET', ...STAFF })));
    assert.deepStrictEqual(orgs.map((o) => o.type), ['team', 'personal']);
  });

  await check('member counts are real, not a stored guess', async () => {
    reset();
    await seedOrg(NW, 'Northwind', { members: ['u_a', 'u_b', 'u_c'] });
    const { orgs } = bodyOf(await platformOrgs(evt({ method: 'GET', ...STAFF })));
    assert.strictEqual(orgs[0].members, 3);
  });

  /* ── 2. WHAT THE STAFF CONSOLE STILL CANNOT DO ──────────────────────── */
  say('\n2. and it still cannot reach a single row of anybody\'s content');

  // THE ISOLATION ASSERTION. A staff screen is exactly where this would be
  // given away by accident, so it is asserted on the response itself rather
  // than trusted to the absence of a link.
  // rejects: a listing that grows a `sets`, `games` or `questions` field, or
  //          any other route into a tenant partition.
  await check('the listing carries no content field of any kind', async () => {
    reset();
    await seedOrg(NW, 'Northwind');
    seedPlatformSet('80strivia', '80s Trivia');
    store.set(key(`ORG#${NW}#SETS`, 'SET#secret'), {
      PK: `ORG#${NW}#SETS`, SK: 'SET#secret', name: 'Q3 Restructure Retro',
    });
    const { orgs } = bodyOf(await platformOrgs(evt({ method: 'GET', ...STAFF })));
    const serialised = JSON.stringify(orgs);
    assert.ok(!/secret|Restructure/.test(serialised), `content leaked: ${serialised}`);
    for (const forbidden of ['sets', 'games', 'questions', 'reports']) {
      assert.ok(!(forbidden in orgs[0]), `${forbidden} must not be on this row`);
    }
  });

  /* ── 3. APPROVING AND SUSPENDING ────────────────────────────────────── */
  say('\n3. approve, suspend, and lift a suspension');

  await check('a pending organisation is approved, on BOTH rows', async () => {
    reset();
    await seedOrg(NW, 'Northwind', { status: 'pending' });
    const res = await platformOrgs(evt({
      method: 'POST', ...STAFF, pathParams: { orgId: NW }, body: { status: 'active' },
    }));
    assert.strictEqual(res.statusCode, 200, res.body);
    // rejects: writing one row only — an organisation that reads as approved on
    // the staff screen and as pending to every guard, or the reverse.
    assert.strictEqual(store.get(key(`ORG#${NW}`, 'METADATA')).status, 'active');
    assert.strictEqual(store.get(key('ORGS', `ORG#${NW}`)).status, 'active');
  });

  await check('a suspension records who did it and when', async () => {
    reset();
    await seedOrg(NW, 'Northwind');
    await platformOrgs(evt({
      method: 'POST', ...STAFF, pathParams: { orgId: NW }, body: { status: 'suspended' },
    }));
    const meta = store.get(key(`ORG#${NW}`, 'METADATA'));
    assert.strictEqual(meta.status, 'suspended');
    assert.strictEqual(meta.statusChangedBy, 'u_staff');
    assert.ok(meta.statusChangedAt, 'the time must be recorded');
  });

  // rejects: suspending somebody's own home, which is an account deletion with
  // a friendlier name — the home cannot be left or deleted by its owner and
  // holds everything they have ever made. The lever for a person is their
  // account, which is reversible and visible to them.
  await check('a PERSONAL space cannot be suspended from here', async () => {
    reset();
    await seedOrg(HOME, 'Amara', { type: 'personal' });
    const res = await platformOrgs(evt({
      method: 'POST', ...STAFF, pathParams: { orgId: HOME }, body: { status: 'suspended' },
    }));
    assert.strictEqual(res.statusCode, 409, res.body);
    assert.strictEqual(store.get(key(`ORG#${HOME}`, 'METADATA')).status, 'active');
  });

  await check('an unknown status is refused rather than stored', async () => {
    reset();
    await seedOrg(NW, 'Northwind');
    const res = await platformOrgs(evt({
      method: 'POST', ...STAFF, pathParams: { orgId: NW }, body: { status: 'deleted' },
    }));
    assert.strictEqual(res.statusCode, 400, res.body);
  });

  await check('a host cannot suspend anybody', async () => {
    reset();
    await seedOrg(NW, 'Northwind');
    const res = await platformOrgs(evt({
      method: 'POST', ...HOST, orgId: NW, role: 'owner',
      pathParams: { orgId: NW }, body: { status: 'suspended' },
    }));
    assert.strictEqual(res.statusCode, 403, res.body);
  });

  /* ── 4. COPYING A SHARED SET ────────────────────────────────────────── */
  say('\n4. an organisation takes a copy of a set it may read but not change');

  await check('every row lands in the org\'s own partition', async () => {
    reset();
    await seedOrg(NW, 'Northwind');
    seedPlatformSet('80strivia', '80s Trivia');
    const res = await copySet(evt({
      method: 'POST', ...HOST, orgId: NW, role: 'member',
      pathParams: { setId: '80strivia' }, body: { scope: 'platform' },
    }));
    assert.strictEqual(res.statusCode, 201, res.body);
    const out = bodyOf(res);
    assert.strictEqual(out.rowsCopied, 3);
    assert.ok(store.has(key(`ORG#${NW}#SETS`, `SET#${out.setId}`)), 'metadata must exist');
    assert.ok(store.has(key(`ORG#${NW}#SET#${out.setId}`, 'QUESTION#q001')));
    assert.ok(store.has(key(`ORG#${NW}#SET#${out.setId}`, 'CATEGORY#c001')));
  });

  // rejects: copying plaintext straight into an org partition. The source has
  // no tenant and is in the clear; the destination has one. A copy that stayed
  // plaintext would be indistinguishable from the org's own work and silently
  // outside the guarantee its owner was given.
  await check('the questions are ENCRYPTED on the way in', async () => {
    reset();
    await seedOrg(NW, 'Northwind');
    seedPlatformSet('80strivia', '80s Trivia');
    const { setId } = bodyOf(await copySet(evt({
      method: 'POST', ...HOST, orgId: NW, role: 'member',
      pathParams: { setId: '80strivia' }, body: { scope: 'platform' },
    })));
    const raw = store.get(key(`ORG#${NW}#SET#${setId}`, 'QUESTION#q001'));
    assert.notStrictEqual(raw.Title, 'Question q001', 'Title must not be stored in the clear');
    assert.strictEqual(plainRow(NW, raw).Title, 'Question q001', 'and must decrypt back');
    // The category NAME stays readable, exactly as an org's own sets do — it
    // carries the 24-bit mask ordering.
    assert.strictEqual(store.get(key(`ORG#${NW}#SET#${setId}`, 'CATEGORY#c001')).Name, 'Pricing');
  });

  // rejects: a copy that keeps a link to its source. An Engage admin editing
  // the platform set would then change a set a customer had already reviewed.
  await check('the copy is independent, and records only where it came from', async () => {
    reset();
    await seedOrg(NW, 'Northwind');
    seedPlatformSet('80strivia', '80s Trivia');
    const { setId } = bodyOf(await copySet(evt({
      method: 'POST', ...HOST, orgId: NW, role: 'member',
      pathParams: { setId: '80strivia' }, body: { scope: 'platform' },
    })));
    const meta = plainRow(NW, store.get(key(`ORG#${NW}#SETS`, `SET#${setId}`)));
    assert.strictEqual(meta.sourceSetId, '80strivia');
    assert.strictEqual(meta.sourceScope, 'platform');
    assert.strictEqual(meta.scope, 'org');
    assert.strictEqual(meta.orgId, NW);
    // rejects: inheriting the platform set's standing. A copy of a quickstart
    // is not one of Engage's quickstarts, and a copy of a published set is not
    // published.
    assert.strictEqual(meta.Quickstart, false);
    assert.strictEqual(meta.visibility, 'private');
    // The source is untouched.
    assert.ok(store.has(key('SETS', 'SET#80strivia')));
    assert.strictEqual(store.get(key('SETS', 'SET#80strivia')).name, '80s Trivia');
  });

  // rejects: overwriting an existing set of the same name. setId is a slug of
  // the title, so a second copy collides — and in one partition a collision is
  // a silent destruction of whatever was already there.
  await check('a second copy does not clobber the first', async () => {
    reset();
    await seedOrg(NW, 'Northwind');
    seedPlatformSet('80strivia', '80s Trivia');
    const call = () => copySet(evt({
      method: 'POST', ...HOST, orgId: NW, role: 'member',
      pathParams: { setId: '80strivia' }, body: { scope: 'platform' },
    }));
    const a = bodyOf(await call());
    const b = bodyOf(await call());
    assert.notStrictEqual(a.setId, b.setId, 'the second copy needs its own id');
    assert.ok(store.has(key(`ORG#${NW}#SETS`, `SET#${a.setId}`)), 'the first must survive');
    assert.ok(store.has(key(`ORG#${NW}#SETS`, `SET#${b.setId}`)));
  });

  await check('copying with no organisation chosen is refused', async () => {
    reset();
    seedPlatformSet('80strivia', '80s Trivia');
    const res = await copySet(evt({
      method: 'POST', ...HOST, pathParams: { setId: '80strivia' }, body: { scope: 'platform' },
    }));
    assert.strictEqual(res.statusCode, 403, res.body);
  });

  // rejects: accepting `org` as a source scope, which would be a route for one
  // organisation to name another's partition and read it.
  await check('only the shared and public libraries can be copied FROM', async () => {
    reset();
    await seedOrg(NW, 'Northwind');
    await seedOrg(OTHER, 'Someone Else');
    store.set(key(`ORG#${OTHER}#SETS`, 'SET#theirs'), {
      PK: `ORG#${OTHER}#SETS`, SK: 'SET#theirs', name: 'Q3 Restructure Retro',
    });
    const res = await copySet(evt({
      method: 'POST', ...HOST, orgId: NW, role: 'member',
      pathParams: { setId: 'theirs' }, body: { scope: 'org', orgId: OTHER },
    }));
    assert.strictEqual(res.statusCode, 400, res.body);
  });

  await check('a set that is not in the shared library is a 404, not a blank copy', async () => {
    reset();
    await seedOrg(NW, 'Northwind');
    const res = await copySet(evt({
      method: 'POST', ...HOST, orgId: NW, role: 'member',
      pathParams: { setId: 'nosuchset' }, body: { scope: 'platform' },
    }));
    assert.strictEqual(res.statusCode, 404, res.body);
  });

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exitCode = fail ? 1 : 0;
})();
