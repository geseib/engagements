const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, GetCommand, QueryCommand } = require('@aws-sdk/lib-dynamodb');

const client = new DynamoDBClient({});
const db = DynamoDBDocumentClient.from(client);

exports.handler = async (event) => {
  // Handle CORS preflight
  if (event.requestContext?.http?.method === 'OPTIONS' || event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type'
      },
      body: ''
    };
  }

  try {
    const { gameId, playerId } = event.pathParameters || {};

    if (!gameId) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Game ID is required' }),
        headers: { 'Access-Control-Allow-Origin': '*' }
      };
    }

    // Get game metadata
    const gameMetadata = await db.send(new GetCommand({
      TableName: process.env.TABLE_NAME,
      Key: { PK: `GAME#${gameId}`, SK: 'METADATA' }
    }));

    if (!gameMetadata.Item) {
      return {
        statusCode: 404,
        body: JSON.stringify({ error: 'Game not found' }),
        headers: { 'Access-Control-Allow-Origin': '*' }
      };
    }

    // Get game state
    const gameState = await db.send(new GetCommand({
      TableName: process.env.TABLE_NAME,
      Key: { PK: `GAME#${gameId}`, SK: 'STATE' }
    }));

    // Extract state information from the current schema
    const stateItem = gameState.Item;
    const currentState = stateItem?.State || 'CREATED';
    const lessonNumber = stateItem?.LessonNumber || 0;
    let currentQuestionData = null;
    
    // Use the actual state directly (ASK#001, VOTE#001, etc.)
    const frontendState = currentState;
    // Try to get question number from LessonNumber, CurrentQuestionId is the source question ID
    const currentQuestionId = stateItem?.CurrentQuestionId;
    const currentQuestionNumber = lessonNumber > 0 ? String(lessonNumber).padStart(3, '0') : null;
    
    console.log(`📊 GET-STATE: currentState=${currentState}, lessonNumber=${lessonNumber}, questionNumber=${currentQuestionNumber}`);

    // If we're in a question state (ASK#, VOTE#, or RESULTS#) but don't have question data, fetch it
    if ((frontendState.startsWith('ASK#') || frontendState.startsWith('VOTE#') || frontendState.startsWith('RESULTS#')) && currentQuestionNumber && !currentQuestionData) {
      console.log(`🔍 Fetching question data for question ${currentQuestionNumber}`);
      
      try {
        // Get question reference record
        const questionRef = await db.send(new GetCommand({
          TableName: process.env.TABLE_NAME,
          Key: { PK: `GAME#${gameId}`, SK: `QUESTION#${currentQuestionNumber}#REF` }
        }));

        if (questionRef.Item) {
          const sourceQuestionId = questionRef.Item.SourceQuestionId;
          const questionSetId = questionRef.Item.SetId;
          
          // Get the actual question from the question set
          const question = await db.send(new GetCommand({
            TableName: process.env.TABLE_NAME,
            Key: { 
              PK: `SET#${questionSetId}`, 
              SK: sourceQuestionId 
            }
          }));

          if (question.Item) {
            currentQuestionData = {
              id: currentQuestionNumber,
              questionNumber: currentQuestionNumber,
              title: question.Item.Title || '',
              detail: question.Item.Detail || '',
              questionDetail: question.Item.Detail || '',
              category: question.Item.Category,
              field: question.Item.Category,
              school: question.Item.School || '',
              customInstructions: question.Item.CustomInstructions || '',
              setId: questionSetId,
              startedAt: questionRef.Item.StartedAt,
              // For trivia questions (check both cases)
              optionA: question.Item.optionA || question.Item.OptionA || '',
              optionB: question.Item.optionB || question.Item.OptionB || '',
              optionC: question.Item.optionC || question.Item.OptionC || '',
              optionD: question.Item.optionD || question.Item.OptionD || '',
              optionE: question.Item.optionE || question.Item.OptionE || '',
              optionF: question.Item.optionF || question.Item.OptionF || '',
              correctAnswer: question.Item.correctAnswer,
              points: question.Item.points || 10
            };
            
            console.log(`✅ Fetched question data for question ${currentQuestionNumber}: ${currentQuestionData.title}`);
          } else {
            console.warn(`❌ Question not found: ${sourceQuestionId} from set ${questionSetId}`);
          }
        } else {
          console.warn(`❌ Question reference not found: QUESTION#${currentQuestionNumber}#REF`);
        }
      } catch (error) {
        console.error(`❌ Error fetching question data for question ${currentQuestionNumber}:`, error);
      }
    }

    const response = {
      gameId: gameId,
      state: frontendState,
      currentQuestion: lessonNumber, // Return numeric lesson number for frontend
      currentQuestionData: currentQuestionData,
      gameType: gameMetadata.Item.GameType || 'call-and-answer',
      gameMetadata: {
        title: gameMetadata.Item.Title,
        hostName: gameMetadata.Item.HostName,
        gameType: gameMetadata.Item.GameType || 'call-and-answer',
        questionSetId: gameMetadata.Item.QuestionSetId,
        selectedCategories: gameMetadata.Item.SelectedCategories || [],
        createdAt: gameMetadata.Item.CreatedAt
      }
    };

    // If playerId is provided, get player-specific state
    if (playerId) {
      const playerData = await db.send(new GetCommand({
        TableName: process.env.TABLE_NAME,
        Key: { PK: `GAME#${gameId}`, SK: `PLAYER#${playerId}` }
      }));

      if (!playerData.Item) {
        return {
          statusCode: 404,
          body: JSON.stringify({ error: 'Player not found in this game' }),
          headers: { 'Access-Control-Allow-Origin': '*' }
        };
      }

      // Get player's current total score from the score record (single source of truth)
      const playerScoreRecord = await db.send(new GetCommand({
        TableName: process.env.TABLE_NAME,
        Key: { 
          PK: `GAME#${gameId}`, 
          SK: `PLAYER#${playerId}#SCORE` 
        }
      }));

      const currentTotalScore = playerScoreRecord.Item ? playerScoreRecord.Item.score || 0 : 0;

      response.playerData = {
        playerId: playerId,
        playerName: playerData.Item.PlayerName,
        totalScore: currentTotalScore,
        joinedAt: playerData.Item.JoinedAt
      };

      // Check player's participation in current question
      if (currentQuestionNumber) {
        const questionNumberStr = currentQuestionNumber.toString().padStart(3, '0');
        
        // Check if player answered
        const playerAnswer = await db.send(new GetCommand({
          TableName: process.env.TABLE_NAME,
          Key: { 
            PK: `GAME#${gameId}`, 
            SK: `QUESTION#${questionNumberStr}#ANSWER#${playerId}` 
          }
        }));

        // Check if player voted
        const playerVote = await db.send(new GetCommand({
          TableName: process.env.TABLE_NAME,
          Key: { 
            PK: `GAME#${gameId}`, 
            SK: `QUESTION#${questionNumberStr}#VOTE#${playerId}` 
          }
        }));

        response.playerQuestionState = {
          questionNumber: currentQuestionNumber,
          hasAnswered: !!playerAnswer.Item,
          hasVoted: !!playerVote.Item
        };
      }
    }

    // If host is requesting, get additional host-specific data
    if (!playerId || event.queryStringParameters?.includeHostData === 'true') {
      // Get voting progress if in voting state
      if (frontendState.startsWith('VOTE#') && currentQuestionNumber) {
        const questionNumberStr = currentQuestionNumber.toString().padStart(3, '0');
        
        // Get all votes for current question
        const votesResult = await db.send(new QueryCommand({
          TableName: process.env.TABLE_NAME,
          KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
          ExpressionAttributeValues: {
            ':pk': `GAME#${gameId}`,
            ':sk': `QUESTION#${questionNumberStr}#VOTE#`
          }
        }));

        // Get all players to calculate voting progress
        const playersResult = await db.send(new QueryCommand({
          TableName: process.env.TABLE_NAME,
          KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
          ExpressionAttributeValues: {
            ':pk': `GAME#${gameId}`,
            ':sk': 'PLAYER#'
          }
        }));

        // Deduplicate players by name, keeping the most recent record (same logic as get-players.js)
        let players = (playersResult.Items || []).filter(player => {
          const playerName = player.PlayerName || player.playerName;
          if (!playerName) {
            console.log(`⚠️ Filtering out player record with no name:`, player);
            return false;
          }
          return true;
        });

        const playerMap = new Map();
        players.forEach(player => {
          const playerName = player.PlayerName || player.playerName;
          const existing = playerMap.get(playerName);
          
          if (!existing || (player.JoinedAt && (!existing.JoinedAt || player.JoinedAt > existing.JoinedAt))) {
            playerMap.set(playerName, player);
          }
        });
        
        const uniquePlayers = Array.from(playerMap.values());
        console.log(`✅ Game state voting progress: ${uniquePlayers.length} unique players after deduplication`);

        response.votingProgress = {
          votesReceived: votesResult.Items?.length || 0,
          totalPlayers: uniquePlayers.length,
          votersIds: (votesResult.Items || []).map(vote => vote.PlayerName)
        };
      }

      // Get answer progress if in answer state
      if (frontendState.startsWith('ASK#') && currentQuestionNumber) {
        const questionNumberStr = currentQuestionNumber.toString().padStart(3, '0');
        
        // Get all answers for current question
        const answersResult = await db.send(new QueryCommand({
          TableName: process.env.TABLE_NAME,
          KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
          ExpressionAttributeValues: {
            ':pk': `GAME#${gameId}`,
            ':sk': `QUESTION#${questionNumberStr}#ANSWER#`
          }
        }));

        // Get all players to calculate answer progress
        const playersResult = await db.send(new QueryCommand({
          TableName: process.env.TABLE_NAME,
          KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
          ExpressionAttributeValues: {
            ':pk': `GAME#${gameId}`,
            ':sk': 'PLAYER#'
          }
        }));

        // Deduplicate players by name, keeping the most recent record (same logic as get-players.js)
        let players = (playersResult.Items || []).filter(player => {
          const playerName = player.PlayerName || player.playerName;
          if (!playerName) {
            console.log(`⚠️ Filtering out player record with no name:`, player);
            return false;
          }
          return true;
        });

        const playerMap = new Map();
        players.forEach(player => {
          const playerName = player.PlayerName || player.playerName;
          const existing = playerMap.get(playerName);
          
          if (!existing || (player.JoinedAt && (!existing.JoinedAt || player.JoinedAt > existing.JoinedAt))) {
            playerMap.set(playerName, player);
          }
        });
        
        const uniquePlayers = Array.from(playerMap.values());
        console.log(`✅ Game state answer progress: ${uniquePlayers.length} unique players after deduplication`);

        response.answerProgress = {
          answersReceived: answersResult.Items?.length || 0,
          totalPlayers: uniquePlayers.length,
          answererIds: (answersResult.Items || []).map(answer => answer.PlayerName)
        };
      }
    }

    return {
      statusCode: 200,
      body: JSON.stringify(response),
      headers: { 'Access-Control-Allow-Origin': '*' }
    };

  } catch (error) {
    console.error('Get game state error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: `Failed to get game state: ${error.message}` }),
      headers: { 'Access-Control-Allow-Origin': '*' }
    };
  }
};