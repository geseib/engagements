const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, QueryCommand, DeleteCommand } = require('@aws-sdk/lib-dynamodb');
const { ApiGatewayManagementApiClient, PostToConnectionCommand } = require('@aws-sdk/client-apigatewaymanagementapi');

const dynamoClient = new DynamoDBClient({});
const db = DynamoDBDocumentClient.from(dynamoClient);
const apigateway = new ApiGatewayManagementApiClient({
  endpoint: process.env.WEBSOCKET_API_ENDPOINT
});

/**
 * Clean WebSocket Message Handler
 * 
 * Message Patterns:
 * 1. Host → All Players: ASK#Q1, VOTE#Q1, RESULT#Q1, END
 * 2. Player → Host: ANSWERED#Q1, VOTED#Q1, QUIT
 * 3. Future: Player → Player (not implemented)
 * 
 * Flow: Sender → HTTP API (update DynamoDB) → WebSocket → Receiver → HTTP API (fetch data)
 */
exports.handler = async (event) => {
  const connectionId = event.requestContext.connectionId;
  
  try {
    const body = JSON.parse(event.body);
    console.log(`📨 WebSocket Message from ${connectionId}:`, body);
    
    const { messageType, gameId, playerName } = body;
    
    if (!messageType || !gameId) {
      console.log('❌ Missing required fields: messageType, gameId');
      return { statusCode: 400, body: 'Missing required fields' };
    }
    
    // Route message based on type
    if (isHostMessage(messageType)) {
      await handleHostMessage(gameId, messageType, body);
    } else if (isPlayerMessage(messageType)) {
      await handlePlayerMessage(gameId, playerName, messageType, body);
    } else {
      console.log(`⚠️ Unknown message type: ${messageType}`);
      return { statusCode: 400, body: 'Unknown message type' };
    }
    
    return { statusCode: 200, body: 'Message processed' };
    
  } catch (error) {
    console.error('❌ WebSocket message error:', error);
    return { statusCode: 500, body: 'Failed to process message' };
  }
};

/**
 * Check if message is from host to all players
 */
function isHostMessage(messageType) {
  return messageType.startsWith('ASK#') || 
         messageType.startsWith('VOTE#') || 
         messageType.startsWith('RESULT#') || 
         messageType === 'END';
}

/**
 * Check if message is from player to host
 */
function isPlayerMessage(messageType) {
  return messageType.startsWith('ANSWERED#') || 
         messageType.startsWith('VOTED#') || 
         messageType === 'QUIT';
}

/**
 * Handle host messages - broadcast to all players in game
 */
async function handleHostMessage(gameId, messageType, messageData) {
  console.log(`🎯 Host message ${messageType} for game ${gameId}`);
  
  try {
    // Get all player connections for this game
    const playerConnections = await getPlayerConnections(gameId);
    console.log(`📡 Broadcasting to ${playerConnections.length} players`);
    
    // Broadcast to all players
    const broadcastPromises = playerConnections.map(connection =>
      sendToConnection(connection.ConnectionId, {
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
    console.error(`❌ Error handling host message ${messageType}:`, error);
    throw error;
  }
}

/**
 * Handle player messages - send to host only
 */
async function handlePlayerMessage(gameId, playerName, messageType, messageData) {
  console.log(`👤 Player message ${messageType} from ${playerName} in game ${gameId}`);
  
  try {
    // Get host connection for this game
    const hostConnection = await getHostConnection(gameId);
    
    if (hostConnection) {
      await sendToConnection(hostConnection.ConnectionId, {
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
    console.error(`❌ Error handling player message ${messageType}:`, error);
    throw error;
  }
}

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
async function sendToConnection(connectionId, message) {
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
