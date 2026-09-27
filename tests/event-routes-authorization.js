/**
 * EVERY EVENT ROUTE IS CLOSED THE SAME WAY — the template, the authorizer and
 * the handlers, together (roadmap M1; tenancy rule: "another org's caller
 * gets 404 on every host route").
 *
 * Three halves, like every closed route in this repo (tests/helpers/
 * template-routes.js explains why either alone is a false fix):
 *   - template-clean.yaml attaches CognitoAuthorizer to each host route, and
 *     to neither public one;
 *   - auth/authorizer.js answers hosts|admins for each host route, by template
 *     and by a concrete path — including ids that spell "join", "vote" or
 *     "answer", which the generic rule would otherwise wave through;
 *   - each handler answers another organisation's member, a caller in no
 *     group and a malformed code with the SAME 404 an unknown code gets.
 *
 * rejects: a host route left public in the template; a pending account let in
 * by the generic `includes('join')` rule; a public route that grew an
 * authorizer (an attendee has no account); a foreign member told anything
 * but "no such event".
 */
const suiteFinished = require('./helpers/finish-guard');
const assert = require('assert');
const path = require('path');
const {
  installEventHarness, asHost, request, seedOrg, startsIn, bodyOf,
} = require('./helpers/event-harness');
const { routesFromTemplate, findRoute, assertScannerWorks } = require('./helpers/template-routes');

const h = installEventHarness();
const { table } = h;
const load = (file) => h.load(path.join('lambda-functions/websocket/events', file)).handler;
const create = load('create-event.js');
const HANDLERS = {
  'GET /events/{code}': load('get-event.js'),
  'PUT /events/{code}': load('update-event.js'),
  'DELETE /events/{code}': load('update-event.js'),
  'POST /events/{code}/items': load('items.js'),
  'PUT /events/{code}/items': load('items.js'),
  'PUT /events/{code}/items/{itemId}': load('items.js'),
  'DELETE /events/{code}/items/{itemId}': load('items.js'),
  // Running the day (events M3) rides the items function.
  'POST /events/{code}/run': load('items.js'),
};
const { requiredGroupsForRoute, hasPermission } = h.load('lambda-functions/auth/authorizer.js');

let pass = 0; let fail = 0;
async function check(label, fn) {
  try { await fn(); console.log(`  ok - ${label}`); pass += 1; }
  catch (e) { console.log(`  FAIL - ${label}\n    ${e.message}`); fail += 1; }
}

const HOST_ROUTES = [
  ['POST', '/events'], ['GET', '/events'],
  ['GET', '/events/{code}'], ['PUT', '/events/{code}'], ['DELETE', '/events/{code}'],
  ['POST', '/events/{code}/items'], ['PUT', '/events/{code}/items'],
  ['PUT', '/events/{code}/items/{itemId}'], ['DELETE', '/events/{code}/items/{itemId}'],
  ['POST', '/events/{code}/run'],
];
// The attendee's two routes (events M2) are public for the agenda's reason:
// an attendee has no account, and GET /me's bearer is an attendee token, not
// a Cognito one — an authorizer there would refuse every attendee.
const PUBLIC_ROUTES = [
  ['GET', '/events/{code}/agenda'], ['GET', '/join/{code}'],
  ['POST', '/events/{code}/attendees'], ['GET', '/events/{code}/me'],
];

