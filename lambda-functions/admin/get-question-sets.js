const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, QueryCommand } = require('@aws-sdk/lib-dynamodb');

const client = new DynamoDBClient({});
const db = DynamoDBDocumentClient.from(client);

exports.handler = async (event) => {
  try {
    console.log('Getting question sets...');
    
    // Get all question set metadata (both active and inactive)
    const res = await db.send(new QueryCommand({
      TableName: process.env.TABLE_NAME,
      KeyConditionExpression: 'PK = :pk',
      ExpressionAttributeValues: { ':pk': 'SETS' }
    }));

    const questionSets = res.Items.map(item => ({
      id: item.SK.replace('SET#', ''),
      name: item.name,
      description: item.description,
      customInstruction: item.customInstruction,
      aiContextInstruction: item.aiContextInstruction,
      promptId: item.promptId,
      engagementType: item.engagementType,
      questionCount: item.questionCount || 0,
      totalQuestions: item.questionCount || 0, // Add for frontend compatibility
      categoryCount: item.categoryCount || 0,
      active: item.active !== false,
      quickstart: item.Quickstart || false, // Add quickstart field
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
      isAIGenerated: item.isAIGenerated || false,
      hasImages: item.hasImages === true
    }));

    return {
      statusCode: 200,
      body: JSON.stringify({ questionSets }),
      headers: { 'Access-Control-Allow-Origin': '*' }
    };
    
  } catch (error) {
    console.error('Get question sets error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: `Failed to get question sets: ${error.message}` }),
      headers: { 'Access-Control-Allow-Origin': '*' }
    };
  }
};
