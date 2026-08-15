/**
 * SOMEBODY LEFT. TAKE THEM OUT OF THE COUNTS, AND OUT OF NOTHING ELSE.
 *
 * Owner's request: *"if someone has left, the host should be able to remove
 * them so they are not in the next rounds counts. this should not eliminate any
 * contribution they had made or points they had accumulated before leaving.
 * they will still show up in the data and reports."*
 *
 * ── THERE IS NO DELETE IN THIS FILE, AND THERE MUST NOT BE ─────────────────
 *
 * The handler issues exactly one `GetCommand` and one `UpdateCommand`. It does
 * not touch `PLAYER#{name}#SCORE`, and it does not touch a single
 * `QUESTION#nnn#ANSWER#{name}` or `#VOTE#{name}`. Removal is the presence of a
 * `RemovedAt` timestamp on the player row and nothing else — see
 * `player-presence.js` for the whole model and for the list of which counts
 * drop a removed player (the live ones) and which keep them (the report and the
 * AI summary).
 *
 * That is also why the SAM policy for this function is derived from those two
 * commands. `DynamoDBCrudPolicy` would grant `DeleteItem` to a handler whose
 * entire purpose is to not delete anything; commit 5ac19a6b in this repo is the
 * record of what happens when a policy is copied rather than derived, in the
 * other direction. Read + Write is exactly Get + Update.
 *
 * ── IT IS REVERSIBLE, AND THAT IS NOT A NICETY ─────────────────────────────
 *
 * `removed: false` puts them back. A host mis-taps, or the person comes back
 * from the corridor; without an undo the only recovery would be for that person
 * to rejoin, which re-opens the name-collision question for no reason. The
 * roster returns removed players separately (`get-players.js`'s
 * `removedPlayers`) precisely so there is a row to press it on.
 *
 * A JOIN ALSO UNDOES IT — see the long comment in `join-game.js` about why a
 * returning browser is un-removed rather than left silently outside the counts.
 *
 * ── HOST-GATED ─────────────────────────────────────────────────────────────
 *
 * `Authorizer: CognitoAuthorizer`, like /reveal-authors and /stage-beat, and
 * for their reason: every participant knows the four-digit game id, so on a
 * public route this would be a button any phone in the room could press to take
 * somebody else out of the round.
 */

const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, GetCommand, UpdateCommand } = require('@aws-sdk/lib-dynamodb');
const { ApiGatewayManagementApiClient } = require('@aws-sdk/client-apigatewaymanagementapi');

const { notifyHost } = require('./host-notify');

const client = new DynamoDBClient({});
const db = DynamoDBDocumentClient.from(client);
const apigateway = new ApiGatewayManagementApiClient({
  endpoint: process.env.WEBSOCKET_API_ENDPOINT
});

const cors = { 'Access-Control-Allow-Origin': '*' };

exports.handler = async (event) => {
  try {
    const { gameId, playerName: rawName } = event.pathParameters || {};
    const playerName = rawName ? decodeURIComponent(rawName) : '';
    const body = JSON.parse(event.body || '{}');
    // Explicit rather than a toggle. A toggle read a stale roster would put
    // somebody back into the room because the host double-tapped.
    const removed = body.removed !== false;

    if (!gameId || !playerName) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Game ID and player name are required' }),
        headers: cors
      };
    }

    const existing = await db.send(new GetCommand({
      TableName: process.env.TABLE_NAME,
      Key: { PK: `GAME#${gameId}`, SK: `PLAYER#${playerName}` }
    }));

    if (!existing.Item) {
      return {
        statusCode: 404,
        body: JSON.stringify({
          error: 'Player not found',
          message: `Nobody in this session is answering as "${playerName}".`
        }),
        headers: cors
      };
    }

    const removedAt = new Date().toISOString();

    // THE ROW CAN VANISH BETWEEN THE GET AND THE UPDATE. `admin/delete-game.js`
    // batch-deletes a game's whole partition, PLAYER# rows included, and the
    // rows also carry a 7-day TTL. Without the condition the Update would
    // UPSERT — resurrecting a player row into a session that no longer has
    // one, under a name nobody is sat behind, which would then join the roster
    // and the readiness counts. With it, the write fails and this reports the
    // same thing the Get above would have.
    try {
      await db.send(new UpdateCommand({
        TableName: process.env.TABLE_NAME,
        Key: { PK: `GAME#${gameId}`, SK: `PLAYER#${playerName}` },
        // SET or REMOVE one attribute. Nothing else on the row is written, so a
        // removal cannot lose a ClientId, a JoinedAt or an open handover grant.
        UpdateExpression: removed ? 'SET RemovedAt = :at' : 'REMOVE RemovedAt',
        ConditionExpression: 'attribute_exists(SK)',
        ...(removed ? { ExpressionAttributeValues: { ':at': removedAt } } : {})
      }));
    } catch (error) {
      if (error.name !== 'ConditionalCheckFailedException') throw error;
      return {
        statusCode: 404,
        body: JSON.stringify({
          error: 'Player not found',
          message: `Nobody in this session is answering as "${playerName}".`
        }),
        headers: cors
      };
    }

    console.log(`${removed ? '🚪' : '↩️'} ${playerName} ${removed ? 'removed from' : 'restored to'} the room in game ${gameId}`);

    // The host's OTHER device. A session is routinely driven from a phone with
    // the projector showing the stage; without this the two rosters disagree
    // until the next poll, and "waiting for N" would differ between them.
    await notifyHost(db, apigateway, process.env.TABLE_NAME, gameId, {
      type: removed ? 'playerRemoved' : 'playerRestored',
      gameId,
      playerName,
      timestamp: removedAt
    });

    return {
      statusCode: 200,
      body: JSON.stringify({
        success: true,
        playerName,
        removed,
        removedAt: removed ? removedAt : null,
        message: removed
          ? `"${playerName}" is out of the live counts. Their answers, votes and points stay in the session report.`
          : `"${playerName}" is back in the room.`
      }),
      headers: cors
    };

  } catch (error) {
    console.error('Remove player error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: `Failed to update player: ${error.message}` }),
      headers: cors
    };
  }
};
