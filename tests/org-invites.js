/**
 * INVITATIONS — mint, accept, revoke.
 *
 * `accept-invite.js` is the only route in the product that lets somebody into a
 * tenant they are not already in, so it is the one place where a mistake is not
 * a bug but a breach. Four things stand between an outsider and a customer's
 * data, and every one of them is asserted here:
 *
 *   the token's SHAPE      — it names its own partition, so an unvalidated one
 *                            aims a Get at any key the caller can spell
 *   the row EXISTING       — revoking IS deleting; there is no revoked flag
 *   the EXPIRY             — compared in the handler, because DynamoDB's TTL
 *                            sweep is "typically within 48 hours" and promises
 *                            nothing, so a dead invitation is still READABLE
 *   the ADDRESSEE          — the invitation's email must equal the caller's,
 *                            or a forwarded link is a working credential
 *
 * And two shapes that are not security but are the difference between a
 * feature and a support queue: accepting twice must succeed (people
 * double-click, mail clients prefetch), and pressing Resend must not mint a
 * second live token for the same address.
 *
 * rejects: dropping the expiry check and relying on the TTL sweep; writing the
 * TTL in milliseconds; skipping the addressee check; letting a revoked or
 * missing invitation through; building a key from an unvalidated token;
 * minting a new token on every Resend; a second accept creating a second
 * membership; accepting without writing the USER reverse row; revoking another
 * organisation's invitation; a non-admin inviting or revoking.
 */
const path = require('path');
const assert = require('assert');

const REPO = path.join(__dirname, '..');

// ─────────────────────────────────────────────────────────────────────────────
// The stub — same harness as tests/org-lifecycle.js, TransactWrite included.
// ─────────────────────────────────────────────────────────────────────────────
const store = new Map();
const key = (pk, sk) => `${pk}|${sk}`;
const counts = { put: 0, get: 0, query: 0, update: 0, delete: 0, transactWrite: 0 };

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

/** Unrecognised expressions THROW — a harness that ignores a condition it does
 *  not understand turns a real guard into a no-op and the test into theatre. */
