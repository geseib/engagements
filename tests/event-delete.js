/**
 * DELETE /events/{code} — lambda-functions/websocket/events/delete-event.js,
 * served by the function behind PUT /events/{code} (update-event.js's
 * handler dispatches on the method; no new Lambda — final review I1).
 *
 * A host can make throwaway events on a dev walk; without a delete each one
 * stays listed as "Draft" and holds its four-digit code for up to ~15 months.
 * The delete removes every row the event owns in ONE transaction — the
 * agenda, METADATA, the organisation's list row and, conditioned on
 * `Kind = event` and the event's own organisation, the code's reservation —
 * so the code goes back only when nothing is left under EVENT#.
 *
 * rejects: a code released while EVENT# rows remain; a half-finished delete;
 * a delete through a foreign member, a non-member or no identity; a delete
 * of an event with an item that has started; an agenda read that stops at
 * the first 1 MB page; a delete that could release a session's code; a
 * session delete releasing an event's; the route answering while the switch
 * is off.
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
const R = h.load('lambda-functions/websocket/code-reservation.js');
const deleteGame = h.load('lambda-functions/admin/delete-game.js').handler;

let pass = 0; let fail = 0;
async function check(label, fn) {
  try { await fn(); console.log(`  ok - ${label}`); pass += 1; }
  catch (e) { console.log(`  FAIL - ${label}\n    ${e.message}`); fail += 1; }
}

const NW = 'org_nw';
const MD = 'org_md';
const del = (code, ctx = asHost(NW)) => eventRoute(request({
  method: 'DELETE', path: `/events/${code}`, pathParameters: { code }, requestContext: ctx,
}));
const add = (code, body) => items(request({
  method: 'POST', path: `/events/${code}/items`, pathParameters: { code }, body, requestContext: asHost(NW),
}));
/** Every row this event owns, anywhere in the table. */
const owned = (code) => [...table.store.values()].filter((r) => r.PK === `EVENT#${code}`
  || (r.PK === `ORG#${NW}#EVENTS` && r.SK === `EVENT#${code}`)
  || (r.PK === 'GAMES' && r.SK === `GAME#${code}`));
const snapshot = () => JSON.stringify([...table.store.entries()].sort());

async function makeEvent({ breaks = 3 } = {}) {
  const res = await create(request({
    method: 'POST', path: '/events', requestContext: asHost(NW),
    body: { title: 'Throwaway', place: 'Room 2', startsAt: startsIn(20), timeZone: 'Europe/London' },
  }));
  assert.strictEqual(res.statusCode, 201, res.body);
  const { code } = bodyOf(res).event;
  for (let i = 0; i < breaks; i += 1) {
    const added = await add(code, { type: 'break', minutes: 5, title: `Break ${i + 1}` });
    assert.strictEqual(added.statusCode, 201, added.body);
  }
  return code;
}

