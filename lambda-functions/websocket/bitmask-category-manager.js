const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, PutCommand, GetCommand, QueryCommand } = require('@aws-sdk/lib-dynamodb');

const dynamoClient = new DynamoDBClient({});
const db = DynamoDBDocumentClient.from(dynamoClient);

// Category bitmask values (powers of 2)
const CATEGORY_BITMASKS = {
  1: 1,     // 00000001
  2: 2,     // 00000010  
  3: 4,     // 00000100
  4: 8,     // 00001000
  5: 16,    // 00010000
  6: 32,    // 00100000
  7: 64,    // 01000000
  8: 128,   // 10000000
  // 9-16 use HostMask9-16
  // 17-24 use HostMask17-24
};

// TTL Constants
const TTL_CREATION_PHASE = 90 * 24 * 60 * 60; // 90 days
const TTL_ACTIVE_PHASE = 7 * 24 * 60 * 60;    // 7 days

// Helper functions for bitmask operations
const isCategorySelected = (hostMask, categoryBitmask) => (hostMask & categoryBitmask) !== 0;
const isCategoryAvailable = (availMask, categoryBitmask) => (availMask & categoryBitmask) !== 0;
const isCategoryExhausted = (availMask, categoryBitmask) => (availMask & categoryBitmask) === 0;
const markCategoryExhausted = (availMask, categoryBitmask) => availMask & (~categoryBitmask);
const getAvailableCategories = (hostMask, availMask) => hostMask & availMask;

// Convert category number to bitmask group and value
const getCategoryBitmaskInfo = (categoryNumber) => {
  if (categoryNumber >= 1 && categoryNumber <= 8) {
    return { group: '1-8', bitmask: Math.pow(2, categoryNumber - 1) };
  } else if (categoryNumber >= 9 && categoryNumber <= 16) {
    return { group: '9-16', bitmask: Math.pow(2, categoryNumber - 9) };
  } else if (categoryNumber >= 17 && categoryNumber <= 24) {
    return { group: '17-24', bitmask: Math.pow(2, categoryNumber - 17) };
  }
  throw new Error(`Invalid category number: ${categoryNumber}`);
};

// Initialize category state for a game
const initializeCategoryState = async (gameId, selectedCategories, questionSetId, isGameStarted = false) => {
  try {
    console.log(`🎯 Initializing category state for game ${gameId}:`, selectedCategories);
    
    const ttl = Math.floor(Date.now() / 1000) + (isGameStarted ? TTL_ACTIVE_PHASE : TTL_CREATION_PHASE);
    
    // Build bitmasks for selected categories
    let hostMask1_8 = 0, hostMask9_16 = 0, hostMask17_24 = 0;
    let availMask1_8 = 0, availMask9_16 = 0, availMask17_24 = 0;
    
    // Get available categories from question set
    const availableCategories = await getAvailableCategoriesFromSet(questionSetId);
    
    for (const category of selectedCategories) {
      const categoryNumber = getCategoryNumberFromName(category, availableCategories);
      const { group, bitmask } = getCategoryBitmaskInfo(categoryNumber);
      
      // Set host mask (selected categories)
      if (group === '1-8') hostMask1_8 |= bitmask;
      else if (group === '9-16') hostMask9_16 |= bitmask;
      else if (group === '17-24') hostMask17_24 |= bitmask;
      
      // Set available mask (initially same as host mask)
      if (group === '1-8') availMask1_8 |= bitmask;
      else if (group === '9-16') availMask9_16 |= bitmask;
      else if (group === '17-24') availMask17_24 |= bitmask;
    }
    
    // Store category state
    await db.send(new PutCommand({
      TableName: process.env.TABLE_NAME,
      Item: {
        PK: `GAME#${gameId}`,
        SK: 'STATE#CATS',
        HostMask1_8: hostMask1_8.toString(2).padStart(8, '0'),
        HostMask9_16: hostMask9_16.toString(2).padStart(8, '0'),
        HostMask17_24: hostMask17_24.toString(2).padStart(8, '0'),
        AvailMask1_8: availMask1_8.toString(2).padStart(8, '0'),
        AvailMask9_16: availMask9_16.toString(2).padStart(8, '0'),
        AvailMask17_24: availMask17_24.toString(2).padStart(8, '0'),
        SelectedCategories: selectedCategories,
        QuestionSetId: questionSetId,
        CreatedAt: new Date().toISOString(),
        UpdatedAt: new Date().toISOString(),
        ttl
      }
    }));
    
    console.log(`✅ Category state initialized for game ${gameId}`);
    
    // Initialize category counts for dynamic management
    await initializeCategoryCounts(gameId, selectedCategories, availableCategories, questionSetId);
    
    return true;
  } catch (error) {
    console.error(`❌ Error initializing category state for game ${gameId}:`, error);
    throw error;
  }
};

