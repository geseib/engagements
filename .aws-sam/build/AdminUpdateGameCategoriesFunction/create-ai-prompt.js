const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, PutCommand, GetCommand, QueryCommand, UpdateCommand } = require('@aws-sdk/lib-dynamodb');
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
      instructions,
      outputFormat,
      isDefault = false,
      status = 'draft',
      questionSetIds = [],
      tags = []
    } = JSON.parse(event.body);

    // Validate required fields - support both old (template) and new (instructions + outputFormat) formats
    if (!name || !gameType) {
      throw new Error('Missing required fields: name and gameType are required');
    }
    
    // Either template OR (instructions + outputFormat) must be provided
    if (!template && (!instructions || !outputFormat)) {
      throw new Error('Either template OR both instructions and outputFormat are required');
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
      // Support both old and new formats
      ...(template && { template }),
      ...(instructions && { instructions }),
      ...(outputFormat && { outputFormat }),
      isDefault,
      status,
      questionSetIds,
      tags,
      createdAt: timestamp,
      updatedAt: timestamp,
      metadata: {
        author: 'admin', // Could be enhanced with actual user info
        createdBy: 'admin-interface',
        format: template ? 'legacy' : 'structured'
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

    // Save metadata to DynamoDB using new structure
    const dynamoItem = {
      PK: 'AIPROMPTS',
      SK: `AIPROMPT#${promptId}`,
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

    // If this is marked as default, handle default prompt lookup structure
    if (isDefault) {
      console.log(`🏷️ Setting as default prompt for ${gameType}/${category}`);
      
      try {
        // First, clear isDefault from all other prompts in the same category
        console.log(`🧹 Clearing default status from other prompts in ${gameType}/${category}`);
        
        const { Items: existingPrompts } = await dynamodb.send(new QueryCommand({
          TableName: tableName,
          KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
          FilterExpression: 'gameType = :gameType AND category = :category AND promptId <> :currentPromptId',
          ExpressionAttributeValues: {
            ':pk': 'AIPROMPTS',
            ':sk': 'AIPROMPT#',
            ':gameType': gameType,
            ':category': category,
            ':currentPromptId': promptId
          }
        }));
        
        // Clear default status from other prompts
        const clearDefaultPromises = existingPrompts
          .filter(prompt => prompt.isDefault)
          .map(prompt => 
            dynamodb.send(new UpdateCommand({
              TableName: tableName,
              Key: {
                PK: 'AIPROMPTS',
                SK: `AIPROMPT#${prompt.promptId}`
              },
              UpdateExpression: 'SET isDefault = :false',
              ExpressionAttributeValues: {
                ':false': false
              }
            }))
          );
        
        if (clearDefaultPromises.length > 0) {
          await Promise.all(clearDefaultPromises);
          console.log(`✅ Cleared default status from ${clearDefaultPromises.length} other prompts`);
        }

        // Create/update the default prompt lookup
        const defaultLookupKey = `GAMETYPE#${gameType}#CATEGORY#${category}`;
        await dynamodb.send(new PutCommand({
          TableName: tableName,
          Item: {
            PK: 'AIPROMPTS',
            SK: defaultLookupKey,
            defaultPrompt: `PROMPT#${promptId}`,
            gameType,
            category,
            promptId,
            updatedAt: timestamp,
            ttl: Math.floor(Date.now() / 1000) + (365 * 24 * 60 * 60) // 1 year TTL
          }
        }));

        console.log(`✅ Set new default prompt for ${gameType}/${category}: ${promptId}`);
      } catch (error) {
        console.error('⚠️ Error managing default prompt lookup:', error);
        // Continue anyway - the prompt was still created successfully
      }
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