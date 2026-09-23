const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, QueryCommand, DeleteCommand, PutCommand, GetCommand, UpdateCommand } = require('@aws-sdk/lib-dynamodb');
const { ApiGatewayManagementApiClient, PostToConnectionCommand } = require('@aws-sdk/client-apigatewaymanagementapi');
const { refSetRef, resolveSetPartition } = require('./set-version');
const { isHidden } = require('./anonymity');
const { encryptItem, decryptItem } = require('./tenant-crypto');
const { ORG } = require('./tenant');
const { countAnsweredQuestion, COUNT_PROJECTION } = require('./session-count');
const {
  isAnswerCorrect, drawnOptions, slotForSubmitted, correctSlots,
} = require('./trivia-answer');

const dynamoClient = new DynamoDBClient({});
const db = DynamoDBDocumentClient.from(dynamoClient);
const apigateway = new ApiGatewayManagementApiClient({
  endpoint: process.env.WEBSOCKET_API_ENDPOINT
});

/**
 * Clean WebSocket Message Handler
 * 
 * Message Patterns:
 * 1. Host → All Players: ASK#Q1, VOTE#Q1, RESULT#Q1, END
 * 2. Player → Host: ANSWERED#Q1, VOTED#Q1, QUIT
 * 3. Future: Player → Player (not implemented)
 * 
 * Flow: Sender → HTTP API (update DynamoDB) → WebSocket → Receiver → HTTP API (fetch data)
 * 
 * Game Type Flows:
 * - Call-and-Answer: ASK# → VOTE# → RESULTS#
 * - Trivia: ASK# → RESULTS# (skip voting)
 * - Wavelength: ASK# → RESULTS# (skip voting)
 */
exports.handler = async (event) => {
  const connectionId = event.requestContext.connectionId;
  
  try {
    const body = JSON.parse(event.body || '{}');

    // Heartbeat keepalive from the client (WebSocketClient._startHeartbeat sends
    // { action: 'ping' }). Reply with a pong. The pong message carries no gameId,
    // so sendToConnection's 410 cleanup path skips the delete.
    if (body.action === 'ping' || body.messageType === 'PING') {
      await sendToConnection(connectionId, { type: 'pong' });
      return { statusCode: 200, body: 'pong' };
    }

    const { messageType, gameId, playerName } = body;

    if (!messageType || !gameId) {
      console.log('❌ Missing required fields: messageType, gameId');
      return { statusCode: 400, body: 'Missing required fields' };
    }

    // A HOST FRAME IS OBEYED ONLY FROM THAT ROOM'S OWN HOST SOCKET. Both the
    // messageType and the gameId are whatever the frame says, and $connect has
    // no authorizer, so without this any socket — one joined to no game, or to
    // another game — could open a vote, close it, or fan a forged hostMessage
    // out to every phone in the room (tests/websocket-host-message-gate.js).
    //
    // Refused BEFORE the body is logged: a refused frame is untrusted input, and
    // its body never reaches the logs. Only the clipped type and game id do.
    const hostFrame = isHostMessage(messageType);
    if (hostFrame && !(await senderIsHostOf(gameId, connectionId))) {
      console.warn(`🚫 Host message ${clipForLog(messageType)} for game ${clipForLog(gameId)} refused: `
        + `connection ${connectionId} is not that game's host`);
      return { statusCode: 403, body: 'Not this game\'s host' };
    }

    // What arrived, never what it said: an ANSWER# body is the player's answer
    // (encrypted at rest — see handlePlayerAnswer) and an ASK# body carries the
    // question. Field NAMES are enough to see a frame's shape.
    console.log(`📨 WebSocket message ${clipForLog(messageType)} for game ${clipForLog(gameId)} `
      + `from ${connectionId}${playerName ? ` (player ${clipForLog(playerName)})` : ''}, `
      + `fields ${clipForLog(Object.keys(body).join(','))}`);

    // Route message based on type
    if (hostFrame) {
      await handleHostMessage(gameId, messageType, body);
    } else if (isPlayerMessage(messageType)) {
      await handlePlayerMessage(gameId, playerName, messageType, body);
    } else {
      console.log(`⚠️ Unknown message type: ${messageType}`);
      return { statusCode: 400, body: 'Unknown message type' };
    }
    
    return { statusCode: 200, body: 'Message processed' };
    
  } catch (error) {
    console.error('❌ WebSocket message error:', error);
    return { statusCode: 500, body: 'Failed to process message' };
  }
};

