const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, GetCommand, QueryCommand, PutCommand, UpdateCommand, DeleteCommand } = require('@aws-sdk/lib-dynamodb');
const { ApiGatewayManagementApiClient, PostToConnectionCommand } = require('@aws-sdk/client-apigatewaymanagementapi');
const { resolveSetPartition } = require('./set-version');

const client = new DynamoDBClient({});
const db = DynamoDBDocumentClient.from(client);
const apigateway = new ApiGatewayManagementApiClient({
  endpoint: process.env.WEBSOCKET_API_ENDPOINT
});

// Helper function to check if a bit is set in a bitmask
const isBitSet = (mask, position) => {
  const pos = position - 1; // Convert to 0-based index
  return mask[pos] === '1';
};

/**
 * Tell the room the round has resolved.
 *
 * This handler moves the game into RESULTS# — the same class of transition that
 * next-question.js (`questionStarted`) and start-vote.js (`votingStarted`)
 * announce — but until now it announced NOTHING. The only notification was the
 * host page firing `RESULT#nnn` down its OWN socket after the fetch returned
 * (GameHostPage.handleShowResults). That made the transition depend on a
 * particular browser tab being open with a live socket: if the host's WebSocket
 * had dropped, the database said RESULTS and the room sat on the voting screen.
 *
 * It also made the transition impossible to drive from anywhere else, which is
 * what the Host Remote needs to do — it calls this endpoint directly so it keeps
 * working when the projector browser is closed.
 *
 * `gameStateChanged` is the message both GameHostPage and PlayerPage already
 * handle by re-fetching state, so it is additive and idempotent: when the host
 * page drives results it now gets a re-sync to the state it just set, and
 * players may see this plus the host's own `RESULT#nnn`, which their handler
 * already tolerates (both funnel into the same re-fetch).
 *
 * Never throws: a broadcast failure must not turn a round that scored correctly
 * into a 500 that the host reads as "results failed".
 */
const broadcastResultsReady = async (gameId, paddedQuestionId) => {
  if (!gameId || !paddedQuestionId) return;
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
    if (connections.length === 0) {
      console.log(`⚠️ RESULTS BROADCAST: no active connections for game ${gameId}`);
      return;
    }

    const message = JSON.stringify({
      type: 'gameStateChanged',
      gameId: gameId,
      state: `GAME#${gameId} RESULTS#${paddedQuestionId}`,
      newState: `RESULTS#${paddedQuestionId}`,
      questionNumber: paddedQuestionId,
      timestamp: new Date().toISOString()
    });

    await Promise.all(connections.map(async (connection) => {
      try {
        await apigateway.send(new PostToConnectionCommand({
          ConnectionId: connection.ConnectionId,
          Data: message
        }));
      } catch (error) {
        // 410 Gone == the client is long dead. Drop the row inline; PK/SK are
        // known from the connection item, so no table scan is needed. Same
        // cleanup next-question.js does.
        const status = error.statusCode || error.$metadata?.httpStatusCode || error.$response?.statusCode;
        if (status === 410 || error.name === 'GoneException') {
          await db.send(new DeleteCommand({
            TableName: process.env.TABLE_NAME,
            Key: { PK: connection.PK, SK: connection.SK }
          })).catch(() => {});
        } else {
          console.error(`❌ RESULTS BROADCAST: failed for ${connection.ConnectionId}:`, error.message);
        }
      }
    }));

    console.log(`✅ RESULTS BROADCAST: RESULTS#${paddedQuestionId} sent to ${connections.length} connection(s)`);
  } catch (error) {
    console.error('❌ RESULTS BROADCAST: failed entirely (continuing):', error);
  }
};

