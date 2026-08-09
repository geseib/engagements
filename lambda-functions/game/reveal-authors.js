/**
 * End the anonymity of one round.
 *
 * The reveal is the primary action of RESULTS, not an automatic consequence of
 * arriving there (§5.6.4) — so this is an endpoint the host calls, and the beat
 * order is RESULTS (anonymous) -> RESULTS (revealed) -> What we heard -> Next.
 * A host cannot forget to reveal, because revealing is the only way forward.
 *
 * PER ROUND, NOT PER GAME. A host may reveal round 3 and end the session before
 * round 4, and round 4 must stay anonymous forever in the report.
 *
 * IDEMPOTENT. The host is standing in front of a room; a double-tap must not
 * produce an error, and revealing something already revealed is a no-op that
 * still returns the rows.
 *
 * This does not un-send anything. `‹ Hide again` on the stage is display-only —
 * the payload has already been delivered. Do not describe it as a security
 * control.
 */
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, QueryCommand, UpdateCommand } = require('@aws-sdk/lib-dynamodb');
const { ApiGatewayManagementApiClient, PostToConnectionCommand } = require('@aws-sdk/client-apigatewaymanagementapi');

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

  if (!gameId || questionNumber === undefined || questionNumber === null) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: 'gameId and questionNumber are required' }),
      headers: { 'Access-Control-Allow-Origin': '*' }
    };
  }

  const padded = String(questionNumber).padStart(3, '0');
  const now = new Date().toISOString();

  try {
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
