const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, GetCommand, UpdateCommand } = require('@aws-sdk/lib-dynamodb');

const client = new DynamoDBClient({});
const db = DynamoDBDocumentClient.from(client);

exports.handler = async (event) => {
  try {
    const { gameId } = event.pathParameters || {};
    
    if (!gameId) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Game ID is required' }),
        headers: { 'Access-Control-Allow-Origin': '*' }
      };
    }

    console.log(`🚀 Starting game ${gameId}`);

    // Check if game exists and is in CREATED state
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

    const currentState = gameState.Item.State;
    if (currentState !== 'CREATED') {
      return {
        statusCode: 400,
        body: JSON.stringify({ 
          error: 'Game cannot be started',
          message: `Game is in state '${currentState}'. Can only start games in 'CREATED' state.`
        }),
        headers: { 'Access-Control-Allow-Origin': '*' }
      };
    }

    // Update game state to STARTED
    const now = new Date().toISOString();
    await db.send(new UpdateCommand({
      TableName: process.env.TABLE_NAME,
      Key: { PK: `GAME#${gameId}`, SK: 'STATE' },
      UpdateExpression: 'SET #state = :state, #started = :started, #updatedAt = :updatedAt, #startedAt = :startedAt',
      ExpressionAttributeNames: {
        '#state': 'State',
        '#started': 'Started',
        '#updatedAt': 'UpdatedAt',
        '#startedAt': 'StartedAt'
      },
      ExpressionAttributeValues: {
        ':state': 'STARTED',
        ':started': true,
        ':updatedAt': now,
        ':startedAt': now
      }
    }));

    // Update METADATA with Started flag and LastPlayedAt
    await db.send(new UpdateCommand({
      TableName: process.env.TABLE_NAME,
      Key: { PK: `GAME#${gameId}`, SK: 'METADATA' },
      UpdateExpression: 'SET #started = :started, #lastPlayedAt = :lastPlayedAt',
      ExpressionAttributeNames: {
        '#started': 'Started',
        '#lastPlayedAt': 'LastPlayedAt'
      },
      ExpressionAttributeValues: {
        ':started': true,
        ':lastPlayedAt': now
      }
    }));

    // Update GAMES list entry with Started flag and LastPlayedAt
    await db.send(new UpdateCommand({
      TableName: process.env.TABLE_NAME,
      Key: { PK: 'GAMES', SK: `GAME#${gameId}` },
      UpdateExpression: 'SET #started = :started, #lastPlayedAt = :lastPlayedAt',
      ExpressionAttributeNames: {
        '#started': 'Started',
        '#lastPlayedAt': 'LastPlayedAt'
      },
      ExpressionAttributeValues: {
        ':started': true,
        ':lastPlayedAt': now
      }
    }));

    console.log(`✅ Game ${gameId} started successfully`);

    return {
      statusCode: 200,
      body: JSON.stringify({
        success: true,
        gameId: gameId,
        state: 'STARTED',
        startedAt: now,
        message: 'Game started successfully'
      }),
      headers: { 'Access-Control-Allow-Origin': '*' }
    };

  } catch (error) {
    console.error('Start game error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: `Failed to start game: ${error.message}` }),
      headers: { 'Access-Control-Allow-Origin': '*' }
    };
  }
};