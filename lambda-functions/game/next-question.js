const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, GetCommand, UpdateCommand, QueryCommand, PutCommand } = require('@aws-sdk/lib-dynamodb');
const { ApiGatewayManagementApiClient, PostToConnectionCommand } = require('@aws-sdk/client-apigatewaymanagementapi');

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

// Helper function to set a bit to 0 in a bitmask
const setBitToZero = (mask, position) => {
  const pos = position - 1; // Convert to 0-based index
  return mask.substring(0, pos) + '0' + mask.substring(pos + 1);
};

// Helper function to select next question based on bitmasks
const selectNextQuestion = async (gameId, categoryState, questionSetId) => {
  console.log(`🎯 Selecting next question for game ${gameId}`);
  
  const hostMask1_8 = categoryState['HostMask1-8'];
  const hostMask9_16 = categoryState['HostMask9-16'];
  const hostMask17_24 = categoryState['HostMask17-24'];
  const availMask1_8 = categoryState['AvailMask1-8'];
  const availMask9_16 = categoryState['AvailMask9-16'];
  const availMask17_24 = categoryState['AvailMask17-24'];

  console.log(`🔢 Host masks: ${hostMask1_8} ${hostMask9_16} ${hostMask17_24}`);
  console.log(`🔢 Avail masks: ${availMask1_8} ${availMask9_16} ${availMask17_24}`);

  // Get all categories from question set
  const categoriesQuery = await db.send(new QueryCommand({
    TableName: process.env.TABLE_NAME,
    KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
    ExpressionAttributeValues: {
      ':pk': `SET#${questionSetId}`,
      ':sk': 'CATEGORY#'
    }
  }));

  const allCategories = categoriesQuery.Items || [];
  console.log(`📋 Found ${allCategories.length} categories in question set`);

  // Find available categories (both host enabled AND questions available)
  const availableCategories = [];
  
  for (let i = 0; i < allCategories.length && i < 24; i++) {
    const position = i + 1;
    let hostEnabled = false;
    let questionsAvailable = false;

    // Check host mask
    if (position <= 8) {
      hostEnabled = isBitSet(hostMask1_8, position);
      questionsAvailable = isBitSet(availMask1_8, position);
    } else if (position <= 16) {
      hostEnabled = isBitSet(hostMask9_16, position - 8);
      questionsAvailable = isBitSet(availMask9_16, position - 8);
    } else {
      hostEnabled = isBitSet(hostMask17_24, position - 16);
      questionsAvailable = isBitSet(availMask17_24, position - 16);
    }

    if (hostEnabled && questionsAvailable) {
      const category = allCategories[i];
      const categoryId = category.SK.replace('CATEGORY#', '');
      availableCategories.push({
        categoryId,
        position,
        name: category.Name
      });
    }
  }

  console.log(`🎯 Available categories:`, availableCategories.map(c => `${c.name} (${c.categoryId})`));

  if (availableCategories.length === 0) {
    console.log(`❌ No available categories found`);
    return null;
  }

  // Randomly select from available categories
  const selectedCategory = availableCategories[Math.floor(Math.random() * availableCategories.length)];
  console.log(`🎲 Selected category: ${selectedCategory.name} (${selectedCategory.categoryId})`);

  // Get the next question from this category
  const categoryOrderQuery = await db.send(new GetCommand({
    TableName: process.env.TABLE_NAME,
    Key: { PK: `GAME#${gameId}`, SK: `CATEGORY#${selectedCategory.categoryId}#ORDER` }
  }));

  const categoryActiveQuery = await db.send(new GetCommand({
    TableName: process.env.TABLE_NAME,
    Key: { PK: `GAME#${gameId}`, SK: `CATEGORY#${selectedCategory.categoryId}#ACTIVE` }
  }));

  if (!categoryOrderQuery.Item || !categoryActiveQuery.Item) {
    console.log(`❌ Category order/active data not found for ${selectedCategory.categoryId}`);
    return null;
  }

  const activeIndex = categoryActiveQuery.Item.ActiveIndex || 0;
  const questionCount = categoryActiveQuery.Item.QuestionCount || 0;
  const questionOrder = categoryOrderQuery.Item.QuestionOrder;

  console.log(`📊 Category ${selectedCategory.categoryId}: activeIndex=${activeIndex}, questionCount=${questionCount}`);

  if (activeIndex >= questionCount) {
    console.log(`❌ No more questions in category ${selectedCategory.categoryId}`);
    return null;
  }

  // Get the question number (1-based)
  let questionNumber;
  if (questionOrder && questionOrder.length > activeIndex) {
    questionNumber = questionOrder[activeIndex];
  } else {
    questionNumber = activeIndex + 1;
  }

  const questionNumberPadded = String(questionNumber).padStart(3, '0');
  const questionId = `QUESTION#${selectedCategory.categoryId}#${questionNumberPadded}`;

  console.log(`🎯 Selected question: ${questionId}`);

  return {
    questionId,
    categoryId: selectedCategory.categoryId,
    categoryPosition: selectedCategory.position,
    activeIndex,
    questionCount,
    questionNumber
  };
};

