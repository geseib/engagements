/**
 * ONE CODE SPACE, ONE LOCK, FOR SESSIONS AND EVENTS —
 * lambda-functions/websocket/code-reservation.js.
 *
 * An event reserves its four-digit code in the same `GAMES` registry, under
 * the same `attribute_not_exists(PK)` put, as a session (PLAN Phase 1,
 * "Code reservation"). So the two can never hold the same number, and a code
 * is never drawn while rows of an older session or event remain under it
 * (bug sweep 2026-09-26 Task 2's rule, extended to EVENT#).
 *
 * rejects: an event reservation without `Kind: "event"`; a session
 * reservation that grows a field; a claim over a held code; a code drawn while
 * its GAME# or EVENT# partition still has rows; an unbounded draw; a session
 * create handed an event's code, reserved or lapsed; the session delete route
 * releasing an event's code.
 */
const suiteFinished = require('./helpers/finish-guard');
const assert = require('assert');
const {
  installEventHarness, asHost, seedOrg, drawing, offerCodes, bodyOf,
} = require('./helpers/event-harness');

const h = installEventHarness();
const { table } = h;
const R = h.load('lambda-functions/websocket/code-reservation.js');
const createGame = h.load('lambda-functions/websocket/create-game.js').handler;
const deleteGame = h.load('lambda-functions/admin/delete-game.js').handler;
const clearAllGames = h.load('lambda-functions/admin/clear-all-games.js').handler;

let pass = 0; let fail = 0;
async function check(label, fn) {
  try { await fn(); console.log(`  ok - ${label}`); pass += 1; }
  catch (e) { console.log(`  FAIL - ${label}\n    ${e.message}`); fail += 1; }
}
const reservation = (code) => table.get('GAMES', `GAME#${code}`);
const newSession = () => createGame({
  body: JSON.stringify({ eventTitle: 'Room', gameType: 'trivia' }),
  requestContext: asHost('org_nw'),
});

