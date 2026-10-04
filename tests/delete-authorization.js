/**
 * WHO MAY DELETE AN ENGAGEMENT, AND THE ENTRY EVERY DELETE LEAVES — the owner's
 * rule of 2026-10-04, across every delete route:
 *
 *   "it should be deletable by three types of people: the host that created
 *    it, an admin for the org, and [an Engage platform admin] with a
 *    documented reason (logged to the org's or user's admin page), and log the
 *    user that deleted."
 *
 * Routes: POST /admin/clear-game/{id} (a session or a Build Room — it checked
 * NO ownership before: any host could clear any org's session by its code),
 * POST /admin/clear-all-games, DELETE /events/{code}, DELETE
 * /events/{code}/items/{itemId}. A Build Room's screenshot and timeline
 * deletes are in tests/build-room.js and §6 below. tenant.deleteRole decides;
 * audit-log.js records, BEFORE the delete.
 *
 * rejects: a plain member, or a host of another organisation, deleting; Engage
 * staff deleting without a reason; a creator or org admin asked for one; a
 * delete with no audit entry, or an entry missing who, in which role, what,
 * or why; a delete that goes ahead when its entry cannot be written; a
 * session made without its creator; the list not saying who may delete.
 */
const suiteFinished = require('./helpers/finish-guard');
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {
  installEventHarness, asHost, request, seedOrg, startsIn, bodyOf,
} = require('./helpers/event-harness');
const { plainRow } = require('./helpers/tenant-crypto-stub');

const h = installEventHarness();
const { table } = h;
const clearGame = h.load('lambda-functions/admin/delete-game.js').handler;
const clearAll = h.load('lambda-functions/admin/clear-all-games.js').handler;
const create = h.load('lambda-functions/websocket/events/create-event.js').handler;
const items = h.load('lambda-functions/websocket/events/items.js').handler;
const eventRoute = h.load('lambda-functions/websocket/events/update-event.js').handler;
const getEvent = h.load('lambda-functions/websocket/events/get-event.js').handler;
const list = h.load('lambda-functions/game/get-games-list.js').handler;
const C = h.load('lambda-functions/game/tenant-crypto.js');
const { createGame } = h.load('lambda-functions/websocket/schema-compliant-manager.js');
const authorizer = h.load('lambda-functions/auth/authorizer.js');

