/**
 * THE ARCHIVE, AS THE BROWSER REACHES IT — list, read, search and delete, through the tier.
 *
 * docs/superpowers/specs/2026-09-14-archive-full-fidelity-design.md §4.6. The archive screen
 * used to fetch archive.seibtribe.us directly, with no credentials, including DELETE. Now the
 * browser calls these routes on its own tier. The route requires the tier's sign-in and the
 * `admins` group (lambda-functions/auth/authorizer.js). This handler requires Engage staff
 * acting as Engage (canManageScope PLATFORM). And the call leaves signed with this function's
 * role (shared/archive-client.js), the only kind of request the locked archive accepts.
 *
 * A RELAY, NOT A SECOND ARCHIVE API. Status and body come back as the archive sent them, so a
 * missing item is a 404 here too and the screen can say so.
 *
 * WHAT THE ARCHIVE REFUSES IS LOGGED, AND SO IS EVERY DELETION. After the lock, a rejected
 * signature or a missing grant reaches the screen as a bare "Forbidden"; the archive's own
 * words are kept here, in CloudWatch. A deletion is the one call that removes a backup, so
 * who deleted which item is written down too.
 */
const tenant = require('./shared/tenant');
const archive = require('./shared/archive-client');
const { callerUserId } = require('./shared/question-set-access');

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Engage-Org',
  'Content-Type': 'application/json',
};
const reply = (statusCode, body) => ({ statusCode, headers, body: typeof body === 'string' ? body : JSON.stringify(body) });

/** Archive ids are UUIDs. Anything else is refused before it can become part of a path. */
const ARCHIVE_ID = /^[A-Za-z0-9-]{1,64}$/;
function archiveIdOf(event) {
  const id = String((event.pathParameters && event.pathParameters.archiveId) || '');
  if (!ARCHIVE_ID.test(id)) throw new Error('That is not an archive item id.');
  return id;
}
function jsonBody(event) {
  try {
    return JSON.parse(event.body || '{}');
  } catch {
    throw new Error('Request body is not valid JSON.');
  }
}
const LIST_FILTERS = ['type', 'category', 'search'];
const listQuery = (event) => Object.fromEntries(
  LIST_FILTERS
    .filter((name) => event.queryStringParameters && event.queryStringParameters[name])
    .map((name) => [name, String(event.queryStringParameters[name])]),
);

const ROUTES = {
  'GET /admin/archive/items': (event) => ['GET', '/archive/items', { query: listQuery(event) }],
  'GET /admin/archive/items/{archiveId}': (event) => ['GET', `/archive/items/${archiveIdOf(event)}`],
  'POST /admin/archive/search': (event) => ['POST', '/archive/search', { body: jsonBody(event) }],
  'DELETE /admin/archive/items/{archiveId}': (event) => ['DELETE', `/archive/items/${archiveIdOf(event)}`],
};

exports.handler = async (event) => {
  const routeKey = String((event && event.requestContext && event.requestContext.routeKey) || '');
  const route = ROUTES[routeKey];
  if (!route) return reply(404, { error: `No archive route ${routeKey || '(none)'}` });
  if (!tenant.canManageScope(event, tenant.PLATFORM)) {
    return reply(403, { error: "The archive backs up Engage's library. Switch to Engage (no organisation selected) to use it." });
  }
  let request;
  try {
    request = route(event);
  } catch (error) {
    return reply(400, { error: error.message });
  }
  try {
    const response = await archive.send(...request);
    const text = await response.text();
    if (response.status >= 300) {
      console.warn(`archive relay ${routeKey} answered ${response.status}: ${text.slice(0, 300)}`);
    }
    if (routeKey === 'DELETE /admin/archive/items/{archiveId}' && response.status >= 200 && response.status < 300) {
      console.log(`archive relay: ${callerUserId(event)} deleted archive item ${archiveIdOf(event)}`);
    }
    return reply(response.status, text || '{}');
  } catch (error) {
    console.error(`archive relay ${routeKey} failed:`, error);
    return reply(502, { error: `The archive could not be reached: ${error.message}` });
  }
};
