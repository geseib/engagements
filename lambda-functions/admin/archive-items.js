const AWS = require('aws-sdk');
const dynamodb = new AWS.DynamoDB.DocumentClient();
const crypto = require('crypto');

const TABLE_NAME = process.env.TABLE_NAME;

// Generate a hash for the archived item ID to avoid conflicts
function generateArchiveHash(originalId) {
  return crypto.createHash('md5').update(originalId + Date.now()).digest('hex').substring(0, 8);
}

exports.handler = async (event, context) => {
  console.log('Archive Items:', JSON.stringify(event, null, 2));

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
    let archivedCount = 0;
    let questionSetsCount = 0;
    let promptsCount = 0;

    // Process each item to archive
    for (const item of items) {
      try {
        let sourceKey;
        let archiveKey;
        let itemData;

        if (item.type === 'question-set') {
          // Get the question set from local system
          sourceKey = { PK: 'QUESTION_SETS', SK: item.id };
          
          const sourceResult = await dynamodb.get({
            TableName: TABLE_NAME,
            Key: sourceKey
          }).promise();

          if (!sourceResult.Item) {
            console.warn(`Question set ${item.id} not found, skipping`);
            continue;
          }

          itemData = sourceResult.Item;
          
          // Also get all questions for this set
          const questionsResult = await dynamodb.query({
            TableName: TABLE_NAME,
            KeyConditionExpression: 'PK = :pk',
            ExpressionAttributeValues: {
              ':pk': `QUESTION_SET#${item.id}`
            }
          }).promise();

          // Generate archive ID with hash
          const archivedSetId = `${item.id}_${generateArchiveHash(item.id)}`;
          
          // Create archive record for question set
          const archivedSet = {
            ...itemData,
            PK: `ARCHIVE#${archiveId}`,
            SK: `SET#${archivedSetId}`,
            originalId: item.id,
            originalPK: itemData.PK,
            originalSK: itemData.SK,
            archivedAt: timestamp,
            archivedSetId: archivedSetId
          };

          // Add question set to archive
          transactItems.push({
            Put: {
              TableName: TABLE_NAME,
              Item: archivedSet
            }
          });

          // Archive all questions for this set
          for (const question of questionsResult.Items) {
            const archivedQuestion = {
              ...question,
              PK: `ARCHIVE#${archiveId}#SET#${archivedSetId}`,
              SK: question.SK, // Keep original SK for questions
              originalPK: question.PK,
              archivedAt: timestamp
            };

            transactItems.push({
              Put: {
                TableName: TABLE_NAME,
                Item: archivedQuestion
              }
            });
          }

          // Delete original question set
          transactItems.push({
            Delete: {
              TableName: TABLE_NAME,
              Key: sourceKey
            }
          });

          // Delete all original questions
          for (const question of questionsResult.Items) {
            transactItems.push({
              Delete: {
                TableName: TABLE_NAME,
                Key: {
                  PK: question.PK,
                  SK: question.SK
                }
              }
            });
          }

          questionSetsCount++;
          archivedCount++;

        } else if (item.type === 'prompt') {
          // Get the prompt from local system
          sourceKey = { PK: 'AI_PROMPTS', SK: item.id };
          
          const sourceResult = await dynamodb.get({
            TableName: TABLE_NAME,
            Key: sourceKey
          }).promise();

          if (!sourceResult.Item) {
            console.warn(`Prompt ${item.id} not found, skipping`);
            continue;
          }

          itemData = sourceResult.Item;
          
          // Generate archive ID with hash
          const archivedPromptId = `${item.id}_${generateArchiveHash(item.id)}`;
          
          // Create archive record for prompt
          const archivedPrompt = {
            ...itemData,
            PK: `ARCHIVE#${archiveId}`,
            SK: `PROMPT#${archivedPromptId}`,
            originalId: item.id,
            originalPK: itemData.PK,
            originalSK: itemData.SK,
            archivedAt: timestamp,
            archivedPromptId: archivedPromptId
          };

          // Add prompt to archive
          transactItems.push({
            Put: {
              TableName: TABLE_NAME,
              Item: archivedPrompt
            }
          });

          // Delete original prompt
          transactItems.push({
            Delete: {
              TableName: TABLE_NAME,
              Key: sourceKey
            }
          });

          promptsCount++;
          archivedCount++;
        }

      } catch (itemError) {
        console.error(`Error processing item ${item.id}:`, itemError);
        // Continue with other items
      }
    }

    if (transactItems.length === 0) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({
          success: false,
          error: 'No valid items found to archive'
        })
      };
    }

    // Update archive metadata
    const updatedArchive = {
      ...archiveResult.Item,
      lastModified: timestamp,
      itemCount: (archiveResult.Item.itemCount || 0) + archivedCount,
      questionSetsCount: (archiveResult.Item.questionSetsCount || 0) + questionSetsCount,
      promptsCount: (archiveResult.Item.promptsCount || 0) + promptsCount
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

    console.log(`Successfully archived ${archivedCount} items to archive ${archiveId}`);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        archivedCount,
        questionSetsCount,
        promptsCount,
        archive: updatedArchive
      })
    };

  } catch (error) {
    console.error('Error archiving items:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        success: false,
        error: 'Failed to archive items',
        details: error.message
      })
    };
  }
};