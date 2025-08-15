const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, QueryCommand, GetCommand } = require('@aws-sdk/lib-dynamodb');

const client = new DynamoDBClient({});
const db = DynamoDBDocumentClient.from(client);

exports.handler = async (event) => {
  try {
    const setId = event.pathParameters?.setId;
    
    console.log(`Getting questions for set: ${setId}`);
    
    if (!setId) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Set ID is required' }),
        headers: { 'Access-Control-Allow-Origin': '*' }
      };
    }
    
    // Verify the question set exists
    const setRes = await db.send(new GetCommand({
      TableName: process.env.TABLE_NAME,
      Key: { PK: 'SETS', SK: `SET#${setId}` }
    }));
    
    if (!setRes.Item) {
      return {
        statusCode: 404,
        body: JSON.stringify({ error: 'Question set not found' }),
        headers: { 'Access-Control-Allow-Origin': '*' }
      };
    }
    
    // Get all questions for this set
    const questionsRes = await db.send(new QueryCommand({
      TableName: process.env.TABLE_NAME,
      KeyConditionExpression: 'PK = :setpk AND begins_with(SK, :questionPrefix)',
      ExpressionAttributeValues: { 
        ':setpk': `SET#${setId}`,
        ':questionPrefix': 'QUESTION#'
      }
    }));
    
    const questions = (questionsRes.Items || []).map(item => ({
      id: item.SK.replace('QUESTION#', ''),
      title: item.title || item.Title,
      questionDetail: item.questionDetail || item.QuestionDetail || item.detail,
      category: item.category || item.Category,
      // Trivia question fields
      optionA: item.optionA || item.OptionA,
      optionB: item.optionB || item.OptionB,
      optionC: item.optionC || item.OptionC,
      optionD: item.optionD || item.OptionD,
      correctAnswer: item.correctAnswer || item.CorrectAnswer,
      answerDetails: item.answerDetails || item.AnswerDetails,
      difficulty: item.difficulty || item.Difficulty,
      // Poll/engagement question fields
      customInstructions: item.customInstructions || item.CustomInstructions,
      // Common fields
      engagementType: item.engagementType || item.EngagementType,
      setId: setId,
      sortOrder: item.sortOrder || 0
    }));
    
    // Sort questions by sortOrder, then by title
    questions.sort((a, b) => {
      if (a.sortOrder !== b.sortOrder) {
        return (a.sortOrder || 0) - (b.sortOrder || 0);
      }
      return (a.title || '').localeCompare(b.title || '');
    });
    
    console.log(`Found ${questions.length} questions for set ${setId}`);
    
    return {
      statusCode: 200,
      body: JSON.stringify({ 
        questions,
        setId,
        setName: setRes.Item.name || setRes.Item.Name,
        totalQuestions: questions.length
      }),
      headers: { 'Access-Control-Allow-Origin': '*' }
    };
    
  } catch (error) {
    console.error('Get question set questions error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: `Failed to get questions: ${error.message}` }),
      headers: { 'Access-Control-Allow-Origin': '*' }
    };
  }
};