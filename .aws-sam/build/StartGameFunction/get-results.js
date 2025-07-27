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

    // Check game type to determine results logic
    const gameMetadata = await db.send(new GetCommand({
      TableName: process.env.TABLE_NAME,
      Key: { PK: `GAME#${gameId}`, SK: 'METADATA' }
    }));

    const gameType = gameMetadata.Item?.GameType || 'call-and-answer';
    console.log(`🎮 Game type: ${gameType}`);

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

    // Handle trivia results differently from call-and-answer
    if (gameType === 'trivia') {
      return await handleTriviaResults(gameId, targetQuestionId);
    }
    
    // Handle wavelength results with word comparison logic
    if (gameType === 'wavelength') {
      return await handleWavelengthResults(gameId, targetQuestionId);
    }

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
    
    // Get the current lesson number from the paddedQuestionId
    const lessonNumber = parseInt(paddedQuestionId);
    console.log(`📊 Setting LessonNumber to ${lessonNumber} for RESULTS#${paddedQuestionId}`);
    
    await db.send(new UpdateCommand({
      TableName: process.env.TABLE_NAME,
      Key: { PK: `GAME#${gameId}`, SK: 'STATE' },
      UpdateExpression: 'SET #state = :state, #currentQuestionId = :questionId, #lessonNumber = :lessonNumber, #started = :started, #updatedAt = :updatedAt',
      ExpressionAttributeNames: {
        '#state': 'State',
        '#currentQuestionId': 'CurrentQuestionId', 
        '#lessonNumber': 'LessonNumber',
        '#started': 'Started',
        '#updatedAt': 'UpdatedAt'
      },
      ExpressionAttributeValues: {
        ':state': `RESULTS#${paddedQuestionId}`,
        ':questionId': paddedQuestionId,
        ':lessonNumber': lessonNumber,
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

/**
 * Handle trivia results - show all answers with correctness and scoring
 */
async function handleTriviaResults(gameId, questionId) {
  try {
    console.log(`🧠 Handling trivia results for game ${gameId}, question ${questionId}`);
    
    const paddedQuestionId = String(questionId).padStart(3, '0');
    
    // First, get the question data for trivia results using the proper lookup method
    console.log(`🔍 Fetching question data for trivia results using question reference`);
    let question = null;
    try {
      // Get question reference record (same as get-question.js)
      const questionRef = await db.send(new GetCommand({
        TableName: process.env.TABLE_NAME,
        Key: { PK: `GAME#${gameId}`, SK: `QUESTION#${paddedQuestionId}#REF` }
      }));

      if (questionRef.Item) {
        const sourceQuestionId = questionRef.Item.SourceQuestionId;
        const questionSetId = questionRef.Item.SetId;
        
        console.log(`📋 Found question reference: ${sourceQuestionId} from set ${questionSetId}`);

        // Get the actual question from the question set (same as get-question.js)
        const questionResponse = await db.send(new GetCommand({
          TableName: process.env.TABLE_NAME,
          Key: { 
            PK: `SET#${questionSetId}`, 
            SK: sourceQuestionId 
          }
        }));

        question = questionResponse.Item;
        console.log(`📋 Question data fetched from question set:`, question ? 'Success' : 'Not found');
      } else {
        console.log(`❌ Question reference not found: QUESTION#${paddedQuestionId}#REF`);
      }
    } catch (error) {
      console.error(`❌ Error fetching question data:`, error);
    }
  
  // Get all answers for this trivia question (same location as call-and-answer)
  console.log(`🔍 TRIVIA QUERY DEBUG: Searching for answers with PK='GAME#${gameId}' and SK begins_with 'QUESTION#${paddedQuestionId}#ANSWER#'`);
  
  const answersQuery = await db.send(new QueryCommand({
    TableName: process.env.TABLE_NAME,
    KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
    ExpressionAttributeValues: {
      ':pk': `GAME#${gameId}`,
      ':sk': `QUESTION#${paddedQuestionId}#ANSWER#`
    }
  }));

  const answers = answersQuery.Items || [];
  console.log(`🎯 Found ${answers.length} trivia answers for question ${paddedQuestionId}`);
  
  if (answers.length > 0) {
    console.log(`📋 TRIVIA ANSWERS FOUND:`, answers.map(a => ({
      playerName: a.PlayerName,
      answer: a.Answer,
      isCorrect: a.IsCorrect,
      pointsEarned: a.PointsEarned
    })));
  } else {
    console.log(`❌ NO TRIVIA ANSWERS FOUND - Expected answers with SK pattern: QUESTION#${paddedQuestionId}#ANSWER#[playerName]`);
  }

  if (answers.length === 0) {
    return {
      statusCode: 200,
      body: JSON.stringify({
        gameId: gameId,
        questionId: paddedQuestionId,
        gameType: 'trivia',
        message: 'No answers found for this trivia question',
        totalAnswers: 0,
        correctAnswers: 0,
        answers: [],
        leaderboard: [],
        timestamp: new Date().toISOString()
      }),
      headers: { 'Access-Control-Allow-Origin': '*' }
    };
  }

  // Sort answers by points earned (highest first), then by response time (fastest first)
  const sortedAnswers = answers.sort((a, b) => {
    if (b.PointsEarned !== a.PointsEarned) {
      return (b.PointsEarned || 0) - (a.PointsEarned || 0);
    }
    // If points are equal, faster response wins
    return (a.ResponseTimeMs || 999999) - (b.ResponseTimeMs || 999999);
  });

  // Calculate stats
  const correctAnswers = answers.filter(answer => answer.IsCorrect);
  const totalPoints = answers.reduce((sum, answer) => sum + (answer.PointsEarned || 0), 0);
  const averageResponseTime = answers.reduce((sum, answer) => sum + (answer.ResponseTimeMs || 0), 0) / answers.length;

  // Create leaderboard for this question
  const leaderboard = sortedAnswers.map((answer, index) => ({
    rank: index + 1,
    playerName: answer.PlayerName,
    answer: answer.Answer,
    isCorrect: answer.IsCorrect || false,
    pointsEarned: answer.PointsEarned || 0,
    basePoints: answer.BasePoints || 0,
    speedBonus: answer.SpeedBonus || 0,
    responseTimeMs: answer.ResponseTimeMs || 0,
    responseTimeSeconds: Math.round((answer.ResponseTimeMs || 0) / 1000 * 10) / 10,
    submittedAt: answer.SubmittedAt
  }));

  console.log(`🏆 Trivia results: ${correctAnswers.length}/${answers.length} correct, total points: ${totalPoints}`);
  console.log(`🔍 TRIVIA DEBUG: Question object available: ${!!question}`);
  if (question) {
    console.log(`🔍 TRIVIA DEBUG: Question fields - title: ${question.title || question.Title}, correctAnswer: ${question.correctAnswer || question.CorrectAnswer}`);
  }

  // Update player scores for trivia results
  console.log(`🏆 Updating player scores for trivia game ${gameId} using individual answer records`);
  const playerUpdatePromises = answers.map(async (answer) => {
    if (answer.PlayerName && answer.PointsEarned > 0) {
      try {
        const scoreKey = `PLAYER#${answer.PlayerName}#SCORE`;
        
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
          console.log(`📊 Found existing score record for ${answer.PlayerName}: ${currentScore} points from round ${lastRound}`);
          
          // Check if this round was already scored
          if (lastRound === paddedQuestionId) {
            console.log(`⚠️ Player ${answer.PlayerName} already scored for round ${paddedQuestionId}, skipping update`);
            return;
          }
        } else {
          console.log(`📊 No existing score record found for ${answer.PlayerName}, starting with 0 points`);
        }

        const newScore = currentScore + answer.PointsEarned;
        console.log(`🧮 Score update for ${answer.PlayerName}: ${currentScore} + ${answer.PointsEarned} = ${newScore} (round ${paddedQuestionId})`);

        // Update consolidated score record
        await db.send(new PutCommand({
          TableName: process.env.TABLE_NAME,
          Item: {
            PK: `GAME#${gameId}`,
            SK: scoreKey,
            PlayerName: answer.PlayerName,
            score: newScore,
            afterRound: paddedQuestionId,
            updatedAt: new Date().toISOString(),
            ttl: Math.floor(Date.now() / 1000) + (30 * 24 * 60 * 60) // 30 days TTL
          }
        }));

        console.log(`✅ Updated ${answer.PlayerName} score: ${currentScore} → ${newScore} (round ${paddedQuestionId})`);
      } catch (error) {
        console.error(`❌ Failed to update score for ${answer.PlayerName}:`, error);
      }
    }
  });

  await Promise.all(playerUpdatePromises);

  // Update game state to RESULTS (important for trivia flow!)
  console.log(`🏷️ Updating game state to RESULTS#${paddedQuestionId}`);
  
  // Get the current lesson number from the paddedQuestionId
  const lessonNumber = parseInt(paddedQuestionId);
  console.log(`📊 Setting LessonNumber to ${lessonNumber} for trivia RESULTS#${paddedQuestionId}`);
  
  await db.send(new UpdateCommand({
    TableName: process.env.TABLE_NAME,
    Key: { PK: `GAME#${gameId}`, SK: 'STATE' },
    UpdateExpression: 'SET #state = :state, #currentQuestionId = :questionId, #lessonNumber = :lessonNumber, #started = :started, #updatedAt = :updatedAt',
    ExpressionAttributeNames: {
      '#state': 'State',
      '#currentQuestionId': 'CurrentQuestionId', 
      '#lessonNumber': 'LessonNumber',
      '#started': 'Started',
      '#updatedAt': 'UpdatedAt'
    },
    ExpressionAttributeValues: {
      ':state': `RESULTS#${paddedQuestionId}`,
      ':questionId': paddedQuestionId,
      ':lessonNumber': lessonNumber,
      ':started': true,
      ':updatedAt': new Date().toISOString()
    }
  }));

  return {
    statusCode: 200,
    body: JSON.stringify({
      gameId: gameId,
      questionId: paddedQuestionId,
      gameType: 'trivia',
      totalAnswers: answers.length,
      correctAnswers: correctAnswers.length,
      incorrectAnswers: answers.length - correctAnswers.length,
      totalPoints: totalPoints,
      averageResponseTime: Math.round(averageResponseTime),
      // Include question data for proper highlighting on frontend (with proper field mapping)
      question: question ? (question.Title || question.Prompt || '') : null,
      questionDetail: question ? (question.questionDetail || question.Detail || '') : null,
      
      // Handle correct answer conversion (same as get-question.js)
      correctAnswer: question ? (() => {
        let correctAnswer = question.correctAnswer || '';
        
        // Convert option IDs (OptionA, OptionB, etc.) to actual answer text
        if (typeof correctAnswer === 'string' && correctAnswer.startsWith('Option')) {
          const optionLetter = correctAnswer.replace('Option', '').toLowerCase();
          const optionField = `option${optionLetter.toUpperCase()}`;
          correctAnswer = question[optionField] || correctAnswer;
        } else if (Array.isArray(correctAnswer)) {
          // Handle multiple correct answers
          correctAnswer = correctAnswer.map(answer => {
            if (typeof answer === 'string' && answer.startsWith('Option')) {
              const optionLetter = answer.replace('Option', '').toLowerCase();
              const optionField = `option${optionLetter.toUpperCase()}`;
              return question[optionField] || answer;
            }
            return answer;
          });
        }
        
        return correctAnswer;
      })() : null,
      
      // Debug logging for question data
      _debugQuestionData: question ? {
        hasTitle: !!(question.Title || question.Prompt),
        hasCorrectAnswer: !!question.correctAnswer,
        questionKeys: Object.keys(question),
        correctAnswerValue: question.correctAnswer,
        sourceQuestionId: question.id || 'unknown'
      } : { questionNull: true },
      
      // Include trivia options (check both cases like get-question.js)
      optionA: question ? (question.optionA || question.OptionA || '') : null,
      optionB: question ? (question.optionB || question.OptionB || '') : null,
      optionC: question ? (question.optionC || question.OptionC || '') : null,
      optionD: question ? (question.optionD || question.OptionD || '') : null,
      optionE: question ? (question.optionE || question.OptionE || '') : null,
      optionF: question ? (question.optionF || question.OptionF || '') : null,
      answers: sortedAnswers.map(answer => ({
        playerName: answer.PlayerName,
        answer: answer.Answer,
        isCorrect: answer.IsCorrect || false,
        pointsEarned: answer.PointsEarned || 0,
        basePoints: answer.BasePoints || 0,
        speedBonus: answer.SpeedBonus || 0,
        responseTimeMs: answer.ResponseTimeMs || 0,
        submittedAt: answer.SubmittedAt
      })),
      leaderboard: leaderboard,
      timestamp: new Date().toISOString()
    }),
    headers: { 'Access-Control-Allow-Origin': '*' }
  };
  } catch (error) {
    console.error('❌ TRIVIA RESULTS ERROR:', error);
    console.error('❌ TRIVIA RESULTS STACK:', error.stack);
    return {
      statusCode: 500,
      body: JSON.stringify({ 
        error: `Failed to get trivia results: ${error.message}`,
        details: error.stack 
      }),
      headers: { 'Access-Control-Allow-Origin': '*' }
    };
  }
}

/**
 * Handle Wavelength Results - Word Association Analysis
 * Returns team-based scoring with common word analysis
 */
async function handleWavelengthResults(gameId, questionId) {
  try {
    console.log(`🌊 Handling wavelength results for game ${gameId}, question ${questionId}`);
    
    const paddedQuestionId = String(questionId).padStart(3, '0');
    
    // Get the question data for wavelength results
    console.log(`🔍 Fetching question data for wavelength results`);
    let question = null;
    try {
      // Get question reference record
      const questionRef = await db.send(new GetCommand({
        TableName: process.env.TABLE_NAME,
        Key: { PK: `GAME#${gameId}`, SK: `QUESTION#${paddedQuestionId}#REF` }
      }));

      if (questionRef.Item) {
        const sourceQuestionId = questionRef.Item.SourceQuestionId;
        const questionSetId = questionRef.Item.SetId;
        
        console.log(`📋 Found question reference: ${sourceQuestionId} from set ${questionSetId}`);

        // Get the actual question from the question set
        const questionResponse = await db.send(new GetCommand({
          TableName: process.env.TABLE_NAME,
          Key: { 
            PK: `SET#${questionSetId}`, 
            SK: sourceQuestionId 
          }
        }));

        if (questionResponse.Item) {
          question = questionResponse.Item;
          console.log(`✅ Question data loaded for wavelength results`);
        }
      }
    } catch (error) {
      console.error('Error fetching question data:', error);
    }

    // Get all player answers for this question
    const answersQuery = await db.send(new QueryCommand({
      TableName: process.env.TABLE_NAME,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
      ExpressionAttributeValues: {
        ':pk': `GAME#${gameId}`,
        ':sk': `QUESTION#${paddedQuestionId}#ANSWER#`
      }
    }));

    const allAnswers = answersQuery.Items || [];
    console.log(`📝 Found ${allAnswers.length} wavelength answers`);

    // Process word analysis
    let wordCounts = {};
    let playerWords = {};
    let totalWordsSubmitted = 0;
    let totalUniqueWords = 0;
    
    // Process each player's answer
    allAnswers.forEach(answerItem => {
      const playerName = answerItem.PlayerName;
      const answer = answerItem.Answer || '';
      const processedWords = answerItem.ProcessedWords || answer.split(',').map(w => w.trim().toLowerCase()).filter(w => w);
      
      playerWords[playerName] = processedWords;
      totalWordsSubmitted += processedWords.length;
      
      // Count occurrences of each word
      processedWords.forEach(word => {
        wordCounts[word] = (wordCounts[word] || 0) + 1;
      });
    });

    // Find common words (mentioned by 2+ players)
    const commonWords = Object.entries(wordCounts)
      .filter(([word, count]) => count > 1)
      .sort((a, b) => b[1] - a[1]) // Sort by frequency
      .map(([word, count]) => ({ word, count }));

    totalUniqueWords = Object.keys(wordCounts).length;
    
    console.log(`🤝 Found ${commonWords.length} common words out of ${totalUniqueWords} unique words`);

    // Calculate team-based scoring
    const teamScore = commonWords.length; // Simple scoring: 1 point per common word
    const connectionScore = Math.round((commonWords.length / totalUniqueWords) * 100) || 0; // Percentage of words that were common
    
    // Team scoring - everyone gets the same score
    const teamScoring = {};
    allAnswers.forEach(answerItem => {
      const playerName = answerItem.PlayerName;
      teamScoring[playerName] = {
        roundScore: teamScore,
        totalScore: 0, // Will be calculated elsewhere
        wordsSubmitted: playerWords[playerName]?.length || 0,
        commonWordsFound: playerWords[playerName]?.filter(word => wordCounts[word] > 1).length || 0
      };
    });

    const resultsData = {
      gameId,
      questionId: paddedQuestionId,
      gameType: 'wavelength',
      question,
      answers: allAnswers.map(answer => ({
        playerName: answer.PlayerName,
        name: answer.PlayerName, // For compatibility
        answer: answer.Answer,
        words: playerWords[answer.PlayerName] || [],
        submittedAt: answer.SubmittedAt
      })),
      wordAnalysis: {
        totalAnswers: allAnswers.length,
        totalWordsSubmitted,
        totalUniqueWords,
        commonWords,
        wordCounts,
        connectionScore
      },
      teamScore,
      teamScoring,
      timestamp: new Date().toISOString()
    };

    console.log(`🏆 Wavelength results calculated: ${commonWords.length} common words, team score: ${teamScore}`);

    // Store results for future retrieval
    await db.send(new PutCommand({
      TableName: process.env.TABLE_NAME,
      Item: {
        PK: `GAME#${gameId}`,
        SK: `QUESTION#${paddedQuestionId}#RESULTS`,
        ...resultsData,
        ttl: Math.floor(Date.now() / 1000) + (7 * 24 * 60 * 60) // 7 days TTL
      }
    }));

    return {
      statusCode: 200,
      body: JSON.stringify(resultsData),
      headers: { 'Access-Control-Allow-Origin': '*' }
    };

  } catch (error) {
    console.error('🌊 Error getting wavelength results:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ 
        error: `Failed to get wavelength results: ${error.message}`,
        details: error.stack 
      }),
      headers: { 'Access-Control-Allow-Origin': '*' }
    };
  }
}