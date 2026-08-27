/**
 * End the anonymity of one round.
 *
 * AMENDED 2026-08-09, alongside Task 8: AuthorsRevealed now flips automatically
 * when the round enters RESULTS (get-results.js's enterResultsState), so a host
 * cannot fail to reveal — it is no longer a gate. This endpoint is only
 * load-bearing for a host who reveals BEFORE closing the vote, i.e. from ASK#
 * or VOTE#; by the time RESULTS is showing, the round is already revealed and a
 * call here is a harmless, idempotent no-op that returns the attributed rows.
 *
 * PER ROUND, NOT PER GAME. A host may reveal round 3 and end the session before
 * round 4, and round 4's authors are never revealed by this endpoint. (It does
 * not follow that round 4 stays anonymous in the report — the amendment above
 * means entering RESULTS reveals a round on its own, so in practice every round
 * that finished is attributed. Only a round abandoned before RESULTS, and never
 * revealed here, stays unattributed. create-report.js reads AuthorsRevealed for
 * exactly that reason.)
 *
 * HOST ONLY — AND THIS SESSION'S HOST. The route carries the Cognito authorizer
 * (template-clean.yaml): a participant knows the four-digit game id, and this
 * both flips the flag for the whole room and returns every name. The authorizer
 * alone only proves the caller is *a* host, and that was the entire boundary
 * until 2026-08-27; the handler now asks whose session this is as well.
 *
 * IDEMPOTENT. The host is standing in front of a room; a double-tap must not
 * produce an error, and revealing something already revealed is a no-op that
 * still returns the rows.
 *
 * This does not un-send anything, and neither does its counterpart: the
 * `Hide authors` control on the RESULTS stage is display-only and calls nothing
 * here — the payload has already been delivered. Do not describe it as a
 * security control.
 */
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, QueryCommand, GetCommand, UpdateCommand } = require('@aws-sdk/lib-dynamodb');
const { ApiGatewayManagementApiClient, PostToConnectionCommand } = require('@aws-sdk/client-apigatewaymanagementapi');

const { callerMayDriveSession } = require('./tenant');

const client = new DynamoDBClient({});
const db = DynamoDBDocumentClient.from(client);

const broadcastToGame = async (gameId, message) => {
  try {
    const apigateway = new ApiGatewayManagementApiClient({
      endpoint: process.env.WEBSOCKET_API_ENDPOINT
    });
    const res = await db.send(new QueryCommand({
      TableName: process.env.TABLE_NAME,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
      ExpressionAttributeValues: { ':pk': `GAME#${gameId}`, ':sk': 'CONNECTION#' }
    }));
    await Promise.all((res.Items || []).map(async (conn) => {
      try {
        await apigateway.send(new PostToConnectionCommand({
          ConnectionId: conn.ConnectionId,
          Data: JSON.stringify(message)
        }));
      } catch (err) {
        // A dead projector must not stop the room being told.
        console.error(`❌ reveal broadcast failed for ${conn.ConnectionId}:`, err.message);
      }
    }));
  } catch (err) {
    console.error('❌ reveal broadcast error:', err);
  }
};

exports.handler = async (event) => {
  const { gameId } = event.pathParameters || {};
  const { questionNumber } = JSON.parse(event.body || '{}');

  // The question number becomes part of the SK, so anything that is not a
  // plain round number is rejected rather than padded. `''` used to pass the
  // presence check and pad to '000'; any other junk wrote a ROUND#<junk> item
  // into the game's partition that nothing would ever read again.
  if (!gameId || !/^\d+$/.test(String(questionNumber ?? '').trim())) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: 'gameId and a numeric questionNumber are required' }),
      headers: { 'Access-Control-Allow-Origin': '*' }
    };
  }

  const padded = String(questionNumber).trim().padStart(3, '0');
  const now = new Date().toISOString();

  try {
    /*
      WHOSE ROOM IS THIS? The Cognito authorizer says the caller is *a* host;
      nothing here said they were THIS session's host. The owning org lives on
      METADATA, so this is one extra GetItem — the same one start-game.js and
      next-question.js pay. 404 rather than 403: see
      tenant.callerMayDriveSession.

      THIS ROUTE ANSWERS WITH THE NAMES, so unscoped it was worse than the flag
      it flips. A `hosts` account in any organisation, holding one of 9,000
      four-digit ids, got back every participant's name against every
      participant's answer for a round it had nothing to do with — and flipped
      AuthorsRevealed for the whole room on the way past. anonymity.js exists
      because that promise is made to participants explicitly, and it is not the
      host's alone to break.
    */
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

    // Idempotent by construction: an unconditional SET to true.
    await db.send(new UpdateCommand({
      TableName: process.env.TABLE_NAME,
      Key: { PK: `GAME#${gameId}`, SK: `ROUND#${padded}` },
      UpdateExpression: 'SET #revealed = :true, #updatedAt = :now, #qn = :qn',
      ExpressionAttributeNames: {
        '#revealed': 'AuthorsRevealed', '#updatedAt': 'UpdatedAt', '#qn': 'QuestionNumber'
      },
      ExpressionAttributeValues: { ':true': true, ':now': now, ':qn': padded }
    }));

    const answersRes = await db.send(new QueryCommand({
      TableName: process.env.TABLE_NAME,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
      ExpressionAttributeValues: {
        ':pk': `GAME#${gameId}`, ':sk': `QUESTION#${padded}#ANSWER#`
      }
    }));

    // Same order as the ballot — this is the query the ballot was built from.
    const answers = (answersRes.Items || []).map(a => ({
      playerId: a.PlayerName,
      playerName: a.PlayerName,
      name: a.PlayerName,
      answer: a.Answer,
      submittedAt: a.SubmittedAt
    }));

    await broadcastToGame(gameId, {
      type: 'authorsRevealed',
      gameId,
      questionNumber: padded,
      timestamp: now
    });

    return {
      statusCode: 200,
      body: JSON.stringify({ status: 'OK', gameId, questionNumber: padded, answers }),
      headers: { 'Access-Control-Allow-Origin': '*' }
    };
  } catch (error) {
    console.error('❌ Reveal authors error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Failed to reveal authors' }),
      headers: { 'Access-Control-Allow-Origin': '*' }
    };
  }
};
