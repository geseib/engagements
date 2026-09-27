/**
 * AN EVENT'S ATTENDEE, JOINING ONE OF ITS ITEMS (events M4) — who a token
 * names, read in the game bundle, where join-game.js lives.
 *
 * An attendee joined the event once, by name, and holds a token
 * (websocket/events/attendee-store.js: `at_<16 hex>.<43 base64url>`, the
 * table keeping only its SHA-256 on EVENT#<code>/ATTENDEE#<id>). When the
 * host starts an engagement, its session carries `EventRef` (the event's
 * code), and the phone joins that session with the token instead of typing a
 * code or a name: "you're in as Priya Raman. No code needed" (p-07).
 *
 * THE SAME CHECK attendee-store.openAttendee makes, restated here because the
 * websocket bundle's file cannot be required from this one (CodeUri is per
 * directory). tests/event-follow.js holds the two to the same answers for the
 * same tokens. A token opens an attendee only when it is well formed, names a
 * row under THIS session's event, of the same organisation as the session,
 * not past its ttl, and hashes to the stored hash (compared in constant time).
 * The name is decrypted with the organisation's key and never logged.
 */
const crypto = require('crypto');
const { GetCommand } = require('@aws-sdk/lib-dynamodb');
const { eventPk } = require('./tenant');
const { decryptItem } = require('./tenant-crypto');

const TOKEN = /^(at_[0-9a-f]{16})\.([A-Za-z0-9_-]{43})$/;
const CODE = /^\d{4}$/;

const hashToken = (token) => crypto.createHash('sha256').update(String(token), 'utf8').digest('base64url');

function tokenMatches(token, storedHash) {
  if (typeof storedHash !== 'string' || !storedHash) return false;
  const actual = Buffer.from(hashToken(token));
  const expected = Buffer.from(storedHash);
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

/**
 * `{ attendeeId, name }` for a token under `eventRef`, or null.
 * @param {{eventRef: string, orgId: string, token: string, nowSeconds?: number}} spec
 */
async function attendeeForToken(db, tableName, { eventRef, orgId, token, nowSeconds = Math.floor(Date.now() / 1000) }) {
  const m = TOKEN.exec(String(token || ''));
  if (!m || !CODE.test(String(eventRef || '')) || !orgId) return null;
  const attendeeId = m[1];
  const res = await db.send(new GetCommand({
    TableName: tableName,
    Key: { PK: eventPk(eventRef), SK: `ATTENDEE#${attendeeId}` },
    ConsistentRead: true,
  }));
  const row = res && res.Item;
  if (!row || row.orgId !== orgId || !(Number(row.ttl) > nowSeconds)) return null;
  if (!tokenMatches(token, row.TokenHash)) return null;
  const plain = await decryptItem(orgId, 'attendee', row);
  const name = typeof plain.AttendeeName === 'string' ? plain.AttendeeName.trim() : '';
  return name ? { attendeeId, name } : null;
}

/**
 * The name an attendee plays under in one session: their own, or — when
 * somebody else in this session already holds it — the same name with a
 * number, "Sam 2", "Sam 3". Tried in order, so the same attendee lands on the
 * same seat every time they come back (join-game.js keeps `AttendeeId` on the
 * seat and reconnects to it).
 */
const MAX_SEATS = 20;
const seatName = (name, n) => (n <= 1 ? name : `${name} ${n}`);

module.exports = { TOKEN, MAX_SEATS, hashToken, tokenMatches, attendeeForToken, seatName };
