/**
 * EDITING AND REORDERING AGENDA ITEMS —
 * PUT /events/{code}/items/{itemId} and PUT /events/{code}/items
 * (lambda-functions/websocket/events/items.js).
 *
 * Edit: an item's title, description and length, and for an engagement "Use
 * vN" — the pinned version changes only when the host asks (RATIONALE §c).
 * Reorder: the whole agenda's order, each row's `Order` rewritten, keys never.
 *
 * rejects: an edit written in plaintext; a version the set never had; a
 * version asked of a break; an edit to an item that has started; a reorder
 * built on an agenda that has since changed (a missing, extra or repeated
 * id); a reorder that moves the counts; a reorder that loses a concurrent
 * insert; a foreign member reordering.
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
const items = h.load('lambda-functions/websocket/events/items.js').handler;
const updateEvent = h.load('lambda-functions/websocket/events/update-event.js').handler;
const { encryptItem, isEnvelope } = h.load('lambda-functions/websocket/tenant-crypto.js');

let pass = 0; let fail = 0;
async function check(label, fn) {
  try { await fn(); console.log(`  ok - ${label}`); pass += 1; }
  catch (e) { console.log(`  FAIL - ${label}\n    ${e.message}`); fail += 1; }
}

const NW = 'org_nw';
let code;
const call = (method, itemId, body, ctx = asHost(NW)) => items(request({
  method,
  path: itemId ? `/events/${code}/items/${itemId}` : `/events/${code}/items`,
  pathParameters: itemId ? { code, itemId } : { code },
  body,
  requestContext: ctx,
}));
const meta = () => table.get(`EVENT#${code}`, 'METADATA');
const rowOf = (itemId) => table.get(`EVENT#${code}`, `ITEM#${itemId}`);
const orderNow = () => [...table.store.values()]
  .filter((r) => r.PK === `EVENT#${code}` && String(r.SK).startsWith('ITEM#'))
  .sort((a, b) => a.Order - b.Order)
  .map((r) => r.SK.slice('ITEM#'.length));

(async () => {
  table.clear();
  seedOrg(table, NW);
  seedOrg(table, 'org_md');
  table.put(await encryptItem(NW, 'set', {
    PK: `ORG#${NW}#SETS`, SK: 'SET#custq4', name: 'Customer knowledge — Q4', engagementType: 'trivia',
    activeVersion: 3, versions: [{ version: 2 }, { version: 3 }],
  }));
  code = bodyOf(await create(request({
    method: 'POST', path: '/events', requestContext: asHost(NW),
    body: { title: 'Q4 Kickoff', startsAt: startsIn(20), timeZone: 'Europe/London' },
  }))).event.code;
  const quiz = bodyOf(await call('POST', null, {
    type: 'trivia', title: 'Quiz', minutes: 15, setRef: { scope: 'org', setId: 'custq4', version: 2 },
  })).item.itemId;
  const brk = bodyOf(await call('POST', null, { type: 'break', minutes: 15 })).item.itemId;
  const talk = bodyOf(await call('POST', null, {
    type: 'trivia', title: 'Second quiz', minutes: 12, setRef: { scope: 'org', setId: 'custq4' },
  })).item.itemId;

  console.log('\n1. editing an item');
  await check('title, description and length change; the words stay sealed', async () => {
    const res = await call('PUT', quiz, { title: 'How well do you know our customers?', description: 'Scored.', minutes: 20 });
    assert.strictEqual(res.statusCode, 200, res.body);
    const { item } = bodyOf(res);
    assert.deepStrictEqual([item.title, item.description, item.minutes], ['How well do you know our customers?', 'Scored.', 20]);
    assert.ok(isEnvelope(rowOf(quiz).Title));
    assert.strictEqual(plainRow(NW, rowOf(quiz)).Description, 'Scored.');
    assert.strictEqual(item.setRef.version, 2, 'an edit moved the pinned version');
  });
  await check('a field left out keeps its value', async () => {
    const res = await call('PUT', quiz, { minutes: 18 });
    assert.strictEqual(bodyOf(res).item.title, 'How well do you know our customers?');
  });
  await check('"Use v3" re-pins the set, and only when asked', async () => {
    const res = await call('PUT', quiz, { version: 3 });
    assert.strictEqual(res.statusCode, 200, res.body);
    assert.deepStrictEqual(rowOf(quiz).SetRef, { scope: 'org', orgId: NW, setId: 'custq4', version: 3 });
  });
  for (const [label, itemId, body, status, match] of [
    ['a version the set never had', quiz, { version: 7 }, 400, /version/],
    ['a version for a break', brk, { version: 2 }, 400, /Only an engagement/],
    ['an empty title', quiz, { title: '' }, 400, /title/],
    // Final review M2: the caller is already through the event's door, so an
    // item that is gone says so — not "No event has that code" above an
    // event that is plainly open.
    ['an unknown item', 'it_ffffffff', { title: 'x' }, 404, /^That item is no longer on the agenda\.$/],
  ]) {
    await check(`${label}: ${status}`, async () => {
      const res = await call('PUT', itemId, body);
      assert.strictEqual(res.statusCode, status, res.body);
      assert.match(bodyOf(res).error, match);
    });
  }
  await check('an item a co-host removed: edit, "Use vN" and remove each say it is no longer on the agenda', async () => {
    const gone = bodyOf(await call('POST', null, { type: 'break', minutes: 5 })).item.itemId;
    assert.strictEqual((await call('DELETE', gone)).statusCode, 200);
    for (const [method, body] of [['PUT', { title: 'Mine' }], ['PUT', { version: 3 }], ['DELETE', undefined]]) {
      const res = await call(method, gone, body);
      assert.strictEqual(res.statusCode, 404, res.body);
      assert.deepStrictEqual(bodyOf(res), { error: 'That item is no longer on the agenda.', code: 'item_gone' });
    }
    assert.strictEqual(rowOf(gone), undefined);
  });
  await check('an unknown code still answers the event\'s own 404, before any item is looked for', async () => {
    const res = await items(request({
      method: 'PUT', path: '/events/9999/items/it_ffffffff', pathParameters: { code: '9999', itemId: 'it_ffffffff' },
      body: { title: 'x' }, requestContext: asHost(NW),
    }));
    assert.strictEqual(res.statusCode, 404, res.body);
    assert.strictEqual(bodyOf(res).error, 'No event has that code.');
  });
  await check('an item that has started cannot be edited', async () => {
    table.put({ ...rowOf(talk), State: 'done' });
    const res = await call('PUT', talk, { title: 'Too late' });
    assert.strictEqual(res.statusCode, 409, res.body);
    assert.strictEqual(bodyOf(res).code, 'not_planned');
    table.put({ ...rowOf(talk), State: 'planned' });
  });

  console.log('\n2. reordering the agenda');
  const counts = () => [meta().ItemCount, meta().EngagementCount, meta().BreakCount];
  const before = counts();
  await check('the whole order is written, and nothing but the order', async () => {
    const res = await call('PUT', null, { order: [talk, quiz, brk] });
    assert.strictEqual(res.statusCode, 200, res.body);
    assert.deepStrictEqual(orderNow(), [talk, quiz, brk]);
    assert.deepStrictEqual([rowOf(talk).Order, rowOf(quiz).Order, rowOf(brk).Order], [1, 2, 3]);
    assert.deepStrictEqual(counts(), before, 'a reorder changed the counts');
  });
  await check('the same order again writes nothing', async () => {
    const writes = table.log.length;
    const res = await call('PUT', null, { order: [talk, quiz, brk] });
    assert.strictEqual(res.statusCode, 200, res.body);
    assert.ok(!table.log.slice(writes).some((e) => e.type === 'transactWrite'));
  });
  for (const [label, order] of [
    ['one item missing', [talk, quiz]],
    ['an item named twice', [talk, quiz, quiz]],
    ['an item that is not on this agenda', [talk, quiz, 'it_ffffffff']],
  ]) {
    await check(`${label}: 409 and nothing moved`, async () => {
      const res = await call('PUT', null, { order });
      assert.strictEqual(res.statusCode, 409, res.body);
      assert.strictEqual(bodyOf(res).code, 'agenda_changed');
      assert.deepStrictEqual(orderNow(), [talk, quiz, brk]);
    });
  }
  // rejects: a reorder applied over an insert it never saw, which would leave
  // two rows at one place.
  await check('an insert that lands mid-reorder cancels the reorder', async () => {
    const gate = table.hold((c) => c.type === 'transactWrite');
    const slow = call('PUT', null, { order: [brk, quiz, talk] });
    await gate.reached;
    const insert = await call('POST', null, { type: 'break', minutes: 5, position: 0 });
    gate.release();
    const late = await slow;
    assert.strictEqual(insert.statusCode, 201, insert.body);
    assert.strictEqual(late.statusCode, 409, late.body);
    const orders = orderNow().map((id) => rowOf(id).Order);
    assert.deepStrictEqual(orders, [1, 2, 3, 4], 'two rows share a place');
  });
  await check('another organisation\'s member: 404', async () => {
    const res = await call('PUT', null, { order: orderNow().reverse() }, asHost('org_md'));
    assert.strictEqual(res.statusCode, 404, res.body);
  });

  console.log('\n3. binding notes from the Task 7 review, carried into this task');
  // Note: "condition each row's write on the Order it read, plus a METADATA
  // counts-equality check (as the add does), so a reorder built before a
  // concurrent append cannot commit over it." An APPEND renumbers no existing
  // row, so a reorder that happens to leave every row it touches at the Order
  // it read would otherwise commit right over it (proven against the
  // Order-only guard alone before the METADATA check was added).
  await check('a reorder is refused, not silently missing a concurrent append', async () => {
    const before = orderNow();
    const gate = table.hold((c) => c.type === 'transactWrite');
    const slow = call('PUT', null, { order: [...before].reverse() });
    await gate.reached;
    const appended = await call('POST', null, { type: 'break', minutes: 5 });
    gate.release();
    const late = await slow;
    assert.strictEqual(appended.statusCode, 201, appended.body);
    assert.strictEqual(late.statusCode, 409, late.body);
    assert.strictEqual(bodyOf(late).code, 'agenda_changed');
    assert.deepStrictEqual(orderNow().slice(0, before.length), before, 'the refused reorder moved something');
    assert.strictEqual(orderNow().length, before.length + 1, 'the append did not land');
  });

  // Note: "use an Update of named attributes (Title, Description, Minutes,
  // SetRef version) with attribute_exists(SK) AND State = planned — never Put
  // the row it read, or a concurrent date move's ttl is overwritten." An
  // Update naming only those attributes cannot touch ttl no matter when a
  // date move lands; a Put of the row read before the date move would have
  // reverted it.
  await check('editing an item never reverts a concurrent date move\'s ttl', async () => {
    const before = rowOf(quiz).ttl;
    const gate = table.hold((c) => c.type === 'update' && c.input.Key && c.input.Key.SK === `ITEM#${quiz}`);
    const editing = call('PUT', quiz, { minutes: 33 });
    await gate.reached;
    const moved = await updateEvent(request({
      method: 'PUT', path: `/events/${code}`, pathParameters: { code }, requestContext: asHost(NW),
      body: { startsAt: startsIn(90) },
    }));
    assert.strictEqual(moved.statusCode, 200, moved.body);
    gate.release();
    const edited = await editing;
    assert.strictEqual(edited.statusCode, 200, edited.body);
    assert.strictEqual(bodyOf(edited).item.minutes, 33);
    const after = rowOf(quiz).ttl;
    assert.notStrictEqual(after, before, 'the date move should have changed the ttl');
    assert.strictEqual(after, meta().ttl, 'the edit reverted the ttl the date move just wrote');
  });

  // Note: '"Use vN" reuses pinSet's version check against the current set
  // metadata, resolving an org set in meta.orgId only — never from the
  // request or client-supplied SetRef fields.' A client sending its own
  // orgId or a whole SetRef object must not redirect the pin.
  await check('"Use vN" ignores any set reference the client sends; only meta.orgId is trusted', async () => {
    table.put(await encryptItem('org_md', 'set', {
      PK: 'ORG#org_md#SETS', SK: 'SET#custq4', name: 'A different organisation\'s set', engagementType: 'trivia',
      activeVersion: 9, versions: [{ version: 9 }],
    }));
    const res = await call('PUT', quiz, {
      version: 2, orgId: 'org_md', scope: 'platform', setRef: {
        scope: 'org', orgId: 'org_md', setId: 'custq4', version: 9,
      },
    });
    assert.strictEqual(res.statusCode, 200, res.body);
    assert.deepStrictEqual(rowOf(quiz).SetRef, { scope: 'org', orgId: NW, setId: 'custq4', version: 2 });
  });

  console.log(`\n${pass} passed, ${fail} failed`);
  suiteFinished();
  process.exit(fail ? 1 : 0);
})();
