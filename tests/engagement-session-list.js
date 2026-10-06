/**
 * AN EVENT IS ONE ROW OF THE SESSION LIST, AND ITS ITEMS' SESSIONS ARE NOT
 * LISTED TWICE — GET /games (lambda-functions/game/get-games-list.js and
 * game/engagement-catalog.js), 2026-10-04.
 *
 * The owner: "why are these not treated as other types of engagements that i
 * can see listed in sessions, and reports, etc." — and the shape, decided the
 * same day: an event is ONE row, labelled Event with its item count; opening
 * it shows its agenda items, each linking to that item's own session; an item
 * session (EventRef) never appears again at the top level. A Build Room is one
 * row too (it always was: it is a session of type `build`).
 *
 * Driven end to end: a real event is made, an item goes live and another is
 * previewed through POST /events/{code}/run, so the item sessions here are the
 * ones the product writes, not a fixture's guess at them.
 *
 * rejects: an item session listed at the top level beside its event; an event
 * missing from the list; an event's words sent as ciphertext; another
 * organisation's event listed; event rows while the switch is off, or an item
 * session then listed nowhere; a list that stops at one page; one unreadable
 * item emptying the list; an expired item session offered as if it were there.
 */
const suiteFinished = require('./helpers/finish-guard');
const assert = require('assert');
const {
  installEventHarness, asHost, request, seedOrg, startsIn, bodyOf,
} = require('./helpers/event-harness');

const h = installEventHarness();
const { table } = h;
const create = h.load('lambda-functions/websocket/events/create-event.js').handler;
const items = h.load('lambda-functions/websocket/events/items.js').handler;
const list = h.load('lambda-functions/game/get-games-list.js').handler;
const C = h.load('lambda-functions/game/tenant-crypto.js');

let pass = 0; let fail = 0;
async function check(label, fn) {
  try { await fn(); console.log(`  ok - ${label}`); pass += 1; }
  catch (e) { console.log(`  FAIL - ${label}\n    ${e.stack || e.message}`); fail += 1; }
}

const NW = 'org_nw';
const MD = 'org_md';
const isEnvelope = (v) => Boolean(v) && typeof v === 'object' && typeof v.ct === 'string';

const add = (code, item, org = NW) => items(request({
  method: 'POST', path: `/events/${code}/items`, pathParameters: { code }, requestContext: asHost(org), body: item,
}));
const run = (code, body, org = NW) => items(request({
  method: 'POST', path: `/dev/events/${code}/run`, pathParameters: { code }, requestContext: asHost(org), body,
}));
async function sessions(org = NW) {
  const res = await list({ requestContext: asHost(org) });
  assert.strictEqual(res.statusCode, 200, res.body);
  return bodyOf(res);
}
const ids = (body) => body.games.map((g) => g.gameId).sort();

async function makeEvent(title, org = NW) {
  const res = await create(request({
    method: 'POST', path: '/events', requestContext: asHost(org),
    body: { title, place: 'Harbour Room', startsAt: startsIn(3), timeZone: 'Europe/London' },
  }));
  assert.strictEqual(res.statusCode, 201, res.body);
  return bodyOf(res).event.code;
}

/** A session a host made by hand, as createGame writes its list row (Title sealed). */
async function seedSession(gameId, { type = 'trivia', title = `Session ${gameId}`, org = NW } = {}) {
  table.put(await C.encryptItem(org, 'session', {
    PK: `ORG#${org}#GAMES`, SK: `GAME#${gameId}`, orgId: org, Title: title, HostName: 'Ada',
    GameType: type, QuestionSetId: 'space', CreatedAt: new Date().toISOString(), Started: true,
  }));
  table.put({ PK: `GAME#${gameId}`, SK: 'STATE', State: 'STARTED', LessonNumber: 0 });
}

