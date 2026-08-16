/**
 * "ASK THE HOST TO LET ME TAKE THIS NAME."
 *
 * The player half of the handover. A person whose join was refused with
 * `NAME_TAKEN` taps one button and the ask lands in the host's Players tab.
 *
 * THIS ROUTE IS DELIBERATELY UNAUTHENTICATED, and that is not an oversight to
 * be tidied up later. The caller is by definition a person who is NOT in the
 * session — they were just refused. There is no token they could present and no
 * player row they own. Putting `Authorizer: CognitoAuthorizer` on it (which the
 * two host routes beside it in template-clean.yaml do carry) would mean the
 * only people who could ask for a handover are hosts and admins, i.e. nobody
 * who needs one.
 *
 * IT GRANTS NOTHING. This writes two attributes that mean "somebody asked" and
 * sends the host a message. The host decides — `grant-handover.js` is the only
 * thing that can open a name, and it is host-gated. The asymmetry is the
 * feature: the owner's reason for the whole design is that a name clash is as
 * likely to be two different people as one person on a new laptop, *"they need
 * the choice though because they may have just mistakenly picked the same
 * name."*
 *
 * ── WHAT AN UNAUTHENTICATED WRITE HERE CAN AND CANNOT DO ───────────────────
 *
 * It can put a spurious "someone is asking for this name" in front of the host,
 * for a session whose four-digit id the caller already knows, having already
 * cleared the same gates a join clears (`session-gate.js`: started, and the
 * access code for a private session). That is the blast radius: one line of
 * noise in a panel, which the host must then act on for anything to happen.
 *
 * It cannot read anything. The response says only whether the ask was recorded;
 * it never reports whether the name is held, by whom, or whether a grant is
 * already open. And the request is recorded ONLY on a player row that already
 * exists (`ConditionExpression: attribute_exists(SK)`) — but a missing row and
 * a present one produce the SAME 200, because a distinct 404 here would be a
 * name oracle: submit a name, learn whether it is in the room. `join-game.js`'s
 * `nameConflictResponse` header sets that standard ("one submitted name in, one
 * yes/no out") and this route must not be the hole in it.
 *
 * ── THE CLIENT ID IS RECORDED SO THE GRANT CAN BE BOUND TO IT ──────────────
 *
 * `HandoverRequestedBy` is the asker's clientId. It exists so the host's grant
 * can be aimed at the person who asked rather than left open to whoever types
 * the name next — see `grant-handover.js`'s `bindToRequester`. It is NEVER
 * published: `handover.js`'s `publicHandoverState` is the allow-list, and the
 * reason is that a clientId is a capability (`get-answers.js:247` hands out a
 * player's own answer text to whoever presents theirs).
 */

const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, UpdateCommand } = require('@aws-sdk/lib-dynamodb');
const { ApiGatewayManagementApiClient } = require('@aws-sdk/client-apigatewaymanagementapi');

const { openSessionOr } = require('./session-gate');
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
    const { accessCode } = body;

    // Same normalisation as join-game.js:90 — absent, empty or non-string means
    // "this caller has no identity", never a value that could match a stored one.
    const clientId = typeof body.clientId === 'string' && body.clientId.trim()
      ? body.clientId.trim()
      : null;

    if (!gameId || !playerName) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Game ID and player name are required' }),
        headers: cors
      };
    }

    if (!clientId) {
      // A grant bound to nobody could be spent by anybody, so an anonymous ask
      // is refused here rather than recorded and quietly made unbindable.
      return {
        statusCode: 400,
        body: JSON.stringify({
          error: 'Client id required',
          message: 'This browser could not identify itself. Reload the page and try again.'
        }),
        headers: cors
      };
    }

    const gate = await openSessionOr(db, process.env.TABLE_NAME, gameId, accessCode);
    if (!gate.ok) return gate.response;

    const requestedAt = new Date().toISOString();
    let recorded = false;

    try {
      await db.send(new UpdateCommand({
        TableName: process.env.TABLE_NAME,
        Key: { PK: `GAME#${gameId}`, SK: `PLAYER#${playerName}` },
        UpdateExpression: 'SET HandoverRequestedBy = :cid, HandoverRequestedAt = :at',
        // Never CREATE a player row. An Update with no condition would upsert,
        // and a phantom row would join the roster and the readiness counts
        // under a name nobody is sat behind.
        ConditionExpression: 'attribute_exists(SK)',
        ExpressionAttributeValues: { ':cid': clientId, ':at': requestedAt }
      }));
      recorded = true;
    } catch (error) {
      if (error.name !== 'ConditionalCheckFailedException') throw error;
      // No such player. Fall through to the same 200 — see the header: a
      // distinct answer here would turn this route into a name oracle.
      console.log(`🤷 Handover asked for a name not in game ${gameId}`);
    }

    if (recorded) {
      console.log(`🙋 Handover requested for ${playerName} in game ${gameId}`);
      await notifyHost(db, apigateway, process.env.TABLE_NAME, gameId, {
        type: 'handoverRequested',
        gameId,
        playerName,
        requestedAt,
        timestamp: requestedAt
      });
    }

    return {
      statusCode: 200,
      body: JSON.stringify({
        success: true,
        playerName,
        // Says what happens next, not what the roster contains.
        message: `Asked the host to hand "${playerName}" over. When they say go ahead, tap “Take over the name”.`
      }),
      headers: cors
    };

  } catch (error) {
    console.error('Request handover error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: `Failed to request handover: ${error.message}` }),
      headers: cors
    };
  }
};
