/**
 * POST /events — lambda-functions/websocket/events/create-event.js.
 *
 * A Team-plan organisation makes an event: its code reserved in the one code
 * space (Kind "event"), its list row and its METADATA written with the name
 * and place sealed, every row kept until 90 days after the event's day. The
 * route is behind EVENTS_ENABLED (roadmap D6) and the Team plan (decision 1).
 *
 * rejects: the route answering while the switch is off; the switch on for any
 * tier but dev; a Personal space getting an event, or getting a bare 403 where
 * the upgrade body belongs; plaintext names at rest; rows kept on different
 * clocks; a failed create leaving a reserved code or a listed half-event;
 * a full code space answered with anything but a 503.
 */
const suiteFinished = require('./helpers/finish-guard');
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const {
  installEventHarness, asHost, request, seedOrg, startsIn, offerCodes, bodyOf,
} = require('./helpers/event-harness');
const { plainRow } = require('./helpers/tenant-crypto-stub');

const h = installEventHarness();
const { table } = h;
const create = h.load('lambda-functions/websocket/events/create-event.js').handler;
const rules = h.load('lambda-functions/websocket/events/agenda-rules.js');
const { isEnvelope } = h.load('lambda-functions/websocket/tenant-crypto.js');

let pass = 0; let fail = 0;
async function check(label, fn) {
  try { await fn(); console.log(`  ok - ${label}`); pass += 1; }
  catch (e) { console.log(`  FAIL - ${label}\n    ${e.message}`); fail += 1; }
}

const TEAM = 'org_team';
const SOLO = 'org_solo';
const STARTS = startsIn(30);
const DETAILS = {
  title: 'Q4 Kickoff', place: 'Harbour Room, 4th floor', startsAt: STARTS,
  timeZone: 'Europe/London', attendeeReports: 'anonymous',
};
const post = (body, orgId = TEAM, ctx) => create(request({
  method: 'POST', path: '/events', body, requestContext: ctx === undefined ? asHost(orgId) : ctx,
}));
const rowsIn = (pk) => [...table.store.values()].filter((r) => r.PK === pk);
function reset() {
  table.clear();
  seedOrg(table, TEAM, { plan: 'team' });
  seedOrg(table, SOLO, { plan: 'free', type: 'personal' });
}

