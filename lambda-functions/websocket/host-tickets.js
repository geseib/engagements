/**
 * WHAT A HOST TICKET IS — the one definition, shared by the side that mints it
 * and the side that spends it.
 *
 * TWO IDENTICAL COPIES: `lambda-functions/game/host-tickets.js` (minted by
 * `mint-host-ticket.js`, behind the Cognito authorizer) and
 * `lambda-functions/websocket/host-tickets.js` (spent by `connect.js`). The two
 * functions ship in different bundles, and `tests/websocket-host-ticket.js`
 * fails if the copies differ — the same arrangement as `tenant.js`.
 *
 * ── WHY THE SOCKET NEEDS ONE ───────────────────────────────────────────────
 *
 * The WebSocket `$connect` route has no authorizer, and every host-only frame
 * (`surveyProgress`, `playerJoined`, vote progress…) goes to the rows stored
 * with `ConnectionType: 'HOST'`. That type used to come from `?isHost=true`
 * alone, so anyone with the four-digit code could read the host's feed. A
 * socket is now HOST only if it presents a ticket the server minted, for this
 * game, to someone `callerMayDriveSession` lets drive it.
 *
 * ── WHY A STORED NONCE, NOT A SIGNED TOKEN ─────────────────────────────────
 *
 *   - no secret to provision, rotate or leak per tier — the table IS the proof;
 *   - SINGLE USE: spending is one conditional Delete, so a ticket cannot be
 *     replayed, and one that leaks into a URL log is spent before anyone reads
 *     it;
 *   - SCOPED BY KEY: it lives under `GAME#<id>`, so another game's ticket is
 *     simply not found when this game looks for it.
 *
 * The host page asks for a fresh ticket before every connect, reconnects
 * included, which is why the window is short.
 */

const crypto = require('crypto');
const { PutCommand, DeleteCommand } = require('@aws-sdk/lib-dynamodb');

const HOST_TICKET_SK_PREFIX = 'HOSTTICKET#';

/**
 * Long enough for a phone on a poor connection to get from the HTTP answer to
 * the socket handshake; short enough that an unspent ticket is not worth
 * stealing. The row's `ttl` sweeps the ones nobody spends.
 */
const HOST_TICKET_TTL_SECONDS = 60;

/** 32 random bytes as lower-case hex — and nothing else ever becomes a key. */
const TICKET_PATTERN = /^[0-9a-f]{64}$/;

const isWellFormedTicket = (ticket) => typeof ticket === 'string' && TICKET_PATTERN.test(ticket);

const ticketKey = (gameId, ticket) => ({
  PK: `GAME#${gameId}`,
  SK: `${HOST_TICKET_SK_PREFIX}${ticket}`,
});

const epochSeconds = (nowMs) => Math.floor(nowMs / 1000);

/**
 * Store a new ticket for this game. The caller has already decided the
 * requester may drive the session; this only writes.
 *
 * @returns {Promise<{ticket: string, expiresAt: number}>}
 */
async function mintHostTicket(db, tableName, gameId, { mintedBy = null, now = Date.now() } = {}) {
  const ticket = crypto.randomBytes(32).toString('hex');
  const expiresAt = epochSeconds(now) + HOST_TICKET_TTL_SECONDS;
  await db.send(new PutCommand({
    TableName: tableName,
    Item: {
      ...ticketKey(gameId, ticket),
      GameId: gameId,
      MintedBy: mintedBy,
      ExpiresAt: expiresAt,
      ttl: expiresAt,
    },
    // 256 random bits do not collide; the condition makes "overwrote a live
    // ticket" impossible rather than merely improbable.
    ConditionExpression: 'attribute_not_exists(PK)',
  }));
  return { ticket, expiresAt };
}

/**
 * Spend a ticket. True only if it existed under THIS game, had not expired, and
 * this call was the one that deleted it — so two sockets presenting the same
 * ticket cannot both win.
 *
 * A missing, malformed, expired or already-spent ticket answers false. Any
 * OTHER failure throws: the caller must not guess, and a refused handshake is
 * something the host page recovers from (it reconnects with a fresh ticket),
 * where a silently downgraded socket is not.
 */
async function spendHostTicket(db, tableName, gameId, ticket, { now = Date.now() } = {}) {
  if (!gameId || !isWellFormedTicket(ticket)) return false;
  try {
    await db.send(new DeleteCommand({
      TableName: tableName,
      Key: ticketKey(gameId, ticket),
      // Expiry is checked here, not left to the table's TTL, which can run up
      // to two days late.
      ConditionExpression: 'attribute_exists(PK) AND ExpiresAt > :now',
      ExpressionAttributeValues: { ':now': epochSeconds(now) },
    }));
    return true;
  } catch (error) {
    if (error && error.name === 'ConditionalCheckFailedException') return false;
    throw error;
  }
}

module.exports = {
  HOST_TICKET_SK_PREFIX,
  HOST_TICKET_TTL_SECONDS,
  isWellFormedTicket,
  mintHostTicket,
  spendHostTicket,
};
