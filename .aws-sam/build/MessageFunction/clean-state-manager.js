const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, PutCommand, GetCommand, QueryCommand, ScanCommand, DeleteCommand } = require('@aws-sdk/lib-dynamodb');
const { ApiGatewayManagementApiClient, PostToConnectionCommand } = require('@aws-sdk/client-apigatewaymanagementapi');

const dynamoClient = new DynamoDBClient({});
const db = DynamoDBDocumentClient.from(dynamoClient);
const apigateway = new ApiGatewayManagementApiClient({
  endpoint: process.env.WEBSOCKET_API_ENDPOINT
});

// TTL Constants
const TTL_ACTIVE_PHASE = 7 * 24 * 60 * 60; // 7 days

// Helper function to broadcast WebSocket message
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
    console.log(`🔌 Broadcasting to ${connections.length} connections for game ${gameId}:`, message);
    
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

// Update host state with WebSocket broadcast
const updateHostState = async (gameId, newState, questionId = null, additionalData = {}) => {
  try {
    const ttl = Math.floor(Date.now() / 1000) + (14 * 24 * 60 * 60);
    
    console.log(`🎮 HOST: Updating state for game ${gameId}: ${newState}${questionId ? ` (${questionId})` : ''}`);
    
    // Get current state to preserve data
    let currentState = {};
    try {
      const result = await db.send(new GetCommand({
        TableName: process.env.TABLE_NAME,
        Key: { PK: `GAME#${gameId}`, SK: 'STATE' }
      }));
      if (result.Item) {
        currentState = result.Item;
      }
    } catch (error) {
      console.log(`📋 No existing state found for game ${gameId}, creating new`);
    }
    
    // Build updated state
    const stateItem = {
      PK: `GAME#${gameId}`,
      SK: 'STATE',
      ...currentState, // Preserve existing data
      HostState: newState,
      UpdatedAt: new Date().toISOString(),
      ttl,
      ...additionalData
    };

    if (questionId) {
      stateItem.CurrentQuestionId = questionId;
    }
    
    // Update played questions list
    if (questionId && newState.startsWith('ASK/')) {
      const playedQuestions = currentState.PlayedQuestions || [];
      if (!playedQuestions.includes(questionId)) {
        stateItem.PlayedQuestions = [...playedQuestions, questionId];
      }
    }
    
    await db.send(new PutCommand({
      TableName: process.env.TABLE_NAME,
      Item: stateItem
    }));
    
    // Determine WebSocket message type and broadcast
    let messageType = 'hostStateChanged';
    let targetType = 'ALL';
    
    if (newState === 'LOBBY') {
      messageType = 'gameCreated';
      targetType = 'ALL';
    } else if (newState.startsWith('ASK/')) {
      messageType = 'questionStarted';
      targetType = 'PARTICIPANTS';
    } else if (newState.startsWith('VOTE/')) {
      messageType = 'votingStarted';
      targetType = 'PARTICIPANTS';
    } else if (newState.startsWith('RESULTS/')) {
      messageType = 'resultsReady';
      targetType = 'PARTICIPANTS';
    } else if (newState === 'END') {
      messageType = 'gameEnded';
      targetType = 'ALL';
    }
    
    // Broadcast state change
    await broadcastToGame(gameId, {
      type: messageType,
      gameId,
      hostState: newState,
      questionId,
      timestamp: new Date().toISOString(),
      ...additionalData
    }, targetType);
    
    console.log(`✅ HOST: State updated successfully for game ${gameId}: ${newState}`);
    return stateItem;
  } catch (error) {
    console.error(`❌ Error updating host state for game ${gameId}:`, error);
    throw error;
  }
};

