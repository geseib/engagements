const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, GetCommand } = require('@aws-sdk/lib-dynamodb');
const { S3Client, GetObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');

const dynamoClient = new DynamoDBClient({
  region: process.env.AWS_REGION || 'us-east-1'
});
const db = DynamoDBDocumentClient.from(dynamoClient);
const s3 = new S3Client({
  region: process.env.AWS_REGION || 'us-east-1'
});

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
    
    console.log(`📖 Getting archive item: ${archiveId}`);
    
    // Get metadata from DynamoDB
    const result = await db.send(new GetCommand({
      TableName: process.env.TABLE_NAME,
      Key: {
        PK: 'ARCHIVE',
        SK: `ITEM#${archiveId}`
      }
    }));
    
    if (!result.Item) {
      return {
        statusCode: 404,
        body: JSON.stringify({ error: 'Archive item not found' }),
        headers: { 'Access-Control-Allow-Origin': '*' }
      };
    }
    
    const item = result.Item;
    
    // Generate presigned URL for S3 content access (valid for 1 hour)
    const command = new GetObjectCommand({
      Bucket: process.env.ARCHIVE_BUCKET_NAME,
      Key: item.S3Key
    });
    
    const now = new Date();
    const expirationTime = new Date(now.getTime() + (3600 * 1000)); // 1 hour from now
    
    console.log(`🕐 Lambda current time: ${now.toISOString()}`);
    console.log(`🕐 Expected URL expiration: ${expirationTime.toISOString()}`);
    console.log(`🕐 Lambda timezone: ${Intl.DateTimeFormat().resolvedOptions().timeZone}`);
    
    // Try with explicit options to ensure proper time handling
    const downloadUrl = await getSignedUrl(s3, command, { 
      expiresIn: 3600,
      signableHeaders: new Set(['host'])
    });
    
    // Extract expiration from the signed URL for verification
    const urlParams = new URL(downloadUrl);
    const urlExpiration = urlParams.searchParams.get('X-Amz-Date');
    const urlExpires = urlParams.searchParams.get('X-Amz-Expires');
    
    console.log(`📝 Signed URL X-Amz-Date: ${urlExpiration}`);
    console.log(`📝 Signed URL X-Amz-Expires: ${urlExpires} seconds`);
    console.log(`✅ Generated presigned URL for archive item: ${archiveId}`);
    
    return {
      statusCode: 200,
      body: JSON.stringify({
        success: true,
        item: item,
        downloadUrl: downloadUrl
      }),
      headers: { 
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Pragma': 'no-cache',
        'Expires': '0'
      }
    };
    
  } catch (error) {
    console.error('Get archive item error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Failed to get archive item' }),
      headers: { 'Access-Control-Allow-Origin': '*' }
    };
  }
};