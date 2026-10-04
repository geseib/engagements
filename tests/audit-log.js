/**
 * THE AUDIT LOG — every action Engage staff take on a team or a person is
 * written down first, with who did it, and the team (or the person) can read it.
 *
 * The owner, 2026-10-04: "make sure that any action by an Engage admin on a
 * team or user is logged, and available [to see], with who did it." Retention
 * (owner, same day): one year.
 *
 * What this pins, in order:
 *   1. the module — the row's shape (the contract another work stream writes
 *      through), the one-year ttl, Title/Reason sealed at rest and opened on
 *      read, the three places a row can land, paging, refusals;
 *   2. every inventoried staff action writes its entry with the right actor,
 *      role and target — and refuses, changing nothing, when it cannot;
 *   3. who may read: an org's owners and admins, a person their own space,
 *      staff any org (from the platform route) — never a plain member.
 *
 * rejects: a staff action that changes something with no entry; an entry that
 * names the wrong actor/role/target; a Title or Reason stored readable for an
 * org that has a key; a member reading the log; a page that repeats or drops
 * an entry; the three module copies drifting apart.
 */
const path = require('path');
const fs = require('fs');
const assert = require('assert');
const Module = require('module');

const H = require('./helpers/moderation-harness');
H.install();

/* ── Cognito, for the Accounts screen (manage-users.js) ─────────────────── */
const pool = new Map(); // username -> { sub, email, groups:Set, enabled }
const cognitoSent = [];
const cog = (name) => class { constructor(i) { this.input = i; this.name = name; } };
const COGNITO = {
  CognitoIdentityProviderClient: class {
    async send(cmd) {
      cognitoSent.push(cmd.name);
      const u = cmd.input.Username;
      const r = pool.get(u);
      const missing = () => Object.assign(new Error('User does not exist.'), { name: 'UserNotFoundException' });
      switch (cmd.name) {
        case 'AdminGetUser':
          if (!r) throw missing();
          return { Enabled: r.enabled, UserAttributes: [{ Name: 'sub', Value: r.sub }, { Name: 'email', Value: r.email }] };
        case 'AdminListGroupsForUser':
          return { Groups: [...((r && r.groups) || [])].map((GroupName) => ({ GroupName })) };
        case 'ListUsersInGroup':
          return { Users: [...pool.entries()].filter(([, x]) => x.groups.has(cmd.input.GroupName)).map(([Username, x]) => ({ Username, Enabled: x.enabled })) };
        case 'AdminAddUserToGroup': r.groups.add(cmd.input.GroupName); return {};
        case 'AdminRemoveUserFromGroup': r.groups.delete(cmd.input.GroupName); return {};
        case 'AdminDisableUser': r.enabled = false; return {};
        case 'AdminEnableUser': r.enabled = true; return {};
        case 'AdminDeleteUser': pool.delete(u); return {};
        default: throw new Error(`unexpected Cognito command ${cmd.name}`);
      }
    }
  },
};
for (const n of ['ListUsers', 'ListUsersInGroup', 'AdminListGroupsForUser', 'AdminAddUserToGroup',
  'AdminRemoveUserFromGroup', 'AdminDeleteUser', 'AdminDisableUser', 'AdminEnableUser', 'AdminGetUser']) {
  COGNITO[`${n}Command`] = cog(n);
}
{
  const realLoad = Module._load;
  Module._load = function (request, parent, isMain) {
    if (request === '@aws-sdk/client-cognito-identity-provider') return COGNITO;
    return realLoad.call(this, request, parent, isMain);
  };
}
process.env.USER_POOL_ID = 'us-east-1_TEST';

const { DynamoDBDocumentClient } = require('@aws-sdk/lib-dynamodb');
const db = DynamoDBDocumentClient.from({});
const AL = path.join(H.REPO, 'lambda-functions');
const A = require(path.join(AL, 'admin/shared/audit-log.js'));
const C = require(path.join(AL, 'admin/shared/tenant-crypto.js'));
const { createPagedTable } = require('./helpers/paged-table');
const { isEnvelope } = C;

const manageUsers = require(path.join(AL, 'admin/manage-users.js')).handler;
const platformOrgs = require(path.join(AL, 'admin/orgs/platform-orgs.js')).handler;
const getOrg = require(path.join(AL, 'admin/orgs/get-org.js')).handler;
const planRequests = require(path.join(AL, 'admin/orgs/plan-requests.js'));
const adjustments = require(path.join(AL, 'admin/orgs/adjustments.js')).handler;
const categories = require(path.join(AL, 'admin/update-game-categories.js')).handler;
const { ensurePersonalOrg } = require(path.join(AL, 'admin/orgs/shared/personal-org.js'));
const authorizer = require(path.join(AL, 'auth/authorizer.js'));

const parse = (res) => JSON.parse(res.body || '{}');
const rows = (pk) => H.rowsWhere((r) => r.PK === pk).sort((a, b) => (a.SK < b.SK ? -1 : 1));

