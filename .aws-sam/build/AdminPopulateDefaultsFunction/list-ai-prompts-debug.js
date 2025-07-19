const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, ScanCommand } = require('@aws-sdk/lib-dynamodb');

const tableName = process.env.TABLE_NAME;

const dynamoClient = new DynamoDBClient({});
const dynamodb = DynamoDBDocumentClient.from(dynamoClient);

exports.handler = async (event) => {
  console.log('🔍 Debug List AI Prompts - Event:', JSON.stringify(event, null, 2));

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

    console.log('📋 Scanning for all AI prompts...');
    const scanResult = await dynamodb.send(new ScanCommand({
      TableName: tableName,
      FilterExpression: 'begins_with(PK, :pk)',
      ExpressionAttributeValues: {
        ':pk': 'AI_PROMPT#'
      }
    }));

    const prompts = scanResult.Items || [];
    console.log(`Found ${prompts.length} AI prompts`);

    // Format for easy debugging
    const debugInfo = prompts.map(prompt => ({
      promptId: prompt.promptId,
      name: prompt.name,
      isDefault: prompt.isDefault,
      s3Key: prompt.s3Key,
      PK: prompt.PK,
      SK: prompt.SK,
      status: prompt.status || 'unknown'
    }));

    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'GET, OPTIONS'
      },
      body: JSON.stringify({
        count: prompts.length,
        prompts: debugInfo,
        raw: prompts
      }, null, 2)
    };

  } catch (error) {
    console.error('❌ Error listing prompts:', error);
    return {
      statusCode: 500,
      headers: {
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({ 
        error: 'Failed to list AI prompts',
        details: error.message 
      })
    };
  }
};