// Initialize question order for a category
const initializeCategoryOrder = async (gameId, categoryNumber, categoryName, questionCount, isRandom = true) => {
  try {
    console.log(`📋 Initializing order for category ${categoryNumber} (${categoryName}): ${questionCount} questions, random: ${isRandom}`);
    
    const ttl = Math.floor(Date.now() / 1000) + TTL_ACTIVE_PHASE;
    
    // Generate question order
    let questionOrder = [];
    if (isRandom) {
      // Create array [1,2,3...questionCount] and shuffle
      questionOrder = Array.from({length: questionCount}, (_, i) => i + 1);
      for (let i = questionOrder.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [questionOrder[i], questionOrder[j]] = [questionOrder[j], questionOrder[i]];
      }
    }
    // If not random, no order array needed (sequential 1,2,3...)
    
    // Store category order
    await db.send(new PutCommand({
      TableName: process.env.TABLE_NAME,
      Item: {
        PK: `GAME#${gameId}`,
        SK: `CAT#${categoryNumber.toString().padStart(3, '0')}#ORDER`,
        CategoryNumber: categoryNumber,
        CategoryName: categoryName,
        IsRandom: isRandom,
        QuestionOrder: isRandom ? questionOrder : [],
        TotalQuestions: questionCount,
        CreatedAt: new Date().toISOString(),
        ttl
      }
    }));
    
    // Initialize active state
    await db.send(new PutCommand({
      TableName: process.env.TABLE_NAME,
      Item: {
        PK: `GAME#${gameId}`,
        SK: `CAT#${categoryNumber.toString().padStart(3, '0')}#ACTIVE`,
        CategoryNumber: categoryNumber,
        CategoryName: categoryName,
        QuestionCount: questionCount,
        ActiveIndex: 0, // Start at 0 (first question)
        QuestionsUsed: 0,
        RemainingQuestions: questionCount,
        CompletedAt: null,
        CreatedAt: new Date().toISOString(),
        UpdatedAt: new Date().toISOString(),
        ttl
      }
    }));
    
    console.log(`✅ Category ${categoryNumber} order and active state initialized`);
    return true;
  } catch (error) {
    console.error(`❌ Error initializing category ${categoryNumber} order:`, error);
    throw error;
  }
};

// Get next category to use (random or sequential)
const getNextCategory = async (gameId, useRandomCategory = true) => {
  try {
    console.log(`🎲 Getting next category for game ${gameId}, random: ${useRandomCategory}`);
    
    // Get category state
    const categoryState = await getCategoryState(gameId);
    if (!categoryState) {
      throw new Error(`No category state found for game ${gameId}`);
    }
    
    // Calculate available categories (selected AND still have questions)
    const hostMask1_8 = parseInt(categoryState.HostMask1_8, 2);
    const availMask1_8 = parseInt(categoryState.AvailMask1_8, 2);
    const availableCategories1_8 = hostMask1_8 & availMask1_8;
    
    // TODO: Handle 9-16 and 17-24 ranges
    
    if (availableCategories1_8 === 0) {
      console.log(`🏁 No more available categories for game ${gameId}`);
      return null; // Game complete
    }
    
    let selectedCategoryBitmask;
    
    if (useRandomCategory) {
      // Random selection from available categories
      const availableBits = [];
      for (let i = 0; i < 8; i++) {
        const bitmask = Math.pow(2, i);
        if (availableCategories1_8 & bitmask) {
          availableBits.push({ number: i + 1, bitmask });
        }
      }
      
      if (availableBits.length === 0) return null;
      
      const randomIndex = Math.floor(Math.random() * availableBits.length);
      selectedCategoryBitmask = availableBits[randomIndex];
    } else {
      // Sequential selection (lowest available bit)
      for (let i = 0; i < 8; i++) {
        const bitmask = Math.pow(2, i);
        if (availableCategories1_8 & bitmask) {
          selectedCategoryBitmask = { number: i + 1, bitmask };
          break;
        }
      }
    }
    
    if (!selectedCategoryBitmask) return null;
    
    console.log(`✅ Selected category ${selectedCategoryBitmask.number} for game ${gameId}`);
    return selectedCategoryBitmask.number;
  } catch (error) {
    console.error(`❌ Error getting next category for game ${gameId}:`, error);
    throw error;
  }
};

