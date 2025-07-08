const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, PutCommand, ScanCommand, DeleteCommand } = require('@aws-sdk/lib-dynamodb');
const { ApiGatewayManagementApiClient, PostToConnectionCommand } = require('@aws-sdk/client-apigatewaymanagementapi');

const dynamoClient = new DynamoDBClient({});
const db = DynamoDBDocumentClient.from(dynamoClient);
const apigateway = new ApiGatewayManagementApiClient({
  endpoint: process.env.WEBSOCKET_API_ENDPOINT
});

// Helper function to broadcast WebSocket message
const broadcastToGame = async (gameId, message) => {
  try {
    const connectionsResult = await db.send(new ScanCommand({
      TableName: process.env.TABLE_NAME,
      FilterExpression: 'begins_with(PK, :prefix) AND GameId = :gameId',
      ExpressionAttributeValues: {
        ':prefix': 'CONNECTION#',
        ':gameId': gameId
      }
    }));
    
    const connections = connectionsResult.Items || [];
    console.log(`🔌 Broadcasting to ${connections.length} connections for game ${gameId}:`, message);
    
    if (connections.length === 0) {
      console.log(`⚠️ No active connections found for game ${gameId}`);
      return;
    }
    
    const broadcastPromises = connections.map(async (connection) => {
      try {
        await apigateway.send(new PostToConnectionCommand({
          ConnectionId: connection.ConnectionId,
          Data: JSON.stringify(message)
        }));
        console.log(`✅ Message sent to connection ${connection.ConnectionId} (${connection.PlayerName || 'Unknown'})`);
      } catch (error) {
        console.log(`❌ Failed to send to connection ${connection.ConnectionId}:`, error.message);
        
        // Remove stale connections (410 = Gone)
        if (error.statusCode === 410 || error.$metadata?.httpStatusCode === 410) {
          console.log(`🧹 Removing stale connection: ${connection.ConnectionId}`);
          try {
            await db.send(new DeleteCommand({
              TableName: process.env.TABLE_NAME,
              Key: { PK: connection.PK, SK: connection.SK }
            }));
          } catch (deleteError) {
            console.error(`❌ Failed to delete stale connection:`, deleteError);
          }
        }
      }
    });
    
    await Promise.all(broadcastPromises);
    console.log(`✅ Broadcast complete for game ${gameId}`);
  } catch (error) {
    console.error('❌ Broadcast error:', error);
    throw error;
  }
};

exports.handler = async (event) => {
  const gameId = event.pathParameters.gameId;
  const { 
    state, 
    currentQuestion, 
    currentQuestionId, 
    scoredQuestions, 
    usedQuestions, 
    playedQuestions, 
    currentQuestionData 
  } = JSON.parse(event.body);
  
  console.log(`🎮 Setting game state for ${gameId}: ${state}, question: ${currentQuestion || currentQuestionId}`);
  
  try {
    const ttl = Math.floor(Date.now() / 1000) + (14 * 24 * 60 * 60); // 2 weeks TTL
    
    // Build state item
    const stateItem = {
      PK: `GAME#${gameId}`,
      SK: 'STATE',
      Stage: state, // BEGIN, ASK, VOTE, RESULTS, END
      UpdatedAt: new Date().toISOString(),
      ttl
    };
    
    // Add current question if provided
    if (currentQuestion) stateItem.CurrentQuestion = currentQuestion;
    if (currentQuestionId) stateItem.CurrentQuestionId = currentQuestionId;
    
    // Add optional arrays if provided
    if (scoredQuestions) stateItem.ScoredQuestions = scoredQuestions;
    if (usedQuestions) stateItem.UsedQuestions = usedQuestions;
    if (playedQuestions) stateItem.PlayedQuestions = playedQuestions;
    if (currentQuestionData) stateItem.CurrentQuestionData = currentQuestionData;
    
    await db.send(new PutCommand({
      TableName: process.env.TABLE_NAME,
      Item: stateItem
    }));
    
    // Broadcast game state change notification via WebSocket
    console.log(`🔌 Broadcasting gameStateChanged for game ${gameId}: ${state}`);
    await broadcastToGame(gameId, {
      type: 'gameStateChanged',
      gameId,
      state,
      questionId: currentQuestionId || currentQuestion,
      timestamp: new Date().toISOString()
    });
    
    console.log(`✅ Game state updated successfully for game ${gameId}: ${state}`);
    return { 
      statusCode: 200, 
      body: JSON.stringify({ status: 'OK' }),
      headers: { 'Access-Control-Allow-Origin': '*' }
    };
  } catch (error) {
    console.error('❌ Set game state error:', error);
    return { 
      statusCode: 500, 
      body: JSON.stringify({ error: 'Failed to set game state' }),
      headers: { 'Access-Control-Allow-Origin': '*' }
    };
  }
};
