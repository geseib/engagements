const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, PutCommand, GetCommand, QueryCommand, DeleteCommand } = require('@aws-sdk/lib-dynamodb');
const { ApiGatewayManagementApiClient, PostToConnectionCommand } = require('@aws-sdk/client-apigatewaymanagementapi');

const dynamoClient = new DynamoDBClient({});
const db = DynamoDBDocumentClient.from(dynamoClient);
const apigateway = new ApiGatewayManagementApiClient({
  endpoint: process.env.WEBSOCKET_API_ENDPOINT
});

// TTL Constants
const TTL_CREATION_PHASE = 90 * 24 * 60 * 60; // 90 days
const TTL_ACTIVE_PHASE = 7 * 24 * 60 * 60;    // 7 days

// Create game with proper schema compliance
const createGame = async (gameId, gameData) => {
  try {
    const ttl = Math.floor(Date.now() / 1000) + TTL_CREATION_PHASE;
    const now = new Date().toISOString();
    
    console.log(`🎮 Creating game ${gameId} with schema compliance`);
    
    // 1. Create GAMES list entry (for efficient game listing - DATABASE_DESIGN.md requirement)
    await db.send(new PutCommand({
      TableName: process.env.TABLE_NAME,
      Item: {
        PK: 'GAMES',
        SK: `GAME#${gameId}`,
        Title: gameData.title || 'Engagement Session',
        CreatedAt: now,
        HostName: gameData.hostName || 'Host',
        GameType: gameData.engagementType || 'trivia',
        QuestionSetId: gameData.questionSetId,
        LastPlayedAt: null,
        ttl
      }
    }));
    
    // 2. Create METADATA record (for template compatibility)
    await db.send(new PutCommand({
      TableName: process.env.TABLE_NAME,
      Item: {
        PK: `GAME#${gameId}`,
        SK: 'METADATA',
        Title: gameData.title || 'Engagement Session',
        CreatedAt: now,
        HostName: gameData.hostName || 'Host',
        GameType: gameData.engagementType || 'trivia',
        QuestionSetId: gameData.questionSetId,
        SelectedCategories: gameData.selectedCategories || [],
        HostPreferences: gameData.hostPreferences || {},
        AiContext: gameData.aiContext,
        DebugMode: gameData.debugMode || false,
        LastPlayedAt: null,
        ttl
      }
    }));

    // 3. Create CONTEXT record (for new functions)
    await db.send(new PutCommand({
      TableName: process.env.TABLE_NAME,
      Item: {
        PK: `GAME#${gameId}`,
        SK: 'CONTEXT',
        Title: gameData.title || 'Engagement Session',
        EngagementType: gameData.engagementType || 'trivia',
        QuestionSetId: gameData.questionSetId,
        SelectedCategories: gameData.selectedCategories || [],
        HostPreferences: gameData.hostPreferences || {},
        AiContext: gameData.aiContext,
        DebugMode: gameData.debugMode || false,
        CreatedAt: now,
        UpdatedAt: now,
        ttl
      }
    }));

    // 3. Create initial STATE record
    await db.send(new PutCommand({
      TableName: process.env.TABLE_NAME,
      Item: {
        PK: `GAME#${gameId}`,
        SK: 'STATE',
        HostState: 'LOBBY',
        CurrentQuestionId: null,
        PlayedQuestions: [],
        GameStarted: false,
        UseRandomQuestions: true,
        UseRandomCategories: true,
        CreatedAt: now,
        UpdatedAt: now,
        ttl
      }
    }));
    
    console.log(`✅ Game ${gameId} created with full schema compliance`);
    return true;
  } catch (error) {
    console.error(`❌ Error creating game ${gameId}:`, error);
    throw error;
  }
};

// Add player with proper schema compliance
const addPlayer = async (gameId, playerName, playerData = {}) => {
  try {
    const ttl = Math.floor(Date.now() / 1000) + TTL_ACTIVE_PHASE;
    const now = new Date().toISOString();
    
    console.log(`👤 Adding player ${playerName} to game ${gameId}`);
    
    // 1. Create PLAYER record (for template compatibility and player listing)
    await db.send(new PutCommand({
      TableName: process.env.TABLE_NAME,
      Item: {
        PK: `GAME#${gameId}`,
        SK: `PLAYER#${playerName}`,
        PlayerName: playerName,
        JoinedAt: now,
        TotalScore: 0,
        CurrentRank: 0,
        IsActive: true,
        ttl
      }
    }));
    
    // 2. Create PLAYER#STATE record (for state management)
    await db.send(new PutCommand({
      TableName: process.env.TABLE_NAME,
      Item: {
        PK: `GAME#${gameId}`,
        SK: `PLAYER#${playerName}#STATE`,
        PlayerName: playerName,
        CurrentState: 'JOINED',
        AnsweredQuestions: [],
        VotedQuestions: [],
        TotalScore: 0,
        LastSeenAt: now,
        IsActive: true,
        ttl
      }
    }));
    
    // 3. Broadcast player joined notification
    await broadcastToGame(gameId, {
      type: 'playerJoined',
      gameId,
      playerName,
      playerData: {
        playerName,
        joinedAt: now,
        totalScore: 0,
        isActive: true
      },
      timestamp: now
    });
    
    console.log(`✅ Player ${playerName} added to game ${gameId} with notifications`);
    return true;
  } catch (error) {
    console.error(`❌ Error adding player ${playerName} to game ${gameId}:`, error);
    throw error;
  }
};

