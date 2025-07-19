const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, GetCommand, DeleteCommand, UpdateCommand } = require('@aws-sdk/lib-dynamodb');
const { S3Client, DeleteObjectCommand, ListObjectsV2Command, DeleteObjectsCommand } = require('@aws-sdk/client-s3');

const tableName = process.env.TABLE_NAME;
const aiPromptsBucket = process.env.AI_PROMPTS_BUCKET;

const dynamoClient = new DynamoDBClient({});
const dynamodb = DynamoDBDocumentClient.from(dynamoClient, {
  marshallOptions: {
    removeUndefinedValues: true
  }
});

const s3Client = new S3Client({});

exports.handler = async (event) => {
  console.log('🗑️ Delete AI Prompt - Event:', JSON.stringify(event, null, 2));

  try {
    // Handle CORS preflight
    if (event.requestContext?.http?.method === 'OPTIONS') {
      return {
        statusCode: 200,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Headers': 'Content-Type',
          'Access-Control-Allow-Methods': 'DELETE, OPTIONS'
        },
        body: ''
      };
    }

    const promptId = event.pathParameters?.promptId;
    console.log('📋 Extracted promptId:', promptId);
    
    if (!promptId) {
      console.error('❌ No promptId found in path parameters');
      return {
        statusCode: 400,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Headers': 'Content-Type',
          'Access-Control-Allow-Methods': 'DELETE, OPTIONS'
        },
        body: JSON.stringify({
          error: 'Missing promptId',
          message: 'promptId is required in path parameters',
          pathParameters: event.pathParameters
        })
      };
    }

    const queryParams = event.queryStringParameters || {};
    const hardDelete = queryParams.hardDelete === 'true';
    const deleteAllVersions = queryParams.deleteAllVersions === 'true';
    
    console.log('📋 Query params:', queryParams);
    console.log('📋 hardDelete:', hardDelete);
    console.log('📋 deleteAllVersions:', deleteAllVersions);

    console.log(`🗑️ Deleting AI prompt: ${promptId}, hardDelete: ${hardDelete}, deleteAllVersions: ${deleteAllVersions}`);

    // Get existing prompt metadata
    const existingPrompt = await dynamodb.send(new GetCommand({
      TableName: tableName,
      Key: {
        PK: `AI_PROMPT#${promptId}`,
        SK: 'METADATA'
      }
    }));

    if (!existingPrompt.Item) {
      throw new Error(`AI prompt not found: ${promptId}`);
    }

    const currentPrompt = existingPrompt.Item;

    // Check if this is a default prompt
    if (currentPrompt.isDefault && !hardDelete) {
      return {
        statusCode: 400,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Headers': 'Content-Type',
          'Access-Control-Allow-Methods': 'DELETE, OPTIONS'
        },
        body: JSON.stringify({
          error: 'Cannot delete default prompt',
          message: 'Default prompts are protected. Use hardDelete=true query parameter to force deletion.',
          promptId: promptId,
          isDefault: true
        })
      };
    }

    const timestamp = new Date().toISOString();

    if (hardDelete) {
      console.log(`💥 Performing hard delete of AI prompt: ${promptId}`);

      // Delete all versions from S3 if requested
      if (deleteAllVersions) {
        console.log(`🗑️ Deleting all versions from S3`);
        
        // List all objects with the prompt prefix
        const s3Prefix = `prompts/${currentPrompt.gameType}/${promptId}/`;
        const listResponse = await s3Client.send(new ListObjectsV2Command({
          Bucket: aiPromptsBucket,
          Prefix: s3Prefix
        }));

        if (listResponse.Contents && listResponse.Contents.length > 0) {
          // Delete all versions
          const objectsToDelete = listResponse.Contents.map(obj => ({ Key: obj.Key }));
          
          await s3Client.send(new DeleteObjectsCommand({
            Bucket: aiPromptsBucket,
            Delete: {
              Objects: objectsToDelete,
              Quiet: true
            }
          }));

          console.log(`🗑️ Deleted ${objectsToDelete.length} versions from S3`);
        }
      } else {
        // Delete only the current version
        if (currentPrompt.s3Key) {
          console.log(`🗑️ Deleting current version from S3: ${currentPrompt.s3Key}`);
          try {
            await s3Client.send(new DeleteObjectCommand({
              Bucket: aiPromptsBucket,
              Key: currentPrompt.s3Key
            }));
            console.log(`✅ Successfully deleted S3 object: ${currentPrompt.s3Key}`);
          } catch (s3Error) {
            console.error(`❌ Failed to delete S3 object: ${currentPrompt.s3Key}`, s3Error);
            // Continue with DynamoDB deletion even if S3 fails
          }
        } else {
          console.log(`⚠️ No S3 key found for prompt ${promptId}, skipping S3 deletion`);
        }
      }

      // Delete from DynamoDB
      console.log(`🗑️ Deleting from DynamoDB`);
      await dynamodb.send(new DeleteCommand({
        TableName: tableName,
        Key: {
          PK: `AI_PROMPT#${promptId}`,
          SK: 'METADATA'
        }
      }));

      console.log(`✅ Hard delete completed for AI prompt: ${promptId}`);

      return {
        statusCode: 200,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Headers': 'Content-Type',
          'Access-Control-Allow-Methods': 'DELETE, OPTIONS'
        },
        body: JSON.stringify({
          promptId,
          status: 'deleted',
          message: 'AI prompt permanently deleted'
        })
      };

    } else {
      // Soft delete - mark as archived
      console.log(`📦 Performing soft delete (archive) of AI prompt: ${promptId}`);

      await dynamodb.send(new UpdateCommand({
        TableName: tableName,
        Key: {
          PK: `AI_PROMPT#${promptId}`,
          SK: 'METADATA'
        },
        UpdateExpression: 'SET #status = :status, archivedAt = :archivedAt, updatedAt = :updatedAt',
        ExpressionAttributeNames: {
          '#status': 'status'
        },
        ExpressionAttributeValues: {
          ':status': 'archived',
          ':archivedAt': timestamp,
          ':updatedAt': timestamp
        }
      }));

      console.log(`✅ Soft delete completed for AI prompt: ${promptId}`);

      return {
        statusCode: 200,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Headers': 'Content-Type',
          'Access-Control-Allow-Methods': 'DELETE, OPTIONS'
        },
        body: JSON.stringify({
          promptId,
          status: 'archived',
          message: 'AI prompt archived successfully'
        })
      };
    }

  } catch (error) {
    console.error('❌ Error deleting AI prompt:', error);
    
    // Handle specific error cases
    let statusCode = 500;
    if (error.message.includes('not found')) {
      statusCode = 404;
    } else if (error.message.includes('Cannot delete default prompt')) {
      statusCode = 403;
    }

    return {
      statusCode,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'DELETE, OPTIONS'
      },
      body: JSON.stringify({
        error: 'Failed to delete AI prompt',
        message: error.message
      })
    };
  }
};