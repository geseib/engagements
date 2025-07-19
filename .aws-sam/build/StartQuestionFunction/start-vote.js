const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, QueryCommand, UpdateCommand } = require('@aws-sdk/lib-dynamodb');
const { broadcastToGame } = require('./schema-compliant-manager');

const client = new DynamoDBClient({});
const db = DynamoDBDocumentClient.from(client);

exports.handler = async (event) => {
  const gameId = event.pathParameters.gameId;
  const { questionNumber } = JSON.parse(event.body || '{}');

  console.log(`🗳️ Starting vote for game ${gameId}, question ${questionNumber}`);

  try {
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

    // Broadcast voting started to all players
    await broadcastToGame(gameId, {
      type: 'votingStarted',
      gameId: gameId,
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
        answers: answers.map(answer => ({
          playerId: answer.PlayerName,
          playerName: answer.PlayerName,
          name: answer.PlayerName, // Add name field for frontend compatibility
          answer: answer.Answer,
          submittedAt: answer.SubmittedAt
        }))
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