/**
 * Check if message is from host to all players
 */
function isHostMessage(messageType) {
  return messageType.startsWith('ASK#') || 
         messageType.startsWith('VOTE#') || 
         messageType.startsWith('RESULT#') || 
         messageType === 'END' ||
         messageType === 'REQUEST_VOTE' ||
         messageType === 'CREATE_RESULTS';
}

/**
 * Is this connection the host screen of this game?
 *
 * The SENDER's own row, under the game the FRAME names. connect.js stores
 * `ConnectionType: 'HOST'` only for a handshake that spent a ticket minted for
 * that game (host-tickets.js), so the row is the server's one fact about who
 * drives the room — nothing in the frame is. A host socket for another room has
 * no row under this game, and a socket that joined no game has its row under
 * GAME#LOBBY, stored PLAYER.
 *
 * Strongly consistent: a host that has just reconnected sends its next frame
 * moments after connect.js wrote the row, and a stale read would refuse it. A
 * table error throws to the handler's catch — a 500, never an obeyed frame.
 */
async function senderIsHostOf(gameId, connectionId) {
  const row = await db.send(new GetCommand({
    TableName: process.env.TABLE_NAME,
    Key: { PK: `GAME#${gameId}`, SK: `CONNECTION#${connectionId}` },
    ConsistentRead: true
  }));
  return row.Item?.ConnectionType === 'HOST';
}

/** A frame field fit for a log line: quoted, and short whatever was sent. */
function clipForLog(value) {
  return JSON.stringify(String(value).slice(0, 64));
}

/**
 * An answer as a log line may carry it: its size, never its words.
 *
 * The ANSWER row encrypts `Answer` at rest (handlePlayerAnswer), and a log line
 * that quoted it would hand the same words to anyone who can read the log group
 * — no key, no audit trail. tests/answer-content-not-logged.js.
 */
function describeAnswer(answer) {
  if (typeof answer === 'string') return `${answer.length} chars`;
  if (answer === undefined || answer === null) return 'no answer';
  return `a ${typeof answer}, not a string`;
}

/**
 * Check if message is from player to host
 *
 * `VOTE#` is deliberately NOT here. It is a HOST message — GameHostPage sends
 * its new state verbatim (`sendCleanMessage(newState, ...)`), and `VOTE#001` is
 * a state — so isHostMessage claims it first at the routing fork below and this
 * predicate never sees it. Listing it here as well was not a second opinion,
 * it was dead weight that made an unreachable player-vote path look live.
 *
 * Player votes do not travel over this socket at all: they are an HTTP POST to
 * submit-vote.js, which pads the round number into the SK and notifies the host
 * itself. `VOTED#` (past tense) is the player-side spelling and is still routed
 * here, for a client that wants to announce a vote it already submitted.
 */
function isPlayerMessage(messageType) {
  return messageType.startsWith('ANSWERED#') ||
         messageType.startsWith('VOTED#') ||
         messageType.startsWith('ANSWER#') ||
         messageType === 'QUIT';
}

/**
 * Handle host messages - broadcast to all players in game
 */
async function handleHostMessage(gameId, messageType, messageData) {
  console.log(`🎯 Host message ${messageType} for game ${gameId}`);
  
  try {
    // Handle REQUEST_VOTE by transitioning game state from ASK# to VOTE#
    if (messageType === 'REQUEST_VOTE') {
      await handleRequestVote(gameId, messageData);
    }
    
    // Handle CREATE_RESULTS by transitioning game state from VOTE# to RESULTS#
    if (messageType === 'CREATE_RESULTS') {
      await handleCreateResults(gameId, messageData);
    }
    
    // Get all player connections for this game
    const playerConnections = await getPlayerConnections(gameId);
    console.log(`📡 Broadcasting to ${playerConnections.length} players`);
    
    // Broadcast to all players. Promise.allSettled + a non-throwing
    // sendToConnection means one dead phone can't 500 the whole fan-out.
    const results = await Promise.allSettled(playerConnections.map(connection =>
      sendToConnection(connection.ConnectionId, {
        type: 'hostMessage',
        messageType,
        gameId,
        timestamp: new Date().toISOString(),
        ...messageData
      })
    ));
    const delivered = results.filter(r => r.value?.ok).length;
    console.log(`✅ Host message ${messageType} broadcast complete: ${delivered}/${playerConnections.length} delivered`);
    
  } catch (error) {
    console.error(`❌ Error handling host message ${messageType}:`, error);
    throw error;
  }
}

