const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, GetCommand, PutCommand, QueryCommand } = require('@aws-sdk/lib-dynamodb');
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
    const { playerName, accessCode } = body;

    if (!gameId || !playerName) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Game ID and player name are required' }),
        headers: { 'Access-Control-Allow-Origin': '*' }
      };
    }

    console.log(`Player ${playerName} attempting to join game ${gameId}`);

    // Check if game exists and is started
    const gameCheck = await db.send(new GetCommand({
      TableName: process.env.TABLE_NAME,
      Key: { PK: `GAME#${gameId}`, SK: 'METADATA' }
    }));

    if (!gameCheck.Item) {
      return {
        statusCode: 404,
        body: JSON.stringify({ error: 'Game not found' }),
        headers: { 'Access-Control-Allow-Origin': '*' }
      };
    }

    // Check if game has been started
    if (!gameCheck.Item.Started) {
      return {
        statusCode: 403,
        body: JSON.stringify({ 
          error: 'Game not started',
          message: 'This game has not been started yet. Please wait for the host to start the session.'
        }),
        headers: { 'Access-Control-Allow-Origin': '*' }
      };
    }

    // Check game visibility and access code for private games
    const gameMetadata = gameCheck.Item;
    const gameVisibility = gameMetadata.Visibility || 'public';
    
    if (gameVisibility === 'private') {
      const requiredAccessCode = gameMetadata.AccessCode;
      
      if (!requiredAccessCode) {
        console.error(`Game ${gameId} is marked as private but has no access code`);
        return {
          statusCode: 500,
          body: JSON.stringify({ error: 'Game configuration error' }),
          headers: { 'Access-Control-Allow-Origin': '*' }
        };
      }
      
      if (!accessCode) {
        return {
          statusCode: 401,
          body: JSON.stringify({ 
            error: 'Access code required',
            message: 'This is a private game. Please enter the access code to join.'
          }),
          headers: { 'Access-Control-Allow-Origin': '*' }
        };
      }
      
      if (accessCode !== requiredAccessCode) {
        return {
          statusCode: 403,
          body: JSON.stringify({ 
            error: 'Invalid access code',
            message: 'The access code you entered is incorrect. Please try again.'
          }),
          headers: { 'Access-Control-Allow-Origin': '*' }
        };
      }
      
      console.log(`Player ${playerName} provided correct access code for private game ${gameId}`);
    }

    // Use playerName directly as the player ID for simplicity
    const playerId = playerName;

    // Check if player already exists
    const existingPlayer = await db.send(new GetCommand({
      TableName: process.env.TABLE_NAME,
      Key: { 
        PK: `GAME#${gameId}`, 
        SK: `PLAYER#${playerName}` 
      }
    }));

    if (existingPlayer.Item) {
      // Return existing player data
      // Notify host via WebSocket about player reconnection
      await notifyHostOfPlayerJoin(gameId, {
        playerId: playerName,
        playerName: playerName,
        totalScore: 0, // Always 0 for returning players - actual score is in SCORE record
        joinedAt: existingPlayer.Item.joinedAt || existingPlayer.Item.JoinedAt,
        isReconnection: true
      });
      
      return {
        statusCode: 200,
        body: JSON.stringify({
          success: true,
          message: 'Reconnected to existing player',
          playerId: playerName,
          playerName: playerName,
          totalScore: 0, // Always 0 for returning players - actual score is in SCORE record
          isReconnection: true
        }),
        headers: { 'Access-Control-Allow-Origin': '*' }
      };
    }

    // Create new player using playerName as both key and ID
    await db.send(new PutCommand({
      TableName: process.env.TABLE_NAME,
      Item: {
        PK: `GAME#${gameId}`,
        SK: `PLAYER#${playerName}`,
        playerId: playerName,
        PlayerName: playerName,
        playerName: playerName, // Support both formats
        JoinedAt: new Date().toISOString(),
        joinedAt: new Date().toISOString(),
        isConnected: true,
        ttl: Math.floor(Date.now() / 1000) + (7 * 24 * 60 * 60) // 7 days TTL
        // Note: totalScore removed - use PLAYER#{playerName}#SCORE record as single source of truth
      }
    }));

    // Create initial consolidated score record using playerName (new players start with afterRound: "000")
    await db.send(new PutCommand({
      TableName: process.env.TABLE_NAME,
      Item: {
        PK: `GAME#${gameId}`,
        SK: `PLAYER#${playerName}#SCORE`,
        PlayerName: playerName,
        score: 0,
        afterRound: "000", // "000" indicates player hasn't been scored yet
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        ttl: Math.floor(Date.now() / 1000) + (30 * 24 * 60 * 60) // 30 days TTL
      }
    }));

    console.log(`✅ Created score record for ${playerName} with afterRound: 000 (not scored yet)`);

    console.log(`Player ${playerName} successfully joined game ${gameId}`);

    // Notify host via WebSocket about new player
    await notifyHostOfPlayerJoin(gameId, {
      playerId: playerName,
      playerName: playerName,
      totalScore: 0,
      joinedAt: new Date().toISOString(),
      isReconnection: false
    });

    return {
      statusCode: 200,
      body: JSON.stringify({
        success: true,
        message: 'Successfully joined game',
        playerId: playerName,
        playerName: playerName,
        totalScore: 0,
        isReconnection: false
      }),
      headers: { 'Access-Control-Allow-Origin': '*' }
    };

  } catch (error) {
    console.error('Join game error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: `Failed to join game: ${error.message}` }),
      headers: { 'Access-Control-Allow-Origin': '*' }
    };
  }
};


