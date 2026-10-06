/**
 * AN EVENT'S ATTENDEES FOLLOW THE EVENT — deleted with it, and re-dated with
 * it (lambda-functions/websocket/events/delete-event.js and update-event.js,
 * through attendee-store.deleteAttendees and restampAttendees; events M2).
 *
 * The attendee rows live under EVENT#<code>, beside the agenda. Before M2 the
 * delete took every such row in ONE transaction, capped at 100 items, and the
 * date move re-dated only the agenda; with attendees neither holds.
 *
 * rejects: an event with more attendees than one transaction holds refused a
 * delete; an attendee row left behind a delete that succeeded; a sweep that
 * reads only the first 1 MB page; the code drawn again while an attendee row
 * remains; a sweep failure turning a finished delete into a 500, or logging
 * a name; a date move that leaves attendees on the old clock.
 */
const suiteFinished = require('./helpers/finish-guard');
const assert = require('assert');
const {
  installEventHarness, asHost, request, seedOrg, startsIn, drawing, bodyOf,
} = require('./helpers/event-harness');

const h = installEventHarness();
const { table } = h;
const create = h.load('lambda-functions/websocket/events/create-event.js').handler;
const items = h.load('lambda-functions/websocket/events/items.js').handler;
const eventRoute = h.load('lambda-functions/websocket/events/update-event.js').handler;
const attendeeFn = h.load('lambda-functions/websocket/events/get-agenda.js').handler;
const R = h.load('lambda-functions/websocket/code-reservation.js');

let pass = 0; let fail = 0;
async function check(label, fn) {
  try { await fn(); console.log(`  ok - ${label}`); pass += 1; }
  catch (e) { console.log(`  FAIL - ${label}\n    ${e.message}`); fail += 1; }
}

const NW = 'org_nw';
const join = (code, name) => attendeeFn(request({
  method: 'POST', path: `/events/${code}/attendees`, pathParameters: { code }, body: { name },
}));
const me = (code, token) => attendeeFn({
  ...request({ method: 'GET', path: `/events/${code}/me`, pathParameters: { code } }),
  headers: { authorization: `Bearer ${token}` },
});
const del = (code) => eventRoute(request({
  method: 'DELETE', path: `/events/${code}`, pathParameters: { code }, requestContext: asHost(NW),
}));
const underEvent = (code) => [...table.store.values()].filter((r) => r.PK === `EVENT#${code}`);
const attendeeRows = (code) => underEvent(code).filter((r) => String(r.SK).startsWith('ATTENDEE#'));

async function makeEvent(attendees, startsAt = startsIn(10)) {
  const res = await create(request({
    method: 'POST', path: '/events', requestContext: asHost(NW),
    body: { title: 'Q4 Kickoff', place: 'Harbour Room', startsAt, timeZone: 'Europe/London' },
  }));
  assert.strictEqual(res.statusCode, 201, res.body);
  const { code } = bodyOf(res).event;
  for (let i = 0; i < 3; i += 1) {
    const added = await items(request({
      method: 'POST', path: `/events/${code}/items`, pathParameters: { code }, requestContext: asHost(NW),
      body: { type: 'break', minutes: 5, title: `Break ${i + 1}` },
    }));
    assert.strictEqual(added.statusCode, 201, added.body);
  }
  const tokens = [];
  for (let i = 0; i < attendees; i += 1) {
    const joined = await join(code, `Person ${i + 1}`);
    assert.strictEqual(joined.statusCode, 201, joined.body);
    tokens.push(bodyOf(joined).token);
  }
  return { code, tokens };
}

