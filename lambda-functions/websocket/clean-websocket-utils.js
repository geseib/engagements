const { ApiGatewayManagementApiClient, PostToConnectionCommand } = require('@aws-sdk/client-apigatewaymanagementapi');
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, QueryCommand } = require('@aws-sdk/lib-dynamodb');

const dynamoClient = new DynamoDBClient({});
const db = DynamoDBDocumentClient.from(dynamoClient);

/**
 * Send a host message through the new clean WebSocket system
 * Host messages are broadcast to all players in the game
 * 
 * @param {string} gameId - The game ID
 * @param {string} messageType - The message type (ASK#Q1, VOTE#Q1, RESULT#Q1, END)
 * @param {object} messageData - Additional message data
 */
const sendHostMessage = async (gameId, messageType, messageData = {}) => {
  console.log(`🎯 Sending host message ${messageType} for game ${gameId}`);
  
  try {
    const apigateway = new ApiGatewayManagementApiClient({
      endpoint: process.env.WEBSOCKET_API_ENDPOINT
    });
    
    // Get all player connections for this game
    const playerConnections = await getPlayerConnections(gameId);
    console.log(`📡 Broadcasting to ${playerConnections.length} players`);
    
    if (playerConnections.length === 0) {
      console.log(`⚠️ No player connections found for game ${gameId}`);
      return;
    }
    
    // Broadcast to all players
    const broadcastPromises = playerConnections.map(connection =>
      sendToConnection(apigateway, connection.ConnectionId, {
        type: 'hostMessage',
        messageType,
        gameId,
        timestamp: new Date().toISOString(),
        ...messageData
      })
    );
    
    await Promise.all(broadcastPromises);
    console.log(`✅ Host message ${messageType} broadcast complete`);
    
  } catch (error) {
    console.error(`❌ Error sending host message ${messageType}:`, error);
    throw error;
  }
};

/**
 * Send a player message through the new clean WebSocket system
 * Player messages are sent to the host only
 * 
 * @param {string} gameId - The game ID
 * @param {string} playerName - The player name
 * @param {string} messageType - The message type (ANSWERED#Q1, VOTED#Q1, QUIT)
 * @param {object} messageData - Additional message data
 */
const sendPlayerMessage = async (gameId, playerName, messageType, messageData = {}) => {
  console.log(`👤 Sending player message ${messageType} from ${playerName} in game ${gameId}`);
  
  try {
    const apigateway = new ApiGatewayManagementApiClient({
      endpoint: process.env.WEBSOCKET_API_ENDPOINT
    });
    
    // Get host connection for this game
    const hostConnection = await getHostConnection(gameId);
    
    if (hostConnection) {
      await sendToConnection(apigateway, hostConnection.ConnectionId, {
        type: 'playerMessage',
        messageType,
        gameId,
        playerName,
        timestamp: new Date().toISOString(),
        ...messageData
      });
      
      console.log(`✅ Player message ${messageType} sent to host`);
    } else {
      console.log(`⚠️ No host connection found for game ${gameId}`);
    }
    
  } catch (error) {
    console.error(`❌ Error sending player message ${messageType}:`, error);
    throw error;
  }
};

/**
 * Get all player connections for a game
 */
async function getPlayerConnections(gameId) {
  try {
    const result = await db.send(new QueryCommand({
      TableName: process.env.TABLE_NAME,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
      FilterExpression: 'ConnectionType = :type',
      ExpressionAttributeValues: {
        ':pk': `GAME#${gameId}`,
        ':sk': 'CONNECTION#',
        ':type': 'PLAYER'
      }
    }));
    
    return result.Items || [];
  } catch (error) {
    console.error(`❌ Error getting player connections for game ${gameId}:`, error);
    return [];
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
    
    return result.Items?.[0] || null;
  } catch (error) {
    console.error(`❌ Error getting host connection for game ${gameId}:`, error);
    return null;
  }
}

/**
 * Send message to specific WebSocket connection
 */
async function sendToConnection(apigateway, connectionId, message) {
  try {
    await apigateway.send(new PostToConnectionCommand({
      ConnectionId: connectionId,
      Data: JSON.stringify(message)
    }));
  } catch (error) {
    console.error(`❌ Failed to send to connection ${connectionId}:`, error);
    
    // Remove stale connections
    if (error.statusCode === 410) {
      console.log(`🧹 Removing stale connection ${connectionId}`);
      // Note: Connection cleanup will be handled by disconnect function
    }
    
    throw error;
  }
}

module.exports = {
  sendHostMessage,
  sendPlayerMessage
};
