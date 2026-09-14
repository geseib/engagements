const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, GetCommand, QueryCommand, UpdateCommand } = require('@aws-sdk/lib-dynamodb');
const { broadcastToGame } = require('./schema-compliant-manager');
const { isHidden, redactAnswers } = require('./anonymity');
const { callerMayDriveSession } = require('./tenant');

const client = new DynamoDBClient({});
const db = DynamoDBDocumentClient.from(client);

exports.handler = async (event) => {
  const gameId = event.pathParameters.gameId;
  const { questionNumber } = JSON.parse(event.body || '{}');

  console.log(`🗳️ Starting vote for game ${gameId}, question ${questionNumber}`);

  try {
    /*
      WHOSE ROOM IS THIS? The Cognito authorizer on this route says the caller
      is *a* host; nothing here said they were THIS session's host, so the
      boundary was "any `hosts` account plus one of the 9,000 four-digit ids".

      THIS ROUTE IS THE REVEAL BY ANOTHER DOOR, which is why the check is here
      rather than only on the state write. /reveal-authors is gated because it
      answers with the names. So does this: the ballot below carries
      `playerName` against `answer` for everyone who has responded, redacted
      only when the session is hiding authors. On a session that is not, an
      account in any organisation could ask a stranger's room to start voting
      and be handed the roster in the reply — without ever asking for a reveal.

      BEFORE THE UPDATE, and that ordering is the point: the state write is the
      first thing this handler does. `metaRes` forty lines below reads the same
      row for the anonymity gate, but by then the room has already moved, so
      this read is not a duplicate that could be folded into it.

      404 rather than 403: see tenant.callerMayDriveSession.
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

    // Update game state to VOTE#questionNumber (using the main STATE record)
    const paddedQuestionNumber = String(questionNumber).padStart(3, '0');
    const newState = `VOTE#${paddedQuestionNumber}`;
    const now = new Date().toISOString();
    
    await db.send(new UpdateCommand({
      TableName: process.env.TABLE_NAME,
      Key: { PK: `GAME#${gameId}`, SK: 'STATE' },
      UpdateExpression: 'SET #state = :state, #updatedAt = :updatedAt',
      ExpressionAttributeNames: {
        '#state': 'State',
        '#updatedAt': 'UpdatedAt'
      },
      ExpressionAttributeValues: {
        ':state': newState,
        ':updatedAt': now
      }
    }));

    // Get answers for this question to return to the host
    const answersResult = await db.send(new QueryCommand({
      TableName: process.env.TABLE_NAME,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
      ExpressionAttributeValues: {
        ':pk': `GAME#${gameId}`,
        ':sk': `QUESTION#${paddedQuestionNumber}#ANSWER#`
      }
    }));

    const answers = answersResult.Items || [];
    console.log(`🗳️ Found ${answers.length} answers for question ${paddedQuestionNumber}`);

    // Anonymity gate. The answers travel over HTTP, which is where the
    // redaction belongs — the votingStarted broadcast below carries no
    // attribution and never has.
    const [metaRes, roundRes] = await Promise.all([
      db.send(new GetCommand({
        TableName: process.env.TABLE_NAME,
        Key: { PK: `GAME#${gameId}`, SK: 'METADATA' }
      })),
      db.send(new GetCommand({
        TableName: process.env.TABLE_NAME,
        Key: { PK: `GAME#${gameId}`, SK: `ROUND#${paddedQuestionNumber}` }
      }))
    ]);
    const hidden = isHidden(metaRes.Item, roundRes.Item);

    const ballot = answers.map(answer => ({
      playerId: answer.PlayerName,
      playerName: answer.PlayerName,
      name: answer.PlayerName, // Add name field for frontend compatibility
      answer: answer.Answer,
      submittedAt: answer.SubmittedAt
    }));

    // Broadcast voting started to everyone attached to the game, host included.
    //
    // `newState` is not decoration. GameHostPage's votingStarted handler reads
    // this exact field and nothing else, so a frame without it made the host
    // page a no-op: drive the session from the phone remote and every player
    // moved to VOTE while the projector sat on ASK. It used to live only in the
    // HTTP response below, which the caller sees and nobody else does.
    //
    // get-results.js already puts `newState` on its gameStateChanged frame; the
    // convention existed, this handler just didn't follow it.
    await broadcastToGame(gameId, {
      type: 'votingStarted',
      gameId: gameId,
      newState: newState,
      state: `GAME#${gameId} ${newState}`,
      questionNumber: paddedQuestionNumber,
      timestamp: now
    });

    console.log(`✅ Vote started successfully for game ${gameId}, question ${questionNumber}`);
    return {
      statusCode: 200,
      body: JSON.stringify({
        status: 'OK',
        questionNumber: questionNumber,
        newState: newState,
        answers: hidden ? redactAnswers(ballot) : ballot
      }),
      headers: { 'Access-Control-Allow-Origin': '*' }
    };
  } catch (error) {
    console.error('❌ Start vote error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Failed to start vote' }),
      headers: { 'Access-Control-Allow-Origin': '*' }
    };
  }
};
