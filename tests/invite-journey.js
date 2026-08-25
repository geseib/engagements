/**
 * THE INVITATION JOURNEY, END TO END — and it had no end.
 *
 * `POST /orgs/{id}/invites` wrote a row. `POST /invites/{token}/accept` was
 * complete, correct and CALLED BY NOTHING — on dev its Lambda had no log group
 * at all, which is what "never once invoked" looks like. In between: no email
 * was ever sent (invite-member.js says so in its own header and the delivery it
 * was waiting for was never wired), the token was returned by the API and never
 * shown to the admin, and the screen said "The invitation to X was mailed
 * again". An invited person could not have joined by any route.
 *
 * The owner's fix removes the delivery problem rather than solving it:
 *
 *   "they dont need to get an email, just login with the same email as they use
 *    for their account and click the accept button on the main screen. i guess
 *    they need a way to leave the org too."
 *
 * `accept-invite.js` already refused any invitation whose address did not match
 * the caller's Cognito email, so the match was always the real check and the
 * token was only ever a way to FIND the row. This file covers the finding, the
 * accepting and the leaving.
 */
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
const listMyInvites = require(path.join(ORGS, 'list-my-invites.js')).handler;
const removeMember = require(path.join(ORGS, 'remove-member.js')).handler;
const listMembers = require(path.join(ORGS, 'list-members.js')).handler;
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


const say = (line) => console.log(line);

const NEWCOMER = 'dev.mensah@x.example';
const invitee = (email = NEWCOMER, sub = 'u_dev') => ({ sub, email });

/** The invitee's own pointer rows, straight out of the store. */
const pointersFor = (email) => [...store.keys()]
  .filter((k) => k.startsWith(`INVITEE#${email.toLowerCase()}|`));

