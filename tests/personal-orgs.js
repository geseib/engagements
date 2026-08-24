/**
 * EVERY APPROVED ACCOUNT HAS A HOME — and it is the one thing it cannot lose.
 *
 * The owner's decision this file pins: after approval there is no "belongs to
 * no organisation" state. That state is not a rare case handlers should cope
 * with, it is a branch each of them has to REMEMBER, and every place that
 * forgets is a bug — `create-game.js` writes a session no list can show,
 * `upload-questions.js` refuses a set with "choose an organisation" to somebody
 * with none to choose. Removing the state removes the class of defect, so the
 * checks below are about the invariant holding rather than about a feature
 * working.
 *
 * THE FIVE THINGS THAT WOULD BREAK IT SILENTLY:
 *
 *   1. PROVISIONING TWICE. This runs on every page load, from every tab. A
 *      check-then-write races and gives somebody two homes and no way to tell
 *      which one their sets are in. The guard has to be a CONDITION on the
 *      PROFILE row, not an `if` in JavaScript.
 *   2. PROVISIONING TOO EARLY. `auth/post-confirmation.js` fires at email
 *      confirmation, before an administrator has approved anybody, so an
 *      organisation minted there belongs to a stranger who may be rejected
 *      minutes later — and lands in the partition 10-platform-orgs.html counts.
 *   3. THE TYPE NOT MOVING, OR MOVING BACK. A personal org that stays personal
 *      after a second member joins is a team that cannot be left and is billed
 *      as free; one that reverts when that member leaves un-bills a team
 *      retroactively, which nothing here can do.
 *   4. A HOME THAT CAN BE LEFT. Removing its only member strands that person's
 *      sessions and sets in a tenant nobody can enter, with no repair job.
 *   5. CONTENT MOVING WHEN SOMEBODY JOINS A TEAM. Being invited somewhere is
 *      not a transfer. Every row of the personal org has to be untouched.
 *
 * Every check carries a `// rejects:` line naming the change it catches, and
 * every one of them was watched failing against a deliberately broken
 * implementation before being kept.
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
const listMyOrgs = require(path.join(ORGS, 'list-my-orgs.js')).handler;
const acceptInvite = require(path.join(ORGS, 'accept-invite.js')).handler;
const removeMember = require(path.join(ORGS, 'remove-member.js')).handler;
const G = require(path.join(ORGS, 'shared/org-guards.js'));
const { ensurePersonalOrg } = require(path.join(ORGS, 'shared/personal-org.js'));

if (!process.env.DEBUG) { console.log = () => {}; console.warn = () => {}; console.error = () => {}; }
const say = (...a) => process.stdout.write(a.join(' ') + '\n');

/** Every TransactWriteItems this run issued, so a check can assert on the
 *  CONDITION a write carries and not merely on the state it left behind. The
 *  idempotency guard is a property of the command; a test that can only see the
 *  store cannot tell a guarded write from a lucky one. */
const transacts = [];
const passThrough = fakeDoc.send;
fakeDoc.send = async (cmd) => {
  if (cmd.type === 'transactWrite') transacts.push(cmd.input.TransactItems || []);
  return passThrough(cmd);
};

let pass = 0, fail = 0;
async function check(label, fn) {
  try { await fn(); say(`  ok   - ${label}`); pass++; }
  catch (e) { say(`  FAIL - ${label}\n         ${e.message}`); fail++; }
}

/** The CUSTOM Lambda authorizer's real shape: context at `.authorizer.lambda`.
 *  `groups` is the comma-joined string the authorizer actually emits — an
 *  approved account carries `hosts` or `admins`, a new one carries `pending`. */
function evt({ method = 'GET', sub = '', email = '', name = '', orgId = '', role = '',
  groups = 'hosts', pathParams = {}, body } = {}) {
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
  transacts.length = 0;
}

const rowsIn = (pk) => [...store.values()].filter((i) => i.PK === pk);
const profileOf = (sub) => store.get(key(`USER#${sub}`, 'PROFILE'));
const metaOf = (orgId) => store.get(key(`ORG#${orgId}`, 'METADATA'));
const indexOf_ = (orgId) => store.get(key('ORGS', `ORG#${orgId}`));
/** Every organisation in the platform index, so "one home per account" is
 *  counted from the rows rather than from what a handler said it did. */
const allOrgs = () => rowsIn('ORGS');

const AMARA = { sub: 'u_amara', email: 'amara.reyes@northwind.example', name: 'Amara Reyes' };