// Update player state with WebSocket broadcast
const updatePlayerState = async (gameId, playerName, newState, questionId = null, additionalData = {}) => {
  try {
    const ttl = Math.floor(Date.now() / 1000) + (14 * 24 * 60 * 60);
    
    console.log(`👤 PLAYER: Updating state for ${playerName} in game ${gameId}: ${newState}${questionId ? ` (${questionId})` : ''}`);
    
    // Get current player state
    let currentPlayerState = {};
    try {
      const result = await db.send(new GetCommand({
        TableName: process.env.TABLE_NAME,
        Key: { PK: `GAME#${gameId}`, SK: `PLAYER#${playerName}#STATE` }
      }));
      if (result.Item) {
        currentPlayerState = result.Item;
      }
    } catch (error) {
      console.log(`📋 No existing player state found for ${playerName}, creating new`);
    }
    
    // Build updated player state
    const playerStateItem = {
      PK: `GAME#${gameId}`,
      SK: `PLAYER#${playerName}#STATE`,
      ...currentPlayerState, // Preserve existing data
      PlayerName: playerName,
      CurrentState: newState,
      LastSeenAt: new Date().toISOString(),
      ttl,
      ...additionalData
    };
    
    // Update question-specific arrays
    if (questionId) {
      if (newState.startsWith('ANSWERED/')) {
        const answeredQuestions = currentPlayerState.AnsweredQuestions || [];
        if (!answeredQuestions.includes(questionId)) {
          playerStateItem.AnsweredQuestions = [...answeredQuestions, questionId];
        }
      } else if (newState.startsWith('VOTED/')) {
        const votedQuestions = currentPlayerState.VotedQuestions || [];
        if (!votedQuestions.includes(questionId)) {
          playerStateItem.VotedQuestions = [...votedQuestions, questionId];
        }
      }
    }
    
    await db.send(new PutCommand({
      TableName: process.env.TABLE_NAME,
      Item: playerStateItem
    }));
    
    // Determine WebSocket message type
    let messageType = 'playerStateChanged';
    if (newState === 'JOINED') {
      messageType = 'playerJoined';
    } else if (newState.startsWith('ANSWERED/')) {
      messageType = 'playerAnswered';
    } else if (newState.startsWith('VOTED/')) {
      messageType = 'playerVoted';
    } else if (newState === 'QUIT') {
      messageType = 'playerQuit';
    }
    
    // Broadcast to host (and other participants for some events)
    await broadcastToGame(gameId, {
      type: messageType,
      gameId,
      playerName,
      playerState: newState,
      questionId,
      timestamp: new Date().toISOString(),
      ...additionalData
    }, 'HOST');
    
    console.log(`✅ PLAYER: State updated successfully for ${playerName} in game ${gameId}: ${newState}`);
    return playerStateItem;
  } catch (error) {
    console.error(`❌ Error updating player state for ${playerName} in game ${gameId}:`, error);
    throw error;
  }
};

// Get complete game state for reconnection
const getCompleteGameState = async (gameId) => {
  try {
    console.log(`🔄 Getting complete state for game ${gameId}`);
    
    const [gameContext, gameState, playerStates] = await Promise.all([
      getGameContext(gameId),
      getGameState(gameId),
      getAllPlayerStates(gameId)
    ]);
    
    return {
      gameContext,
      gameState,
      playerStates,
      timestamp: new Date().toISOString()
    };
  } catch (error) {
    console.error(`❌ Error getting complete state for game ${gameId}:`, error);
    throw error;
  }
};

// Helper functions
const getGameContext = async (gameId) => {
  try {
    const result = await db.send(new GetCommand({
      TableName: process.env.TABLE_NAME,
      Key: { PK: `GAME#${gameId}`, SK: 'CONTEXT' }
    }));
    return result.Item || null;
  } catch (error) {
    console.error(`❌ Error getting game context for ${gameId}:`, error);
    return null;
  }
};

const getGameState = async (gameId) => {
  try {
    const result = await db.send(new GetCommand({
      TableName: process.env.TABLE_NAME,
      Key: { PK: `GAME#${gameId}`, SK: 'STATE' }
    }));
    return result.Item || { HostState: 'LOBBY', PlayedQuestions: [] };
  } catch (error) {
    console.error(`❌ Error getting game state for ${gameId}:`, error);
    return { HostState: 'LOBBY', PlayedQuestions: [] };
  }
};

const getAllPlayerStates = async (gameId) => {
  try {
    const result = await db.send(new QueryCommand({
      TableName: process.env.TABLE_NAME,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
      ExpressionAttributeValues: {
        ':pk': `GAME#${gameId}`,
        ':sk': 'PLAYER#'
      }
    }));
    
    const playerStates = {};
    result.Items?.forEach(item => {
      if (item.SK.includes('#STATE')) {
        playerStates[item.PlayerName] = item;
      }
    });
    
    return playerStates;
  } catch (error) {
    console.error(`❌ Error getting player states for game ${gameId}:`, error);
    return {};
  }
};

module.exports = {
  updateHostState,
  updatePlayerState,
  getCompleteGameState,
  broadcastToGame
};
