const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, GetCommand, PutCommand, QueryCommand, DeleteCommand, UpdateCommand } = require('@aws-sdk/lib-dynamodb');
const { ApiGatewayManagementApiClient, PostToConnectionCommand } = require('@aws-sdk/client-apigatewaymanagementapi');

const client = new DynamoDBClient({});
const db = DynamoDBDocumentClient.from(client);
const apigateway = new ApiGatewayManagementApiClient({
  endpoint: process.env.WEBSOCKET_API_ENDPOINT
});

/**
 * Is the second Chris the first Chris coming back, or a different person?
 *
 * Players are keyed `PLAYER#{playerName}`, and until this existed, a join that
 * found an existing key returned `isReconnection: true` unconditionally. In a
 * room with two Chrises the second one inherited the first one's answers and
 * score, and neither of them was told. The merge was silent by construction.
 *
 * The join request carried nothing that could tell those two cases apart —
 * no session id, no token, and no connection id (the player's WebSocket is
 * opened *after* the join succeeds, so at this point there is none). The name
 * was the whole identity. So the client now mints a random `clientId`, keeps
 * it in localStorage under the game, and sends it with every join; the server
 * stamps it on the player row the first time and requires it to match
 * thereafter.
 *
 * Four cases, and the two compatibility ones matter as much as the two new:
 *
 *   reconnect  stored id matches the one presented — the same browser. Today's
 *              behaviour, now actually verified.
 *   collision  the row is owned by a different id (or the caller presented
 *              none against an owned row) — refuse, and say so.
 *   legacy     neither side has an id. A player already in a live session when
 *              this shipped is served by the old bundle and sends no clientId;
 *              their row has none either. Refusing them would break the very
 *              reconnection this is meant to protect, so this case keeps the
 *              old behaviour exactly. It is no *worse* than today, and it
 *              disappears as soon as the row is claimed.
 *   unverified a claimed identity meeting an unowned row — a new bundle
 *              rejoining a row created by the old one. Indistinguishable from a
 *              genuine collision, so do not guess: refuse, and let the client
 *              ASK ("are you rejoining, or a different Chris?"). An explicit
 *              `claimExisting` turns it into an adoption.
 *
 * Exported for tests: this is the whole of the decision and it should be
 * assertable without a DynamoDB fake.
 */
function classifyRejoin({ storedClientId, clientId, claimExisting }) {
  if (storedClientId) {
    return storedClientId === clientId ? 'reconnect' : 'collision';
  }
  if (!clientId) return 'legacy';
  return claimExisting === true ? 'adopt' : 'unverified';
}

/**
 * The refusal. `code` is the machine-readable half — the client switches UI on
 * it — and `message` is the half a person reads.
 *
 * This discloses that one specific name is in use, to a caller who already
 * holds the game id, has passed the started check, and has passed the access
 * code check for a private game. That is the minimum a collision can be
 * reported with. It is deliberately NOT a roster: one submitted name in, one
 * yes/no out, no listing and no endpoint that answers without a join attempt.
 */
function nameConflictResponse(code, playerName) {
  const message = code === 'NAME_UNVERIFIED'
    ? `Someone in this session is already answering as "${playerName}". If that was you on another device, rejoin to pick your answers and score back up. If not, choose a name the host can tell apart.`
    : `Someone in this session is already answering as "${playerName}". Add a last initial or pick another name so the host can tell you apart.`;

  return {
    statusCode: 409,
    body: JSON.stringify({
      error: 'Name already in use',
      code,
      playerName,
      message
    }),
    headers: { 'Access-Control-Allow-Origin': '*' }
  };
}

