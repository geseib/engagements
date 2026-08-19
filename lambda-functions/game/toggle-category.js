const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, GetCommand, TransactWriteCommand } = require('@aws-sdk/lib-dynamodb');

const client = new DynamoDBClient({});
const db = DynamoDBDocumentClient.from(client);

// Helper to update bitmask
const updateBitmask = (mask, position, enabled) => {
  const pos = position - 1; // Convert to 0-based index
  const maskArray = mask.split('');
  maskArray[pos] = enabled ? '1' : '0';
  return maskArray.join('');
};

// Helper function to check if a bit is set in a bitmask
const isBitSet = (mask, position) => {
  const pos = position - 1; // Convert to 0-based index
  return mask[pos] === '1';
};

exports.handler = async (event) => {
  try {
    const { gameId } = event.pathParameters || {};
    const body = JSON.parse(event.body || '{}');
    const { categoryId, enabled, categoryName } = body;
    
    if (!gameId || !categoryId || enabled === undefined) {
      return {
        statusCode: 400,
        body: JSON.stringify({ 
          error: 'Missing required fields: gameId, categoryId, enabled' 
        }),
        headers: { 'Access-Control-Allow-Origin': '*' }
      };
    }

    console.log(`🔄 Toggling category ${categoryId} (${categoryName}) to ${enabled} for game ${gameId}`);

    // Get current game state to verify game is active
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

    /*
      CREATED IS A VALID STATE TO TOGGLE IN, and its absence here was reported
      as a bug: *"going to the session/questions tab appears to let you edit
      categories but it says you cannot. I think you should be able to."*

      The original list was written for the mid-session case and simply never
      considered pre-start. Nothing downstream cares: the toggle flips HostMask
      bits on STATE#CATS, which exists from create time
      (schema-compliant-manager.js), and start-game does not rebuild it — so a
      bit flipped before start is exactly as durable as one flipped after.
      ENDED stays excluded; a finished session's masks are part of its record.
    */
    const validStates = ['CREATED', 'STARTED', 'ASK#', 'VOTE#', 'RESULTS#'];
    const currentState = gameState.Item.State;
    const isValidState = validStates.some(state => 
      currentState === state || currentState.startsWith(state)
    );

    if (!isValidState) {
      return {
        statusCode: 400,
        body: JSON.stringify({ 
          error: 'Category toggles only allowed during active games' 
        }),
        headers: { 'Access-Control-Allow-Origin': '*' }
      };
    }

    // Get current category states
    const [categoryState, countsState] = await Promise.all([
      db.send(new GetCommand({
        TableName: process.env.TABLE_NAME,
        Key: { PK: `GAME#${gameId}`, SK: 'STATE#CATS' }
      })),
      db.send(new GetCommand({
        TableName: process.env.TABLE_NAME,
        Key: { PK: `GAME#${gameId}`, SK: 'STATE#CATS#COUNTS' }
      }))
    ]);

    if (!categoryState.Item) {
      return {
        statusCode: 404,
        body: JSON.stringify({ error: 'Category state not found' }),
        headers: { 'Access-Control-Allow-Origin': '*' }
      };
    }

    // Determine category position from categoryId (format: position-based or extract from name)
    const categoryPosition = parseInt(categoryId.replace(/\D/g, '')) || parseInt(categoryId.split('_')[1]) || 1;
    
    // Update bitmask based on position
    let updatedHostMask1_8 = categoryState.Item['HostMask1-8'];
    let updatedHostMask9_16 = categoryState.Item['HostMask9-16'];
    let updatedHostMask17_24 = categoryState.Item['HostMask17-24'];

    if (categoryPosition <= 8) {
      updatedHostMask1_8 = updateBitmask(updatedHostMask1_8, categoryPosition, enabled);
    } else if (categoryPosition <= 16) {
      updatedHostMask9_16 = updateBitmask(updatedHostMask9_16, categoryPosition - 8, enabled);
    } else if (categoryPosition <= 24) {
      updatedHostMask17_24 = updateBitmask(updatedHostMask17_24, categoryPosition - 16, enabled);
    }

    // Prepare array-based counts update
    const currentCounts = countsState.Item || {
      PK: `GAME#${gameId}`,
      SK: 'STATE#CATS#COUNTS',
      Version: 0,
      '1-8': new Array(8).fill(0),
      '9-16': new Array(8).fill(0),
      '17-24': new Array(8).fill(0),
      TotalEnabled: 0,
      TotalRemaining: 0
    };

    const counts1_8 = [...(currentCounts['1-8'] || [])];
    const counts9_16 = [...(currentCounts['9-16'] || [])];
    const counts17_24 = [...(currentCounts['17-24'] || [])];

    // Recalculate totals after bitmask change
    const hostMask1_8 = updatedHostMask1_8;
    const hostMask9_16 = updatedHostMask9_16;
    const hostMask17_24 = updatedHostMask17_24;
    
    let totalEnabled = 0;
    let enabledCategoriesCount = 0;
    
    // Count enabled questions from 1-8
    for (let i = 0; i < 8; i++) {
      if (isBitSet(hostMask1_8, i + 1)) {
        totalEnabled += counts1_8[i] || 0;
        enabledCategoriesCount++;
      }
    }
    
    // Count enabled questions from 9-16
    for (let i = 0; i < 8; i++) {
      if (isBitSet(hostMask9_16, i + 1)) {
        totalEnabled += counts9_16[i] || 0;
        enabledCategoriesCount++;
      }
    }
    
    // Count enabled questions from 17-24
    for (let i = 0; i < 8; i++) {
      if (isBitSet(hostMask17_24, i + 1)) {
        totalEnabled += counts17_24[i] || 0;
        enabledCategoriesCount++;
      }
    }

    // Ensure at least one category remains enabled
    if (enabledCategoriesCount === 0) {
      return {
        statusCode: 400,
        body: JSON.stringify({ 
          error: 'At least one category must remain enabled' 
        }),
        headers: { 'Access-Control-Allow-Origin': '*' }
      };
    }

    // Calculate totalRemaining as sum of enabled categories only (same as totalEnabled)
    const totalRemaining = totalEnabled;

    // Use TransactWrite for atomic update
    const transactItems = [
      // Update bitmasks
      {
        Update: {
          TableName: process.env.TABLE_NAME,
          Key: { PK: `GAME#${gameId}`, SK: 'STATE#CATS' },
          UpdateExpression: 'SET #hm1 = :hm1, #hm2 = :hm2, #hm3 = :hm3, #updated = :updated',
          ExpressionAttributeNames: {
            '#hm1': 'HostMask1-8',
            '#hm2': 'HostMask9-16',
            '#hm3': 'HostMask17-24',
            '#updated': 'UpdatedAt'
          },
          ExpressionAttributeValues: {
            ':hm1': updatedHostMask1_8,
            ':hm2': updatedHostMask9_16,
            ':hm3': updatedHostMask17_24,
            ':updated': new Date().toISOString()
          }
        }
      },
      // Update counts with optimistic locking and array structure
      {
        Update: {
          TableName: process.env.TABLE_NAME,
          Key: { PK: `GAME#${gameId}`, SK: 'STATE#CATS#COUNTS' },
          UpdateExpression: 'SET #ver = :newVer, #c1_8 = :c1_8, #c9_16 = :c9_16, #c17_24 = :c17_24, #totEnabled = :totEnabled, #totRemaining = :totRemaining, #updated = :updated',
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
          },
          ConditionExpression: 'attribute_not_exists(Version) OR Version = :expectedVer'
        }
      }
    ];

    await db.send(new TransactWriteCommand({ TransactItems: transactItems }));

    console.log(`✅ Category ${categoryId} toggled to ${enabled} for game ${gameId}`);
    console.log(`📊 Updated totals - Enabled: ${totalEnabled}, Total Remaining: ${totalRemaining}`);

    return {
      statusCode: 200,
      body: JSON.stringify({
        success: true,
        categoryId: categoryId,
        categoryPosition: categoryPosition,
        enabled: enabled,
        totalEnabledQuestions: totalEnabled,
        totalRemaining: totalRemaining,
        enabledCategoriesCount: enabledCategoriesCount
      }),
      headers: { 'Access-Control-Allow-Origin': '*' }
    };

  } catch (error) {
    console.error('Toggle category error:', error);
    
    // Handle optimistic locking conflict
    if (error.name === 'TransactionCanceledException') {
      return {
        statusCode: 409,
        body: JSON.stringify({ 
          error: 'Concurrent update conflict. Please retry.' 
        }),
        headers: { 'Access-Control-Allow-Origin': '*' }
      };
    }
    
    return {
      statusCode: 500,
      body: JSON.stringify({ 
        error: `Failed to toggle category: ${error.message}` 
      }),
      headers: { 'Access-Control-Allow-Origin': '*' }
    };
  }
};