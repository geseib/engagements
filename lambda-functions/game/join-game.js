const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, GetCommand, PutCommand, QueryCommand, DeleteCommand, UpdateCommand } = require('@aws-sdk/lib-dynamodb');
const { ApiGatewayManagementApiClient, PostToConnectionCommand } = require('@aws-sdk/client-apigatewaymanagementapi');

const { openSessionOr } = require('./session-gate');
const { nowSeconds, handoverOpenFor } = require('./handover');

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
 *   handover   an owned row that the HOST has unlocked for exactly one
 *              exchange. The fifth case, and the only one that lets a browser
 *              take a name a different browser provably holds — see below.
 *
 * ── THE FIFTH CASE ─────────────────────────────────────────────────────────
 *
 * `collision` is right and it is also a dead end: the person who genuinely
 * swapped laptops is locked out of a name that is provably theirs, and no
 * amount of evidence they can present changes that, because the whole premise
 * is that the request carries no evidence. The only party who can tell "Chris
 * on a new laptop" from "a second Chris" is the host, who can see the room.
 *
 * So the way out is a grant the host makes, and NOT anything the client can
 * assert: `claimExisting` alone still yields `collision` (asserted in
 * tests/join-name-collision.js, "claiming does not override an owned row"),
 * because a client-asserted claim is precisely the silent merge this function
 * exists to stop. `handoverOpen` comes from `handover.js` reading attributes
 * only `grant-handover.js` — a host-authenticated route — can write.
 *
 * BOTH TERMS ARE REQUIRED, and neither is redundant:
 *   `handoverOpen`  the host said yes.
 *   `claimExisting` the PERSON said yes. Without it, an unlocked name would be
 *                   taken by whoever typed it next, including the innocent
 *                   third Chris who has no idea a handover is in flight.
 *
 * `handoverOpen` is read from a Get and is therefore ADVISORY — the grant is
 * actually spent by a ConditionExpression on the write, exactly as `adopt` is.
 * See the branch below.
 *
 * Exported for tests: this is the whole of the decision and it should be
 * assertable without a DynamoDB fake.
 */
