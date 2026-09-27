/**
 * JOINING AN OPEN EVENT, AND BEING KNOWN AGAIN (events M2).
 *
 *   POST /events/{code}/attendees   { name }  → 201 { token, attendee }
 *   GET  /events/{code}/me          Authorization: Bearer <token>
 *                                              → 200 { attendee }
 *
 * PUBLIC, BOTH: an attendee has no account. NOT A LAMBDA OF ITS OWN: this is a
 * family file of the function behind GET /events/{code}/agenda — get-agenda.js
 * hands it these two routes, the way update-event.js hands DELETE to
 * delete-event.js. The stack is near CloudFormation's 500-resource limit, and
 * a route is an event on an existing function, not a new one.
 *
 * ── WHAT EITHER ROUTE SAYS ───────────────────────────────────────────────
 * The caller's OWN name and when they joined. Never anybody else's name, never
 * a count, never the attendee id, the hash or the organisation. There is no
 * roster in M2, and no public route returns an attendee's name but this one,
 * to the holder of that attendee's token.
 *
 * ── WHEN AN EVENT TAKES JOINS ────────────────────────────────────────────
 * Switched on (EVENTS_ENABLED), open, and not past its ttl — the ttl is
 * 90 days after the event's day (agenda-rules.eventTtl), so an attendee can
 * join before the day, on it, and after it while the agenda is still there to
 * read. M3's end-event is where "the day is over" becomes a refusal. Anything
 * else — switched off, unknown, malformed, invite-only (passcodes are PLAN
 * Phase 3), expired — is the one 404 an unknown code gets: a different answer
 * would say which codes are events.
 *
 * ── JOINING NEVER STARTS ANYTHING, AND IS NOT BILLED ─────────────────────
 * A join writes exactly two things: the attendee row and one on the event's
 * count. No session is created or started, and no usage is recorded — roadmap
 * decision 1 bills the EVENT once, and that meter is M3's.
 *
 * ── THE COUNT IS THE ROWS ────────────────────────────────────────────────
 * `AttendeeCount` counts attendee rows. The row is written first, then the
 * count; if the count cannot be written the row is taken back and the join is
 * refused (404 when the event was deleted in between, 503 BUSY after the
 * retry budget). A "Not you?" that joins again makes a second row, so it
 * counts again: the host's figure is "N joined", never "N people".
 *
 * Logs name the route and the code, never the token and never the name
 * (tests/event-attendees.js reads every line).
 */
const rules = require('./agenda-rules');
const { json, notFound, readBody, trace, eventsEnabled } = require('./event-http');
const S = require('./event-store');
const A = require('./attendee-store');

const NOT_JOINED = 'You have not joined this event yet.';
const BUSY = 'A lot of people are joining at once. Try again in a moment.';
const busyResponse = () => json(503, { error: BUSY, code: 'BUSY' });

/** The event's METADATA when an attendee may join it or be known in it, else null. */
async function openForAttendees(db, tableName, code, nowSeconds) {
  if (!eventsEnabled()) return null;
  const meta = await S.readMeta(db, tableName, code);
  if (!meta || !meta.orgId) return null;
  if ((meta.Access || 'open') !== 'open') return null;
  if (A.isExpired(meta, nowSeconds)) return null;
  return meta;
}

async function joinEvent(db, tableName, request) {
  trace('join-event', request);
  const code = String((request.pathParameters || {}).code || '');
  const nowSeconds = Math.floor(Date.now() / 1000);
  try {
    const meta = await openForAttendees(db, tableName, code, nowSeconds);
    if (!meta) return notFound();
    // The day is over (events M3, run.js end-event): the agenda stays
    // readable, and somebody who joined is still known, but nobody new joins.
    if (meta.State === 'ENDED') return json(409, { error: 'This event has ended.', code: 'event_ended' });
    const body = readBody(request);
    if (!body) return json(400, { error: 'The request body is not valid JSON.' });
    const checked = rules.checkAttendeeName(body.name);
    if (checked.error) return json(400, { error: checked.error });

    const joined = await A.putAttendee(db, tableName, { code, meta, name: checked.value });
    try {
      await A.countJoin(db, tableName, code);
    } catch (error) {
      try {
        await A.removeAttendee(db, tableName, code, joined.attendeeId);
      } catch (undoError) {
        console.error(`❌ join-event: could not take back a join to EVENT#${code}:`, undoError && undoError.message);
      }
      if (error && error.name === 'ConditionalCheckFailedException') return notFound();
      if (A.isBusy(error)) return busyResponse();
      throw error;
    }
    await A.mirrorJoinOnList(db, tableName, code, meta.orgId);
    console.log(`🎟️ join-event: EVENT#${code} +1`);
    return json(201, { token: joined.token, attendee: A.projectAttendee(joined.row) });
  } catch (error) {
    if (A.isBusy(error)) return busyResponse();
    console.error('❌ join-event failed:', error && error.message);
    return json(500, { error: 'Could not join the event. Try again.' });
  }
}

async function whoAmI(db, tableName, request) {
  trace('who-am-i', request);
  const code = String((request.pathParameters || {}).code || '');
  const nowSeconds = Math.floor(Date.now() / 1000);
  try {
    const meta = await openForAttendees(db, tableName, code, nowSeconds);
    if (!meta) return notFound();
    const row = await A.openAttendee(db, tableName, { code, meta, token: A.bearerOf(request), nowSeconds });
    if (!row) return json(401, { error: NOT_JOINED, code: 'not_joined' });
    return json(200, { attendee: A.projectAttendee(row) });
  } catch (error) {
    console.error('❌ who-am-i failed:', error && error.message);
    return json(500, { error: 'Could not check who you are. Try again.' });
  }
}

module.exports = { joinEvent, whoAmI, NOT_JOINED, BUSY };