(async () => {
  console.log('\n1. the lock');
  table.clear();
  await check('an event reservation is {orgId, Kind: "event", ttl} and nothing else', async () => {
    const code = await R.reserveCode(table.doc, { orgId: 'org_nw', ttl: 1900000000, kind: 'event', draw: drawing('5307') });
    assert.strictEqual(code, '5307');
    assert.deepStrictEqual(reservation('5307'),
      { PK: 'GAMES', SK: 'GAME#5307', orgId: 'org_nw', Kind: 'event', ttl: 1900000000 });
  });
  // rejects: Kind leaking onto sessions — tenant-session-scoping.js holds the
  // session row to exactly {orgId, ttl}.
  await check('a session reservation stays {orgId, ttl}', async () => {
    await R.claimCode(table.doc, { code: '6120', orgId: 'org_nw', ttl: 1800000000, kind: 'session' });
    assert.deepStrictEqual(Object.keys(reservation('6120')).sort(), ['PK', 'SK', 'orgId', 'ttl']);
  });
  await check('claiming a held code throws ConditionalCheckFailedException and changes nothing', async () => {
    await assert.rejects(
      () => R.claimCode(table.doc, { code: '5307', orgId: 'org_md', ttl: 1, kind: 'session' }),
      (e) => e.name === 'ConditionalCheckFailedException');
    assert.strictEqual(reservation('5307').orgId, 'org_nw');
  });
  await check('an unknown kind or a missing ttl throws before anything is written', async () => {
    await assert.rejects(() => R.claimCode(table.doc, { code: '7001', ttl: 1, kind: 'party' }), /unknown kind/);
    await assert.rejects(() => R.claimCode(table.doc, { code: '7001', kind: 'event' }), /ttl/);
    assert.strictEqual(reservation('7001'), undefined);
  });

  console.log('\n2. a code is not drawn while its old rows remain');
  table.clear();
  table.put({ PK: 'GAME#4821', SK: 'PLAYER#Ada#SCORE', ttl: 1 });   // a lapsed session's 30-day row
  table.put({ PK: 'EVENT#3001', SK: 'ITEM#it_0000abcd', ttl: 1 });  // an expired event's agenda row
  await check('stale GAME# and EVENT# rows are skipped; the third draw is taken', async () => {
    const code = await R.reserveCode(table.doc, { orgId: 'org_nw', ttl: 1, kind: 'event', draw: drawing('4821', '3001', '7777') });
    assert.strictEqual(code, '7777');
    assert.strictEqual(reservation('4821'), undefined);
    assert.strictEqual(reservation('3001'), undefined);
    assert.ok(table.get('GAME#4821', 'PLAYER#Ada#SCORE') && table.get('EVENT#3001', 'ITEM#it_0000abcd'),
      'the stale rows were touched');
  });
  await check('each partition check is strongly consistent and reads one row', () => {
    const checks = table.log.filter((e) => e.type === 'query'
      && /^(GAME|EVENT)#(4821|3001|7777)$/.test(e.input.ExpressionAttributeValues[':pk']));
    assert.ok(checks.length >= 3, `only ${checks.length} partition checks were made`);
    for (const q of checks) {
      assert.strictEqual(q.input.ConsistentRead, true);
      assert.strictEqual(q.input.Limit, 1);
    }
  });

  console.log('\n3. eight collisions, then CodeSpaceExhausted');
  table.clear();
  const taken = ['1000', '1001', '1002', '1003', '1004', '1005', '1006', '1007'];
  taken.forEach((c) => table.put({ PK: 'GAMES', SK: `GAME#${c}`, ttl: 1 }));
  await check('eight held codes exhaust the draw', async () => {
    await assert.rejects(
      () => R.reserveCode(table.doc, { orgId: 'org_nw', ttl: 1, kind: 'event', draw: drawing(...taken) }),
      (e) => e instanceof R.CodeSpaceExhausted && e.attempts === 8);
  });
  await check('the session create still answers the honest 503', async () => {
    const restore = offerCodes(...taken);
    try {
      seedOrg(table, 'org_nw');
      const res = await newSession();
      assert.strictEqual(res.statusCode, 503, res.body);
      assert.match(bodyOf(res).error, /Could not allocate a session code/);
    } finally { restore(); }
  });

  console.log('\n4. sessions and events share one space');
  table.clear();
  seedOrg(table, 'org_nw');
  await R.reserveCode(table.doc, { orgId: 'org_nw', ttl: 2000000000, kind: 'event', draw: drawing('5307') });
  table.put({ PK: 'EVENT#5307', SK: 'METADATA', orgId: 'org_nw' });
  await check('a session create never takes a reserved event code', async () => {
    const restore = offerCodes(5307, 6120);
    try {
      const res = await newSession();
      assert.strictEqual(res.statusCode, 201, res.body);
      assert.strictEqual(bodyOf(res).gameId, '6120');
      assert.strictEqual(reservation('5307').Kind, 'event');
    } finally { restore(); }
  });
  // rejects: trusting the reservation alone. DynamoDB deletes it lazily, and
  // its absence must not hand the event's number to a session.
  await check('nor an event code whose reservation has lapsed while its rows remain', async () => {
    table.store.delete(table.keyOf('GAMES', 'GAME#5307'));
    const restore = offerCodes(5307, 7001);
    try {
      const res = await newSession();
      assert.strictEqual(res.statusCode, 201, res.body);
      assert.strictEqual(bodyOf(res).gameId, '7001');
      assert.strictEqual(table.get('GAME#5307', 'METADATA'), undefined, 'a session was written under the event code');
    } finally { restore(); }
  });

  console.log('\n5. the session routes leave an event\'s code alone');
  table.clear();
  await R.reserveCode(table.doc, { orgId: 'org_nw', ttl: 2000000000, kind: 'event', draw: drawing('5307') });
  await check('POST /admin/clear-game with an event\'s code answers 404 and keeps the reservation', async () => {
    const res = await deleteGame({
      pathParameters: { gameId: '5307' },
      requestContext: { ...asHost('org_nw'), http: { method: 'POST', path: '/admin/clear-game/5307' } },
    });
    assert.strictEqual(res.statusCode, 404, res.body);
    assert.ok(reservation('5307'), 'the event\'s code was released');
  });

  // rejects: staff "Delete all sessions" releasing an event's code (final
  // review M7). A lapsed session's ORG#A#GAMES/GAME#<code> index row can
  // outlive its GAME# partition and reservation by DynamoDB's lazy ~48h; org
  // B can draw that code for an EVENT in the gap. Clearing org A's sessions
  // then batch-deleted B's event reservation — BatchWriteItem carries no
  // condition — and B's /join and every date move broke.
  await check('"Delete all sessions" for one org leaves another org\'s event reservation in place', async () => {
    table.clear();
    const EVENT_CODE = '5307';
    const OWN_CODE = '6120';
    table.put({ PK: 'ORG#org_a#GAMES', SK: `GAME#${EVENT_CODE}`, orgId: 'org_a', ttl: 1 });   // lapsed, not yet reaped
    table.put({ PK: 'GAMES', SK: `GAME#${EVENT_CODE}`, orgId: 'org_b', Kind: 'event', ttl: 2000000000 });
    table.put({ PK: `EVENT#${EVENT_CODE}`, SK: 'METADATA', orgId: 'org_b' });
    // And org A's own live session, which must still go — so the test cannot
    // pass by clearing nothing.
    table.put({ PK: 'ORG#org_a#GAMES', SK: `GAME#${OWN_CODE}`, orgId: 'org_a', ttl: 2000000000 });
    table.put({ PK: 'GAMES', SK: `GAME#${OWN_CODE}`, orgId: 'org_a', ttl: 2000000000 });
    table.put({ PK: `GAME#${OWN_CODE}`, SK: 'METADATA', orgId: 'org_a' });
    const res = await clearAllGames({
      requestContext: { ...asHost('org_a', { groups: 'admins', orgRole: 'owner' }), http: { method: 'DELETE', path: '/admin/clear-all-games' } },
    });
    assert.strictEqual(res.statusCode, 200, res.body);
    assert.deepStrictEqual(reservation(EVENT_CODE), { PK: 'GAMES', SK: `GAME#${EVENT_CODE}`, orgId: 'org_b', Kind: 'event', ttl: 2000000000 },
      'the event\'s reservation was released');
    assert.ok(table.get(`EVENT#${EVENT_CODE}`, 'METADATA'), 'the event itself was touched');
    assert.strictEqual(table.get('ORG#org_a#GAMES', `GAME#${EVENT_CODE}`), undefined, 'org A\'s stale index row stayed');
    assert.strictEqual(reservation(OWN_CODE), undefined, 'org A\'s own session code was not released');
    assert.strictEqual(table.get(`GAME#${OWN_CODE}`, 'METADATA'), undefined);
    assert.strictEqual(table.get('ORG#org_a#GAMES', `GAME#${OWN_CODE}`), undefined);
  });

  console.log('\n6. the final delete refuses an event\'s code too, not only the read');
  // rejects: a bug that moves or drops the early read-and-refuse check above,
  // or a race that slips Kind onto the row between that read and this route's
  // own final delete — either way the write itself must still refuse, not
  // rely on the read alone (Task 3 review; delete-game.js's last DeleteCommand
  // now carries `ConditionExpression: 'attribute_not_exists(Kind)'`).
  table.clear();
  seedOrg(table, 'org_nw');
  await check('a code that becomes an event\'s mid-delete is not released', async () => {
    const created = await newSession();
    assert.strictEqual(created.statusCode, 201, created.body);
    const gameId = bodyOf(created).gameId;
    const gate = table.hold((c) => c.type === 'delete'
      && c.input.Key && c.input.Key.PK === 'GAMES' && c.input.Key.SK === `GAME#${gameId}`);
    const slow = deleteGame({
      pathParameters: { gameId },
      requestContext: { ...asHost('org_nw'), http: { method: 'DELETE', path: `/admin/games/${gameId}` } },
    });
    await gate.reached;
    // The race: this handler's own early read already ran and saw no Kind —
    // that is why it got this far — but something turns the code into an
    // event's before the reservation delete it decided on actually lands.
    table.put({ ...reservation(gameId), Kind: 'event' });
    gate.release();
    const res = await slow;
    assert.strictEqual(res.statusCode, 500, res.body);
    assert.ok(reservation(gameId), 'the reservation was deleted despite carrying Kind');
    assert.strictEqual(reservation(gameId).Kind, 'event');
  });

  console.log(`\n${pass} passed, ${fail} failed`);
  suiteFinished();
  process.exit(fail ? 1 : 0);
})();