/* ── People and places ──────────────────────────────────────────────────── */
const TEAM = 'org_1111111111111111111111';
const HOME = 'org_2222222222222222222222'; // Pat's personal space
const STAFF = { sub: 'sub-dai', email: 'dai@engage.example', name: 'Dai Staff' };
const OWNER = { sub: 'sub-owner', email: 'owner@team.example', role: 'owner' };
const ADMIN = { sub: 'sub-admin', email: 'admin@team.example', role: 'admin' };
const MEMBER = { sub: 'sub-member', email: 'member@team.example', role: 'member' };

/** Engage staff in platform mode (no active org), as the authorizer sends it. */
function staffEvent({ method = 'POST', body, pathParameters = {}, rawPath = '', query } = {}) {
  return {
    rawPath,
    requestContext: {
      http: { method, path: rawPath },
      authorizer: { lambda: { userId: STAFF.sub, username: 'dai', email: STAFF.email, name: STAFF.name, groups: 'admins', orgId: '', orgRole: '' } },
    },
    pathParameters,
    ...(query ? { queryStringParameters: query } : {}),
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  };
}
/** A member of `orgId`, acting for it. */
function memberEvent(m, orgId, { method = 'GET', rawPath = '', query, groups = 'hosts' } = {}) {
  return {
    rawPath,
    requestContext: {
      http: { method, path: rawPath },
      authorizer: { lambda: { userId: m.sub, email: m.email, groups, orgId, orgRole: m.role, orgIds: orgId } },
    },
    pathParameters: { orgId },
    ...(query ? { queryStringParameters: query } : {}),
  };
}

function seedOrg(orgId, name, members, { type = 'team', plan = 'free', status = 'active' } = {}) {
  H.seedRow({ PK: `ORG#${orgId}`, SK: 'METADATA', orgId, name, type, plan, status, createdAt: '2026-02-01T00:00:00.000Z', dataKeyCiphertext: 'seeded' });
  H.seedRow({ PK: 'ORGS', SK: `ORG#${orgId}`, orgId, name, type, plan, status });
  for (const m of members) {
    H.seedRow({ PK: `ORG#${orgId}`, SK: `MEMBER#${m.sub}`, orgId, userId: m.sub, role: m.role, email: m.email });
    H.seedRow({ PK: `USER#${m.sub}`, SK: `ORG#${orgId}`, orgId, userId: m.sub, role: m.role });
  }
}

/** Make every write to an audit partition fail, for one call. */
async function withAuditWritesFailing(fn) {
  const map = H.state.ddb;
  const realSet = map.set.bind(map);
  map.set = (k, v) => {
    if (/#AUDIT\|/.test(k) || /^PLATFORM#AUDIT\|/.test(k)) {
      throw Object.assign(new Error('simulated throttle'), { name: 'ProvisionedThroughputExceededException' });
    }
    return realSet(k, v);
  };
  try { return await fn(); } finally { map.set = realSet; }
}

