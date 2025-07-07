const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, ScanCommand, DeleteCommand, GetCommand, QueryCommand } = require('@aws-sdk/lib-dynamodb');
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
        
      case 'requestStateSync':
        // Send complete state to requesting client
        if (body.gameId) {
          console.log(`🔄 State sync requested for game ${body.gameId} by ${body.playerName || 'host'}`);

          const completeState = await getCompleteGameState(body.gameId, body.playerName);

          await apigateway.send(new PostToConnectionCommand({
            ConnectionId: connectionId,
            Data: JSON.stringify({
              type: 'completeStateSync',
              gameId: body.gameId,
              timestamp: new Date().toISOString(),
              data: completeState
            })
          }));

          console.log(`✅ State sync sent to ${connectionId}`);
        }
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

// Get complete game state for reconnection
const getCompleteGameState = async (gameId, playerName = null) => {
  try {
    console.log(`🎮 Getting complete state for game ${gameId}, player: ${playerName}`);

    // Get all game-related data in parallel
    const [gameContext, gameState, players, questionProgress] = await Promise.all([
      getGameContext(gameId),
      getGameState(gameId),
      getGamePlayers(gameId),
      getQuestionProgress(gameId)
    ]);

    // Get specific player state if requested
    let playerState = null;
    if (playerName) {
      playerState = await getPlayerState(gameId, playerName);
    }

    const completeState = {
      gameContext,
      gameState,
      players,
      questionProgress,
      playerState,
      timestamp: new Date().toISOString()
    };

    console.log(`✅ Complete state retrieved for game ${gameId}`);
    return completeState;
  } catch (error) {
    console.error(`❌ Error getting complete state for game ${gameId}:`, error);
    throw error;
  }
};

// Get game context (metadata, question set, categories)
const getGameContext = async (gameId) => {
  try {
    const result = await db.send(new GetCommand({
      TableName: process.env.TABLE_NAME,
      Key: { PK: `GAME#${gameId}`, SK: 'CONTEXT' }
    }));

    if (!result.Item) {
      // Fallback to METADATA for backward compatibility
      const metadataResult = await db.send(new GetCommand({
        TableName: process.env.TABLE_NAME,
        Key: { PK: `GAME#${gameId}`, SK: 'METADATA' }
      }));

      if (metadataResult.Item) {
        return {
          title: metadataResult.Item.Title,
          engagementType: metadataResult.Item.EngagementType,
          questionSetId: metadataResult.Item.QuestionSetId,
          selectedCategories: metadataResult.Item.SelectedCategories || [],
          hostPreferences: metadataResult.Item.HostPreferences || {},
          createdAt: metadataResult.Item.CreatedAt,
          createdBy: metadataResult.Item.CreatedBy,
          aiContext: metadataResult.Item.AiContext,
          debugMode: metadataResult.Item.DebugMode || false
        };
      }
    }

    return result.Item || null;
  } catch (error) {
    console.error(`❌ Error getting game context for ${gameId}:`, error);
    return null;
  }
};

// Get current game state
const getGameState = async (gameId) => {
  try {
    const result = await db.send(new GetCommand({
      TableName: process.env.TABLE_NAME,
      Key: { PK: `GAME#${gameId}`, SK: 'STATE' }
    }));

    if (!result.Item) {
      return {
        stage: 'BEGIN',
        state: 'waiting',
        currentQuestionId: null,
        currentQuestionData: null,
        playedQuestions: [],
        totalQuestions: 0
      };
    }

    return {
      stage: result.Item.Stage || 'BEGIN',
      state: result.Item.State || 'waiting',
      currentQuestionId: result.Item.CurrentQuestion,
      currentQuestionData: result.Item.CurrentQuestionData,
      currentQuestionIndex: result.Item.CurrentQuestionIndex,
      playedQuestions: result.Item.PlayedQuestions || [],
      scoredQuestions: result.Item.ScoredQuestions || [],
      usedQuestions: result.Item.UsedQuestions || [],
      totalQuestions: result.Item.TotalQuestions || 0,
      updatedAt: result.Item.UpdatedAt
    };
  } catch (error) {
    console.error(`❌ Error getting game state for ${gameId}:`, error);
    return null;
  }
};

// Get all players and their states
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
      if (item.SK.includes('#STATE')) {
        // Player state record
        const playerName = item.PlayerName;
        players[playerName] = {
          ...players[playerName],
          currentStage: item.CurrentStage || 'JOINED',
          lastQuestionAnswered: item.LastQuestionAnswered,
          lastQuestionVoted: item.LastQuestionVoted,
          answeredQuestions: item.AnsweredQuestions || [],
          votedQuestions: item.VotedQuestions || [],
          lastSeenAt: item.LastSeenAt,
          isActive: item.IsActive !== false
        };
      } else {
        // Player basic record
        const playerName = item.PlayerName || item.SK.replace('PLAYER#', '');
        players[playerName] = {
          ...players[playerName],
          playerName,
          totalScore: item.TotalScore || 0,
          currentRank: item.CurrentRank || 0,
          joinedAt: item.JoinedAt
        };
      }
    });

    return players;
  } catch (error) {
    console.error(`❌ Error getting players for game ${gameId}:`, error);
    return {};
  }
};

// Get question progress for all questions
const getQuestionProgress = async (gameId) => {
  try {
    const result = await db.send(new QueryCommand({
      TableName: process.env.TABLE_NAME,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
      ExpressionAttributeValues: {
        ':pk': `GAME#${gameId}`,
        ':sk': 'QUESTION#'
      }
    }));

    const progress = {};
    result.Items?.forEach(item => {
      if (item.SK.includes('#PROGRESS')) {
        const questionId = item.QuestionId;
        progress[questionId] = {
          playersAnswered: item.PlayersAnswered || [],
          playersVoted: item.PlayersVoted || [],
          answerCount: item.AnswerCount || 0,
          voteCount: item.VoteCount || 0,
          startedAt: item.StartedAt,
          answeringCompletedAt: item.AnsweringCompletedAt,
          votingCompletedAt: item.VotingCompletedAt
        };
      }
    });

    return progress;
  } catch (error) {
    console.error(`❌ Error getting question progress for game ${gameId}:`, error);
    return {};
  }
};

// Get specific player state
const getPlayerState = async (gameId, playerName) => {
  try {
    const result = await db.send(new GetCommand({
      TableName: process.env.TABLE_NAME,
      Key: { PK: `GAME#${gameId}`, SK: `PLAYER#${playerName}#STATE` }
    }));

    if (!result.Item) {
      return {
        playerName,
        currentStage: 'JOINED',
        answeredQuestions: [],
        votedQuestions: [],
        totalScore: 0,
        isActive: true
      };
    }

    return {
      playerName: result.Item.PlayerName,
      currentStage: result.Item.CurrentStage || 'JOINED',
      lastQuestionAnswered: result.Item.LastQuestionAnswered,
      lastQuestionVoted: result.Item.LastQuestionVoted,
      answeredQuestions: result.Item.AnsweredQuestions || [],
      votedQuestions: result.Item.VotedQuestions || [],
      totalScore: result.Item.TotalScore || 0,
      currentRank: result.Item.CurrentRank || 0,
      lastSeenAt: result.Item.LastSeenAt,
      isActive: result.Item.IsActive !== false
    };
  } catch (error) {
    console.error(`❌ Error getting player state for ${playerName} in game ${gameId}:`, error);
    return null;
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
