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
    engagementType: 'trivia', questionCount: 10, activeVersion: 3,
    versions: [{ version: 2, questionCount: 7 }, { version: 3, questionCount: 10 }],
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
  // Pinned to v1, which the set no longer has (deleted after it was added).
  await seedItem(code, 'it_00000004', {
    Type: 'trivia', Order: 4, Minutes: 12, Title: 'Old quiz', Description: '',
    SetRef: { scope: 'org', orgId: NW, setId: 'custq4', version: 1 },
  });
  // Pinned to the active version, which versions[] does not record, and
  // unpinned: both read the set's own count, as the session read would.
  await seedItem(code, 'it_00000005', {
    Type: 'trivia', Order: 5, Minutes: 12, Title: 'Unpinned quiz', Description: '',
    SetRef: { scope: 'org', orgId: NW, setId: 'custq4', version: null },
  });
  const res = await read(code, asHost(NW));
  const body = bodyOf(res);
  await check('200 with the event and its items in agenda order', () => {
    assert.strictEqual(res.statusCode, 200, res.body);
    assert.strictEqual(body.event.title, 'Q4 Kickoff');
    assert.deepStrictEqual(body.items.map((i) => i.itemId), ['it_00000001', 'it_00000002', 'it_00000003', 'it_00000004', 'it_00000005']);
  });
  await check('every word decrypted, no envelope anywhere', () => {
    assert.strictEqual(body.items[0].title, 'How well do you know our customers?');
    assert.strictEqual(body.items[1].description, 'Coffee');
    assert.ok(!/"ct":/.test(res.body), 'an envelope reached the response');
  });
  // rejects: the PINNED version described with the ACTIVE one's count — "v2 ·
  // 10 questions" beside a v2 of 7, at the very moment the host decides
  // whether to press "Use v3" (final review M1).
  await check('an engagement says its set, its pin, the PINNED version\'s own count, and the version it would play today', () =>
    assert.deepStrictEqual({ setRef: body.items[0].setRef, set: body.items[0].set }, {
      setRef: { scope: 'org', orgId: NW, setId: 'custq4', version: 2 },
      set: { missing: false, name: 'Customer knowledge — Q4', questionCount: 7, latestVersion: 3, pinnedMissing: false },
    }));
  await check('a pin to a version the set no longer has says so, and still names the one it would play', () =>
    assert.deepStrictEqual(body.items[3].set, {
      missing: false, name: 'Customer knowledge — Q4', questionCount: 0, latestVersion: 3, pinnedMissing: true,
    }));
  await check('an unpinned item reads the set\'s own count', () =>
    assert.deepStrictEqual(body.items[4].set, {
      missing: false, name: 'Customer knowledge — Q4', questionCount: 10, latestVersion: 3, pinnedMissing: false,
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

  console.log('\n4. one unreadable item does not sink the builder (final review M4)');
  // An item sealed under ANOTHER organisation's key: this org's key cannot
  // open it, exactly as a corrupted or mis-keyed row would fail in production.
  const other = later.code;
  await seedItem(other, 'it_0000000a', { Type: 'break', Order: 1, Minutes: 10, Title: 'Coffee', Description: 'On the landing.' });
  table.put(await encryptItem(MD, 'item', {
    PK: `EVENT#${other}`, SK: 'ITEM#it_0000000b', State: 'planned', ttl: 1,
    Type: 'poll', Order: 2, Minutes: 12, Title: 'Sealed wrongly', Description: 'Nobody can read this.',
  }));
  const logged = [];
  const realWarn = console.warn; const realError = console.error; const realLog = console.log;
  const capture = (...args) => logged.push(args.map(String).join(' '));
  console.warn = capture; console.error = capture;
  let unreadable;
  try {
    unreadable = await read(other, asHost(NW));
  } finally { console.warn = realWarn; console.error = realError; console.log = realLog; }
  const got = unreadable.statusCode === 200 ? bodyOf(unreadable) : null;
  await check('200: the readable item as it is, the unreadable one in its place with blank words', () => {
    assert.strictEqual(unreadable.statusCode, 200, unreadable.body);
    assert.deepStrictEqual(got.items.map((i) => i.itemId), ['it_0000000a', 'it_0000000b']);
    assert.strictEqual(got.items[0].title, 'Coffee');
    assert.strictEqual(got.items[0].decryptFailed, undefined);
    const bad = got.items[1];
    assert.deepStrictEqual([bad.title, bad.description, bad.decryptFailed], ['', '', true]);
    assert.deepStrictEqual([bad.type, bad.minutes, bad.order, bad.state], ['poll', 12, 2, 'planned']);
  });
  await check('no envelope in the response', () => assert.ok(!/"ct":/.test(unreadable.body), unreadable.body));
  await check('it is logged, naming the row, with neither the ciphertext nor any plaintext', () => {
    const row = table.get(`EVENT#${other}`, 'ITEM#it_0000000b');
    const text = logged.join('\n');
    assert.ok(/ITEM#it_0000000b/.test(text), `nothing named the row: ${text}`);
    assert.ok(!text.includes(row.Title.ct) && !text.includes(row.Description.ct), 'the ciphertext was logged');
    assert.ok(!/Sealed wrongly|Nobody can read this|Coffee|On the landing/.test(text), 'plaintext was logged');
  });

  console.log(`\n${pass} passed, ${fail} failed`);
  suiteFinished();
  process.exit(fail ? 1 : 0);
})();
