const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, GetCommand, QueryCommand, PutCommand, UpdateCommand } = require('@aws-sdk/lib-dynamodb');

const client = new DynamoDBClient({});
const db = DynamoDBDocumentClient.from(client);

exports.handler = async (event) => {
  try {
    // Handle POST request with body containing gameId and questionNumber
    const body = JSON.parse(event.body || '{}');
    const { gameId, questionNumber } = body;
    
    if (!gameId) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Game ID is required' }),
        headers: { 'Access-Control-Allow-Origin': '*' }
      };
    }

    console.log(`📊 Getting results for game ${gameId}, questionNumber: ${questionNumber}`);

    let targetQuestionId = questionNumber;
    
    // If no specific question ID provided, get current question from game state
    if (!targetQuestionId) {
      const gameState = await db.send(new GetCommand({
        TableName: process.env.TABLE_NAME,
        Key: { PK: `GAME#${gameId}`, SK: 'STATE' }
      }));

      if (!gameState.Item) {
        return {
          statusCode: 404,
          body: JSON.stringify({ error: 'Game not found' }),
          headers: { 'Access-Control-Allow-Origin': '*' }
        };
      }

      targetQuestionId = gameState.Item.CurrentQuestionId;
      
      if (!targetQuestionId) {
        return {
          statusCode: 400,
          body: JSON.stringify({ 
            error: 'No current question',
            message: 'No question is currently active'
          }),
          headers: { 'Access-Control-Allow-Origin': '*' }
        };
      }
    }

    console.log(`🎯 Calculating results for question: ${targetQuestionId}`);

    // Get game metadata for scoring configuration
    const gameMetadata = await db.send(new GetCommand({
      TableName: process.env.TABLE_NAME,
      Key: { PK: `GAME#${gameId}`, SK: 'METADATA' }
    }));

    // Extract scoring configuration with defaults
    const scoringConfig = gameMetadata.Item?.ScoringConfig || {
      firstPlacePoints: 3,
      secondPlacePoints: 2,
      thirdPlacePoints: 1,
      participationPoints: 0
    };
    
    console.log(`🏆 Using scoring config:`, scoringConfig);

    // Get all votes for this question
    const paddedQuestionId = String(targetQuestionId).padStart(3, '0');
    const votesQuery = await db.send(new QueryCommand({
      TableName: process.env.TABLE_NAME,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
      ExpressionAttributeValues: {
        ':pk': `GAME#${gameId}`,
        ':sk': `QUESTION#${paddedQuestionId}#VOTE#`
      }
    }));

    const votes = votesQuery.Items || [];
    console.log(`📊 Found ${votes.length} votes for question ${paddedQuestionId}`);

    if (votes.length === 0) {
      return {
        statusCode: 200,
        body: JSON.stringify({
          gameId: gameId,
          questionId: paddedQuestionId,
          message: 'No votes found for this question',
          totalVotes: 0,
          winners: [],
          voteTallies: {},
          timestamp: new Date().toISOString()
        }),
        headers: { 'Access-Control-Allow-Origin': '*' }
      };
    }

    // Get all answers for this question to map vote indices to answers
    const answersQuery = await db.send(new QueryCommand({
      TableName: process.env.TABLE_NAME,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
      ExpressionAttributeValues: {
        ':pk': `GAME#${gameId}`,
        ':sk': `QUESTION#${paddedQuestionId}#ANSWER#`
      }
    }));

    const answers = answersQuery.Items || [];
    console.log(`📋 Found ${answers.length} answers for question ${paddedQuestionId}`);

    // Calculate vote tallies
    const voteTallies = {};
    const answerScores = {};

    // Initialize scores for each answer
    answers.forEach((answer, index) => {
      answerScores[index] = 0;
      voteTallies[index] = {
        answerText: answer.Answer,
        playerName: answer.PlayerName,
        firstPlace: 0,
        secondPlace: 0,
        thirdPlace: 0,
        totalScore: 0
      };
    });

    // Process each vote
    votes.forEach(vote => {
      const voteData = vote.Votes; // e.g., {"0": 1, "1": 2, "2": 3}
      
      Object.entries(voteData).forEach(([answerIndex, rank]) => {
        const idx = parseInt(answerIndex);
        const position = parseInt(rank);
        
        if (voteTallies[idx]) {
          // Award points using configurable scoring system
          let points = 0;
          if (position === 1) {
            voteTallies[idx].firstPlace++;
            points = scoringConfig.firstPlacePoints;
          } else if (position === 2) {
            voteTallies[idx].secondPlace++;
            points = scoringConfig.secondPlacePoints;
          } else if (position === 3) {
            voteTallies[idx].thirdPlace++;
            points = scoringConfig.thirdPlacePoints;
          }
          
          voteTallies[idx].totalScore += points;
          answerScores[idx] += points;
        }
      });
    });

    // Find winners (highest score)
    const maxScore = Math.max(...Object.values(answerScores));
    const winners = [];
    
    Object.entries(answerScores).forEach(([index, score]) => {
      if (score === maxScore && voteTallies[index]) {
        winners.push({
          playerName: voteTallies[index].playerName,
          answerText: voteTallies[index].answerText,
          score: score
        });
      }
    });

    // Update game state to results (preserve LessonNumber!)
    console.log(`🏷️ Updating game state to RESULTS#${paddedQuestionId}`);
    await db.send(new UpdateCommand({
      TableName: process.env.TABLE_NAME,
      Key: { PK: `GAME#${gameId}`, SK: 'STATE' },
      UpdateExpression: 'SET #state = :state, #currentQuestionId = :questionId, #started = :started, #updatedAt = :updatedAt',
      ExpressionAttributeNames: {
        '#state': 'State',
        '#currentQuestionId': 'CurrentQuestionId', 
        '#started': 'Started',
        '#updatedAt': 'UpdatedAt'
      },
      ExpressionAttributeValues: {
        ':state': `RESULTS#${paddedQuestionId}`,
        ':questionId': paddedQuestionId,
        ':started': true,
        ':updatedAt': new Date().toISOString()
      }
    }));

    // Update player scores using simplified PLAYER#{playerName}#SCORE architecture
    console.log(`🏆 Updating player scores for ${gameId} using simplified score records`);
    const playerUpdatePromises = Object.entries(voteTallies).map(async ([index, tally]) => {
      if (tally.playerName && tally.totalScore > 0) {
        try {
          // Use playerName directly in score key for simplicity
          const scoreKey = `PLAYER#${tally.playerName}#SCORE`;
          
          // Check current score record
          const currentScoreRecord = await db.send(new GetCommand({
            TableName: process.env.TABLE_NAME,
            Key: { 
              PK: `GAME#${gameId}`, 
              SK: scoreKey
            }
          }));

          let currentScore = 0;
          let lastRound = null;

          if (currentScoreRecord.Item) {
            currentScore = currentScoreRecord.Item.score || 0;
            lastRound = currentScoreRecord.Item.afterRound;
            console.log(`📊 Found existing score record for ${tally.playerName}: ${currentScore} points from round ${lastRound}`);
            
            // Check if this round was already scored
            if (lastRound === paddedQuestionId) {
              console.log(`⚠️ Player ${tally.playerName} already scored for round ${paddedQuestionId}, skipping update`);
              return;
            }
          } else {
            console.log(`📊 No existing score record found for ${tally.playerName}, starting with 0 points`);
          }

          const newScore = currentScore + tally.totalScore;
          console.log(`🧮 Score update for ${tally.playerName}: ${currentScore} + ${tally.totalScore} = ${newScore} (round ${paddedQuestionId})`);

          // Update consolidated score record
          await db.send(new PutCommand({
            TableName: process.env.TABLE_NAME,
            Item: {
              PK: `GAME#${gameId}`,
              SK: scoreKey,
              PlayerName: tally.playerName,
              score: newScore,
              afterRound: paddedQuestionId,
              updatedAt: new Date().toISOString(),
              ttl: Math.floor(Date.now() / 1000) + (30 * 24 * 60 * 60) // 30 days TTL
            }
          }));

          // Note: Removed duplicate player record update to maintain single source of truth
          // All score queries should use the consolidated PLAYER#{playerName}#SCORE record

          console.log(`✅ Updated ${tally.playerName} score: ${currentScore} → ${newScore} (round ${paddedQuestionId})`);
        } catch (error) {
          console.error(`❌ Failed to update score for ${tally.playerName}:`, error);
        }
      }
    });

    await Promise.all(playerUpdatePromises);

    const result = {
      gameId: gameId,
      questionId: paddedQuestionId,
      voteTallies: voteTallies,
      winners: winners,
      totalVotes: votes.length,
      maxScore: maxScore,
      timestamp: new Date().toISOString()
    };

    // Store question results record for report generation
    await db.send(new PutCommand({
      TableName: process.env.TABLE_NAME,
      Item: {
        PK: `GAME#${gameId}`,
        SK: `QUESTION#${paddedQuestionId}#RESULTS`,
        GameId: gameId,
        QuestionId: paddedQuestionId,
        Winners: winners.map(w => w.playerName),
        VoteTallies: voteTallies,
        MaxVotes: maxScore,
        TotalVotes: votes.length,
        CompletedAt: new Date().toISOString(),
        ttl: Math.floor(Date.now() / 1000) + (30 * 24 * 60 * 60) // 30 days TTL
      }
    }));

    console.log(`✅ Calculated results for ${gameId}: ${winners.length} winner(s) with ${maxScore} points`);
    return {
      statusCode: 200,
      body: JSON.stringify(result),
      headers: { 'Access-Control-Allow-Origin': '*' }
    };

  } catch (error) {
    console.error('Get results error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: `Failed to get results: ${error.message}` }),
      headers: { 'Access-Control-Allow-Origin': '*' }
    };
  }
};