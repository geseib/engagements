const AWS = require('aws-sdk');
const dynamodb = new AWS.DynamoDB.DocumentClient();

const TABLE_NAME = process.env.TABLE_NAME;

exports.handler = async (event, context) => {
  console.log('Delete Archive Items:', JSON.stringify(event, null, 2));

  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token',
    'Access-Control-Allow-Methods': 'DELETE,OPTIONS',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers };
  }

  try {
    const { archiveId, items } = JSON.parse(event.body || '{}');

    if (!archiveId || !items || !Array.isArray(items) || items.length === 0) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({
          success: false,
          error: 'Archive ID and items array are required'
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

    const timestamp = new Date().toISOString();
    const transactItems = [];
    let deletedCount = 0;
    let questionSetsCount = 0;
    let promptsCount = 0;

    // Process each item to delete
    for (const item of items) {
      try {
        if (item.type === 'question-set') {
          // Verify the archived question set exists
          const archivedSetResult = await dynamodb.get({
            TableName: TABLE_NAME,
            Key: {
              PK: `ARCHIVE#${archiveId}`,
              SK: `SET#${item.archiveItemId}`
            }
          }).promise();

          if (!archivedSetResult.Item) {
            console.warn(`Archived question set ${item.archiveItemId} not found, skipping`);
            continue;
          }

          // Delete the archived question set
          transactItems.push({
            Delete: {
              TableName: TABLE_NAME,
              Key: {
                PK: `ARCHIVE#${archiveId}`,
                SK: `SET#${item.archiveItemId}`
              }
            }
          });

          // Get and delete all questions for this archived set
          const archivedQuestionsResult = await dynamodb.query({
            TableName: TABLE_NAME,
            KeyConditionExpression: 'PK = :pk',
            ExpressionAttributeValues: {
              ':pk': `ARCHIVE#${archiveId}#SET#${item.archiveItemId}`
            }
          }).promise();

          // Delete all questions
          for (const archivedQuestion of archivedQuestionsResult.Items) {
            transactItems.push({
              Delete: {
                TableName: TABLE_NAME,
                Key: {
                  PK: archivedQuestion.PK,
                  SK: archivedQuestion.SK
                }
              }
            });
          }

          questionSetsCount++;
          deletedCount++;

        } else if (item.type === 'prompt') {
          // Verify the archived prompt exists
          const archivedPromptResult = await dynamodb.get({
            TableName: TABLE_NAME,
            Key: {
              PK: `ARCHIVE#${archiveId}`,
              SK: `PROMPT#${item.archiveItemId}`
            }
          }).promise();

          if (!archivedPromptResult.Item) {
            console.warn(`Archived prompt ${item.archiveItemId} not found, skipping`);
            continue;
          }

          // Delete the archived prompt
          transactItems.push({
            Delete: {
              TableName: TABLE_NAME,
              Key: {
                PK: `ARCHIVE#${archiveId}`,
                SK: `PROMPT#${item.archiveItemId}`
              }
            }
          });

          promptsCount++;
          deletedCount++;
        }

      } catch (itemError) {
        console.error(`Error processing item ${item.archiveItemId}:`, itemError);
        // Continue with other items
      }
    }

    if (transactItems.length === 0) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({
          success: false,
          error: 'No valid items found to delete'
        })
      };
    }

    // Update archive metadata to reflect deleted items
    const updatedArchive = {
      ...archiveResult.Item,
      lastModified: timestamp,
      itemCount: Math.max(0, (archiveResult.Item.itemCount || 0) - deletedCount),
      questionSetsCount: Math.max(0, (archiveResult.Item.questionSetsCount || 0) - questionSetsCount),
      promptsCount: Math.max(0, (archiveResult.Item.promptsCount || 0) - promptsCount)
    };

    transactItems.push({
      Put: {
        TableName: TABLE_NAME,
        Item: updatedArchive
      }
    });

    // Execute all operations in batches (DynamoDB limit is 25 items per transaction)
    const batchSize = 25;
    for (let i = 0; i < transactItems.length; i += batchSize) {
      const batch = transactItems.slice(i, i + batchSize);
      await dynamodb.transactWrite({
        TransactItems: batch
      }).promise();
    }

    console.log(`Successfully deleted ${deletedCount} items from archive ${archiveId}`);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        deletedCount,
        questionSetsCount,
        promptsCount,
        archive: updatedArchive,
        message: `Successfully deleted ${deletedCount} items from archive`
      })
    };

  } catch (error) {
    console.error('Error deleting archive items:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        success: false,
        error: 'Failed to delete archive items',
        details: error.message
      })
    };
  }
};