(async () => {
  console.log('\naudit log\n');

  /* ════════════════════════ 1. THE MODULE ════════════════════════ */

  await H.test('the three copies of audit-log.js are byte-identical', async () => {
    const read = (p) => fs.readFileSync(path.join(AL, p), 'utf8');
    const admin = read('admin/shared/audit-log.js');
    assert.strictEqual(read('game/audit-log.js'), admin, 'game/ copy differs');
    assert.strictEqual(read('websocket/audit-log.js'), admin, 'websocket/ copy differs');
  });

  await H.test('an entry has the contract\'s shape, and is kept for one year', async () => {
    H.reset();
    const before = Math.floor(Date.now() / 1000);
    const ref = await A.recordAudit(db, {
      orgId: TEAM, action: 'org.suspend',
      actor: { ...STAFF, role: 'platform-admin' },
      target: { type: 'org', id: TEAM, title: 'Northwind' },
      reason: 'Spam reported by three teams.', detail: { from: 'active', to: 'suspended' },
    });
    const [row] = rows(`ORG#${TEAM}#AUDIT`);
    assert.ok(row, 'no org row');
    assert.strictEqual(ref.SK, row.SK);
    assert.match(row.SK, /^\d{4}-\d{2}-\d{2}T[0-9:.]+Z#[0-9a-f]{8}$/);
    assert.strictEqual(row.At, row.SK.split('#')[0]);
    assert.strictEqual(row.OrgId, TEAM);
    assert.strictEqual(row.Action, 'org.suspend');
    assert.deepStrictEqual(row.Actor, { Sub: STAFF.sub, Email: STAFF.email, Name: STAFF.name, Role: 'platform-admin' });
    assert.deepStrictEqual(row.Target, { Type: 'org', Id: TEAM });
    assert.deepStrictEqual(row.Detail, { from: 'active', to: 'suspended' });
    assert.strictEqual(A.RETENTION_DAYS, 365);
    const want = Math.floor(new Date(row.At).getTime() / 1000) + 365 * 86400;
    assert.strictEqual(row.ttl, want);
    assert.ok(Math.abs(row.ttl - (before + 365 * 86400)) <= 1, `ttl ${row.ttl} is not a year from now`);
  });

  await H.test('Title and Reason are ciphertext at rest and plain on read', async () => {
    H.reset();
    await A.recordAudit(db, {
      orgId: TEAM, action: 'billing.grant', actor: { ...STAFF, role: 'platform-admin' },
      target: { type: 'adjustment', id: 'adj1', title: 'Credit' }, reason: 'Outage on 2 October.',
    });
    const [row] = rows(`ORG#${TEAM}#AUDIT`);
    assert.ok(isEnvelope(row.Title), 'Title is stored readable');
    assert.ok(isEnvelope(row.Reason), 'Reason is stored readable');
    assert.ok(!JSON.stringify(row).includes('Outage'), 'the reason leaks in plaintext somewhere on the row');
    assert.strictEqual(row.Sealed, undefined);
    const { entries } = await A.readAudit(db, { orgId: TEAM });
    assert.strictEqual(entries[0].reason, 'Outage on 2 October.');
    assert.strictEqual(entries[0].target.title, 'Credit');
    assert.strictEqual(entries[0].actor.role, 'platform-admin');
  });

  await H.test('staff entries are indexed for the platform view; a host\'s are not', async () => {
    H.reset();
    await A.recordAudit(db, { orgId: TEAM, action: 'org.suspend', actor: { ...STAFF, role: 'platform-admin' }, target: { type: 'org', id: TEAM, title: 'N' } });
    await A.recordAudit(db, { orgId: TEAM, action: 'session.delete', actor: { sub: OWNER.sub, role: 'host' }, target: { type: 'session', id: '1234', title: 'Retro' } });
    assert.strictEqual(rows(`ORG#${TEAM}#AUDIT`).length, 2);
    const idx = rows(A.PLATFORM_AUDIT_PK);
    assert.strictEqual(idx.length, 1);
    assert.strictEqual(idx[0].Action, 'org.suspend');
    assert.ok(isEnvelope(idx[0].Title), 'the index carries the sealed field, not a readable copy');
    assert.ok(idx[0].ttl > 0, 'the index row has no ttl');
    const feed = await A.readPlatformAudit(db, {});
    assert.strictEqual(feed.entries[0].target.title, 'N', 'the staff feed opens each row with its own org');
  });

  await H.test('an action on a person with no space yet waits in a holding partition, unsealed', async () => {
    H.reset();
    await A.recordAudit(db, { orgId: '', action: 'user.approve', actor: { ...STAFF, role: 'platform-admin' }, target: { type: 'user', id: 'sub-pat', title: 'pat@x.example' }, reason: 'Known customer.' });
    const [held] = rows('USER#sub-pat#AUDIT');
    assert.ok(held);
    assert.strictEqual(held.Title, 'pat@x.example');
    assert.strictEqual(held.Sealed, false);
    assert.ok(held.ttl > 0);
    assert.strictEqual(rows(A.PLATFORM_AUDIT_PK).length, 1);
  });

  await H.test('only staff may write an entry with no organisation and no person', async () => {
    H.reset();
    await A.recordAudit(db, { orgId: '', action: 'code.create', actor: { ...STAFF, role: 'platform-admin' }, target: { type: 'code', id: 'SPRING', title: 'SPRING' } });
    assert.strictEqual(rows(A.PLATFORM_AUDIT_PK).length, 1);
    await assert.rejects(A.recordAudit(db, { orgId: '', action: 'code.create', actor: { sub: 'x', role: 'host' }, target: { type: 'code', id: 'X' } }), /organisation/);
  });

  await H.test('a malformed entry throws rather than writing something unattributable', async () => {
    H.reset();
    const ok = { orgId: TEAM, action: 'org.suspend', actor: { ...STAFF, role: 'platform-admin' }, target: { type: 'org', id: TEAM } };
    await assert.rejects(A.recordAudit(db, { ...ok, action: 'suspend' }), /dotted/);
    await assert.rejects(A.recordAudit(db, { ...ok, actor: { ...STAFF, role: 'god' } }), /role/);
    await assert.rejects(A.recordAudit(db, { ...ok, actor: { role: 'platform-admin' } }), /sub/);
    await assert.rejects(A.recordAudit(db, { ...ok, target: { id: 'x' } }), /type/);
    assert.strictEqual(H.rowsWhere((r) => /AUDIT/.test(r.PK)).length, 0);
  });

  await H.test('Detail keeps ids and counts and drops prose and nested objects', async () => {
    H.reset();
    await A.recordAudit(db, {
      orgId: TEAM, action: 'org.suspend', actor: { ...STAFF, role: 'platform-admin' }, target: { type: 'org', id: TEAM },
      detail: { count: 3, ok: true, id: 'abc', note: 'x'.repeat(500), nested: { a: 1 }, ids: ['a', 'b', { c: 1 }] },
    });
    assert.deepStrictEqual(rows(`ORG#${TEAM}#AUDIT`)[0].Detail, { count: 3, ok: true, id: 'abc', ids: ['a', 'b'] });
  });

  await H.test('a failed write throws, and a failed index write takes the org row back', async () => {
    H.reset();
    await withAuditWritesFailing(() => assert.rejects(A.recordAudit(db, { orgId: TEAM, action: 'org.suspend', actor: { ...STAFF, role: 'platform-admin' }, target: { type: 'org', id: TEAM } })));
    const map = H.state.ddb; const realSet = map.set.bind(map);
    map.set = (k, v) => { if (k.startsWith('PLATFORM#AUDIT|')) throw new Error('index down'); return realSet(k, v); };
    try {
      await assert.rejects(A.recordAudit(db, { orgId: TEAM, action: 'org.suspend', actor: { ...STAFF, role: 'platform-admin' }, target: { type: 'org', id: TEAM } }), /index down/);
    } finally { map.set = realSet; }
    assert.strictEqual(rows(`ORG#${TEAM}#AUDIT`).length, 0, 'an org row was left standing for a refused action');
  });

  await H.test('an organisation with no data key still gets its entry, marked unsealed', async () => {
    H.reset();
    C.setCiphertextLoader(async () => '');
    C.forgetOrg();
    try {
      await A.recordAudit(db, { orgId: TEAM, action: 'org.suspend', actor: { ...STAFF, role: 'platform-admin' }, target: { type: 'org', id: TEAM, title: 'Old org' }, reason: 'r' });
      const [row] = rows(`ORG#${TEAM}#AUDIT`);
      assert.strictEqual(row.Title, 'Old org');
      assert.strictEqual(row.Sealed, false);
    } finally { H.reset(); }
  });

  await H.test('any other crypto failure throws, so the action would be refused', async () => {
    H.reset();
    C.setCiphertextLoader(async () => { throw new Error('AccessDeniedException: kms:Decrypt'); });
    C.forgetOrg();
    try {
      await assert.rejects(A.recordAudit(db, { orgId: TEAM, action: 'org.suspend', actor: { ...STAFF, role: 'platform-admin' }, target: { type: 'org', id: TEAM, title: 'x' } }), /AccessDenied/);
      assert.strictEqual(rows(`ORG#${TEAM}#AUDIT`).length, 0);
    } finally { H.reset(); }
  });

  await H.test('markAuditOutcome says the action did not go through, on both rows', async () => {
    H.reset();
    const ref = await A.recordAudit(db, { orgId: TEAM, action: 'org.suspend', actor: { ...STAFF, role: 'platform-admin' }, target: { type: 'org', id: TEAM } });
    await A.markAuditOutcome(db, ref, 'failed');
    assert.strictEqual(rows(`ORG#${TEAM}#AUDIT`)[0].Outcome, 'failed');
    assert.strictEqual(rows(A.PLATFORM_AUDIT_PK)[0].Outcome, 'failed');
    const { entries } = await A.readAudit(db, { orgId: TEAM });
    assert.strictEqual(entries[0].outcome, 'failed');
  });

  await H.test('paging walks past one page, newest first, with no repeats and no gaps', async () => {
    const paged = createPagedTable({ pageSize: 3 });
    // The harness's command classes carry `kind`; the paged table reads `type`.
    const table = { put: paged.put, send: (cmd) => paged.send({ type: cmd.kind || cmd.type, input: cmd.input }) };
    const real = Date.now();
    for (let i = 0; i < 8; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      await A.recordAudit(table, { orgId: TEAM, action: 'org.suspend', actor: { sub: OWNER.sub, role: 'org-owner' }, target: { type: 'org', id: TEAM, title: `t${i}` }, detail: { i } }, { now: new Date(real + i * 1000) });
    }
    table.put({ PK: `ORG#${HOME}#AUDIT`, SK: '2099-01-01T00:00:00.000Z#ffffffff', Action: 'x.y', OrgId: HOME });
    const seen = [];
    let cursor = '';
    let pages = 0;
    do {
      // eslint-disable-next-line no-await-in-loop
      const page = await A.readAudit(table, { orgId: TEAM, limit: 3, cursor });
      seen.push(...page.entries.map((e) => e.detail.i));
      cursor = page.cursor;
      pages += 1;
    } while (cursor && pages < 10);
    assert.deepStrictEqual(seen, [7, 6, 5, 4, 3, 2, 1, 0]);
    assert.ok(pages >= 3, `read in ${pages} page(s)`);
  });

  await H.test('a page marker the log did not give out is refused', async () => {
    H.reset();
    await assert.rejects(A.readAudit(db, { orgId: TEAM, cursor: 'not-a-cursor' }), (e) => e.statusCode === 400);
    const forged = Buffer.from(JSON.stringify({ sk: 'METADATA' })).toString('base64url');
    await assert.rejects(A.readAudit(db, { orgId: TEAM, cursor: forged }), (e) => e.statusCode === 400);
  });

  /* ════════════════════ 2. EVERY STAFF ACTION ════════════════════ */

  /* ── Accounts (manage-users.js) ── */
  const seedPool = () => {
    pool.clear(); cognitoSent.length = 0;
    pool.set('dai', { sub: STAFF.sub, email: STAFF.email, groups: new Set(['admins']), enabled: true });
    pool.set('dee', { sub: 'sub-dee', email: 'dee@engage.example', groups: new Set(['admins']), enabled: true });
    pool.set('pat', { sub: 'sub-pat', email: 'pat@x.example', groups: new Set(['pending']), enabled: true });
    pool.set('sam', { sub: 'sub-sam', email: 'sam@x.example', groups: new Set(['hosts']), enabled: true });
  };
  const userState = (username, newState, extra = {}) => manageUsers(staffEvent({
    method: 'PUT', rawPath: `/admin/users/${username}/state`, pathParameters: { username }, body: { newState, ...extra },
  }));
  const MUTATING = ['AdminAddUserToGroup', 'AdminRemoveUserFromGroup', 'AdminDisableUser', 'AdminEnableUser', 'AdminDeleteUser'];

  await H.test('approving a pending account is recorded (no space yet: held, and in the staff index)', async () => {
    H.reset(); seedPool();
    const res = await userState('pat', 'hosts', { reason: 'Signed the pilot.' });
    assert.strictEqual(res.statusCode, 200, res.body);
    const [held] = rows('USER#sub-pat#AUDIT');
    assert.ok(held, 'no entry');
    assert.strictEqual(held.Action, 'user.approve');
    assert.strictEqual(held.Actor.Sub, STAFF.sub);
    assert.strictEqual(held.Actor.Email, STAFF.email);
    assert.strictEqual(held.Actor.Role, 'platform-admin');
    assert.deepStrictEqual(held.Target, { Type: 'user', Id: 'sub-pat' });
    assert.strictEqual(held.Reason, 'Signed the pilot.');
    assert.deepStrictEqual(held.Detail, { from: 'pending', to: 'hosts' });
    assert.strictEqual(rows(A.PLATFORM_AUDIT_PK).length, 1);
    assert.ok(pool.get('pat').groups.has('hosts'));
  });

  await H.test('...and when their space is made, the entry moves in, sealed, and they can read it', async () => {
    // Continues from the approval above: Pat's first console load.
    const evt = { requestContext: { authorizer: { lambda: { userId: 'sub-pat', email: 'pat@x.example', groups: 'hosts' } } } };
    const made = await ensurePersonalOrg(evt);
    assert.strictEqual(made.created, true, JSON.stringify(made));
    assert.strictEqual(rows('USER#sub-pat#AUDIT').length, 0, 'the holding row was not removed');
    const [moved] = rows(`ORG#${made.orgId}#AUDIT`);
    assert.ok(moved, 'the entry did not move into the space');
    assert.strictEqual(moved.OrgId, made.orgId);
    assert.ok(isEnvelope(moved.Title) && isEnvelope(moved.Reason), 'moved but not sealed');
    assert.strictEqual(moved.Sealed, undefined);
    const res = await getOrg(memberEvent({ sub: 'sub-pat', email: 'pat@x.example', role: 'owner' }, made.orgId, { rawPath: `/orgs/${made.orgId}/audit` }));
    assert.strictEqual(res.statusCode, 200, res.body);
    const { entries } = parse(res);
    assert.strictEqual(entries.length, 1);
    assert.strictEqual(entries[0].action, 'user.approve');
    assert.strictEqual(entries[0].reason, 'Signed the pilot.');
    assert.strictEqual(entries[0].actor.email, STAFF.email);
  });

  await H.test('disabling an account with a space writes to that space, sealed', async () => {
    H.reset(); seedPool();
    seedOrg(HOME, 'Sam', [{ sub: 'sub-sam', email: 'sam@x.example', role: 'owner' }], { type: 'personal' });
    H.seedRow({ PK: 'USER#sub-sam', SK: 'PROFILE', personalOrgId: HOME });
    const res = await userState('sam', 'disabled', { reason: 'Abuse report #12' });
    assert.strictEqual(res.statusCode, 200, res.body);
    const [row] = rows(`ORG#${HOME}#AUDIT`);
    assert.ok(row, 'no entry in the person\'s space');
    assert.strictEqual(row.Action, 'user.disable');
    assert.ok(isEnvelope(row.Title) && isEnvelope(row.Reason));
    assert.deepStrictEqual(row.Target, { Type: 'user', Id: 'sub-sam' });
  });

  for (const [state, action, who] of [['admins', 'user.make-admin', 'sam'], ['pending', 'user.set-pending', 'sam'], ['delete', 'user.delete', 'sam']]) {
    // eslint-disable-next-line no-await-in-loop
    await H.test(`${state}: recorded as ${action}`, async () => {
      H.reset(); seedPool();
      const res = await userState(who, state);
      assert.strictEqual(res.statusCode, 200, res.body);
      const [row] = rows('USER#sub-sam#AUDIT');
      assert.strictEqual(row && row.Action, action);
    });
  }

  await H.test('an account change whose entry cannot be written is refused, and Cognito is untouched', async () => {
    H.reset(); seedPool();
    const res = await withAuditWritesFailing(() => userState('pat', 'hosts'));
    assert.strictEqual(res.statusCode, 503, res.body);
    assert.ok(!cognitoSent.some((c) => MUTATING.includes(c)), `Cognito was changed: ${cognitoSent.join(', ')}`);
    assert.ok(pool.get('pat').groups.has('pending') && !pool.get('pat').groups.has('hosts'));
  });

  await H.test('a refused change (the last-admin guard) writes no entry', async () => {
    H.reset(); seedPool();
    pool.get('dee').groups.delete('admins');
    const res = await userState('dai', 'hosts');
    assert.strictEqual(res.statusCode, 409);
    assert.strictEqual(H.rowsWhere((r) => /AUDIT/.test(r.PK)).length, 0);
  });

  /* ── Organisations (platform-orgs.js) ── */
  const setStatus = (orgId, status, reason) => platformOrgs(staffEvent({
    rawPath: `/platform/orgs/${orgId}/status`, pathParameters: { orgId }, body: { status, ...(reason ? { reason } : {}) },
  }));

  await H.test('suspending a team is recorded with who, why and from-to', async () => {
    H.reset(); seedOrg(TEAM, 'Northwind', [OWNER, ADMIN, MEMBER]);
    const res = await setStatus(TEAM, 'suspended', 'Phishing links in a public set.');
    assert.strictEqual(res.statusCode, 200, res.body);
    const [row] = rows(`ORG#${TEAM}#AUDIT`);
    assert.strictEqual(row.Action, 'org.suspend');
    assert.strictEqual(row.Actor.Role, 'platform-admin');
    assert.deepStrictEqual(row.Target, { Type: 'org', Id: TEAM });
    assert.deepStrictEqual(row.Detail, { from: 'active', to: 'suspended' });
    assert.strictEqual(H.plainRow(TEAM, row).Reason, 'Phishing links in a public set.');
    assert.strictEqual(H.plainRow(TEAM, row).Title, 'Northwind');
    const res2 = await setStatus(TEAM, 'active');
    assert.strictEqual(res2.statusCode, 200);
    assert.ok(rows(`ORG#${TEAM}#AUDIT`).some((x) => x.Action === 'org.reinstate'));
  });

  await H.test('approving a waiting team is org.approve', async () => {
    H.reset(); seedOrg(TEAM, 'Northwind', [OWNER], { status: 'pending' });
    assert.strictEqual((await setStatus(TEAM, 'active')).statusCode, 200);
    assert.strictEqual(rows(`ORG#${TEAM}#AUDIT`)[0].Action, 'org.approve');
  });

  await H.test('a status change whose entry cannot be written leaves the team as it was', async () => {
    H.reset(); seedOrg(TEAM, 'Northwind', [OWNER]);
    const res = await withAuditWritesFailing(() => setStatus(TEAM, 'suspended'));
    assert.strictEqual(res.statusCode, 503, res.body);
    assert.strictEqual(H.state.ddb.get(`ORG#${TEAM}|METADATA`).status, 'active');
    assert.strictEqual(H.state.ddb.get(`ORGS|ORG#${TEAM}`).status, 'active');
  });

  /* ── Plan requests (plan-requests.js) ── */
  const fileOne = async () => {
    const res = await planRequests.fileRequest({ org: { plan: 'free', type: 'team', name: 'Northwind' }, orgId: TEAM, toPlan: 'team', by: OWNER.sub });
    return parse(res).request.reqId;
  };
  const decide = (reqId, decision, note) => planRequests.handler(staffEvent({
    rawPath: `/platform/plan-requests/${TEAM}/${reqId}/decide`, pathParameters: { orgId: TEAM, reqId }, body: { decision, note },
  }));

  await H.test('approving a plan request is recorded, with the note as the reason', async () => {
    H.reset(); seedOrg(TEAM, 'Northwind', [OWNER]);
    const reqId = await fileOne();
    const res = await decide(reqId, 'approved', 'Welcome aboard.');
    assert.strictEqual(res.statusCode, 200, res.body);
    const [row] = rows(`ORG#${TEAM}#AUDIT`);
    assert.strictEqual(row.Action, 'plan.approve');
    assert.deepStrictEqual(row.Target, { Type: 'plan-request', Id: reqId });
    assert.strictEqual(H.plainRow(TEAM, row).Reason, 'Welcome aboard.');
    assert.strictEqual(row.Detail.toPlan, 'team');
  });

  await H.test('declining is plan.decline; an unwritable entry decides nothing', async () => {
    H.reset(); seedOrg(TEAM, 'Northwind', [OWNER]);
    const reqId = await fileOne();
    const refused = await withAuditWritesFailing(() => decide(reqId, 'approved', 'ok'));
    assert.strictEqual(refused.statusCode, 503, refused.body);
    const req = H.rowsWhere((r) => r.PK === `ORG#${TEAM}` && String(r.SK).startsWith('PLANREQ#'))[0];
    assert.strictEqual(req.status, 'requested');
    assert.strictEqual(H.state.ddb.get(`ORG#${TEAM}|METADATA`).plan, 'free');
    assert.strictEqual((await decide(reqId, 'declined', 'Not yet.')).statusCode, 200);
    assert.strictEqual(rows(`ORG#${TEAM}#AUDIT`)[0].Action, 'plan.decline');
  });

  /* ── Billing ledger and codes (adjustments.js) ── */
  const grant = (body) => adjustments(staffEvent({ rawPath: `/platform/orgs/${TEAM}/adjustments`, pathParameters: { orgId: TEAM }, body }));

  await H.test('a grant and its revoke are each recorded, with the ledger\'s note as the reason', async () => {
    H.reset(); seedOrg(TEAM, 'Northwind', [OWNER]);
    const res = await grant({ kind: 'CREDIT_CENTS', amountCents: 2500, note: 'Outage credit.' });
    assert.strictEqual(res.statusCode, 201, res.body);
    const adjId = parse(res).adjustment.adjId;
    const rev = await adjustments(staffEvent({ rawPath: `/platform/orgs/${TEAM}/adjustments/${adjId}/revoke`, pathParameters: { orgId: TEAM, adjId }, body: { note: 'Granted twice.' } }));
    assert.strictEqual(rev.statusCode, 200, rev.body);
    const all = rows(`ORG#${TEAM}#AUDIT`);
    const g = all.find((x) => x.Action === 'billing.grant');
    const r = all.find((x) => x.Action === 'billing.revoke');
    assert.ok(g && r, all.map((x) => x.Action).join(', '));
    assert.strictEqual(g.Action, 'billing.grant');
    assert.deepStrictEqual(g.Target, { Type: 'adjustment', Id: adjId });
    assert.strictEqual(g.Detail.amountCents, 2500);
    assert.strictEqual(H.plainRow(TEAM, g).Reason, 'Outage credit.');
    assert.strictEqual(r.Action, 'billing.revoke');
    assert.strictEqual(H.plainRow(TEAM, r).Reason, 'Granted twice.');
    const ledger = H.rowsWhere((x) => x.PK === `ORG#${TEAM}` && String(x.SK).startsWith('ADJ#'))[0];
    assert.strictEqual(ledger.createdBy, STAFF.sub, 'the ledger keeps its own actor too');
  });

  await H.test('a grant whose entry cannot be written grants nothing', async () => {
    H.reset(); seedOrg(TEAM, 'Northwind', [OWNER]);
    const res = await withAuditWritesFailing(() => grant({ kind: 'CREDIT_CENTS', amountCents: 2500, note: 'x' }));
    assert.strictEqual(res.statusCode, 503, res.body);
    assert.strictEqual(H.rowsWhere((x) => String(x.SK).startsWith('ADJ#')).length, 0);
  });

  await H.test('creating and retiring a discount code is recorded in the staff index', async () => {
    H.reset();
    const made = await adjustments(staffEvent({ rawPath: '/platform/codes', body: { code: 'SPRING26', percentOff: 20, note: 'Spring promo.' } }));
    assert.strictEqual(made.statusCode, 201, made.body);
    const gone = await adjustments(staffEvent({ rawPath: '/platform/codes/SPRING26/retire', pathParameters: { code: 'SPRING26' } }));
    assert.strictEqual(gone.statusCode, 200, gone.body);
    const idx = rows(A.PLATFORM_AUDIT_PK);
    // Two entries in one millisecond have no order between them; find each.
    assert.deepStrictEqual(idx.map((x) => x.Action).sort(), ['code.create', 'code.retire']);
    const created = idx.find((x) => x.Action === 'code.create');
    assert.deepStrictEqual(created.Target, { Type: 'code', Id: 'SPRING26' });
    assert.strictEqual(created.Reason, 'Spring promo.');
    const refused = await withAuditWritesFailing(() => adjustments(staffEvent({ rawPath: '/platform/codes', body: { code: 'NOPE26', percentOff: 5 } })));
    assert.strictEqual(refused.statusCode, 503);
    assert.ok(!H.state.ddb.get('ORGS|CODE#NOPE26'), 'the code was created anyway');
  });

  /* ── A session's categories (update-game-categories.js) ── */
  await H.test('staff changing a team session\'s categories is recorded; an unwritable entry changes nothing', async () => {
    H.reset(); seedOrg(TEAM, 'Northwind', [OWNER]);
    H.seedRow({ PK: 'GAME#4821', SK: 'METADATA', orgId: TEAM, QuestionSetId: 'trivia1', Title: await C.encryptValue(TEAM, 'Friday retro') });
    H.seedRow({ PK: 'GAME#4821', SK: 'STATE#CATS', 'HostMask1-8': '11111111' });
    H.seedRow({ PK: 'SET#trivia1', SK: 'CATEGORY#Science' });
    H.seedRow({ PK: 'SET#trivia1', SK: 'CATEGORY#History' });
    const call = () => categories(staffEvent({ method: 'PUT', rawPath: '/admin/games/4821/categories', pathParameters: { gameId: '4821' }, body: { selectedCategories: ['History'] } }));
    const refused = await withAuditWritesFailing(call);
    assert.strictEqual(refused.statusCode, 503, refused.body);
    assert.strictEqual(H.state.ddb.get('GAME#4821|STATE#CATS')['HostMask1-8'], '11111111');
    const res = await call();
    assert.strictEqual(res.statusCode, 200, res.body);
    const [row] = rows(`ORG#${TEAM}#AUDIT`);
    assert.strictEqual(row.Action, 'session.categories');
    assert.deepStrictEqual(row.Target, { Type: 'session', Id: '4821' });
    assert.strictEqual(H.plainRow(TEAM, row).Title, 'Friday retro');
  });

  /* ═══════════════════════ 3. WHO MAY READ ═══════════════════════ */

  const readAs = (m, orgId, query) => getOrg(memberEvent(m, orgId, { rawPath: `/orgs/${orgId}/audit`, query }));

  await H.test('a team\'s owner and admins read its log; a member and an outsider do not', async () => {
    H.reset(); seedOrg(TEAM, 'Northwind', [OWNER, ADMIN, MEMBER]);
    await setStatus(TEAM, 'suspended', 'Why.');
    for (const m of [OWNER, ADMIN]) {
      // eslint-disable-next-line no-await-in-loop
      const res = await readAs(m, TEAM);
      assert.strictEqual(res.statusCode, 200, `${m.role}: ${res.body}`);
      const e = parse(res).entries[0];
      assert.strictEqual(e.action, 'org.suspend');
      assert.strictEqual(e.reason, 'Why.');
      assert.strictEqual(e.actor.name, STAFF.name);
    }
    assert.strictEqual((await readAs(MEMBER, TEAM)).statusCode, 403);
    const outsider = { sub: 'sub-out', email: 'o@x.example', role: 'owner' };
    assert.strictEqual((await readAs(outsider, TEAM)).statusCode, 403, 'an owner of nothing here read the log');
  });

  await H.test('staff are not let in through the team\'s own route...', async () => {
    const staffAsCaller = staffEvent({ method: 'GET', rawPath: `/orgs/${TEAM}/audit`, pathParameters: { orgId: TEAM } });
    assert.strictEqual((await getOrg(staffAsCaller)).statusCode, 403);
  });

  await H.test('...they read any team\'s log, and the staff-wide feed, from the platform route', async () => {
    const one = await platformOrgs(staffEvent({ method: 'GET', rawPath: '/platform/audit', query: { orgId: TEAM } }));
    assert.strictEqual(one.statusCode, 200, one.body);
    assert.strictEqual(parse(one).entries[0].reason, 'Why.');
    const feed = await platformOrgs(staffEvent({ method: 'GET', rawPath: '/platform/audit' }));
    assert.strictEqual(feed.statusCode, 200, feed.body);
    assert.strictEqual(parse(feed).entries[0].orgId, TEAM);
    const host = memberEvent(OWNER, TEAM, { rawPath: '/platform/audit' });
    assert.strictEqual((await platformOrgs(host)).statusCode, 403, 'a team owner read the staff feed');
  });

  await H.test('the reader pages through the route too', async () => {
    H.reset(); seedOrg(TEAM, 'Northwind', [OWNER]);
    for (let i = 0; i < 5; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      await A.recordAudit(db, { orgId: TEAM, action: 'org.suspend', actor: { ...STAFF, role: 'platform-admin' }, target: { type: 'org', id: TEAM } }, { now: new Date(Date.UTC(2026, 9, 4, 10, 0, i)) });
    }
    const first = parse(await readAs(OWNER, TEAM, { limit: '2' }));
    // The harness answers a Query in one page; the module's cursor is pinned by
    // the paged-table test above. Here: the limit reaches the query, newest first.
    assert.ok(first.entries.length >= 2);
    assert.ok(first.entries[0].at > first.entries[1].at);
    const bad = await readAs(OWNER, TEAM, { cursor: 'junk' });
    assert.strictEqual(bad.statusCode, 400);
  });

  /* ═════════════════ 4. THE ROUTES ARE WIRED ═════════════════ */

  await H.test('the authorizer lets only staff knock on /platform/audit, and team members on /orgs/{id}/audit', async () => {
    assert.deepStrictEqual(authorizer.requiredGroupsForRoute('GET', 'platform/audit'), ['admins']);
    assert.deepStrictEqual(authorizer.requiredGroupsForRoute('GET', 'orgs/{orgId}/audit'), ['hosts', 'admins']);
  });

  await H.test('the template mounts both readers on existing functions', async () => {
    const t = fs.readFileSync(path.join(H.REPO, 'template-clean.yaml'), 'utf8');
    const block = (name) => {
      const start = t.indexOf(`\n  ${name}:\n`);
      const rest = t.slice(start + 1);
      const end = rest.slice(3).search(/\n {2}[A-Za-z0-9]+:\n/);
      return rest.slice(0, end + 3);
    };
    assert.match(block('OrgGetFunction'), /Path: \/orgs\/\{orgId\}\/audit\s+Method: GET/);
    assert.match(block('PlatformOrgsFunction'), /Path: \/platform\/audit\s+Method: GET/);
  });

  H.summary();
})();
