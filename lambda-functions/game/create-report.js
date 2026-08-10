const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, GetCommand, QueryCommand, PutCommand } = require('@aws-sdk/lib-dynamodb');
const { resolveSetPartition } = require('./set-version');
const { isHidden } = require('./anonymity');

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

    // ANONYMITY. POST /games/{id}/report is a PUBLIC route, and the rounds it
    // reports on are not all finished: questionNumbers below is built from
    // votes ∪ results ∪ AI summaries, so a round still in VOTE joins the list
    // the moment the first ballot lands. Without this, anyone holding the
    // four-digit game id could ask the report for the names the ballot itself
    // is withholding, mid-vote, from the projector in the room.
    //
    // Per round, from the same ROUND# records the rest of the feature reads,
    // through the same isHidden() gate — so the report cannot drift from what
    // GET /answers decided. In practice this narrows nothing: entering RESULTS
    // sets AuthorsRevealed by itself, so every round that finished is still
    // fully attributed. Only a round abandoned mid-vote loses its names.
    const roundsQuery = await db.send(new QueryCommand({
      TableName: process.env.TABLE_NAME,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
      ExpressionAttributeValues: {
        ':pk': `GAME#${gameId}`,
        ':sk': 'ROUND#'
      }
    }));
    const roundsByNumber = new Map(
      (roundsQuery.Items || []).map((r) => [String(r.SK).replace('ROUND#', ''), r])
    );
    /** True when THIS round's authors must stay off the report. */
    const roundIsHidden = (paddedQuestionNumber) =>
      isHidden(gameMetadata.Item, roundsByNumber.get(paddedQuestionNumber));

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
    let useNewFormat = false; // Track which format is being used

    // Which VERSION of the set this game played. The final report must quote
    // the questions the players actually saw, so it resolves through the game's
    // pin first, then the set's activeVersion, then the legacy partition.
    const resolvedSet = questionSetId
      ? await resolveSetPartition(db, process.env.TABLE_NAME, questionSetId, gameMetadata.Item.QuestionSetVersion)
      : { pk: null, version: null };
    
    if (questionSetId) {
      try {
        // Try the new metadata structure first (SET#{id} / METADATA)
        console.log(`📊 Attempting to fetch question set metadata for ${questionSetId} using new format...`);
        const newFormatResult = await db.send(new GetCommand({
          TableName: process.env.TABLE_NAME,
          Key: { PK: `SET#${questionSetId}`, SK: 'METADATA' }
        }));
        
        if (newFormatResult.Item && newFormatResult.Item.metadata) {
          console.log(`📊 Found question set in NEW format`);
          questionSetData = newFormatResult.Item.metadata;
          useNewFormat = true;
        } else {
          // Fallback to old structure (SETS / SET#{id})
          console.log(`📊 New format not found, trying old format...`);
          const oldFormatResult = await db.send(new GetCommand({
            TableName: process.env.TABLE_NAME,
            Key: { PK: 'SETS', SK: `SET#${questionSetId}` }
          }));
          
          if (oldFormatResult.Item) {
            console.log(`📊 Found question set in OLD format`);
            questionSetData = oldFormatResult.Item;
            useNewFormat = false;
          }
        }
        
        console.log(`📊 Question set data: ${questionSetData ? 'Found' : 'Not found'} for setId: ${questionSetId}`);
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
    
    // And from AI summaries. A round that produced a Workie summary but neither a
    // vote nor a RESULTS record — a game ended mid-question, or any future
    // non-voting flow — would otherwise be dropped from the report entirely,
    // taking its Field Notes with it.
    const questionNumbersFromAISummaries = [...new Set(aiSummaries.map(ai => {
      // Extract question number from SK format: QUESTION#001#AISummary
      const match = ai.SK.match(/QUESTION#(\d+)#AISummary/);
      return match ? match[1] : null;
    }).filter(Boolean))];

    // Combine all three sources and deduplicate
    const questionNumbers = [...new Set([
      ...questionNumbersFromVotes,
      ...questionNumbersFromResults,
      ...questionNumbersFromAISummaries
    ])];

    console.log(`📊 Found ${questionNumbers.length} questions to process: ${questionNumbers.join(', ')}`);
    console.log(`📊 From votes: ${questionNumbersFromVotes.length}, from results: ${questionNumbersFromResults.length}, from AI summaries: ${questionNumbersFromAISummaries.length}`);

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
      
      if (sourceQuestionId) {
        console.log(`📊 Source question ID: ${sourceQuestionId || 'Not found'} for question ${questionNumber}`);
        
        if (useNewFormat && questionSetId) {
          // For new format, questions are stored with PK=SET#{setId}
          try {
            console.log(`📊 Fetching question details using NEW format...`);
            const questionResult = await db.send(new GetCommand({
              TableName: process.env.TABLE_NAME,
              Key: {
                PK: resolvedSet.pk,
                SK: sourceQuestionId
              }
            }));
            questionDetails = questionResult.Item;
            console.log(`📊 Question details (new format): ${questionDetails ? 'Found' : 'Not found'} for sourceId: ${sourceQuestionId}`);
          } catch (error) {
            console.log(`Could not fetch question details (new format) for ${sourceQuestionId}:`, error.message);
          }
        } else if (questionSetData) {
          // For old format, we need to search through the question set data
          // or try a different query pattern
          console.log(`📊 Fetching question details using OLD format...`);
          try {
            // Try querying for questions in the old format
            const questionsQuery = await db.send(new QueryCommand({
              TableName: process.env.TABLE_NAME,
              KeyConditionExpression: 'PK = :pk AND SK = :sk',
              ExpressionAttributeValues: {
                ':pk': resolvedSet.pk,
                ':sk': sourceQuestionId
              }
            }));
            
            if (questionsQuery.Items && questionsQuery.Items.length > 0) {
              questionDetails = questionsQuery.Items[0];
              console.log(`📊 Question details (old format): Found for sourceId: ${sourceQuestionId}`);
            } else {
              console.log(`📊 Question details (old format): Not found for sourceId: ${sourceQuestionId}`);
            }
          } catch (error) {
            console.log(`Could not fetch question details (old format) for ${sourceQuestionId}:`, error.message);
          }
        }
        
        console.log(`📊 Question details final result: ${questionDetails ? 'Found' : 'Not found'}, Title: ${questionDetails?.Title || 'N/A'}`);
      }

      // Calculate vote tallies for ranking (same logic as get-ai-summary.js)
      const voteTallies = {};
      const answerScores = {};
      const hideAuthors = roundIsHidden(questionNumber);
      if (hideAuthors) {
        console.log(`🔒 Question ${questionNumber} is unrevealed — reporting it without attribution`);
      }

      // Initialize scores for each answer.
      //
      // Index-keyed and never filtered or reordered: the ballot is positional
      // (submit-vote stores {"0": 1}), so dropping a redacted row here would
      // land every later vote on the wrong answer. Authorship is OMITTED, not
      // nulled — same rule as the runtime payloads (game/anonymity.js) — so a
      // renderer that forgets about anonymity shows nothing rather than "null".
      questionAnswers.forEach((answer, index) => {
        answerScores[index] = 0;
        voteTallies[index] = {
          answerText: answer.Answer,
          ...(hideAuthors ? {} : { playerName: answer.PlayerName }),
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
          // Absent on an unrevealed round — voteTallies omitted it above.
          ...(hideAuthors ? {} : { playerName: voteData.playerName }),
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

      // Debug logging for trivia games
      if (gameMetadata.Item.GameType === 'trivia') {
        console.log(`🎯 TRIVIA DEBUG - Question ${questionNumber}:`);
        console.log(`  - GameType: ${gameMetadata.Item.GameType}`);
        console.log(`  - questionDetails exists: ${!!questionDetails}`);
        console.log(`  - questionDetails keys: ${questionDetails ? Object.keys(questionDetails).join(', ') : 'N/A'}`);
        if (questionDetails) {
          console.log(`  - optionA: ${questionDetails.optionA || questionDetails.OptionA || 'missing'}`);
          console.log(`  - optionB: ${questionDetails.optionB || questionDetails.OptionB || 'missing'}`);
          console.log(`  - correctAnswer: ${questionDetails.correctAnswer || questionDetails.CorrectAnswer || 'missing'}`);
        }
      }

      // Compile complete question data
      detailedQuestions.push({
        questionNumber,
        questionId: questionResults?.QuestionId || questionNumber,
        
        // Question metadata (enhanced for trivia games)
        questionData: {
          title: questionDetails?.Title || `Question ${questionNumber}`,
          detail: questionDetails?.Detail || questionDetails?.QuestionDetail || '',
          category: questionDetails?.Category || 'General',
          sourceQuestionId: sourceQuestionId,

          // Art Title rounds are ordinary call-and-answer sets that carry an
          // image, so `image` is the ONLY thing that lets resolveRoundNoun()
          // label the round "Artwork" in the report. `school` is the artist
          // credit that goes with it.
          image: questionDetails?.Image || questionDetails?.image || null,
          school: questionDetails?.School || questionDetails?.school || null,

          // Trivia-specific fields
          ...(gameMetadata.Item.GameType === 'trivia' && questionDetails ? {
            questionDetail: questionDetails.QuestionDetail || questionDetails.Detail,
            optionA: questionDetails.optionA || questionDetails.OptionA,
            optionB: questionDetails.optionB || questionDetails.OptionB, 
            optionC: questionDetails.optionC || questionDetails.OptionC,
            optionD: questionDetails.optionD || questionDetails.OptionD,
            optionE: questionDetails.optionE || questionDetails.OptionE,
            optionF: questionDetails.optionF || questionDetails.OptionF,
            correctAnswer: questionDetails.correctAnswer || questionDetails.CorrectAnswer,
            answerDetails: questionDetails.answerDetails || questionDetails.AnswerDetails
          } : {})
        },
        
        // Answer data ranked by vote results
        answers: rankedAnswers,
        
        // Vote statistics
        voteStats: {
          totalAnswers: questionAnswers.length,
          totalVotes: questionVotes.length,
          // Math.max() with no arguments is -Infinity, which JSON.stringify
          // turns into null. Reachable whenever a round has no answers — now
          // more so, since AI-summary-only rounds join the list above.
          maxScore: Object.values(answerScores).length > 0
            ? Math.max(...Object.values(answerScores))
            : 0,
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
          // Which Workie voice wrote this. Tolerant read: summaries generated
          // before the persona resolver started stamping the item carry neither
          // spelling, and must stay renderable.
          personaName: questionAISummary.PersonaName || questionAISummary.personaName || null,
          personaId: questionAISummary.PersonaId || questionAISummary.personaId || null,
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
      // filter(Boolean): a redacted winner carries no playerName, and a
      // winners list of [undefined] is worse than an empty one — it renders as
      // a blank name and counts as a person.
      winners: q.answers.filter(a => a.rank === 1).map(a => a.playerName).filter(Boolean),
      maxVotes: q.voteStats.maxScore,
      voteTallies: q.answers.reduce((acc, answer) => {
        acc[answer.answerIndex] = {
          answerText: answer.answerText,
          // Omitted, not nulled, when the round it came from is unrevealed.
          ...(answer.playerName === undefined ? {} : { playerName: answer.playerName }),
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
          // `a.playerName &&` matters: rows from an unrevealed round omit it,
          // and a player record with no name would otherwise match every one
          // of them on undefined === undefined and collect the whole round's
          // points. An unrevealed round simply contributes nothing here — it
          // has no attributable score to contribute.
          const playerAnswer = question.answers.find(a => a.playerName && a.playerName === playerName);
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
      // schema-compliant-manager.js writes the metadata attribute as `Title`;
      // nothing has ever written `EventTitle`, so this always read
      // "Untitled Game". Same tolerant order get-ai-summary.js:947 uses.
      gameTitle: gameMetadata.Item.EventTitle || gameMetadata.Item.Title || 'Untitled Game',
      hostName: gameMetadata.Item.HostName || 'Unknown Host',
      questionSetId: gameMetadata.Item.QuestionSetId,
      gameType: gameMetadata.Item.GameType || 'standard',
      createdAt: gameMetadata.Item.CreatedAt,
      startedAt: gameState.Item?.StartedAt,
      currentState: gameState.Item?.State || 'UNKNOWN',
      lessonNumber: gameState.Item?.LessonNumber || 0,

      // Per-set round-label override ("Lesson", "Scenario", ...). Top level
      // because resolveRoundNoun() is called as
      // resolveRoundNoun(questionData, reportData.gameType, reportData.roundNoun).
      roundNoun: questionSetData?.roundNoun || questionSetData?.RoundNoun || null,

      // Statistics
      gameStats,
      
      // Player performance, ordered by SCORE.
      //
      // This sorted by `gamesWon` and that was wrong for most of the product.
      // `wins` above is counted from `result.Winners`, and `Winners` is only
      // ever written in the vote-tally branch (game/get-results.js:546,
      // websocket/message.js:265), both gated on a VOTE# state. Trivia and
      // wavelength never enter one, so every one of their players carried
      // `gamesWon: 0` and Array#sort left them in whatever order DynamoDB
      // happened to return — a leaderboard that looked authoritative and was
      // arbitrary.
      //
      // `totalScore` on the same object is correct and is computed just above
      // from the consolidated score record. Ties break on name so the order is
      // stable across regenerations of the same report rather than reshuffling
      // on every call.
      //
      // The host stage's top-three reads this ordering, so it is a
      // prerequisite for that podium being truthful and not merely present.
      playerPerformance: playerPerformance.sort((a, b) => (
        (b.totalScore || 0) - (a.totalScore || 0)
        || String(a.playerName || '').localeCompare(String(b.playerName || ''))
      )),
      
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
        title: questionSetData.title || questionSetData.Title || questionSetData.name,
        description: questionSetData.description || questionSetData.Description,
        category: questionSetData.category || questionSetData.Category,
        aiContext: questionSetData.aiContextInstruction || questionSetData.AIContextInstruction,
        customInstruction: questionSetData.customInstruction || questionSetData.CustomInstruction,
        roundNoun: questionSetData.roundNoun || questionSetData.RoundNoun || null
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