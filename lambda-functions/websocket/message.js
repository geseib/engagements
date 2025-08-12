const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, QueryCommand, DeleteCommand, PutCommand, GetCommand, UpdateCommand } = require('@aws-sdk/lib-dynamodb');
const { ApiGatewayManagementApiClient, PostToConnectionCommand } = require('@aws-sdk/client-apigatewaymanagementapi');

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
    const body = JSON.parse(event.body);
    console.log(`📨 WebSocket Message from ${connectionId}:`, body);
    
    const { messageType, gameId, playerName } = body;
    
    if (!messageType || !gameId) {
      console.log('❌ Missing required fields: messageType, gameId');
      return { statusCode: 400, body: 'Missing required fields' };
    }
    
    // Route message based on type
    if (isHostMessage(messageType)) {
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
 * Check if message is from player to host
 */
function isPlayerMessage(messageType) {
  return messageType.startsWith('ANSWERED#') || 
         messageType.startsWith('VOTED#') || 
         messageType.startsWith('ANSWER#') ||
         messageType.startsWith('VOTE#') ||
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
    
    // Broadcast to all players
    const broadcastPromises = playerConnections.map(connection =>
      sendToConnection(connection.ConnectionId, {
        type: 'hostMessage',
        messageType,
        gameId,
        timestamp: new Date().toISOString(),
        ...messageData
      })
    );
    
    await Promise.all(broadcastPromises);
    console.log(`✅ Host message ${messageType} broadcast complete`);
    
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
    console.log(`🎯 DEBUG TRIVIA ANSWER: playerName=${playerName}, answer=${answer}, answerType=${answerType}, gameId=${gameId}`);
    
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
          
          // Get the actual question to check correct answer
          const question = await db.send(new GetCommand({
            TableName: process.env.TABLE_NAME,
            Key: { 
              PK: `SET#${questionSetId}`, 
              SK: sourceQuestionId 
            }
          }));
          
          if (question.Item) {
            const correctAnswer = question.Item.correctAnswer;
            const points = question.Item.points || 10;
            
            // Check if player's answer is correct
            // Handle both single correct answers and multiple correct answers
            let isCorrect = false;
            if (Array.isArray(correctAnswer)) {
              // Multiple correct answers: check if player's option ID is in the array
              isCorrect = correctAnswer.includes(`Option${answer}`);
            } else if (typeof correctAnswer === 'string') {
              // Single correct answer: check if it matches the option ID
              isCorrect = correctAnswer === `Option${answer}`;
            }
            
            console.log(`🔍 TRIVIA CHECK: Player answered "${answer}" -> "Option${answer}", correct answer(s): ${JSON.stringify(correctAnswer)}, isCorrect: ${isCorrect}`);
            
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
            
            console.log(`🎯 TRIVIA SCORING: ${playerName} answered ${answer} (correct: ${correctAnswer}), isCorrect: ${isCorrect}, time: ${responseTimeMs}ms, points: ${totalPoints}`);
          }
        }
      } catch (triviaError) {
        console.error('Error calculating trivia scoring:', triviaError);
        // Continue with basic answer recording even if trivia scoring fails
      }
    } else if (answerType === 'wavelength') {
      // For wavelength questions, process and normalize the word list
      try {
        console.log(`🌊 Processing wavelength answer from ${playerName}: ${answer}`);
        
        // Parse the comma-separated words and normalize them
        const words = answer.split(',')
          .map(word => word.trim().toLowerCase())
          .filter(word => word.length > 0 && word.length <= 50) // Filter out empty and overly long words
          .slice(0, 10); // Ensure max 10 words
        
        // Store normalized words back in the answer record
        answerRecord.Answer = words.join(',');
        answerRecord.WordCount = words.length;
        answerRecord.ProcessedWords = words; // Store as array for easier processing
        
        console.log(`🌊 Processed ${words.length} words for ${playerName}: [${words.join(', ')}]`);
        
      } catch (wavelengthError) {
        console.error('Error processing wavelength answer:', wavelengthError);
        // Continue with basic answer recording even if wavelength processing fails
      }
    }
    
    console.log(`📝 STORING ANSWER RECORD:`, JSON.stringify(answerRecord, null, 2));
    console.log(`🔥 WEBSOCKET DEBUG: About to store answer record with PK: ${answerRecord.PK}, SK: ${answerRecord.SK}`);
    
    await db.send(new PutCommand({
      TableName: process.env.TABLE_NAME,
      Item: answerRecord
    }));
    
    console.log(`✅ Answer stored for ${playerName} on question ${questionNumber}`);
    console.log(`🔥 WEBSOCKET DEBUG: Successfully stored answer record in DynamoDB`);
    
  } catch (error) {
    console.error(`❌ Error storing player answer:`, error);
    throw error;
  }
}

