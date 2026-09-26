/**
 * PUT /events/{code} — lambda-functions/websocket/events/update-event.js.
 *
 * "Edit details": the name, place, date, start, zone and report default. The
 * name and place are re-sealed on both rows; a new date moves the expiry of
 * every row the event owns, in one transaction.
 *
 * rejects: a rename that reaches METADATA but not the list (or the reverse);
 * plaintext written back; a date change that leaves any row — the code, an
 * item — on the old date's clock; a date change that could touch a session's
 * code; a bad value half-saved; a foreign member editing.
 */
const suiteFinished = require('./helpers/finish-guard');
const assert = require('assert');
const {
  installEventHarness, asHost, request, seedOrg, startsIn, bodyOf,
} = require('./helpers/event-harness');
const { plainRow } = require('./helpers/tenant-crypto-stub');

const h = installEventHarness();
const { table } = h;
const create = h.load('lambda-functions/websocket/events/create-event.js').handler;
const update = h.load('lambda-functions/websocket/events/update-event.js').handler;
const rules = h.load('lambda-functions/websocket/events/agenda-rules.js');
const { isEnvelope, encryptItem } = h.load('lambda-functions/websocket/tenant-crypto.js');

let pass = 0; let fail = 0;
async function check(label, fn) {
  try { await fn(); console.log(`  ok - ${label}`); pass += 1; }
  catch (e) { console.log(`  FAIL - ${label}\n    ${e.message}`); fail += 1; }
}

const NW = 'org_nw';
const put = (code, body, ctx = asHost(NW)) => update(request({
  method: 'PUT', path: `/events/${code}`, pathParameters: { code }, body, requestContext: ctx,
}));

(async () => {
  table.clear();
  seedOrg(table, NW);
  seedOrg(table, 'org_md');
  const first = startsIn(20);
  const { code } = bodyOf(await create(request({
    method: 'POST', path: '/events', requestContext: asHost(NW),
    body: { title: 'Q4 Kickoff', place: 'Harbour Room', startsAt: first, timeZone: 'Europe/London' },
  }))).event;
  table.put(await encryptItem(NW, 'item', {
    PK: `EVENT#${code}`, SK: 'ITEM#it_00000001', Type: 'break', Order: 1, Minutes: 15,
    Title: 'Break', State: 'planned', ttl: table.get(`EVENT#${code}`, 'METADATA').ttl,
  }));
  const rows = () => ({
    reservation: table.get('GAMES', `GAME#${code}`),
    list: table.get(`ORG#${NW}#EVENTS`, `EVENT#${code}`),
    meta: table.get(`EVENT#${code}`, 'METADATA'),
    item: table.get(`EVENT#${code}`, 'ITEM#it_00000001'),
  });

  console.log('\n1. a rename reaches both rows, sealed');
  const renamed = await put(code, { title: 'Q4 Kickoff, day one', place: 'Riverside Hall' });
  await check('200 with the new details, the rest kept', () => {
    assert.strictEqual(renamed.statusCode, 200, renamed.body);
    const { event } = bodyOf(renamed);
    assert.strictEqual(event.title, 'Q4 Kickoff, day one');
    assert.strictEqual(event.place, 'Riverside Hall');
    assert.strictEqual(event.startsAt, first);
  });
  await check('both rows carry the new words, sealed', () => {
    const { list, meta } = rows();
    for (const row of [list, meta]) {
      assert.ok(isEnvelope(row.Title) && isEnvelope(row.Place));
      assert.strictEqual(plainRow(NW, row).Title, 'Q4 Kickoff, day one');
      assert.strictEqual(plainRow(NW, row).Place, 'Riverside Hall');
    }
  });
  await check('the same date leaves every expiry alone', () => {
    const { reservation, list, meta, item } = rows();
    const ttl = meta.ttl;
    for (const row of [reservation, list, item]) assert.strictEqual(row.ttl, ttl);
  });

  console.log('\n2. a new date moves every row\'s expiry, together');
  const later = startsIn(200);
  await check('the code, the list row, METADATA and every item follow the new date', async () => {
    const res = await put(code, { startsAt: later });
    assert.strictEqual(res.statusCode, 200, res.body);
    const expected = rules.eventTtl(later, Math.floor(Date.now() / 1000));
    for (const [name, row] of Object.entries(rows())) assert.strictEqual(row.ttl, expected, `${name} stayed on the old clock`);
    assert.strictEqual(rows().meta.StartsAt, later);
    assert.strictEqual(rows().list.StartsAt, later);
  });
  // rejects: the reservation's update without its Kind condition, which would
  // let a date change write onto a session's code.
  await check('a code that is not an event\'s cancels the whole change', async () => {
    const held = table.get('GAMES', `GAME#${code}`);
    table.put({ PK: held.PK, SK: held.SK, orgId: held.orgId, ttl: held.ttl });   // a session's shape
    try {
      const res = await put(code, { startsAt: startsIn(100) });
      assert.strictEqual(res.statusCode, 409, res.body);
      assert.strictEqual(rows().meta.StartsAt, later, 'METADATA moved anyway');
    } finally { table.put(held); }
  });

  console.log('\n3. refusals change nothing');
  for (const [label, patch] of [
    ['an empty name', { title: '  ' }],
    ['an unknown zone', { timeZone: 'Mars/Base' }],
    ['invite-only', { access: 'invite' }],
  ]) {
    await check(`${label}: 400, nothing written`, async () => {
      const before = JSON.stringify(rows());
      const res = await put(code, patch);
      assert.strictEqual(res.statusCode, 400, res.body);
      assert.strictEqual(JSON.stringify(rows()), before);
    });
  }
  await check('another organisation\'s member: 404, nothing written', async () => {
    const before = JSON.stringify(rows());
    const res = await put(code, { title: 'Mine now' }, asHost('org_md'));
    assert.strictEqual(res.statusCode, 404, res.body);
    assert.strictEqual(JSON.stringify(rows()), before);
  });

  console.log(`\n${pass} passed, ${fail} failed`);
  suiteFinished();
  process.exit(fail ? 1 : 0);
})();
