const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, DeleteCommand, GetCommand } = require('@aws-sdk/lib-dynamodb');
const { S3Client, DeleteObjectCommand } = require('@aws-sdk/client-s3');

const dynamoClient = new DynamoDBClient({});
const db = DynamoDBDocumentClient.from(dynamoClient);
const s3 = new S3Client({});

exports.handler = async (event) => {
  try {
    const { archiveId } = event.pathParameters || {};
    
    if (!archiveId) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Archive ID is required' }),
        headers: { 'Access-Control-Allow-Origin': '*' }
      };
    }
    
    console.log(`🗑️ Deleting archive item: ${archiveId}`);
    
    // First get the item to retrieve S3 key
    const existing = await db.send(new GetCommand({
      TableName: process.env.TABLE_NAME,
      Key: {
        PK: 'ARCHIVE',
        SK: `ITEM#${archiveId}`
      }
    }));
    
    if (!existing.Item) {
      return {
        statusCode: 404,
        body: JSON.stringify({ error: 'Archive item not found' }),
        headers: { 'Access-Control-Allow-Origin': '*' }
      };
    }
    
    // Delete from S3
    if (existing.Item.S3Key) {
      try {
        await s3.send(new DeleteObjectCommand({
          Bucket: process.env.ARCHIVE_BUCKET_NAME,
          Key: existing.Item.S3Key
        }));
        console.log(`✅ Deleted S3 object: ${existing.Item.S3Key}`);
      } catch (s3Error) {
        console.error('S3 deletion error:', s3Error);
        // Continue with DynamoDB deletion even if S3 fails
      }
    }
    
    // Delete from DynamoDB
    await db.send(new DeleteCommand({
      TableName: process.env.TABLE_NAME,
      Key: {
        PK: 'ARCHIVE',
        SK: `ITEM#${archiveId}`
      }
    }));
    
    console.log(`✅ Archive item deleted: ${archiveId}`);
    
    return {
      statusCode: 200,
      body: JSON.stringify({
        success: true,
        archiveId: archiveId,
        message: 'Archive item deleted successfully'
      }),
      headers: { 'Access-Control-Allow-Origin': '*' }
    };
    
  } catch (error) {
    console.error('Delete archive error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Failed to delete archive item' }),
      headers: { 'Access-Control-Allow-Origin': '*' }
    };
  }
};