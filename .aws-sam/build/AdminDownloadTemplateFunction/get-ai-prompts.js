const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, QueryCommand } = require('@aws-sdk/lib-dynamodb');
const { S3Client, ListObjectsV2Command, GetObjectCommand } = require('@aws-sdk/client-s3');

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
  console.log('🔍 Get AI Prompts - Event:', JSON.stringify(event, null, 2));

  try {
    // Handle CORS preflight
    if (event.requestContext?.http?.method === 'OPTIONS') {
      return {
        statusCode: 200,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Headers': 'Content-Type',
          'Access-Control-Allow-Methods': 'GET, OPTIONS'
        },
        body: ''
      };
    }

    const queryParams = event.queryStringParameters || {};
    const gameType = queryParams.gameType; // callandanswer, trivia, polls
    const category = queryParams.category; // specific category filter
    const status = queryParams.status; // active, draft, archived

    console.log(`🔍 Fetching AI prompts - gameType: ${gameType}, category: ${category}, status: ${status}`);

    // Get prompt metadata from DynamoDB using new structure
    const dynamoQuery = {
      TableName: tableName,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
      ExpressionAttributeValues: {
        ':pk': 'AIPROMPTS',
        ':sk': 'AIPROMPT#'
      }
    };

    // Add filters if specified
    const filterExpressions = [];
    if (gameType) {
      filterExpressions.push('gameType = :gameType');
      dynamoQuery.ExpressionAttributeValues[':gameType'] = gameType;
    }
    if (category) {
      filterExpressions.push('category = :category');
      dynamoQuery.ExpressionAttributeValues[':category'] = category;
    }
    if (status) {
      filterExpressions.push('#status = :status');
      dynamoQuery.ExpressionAttributeValues[':status'] = status;
      dynamoQuery.ExpressionAttributeNames = { '#status': 'status' };
    }

    if (filterExpressions.length > 0) {
      dynamoQuery.FilterExpression = filterExpressions.join(' AND ');
    }

    const response = await dynamodb.send(new QueryCommand(dynamoQuery));
    const promptsMetadata = response.Items || [];

    console.log(`📊 Found ${promptsMetadata.length} prompt metadata records`);

    // Enrich with S3 data if needed
    const enrichedPrompts = await Promise.all(promptsMetadata.map(async (prompt) => {
      try {
        // Get latest version from S3 if needed
        if (prompt.s3Key && queryParams.includeContent === 'true') {
          const s3Response = await s3Client.send(new GetObjectCommand({
            Bucket: aiPromptsBucket,
            Key: prompt.s3Key
          }));
          
          const content = await s3Response.Body.transformToString();
          const promptData = JSON.parse(content);
          
          return {
            ...prompt,
            promptContent: promptData
          };
        }
        
        return prompt;
      } catch (s3Error) {
        console.warn(`⚠️ Could not fetch S3 content for ${prompt.s3Key}:`, s3Error.message);
        return prompt;
      }
    }));

    // Sort by updatedAt desc
    enrichedPrompts.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));

    console.log(`✅ Successfully retrieved ${enrichedPrompts.length} AI prompts`);

    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'GET, OPTIONS'
      },
      body: JSON.stringify({
        prompts: enrichedPrompts,
        totalCount: enrichedPrompts.length,
        filters: {
          gameType,
          category,
          status
        }
      })
    };

  } catch (error) {
    console.error('❌ Error fetching AI prompts:', error);
    return {
      statusCode: 500,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'GET, OPTIONS'
      },
      body: JSON.stringify({
        error: 'Failed to fetch AI prompts',
        message: error.message
      })
    };
  }
};