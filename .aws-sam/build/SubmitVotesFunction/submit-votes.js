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
  const { name, questionNumber, votes } = JSON.parse(event.body);
  const ttl = Math.floor(Date.now() / 1000) + (14 * 24 * 60 * 60);
  
  console.log(`🗳️ Votes: game=${gameId}, question=${questionNumber}, voter=${name}`, votes);
  
  try {
    // Clean structure: GAME#1234 / VOTE#001#PLAYER#name
    // votes = { "0": 1, "1": 2, "2": 3 } (answerIndex: rank)
    await db.send(new PutCommand({
      TableName: process.env.TABLE_NAME,
      Item: {
        PK: `GAME#${gameId}`,
        SK: `VOTE#${questionNumber}#PLAYER#${name}`,
        VoterName: name,
        QuestionNumber: questionNumber,
        First: votes["0"] || null,   // Answer index for 1st place
        Second: votes["1"] || null,  // Answer index for 2nd place  
        Third: votes["2"] || null,   // Answer index for 3rd place
        VotesRaw: votes, // Keep original format for compatibility
        SubmittedAt: new Date().toISOString(),
        ttl
      }
    }));
    
    console.log(`✅ Vote stored successfully for ${name} on question ${questionNumber}`);
    
    // Broadcast vote submitted notification via WebSocket
    console.log(`🔌 Broadcasting playerVoted for game ${gameId}, question ${questionNumber}, voter ${name}`);
    await broadcastToGame(gameId, {
      type: 'playerVoted',
      gameId,
      questionId: questionNumber,
      voterName: name,
      timestamp: new Date().toISOString()
    });
    
    console.log(`✅ Vote submission complete for ${name} on question ${questionNumber}`);
    return { 
      statusCode: 200, 
      body: JSON.stringify({ status: 'OK' }),
      headers: { 'Access-Control-Allow-Origin': '*' }
    };
  } catch (error) {
    console.error('❌ Submit votes error:', error);
    return { 
      statusCode: 500, 
      body: JSON.stringify({ error: 'Failed to submit votes' }),
      headers: { 'Access-Control-Allow-Origin': '*' }
    };
  }
};