/**
 * Handle request vote - transition from ASK# to VOTE# state
 */
async function handleRequestVote(gameId, messageData) {
  console.log(`🗳️ Processing request vote for game ${gameId}`);
  
  try {
    // Get current game state
    const gameState = await db.send(new GetCommand({
      TableName: process.env.TABLE_NAME,
      Key: { PK: `GAME#${gameId}`, SK: 'STATE' }
    }));
    
    if (!gameState.Item) {
      console.log(`❌ Game ${gameId} not found`);
      return;
    }
    
    // Get game metadata to check game type
    const gameMetadata = await db.send(new GetCommand({
      TableName: process.env.TABLE_NAME,
      Key: { PK: `GAME#${gameId}`, SK: 'METADATA' }
    }));
    
    const gameType = gameMetadata.Item?.GameType || 'call-and-answer';
    const currentState = gameState.Item.State;
    const currentQuestionId = gameState.Item.CurrentQuestionId;
    
    // Validate we're in an ASK# state
    if (!currentState.startsWith('ASK#') || !currentQuestionId) {
      console.log(`⚠️ Invalid state for vote request. Current state: ${currentState}`);
      return;
    }
    
    // For trivia and wavelength games, the host will handle the transition directly via handleShowResults()
    // No special WebSocket handling needed - use unified flow
    if (gameType === 'trivia') {
      console.log(`🧠 Trivia game detected - host will handle results transition directly via handleShowResults()`);
      return;
    }
    
    if (gameType === 'wavelength') {
      console.log(`🌊 Wavelength game detected - host will handle results transition directly via handleShowResults()`);
      return;
    }
    
    // For call-and-answer games, transition to VOTE# state
    const newState = `VOTE#${currentQuestionId}`;
    const now = new Date().toISOString();
    
    await db.send(new UpdateCommand({
      TableName: process.env.TABLE_NAME,
      Key: { PK: `GAME#${gameId}`, SK: 'STATE' },
      UpdateExpression: 'SET #state = :state, #updatedAt = :updatedAt',
      ExpressionAttributeNames: {
        '#state': 'State',
        '#updatedAt': 'UpdatedAt'
      },
      ExpressionAttributeValues: {
        ':state': newState,
        ':updatedAt': now
      }
    }));
    
    console.log(`✅ Call-and-answer game ${gameId} transitioned to voting state: ${newState}`);
    
  } catch (error) {
    console.error(`❌ Error handling request vote:`, error);
    throw error;
  }
}

/**
 * Handle create results - transition from VOTE# to RESULTS# state and calculate voting results
 */
