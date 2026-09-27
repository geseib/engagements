/**
 * GET /join/{code} — what does this code open? (PLAN Phase 1, resolve-code.js)
 *
 * One read of the code's reservation answers it: `Kind: "event"` is an event
 * (websocket/code-reservation.js), anything else a session. The join screen
 * (roadmap M2, hooks/useJoinCode.js) asks this first and routes on `kind`.
 *
 * PUBLIC, AND IT SAYS NOTHING MORE THAN THE CODE ALREADY OPENS:
 *   event    kind, access, and the title and date the join screen shows —
 *            exactly what the event's own public agenda shows anyway;
 *   session  kind only. Whatever a session shows a player is GET /games/{id}'s
 *            to say, as today.
 * Never an organisation, a creator, an item, a set or a count.
 *
 * WHILE EVENTS_ENABLED IS OFF an event's code answers exactly as a code that
 * names nothing (events M2): a tier with the switch off has no events to join.
 *
 * A session older than its reservation (lapsed, or from before reservations
 * carried `orgId`) is still found by its METADATA row. A code that names
 * nothing is 404; a malformed one 400.
 */
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, GetCommand } = require('@aws-sdk/lib-dynamodb');
const { GAMES_RESERVATION_PK } = require('../tenant');
const { json, trace, eventsEnabled } = require('./event-http');
const S = require('./event-store');

const db = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const TABLE = () => process.env.TABLE_NAME;
const NOTHING = () => json(404, { error: 'Nothing is running with that code.' });

exports.handler = async (request) => {
  trace('resolve-code', request);
  const code = String((request.pathParameters || {}).code || '').trim();
  if (!S.isCode(code)) return json(400, { error: 'A join code is four digits.' });
  try {
    const res = await db.send(new GetCommand({
      TableName: TABLE(),
      Key: { PK: GAMES_RESERVATION_PK, SK: `GAME#${code}` },
    }));
    const reservation = res && res.Item;
    if (reservation && reservation.Kind === 'event') {
      if (!eventsEnabled()) return NOTHING();
      const meta = await S.readMeta(db, TABLE(), code);
      if (!meta || !meta.orgId) return NOTHING();
      const event = await S.decryptEvent(meta.orgId, { Title: meta.Title });
      return json(200, {
        code,
        kind: 'event',
        access: meta.Access || 'open',
        title: event.Title || '',
        startsAt: meta.StartsAt || '',
        timeZone: meta.TimeZone || '',
      });
    }
    if (reservation) return json(200, { code, kind: 'session' });
    const session = await db.send(new GetCommand({
      TableName: TABLE(),
      Key: { PK: `GAME#${code}`, SK: 'METADATA' },
    }));
    if (session && session.Item) return json(200, { code, kind: 'session' });
    return NOTHING();
  } catch (error) {
    console.error('❌ resolve-code failed:', error && error.message);
    return json(500, { error: 'Could not look that code up. Try again.' });
  }
};
