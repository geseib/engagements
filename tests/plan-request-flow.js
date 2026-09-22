/**
 * PLAN REQUESTS — the state machine, the two sides, and the rows.
 *
 * docs/handoff/billing-experience-2026-09-22.md §2.1; mockups 13–15 in
 * docs/design/tenancy-redesign. The harness is tests/org-lifecycle.js's fake
 * table (conditions evaluated before a transaction, all-or-nothing writes).
 *
 * rejects: a member (not owner) asking; two open requests; a decision with no
 * note; approval that changes only one of the two org rows; a stale second
 * decision winning; staff routes open to anyone signed in; a bare partition
 * literal anywhere in the handler.
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
const planRequests = require(path.join(ORGS, 'plan-requests.js')).handler;
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
  const ORG = 'org_2222222222222222222222';
  const staff = (extra = {}) => evt({ sub: 'u_staff', email: 'staff@engage.example', groups: 'admins', ...extra });
  const as = (m, extra = {}) => evt({ sub: m.sub, email: m.email, orgId: ORG, role: m.role, groups: 'hosts', ...extra });
  const ask = (m, body = {}) => planRequests(as(m, { method: 'POST', pathParams: { orgId: ORG }, body }));
  const mine = (m) => planRequests(as(m, { method: 'GET', pathParams: { orgId: ORG } }));
  const withdraw = (m, reqId) => planRequests(as(m, { method: 'DELETE', pathParams: { orgId: ORG, reqId } }));
  const queue = (status) => planRequests({ ...staff({ method: 'GET' }), rawPath: '/platform/plan-requests', queryStringParameters: status ? { status } : undefined });
  const decide = (reqId, body, who = staff) => planRequests({ ...who({ method: 'POST', pathParams: { orgId: ORG, reqId }, body }), rawPath: `/platform/plan-requests/${ORG}/${reqId}/decide` });
  const meta = () => store.get(key(`ORG#${ORG}`, 'METADATA'));
  const index = () => store.get(key('ORGS', `ORG#${ORG}`));
  const queueRows = (status) => [...store.values()].filter((r) => r.PK === 'ORGS' && String(r.SK).startsWith(`PLANREQ#${status}#`));
  const seedCode = (code, extra = {}) => store.set(key('ORGS', `CODE#${code}`), { PK: 'ORGS', SK: `CODE#${code}`, RecordType: 'CODE', code, percentOff: 30, months: 3, maxUses: 50, uses: 12, validUntil: '2026-12-31', createdAt: '2026-08-01T00:00:00Z', ...extra });
  const adjRows = () => [...store.values()].filter((r) => r.PK === `ORG#${ORG}` && String(r.SK).startsWith('ADJ#'));

  await check('only an OWNER can ask; an admin is refused', async () => {
    reset(); seedOrg(ORG, 'Northwind', [OWNER, ADMIN, MEMBER]); seedCode('WELCOME30');
    assert.strictEqual((await ask(ADMIN, { toPlan: 'team' })).statusCode, 403);
    assert.strictEqual((await ask(MEMBER, { toPlan: 'team' })).statusCode, 403);
  });

  let reqId;
  await check('the owner asks: a row on the org, a pointer in the queue, plan untouched', async () => {
    const res = await ask(OWNER, { toPlan: 'team', note: 'Programme for 40 in October', code: 'welcome30' });
    assert.strictEqual(res.statusCode, 201, res.body);
    const { request } = bodyOf(res);
    reqId = request.reqId;
    assert.deepStrictEqual([request.status, request.fromPlan, request.toPlan, request.code], ['requested', 'free', 'team', 'WELCOME30']);
    assert.strictEqual(queueRows('requested').length, 1);
    assert.strictEqual(meta().plan, 'free', 'asking must not change the plan');
  });

  await check('a second open request is refused with 409', async () => {
    assert.strictEqual((await ask(OWNER, { toPlan: 'team' })).statusCode, 409);
  });

  await check('an admin can read the history; a member cannot', async () => {
    const res = await mine(ADMIN);
    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(bodyOf(res).requests.length, 1);
    assert.strictEqual((await mine(MEMBER)).statusCode, 403);
  });

  await check('the queue is staff-only, and lists the waiting request with its org name', async () => {
    const nobody = await planRequests({ ...as(OWNER, { method: 'GET' }), rawPath: '/platform/plan-requests' });
    assert.strictEqual(nobody.statusCode, 403);
    const res = await queue();
    assert.strictEqual(res.statusCode, 200, res.body);
    const [row] = bodyOf(res).requests;
    assert.strictEqual(row.reqId, reqId);
    assert.strictEqual(row.orgName, 'Northwind');
    assert.strictEqual(row.note, 'Programme for 40 in October');
  });

  await check('a decision with no note is refused — the customer reads it', async () => {
    assert.strictEqual((await decide(reqId, { decision: 'approved' })).statusCode, 400);
    assert.strictEqual((await decide(reqId, { decision: 'maybe', note: 'x' })).statusCode, 400);
  });

  await check('approval changes BOTH org rows, writes a PLAN_CHANGE ledger row, and moves the pointer', async () => {
    const res = await decide(reqId, { decision: 'approved', note: 'Welcome aboard' });
    assert.strictEqual(res.statusCode, 200, res.body);
    assert.strictEqual(bodyOf(res).plan, 'team');
    assert.strictEqual(meta().plan, 'team');
    assert.strictEqual(index().plan, 'team', 'the ORGS index row must agree, or the platform list lies');
    const ledger = [...store.values()].find((r) => r.PK === `ORG#${ORG}` && String(r.SK).includes('#PLAN_CHANGE#'));
    assert.ok(ledger, 'no PLAN_CHANGE ledger row');
    assert.deepStrictEqual([ledger.fromPlan, ledger.toPlan, ledger.note], ['free', 'team', 'Welcome aboard']);
    assert.strictEqual(queueRows('requested').length, 0);
    assert.strictEqual(queueRows('approved').length, 1);
    const hist = bodyOf(await mine(OWNER));
    assert.strictEqual(hist.plan, 'team');
    assert.strictEqual(hist.requests[0].decisionNote, 'Welcome aboard');
  });

  await check('approval REDEEMS the code in the same transaction: an ADJ row, a CODEUSE row, the counter up one', async () => {
    const adj = adjRows();
    assert.strictEqual(adj.length, 1, 'one CODE_REDEMPTION row');
    assert.deepStrictEqual([adj[0].kind, adj[0].code, adj[0].percentOff, adj[0].validTo], ['CODE_REDEMPTION', 'WELCOME30', 30, '2026-11']);
    assert.ok(store.get(key(`ORG#${ORG}`, 'CODEUSE#WELCOME30')), 'no CODEUSE row');
    assert.strictEqual(store.get(key('ORGS', 'CODE#WELCOME30')).uses, 13);
    assert.strictEqual(bodyOf(await mine(OWNER)).requests[0].codeApplied, 'WELCOME30');
  });

  await check('a decided request cannot be decided again', async () => {
    assert.strictEqual((await decide(reqId, { decision: 'declined', note: 'too late' })).statusCode, 409);
    assert.strictEqual(meta().plan, 'team');
  });

  await check('already on the plan → asking again is a 400, not a second request', async () => {
    assert.strictEqual((await ask(OWNER, { toPlan: 'team' })).statusCode, 400);
  });

  await check('a code that cannot be redeemed refuses the approval with the reason; dropCode approves without it', async () => {
    reset(); seedOrg(ORG, 'Northwind', [OWNER]); seedCode('LAUNCH50', { validUntil: '2026-08-31' });
    const { request } = bodyOf(await ask(OWNER, { toPlan: 'team', code: 'LAUNCH50' }));
    const res = await decide(request.reqId, { decision: 'approved', note: 'ok' });
    assert.strictEqual(res.statusCode, 409, res.body);
    assert.ok(/expired/.test(bodyOf(res).error), bodyOf(res).error);
    assert.strictEqual(meta().plan, 'free', 'nothing changed on a refused approval');
    const ok = await decide(request.reqId, { decision: 'approved', note: 'The code had expired; approved without it.', dropCode: true });
    assert.strictEqual(ok.statusCode, 200, ok.body);
    assert.strictEqual(meta().plan, 'team');
    assert.strictEqual(adjRows().length, 0);
  });

  await check('a declined request burns no use of its code', async () => {
    reset(); seedOrg(ORG, 'Northwind', [OWNER]); seedCode('WELCOME30');
    const { request } = bodyOf(await ask(OWNER, { toPlan: 'team', code: 'WELCOME30' }));
    await decide(request.reqId, { decision: 'declined', note: 'Not yet.' });
    assert.strictEqual(store.get(key('ORGS', 'CODE#WELCOME30')).uses, 12);
    assert.strictEqual(adjRows().length, 0);
  });

  await check('decline leaves the plan alone and quotes the reason; the owner may ask again at once', async () => {
    reset(); seedOrg(ORG, 'Northwind', [OWNER]);
    const { request } = bodyOf(await ask(OWNER, { toPlan: 'team' }));
    const res = await decide(request.reqId, { decision: 'declined', note: 'That code expired in August.' });
    assert.strictEqual(res.statusCode, 200, res.body);
    assert.strictEqual(meta().plan, 'free');
    assert.ok(![...store.values()].some((r) => String(r.SK).includes('#PLAN_CHANGE#')), 'a decline writes no ledger row');
    assert.strictEqual(bodyOf(await mine(OWNER)).requests[0].decisionNote, 'That code expired in August.');
    assert.strictEqual((await ask(OWNER, { toPlan: 'team' })).statusCode, 201, 'Q1: re-requestable immediately');
  });

  await check('withdraw is the owner\'s, only while waiting', async () => {
    reset(); seedOrg(ORG, 'Northwind', [OWNER, ADMIN]);
    const { request } = bodyOf(await ask(OWNER, { toPlan: 'team' }));
    assert.strictEqual((await withdraw(ADMIN, request.reqId)).statusCode, 403);
    assert.strictEqual((await withdraw(OWNER, request.reqId)).statusCode, 200);
    assert.strictEqual(queueRows('requested').length, 0);
    assert.strictEqual(queueRows('withdrawn').length, 1);
    assert.strictEqual((await withdraw(OWNER, request.reqId)).statusCode, 409);
  });

  await check('a stale second decision loses when the transaction is cancelled', async () => {
    reset(); seedOrg(ORG, 'Northwind', [OWNER]);
    const { request } = bodyOf(await ask(OWNER, { toPlan: 'team' }));
    control.failNextTransact = 'TransactionCanceledException';
    const res = await decide(request.reqId, { decision: 'approved', note: 'x' });
    assert.strictEqual(res.statusCode, 409);
    assert.strictEqual(meta().plan, 'free');
  });

  await check('the handler writes no bare partition literal', () => {
    const src = fs.readFileSync(path.join(ORGS, 'plan-requests.js'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    assert.ok(!/PK:\s*'(SETS|GAMES|ORGS)'/.test(src));
    assert.ok(/tenant\.ORGS_INDEX_PK/.test(src) && /tenant\.orgPk\(/.test(src));
  });

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