// Get next question from a category
const getNextQuestionFromCategory = async (gameId, categoryNumber) => {
  try {
    console.log(`📝 Getting next question from category ${categoryNumber} for game ${gameId}`);
    
    // Get category order and active state
    const [orderData, activeData] = await Promise.all([
      getCategoryOrder(gameId, categoryNumber),
      getCategoryActive(gameId, categoryNumber)
    ]);
    
    if (!orderData || !activeData) {
      throw new Error(`Category ${categoryNumber} not found for game ${gameId}`);
    }
    
    // Check if category is exhausted
    if (activeData.ActiveIndex >= activeData.QuestionCount) {
      console.log(`🏁 Category ${categoryNumber} exhausted for game ${gameId}`);
      await markCategoryAsExhausted(gameId, categoryNumber);
      return null;
    }
    
    // Get next question number
    let questionNumber;
    if (orderData.IsRandom) {
      questionNumber = orderData.QuestionOrder[activeData.ActiveIndex];
    } else {
      questionNumber = activeData.ActiveIndex + 1; // Sequential: 1, 2, 3...
    }
    
    // Update active index
    await updateCategoryActiveIndex(gameId, categoryNumber, activeData.ActiveIndex + 1);
    
    console.log(`✅ Next question from category ${categoryNumber}: Q${questionNumber.toString().padStart(3, '0')}`);
    return {
      questionNumber,
      categoryNumber,
      categoryName: activeData.CategoryName,
      isLastInCategory: (activeData.ActiveIndex + 1) >= activeData.QuestionCount
    };
  } catch (error) {
    console.error(`❌ Error getting next question from category ${categoryNumber}:`, error);
    throw error;
  }
};

// Helper functions
const getCategoryState = async (gameId) => {
  const result = await db.send(new GetCommand({
    TableName: process.env.TABLE_NAME,
    Key: { PK: `GAME#${gameId}`, SK: 'STATE#CATS' }
  }));
  return result.Item;
};

const getCategoryOrder = async (gameId, categoryNumber) => {
  const result = await db.send(new GetCommand({
    TableName: process.env.TABLE_NAME,
    Key: { PK: `GAME#${gameId}`, SK: `CAT#${categoryNumber.toString().padStart(3, '0')}#ORDER` }
  }));
  return result.Item;
};

const getCategoryActive = async (gameId, categoryNumber) => {
  const result = await db.send(new GetCommand({
    TableName: process.env.TABLE_NAME,
    Key: { PK: `GAME#${gameId}`, SK: `CAT#${categoryNumber.toString().padStart(3, '0')}#ACTIVE` }
  }));
  return result.Item;
};

const updateCategoryActiveIndex = async (gameId, categoryNumber, newIndex) => {
  const activeData = await getCategoryActive(gameId, categoryNumber);
  if (!activeData) return;
  
  const ttl = Math.floor(Date.now() / 1000) + TTL_ACTIVE_PHASE;
  
  await db.send(new PutCommand({
    TableName: process.env.TABLE_NAME,
    Item: {
      ...activeData,
      ActiveIndex: newIndex,
      QuestionsUsed: newIndex,
      RemainingQuestions: activeData.QuestionCount - newIndex,
      UpdatedAt: new Date().toISOString(),
      ttl
    }
  }));
};

