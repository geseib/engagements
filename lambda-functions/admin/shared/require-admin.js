/**
 * Who is calling, and are they allowed to be here?
 *
 * WHY THIS EXISTS. `manage-users.js` carried the comment
 * `// Skip authorization for now - just focus on getting user list working`
 * and never grew the check. Both of its routes sit behind `CognitoAuthorizer`,
 * which authenticates ANY account in the pool — including one still sitting in
 * `pending`, waiting for an admin to approve it. The handler's `validStates`
 * includes `'admins'` and `'delete'`, and it passes the requested group
 * straight to `AdminAddUserToGroupCommand`.
 *
 * So the deployed state was: any registered user could
 *
 *     PUT /admin/users/<their-own-username>/state   {"state": "admins"}
 *
 * and become an administrator, or `POST /admin/users/list` and enumerate every
 * account in the pool. Authentication was doing the work of authorisation.
 *
 * THE DISTINCTION THIS MODULE DRAWS. An authorizer proves you are *someone*.
 * It does not prove you are someone *allowed to do this*. Every admin route
 * needs the second check, and it belongs in the handler — an API-Gateway
 * authorizer cannot express "is in the admins group" without a custom
 * authorizer, and the IAM policy on the function is about what the FUNCTION may
 * do, never about who asked it.
 *
 * Kept pure and separate so it can be tested without invoking a handler,
 * because the shapes below are the part that is easy to get wrong.
 */

/** The group that may administer. One place, so it cannot drift. */
const ADMIN_GROUP = 'admins';

/**
 * The caller's Cognito groups, from the JWT the authorizer already validated.
 *
 * `cognito:groups` arrives in more than one shape and the difference is not
 * cosmetic — reading it wrongly fails OPEN, which is the worst direction:
 *
 *   - HTTP API v2 payload: often a real array         ['admins']
 *   - serialised by API Gateway:                      '[admins hosts]'
 *   - some paths comma-join it:                       'admins,hosts'
 *
 * All three are handled. Anything unrecognised yields [], which denies.
 */
function callerGroups(event) {
  const claims = event?.requestContext?.authorizer?.jwt?.claims
    // REST-authorizer shape, kept because this API has both kinds of route.
    || event?.requestContext?.authorizer?.claims
    || {};

  const raw = claims['cognito:groups'];
  if (!raw) return [];
  if (Array.isArray(raw)) return raw.map(String).map((s) => s.trim()).filter(Boolean);
  if (typeof raw !== 'string') return [];

  // '[admins hosts]' or 'admins,hosts' or 'admins'
  return raw
    .replace(/^\[/, '')
    .replace(/\]$/, '')
    .split(/[,\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** The signed-in username, for logging who tried what. */
function callerUsername(event) {
  const claims = event?.requestContext?.authorizer?.jwt?.claims
    || event?.requestContext?.authorizer?.claims
    || {};
  return claims['cognito:username'] || claims.username || claims.sub || 'unknown';
}

/** Is the caller an administrator? */
function isAdminCaller(event) {
  return callerGroups(event).includes(ADMIN_GROUP);
}

/**
 * Guard for an admin handler. Returns an HTTP response to return immediately,
 * or `null` when the caller may proceed.
 *
 * Denies by default: no claims, no groups, an unreadable shape and an empty
 * event all fail closed.
 */
function requireAdmin(event) {
  if (isAdminCaller(event)) return null;

  const who = callerUsername(event);
  const groups = callerGroups(event);
  console.warn(`🚫 admin route refused for "${who}" (groups: ${groups.join(', ') || 'none'})`);

  return {
    statusCode: 403,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Content-Type': 'application/json',
    },
    // Deliberately says nothing about who they are or what exists — a refusal
    // is not a place to leak the group vocabulary or confirm an account.
    body: JSON.stringify({ error: 'Administrator access required' }),
  };
}

module.exports = { ADMIN_GROUP, callerGroups, callerUsername, isAdminCaller, requireAdmin };
