/**
 * THE HOST'S READS — GET /events and GET /events/{code}
 * (lambda-functions/websocket/events/get-events.js, get-event.js).
 *
 * The list is one organisation's and only that organisation's; one event
 * comes back with its agenda in order, every word decrypted, and each
 * engagement saying what the builder needs about its set — its name, its
 * question count, the version it would play today, or that it is gone.
 *
 * rejects: another organisation's events in a list; a list that stops at the
 * first 1 MB page; ciphertext in a response; an agenda out of order; another
 * organisation's member, an anonymous caller or a malformed code getting
 * anything but the one 404; a missing set breaking the builder's read.
 */
const suiteFinished = require('./helpers/finish-guard');
const assert = require('assert');
const {
  installEventHarness, asHost, request, seedOrg, startsIn, bodyOf,
} = require('./helpers/event-harness');

const h = installEventHarness();
const { table } = h;
const create = h.load('lambda-functions/websocket/events/create-event.js').handler;
const getEvents = h.load('lambda-functions/websocket/events/get-events.js').handler;
const getEvent = h.load('lambda-functions/websocket/events/get-event.js').handler;
const { encryptItem } = h.load('lambda-functions/websocket/tenant-crypto.js');

let pass = 0; let fail = 0;
async function check(label, fn) {
  try { await fn(); console.log(`  ok - ${label}`); pass += 1; }
  catch (e) { console.log(`  FAIL - ${label}\n    ${e.message}`); fail += 1; }
}

const NW = 'org_nw';
const MD = 'org_md';
const make = async (orgId, title, days) => bodyOf(await create(request({
  method: 'POST', path: '/events', requestContext: asHost(orgId),
  body: { title, place: `${title} room`, startsAt: startsIn(days), timeZone: 'Europe/London' },
}))).event;
const list = (orgId, ctx) => getEvents(request({ path: '/events', requestContext: ctx || asHost(orgId) }));
const read = (code, ctx) => getEvent(request({ path: `/events/${code}`, pathParameters: { code }, requestContext: ctx }));
async function seedItem(code, itemId, fields) {
  table.put(await encryptItem(NW, 'item', {
    PK: `EVENT#${code}`, SK: `ITEM#${itemId}`, State: 'planned', ttl: 1, ...fields,
  }));
}

(async () => {
  table.clear();
  seedOrg(table, NW);
  seedOrg(table, MD);

  console.log('\n1. GET /events is the acting organisation\'s list');
  const later = await make(NW, 'Partner day', 40);
  const soon = await make(NW, 'Q4 Kickoff', 10);
  const theirs = await make(MD, 'Their offsite', 20);
  await check('soonest first, decrypted, and none of another organisation\'s', async () => {
    const res = await list(NW);
    assert.strictEqual(res.statusCode, 200, res.body);
    const { events } = bodyOf(res);
    assert.deepStrictEqual(events.map((e) => e.title), ['Q4 Kickoff', 'Partner day']);
    assert.deepStrictEqual(events.map((e) => e.code), [soon.code, later.code]);
    assert.strictEqual(events[0].place, 'Q4 Kickoff room');
    assert.ok(!events.some((e) => e.code === theirs.code));
  });
  // rejects: a single-page read — the day the list outgrows 1 MB it goes blind.
  await check('it reads every page', async () => {
    await make(NW, 'Third', 50);
    await make(NW, 'Fourth', 60);
    table.pageSize = 2;
    try {
      const { events } = bodyOf(await list(NW));
      assert.strictEqual(events.length, 4);
    } finally { table.pageSize = null; }
  });
  await check('a caller acting for no organisation is refused', async () => {
    const res = await list('', asHost(''));
    assert.strictEqual(res.statusCode, 403, res.body);
  });

  console.log('\n2. GET /events/{code} is the agenda, in order, with its sets');
  const code = soon.code;
  table.put(await encryptItem(NW, 'set', {
    PK: `ORG#${NW}#SETS`, SK: 'SET#custq4', name: 'Customer knowledge — Q4',
    engagementType: 'trivia', questionCount: 10, activeVersion: 3, versions: [{ version: 2 }, { version: 3 }],
  }));
  await seedItem(code, 'it_00000002', { Type: 'break', Order: 2, Minutes: 15, Title: 'Break', Description: 'Coffee' });
  await seedItem(code, 'it_00000001', {
    Type: 'trivia', Order: 1, Minutes: 15, Title: 'How well do you know our customers?', Description: 'Ten questions.',
    SetRef: { scope: 'org', orgId: NW, setId: 'custq4', version: 2 },
  });
  await seedItem(code, 'it_00000003', {
    Type: 'poll', Order: 3, Minutes: 10, Title: 'Where next?', Description: '',
    SetRef: { scope: 'platform', orgId: '', setId: 'gone', version: 1 },
  });
  const res = await read(code, asHost(NW));
  const body = bodyOf(res);
  await check('200 with the event and its items in agenda order', () => {
    assert.strictEqual(res.statusCode, 200, res.body);
    assert.strictEqual(body.event.title, 'Q4 Kickoff');
    assert.deepStrictEqual(body.items.map((i) => i.itemId), ['it_00000001', 'it_00000002', 'it_00000003']);
  });
  await check('every word decrypted, no envelope anywhere', () => {
    assert.strictEqual(body.items[0].title, 'How well do you know our customers?');
    assert.strictEqual(body.items[1].description, 'Coffee');
    assert.ok(!/"ct":/.test(res.body), 'an envelope reached the response');
  });
  await check('an engagement says its set, its pin and the version it would play today', () =>
    assert.deepStrictEqual({ setRef: body.items[0].setRef, set: body.items[0].set }, {
      setRef: { scope: 'org', orgId: NW, setId: 'custq4', version: 2 },
      set: { missing: false, name: 'Customer knowledge — Q4', questionCount: 10, latestVersion: 3 },
    }));
  await check('a break has no set', () => {
    assert.strictEqual(body.items[1].setRef, undefined);
    assert.strictEqual(body.items[1].set, undefined);
  });
  await check('a set that is gone says so, and the read still succeeds', () =>
    assert.strictEqual(body.items[2].set.missing, true));

  console.log('\n3. one 404 for everything that is not yours');
  const notFound = bodyOf(await read('9999', asHost(NW)));
  for (const [label, c, ctx] of [
    ['another organisation\'s member', code, asHost(MD)],
    ['a signed-in account with no group', code, { authorizer: { lambda: { userId: 'u', orgId: NW, orgIds: NW } } }],
    ['no identity at all', code, undefined],
    ['a malformed code', '53a7', asHost(NW)],
  ]) {
    await check(`${label}: the same 404 as an unknown code`, async () => {
      const r = await read(c, ctx);
      assert.strictEqual(r.statusCode, 404, r.body);
      assert.deepStrictEqual(bodyOf(r), notFound);
    });
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  suiteFinished();
  process.exit(fail ? 1 : 0);
})();