const markCategoryAsExhausted = async (gameId, categoryNumber) => {
  // TODO: Update AvailMask to remove this category
  console.log(`🏁 Marking category ${categoryNumber} as exhausted for game ${gameId}`);
};

// Placeholder functions (to be implemented)
const getAvailableCategoriesFromSet = async (questionSetId) => {
  // TODO: Query question set to get available categories
  return [
    { number: 1, name: 'Leadership' },
    { number: 2, name: 'Innovation' },
    { number: 3, name: 'Agile Practices' },
    { number: 4, name: 'Communication' }
  ];
};

const getCategoryNumberFromName = (categoryName, availableCategories) => {
  const category = availableCategories.find(cat => cat.name === categoryName);
  return category ? category.number : 1; // Default to 1 if not found
};

// Initialize category counts for dynamic management using array-based approach
const initializeCategoryCounts = async (gameId, selectedCategories, availableCategories, questionSetId) => {
  try {
    console.log(`📊 Initializing category counts for game ${gameId} using array-based approach`);
    
    const ttl = Math.floor(Date.now() / 1000) + TTL_ACTIVE_PHASE;
    
    // Initialize arrays for three bitmask groups
    const counts1_8 = new Array(8).fill(0);
    const counts9_16 = new Array(8).fill(0);
    const counts17_24 = new Array(8).fill(0);
    
    let totalQuestions = 0;
    
    for (const categoryName of selectedCategories) {
      const categoryNumber = getCategoryNumberFromName(categoryName, availableCategories);
      const categoryInfo = availableCategories.find(cat => cat.name === categoryName);
      
      // Get actual question count for this category
      const questionCount = await getCategoryQuestionCount(questionSetId, categoryInfo?.id || categoryName);
      
      // Place count in appropriate array based on position
      if (categoryNumber >= 1 && categoryNumber <= 8) {
        counts1_8[categoryNumber - 1] = questionCount;
      } else if (categoryNumber >= 9 && categoryNumber <= 16) {
        counts9_16[categoryNumber - 9] = questionCount;
      } else if (categoryNumber >= 17 && categoryNumber <= 24) {
        counts17_24[categoryNumber - 17] = questionCount;
      }
      
      totalQuestions += questionCount;
    }
    
    // Store category counts state with array-based structure
    await db.send(new PutCommand({
      TableName: process.env.TABLE_NAME,
      Item: {
        PK: `GAME#${gameId}`,
        SK: 'STATE#CATS#COUNTS',
        Version: 1,
        '1-8': counts1_8,
        '9-16': counts9_16,
        '17-24': counts17_24,
        TotalEnabled: totalQuestions,
        TotalRemaining: totalQuestions,
        CreatedAt: new Date().toISOString(),
        UpdatedAt: new Date().toISOString(),
        ttl
      }
    }));
    
    console.log(`✅ Category counts initialized using arrays: ${totalQuestions} total questions across ${selectedCategories.length} categories`);
    console.log(`📊 Counts - 1-8: [${counts1_8.join(',')}], 9-16: [${counts9_16.join(',')}], 17-24: [${counts17_24.join(',')}]`);
    return true;
  } catch (error) {
    console.error(`❌ Error initializing category counts for game ${gameId}:`, error);
    // Don't throw - this is an enhancement, shouldn't break existing flow
    return false;
  }
};

// Get actual question count for a category
const getCategoryQuestionCount = async (questionSetId, categoryId) => {
  try {
    // Query questions for this category
    const result = await db.send(new QueryCommand({
      TableName: process.env.TABLE_NAME,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
      ExpressionAttributeValues: {
        ':pk': `SET#${questionSetId}`,
        ':sk': `QUESTION#${categoryId}#`
      }
    }));
    
    return result.Items?.length || 5; // Default to 5 if not found
  } catch (error) {
    console.error(`Error getting question count for category ${categoryId}:`, error);
    return 5; // Default fallback
  }
};

module.exports = {
  initializeCategoryState,
  initializeCategoryOrder,
  getNextCategory,
  getNextQuestionFromCategory,
  getCategoryState,
  getCategoryOrder,
  getCategoryActive,
  CATEGORY_BITMASKS,
  TTL_CREATION_PHASE,
  TTL_ACTIVE_PHASE
};
