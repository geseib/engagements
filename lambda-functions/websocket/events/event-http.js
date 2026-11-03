/**
 * THE EVENT ROUTES' SHARED PLUMBING — responses, the request trace, the body,
 * the caller and the EVENTS_ENABLED switch. Nothing here reads the table.
 *
 * The routes' Lambda parameter is called `request`, not `event`, in every file
 * of this folder: here an "event" is the thing a host plans.
 */
const HEADERS = Object.freeze({ 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' });

function json(statusCode, body) {
  return { statusCode, headers: { ...HEADERS }, body: JSON.stringify(body) };
}

/**
 * Every refusal of an event this caller may not touch reads exactly like an
 * event that does not exist. A 403 would confirm that a guessed code names
 * somebody else's event (tenant.js, callerMayDriveSession).
 */
const notFound = () => json(404, { error: 'No event has that code.' });

/** The caller's user id, from the Lambda authorizer or a JWT claim; '' if none. */
function callerSub(request) {
  const auth = (request && request.requestContext && request.requestContext.authorizer) || {};
  const lambda = auth.lambda || {};
  const claims = (auth.jwt && auth.jwt.claims) || auth.claims || {};
  return String(lambda.userId || claims.sub || '').trim();
}

/**
 * The caller's display name, for the event they create (the summary PDF's
 * "Hosted by"): the token's `name`, else given and family names, else the
 * part of the email before the @. '' when the request carries none of them.
 * The Lambda authorizer passes `name` and `email` (auth/authorizer.js); a JWT
 * authorizer passes the claims themselves.
 */
function callerDisplayName(request) {
  const auth = (request && request.requestContext && request.requestContext.authorizer) || {};
  const lambda = auth.lambda || {};
  const claims = (auth.jwt && auth.jwt.claims) || auth.claims || {};
  const clean = (v) => String(v || '').replace(/\s+/g, ' ').trim();
  const name = clean(lambda.name) || clean(claims.name);
  if (name) return name.slice(0, 120);
  const full = clean([claims.given_name, claims.family_name].filter(Boolean).join(' '));
  if (full) return full.slice(0, 120);
  const email = clean(lambda.email) || clean(claims.email);
  return email.includes('@') ? email.split('@')[0].slice(0, 120) : '';
}

function methodOf(request) {
  const http = (request && request.requestContext && request.requestContext.http) || {};
  return String(http.method || '').toUpperCase();
}

/**
 * Which request this was, never what it carried: method, path, code, item and
 * caller. No header (the bearer token is one) and no body (an agenda is org
 * content). tests/lambda-event-not-logged.js holds that rule for every file
 * under lambda-functions/.
 */
function trace(label, request) {
  const http = (request && request.requestContext && request.requestContext.http) || {};
  const params = (request && request.pathParameters) || {};
  console.log(label, JSON.stringify({
    method: http.method || null,
    path: http.path || null,
    code: params.code || null,
    itemId: params.itemId || null,
    sub: callerSub(request) || null,
  }));
}

/** The body as an object; `{}` when there is none; null when it is not a JSON object. */
function readBody(request) {
  const raw = request && request.body;
  if (raw === undefined || raw === null || raw === '') return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch (e) {
    return null;
  }
}

/**
 * THE SWITCH (roadmap D6), on the TEAM_WORKIE_AUTHORING precedent
 * (admin/shared/prompt-access.js): read at call time so a test can set it, and
 * on only for the exact word. template-clean.yaml's Globals set it per tier:
 * on for dev, off for test and prod. admin/orgs/list-my-orgs.js reads the same
 * variable the same way to tell the console whether to show Events;
 * tests/events-switch.js holds the two together.
 */
const eventsEnabled = () => String(process.env.EVENTS_ENABLED || '').trim().toLowerCase() === 'on';

module.exports = { json, notFound, callerSub, callerDisplayName, methodOf, trace, readBody, eventsEnabled };
