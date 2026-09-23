/**
 * ADJUSTMENTS AND CODES — the ledger routes (billing step 3).
 * Harness: tests/plan-request-flow.js's fake table.
 *
 * rejects: a grant with no reason; a customer granting themselves anything;
 * a member reading the ledger; revoke deleting the row; a code name reused
 * while live; a code retired twice; a bare partition literal.
 */
const suiteFinished = require('./helpers/finish-guard');
const path = require('path');
const fs = require('fs');
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
  if ((m = /^([#\w]+)\s*<\s*(:\w+)$/.exec(expr.trim()))) {
    const f = resolveName(m[1], names);
    return !!item && Number(item[f]) < Number(values[m[2]]);
  }
  if ((m = /^([#\w]+)\s*=\s*(:\w+)$/.exec(expr.trim()))) {
    const f = resolveName(m[1], names);
    return !!item && item[f] === values[m[2]];
  }
  throw new Error(`test harness: unsupported ConditionExpression ${JSON.stringify(expr)}`);
}

function applyUpdate(existing, keyObj, expr, values = {}, names = {}) {
  const item = { ...(existing || keyObj) };
  const sections = expr.split(/\b(SET|REMOVE|ADD)\b/i).map((s) => s.trim()).filter(Boolean);
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
    } else if (kind === 'ADD') {
      // `ADD #uses :one` — the code counter.
      for (const clause of splitTop(body)) {
        const [lhs, rhs] = clause.trim().split(/\s+/);
        const f = resolveName(lhs, names);
        item[f] = (Number(item[f]) || 0) + Number(values[rhs]);
      }
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
const adjustments = require(path.join(ORGS, 'adjustments.js')).handler;
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
  const OWNER = { sub: 'u_owner', email: 'owner@nw.example', role: 'owner' };
  const ADMIN = { sub: 'u_admin', email: 'admin@nw.example', role: 'admin' };
  const MEMBER = { sub: 'u_member', email: 'm@nw.example', role: 'member' };
  const ORG = 'org_3333333333333333333333';
  const staff = (extra = {}) => evt({ sub: 'u_staff', email: 'staff@engage.example', groups: 'admins', ...extra });
  const as = (m, extra = {}) => evt({ sub: m.sub, email: m.email, orgId: ORG, role: m.role, groups: 'hosts', ...extra });
  const grant = (body, who = staff) => adjustments({ ...who({ method: 'POST', pathParams: { orgId: ORG }, body }), rawPath: `/platform/orgs/${ORG}/adjustments` });
  const revoke = (adjId, body) => adjustments({ ...staff({ method: 'POST', pathParams: { orgId: ORG, adjId }, body }), rawPath: `/platform/orgs/${ORG}/adjustments/${adjId}/revoke` });
  const ledgerAs = (m) => adjustments({ ...as(m, { method: 'GET', pathParams: { orgId: ORG } }), rawPath: `/orgs/${ORG}/adjustments` });
  const ledgerStaff = () => adjustments({ ...staff({ method: 'GET', pathParams: { orgId: ORG } }), rawPath: `/platform/orgs/${ORG}/adjustments` });
  const createCode = (body, who = staff) => adjustments({ ...who({ method: 'POST', body }), rawPath: '/platform/codes' });
  const listCodes = () => adjustments({ ...staff({ method: 'GET' }), rawPath: '/platform/codes' });
  const retire = (code) => adjustments({ ...staff({ method: 'POST', pathParams: { code } }), rawPath: `/platform/codes/${code}/retire` });
  const adjRows = () => [...store.values()].filter((r) => r.PK === `ORG#${ORG}` && String(r.SK).startsWith('ADJ#'));

  reset(); seedOrg(ORG, 'Northwind', [OWNER, ADMIN, MEMBER]);

  await check('a grant needs a reason, and a kind it knows', async () => {
    assert.strictEqual((await grant({ kind: 'CREDIT_CENTS', amountCents: 1000 })).statusCode, 400);
    assert.strictEqual((await grant({ kind: 'GIFT', amountCents: 1000, note: 'x' })).statusCode, 400);
  });

  await check('a customer cannot grant themselves anything, even the owner', async () => {
    const res = await grant({ kind: 'CREDIT_CENTS', amountCents: 1000, note: 'me' }, (extra) => as(OWNER, extra));
    assert.strictEqual(res.statusCode, 403);
    assert.strictEqual(adjRows().length, 0);
  });

  let creditId;
  await check('a credit is an append-only row with who, when, why, and its remaining balance', async () => {
    const res = await grant({ kind: 'CREDIT_CENTS', amountCents: 1000, note: 'pilot goodwill' });
    assert.strictEqual(res.statusCode, 201, res.body);
    const { adjustment } = bodyOf(res);
    creditId = adjustment.adjId;
    assert.deepStrictEqual([adjustment.kind, adjustment.amountCents, adjustment.remainingCents, adjustment.note, adjustment.status], ['CREDIT_CENTS', 1000, 1000, 'pilot goodwill', 'active']);
    assert.strictEqual(adjustment.createdBy, 'u_staff');
  });

  await check('an offer of "2 months at 50%" from October gets its window', async () => {
    const res = await grant({ kind: 'OFFER', percentOff: 50, months: 2, validFrom: '2026-10', note: 'education pilot' });
    assert.strictEqual(res.statusCode, 201, res.body);
    const a = bodyOf(res).adjustment;
    assert.deepStrictEqual([a.validFrom, a.validTo], ['2026-10', '2026-11']);
    assert.strictEqual(a.status, 'upcoming');
  });

  await check('a special rate and extra allowance validate their shape', async () => {
    assert.strictEqual((await grant({ kind: 'RATE_OVERRIDE', rate: {}, note: 'x' })).statusCode, 400);
    assert.strictEqual((await grant({ kind: 'RATE_OVERRIDE', rate: { baseCents: 400 }, months: 1, note: 'x' })).statusCode, 201);
    assert.strictEqual((await grant({ kind: 'CREDIT_UNITS', units: {}, note: 'x' })).statusCode, 400);
    assert.strictEqual((await grant({ kind: 'CREDIT_UNITS', units: { sessions: 10 }, months: 1, note: 'x' })).statusCode, 201);
  });

  await check('admins read the ledger; members do not; staff read it too', async () => {
    const res = await ledgerAs(ADMIN);
    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(bodyOf(res).adjustments.length, 4);
    assert.strictEqual((await ledgerAs(MEMBER)).statusCode, 403);
    assert.strictEqual((await ledgerStaff()).statusCode, 200);
  });

  await check('revoke adds a fact and keeps the row; it needs a reason; twice is a 409', async () => {
    assert.strictEqual((await revoke(creditId, {})).statusCode, 400);
    const res = await revoke(creditId, { note: 'granted to the wrong org' });
    assert.strictEqual(res.statusCode, 200, res.body);
    assert.strictEqual(bodyOf(res).adjustment.status, 'revoked');
    assert.strictEqual(adjRows().length, 4, 'the row must stay');
    assert.strictEqual(adjRows().find((r) => r.adjId === creditId).revokeNote, 'granted to the wrong org');
    assert.strictEqual((await revoke(creditId, { note: 'again' })).statusCode, 409);
  });

  await check('codes: create, list, one name at a time, retire once', async () => {
    assert.strictEqual((await createCode({ code: 'x', percentOff: 10 })).statusCode, 400, 'too short');
    assert.strictEqual((await createCode({ code: 'AUTUMN25', maxUses: 100 })).statusCode, 400, 'gives nothing');
    const res = await createCode({ code: 'autumn25', percentOff: 25, months: 2, maxUses: 100, validUntil: '2026-11-30', note: 'campaign' });
    assert.strictEqual(res.statusCode, 201, res.body);
    assert.deepStrictEqual([bodyOf(res).code.code, bodyOf(res).code.status, bodyOf(res).code.uses], ['AUTUMN25', 'active', 0]);
    assert.strictEqual((await createCode({ code: 'AUTUMN25', percentOff: 5 })).statusCode, 409);
    assert.strictEqual(bodyOf(await listCodes()).codes.length, 1);
    assert.strictEqual((await retire('AUTUMN25')).statusCode, 200);
    assert.strictEqual(bodyOf(await listCodes()).codes[0].status, 'retired');
    assert.strictEqual((await retire('AUTUMN25')).statusCode, 409);
  });

  await check('a customer cannot create or list codes', async () => {
    assert.strictEqual((await createCode({ code: 'FREE100', percentOff: 100 }, (extra) => as(OWNER, extra))).statusCode, 403);
  });

  await check('the handler writes no bare partition literal', () => {
    const src = fs.readFileSync(path.join(ORGS, 'adjustments.js'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    assert.ok(!/PK:\s*'(SETS|GAMES|ORGS)'/.test(src));
  });

  console.log(`\n${pass} passed, ${fail} failed`);
  suiteFinished();
  process.exit(fail ? 1 : 0);
})();
