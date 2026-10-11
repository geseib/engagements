/**
 * GET /me/attention — counts per scope for the console's tabs
 * (lambda-functions/admin/orgs/my-attention.js; docs/design/admin-landing,
 * open question 2, owner 2026-10-11).
 *
 * What it must never do, each pinned below:
 *   - answer anybody without a signed-in identity;
 *   - count a team's members or invitations for a plain MEMBER of that team
 *     (those are owner/admin boxes; a member's Overview does not show them);
 *   - count Engage's queues for anybody outside the `admins` group;
 *   - return anything but numbers (no names, no titles, no rows);
 *   - read one page and stop: the table here pages every 2 rows
 *     (tests/helpers/paged-table.js), so a reader that stops early undercounts.
 */
const suiteFinished = require('./helpers/finish-guard');
const path = require('path');
const assert = require('assert');
const Module = require('module');
const { createPagedTable, commands } = require('./helpers/paged-table');

const REPO = path.join(__dirname, '..');
const LF = path.join(REPO, 'lambda-functions');

const stubs = new Map();
const realLoad = Module._load;
Module._load = function load(request, parent, isMain) {
  if (stubs.has(request)) return stubs.get(request);
  return realLoad.call(this, request, parent, isMain);
};
const stub = (name, exports) => stubs.set(name, exports);

const table = createPagedTable({ pageSize: 2 });
stub('@aws-sdk/client-dynamodb', { DynamoDBClient: class {} });
stub('@aws-sdk/lib-dynamodb', {
  DynamoDBDocumentClient: { from: () => table },
  TransactWriteCommand: class { constructor(i) { this.input = i; this.type = 'transact'; } },
  BatchWriteCommand: class { constructor(i) { this.input = i; this.type = 'batch'; } },
  ...commands,
});
class ListUsersInGroupCommand { constructor(i) { this.input = i; } }
const cognitoState = { pending: [], calls: 0 };
stub('@aws-sdk/client-cognito-identity-provider', {
  ListUsersInGroupCommand,
  CognitoIdentityProviderClient: class {
    async send(cmd) {
      cognitoState.calls += 1;
      if (cmd.input.GroupName !== 'pending') return { Users: [] };
      // Two per page, as a real pool pages at 60.
      const start = cmd.input.NextToken ? Number(cmd.input.NextToken) : 0;
      const Users = cognitoState.pending.slice(start, start + 2);
      return { Users, ...(start + 2 < cognitoState.pending.length ? { NextToken: String(start + 2) } : {}) };
    }
  },
});

process.env.TABLE_NAME = 'test-table';
process.env.USER_POOL_ID = 'us-east-1_test';

const tenant = require(path.join(LF, 'admin', 'shared', 'tenant.js'));
const listMyOrgs = require(path.join(LF, 'admin', 'orgs', 'list-my-orgs.js'));
const { QUEUE_PK } = require(path.join(LF, 'admin', 'shared', 'moderation-queue.js'));
const { usageSk } = require(path.join(LF, 'admin', 'shared', 'usage.js'));

if (!process.env.DEBUG) { console.log = () => {}; console.warn = () => {}; console.error = () => {}; }
const say = (...a) => process.stdout.write(`${a.join(' ')}\n`);

const oid = (c) => `org_${c.repeat(22)}`;
const TEAM = oid('T');
const OTHER = oid('Q');
const HOME = oid('H');
const ME = 'u_maya';
const NOW = new Date('2026-10-11T09:40:00.000Z');
const day = (n) => new Date(NOW.getTime() + n * 86400000).toISOString();

function evt({ sub = ME, groups = 'hosts', email = 'maya@northwind.example', path: p = '/me/attention' } = {}) {
  return {
    rawPath: p,
    requestContext: {
      http: { method: 'GET', path: p },
      authorizer: { lambda: { userId: sub, email, emailVerified: 'true', groups } },
    },
  };
}
const bodyOf = (res) => JSON.parse(res.body || '{}');

