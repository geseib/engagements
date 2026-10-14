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
 *
 * ── GET /site, THE SITE SKIN (docs/design/themes/SPEC.md §5.2) ─────────────
 *
 * The same function answers the one read every page makes before anybody has
 * an identity: which look Engage wears. It is here because this is the public
 * function whose job is "answer a visitor who has no identity yet" — a new
 * function would cost two stack resources, a route costs one.
 *
 * One GetItem on PLATFORM#SETTINGS / SITE_SKIN, no KMS, no Scan, no write. It
 * answers `{ skin, updatedAt }` and nothing else (never who changed it), with
 * a short public cache. No row, or a row naming a skin this code does not know,
 * is Classic (../site-skin.js). A failed read is a 503 the browser ignores —
 * never a guessed "classic", which would flip every visitor back on a hiccup.
 */
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, GetCommand } = require('@aws-sdk/lib-dynamodb');
const { GAMES_RESERVATION_PK } = require('../tenant');
const { json, trace, eventsEnabled } = require('./event-http');
const S = require('./event-store');
const SKIN = require('../site-skin');

const db = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const TABLE = () => process.env.TABLE_NAME;
const NOTHING = () => json(404, { error: 'Nothing is running with that code.' });

/** GET /site — matched on the route key, or a path whose last segment is `site`. */
function isSiteRequest(request) {
  const routeKey = String((request && request.routeKey) || '');
  if (routeKey) return routeKey === 'GET /site';
  return /(^|\/)site\/?$/.test(String((request && request.rawPath) || ''));
}

async function siteSkin() {
  try {
    const res = await db.send(new GetCommand({ TableName: TABLE(), Key: { ...SKIN.SITE_SKIN_KEY } }));
    const out = json(200, SKIN.publicView(res && res.Item));
    out.headers['Cache-Control'] = SKIN.SITE_CACHE_CONTROL;
    return out;
  } catch (error) {
    console.error('❌ site skin read failed:', error && error.name);
    const out = json(503, { error: 'Could not read the site look. Try again.' });
    out.headers['Cache-Control'] = 'no-store';
    return out;
  }
}

exports.handler = async (request) => {
  trace('resolve-code', request);
  if (isSiteRequest(request)) return siteSkin();
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

exports.isSiteRequest = isSiteRequest;