exports.handler = async (event) => {
  try {
    const { gameId } = event.pathParameters || {};
    const body = JSON.parse(event.body || '{}');
    const { playerName, accessCode, claimExisting } = body;
    // Absent, empty, or non-string means "this caller has no identity" — never
    // a value that could accidentally match a stored one.
    const clientId = typeof body.clientId === 'string' && body.clientId.trim()
      ? body.clientId.trim()
      : null;

    if (!gameId || !playerName) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Game ID and player name are required' }),
        headers: { 'Access-Control-Allow-Origin': '*' }
      };
    }

    console.log(`Player ${playerName} attempting to join game ${gameId}`);

    // Check if game exists and is started
    const gameCheck = await db.send(new GetCommand({
      TableName: process.env.TABLE_NAME,
      Key: { PK: `GAME#${gameId}`, SK: 'METADATA' }
    }));

    if (!gameCheck.Item) {
      return {
        statusCode: 404,
        body: JSON.stringify({ error: 'Game not found' }),
        headers: { 'Access-Control-Allow-Origin': '*' }
      };
    }

    // Check if game has been started
    if (!gameCheck.Item.Started) {
      return {
        statusCode: 403,
        body: JSON.stringify({ 
          error: 'Game not started',
          message: 'This game has not been started yet. Please wait for the host to start the session.'
        }),
        headers: { 'Access-Control-Allow-Origin': '*' }
      };
    }

    // Check game visibility and access code for private games
    const gameMetadata = gameCheck.Item;
    const gameVisibility = gameMetadata.Visibility || 'public';
    
    if (gameVisibility === 'private') {
      const requiredAccessCode = gameMetadata.AccessCode;
      
      if (!requiredAccessCode) {
        console.error(`Game ${gameId} is marked as private but has no access code`);
        return {
          statusCode: 500,
          body: JSON.stringify({ error: 'Game configuration error' }),
          headers: { 'Access-Control-Allow-Origin': '*' }
        };
      }
      
      if (!accessCode) {
        return {
          statusCode: 401,
          body: JSON.stringify({ 
            error: 'Access code required',
            message: 'This is a private game. Please enter the access code to join.'
          }),
          headers: { 'Access-Control-Allow-Origin': '*' }
        };
      }
      
      if (accessCode !== requiredAccessCode) {
        return {
          statusCode: 403,
          body: JSON.stringify({ 
            error: 'Invalid access code',
            message: 'The access code you entered is incorrect. Please try again.'
          }),
          headers: { 'Access-Control-Allow-Origin': '*' }
        };
      }
      
      console.log(`Player ${playerName} provided correct access code for private game ${gameId}`);
    }

    // Use playerName directly as the player ID for simplicity
    const playerId = playerName;

    // Check if player already exists
    const existingPlayer = await db.send(new GetCommand({
      TableName: process.env.TABLE_NAME,
      Key: { 
        PK: `GAME#${gameId}`, 
        SK: `PLAYER#${playerName}` 
      }
    }));

    if (existingPlayer.Item) {
      const verdict = classifyRejoin({
        storedClientId: existingPlayer.Item.ClientId || null,
        clientId,
        claimExisting
      });

      if (verdict === 'collision' || verdict === 'unverified') {
        // No host notification and no write: nobody joined. The first Chris is
        // still the only Chris, and still has their answers.
        console.log(`⛔ Refusing join for ${playerName} in game ${gameId}: ${verdict}`);
        return nameConflictResponse(
          verdict === 'unverified' ? 'NAME_UNVERIFIED' : 'NAME_TAKEN',
          playerName
        );
      }

      if (verdict === 'adopt') {
        // Stamp this browser onto a row that predates identities. The condition
        // is what stops two simultaneous claimants both "adopting": the loser
        // falls through to a collision rather than silently sharing the row.
        try {
          await db.send(new UpdateCommand({
            TableName: process.env.TABLE_NAME,
            Key: { PK: `GAME#${gameId}`, SK: `PLAYER#${playerName}` },
            UpdateExpression: 'SET ClientId = :cid',
            ConditionExpression: 'attribute_not_exists(ClientId)',
            ExpressionAttributeValues: { ':cid': clientId }
          }));
          console.log(`🔗 Claimed unowned player row ${playerName} for client ${clientId}`);
        } catch (error) {
          if (error.name === 'ConditionalCheckFailedException') {
            console.log(`⛔ Lost the race to claim ${playerName} in game ${gameId}`);
            return nameConflictResponse('NAME_TAKEN', playerName);
          }
          throw error;
        }
      }

      // Return existing player data
      // Notify host via WebSocket about player reconnection
      await notifyHostOfPlayerJoin(gameId, {
        playerId: playerName,
        playerName: playerName,
        totalScore: 0, // Always 0 for returning players - actual score is in SCORE record
        joinedAt: existingPlayer.Item.joinedAt || existingPlayer.Item.JoinedAt,
        isReconnection: true
      });
      
      return {
        statusCode: 200,
        body: JSON.stringify({
          success: true,
          message: 'Reconnected to existing player',
          playerId: playerName,
          playerName: playerName,
          totalScore: 0, // Always 0 for returning players - actual score is in SCORE record
          isReconnection: true
        }),
        headers: { 'Access-Control-Allow-Origin': '*' }
      };
    }

    // Create new player using playerName as both key and ID.
    //
    // The condition closes the window the Get above cannot: two Chrises whose
    // joins overlap both read "no such player" and both used to write, the
    // second overwriting the first. Now the loser is told.
    try {
      await db.send(new PutCommand({
        TableName: process.env.TABLE_NAME,
        Item: {
          PK: `GAME#${gameId}`,
          SK: `PLAYER#${playerName}`,
          playerId: playerName,
          PlayerName: playerName,
          playerName: playerName, // Support both formats
          ...(clientId ? { ClientId: clientId } : {}),
          JoinedAt: new Date().toISOString(),
          joinedAt: new Date().toISOString(),
          isConnected: true,
          ttl: Math.floor(Date.now() / 1000) + (7 * 24 * 60 * 60) // 7 days TTL
          // Note: totalScore removed - use PLAYER#{playerName}#SCORE record as single source of truth
        },
        ConditionExpression: 'attribute_not_exists(SK)'
      }));
    } catch (error) {
      if (error.name === 'ConditionalCheckFailedException') {
        console.log(`⛔ Concurrent join lost the name ${playerName} in game ${gameId}`);
        return nameConflictResponse('NAME_TAKEN', playerName);
      }
      throw error;
    }

    // Create initial consolidated score record using playerName (new players start with afterRound: "000")
    await db.send(new PutCommand({
      TableName: process.env.TABLE_NAME,
      Item: {
        PK: `GAME#${gameId}`,
        SK: `PLAYER#${playerName}#SCORE`,
        PlayerName: playerName,
        score: 0,
        afterRound: "000", // "000" indicates player hasn't been scored yet
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        ttl: Math.floor(Date.now() / 1000) + (30 * 24 * 60 * 60) // 30 days TTL
      }
    }));

    console.log(`✅ Created score record for ${playerName} with afterRound: 000 (not scored yet)`);

    console.log(`Player ${playerName} successfully joined game ${gameId}`);

    // Notify host via WebSocket about new player
    await notifyHostOfPlayerJoin(gameId, {
      playerId: playerName,
      playerName: playerName,
      totalScore: 0,
      joinedAt: new Date().toISOString(),
      isReconnection: false
    });

    return {
      statusCode: 200,
      body: JSON.stringify({
        success: true,
        message: 'Successfully joined game',
        playerId: playerName,
        playerName: playerName,
        totalScore: 0,
        isReconnection: false
      }),
      headers: { 'Access-Control-Allow-Origin': '*' }
    };

  } catch (error) {
    console.error('Join game error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: `Failed to join game: ${error.message}` }),
      headers: { 'Access-Control-Allow-Origin': '*' }
    };
  }
};


