const { S3Client, PutObjectCommand, GetObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, GetCommand } = require('@aws-sdk/lib-dynamodb');

const s3Client = new S3Client({});
const dynamoClient = new DynamoDBClient({});
const db = DynamoDBDocumentClient.from(dynamoClient);

exports.handler = async (event) => {
  try {
    const { gameId } = event.pathParameters || {};
    const body = JSON.parse(event.body || '{}');
    const { eventTitle, pdfBlob, permanent = false } = body;
    
    if (!gameId) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Game ID is required' }),
        headers: { 'Access-Control-Allow-Origin': '*' }
      };
    }

    if (!pdfBlob || !eventTitle) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Event title and PDF blob are required' }),
        headers: { 'Access-Control-Allow-Origin': '*' }
      };
    }

    console.log(`📄 Saving PDF report for game ${gameId}: ${eventTitle}`);

    // Verify game exists
    const gameMetadata = await db.send(new GetCommand({
      TableName: process.env.TABLE_NAME,
      Key: { PK: `GAME#${gameId}`, SK: 'METADATA' }
    }));

    if (!gameMetadata.Item) {
      return {
        statusCode: 404,
        body: JSON.stringify({ error: 'Game not found' }),
        headers: { 'Access-Control-Allow-Origin': '*' }
      };
    }

    // Generate filename
    const timestamp = new Date().toISOString().split('T')[0];
    const sanitizedTitle = eventTitle.replace(/[^a-zA-Z0-9\s-]/g, '').replace(/\s+/g, '-');
    const baseFileName = `${sanitizedTitle}-${timestamp}-${gameId}.pdf`;
    
    // Add prefix for permanent files
    const fileName = permanent ? `permanent/${baseFileName}` : baseFileName;
    
    // Convert base64 to buffer
    const pdfBuffer = Buffer.from(pdfBlob, 'base64');
    
    // Upload to S3
    const uploadCommand = new PutObjectCommand({
      Bucket: process.env.REPORTS_BUCKET_NAME,
      Key: fileName,
      Body: pdfBuffer,
      ContentType: 'application/pdf',
      ContentDisposition: `attachment; filename="${baseFileName}"`,
      Metadata: {
        'permanent': permanent ? 'true' : 'false',
        'game-id': gameId,
        'event-title': eventTitle
      }
    });
    
    const uploadResult = await s3Client.send(uploadCommand);
    
    // Generate presigned URL for download (valid for 24 hours)
    const getObjectCommand = new GetObjectCommand({
      Bucket: process.env.REPORTS_BUCKET_NAME,
      Key: fileName
    });
    
    const downloadUrl = await getSignedUrl(s3Client, getObjectCommand, {
      expiresIn: 24 * 60 * 60 // 24 hours in seconds
    });
    
    console.log(`✅ PDF report saved: ${fileName}`);
    
    return {
      statusCode: 200,
      body: JSON.stringify({
        fileName: fileName,
        downloadUrl: downloadUrl,
        s3Location: `s3://${process.env.REPORTS_BUCKET_NAME}/${fileName}`,
        permanent: permanent,
        gameId: gameId,
        eventTitle: eventTitle
      }),
      headers: { 'Access-Control-Allow-Origin': '*' }
    };
    
  } catch (error) {
    console.error('Save report error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: `Failed to save report: ${error.message}` }),
      headers: { 'Access-Control-Allow-Origin': '*' }
    };
  }
};