/**
 * A REFUSAL SAYS WHO CAN FIX IT.
 *
 * Every plan-limit 402 (a new session, a new set, a library copy) carries a
 * `resolve` block beside the existing `limit` and `upgrade` blocks, worked out
 * on the server from the CALLER'S role in the organisation — so the screen can
 * say the right thing to the right person without guessing a role from local
 * state (docs/design/tenancy-redesign/22-plan-limit-notice.html):
 *
 *   owner   -> may request the Team plan (and is told about a request waiting)
 *   admin   -> may see Plan & usage, may not request; told who the owner is
 *   member  -> sees no billing at all; told whom to ask, owners then admins
 *
 * The names and addresses are the org's own owners and admins — the same
 * people `list-members.js` already shows any member — and they are looked up
 * ONLY on the refusal path, so a create that succeeds pays nothing for this.
 *
 * Also pinned: library copies are refused at the stored-set allowance
 * (copy-question-set.js wrote a new stored set and never checked), and the
 * set list's `setAllowance` carries the same block when a copy would be refused.
 *
 * Every check carries a `// rejects:` line naming the change it catches.
 */
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const H = require('./helpers/moderation-harness');
H.install();

/* Log every command, so "no lookup unless refusing" is observable. The
   harness hands the same client to every handler, so wrapping its `send`
   after install() is seen by all of them. */
const lib = require('@aws-sdk/lib-dynamodb');
const docClient = lib.DynamoDBDocumentClient.from();
const sent = [];
let failQueryPrefix = null;
const realSend = docClient.send;
docClient.send = async (cmd) => {
  sent.push(cmd);
  const v = (cmd.input && cmd.input.ExpressionAttributeValues) || {};
  if (cmd.kind === 'query' && failQueryPrefix && String(v[':sk'] || '').startsWith(failQueryPrefix)) {
    throw new Error(`injected failure on ${failQueryPrefix}`);
  }
  return realSend(cmd);
};
const queriesFor = (prefix) => sent.filter((c) => c.kind === 'query'
  && String(((c.input || {}).ExpressionAttributeValues || {})[':sk'] || '').startsWith(prefix));

const REPO = H.REPO;
const createGame = require(path.join(REPO, 'lambda-functions/websocket/create-game.js')).handler;
const upload = require(path.join(REPO, 'lambda-functions/admin/upload-questions.js')).handler;
const copySet = require(path.join(REPO, 'lambda-functions/admin/copy-question-set.js')).handler;
const getSets = require(path.join(REPO, 'lambda-functions/admin/get-question-sets.js')).handler;
const usage = require(path.join(REPO, 'lambda-functions/admin/shared/usage.js'));
const { setMetadataKey, setPartition } = require(path.join(REPO, 'lambda-functions/admin/shared/set-version.js'));

if (!process.env.DEBUG) { console.log = () => {}; console.warn = () => {}; console.error = () => {}; }
const say = (...a) => process.stdout.write(a.join(' ') + '\n');
let pass = 0, fail = 0;
async function check(label, fn) {
  try { await fn(); say(`  ok   - ${label}`); pass++; }
  catch (e) { say(`  FAIL - ${label}\n         ${e.message}`); fail++; }
}

// ---- Fixtures --------------------------------------------------------------
const SOLO = 'org_amara';       // Amara's own space
const NW = 'org_northwind';     // a team org still on the free plan
const PERIOD = usage.periodOf(new Date());
const RESETS_ON = (() => {
  const [y, m] = PERIOD.split('-').map(Number);
  return new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10);
})();

function seedOrg(orgId, { name, type, plan = 'free' }) {
  H.seedRow({ PK: `ORG#${orgId}`, SK: 'METADATA', orgId, name, type, plan, status: 'active' });
}
function seedMember(orgId, sub, role, displayName, email) {
  H.seedRow({ PK: `ORG#${orgId}`, SK: `MEMBER#${sub}`, orgId, userId: sub, role, displayName, email, joinedAt: '2026-01-01T00:00:00.000Z' });
}
function seedUsage(orgId, { sessionsRun = 0, setsCurrent = 0 } = {}) {
  H.seedRow({ PK: `ORG#${orgId}`, SK: `USAGE#${PERIOD}`, orgId, period: PERIOD, sessionsRun, setsCurrent, setsPeak: setsCurrent });
}
function seedWaitingRequest(orgId, bySub, at = '2026-09-22T10:00:00.000Z') {
  H.seedRow({ PK: `ORG#${orgId}`, SK: `PLANREQ#${at}#req1`, RecordType: 'PLANREQ', orgId, reqId: 'req1', fromPlan: 'free', toPlan: 'team', status: 'requested', requestedBy: bySub, requestedAt: at });
}

