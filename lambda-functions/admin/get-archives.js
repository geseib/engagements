const AWS = require('aws-sdk');
const dynamodb = new AWS.DynamoDB.DocumentClient();

const TABLE_NAME = process.env.TABLE_NAME;

exports.handler = async (event, context) => {
  console.log('Get Archives:', JSON.stringify(event, null, 2));

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
    // Get all archives from the ARCHIVES record
    const archivesResult = await dynamodb.get({
      TableName: TABLE_NAME,
      Key: {
        PK: 'ARCHIVES',
        SK: 'METADATA'
      }
    }).promise();

    let archives = [];
    if (archivesResult.Item && archivesResult.Item.archives) {
      const archiveIds = archivesResult.Item.archives;
      
      // Get detailed information for each archive
      const archivePromises = archiveIds.map(async (archiveId) => {
        try {
          const archiveResult = await dynamodb.get({
            TableName: TABLE_NAME,
            Key: {
              PK: `ARCHIVE#${archiveId}`,
              SK: 'METADATA'
            }
          }).promise();

          if (archiveResult.Item) {
            // Count items in this archive
            const itemsResult = await dynamodb.query({
              TableName: TABLE_NAME,
              KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
              ExpressionAttributeValues: {
                ':pk': `ARCHIVE#${archiveId}`,
                ':sk': 'SET#'
              },
              Select: 'COUNT'
            }).promise();

            const promptsResult = await dynamodb.query({
              TableName: TABLE_NAME,
              KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
              ExpressionAttributeValues: {
                ':pk': `ARCHIVE#${archiveId}`,
                ':sk': 'PROMPT#'
              },
              Select: 'COUNT'
            }).promise();

            const questionSetsCount = itemsResult.Count || 0;
            const promptsCount = promptsResult.Count || 0;

            return {
              ...archiveResult.Item,
              questionSetsCount,
              promptsCount,
              itemCount: questionSetsCount + promptsCount
            };
          }
          return null;
        } catch (error) {
          console.error(`Error getting archive ${archiveId}:`, error);
          return null;
        }
      });

      const archiveResults = await Promise.all(archivePromises);
      archives = archiveResults.filter(archive => archive !== null);
      
      // Sort by creation date (newest first)
      archives.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        archives: archives
      })
    };

  } catch (error) {
    console.error('Error getting archives:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        success: false,
        error: 'Failed to get archives',
        details: error.message
      })
    };
  }
};