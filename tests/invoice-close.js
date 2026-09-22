/**
 * SIMULATED INVOICES — closed by the reconciler, read back frozen (step 4).
 *
 * rejects: a second night writing a second invoice; a credit spent twice; a
 * free month left as a gap instead of a $0.00 row; an invoice that recomputes
 * from the ledger instead of reading its snapshot; a non-member reading one.
 */
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
  // `attribute_not_exists(#peak) OR #peak < :c` — the peak-set counter.
  if (/\sOR\s/.test(expr)) {
    return expr.split(/\sOR\s/).some((part) => evalCondition(part.trim(), item, values, names));
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
const reconcile = require(path.join(REPO, 'lambda-functions/admin/usage-reconcile.js')).handler;
const getUsage = require(path.join(REPO, 'lambda-functions/admin/get-usage.js')).handler;
const { previousPeriod } = require(path.join(REPO, 'lambda-functions/admin/usage-reconcile.js'));
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
  const OUTSIDER = { sub: 'u_out', email: 'o@x.example', role: 'owner' };
  const ORG = 'org_4444444444444444444444';
  const OTHER = 'org_5555555555555555555555';
  const staff = (extra = {}) => evt({ sub: 'u_staff', email: 'staff@engage.example', groups: 'admins', ...extra });
  const grant = (body) => adjustments({ ...staff({ method: 'POST', pathParams: { orgId: ORG }, body }), rawPath: `/platform/orgs/${ORG}/adjustments` });
  // `acting` is the org the caller's token names; `org` is the one in the path.
  const usageEvt = (m, org, rawPath, extra = {}, acting = org) => ({
    requestContext: { http: { method: 'GET' }, authorizer: { lambda: { userId: m.sub, email: m.email, orgId: acting, orgRole: m.role, groups: 'hosts' } } },
    pathParameters: { orgId: org, ...(extra.period ? { period: extra.period } : {}) },
    rawPath,
  });
  const invoiceRow = (org, p) => store.get(key(`ORG#${org}`, `INVOICE#${p}`));
  const AUG = '2026-08';
  const SEP_1 = new Date('2026-09-01T00:05:00Z');

  // A Team org that ran 20 sessions in August with a code and a credit.
  reset(); seedOrg(ORG, 'Northwind', [OWNER]); seedOrg(OTHER, 'Globex', [OUTSIDER]);
  store.get(key(`ORG#${ORG}`, 'METADATA')).plan = 'team';
  store.set(key(`ORG#${ORG}`, `USAGE#${AUG}`), { PK: `ORG#${ORG}`, SK: `USAGE#${AUG}`, sessionsRun: 20, setsPeak: 2, setsCurrent: 2 });
  for (let i = 0; i < 20; i += 1) store.set(key(`ORG#${ORG}`, `LEDGER#${AUG}#SESSION#g${i}`), { PK: `ORG#${ORG}`, SK: `LEDGER#${AUG}#SESSION#g${i}` });
  await grant({ kind: 'OFFER', percentOff: 30, months: 3, validFrom: AUG, note: 'welcome' });
  const creditRes = await grant({ kind: 'CREDIT_CENTS', amountCents: 1000, validFrom: AUG, note: 'pilot goodwill' });
  const creditId = bodyOf(creditRes).adjustment.adjId;

  await check('the nightly run on 1 Sep closes August: $8.75 list → 30% → credit → $0.00, credit drawn to $3.88', async () => {
    await reconcile({ now: SEP_1.toISOString() });
    const inv = invoiceRow(ORG, AUG);
    assert.ok(inv, 'no invoice row');
    assert.deepStrictEqual([inv.status, inv.simulated, inv.listCents, inv.totalCents, inv.savingsPercent], ['closed', true, 875, 0, 100]);
    assert.strictEqual(inv.settlement.kind, 'simulated');
    assert.strictEqual(inv.settlement.chargedCents, 0);
    assert.strictEqual(inv.settlement.wouldHaveChargedCents, 0);
    assert.ok(/^SIM-/.test(inv.number), inv.number);
    assert.ok(/This is a simulation\. No card was charged\./.test(inv.sentence));
    const credit = [...store.values()].find((r) => r.adjId === creditId);
    assert.strictEqual(credit.remainingCents, 388, 'the credit was not drawn down');
    assert.ok(store.get(key(`ORG#${ORG}`, `LEDGER#${AUG}#CREDIT_APPLIED#${creditId}`)), 'no CREDIT_APPLIED ledger row');
    assert.ok(store.get(key('ORGS', `INVOICE#${AUG}#${ORG}`)), 'no platform pointer');
  });

  await check('a second night is a no-op: one invoice, the credit not spent again', async () => {
    await reconcile({ now: new Date('2026-09-02T00:05:00Z').toISOString() });
    assert.strictEqual([...store.values()].filter((r) => r.PK === `ORG#${ORG}` && String(r.SK).startsWith('INVOICE#')).length, 1);
    assert.strictEqual([...store.values()].find((r) => r.adjId === creditId).remainingCents, 388);
  });

  await check('a FREE org gets a $0.00 invoice, not a gap', async () => {
    const inv = invoiceRow(OTHER, AUG);
    assert.ok(inv, 'the free org has no August invoice');
    assert.strictEqual(inv.totalCents, 0);
    assert.strictEqual(inv.planId, 'personal');
  });

  await check('the invoice is read back FROZEN — revoking the code afterwards does not change August', async () => {
    const offer = [...store.values()].find((r) => r.PK === `ORG#${ORG}` && r.kind === 'OFFER');
    await adjustments({ ...staff({ method: 'POST', pathParams: { orgId: ORG, adjId: offer.adjId }, body: { note: 'oops' } }), rawPath: `/platform/orgs/${ORG}/adjustments/${offer.adjId}/revoke` });
    const res = await getUsage(usageEvt(OWNER, ORG, `/orgs/${ORG}/invoices/${AUG}`, { period: AUG }));
    assert.strictEqual(res.statusCode, 200, res.body);
    const { invoice } = JSON.parse(res.body);
    assert.strictEqual(invoice.discounts[0].amountCents, 263, 'August must still show the 30% it was closed with');
    assert.strictEqual(invoice.totalCents, 0);
  });

  await check('the list is newest first and a member of another org cannot read it', async () => {
    const list = JSON.parse((await getUsage(usageEvt(OWNER, ORG, `/orgs/${ORG}/invoices`))).body);
    assert.strictEqual(list.invoices.length, 1);
    assert.strictEqual(list.invoices[0].period, AUG);
    const denied = await getUsage(usageEvt(OUTSIDER, ORG, `/orgs/${ORG}/invoices`, {}, OTHER));
    assert.strictEqual(denied.statusCode, 403);
    const missing = await getUsage(usageEvt(OWNER, ORG, `/orgs/${ORG}/invoices/2026-07`, { period: '2026-07' }));
    assert.strictEqual(missing.statusCode, 404);
  });

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