function world({ sessionsRun = 5, setsCurrent = 5 } = {}) {
  H.reset();
  sent.length = 0;
  failQueryPrefix = null;
  seedOrg(SOLO, { name: 'Amara Reyes', type: 'personal' });
  seedMember(SOLO, 'sub-amara', 'owner', 'Amara Reyes', 'amara@example.com');
  seedUsage(SOLO, { sessionsRun, setsCurrent });
  seedOrg(NW, { name: 'Northwind Learning', type: 'team' });
  seedMember(NW, 'sub-dana', 'owner', 'Dana Whitfield', 'dana@northwind.example');
  seedMember(NW, 'sub-tomas', 'admin', 'Tomás Ortega', 'tomas@northwind.example');
  seedMember(NW, 'sub-priya', 'member', 'Priya Raghavan', 'priya@northwind.example');
  seedMember(NW, 'sub-ken', 'member', 'Ken Ito', 'ken@northwind.example');
  seedUsage(NW, { sessionsRun, setsCurrent });
}

const as = (orgId, userId, role) => ({ orgId, userId, role, username: userId.replace('sub-', '') });
const create = (who) => createGame(H.orgEvent({ ...who, body: { eventTitle: 'Offsite', gameType: 'call-and-answer' } }));
const parse = (res) => JSON.parse(res.body || '{}');

const CSV = [
  'Category,Question#,Title,Detail_lesson,School,CustomInstruction,Image',
  '"Renaissance",1,"THE SMILE","A portrait.","Leonardo","Invent a title.",""',
].join('\n');

function seedPlatformSet(setId = 'teamretro') {
  const source = { scope: 'platform', orgId: '', setId };
  H.seedRow({ ...setMetadataKey(source), name: 'Team retro', engagementType: 'call-and-answer', questionCount: 1 });
  const pk = setPartition(source, null);
  H.seedRow({ PK: pk, SK: 'CATEGORY#c001', Name: 'Retro', QuestionCount: 1 });
  H.seedRow({ PK: pk, SK: 'QUESTION#q001', Title: 'WHAT WENT WELL', Detail: 'Name one thing.' });
}

