const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, GetCommand, QueryCommand } = require('@aws-sdk/lib-dynamodb');
const { isHidden, redactAnswers } = require('./anonymity');

const client = new DynamoDBClient({});
const db = DynamoDBDocumentClient.from(client);

exports.handler = async (event) => {
  try {
    const { gameId } = event.pathParameters || {};
    const queryParams = event.queryStringParameters || {};
    const { role, questionId } = queryParams; // 'host' or 'player'
    
    if (!gameId) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Game ID is required' }),
        headers: { 'Access-Control-Allow-Origin': '*' }
      };
    }

    console.log(`📋 Getting answers for game ${gameId}, role: ${role || 'unspecified'}, questionId: ${questionId || 'current'}`);

    let targetQuestionId = questionId;
    
    // If no specific question ID provided, get current question from game state
    if (!targetQuestionId) {
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

      // Use LessonNumber to construct the question ID 
      const lessonNumber = gameState.Item.LessonNumber;
      if (lessonNumber && lessonNumber > 0) {
        targetQuestionId = String(lessonNumber).padStart(3, '0');
      } else {
        targetQuestionId = gameState.Item.CurrentQuestionId;
      }
      
      if (!targetQuestionId) {
        return {
          statusCode: 400,
          body: JSON.stringify({ 
            error: 'No current question',
            message: 'No question is currently active'
          }),
          headers: { 'Access-Control-Allow-Origin': '*' }
        };
      }
    }

    console.log(`🎯 Getting answers for question: ${targetQuestionId}`);

    // Get all answers for this question
    const answersQuery = await db.send(new QueryCommand({
      TableName: process.env.TABLE_NAME,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
      ExpressionAttributeValues: {
        ':pk': `GAME#${gameId}`,
        ':sk': `QUESTION#${targetQuestionId}#ANSWER#`
      }
    }));

    const answers = answersQuery.Items || [];
    console.log(`📊 Found ${answers.length} answers for question ${targetQuestionId}`);

    // Base answer information
    const fullAnswers = answers.map(answer => ({
      playerName: answer.PlayerName,
      name: answer.PlayerName, // Add name field for frontend compatibility
      answer: answer.Answer,
      answerType: answer.AnswerType || 'text',
      submittedAt: answer.SubmittedAt
    }));

    // Anonymity is decided here, once, for both role branches below.
    //
    // There is deliberately no host exemption: `role` arrives as a query
    // parameter (see :11), so a payload we would emit to role=host we would
    // emit to anybody who typed it. The only implementable guarantee is that
    // the names are not in the response at all.
    const [metaRes, roundRes] = await Promise.all([
      db.send(new GetCommand({
        TableName: process.env.TABLE_NAME,
        Key: { PK: `GAME#${gameId}`, SK: 'METADATA' }
      })),
      db.send(new GetCommand({
        TableName: process.env.TABLE_NAME,
        Key: { PK: `GAME#${gameId}`, SK: `ROUND#${targetQuestionId}` }
      }))
    ]);

    const hidden = isHidden(metaRes.Item, roundRes.Item);
    // Order is preserved by redactAnswers and must stay that way: the ballot is
    // positional and get-results tallies vote index against answers[index].
    const baseAnswers = hidden ? redactAnswers(fullAnswers) : fullAnswers;

    // Role-specific information
    if (role === 'host') {
      // Host gets complete answer information plus question details
      const result = {
        gameId: gameId,
        questionId: targetQuestionId,
        answers: baseAnswers,
        answerCount: answers.length,
        timestamp: new Date().toISOString()
      };

      console.log(`✅ Returning host answer info for ${gameId}: ${answers.length} answers`);
      return {
        statusCode: 200,
        body: JSON.stringify(result),
        headers: { 'Access-Control-Allow-Origin': '*' }
      };
    } else {
      // Check if game is in voting phase - if so, players can see answers to vote on
      const gameState = await db.send(new GetCommand({
        TableName: process.env.TABLE_NAME,
        Key: { PK: `GAME#${gameId}`, SK: 'STATE' }
      }));
      
      const currentState = gameState.Item?.State || 'CREATED';
      
      if (currentState.startsWith('VOTE#')) {
        // During voting, players can see answers to vote on
        const result = {
          gameId: gameId,
          questionId: targetQuestionId,
          answers: baseAnswers,
          answerCount: answers.length,
          timestamp: new Date().toISOString()
        };

        console.log(`✅ Returning player voting answers for ${gameId}: ${answers.length} answers`);
        return {
          statusCode: 200,
          body: JSON.stringify(result),
          headers: { 'Access-Control-Allow-Origin': '*' }
        };
      } else {
        // Players get limited answer information (just count, not actual answers)
        const result = {
          gameId: gameId,
          questionId: targetQuestionId,
          answerCount: answers.length,
          timestamp: new Date().toISOString()
        };

        console.log(`✅ Returning player answer info for ${gameId}: ${answers.length} answers (count only)`);
        return {
          statusCode: 200,
          body: JSON.stringify(result),
          headers: { 'Access-Control-Allow-Origin': '*' }
        };
      }
    }

  } catch (error) {
    console.error('Get answers error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: `Failed to get answers: ${error.message}` }),
      headers: { 'Access-Control-Allow-Origin': '*' }
    };
  }
};