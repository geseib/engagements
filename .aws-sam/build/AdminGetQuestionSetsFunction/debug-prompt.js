const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, GetCommand } = require('@aws-sdk/lib-dynamodb');

const tableName = process.env.TABLE_NAME;

const dynamoClient = new DynamoDBClient({});
const dynamodb = DynamoDBDocumentClient.from(dynamoClient);

exports.handler = async (event) => {
  console.log('🔍 Debug Prompt - Event:', JSON.stringify(event, null, 2));

  try {
    // Handle CORS preflight
    if (event.requestContext?.http?.method === 'OPTIONS') {
      return {
        statusCode: 200,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Headers': 'Content-Type',
          'Access-Control-Allow-Methods': 'GET, OPTIONS'
        },
        body: ''
      };
    }

    const promptId = event.pathParameters?.promptId;
    if (!promptId) {
      return {
        statusCode: 400,
        headers: { 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify({ error: 'promptId is required' })
      };
    }

    console.log(`🔍 Looking up prompt: ${promptId}`);

    // Get prompt metadata
    const promptData = await dynamodb.send(new GetCommand({
      TableName: tableName,
      Key: {
        PK: `AI_PROMPT#${promptId}`,
        SK: 'METADATA'
      }
    }));

    if (!promptData.Item) {
      return {
        statusCode: 404,
        headers: { 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify({ error: 'Prompt not found' })
      };
    }

    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type'
      },
      body: JSON.stringify({
        promptId: promptId,
        promptData: promptData.Item,
        isDefault: promptData.Item.isDefault,
        s3Key: promptData.Item.s3Key,
        PK: promptData.Item.PK,
        SK: promptData.Item.SK,
        deleteUrl: `DELETE /admin/ai-prompts/${promptId}?hardDelete=true`,
        deleteCommand: `curl -X DELETE "https://your-api/admin/ai-prompts/${promptId}?hardDelete=true"`
      }, null, 2)
    };

  } catch (error) {
    console.error('❌ Error debugging prompt:', error);
    return {
      statusCode: 500,
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ 
        error: 'Failed to debug prompt',
        details: error.message 
      })
    };
  }
};