(async () => {
  say('\nplan-limit refusals say who can fix it\n');

  // ── 1. Sessions, by role ────────────────────────────────────────────────
  say('1. a refused session carries the caller\'s way out');

  await check('the owner of a personal space may request, and is told when the count starts again', async () => {
    world();
    const res = await create(as(SOLO, 'sub-amara', 'owner'));
    assert.strictEqual(res.statusCode, 402, res.body);
    const body = parse(res);
    // rejects: replacing the existing refusal rather than adding to it.
    assert.strictEqual(body.code, 'upgrade_required');
    assert.deepStrictEqual([body.limit.kind, body.limit.used, body.limit.included], ['sessions', 5, 5]);
    assert.ok(Number.isInteger(body.upgrade.priceCents));
    // rejects: a refusal with no `resolve` — the state of every 402 before this.
    const r = body.resolve;
    assert.ok(r, `no resolve block: ${res.body}`);
    assert.strictEqual(r.role, 'owner');
    assert.strictEqual(r.canRequest, true);
    assert.strictEqual(r.canViewBilling, true);
    assert.deepStrictEqual(r.org, { name: 'Amara Reyes', type: 'personal' });
    assert.deepStrictEqual(r.contacts, [], 'an owner is not told to ask somebody');
    assert.strictEqual(r.request, null);
    assert.strictEqual(r.resetsOn, RESETS_ON);
  });

  await check('an admin may see billing but not request, and is told who the owner is', async () => {
    world();
    const r = parse(await create(as(NW, 'sub-tomas', 'admin'))).resolve;
    // rejects: offering "Request the Team plan" to an admin — plan-requests.js
    // authorises that route for the OWNER only, so the button would 403.
    assert.strictEqual(r.role, 'admin');
    assert.strictEqual(r.canRequest, false);
    assert.strictEqual(r.canViewBilling, true);
    // rejects: listing the admin themselves, or other admins, as the way out.
    assert.deepStrictEqual(r.contacts, [
      { name: 'Dana Whitfield', email: 'dana@northwind.example', role: 'owner' },
    ]);
  });

  await check('a member is told whom to ask: owners first, then admins, never other members', async () => {
    world();
    const r = parse(await create(as(NW, 'sub-priya', 'member'))).resolve;
    assert.strictEqual(r.role, 'member');
    assert.strictEqual(r.canRequest, false);
    // rejects: a billing link for somebody consoleSections.js gives no Billing.
    assert.strictEqual(r.canViewBilling, false);
    // rejects: "contact your admin" with no names, or a list padded with members.
    assert.deepStrictEqual(r.contacts, [
      { name: 'Dana Whitfield', email: 'dana@northwind.example', role: 'owner' },
      { name: 'Tomás Ortega', email: 'tomas@northwind.example', role: 'admin' },
    ]);
    assert.deepStrictEqual(r.org, { name: 'Northwind Learning', type: 'team' });
  });

  await check('a request already waiting is reported, with who sent it', async () => {
    world();
    seedWaitingRequest(NW, 'sub-dana');
    const member = parse(await create(as(NW, 'sub-priya', 'member'))).resolve;
    // rejects: sending a member to pester the owner for something already asked.
    assert.deepStrictEqual(member.request, { requestedAt: '2026-09-22T10:00:00.000Z', requestedBy: 'Dana Whitfield' });
    const owner = parse(await create(as(NW, 'sub-dana', 'owner'))).resolve;
    // rejects: asking the owner to request a second time (plan-requests.js
    // would answer 409).
    assert.strictEqual(owner.request.requestedAt, '2026-09-22T10:00:00.000Z');
    assert.strictEqual(owner.canRequest, true);
  });

  await check('a decided request is not "waiting"', async () => {
    world();
    seedWaitingRequest(NW, 'sub-dana');
    const k = `ORG#${NW}|PLANREQ#2026-09-22T10:00:00.000Z#req1`;
    H.state.ddb.set(k, { ...H.state.ddb.get(k), status: 'declined' });
    const r = parse(await create(as(NW, 'sub-priya', 'member'))).resolve;
    assert.strictEqual(r.request, null);
  });

  await check('a personal space with no role on the token is still its owner\'s', async () => {
    world();
    const r = parse(await create(as(SOLO, 'sub-amara', ''))).resolve;
    // rejects: reading a missing role as "member" in a space that has exactly
    // one person, which would tell Amara to ask herself.
    assert.strictEqual(r.role, 'owner');
    assert.strictEqual(r.canRequest, true);
  });

  // ── 2. Only on the refusal path ──────────────────────────────────────────
  say('\n2. the names are looked up only when something is refused');

  await check('a create inside the allowance issues no member or request query', async () => {
    world({ sessionsRun: 1 });
    const res = await create(as(NW, 'sub-priya', 'member'));
    assert.strictEqual(res.statusCode, 201, res.body);
    // rejects: building the resolve block on every create.
    assert.strictEqual(queriesFor('MEMBER#').length, 0);
    assert.strictEqual(queriesFor('PLANREQ#').length, 0);
  });

  await check('a failed member lookup still answers 402, with the role, and no names', async () => {
    world();
    failQueryPrefix = 'MEMBER#';
    const res = await create(as(NW, 'sub-priya', 'member'));
    // rejects: letting the helpful part of a refusal turn it into a 500.
    assert.strictEqual(res.statusCode, 402, res.body);
    const r = parse(res).resolve;
    assert.strictEqual(r.role, 'member');
    assert.deepStrictEqual(r.contacts, []);
  });

  // ── 3. Sets: upload, copy, the list ──────────────────────────────────────
  say('\n3. sets: an upload and a library copy are refused the same way');

  await check('an upload at the set allowance carries the member\'s way out', async () => {
    world();
    const res = await upload(H.orgEvent({ ...as(NW, 'sub-priya', 'member'), body: { fileName: 'x.csv', fileContent: CSV, topic: 'business-work' } }));
    assert.strictEqual(res.statusCode, 402, res.body);
    const body = parse(res);
    assert.strictEqual(body.limit.kind, 'sets');
    assert.strictEqual(body.resolve.role, 'member');
    assert.strictEqual(body.resolve.contacts[0].name, 'Dana Whitfield');
  });

  await check('a library copy at the set allowance is refused with 402, and writes nothing', async () => {
    world();
    seedPlatformSet();
    const before = H.rowsWhere((i) => String(i.PK).startsWith(`ORG#${NW}#`)).length;
    const res = await copySet(H.orgEvent({ ...as(NW, 'sub-priya', 'member'), setId: 'teamretro', body: { scope: 'platform' } }));
    // rejects: copy-question-set.js creating a sixth stored set with no gate —
    // the free way round the allowance before this change.
    assert.strictEqual(res.statusCode, 402, res.body);
    const body = parse(res);
    assert.strictEqual(body.code, 'upgrade_required');
    assert.strictEqual(body.limit.kind, 'sets');
    assert.strictEqual(body.resolve.role, 'member');
    const after = H.rowsWhere((i) => String(i.PK).startsWith(`ORG#${NW}#`)).length;
    assert.strictEqual(after, before, 'the refused copy wrote rows');
  });

  await check('a library copy inside the allowance still copies', async () => {
    world({ setsCurrent: 2 });
    seedPlatformSet();
    const res = await copySet(H.orgEvent({ ...as(NW, 'sub-priya', 'member'), setId: 'teamretro', body: { scope: 'platform' } }));
    // rejects: a gate that refuses below the allowance.
    assert.strictEqual(res.statusCode, 201, res.body);
  });

  await check('a Team-plan organisation copies at any count', async () => {
    world({ setsCurrent: 40 });
    H.seedRow({ PK: `ORG#${NW}`, SK: 'METADATA', orgId: NW, name: 'Northwind Learning', type: 'team', plan: 'team', status: 'active' });
    seedPlatformSet();
    const res = await copySet(H.orgEvent({ ...as(NW, 'sub-priya', 'member'), setId: 'teamretro', body: { scope: 'platform' } }));
    // rejects: gating without consulting the plan — metered plans are never refused.
    assert.strictEqual(res.statusCode, 201, res.body);
  });

  await check('the set list tells the editor the way out when a copy would be refused', async () => {
    world();
    const res = await getSets(H.orgEvent({ ...as(NW, 'sub-tomas', 'admin'), method: 'GET' }));
    assert.strictEqual(res.statusCode, 200, res.body);
    const a = parse(res).setAllowance;
    assert.strictEqual(a.mustUpgradeForSet, true);
    // rejects: the on-arrival "no room for a copy" warning having no way out.
    assert.ok(a.resolve, JSON.stringify(a));
    assert.strictEqual(a.resolve.role, 'admin');
    assert.strictEqual(a.resolve.contacts[0].name, 'Dana Whitfield');
  });

  await check('...and pays nothing for it when there is room', async () => {
    world({ setsCurrent: 1 });
    const res = await getSets(H.orgEvent({ ...as(NW, 'sub-tomas', 'admin'), method: 'GET' }));
    const a = parse(res).setAllowance;
    assert.strictEqual(a.mustUpgradeForSet, false);
    assert.strictEqual(a.resolve, undefined);
    assert.strictEqual(queriesFor('MEMBER#').length, 0);
  });

  // ── 4. One helper, two bundles ───────────────────────────────────────────
  say('\n4. the helper is one file, copied');

  await check('admin/shared/plan-limit.js and websocket/plan-limit.js are byte-identical', () => {
    const a = fs.readFileSync(path.join(REPO, 'lambda-functions/admin/shared/plan-limit.js'), 'utf8');
    const b = fs.readFileSync(path.join(REPO, 'lambda-functions/websocket/plan-limit.js'), 'utf8');
    // rejects: the session refusal and the set refusal drifting into two
    // different answers to "who can fix this".
    assert.strictEqual(a, b);
  });

  say(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { say(`crashed: ${e.stack}`); process.exit(1); });
