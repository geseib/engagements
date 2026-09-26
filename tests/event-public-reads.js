/**
 * THE TWO PUBLIC READS — GET /events/{code}/agenda and GET /join/{code}
 * (lambda-functions/websocket/events/get-agenda.js, resolve-code.js).
 *
 * Anyone with the code may read an open event's agenda before the day
 * (decision 11) — times, titles, kinds, descriptions — and nothing an agenda
 * does not need. The resolver tells the join box whether a code is a session
 * or an event, with the event's title and date and no more.
 *
 * rejects: an agenda that carries a set, an org, a creator or a report
 * setting; a link into an item before the host starts it; times that do not
 * follow the order; an invite-only agenda shown with no passcode; the
 * resolver saying more than kind, access, title and date; a session's code
 * resolved as anything but a session; a lapsed reservation losing a session.
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
const agenda = h.load('lambda-functions/websocket/events/get-agenda.js').handler;
const resolve = h.load('lambda-functions/websocket/events/resolve-code.js').handler;
const { encryptItem } = h.load('lambda-functions/websocket/tenant-crypto.js');

let pass = 0; let fail = 0;
async function check(label, fn) {
  try { await fn(); console.log(`  ok - ${label}`); pass += 1; }
  catch (e) { console.log(`  FAIL - ${label}\n    ${e.message}`); fail += 1; }
}

const NW = 'org_nw';
const read = (code) => agenda(request({ path: `/events/${code}/agenda`, pathParameters: { code } }));
const join = (code) => resolve(request({ path: `/join/${code}`, pathParameters: { code } }));
const add = (code, body) => items(request({
  method: 'POST', path: `/events/${code}/items`, pathParameters: { code }, body, requestContext: asHost(NW),
}));

(async () => {
  table.clear();
  seedOrg(table, NW);
  table.put(await encryptItem(NW, 'set', {
    PK: `ORG#${NW}#SETS`, SK: 'SET#custq4', name: 'Customer knowledge — Q4', engagementType: 'trivia', activeVersion: 2,
  }));
  const startsAt = `${startsIn(20).slice(0, 10)}T09:00`;
  const { code } = bodyOf(await create(request({
    method: 'POST', path: '/events', requestContext: asHost(NW),
    body: { title: 'Q4 Kickoff', place: 'Harbour Room', startsAt, timeZone: 'Europe/London' },
  }))).event;
  await add(code, { type: 'trivia', title: 'How well do you know our customers?', description: 'Ten questions.', minutes: 15, setRef: { scope: 'org', setId: 'custq4' } });
  await add(code, { type: 'break', minutes: 15, description: 'Coffee on the landing.' });
  await add(code, { type: 'trivia', title: 'Warm-up', minutes: 8, setRef: { scope: 'org', setId: 'custq4' }, position: 0 });

  console.log('\n1. the agenda, before the day');
  const res = await read(code);
  const body = bodyOf(res);
  await check('200 for anyone with the code, with the event\'s name, place and times', () => {
    assert.strictEqual(res.statusCode, 200, res.body);
    assert.deepStrictEqual(body.event, {
      code, title: 'Q4 Kickoff', place: 'Harbour Room', startsAt, timeZone: 'Europe/London', endsAt: '9:38', state: 'SCHEDULED',
    });
  });
  await check('items in order, timed from the start, with their words', () => {
    assert.deepStrictEqual(body.items.map((i) => [i.at, i.until, i.type, i.title]), [
      ['9:00', '9:08', 'trivia', 'Warm-up'],
      ['9:08', '9:23', 'trivia', 'How well do you know our customers?'],
      ['9:23', '9:38', 'break', 'Break'],
    ]);
    assert.strictEqual(body.items[2].description, 'Coffee on the landing.');
  });
  // rejects: decision 11 — nothing is reachable before the host starts it.
  await check('every item is planned, and none carries a link', () => {
    for (const item of body.items) {
      assert.strictEqual(item.state, 'planned');
      assert.strictEqual(item.gameId, undefined);
    }
  });
  await check('no set, organisation, creator, report setting or count reaches the page', () => {
    assert.deepStrictEqual(Object.keys(body.items[0]).sort(),
      ['at', 'description', 'itemId', 'minutes', 'state', 'title', 'type', 'until']);
    for (const leak of ['custq4', NW, 'u_host', 'setRef', 'SetRef', 'attendeeReports', 'ItemCount', 'orgId']) {
      assert.ok(!res.body.includes(leak), `the agenda leaks ${leak}`);
    }
  });
  await check('an item the host has started links to its session (the rule M3 relies on)', async () => {
    const started = [...table.store.values()].find((r) => r.PK === `EVENT#${code}` && r.Type === 'break');
    table.put({ ...started, State: 'done', GameId: '8816' });
    const again = bodyOf(await read(code));
    assert.strictEqual(again.items[2].gameId, '8816');
    assert.strictEqual(again.items[0].gameId, undefined);
    table.put(started);
  });
  await check('an invite-only event\'s agenda is not public (PLAN Phase 3)', async () => {
    const meta = table.get(`EVENT#${code}`, 'METADATA');
    table.put({ ...meta, Access: 'invite' });
    try {
      assert.strictEqual((await read(code)).statusCode, 404);
    } finally { table.put(meta); }
  });
  await check('an unknown or malformed code: 404', async () => {
    assert.strictEqual((await read('9999')).statusCode, 404);
    assert.strictEqual((await read('abcd')).statusCode, 404);
  });

  console.log('\n2. what a code opens');
  await check('an event: kind, access, title and date — nothing else', async () => {
    const r = await join(code);
    assert.strictEqual(r.statusCode, 200, r.body);
    assert.deepStrictEqual(bodyOf(r), {
      code, kind: 'event', access: 'open', title: 'Q4 Kickoff', startsAt, timeZone: 'Europe/London',
    });
  });
  table.put({ PK: 'GAMES', SK: 'GAME#4821', orgId: NW, ttl: 1 });
  table.put({ PK: 'GAME#4821', SK: 'METADATA', orgId: NW, Title: 'secret session title' });
  table.put({ PK: 'GAME#1190', SK: 'METADATA', orgId: NW });
  await check('a session: kind only', async () => {
    const r = await join('4821');
    assert.deepStrictEqual(bodyOf(r), { code: '4821', kind: 'session' });
  });
  await check('a session whose reservation has lapsed is still a session', async () =>
    assert.deepStrictEqual(bodyOf(await join('1190')), { code: '1190', kind: 'session' }));
  await check('a code that names nothing: 404; a malformed one: 400', async () => {
    assert.strictEqual((await join('7777')).statusCode, 404);
    assert.strictEqual((await join('77a7')).statusCode, 400);
  });

  console.log(`\n${pass} passed, ${fail} failed`);
  suiteFinished();
  process.exit(fail ? 1 : 0);
})();