(async () => {
  table.clear();
  seedOrg(table, NW);
  const realLog = console.log;

  console.log('\n1. a delete takes every attendee with the event, however many');
  console.log = () => {};
  const big = await makeEvent(120);
  console.log = realLog;
  await check('the event holds 120 attendees, more than one transaction could', () =>
    assert.strictEqual(attendeeRows(big.code).length, 120));
  const logFrom = table.log.length;
  const res = await del(big.code);
  await check('200, naming the code', () => {
    assert.strictEqual(res.statusCode, 200, res.body);
    assert.deepStrictEqual(bodyOf(res), { deleted: big.code, sessions: 0 });
  });
  await check('nothing is left under EVENT#, and the reservation is gone', () => {
    assert.deepStrictEqual(underEvent(big.code), []);
    assert.strictEqual(table.get('GAMES', `GAME#${big.code}`), undefined);
  });
  await check('the transaction held the agenda, METADATA, the list row and the code — no attendee', () => {
    const tx = table.log.slice(logFrom).filter((e) => e.type === 'transactWrite');
    assert.strictEqual(tx.length, 1);
    assert.strictEqual(tx[0].input.TransactItems.length, 6);
    assert.ok(!JSON.stringify(tx[0].input).includes('ATTENDEE#'));
  });
  await check('the attendees went after it, 25 to a call', () => {
    const batches = table.log.slice(logFrom).filter((e) => e.type === 'batchWrite');
    assert.deepStrictEqual(batches.map((b) => Object.values(b.input.RequestItems)[0].length), [25, 25, 25, 25, 20]);
  });
  await check('the code is drawable again', async () => {
    const again = await R.reserveCode(table.doc, { orgId: NW, ttl: 2000000000, kind: 'event', draw: drawing(big.code) });
    assert.strictEqual(again, big.code);
    table.store.delete(table.keyOf('GAMES', `GAME#${big.code}`));
  });

  console.log('\n2. the sweep reads to the last page');
  await check('with the table paging every 7 rows, every attendee still goes', async () => {
    console.log = () => {};
    const paged = await makeEvent(30);
    console.log = realLog;
    table.pageSize = 7;
    try {
      assert.strictEqual((await del(paged.code)).statusCode, 200);
    } finally { table.pageSize = null; }
    assert.deepStrictEqual(underEvent(paged.code), []);
  });

  console.log('\n3. a sweep that fails part-way');
  console.log = () => {};
  const stuck = await makeEvent(4);
  console.log = realLog;
  const lines = [];
  const realError = console.error;
  console.error = (...a) => lines.push(a.map(String).join(' '));
  table.inject((c) => c.type === 'batchWrite', () => Object.assign(new Error('the sweep failed'), { name: 'InternalServerError' }), 1);
  const partial = await del(stuck.code);
  console.error = realError;
  await check('the delete still answers 200: the event IS gone', () => {
    assert.strictEqual(partial.statusCode, 200, partial.body);
    assert.strictEqual(table.get(`EVENT#${stuck.code}`, 'METADATA'), undefined);
  });
  await check('it says so in the log, naming the event and no attendee', () => {
    const text = lines.join('\n');
    assert.match(text, new RegExp(`EVENT#${stuck.code} is deleted but some attendee rows remain`));
    assert.ok(!/Person \d/.test(text), 'a name was logged');
  });
  await check('the rows left behind keep the code from being drawn, so no new event inherits them', async () => {
    assert.strictEqual(attendeeRows(stuck.code).length, 4);
    await assert.rejects(
      R.reserveCode(table.doc, { orgId: NW, ttl: 2000000000, kind: 'event', draw: drawing(stuck.code) }),
      /the draw asked for more codes than the test offered/,
    );
  });
  await check('and none of them opens anything: the event is unknown', async () => {
    const r = await me(stuck.code, stuck.tokens[0]);
    assert.strictEqual(r.statusCode, 404);
  });

  console.log('\n4. a new date moves every attendee\'s expiry');
  console.log = () => {};
  const moving = await makeEvent(3);
  console.log = realLog;
  const put = await eventRoute(request({
    method: 'PUT', path: `/events/${moving.code}`, pathParameters: { code: moving.code }, requestContext: asHost(NW),
    body: { startsAt: startsIn(200) },
  }));
  const newTtl = table.get(`EVENT#${moving.code}`, 'METADATA').ttl;
  await check('the move lands, and every attendee row carries the event\'s new ttl', () => {
    assert.strictEqual(put.statusCode, 200, put.body);
    const rows = attendeeRows(moving.code);
    assert.strictEqual(rows.length, 3);
    for (const row of rows) assert.strictEqual(row.ttl, newTtl);
  });
  await check('an attendee is still known after the move', async () => {
    assert.strictEqual((await me(moving.code, moving.tokens[0])).statusCode, 200);
  });
  await check('a rename that keeps the date touches no attendee row', async () => {
    const logAt = table.log.length;
    const r = await eventRoute(request({
      method: 'PUT', path: `/events/${moving.code}`, pathParameters: { code: moving.code }, requestContext: asHost(NW),
      body: { title: 'Q4 Kickoff (moved)' },
    }));
    assert.strictEqual(r.statusCode, 200, r.body);
    const touched = table.log.slice(logAt).filter((e) => e.type === 'update' && String((e.input.Key || {}).SK).startsWith('ATTENDEE#'));
    assert.deepStrictEqual(touched, []);
  });

  console.log(`\n${pass} passed, ${fail} failed`);
  suiteFinished();
  process.exit(fail ? 1 : 0);
})();