/**
 * Notify host via WebSocket when a player joins or reconnects
 */
async function notifyHostOfPlayerJoin(gameId, playerData) {
  try {
    console.log(`🔔 WEBSOCKET DEBUG: Notifying host of player join: ${playerData.playerName} in game ${gameId}`);
    console.log(`🔔 WEBSOCKET DEBUG: Environment WEBSOCKET_API_ENDPOINT: ${process.env.WEBSOCKET_API_ENDPOINT}`);
    console.log(`🔔 WEBSOCKET DEBUG: ApiGateway client configured:`, apigateway.config);
    
    // Get host connection for this game
    const hostConnection = await getHostConnection(gameId);
    console.log(`🔔 WEBSOCKET DEBUG: Host connection result:`, hostConnection);
    
    if (hostConnection) {
      const message = {
        type: 'playerJoined',
        gameId: gameId,
        player: playerData,
        timestamp: new Date().toISOString()
      };
      
      console.log(`🔔 WEBSOCKET DEBUG: Sending message to ${hostConnection.ConnectionId}:`, message);
      
      await sendToConnection(hostConnection.ConnectionId, message);
      
      console.log(`✅ WEBSOCKET DEBUG: Host notified successfully of player join: ${playerData.playerName}`);
    } else {
      console.log(`⚠️ WEBSOCKET DEBUG: No host connection found for game ${gameId}`);
      
      // Additional debugging - check what connections exist
      const allConnections = await db.send(new QueryCommand({
        TableName: process.env.TABLE_NAME,
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
        ExpressionAttributeValues: {
          ':pk': `GAME#${gameId}`,
          ':sk': 'CONNECTION#'
        }
      }));
      
      console.log(`🔔 WEBSOCKET DEBUG: All connections for game ${gameId}:`, allConnections.Items);
    }
    
  } catch (error) {
    console.error(`❌ WEBSOCKET DEBUG: Error notifying host of player join:`, error);
    console.error(`❌ WEBSOCKET DEBUG: Error details:`, {
      message: error.message,
      statusCode: error.$response?.statusCode,
      stack: error.stack
    });
    // Don't throw error - this shouldn't block player joining
  }
}

