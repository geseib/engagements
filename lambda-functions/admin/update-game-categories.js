const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, GetCommand, UpdateCommand, QueryCommand } = require('@aws-sdk/lib-dynamodb');
const { resolveSetPartition } = require('./shared/set-version');

const client = new DynamoDBClient({});
const db = DynamoDBDocumentClient.from(client);

// Helper function to convert array of category names to bitmasks
const convertCategoriesToBitmasks = (selectedCategories, allCategories) => {
  console.log('🔄 Converting categories to bitmasks:', selectedCategories);
  
  // Initialize bitmasks as arrays of '0's
  let hostMask1_8 = '00000000';
  let hostMask9_16 = '00000000';
  let hostMask17_24 = '00000000';
  
  // If no categories selected, enable all categories
  if (!selectedCategories || selectedCategories.length === 0) {
    console.log('📋 No categories selected - enabling all categories');
    const categoryCount = allCategories.length;
    
    // Set bits for available categories
    for (let i = 0; i < Math.min(categoryCount, 8); i++) {
      hostMask1_8 = hostMask1_8.substring(0, i) + '1' + hostMask1_8.substring(i + 1);
    }
    for (let i = 8; i < Math.min(categoryCount, 16); i++) {
      const pos = i - 8;
      hostMask9_16 = hostMask9_16.substring(0, pos) + '1' + hostMask9_16.substring(pos + 1);
    }
    for (let i = 16; i < Math.min(categoryCount, 24); i++) {
      const pos = i - 16;
      hostMask17_24 = hostMask17_24.substring(0, pos) + '1' + hostMask17_24.substring(pos + 1);
    }
  } else {
    // Enable only selected categories
    selectedCategories.forEach(categoryName => {
      const categoryIndex = allCategories.findIndex(cat => cat.name === categoryName);
      if (categoryIndex !== -1) {
        const position = categoryIndex; // 0-based index
        
        if (position < 8) {
          hostMask1_8 = hostMask1_8.substring(0, position) + '1' + hostMask1_8.substring(position + 1);
        } else if (position < 16) {
          const pos = position - 8;
          hostMask9_16 = hostMask9_16.substring(0, pos) + '1' + hostMask9_16.substring(pos + 1);
        } else if (position < 24) {
          const pos = position - 16;
          hostMask17_24 = hostMask17_24.substring(0, pos) + '1' + hostMask17_24.substring(pos + 1);
        }
      }
    });
  }
  
  console.log('🎯 Generated bitmasks:', {
    'HostMask1-8': hostMask1_8,
    'HostMask9-16': hostMask9_16,
    'HostMask17-24': hostMask17_24
  });
  
  return {
    'HostMask1-8': hostMask1_8,
    'HostMask9-16': hostMask9_16,
    'HostMask17-24': hostMask17_24
  };
};

exports.handler = async (event) => {
  try {
    const { gameId } = event.pathParameters || {};
    const { selectedCategories } = JSON.parse(event.body || '{}');
    
    if (!gameId) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Game ID is required' }),
        headers: { 'Access-Control-Allow-Origin': '*' }
      };
    }

    console.log(`🎯 Updating categories for game ${gameId}:`, selectedCategories);

    // Get current game metadata to find question set
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

    const questionSetId = gameMetadata.Item.QuestionSetId;

    // Category POSITIONS drive the game's bitmasks, so they must come from the
    // version the game is pinned to — a different version can order or number
    // its categories differently and every mask bit would then point elsewhere.
    const resolvedSet = await resolveSetPartition(
      db, process.env.TABLE_NAME, questionSetId, gameMetadata.Item.QuestionSetVersion
    );

    // Get all categories for this question set
    const categoriesQuery = await db.send(new QueryCommand({
      TableName: process.env.TABLE_NAME,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
      ExpressionAttributeValues: {
        ':pk': resolvedSet.pk,
        ':sk': 'CATEGORY#'
      }
    }));

    const allCategories = categoriesQuery.Items || [];
    console.log(`📋 Found ${allCategories.length} categories in question set ${questionSetId}`);

    // Convert selected categories to bitmasks
    const bitmasks = convertCategoriesToBitmasks(selectedCategories, allCategories.map(cat => ({
      name: cat.SK.replace('CATEGORY#', '')
    })));

    // Update the category state in DynamoDB
    await db.send(new UpdateCommand({
      TableName: process.env.TABLE_NAME,
      Key: { PK: `GAME#${gameId}`, SK: 'STATE#CATS' },
      UpdateExpression: 'SET #hostMask1_8 = :hostMask1_8, #hostMask9_16 = :hostMask9_16, #hostMask17_24 = :hostMask17_24, #updatedAt = :updatedAt',
      ExpressionAttributeNames: {
        '#hostMask1_8': 'HostMask1-8',
        '#hostMask9_16': 'HostMask9-16',
        '#hostMask17_24': 'HostMask17-24',
        '#updatedAt': 'UpdatedAt'
      },
      ExpressionAttributeValues: {
        ':hostMask1_8': bitmasks['HostMask1-8'],
        ':hostMask9_16': bitmasks['HostMask9-16'],
        ':hostMask17_24': bitmasks['HostMask17-24'],
        ':updatedAt': new Date().toISOString()
      }
    }));

    console.log(`✅ Updated category selection for game ${gameId}`);

    return {
      statusCode: 200,
      body: JSON.stringify({
        success: true,
        gameId: gameId,
        selectedCategories: selectedCategories || [],
        bitmasks: bitmasks,
        message: 'Category selection updated successfully'
      }),
      headers: { 'Access-Control-Allow-Origin': '*' }
    };

  } catch (error) {
    console.error('Update categories error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: `Failed to update categories: ${error.message}` }),
      headers: { 'Access-Control-Allow-Origin': '*' }
    };
  }
};