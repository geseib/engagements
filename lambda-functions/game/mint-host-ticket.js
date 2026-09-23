/**
 * POST /games/{gameId}/host-ticket — THE ONLY WAY A SOCKET BECOMES A HOST'S.
 *
 * The host page calls this immediately before every WebSocket connect and puts
 * the answer on the socket URL (`&hostTicket=…`). `websocket/connect.js` spends
 * it: a live ticket for this game makes the connection row HOST, and anything
 * else makes it PLAYER. See `host-tickets.js` for what a ticket is and why it
 * is a stored nonce.
 *
 * ── WHO GETS ONE ───────────────────────────────────────────────────────────
 *
 * Exactly the people who may drive the room, decided by the rule every other
 * host control uses: the Cognito authorizer in front (template-clean.yaml,
 * `hosts` or `admins`), and `callerMayDriveSession` on the session's own org.
 * 404 to anyone else, for the reason tenant.callerMayDriveSession gives — a
 * 403 would confirm that a guessed code is somebody's live session.
 *
 * NO IDENTITY IS REFUSED HERE TOO, as save-report.js and comments.js do.
 * `callerMayDriveSession` waves through a caller with no groups, because the
 * participant journey is never gated; on its own it would hand a ticket for an
 * orgless session to anyone, the day this route lost its authorizer.
 *
 * A session that does not exist gets no ticket, so a ticket row can never be
 * written into a partition nothing else will ever clean up.
 */

const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, GetCommand } = require('@aws-sdk/lib-dynamodb');

const { callerMayDriveSession } = require('./tenant');
const { mintHostTicket, HOST_TICKET_TTL_SECONDS } = require('./host-tickets');

const client = new DynamoDBClient({});
const db = DynamoDBDocumentClient.from(client);

// A ticket is a credential for one handshake; nothing between here and the
// browser may keep a copy.
const headers = {
  'Access-Control-Allow-Origin': '*',
  'Content-Type': 'application/json',
  'Cache-Control': 'no-store',
};

const respond = (statusCode, body) => ({ statusCode, headers, body: JSON.stringify(body) });

exports.handler = async (event) => {
  const { gameId } = event.pathParameters || {};
  if (!gameId) return respond(400, { error: 'Game ID is required' });

  try {
    const meta = await db.send(new GetCommand({
      TableName: process.env.TABLE_NAME,
      Key: { PK: `GAME#${gameId}`, SK: 'METADATA' },
      ProjectionExpression: 'PK, orgId, OrgId',
    }));

    const authorizer = event?.requestContext?.authorizer;
    const identity = authorizer?.jwt?.claims || authorizer?.lambda;
    if (!meta.Item || !identity || !callerMayDriveSession(event, meta.Item)) {
      return respond(404, { error: 'Game not found' });
    }

    const { ticket } = await mintHostTicket(db, process.env.TABLE_NAME, gameId, {
      mintedBy: identity.userId || identity.sub || null,
    });

    // The ticket itself is never logged: it is a credential until it is spent.
    console.log(`🎟️ Host ticket minted for game ${gameId}`);
    return respond(200, { ticket, expiresInSeconds: HOST_TICKET_TTL_SECONDS });
  } catch (error) {
    console.error(`❌ Host ticket for game ${gameId} failed:`, error.message);
    return respond(500, { error: 'Could not issue a host ticket' });
  }
};