/**
 * Get host connection for a game
 */
async function getHostConnection(gameId) {
  try {
    const result = await db.send(new QueryCommand({
      TableName: process.env.TABLE_NAME,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
      FilterExpression: 'ConnectionType = :type',
      ExpressionAttributeValues: {
        ':pk': `GAME#${gameId}`,
        ':sk': 'CONNECTION#',
        ':type': 'HOST'
      }
    }));
    
    return result.Items?.[0] || null;
  } catch (error) {
    console.error(`❌ Error getting host connection for game ${gameId}:`, error);
    return null;
  }
}

/**
 * Send message to specific WebSocket connection
 */
async function sendToConnection(connectionId, message) {
  try {
    console.log(`🔔 WEBSOCKET DEBUG: sendToConnection called with connectionId: ${connectionId}`);
    console.log(`🔔 WEBSOCKET DEBUG: Message to send:`, JSON.stringify(message, null, 2));
    
    const command = new PostToConnectionCommand({
      ConnectionId: connectionId,
      Data: JSON.stringify(message)
    });
    
    console.log(`🔔 WEBSOCKET DEBUG: Executing PostToConnectionCommand`);
    const result = await apigateway.send(command);
    console.log(`🔔 WEBSOCKET DEBUG: PostToConnectionCommand result:`, result);
    return { ok: true };

  } catch (error) {
    // 410 Gone == dead connection. Delete the stale row inline (message carries
    // gameId so the PK is known) and never re-throw.
    if (error.statusCode === 410 || error.name === 'GoneException' || error.$response?.statusCode === 410) {
      console.log(`🧹 WEBSOCKET DEBUG: Removing stale connection ${connectionId} (410 Gone)`);
      if (message.gameId) {
        await db.send(new DeleteCommand({
          TableName: process.env.TABLE_NAME,
          Key: { PK: `GAME#${message.gameId}`, SK: `CONNECTION#${connectionId}` }
        })).catch(() => {});
      }
      return { ok: false, stale: true };
    }
    console.error(`❌ WEBSOCKET DEBUG: Failed to send to connection ${connectionId}:`, error);
    return { ok: false, error };
  }
}

// Exported for tests — the collision decision should be assertable on its own.
exports.classifyRejoin = classifyRejoin;