function seed() {
  table.store.clear();
  table.log.length = 0;
  const membership = (orgId, role) => table.put({ PK: tenant.userPk(ME), SK: `ORG#${orgId}`, orgId, userId: ME, role });
  const meta = (orgId, extra) => table.put({ PK: tenant.orgPk(orgId), SK: 'METADATA', orgId, name: orgId, plan: 'team', type: 'team', ...extra });
  meta(TEAM); meta(OTHER); meta(HOME, { type: 'personal', plan: 'free' });
  membership(TEAM, 'owner');
  membership(OTHER, 'member');
  membership(HOME, 'owner');

  // TEAM: three waiting for approval (one without the invitation stamp, which
  // only Engage can approve and so is not the team's to count), two
  // invitations running out, one comfortable, two flagged sets of five.
  const member = (orgId, sub, extra) => table.put({ PK: tenant.orgPk(orgId), SK: `MEMBER#${sub}`, orgId, userId: sub, role: 'member', ...extra });
  member(TEAM, ME, { role: 'owner' });
  member(HOME, ME, { role: 'owner' });
  table.put({ PK: tenant.userPk(ME), SK: 'PROFILE', userId: ME, personalOrgId: HOME });
  member(TEAM, 'u_a', { joinedByInvite: true, awaitingHostApproval: true });
  member(TEAM, 'u_b', { joinedByInvite: true, awaitingHostApproval: true });
  member(TEAM, 'u_c', { awaitingHostApproval: true });
  member(TEAM, 'u_d', { joinedByInvite: true });
  const invite = (orgId, token, expiresAt) => table.put({ PK: tenant.orgPk(orgId), SK: `INVITE#${token}`, token, email: `${token}@x.example`, role: 'member', invitedAt: day(-12), expiresAt });
  invite(TEAM, 'soon', day(1));
  invite(TEAM, 'gone', day(-1));
  invite(TEAM, 'later', day(9));
  const set = (orgId, id, status) => table.put({ PK: tenant.setsMetadataPk(tenant.ORG, orgId), SK: `SET#${id}`, id, Title: 'sealed', ...(status ? { share: { status } } : {}) });
  ['s1', 's2', 's3'].forEach((id) => set(TEAM, id, 'passed'));
  set(TEAM, 'f1', 'flagged');
  set(TEAM, 'f2', 'flagged');

  // OTHER, where I am a member: one flagged set (counted), and people waiting
  // (NOT counted for a member).
  member(OTHER, 'u_x', { joinedByInvite: true, awaitingHostApproval: true });
  invite(OTHER, 'otherSoon', day(1));
  set(OTHER, 'of', 'flagged');

  // HOME, the personal space on Free: 5 of 5 sessions used is "stuck".
  table.put({ PK: tenant.orgPk(HOME), SK: usageSk('2026-10'), sessionsRun: 5 });

  // An invitation to me, at my own address.
  table.put({ PK: `INVITEE#maya@northwind.example`, SK: 'INVITE#tok1', token: 'tok1', orgId: oid('R'), email: 'maya@northwind.example', expiresAt: day(3) });

  // Engage's queues.
  table.put({ PK: tenant.ORGS_INDEX_PK, SK: 'PLANREQ#requested#2026-10-09#a', orgId: TEAM, reqId: 'a' });
  table.put({ PK: tenant.ORGS_INDEX_PK, SK: 'PLANREQ#requested#2026-10-10#b', orgId: OTHER, reqId: 'b' });
  table.put({ PK: tenant.ORGS_INDEX_PK, SK: 'PLANREQ#approved#2026-10-01#c', orgId: OTHER, reqId: 'c' });
  ['1', '2', '3'].forEach((n) => table.put({ PK: QUEUE_PK, SK: `Q#${n}`, waitingSince: day(-n) }));
  cognitoState.pending = [
    { Username: 'p1', Enabled: true }, { Username: 'p2', Enabled: true },
    { Username: 'p3', Enabled: false }, { Username: 'p4', Enabled: true }, { Username: 'p5', Enabled: true },
  ];
  cognitoState.calls = 0;
}

let pass = 0;
let fail = 0;
async function check(label, fn) {
  try { await fn(); say(`  ok   - ${label}`); pass += 1; } catch (e) { say(`  FAIL - ${label}\n         ${e.message}`); fail += 1; }
}

const RealDate = Date;
global.Date = class extends RealDate {
  constructor(...a) { if (a.length) super(...a); else super(NOW.getTime()); }
  static now() { return NOW.getTime(); }
  static [Symbol.hasInstance](x) { return x instanceof RealDate; }
};

