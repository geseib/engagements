/**
 * POST /games/{gameId}/end — THE HOST STOPS A SESSION EARLY.
 *
 * Task 4, 2026-09-26 bug sweep: "A non-survey session reaches ENDED only when
 * the question pool runs dry (next-question.js's pool-dry path). A host who
 * wants to stop after round 4 of 10 cannot, so the session stays live until
 * its ttl." This route is the missing door.
 *
 * ── THE GATE, copied from next-question.js's own (the nearest host-only
 *    POST under /games/{gameId}/... that already drives a live session) ──
 *
 * Cognito in front (template-clean.yaml) and `callerMayDriveSession` on the
 * session's own org behind it. 404, not 403, on a caller who may not drive
 * this session — a guessed four-digit code must not be able to learn a
 * session exists. `tests/end-session.js` pins both an anonymous caller and a
 * caller from another organisation.
 *
 * ── THE WRITE AND THE BROADCAST are session-end.js's `endSession`, the SAME
 *    helper next-question.js's pool-dry path now calls. Nothing here
 *    duplicates the UpdateCommand or the broadcast; see that file's header.
 *
 * ── IDEMPOTENT: an already-ENDED session answers 200 and `endSession`
 *    writes and broadcasts nothing (`currentState === 'ENDED'`). A host's
 *    click landing twice, or two of the host's own devices racing the same
 *    click, must not send the room a second END frame.
 *
 * ── A SURVEY IS REFUSED HERE, 400, POINTING AT survey/end. A survey ends
 *    through survey-host.js's own `end()` — SURVEY#CLOSED -> ENDED only,
 *    with its own EndedAt stamp and its own `gameEnded` broadcast shape.
 *    Letting this route also end a survey would give it two ways to reach
 *    ENDED that disagree about what state it must already be in.
 *
 * ── A CREATED SESSION IS REFUSED HERE TOO, 409. `canEndSession` already
 *    keeps the settings panel from offering the control before a session has
 *    started, but the route does not trust that: ending a CREATED session
 *    would write ENDED over one whose `Started` flag was never set and whose
 *    ttl is still the 90-day unstarted one (session-ttl.js) — see
 *    session-start.js, the only writer of either.
 *
 * ── ORDER (fix round 1, item 4): the identity check runs BEFORE either
 *    DynamoDB read, so an unidentified caller costs the table nothing.
 *    `callerMayDriveSession` still needs METADATA, so that half of the gate
 *    stays after the reads, once there is a row to ask it about.
 */
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const {
  DynamoDBDocumentClient, GetCommand, QueryCommand, DeleteCommand,
} = require('@aws-sdk/lib-dynamodb');
const { ApiGatewayManagementApiClient, PostToConnectionCommand } = require('@aws-sdk/client-apigatewaymanagementapi');

const { callerMayDriveSession } = require('./tenant');
const { endSession } = require('./session-end');

const client = new DynamoDBClient({});
const db = DynamoDBDocumentClient.from(client);
const apigateway = new ApiGatewayManagementApiClient({
  endpoint: process.env.WEBSOCKET_API_ENDPOINT,
});

const respond = (statusCode, body) => ({
  statusCode,
  body: JSON.stringify(body),
  headers: { 'Access-Control-Allow-Origin': '*' },
});

/** Same shape as next-question.js's own broadcaster: never throws, drops
 *  connections the socket has already lost. */
const broadcastToGame = async (gameId, message) => {
  try {
    const connectionsResult = await db.send(new QueryCommand({
      TableName: process.env.TABLE_NAME,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
      ExpressionAttributeValues: { ':pk': `GAME#${gameId}`, ':sk': 'CONNECTION#' },
    }));

    const connections = connectionsResult.Items || [];
    if (connections.length === 0) return;

    await Promise.all(connections.map(async (connection) => {
      try {
        await apigateway.send(new PostToConnectionCommand({
          ConnectionId: connection.ConnectionId,
          Data: JSON.stringify(message),
        }));
      } catch (error) {
        const status = error.statusCode || error.$metadata?.httpStatusCode || error.$response?.statusCode;
        if (status === 410 || error.name === 'GoneException') {
          await db.send(new DeleteCommand({
            TableName: process.env.TABLE_NAME,
            Key: { PK: connection.PK, SK: connection.SK },
          })).catch(() => {});
        } else {
          console.error(`❌ END SESSION: broadcast failed for ${connection.ConnectionId}:`, error.message);
        }
      }
    }));
  } catch (error) {
    console.error('❌ END SESSION: broadcast failed entirely (continuing):', error);
  }
};

exports.handler = async (event) => {
  try {
    const { gameId } = event.pathParameters || {};
    if (!gameId) {
      return respond(400, { error: 'Game ID is required' });
    }

    /*
      FIX ROUND 1, ITEM 4 — THE IDENTITY CHECK COMES BEFORE ANY READ. This
      route has no participant journey — every legitimate caller is a host —
      so an absent identity is refused outright, and refusing it costs the
      table nothing: no GetCommand is issued for a request that was never
      going anywhere. `callerMayDriveSession` still needs METADATA to decide
      whether THIS caller may drive THIS session, which is why that half of
      the gate stays below, once the row exists to ask it about.
    */
    const claims = event?.requestContext?.authorizer?.jwt?.claims || event?.requestContext?.authorizer?.lambda;
    if (!claims) {
      return respond(404, { error: 'Game not found' });
    }

    const [gameState, ownerRead] = await Promise.all([
      db.send(new GetCommand({
        TableName: process.env.TABLE_NAME,
        Key: { PK: `GAME#${gameId}`, SK: 'STATE' },
      })),
      db.send(new GetCommand({
        TableName: process.env.TABLE_NAME,
        Key: { PK: `GAME#${gameId}`, SK: 'METADATA' },
        ProjectionExpression: 'orgId, GameType',
      })),
    ]);

    if (!gameState.Item) {
      return respond(404, { error: 'Game not found' });
    }

    // 404 rather than 403, so a guessed code cannot be used to discover that a
    // session exists — see tenant.callerMayDriveSession.
    if (!callerMayDriveSession(event, ownerRead.Item || {})) {
      return respond(404, { error: 'Game not found' });
    }

    if (ownerRead.Item && ownerRead.Item.GameType === 'survey') {
      const reason = 'A survey ends through survey/end — Close, then End the session there, not this route.';
      return respond(400, { error: reason, message: reason, code: 'SURVEY_USE_SURVEY_END' });
    }

    /*
      FIX ROUND 1, ITEM 3 — A SESSION THAT HAS NOT STARTED HAS NOTHING TO END.
      `canEndSession` (config/hostControls.js) already keeps the UI from
      offering this control on a CREATED session, but the route must refuse it
      on its own: ending a CREATED session would write ENDED over a session
      whose `Started` flag was never set and whose ttl is still the 90-day
      unstarted one (session-ttl.js) — session-start.js is the only writer of
      either, and only next-question.js and start-game.js call it, never this
      route.
    */
    if (gameState.Item.State === 'CREATED') {
      const reason = 'This session has not started yet.';
      return respond(409, { error: reason, message: reason });
    }

    const { changed } = await endSession(db, process.env.TABLE_NAME, gameId, {
      currentState: gameState.Item.State,
      broadcastToGame,
    });

    return respond(200, {
      success: true,
      gameId,
      state: 'ENDED',
      changed,
    });
  } catch (error) {
    console.error('❌ END SESSION: error:', error);
    return respond(500, { error: 'Failed to end the session' });
  }
};
