const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, GetCommand, PutCommand, UpdateCommand, QueryCommand, DeleteCommand } = require('@aws-sdk/lib-dynamodb');
const { S3Client, PutObjectCommand, GetObjectCommand } = require('@aws-sdk/client-s3');
const { normalizeGameType } = require('./shared/game-types');
const { normalizeOutputSections, inferPromptType } = require('./shared/prompt-shape');
const { assertTemplateVariablesExist } = require('./shared/template-variable-usage');

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
      instructions,
      outputFormat,
      // Declared output shape. Omit to leave whatever the prompt already has;
      // send [] or null to clear it and go back to the system default triad.
      outputSections: rawOutputSections,
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
        PK: 'AIPROMPTS',
        SK: `AIPROMPT#${promptId}`
      }
    }));

    if (!existingPrompt.Item) {
      throw new Error(`AI prompt not found: ${promptId}`);
    }

    const currentPrompt = existingPrompt.Item;
    const timestamp = new Date().toISOString();

    // Distinguish "not supplied" from "cleared" — the same null-means-skip trap
    // that made question-set edits silently no-op (see the rounds/personas
    // cleanup design, R2). undefined = leave alone; anything else = replace,
    // and an empty/invalid declaration clears back to the default triad.
    const outputSectionsSupplied = rawOutputSections !== undefined;
    const outputSections = outputSectionsSupplied ? normalizeOutputSections(rawOutputSections) : null;
    if (outputSectionsSupplied && rawOutputSections && !outputSections) {
      throw new Error('outputSections must be 1-8 entries of { heading, guidance }, each heading unique, single-line plain text without markdown syntax');
    }

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

    // Same gate as create-ai-prompt.js, and for the same reason — the advisor's
    // "apply improved prompt" lands here rather than there.
    //
    // Only the fields this request actually SUPPLIED are checked. Validating
    // untouched ones would make a prompt authored before the gate existed
    // permanently uneditable, including by the edit that would have fixed it.
    const effectivePromptType = currentPrompt.promptType
      || inferPromptType(currentContent || currentPrompt);
    if (effectivePromptType === 'analysis') {
      const supplied = {};
      if (template !== undefined) supplied.template = template;
      if (instructions !== undefined) supplied.instructions = instructions;
      if (outputFormat !== undefined) supplied.outputFormat = outputFormat;
      assertTemplateVariablesExist(supplied);
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
      // Support both old and new formats
      ...(template !== undefined && { template }),
      ...(instructions !== undefined && { instructions }),
      ...(outputFormat !== undefined && { outputFormat }),
      // Preserve existing values if not being updated
      ...(template === undefined && currentContent?.template && { template: currentContent.template }),
      ...(instructions === undefined && currentContent?.instructions && { instructions: currentContent.instructions }),
      ...(outputFormat === undefined && currentContent?.outputFormat && { outputFormat: currentContent.outputFormat }),
      ...(outputSectionsSupplied
        ? (outputSections ? { outputSections } : { outputSections: undefined })
        : (currentContent?.outputSections ? { outputSections: currentContent.outputSections } : {})),
      isDefault: isDefault !== undefined ? isDefault : currentContent?.isDefault || currentPrompt.isDefault,
      status: status !== undefined ? status : currentContent?.status || currentPrompt.status,
      questionSetIds: questionSetIds !== undefined ? questionSetIds : currentContent?.questionSetIds || currentPrompt.questionSetIds || [],
      tags: tags !== undefined ? tags : currentContent?.tags || currentPrompt.tags || [],
      updatedAt: timestamp,
      metadata: {
        ...currentContent?.metadata,
        lastModifiedBy: 'admin-interface',
        updateReason: createNewVersion ? 'new-version' : 'edit',
        format: (instructions !== undefined || outputFormat !== undefined) ? 'structured' : 
                currentContent?.metadata?.format || 'legacy'
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

    if (outputSectionsSupplied) {
      // Mirror of the S3 copy, so the admin picker can show the shape from the
      // list response. A cleared shape writes an empty list rather than a
      // REMOVE, which keeps this in one SET expression and still normalises to
      // "no declaration" (normalizeOutputSections rejects an empty array).
      updateExpression.push('outputSections = :outputSections');
      expressionAttributeValues[':outputSections'] = outputSections || [];
    }

    // Always update these fields
    updateExpression.push('updatedAt = :updatedAt');
    expressionAttributeValues[':updatedAt'] = timestamp;
    
    updateExpression.push('version = :version');
    expressionAttributeValues[':version'] = newVersion;
    
    updateExpression.push('s3Key = :s3Key');
    expressionAttributeValues[':s3Key'] = newS3Key;

    // Needed by the `REMOVE #ttl` clause below — `ttl` is a DynamoDB reserved word.
    expressionAttributeNames['#ttl'] = 'ttl';

    // Handle default prompt management for both setting and unsetting defaults
    if (isDefault !== undefined) {
      if (isDefault === true) {
        console.log(`🏷️ Setting as default prompt for ${currentPrompt.gameType}/${updatedContent.category}`);
        
        try {
          // First, clear isDefault from all other prompts in the same category
          console.log(`🧹 Clearing default status from other prompts in ${currentPrompt.gameType}/${updatedContent.category}`);
          
          const { Items: allPrompts } = await dynamodb.send(new QueryCommand({
            TableName: tableName,
            KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
            ExpressionAttributeValues: {
              ':pk': 'AIPROMPTS',
              ':sk': 'AIPROMPT#'
            }
          }));

          // One default per GAME TYPE, not per game type + category — see the
          // matching note in create-ai-prompt.js (D17). Matched on the
          // normalized type so legacy `callandanswer` rows are cleared too,
          // which a FilterExpression cannot express.
          const targetType = normalizeGameType(currentPrompt.gameType);
          const existingPrompts = (allPrompts || []).filter(p =>
            p.promptId !== promptId && normalizeGameType(p.gameType) === targetType);

          // Clear default status from other prompts
          const clearDefaultPromises = existingPrompts
            .filter(prompt => prompt.isDefault && prompt.promptId)
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
          const defaultLookupKey = `GAMETYPE#${currentPrompt.gameType}#CATEGORY#${updatedContent.category}`;
          await dynamodb.send(new PutCommand({
            TableName: tableName,
            Item: {
              PK: 'AIPROMPTS',
              SK: defaultLookupKey,
              defaultPrompt: `PROMPT#${promptId}`,
              gameType: currentPrompt.gameType,
              category: updatedContent.category,
              promptId,
              updatedAt: timestamp
              // NO `ttl`. The table's TimeToLiveSpecification exists for
              // GAME#/PLAYER# session records; AI prompts are configuration and
              // must never expire. See create-ai-prompt.js for the full note.
            }
          }));

          console.log(`✅ Updated default prompt for ${currentPrompt.gameType}/${updatedContent.category}: ${promptId}`);
        } catch (error) {
          console.error('⚠️ Error managing default prompt lookup:', error);
          // Continue anyway - the prompt was still updated successfully
        }
      } else if (isDefault === false && currentPrompt.isDefault === true) {
        // If we're unsetting a default, remove the default lookup (no default for this category)
        console.log(`🗑️ Removing default status from ${currentPrompt.gameType}/${updatedContent.category}`);
        
        try {
          const defaultLookupKey = `GAMETYPE#${currentPrompt.gameType}#CATEGORY#${updatedContent.category}`;
          
          await dynamodb.send(new DeleteCommand({
            TableName: tableName,
            Key: {
              PK: 'AIPROMPTS',
              SK: defaultLookupKey
            }
          }));
          
          console.log(`✅ Removed default lookup for ${currentPrompt.gameType}/${updatedContent.category}`);
        } catch (error) {
          console.error('⚠️ Error removing default lookup:', error);
        }
      }
    }

    if (updateExpression.length > 0) {
      console.log(`💾 Updating DynamoDB metadata`);
      await dynamodb.send(new UpdateCommand({
        TableName: tableName,
        Key: {
          PK: 'AIPROMPTS',
          SK: `AIPROMPT#${promptId}`
        },
        // `REMOVE ttl` self-heals: any prompt row still carrying the old
        // now+365d stamp loses it the next time anyone saves the prompt, so the
        // one-off sweep in scripts/cull-ai-prompts.js is a floor, not a
        // dependency. Removing an absent attribute is a no-op in DynamoDB.
        UpdateExpression: `SET ${updateExpression.join(', ')} REMOVE #ttl`,
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