/**
 * The route this request actually came in on — the only thing that decides
 * whether it may CLOSE a round or merely READ one.
 *
 * This handler sits behind TWO routes (template-clean.yaml):
 *
 *   POST /games/get-results            public — PlayerPage calls it with a
 *                                      plain fetch, so it cannot carry the
 *                                      Cognito authorizer without breaking
 *                                      every player client
 *   POST /games/{gameId}/close-round   host only — carries the authorizer,
 *                                      the same way /reveal-authors does
 *
 * HTTP API authorizers are per-route and not optional: a route either has one
 * or it does not, so "same route, sometimes authenticated" is not expressible.
 * Two routes onto one handler is how the read stays public while the
 * transition stays host-only, and this predicate is the seam between them.
 *
 * `requestContext.routeKey` is stamped by API Gateway from the route that
 * MATCHED. It is not part of the request the caller composes — no body field,
 * header or path trick can set it — so reaching this handler with the
 * close-round routeKey is itself proof the authorizer let the caller through.
 *
 * FAILS CLOSED. Anything else — the public route, a missing requestContext, a
 * future caller — is not a host.
 */
const HOST_TRANSITION_ROUTE = 'POST /games/{gameId}/close-round';
const isHostTransitionRoute = (event) =>
  (event?.requestContext?.routeKey || event?.routeKey) === HOST_TRANSITION_ROUTE;

/**
 * Move the game into RESULTS#nnn and tell the room.
 *
 * The same six-line UpdateCommand was pasted into the call-and-answer branch and
 * the trivia branch, and MISSING from the other two exits of this handler:
 *
 *   - wavelength: handleWavelengthResults computed the word cloud, stored it,
 *     and returned 200 without ever writing the state. The database stayed on
 *     ASK#nnn for the rest of the round.
 *   - call-and-answer with zero votes: returned "No votes found" early, also
 *     without writing the state.
 *
 * Neither was visible from the host page, because GameHostPage.handleShowResults
 * sets `RESULTS#nnn` in its OWN React state regardless of what the server did —
 * so the projector moved on while the database did not. Anything that reads the
 * state back instead of remembering what it asked for (a refresh, a second host
 * screen, the Host Remote) saw the round stuck.
 *
 * `Started: true` is preserved from the original copies: resolving a round is
 * also proof the game is underway.
 *
 * WHO IS ALLOWED TO DO THIS is decided HERE, not at the call sites, for the
 * same reason the write itself lives here: there are four exits, two of them
 * once forgot the write entirely, and a permission check pasted into some of
 * them would grow the identical hole. `event` is threaded in so this function
 * can answer the question itself; a public read reaches this point only when
 * the round it asked about is ALREADY in RESULTS (the handler refuses
 * otherwise), so there is genuinely nothing to transition and returning early
 * is the whole of the read path's write behaviour: no state, no reveal, no
 * re-announcement.
 *
 * A missing `event` is a programming error — a fifth exit that forgot to pass
 * it — and throws rather than silently declining, because silently declining
 * is how a host ends up staring at a round that will not close.
 */
const enterResultsState = async (event, gameId, paddedQuestionId) => {
  if (!event || typeof event !== 'object') {
    throw new Error('enterResultsState: the request event is required to authorise the transition');
  }

  if (!isHostTransitionRoute(event)) {
    console.log(`👀 Public read of RESULTS#${paddedQuestionId} for ${gameId} — reporting only, no transition`);
    return;
  }

  const lessonNumber = parseInt(paddedQuestionId, 10);
  console.log(`🏷️ Updating game state to RESULTS#${paddedQuestionId} (LessonNumber ${lessonNumber})`);

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

  // VOTING HAS CLOSED, SO THE PROMISE IS DISCHARGED. The room was told "nobody
  // sees who wrote what — the host included — until voting closes", and this is
  // that moment. Attribution returns everywhere from here: results, Field Notes,
  // standings, the report and the archive export.
  //
  // It lives in this function rather than at the call sites for the reason the
  // comment above records — the state write used to be pasted into two branches
  // and missing from the wavelength and zero-vote exits, so a round could close
  // without it. The reveal must not inherit that hole.
  //
  // Unconditional SET, so it is idempotent: a host who resolves the same round
  // twice does not error, and POST /reveal-authors having run first is a no-op.
  await db.send(new UpdateCommand({
    TableName: process.env.TABLE_NAME,
    Key: { PK: `GAME#${gameId}`, SK: `ROUND#${paddedQuestionId}` },
    UpdateExpression: 'SET #revealed = :true, #qn = :qn, #updatedAt = :updatedAt',
    ExpressionAttributeNames: {
      '#revealed': 'AuthorsRevealed', '#qn': 'QuestionNumber', '#updatedAt': 'UpdatedAt'
    },
    ExpressionAttributeValues: {
      ':true': true, ':qn': paddedQuestionId, ':updatedAt': new Date().toISOString()
    }
  }));

  await broadcastResultsReady(gameId, paddedQuestionId);
};

