const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, GetCommand, UpdateCommand } = require('@aws-sdk/lib-dynamodb');

const client = new DynamoDBClient({});
const db = DynamoDBDocumentClient.from(client);

exports.handler = async (event) => {
  try {
    const gameId = event.pathParameters?.gameId;
    const { questionId, setId } = JSON.parse(event.body || '{}');
    
    console.log(`Selecting question ${questionId} from set ${setId} for game ${gameId}`);
    
    if (!gameId || !questionId || !setId) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Game ID, question ID, and set ID are required' }),
        headers: { 'Access-Control-Allow-Origin': '*' }
      };
    }
    
    // Get the specific question
    const questionRes = await db.send(new GetCommand({
      TableName: process.env.TABLE_NAME,
      Key: { 
        PK: `SET#${setId}`, 
        SK: `QUESTION#${questionId}` 
      }
    }));
    
    if (!questionRes.Item) {
      return {
        statusCode: 404,
        body: JSON.stringify({ error: 'Question not found' }),
        headers: { 'Access-Control-Allow-Origin': '*' }
      };
    }
    
    const question = questionRes.Item;
    
    // Get the current game to check state
    const gameRes = await db.send(new GetCommand({
      TableName: process.env.TABLE_NAME,
      Key: { PK: `GAME#${gameId}`, SK: 'METADATA' }
    }));
    
    if (!gameRes.Item) {
      return {
        statusCode: 404,
        body: JSON.stringify({ error: 'Game not found' }),
        headers: { 'Access-Control-Allow-Origin': '*' }
      };
    }
    
    const gameData = gameRes.Item;
    
    // Check if game is in a state where question selection is allowed
    const currentState = gameData.GameState || 'CREATED';
    if (!['CREATED', 'STARTED'].includes(currentState)) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Cannot select question while game is in progress' }),
        headers: { 'Access-Control-Allow-Origin': '*' }
      };
    }
    
    // Calculate next question number
    const currentQuestions = gameData.Questions || [];
    const nextQuestionNum = String(currentQuestions.length + 1).padStart(3, '0');
    
    // Create the new question entry
    const newQuestion = {
      id: nextQuestionNum,
      title: question.title || question.Title,
      questionDetail: question.questionDetail || question.QuestionDetail || question.detail,
      category: question.category || question.Category,
      setId: setId,
      originalQuestionId: questionId,
      // Copy all question fields
      ...question,
      // Override with standardized fields
      id: nextQuestionNum
    };
    
    // Add the question to the game
    const updatedQuestions = [...currentQuestions, newQuestion];
    
    // Update the game with the new question
    await db.send(new UpdateCommand({
      TableName: process.env.TABLE_NAME,
      Key: { PK: `GAME#${gameId}`, SK: 'METADATA' },
      UpdateExpression: 'SET Questions = :questions, QuestionSetId = :setId, #ts = :timestamp',
      ExpressionAttributeNames: {
        '#ts': 'timestamp'
      },
      ExpressionAttributeValues: {
        ':questions': updatedQuestions,
        ':setId': setId,
        ':timestamp': new Date().toISOString()
      }
    }));
    
    console.log(`✅ Question ${questionId} added as question #${nextQuestionNum} to game ${gameId}`);
    
    return {
      statusCode: 200,
      body: JSON.stringify({ 
        success: true,
        message: `Question "${newQuestion.title}" added to game`,
        questionNumber: nextQuestionNum,
        question: newQuestion
      }),
      headers: { 'Access-Control-Allow-Origin': '*' }
    };
    
  } catch (error) {
    console.error('Select question error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: `Failed to select question: ${error.message}` }),
      headers: { 'Access-Control-Allow-Origin': '*' }
    };
  }
};