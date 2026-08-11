const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, PutCommand, GetCommand, QueryCommand, UpdateCommand } = require('@aws-sdk/lib-dynamodb');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const { normalizeGameType, isKnownGameType, GAME_TYPE_IDS } = require('./shared/game-types');
const { inferPromptType, normalizeOutputSections } = require('./shared/prompt-shape');
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

    const requestBody = JSON.parse(event.body);
    
    // Support both old and new formats
    const {
      name,
      description,
      gameType: rawGameType,
      promptType: requestedPromptType,
      // Old format fields
      category,
      scenario,
      scenarioType, // Make optional - not required anymore
      template,
      instructions,
      // New format fields from AIGenerationPromptEditor
      basePrompt,
      contextTemplate,
      audienceTemplate,
      categoryTemplate,
      outputFormat,
      // Declared output shape: [{ heading, guidance }]. Absent means the prompt
      // takes the system default triad, which is what every prompt authored
      // before this field existed does.
      outputSections: rawOutputSections,
      defaultSettings = {},
      // Common fields
      isDefault = false,
      status = 'active',
      questionSetIds = [],
      tags = []
    } = requestBody;

    // Validate required fields - support both old (template) and new (instructions + outputFormat) formats
    if (!name || !rawGameType) {
      throw new Error('Missing required fields: name and gameType are required');
    }

    // Either template OR (instructions + outputFormat) OR basePrompt must be provided
    if (!template && (!instructions || !outputFormat) && !basePrompt) {
      throw new Error('Either template OR both instructions and outputFormat OR basePrompt are required');
    }

    // Validate against the recognised spellings, then STORE THE CANONICAL ONE.
    // Writing `callandanswer` here and `call-and-answer` from the generation
    // editor is what made the upload dropdown's filter return nothing.
    // isKnownGameType (not normalizeGameType) does the validating — normalize
    // never fails, so on its own it would happily accept "banana".
    if (!isKnownGameType(rawGameType)) {
      throw new Error(`Invalid gameType "${rawGameType}". Must be one of: ${GAME_TYPE_IDS.join(', ')}`);
    }

    // Reject a malformed shape at the door rather than storing something that
    // will be silently ignored at runtime — "I set it and nothing changed" is
    // the exact complaint this whole area exists to fix.
    const outputSections = normalizeOutputSections(rawOutputSections);
    if (rawOutputSections && !outputSections) {
      throw new Error('outputSections must be 1-8 entries of { heading, guidance }, each heading unique, single-line plain text without markdown syntax');
    }
    const gameType = normalizeGameType(rawGameType);

    // promptType decides which surfaces list this prompt. AIPromptManager used
    // not to send it at all, and the old `= 'generation'` default then labelled
    // every hand-written ANALYSIS prompt as a generation prompt (D15). Infer it
    // from the record's shape when the caller stays silent.
    const promptType = (requestedPromptType === 'analysis' || requestedPromptType === 'generation')
      ? requestedPromptType
      : inferPromptType({ template, instructions, basePrompt });
    console.log(`🏷️ promptType: ${promptType}${requestedPromptType ? '' : ' (inferred — caller sent none)'}`);

    // Reject invented {variables} before they are stored. The AI generator used
    // to make these up wholesale (it was handed an empty list and told to use
    // it), and nothing downstream noticed — the token simply reached a projector
    // as literal braces. Analysis prompts only: generation prompts speak a
    // different vocabulary entirely.
    if (promptType === 'analysis') {
      assertTemplateVariablesExist({ template, instructions, outputFormat });
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
      promptType,
      // Old format fields (optional)
      ...(category && { category }),
      ...(scenario && { scenario }),
      ...(scenarioType && { scenarioType }),
      ...(template && { template }),
      ...(instructions && { instructions }),
      // New format fields (optional)
      ...(basePrompt && { basePrompt }),
      ...(contextTemplate && { contextTemplate }),
      ...(audienceTemplate && { audienceTemplate }),
      ...(categoryTemplate && { categoryTemplate }),
      ...(outputFormat && { outputFormat }),
      ...(outputSections && { outputSections }),
      ...(Object.keys(defaultSettings).length > 0 && { defaultSettings }),
      isDefault,
      status,
      questionSetIds,
      tags,
      createdAt: timestamp,
      updatedAt: timestamp,
      metadata: {
        author: 'admin',
        createdBy: 'admin-interface',
        format: basePrompt ? 'generation' : (template ? 'legacy' : 'structured')
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
      promptType,
      // Old format fields (optional)
      ...(category && { category }),
      ...(scenario && { scenario }),
      ...(scenarioType && { scenarioType }),
      // New format fields (optional) 
      ...(basePrompt && { basePrompt }),
      ...(contextTemplate && { contextTemplate }),
      ...(audienceTemplate && { audienceTemplate }),
      ...(categoryTemplate && { categoryTemplate }),
      ...(outputFormat && { outputFormat }),
      ...(outputSections && { outputSections }),
      ...(Object.keys(defaultSettings).length > 0 && { defaultSettings }),
      isDefault,
      status,
      questionSetIds,
      tags,
      s3Key,
      version,
      createdAt: timestamp,
      updatedAt: timestamp
      // NO `ttl`. The table has TimeToLiveSpecification on `ttl`
      // (template-clean.yaml:104-106) because GAME#/PLAYER# records must expire.
      // AI prompts are configuration, not session data — stamping them with
      // now+365d meant prompts authored in Aug 2025 started vanishing in Aug
      // 2026, which is what "I added a prompt and it disappeared" actually was.
    };

    console.log(`💾 Saving prompt metadata to DynamoDB`);
    await dynamodb.send(new PutCommand({
      TableName: tableName,
      Item: dynamoItem
    }));

    // If this is marked as default, handle default prompt lookup structure
    if (isDefault) {
      console.log(`🏷️ Setting as default prompt for ${gameType}`);

      try {
        // Clear isDefault from every other prompt of this GAME TYPE — not just
        // this category. `findDefaultPromptId` (game/get-ai-summary.js) looks up
        // the default by game type alone, so per-category defaults produced
        // seven simultaneous call-and-answer "defaults" and an arbitrary winner
        // (D17). One default per game type, full stop.
        console.log(`🧹 Clearing default status from other ${gameType} prompts`);

        const { Items: allPrompts } = await dynamodb.send(new QueryCommand({
          TableName: tableName,
          KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
          ExpressionAttributeValues: {
            ':pk': 'AIPROMPTS',
            ':sk': 'AIPROMPT#'
          }
        }));

        // Match on the NORMALIZED type so a legacy `callandanswer` row is
        // cleared too, and filter in JS because a FilterExpression cannot
        // normalize.
        const existingPrompts = (allPrompts || []).filter(p =>
          p.promptId !== promptId && normalizeGameType(p.gameType) === gameType);

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
            updatedAt: timestamp
            // NO `ttl` — see the note on the AIPROMPT# item above.
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