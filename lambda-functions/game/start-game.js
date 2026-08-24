const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, GetCommand, UpdateCommand } = require('@aws-sdk/lib-dynamodb');

const { gamesIndexPk, callerMayDriveSession } = require('./tenant');

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

    /* WHOSE SESSION IS THIS? Nothing here asked. A host in another organisation
       started somebody else's session on dev with nothing but the four-digit
       code. The owning org lives on METADATA; STATE does not carry it.
       404 rather than 403 — see tenant.callerMayDriveSession. */
    const ownerRead = await db.send(new GetCommand({
      TableName: process.env.TABLE_NAME,
      Key: { PK: `GAME#${gameId}`, SK: 'METADATA' },
      ProjectionExpression: 'orgId'
    }));
    if (!callerMayDriveSession(event, ownerRead.Item || {})) {
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

    /*
      Update the SESSION BRIEF — which is the OWNING ORG's index row now, not
      the global reservation.

      The reservation row carries `{orgId, ttl}` and nothing a list ever reads,
      so writing `Started` there would be writing to a row nobody looks at while
      every host's list stayed stale. The owning org is read from METADATA
      rather than from the caller: a session belongs to the org that created it,
      not to whichever org the person pressing Start happens to be acting for.

      A session created without an org has no index row, so there is nothing to
      update and the round still starts — the state that matters is on STATE and
      METADATA, both already written above.
    */
    const metadata = await db.send(new GetCommand({
      TableName: process.env.TABLE_NAME,
      Key: { PK: `GAME#${gameId}`, SK: 'METADATA' },
      ProjectionExpression: 'orgId'
    }));
    const orgId = (metadata.Item && metadata.Item.orgId) || '';

    if (orgId) {
      await db.send(new UpdateCommand({
        TableName: process.env.TABLE_NAME,
        Key: { PK: gamesIndexPk(orgId), SK: `GAME#${gameId}` },
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
    } else {
      console.warn(`⚠️ Game ${gameId} has no owning organisation — no session list row to update`);
    }

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