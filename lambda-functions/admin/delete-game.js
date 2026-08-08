const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, DeleteCommand } = require('@aws-sdk/lib-dynamodb');
const { collectPartitionKeys, batchDeleteKeys } = require('./shared/ddb-delete');

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

    // First, get all items related to this game.
    // Paginated: a Query response caps at 1 MB, and a long game accumulates a
    // row per player and per response. An un-paginated Query would delete only
    // the first page and orphan the rest in the GAME# partition.
    console.log('Querying all game data...');
    const { keys, pages } = await collectPartitionKeys(db, TABLE_NAME, `GAME#${gameId}`);

    console.log(`Found ${keys.length} items to delete for game ${gameId} across ${pages} query page(s)`);

    // Delete in chunks of 25, resubmitting anything DynamoDB hands back as
    // UnprocessedItems. Throws (=> 500) rather than under-delete silently.
    const deletedCount = keys.length ? await batchDeleteKeys(db, TABLE_NAME, keys) : 0;

    // Only once the content rows are confirmed gone do we drop the index row —
    // a partial failure must leave the game still listed and re-deletable,
    // never an invisible orphan partition.
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
        itemsDeleted: deletedCount + 1
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
        details: error.message,
        // The game is still listed and still owns whatever rows survived, so a
        // retry is safe and is the expected next step.
        partial: true,
        itemsDeleted: typeof error.deleted === 'number' ? error.deleted : undefined,
        remaining: typeof error.deleted === 'number' ? error.remaining.length : undefined
      })
    };
  }
};