const AWS = require('aws-sdk');
const dynamodb = new AWS.DynamoDB.DocumentClient();

const TABLE_NAME = process.env.TABLE_NAME;

exports.handler = async (event, context) => {
  console.log('Get Archive Content:', JSON.stringify(event, null, 2));

  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token',
    'Access-Control-Allow-Methods': 'GET,OPTIONS',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers };
  }

  try {
    const archiveId = event.queryStringParameters?.archiveId;

    if (!archiveId) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({
          success: false,
          error: 'Archive ID is required'
        })
      };
    }

    // Verify archive exists
    const archiveResult = await dynamodb.get({
      TableName: TABLE_NAME,
      Key: {
        PK: `ARCHIVE#${archiveId}`,
        SK: 'METADATA'
      }
    }).promise();

    if (!archiveResult.Item) {
      return {
        statusCode: 404,
        headers,
        body: JSON.stringify({
          success: false,
          error: 'Archive not found'
        })
      };
    }

    // Get all items in the archive (both question sets and prompts)
    const itemsResult = await dynamodb.query({
      TableName: TABLE_NAME,
      KeyConditionExpression: 'PK = :pk',
      FilterExpression: 'SK <> :metadata',
      ExpressionAttributeValues: {
        ':pk': `ARCHIVE#${archiveId}`,
        ':metadata': 'METADATA'
      }
    }).promise();

    const questionSets = [];
    const prompts = [];

    itemsResult.Items.forEach(item => {
      if (item.SK.startsWith('SET#')) {
        // This is a question set
        questionSets.push({
          ...item,
          archiveItemId: item.SK.replace('SET#', ''), // Remove SET# prefix for UI
          type: 'question-set'
        });
      } else if (item.SK.startsWith('PROMPT#')) {
        // This is a prompt
        prompts.push({
          ...item,
          archiveItemId: item.SK.replace('PROMPT#', ''), // Remove PROMPT# prefix for UI
          type: 'prompt'
        });
      }
    });

    // Sort by archived date (newest first)
    questionSets.sort((a, b) => new Date(b.archivedAt) - new Date(a.archivedAt));
    prompts.sort((a, b) => new Date(b.archivedAt) - new Date(a.archivedAt));

    console.log(`Retrieved ${questionSets.length} question sets and ${prompts.length} prompts from archive ${archiveId}`);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        archive: archiveResult.Item,
        questionSets,
        prompts,
        totalItems: questionSets.length + prompts.length
      })
    };

  } catch (error) {
    console.error('Error getting archive content:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        success: false,
        error: 'Failed to get archive content',
        details: error.message
      })
    };
  }
};