async function handleCreateResults(gameId, messageData) {
  console.log(`📊 Processing create results for game ${gameId}`);
  
  try {
    // Get current game state
    const gameState = await db.send(new GetCommand({
      TableName: process.env.TABLE_NAME,
      Key: { PK: `GAME#${gameId}`, SK: 'STATE' }
    }));
    
    if (!gameState.Item) {
      console.log(`❌ Game ${gameId} not found`);
      return;
    }
    
    const currentState = gameState.Item.State;
    const currentQuestionId = gameState.Item.CurrentQuestionId;
    
    // Validate we're in a VOTE# state
    if (!currentState.startsWith('VOTE#') || !currentQuestionId) {
      console.log(`⚠️ Invalid state for create results. Current state: ${currentState}`);
      return;
    }
    
    // Get all votes for this question
    const votesQuery = await db.send(new QueryCommand({
      TableName: process.env.TABLE_NAME,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
      ExpressionAttributeValues: {
        ':pk': `GAME#${gameId}`,
        ':sk': `QUESTION#${currentQuestionId}#VOTE#`
      }
    }));
    
    const votes = votesQuery.Items || [];
    console.log(`📊 Found ${votes.length} votes for question ${currentQuestionId}`);
    
    // Calculate vote tallies
    const voteTallies = {};
    votes.forEach(vote => {
      const votedFor = vote.VotedFor;
      if (!voteTallies[votedFor]) {
        voteTallies[votedFor] = 0;
      }
      voteTallies[votedFor]++;
    });
    
    // Find winner(s) - player(s) with most votes
    const maxVotes = Math.max(...Object.values(voteTallies), 0);
    const winners = Object.keys(voteTallies).filter(player => voteTallies[player] === maxVotes);
    
    // Store results in DynamoDB
    const now = new Date().toISOString();
    const resultsRecord = {
      PK: `GAME#${gameId}`,
      SK: `QUESTION#${currentQuestionId}#RESULTS`,
      QuestionId: currentQuestionId,
      VoteTallies: voteTallies,
      Winners: winners,
      TotalVotes: votes.length,
      MaxVotes: maxVotes,
      CreatedAt: now,
      GameId: gameId,
      ttl: Math.floor(Date.now() / 1000) + (7 * 24 * 60 * 60) // 7 days TTL
    };
    
    await db.send(new PutCommand({
      TableName: process.env.TABLE_NAME,
      Item: resultsRecord
    }));
    
    // Transition to RESULTS# state
    const newState = `RESULTS#${currentQuestionId}`;
    
    await db.send(new UpdateCommand({
      TableName: process.env.TABLE_NAME,
      Key: { PK: `GAME#${gameId}`, SK: 'STATE' },
      UpdateExpression: 'SET #state = :state, #updatedAt = :updatedAt',
      ExpressionAttributeNames: {
        '#state': 'State',
        '#updatedAt': 'UpdatedAt'
      },
      ExpressionAttributeValues: {
        ':state': newState,
        ':updatedAt': now
      }
    }));
    
    console.log(`✅ Game ${gameId} transitioned to results state: ${newState}`);
    console.log(`🏆 Winners: ${winners.join(', ')} with ${maxVotes} votes each`);
    
  } catch (error) {
    console.error(`❌ Error handling create results:`, error);
    throw error;
  }
}

/**
 * Handle player answer submission - store in DynamoDB
 */