(async () => {
  console.log('\n1. the template');
  const routes = routesFromTemplate();
  await check('the scanner parses routes and sees Auth', () => assertScannerWorks(routes));
  for (const [method, p] of HOST_ROUTES) {
    await check(`${method} ${p} carries CognitoAuthorizer`, () => {
      const route = findRoute(routes, method, p);
      assert.ok(route, 'the route is not in the template');
      assert.strictEqual(route.authorizer, 'CognitoAuthorizer');
    });
  }
  for (const [method, p] of PUBLIC_ROUTES) {
    await check(`${method} ${p} is public`, () => {
      const route = findRoute(routes, method, p);
      assert.ok(route, 'the route is not in the template');
      assert.strictEqual(route.authorizer, null);
    });
  }

  console.log('\n2. the authorizer demands a host');
  const concrete = ['events', 'events/{code}', 'events/5307', 'events/{code}/items', 'events/5307/items',
    'events/{code}/items/{itemId}', 'events/5307/items/it_0a1b2c3d',
    'events/{code}/run', 'events/5307/run',
    // An id that spells a word the generic public rule matches with includes().
    'events/5307/items/join', 'events/5307/items/vote', 'events/5307/items/answer'];
  for (const p of concrete) {
    for (const method of ['GET', 'POST', 'PUT', 'DELETE']) {
      await check(`${method} ${p} requires hosts or admins, and refuses a pending account`, () => {
        assert.deepStrictEqual(requiredGroupsForRoute(method, p), ['hosts', 'admins']);
        assert.strictEqual(hasPermission(['pending'], requiredGroupsForRoute(method, p)), false);
      });
    }
  }

  console.log('\n3. the handlers answer one 404');
  table.clear();
  seedOrg(table, 'org_nw');
  seedOrg(table, 'org_md');
  const { code } = bodyOf(await create(request({
    method: 'POST', path: '/events', requestContext: asHost('org_nw'),
    body: { title: 'Q4 Kickoff', startsAt: startsIn(20), timeZone: 'Europe/London' },
  }))).event;
  const itemId = 'it_0a1b2c3d';
  const callAs = (key, ctx, c = code) => {
    const [method, route] = key.split(' ');
    return HANDLERS[key](request({
      method,
      path: route.replace('{code}', c).replace('{itemId}', itemId),
      pathParameters: route.includes('{itemId}') ? { code: c, itemId } : { code: c },
      body: { title: 'x', type: 'break', minutes: 5, order: [] },
      requestContext: ctx,
    }));
  };
  for (const key of Object.keys(HANDLERS)) {
    const unknown = bodyOf(await callAs(key, asHost('org_nw'), '9999'));
    for (const [label, ctx, c] of [
      ['another organisation\'s member', asHost('org_md'), code],
      ['a signed-in account in no group', { authorizer: { lambda: { userId: 'u', orgId: 'org_nw', orgIds: 'org_nw' } } }, code],
      ['Engage staff who are not members', asHost('', { groups: 'admins,hosts', orgIds: '' }), code],
      ['a malformed code', asHost('org_nw'), '53a7'],
    ]) {
      await check(`${key} — ${label}: the unknown code's 404`, async () => {
        const res = await callAs(key, ctx, c);
        assert.strictEqual(res.statusCode, 404, res.body);
        assert.deepStrictEqual(bodyOf(res), unknown);
      });
    }
  }
  // rejects: the host door reading METADATA before it asks who is calling
  // (final review M5). A route that ever lost its authorizer would then cost a
  // strongly consistent read per anonymous guess; with the identity checked
  // first it costs nothing.
  for (const key of Object.keys(HANDLERS)) {
    await check(`${key} — no identity at all: the unknown code's 404, and not one table call`, async () => {
      const unknown = bodyOf(await callAs(key, asHost('org_nw'), '9999'));
      const before = table.log.length;
      const res = await callAs(key, { authorizer: { lambda: { orgId: 'org_nw', orgIds: 'org_nw', groups: 'hosts' } } }, code);
      assert.strictEqual(res.statusCode, 404, res.body);
      assert.deepStrictEqual(bodyOf(res), unknown);
      assert.deepStrictEqual(table.log.slice(before).map((e) => e.type), [], 'the door read the table before asking who was calling');
    });
  }
  await check('and nothing any of them sent was written', () => {
    const rows = [...table.store.values()].filter((r) => r.PK === `EVENT#${code}`);
    assert.deepStrictEqual(rows.map((r) => r.SK), ['METADATA']);
    assert.strictEqual(table.get(`EVENT#${code}`, 'METADATA').ItemCount, 0);
  });

  console.log(`\n${pass} passed, ${fail} failed`);
  suiteFinished();
  process.exit(fail ? 1 : 0);
})();
