const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, GetCommand, QueryCommand, PutCommand } = require('@aws-sdk/lib-dynamodb');

const client = new DynamoDBClient({});
const db = DynamoDBDocumentClient.from(client, {
  marshallOptions: {
    removeUndefinedValues: true
  }
});

exports.handler = async (event) => {
  try {
    const { gameId } = event.pathParameters || {};
    
    if (!gameId) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Game ID is required' }),
        headers: { 'Access-Control-Allow-Origin': '*' }
      };
    }

    console.log(`📊 Creating comprehensive report for game ${gameId}`);

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

    // Get all players
    const playersQuery = await db.send(new QueryCommand({
      TableName: process.env.TABLE_NAME,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
      ExpressionAttributeValues: {
        ':pk': `GAME#${gameId}`,
        ':sk': 'PLAYER#'
      }
    }));

    // Get all player score records by filtering the player query results
    const playerScores = (playersQuery.Items || []).filter(item => 
      item.SK && item.SK.includes('#SCORE')
    );

    // Get all questions that were asked (based on results)
    const resultsQuery = await db.send(new QueryCommand({
      TableName: process.env.TABLE_NAME,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
      ExpressionAttributeValues: {
        ':pk': `GAME#${gameId}`,
        ':sk': 'QUESTION#'
      }
    }));

    // All question-related data is retrieved in the single query above

    // Process the data with proper filtering
    const players = playersQuery.Items || [];
    const allQuestionItems = resultsQuery.Items || [];

    console.log(`📊 Found ${players.length} player records and ${playerScores.length} score records`);
    
    // Filter items by type using SK patterns
    const results = allQuestionItems.filter(item => item.SK.includes('#RESULTS'));
    const answers = allQuestionItems.filter(item => item.SK.includes('#ANSWER#'));
    const votes = allQuestionItems.filter(item => item.SK.includes('#VOTE#'));
    const aiSummaries = allQuestionItems.filter(item => item.SK.includes('#AISummary'));

    // Calculate statistics
    const gameStats = {
      totalPlayers: players.length,
      totalQuestions: results.length,
      totalAnswers: answers.length,
      totalVotes: votes.length,
      averageAnswersPerQuestion: results.length > 0 ? Math.round((answers.length / results.length) * 100) / 100 : 0,
      averageVotesPerQuestion: results.length > 0 ? Math.round((votes.length / results.length) * 100) / 100 : 0
    };

    // Get game metadata for scoring configuration
    const scoringConfig = gameMetadata.Item.ScoringConfig || {
      firstPlacePoints: 3,
      secondPlacePoints: 2,
      thirdPlacePoints: 1,
      participationPoints: 0
    };

    // Get question set details for question metadata
    const questionSetId = gameMetadata.Item.QuestionSetId;
    let questionSetData = null;
    if (questionSetId) {
      try {
        const setResult = await db.send(new GetCommand({
          TableName: process.env.TABLE_NAME,
          Key: { PK: 'SETS', SK: `SET#${questionSetId}` }
        }));
        questionSetData = setResult.Item;
      } catch (error) {
        console.log('Could not fetch question set data:', error.message);
      }
    }

    // Process questions with complete data including rankings
    const detailedQuestions = [];
    
    // Get question numbers from votes (indicates completed questions)
    const questionNumbersFromVotes = [...new Set(votes.map(v => {
      // Extract question number from SK format: QUESTION#001#VOTE#playerId
      const match = v.SK.match(/QUESTION#(\d+)#VOTE#/);
      return match ? match[1] : null;
    }).filter(Boolean))];
    
    // Also check for RESULTS entries (might exist for some questions)
    const questionNumbersFromResults = [...new Set(results.map(r => {
      // Extract question number from SK format: QUESTION#001#RESULTS
      const match = r.SK.match(/QUESTION#(\d+)#RESULTS/);
      return match ? match[1] : null;
    }).filter(Boolean))];
    
    // Combine both sources and deduplicate
    const questionNumbers = [...new Set([...questionNumbersFromVotes, ...questionNumbersFromResults])];
    
    console.log(`📊 Found ${questionNumbers.length} questions to process: ${questionNumbers.join(', ')}`);
    console.log(`📊 From votes: ${questionNumbersFromVotes.length}, from results: ${questionNumbersFromResults.length}`);

    for (const questionNumber of questionNumbers) {
      console.log(`📊 Processing question ${questionNumber} for report`);
      
      // Get question metadata from results
      const questionResults = results.find(r => r.SK.includes(`QUESTION#${questionNumber}#RESULTS`));
      const questionAnswers = answers.filter(a => a.SK.includes(`QUESTION#${questionNumber}#ANSWER#`));
      const questionVotes = votes.filter(v => v.SK.includes(`QUESTION#${questionNumber}#VOTE#`));
      const questionAISummary = aiSummaries.find(ai => ai.SK.includes(`QUESTION#${questionNumber}#AISummary`));
      
      console.log(`📊 Question ${questionNumber}: ${questionAnswers.length} answers, ${questionVotes.length} votes, hasResults=${!!questionResults}, hasAI=${!!questionAISummary}`);
      
      // Get question details from question set if available
      let questionDetails = null;
      let sourceQuestionId = null;
      
      // First try to get source question ID from results
      if (questionResults?.SourceQuestionId) {
        sourceQuestionId = questionResults.SourceQuestionId;
      } else {
        // If no results, try to find source question ID from question reference
        try {
          const questionRef = await db.send(new GetCommand({
            TableName: process.env.TABLE_NAME,
            Key: { PK: `GAME#${gameId}`, SK: `QUESTION#${questionNumber}#REF` }
          }));
          
          if (questionRef.Item?.SourceQuestionId) {
            sourceQuestionId = questionRef.Item.SourceQuestionId;
            console.log(`📊 Found source question ID from reference: ${sourceQuestionId}`);
          }
        } catch (error) {
          console.log(`⚠️ Could not fetch question reference for ${questionNumber}:`, error.message);
        }
      }
      
      if (questionSetData && sourceQuestionId) {
        try {
          const questionResult = await db.send(new GetCommand({
            TableName: process.env.TABLE_NAME,
            Key: { 
              PK: `SET#${questionSetId}`, 
              SK: sourceQuestionId 
            }
          }));
          questionDetails = questionResult.Item;
          console.log(`📊 Found question details: ${questionDetails?.Title || 'No title'}`);
        } catch (error) {
          console.log(`Could not fetch question details for ${sourceQuestionId}:`, error.message);
        }
      }

      // Calculate vote tallies for ranking (same logic as get-ai-summary.js)
      const voteTallies = {};
      const answerScores = {};

      // Initialize scores for each answer
      questionAnswers.forEach((answer, index) => {
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

      // Process votes to calculate scores
      questionVotes.forEach(vote => {
        const voteData = vote.Votes; // e.g., {"0": 1, "1": 2, "2": 3}
        
        Object.entries(voteData).forEach(([answerIndex, rank]) => {
          const idx = parseInt(answerIndex);
          const position = parseInt(rank);
          
          if (voteTallies[idx]) {
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

      // Create ranked answers list with proper tie handling
      const rankedAnswers = Object.entries(voteTallies)
        .map(([index, voteData]) => ({
          answerIndex: parseInt(index),
          playerName: voteData.playerName,
          answerText: voteData.answerText,
          totalScore: voteData.totalScore,
          firstPlace: voteData.firstPlace,
          secondPlace: voteData.secondPlace,
          thirdPlace: voteData.thirdPlace,
          voteBreakdown: `${voteData.firstPlace} first, ${voteData.secondPlace} second, ${voteData.thirdPlace} third`
        }))
        .sort((a, b) => {
          // Sort by total score first, then by first place votes as tiebreaker
          if (b.totalScore !== a.totalScore) {
            return b.totalScore - a.totalScore;
          }
          return b.firstPlace - a.firstPlace;
        });

      // Add ranking positions
      let currentRank = 1;
      rankedAnswers.forEach((answer, idx) => {
        if (idx > 0 && answer.totalScore !== rankedAnswers[idx - 1].totalScore) {
          currentRank = idx + 1;
        }
        answer.rank = currentRank;
        answer.rankDisplay = currentRank === 1 ? '🥇 1st Place' : 
                           currentRank === 2 ? '🥈 2nd Place' : 
                           currentRank === 3 ? '🥉 3rd Place' : 
                           `${currentRank}th Place`;
      });

      // Compile complete question data
      detailedQuestions.push({
        questionNumber,
        questionId: questionResults?.QuestionId || questionNumber,
        
        // Question metadata
        questionData: {
          title: questionDetails?.Title || `Question ${questionNumber}`,
          detail: questionDetails?.Detail || '',
          category: questionDetails?.Category || 'General',
          sourceQuestionId: sourceQuestionId
        },
        
        // Answer data ranked by vote results
        answers: rankedAnswers,
        
        // Vote statistics
        voteStats: {
          totalAnswers: questionAnswers.length,
          totalVotes: questionVotes.length,
          maxScore: Math.max(...Object.values(answerScores)),
          averageScore: Object.values(answerScores).length > 0 ? 
            Math.round((Object.values(answerScores).reduce((sum, score) => sum + score, 0) / Object.values(answerScores).length) * 100) / 100 : 0
        },
        
        // AI Summary (enhanced with structured data)
        aiSummary: questionAISummary ? {
          summaryText: questionAISummary.SummaryText || questionAISummary.Summary,
          discussionQuestions: questionAISummary.DiscussionQuestions || [],
          nextSteps: questionAISummary.NextSteps || [],
          fullResponse: questionAISummary.FullResponse,
          markdownResponse: questionAISummary.MarkdownResponse,
          generatedAt: questionAISummary.GeneratedAt,
          hasStructuredData: !!(questionAISummary.SummaryText && questionAISummary.DiscussionQuestions)
        } : null,
        
        // Results metadata
        processedAt: questionResults?.ProcessedAt,
        completedAt: questionResults?.CompletedAt
      });
    }

    // Legacy question summaries for backward compatibility
    const questionSummaries = detailedQuestions.map(q => ({
      questionId: q.questionId,
      answerCount: q.answers.length,
      voteCount: q.voteStats.totalVotes,
      winners: q.answers.filter(a => a.rank === 1).map(a => a.playerName),
      maxVotes: q.voteStats.maxScore,
      voteTallies: q.answers.reduce((acc, answer) => {
        acc[answer.answerIndex] = {
          answerText: answer.answerText,
          playerName: answer.playerName,
          firstPlace: answer.firstPlace,
          secondPlace: answer.secondPlace,
          thirdPlace: answer.thirdPlace,
          totalScore: answer.totalScore
        };
        return acc;
      }, {})
    }));

    // Filter to get only main player records (not score records)
    const mainPlayerRecords = players.filter(player => 
      !player.SK.includes('#SCORE') && 
      !player.SK.includes('#STATE') && 
      player.SK.startsWith('PLAYER#')
    );

    // Deduplicate players by name, keeping the most recent record
    const playerMap = new Map();
    mainPlayerRecords.forEach(player => {
      const playerName = player.PlayerName || player.playerName;
      const existing = playerMap.get(playerName);
      
      if (!existing || (player.JoinedAt && (!existing.JoinedAt || player.JoinedAt > existing.JoinedAt))) {
        playerMap.set(playerName, player);
      }
    });
    
    const uniquePlayers = Array.from(playerMap.values());
    console.log(`📊 Filtered and deduplicated players: ${players.length} → ${mainPlayerRecords.length} → ${uniquePlayers.length}`);

    // Calculate player performance
    const playerPerformance = uniquePlayers.map(player => {
      const playerName = player.PlayerName || player.playerName;
      const playerAnswers = answers.filter(a => (a.PlayerName || a.playerName) === playerName);
      const playerVotes = votes.filter(v => (v.PlayerName || v.playerName) === playerName);
      
      // Count how many times this player won
      let wins = 0;
      results.forEach(result => {
        if (result.Winners && result.Winners.includes(playerName)) {
          wins++;
        }
      });

      // Calculate total score from the consolidated score record (single source of truth)
      let totalScore = 0;
      
      // Find the player's score record
      const playerScoreRecord = playerScores.find(score => score.PlayerName === playerName);
      if (playerScoreRecord) {
        totalScore = playerScoreRecord.score || 0;
        console.log(`📊 Player ${playerName}: Found score record with totalScore=${totalScore} (afterRound: ${playerScoreRecord.afterRound})`);
      } else {
        // Fallback: Calculate from vote tallies across all questions if no score record exists
        console.log(`⚠️ Player ${playerName}: No score record found, calculating from question tallies`);
        detailedQuestions.forEach(question => {
          const playerAnswer = question.answers.find(a => a.playerName === playerName);
          if (playerAnswer) {
            totalScore += playerAnswer.totalScore || 0;
          }
        });
      }

      console.log(`📊 Player ${playerName}: totalScore=${totalScore}, wins=${wins}, answers=${playerAnswers.length}`);

      return {
        playerName: playerName,
        totalScore: totalScore,
        answersGiven: playerAnswers.length,
        votesGiven: playerVotes.length,
        gamesWon: wins,
        participationRate: gameStats.totalQuestions > 0 ? 
          Math.round((playerAnswers.length / gameStats.totalQuestions) * 100) : 0
      };
    });

    // Create comprehensive report
    const reportData = {
      gameId,
      gameTitle: gameMetadata.Item.EventTitle || 'Untitled Game',
      hostName: gameMetadata.Item.HostName || 'Unknown Host',
      questionSetId: gameMetadata.Item.QuestionSetId,
      gameType: gameMetadata.Item.GameType || 'standard',
      createdAt: gameMetadata.Item.CreatedAt,
      startedAt: gameState.Item?.StartedAt,
      currentState: gameState.Item?.State || 'UNKNOWN',
      lessonNumber: gameState.Item?.LessonNumber || 0,
      
      // Statistics
      gameStats,
      
      // Player performance
      playerPerformance: playerPerformance.sort((a, b) => b.gamesWon - a.gamesWon),
      
      // Enhanced question data with rankings and AI summaries
      detailedQuestions: detailedQuestions.sort((a, b) => 
        parseInt(a.questionNumber) - parseInt(b.questionNumber)
      ),
      
      // Legacy question summaries for backward compatibility
      questionSummaries,
      
      // Scoring configuration
      scoringConfig,
      
      // Question set metadata
      questionSetData: questionSetData ? {
        title: questionSetData.Title,
        description: questionSetData.Description,
        category: questionSetData.Category,
        aiContext: questionSetData.AIContextInstruction,
        customInstruction: questionSetData.CustomInstruction
      } : null,
      
      // Metadata
      reportGeneratedAt: new Date().toISOString(),
      reportVersion: '2.0'
    };

    // Store the report in DynamoDB
    const reportRecord = {
      PK: `GAME#${gameId}`,
      SK: 'REPORT',
      ...reportData,
      ttl: Math.floor(Date.now() / 1000) + (30 * 24 * 60 * 60) // 30 days TTL
    };

    await db.send(new PutCommand({
      TableName: process.env.TABLE_NAME,
      Item: reportRecord
    }));

    console.log(`✅ Report created for game ${gameId}: ${gameStats.totalQuestions} questions, ${gameStats.totalPlayers} players`);

    return {
      statusCode: 200,
      body: JSON.stringify({
        success: true,
        gameId: gameId,
        report: reportData,
        message: 'Game report created successfully'
      }),
      headers: { 'Access-Control-Allow-Origin': '*' }
    };

  } catch (error) {
    console.error('Create report error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: `Failed to create report: ${error.message}` }),
      headers: { 'Access-Control-Allow-Origin': '*' }
    };
  }
};