async function handlePlayerAnswer(gameId, playerName, messageType, messageData) {
  console.log(`💬 Storing answer from ${playerName} in game ${gameId}`);
  console.log(`🔥 WEBSOCKET DEBUG: handlePlayerAnswer called with messageType: ${messageType}, gameId: ${gameId}, playerName: ${playerName}`);
  
  try {
    // Extract question number from messageType (ANSWER#4)
    const rawQuestionNumber = messageType.replace('ANSWER#', '');
    const questionNumber = String(rawQuestionNumber).padStart(3, '0'); // Pad to 3 digits
    const { answer, answerType = 'text' } = messageData;
    
    console.log(`🎯 Processing answer: messageType=${messageType}, rawQuestionNumber=${rawQuestionNumber}, paddedQuestionNumber=${questionNumber}`);
    console.log(`🎯 Answer from ${playerName} in game ${gameId}: ${answerType}, ${describeAnswer(answer)}`);
    
    if (!answer) {
      console.log(`⚠️ No answer provided in message data`);
      return;
    }
    
    // Get current game state to validate we're in the right question state
    const gameState = await db.send(new GetCommand({
      TableName: process.env.TABLE_NAME,
      Key: { PK: `GAME#${gameId}`, SK: 'STATE' }
    }));
    
    if (!gameState.Item) {
      console.log(`❌ Game ${gameId} not found`);
      return;
    }
    
    const currentState = gameState.Item.State;
    
    // Flexible state validation - accept both padded and unpadded formats
    const expectedStates = [
      `ASK#${questionNumber}`,        // Padded format: ASK#001
      `ASK#${rawQuestionNumber}`      // Unpadded format: ASK#1
    ];
    
    console.log(`🎮 State validation: currentState=${currentState}, expectedStates=${expectedStates.join(' OR ')}`);
    
    const isValidState = expectedStates.includes(currentState);
    if (!isValidState) {
      console.log(`⚠️ Invalid state for answer submission. Expected one of: ${expectedStates.join(', ')}, Got: ${currentState}`);
      return;
    }
    
    // Store the answer in DynamoDB (using question number format)
    const now = new Date().toISOString();
    const answerRecord = {
      PK: `GAME#${gameId}`,
      SK: `QUESTION#${questionNumber}#ANSWER#${playerName}`,
      PlayerName: playerName,
      QuestionNumber: questionNumber,
      Answer: answer,
      AnswerType: answerType,
      SubmittedAt: now,
      GameId: gameId,
      ttl: Math.floor(Date.now() / 1000) + (7 * 24 * 60 * 60) // 7 days TTL
    };
    
    // Always store the answer in the standard QUESTION#001#ANSWER#PlayerName location
    // For trivia questions, also calculate correctness and scoring
    if (answerType === 'trivia') {
      try {
        // Get question data to check correct answer
        const questionRef = await db.send(new GetCommand({
          TableName: process.env.TABLE_NAME,
          Key: { PK: `GAME#${gameId}`, SK: `QUESTION#${questionNumber}#REF` }
        }));
        
        if (questionRef.Item) {
          const sourceQuestionId = questionRef.Item.SourceQuestionId;
          const questionSetId = questionRef.Item.SetId;
          const questionStartTime = questionRef.Item.StartedAt;
          
          // Read the VERSION this round was served from (the REF row records
          // it). Scoring against a different version's correctAnswer than the
          // one the player was shown is the worst possible drift.
          //
          // Resolved with the PAIR the REF row pins, never the bare id: a bare
          // id reads as PLATFORM (set-version.js `setRef`), so for a session
          // played from an organisation's own set or from a public copy this
          // read missed, the block below was skipped without a sound, and the
          // whole room was stored with no IsCorrect and no PointsEarned
          // (tests/trivia-scoring-set-scope.js).
          const resolvedSet = await resolveSetPartition(
            db, process.env.TABLE_NAME, refSetRef(questionRef.Item, questionSetId), questionRef.Item.SetVersion
          );

          // Get the actual question to check correct answer
          const questionRow = await db.send(new GetCommand({
            TableName: process.env.TABLE_NAME,
            Key: {
              PK: resolvedSet.pk,
              SK: sourceQuestionId
            }
          }));

          // An org's optionA..optionF are encrypted at rest, and an envelope is
          // not a string: trivia-answer.js draws no option from one, so every
          // answer in the room resolves to no slot and is marked WRONG —
          // whichever way the set spells the right one. Decrypted from the
          // SET's org (the pinned pair above), not the session's: a host in
          // org A may be running a platform or public set, which was never
          // encrypted and passes through. A failure to decrypt lands in the
          // catch below and the answer is stored unscored, as it always was.
          const setOrgId = resolvedSet.scope === ORG ? String(resolvedSet.orgId || '') : '';
          const question = {
            Item: questionRow.Item && setOrgId
              ? await decryptItem(setOrgId, 'question', questionRow.Item)
              : questionRow.Item
          };

          if (question.Item) {
            const points = question.Item.points || 10;
            
            // Check if player's answer is correct.
            //
            // `answer` is the letter the phone drew, NOT the slot the set
            // stores. They differ on any question that skips a slot, because
            // PlayerPage letters only the FILLED options: for optionA/C/D the
            // room sees A, B, C. This used to compare `Option${answer}`
            // directly, which read the drawn letter as a slot id and so paid
            // the player who picked the option one place further down. Both
            // sides are resolved to SLOTS in trivia-answer.js before they meet,
            // and every spelling a set records for the answer is read there —
            // the exact same set the host's phone has always read.
            const isCorrect = isAnswerCorrect(question.Item, answer);
            const drawn = drawnOptions(question.Item);
            const picked = slotForSubmitted(question.Item, answer);

            // Slots and letters only. Neither the pick nor the set's own
            // spelling of the answer is quoted: the pick is the player's answer,
            // and `correctAnswer` is often the option's TEXT, which an org's set
            // holds as ciphertext in optionA..F.
            console.log(`🔍 TRIVIA CHECK: answer ${picked ? 'placed on a drawn option' : 'placed on no drawn option'} (drawn: ${drawn.map((o) => `${o.letter}=${o.slot}`).join(' ')}), correct slot(s) ${correctSlots(question.Item).join(',') || 'none'}, isCorrect: ${isCorrect}`);
            
            // Calculate response time and speed bonus
            let responseTimeMs = 0;
            let speedBonus = 0;
            
            if (questionStartTime) {
              responseTimeMs = new Date(now).getTime() - new Date(questionStartTime).getTime();
              const responseTimeSeconds = responseTimeMs / 1000;
              
              // Speed bonus: max 5 points for answers within 5 seconds, scaling down
              if (isCorrect && responseTimeSeconds <= 30) {
                speedBonus = Math.max(0, Math.round(5 * (1 - responseTimeSeconds / 30)));
              }
            }
            
            const totalPoints = isCorrect ? points + speedBonus : 0;
            
            // Add trivia-specific fields to answer record
            answerRecord.IsCorrect = isCorrect;
            answerRecord.ResponseTimeMs = responseTimeMs;
            answerRecord.SpeedBonus = speedBonus;
            answerRecord.PointsEarned = totalPoints;
            answerRecord.BasePoints = points;
            
            console.log(`🎯 TRIVIA SCORING: ${playerName} on question ${questionNumber}, isCorrect: ${isCorrect}, time: ${responseTimeMs}ms, points: ${totalPoints}`);
          }
        }
      } catch (triviaError) {
        console.error('Error calculating trivia scoring:', triviaError);
        // Continue with basic answer recording even if trivia scoring fails
      }
    } else if (answerType === 'wavelength') {
      // For wavelength questions, process and normalize the word list
      try {
        console.log(`🌊 Processing wavelength answer from ${playerName} (${describeAnswer(answer)})`);
        
        // Parse the comma-separated words and normalize them
        const words = answer.split(',')
          .map(word => word.trim().toLowerCase())
          .filter(word => word.length > 0 && word.length <= 50) // Filter out empty and overly long words
          .slice(0, 10); // Ensure max 10 words
        
        // Store normalized words back in the answer record
        answerRecord.Answer = words.join(',');
        answerRecord.WordCount = words.length;
        answerRecord.ProcessedWords = words; // Store as array for easier processing
        
        console.log(`🌊 Processed ${words.length} words for ${playerName}`);
        
      } catch (wavelengthError) {
        console.error('Error processing wavelength answer:', wavelengthError);
        // Continue with basic answer recording even if wavelength processing fails
      }
    }
    
    // The row's keys and scoring, never the row: `Answer` is what is about to be
    // encrypted, and this line runs BEFORE that happens.
    console.log(`📝 Storing answer row PK: ${answerRecord.PK}, SK: ${answerRecord.SK} — ${answerType}, `
      + `${describeAnswer(answerRecord.Answer)}`
      + ('IsCorrect' in answerRecord ? `, isCorrect: ${answerRecord.IsCorrect}, points: ${answerRecord.PointsEarned}` : ''));

    // ── THE MOST SENSITIVE ROW IN THE TABLE ──────────────────────────────────
    //
    // What a named person said in a retrospective. `ENCRYPTED_FIELDS.answer` is
    // just `Answer`, and everything else on this row stays readable on purpose:
    // `PlayerName`, `IsCorrect`, `PointsEarned` and `ResponseTimeMs` are the
    // scoring machinery, and the privacy page promises identifiers and counts
    // are visible — it is the CONTENT that is not.
    //
    // THE ORG COMES OFF THE SESSION ROW, NOT OFF THE CONNECTION. A player's
    // WebSocket carries no authorizer context — they joined with a four-digit
    // code — so there is no caller org here at all, and a blank one throws
    // rather than defaulting. `GAME#<id>/METADATA.orgId` is the same source
    // every participant-facing HTTP handler uses.
    //
    // A session with no org (created before tenancy) writes plaintext, exactly
    // as it did yesterday; there is no key to write it under.
    // The same read carries what session-count.js needs, so a session that has
    // already counted costs no extra call per answer.
    const sessionMeta = await db.send(new GetCommand({
      TableName: process.env.TABLE_NAME,
      Key: { PK: `GAME#${gameId}`, SK: 'METADATA' },
      ProjectionExpression: COUNT_PROJECTION
    }));
    const answerOrgId = typeof sessionMeta.Item?.orgId === 'string' ? sessionMeta.Item.orgId.trim() : '';
    const itemToStore = answerOrgId
      ? await encryptItem(answerOrgId, 'answer', answerRecord)
      : answerRecord;

    // Answers are counted for the platform dashboard per ROUND, when the host
    // moves on (platform-metrics.js recordRoundClosed) — nothing runs here.
    await db.send(new PutCommand({
      TableName: process.env.TABLE_NAME,
      Item: itemToStore
    }));

    // A SESSION COUNTS toward its organisation's plan at the first answer to
    // its second answered question (session-count.js). After the answer is
    // stored, and it never throws — metering can never lose an answer.
    await countAnsweredQuestion(db, process.env.TABLE_NAME, gameId, questionNumber, sessionMeta.Item || {});

    console.log(`✅ Answer stored for ${playerName} on question ${questionNumber}`);
    console.log(`🔥 WEBSOCKET DEBUG: Successfully stored answer record in DynamoDB`);
    
  } catch (error) {
    console.error(`❌ Error storing player answer:`, error);
    throw error;
  }
}

