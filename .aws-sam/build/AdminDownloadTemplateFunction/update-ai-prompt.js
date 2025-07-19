const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, GetCommand, PutCommand, UpdateCommand } = require('@aws-sdk/lib-dynamodb');
const { S3Client, PutObjectCommand, GetObjectCommand } = require('@aws-sdk/client-s3');

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
  console.log('✏️ Update AI Prompt - Event:', JSON.stringify(event, null, 2));

  try {
    // Handle CORS preflight
    if (event.requestContext?.http?.method === 'OPTIONS') {
      return {
        statusCode: 200,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Headers': 'Content-Type',
          'Access-Control-Allow-Methods': 'PUT, OPTIONS'
        },
        body: ''
      };
    }

    const promptId = event.pathParameters?.promptId;
    if (!promptId) {
      throw new Error('promptId is required in path parameters');
    }

    if (!event.body) {
      throw new Error('Request body is required');
    }

    const updateData = JSON.parse(event.body);
    const {
      name,
      description,
      category,
      scenario,
      template,
      isDefault,
      status,
      questionSetIds,
      tags,
      createNewVersion = false
    } = updateData;

    console.log(`✏️ Updating AI prompt: ${promptId}, createNewVersion: ${createNewVersion}`);

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
    const timestamp = new Date().toISOString();

    // Get current content from S3
    let currentContent = null;
    try {
      const s3Response = await s3Client.send(new GetObjectCommand({
        Bucket: aiPromptsBucket,
        Key: currentPrompt.s3Key
      }));
      currentContent = JSON.parse(await s3Response.Body.transformToString());
    } catch (s3Error) {
      console.warn(`⚠️ Could not fetch current content from S3: ${s3Error.message}`);
    }

    let newVersion = currentPrompt.version;
    let newS3Key = currentPrompt.s3Key;

    // If creating new version or if default prompt is being edited
    if (createNewVersion || currentPrompt.isDefault) {
      newVersion = currentPrompt.version + 1;
      newS3Key = `prompts/${currentPrompt.gameType}/${promptId}/v${newVersion}.json`;
      console.log(`🔄 Creating new version: ${newVersion}`);
    }

    // Prepare updated content
    const updatedContent = {
      ...currentContent,
      id: promptId,
      version: newVersion,
      name: name !== undefined ? name : currentContent?.name || currentPrompt.name,
      description: description !== undefined ? description : currentContent?.description || currentPrompt.description,
      category: category !== undefined ? category : currentContent?.category || currentPrompt.category,
      scenario: scenario !== undefined ? scenario : currentContent?.scenario || currentPrompt.scenario,
      template: template !== undefined ? template : currentContent?.template,
      isDefault: isDefault !== undefined ? isDefault : currentContent?.isDefault || currentPrompt.isDefault,
      status: status !== undefined ? status : currentContent?.status || currentPrompt.status,
      questionSetIds: questionSetIds !== undefined ? questionSetIds : currentContent?.questionSetIds || currentPrompt.questionSetIds || [],
      tags: tags !== undefined ? tags : currentContent?.tags || currentPrompt.tags || [],
      updatedAt: timestamp,
      metadata: {
        ...currentContent?.metadata,
        lastModifiedBy: 'admin-interface',
        updateReason: createNewVersion ? 'new-version' : 'edit'
      }
    };

    // Save updated content to S3
    console.log(`💾 Saving updated content to S3: ${newS3Key}`);
    await s3Client.send(new PutObjectCommand({
      Bucket: aiPromptsBucket,
      Key: newS3Key,
      Body: JSON.stringify(updatedContent, null, 2),
      ContentType: 'application/json',
      Metadata: {
        promptId: promptId,
        gameType: currentPrompt.gameType,
        version: newVersion.toString(),
        status: updatedContent.status
      }
    }));

    // Update DynamoDB metadata
    const updateExpression = [];
    const expressionAttributeValues = {};
    const expressionAttributeNames = {};

    if (name !== undefined) {
      updateExpression.push('#name = :name');
      expressionAttributeNames['#name'] = 'name';
      expressionAttributeValues[':name'] = name;
    }
    
    if (description !== undefined) {
      updateExpression.push('description = :description');
      expressionAttributeValues[':description'] = description;
    }
    
    if (category !== undefined) {
      updateExpression.push('category = :category');
      expressionAttributeValues[':category'] = category;
    }
    
    if (scenario !== undefined) {
      updateExpression.push('scenario = :scenario');
      expressionAttributeValues[':scenario'] = scenario;
    }
    
    if (isDefault !== undefined) {
      updateExpression.push('isDefault = :isDefault');
      expressionAttributeValues[':isDefault'] = isDefault;
    }
    
    if (status !== undefined) {
      updateExpression.push('#status = :status');
      expressionAttributeNames['#status'] = 'status';
      expressionAttributeValues[':status'] = status;
    }
    
    if (questionSetIds !== undefined) {
      updateExpression.push('questionSetIds = :questionSetIds');
      expressionAttributeValues[':questionSetIds'] = questionSetIds;
    }
    
    if (tags !== undefined) {
      updateExpression.push('tags = :tags');
      expressionAttributeValues[':tags'] = tags;
    }

    // Always update these fields
    updateExpression.push('updatedAt = :updatedAt');
    expressionAttributeValues[':updatedAt'] = timestamp;
    
    updateExpression.push('version = :version');
    expressionAttributeValues[':version'] = newVersion;
    
    updateExpression.push('s3Key = :s3Key');
    expressionAttributeValues[':s3Key'] = newS3Key;

    if (updateExpression.length > 0) {
      console.log(`💾 Updating DynamoDB metadata`);
      await dynamodb.send(new UpdateCommand({
        TableName: tableName,
        Key: {
          PK: `AI_PROMPT#${promptId}`,
          SK: 'METADATA'
        },
        UpdateExpression: `SET ${updateExpression.join(', ')}`,
        ExpressionAttributeValues: expressionAttributeValues,
        ...(Object.keys(expressionAttributeNames).length > 0 && { ExpressionAttributeNames: expressionAttributeNames })
      }));
    }

    const result = {
      promptId,
      version: newVersion,
      s3Key: newS3Key,
      status: 'updated',
      message: createNewVersion ? 'New version created successfully' : 'AI prompt updated successfully'
    };

    console.log(`✅ Successfully updated AI prompt: ${promptId}`);

    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'PUT, OPTIONS'
      },
      body: JSON.stringify(result)
    };

  } catch (error) {
    console.error('❌ Error updating AI prompt:', error);
    return {
      statusCode: 500,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'PUT, OPTIONS'
      },
      body: JSON.stringify({
        error: 'Failed to update AI prompt',
        message: error.message
      })
    };
  }
};