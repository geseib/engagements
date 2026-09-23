const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, GetCommand } = require('@aws-sdk/lib-dynamodb');

const { callerMayDriveSession } = require('./tenant');
const { startSession } = require('./session-start');

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

    /*
      STATE, the reservation, METADATA and the org's index row — the four rows
      session-ttl.js names — in the one function next-question.js also calls
      when it opens a round from CREATED. See session-start.js for what went
      missing while these writes lived here alone.

      The owning org comes from the METADATA read above, not from the caller: a
      session belongs to the org that created it, not to whichever org the
      person pressing Start happens to be acting for.
    */
    const { startedAt: now } = await startSession(db, process.env.TABLE_NAME, gameId, {
      orgId: (ownerRead.Item && ownerRead.Item.orgId) || ''
    });

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