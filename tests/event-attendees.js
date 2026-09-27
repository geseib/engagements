/**
 * JOINING AN OPEN EVENT — POST /events/{code}/attendees and
 * GET /events/{code}/me (lambda-functions/websocket/events/attendees.js,
 * served by the agenda function through get-agenda.js; events M2).
 *
 * rejects: a join that returns anything but the joiner's own token and name;
 * a blank or overlong name let in; a join to an unknown, malformed,
 * invite-only, expired or switched-off event answered differently from an
 * unknown code, or leaving anything behind; a join that creates a session,
 * touches a code or records usage; a count that is not the rows — a join
 * that lands with no count, or a count with no row; a room joining at once
 * answered 500; a token opening another event, an expired row or no row; a
 * name on any public route but the holder's own GET /me; the token or the
 * name in a log line; the agenda or the resolver answering for an event while
 * the switch is off.
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
const eventRoute = h.load('lambda-functions/websocket/events/update-event.js').handler;
const attendeeFn = h.load('lambda-functions/websocket/events/get-agenda.js').handler;
const resolve = h.load('lambda-functions/websocket/events/resolve-code.js').handler;
const A = h.load('lambda-functions/websocket/events/attendee-store.js');

let pass = 0; let fail = 0;
async function check(label, fn) {
  try { await fn(); console.log(`  ok - ${label}`); pass += 1; }
  catch (e) { console.log(`  FAIL - ${label}\n    ${e.message}`); fail += 1; }
}

const NW = 'org_nw';
const UNKNOWN = { error: 'No event has that code.' };
const join = (code, body) => attendeeFn(request({
  method: 'POST', path: `/dev/events/${code}/attendees`, pathParameters: { code }, body,
}));
const me = (code, token) => attendeeFn({
  ...request({ method: 'GET', path: `/dev/events/${code}/me`, pathParameters: { code } }),
  ...(token === undefined ? {} : { headers: { authorization: `Bearer ${token}` } }),
});
const agenda = (code) => attendeeFn(request({ method: 'GET', path: `/dev/events/${code}/agenda`, pathParameters: { code } }));
const meta = (code) => table.get(`EVENT#${code}`, 'METADATA');
const attendeeRows = (code) => [...table.store.values()].filter((r) => r.PK === `EVENT#${code}` && String(r.SK).startsWith('ATTENDEE#'));
const snapshot = () => JSON.stringify([...table.store.entries()].sort());
const writesSince = (from) => table.log.slice(from).filter((e) => ['put', 'update', 'delete', 'transactWrite', 'batchWrite'].includes(e.type));

/** Everything printed while `fn` runs, and its result. */
async function logged(fn) {
  const lines = [];
  const real = { log: console.log, warn: console.warn, error: console.error };
  for (const k of Object.keys(real)) console[k] = (...a) => lines.push(a.map(String).join(' '));
  try { return { out: await fn(), text: lines.join('\n') }; } finally { Object.assign(console, real); }
}

async function makeEvent(body = {}) {
  const res = await create(request({
    method: 'POST', path: '/events', requestContext: asHost(NW),
    body: { title: 'Q4 Kickoff', place: 'Harbour Room', startsAt: startsIn(10), timeZone: 'Europe/London', ...body },
  }));
  assert.strictEqual(res.statusCode, 201, res.body);
  const { code } = bodyOf(res).event;
  const added = await items(request({
    method: 'POST', path: `/events/${code}/items`, pathParameters: { code }, requestContext: asHost(NW),
    body: { type: 'break', minutes: 15, description: 'Coffee on the landing.' },
  }));
  assert.strictEqual(added.statusCode, 201, added.body);
  return code;
}