(async () => {
  seedOrg(table, NW);
  seedOrg(table, MD);
  table.put({ PK: 'SETS', SK: 'SET#space', name: 'Space Trivia', engagementType: 'trivia', questionCount: 12, activeVersion: 1, versions: [{ version: 1, questionCount: 12 }] });
  table.put({ PK: 'SETS', SK: 'SET#friction', name: 'Friction finder', engagementType: 'call-and-answer', questionCount: 4, activeVersion: 1, versions: [{ version: 1, questionCount: 4 }] });

  const code = await makeEvent('Q4 Kickoff');
  const trivia = bodyOf(await add(code, { type: 'trivia', title: 'Space night', minutes: 15, setRef: { scope: 'platform', setId: 'space', version: 1 } })).item.itemId;
  const talk = bodyOf(await add(code, { type: 'presentation', title: 'FY26 in review', ledBy: 'Dana', minutes: 30 })).item.itemId;
  const friction = bodyOf(await add(code, { type: 'call-and-answer', title: 'What slows us down?', minutes: 20, setRef: { scope: 'platform', setId: 'friction' } })).item.itemId;

  const started = await run(code, { action: 'start', itemId: trivia });
  assert.strictEqual(started.statusCode, 200, started.body);
  const triviaGame = bodyOf(started).gameId;
  const prepared = await run(code, { action: 'prepare', itemId: friction });
  assert.strictEqual(prepared.statusCode, 200, prepared.body);
  const frictionGame = bodyOf(prepared).items.find((i) => i.itemId === friction).gameId;
  assert.ok(frictionGame, 'the previewed item has a session');

  await seedSession('5101', { title: 'Friday quiz' });
  await seedSession('5102', { type: 'build', title: 'Build the badge printer' });

  console.log('\n1. an item session says so on its list row');
  await check('createGame writes EventRef and EventItem on the ORG#…#GAMES row of an item session', () => {
    const row = table.get(`ORG#${NW}#GAMES`, `GAME#${triviaGame}`);
    assert.strictEqual(row.EventRef, code);
    assert.strictEqual(row.EventItem, trivia);
  });
  await check('a session a host made by hand carries no EventRef', () => {
    assert.strictEqual(table.get(`ORG#${NW}#GAMES`, 'GAME#5101').EventRef, undefined);
  });

  console.log('\n2. one row per event, nothing twice');
  let body = await sessions();
  await check('the sessions list keeps the ordinary session and the Build Room, and drops both item sessions', () => {
    assert.deepStrictEqual(ids(body), ['5101', '5102']);
  });
  await check('the event is one row: kind event, its title in plaintext, its item count and its items in order', () => {
    assert.strictEqual(body.events.length, 1);
    const e = body.events[0];
    assert.strictEqual(e.kind, 'event');
    assert.strictEqual(e.gameType, 'event');
    assert.strictEqual(e.gameId, code);
    assert.strictEqual(e.eventCode, code);
    assert.strictEqual(e.title, 'Q4 Kickoff');
    assert.strictEqual(e.itemCount, 3);
    assert.deepStrictEqual(e.items.map((i) => i.itemId), [trivia, talk, friction]);
    assert.deepStrictEqual(e.items.map((i) => i.title), ['Space night', 'FY26 in review', 'What slows us down?']);
    assert.strictEqual(e.state, 'LIVE');
    assert.strictEqual(e.started, true);
    assert.ok(e.createdAt, 'created, from METADATA');
  });
  await check('the fixture is ciphertext where the writer seals it (the decrypt is not a pass-through)', () => {
    assert.ok(isEnvelope(table.get(`ORG#${NW}#EVENTS`, `EVENT#${code}`).Title));
    assert.ok(isEnvelope(table.get(`EVENT#${code}`, `ITEM#${trivia}`).Title));
  });
  await check('each engagement item carries its own session: the live one started, the previewed one not', () => {
    const e = body.events[0];
    const live = e.items.find((i) => i.itemId === trivia);
    const preview = e.items.find((i) => i.itemId === friction);
    assert.strictEqual(live.session.gameId, triviaGame);
    assert.strictEqual(live.session.started, true);
    assert.strictEqual(live.session.gameType, 'trivia');
    assert.strictEqual(preview.session.gameId, frictionGame);
    assert.strictEqual(preview.session.started, false);
    assert.strictEqual(e.items.find((i) => i.itemId === talk).session, null, 'a talk has no session');
    assert.strictEqual(live.sessionGone, false);
  });

  console.log('\n3. a session written before the list row carried EventRef');
  await check('is still filed under its event, by the item that names it', async () => {
    const row = table.get(`ORG#${NW}#GAMES`, `GAME#${frictionGame}`);
    delete row.EventRef; delete row.EventItem;
    table.put(row);
    const again = await sessions();
    assert.deepStrictEqual(ids(again), ['5101', '5102']);
    assert.strictEqual(again.events[0].items.find((i) => i.itemId === friction).session.gameId, frictionGame);
  });

  console.log('\n4. organisations');
  await check("another organisation's event is not listed, and its own is", async () => {
    const mdCode = await makeEvent('Board offsite', MD);
    const nw = await sessions(NW);
    assert.deepStrictEqual(nw.events.map((e) => e.eventCode), [code]);
    const md = await sessions(MD);
    assert.deepStrictEqual(md.events.map((e) => e.eventCode), [mdCode]);
    assert.deepStrictEqual(md.games, []);
  });

  console.log('\n5. the switch');
  await check('switched off: no event rows, and every item session is listed once, at the top level', async () => {
    process.env.EVENTS_ENABLED = 'off';
    try {
      const off = await sessions();
      assert.deepStrictEqual(off.events, []);
      assert.deepStrictEqual(ids(off), ['5101', '5102', frictionGame, triviaGame].sort());
    } finally {
      process.env.EVENTS_ENABLED = 'on';
    }
  });

  console.log('\n6. paging');
  await check('a list past one page still carries every session and every item', async () => {
    for (let n = 0; n < 7; n += 1) await seedSession(String(5200 + n));
    table.pageSize = 2;
    try {
      const paged = await sessions();
      assert.strictEqual(paged.games.length, 9);
      assert.strictEqual(paged.events[0].items.length, 3);
      assert.ok(!paged.games.some((g) => g.gameId === triviaGame));
    } finally {
      table.pageSize = null;
    }
  });

  console.log('\n7. what goes wrong');
  await check('an item session that has expired is marked gone, not offered', async () => {
    for (const row of [...table.store.values()]) {
      if (row.PK === `GAME#${triviaGame}` || (row.PK === `ORG#${NW}#GAMES` && row.SK === `GAME#${triviaGame}`)) {
        table.store.delete(table.keyOf(row.PK, row.SK));
      }
    }
    const gone = await sessions();
    const item = gone.events[0].items.find((i) => i.itemId === trivia);
    assert.strictEqual(item.gameId, triviaGame);
    assert.strictEqual(item.session, null);
    assert.strictEqual(item.sessionGone, true);
  });
  await check('one unreadable item does not empty the list: its words are blank and it says so', async () => {
    const row = table.get(`EVENT#${code}`, `ITEM#${talk}`);
    table.put({ ...row, Title: { ...row.Title, ct: Buffer.from('garbage').toString('base64') } });
    const after = await sessions();
    const item = after.events[0].items.find((i) => i.itemId === talk);
    assert.strictEqual(item.decryptFailed, true);
    assert.strictEqual(item.title, '');
    assert.strictEqual(after.events[0].title, 'Q4 Kickoff');
    assert.strictEqual(after.games.length, 9);
  });

  console.log(`\n${pass} passed, ${fail} failed`);
  suiteFinished();
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