/**
 * Handle player vote submission - store in DynamoDB
 */
async function handlePlayerVote(gameId, playerName, messageType, messageData) {
  console.log(`🗳️ Storing vote from ${playerName} in game ${gameId}`);
  
  try {
    // Extract question ID from messageType (VOTE#QUESTION#categoryId#001)
    const questionId = messageType.replace('VOTE#', '');
    const { votedFor, voteType = 'answer' } = messageData;
    
    if (!votedFor) {
      console.log(`⚠️ No vote target provided in message data`);
      return;
    }
    
    // Get current game state to validate we're in the right voting state
    const gameState = await db.send(new GetCommand({
      TableName: process.env.TABLE_NAME,
      Key: { PK: `GAME#${gameId}`, SK: 'STATE' }
    }));
    
    if (!gameState.Item) {
      console.log(`❌ Game ${gameId} not found`);
      return;
    }
    
    const currentState = gameState.Item.State;
    const expectedState = `VOTE#${questionId}`;
    
    if (currentState !== expectedState) {
      console.log(`⚠️ Invalid state for vote submission. Expected: ${expectedState}, Got: ${currentState}`);
      return;
    }
    
    // Store the vote in DynamoDB
    const now = new Date().toISOString();
    const voteRecord = {
      PK: `GAME#${gameId}`,
      SK: `QUESTION#${questionId}#VOTE#${playerName}`,
      PlayerName: playerName,
      QuestionId: questionId,
      VotedFor: votedFor, // This could be another player's name or answer ID
      VoteType: voteType,
      SubmittedAt: now,
      GameId: gameId,
      ttl: Math.floor(Date.now() / 1000) + (7 * 24 * 60 * 60) // 7 days TTL
    };
    
    await db.send(new PutCommand({
      TableName: process.env.TABLE_NAME,
      Item: voteRecord
    }));
    
    console.log(`✅ Vote stored for ${playerName} on question ${questionId}: voted for ${votedFor}`);
    
  } catch (error) {
    console.error(`❌ Error storing player vote:`, error);
    throw error;
  }
}

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
    
    // Handle VOTE# messages by storing the vote in DynamoDB
    if (messageType.startsWith('VOTE#')) {
      await handlePlayerVote(gameId, playerName, messageType, messageData);
    }
    
    // Get host connection for this game
    const hostConnection = await getHostConnection(gameId);
    
    if (hostConnection) {
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
        console.log(`🔔 Preparing playerAnswered notification: questionNumber=${questionNumber}, playerName=${playerName}`);
      } else if (messageType.startsWith('VOTE#')) {
        notificationType = 'playerVoted';
        const questionNumber = messageType.replace('VOTE#', '');
        notificationData.questionNumber = questionNumber;
        notificationData.questionId = questionNumber; // For backward compatibility
      }
      
      const notificationMessage = {
        type: notificationType,
        ...notificationData
      };
      
      console.log(`📤 Sending notification to host:`, notificationMessage);
      
      await sendToConnection(hostConnection.ConnectionId, notificationMessage);
      
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
 * Get host connection for a game
 */
async function getHostConnection(gameId) {
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
    
    return result.Items?.[0] || null;
  } catch (error) {
    console.error(`❌ Error getting host connection for game ${gameId}:`, error);
    return null;
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
  } catch (error) {
    console.error(`❌ Failed to send to connection ${connectionId}:`, error);
    
    // Remove stale connections
    if (error.statusCode === 410) {
      console.log(`🧹 Removing stale connection ${connectionId}`);
      // Note: Connection cleanup will be handled by disconnect function
    }
    
    throw error;
  }
}
