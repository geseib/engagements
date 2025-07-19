const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, PutCommand } = require('@aws-sdk/lib-dynamodb');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');

const tableName = process.env.TABLE_NAME;
const aiPromptsBucket = process.env.AI_PROMPTS_BUCKET;

const dynamoClient = new DynamoDBClient({});
const dynamodb = DynamoDBDocumentClient.from(dynamoClient, {
  marshallOptions: {
    removeUndefinedValues: true
  }
});

const s3Client = new S3Client({});

// Generate unique ID for prompts
const generatePromptId = () => {
  return Date.now().toString(36) + Math.random().toString(36).substr(2);
};

exports.handler = async (event) => {
  console.log('➕ Create AI Prompt - Event:', JSON.stringify(event, null, 2));

  try {
    // Handle CORS preflight
    if (event.requestContext?.http?.method === 'OPTIONS') {
      return {
        statusCode: 200,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Headers': 'Content-Type',
          'Access-Control-Allow-Methods': 'POST, OPTIONS'
        },
        body: ''
      };
    }

    if (!event.body) {
      throw new Error('Request body is required');
    }

    const {
      name,
      description,
      gameType,
      category,
      scenario,
      template,
      isDefault = false,
      status = 'draft',
      questionSetIds = [],
      tags = []
    } = JSON.parse(event.body);

    // Validate required fields
    if (!name || !gameType || !template) {
      throw new Error('Missing required fields: name, gameType, and template are required');
    }

    // Validate gameType
    const validGameTypes = ['callandanswer', 'trivia', 'polls'];
    if (!validGameTypes.includes(gameType)) {
      throw new Error(`Invalid gameType. Must be one of: ${validGameTypes.join(', ')}`);
    }

    const promptId = generatePromptId();
    const timestamp = new Date().toISOString();
    const version = 1;

    // Create S3 key based on gameType and promptId
    const s3Key = `prompts/${gameType}/${promptId}/v${version}.json`;

    console.log(`📝 Creating AI prompt - ID: ${promptId}, GameType: ${gameType}, Category: ${category}`);

    // Prepare prompt content for S3
    const promptContent = {
      id: promptId,
      version,
      name,
      description,
      gameType,
      category,
      scenario,
      template,
      isDefault,
      status,
      questionSetIds,
      tags,
      createdAt: timestamp,
      updatedAt: timestamp,
      metadata: {
        author: 'admin', // Could be enhanced with actual user info
        createdBy: 'admin-interface'
      }
    };

    // Save to S3
    console.log(`💾 Saving prompt content to S3: ${s3Key}`);
    await s3Client.send(new PutObjectCommand({
      Bucket: aiPromptsBucket,
      Key: s3Key,
      Body: JSON.stringify(promptContent, null, 2),
      ContentType: 'application/json',
      Metadata: {
        promptId: promptId,
        gameType: gameType,
        version: version.toString(),
        status: status
      }
    }));

    // Save metadata to DynamoDB
    const dynamoItem = {
      PK: `AI_PROMPT#${promptId}`,
      SK: `METADATA`,
      GSI1PK: 'AI_PROMPT',
      GSI1SK: `${gameType}#${timestamp}`,
      promptId,
      name,
      description,
      gameType,
      category,
      scenario,
      isDefault,
      status,
      questionSetIds,
      tags,
      s3Key,
      version,
      createdAt: timestamp,
      updatedAt: timestamp,
      ttl: Math.floor(Date.now() / 1000) + (365 * 24 * 60 * 60) // 1 year TTL
    };

    console.log(`💾 Saving prompt metadata to DynamoDB`);
    await dynamodb.send(new PutCommand({
      TableName: tableName,
      Item: dynamoItem
    }));

    // If this is marked as default, we might want to update other defaults
    if (isDefault) {
      console.log(`🏷️ Prompt marked as default for ${gameType}/${category}`);
      // Note: Implementation for managing default status would go here
      // For now, we'll allow multiple defaults and let the UI handle selection
    }

    const result = {
      promptId,
      s3Key,
      version,
      status: 'created',
      message: 'AI prompt created successfully'
    };

    console.log(`✅ Successfully created AI prompt: ${promptId}`);

    return {
      statusCode: 201,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'POST, OPTIONS'
      },
      body: JSON.stringify(result)
    };

  } catch (error) {
    console.error('❌ Error creating AI prompt:', error);
    return {
      statusCode: 500,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'POST, OPTIONS'
      },
      body: JSON.stringify({
        error: 'Failed to create AI prompt',
        message: error.message
      })
    };
  }
};