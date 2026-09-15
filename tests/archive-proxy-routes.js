/**
 * THE BROWSER REACHES THE ARCHIVE ONLY THROUGH ITS OWN TIER.
 *
 * spec §4.6. The archive screen used to fetch archive.seibtribe.us directly, with no
 * credentials, including DELETE. These four routes replace those calls. The tier's sign-in and
 * the `admins` group gate the route; this handler requires Engage staff acting as Engage; and
 * the request leaves signed with the function's role, the only kind the locked archive accepts.
 *
 * // rejects: a relay a host or an org-standing admin can use; an id that can steer the path;
 * //          query parameters the archive was not asked for; a relay that rewrites the
 * //          archive's answer; CORS headers that drop X-Engage-Org.
 */
const h = require('./helpers/archive-harness');
const assert = require('assert');
const path = require('path');

const REPO = path.join(__dirname, '..');
const handler = require(path.join(REPO, 'lambda-functions/admin/archive-items.js')).handler;

const { check, finish } = h.checker();
const call = async (event) => {
  const res = await handler(event);
  let body;
  try { body = JSON.parse(res.body); } catch { body = res.body; }
  return { status: res.statusCode, headers: res.headers, body };
};
const archiveCalls = () => h.fetchLog.filter((c) => c.url.startsWith(process.env.ARCHIVE_SERVICE_URL));

(async () => {
  console.log('1. each route relays to the archive, signed');
  h.reset();
  const kept = h.seedArchiveItem({ contentType: 'questionset', title: 'Team Retro', tags: ['prod'], content: '{"schema":"engage.set/1"}' });
  const doomed = h.seedArchiveItem({ contentType: 'prompt', title: 'Old Prompt', tags: ['dev'], content: '{"schema":"engage.prompt/1"}' });

  let res = await call(h.adminEvent(undefined, { routeKey: 'GET /admin/archive/items', queryStringParameters: { type: 'questionset', sneaky: 'x' } }));
  await check('list returns the archive\'s items, filtered as asked', () => {
    assert.strictEqual(res.status, 200);
    assert.deepStrictEqual(res.body.items.map((i) => i.ArchiveId), [kept]);
  });
  await check('only type, category and search are passed on', () => {
    const sent = new URL(archiveCalls()[0].url);
    assert.deepStrictEqual([...sent.searchParams.keys()], ['type']);
  });
  res = await call(h.adminEvent(undefined, { routeKey: 'GET /admin/archive/items/{archiveId}', pathParameters: { archiveId: kept } }));
  await check('get returns the item and its download link', () => {
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.item.ArchiveId, kept);
    assert.ok(res.body.downloadUrl);
  });
  res = await call(h.adminEvent({ query: 'retro' }, { routeKey: 'POST /admin/archive/search' }));
  await check('search relays the body', () => assert.deepStrictEqual(res.body.items.map((i) => i.Title), ['Team Retro']));
  res = await call(h.adminEvent(undefined, { routeKey: 'DELETE /admin/archive/items/{archiveId}', pathParameters: { archiveId: doomed } }));
  await check('delete removes the item', () => {
    assert.strictEqual(res.status, 200);
    assert.ok(!h.archive.has(doomed) && h.archive.has(kept));
  });
  await check('every call carried a SigV4 signature (the harness refuses the rest)', () => {
    assert.strictEqual(archiveCalls().length, 4);
    assert.ok(archiveCalls().every((c) => String(c.headers.authorization).startsWith('AWS4-HMAC-SHA256')));
  });
  res = await call(h.adminEvent(undefined, { routeKey: 'GET /admin/archive/items/{archiveId}', pathParameters: { archiveId: 'arc-404' } }));
  await check('an archive 404 is relayed as a 404, not rewritten', () => assert.strictEqual(res.status, 404));
  await check('responses carry CORS headers that include X-Engage-Org', () => {
    assert.match(res.headers['Access-Control-Allow-Headers'], /X-Engage-Org/);
  });

  console.log('\n2. refusals, before the archive is touched');
  for (const [who, event] of [
    ['a host', h.hostEvent(undefined, { routeKey: 'GET /admin/archive/items' })],
    ['an Engage admin inside a customer team', h.orgAdminEvent('acme', undefined, { routeKey: 'DELETE /admin/archive/items/{archiveId}', pathParameters: { archiveId: kept } })],
  ]) {
    h.fetchLog.length = 0;
    // eslint-disable-next-line no-await-in-loop
    res = await call(event);
    // eslint-disable-next-line no-await-in-loop
    await check(`${who} gets 403 and the archive is never called`, () => {
      assert.strictEqual(res.status, 403);
      assert.strictEqual(h.fetchLog.length, 0);
    });
  }
  h.fetchLog.length = 0;
  res = await call(h.adminEvent(undefined, { routeKey: 'GET /admin/archive/items/{archiveId}', pathParameters: { archiveId: '../search' } }));
  await check('an id that is not an id is refused before it can become part of a path', () => {
    assert.strictEqual(res.status, 400);
    assert.strictEqual(h.fetchLog.length, 0);
  });
  res = await call(h.adminEvent(undefined, { routeKey: 'PUT /admin/archive/items/{archiveId}', pathParameters: { archiveId: kept } }));
  await check('a route this relay does not serve is a 404', () => assert.strictEqual(res.status, 404));

  console.log('\n3. an unreachable archive is named');
  const realFetch = global.fetch;
  global.fetch = async () => { throw new Error('getaddrinfo ENOTFOUND'); };
  res = await call(h.adminEvent(undefined, { routeKey: 'GET /admin/archive/items' }));
  global.fetch = realFetch;
  await check('it is a 502 that says the archive could not be reached', () => {
    assert.strictEqual(res.status, 502);
    assert.match(res.body.error, /archive could not be reached/);
  });

  console.log('\n4. the routes are closed at both halves: the template and the authorizer');
  const { routesFromTemplate, findRoute, assertScannerWorks } = require('./helpers/template-routes');
  const { requiredGroupsForRoute } = require(path.join(REPO, 'lambda-functions/auth/authorizer.js'));
  const routes = routesFromTemplate();
  await check('the template scanner works', () => assertScannerWorks(routes));
  for (const [method, routePath] of [
    ['GET', '/admin/archive/items'],
    ['GET', '/admin/archive/items/{archiveId}'],
    ['POST', '/admin/archive/search'],
    ['DELETE', '/admin/archive/items/{archiveId}'],
  ]) {
    // eslint-disable-next-line no-await-in-loop
    await check(`${method} ${routePath} carries CognitoAuthorizer and requires admins`, () => {
      const route = findRoute(routes, method, routePath);
      assert.ok(route, 'not declared in template-clean.yaml');
      assert.strictEqual(route.authorizer, 'CognitoAuthorizer');
      assert.deepStrictEqual(requiredGroupsForRoute(method, routePath.slice(1)), ['admins']);
    });
  }
  await check('the dead list-local-archive route is gone', () => {
    assert.strictEqual(findRoute(routes, 'GET', '/admin/list-local-archive'), undefined);
  });

  finish();
})().catch((e) => { console.error('harness error:', e); process.exit(2); });