(async () => {
  say('1. an invitation writes BOTH rows, in one transaction');

  await check('the invitee gets a pointer keyed on their address', async () => {
    reset();
    seedOrg(ORG_A, 'Northwind Learning', [{ sub: 'u_amara', role: 'admin', email: 'amara@northwind.example' }]);
    const res = await inviteMember(evt({
      ...admin(ORG_A), pathParams: { orgId: ORG_A }, body: { email: NEWCOMER, role: 'member' },
    }));
    assert.strictEqual(res.statusCode, 201, res.body);
    // rejects: the forward row alone. The invitee cannot read the ORGANISATION'S
    // partition and does not know its id, and this table has no GSIs — so
    // without this row "which invitations are waiting for me?" has no answer.
    assert.strictEqual(pointersFor(NEWCOMER).length, 1, 'the pointer must exist');
  });

  await check('the pointer carries the organisation NAME', async () => {
    reset();
    seedOrg(ORG_A, 'Northwind Learning', [{ sub: 'u_amara', role: 'admin', email: 'amara@northwind.example' }]);
    await inviteMember(evt({
      ...admin(ORG_A), pathParams: { orgId: ORG_A }, body: { email: NEWCOMER, role: 'member' },
    }));
    // rejects: making the prompt read the inviting org's METADATA, which the
    // invitee is not a member of. Denormalising the name here is what keeps the
    // accept prompt from needing a hole in the isolation boundary.
    const row = store.get(pointersFor(NEWCOMER)[0]);
    assert.strictEqual(row.orgName, 'Northwind Learning');
  });

  say('\n2. finding your own invitations');

  await check('GET /invites returns the ones addressed to you', async () => {
    reset();
    seedOrg(ORG_A, 'Northwind Learning', [{ sub: 'u_amara', role: 'admin', email: 'amara@northwind.example' }]);
    await inviteMember(evt({
      ...admin(ORG_A), pathParams: { orgId: ORG_A }, body: { email: NEWCOMER, role: 'member' },
    }));
    const res = await listMyInvites(evt({ method: 'GET', ...invitee() }));
    assert.strictEqual(res.statusCode, 200, res.body);
    const { invites } = JSON.parse(res.body);
    assert.strictEqual(invites.length, 1);
    assert.strictEqual(invites[0].orgName, 'Northwind Learning');
    assert.strictEqual(invites[0].role, 'member');
  });

  // rejects: returning invitations addressed to somebody else — the one way
  // this route could leak, and the reason it reads the CALLER'S email rather
  // than anything in the request.
  await check('it returns nothing for a different address', async () => {
    reset();
    seedOrg(ORG_A, 'Northwind Learning', [{ sub: 'u_amara', role: 'admin', email: 'amara@northwind.example' }]);
    await inviteMember(evt({
      ...admin(ORG_A), pathParams: { orgId: ORG_A }, body: { email: NEWCOMER, role: 'member' },
    }));
    const res = await listMyInvites(evt({ method: 'GET', sub: 'u_other', email: 'someone.else@x.example' }));
    assert.deepStrictEqual(JSON.parse(res.body).invites, []);
  });

  // rejects: matching case-sensitively. Cognito hands back whatever case the
  // person typed, and an invitation to Dev.Mensah@ must be findable by
  // dev.mensah@ or the prompt silently never appears.
  await check('the address match ignores case', async () => {
    reset();
    seedOrg(ORG_A, 'Northwind Learning', [{ sub: 'u_amara', role: 'admin', email: 'amara@northwind.example' }]);
    await inviteMember(evt({
      ...admin(ORG_A), pathParams: { orgId: ORG_A }, body: { email: 'Dev.Mensah@X.Example', role: 'member' },
    }));
    const res = await listMyInvites(evt({ method: 'GET', sub: 'u_dev', email: 'dev.mensah@x.example' }));
    assert.strictEqual(JSON.parse(res.body).invites.length, 1);
  });

  // rejects: an error banner on the landing screen of every account that has no
  // email attribute, for a feature they are not using.
  await check('an account with no email gets an empty list, not an error', async () => {
    reset();
    const res = await listMyInvites(evt({ method: 'GET', sub: 'u_noemail', email: '' }));
    assert.strictEqual(res.statusCode, 200, res.body);
    assert.deepStrictEqual(JSON.parse(res.body).invites, []);
  });

  // rejects: offering an invitation the accept route will refuse as expired —
  // a button that exists only to fail.
  await check('an expired invitation is not offered', async () => {
    reset();
    seedOrg(ORG_A, 'Northwind Learning', [{ sub: 'u_amara', role: 'admin', email: 'amara@northwind.example' }]);
    const tok = `${ORG_A}.${'k'.repeat(32)}`;
    store.set(key(`INVITEE#${NEWCOMER}`, `INVITE#${tok}`), {
      PK: `INVITEE#${NEWCOMER}`, SK: `INVITE#${tok}`, token: tok, orgId: ORG_A,
      orgName: 'Northwind Learning', email: NEWCOMER, role: 'member',
      expiresAt: new Date(Date.now() - 86400000).toISOString(),
      ttl: Math.floor((Date.now() - 86400000) / 1000),
    });
    const res = await listMyInvites(evt({ method: 'GET', ...invitee() }));
    assert.deepStrictEqual(JSON.parse(res.body).invites, []);
  });

  say('\n3. accepting clears the prompt');

  await check('accepting removes the pointer as well as the invitation', async () => {
    reset();
    seedOrg(ORG_A, 'Northwind Learning', [{ sub: 'u_amara', role: 'admin', email: 'amara@northwind.example' }]);
    const created = await inviteMember(evt({
      ...admin(ORG_A), pathParams: { orgId: ORG_A }, body: { email: NEWCOMER, role: 'member' },
    }));
    const { invite } = JSON.parse(created.body);

    const res = await acceptInvite(evt({
      method: 'POST', ...invitee(), pathParams: { token: invite.token },
    }));
    assert.strictEqual(res.statusCode, 200, res.body);
    // rejects: leaving the pointer behind, which keeps the accept prompt on the
    // landing screen offering an invitation that has already been taken.
    assert.deepStrictEqual(pointersFor(NEWCOMER), [], 'the pointer must be gone');
    const after = await listMyInvites(evt({ method: 'GET', ...invitee() }));
    assert.deepStrictEqual(JSON.parse(after.body).invites, []);
  });

  await check('revoking removes the pointer too', async () => {
    reset();
    seedOrg(ORG_A, 'Northwind Learning', [{ sub: 'u_amara', role: 'admin', email: 'amara@northwind.example' }]);
    const created = await inviteMember(evt({
      ...admin(ORG_A), pathParams: { orgId: ORG_A }, body: { email: NEWCOMER, role: 'member' },
    }));
    const { invite } = JSON.parse(created.body);

    const res = await revokeInvite(evt({
      method: 'DELETE', ...admin(ORG_A), pathParams: { orgId: ORG_A, token: invite.token },
    }));
    assert.strictEqual(res.statusCode, 200, res.body);
    // rejects: a revoke that leaves the invitee still being offered it — the
    // accept route would refuse, so the prompt would only ever fail.
    assert.deepStrictEqual(pointersFor(NEWCOMER), []);
  });

  say('\n4. invitations that predate the pointer are rescued');

  /*
    THE MIGRATION THIS FEATURE NEEDED AND ALMOST DID NOT GET.

    An invitation written before the pointer shipped has only the forward row.
    Its recipient signs in, `GET /invites` queries `INVITEE#{email}`, finds
    nothing, and the invitation expires unseen a fortnight later with the admin
    looking at a healthy-looking "Invited" list the whole time.

    There was one of these on dev within an hour of the deploy — an invitation
    the owner had sent 38 minutes before the feature landed.
  */
  // rejects: shipping the pointer with no path for the invitations that came
  // before it, which is a silent dead end for exactly the people already
  // waiting to join.
  await check('an old invitation with no pointer becomes findable', async () => {
    reset();
    seedOrg(ORG_A, 'Northwind Learning', [{ sub: 'u_amara', role: 'admin', email: 'amara@northwind.example' }]);
    // Seeded directly — this is the pre-pointer shape: forward row only.
    const tok = seedInvite(ORG_A, NEWCOMER, 'member', 11);
    assert.deepStrictEqual(pointersFor(NEWCOMER), [], 'precondition: no pointer');
    assert.deepStrictEqual(
      JSON.parse((await listMyInvites(evt({ method: 'GET', ...invitee() }))).body).invites,
      [], 'precondition: invisible to the invitee',
    );

    // An admin opens the Members screen.
    const res = await listMembers(evt({
      method: 'GET', ...admin(ORG_A), pathParams: { orgId: ORG_A },
    }));
    assert.strictEqual(res.statusCode, 200, res.body);

    const after = JSON.parse((await listMyInvites(evt({ method: 'GET', ...invitee() }))).body).invites;
    assert.strictEqual(after.length, 1, 'the invitation must now be findable');
    assert.strictEqual(after[0].token, tok);
    assert.strictEqual(after[0].orgName, 'Northwind Learning', 'and carry the org name');
  });

  // rejects: a repair that overwrites. The pointer is derived, but resurrecting
  // an accepted invitation or clobbering a live one would both be worse than
  // the gap it is fixing.
  await check('the repair cannot overwrite an existing pointer', async () => {
    reset();
    seedOrg(ORG_A, 'Northwind Learning', [{ sub: 'u_amara', role: 'admin', email: 'amara@northwind.example' }]);
    const created = await inviteMember(evt({
      ...admin(ORG_A), pathParams: { orgId: ORG_A }, body: { email: NEWCOMER, role: 'member' },
    }));
    const { invite } = JSON.parse(created.body);
    const before = store.get(pointersFor(NEWCOMER)[0]);

    await listMembers(evt({ method: 'GET', ...admin(ORG_A), pathParams: { orgId: ORG_A } }));

    assert.strictEqual(pointersFor(NEWCOMER).length, 1, 'still exactly one');
    assert.deepStrictEqual(store.get(pointersFor(NEWCOMER)[0]), before, 'and untouched');
    assert.strictEqual(before.token, invite.token);
  });

  say('\n5. leaving');

  // rejects: THE MISSING HALF. This route required `admin` for every caller, so
  // a plain member had no way out of a team at all.
  await check('a member can leave the organisation', async () => {
    reset();
    seedOrg(ORG_A, 'Northwind Learning', [
      { sub: 'u_amara', role: 'owner', email: 'amara@northwind.example' },
      { sub: 'u_dev', role: 'member', email: NEWCOMER },
    ]);
    const res = await removeMember(evt({
      method: 'DELETE', sub: 'u_dev', email: NEWCOMER, orgId: ORG_A, role: 'member',
      pathParams: { orgId: ORG_A, sub: 'u_dev' },
    }));
    assert.strictEqual(res.statusCode, 200, res.body);
    assert.strictEqual(store.has(key(`ORG#${ORG_A}`, 'MEMBER#u_dev')), false);
    assert.strictEqual(store.has(key('USER#u_dev', `ORG#${ORG_A}`)), false,
      'both halves of the membership must go, or the authorizer still sees it');
  });

  // rejects: widening the guard to "anybody may remove anybody". Leaving is
  // yourself; removing somebody else is still an admin power.
  await check('a member still cannot remove somebody else', async () => {
    reset();
    seedOrg(ORG_A, 'Northwind Learning', [
      { sub: 'u_amara', role: 'owner', email: 'amara@northwind.example' },
      { sub: 'u_dev', role: 'member', email: NEWCOMER },
    ]);
    const res = await removeMember(evt({
      method: 'DELETE', sub: 'u_dev', email: NEWCOMER, orgId: ORG_A, role: 'member',
      pathParams: { orgId: ORG_A, sub: 'u_amara' },
    }));
    assert.strictEqual(res.statusCode, 403, res.body);
    assert.strictEqual(store.has(key(`ORG#${ORG_A}`, 'MEMBER#u_amara')), true);
  });

  // rejects: leaving as a way to reach an organisation you were never in.
  await check('somebody who is not a member cannot "leave"', async () => {
    reset();
    seedOrg(ORG_A, 'Northwind Learning', [{ sub: 'u_amara', role: 'owner', email: 'amara@northwind.example' }]);
    const res = await removeMember(evt({
      method: 'DELETE', sub: 'u_stranger', email: 'stranger@x.example',
      pathParams: { orgId: ORG_A, sub: 'u_stranger' },
    }));
    assert.strictEqual(res.statusCode, 403, res.body);
  });

  // rejects: the last owner walking out of an organisation nobody else can
  // administer. Unchanged by the relaxation above, and worth pinning because
  // the relaxation is what could have bypassed it.
  await check('the last owner still cannot leave', async () => {
    reset();
    seedOrg(ORG_A, 'Northwind Learning', [
      { sub: 'u_amara', role: 'owner', email: 'amara@northwind.example' },
      { sub: 'u_dev', role: 'member', email: NEWCOMER },
    ]);
    const res = await removeMember(evt({
      method: 'DELETE', sub: 'u_amara', email: 'amara@northwind.example', orgId: ORG_A, role: 'owner',
      pathParams: { orgId: ORG_A, sub: 'u_amara' },
    }));
    assert.strictEqual(res.statusCode, 409, res.body);
    assert.match(JSON.parse(res.body).error, /last owner/i);
  });

  say(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