/*
 * REMOVED: handlePlayerVote.
 *
 * It was unreachable — the routing fork at the top of this file hands every
 * `VOTE#…` to handleHostMessage (it is the host's own state broadcast), so
 * nothing ever called it — and it was a live landmine while it sat here. It
 * built its SK as `QUESTION#${questionId}#VOTE#${playerName}` from a RAW
 * `messageType.replace('VOTE#', '')`, with no padding, while every other path
 * in the system writes and reads `QUESTION#001#VOTE#…`. Anyone who later
 * "fixed" the routing would have started writing votes to keys that
 * get-votes.js, get-results.js and get-game-state.js all query past — a vote
 * that vanishes with no error anywhere, which reads to a player as the system
 * forgetting they voted.
 *
 * The live vote path is HTTP: lambda-functions/game/submit-vote.js. It pads
 * (`String(questionNumber).padStart(3, '0')`), validates the state against the
 * padded form, and notifies every host connection itself.
 */

/**
 * Handle player messages - process and send to host
 */
async function handlePlayerMessage(gameId, playerName, messageType, messageData) {
  console.log(`👤 Player message ${messageType} from ${playerName} in game ${gameId}`);
  
  try {
    // Handle ANSWER# messages by storing the answer in DynamoDB
    if (messageType.startsWith('ANSWER#')) {
      await handlePlayerAnswer(gameId, playerName, messageType, messageData);
    }

    // Every host screen attached to this game
    const hostConnections = await getHostConnections(gameId);

    if (hostConnections.length > 0) {
      // Send specific notification types based on message type
      let notificationType = 'playerMessage';
      let notificationData = {
        messageType,
        gameId,
        playerName,
        timestamp: new Date().toISOString(),
        ...messageData
      };
      
      if (messageType.startsWith('ANSWER#')) {
        notificationType = 'playerAnswered';
        const questionNumber = messageType.replace('ANSWER#', '');
        notificationData.questionNumber = questionNumber;
        notificationData.questionId = questionNumber; // For backward compatibility

        // ANONYMITY. This frame is the one leak a purely HTTP redaction would
        // leave behind: it hands the host's socket a live author-to-answer
        // mapping the moment an answer lands, before any endpoint is called.
        // Under §5.6.2 the host is inside "nobody", so while hidden we announce
        // only THAT an answer arrived and which round it belongs to.
        //
        // The host still needs the count to know whether it can move on, and
        // the count is not attribution — see §5.6.2's split between "who has
        // not acted" and "who wrote which answer".
        const [metaRes, roundRes] = await Promise.all([
          db.send(new GetCommand({
            TableName: process.env.TABLE_NAME,
            Key: { PK: `GAME#${gameId}`, SK: 'METADATA' }
          })),
          // ROUND# keys are always stored zero-padded to 3 digits (see
          // handlePlayerAnswer's own `questionNumber` a few hundred lines up,
          // and start-vote.js / reveal-authors.js) — an unpadded lookup here
          // (e.g. from messageType 'ANSWER#1') misses the row entirely. It
          // fails safe today (isHidden(meta, undefined) still returns hidden),
          // but that's an accident of the default, not a reason to skip padding.
          db.send(new GetCommand({
            TableName: process.env.TABLE_NAME,
            Key: { PK: `GAME#${gameId}`, SK: `ROUND#${String(questionNumber).padStart(3, '0')}` }
          }))
        ]);

        if (isHidden(metaRes.Item, roundRes.Item)) {
          notificationData = {
            messageType,
            gameId,
            questionNumber,
            questionId: questionNumber,
            timestamp: new Date().toISOString()
          };
        }

        console.log(`🔔 Preparing playerAnswered notification: questionNumber=${questionNumber}, playerName=${playerName}`);
      }
      // No `VOTE#` branch: isPlayerMessage does not claim that prefix, so this
      // function is never reached with one. The host's `playerVoted` frame is
      // emitted by submit-vote.js, on the HTTP path the vote actually takes.

      const notificationMessage = {
        type: notificationType,
        ...notificationData
      };
      
      // Field names, not the frame: when the round is not anonymous it carries
      // the answer itself. The names still show whether the author was withheld.
      console.log(`📤 Sending ${notificationType} ${messageType} to ${hostConnections.length} host connection(s), `
        + `fields ${clipForLog(Object.keys(notificationMessage).join(','))}`);

      await Promise.all(hostConnections.map(
        (connection) => sendToConnection(connection.ConnectionId, notificationMessage)
      ));

      console.log(`✅ Player message ${messageType} sent to host`);
    } else {
      console.log(`⚠️ No host connection found for game ${gameId}`);
    }
    
  } catch (error) {
    console.error(`❌ Error handling player message ${messageType}:`, error);
    throw error;
  }
}

