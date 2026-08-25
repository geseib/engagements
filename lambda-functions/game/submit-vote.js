const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, PutCommand, GetCommand, QueryCommand, DeleteCommand } = require('@aws-sdk/lib-dynamodb');
const { ApiGatewayManagementApiClient, PostToConnectionCommand } = require('@aws-sdk/client-apigatewaymanagementapi');
const { encryptItem } = require('./tenant-crypto');

const client = new DynamoDBClient({});
const db = DynamoDBDocumentClient.from(client);
const apigateway = new ApiGatewayManagementApiClient({
  endpoint: process.env.WEBSOCKET_API_ENDPOINT
});

exports.handler = async (event) => {
  try {
    const { gameId } = event.pathParameters || {};
    const body = JSON.parse(event.body || '{}');
    const { playerName, questionNumber, votes } = body;

    if (!gameId || !playerName || !questionNumber || !votes) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Game ID, player name, question number, and votes are required' }),
        headers: { 'Access-Control-Allow-Origin': '*' }
      };
    }

    console.log(`🗳️ Player ${playerName} submitting vote for question ${questionNumber} in game ${gameId}`);

    // Validate game exists and is in voting state
    const gameState = await db.send(new GetCommand({
      TableName: process.env.TABLE_NAME,
      Key: { PK: `GAME#${gameId}`, SK: 'STATE' }
    }));

    if (!gameState.Item) {
      return {
        statusCode: 404,
        body: JSON.stringify({ error: 'Game not found' }),
        headers: { 'Access-Control-Allow-Origin': '*' }
      };
    }

    const currentState = gameState.Item.State;
    const paddedQuestionNumber = String(questionNumber).padStart(3, '0');
    const expectedState = `VOTE#${paddedQuestionNumber}`;

    if (currentState !== expectedState) {
      return {
        statusCode: 400,
        body: JSON.stringify({ 
          error: 'Invalid game state for voting',
          currentState,
          expectedState
        }),
        headers: { 'Access-Control-Allow-Origin': '*' }
      };
    }

    // Store vote in database following design doc schema
    const voteRecord = {
      PK: `GAME#${gameId}`,
      SK: `QUESTION#${paddedQuestionNumber}#VOTE#${playerName}`,
      VoterName: playerName,
      QuestionNumber: paddedQuestionNumber,
      Votes: votes, // e.g., {"0": 1, "1": 2, "2": 3}
      SubmittedAt: new Date().toISOString(),
      ttl: Math.floor(Date.now() / 1000) + (7 * 24 * 60 * 60) // 7 days TTL
    };

    // ── THE BALLOT ───────────────────────────────────────────────────────────
    //
    // `Votes` is a MAP (`{"0":1,"1":2}`), not a string. `encryptValue`
    // JSON-serialises whatever it is given, so it round-trips back as a map and
    // every tally below keeps working on the shape it expects.
    //
    // THIS ROUTE IS PUBLIC — a participant votes with nothing but the game id
    // and their name — so the organisation cannot come from the caller. It
    // comes off `GAME#<id>/METADATA`, the same row `get-votes` and
    // `get-results` read it from when they decrypt. A pre-tenancy session has
    // no orgId, no data key, and therefore keeps writing plaintext.
    const sessionMeta = await db.send(new GetCommand({
      TableName: process.env.TABLE_NAME,
      Key: { PK: `GAME#${gameId}`, SK: 'METADATA' },
      ProjectionExpression: 'orgId'
    }));
    const voteOrgId = typeof sessionMeta.Item?.orgId === 'string' ? sessionMeta.Item.orgId.trim() : '';

    await db.send(new PutCommand({
      TableName: process.env.TABLE_NAME,
      Item: voteOrgId ? await encryptItem(voteOrgId, 'vote', voteRecord) : voteRecord
    }));

    console.log(`✅ Vote stored successfully for ${playerName} on question ${questionNumber}`);

    // After successful storage, notify host via WebSocket
    await notifyHostOfVote(gameId, playerName, questionNumber, votes);

    return {
      statusCode: 200,
      body: JSON.stringify({ 
        message: 'Vote submitted successfully',
        questionNumber: paddedQuestionNumber,
        playerName
      }),
      headers: { 'Access-Control-Allow-Origin': '*' }
    };

  } catch (error) {
    console.error('Submit vote error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: `Failed to submit vote: ${error.message}` }),
      headers: { 'Access-Control-Allow-Origin': '*' }
    };
  }
};

/**
 * Notify host of player vote via WebSocket
 */
async function notifyHostOfVote(gameId, playerName, questionNumber, votes) {
  try {
    const hostConnections = await getHostConnections(gameId);

    if (hostConnections.length === 0) {
      console.log(`⚠️ No host connection found for game ${gameId}`);
      return;
    }

    const notification = {
      type: 'playerVoted',
      gameId,
      playerName,
      questionNumber,
      questionId: questionNumber,
      votes,
      timestamp: new Date().toISOString()
    };

    await Promise.all(hostConnections.map(async (hostConnection) => {
      try {
        await apigateway.send(new PostToConnectionCommand({
          ConnectionId: hostConnection.ConnectionId,
          Data: JSON.stringify(notification)
        }));
        console.log(`✅ Host ${hostConnection.ConnectionId} notified of vote from ${playerName}`);
      } catch (sendError) {
        // 410 Gone == dead host connection. Delete the stale row inline.
        if (sendError.statusCode === 410 || sendError.name === 'GoneException' || sendError.$response?.statusCode === 410) {
          console.log(`🧹 Removing stale host connection ${hostConnection.ConnectionId} (410 Gone)`);
          await db.send(new DeleteCommand({
            TableName: process.env.TABLE_NAME,
            Key: { PK: hostConnection.PK, SK: hostConnection.SK }
          })).catch(() => {});
        } else {
          console.error(`❌ Failed to notify host ${hostConnection.ConnectionId}:`, sendError.message);
        }
      }
    }));
  } catch (error) {
    console.error(`❌ Error notifying host of vote:`, error);
    // Don't throw error - vote was already saved successfully
  }
}

/**
 * Every host connection for a game.
 *
 * ALL of them, not `Items[0]`. connect.js retires older host rows but leaves
 * same-millisecond peers alone rather than picking a winner by coin flip (see
 * tests/host-connection-dedup.js), so more than one row can legitimately exist.
 * Choosing one means the host screen the operator is looking at may be the one
 * whose "Voted n / m" never moves — the VOTE-phase twin of the frozen answer
 * meter.
 */
async function getHostConnections(gameId) {
  try {
    const result = await db.send(new QueryCommand({
      TableName: process.env.TABLE_NAME,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
      FilterExpression: 'ConnectionType = :type',
      ExpressionAttributeValues: {
        ':pk': `GAME#${gameId}`,
        ':sk': 'CONNECTION#',
        ':type': 'HOST'
      }
    }));

    return result.Items || [];
  } catch (error) {
    console.error(`❌ Error getting host connections for game ${gameId}:`, error);
    return [];
  }
}