(async () => {
  console.log('\n1. the switch (roadmap D6)');
  reset();
  await check('off: 404, and no code is reserved', async () => {
    process.env.EVENTS_ENABLED = 'off';
    try {
      const res = await post(DETAILS);
      assert.strictEqual(res.statusCode, 404, res.body);
      assert.strictEqual(bodyOf(res).code, 'events_disabled');
      assert.strictEqual(rowsIn('GAMES').length, 0);
    } finally { process.env.EVENTS_ENABLED = 'on'; }
  });
  await check('the template switches it on for dev and off everywhere else', () => {
    const template = fs.readFileSync(path.join(h.REPO, 'template-clean.yaml'), 'utf8');
    assert.match(template, /IsDev: !Equals \[!Ref Environment, "dev"\]/);
    assert.match(template, /EVENTS_ENABLED: !If \[IsDev, 'on', 'off'\]/);
  });

  console.log('\n2. Team-plan organisations only (decision 1)');
  reset();
  await check('a Personal space gets 402 with the upgrade body, and nothing is written', async () => {
    const res = await post(DETAILS, SOLO);
    assert.strictEqual(res.statusCode, 402, res.body);
    const body = bodyOf(res);
    assert.strictEqual(body.code, 'upgrade_required');
    assert.strictEqual(body.limit.kind, 'events');
    assert.match(body.error, /Events are part of the Team plan/);
    assert.ok(body.upgrade && body.upgrade.planId === 'team');
    assert.ok(body.resolve && body.resolve.role);
    assert.strictEqual(rowsIn('GAMES').length, 0);
  });
  await check('an organisation whose plan cannot be read is not refused', async () => {
    const res = await post(DETAILS, 'org_unlisted');
    assert.strictEqual(res.statusCode, 201, res.body);
  });
  await check('a caller acting for no organisation is refused before anything else', async () => {
    const res = await post(DETAILS, TEAM, asHost(''));
    assert.strictEqual(res.statusCode, 403, res.body);
  });

  console.log('\n3. the rows');
  reset();
  const made = await post(DETAILS);
  const event = bodyOf(made).event;
  await check('201 with the event, its code and an empty agenda', () => {
    assert.strictEqual(made.statusCode, 201, made.body);
    assert.match(event.code, /^\d{4}$/);
    assert.deepStrictEqual({ ...event, code: 'x', createdAt: 'x', updatedAt: 'x' }, {
      code: 'x', title: 'Q4 Kickoff', place: 'Harbour Room, 4th floor', startsAt: STARTS,
      timeZone: 'Europe/London', access: 'open', state: 'SCHEDULED', itemCount: 0,
      engagementCount: 0, breakCount: 0, attendeeReports: 'anonymous', createdAt: 'x', updatedAt: 'x',
      // Events M2 and M3: nobody has joined, nothing is live, the day has not ended.
      attendeeCount: 0, liveItemId: '', endedAt: null,
    });
  });
  const code = event.code;
  const reservation = table.get('GAMES', `GAME#${code}`);
  const listRow = table.get(`ORG#${TEAM}#EVENTS`, `EVENT#${code}`);
  const meta = table.get(`EVENT#${code}`, 'METADATA');
  await check('the code is reserved as an event\'s', () => {
    assert.deepStrictEqual(Object.keys(reservation).sort(), ['Kind', 'PK', 'SK', 'orgId', 'ttl']);
    assert.strictEqual(reservation.Kind, 'event');
  });
  await check('the name and place are sealed on both rows, and open with the org\'s key', () => {
    for (const row of [listRow, meta]) {
      assert.ok(isEnvelope(row.Title) && isEnvelope(row.Place), `${row.PK} holds plaintext`);
      assert.ok(!JSON.stringify(row).includes('Kickoff'), `${row.PK} leaks the name`);
      assert.strictEqual(plainRow(TEAM, row).Title, 'Q4 Kickoff');
      assert.strictEqual(plainRow(TEAM, row).Place, 'Harbour Room, 4th floor');
    }
  });
  await check('METADATA holds the schedule, the counts, the report default and who made it', () => {
    assert.strictEqual(meta.orgId, TEAM);
    assert.strictEqual(meta.StartsAt, STARTS);
    assert.strictEqual(meta.TimeZone, 'Europe/London');
    assert.strictEqual(meta.Access, 'open');
    assert.strictEqual(meta.State, 'SCHEDULED');
    assert.deepStrictEqual([meta.ItemCount, meta.EngagementCount, meta.BreakCount], [0, 0, 0]);
    assert.strictEqual(meta.AttendeeReports, 'anonymous');
    assert.strictEqual(meta.CreatedBy, 'u_host');
  });
  // rejects: session-ttl's creation clock, which would expire an event booked
  // for next month weeks after its day — and rows on different clocks.
  await check('all three rows are kept until 90 days after the event\'s day', () => {
    const expected = rules.eventTtl(STARTS, Math.floor(Date.now() / 1000));
    for (const row of [reservation, listRow, meta]) assert.strictEqual(row.ttl, expected, row.PK);
    assert.ok(expected > Date.now() / 1000 + 119 * 24 * 3600, 'not ~120 days out for an event a month away');
  });

  console.log('\n4. what the dialog may send');
  reset();
  for (const [label, patch, error] of [
    ['no name', { title: '' }, /name/],
    ['an unknown zone', { timeZone: 'Mars/Base' }, /time zone/],
    ['invite-only (PLAN Phase 3)', { access: 'invite' }, /Invite-only events are not available yet/],
    ['a date two years out', { startsAt: startsIn(730) }, /within the next year/],
  ]) {
    await check(`${label}: 400 with the reason, and no code reserved`, async () => {
      const res = await post({ ...DETAILS, ...patch });
      assert.strictEqual(res.statusCode, 400, res.body);
      assert.match(bodyOf(res).error, error);
      assert.strictEqual(rowsIn('GAMES').length, 0);
    });
  }
  await check('a body that is not JSON: 400', async () => {
    const res = await post('{not json');
    assert.strictEqual(res.statusCode, 400, res.body);
  });

  console.log('\n5. a failed create leaves nothing');
  reset();
  await check('METADATA failing to write: 500, the code released and the list row gone', async () => {
    table.inject((c) => c.type === 'put' && c.input.Item && c.input.Item.SK === 'METADATA'
      && String(c.input.Item.PK).startsWith('EVENT#'), () => new Error('injected write failure'), 1);
    const res = await post(DETAILS);
    assert.strictEqual(res.statusCode, 500, res.body);
    assert.strictEqual(rowsIn('GAMES').length, 0, 'the code stayed reserved');
    assert.strictEqual(rowsIn(`ORG#${TEAM}#EVENTS`).length, 0, 'a half-made event is listed');
  });
  await check('eight held codes: the honest 503', async () => {
    const taken = ['2000', '2001', '2002', '2003', '2004', '2005', '2006', '2007'];
    taken.forEach((c) => table.put({ PK: 'GAMES', SK: `GAME#${c}`, ttl: 1 }));
    const restore = offerCodes(...taken);
    try {
      const res = await post(DETAILS);
      assert.strictEqual(res.statusCode, 503, res.body);
    } finally { restore(); }
  });

  console.log(`\n${pass} passed, ${fail} failed`);
  suiteFinished();
  process.exit(fail ? 1 : 0);
})();