(async () => {
  table.clear();
  seedOrg(table, NW);
  const code = await makeEvent();

  console.log('\n1. joining with a name');
  const logFrom = table.log.length;
  const first = await logged(() => join(code, { name: '  Priya Raman  ' }));
  const res = first.out;
  const body = bodyOf(res);
  await check('201 with the token and the joiner\'s own name, trimmed, and when', () => {
    assert.strictEqual(res.statusCode, 201, res.body);
    assert.match(body.token, /^at_[0-9a-f]{16}\.[A-Za-z0-9_-]{43}$/);
    assert.deepStrictEqual(Object.keys(body.attendee).sort(), ['joinedAt', 'name']);
    assert.strictEqual(body.attendee.name, 'Priya Raman');
    assert.ok(!Number.isNaN(Date.parse(body.attendee.joinedAt)));
  });
  await check('the response names no id, hash, organisation or count', () => {
    for (const leak of ['attendeeId', 'TokenHash', 'tokenHash', NW, 'orgId', 'AttendeeCount', 'count']) {
      assert.ok(!res.body.includes(leak), `the join leaks ${leak}`);
    }
  });
  await check('it wrote exactly the attendee row, one on the count and its list mirror — no session, no code, no usage', () => {
    const writes = writesSince(logFrom);
    assert.deepStrictEqual(writes.map((w) => w.type), ['put', 'update', 'update']);
    assert.match(writes[0].input.Item.SK, /^ATTENDEE#at_[0-9a-f]{16}$/);
    assert.deepStrictEqual(writes[1].input.Key, { PK: `EVENT#${code}`, SK: 'METADATA' });
    assert.strictEqual(writes[1].input.UpdateExpression, 'ADD #n :one');
    assert.deepStrictEqual(writes[2].input.Key, { PK: `ORG#${NW}#EVENTS`, SK: `EVENT#${code}` });
    assert.strictEqual(writes[2].input.UpdateExpression, 'ADD #n :one');
    assert.strictEqual(writes[2].input.ConditionExpression, 'attribute_exists(PK)');
    assert.ok(![...table.store.values()].some((r) => String(r.PK).startsWith('GAME#') || String(r.SK).startsWith('LEDGER#')));
  });
  await check('the row: under the event, the name sealed, the hash and the event\'s ttl', () => {
    const rows = attendeeRows(code);
    assert.strictEqual(rows.length, 1);
    assert.strictEqual(rows[0].TokenHash, A.hashToken(body.token));
    assert.strictEqual(rows[0].ttl, meta(code).ttl);
    assert.ok(!JSON.stringify(rows[0]).includes('Priya'));
  });
  await check('the count is the rows: 1', () => assert.strictEqual(meta(code).AttendeeCount, 1));
  await check('the Events list row carries the same count', () => {
    assert.strictEqual(table.get(`ORG#${NW}#EVENTS`, `EVENT#${code}`).AttendeeCount, 1);
  });
  await check('the host\'s GET /events/{code} and GET /events say "1 joined", a count and no name', async () => {
    const getEvent = h.load('lambda-functions/websocket/events/get-event.js').handler;
    const getEvents = h.load('lambda-functions/websocket/events/get-events.js').handler;
    const one = await getEvent(request({ method: 'GET', path: `/events/${code}`, pathParameters: { code }, requestContext: asHost(NW) }));
    assert.strictEqual(one.statusCode, 200, one.body);
    assert.strictEqual(bodyOf(one).event.attendeeCount, 1);
    assert.ok(!one.body.includes('Priya'), 'the host read leaks an attendee name');
    const list = await getEvents(request({ method: 'GET', path: '/events', requestContext: asHost(NW) }));
    assert.strictEqual(list.statusCode, 200, list.body);
    assert.strictEqual(bodyOf(list).events.find((e) => e.code === code).attendeeCount, 1);
  });
  await check('the log line says a join happened, and neither the token nor the name', () => {
    assert.match(first.text, new RegExp(`join-event: EVENT#${code} \\+1`));
    assert.ok(!first.text.includes(body.token.split('.')[1]), 'the secret was logged');
    assert.ok(!first.text.includes('Priya'), 'the name was logged');
  });
  await check('the same name again is a second attendee: duplicates are allowed, and each join counts', async () => {
    const again = await join(code, { name: 'Priya Raman' });
    assert.strictEqual(again.statusCode, 201, again.body);
    assert.notStrictEqual(bodyOf(again).token, body.token);
    assert.strictEqual(attendeeRows(code).length, 2);
    assert.strictEqual(meta(code).AttendeeCount, 2);
  });
  // rejects: a join that stamps UpdatedAt or an item count, which every host
  // write is conditioned on — a room joining would make the builder say "The
  // event changed while you were saving".
  await check('a join moves nothing a host\'s write is conditioned on', async () => {
    const before = meta(code);
    const r = await join(code, { name: 'Ada' });
    assert.strictEqual(r.statusCode, 201, r.body);
    const after = meta(code);
    for (const k of ['UpdatedAt', 'ItemCount', 'EngagementCount', 'BreakCount', 'StartsAt', 'ttl']) {
      assert.deepStrictEqual(after[k], before[k], k);
    }
    assert.strictEqual(after.AttendeeCount, before.AttendeeCount + 1);
  });

  console.log('\n2. what a join refuses, and that it leaves nothing');
  for (const [label, sent, sentence] of [
    ['a blank name', { name: '   ' }, 'Type your name.'],
    ['no name at all', {}, 'Type your name.'],
    ['81 characters', { name: 'x'.repeat(81) }, 'A name can be 80 characters at most.'],
  ]) {
    await check(`${label}: 400 in plain words, nothing written`, async () => {
      const before = snapshot();
      const r = await join(code, sent);
      assert.strictEqual(r.statusCode, 400, r.body);
      assert.deepStrictEqual(bodyOf(r), { error: sentence });
      assert.strictEqual(snapshot(), before);
    });
  }
  await check('a body that is not JSON: 400', async () => {
    const r = await join(code, '{nope');
    assert.strictEqual(r.statusCode, 400);
  });
  const invite = await makeEvent({ title: 'Board day' });
  table.put({ ...meta(invite), Access: 'invite' });
  const expired = await makeEvent({ title: 'Last year' });
  table.put({ ...meta(expired), ttl: Math.floor(Date.now() / 1000) - 60 });
  for (const [label, target] of [
    ['an unknown code', '9999'], ['a malformed code', '12a4'], ['an invite-only event (passcodes are Phase 3)', invite],
    ['an event past its ttl, still in the table', expired],
  ]) {
    await check(`${label}: the unknown code's 404, nothing written`, async () => {
      const before = snapshot();
      const r = await join(target, { name: 'Priya' });
      assert.strictEqual(r.statusCode, 404, r.body);
      assert.deepStrictEqual(bodyOf(r), UNKNOWN);
      assert.strictEqual(snapshot(), before);
    });
  }
  await check('EVENTS_ENABLED off: the unknown code\'s 404, nothing written', async () => {
    const before = snapshot();
    process.env.EVENTS_ENABLED = 'off';
    try {
      const r = await join(code, { name: 'Priya' });
      assert.strictEqual(r.statusCode, 404, r.body);
      assert.deepStrictEqual(bodyOf(r), UNKNOWN);
    } finally { process.env.EVENTS_ENABLED = 'on'; }
    assert.strictEqual(snapshot(), before);
  });

  console.log('\n3. GET /me: known again by the token');
  await check('the token: 200 with the holder\'s own name and when they joined', async () => {
    const r = await logged(() => me(code, body.token));
    assert.strictEqual(r.out.statusCode, 200, r.out.body);
    assert.deepStrictEqual(bodyOf(r.out), { attendee: body.attendee });
    assert.ok(!r.text.includes(body.token.split('.')[1]) && !r.text.includes('Priya'), 'the token or the name was logged');
  });
  for (const [label, token] of [
    ['no Authorization header', undefined],
    ['a token that is not one', 'hello'],
    ['a well-formed token nobody was given', A.mintToken().token],
    ['this attendee\'s id with another secret', `${body.token.split('.')[0]}.${'A'.repeat(43)}`],
  ]) {
    await check(`${label}: 401 not_joined`, async () => {
      const r = await me(code, token);
      assert.strictEqual(r.statusCode, 401, r.body);
      assert.deepStrictEqual(bodyOf(r), { error: 'You have not joined this event yet.', code: 'not_joined' });
    });
  }
  await check('this token presented to another event: 401', async () => {
    const other = await makeEvent({ title: 'Partner day' });
    assert.strictEqual((await me(other, body.token)).statusCode, 401);
  });
  await check('the attendee row past its ttl: 401, although the row is still there', async () => {
    const [row] = attendeeRows(code).filter((r) => r.TokenHash === A.hashToken(body.token));
    try {
      table.put({ ...row, ttl: Math.floor(Date.now() / 1000) - 1 });
      assert.strictEqual((await me(code, body.token)).statusCode, 401);
    } finally { table.put(row); }
  });
  await check('the event unknown, past its ttl, or switched off: the unknown code\'s 404', async () => {
    assert.deepStrictEqual(bodyOf(await me('9999', body.token)), UNKNOWN);
    assert.deepStrictEqual(bodyOf(await me(expired, body.token)), UNKNOWN);
    process.env.EVENTS_ENABLED = 'off';
    try {
      const r = await me(code, body.token);
      assert.strictEqual(r.statusCode, 404);
    } finally { process.env.EVENTS_ENABLED = 'on'; }
  });

  console.log('\n4. the count is the rows, when things go wrong');
  await check('the event deleted between the read and the count: 404, and the row is taken back', async () => {
    const doomed = await makeEvent({ title: 'Cancelled' });
    const held = table.hold((c) => c.type === 'update' && c.input.UpdateExpression === 'ADD #n :one');
    const pending = join(doomed, { name: 'Priya' });
    await held.reached;
    const deleted = await eventRoute(request({
      method: 'DELETE', path: `/events/${doomed}`, pathParameters: { code: doomed }, requestContext: asHost(NW),
    }));
    assert.strictEqual(deleted.statusCode, 200, deleted.body);
    held.release();
    const r = await pending;
    assert.strictEqual(r.statusCode, 404, r.body);
    assert.deepStrictEqual(attendeeRows(doomed), []);
  });
  await check('a host\'s transaction holding METADATA: the count is retried, and the join lands once', async () => {
    const before = meta(code).AttendeeCount;
    const busy = table.conflictUpdates(2, (c) => c.input.UpdateExpression === 'ADD #n :one');
    const r = await join(code, { name: 'Tomás' });
    assert.strictEqual(r.statusCode, 201, r.body);
    assert.strictEqual(busy.thrown, 2);
    assert.strictEqual(meta(code).AttendeeCount, before + 1);
    assert.strictEqual(attendeeRows(code).length, before + 1);
  });
  await check('busy past the budget: 503 BUSY, the row taken back, the count unchanged', async () => {
    const before = meta(code).AttendeeCount;
    table.conflictUpdates(A.busyBudget.tries, (c) => c.input.UpdateExpression === 'ADD #n :one');
    const r = await join(code, { name: 'Kwame' });
    assert.strictEqual(r.statusCode, 503, r.body);
    assert.deepStrictEqual(bodyOf(r), { error: 'A lot of people are joining at once. Try again in a moment.', code: 'BUSY' });
    assert.strictEqual(meta(code).AttendeeCount, before);
    assert.strictEqual(attendeeRows(code).length, before);
  });
  await check('a throttled attendee write is busy too: retried, then it lands', async () => {
    const before = meta(code).AttendeeCount;
    const t = table.throttle(1, (c) => c.type === 'put');
    const r = await join(code, { name: 'Grace' });
    assert.strictEqual(r.statusCode, 201, r.body);
    assert.strictEqual(t.thrown, 1);
    assert.strictEqual(meta(code).AttendeeCount, before + 1);
  });

  console.log('\n5. no public route names an attendee');
  await check('the agenda and the resolver carry no attendee\'s name and no count', async () => {
    for (const r of [await agenda(code), await resolve(request({ path: `/join/${code}`, pathParameters: { code } }))]) {
      assert.strictEqual(r.statusCode, 200, r.body);
      for (const leak of ['Priya', 'Tomás', 'Grace', 'ttendee', 'joined']) assert.ok(!r.body.includes(leak), `leaks ${leak}`);
    }
  });

  console.log('\n6. the switch, on the other public routes');
  await check('EVENTS_ENABLED off: the agenda is the unknown code\'s 404, and the resolver says nothing is running', async () => {
    process.env.EVENTS_ENABLED = 'off';
    try {
      const a = await agenda(code);
      assert.strictEqual(a.statusCode, 404);
      assert.deepStrictEqual(bodyOf(a), UNKNOWN);
      const j = await resolve(request({ path: `/join/${code}`, pathParameters: { code } }));
      assert.strictEqual(j.statusCode, 404);
      assert.deepStrictEqual(bodyOf(j), { error: 'Nothing is running with that code.' });
    } finally { process.env.EVENTS_ENABLED = 'on'; }
  });

  console.log(`\n${pass} passed, ${fail} failed`);
  suiteFinished();
  process.exit(fail ? 1 : 0);
})();
