/**
 * AN EVENT'S LIFECYCLE, LIKE ANY ENGAGEMENT'S — delete after it has run,
 * what the delete takes and what it leaves, and the session routes that must
 * not take an event's sessions out from under it (2026-10-04).
 *
 * The owner asked for events and Build Rooms to have "lifecycle management, to
 * all of their artifacts as well. just like the other types engagements". A
 * played session can be deleted (POST /admin/clear-game) and its saved report
 * outlives it; an event could only be deleted before anything started, so a
 * day that had run could only expire. Now:
 *   - DELETE /events/{code} is refused only while an item is live or paused,
 *     and takes the event's item sessions with it — each only once its own
 *     METADATA proves it is this event's item;
 *   - saved reports stay (decision 10; reports outlive sessions by rule);
 *   - clear-game refuses an item session and clear-all-games leaves it, so
 *     only its event deletes it;
 *   - every new artifact carries a ttl.
 *
 * rejects: a run event that cannot be deleted; a delete while a room is in an
 * item; an item session, its list row or its code left behind; somebody
 * else's session deleted because its code was once an item's; a saved report
 * deleted with the event; an item session deleted on its own or by delete-all;
 * a new row without a ttl.
 */
const suiteFinished = require('./helpers/finish-guard');
const assert = require('assert');
const {
  installEventHarness, asHost, request, seedOrg, startsIn, bodyOf,
} = require('./helpers/event-harness');

const h = installEventHarness();
const { table } = h;
process.env.REPORTS_BUCKET_NAME = 'test-reports';
const create = h.load('lambda-functions/websocket/events/create-event.js').handler;
const items = h.load('lambda-functions/websocket/events/items.js').handler;
const eventRoute = h.load('lambda-functions/websocket/events/update-event.js').handler;
const saveReport = h.load('lambda-functions/game/save-report.js').handler;
const clearGame = h.load('lambda-functions/admin/delete-game.js').handler;
const clearAll = h.load('lambda-functions/admin/clear-all-games.js').handler;

let pass = 0; let fail = 0;
async function check(label, fn) {
  try { await fn(); console.log(`  ok - ${label}`); pass += 1; }
  catch (e) { console.log(`  FAIL - ${label}\n    ${e.stack || e.message}`); fail += 1; }
}

const NW = 'org_nw';
const MD = 'org_md';
const add = (code, item) => items(request({
  method: 'POST', path: `/events/${code}/items`, pathParameters: { code }, requestContext: asHost(NW), body: item,
}));
const run = (code, body) => items(request({
  method: 'POST', path: `/dev/events/${code}/run`, pathParameters: { code }, requestContext: asHost(NW), body,
}));
const del = (code) => eventRoute(request({
  method: 'DELETE', path: `/events/${code}`, pathParameters: { code }, requestContext: asHost(NW),
}));
const rowsOf = (pk) => [...table.store.values()].filter((r) => r.PK === pk);
const hasSession = (gameId, org = NW) => rowsOf(`GAME#${gameId}`).length > 0
  || Boolean(table.get(`ORG#${org}#GAMES`, `GAME#${gameId}`)) || Boolean(table.get('GAMES', `GAME#${gameId}`));

async function makeEvent(title) {
  const res = await create(request({
    method: 'POST', path: '/events', requestContext: asHost(NW),
    body: { title, place: 'Harbour Room', startsAt: startsIn(3), timeZone: 'Europe/London' },
  }));
  assert.strictEqual(res.statusCode, 201, res.body);
  return bodyOf(res).event.code;
}
async function twoItems(code) {
  const trivia = bodyOf(await add(code, { type: 'trivia', title: 'Space night', minutes: 15, setRef: { scope: 'platform', setId: 'space', version: 1 } })).item.itemId;
  const friction = bodyOf(await add(code, { type: 'call-and-answer', title: 'What slows us down?', minutes: 20, setRef: { scope: 'platform', setId: 'friction' } })).item.itemId;
  return { trivia, friction };
}

