const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, ScanCommand, DeleteCommand } = require('@aws-sdk/lib-dynamodb');
const { ApiGatewayManagementApiClient, PostToConnectionCommand } = require('@aws-sdk/client-apigatewaymanagementapi');

const dynamoClient = new DynamoDBClient({});
const db = DynamoDBDocumentClient.from(dynamoClient);

/**
 * Broadcast a message to all WebSocket connections for a specific game
 * @param {string} gameId - The game ID to broadcast to
 * @param {object} message - The message object to send
 * @param {string} websocketEndpoint - The WebSocket API endpoint
 * @returns {Promise<void>}
 */
const broadcastToGame = async (gameId, message, websocketEndpoint) => {
  const apigateway = new ApiGatewayManagementApiClient({
    endpoint: websocketEndpoint
  });

  try {
    // Get all WebSocket connections for this game
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

/**
 * Send a message to a specific WebSocket connection
 * @param {string} connectionId - The connection ID to send to
 * @param {object} message - The message object to send
 * @param {string} websocketEndpoint - The WebSocket API endpoint
 * @returns {Promise<boolean>} - True if successful, false if failed
 */
const sendToConnection = async (connectionId, message, websocketEndpoint) => {
  const apigateway = new ApiGatewayManagementApiClient({
    endpoint: websocketEndpoint
  });

  try {
    await apigateway.send(new PostToConnectionCommand({
      ConnectionId: connectionId,
      Data: JSON.stringify(message)
    }));
    console.log(`✅ Message sent to connection ${connectionId}`);
    return true;
  } catch (error) {
    console.log(`❌ Failed to send to connection ${connectionId}:`, error.message);
    return false;
  }
};

module.exports = {
  broadcastToGame,
  sendToConnection
};
