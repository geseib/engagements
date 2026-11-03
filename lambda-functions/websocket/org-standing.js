/**
 * IS THE ORGANISATION THAT OWNS THIS SESSION SUSPENDED? — for the PARTICIPANT
 * routes, which carry no authorizer (#40).
 *
 * Signed-in callers are refused at the authorizer (auth/standing.js). A player
 * has no account, joins with a four-digit code, and never meets it, so a
 * suspended organisation's room would otherwise keep admitting people. These
 * routes ask here instead, with the session's own `orgId` off METADATA — the
 * same source they already use to pick the encryption key:
 *
 *   join-game / request-handover   via session-gate.js `openSessionOr`
 *   a player's answer (WebSocket)  websocket/message.js
 *   a vote                         submit-vote.js
 *   a survey answer / submit       survey-answers.js
 *
 * Reads, comments and the room's screens are left alone: nothing new is
 * collected through them, and a room that goes blank mid-sentence helps
 * nobody. The host cannot advance a suspended org's session at all (every
 * host route is refused), so the room simply stops.
 *
 * ── A SHORT CACHE, AND WHY IT IS SAFE ──────────────────────────────────────
 *
 * An answer is the hottest write in the product, so the org's status is kept
 * in the container for CACHE_MS. A suspension therefore reaches participants
 * within that window (a warm container's copy goes stale at most this long);
 * a reinstatement likewise. A read that fails is NOT a suspension, for the
 * reason standing.js gives: an availability blip must not stop every room.
 *
 * COPIED IDENTICALLY into lambda-functions/websocket/; tests/suspension-
 * participants.js holds the two copies byte-equal.
 */
const { GetCommand } = require('@aws-sdk/lib-dynamodb');

const CACHE_MS = 30 * 1000;
const cache = new Map();

/** The sentence a participant reads. Plain, and says nothing about why. */
const SESSION_UNAVAILABLE = Object.freeze({
  code: 'SESSION_UNAVAILABLE',
  error: 'Session unavailable',
  message: 'This session is not available right now. Please check with the host.',
});

function clean(v) {
  return typeof v === 'string' ? v.trim() : '';
}

/**
 * @param {object} db  a DynamoDBDocumentClient
 * @param {string} tableName
 * @param {string} orgId  the SESSION's orgId; blank means pre-tenancy, never suspended
 * @param {{now?: number}} [opts]
 * @returns {Promise<boolean>}
 */
async function orgIsSuspended(db, tableName, orgId, { now = Date.now() } = {}) {
  const id = clean(orgId);
  if (!id || !tableName) return false;
  const hit = cache.get(id);
  if (hit && hit.until > now) return hit.suspended;
  let suspended = false;
  try {
    const res = await db.send(new GetCommand({
      TableName: tableName,
      Key: { PK: `ORG#${id}`, SK: 'METADATA' },
      ProjectionExpression: '#s',
      ExpressionAttributeNames: { '#s': 'status' },
    }));
    suspended = clean(res && res.Item && res.Item.status).toLowerCase() === 'suspended';
  } catch (error) {
    console.error(`org-standing: could not read ${id}; treating it as in good standing:`, error.message);
    return false;
  }
  cache.set(id, { suspended, until: now + CACHE_MS });
  return suspended;
}

/** The HTTP refusal a participant route returns for a suspended org's session. */
function sessionUnavailableResponse(headers = { 'Access-Control-Allow-Origin': '*' }) {
  return {
    statusCode: 403,
    headers,
    body: JSON.stringify(SESSION_UNAVAILABLE),
  };
}

/** Tests only. */
function _resetCache() { cache.clear(); }

module.exports = { orgIsSuspended, sessionUnavailableResponse, SESSION_UNAVAILABLE, CACHE_MS, _resetCache };