(async () => {
  seedOrg(table, NW);
  seedOrg(table, MD);
  table.put({ PK: 'SETS', SK: 'SET#space', name: 'Space Trivia', engagementType: 'trivia', questionCount: 12, activeVersion: 1, versions: [{ version: 1, questionCount: 12 }] });
  table.put({ PK: 'SETS', SK: 'SET#friction', name: 'Friction finder', engagementType: 'call-and-answer', questionCount: 4, activeVersion: 1, versions: [{ version: 1, questionCount: 4 }] });

  // ── A day that ran ──────────────────────────────────────────────────────
  const code = await makeEvent('Q4 Kickoff');
  const { trivia, friction } = await twoItems(code);
  const triviaGame = bodyOf(await run(code, { action: 'start', itemId: trivia })).gameId;
  const frictionGame = bodyOf(await run(code, { action: 'start', itemId: friction })).gameId;
  const saved = await saveReport({
    requestContext: asHost(NW), pathParameters: { gameId: triviaGame },
    body: JSON.stringify({ eventTitle: 'Space night', pdfBlob: 'JVBERi0=', permanent: true }),
  });
  assert.strictEqual(saved.statusCode, 200, saved.body);
  const reportKey = bodyOf(saved).fileName;

  console.log('\n1. every new artifact has a ttl');
  await check("an item session's list row, METADATA and code carry the session's ttl", () => {
    const index = table.get(`ORG#${NW}#GAMES`, `GAME#${triviaGame}`);
    assert.ok(Number(index.ttl) > Date.now() / 1000, 'index row ttl');
    assert.strictEqual(index.ttl, table.get(`GAME#${triviaGame}`, 'METADATA').ttl);
    assert.ok(Number(table.get('GAMES', `GAME#${triviaGame}`).ttl) > 0);
  });
  await check("the item's saved report row carries its year", () => {
    const row = table.get(`ORG#${NW}#REPORTS`, `REPORT#${triviaGame}`);
    assert.ok(Math.abs(row.ttl - (Date.now() / 1000 + 365 * 86400)) < 120, `ttl=${row.ttl}`);
  });

  console.log('\n2. the session routes leave an event\'s sessions to the event');
  await check('clear-game refuses an item session, says which event, and deletes nothing', async () => {
    const before = rowsOf(`GAME#${frictionGame}`).length;
    const res = await clearGame({ pathParameters: { gameId: frictionGame }, requestContext: asHost(NW, { groups: 'admins,hosts' }) });
    assert.strictEqual(res.statusCode, 409, res.body);
    const body = bodyOf(res);
    assert.strictEqual(body.code, 'event_item');
    assert.strictEqual(body.eventCode, code);
    assert.match(body.error, /Delete the event instead/);
    assert.strictEqual(rowsOf(`GAME#${frictionGame}`).length, before);
    assert.ok(table.get(`ORG#${NW}#GAMES`, `GAME#${frictionGame}`));
  });
  await check('delete-all clears the sessions a host made and leaves every item session, legacy rows included', async () => {
    // An ordinary session, and an item session written before its list row
    // carried EventRef (the METADATA says so).
    table.put({ PK: `ORG#${NW}#GAMES`, SK: 'GAME#5101', orgId: NW, Title: 'x', GameType: 'poll' });
    table.put({ PK: 'GAME#5101', SK: 'METADATA', orgId: NW, GameType: 'poll' });
    table.put({ PK: 'GAMES', SK: 'GAME#5101', orgId: NW });
    const legacy = table.get(`ORG#${NW}#GAMES`, `GAME#${frictionGame}`);
    delete legacy.EventRef; delete legacy.EventItem;
    table.put(legacy);
    const res = await clearAll({ requestContext: { ...asHost(NW, { groups: 'admins' }), http: { method: 'POST' } } });
    assert.strictEqual(res.statusCode, 200, res.body);
    const body = bodyOf(res);
    assert.strictEqual(body.sessionsDeleted, 1);
    assert.strictEqual(body.eventSessionsKept, 2);
    assert.ok(!hasSession('5101'), 'the ordinary session is gone');
    for (const g of [triviaGame, frictionGame]) {
      assert.ok(table.get(`GAME#${g}`, 'METADATA'), `${g} METADATA kept`);
      assert.ok(table.get(`ORG#${NW}#GAMES`, `GAME#${g}`), `${g} list row kept`);
      assert.ok(table.get('GAMES', `GAME#${g}`), `${g} code kept`);
    }
  });

  console.log('\n3. deleting an event that ran');
  await check('refused while an item is live, with a plain sentence, and nothing deleted', async () => {
    const res = await del(code);
    assert.strictEqual(res.statusCode, 409, res.body);
    assert.strictEqual(bodyOf(res).code, 'item_running');
    assert.ok(table.get(`EVENT#${code}`, 'METADATA'));
    assert.ok(hasSession(frictionGame));
  });
  await check('once nothing is running it goes, with every item session, its list row and its code', async () => {
    const ended = await run(code, { action: 'end', itemId: friction });
    assert.strictEqual(ended.statusCode, 200, ended.body);
    const res = await del(code);
    assert.strictEqual(res.statusCode, 200, res.body);
    assert.deepStrictEqual(bodyOf(res), { deleted: code, sessions: 2 });
    assert.strictEqual(rowsOf(`EVENT#${code}`).length, 0);
    assert.ok(!table.get(`ORG#${NW}#EVENTS`, `EVENT#${code}`));
    assert.ok(!table.get('GAMES', `GAME#${code}`), 'the event code is free');
    for (const g of [triviaGame, frictionGame]) {
      assert.strictEqual(rowsOf(`GAME#${g}`).length, 0, `${g}'s rows`);
      assert.ok(!table.get(`ORG#${NW}#GAMES`, `GAME#${g}`), `${g}'s list row`);
      assert.ok(!table.get('GAMES', `GAME#${g}`), `${g}'s code`);
    }
  });
  await check('its saved report stays: the row, and the file', () => {
    assert.ok(table.get(`ORG#${NW}#REPORTS`, `REPORT#${triviaGame}`));
    // The report bucket is the harness's in-memory S3.
    assert.ok(h.media.objects.has(reportKey), 'the PDF is still in the bucket');
  });

  console.log('\n4. a code drawn again is somebody else\'s');
  await check("an item session that expired, its code since drawn by another organisation's session, is not touched", async () => {
    const later = await makeEvent('Spring offsite');
    const ids = await twoItems(later);
    const g = bodyOf(await run(later, { action: 'start', itemId: ids.trivia })).gameId;
    await run(later, { action: 'end', itemId: ids.trivia });
    // The item session expires …
    for (const r of rowsOf(`GAME#${g}`)) table.store.delete(table.keyOf(r.PK, r.SK));
    table.store.delete(table.keyOf(`ORG#${NW}#GAMES`, `GAME#${g}`));
    table.store.delete(table.keyOf('GAMES', `GAME#${g}`));
    // … and Maple Dental's new session draws the same four digits.
    table.put({ PK: `GAME#${g}`, SK: 'METADATA', orgId: MD, GameType: 'poll' });
    table.put({ PK: `GAME#${g}`, SK: 'STATE', State: 'STARTED' });
    table.put({ PK: `ORG#${MD}#GAMES`, SK: `GAME#${g}`, orgId: MD });
    table.put({ PK: 'GAMES', SK: `GAME#${g}`, orgId: MD });
    const res = await del(later);
    assert.strictEqual(res.statusCode, 200, res.body);
    assert.strictEqual(bodyOf(res).sessions, 0);
    assert.strictEqual(rowsOf(`GAME#${g}`).length, 2, "Maple Dental's session is intact");
    assert.ok(table.get(`ORG#${MD}#GAMES`, `GAME#${g}`));
    assert.strictEqual(table.get('GAMES', `GAME#${g}`).orgId, MD, 'its code is still held');
  });

  console.log(`\n${pass} passed, ${fail} failed`);
  suiteFinished();
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
