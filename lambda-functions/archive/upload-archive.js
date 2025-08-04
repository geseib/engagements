const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, PutCommand } = require('@aws-sdk/lib-dynamodb');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const { v4: uuidv4 } = require('uuid');

const dynamoClient = new DynamoDBClient({});
const db = DynamoDBDocumentClient.from(dynamoClient);
const s3 = new S3Client({});

exports.handler = async (event) => {
  try {
    // Parse the request body
    const body = JSON.parse(event.body || '{}');
    const { title, description, content, contentType, category, tags, fileName } = body;
    
    if (!title || !content || !contentType) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Title, content, and contentType are required' }),
        headers: { 'Access-Control-Allow-Origin': '*' }
      };
    }
    
    console.log(`📤 Uploading archive item: ${title}`);
    
    // Generate unique ID for the archive item
    const archiveId = uuidv4();
    const timestamp = new Date().toISOString();
    
    // Determine file extension based on content type
    const fileExtension = contentType === 'questionset' ? '.csv' : 
                         contentType === 'document' ? '.txt' : 
                         contentType === 'template' ? '.json' : '.txt';
    
    // Create S3 key for content storage
    const s3Key = `archive/${contentType}/${archiveId}${fileExtension}`;
    
    // Upload content to S3
    await s3.send(new PutObjectCommand({
      Bucket: process.env.ARCHIVE_BUCKET_NAME,
      Key: s3Key,
      Body: content,
      ContentType: 'text/plain',
      Metadata: {
        archiveId: archiveId,
        title: title,
        uploadedAt: timestamp
      }
    }));
    
    console.log(`✅ Content uploaded to S3: ${s3Key}`);
    
    // Store metadata in DynamoDB
    const archiveItem = {
      PK: 'ARCHIVE',
      SK: `ITEM#${archiveId}`,
      ArchiveId: archiveId,
      Title: title,
      Description: description || '',
      ContentType: contentType,
      Category: category || 'general',
      Tags: tags || [],
      FileName: fileName || `${title}${fileExtension}`,
      S3Key: s3Key,
      FileSize: Buffer.byteLength(content, 'utf8'),
      UploadedBy: event.requestContext?.authorizer?.claims?.sub || 'anonymous',
      CreatedAt: timestamp,
      UpdatedAt: timestamp,
      Version: 1,
      Status: 'active'
    };
    
    await db.send(new PutCommand({
      TableName: process.env.TABLE_NAME,
      Item: archiveItem
    }));
    
    console.log(`✅ Metadata stored in DynamoDB for archive ID: ${archiveId}`);
    
    return {
      statusCode: 200,
      body: JSON.stringify({
        success: true,
        archiveId: archiveId,
        item: archiveItem,
        message: 'Archive item uploaded successfully'
      }),
      headers: { 'Access-Control-Allow-Origin': '*' }
    };
    
  } catch (error) {
    console.error('Upload archive error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Failed to upload archive item' }),
      headers: { 'Access-Control-Allow-Origin': '*' }
    };
  }
};