(async () => {
  table.clear();
  seedOrg(table, NW);
  seedOrg(table, MD);

  console.log('\n1. the owner deletes, and nothing of the event is left');
  const code = await makeEvent();
  await check('the event owns its rows before: 3 items, METADATA, the list row and the code', () =>
    assert.strictEqual(owned(code).length, 6));
  const logFrom = table.log.length;
  const res = await del(code);
  await check('200, naming the code', () => {
    assert.strictEqual(res.statusCode, 200, res.body);
    assert.deepStrictEqual(bodyOf(res), { deleted: code });
  });
  await check('every item, METADATA, the list row and the reservation are gone', () =>
    assert.deepStrictEqual(owned(code), []));
  await check('in ONE transaction: all or nothing', () => {
    const writes = table.log.slice(logFrom).filter((e) => ['transactWrite', 'put', 'update', 'delete', 'batchWrite'].includes(e.type));
    assert.deepStrictEqual(writes.map((e) => e.type), ['transactWrite']);
    assert.strictEqual(writes[0].input.TransactItems.length, 6, 'three items, METADATA, the list row and the code');
  });
  await check('the code is drawable again', async () => {
    const again = await R.reserveCode(table.doc, { orgId: MD, ttl: 2000000000, kind: 'event', draw: drawing(code) });
    assert.strictEqual(again, code);
    table.store.delete(table.keyOf('GAMES', `GAME#${code}`));
  });
  await check('a second delete of the same code: 404', async () => {
    assert.strictEqual((await del(code)).statusCode, 404);
  });

  console.log('\n2. one 404 for everyone who may not, and nothing deleted');
  const kept = await makeEvent();
  const unknown = bodyOf(await del('9999'));
  for (const [label, ctx, c] of [
    ['another organisation\'s member', asHost(MD), kept],
    ['a non-member (Engage staff in no organisation)', asHost('', { groups: 'admins,hosts', orgIds: '' }), kept],
    ['a signed-in account in no group', { authorizer: { lambda: { userId: 'u', orgId: NW, orgIds: NW } } }, kept],
    ['no identity at all', { authorizer: { lambda: { orgId: NW, orgIds: NW, groups: 'hosts' } } }, kept],
    ['a malformed code', asHost(NW), '53a7'],
  ]) {
    await check(`${label}: the unknown code's 404, and every row still there`, async () => {
      const before = snapshot();
      const r = await del(c, ctx);
      assert.strictEqual(r.statusCode, 404, r.body);
      assert.deepStrictEqual(bodyOf(r), unknown);
      assert.strictEqual(snapshot(), before);
    });
  }

  console.log('\n3. only while every item is planned');
  await check('an item that has started: 409 with a plain sentence, and nothing deleted', async () => {
    const row = [...table.store.values()].find((r) => r.PK === `EVENT#${kept}` && String(r.SK).startsWith('ITEM#'));
    table.put({ ...row, State: 'live' });
    try {
      const before = snapshot();
      const r = await del(kept);
      assert.strictEqual(r.statusCode, 409, r.body);
      assert.deepStrictEqual(bodyOf(r), {
        error: 'This event has an item that has started, so it cannot be deleted.', code: 'not_planned',
      });
      assert.strictEqual(snapshot(), before);
    } finally { table.put(row); }
  });
  // rejects: the State check made only on the read. An item started between
  // the read and the write must cancel the whole delete, not be deleted live.
  await check('an item that starts while the delete is saving cancels all of it', async () => {
    const row = [...table.store.values()].find((r) => r.PK === `EVENT#${kept}` && String(r.SK).startsWith('ITEM#'));
    const gate = table.hold((c) => c.type === 'transactWrite');
    const slow = del(kept);
    await gate.reached;
    table.put({ ...row, State: 'live' });
    const before = snapshot();
    gate.release();
    const r = await slow;
    try {
      assert.strictEqual(r.statusCode, 409, r.body);
      assert.strictEqual(bodyOf(r).code, 'agenda_changed');
      assert.strictEqual(snapshot(), before);
    } finally { table.put(row); }
  });
  await check('an item added while the delete is saving cancels all of it (no row is left behind a freed code)', async () => {
    const gate = table.hold((c) => c.type === 'transactWrite');
    const slow = del(kept);
    await gate.reached;
    const added = await add(kept, { type: 'break', minutes: 5, title: 'Late' });
    gate.release();
    const r = await slow;
    assert.strictEqual(added.statusCode, 201, added.body);
    assert.strictEqual(r.statusCode, 409, r.body);
    assert.strictEqual(bodyOf(r).code, 'agenda_changed');
    assert.ok(table.get('GAMES', `GAME#${kept}`), 'the code was released while EVENT# rows remain');
    assert.ok(table.get(`EVENT#${kept}`, 'METADATA'));
  });

  console.log('\n4. the code: an event\'s, and this event\'s, or none');
  await check('a reservation that is not an event\'s cancels the whole delete', async () => {
    const held = table.get('GAMES', `GAME#${kept}`);
    table.put({ PK: held.PK, SK: held.SK, orgId: held.orgId, ttl: held.ttl });   // a session's shape
    try {
      const before = snapshot();
      const r = await del(kept);
      assert.strictEqual(r.statusCode, 409, r.body);
      assert.strictEqual(snapshot(), before);
    } finally { table.put(held); }
  });
  await check('another organisation\'s event reservation under the code cancels it too', async () => {
    const held = table.get('GAMES', `GAME#${kept}`);
    table.put({ ...held, orgId: MD });
    try {
      const before = snapshot();
      assert.strictEqual((await del(kept)).statusCode, 409);
      assert.strictEqual(snapshot(), before);
    } finally { table.put(held); }
  });
  await check('a session delete still cannot release an event\'s code', async () => {
    const r = await deleteGame({
      pathParameters: { gameId: kept },
      requestContext: { ...asHost(NW), http: { method: 'POST', path: `/admin/clear-game/${kept}` } },
    });
    assert.strictEqual(r.statusCode, 404, r.body);
    assert.ok(table.get('GAMES', `GAME#${kept}`), 'the event\'s code was released by the session route');
  });
  await check('a reservation DynamoDB has already reaped does not strand the rows: the delete still lands', async () => {
    const held = table.get('GAMES', `GAME#${kept}`);
    table.store.delete(table.keyOf('GAMES', `GAME#${kept}`));
    const r = await del(kept);
    assert.strictEqual(r.statusCode, 200, r.body);
    assert.deepStrictEqual(owned(kept), []);
    assert.ok(held, 'fixture');
  });

  console.log('\n5. the agenda is read to its last page');
  // rejects: a one-call Query past 1 MB — it would delete the first page,
  // then free a code with the rest of the agenda still under EVENT#.
  await check('with the table paging every 2 rows, every item still goes', async () => {
    const big = await makeEvent({ breaks: 7 });
    assert.strictEqual(owned(big).length, 10);
    table.pageSize = 2;
    try {
      const r = await del(big);
      assert.strictEqual(r.statusCode, 200, r.body);
    } finally { table.pageSize = null; }
    assert.deepStrictEqual(owned(big), []);
  });

  console.log('\n6. the switch');
  await check('EVENTS_ENABLED off: 404, and nothing deleted', async () => {
    const off = await makeEvent({ breaks: 1 });
    process.env.EVENTS_ENABLED = 'off';
    try {
      const before = snapshot();
      const r = await del(off);
      assert.strictEqual(r.statusCode, 404, r.body);
      assert.strictEqual(bodyOf(r).code, 'events_disabled');
      assert.strictEqual(snapshot(), before);
    } finally { process.env.EVENTS_ENABLED = 'on'; }
  });

  console.log(`\n${pass} passed, ${fail} failed`);
  suiteFinished();
  process.exit(fail ? 1 : 0);
})();
