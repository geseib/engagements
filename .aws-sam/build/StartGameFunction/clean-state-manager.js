const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, PutCommand, GetCommand, QueryCommand } = require('@aws-sdk/lib-dynamodb');
const { sendPlayerMessage } = require('./clean-websocket-utils');

const dynamoClient = new DynamoDBClient({});
const db = DynamoDBDocumentClient.from(dynamoClient);

// TTL Constants
const TTL_ACTIVE_PHASE = 7 * 24 * 60 * 60; // 7 days

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
    
    // Note: Host state changes are now handled by specific functions:
    // - start-question.js sends ASK#Q{n} messages
    // - start-vote.js sends VOTE#Q{n} messages
    // - set-game-state.js sends RESULT#Q{n} and END messages
    console.log(`✅ Host state updated to ${newState} for game ${gameId}`);
    
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
    
    // Send player message to host via new clean WebSocket system
    if (newState.startsWith('ANSWERED/')) {
      const questionNum = questionId || newState.split('/')[1];
      await sendPlayerMessage(gameId, playerName, `ANSWERED#${questionNum}`, {
        questionId: questionNum,
        ...additionalData
      });
    } else if (newState.startsWith('VOTED/')) {
      const questionNum = questionId || newState.split('/')[1];
      await sendPlayerMessage(gameId, playerName, `VOTED#${questionNum}`, {
        questionId: questionNum,
        ...additionalData
      });
    } else if (newState === 'QUIT') {
      await sendPlayerMessage(gameId, playerName, 'QUIT', {
        ...additionalData
      });
    }
    // Note: JOINED messages are handled by the join process, not state updates
    
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
  getCompleteGameState
};
