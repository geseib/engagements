const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, ScanCommand } = require('@aws-sdk/lib-dynamodb');
const { ApiGatewayManagementApiClient, PostToConnectionCommand } = require('@aws-sdk/client-apigatewaymanagementapi');

const dynamoClient = new DynamoDBClient({});
const db = DynamoDBDocumentClient.from(dynamoClient);
const apigateway = new ApiGatewayManagementApiClient({
  endpoint: process.env.WEBSOCKET_API_ENDPOINT
});

exports.handler = async (event) => {
  const connectionId = event.requestContext.connectionId;
  const body = JSON.parse(event.body);
  
  console.log(`📨 WebSocket Message:`, body);
  
  try {
    // Handle different message types
    switch (body.action) {
      case 'ping':
        // Simple ping/pong for connection testing
        await apigateway.send(new PostToConnectionCommand({
          ConnectionId: connectionId,
          Data: JSON.stringify({ type: 'pong', timestamp: new Date().toISOString() })
        }));
        break;
        
      case 'broadcast':
        // Broadcast message to all connections in a game
        if (body.gameId && body.message) {
          await broadcastToGame(body.gameId, body.message);
        }
        break;
        
      default:
        console.log(`⚠️ Unknown action: ${body.action}`);
    }
    
    return { statusCode: 200, body: 'Message processed' };
  } catch (error) {
    console.error('❌ Send message error:', error);
    return { statusCode: 500, body: 'Failed to process message' };
  }
};

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
    console.log(`🔌 Broadcasting to ${connections.length} connections for game ${gameId}`);
    
    const broadcastPromises = connections.map(async (connection) => {
      try {
        await apigateway.send(new PostToConnectionCommand({
          ConnectionId: connection.ConnectionId,
          Data: JSON.stringify(message)
        }));
      } catch (error) {
        console.log(`🔌 Failed to send to connection ${connection.ConnectionId}:`, error);
        // Remove dead connections
        if (error.statusCode === 410) {
          await db.send(new DeleteCommand({
            TableName: process.env.TABLE_NAME,
            Key: { PK: connection.PK, SK: connection.SK }
          }));
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