function evalCondition(expr, item, values = {}, names = {}) {
  if (!expr) return true;
  let m;
  if ((m = /^attribute_not_exists\(([#\w]+)\)$/.exec(expr.trim()))) {
    return !item || item[resolveName(m[1], names)] === undefined;
  }
  if ((m = /^attribute_exists\(([#\w]+)\)$/.exec(expr.trim()))) {
    return !!item && item[resolveName(m[1], names)] !== undefined;
  }
  if ((m = /^([#\w]+)\s*=\s*(:\w+)$/.exec(expr.trim()))) {
    return !!item && item[resolveName(m[1], names)] === values[m[2]];
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
        let value; let m;
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
        return { Items: items, Count: items.length };
      }
      case 'transactWrite': {
        const items = inp.TransactItems || [];
        for (const it of items) {
          const op = it.Put || it.Update || it.Delete;
          const k = it.Put ? key(it.Put.Item.PK, it.Put.Item.SK) : key(op.Key.PK, op.Key.SK);
          if (!evalCondition(op.ConditionExpression, store.get(k),
            op.ExpressionAttributeValues, op.ExpressionAttributeNames)) {
            throw ddbError('TransactionCanceledException');
          }
        }
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
  if (!seen.size) throw new Error(`stub(): could not resolve ${name}`);
}
stub('@aws-sdk/client-dynamodb', { DynamoDBClient: class {} });
stub('@aws-sdk/lib-dynamodb', {
  DynamoDBDocumentClient: { from: () => fakeDoc },
  PutCommand, GetCommand, QueryCommand, DeleteCommand, UpdateCommand,
  BatchWriteCommand, TransactWriteCommand,
});

process.env.TABLE_NAME = 'test-table';

const ORGS = path.join(REPO, 'lambda-functions/admin/orgs');
const inviteMember = require(path.join(ORGS, 'invite-member.js')).handler;
const acceptInvite = require(path.join(ORGS, 'accept-invite.js')).handler;
const revokeInvite = require(path.join(ORGS, 'revoke-invite.js')).handler;
const G = require(path.join(ORGS, 'shared/org-guards.js'));

let pass = 0, fail = 0;
async function check(label, fn) {
  try { await fn(); console.log(`  ok   - ${label}`); pass++; }
  catch (e) { console.log(`  FAIL - ${label}\n         ${e.message}`); fail++; }
}

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
}

function seedOrg(orgId, name, members) {
  store.set(key(`ORG#${orgId}`, 'METADATA'), {
    PK: `ORG#${orgId}`, SK: 'METADATA', orgId, name, plan: 'free', status: 'active',
  });
  for (const m of members) {
    store.set(key(`ORG#${orgId}`, `MEMBER#${m.sub}`), {
      PK: `ORG#${orgId}`, SK: `MEMBER#${m.sub}`, orgId, userId: m.sub,
      role: m.role, email: m.email || `${m.sub}@x.example`, joinedAt: '2026-02-01T00:00:00.000Z',
    });
    store.set(key(`USER#${m.sub}`, `ORG#${orgId}`), {
      PK: `USER#${m.sub}`, SK: `ORG#${orgId}`, orgId, userId: m.sub, role: m.role,
    });
  }
}

/** An invitation row placed by hand, so accept/revoke tests do not depend on
 *  invite-member passing. `daysLeft` may be negative — that is the expired one. */
function seedInvite(orgId, email, role, daysLeft, token) {
  const tok = token || `${orgId}.${'k'.repeat(32)}`;
  const row = {
    PK: `ORG#${orgId}`, SK: `INVITE#${tok}`, orgId, token: tok,
    email, role, invitedBy: 'u_jonah', invitedByEmail: 'jonah@x.example',
    invitedAt: new Date(Date.now() - 3 * 86400000).toISOString(),
    expiresAt: new Date(Date.now() + daysLeft * 86400000).toISOString(),
    ttl: Math.floor((Date.now() + daysLeft * 86400000) / 1000),
  };
  store.set(key(row.PK, row.SK), row);
  return tok;
}

const ORG_A = 'org_1111111111111111111111';
const ORG_B = 'org_2222222222222222222222';
const admin = (orgId) => ({ sub: 'u_amara', email: 'amara@northwind.example', orgId, role: 'admin' });

(async () => {
  // ── 1. Minting an invitation ────────────────────────────────────────────
  console.log('\n1. POST /orgs/{orgId}/invites');

  await check('an admin mints one row, with a fortnight of life', async () => {
    reset();
    seedOrg(ORG_A, 'Northwind', [{ sub: 'u_amara', role: 'admin', email: 'amara@northwind.example' }]);
    const before = Date.now();
    const res = await inviteMember(evt({
      ...admin(ORG_A), pathParams: { orgId: ORG_A },
      body: { email: 'Dev.Mensah@northwind.example', role: 'member' },
    }));
    assert.strictEqual(res.statusCode, 201, res.body);
    const { invite, created } = bodyOf(res);
    assert.strictEqual(created, true);
    assert.strictEqual(invite.email, 'dev.mensah@northwind.example', 'the address must be stored lower-cased');
    const row = store.get(key(`ORG#${ORG_A}`, `INVITE#${invite.token}`));
    assert.ok(row, 'no invitation row was written');
    const days = (Date.parse(row.expiresAt) - before) / 86400000;
    assert.ok(days > 13.9 && days < 14.1, `expiry is ${days} days, not 14`);
    // rejects: writing the TTL in MILLISECONDS — DynamoDB reads this attribute
    // as epoch SECONDS, so a ms value expires in the year 57000 and the row is
    // never swept.
    assert.ok(Math.abs(row.ttl - Date.parse(row.expiresAt) / 1000) < 2,
      `ttl ${row.ttl} is not epoch seconds`);
    // NOTHING IS CREATED UNTIL IT IS ACCEPTED — 03-team.html says so, and a
    // placeholder MEMBER row would be counted by ownersOf.
    assert.strictEqual(store.get(key(`ORG#${ORG_A}`, 'MEMBER#u_dev')), undefined);
  });

  await check('the token names its own partition, and parses back to it', async () => {
    reset();
    seedOrg(ORG_A, 'Northwind', [{ sub: 'u_amara', role: 'admin', email: 'amara@northwind.example' }]);
    const { invite } = bodyOf(await inviteMember(evt({
      ...admin(ORG_A), pathParams: { orgId: ORG_A }, body: { email: 'dev@x.example' },
    })));
    // There is no GSI on this table, so a token that did not carry its orgId
    // could not be looked up by POST /invites/{token}/accept at all.
    assert.deepStrictEqual(G.parseInviteToken(invite.token).orgId, ORG_A);
    assert.strictEqual(G.parseInviteToken('not-a-token'), null);
    assert.strictEqual(G.parseInviteToken(`${ORG_A}.short`), null);
  });

  await check('a plain member cannot invite', async () => {
    reset();
    seedOrg(ORG_A, 'Northwind', [{ sub: 'u_priya', role: 'member', email: 'priya@x.example' }]);
    const res = await inviteMember(evt({
      sub: 'u_priya', email: 'priya@x.example', orgId: ORG_A, role: 'member',
      pathParams: { orgId: ORG_A }, body: { email: 'dev@x.example' },
    }));
    assert.strictEqual(res.statusCode, 403, res.body);
    assert.strictEqual(G.ownersOf([...store.values()]).length, 0);
    assert.strictEqual([...store.values()].filter((i) => String(i.SK).startsWith('INVITE#')).length, 0);
  });

  await check('an admin of ANOTHER org cannot invite into this one', async () => {
    reset();
    seedOrg(ORG_A, 'Northwind', [{ sub: 'u_amara', role: 'admin', email: 'amara@x.example' }]);
    seedOrg(ORG_B, 'Halcyon', [{ sub: 'u_jonah', role: 'owner', email: 'jonah@x.example' }]);
    const res = await inviteMember(evt({
      sub: 'u_jonah', email: 'jonah@x.example', orgId: ORG_B, role: 'owner',
      pathParams: { orgId: ORG_A }, body: { email: 'dev@x.example' },
    }));
    assert.strictEqual(res.statusCode, 403, res.body);
  });

  await check('inviting an existing member is refused', async () => {
    reset();
    seedOrg(ORG_A, 'Northwind', [
      { sub: 'u_amara', role: 'admin', email: 'amara@northwind.example' },
      { sub: 'u_priya', role: 'member', email: 'priya@northwind.example' },
    ]);
    // Such an invitation could never be accepted — accept is idempotent
    // against the membership — so it would sit in the Invited list for ever.
    const res = await inviteMember(evt({
      ...admin(ORG_A), pathParams: { orgId: ORG_A }, body: { email: 'PRIYA@northwind.example' },
    }));
    assert.strictEqual(res.statusCode, 409, res.body);
  });

  await check('Resend returns the SAME token, it does not mint a second', async () => {
    reset();
    seedOrg(ORG_A, 'Northwind', [{ sub: 'u_amara', role: 'admin', email: 'amara@northwind.example' }]);
    const first = bodyOf(await inviteMember(evt({
      ...admin(ORG_A), pathParams: { orgId: ORG_A }, body: { email: 'dev@x.example' },
    })));
    const second = bodyOf(await inviteMember(evt({
      ...admin(ORG_A), pathParams: { orgId: ORG_A }, body: { email: 'dev@x.example' },
    })));
    // rejects: minting a fresh token per Resend — every earlier link would
    // stay live and revoking would mean finding all of them.
    assert.strictEqual(second.invite.token, first.invite.token);
    assert.strictEqual(second.created, false);
    const rows = [...store.values()].filter((i) => String(i.SK).startsWith('INVITE#'));
    assert.strictEqual(rows.length, 1, `${rows.length} invitations for one address`);
  });

  await check('an EXPIRED invitation for the same address is replaced, not stacked', async () => {
    reset();
    seedOrg(ORG_A, 'Northwind', [{ sub: 'u_amara', role: 'admin', email: 'amara@northwind.example' }]);
    const dead = seedInvite(ORG_A, 'dev@x.example', 'member', -1);
    const res = await inviteMember(evt({
      ...admin(ORG_A), pathParams: { orgId: ORG_A }, body: { email: 'dev@x.example' },
    }));
    assert.strictEqual(res.statusCode, 201, res.body);
    assert.strictEqual(store.get(key(`ORG#${ORG_A}`, `INVITE#${dead}`)), undefined,
      'the expired row survived');
    const rows = [...store.values()].filter((i) => String(i.SK).startsWith('INVITE#'));
    assert.strictEqual(rows.length, 1);
  });

  await check('owner cannot be invited, and a junk role or address is refused', async () => {
    reset();
    seedOrg(ORG_A, 'Northwind', [{ sub: 'u_amara', role: 'admin', email: 'amara@northwind.example' }]);
    const p = { orgId: ORG_A };
    // Ownership is handed over between people already inside; minting it from
    // an email address means a typo grants the one role that cannot be removed.
    assert.strictEqual((await inviteMember(evt({ ...admin(ORG_A), pathParams: p, body: { email: 'd@x.example', role: 'owner' } }))).statusCode, 400);
    assert.strictEqual((await inviteMember(evt({ ...admin(ORG_A), pathParams: p, body: { email: 'd@x.example', role: 'wizard' } }))).statusCode, 400);
    assert.strictEqual((await inviteMember(evt({ ...admin(ORG_A), pathParams: p, body: { email: 'not an address' } }))).statusCode, 400);
    assert.strictEqual([...store.values()].filter((i) => String(i.SK).startsWith('INVITE#')).length, 0);
  });

  await check('OPTIONS answers 200 with no credentials at all', async () => {
    reset();
    for (const h of [inviteMember, acceptInvite, revokeInvite]) {
      const res = await h({ requestContext: { http: { method: 'OPTIONS' } } });
      assert.strictEqual(res.statusCode, 200);
    }
  });

  // ── 2. Accepting ────────────────────────────────────────────────────────
  console.log('\n2. POST /invites/{token}/accept');

  await check('the happy path writes BOTH membership rows and consumes the invitation', async () => {
    reset();
    seedOrg(ORG_A, 'Northwind', [{ sub: 'u_jonah', role: 'admin', email: 'jonah@x.example' }]);
    const tok = seedInvite(ORG_A, 'dev.mensah@northwind.example', 'member', 3);
    // NOTE: no orgId and no orgRole in the context. This is the one route that
    // cannot require an organisation — on first run the caller is in none.
    const res = await acceptInvite(evt({
      sub: 'u_dev', email: 'Dev.Mensah@northwind.example', name: 'Dev Mensah',
      pathParams: { token: tok },
    }));
    assert.strictEqual(res.statusCode, 200, res.body);
    assert.strictEqual(bodyOf(res).accepted, true);
    assert.strictEqual(store.get(key(`ORG#${ORG_A}`, 'MEMBER#u_dev')).role, 'member');
    // rejects: writing the MEMBER row without the reverse row — the authorizer
    // reads USER#{sub}, so Dev would join and then be unable to enter.
    assert.strictEqual(store.get(key('USER#u_dev', `ORG#${ORG_A}`)).role, 'member');
    assert.strictEqual(store.get(key(`ORG#${ORG_A}`, `INVITE#${tok}`)), undefined,
      'the invitation was not consumed');
    // First organisation becomes home.
    assert.strictEqual(store.get(key('USER#u_dev', 'PROFILE')).defaultOrgId, ORG_A);
    assert.strictEqual(counts.transactWrite, 1);
  });

  await check('accepting twice succeeds and produces ONE membership', async () => {
    reset();
    seedOrg(ORG_A, 'Northwind', [{ sub: 'u_jonah', role: 'admin', email: 'jonah@x.example' }]);
    const tok = seedInvite(ORG_A, 'dev@x.example', 'member', 3);
    const ev = evt({ sub: 'u_dev', email: 'dev@x.example', pathParams: { token: tok } });
    const first = await acceptInvite(ev);
    const second = await acceptInvite(ev);
    assert.strictEqual(first.statusCode, 200, first.body);
    // People double-click and mail clients prefetch links. The second call
    // must not read as a failure.
    assert.strictEqual(second.statusCode, 200, second.body);
    assert.strictEqual(bodyOf(second).accepted, false);
    const members = [...store.values()].filter((i) => String(i.SK).startsWith('MEMBER#u_dev'));
    assert.strictEqual(members.length, 1);
  });

  await check('an EXPIRED invitation is refused even though the row is still there', async () => {
    reset();
    seedOrg(ORG_A, 'Northwind', [{ sub: 'u_jonah', role: 'admin', email: 'jonah@x.example' }]);
    // DynamoDB's TTL sweep is "typically within 48 hours" and guarantees
    // nothing, so this row is readable long after it died.
    // rejects: deleting the expiry comparison and trusting the sweeper.
    const tok = seedInvite(ORG_A, 'dev@x.example', 'member', -0.5);
    const res = await acceptInvite(evt({ sub: 'u_dev', email: 'dev@x.example', pathParams: { token: tok } }));
    assert.strictEqual(res.statusCode, 410, res.body);
    assert.strictEqual(store.get(key(`ORG#${ORG_A}`, 'MEMBER#u_dev')), undefined);
    assert.strictEqual(store.get(key('USER#u_dev', `ORG#${ORG_A}`)), undefined);
  });

  await check('an invitation addressed to somebody else is refused', async () => {
    reset();
    seedOrg(ORG_A, 'Northwind', [{ sub: 'u_jonah', role: 'admin', email: 'jonah@x.example' }]);
    const tok = seedInvite(ORG_A, 'dev@x.example', 'member', 5);
    // Forwarded, quoted in a ticket, pasted into a chat: without this check the
    // token is a bearer credential that admits whoever opens it.
    const res = await acceptInvite(evt({ sub: 'u_mallory', email: 'mallory@elsewhere.example', pathParams: { token: tok } }));
    assert.strictEqual(res.statusCode, 403, res.body);
    assert.strictEqual(store.get(key(`ORG#${ORG_A}`, 'MEMBER#u_mallory')), undefined);
    assert.ok(store.get(key(`ORG#${ORG_A}`, `INVITE#${tok}`)), 'a refused accept consumed the invitation');
  });

  await check('a caller with no email at all is refused, not waved through', async () => {
    reset();
    seedOrg(ORG_A, 'Northwind', [{ sub: 'u_jonah', role: 'admin', email: 'jonah@x.example' }]);
    const tok = seedInvite(ORG_A, 'dev@x.example', 'member', 5);
    // "No email" must never mean "matches anything".
    const res = await acceptInvite(evt({ sub: 'u_dev', email: '', pathParams: { token: tok } }));
    assert.strictEqual(res.statusCode, 403, res.body);
    // The MESSAGE matters, not just the code. Without the explicit guard the
    // request is still refused — by the addressee comparison, which '' happens
    // to fail — and the day somebody stores a blank invite email the two
    // blanks match and the door opens. Pinning the reason pins the guard.
    assert.match(bodyOf(res).error, /no email address/i);
    assert.strictEqual(store.get(key(`ORG#${ORG_A}`, 'MEMBER#u_dev')), undefined);
  });

  await check('an invitation with NO expiry at all counts as expired', async () => {
    reset();
    seedOrg(ORG_A, 'Northwind', [{ sub: 'u_jonah', role: 'admin', email: 'jonah@x.example' }]);
    const tok = seedInvite(ORG_A, 'dev@x.example', 'member', 5);
    delete store.get(key(`ORG#${ORG_A}`, `INVITE#${tok}`)).expiresAt;
    // An invitation whose shape we cannot read is one we refuse. Reading a
    // missing expiry as "never expires" makes a corrupted row immortal.
    const res = await acceptInvite(evt({ sub: 'u_dev', email: 'dev@x.example', pathParams: { token: tok } }));
    assert.strictEqual(res.statusCode, 410, res.body);
    assert.strictEqual(store.get(key(`ORG#${ORG_A}`, 'MEMBER#u_dev')), undefined);
  });

  await check('an anonymous caller is refused', async () => {
    reset();
    seedOrg(ORG_A, 'Northwind', [{ sub: 'u_jonah', role: 'admin', email: 'jonah@x.example' }]);
    const tok = seedInvite(ORG_A, 'dev@x.example', 'member', 5);
    const res = await acceptInvite({ requestContext: { http: { method: 'POST' } }, pathParameters: { token: tok } });
    assert.strictEqual(res.statusCode, 403, res.body);
  });

  await check('a junk token builds no key and touches nothing', async () => {
    reset();
    seedOrg(ORG_A, 'Northwind', [{ sub: 'u_jonah', role: 'admin', email: 'jonah@x.example' }]);
    const sizeBefore = store.size;
    for (const bad of ['', 'x', 'ORG#evil.aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', `${ORG_A}.short`, 'METADATA']) {
      const res = await acceptInvite(evt({ sub: 'u_dev', email: 'dev@x.example', pathParams: { token: bad } }));
      assert.strictEqual(res.statusCode, 404, `${bad} -> ${res.statusCode}`);
    }
    assert.strictEqual(store.size, sizeBefore);
  });

  await check('a revoked (missing) invitation is a 404, not a join', async () => {
    reset();
    seedOrg(ORG_A, 'Northwind', [{ sub: 'u_jonah', role: 'admin', email: 'jonah@x.example' }]);
    const tok = `${ORG_A}.${'m'.repeat(32)}`;
    const res = await acceptInvite(evt({ sub: 'u_dev', email: 'dev@x.example', pathParams: { token: tok } }));
    assert.strictEqual(res.statusCode, 404, res.body);
    assert.strictEqual(store.get(key(`ORG#${ORG_A}`, 'MEMBER#u_dev')), undefined);
  });

  await check('an invitation carrying role "owner" is refused, not coerced', async () => {
    reset();
    seedOrg(ORG_A, 'Northwind', [{ sub: 'u_jonah', role: 'admin', email: 'jonah@x.example' }]);
    const tok = seedInvite(ORG_A, 'dev@x.example', 'owner', 5);
    // A corrupted or hand-written row must not grant the one role that cannot
    // be removed, and must not quietly become `member` either.
    const res = await acceptInvite(evt({ sub: 'u_dev', email: 'dev@x.example', pathParams: { token: tok } }));
    assert.strictEqual(res.statusCode, 409, res.body);
    assert.strictEqual(store.get(key(`ORG#${ORG_A}`, 'MEMBER#u_dev')), undefined);
  });

  await check('joining a SECOND organisation does not move the default', async () => {
    reset();
    seedOrg(ORG_A, 'Northwind', [{ sub: 'u_jonah', role: 'admin', email: 'jonah@x.example' }]);
    seedOrg(ORG_B, 'Halcyon', [{ sub: 'u_ruth', role: 'admin', email: 'ruth@x.example' }]);
    store.set(key('USER#u_dev', 'PROFILE'), { PK: 'USER#u_dev', SK: 'PROFILE', defaultOrgId: ORG_B });
    const tok = seedInvite(ORG_A, 'dev@x.example', 'member', 5);
    await acceptInvite(evt({ sub: 'u_dev', email: 'dev@x.example', pathParams: { token: tok } }));
    assert.strictEqual(store.get(key('USER#u_dev', 'PROFILE')).defaultOrgId, ORG_B);
  });

  // ── 3. Revoking ─────────────────────────────────────────────────────────
  console.log('\n3. DELETE /orgs/{orgId}/invites/{token}');

  await check('revoking deletes the row, and the link then does nothing', async () => {
    reset();
    seedOrg(ORG_A, 'Northwind', [{ sub: 'u_amara', role: 'admin', email: 'amara@northwind.example' }]);
    const tok = seedInvite(ORG_A, 'dev@x.example', 'member', 5);
    const res = await revokeInvite(evt({
      method: 'DELETE', ...admin(ORG_A), pathParams: { orgId: ORG_A, token: tok },
    }));
    assert.strictEqual(res.statusCode, 200, res.body);
    assert.strictEqual(store.get(key(`ORG#${ORG_A}`, `INVITE#${tok}`)), undefined);
    // Revoking IS the deletion — there is no separate flag for accept to check
    // and therefore no flag a refactor can forget.
    const after = await acceptInvite(evt({ sub: 'u_dev', email: 'dev@x.example', pathParams: { token: tok } }));
    assert.strictEqual(after.statusCode, 404, after.body);
  });

  await check('revoking twice reports the second one honestly', async () => {
    reset();
    seedOrg(ORG_A, 'Northwind', [{ sub: 'u_amara', role: 'admin', email: 'amara@northwind.example' }]);
    const tok = seedInvite(ORG_A, 'dev@x.example', 'member', 5);
    const ev = evt({ method: 'DELETE', ...admin(ORG_A), pathParams: { orgId: ORG_A, token: tok } });
    assert.strictEqual((await revokeInvite(ev)).statusCode, 200);
    // Two admins on a stale list should not both be told they did it.
    assert.strictEqual((await revokeInvite(ev)).statusCode, 404);
  });

  await check("another organisation's token cannot be revoked through this org", async () => {
    reset();
    seedOrg(ORG_A, 'Northwind', [{ sub: 'u_amara', role: 'admin', email: 'amara@northwind.example' }]);
    seedOrg(ORG_B, 'Halcyon', [{ sub: 'u_ruth', role: 'admin', email: 'ruth@x.example' }]);
    const foreign = seedInvite(ORG_B, 'dev@x.example', 'member', 5);
    counts.delete = 0;
    const res = await revokeInvite(evt({
      method: 'DELETE', ...admin(ORG_A), pathParams: { orgId: ORG_A, token: foreign },
    }));
    assert.strictEqual(res.statusCode, 404, res.body);
    // Refused BEFORE any write is attempted. Without the orgId comparison the
    // request still fails — the key is built from the path's orgId, so it
    // simply misses — but the refusal becomes accidental, and it stops being a
    // refusal the moment somebody "simplifies" the key to use the token's own
    // orgId, which is right there in the parsed token.
    assert.strictEqual(counts.delete, 0, 'a delete was attempted against another org');
    // The token carries its own orgId. Acting on THAT would let an admin of A
    // revoke B's invitations.
    assert.ok(store.get(key(`ORG#${ORG_B}`, `INVITE#${foreign}`)), "B's invitation was destroyed");
  });

  await check('a plain member cannot revoke', async () => {
    reset();
    seedOrg(ORG_A, 'Northwind', [{ sub: 'u_priya', role: 'member', email: 'priya@x.example' }]);
    const tok = seedInvite(ORG_A, 'dev@x.example', 'member', 5);
    const res = await revokeInvite(evt({
      method: 'DELETE', sub: 'u_priya', email: 'priya@x.example', orgId: ORG_A, role: 'member',
      pathParams: { orgId: ORG_A, token: tok },
    }));
    assert.strictEqual(res.statusCode, 403, res.body);
    assert.ok(store.get(key(`ORG#${ORG_A}`, `INVITE#${tok}`)));
  });

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
