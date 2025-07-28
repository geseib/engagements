const AWS = require('aws-sdk');
const dynamodb = new AWS.DynamoDB.DocumentClient();
const crypto = require('crypto');

const TABLE_NAME = process.env.TABLE_NAME;

// Generate a new ID if there's a conflict
function generateConflictId(originalId) {
  const timestamp = Date.now().toString();
  return `${originalId}_copy_${timestamp.substring(-6)}`;
}

exports.handler = async (event, context) => {
  console.log('Download Items:', JSON.stringify(event, null, 2));

  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token',
    'Access-Control-Allow-Methods': 'POST,OPTIONS',
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
    let downloadedCount = 0;
    let questionSetsCount = 0;
    let promptsCount = 0;
    const conflicts = [];

    // Process each item to download
    for (const item of items) {
      try {
        if (item.type === 'question-set') {
          // Get the archived question set
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

          const archivedSet = archivedSetResult.Item;
          
          // Remove hash from original ID to get the clean ID
          let restoredId = archivedSet.originalId;
          if (!restoredId) {
            // Fallback: remove hash from archive item ID
            restoredId = item.archiveItemId.split('_')[0];
          }

          // Check if original ID already exists in local system
          const existingResult = await dynamodb.get({
            TableName: TABLE_NAME,
            Key: {
              PK: 'QUESTION_SETS',
              SK: restoredId
            }
          }).promise();

          if (existingResult.Item) {
            // ID conflict - generate new ID
            restoredId = generateConflictId(restoredId);
            conflicts.push({
              type: 'question-set',
              originalId: archivedSet.originalId,
              newId: restoredId,
              reason: 'ID already exists in local system'
            });
          }

          // Restore the question set to local system
          const restoredSet = {
            ...archivedSet,
            PK: 'QUESTION_SETS',
            SK: restoredId,
            id: restoredId, // Update the ID field
            restoredAt: timestamp,
            restoredFrom: archiveId
          };

          // Remove archive-specific fields
          delete restoredSet.originalId;
          delete restoredSet.originalPK;
          delete restoredSet.originalSK;
          delete restoredSet.archivedAt;
          delete restoredSet.archivedSetId;

          transactItems.push({
            Put: {
              TableName: TABLE_NAME,
              Item: restoredSet
            }
          });

          // Get all questions for this archived set
          const archivedQuestionsResult = await dynamodb.query({
            TableName: TABLE_NAME,
            KeyConditionExpression: 'PK = :pk',
            ExpressionAttributeValues: {
              ':pk': `ARCHIVE#${archiveId}#SET#${item.archiveItemId}`
            }
          }).promise();

          // Restore all questions
          for (const archivedQuestion of archivedQuestionsResult.Items) {
            const restoredQuestion = {
              ...archivedQuestion,
              PK: `QUESTION_SET#${restoredId}`, // Update to use restored set ID
              // SK remains the same for questions
              restoredAt: timestamp
            };

            // Remove archive-specific fields
            delete restoredQuestion.originalPK;
            delete restoredQuestion.archivedAt;

            transactItems.push({
              Put: {
                TableName: TABLE_NAME,
                Item: restoredQuestion
              }
            });
          }

          questionSetsCount++;
          downloadedCount++;

        } else if (item.type === 'prompt') {
          // Get the archived prompt
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

          const archivedPrompt = archivedPromptResult.Item;
          
          // Remove hash from original ID to get the clean ID
          let restoredId = archivedPrompt.originalId;
          if (!restoredId) {
            // Fallback: remove hash from archive item ID
            restoredId = item.archiveItemId.split('_')[0];
          }

          // Check if original ID already exists in local system
          const existingResult = await dynamodb.get({
            TableName: TABLE_NAME,
            Key: {
              PK: 'AI_PROMPTS',
              SK: restoredId
            }
          }).promise();

          if (existingResult.Item) {
            // ID conflict - generate new ID
            restoredId = generateConflictId(restoredId);
            conflicts.push({
              type: 'prompt',
              originalId: archivedPrompt.originalId,
              newId: restoredId,
              reason: 'ID already exists in local system'
            });
          }

          // Restore the prompt to local system
          const restoredPrompt = {
            ...archivedPrompt,
            PK: 'AI_PROMPTS',
            SK: restoredId,
            id: restoredId, // Update the ID field
            restoredAt: timestamp,
            restoredFrom: archiveId
          };

          // Remove archive-specific fields
          delete restoredPrompt.originalId;
          delete restoredPrompt.originalPK;
          delete restoredPrompt.originalSK;
          delete restoredPrompt.archivedAt;
          delete restoredPrompt.archivedPromptId;

          transactItems.push({
            Put: {
              TableName: TABLE_NAME,
              Item: restoredPrompt
            }
          });

          promptsCount++;
          downloadedCount++;
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
          error: 'No valid items found to download'
        })
      };
    }

    // Execute all operations in batches (DynamoDB limit is 25 items per transaction)
    const batchSize = 25;
    for (let i = 0; i < transactItems.length; i += batchSize) {
      const batch = transactItems.slice(i, i + batchSize);
      await dynamodb.transactWrite({
        TransactItems: batch
      }).promise();
    }

    console.log(`Successfully downloaded ${downloadedCount} items from archive ${archiveId}`);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        downloadedCount,
        questionSetsCount,
        promptsCount,
        conflicts: conflicts.length > 0 ? conflicts : undefined,
        message: conflicts.length > 0 ? 
          `Downloaded ${downloadedCount} items. ${conflicts.length} items were renamed due to ID conflicts.` :
          `Successfully downloaded ${downloadedCount} items.`
      })
    };

  } catch (error) {
    console.error('Error downloading items:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        success: false,
        error: 'Failed to download items',
        details: error.message
      })
    };
  }
};