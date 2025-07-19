const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, QueryCommand, BatchWriteCommand, DeleteCommand } = require('@aws-sdk/lib-dynamodb');

const dynamoClient = new DynamoDBClient({});
const db = DynamoDBDocumentClient.from(dynamoClient);
const TABLE_NAME = process.env.TABLE_NAME;

exports.handler = async (event) => {
  console.log('Delete game request:', JSON.stringify(event, null, 2));

  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'DELETE, OPTIONS',
    'Content-Type': 'application/json'
  };

  try {
    const gameId = event.pathParameters?.gameId;
    
    if (!gameId) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({
          success: false,
          error: 'Game ID is required'
        })
      };
    }

    console.log(`Deleting game: ${gameId}`);

    // First, get all items related to this game
    const queryParams = {
      TableName: TABLE_NAME,
      KeyConditionExpression: 'PK = :pk',
      ExpressionAttributeValues: {
        ':pk': `GAME#${gameId}`
      }
    };

    console.log('Querying all game data...');
    const gameData = await db.send(new QueryCommand(queryParams));
    
    console.log(`Found ${gameData.Items.length} items to delete for game ${gameId}`);

    // Delete all game-related items in batches
    const itemsToDelete = gameData.Items.map(item => ({
      DeleteRequest: {
        Key: {
          PK: item.PK,
          SK: item.SK
        }
      }
    }));

    // DynamoDB batch write can handle max 25 items per request
    const batchSize = 25;
    const batches = [];
    
    for (let i = 0; i < itemsToDelete.length; i += batchSize) {
      batches.push(itemsToDelete.slice(i, i + batchSize));
    }

    console.log(`Deleting in ${batches.length} batches...`);

    // Execute all batch deletes
    for (let i = 0; i < batches.length; i++) {
      const batch = batches[i];
      console.log(`Processing batch ${i + 1}/${batches.length} with ${batch.length} items`);
      
      const batchParams = {
        RequestItems: {
          [TABLE_NAME]: batch
        }
      };

      await db.send(new BatchWriteCommand(batchParams));
    }

    // Also remove the game from the GAMES index
    const gameIndexParams = {
      TableName: TABLE_NAME,
      Key: {
        PK: 'GAMES',
        SK: `GAME#${gameId}`
      }
    };

    console.log('Removing game from GAMES index...');
    await db.send(new DeleteCommand(gameIndexParams));

    console.log(`✅ Successfully deleted game ${gameId} and all related data`);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        message: `Game ${gameId} deleted successfully`,
        itemsDeleted: gameData.Items.length
      })
    };

  } catch (error) {
    console.error('Error deleting game:', error);
    
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        success: false,
        error: 'Failed to delete game',
        details: error.message
      })
    };
  }
};