function seedOrg(orgId, name, members, extra = {}) {
  store.set(key(`ORG#${orgId}`, 'METADATA'), {
    PK: `ORG#${orgId}`, SK: 'METADATA', orgId, name, plan: 'free', status: 'active',
    type: 'team', createdAt: '2026-02-01T00:00:00.000Z', createdBy: members[0].sub, ...extra,
  });
  store.set(key('ORGS', `ORG#${orgId}`), {
    PK: 'ORGS', SK: `ORG#${orgId}`, orgId, name, plan: 'free', status: 'active',
    type: 'team', ...extra,
  });
  for (const m of members) {
    store.set(key(`ORG#${orgId}`, `MEMBER#${m.sub}`), {
      PK: `ORG#${orgId}`, SK: `MEMBER#${m.sub}`, orgId, userId: m.sub, role: m.role,
      email: m.email || `${m.sub}@x.example`, joinedAt: '2026-02-01T00:00:00.000Z',
    });
    store.set(key(`USER#${m.sub}`, `ORG#${orgId}`), {
      PK: `USER#${m.sub}`, SK: `ORG#${orgId}`, orgId, userId: m.sub, role: m.role,
      joinedAt: '2026-02-01T00:00:00.000Z',
    });
  }
}

function seedInvite(orgId, email, role, daysLeft) {
  const tok = `${orgId}.${'k'.repeat(32)}`;
  store.set(key(`ORG#${orgId}`, `INVITE#${tok}`), {
    PK: `ORG#${orgId}`, SK: `INVITE#${tok}`, orgId, token: tok, email, role,
    invitedBy: 'u_jonah', invitedByEmail: 'jonah@x.example',
    invitedAt: new Date(Date.now() - 86400000).toISOString(),
    expiresAt: new Date(Date.now() + daysLeft * 86400000).toISOString(),
  });
  return tok;
}

const TEAM_ORG = 'org_2222222222222222222222';