let pass = 0; let fail = 0;
const seenAudits = new Set();
async function check(label, fn) {
  // Each check starts with every entry so far already seen (lastAudit below).
  for (const r of table.store.values()) if (/#AUDIT$/.test(String(r.PK))) seenAudits.add(r.SK);
  try { await fn(); console.log(`  ok - ${label}`); pass += 1; } catch (e) { console.log(`  FAIL - ${label}\n    ${e.stack || e.message}`); fail += 1; }
}

const NW = 'org_nw';
const MD = 'org_md';
const WHO = {
  creator: asHost(NW, { userId: 'u_creator' }),
  member: asHost(NW, { userId: 'u_member' }),
  admin: asHost(NW, { userId: 'u_admin', orgRole: 'admin' }),
  owner: asHost(NW, { userId: 'u_owner', orgRole: 'owner' }),
  rival: asHost(MD, { userId: 'u_rival', orgRole: 'owner' }),
  staff: asHost('', { userId: 'u_staff', groups: 'admins,hosts', orgIds: '' }),
  staffAdmin: asHost(NW, { userId: 'u_staffadmin', groups: 'admins,hosts', orgRole: 'admin' }),
};
for (const ctx of Object.values(WHO)) ctx.authorizer.lambda.email = `${ctx.authorizer.lambda.userId}@example.com`;

const audits = (org = NW) => [...table.store.values()].filter((r) => r.PK === `ORG#${org}#AUDIT`);
/* THE ENTRY THE LAST DELETE WROTE. Not "the highest SK": two entries in one
   millisecond order by their random suffix. Every entry already looked at is
   remembered, and exactly one new one is expected. */
const lastAudit = (org = NW) => {
  const fresh = audits(org).filter((r) => !seenAudits.has(r.SK));
  fresh.forEach((r) => seenAudits.add(r.SK));
  assert.strictEqual(fresh.length, 1, `expected one new audit entry, found ${fresh.length}`);
  return fresh[0];
};
const exists = (gameId) => Boolean(table.get(`GAME#${gameId}`, 'METADATA'));

async function seedSession(gameId, { createdBy = 'u_creator', org = NW, type = 'trivia', eventRef = '' } = {}) {
  table.put(await C.encryptItem(org, 'session', {
    PK: `GAME#${gameId}`, SK: 'METADATA', orgId: org, GameType: type, Title: `Session ${gameId}`,
    ...(createdBy ? { CreatedBy: createdBy } : {}), ...(eventRef ? { EventRef: eventRef } : {}),
  }));
  table.put({ PK: `GAME#${gameId}`, SK: 'STATE', State: 'STARTED' });
  table.put(await C.encryptItem(org, 'session', {
    PK: `ORG#${org}#GAMES`, SK: `GAME#${gameId}`, orgId: org, Title: `Session ${gameId}`, GameType: type,
    CreatedAt: new Date().toISOString(), ...(createdBy ? { CreatedBy: createdBy } : {}),
  }));
  table.put({ PK: 'GAMES', SK: `GAME#${gameId}`, orgId: org });
}
const del = (gameId, who, reason) => clearGame({
  pathParameters: { gameId }, requestContext: who, body: reason === undefined ? undefined : JSON.stringify({ reason }),
}).then((r) => ({ status: r.statusCode, body: JSON.parse(r.body) }));

let n = 6000;
const next = () => String(n++);

(async () => {
  seedOrg(table, NW);
  seedOrg(table, MD);

  console.log('\n1. one session (POST /admin/clear-game/{id})');
  for (const [who, role] of [['creator', 'host'], ['owner', 'org-owner'], ['admin', 'org-admin'], ['staffAdmin', 'org-admin']]) {
    await check(`${who} may delete it, recorded as ${role}, no reason asked`, async () => {
      const g = next();
      await seedSession(g);
      const r = await del(g, WHO[who]);
      assert.strictEqual(r.status, 200, JSON.stringify(r.body));
      assert.ok(!exists(g));
      const a = lastAudit();
      assert.strictEqual(a.Action, 'session.delete');
      assert.strictEqual(a.Actor.Role, role);
      assert.strictEqual(a.Actor.Sub, WHO[who].authorizer.lambda.userId);
      assert.strictEqual(a.Actor.Email, `${WHO[who].authorizer.lambda.userId}@example.com`);
      assert.deepStrictEqual(a.Target, { Type: 'session', Id: g });
      assert.strictEqual(plainRow(NW, a).Title, `Session ${g}`);
      assert.ok(!('Reason' in a));
    });
  }
  await check('a plain member who did not create it: 403 with a sentence, nothing deleted, nothing logged', async () => {
    const g = next();
    await seedSession(g);
    const before = audits().length;
    const r = await del(g, WHO.member);
    assert.strictEqual(r.status, 403);
    assert.match(r.body.error, /Only the host who created this/);
    assert.ok(exists(g));
    assert.strictEqual(audits().length, before);
  });
  await check("a host of another organisation (the gap: any host could clear any org's session): the unknown code's 404", async () => {
    const g = next();
    await seedSession(g);
    const r = await del(g, WHO.rival);
    assert.strictEqual(r.status, 404);
    assert.ok(exists(g));
  });
  await check('Engage staff with no reason: 400 reason_required, nothing deleted', async () => {
    const g = next();
    await seedSession(g);
    const r = await del(g, WHO.staff, '   ');
    assert.strictEqual(r.status, 400);
    assert.strictEqual(r.body.code, 'reason_required');
    assert.ok(exists(g));
  });
  await check("Engage staff with a reason: deleted, and the entry says who, as platform-admin, and why", async () => {
    const g = next();
    await seedSession(g);
    const r = await del(g, WHO.staff, 'Customer asked by email, ticket 4411.');
    assert.strictEqual(r.status, 200, JSON.stringify(r.body));
    assert.ok(!exists(g));
    const a = lastAudit();
    assert.strictEqual(a.Actor.Role, 'platform-admin');
    assert.strictEqual(a.Actor.Sub, 'u_staff');
    assert.strictEqual(typeof a.Reason, 'object', 'the reason is sealed');
    assert.strictEqual(plainRow(NW, a).Reason, 'Customer asked by email, ticket 4411.');
  });
  await check('a session made before creators were recorded: org admin may, its old host (a plain member) may not', async () => {
    const g = next();
    await seedSession(g, { createdBy: '' });
    assert.strictEqual((await del(g, WHO.creator)).status, 403);
    assert.strictEqual((await del(g, WHO.admin)).status, 200);
  });
  await check('a Build Room is logged as buildroom.delete', async () => {
    const g = next();
    await seedSession(g, { type: 'build' });
    assert.strictEqual((await del(g, WHO.creator)).status, 200);
    const a = lastAudit();
    assert.strictEqual(a.Action, 'buildroom.delete');
    assert.strictEqual(a.Target.Type, 'buildroom');
  });
  await check('an event item\'s session is still refused (409) to those who may delete, and to nobody else is it even named', async () => {
    const g = next();
    await seedSession(g, { eventRef: '4242' });
    assert.strictEqual((await del(g, WHO.member)).status, 403);
    const r = await del(g, WHO.admin);
    assert.strictEqual(r.status, 409);
    assert.strictEqual(r.body.code, 'event_item');
  });
  await check('the audit entry cannot be written: 500, a sentence, and NOTHING deleted', async () => {
    const g = next();
    await seedSession(g);
    table.inject((c) => c.type === 'put' && /#AUDIT$/.test(c.input.Item.PK), () => new Error('ThrottlingException'));
    const r = await del(g, WHO.creator);
    assert.strictEqual(r.status, 500);
    assert.match(r.body.error, /nothing was deleted/);
    assert.ok(exists(g));
    assert.ok(table.get(`ORG#${NW}#GAMES`, `GAME#${g}`));
    assert.ok(table.get('GAMES', `GAME#${g}`));
  });

  console.log('\n2. delete all (POST /admin/clear-all-games)');
  const all = (who, reason) => clearAll({
    requestContext: { ...who, http: { method: 'POST' } }, body: reason === undefined ? undefined : JSON.stringify({ reason }),
  }).then((r) => ({ status: r.statusCode, body: JSON.parse(r.body) }));
  await check('the route is open to hosts now (an org owner is a host); the handler decides', () => {
    // The authorizer's group gate for this exact route.
    const src = fs.readFileSync(path.join(h.REPO, 'lambda-functions/auth/authorizer.js'), 'utf8');
    assert.match(src, /method === 'POST' && path === 'admin\/clear-all-games'\) \{\s*return \['hosts', 'admins'\];/);
    assert.ok(authorizer);
  });
  await check('a plain member, and a session\'s creator: 403, nothing deleted', async () => {
    const g = next();
    await seedSession(g);
    for (const who of ['member', 'creator']) {
      const r = await all(WHO[who]);
      assert.strictEqual(r.status, 403);
      assert.match(r.body.error, /Only an owner or admin of this organisation/);
    }
    assert.ok(exists(g));
  });
  await check('Engage staff acting for the team without being its admin: 400 without a reason', async () => {
    const staffMember = asHost(NW, { userId: 'u_staffm', groups: 'admins,hosts' });
    const r = await all(staffMember);
    assert.strictEqual(r.status, 400);
    assert.strictEqual(r.body.code, 'reason_required');
  });
  await check('...and with one, everything goes, and one entry says so, with the count and the reason', async () => {
    const staffMember = asHost(NW, { userId: 'u_staffm', groups: 'admins,hosts' });
    const g = next();
    await seedSession(g);
    const r = await all(staffMember, 'Team closed; owner asked by phone.');
    assert.strictEqual(r.status, 200, JSON.stringify(r.body));
    assert.ok(!exists(g));
    const a = lastAudit();
    assert.strictEqual(a.Action, 'sessions.delete-all');
    assert.strictEqual(a.Actor.Role, 'platform-admin');
    assert.ok(a.Detail.sessions >= 1);
    assert.strictEqual(plainRow(NW, a).Reason, 'Team closed; owner asked by phone.');
  });
  await check('an org owner: no reason, recorded as org-owner; an audit failure deletes nothing', async () => {
    const g = next();
    await seedSession(g);
    table.inject((c) => c.type === 'put' && /#AUDIT$/.test(c.input.Item.PK), () => new Error('ThrottlingException'));
    assert.strictEqual((await all(WHO.owner)).status, 500);
    assert.ok(exists(g));
    assert.strictEqual((await all(WHO.owner)).status, 200);
    assert.ok(!exists(g));
    assert.strictEqual(lastAudit().Actor.Role, 'org-owner');
  });

  console.log('\n3. an event (DELETE /events/{code})');
  table.put({ PK: 'SETS', SK: 'SET#space', name: 'Space Trivia', engagementType: 'trivia', questionCount: 12, activeVersion: 1, versions: [{ version: 1, questionCount: 12 }] });
  const makeEvent = async () => {
    const res = await create(request({
      method: 'POST', path: '/events', requestContext: WHO.creator,
      body: { title: 'Q4 Kickoff', place: 'Harbour Room', startsAt: startsIn(3), timeZone: 'Europe/London' },
    }));
    assert.strictEqual(res.statusCode, 201, res.body);
    return bodyOf(res).event.code;
  };
  const delEvent = (code, who, reason) => eventRoute(request({
    method: 'DELETE', path: `/events/${code}`, pathParameters: { code }, requestContext: who,
    ...(reason === undefined ? {} : { body: { reason } }),
  })).then((r) => ({ status: r.statusCode, body: JSON.parse(r.body) }));
  for (const [who, role] of [['creator', 'host'], ['admin', 'org-admin']]) {
    await check(`${who} may delete it, recorded as ${role}`, async () => {
      const code = await makeEvent();
      const r = await delEvent(code, WHO[who]);
      assert.strictEqual(r.status, 200, JSON.stringify(r.body));
      const a = lastAudit();
      assert.strictEqual(a.Action, 'event.delete');
      assert.strictEqual(a.Actor.Role, role);
      assert.deepStrictEqual(a.Target, { Type: 'event', Id: code });
      assert.strictEqual(plainRow(NW, a).Title, 'Q4 Kickoff');
    });
  }
  await check('a plain member: 403; a host of another org: 404; staff outside the team: 400 then 200 with a reason', async () => {
    const code = await makeEvent();
    assert.strictEqual((await delEvent(code, WHO.member)).status, 403);
    assert.strictEqual((await delEvent(code, WHO.rival)).status, 404);
    const noReason = await delEvent(code, WHO.staff);
    assert.strictEqual(noReason.status, 400);
    assert.strictEqual(noReason.body.code, 'reason_required');
    assert.ok(table.get(`EVENT#${code}`, 'METADATA'));
    const ok = await delEvent(code, WHO.staff, 'Duplicate made by mistake, per the owner.');
    assert.strictEqual(ok.status, 200, JSON.stringify(ok.body));
    const a = lastAudit();
    assert.strictEqual(a.Actor.Role, 'platform-admin');
    assert.strictEqual(plainRow(NW, a).Reason, 'Duplicate made by mistake, per the owner.');
  });
  await check('the audit entry cannot be written: 500, the event is untouched', async () => {
    const code = await makeEvent();
    table.inject((c) => c.type === 'put' && /#AUDIT$/.test(c.input.Item.PK), () => new Error('ThrottlingException'));
    const r = await delEvent(code, WHO.creator);
    assert.strictEqual(r.status, 500);
    assert.ok(table.get(`EVENT#${code}`, 'METADATA'));
    assert.ok(table.get('GAMES', `GAME#${code}`));
  });
  await check('GET /events/{code} says the role each caller would delete in', async () => {
    const code = await makeEvent();
    const as = async (who) => bodyOf(await getEvent(request({ method: 'GET', path: `/events/${code}`, pathParameters: { code }, requestContext: who }))).event.deleteAs;
    assert.strictEqual(await as(WHO.creator), 'host');
    assert.strictEqual(await as(WHO.member), '');
    assert.strictEqual(await as(WHO.owner), 'org-owner');
  });

  console.log('\n4. an event item (DELETE /events/{code}/items/{itemId})');
  await check('the event\'s creator may; another member may not; staff need a reason; each delete is logged', async () => {
    const code = await makeEvent();
    const add = async () => bodyOf(await items(request({
      method: 'POST', path: `/events/${code}/items`, pathParameters: { code }, requestContext: WHO.creator,
      body: { type: 'break', minutes: 10, title: 'Coffee' },
    }))).item.itemId;
    const remove = (itemId, who, reason) => items(request({
      method: 'DELETE', path: `/events/${code}/items/${itemId}`, pathParameters: { code, itemId }, requestContext: who,
      ...(reason === undefined ? {} : { body: { reason } }),
    })).then((r) => ({ status: r.statusCode, body: JSON.parse(r.body) }));
    const a = await add();
    assert.strictEqual((await remove(a, WHO.member)).status, 403);
    assert.strictEqual((await remove(a, WHO.staff)).status, 400);
    assert.strictEqual((await remove(a, WHO.creator)).status, 200);
    let e = lastAudit();
    assert.strictEqual(e.Action, 'event-item.delete');
    assert.strictEqual(e.Actor.Role, 'host');
    assert.deepStrictEqual(e.Target, { Type: 'event-item', Id: `${code}/${a}` });
    const b = await add();
    assert.strictEqual((await remove(b, WHO.staff, 'Customer request')).status, 200);
    e = lastAudit();
    assert.strictEqual(e.Actor.Role, 'platform-admin');
  });

  console.log('\n5. the creator is recorded, and the list says who may delete');
  await check('createGame writes CreatedBy on METADATA and on the list row; create-game passes the caller', async () => {
    table.put({ PK: 'SETS', SK: 'SET#space', name: 'Space Trivia', engagementType: 'trivia', questionCount: 12, activeVersion: 1, versions: [{ version: 1, questionCount: 12 }] });
    await createGame('7777', { title: 'Mine', engagementType: 'trivia', questionSetId: 'space', questionSetScope: 'platform', orgId: NW, createdBy: 'u_creator' });
    assert.strictEqual(table.get('GAME#7777', 'METADATA').CreatedBy, 'u_creator');
    assert.strictEqual(table.get(`ORG#${NW}#GAMES`, 'GAME#7777').CreatedBy, 'u_creator');
    const src = fs.readFileSync(path.join(h.REPO, 'lambda-functions/websocket/create-game.js'), 'utf8');
    assert.match(src, /createdBy: callerUserId\(event\)/);
  });
  await check('GET /games: each row\'s deleteAs, and deleteAllAs, for the caller', async () => {
    const res = async (who) => bodyOf(await list({ requestContext: who }));
    const mine = await res(WHO.creator);
    assert.strictEqual(mine.games.find((g) => g.gameId === '7777').deleteAs, 'host');
    assert.strictEqual(mine.deleteAllAs, '');
    const other = await res(WHO.member);
    assert.strictEqual(other.games.find((g) => g.gameId === '7777').deleteAs, '');
    const staffMember = await res(asHost(NW, { userId: 'u_staffm', groups: 'admins,hosts' }));
    assert.strictEqual(staffMember.games.find((g) => g.gameId === '7777').deleteAs, 'platform-admin');
    assert.strictEqual(staffMember.deleteAllAs, 'platform-admin');
    assert.strictEqual((await res(WHO.owner)).deleteAllAs, 'org-owner');
  });

  console.log(`\n${pass} passed, ${fail} failed`);
  suiteFinished();
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