/**
 * Get all player connections for a game
 */
async function getPlayerConnections(gameId) {
  try {
    const result = await db.send(new QueryCommand({
      TableName: process.env.TABLE_NAME,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
      FilterExpression: 'ConnectionType = :type',
      ExpressionAttributeValues: {
        ':pk': `GAME#${gameId}`,
        ':sk': 'CONNECTION#',
        ':type': 'PLAYER'
      }
    }));
    
    return result.Items || [];
  } catch (error) {
    console.error(`❌ Error getting player connections for game ${gameId}:`, error);
    return [];
  }
}

/**
 * Every host connection for a game.
 *
 * ALL of them, not `Items[0]`. connect.js retires older host rows, but it
 * deliberately leaves same-millisecond peers alone rather than picking a winner
 * by coin flip (see tests/host-connection-dedup.js), so more than one row can
 * legitimately exist for a moment. Taking the first would mean the host screen
 * the operator is actually looking at is the one that never learns an answer
 * arrived — the same silent failure the dedup ordering exists to prevent, and
 * the only remaining place in the system that talks to a single chosen host
 * instead of broadcasting.
 */
async function getHostConnections(gameId) {
  try {
    const result = await db.send(new QueryCommand({
      TableName: process.env.TABLE_NAME,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
      FilterExpression: 'ConnectionType = :type',
      ExpressionAttributeValues: {
        ':pk': `GAME#${gameId}`,
        ':sk': 'CONNECTION#',
        ':type': 'HOST'
      }
    }));

    return result.Items || [];
  } catch (error) {
    console.error(`❌ Error getting host connections for game ${gameId}:`, error);
    return [];
  }
}

/**
 * Send message to specific WebSocket connection
 */
async function sendToConnection(connectionId, message) {
  try {
    await apigateway.send(new PostToConnectionCommand({
      ConnectionId: connectionId,
      Data: JSON.stringify(message)
    }));
    return { ok: true };
  } catch (error) {
    // 410 Gone == the connection is dead. Delete the stale row inline (the
    // message carries gameId so the PK is known — no full-table Scan needed)
    // and never re-throw, so a single dead phone can't poison the broadcast.
    if (error.statusCode === 410 || error.name === 'GoneException') {
      console.log(`🧹 Removing stale connection ${connectionId}`);
      if (message.gameId) {
        await db.send(new DeleteCommand({
          TableName: process.env.TABLE_NAME,
          Key: { PK: `GAME#${message.gameId}`, SK: `CONNECTION#${connectionId}` }
        })).catch(() => {});
      }
      return { ok: false, stale: true };
    }
    console.error(`❌ Failed to send to connection ${connectionId}:`, error);
    return { ok: false, error };   // degrade gracefully; never block the fan-out
  }
}
