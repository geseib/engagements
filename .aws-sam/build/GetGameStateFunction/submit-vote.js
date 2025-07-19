const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, PutCommand, GetCommand, QueryCommand } = require('@aws-sdk/lib-dynamodb');
const { ApiGatewayManagementApiClient, PostToConnectionCommand } = require('@aws-sdk/client-apigatewaymanagementapi');

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

    await db.send(new PutCommand({
      TableName: process.env.TABLE_NAME,
      Item: voteRecord
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
    // Get host connection
    const hostConnection = await getHostConnection(gameId);
    
    if (hostConnection) {
      const notification = {
        type: 'playerVoted',
        gameId,
        playerName,
        questionNumber,
        questionId: questionNumber,
        votes,
        timestamp: new Date().toISOString()
      };

      await apigateway.send(new PostToConnectionCommand({
        ConnectionId: hostConnection.ConnectionId,
        Data: JSON.stringify(notification)
      }));

      console.log(`✅ Host notified of vote from ${playerName}`);
    } else {
      console.log(`⚠️ No host connection found for game ${gameId}`);
    }
  } catch (error) {
    console.error(`❌ Error notifying host of vote:`, error);
    // Don't throw error - vote was already saved successfully
  }
}

/**
 * Get host connection for a game
 */
async function getHostConnection(gameId) {
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
    
    return result.Items && result.Items.length > 0 ? result.Items[0] : null;
  } catch (error) {
    console.error(`❌ Error getting host connection for game ${gameId}:`, error);
    return null;
  }
}