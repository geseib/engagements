/**
 * THE HOST OPENS A NAME FOR EXACTLY ONE EXCHANGE.
 *
 * The other half of `request-handover.js`, and the only thing in the product
 * that can let a browser take a name a different browser provably holds.
 *
 * ── HOST-GATED, AND ITS NEIGHBOUR DELIBERATELY IS NOT ──────────────────────
 *
 * `Auth: Authorizer: CognitoAuthorizer` in template-clean.yaml, exactly like
 * /reveal-authors and /stage-beat. The reason is the same one those two give:
 * every participant knows the four-digit game id, so without the gate this
 * would be a button any phone in the room could press to take anybody's answers
 * and score. `request-handover.js` sits one path segment away with NO
 * authorizer, and that asymmetry is the design — asking is something a person
 * locked out of the session must be able to do, granting is not.
 *
 * ── WHY THE HOST NEVER HANDLES A CLIENT ID ─────────────────────────────────
 *
 * `bindToRequester: true` rather than `forClientId: "<id>"`. The host's console
 * says "let the person who asked take it"; the SERVER reads
 * `HandoverRequestedBy` off the row it is already holding. The id is never
 * published in the roster and never posted back, because a clientId is a
 * capability — `get-answers.js:247` returns a player's own answer text to
 * whoever presents theirs — and `GET /games/{id}/players` is public.
 *
 * Two shapes of grant, and the host chooses by whether anybody has asked:
 *
 *   BOUND    somebody asked, and the grant names them. Nobody else can spend
 *            it, so a third party who happens to be typing the same name at the
 *            same moment cannot steal it.
 *   OPEN     nobody asked — the owner's second entry point: *"the host can use
 *            the session players tab to unlock … without waiting to be asked,
 *            because in a real room the person will just say it out loud."*
 *            Spendable by the next browser that claims the name, which is why
 *            the window is five minutes and not a session.
 *
 * Asking to bind when nobody has asked is refused (409) rather than silently
 * downgraded to open: those are different grants with different blast radii,
 * and a host who pressed "let them take it" should not get "let anyone take
 * it".
 *
 * ── WHAT IT DOES NOT DO ────────────────────────────────────────────────────
 *
 * It does not move anything. No `ClientId` is written here, no score, no
 * answers. The grant is spent by `join-game.js`'s conditional update when the
 * person actually claims, which is where the one-exchange rule is enforced —
 * see the `handover` branch there.
 */

const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, GetCommand, UpdateCommand } = require('@aws-sdk/lib-dynamodb');

const { handoverExpiryFrom, HANDOVER_WINDOW_SECONDS, publicHandoverState } = require('./handover');

const client = new DynamoDBClient({});
const db = DynamoDBDocumentClient.from(client);

const cors = { 'Access-Control-Allow-Origin': '*' };

exports.handler = async (event) => {
  try {
    const { gameId, playerName: rawName } = event.pathParameters || {};
    const playerName = rawName ? decodeURIComponent(rawName) : '';
    const body = JSON.parse(event.body || '{}');
    const bindToRequester = body.bindToRequester === true;

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

    // A host asking about a name that is not in their own session is a mistake
    // worth reporting, not an oracle: this route is authenticated, so 404 here
    // discloses nothing that the roster does not already show them.
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

    const requestedBy = existing.Item.HandoverRequestedBy || null;
    if (bindToRequester && !requestedBy) {
      return {
        statusCode: 409,
        body: JSON.stringify({
          error: 'No pending request',
          message: `Nobody has asked to take over "${playerName}". Unlock the name instead if they asked you out loud.`
        }),
        headers: cors
      };
    }

    const expiresAt = handoverExpiryFrom();

    // Re-granting is an overwrite, deliberately: the owner's fallback for a
    // handover that did not land is *"if they need to do again, same routine."*
    // A second grant replaces the first rather than stacking, so "one exchange"
    // stays one exchange however many times the host presses the button.
    //
    // `attribute_exists(SK)` so an Update can never upsert a phantom player row
    // — a name nobody is sat behind would otherwise join the roster and the
    // readiness counts.
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
        UpdateExpression: bindToRequester
          ? 'SET HandoverExpiresAt = :exp, HandoverForClientId = :cid'
          : 'SET HandoverExpiresAt = :exp REMOVE HandoverForClientId',
        ConditionExpression: 'attribute_exists(SK)',
        ExpressionAttributeValues: bindToRequester
          ? { ':exp': expiresAt, ':cid': requestedBy }
          : { ':exp': expiresAt }
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

    console.log(`🔓 Handover opened for ${playerName} in game ${gameId} (${bindToRequester ? 'bound to the requester' : 'open'}), expires ${expiresAt}`);

    return {
      statusCode: 200,
      body: JSON.stringify({
        success: true,
        playerName,
        bound: bindToRequester,
        windowSeconds: HANDOVER_WINDOW_SECONDS,
        // The same allow-listed shape the roster publishes, so the host page has
        // one reading of handover state rather than two.
        handover: publicHandoverState({ ...existing.Item, HandoverExpiresAt: expiresAt }),
        message: `"${playerName}" is unlocked for one handover. It closes in ${Math.round(HANDOVER_WINDOW_SECONDS / 60)} minutes if nobody takes it.`
      }),
      headers: cors
    };

  } catch (error) {
    console.error('Grant handover error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: `Failed to unlock name: ${error.message}` }),
      headers: cors
    };
  }
};
