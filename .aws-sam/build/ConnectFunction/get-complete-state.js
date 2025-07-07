const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, GetCommand, QueryCommand } = require('@aws-sdk/lib-dynamodb');

const dynamoClient = new DynamoDBClient({});
const db = DynamoDBDocumentClient.from(dynamoClient);

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

exports.handler = async (event) => {
  const gameId = event.pathParameters.gameId;
  const playerName = event.pathParameters.playerName || event.queryStringParameters?.playerName;
  
  try {
    if (playerName && event.resource.includes('/players/')) {
      // Get specific player state
      console.log(`🎮 Getting player state for ${playerName} in game ${gameId}`);
      
      const [gameState, playerState] = await Promise.all([
        getGameState(gameId),
        getPlayerState(gameId, playerName)
      ]);
      
      if (!playerState) {
        return {
          statusCode: 404,
          body: JSON.stringify({ error: 'Player not found' }),
          headers: { 'Access-Control-Allow-Origin': '*' }
        };
      }
      
      // Determine player's current capabilities
      const currentQuestionId = gameState.currentQuestionId;
      const hasAnswered = playerState.answeredQuestions.includes(currentQuestionId);
      const hasVoted = playerState.votedQuestions.includes(currentQuestionId);
      
      const response = {
        ...playerState,
        gameStage: gameState.stage,
        currentQuestionId: gameState.currentQuestionId,
        hasAnswered,
        hasVoted,
        canAnswer: gameState.stage === 'ASK' && !hasAnswered,
        canVote: gameState.stage === 'VOTE' && !hasVoted,
        shouldShowResults: gameState.stage === 'RESULTS'
      };
      
      return {
        statusCode: 200,
        body: JSON.stringify(response),
        headers: { 'Access-Control-Allow-Origin': '*' }
      };
    } else {
      // Get complete game state
      console.log(`🎮 Getting complete state for game ${gameId}`);
      
      const completeState = await getCompleteGameState(gameId, playerName);
      
      return {
        statusCode: 200,
        body: JSON.stringify(completeState),
        headers: { 'Access-Control-Allow-Origin': '*' }
      };
    }
  } catch (error) {
    console.error('❌ Get complete state error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Failed to get game state' }),
      headers: { 'Access-Control-Allow-Origin': '*' }
    };
  }
};
