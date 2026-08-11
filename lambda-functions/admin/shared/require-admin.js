/**
 * Who is calling, and are they allowed to be here? DEFENCE IN DEPTH.
 *
 * READ THIS BEFORE ASSUMING THE HANDLERS ARE UNGUARDED. `manage-users.js`
 * carries the comment "Skip authorization for now", which reads like an open
 * door and is not one. `CognitoAuthorizer` is NOT a Cognito JWT authorizer
 * despite the name — it is a custom Lambda authorizer
 * (`template-clean.yaml`: `FunctionArn: !GetAtt AuthorizerFunction.Arn`,
 * payload 2.0, simple responses) and `lambda-functions/auth/authorizer.js`
 * already does the group check:
 *
 *     if (path.startsWith('admin')) return ['admins'];      // :103-105
 *
 * with `path` stripped of its leading slash. So every `/admin/*` route is
 * already gated to the `admins` group, and a disabled user is refused outright
 * (`:141-144`). An earlier reading of this code called it a privilege-escalation
 * hole; that was WRONG, and the correction is recorded here so the next reader
 * does not re-raise it.
 *
 * WHAT THIS MODULE IS FOR, THEN. A second, independent check inside the
 * handler, because the first one lives in a different lambda and is routed by
 * STRING PREFIX. `requiredGroupsForRoute` is one `startsWith('admin')` away
 * from admitting anyone: a route mounted at a path that does not begin with
 * `admin`, or a refactor of that function, silently opens every handler behind
 * it. The handler knowing its own requirement costs one line and does not
 * depend on how it was reached.
 *
 * THE SHAPE, WHICH IS THE PART THAT IS EASY TO GET WRONG AND WAS.
 * A simple-response Lambda authorizer returns `{ isAuthorized, context }`, and
 * that context reaches the handler at
 *
 *     event.requestContext.authorizer.lambda
 *
 * as `{ userId, username, email, groups: 'hosts,admins', status, role }` —
 * groups COMMA-JOINED into a string (`authorizer.js:156-166`). It is NOT
 * `.jwt.claims['cognito:groups']`; this API has no JWT authorizer. Reading the
 * wrong shape here does not fail open, it fails CLOSED — every real admin gets
 * a 403 and the Users tab stops working entirely. The JWT shapes are still
 * accepted below so that a route later moved onto a native JWT authorizer does
 * not silently lock out its admins.
 *
 * Kept pure and separate so the shapes can be tested without invoking a handler.
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
  const authorizer = event?.requestContext?.authorizer || {};

  // THIS API'S ACTUAL SHAPE, and the one that matters: a simple-response
  // Lambda authorizer's `context`, with groups comma-joined into a string.
  const raw = authorizer.lambda?.groups
    // Native JWT authorizer, if a route is ever moved onto one.
    ?? authorizer.jwt?.claims?.['cognito:groups']
    // REST-authorizer shape.
    ?? authorizer.claims?.['cognito:groups'];

  if (!raw) return [];
  if (Array.isArray(raw)) return raw.map(String).map((s) => s.trim()).filter(Boolean);
  if (typeof raw !== 'string') return [];

  // 'admins,hosts' (this API) or '[admins hosts]' or 'admins'
  return raw
    .replace(/^\[/, '')
    .replace(/\]$/, '')
    .split(/[,\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** The signed-in username, for logging who tried what. */
function callerUsername(event) {
  const authorizer = event?.requestContext?.authorizer || {};
  const claims = authorizer.jwt?.claims || authorizer.claims || {};
  return authorizer.lambda?.username
    || claims['cognito:username']
    || claims.username
    || claims.sub
    || 'unknown';
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