(async () => {
  say('\npersonal organisations: the home every approved account has\n');

  // ── 1. Provisioning ──────────────────────────────────────────────────────
  say('1. an approved account is given a home the first time it asks');

  await check('GET /orgs provisions one, and returns it in the SAME response', async () => {
    reset();
    const res = await listMyOrgs(evt({ ...AMARA }));
    assert.strictEqual(res.statusCode, 200, res.body);
    const { orgs } = bodyOf(res);
    // rejects: provisioning AFTER the memberships are read, which shows an
    // empty switcher on the first load and a populated one on the second —
    // indistinguishable from a bug, and the reason for the ordering.
    assert.strictEqual(orgs.length, 1, `expected one organisation, got ${JSON.stringify(orgs)}`);
    assert.strictEqual(orgs[0].type, 'personal');
    assert.strictEqual(orgs[0].yourRole, 'owner');
  });

  await check('all five rows land, in ONE transaction and no loose Puts', async () => {
    reset();
    const { orgId, created } = await ensurePersonalOrg(evt({ ...AMARA }));
    assert.ok(created && G.isOrgId(orgId), `nothing was provisioned: ${orgId}`);
    assert.ok(indexOf_(orgId), 'no platform index row');
    assert.ok(metaOf(orgId), 'no METADATA row');
    assert.ok(store.get(key(`ORG#${orgId}`, `MEMBER#${AMARA.sub}`)), 'no MEMBER row');
    assert.ok(store.get(key(`USER#${AMARA.sub}`, `ORG#${orgId}`)), 'no USER reverse row');
    assert.ok(profileOf(AMARA.sub), 'no PROFILE row');
    // rejects: five sequential writes. The gap after row 2 is an organisation
    // with NO MEMBERS: unenterable, undeletable, un-invitable-to.
    assert.strictEqual(counts.transactWrite, 1, 'expected exactly one transaction');
    assert.strictEqual(counts.put, 0, 'a bare Put escaped the transaction');
  });

  await check('it is named after the person, as the switcher draws it', async () => {
    reset();
    const { orgId } = await ensurePersonalOrg(evt({ ...AMARA }));
    // 01-org-switcher.html prints "Amara Reyes · Personal" — the name is the
    // PERSON and the "· Personal" half comes from `type`.
    assert.strictEqual(metaOf(orgId).name, 'Amara Reyes');
  });

  await check('an account with no display name falls back to the email, never to blank', async () => {
    reset();
    const { orgId } = await ensurePersonalOrg(evt({ sub: 'u_fed', email: 'dev.mensah@x.example' }));
    // rejects: naming it '' for a federated identity that carries no `name`.
    // An organisation called '' is unpickable in the switcher for ever.
    assert.strictEqual(metaOf(orgId).name, 'dev.mensah');
  });

  say('\n2. and only ONE, however many times it is asked');

  await check('calling it twice provisions once', async () => {
    reset();
    const first = await ensurePersonalOrg(evt({ ...AMARA }));
    const second = await ensurePersonalOrg(evt({ ...AMARA }));
    assert.strictEqual(second.created, false, 'a second organisation was created');
    assert.strictEqual(second.orgId, first.orgId, 'the second call named a different org');
    assert.strictEqual(allOrgs().length, 1, `${allOrgs().length} organisations exist`);
  });

  await check('ten page loads still leave one', async () => {
    reset();
    for (let i = 0; i < 10; i++) await listMyOrgs(evt({ ...AMARA }));
    assert.strictEqual(allOrgs().length, 1);
    const res = await listMyOrgs(evt({ ...AMARA }));
    assert.strictEqual(bodyOf(res).orgs.length, 1);
  });

  await check('TWO TABS AT ONCE still leave one, and both are told the same id', async () => {
    reset();
    // rejects: an `if (profile.personalOrgId) return` with no condition on the
    // write. Both calls read "no home" before either writes; only a condition
    // INSIDE DynamoDB can make one of them lose.
    const [a, b] = await Promise.all([
      ensurePersonalOrg(evt({ ...AMARA })),
      ensurePersonalOrg(evt({ ...AMARA })),
    ]);
    assert.strictEqual(allOrgs().length, 1,
      `a race produced ${allOrgs().length} organisations`);
    const winner = profileOf(AMARA.sub).personalOrgId;
    assert.ok(winner, 'no personalOrgId was recorded');
    for (const r of [a, b]) {
      if (r.orgId) assert.strictEqual(r.orgId, winner, 'a caller was told about the loser');
    }
    assert.strictEqual(a.created !== b.created, true, 'exactly one call should report created');
  });

  await check('the guard is a CONDITION on the write, not a JavaScript branch', async () => {
    reset();
    await ensurePersonalOrg(evt({ ...AMARA }));
    // rejects: dropping `ConditionExpression: attribute_not_exists(personalOrgId)`
    // and relying on the early return above it. That early return is a
    // check-then-write: it is correct in every sequential test and wrong
    // exactly when two requests overlap, which is every page load in two tabs.
    // Asserted on the COMMAND because the store cannot tell a guarded write
    // from one that merely got lucky.
    const items = transacts[transacts.length - 1] || [];
    const profileWrite = items.find((i) => i.Update
      && i.Update.Key.SK === 'PROFILE' && i.Update.Key.PK === `USER#${AMARA.sub}`);
    assert.ok(profileWrite, 'the profile is not written in the same transaction');
    assert.match(String(profileWrite.Update.ConditionExpression),
      /attribute_not_exists\(\s*personalOrgId\s*\)/,
      'the personal-org write is not guarded by a condition on personalOrgId');
  });

  await check('a profile that already names a home is left alone', async () => {
    reset();
    const first = await ensurePersonalOrg(evt({ ...AMARA }));
    const again = await ensurePersonalOrg(evt({ ...AMARA }));
    assert.strictEqual(again.created, false);
    assert.strictEqual(again.orgId, first.orgId);
    assert.strictEqual(allOrgs().length, 1);
  });

  say('\n3. but not for an account nobody has approved');

  await check('a PENDING account gets nothing', async () => {
    reset();
    const res = await ensurePersonalOrg(evt({ ...AMARA, groups: 'pending' }));
    // rejects: provisioning in auth/post-confirmation.js, which runs at email
    // confirmation — before approval — and would mint an organisation for
    // every abandoned signup and every account about to be rejected.
    assert.strictEqual(res.created, false);
    assert.strictEqual(res.reason, 'not-approved');
    assert.strictEqual(allOrgs().length, 0, 'an unapproved account was given a tenant');
  });

  await check('an account with NO groups at all gets nothing either', async () => {
    reset();
    const res = await ensurePersonalOrg(evt({ ...AMARA, groups: '' }));
    // rejects: treating "I could not read the groups" as approval.
    assert.strictEqual(res.created, false);
    assert.strictEqual(allOrgs().length, 0);
  });

  await check('an anonymous caller gets nothing', async () => {
    reset();
    const res = await ensurePersonalOrg(evt({ sub: '', groups: 'hosts' }));
    assert.strictEqual(res.created, false);
    assert.strictEqual(allOrgs().length, 0);
  });

  await check('an admin is approved too', async () => {
    reset();
    const res = await ensurePersonalOrg(evt({ ...AMARA, groups: 'admins' }));
    assert.strictEqual(res.created, true);
  });

  // ── 4. defaultOrgId ──────────────────────────────────────────────────────
  say('\n4. defaultOrgId, which nothing wrote until now');

  await check('the home becomes the default the authorizer reads', async () => {
    reset();
    const { orgId } = await ensurePersonalOrg(evt({ ...AMARA }));
    // rejects: leaving defaultOrgId unwritten, which is the state the
    // authorizer's multi-org tie-break was in — present in the code, inert in
    // the data, and therefore never exercised.
    assert.strictEqual(profileOf(AMARA.sub).defaultOrgId, orgId);
    assert.strictEqual(profileOf(AMARA.sub).personalOrgId, orgId);
  });

  await check('somebody who joined a team first KEEPS that team as their default', async () => {
    reset();
    seedOrg(TEAM_ORG, 'Northwind Learning', [{ sub: 'u_jonah', role: 'owner' }]);
    const tok = seedInvite(TEAM_ORG, AMARA.email, 'member', 5);
    await acceptInvite(evt({ method: 'POST', ...AMARA, pathParams: { token: tok } }));
    assert.strictEqual(profileOf(AMARA.sub).defaultOrgId, TEAM_ORG);

    const { orgId } = await ensurePersonalOrg(evt({ ...AMARA }));
    // rejects: a plain `SET defaultOrgId` in personal-org.js. Moving somebody's
    // home under them reads as "all my sets disappeared" on the next sign-in.
    assert.strictEqual(profileOf(AMARA.sub).defaultOrgId, TEAM_ORG,
      'provisioning moved the default off the team they were in');
    assert.strictEqual(profileOf(AMARA.sub).personalOrgId, orgId,
      'the home was not recorded');
  });

  // ── 5. personal vs team ──────────────────────────────────────────────────
  say('\n5. `type`, on both rows, because two screens read two rows');

  await check('a provisioned home is personal in METADATA and in the platform index', async () => {
    reset();
    const { orgId } = await ensurePersonalOrg(evt({ ...AMARA }));
    assert.strictEqual(metaOf(orgId).type, 'personal');
    // rejects: writing `type` only on METADATA. 10-platform-orgs.html counts
    // "47 teams" off the index row; without it the staff console would have to
    // open every organisation to work out which entries are somebody's home.
    assert.strictEqual(indexOf_(orgId).type, 'personal');
  });

  await check('an organisation somebody deliberately CREATED is a team from birth', async () => {
    reset();
    const res = await createOrg(evt({ method: 'POST', ...AMARA, body: { name: 'Northwind Learning' } }));
    const { org } = bodyOf(res);
    // rejects: deriving `type` from the member count. A one-person org created
    // on purpose would then be undeletable and unleavable, so a mistyped name
    // becomes a permanent fixture of the switcher.
    assert.strictEqual(org.type, 'team');
    assert.strictEqual(metaOf(org.orgId).type, 'team');
    assert.strictEqual(indexOf_(org.orgId).type, 'team');
  });

  await check('publicOrg tells the switcher which entry is the home', async () => {
    reset();
    const { orgId } = await ensurePersonalOrg(evt({ ...AMARA }));
    seedOrg(TEAM_ORG, 'Northwind Learning', [{ sub: AMARA.sub, role: 'member' }]);
    const { orgs } = bodyOf(await listMyOrgs(evt({ ...AMARA })));
    const byId = Object.fromEntries(orgs.map((o) => [o.orgId, o.type]));
    assert.strictEqual(byId[orgId], 'personal');
    assert.strictEqual(byId[TEAM_ORG], 'team');
  });

  await check('an organisation written before `type` existed reads as a team', async () => {
    reset();
    seedOrg(TEAM_ORG, 'Legacy', [{ sub: AMARA.sub, role: 'owner' }], { type: undefined });
    store.set(key(`ORG#${TEAM_ORG}`, 'METADATA'),
      { ...metaOf(TEAM_ORG), type: undefined });
    // rejects: defaulting an absent `type` to personal, which would freeze
    // every organisation that predates the attribute — all of them deletable
    // today — into something nobody can leave.
    assert.strictEqual(G.orgType(metaOf(TEAM_ORG)), 'team');
    assert.strictEqual(G.isPersonalOrg(metaOf(TEAM_ORG)), false);
  });

  // ── 6. The flip ──────────────────────────────────────────────────────────
  say('\n6. the second member is what makes it a team — and it never goes back');

  async function homeWithASecondMember() {
    reset();
    const { orgId } = await ensurePersonalOrg(evt({ ...AMARA }));
    const tok = seedInvite(orgId, 'dev.mensah@x.example', 'member', 5);
    const res = await acceptInvite(evt({
      method: 'POST', sub: 'u_dev', email: 'dev.mensah@x.example', name: 'Dev Mensah',
      pathParams: { token: tok },
    }));
    assert.strictEqual(res.statusCode, 200, res.body);
    return orgId;
  }

  await check('accepting an invitation flips personal -> team on BOTH rows', async () => {
    const orgId = await homeWithASecondMember();
    // rejects: leaving the type alone when somebody joins. The organisation
    // would stay unleavable AND stay on the free cap while holding two
    // people's work.
    assert.strictEqual(metaOf(orgId).type, 'team');
    assert.strictEqual(indexOf_(orgId).type, 'team');
  });

  await check('and flips the plan with it — "free while you are the only member"', async () => {
    const orgId = await homeWithASecondMember();
    // 09-first-run.html prices exactly two things, and the second member is
    // the line between them.
    assert.strictEqual(metaOf(orgId).plan, 'team');
    assert.strictEqual(indexOf_(orgId).plan, 'team');
  });

  await check('the accept response already says team, not personal', async () => {
    reset();
    const { orgId } = await ensurePersonalOrg(evt({ ...AMARA }));
    const tok = seedInvite(orgId, 'dev@x.example', 'member', 5);
    const res = await acceptInvite(evt({
      method: 'POST', sub: 'u_dev', email: 'dev@x.example', pathParams: { token: tok },
    }));
    // rejects: answering with the org row as it was READ, which would draw
    // "· Personal" beside a team until the next reload.
    assert.strictEqual(bodyOf(res).org.type, 'team');
  });

  await check('joining an ordinary TEAM changes nothing about it', async () => {
    reset();
    seedOrg(TEAM_ORG, 'Northwind Learning', [{ sub: 'u_jonah', role: 'owner' }]);
    const before = JSON.stringify(metaOf(TEAM_ORG));
    const tok = seedInvite(TEAM_ORG, 'dev@x.example', 'member', 5);
    const res = await acceptInvite(evt({
      method: 'POST', sub: 'u_dev', email: 'dev@x.example', pathParams: { token: tok },
    }));
    // rejects: a CONDITIONAL flip inside the accept transaction. A condition
    // that is false CANCELS THE WHOLE TRANSACTION, so `type = personal` as a
    // guard would refuse every ordinary join into a team — almost all of them.
    assert.strictEqual(res.statusCode, 200, res.body);
    assert.strictEqual(JSON.stringify(metaOf(TEAM_ORG)), before,
      'joining a team rewrote the organisation');
  });

  await check('it does NOT go back when that member leaves', async () => {
    const orgId = await homeWithASecondMember();
    const res = await removeMember(evt({
      method: 'DELETE', ...AMARA, orgId, role: 'owner',
      pathParams: { orgId, sub: 'u_dev' },
    }));
    assert.strictEqual(res.statusCode, 200, res.body);
    // rejects: recomputing `type` from the member count on removal. The org now
    // holds two people's content and has been billed as a team; un-billing it
    // retroactively is not something this system can do.
    assert.strictEqual(metaOf(orgId).type, 'team');
    assert.strictEqual(metaOf(orgId).plan, 'team');
  });

  // ── 7. A home cannot be left ─────────────────────────────────────────────
  say('\n7. a home cannot be left, emptied or deleted');

  await check('its owner cannot be removed from it', async () => {
    reset();
    const { orgId } = await ensurePersonalOrg(evt({ ...AMARA }));
    const res = await removeMember(evt({
      method: 'DELETE', ...AMARA, orgId, role: 'owner',
      pathParams: { orgId, sub: AMARA.sub },
    }));
    // rejects: leaving this to the last-owner rule, which refuses with "make
    // somebody else an owner first" — advice that leads to inviting a stranger
    // into your private library in order to escape it.
    assert.strictEqual(res.statusCode, 409, res.body);
    assert.match(bodyOf(res).error, /personal organisation/i);
    assert.match(bodyOf(res).error, /account/i, 'the refusal does not say what the real operation is');
  });

  await check('and the rows are all still there afterwards', async () => {
    reset();
    const { orgId } = await ensurePersonalOrg(evt({ ...AMARA }));
    await removeMember(evt({
      method: 'DELETE', ...AMARA, orgId, role: 'owner',
      pathParams: { orgId, sub: AMARA.sub },
    }));
    // rejects: a refusal issued AFTER the transaction — the answer would be a
    // 409 over a tenant that had already been emptied.
    assert.ok(store.get(key(`ORG#${orgId}`, `MEMBER#${AMARA.sub}`)), 'the MEMBER row was deleted');
    assert.ok(store.get(key(`USER#${AMARA.sub}`, `ORG#${orgId}`)), 'the reverse row was deleted');
    assert.strictEqual(profileOf(AMARA.sub).personalOrgId, orgId);
  });

  await check('DELETING it is refused by the same guard, not by the UI', async () => {
    reset();
    const { orgId } = await ensurePersonalOrg(evt({ ...AMARA }));
    // There is no DELETE /orgs route yet; the guard is what any future one
    // must call, so it is pinned here rather than left as a comment.
    const refusal = G.personalOrgRefusal(metaOf(orgId), 'delete');
    assert.ok(refusal, 'a personal organisation can be deleted');
    assert.strictEqual(refusal.statusCode, 409);
    assert.match(JSON.parse(refusal.body).error, /cannot be deleted/i);
    assert.strictEqual(G.personalOrgRefusal({ type: 'team' }, 'delete'), null,
      'a team cannot be deleted either — the guard is refusing everything');
  });

  await check('once it is a team, it can be left like any other', async () => {
    const orgId = await homeWithASecondMember();
    // Dev leaves. rejects: keying the refusal off `provisioned` or off
    // `personalOrgId` rather than off the live `type`, either of which would
    // trap the second member in an organisation they only ever joined.
    const res = await removeMember(evt({
      method: 'DELETE', ...AMARA, orgId, role: 'owner',
      pathParams: { orgId, sub: 'u_dev' },
    }));
    assert.strictEqual(res.statusCode, 200, res.body);
  });

  // ── 8. Joining a team is not a transfer ──────────────────────────────────
  say('\n8. being invited to a team does not move your own work');

  await check('every row of the home is untouched by accepting an invitation', async () => {
    reset();
    const { orgId } = await ensurePersonalOrg(evt({ ...AMARA }));
    // Some of Amara's own work, in her own partitions.
    store.set(key(`ORG#${orgId}#SETS`, 'SET#teamretro'),
      { PK: `ORG#${orgId}#SETS`, SK: 'SET#teamretro', name: 'Team Retro' });
    store.set(key(`ORG#${orgId}#GAMES`, 'GAME#1234'),
      { PK: `ORG#${orgId}#GAMES`, SK: 'GAME#1234', orgId });
    const before = JSON.stringify([...store.entries()]
      .filter(([k]) => k.startsWith(`ORG#${orgId}`)).sort());

    seedOrg(TEAM_ORG, 'Northwind Learning', [{ sub: 'u_jonah', role: 'owner' }]);
    const tok = seedInvite(TEAM_ORG, AMARA.email, 'member', 5);
    const res = await acceptInvite(evt({ method: 'POST', ...AMARA, pathParams: { token: tok } }));
    assert.strictEqual(res.statusCode, 200, res.body);

    // rejects: any "migrate the new member's content into the team" step. Their
    // sets and sessions stay theirs; they SWITCH between organisations.
    const after = JSON.stringify([...store.entries()]
      .filter(([k]) => k.startsWith(`ORG#${orgId}`)).sort());
    assert.strictEqual(after, before, 'joining a team rewrote the personal organisation');
    assert.strictEqual(store.get(key(`ORG#${TEAM_ORG}#SETS`, 'SET#teamretro')), undefined,
      'a personal set was copied into the team');
  });

  await check('and the home is still in the switcher alongside the team', async () => {
    reset();
    const { orgId } = await ensurePersonalOrg(evt({ ...AMARA }));
    seedOrg(TEAM_ORG, 'Northwind Learning', [{ sub: 'u_jonah', role: 'owner' }]);
    const tok = seedInvite(TEAM_ORG, AMARA.email, 'member', 5);
    await acceptInvite(evt({ method: 'POST', ...AMARA, pathParams: { token: tok } }));
    const { orgs } = bodyOf(await listMyOrgs(evt({ ...AMARA })));
    assert.deepStrictEqual(orgs.map((o) => o.orgId).sort(), [orgId, TEAM_ORG].sort());
  });

  say(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