// Remove player with proper cleanup
const removePlayer = async (gameId, playerName) => {
  try {
    console.log(`👤 Removing player ${playerName} from game ${gameId}`);
    
    // Delete both player records
    await Promise.all([
      db.send(new DeleteCommand({
        TableName: process.env.TABLE_NAME,
        Key: { PK: `GAME#${gameId}`, SK: `PLAYER#${playerName}` }
      })),
      db.send(new DeleteCommand({
        TableName: process.env.TABLE_NAME,
        Key: { PK: `GAME#${gameId}`, SK: `PLAYER#${playerName}#STATE` }
      }))
    ]);
    
    // Broadcast player left notification
    await broadcastToGame(gameId, {
      type: 'playerLeft',
      gameId,
      playerName,
      timestamp: new Date().toISOString()
    });
    
    console.log(`✅ Player ${playerName} removed from game ${gameId}`);
    return true;
  } catch (error) {
    console.error(`❌ Error removing player ${playerName} from game ${gameId}:`, error);
    throw error;
  }
};

// Get all players (both formats for compatibility)
const getGamePlayers = async (gameId) => {
  try {
    const result = await db.send(new QueryCommand({
      TableName: process.env.TABLE_NAME,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
      ExpressionAttributeValues: {
        ':pk': `GAME#${gameId}`,
        ':sk': 'PLAYER#'
      }
    }));
    
    const players = {};
    result.Items?.forEach(item => {
      const playerName = item.PlayerName;
      if (!players[playerName]) {
        players[playerName] = {};
      }
      
      if (item.SK === `PLAYER#${playerName}`) {
        // Basic player record
        players[playerName] = {
          ...players[playerName],
          playerName,
          joinedAt: item.JoinedAt,
          totalScore: item.TotalScore || 0,
          currentRank: item.CurrentRank || 0,
          isActive: item.IsActive !== false
        };
      } else if (item.SK === `PLAYER#${playerName}#STATE`) {
        // Player state record
        players[playerName] = {
          ...players[playerName],
          currentState: item.CurrentState || 'JOINED',
          answeredQuestions: item.AnsweredQuestions || [],
          votedQuestions: item.VotedQuestions || [],
          lastSeenAt: item.LastSeenAt
        };
      }
    });
    
    return players;
  } catch (error) {
    console.error(`❌ Error getting players for game ${gameId}:`, error);
    return {};
  }
};

// Efficient WebSocket broadcasting (no scans)
const broadcastToGame = async (gameId, message, targetType = 'ALL') => {
  try {
    const connectionsResult = await db.send(new QueryCommand({
      TableName: process.env.TABLE_NAME,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
      ExpressionAttributeValues: {
        ':pk': `GAME#${gameId}`,
        ':sk': 'CONNECTION#'
      }
    }));
    
    const connections = connectionsResult.Items || [];
    console.log(`🔌 Broadcasting to ${connections.length} connections for game ${gameId}:`, message.type);
    
    if (connections.length === 0) {
      console.log(`⚠️ No active connections found for game ${gameId}`);
      return;
    }
    
    // Filter connections based on target type
    let targetConnections = connections;
    if (targetType === 'HOST') {
      targetConnections = connections.filter(conn => conn.IsHost === true);
    } else if (targetType === 'PARTICIPANTS') {
      targetConnections = connections.filter(conn => conn.IsHost !== true);
    }
    
    const broadcastPromises = targetConnections.map(async (connection) => {
      try {
        await apigateway.send(new PostToConnectionCommand({
          ConnectionId: connection.ConnectionId,
          Data: JSON.stringify(message)
        }));
        console.log(`✅ Message sent to connection ${connection.ConnectionId} (${connection.PlayerName || 'Host'})`);
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
    console.log(`✅ Broadcast complete for game ${gameId} (${targetType})`);
  } catch (error) {
    console.error('❌ Broadcast error:', error);
    throw error;
  }
};

module.exports = {
  createGame,
  addPlayer,
  removePlayer,
  getGamePlayers,
  broadcastToGame,
  TTL_CREATION_PHASE,
  TTL_ACTIVE_PHASE
};