/**
 * Notify host via WebSocket when a player joins or reconnects
 */
async function notifyHostOfPlayerJoin(gameId, playerData) {
  try {
    console.log(`🔔 WEBSOCKET DEBUG: Notifying host of player join: ${playerData.playerName} in game ${gameId}`);
    console.log(`🔔 WEBSOCKET DEBUG: Environment WEBSOCKET_API_ENDPOINT: ${process.env.WEBSOCKET_API_ENDPOINT}`);
    console.log(`🔔 WEBSOCKET DEBUG: ApiGateway client configured:`, apigateway.config);
    
    // Get host connection for this game
    const hostConnection = await getHostConnection(gameId);
    console.log(`🔔 WEBSOCKET DEBUG: Host connection result:`, hostConnection);
    
    if (hostConnection) {
      const message = {
        type: 'playerJoined',
        gameId: gameId,
        player: playerData,
        timestamp: new Date().toISOString()
      };
      
      console.log(`🔔 WEBSOCKET DEBUG: Sending message to ${hostConnection.ConnectionId}:`, message);
      
      await sendToConnection(hostConnection.ConnectionId, message);
      
      console.log(`✅ WEBSOCKET DEBUG: Host notified successfully of player join: ${playerData.playerName}`);
    } else {
      console.log(`⚠️ WEBSOCKET DEBUG: No host connection found for game ${gameId}`);
      
      // Additional debugging - check what connections exist
      const allConnections = await db.send(new QueryCommand({
        TableName: process.env.TABLE_NAME,
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
        ExpressionAttributeValues: {
          ':pk': `GAME#${gameId}`,
          ':sk': 'CONNECTION#'
        }
      }));
      
      console.log(`🔔 WEBSOCKET DEBUG: All connections for game ${gameId}:`, allConnections.Items);
    }
    
  } catch (error) {
    console.error(`❌ WEBSOCKET DEBUG: Error notifying host of player join:`, error);
    console.error(`❌ WEBSOCKET DEBUG: Error details:`, {
      message: error.message,
      statusCode: error.$response?.statusCode,
      stack: error.stack
    });
    // Don't throw error - this shouldn't block player joining
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
    console.log(`🔔 WEBSOCKET DEBUG: sendToConnection called with connectionId: ${connectionId}`);
    console.log(`🔔 WEBSOCKET DEBUG: Message to send:`, JSON.stringify(message, null, 2));
    
    const command = new PostToConnectionCommand({
      ConnectionId: connectionId,
      Data: JSON.stringify(message)
    });
    
    console.log(`🔔 WEBSOCKET DEBUG: Executing PostToConnectionCommand`);
    const result = await apigateway.send(command);
    console.log(`🔔 WEBSOCKET DEBUG: PostToConnectionCommand result:`, result);
    
  } catch (error) {
    console.error(`❌ WEBSOCKET DEBUG: Failed to send to connection ${connectionId}:`, error);
    console.error(`❌ WEBSOCKET DEBUG: Error type:`, error.constructor.name);
    console.error(`❌ WEBSOCKET DEBUG: Error code:`, error.Code || error.code);
    console.error(`❌ WEBSOCKET DEBUG: Error statusCode:`, error.statusCode || error.$response?.statusCode);
    console.error(`❌ WEBSOCKET DEBUG: Full error object:`, JSON.stringify(error, null, 2));
    
    // Remove stale connections
    if (error.statusCode === 410 || error.$response?.statusCode === 410) {
      console.log(`🧹 WEBSOCKET DEBUG: Removing stale connection ${connectionId} (410 Gone)`);
      // Note: Connection cleanup will be handled by disconnect function
    }
    
    throw error;
  }
}