exports.handler = async (event) => {
  try {
    // Handle POST request with body containing gameId and questionNumber.
    // The host route is nested under the game (/games/{gameId}/close-round) and
    // so carries no gameId in the body; the public one takes it in the body.
    const body = JSON.parse(event.body || '{}');
    const { questionNumber } = body;
    const gameId = event.pathParameters?.gameId || body.gameId;

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

    // The STATE record is wanted twice at most — to fill in an omitted round,
    // and to decide whether a public caller is reading an already-resolved
    // one — so read it once, lazily.
    let cachedGameState;
    const readGameState = async () => {
      if (cachedGameState === undefined) {
        const res = await db.send(new GetCommand({
          TableName: process.env.TABLE_NAME,
          Key: { PK: `GAME#${gameId}`, SK: 'STATE' }
        }));
        cachedGameState = res.Item || null;
      }
      return cachedGameState;
    };

    let targetQuestionId = questionNumber;

    // If no specific question ID provided, get current question from game state
    if (!targetQuestionId) {
      const gameState = await readGameState();

      if (!gameState) {
        return {
          statusCode: 404,
          body: JSON.stringify({ error: 'Game not found' }),
          headers: { 'Access-Control-Allow-Origin': '*' }
        };
      }

      targetQuestionId = gameState.CurrentQuestionId;

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

    // READ FREELY, CLOSE ONLY AS THE HOST.
    //
    // Everything below this point can move the room: it writes RESULTS#nnn,
    // flips AuthorsRevealed — which is what ends the room's anonymity —
    // awards scores and announces the transition to every connection. A
    // participant knows the four-digit game id, so on the public route that
    // was a button any phone in the room could press mid-vote, and (this
    // handler does not redact) the response handed back every author's name.
    //
    // The read that players actually make is the one AFTER the transition:
    // PlayerPage waits for the state to say RESULTS#nnn and only then fetches
    // that same nnn. That call has nothing left to do but report, so it is
    // allowed through and enterResultsState declines to write.
    //
    // Scoped to the round the room is ON, not merely "this game has resolved
    // something": a game sitting on RESULTS#003 must not hand out the authors
    // of round 2, which may have been abandoned before RESULTS and so is still
    // anonymous. Compared numerically because callers spell the round 1, '1'
    // or '001' while the state stores it padded.
    if (!isHostTransitionRoute(event)) {
      const gameState = await readGameState();
      const resolvedRound = String(gameState?.State || '').startsWith('RESULTS#')
        ? String(gameState.State).split('#')[1]
        : null;
      const readingTheResolvedRound = resolvedRound !== null
        && parseInt(resolvedRound, 10) === parseInt(String(targetQuestionId), 10);

      if (!readingTheResolvedRound) {
        console.log(`🔒 Refusing to close round ${targetQuestionId} of ${gameId}: not the host`);
        return {
          statusCode: 403,
          body: JSON.stringify({
            error: 'Host authentication required',
            message: 'Results for this round are not available yet'
          }),
          headers: { 'Access-Control-Allow-Origin': '*' }
        };
      }
    }

    console.log(`🎯 Calculating results for question: ${targetQuestionId}`);

    // Handle trivia results differently from call-and-answer
    if (gameType === 'trivia') {
      return await handleTriviaResults(event, gameId, targetQuestionId);
    }
    
    // Handle wavelength results with word comparison logic
    if (gameType === 'wavelength') {
      return await handleWavelengthResults(event, gameId, targetQuestionId);
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
      // A round nobody voted on is still a resolved round. This used to return
      // without touching the state, so the game sat on VOTE#nnn while the host
      // screen (which sets RESULTS# locally regardless) showed results.
      await enterResultsState(event, gameId, paddedQuestionId);

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
    await enterResultsState(event, gameId, paddedQuestionId);

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

    // Decrement category counts after results are calculated (prevent duplicates)
    console.log(`🔢 Calling decrementCategoryCount for ${gameId}, question ${paddedQuestionId}`);
    await decrementCategoryCount(gameId, paddedQuestionId);

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
async function handleTriviaResults(event, gameId, questionId) {
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

        // Read the VERSION this round was served from (the REF row records it).
        // RESULTS must show the same question text ASK did, so this resolves
        // through the same pin > activeVersion > legacy order.
        const resolvedSet = await resolveSetPartition(
          db, process.env.TABLE_NAME, questionSetId, questionRef.Item.SetVersion
        );

        // Get the actual question from the question set (same as get-question.js)
        const questionResponse = await db.send(new GetCommand({
          TableName: process.env.TABLE_NAME,
          Key: {
            PK: resolvedSet.pk,
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

  // Decrement category counts after trivia results are calculated (prevent duplicates)
  console.log(`🔢 Calling decrementCategoryCount for trivia ${gameId}, question ${paddedQuestionId}`);
  await decrementCategoryCount(gameId, paddedQuestionId);

  // Update game state to RESULTS (important for trivia flow!)
  await enterResultsState(event, gameId, paddedQuestionId);

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
async function handleWavelengthResults(event, gameId, questionId) {
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

        // Same version resolution as the trivia branch above.
        const resolvedSet = await resolveSetPartition(
          db, process.env.TABLE_NAME, questionSetId, questionRef.Item.SetVersion
        );

        // Get the actual question from the question set
        const questionResponse = await db.send(new GetCommand({
          TableName: process.env.TABLE_NAME,
          Key: {
            PK: resolvedSet.pk,
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

    // This branch never wrote the state at all — the word cloud was computed and
    // returned while the game stayed on ASK#nnn. Only the host page's local
    // React state moved, so a refresh (or the Host Remote, which reads the state
    // back rather than remembering what it asked for) put the room back on the
    // answering screen.
    await enterResultsState(event, gameId, paddedQuestionId);

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

/**
 * Decrement category count when a question is completed
 * Uses atomic updates with version control for concurrent safety
 */
async function decrementCategoryCount(gameId, questionId) {
  try {
    console.log(`🔢 Decrementing category count for completed question ${questionId} in game ${gameId}`);
    
    // Check if this question has already been decremented (prevent duplicates)
    const resultsCheck = await db.send(new GetCommand({
      TableName: process.env.TABLE_NAME,
      Key: { PK: `GAME#${gameId}`, SK: `QUESTION#${questionId}#RESULTS` }
    }));
    
    if (resultsCheck.Item && resultsCheck.Item.CategoryCountDecremented) {
      console.log(`⚠️ Question ${questionId} already processed for category count decrement, skipping`);
      return;
    }
    
    // Get the question reference to determine which category was used
    const questionRef = await db.send(new GetCommand({
      TableName: process.env.TABLE_NAME,
      Key: { PK: `GAME#${gameId}`, SK: `QUESTION#${questionId}#REF` }
    }));

    if (!questionRef.Item || !questionRef.Item.SourceQuestionId) {
      console.log(`⚠️ Question reference not found for ${questionId}, skipping category count decrement`);
      return;
    }

    // Extract category from source question ID (format: QUESTION#{categoryId}#{questionNumber})
    const sourceQuestionId = questionRef.Item.SourceQuestionId;
    const categoryMatch = sourceQuestionId.match(/^QUESTION#([^#]+)#/);
    
    if (!categoryMatch) {
      console.log(`⚠️ Could not extract category from source question ID: ${sourceQuestionId}`);
      return;
    }

    const categoryId = categoryMatch[1];
    console.log(`🎯 Identified category ${categoryId} for completed question`);

    // Get current category counts with retry logic for concurrent updates
    let attempts = 0;
    const maxAttempts = 3;
    
    while (attempts < maxAttempts) {
      try {
        const countsResult = await db.send(new GetCommand({
          TableName: process.env.TABLE_NAME,
          Key: { PK: `GAME#${gameId}`, SK: 'STATE#CATS#COUNTS' }
        }));

        if (!countsResult.Item) {
          console.log(`📊 No category counts found for game ${gameId}, skipping decrement`);
          return;
        }

        // Get the position of this category from the game's category state
        const categoryStateResult = await db.send(new GetCommand({
          TableName: process.env.TABLE_NAME,
          Key: { PK: `GAME#${gameId}`, SK: 'STATE#CATS' }
        }));

        if (!categoryStateResult.Item) {
          console.log(`⚠️ Category state not found for game ${gameId}, skipping decrement`);
          return;
        }

        // Find category position by querying question set categories.
        // Category POSITIONS are what the bitmask counters are indexed by, and
        // two versions of a set can order categories differently — so this must
        // read the same version the round was served from.
        const resolvedCategorySet = await resolveSetPartition(
          db, process.env.TABLE_NAME,
          questionRef.Item.SetId || 'unknown',
          questionRef.Item.SetVersion
        );
        const categoriesQuery = await db.send(new QueryCommand({
          TableName: process.env.TABLE_NAME,
          KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
          ExpressionAttributeValues: {
            ':pk': resolvedCategorySet.pk,
            ':sk': 'CATEGORY#'
          }
        }));

        const allCategories = categoriesQuery.Items || [];
        let categoryPosition = null;
        
        for (let i = 0; i < allCategories.length; i++) {
          const catId = allCategories[i].SK.replace('CATEGORY#', '');
          if (catId === categoryId) {
            categoryPosition = i + 1; // 1-based position
            break;
          }
        }

        if (!categoryPosition) {
          console.log(`⚠️ Could not determine position for category ${categoryId}, skipping decrement`);
          return;
        }

        console.log(`📋 Found category ${categoryId} at position ${categoryPosition}`);

        const currentCounts = countsResult.Item;
        console.log(`🔍 Current counts record:`, JSON.stringify(currentCounts, null, 2));
        
        // Check for Version field
        if (typeof currentCounts.Version !== 'number') {
          console.log(`⚠️ Version field missing or invalid: ${currentCounts.Version}, initializing to 1`);
          currentCounts.Version = 1;
        }
        
        const counts1_8 = [...(currentCounts['1-8'] || [])];
        const counts9_16 = [...(currentCounts['9-16'] || [])];
        const counts17_24 = [...(currentCounts['17-24'] || [])];
        
        console.log(`📊 Current counts - 1-8: [${counts1_8}], 9-16: [${counts9_16}], 17-24: [${counts17_24}]`);
        
        // Determine which array and index to update
        let arrayIndex, targetArray, arrayName;
        if (categoryPosition >= 1 && categoryPosition <= 8) {
          arrayIndex = categoryPosition - 1;
          targetArray = counts1_8;
          arrayName = '1-8';
        } else if (categoryPosition >= 9 && categoryPosition <= 16) {
          arrayIndex = categoryPosition - 9;
          targetArray = counts9_16;
          arrayName = '9-16';
        } else if (categoryPosition >= 17 && categoryPosition <= 24) {
          arrayIndex = categoryPosition - 17;
          targetArray = counts17_24;
          arrayName = '17-24';
        } else {
          console.log(`⚠️ Invalid category position ${categoryPosition}, skipping decrement`);
          return;
        }

        const currentRemaining = targetArray[arrayIndex] || 0;
        console.log(`🎯 Target: ${categoryId} at position ${categoryPosition} → ${arrayName}[${arrayIndex}] = ${currentRemaining}`);
        
        // Check if already at 0
        if (currentRemaining <= 0) {
          console.log(`⚠️ Category ${categoryId} already at 0 remaining questions`);
          return;
        }

        // Update the array
        const newCount = Math.max(0, currentRemaining - 1);
        targetArray[arrayIndex] = newCount;
        console.log(`🔄 Decrementing ${categoryId}: ${currentRemaining} → ${newCount}`);

        // Recalculate totalRemaining from enabled categories only (should match totalEnabled)
        const totalRemaining = totalEnabled;
        
        // Calculate total enabled (need to check bitmasks)
        const hostMask1_8 = categoryStateResult.Item['HostMask1-8'];
        const hostMask9_16 = categoryStateResult.Item['HostMask9-16'];
        const hostMask17_24 = categoryStateResult.Item['HostMask17-24'];
        
        let totalEnabled = 0;
        
        // Count enabled questions from 1-8
        for (let i = 0; i < 8; i++) {
          if (isBitSet(hostMask1_8, i + 1)) {
            totalEnabled += counts1_8[i] || 0;
          }
        }
        
        // Count enabled questions from 9-16
        for (let i = 0; i < 8; i++) {
          if (isBitSet(hostMask9_16, i + 1)) {
            totalEnabled += counts9_16[i] || 0;
          }
        }
        
        // Count enabled questions from 17-24
        for (let i = 0; i < 8; i++) {
          if (isBitSet(hostMask17_24, i + 1)) {
            totalEnabled += counts17_24[i] || 0;
          }
        }

        // Atomic update with optimistic locking
        await db.send(new UpdateCommand({
          TableName: process.env.TABLE_NAME,
          Key: { PK: `GAME#${gameId}`, SK: 'STATE#CATS#COUNTS' },
          UpdateExpression: 'SET #ver = :newVer, #c1_8 = :c1_8, #c9_16 = :c9_16, #c17_24 = :c17_24, #totEnabled = :totEnabled, #totRemaining = :totRemaining, #updated = :updated',
          ConditionExpression: 'Version = :expectedVer',
          ExpressionAttributeNames: {
            '#ver': 'Version',
            '#c1_8': '1-8',
            '#c9_16': '9-16',
            '#c17_24': '17-24',
            '#totEnabled': 'TotalEnabled',
            '#totRemaining': 'TotalRemaining',
            '#updated': 'UpdatedAt'
          },
          ExpressionAttributeValues: {
            ':newVer': currentCounts.Version + 1,
            ':c1_8': counts1_8,
            ':c9_16': counts9_16,
            ':c17_24': counts17_24,
            ':totEnabled': totalEnabled,
            ':totRemaining': totalRemaining,
            ':updated': new Date().toISOString(),
            ':expectedVer': currentCounts.Version
          }
        }));

        console.log(`✅ Decremented ${categoryId} (position ${categoryPosition}, ${arrayName}[${arrayIndex}]): ${currentRemaining} → ${currentRemaining - 1}`);
        console.log(`📊 Updated totals - Enabled: ${totalEnabled}, Total Remaining: ${totalRemaining}`);
        
        // Mark this question's results as having been processed for category count
        try {
          await db.send(new UpdateCommand({
            TableName: process.env.TABLE_NAME,
            Key: { PK: `GAME#${gameId}`, SK: `QUESTION#${questionId}#RESULTS` },
            UpdateExpression: 'SET CategoryCountDecremented = :flag',
            ExpressionAttributeValues: {
              ':flag': true
            }
          }));
          console.log(`🏷️ Marked question ${questionId} as processed for category count`);
        } catch (markError) {
          console.log(`⚠️ Failed to mark question as processed, but decrement succeeded:`, markError.message);
        }
        
        return; // Success, exit retry loop

      } catch (error) {
        attempts++;
        
        if (error.name === 'ConditionalCheckFailedException') {
          console.log(`🔄 Concurrent update detected, retrying (${attempts}/${maxAttempts})`);
          if (attempts < maxAttempts) {
            // Brief delay before retry
            await new Promise(resolve => setTimeout(resolve, 100 * attempts));
            continue;
          }
        }
        
        throw error; // Re-throw non-retryable errors or max attempts reached
      }
    }
    
    console.log(`❌ Failed to decrement category count after ${maxAttempts} attempts`);
    
  } catch (error) {
    console.error(`❌ Error decrementing category count for game ${gameId}, question ${questionId}:`, error);
    // Don't throw - this shouldn't block results processing
  }
}