(async () => {
  say('GET /me/attention');

  await check('no identity: 403, nothing read', async () => {
    seed();
    const ev = evt();
    ev.requestContext.authorizer.lambda.userId = '';
    const res = await listMyOrgs.handler(ev);
    assert.strictEqual(res.statusCode, 403);
    assert.strictEqual(table.log.length, 0);
  });

  await check('owner of a team: approvals stamped by THIS team + invitations running out + flagged sets', async () => {
    seed();
    const res = await listMyOrgs.handler(evt());
    assert.strictEqual(res.statusCode, 200, res.body);
    // u_a, u_b (u_c has no invitation stamp) + soon, gone + f1, f2
    assert.strictEqual(bodyOf(res).scopes[TEAM], 6);
  });

  await check('member of a team: only the sets the check sent back, never members or invitations', async () => {
    seed();
    assert.strictEqual(bodyOf(await listMyOrgs.handler(evt())).scopes[OTHER], 1);
  });

  await check('personal space on Free at 5 of 5 sessions counts once (stuck); 4 of 5 does not', async () => {
    seed();
    assert.strictEqual(bodyOf(await listMyOrgs.handler(evt())).scopes[HOME], 1);
    table.put({ PK: tenant.orgPk(HOME), SK: usageSk('2026-10'), sessionsRun: 4 });
    assert.strictEqual(bodyOf(await listMyOrgs.handler(evt())).scopes[HOME], 0);
  });

  await check('invitations to my own verified address are counted apart from any team', async () => {
    seed();
    assert.strictEqual(bodyOf(await listMyOrgs.handler(evt())).invites, 1);
  });

  await check('a host gets no ~platform count and Cognito is never asked', async () => {
    seed();
    const body = bodyOf(await listMyOrgs.handler(evt()));
    assert.ok(!('~platform' in body.scopes));
    assert.strictEqual(cognitoState.calls, 0);
  });

  await check('staff: enabled pending accounts (paged) + waiting plan requests + Moderation', async () => {
    seed();
    const body = bodyOf(await listMyOrgs.handler(evt({ groups: 'admins' })));
    // 4 enabled pending + 2 requested + 3 queued
    assert.strictEqual(body.scopes['~platform'], 9);
    assert.ok(cognitoState.calls >= 3, 'every Cognito page was read');
  });

  await check('counts only: no names, emails, titles or rows in the answer', async () => {
    seed();
    const text = (await listMyOrgs.handler(evt({ groups: 'admins' }))).body;
    assert.ok(!/@|sealed|u_a|Title|email/i.test(text), text);
    const body = JSON.parse(text);
    for (const v of Object.values(body.scopes)) assert.strictEqual(typeof v, 'number');
  });

  await check('every partition was read past its first page', async () => {
    seed();
    await listMyOrgs.handler(evt());
    const setsPk = tenant.setsMetadataPk(tenant.ORG, TEAM);
    const reads = table.calls('query').filter((c) => c.input.ExpressionAttributeValues[':pk'] === setsPk);
    assert.ok(reads.length >= 3, `the sets partition was read in ${reads.length} page(s)`);
  });

  await check('a part that cannot be read is named, not counted as zero for the whole answer', async () => {
    seed();
    process.env.USER_POOL_ID = '';
    const body = bodyOf(await listMyOrgs.handler(evt({ groups: 'admins' })));
    process.env.USER_POOL_ID = 'us-east-1_test';
    assert.ok(body.unavailable.some((u) => u.part === 'accounts'));
    assert.strictEqual(body.scopes['~platform'], 5, 'the other two queues still count');
    assert.strictEqual(body.scopes[TEAM], 6);
  });

  await check('GET /orgs still answers the switcher on the same function', async () => {
    seed();
    const res = await listMyOrgs.handler(evt({ path: '/orgs' }));
    assert.strictEqual(res.statusCode, 200, res.body);
    assert.ok(Array.isArray(bodyOf(res).orgs));
  });

  say(`\n${pass} passed, ${fail} failed`);
  suiteFinished();
  process.exit(fail ? 1 : 0);
})();