// Efficient WebSocket broadcasting
const broadcastToGame = async (gameId, message) => {
  try {
    console.log(`🔔 WEBSOCKET DEBUG: broadcastToGame called for game ${gameId}`);
    console.log(`🔔 WEBSOCKET DEBUG: Environment WEBSOCKET_API_ENDPOINT: ${process.env.WEBSOCKET_API_ENDPOINT}`);
    console.log(`🔔 WEBSOCKET DEBUG: Message to broadcast:`, JSON.stringify(message, null, 2));
    
    const connectionsResult = await db.send(new QueryCommand({
      TableName: process.env.TABLE_NAME,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
      ExpressionAttributeValues: {
        ':pk': `GAME#${gameId}`,
        ':sk': 'CONNECTION#'
      }
    }));
    
    const connections = connectionsResult.Items || [];
    console.log(`🔔 WEBSOCKET DEBUG: Found ${connections.length} connections for game ${gameId}`);
    console.log(`🔔 WEBSOCKET DEBUG: Connection details:`, connections.map(c => ({
      ConnectionId: c.ConnectionId,
      ConnectionType: c.ConnectionType,
      PlayerName: c.PlayerName,
      ConnectedAt: c.ConnectedAt
    })));
    
    if (connections.length === 0) {
      console.log(`⚠️ WEBSOCKET DEBUG: No active connections found for game ${gameId}`);
      return;
    }
    
    const broadcastPromises = connections.map(async (connection) => {
      try {
        console.log(`🔔 WEBSOCKET DEBUG: Sending to ${connection.ConnectionType} connection ${connection.ConnectionId}`);
        
        const command = new PostToConnectionCommand({
          ConnectionId: connection.ConnectionId,
          Data: JSON.stringify(message)
        });
        
        const result = await apigateway.send(command);
        console.log(`✅ WEBSOCKET DEBUG: Message sent successfully to ${connection.ConnectionId}`, result);
      } catch (error) {
        console.error(`❌ WEBSOCKET DEBUG: Failed to send to connection ${connection.ConnectionId}:`, error);
        console.error(`❌ WEBSOCKET DEBUG: Error details:`, {
          message: error.message,
          statusCode: error.statusCode || error.$response?.statusCode,
          code: error.Code || error.code
        });
        
        // Remove stale connections (410 = Gone)
        if (error.statusCode === 410 || error.$metadata?.httpStatusCode === 410 || error.$response?.statusCode === 410) {
          console.log(`🧹 WEBSOCKET DEBUG: Removing stale connection: ${connection.ConnectionId}`);
          // Note: Connection cleanup would be handled by disconnect function
        }
      }
    });
    
    await Promise.all(broadcastPromises);
    console.log(`✅ WEBSOCKET DEBUG: Broadcast complete for game ${gameId}`);
  } catch (error) {
    console.error('❌ WEBSOCKET DEBUG: Broadcast error:', error);
    console.error('❌ WEBSOCKET DEBUG: Broadcast error details:', {
      message: error.message,
      stack: error.stack
    });
    // Don't throw error - this shouldn't block the question progression
  }
};

