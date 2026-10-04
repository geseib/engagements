/**
 * REPORTS: EVERY ROW TYPED, AN EVENT ONE ROW WITH ITS ITEMS — GET /reports
 * (lambda-functions/game/get-reports.js) and the row save-report.js writes,
 * 2026-10-04.
 *
 * The owner asked why events and Build Rooms are not listed "in sessions, and
 * reports, etc." like every other engagement. A saved report's index row now
 * records the session's format and, for an event item, its event and item —
 * plaintext ids, read off the session — so the list can type every row and
 * file an item's report under its ONE event row long after the session (7
 * days from start) has gone. Rows saved before that are attributed through the
 * session's METADATA while it exists, and through the event item that names
 * the session after it does not.
 *
 * rejects: a report row without its format; an item's report not tied to its
 * event; an event that has run missing from the reports list; an event that
 * never ran and has no report listed; an item's saved report not named on its
 * item; an older row (no EventRef) left ungrouped; event rows while the switch
 * is off; a list that stops at one page.
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
const saveReport = h.load('lambda-functions/game/save-report.js').handler;
const listReports = h.load('lambda-functions/game/get-reports.js').handler;

let pass = 0; let fail = 0;
async function check(label, fn) {
  try { await fn(); console.log(`  ok - ${label}`); pass += 1; }
  catch (e) { console.log(`  FAIL - ${label}\n    ${e.stack || e.message}`); fail += 1; }
}

const NW = 'org_nw';
const add = (code, item) => items(request({
  method: 'POST', path: `/events/${code}/items`, pathParameters: { code }, requestContext: asHost(NW), body: item,
}));
const run = (code, body) => items(request({
  method: 'POST', path: `/dev/events/${code}/run`, pathParameters: { code }, requestContext: asHost(NW), body,
}));
async function save(gameId, title) {
  const res = await saveReport({
    requestContext: asHost(NW),
    pathParameters: { gameId },
    body: JSON.stringify({ eventTitle: title, pdfBlob: 'JVBERi0=', permanent: false }),
  });
  assert.strictEqual(res.statusCode, 200, res.body);
}
async function reports() {
  const res = await listReports({ requestContext: asHost(NW) });
  assert.strictEqual(res.statusCode, 200, res.body);
  return bodyOf(res);
}
async function makeEvent(title) {
  const res = await create(request({
    method: 'POST', path: '/events', requestContext: asHost(NW),
    body: { title, place: 'Harbour Room', startsAt: startsIn(3), timeZone: 'Europe/London' },
  }));
  assert.strictEqual(res.statusCode, 201, res.body);
  return bodyOf(res).event.code;
}

(async () => {
  seedOrg(table, NW);
  table.put({ PK: 'SETS', SK: 'SET#space', name: 'Space Trivia', engagementType: 'trivia', questionCount: 12, activeVersion: 1, versions: [{ version: 1, questionCount: 12 }] });
  table.put({ PK: 'SETS', SK: 'SET#friction', name: 'Friction finder', engagementType: 'call-and-answer', questionCount: 4, activeVersion: 1, versions: [{ version: 1, questionCount: 4 }] });

  const code = await makeEvent('Q4 Kickoff');
  const trivia = bodyOf(await add(code, { type: 'trivia', title: 'Space night', minutes: 15, setRef: { scope: 'platform', setId: 'space', version: 1 } })).item.itemId;
  const friction = bodyOf(await add(code, { type: 'call-and-answer', title: 'What slows us down?', minutes: 20, setRef: { scope: 'platform', setId: 'friction' } })).item.itemId;
  const triviaGame = bodyOf(await run(code, { action: 'start', itemId: trivia })).gameId;
  const frictionGame = bodyOf(await run(code, { action: 'start', itemId: friction })).gameId;
  const quiet = await makeEvent('Planning day, not yet run');

  // Two sessions a host made by hand: an ordinary one and a Build Room.
  table.put({ PK: 'GAME#5101', SK: 'METADATA', orgId: NW, GameType: 'poll', Title: 'x' });
  table.put({ PK: 'GAME#5102', SK: 'METADATA', orgId: NW, GameType: 'build', Title: 'x' });

  await save(triviaGame, 'Space night');
  await save('5101', 'Friday poll');
  await save('5102', 'Badge printer');

  console.log('\n1. the row a save writes');
  await check("an item session's report row says its format, its event and its item, in plaintext", () => {
    const row = table.get(`ORG#${NW}#REPORTS`, `REPORT#${triviaGame}`);
    assert.strictEqual(row.GameType, 'trivia');
    assert.strictEqual(row.EventRef, code);
    assert.strictEqual(row.EventItem, trivia);
  });
  await check("a Build Room's report row says build, and names no event", () => {
    const row = table.get(`ORG#${NW}#REPORTS`, 'REPORT#5102');
    assert.strictEqual(row.GameType, 'build');
    assert.strictEqual(row.EventRef, undefined);
  });

  console.log('\n2. the list');
  let body = await reports();
  const byGame = (b, id) => b.reports.find((r) => r.gameId === id);
  await check('every row is typed', () => {
    assert.strictEqual(byGame(body, triviaGame).gameType, 'trivia');
    assert.strictEqual(byGame(body, '5101').gameType, 'poll');
    assert.strictEqual(byGame(body, '5102').gameType, 'build');
  });
  await check("the item's report is tied to its event; the others are not", () => {
    assert.strictEqual(byGame(body, triviaGame).eventRef, code);
    assert.strictEqual(byGame(body, triviaGame).eventItem, trivia);
    assert.strictEqual(byGame(body, '5101').eventRef, undefined);
  });
  await check('the event that ran is one row, its items in order, each naming its saved report or none', () => {
    assert.deepStrictEqual(body.events.map((e) => e.code), [code]);
    const e = body.events[0];
    assert.strictEqual(e.kind, 'event');
    assert.strictEqual(e.title, 'Q4 Kickoff');
    assert.deepStrictEqual(e.items.map((i) => i.itemId), [trivia, friction]);
    assert.strictEqual(e.items[0].reportId, `REPORT#${triviaGame}`);
    assert.strictEqual(e.items[1].reportId, null);
    assert.strictEqual(e.items[1].gameId, frictionGame);
    assert.strictEqual(e.items[1].sessionGone, false, 'its session is still there to save one from');
  });
  await check('an event that never ran and has no report is not listed', () => {
    assert.ok(!body.events.some((e) => e.code === quiet));
  });

  console.log('\n3. a row saved before it carried its event');
  await check('is filed under its event through the item that names its session, once the session has gone', async () => {
    await save(frictionGame, 'What slows us down?');
    const row = table.get(`ORG#${NW}#REPORTS`, `REPORT#${frictionGame}`);
    delete row.EventRef; delete row.EventItem; delete row.GameType;
    table.put(row);
    for (const r of [...table.store.values()]) {
      if (r.PK === `GAME#${frictionGame}`) table.store.delete(table.keyOf(r.PK, r.SK));
    }
    body = await reports();
    const rep = byGame(body, frictionGame);
    assert.strictEqual(rep.eventRef, code);
    assert.strictEqual(rep.eventItem, friction);
    assert.strictEqual(rep.sessionGone, true);
    assert.strictEqual(rep.gameType, null, 'nothing left says what it was');
    const item = body.events[0].items.find((i) => i.itemId === friction);
    assert.strictEqual(item.reportId, `REPORT#${frictionGame}`);
    assert.strictEqual(item.sessionGone, true);
  });

  console.log('\n4. the switch and paging');
  await check('switched off: no event rows', async () => {
    process.env.EVENTS_ENABLED = 'off';
    try {
      const off = await reports();
      assert.deepStrictEqual(off.events, []);
      assert.strictEqual(off.reports.length, 4);
    } finally {
      process.env.EVENTS_ENABLED = 'on';
    }
  });
  await check('a list past one page carries every report', async () => {
    table.pageSize = 1;
    try {
      const paged = await reports();
      assert.strictEqual(paged.reports.length, 4);
      assert.strictEqual(paged.events[0].items.length, 2);
    } finally {
      table.pageSize = null;
    }
  });

  console.log(`\n${pass} passed, ${fail} failed`);
  suiteFinished();
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
