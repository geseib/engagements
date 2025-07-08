const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, PutCommand, GetCommand } = require('@aws-sdk/lib-dynamodb');
const { 
  initializeCategoryOrder, 
  getCategoryState, 
  TTL_ACTIVE_PHASE,
  updateHostState 
} = require('./bitmask-category-manager');
const { updateHostState: updateCleanHostState } = require('./clean-state-manager');

const dynamoClient = new DynamoDBClient({});
const db = DynamoDBDocumentClient.from(dynamoClient);

exports.handler = async (event) => {
  const gameId = event.pathParameters.gameId;
  const { 
    useRandomQuestions = true,
    useRandomCategories = true 
  } = JSON.parse(event.body || '{}');
  
  console.log(`🚀 Starting game ${gameId} with random questions: ${useRandomQuestions}, random categories: ${useRandomCategories}`);
  
  try {
    // Get game context to understand selected categories
    const gameContext = await getGameContext(gameId);
    if (!gameContext) {
      return {
        statusCode: 404,
        body: JSON.stringify({ error: 'Game not found' }),
        headers: { 'Access-Control-Allow-Origin': '*' }
      };
    }
    
    // Get category state
    const categoryState = await getCategoryState(gameId);
    if (!categoryState) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Category state not initialized' }),
        headers: { 'Access-Control-Allow-Origin': '*' }
      };
    }
    
    console.log(`📋 Initializing question orders for selected categories`);
    
    // Initialize question orders for each selected category
    const selectedCategories = gameContext.SelectedCategories || [];
    const questionSetId = gameContext.QuestionSetId;
    
    // Get question counts for each category from the question set
    const categoryCounts = await getCategoryQuestionCounts(questionSetId, selectedCategories);
    
    // Initialize order and active state for each category
    const initPromises = selectedCategories.map(async (categoryName, index) => {
      const categoryNumber = index + 1; // Simple mapping for now
      const questionCount = categoryCounts[categoryName] || 5; // Default to 5 if not found
      
      console.log(`🎯 Initializing category ${categoryNumber}: ${categoryName} (${questionCount} questions)`);
      
      return initializeCategoryOrder(
        gameId, 
        categoryNumber, 
        categoryName, 
        questionCount, 
        useRandomQuestions
      );
    });
    
    await Promise.all(initPromises);
    
    // Update game state to LOBBY with active TTL
    const ttl = Math.floor(Date.now() / 1000) + TTL_ACTIVE_PHASE;
    
    await db.send(new PutCommand({
      TableName: process.env.TABLE_NAME,
      Item: {
        PK: `GAME#${gameId}`,
        SK: 'STATE',
        HostState: 'LOBBY',
        CurrentQuestionId: null,
        PlayedQuestions: [],
        GameStarted: true,
        UseRandomQuestions: useRandomQuestions,
        UseRandomCategories: useRandomCategories,
        StartedAt: new Date().toISOString(),
        UpdatedAt: new Date().toISOString(),
        ttl
      }
    }));
    
    // Update host state using clean state management
    await updateCleanHostState(gameId, 'LOBBY', null, {
      GameStarted: true,
      UseRandomQuestions: useRandomQuestions,
      UseRandomCategories: useRandomCategories,
      StartedAt: new Date().toISOString()
    });
    
    // Update all game records to use active TTL (7 days instead of 90 days)
    await updateGameTTLToActive(gameId);
    
    console.log(`✅ Game ${gameId} started successfully`);
    
    return {
      statusCode: 200,
      body: JSON.stringify({
        status: 'OK',
        gameId,
        hostState: 'LOBBY',
        categoriesInitialized: selectedCategories.length,
        useRandomQuestions,
        useRandomCategories,
        startedAt: new Date().toISOString()
      }),
      headers: { 'Access-Control-Allow-Origin': '*' }
    };
  } catch (error) {
    console.error(`❌ Error starting game ${gameId}:`, error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Failed to start game' }),
      headers: { 'Access-Control-Allow-Origin': '*' }
    };
  }
};

// Helper functions
const getGameContext = async (gameId) => {
  try {
    const result = await db.send(new GetCommand({
      TableName: process.env.TABLE_NAME,
      Key: { PK: `GAME#${gameId}`, SK: 'CONTEXT' }
    }));
    return result.Item;
  } catch (error) {
    console.error(`❌ Error getting game context for ${gameId}:`, error);
    return null;
  }
};

const getCategoryQuestionCounts = async (questionSetId, selectedCategories) => {
  try {
    console.log(`📊 Getting question counts for categories in set ${questionSetId}`);
    
    // TODO: Query the question set to get actual question counts per category
    // For now, return mock data
    const counts = {};
    selectedCategories.forEach(category => {
      counts[category] = Math.floor(Math.random() * 10) + 5; // 5-14 questions per category
    });
    
    console.log(`📊 Category question counts:`, counts);
    return counts;
  } catch (error) {
    console.error(`❌ Error getting category question counts:`, error);
    return {};
  }
};

const updateGameTTLToActive = async (gameId) => {
  try {
    console.log(`⏰ Updating TTL to active phase (7 days) for game ${gameId}`);
    
    const ttl = Math.floor(Date.now() / 1000) + TTL_ACTIVE_PHASE;
    
    // Update CONTEXT record TTL
    const contextResult = await db.send(new GetCommand({
      TableName: process.env.TABLE_NAME,
      Key: { PK: `GAME#${gameId}`, SK: 'CONTEXT' }
    }));
    
    if (contextResult.Item) {
      await db.send(new PutCommand({
        TableName: process.env.TABLE_NAME,
        Item: {
          ...contextResult.Item,
          ttl,
          UpdatedAt: new Date().toISOString()
        }
      }));
    }
    
    // Update STATE#CATS record TTL
    const catsResult = await db.send(new GetCommand({
      TableName: process.env.TABLE_NAME,
      Key: { PK: `GAME#${gameId}`, SK: 'STATE#CATS' }
    }));
    
    if (catsResult.Item) {
      await db.send(new PutCommand({
        TableName: process.env.TABLE_NAME,
        Item: {
          ...catsResult.Item,
          ttl,
          UpdatedAt: new Date().toISOString()
        }
      }));
    }
    
    console.log(`✅ TTL updated to active phase for game ${gameId}`);
  } catch (error) {
    console.error(`❌ Error updating TTL for game ${gameId}:`, error);
  }
};
