const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, QueryCommand } = require('@aws-sdk/lib-dynamodb');

const client = new DynamoDBClient({});
const db = DynamoDBDocumentClient.from(client);

exports.handler = async (event) => {
  try {
    const { setId } = event.pathParameters || {};

    if (!setId) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Question set ID is required' }),
        headers: { 'Access-Control-Allow-Origin': '*' }
      };
    }

    console.log(`Getting categories for question set: ${setId}`);

    // Query all categories in the set
    const result = await db.send(new QueryCommand({
      TableName: process.env.TABLE_NAME,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
      ExpressionAttributeValues: {
        ':pk': `SET#${setId}`,
        ':sk': 'CATEGORY#'
      }
    }));

    const categoryItems = result.Items || [];
    
    // Format categories as expected by frontend
    const categories = categoryItems.map(category => ({
      id: category.SK.replace('CATEGORY#', ''),
      name: category.Name,
      description: category.Description,
      active: true,
      questionCount: category.QuestionCount || 0
    }));

    console.log(`Found ${categories.length} categories for set ${setId}:`, categories);

    return {
      statusCode: 200,
      body: JSON.stringify({
        categories: categories,
        totalCategories: categories.length
      }),
      headers: { 'Access-Control-Allow-Origin': '*' }
    };

  } catch (error) {
    console.error('Get categories error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: `Failed to get categories: ${error.message}` }),
      headers: { 'Access-Control-Allow-Origin': '*' }
    };
  }
};