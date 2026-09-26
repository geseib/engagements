/**
 * ADDING AND REMOVING AGENDA ITEMS, AND THE CAPS THE SERVER HOLDS —
 * POST /events/{code}/items and DELETE /events/{code}/items/{itemId}
 * (lambda-functions/websocket/events/items.js).
 *
 * The owner's caps (decision 1): 16 items, at most 8 of them engagements;
 * breaks count for nothing (decision 7). The builder disables what cannot be
 * added — and the server refuses it again, in the same words, inside the same
 * transaction as the write, so two hosts adding at once cannot slip past.
 *
 * rejects: a 17th item or a 9th engagement written; a break counted; a
 * refusal worded differently from the builder's menu; two concurrent adds
 * both landing the 8th-and-9th engagement; an insert that leaves two rows at
 * one place; two concurrent APPENDS landing at the same place (an append
 * renumbers no existing row, so nothing but the counters' own equality check
 * stops it); a non-numeric `position` — null, '', false — read as 0 instead
 * of "the end"; a set from another organisation's library pinned to this
 * agenda; a set of the wrong type; an unpinned version; plaintext titles;
 * a presentation or survey item added before its release; removing an item
 * that has started; counts left behind by a removal; an add racing a
 * concurrent date move, on both sides of the race.
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
const update = h.load('lambda-functions/websocket/events/update-event.js').handler;
const rules = h.load('lambda-functions/websocket/events/agenda-rules.js');
const S = h.load('lambda-functions/websocket/events/event-store.js');
const { encryptItem, isEnvelope } = h.load('lambda-functions/websocket/tenant-crypto.js');

let pass = 0; let fail = 0;
async function check(label, fn) {
  try { await fn(); console.log(`  ok - ${label}`); pass += 1; }
  catch (e) { console.log(`  FAIL - ${label}\n    ${e.message}`); fail += 1; }
}

const NW = 'org_nw';
const MD = 'org_md';
let code;
const add = (body, ctx = asHost(NW)) => items(request({
  method: 'POST', path: `/events/${code}/items`, pathParameters: { code }, body, requestContext: ctx,
}));
const remove = (itemId, ctx = asHost(NW)) => items(request({
  method: 'DELETE', path: `/events/${code}/items/${itemId}`, pathParameters: { code, itemId }, requestContext: ctx,
}));
const put = (body, ctx = asHost(NW)) => update(request({
  method: 'PUT', path: `/events/${code}`, pathParameters: { code }, body, requestContext: ctx,
}));
const meta = () => table.get(`EVENT#${code}`, 'METADATA');
const listRow = () => table.get(`ORG#${NW}#EVENTS`, `EVENT#${code}`);
const itemRows = () => [...table.store.values()]
  .filter((r) => r.PK === `EVENT#${code}` && String(r.SK).startsWith('ITEM#'))
  .sort((a, b) => a.Order - b.Order);
const trivia = (title, extra = {}) => ({
  type: 'trivia', title, description: 'Ten questions.', minutes: 15,
  setRef: { scope: 'org', setId: 'custq4' }, ...extra,
});
const poll = (title) => ({ type: 'poll', title, minutes: 10, setRef: { scope: 'platform', setId: 'pulse' } });

async function freshEvent() {
  table.clear();
  seedOrg(table, NW);
  seedOrg(table, MD);
  table.put(await encryptItem(NW, 'set', {
    PK: `ORG#${NW}#SETS`, SK: 'SET#custq4', name: 'Customer knowledge — Q4', engagementType: 'trivia',
    questionCount: 10, activeVersion: 3, versions: [{ version: 1 }, { version: 2 }, { version: 3 }],
  }));
  table.put({ PK: 'SETS', SK: 'SET#pulse', name: 'Pulse', engagementType: 'polls', questionCount: 3, activeVersion: 1, versions: [{ version: 1 }] });
  table.put({ PK: 'SETS', SK: 'SET#legacy', name: 'Legacy', questionCount: 4 });
  table.put({ PK: 'SETS', SK: 'SET#off', name: 'Off', engagementType: 'trivia', active: false, activeVersion: 1 });
  table.put(await encryptItem(MD, 'set', {
    PK: `ORG#${MD}#SETS`, SK: 'SET#theirs', name: 'Their quiz', engagementType: 'trivia', activeVersion: 1,
  }));
  code = bodyOf(await create(request({
    method: 'POST', path: '/events', requestContext: asHost(NW),
    body: { title: 'Q4 Kickoff', startsAt: startsIn(20), timeZone: 'Europe/London' },
  }))).event.code;
}

(async () => {
  console.log('\n1. an engagement, pinned and sealed');
  await freshEvent();
  const first = await add(trivia('How well do you know our customers?'));
  const item = bodyOf(first).item;
  await check('201: planned, first on the agenda, pinned to the set\'s current version', () => {
    assert.strictEqual(first.statusCode, 201, first.body);
    assert.match(item.itemId, /^it_[0-9a-f]{8}$/);
    assert.strictEqual(item.state, 'planned');
    assert.strictEqual(item.order, 1);
    assert.deepStrictEqual(item.setRef, { scope: 'org', orgId: NW, setId: 'custq4', version: 3 });
  });
  await check('the row is sealed, carries the event\'s expiry, and the counts moved on both rows', () => {
    const row = itemRows()[0];
    assert.ok(isEnvelope(row.Title) && isEnvelope(row.Description));
    assert.strictEqual(plainRow(NW, row).Title, 'How well do you know our customers?');
    assert.strictEqual(row.ttl, meta().ttl);
    assert.deepStrictEqual([meta().ItemCount, meta().EngagementCount, meta().BreakCount], [1, 1, 0]);
    assert.strictEqual(listRow().ItemCount, 1);
  });
  await check('an explicit older version is pinned as asked', async () => {
    const res = await add(trivia('Again', { setRef: { scope: 'org', setId: 'custq4', version: 2 } }));
    assert.strictEqual(bodyOf(res).item.setRef.version, 2);
  });
  await check('an older spelling of the type still matches (polls → poll)', async () => {
    const res = await add(poll('Where next?'));
    assert.strictEqual(res.statusCode, 201, res.body);
  });
  await check('a set that has never been versioned pins no version', async () => {
    const res = await add({ type: 'call-and-answer', title: 'Old set', minutes: 10, setRef: { scope: 'platform', setId: 'legacy' } });
    assert.strictEqual(res.statusCode, 201, res.body);
    assert.strictEqual(bodyOf(res).item.setRef.version, null);
  });

  console.log('\n2. what may not be pinned');
  for (const [label, body, error] of [
    ['another organisation\'s set, even named with its orgId', trivia('x', { setRef: { scope: 'org', orgId: MD, setId: 'theirs' } }), /not in a library this event can use/],
    ['a set of another type', { type: 'poll', title: 'x', minutes: 5, setRef: { scope: 'org', setId: 'custq4' } }, /Trivia set, and this item is Poll/],
    ['a set switched off', trivia('x', { setRef: { scope: 'platform', setId: 'off' } }), /switched off/],
    ['a version the set never had', trivia('x', { setRef: { scope: 'org', setId: 'custq4', version: 9 } }), /version/],
    ['no set at all', { type: 'trivia', title: 'x', minutes: 5 }, /Choose a question set/],
    ['a presentation, before M5', { type: 'presentation', title: 'x', minutes: 30 }, /Presentations are coming soon/],
    ['a survey item, before PLAN Phase 6', { type: 'survey', title: 'x', minutes: 5 }, /Survey items are coming soon/],
    ['a kind that does not exist', { type: 'party', title: 'x', minutes: 5 }, /not a kind of agenda item/],
    ['a length of zero', trivia('x', { minutes: 0 }), /whole number of minutes/],
  ]) {
    await check(`${label}: 400, nothing written`, async () => {
      const before = itemRows().length;
      const res = await add(body);
      assert.strictEqual(res.statusCode, 400, res.body);
      assert.match(bodyOf(res).error, error);
      assert.strictEqual(itemRows().length, before);
    });
  }
  await check('the other organisation\'s library was never even read', () =>
    assert.ok(!table.log.some((e) => e.type === 'get' && e.input.Key.PK === `ORG#${MD}#SETS`)));

  console.log('\n3. the caps, in the builder\'s words');
  await freshEvent();
  for (let i = 1; i <= 8; i += 1) await add(trivia(`Quiz ${i}`));
  await check('eight engagements fit', () => assert.strictEqual(meta().EngagementCount, 8));
  await check('a 9th engagement: 409 with the menu\'s sentence, nothing written', async () => {
    const res = await add(poll('One too many'));
    assert.strictEqual(res.statusCode, 409, res.body);
    assert.deepStrictEqual(bodyOf(res), { error: rules.CAP_SENTENCES.engagements, cap: 'engagements' });
    assert.strictEqual(itemRows().length, 8);
  });
  await check('a break still fits, and counts for nothing', async () => {
    const res = await add({ type: 'break', minutes: 15, description: 'Coffee on the landing.' });
    assert.strictEqual(res.statusCode, 201, res.body);
    assert.strictEqual(bodyOf(res).item.title, 'Break');
    assert.deepStrictEqual([meta().ItemCount, meta().EngagementCount, meta().BreakCount], [8, 8, 1]);
    assert.strictEqual(listRow().ItemCount, 8);
  });
  await check('at 16 items (presentations fill the rest in M5) a 17th is refused', async () => {
    table.put({ ...meta(), ItemCount: 16, EngagementCount: 7 });
    const res = await add(trivia('Seventeenth'));
    assert.strictEqual(res.statusCode, 409, res.body);
    assert.strictEqual(bodyOf(res).cap, 'items');
    assert.strictEqual(bodyOf(res).error, rules.CAP_SENTENCES.items);
  });

  console.log('\n4. two hosts at once: exactly one 8th engagement lands');
  await freshEvent();
  for (let i = 1; i <= 7; i += 1) await add(trivia(`Quiz ${i}`));
  // rejects: a cap held by the read alone. Both adds read 7 and pass; only
  // the transaction's `EngagementCount < 8` can stop the second.
  await check('the add that loses the race is refused with the cap\'s sentence', async () => {
    const gate = table.hold((c) => c.type === 'transactWrite');
    const slow = add(trivia('Host A'));
    await gate.reached;
    const fast = await add(poll('Host B'));
    gate.release();
    const late = await slow;
    assert.strictEqual(fast.statusCode, 201, fast.body);
    assert.strictEqual(late.statusCode, 409, late.body);
    assert.strictEqual(bodyOf(late).error, rules.CAP_SENTENCES.engagements);
    assert.strictEqual(meta().EngagementCount, 8);
    assert.strictEqual(itemRows().length, 8);
  });

  console.log('\n5. a position inserts, and the numbers stay whole');
  await freshEvent();
  await add(trivia('A'));
  await add(trivia('C'));
  await check('position 1 puts B between A and C, and renumbers C', async () => {
    const res = await add(trivia('B', { position: 1 }));
    assert.strictEqual(bodyOf(res).item.order, 2);
    assert.deepStrictEqual(itemRows().map((r) => [plainRow(NW, r).Title, r.Order]), [['A', 1], ['B', 2], ['C', 3]]);
  });
  await check('no position means the end', async () => {
    await add({ type: 'break', minutes: 5 });
    assert.strictEqual(itemRows()[3].Type, 'break');
  });

  console.log('\n6. removing');
  const victim = itemRows()[0];
  const victimId = victim.SK.slice('ITEM#'.length);
  await check('a planned engagement goes, and both counts come down', async () => {
    const res = await remove(victimId);
    assert.strictEqual(res.statusCode, 200, res.body);
    assert.strictEqual(table.get(`EVENT#${code}`, victim.SK), undefined);
    assert.deepStrictEqual([meta().ItemCount, meta().EngagementCount, meta().BreakCount], [2, 2, 1]);
    assert.strictEqual(listRow().ItemCount, 2);
  });
  await check('removing a break moves only the break count', async () => {
    const brk = itemRows().find((r) => r.Type === 'break');
    await remove(brk.SK.slice('ITEM#'.length));
    assert.deepStrictEqual([meta().ItemCount, meta().EngagementCount, meta().BreakCount], [2, 2, 0]);
  });
  await check('an item that has started cannot be removed', async () => {
    const started = itemRows()[0];
    table.put({ ...started, State: 'live' });
    const res = await remove(started.SK.slice('ITEM#'.length));
    assert.strictEqual(res.statusCode, 409, res.body);
    assert.strictEqual(bodyOf(res).code, 'not_planned');
    assert.ok(table.get(`EVENT#${code}`, started.SK));
  });
  await check('an unknown item, and another organisation\'s member: 404', async () => {
    assert.strictEqual((await remove('it_ffffffff')).statusCode, 404);
    const own = itemRows()[1].SK.slice('ITEM#'.length);
    assert.strictEqual((await remove(own, asHost(MD))).statusCode, 404);
    assert.ok(table.get(`EVENT#${code}`, `ITEM#${own}`), 'a foreign member removed an item');
  });

  console.log('\n7. an add racing update-event.js\'s date move (carry-forward, Review Focus #3/#5)');
  // Task 6's PUT reads the agenda once and rewrites every row's ttl in one
  // transaction; an item added between that read and that commit would
  // otherwise keep the ttl this route read at ITS start. Both orderings a
  // host and a co-host can land in are proven: whichever transaction's
  // COMMIT comes second must be the one that notices, because a fake that
  // let both land would leave one row on the old clock and every other row
  // on the new one.
  await freshEvent();
  await add(trivia('Existing'));
  await check('the date move commits first: the add loses, so no item ever carries the stale ttl', async () => {
    const before = meta().ttl;
    // The add reads its meta (old ttl) and builds its transaction, but is
    // held just before it commits.
    const gate = table.hold((c) => c.type === 'transactWrite');
    const slowAdd = add(trivia('Late add'));
    await gate.reached;
    // The date move runs to completion first, entirely unheld: it rewrites
    // METADATA's ttl and the existing item's, together, to the new date's
    // clock — this is Task 6's own transaction, untouched by this task.
    const moveRes = await put({ startsAt: startsIn(200) });
    assert.strictEqual(moveRes.statusCode, 200, moveRes.body);
    const after = meta().ttl;
    assert.notStrictEqual(after, before, 'the date move did not actually change the ttl — the race proves nothing');
    assert.strictEqual(itemRows()[0].ttl, after, 'the existing item did not move with the date');
    // Only now does the add's own transaction get to run, against a
    // METADATA row whose ttl no longer matches what it read.
    gate.release();
    const addRes = await slowAdd;
    assert.strictEqual(addRes.statusCode, 409, addRes.body);
    assert.strictEqual(bodyOf(addRes).error, S.AGENDA_CHANGED);
    assert.strictEqual(bodyOf(addRes).code, 'agenda_changed');
    assert.deepStrictEqual([meta().ItemCount, meta().EngagementCount, meta().BreakCount], [1, 1, 0], 'the losing add still wrote something');
    assert.strictEqual(itemRows().length, 1, 'a stale-ttl item was written despite the 409');
    assert.strictEqual(itemRows()[0].ttl, after, 'a row was left on the old clock');
  });

  await freshEvent();
  await add(trivia('Existing'));
  await check('an add commits first: the date move that missed it is the one refused, not silently incomplete', async () => {
    const before = meta().ttl;
    // The date move reads the agenda (one item, 'Existing') and is held just
    // before its own commit — exactly the window Task 6's PUT leaves open.
    const gate = table.hold((c) => c.type === 'transactWrite');
    const slowMove = put({ startsAt: startsIn(200) });
    await gate.reached;
    // An add runs to completion first, entirely unheld: a new item lands
    // with the CURRENT (still old) ttl, and METADATA's counts move.
    const addRes = await add(trivia('Snuck in'));
    assert.strictEqual(addRes.statusCode, 201, addRes.body);
    assert.strictEqual(meta().ItemCount, 2);
    gate.release();
    const moveRes = await slowMove;
    // The date move must not silently finish having missed the new row: its
    // own METADATA condition (ItemCount/EngagementCount/BreakCount, read at
    // its start) no longer holds, so it is the one that cancels.
    assert.strictEqual(moveRes.statusCode, 409, moveRes.body);
    assert.strictEqual(bodyOf(moveRes).code, 'agenda_changed');
    assert.strictEqual(bodyOf(moveRes).error, S.AGENDA_CHANGED);
    // Nothing moved to a mismatched state: every row, old and new alike,
    // still shares the one ttl the failed move never got to change.
    assert.strictEqual(meta().ttl, before, 'METADATA moved anyway');
    const ttls = new Set([meta().ttl, ...itemRows().map((r) => r.ttl)]);
    assert.strictEqual(ttls.size, 1, 'the agenda ended up on two different clocks');
    assert.strictEqual(itemRows().length, 2);
  });

  console.log('\n8. two concurrent appends never land at the same Order (fix round 1)');
  // The brief's own append code (`position = clampPosition(body.position,
  // rows.length)`, `Order: position + 1`) renumbers no existing row for a
  // pure append, so nothing tied the new Order to what else might land at
  // the same moment. Two hosts both appending — or one appending while
  // another inserts mid-list — read the same `rows.length` and both wrote
  // `Order: n+1` before this fix. Reproduced directly against the
  // unprotected code: poll:1, poll:2, break:2 (two rows sharing Order 2).
  await freshEvent();
  await add(poll('First'));
  await check('two hosts appending at once: exactly one 201, one 409, and the orders stay unique', async () => {
    const gate = table.hold((c) => c.type === 'transactWrite');
    const slow = add(poll('Second (slow)'));
    await gate.reached;
    const fast = await add({ type: 'break', minutes: 5, description: 'Stretch.' });
    gate.release();
    const late = await slow;
    const codes = [fast.statusCode, late.statusCode].sort();
    assert.deepStrictEqual(codes, [201, 409], `expected one 201 and one 409, got ${codes}`);
    const loser = fast.statusCode === 409 ? fast : late;
    assert.strictEqual(bodyOf(loser).error, S.AGENDA_CHANGED, 'the loser should read agenda_changed, not a cap sentence');
    assert.strictEqual(bodyOf(loser).code, 'agenda_changed');
    // The loser wrote nothing: exactly two rows exist (the pre-seeded 'First'
    // and whichever of the two appends actually landed), and no two rows
    // share an Order.
    assert.strictEqual(itemRows().length, 2, 'the losing append still wrote a row');
    const orders = itemRows().map((r) => r.Order);
    assert.strictEqual(new Set(orders).size, orders.length, `two rows share one Order: ${orders}`);
  });

  console.log('\n9. an append with no usable position — null, empty string, false — still means "the end"');
  await freshEvent();
  await add(trivia('A'));
  for (const [label, value] of [['null', null], ['an empty string', ''], ['false', false]]) {
    await check(`position: ${label} appends, rather than prepending at 0`, async () => {
      const before = itemRows().length;
      const res = await add(trivia(`After (${label})`, { position: value }));
      assert.strictEqual(res.statusCode, 201, res.body);
      assert.strictEqual(bodyOf(res).item.order, before + 1, 'a non-numeric position was read as 0, not "the end"');
      assert.deepStrictEqual(itemRows().map((r) => r.Order), itemRows().map((_, i) => i + 1), 'a row was left out of order');
    });
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  suiteFinished();
  process.exit(fail ? 1 : 0);
})();
