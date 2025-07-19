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
    
    const currentState = gameState.Item.State;
    const currentQuestionId = gameState.Item.CurrentQuestionId;
    
    // Validate we're in an ASK# state
    if (!currentState.startsWith('ASK#') || !currentQuestionId) {
      console.log(`⚠️ Invalid state for vote request. Current state: ${currentState}`);
      return;
    }
    
    // Transition to VOTE# state
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
    
    console.log(`✅ Game ${gameId} transitioned to voting state: ${newState}`);
    
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
  
  try {
    // Extract question number from messageType (ANSWER#4)
    const rawQuestionNumber = messageType.replace('ANSWER#', '');
    const questionNumber = String(rawQuestionNumber).padStart(3, '0'); // Pad to 3 digits
    const { answer, answerType = 'text' } = messageData;
    
    console.log(`🎯 Processing answer: messageType=${messageType}, rawQuestionNumber=${rawQuestionNumber}, paddedQuestionNumber=${questionNumber}`);
    
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
    
    await db.send(new PutCommand({
      TableName: process.env.TABLE_NAME,
      Item: answerRecord
    }));
    
    console.log(`✅ Answer stored for ${playerName} on question ${questionNumber}`);
    
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