exports.handler = async (event) => {
  try {
    const { gameId } = event.pathParameters || {};
    const body = JSON.parse(event.body || '{}');
    const { action } = body; // Allow 'skip' action to force progression
    
    if (!gameId) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Game ID is required' }),
        headers: { 'Access-Control-Allow-Origin': '*' }
      };
    }

    console.log(`➡️ Getting next question for game ${gameId}, action: ${action || 'normal'}`);

    // Get game state
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

    // DUPLICATE PREVENTION: Check current state and validate progression
    const currentState = gameState.Item.State;
    const currentLessonNumber = gameState.Item.LessonNumber || 0;
    
    console.log(`🔒 NEXT-QUESTION: Current state: ${currentState}, lesson: ${currentLessonNumber}`);
    console.log(`🔒 NEXT-QUESTION: Expected transition patterns:`);
    console.log(`🔒   - RESULTS#001 → ASK#002 (normal flow)`);
    console.log(`🔒   - ASK#001 → ASK#002 (skip during ask)`); 
    console.log(`🔒   - VOTE#001 → ASK#002 (skip during vote)`);
    console.log(`🔒 NEXT-QUESTION: Full game state item:`, JSON.stringify(gameState.Item, null, 2));
    
    // Only allow progression from STARTED, ASK#, VOTE#, or RESULTS# states
    const validStates = ['STARTED', 'CREATED'];
    const isValidState = validStates.includes(currentState) || 
                        currentState.startsWith('ASK#') || 
                        currentState.startsWith('VOTE#') || 
                        currentState.startsWith('RESULTS#');
    
    if (!isValidState && action !== 'skip') {
      return {
        statusCode: 400,
        body: JSON.stringify({ 
          error: 'Invalid state transition',
          message: `Cannot advance from state '${currentState}'. Use action 'skip' to force progression.`,
          currentState: currentState
        }),
        headers: { 'Access-Control-Allow-Origin': '*' }
      };
    }

    // Prevent duplicate calls - if currently processing a question, return current state
    if (currentState.startsWith('ASK#') && action !== 'skip') {
      const currentQuestionNumber = currentState.replace('ASK#', '');
      console.log(`⚠️ Already in ASK state for question ${currentQuestionNumber}, not advancing (use action:'skip' to force)`);
      return {
        statusCode: 200,
        body: JSON.stringify({
          success: true,
          message: 'Already asking a question',
          gameId: gameId,
          state: currentState,
          lessonNumber: currentLessonNumber,
          questionId: gameState.Item.CurrentQuestionId
        }),
        headers: { 'Access-Control-Allow-Origin': '*' }
      };
    }

    // Get game metadata for question set ID
    const gameMetadata = await db.send(new GetCommand({
      TableName: process.env.TABLE_NAME,
      Key: { PK: `GAME#${gameId}`, SK: 'METADATA' }
    }));

    if (!gameMetadata.Item || !gameMetadata.Item.QuestionSetId) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Game metadata or question set ID not found' }),
        headers: { 'Access-Control-Allow-Origin': '*' }
      };
    }

    // Get category state
    const categoryState = await db.send(new GetCommand({
      TableName: process.env.TABLE_NAME,
      Key: { PK: `GAME#${gameId}`, SK: 'STATE#CATS' }
    }));

    if (!categoryState.Item) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Category state not found' }),
        headers: { 'Access-Control-Allow-Origin': '*' }
      };
    }

    // Select next question
    const nextQuestion = await selectNextQuestion(gameId, categoryState.Item, gameMetadata.Item.QuestionSetId);

    if (!nextQuestion) {
      return {
        statusCode: 400,
        body: JSON.stringify({ 
          error: 'No questions available',
          message: 'All questions have been used or no categories are available'
        }),
        headers: { 'Access-Control-Allow-Origin': '*' }
      };
    }

    // CREATE QUESTION REFERENCE (as per game flow specification)
    const now = new Date().toISOString();
    const newLessonNumber = currentLessonNumber + 1;
    const questionNumber = String(newLessonNumber).padStart(3, '0');
    const newState = `ASK#${questionNumber}`;

    console.log(`📝 Creating question reference QUESTION#${questionNumber}#REF for ${nextQuestion.questionId}`);

    // Step 1: Create question reference record (CRITICAL: per game flow spec)
    await db.send(new PutCommand({
      TableName: process.env.TABLE_NAME,
      Item: {
        PK: `GAME#${gameId}`,
        SK: `QUESTION#${questionNumber}#REF`,
        SourceQuestionId: nextQuestion.questionId,
        SetId: gameMetadata.Item.QuestionSetId,
        QuestionNumber: questionNumber,
        StartedAt: now,
        ttl: Math.floor(Date.now() / 1000) + (24 * 60 * 60) // 24 hours
      }
    }));

    // Step 2: Update game state
    await db.send(new UpdateCommand({
      TableName: process.env.TABLE_NAME,
      Key: { PK: `GAME#${gameId}`, SK: 'STATE' },
      UpdateExpression: 'SET #state = :state, #currentQuestionId = :questionId, #lessonNumber = :lessonNumber, #updatedAt = :updatedAt',
      ExpressionAttributeNames: {
        '#state': 'State',
        '#currentQuestionId': 'CurrentQuestionId',
        '#lessonNumber': 'LessonNumber',
        '#updatedAt': 'UpdatedAt'
      },
      ExpressionAttributeValues: {
        ':state': newState,
        ':questionId': nextQuestion.questionId,
        ':lessonNumber': newLessonNumber,
        ':updatedAt': now
      }
    }));

    // Update category active index
    await db.send(new UpdateCommand({
      TableName: process.env.TABLE_NAME,
      Key: { PK: `GAME#${gameId}`, SK: `CATEGORY#${nextQuestion.categoryId}#ACTIVE` },
      UpdateExpression: 'SET #activeIndex = :activeIndex',
      ExpressionAttributeNames: {
        '#activeIndex': 'ActiveIndex'
      },
      ExpressionAttributeValues: {
        ':activeIndex': nextQuestion.activeIndex + 1
      }
    }));

    // Check if this category is now exhausted and update AvailMask if needed
    if (nextQuestion.activeIndex + 1 >= nextQuestion.questionCount) {
      console.log(`🏁 Category ${nextQuestion.categoryId} exhausted, updating AvailMask`);
      
      const position = nextQuestion.categoryPosition;
      let updateExpression = '';
      let expressionAttributeNames = {};
      let expressionAttributeValues = {};

      if (position <= 8) {
        const newMask = setBitToZero(categoryState.Item['AvailMask1-8'], position);
        updateExpression = 'SET #availMask1_8 = :availMask1_8';
        expressionAttributeNames['#availMask1_8'] = 'AvailMask1-8';
        expressionAttributeValues[':availMask1_8'] = newMask;
      } else if (position <= 16) {
        const newMask = setBitToZero(categoryState.Item['AvailMask9-16'], position - 8);
        updateExpression = 'SET #availMask9_16 = :availMask9_16';
        expressionAttributeNames['#availMask9_16'] = 'AvailMask9-16';
        expressionAttributeValues[':availMask9_16'] = newMask;
      } else {
        const newMask = setBitToZero(categoryState.Item['AvailMask17-24'], position - 16);
        updateExpression = 'SET #availMask17_24 = :availMask17_24';
        expressionAttributeNames['#availMask17_24'] = 'AvailMask17-24';
        expressionAttributeValues[':availMask17_24'] = newMask;
      }

      await db.send(new UpdateCommand({
        TableName: process.env.TABLE_NAME,
        Key: { PK: `GAME#${gameId}`, SK: 'STATE#CATS' },
        UpdateExpression: updateExpression,
        ExpressionAttributeNames: expressionAttributeNames,
        ExpressionAttributeValues: expressionAttributeValues
      }));
    }

    // Send simplified WebSocket notification to all connected players
    await broadcastToGame(gameId, {
      type: 'questionStarted',
      gameId: gameId,
      state: `GAME#${gameId} ASK#${questionNumber}`,
      questionNumber: questionNumber,
      lessonNumber: newLessonNumber,
      timestamp: now
    });

    console.log(`✅ Next question selected for game ${gameId}: ${nextQuestion.questionId}`);

    return {
      statusCode: 200,
      body: JSON.stringify({
        success: true,
        gameId: gameId,
        state: newState,
        questionId: nextQuestion.questionId,
        lessonNumber: newLessonNumber,
        categoryId: nextQuestion.categoryId,
        message: 'Next question selected successfully'
      }),
      headers: { 'Access-Control-Allow-Origin': '*' }
    };

  } catch (error) {
    console.error('Next question error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: `Failed to get next question: ${error.message}` }),
      headers: { 'Access-Control-Allow-Origin': '*' }
    };
  }
};