function classifyRejoin({ storedClientId, clientId, claimExisting, handoverOpen = false }) {
  if (storedClientId) {
    if (storedClientId === clientId) return 'reconnect';
    if (handoverOpen && clientId && claimExisting === true) return 'handover';
    return 'collision';
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

    // Session exists, has started, and (if private) the code matches — in that
    // order, because the name-in-use signal must sit behind the code gate or
    // the refusal becomes a roster oracle. See session-gate.js.
    const gate = await openSessionOr(db, process.env.TABLE_NAME, gameId, accessCode);
    if (!gate.ok) return gate.response;

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
        claimExisting,
        handoverOpen: handoverOpenFor(existingPlayer.Item, clientId)
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
        //
        // `REMOVE RemovedAt` for the reason spelled out at the top of the
        // reconnect branch below: a claim proves somebody is at the keyboard.
        try {
          await db.send(new UpdateCommand({
            TableName: process.env.TABLE_NAME,
            Key: { PK: `GAME#${gameId}`, SK: `PLAYER#${playerName}` },
            UpdateExpression: 'SET ClientId = :cid REMOVE RemovedAt',
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

      if (verdict === 'handover') {
        // SPENDING THE HOST'S GRANT, AND THE ONE-SHOT RULE IS THIS CONDITION.
        //
        // Owner's rule: *"the host can use the session players tab to unlock
        // for 1 exchange of players for that name … if they need to do again,
        // same routine."* So the grant must be consumed by the first successful
        // claim and be gone for the second.
        //
        // ONE ITEM, ONE CONDITIONAL WRITE. Every clause `handoverOpenFor` read
        // from the Get is re-checked here against the item as it is at write
        // time, and the same statement REMOVEs the grant. Two browsers racing a
        // single grant are serialised by DynamoDB: the first passes
        // `attribute_exists(HandoverExpiresAt)` and deletes it, the second
        // fails its condition and is told the name is taken. A read-then-write
        // — "handoverOpen was true a moment ago, so write" — would let both in,
        // which is why the grant lives on this row rather than one of its own
        // (handover.js's header argues that at length).
        //
        // The three clauses:
        //   attribute_exists   the grant has not already been spent
        //   > :now             it has not lapsed (five-minute window)
        //   ForClientId        a grant bound to the person who ASKED cannot be
        //                      stolen by whoever types the name next
        //
        // The first is REDUNDANT and kept deliberately — mutation testing says
        // so: deleting it changes no outcome, because a comparison against a
        // non-existent attribute is false in DynamoDB, so `> :now` already
        // implies existence. It stays because it is the clause that STATES the
        // one-shot rule, and the clause that keeps the rule if the expiry
        // window is ever widened, made optional, or moved. The other two are
        // load-bearing and are proven so by the two mid-flight races in
        // tests/name-handover.js §4 — which exist because dropping either one
        // left every other test in that file green.
        //
        // `RemovedAt` goes too: taking over a name is somebody arriving.
        try {
          await db.send(new UpdateCommand({
            TableName: process.env.TABLE_NAME,
            Key: { PK: `GAME#${gameId}`, SK: `PLAYER#${playerName}` },
            UpdateExpression: 'SET ClientId = :cid REMOVE HandoverExpiresAt, HandoverForClientId, HandoverRequestedBy, HandoverRequestedAt, RemovedAt',
            ConditionExpression: 'attribute_exists(HandoverExpiresAt) AND HandoverExpiresAt > :now AND (attribute_not_exists(HandoverForClientId) OR HandoverForClientId = :cid)',
            ExpressionAttributeValues: { ':cid': clientId, ':now': nowSeconds() }
          }));
          console.log(`🤝 Handover spent: ${playerName} in game ${gameId} is now client ${clientId}`);
        } catch (error) {
          if (error.name === 'ConditionalCheckFailedException') {
            // Lapsed between the read and the write, or a second claimant got
            // there first. Either way there is no grant now, and the honest
            // answer is the one the caller would have got without one.
            console.log(`⛔ Handover for ${playerName} in game ${gameId} was already spent or has lapsed`);
            return nameConflictResponse('NAME_TAKEN', playerName);
          }
          throw error;
        }
      }

      // A JOIN UNDOES A REMOVAL, and this is a decision rather than a
      // side-effect.
      //
      // The host removes people who have left. A removed row keeps its
      // `ClientId`, so nothing stops that browser coming back — and it is worth
      // being precise about what "coming back" costs here, because both answers
      // are defensible:
      //
      //   leave them removed   the person is sat in the room typing an answer
      //                        that no progress bar is waiting for. The host
      //                        sees "3 of 4 answered" while four people answer,
      //                        and NOTHING on any screen explains why. An
      //                        inconsistency nobody can see is the worse bug.
      //   un-remove them       the host's removal is undone by a browser. The
      //                        host sees them reappear in the roster and can
      //                        remove them again — one click, and the state on
      //                        screen matches the room.
      //
      // The second. It fails visibly and it fails towards the truth: a join is
      // an explicit act on this surface (the rejoin prompt is a tap; auto-join
      // needs a name in the URL on a fresh page load), so a phone in a pocket
      // does not quietly resurrect anybody.
      //
      // `adopt` and `handover` already cleared it inside their own conditional
      // writes, so this covers `reconnect` and `legacy` — and it is CONDITIONAL
      // on the attribute existing so that the overwhelmingly common reconnect
      // stays a read-only path with no write at all.
      if (existingPlayer.Item.RemovedAt && verdict !== 'adopt' && verdict !== 'handover') {
        try {
          await db.send(new UpdateCommand({
            TableName: process.env.TABLE_NAME,
            Key: { PK: `GAME#${gameId}`, SK: `PLAYER#${playerName}` },
            UpdateExpression: 'REMOVE RemovedAt',
            ConditionExpression: 'attribute_exists(RemovedAt)'
          }));
          console.log(`↩️ ${playerName} rejoined game ${gameId} after being removed — back in the counts`);
        } catch (error) {
          // Somebody else already un-removed them. That is the desired state.
          if (error.name !== 'ConditionalCheckFailedException') throw error;
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
