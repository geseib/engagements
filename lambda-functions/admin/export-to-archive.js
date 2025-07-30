const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, ScanCommand, GetCommand, PutCommand } = require('@aws-sdk/lib-dynamodb');

const db = DynamoDBDocumentClient.from(new DynamoDBClient());

// Archive service configuration
const ARCHIVE_SERVICE_URL = process.env.ARCHIVE_SERVICE_URL || 'https://archive.seibtribe.us';

exports.handler = async (event) => {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization'
  };

  // Handle CORS preflight
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: corsHeaders,
      body: ''
    };
  }

  try {
    const { selectedItems, exportType } = JSON.parse(event.body);
    
    if (!selectedItems || !Array.isArray(selectedItems) || selectedItems.length === 0) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({
          error: 'selectedItems array is required and must not be empty'
        })
      };
    }

    if (!exportType || !['questionsets', 'prompts'].includes(exportType)) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({
          error: 'exportType must be either "questionsets" or "prompts"'
        })
      };
    }

    console.log(`🚀 Starting export of ${selectedItems.length} ${exportType} items to archive`);

    const results = {
      successful: [],
      failed: [],
      totalRequested: selectedItems.length
    };

    // Determine current environment
    const environment = process.env.STACK_NAME || process.env.AWS_LAMBDA_FUNCTION_NAME || 'unknown';
    const env = environment.includes('dev') ? 'dev' : 
                environment.includes('test') ? 'test' : 
                environment.includes('prod') ? 'prod' : 'unknown';

    if (exportType === 'questionsets') {
      await exportQuestionSets(selectedItems, env, results);
    } else if (exportType === 'prompts') {
      await exportPrompts(selectedItems, env, results);
    }

    console.log(`✅ Export completed. Success: ${results.successful.length}, Failed: ${results.failed.length}`);

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({
        message: `Export completed. ${results.successful.length} items exported successfully.`,
        results: results
      })
    };

  } catch (error) {
    console.error('❌ Export to archive failed:', error);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({
        error: 'Export to archive failed',
        details: error.message
      })
    };
  }
};

async function exportQuestionSets(selectedIds, environment, results) {
  for (const setId of selectedIds) {
    try {
      console.log(`📤 Exporting question set: ${setId}`);
      
      // Get question set metadata
      const setResponse = await db.send(new GetCommand({
        TableName: process.env.TABLE_NAME,
        Key: { PK: 'SETS', SK: `SET#${setId}` }
      }));

      if (!setResponse.Item) {
        console.warn(`⚠️ Question set ${setId} not found`);
        results.failed.push({ id: setId, error: 'Question set not found' });
        continue;
      }

      const questionSet = setResponse.Item;

      // Get all questions for this set
      const questionsResponse = await db.send(new ScanCommand({
        TableName: process.env.TABLE_NAME,
        FilterExpression: 'PK = :pk AND begins_with(SK, :skPrefix)',
        ExpressionAttributeValues: {
          ':pk': `SET#${setId}`,
          ':skPrefix': 'QUESTION#'
        }
      }));

      const questions = questionsResponse.Items || [];
      
      // Transform to archive format
      const archiveData = {
        title: `${questionSet.name} (${environment})`,
        description: `${questionSet.description || 'Question set'} - Exported from ${environment} environment`,
        content: JSON.stringify({
          metadata: {
            id: setId,
            name: questionSet.name,
            description: questionSet.description,
            customInstruction: questionSet.customInstruction,
            aiContextInstruction: questionSet.aiContextInstruction,
            engagementType: questionSet.engagementType || 'call-and-answer',
            promptId: questionSet.promptId,
            active: questionSet.active,
            quickstart: questionSet.quickstart,
            totalQuestions: questionSet.totalQuestions,
            categoryCount: questionSet.categoryCount,
            createdAt: questionSet.createdAt,
            isAIGenerated: questionSet.isAIGenerated,
            sourceEnvironment: environment
          },
          questions: questions
        }, null, 2),
        contentType: 'questionset',
        category: questionSet.engagementType || 'general',
        tags: [
          environment,
          questionSet.engagementType || 'call-and-answer',
          `questions:${questions.length}`,
          ...(questionSet.isAIGenerated ? ['ai-generated'] : [])
        ]
      };

      console.log(`📤 Uploading to archive service: ${ARCHIVE_SERVICE_URL}/archive/items`);
      console.log(`📦 Archive data size: ${JSON.stringify(archiveData).length} bytes`);
      console.log(`📊 Question set: ${questionSet.name}, Questions: ${questions.length}, Type: ${questionSet.engagementType}`);

      // Upload to archive service
      const uploadResponse = await fetch(`${ARCHIVE_SERVICE_URL}/archive/items`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(archiveData)
      });

      console.log(`📡 Archive service response status: ${uploadResponse.status}`);
      console.log(`📡 Archive service response headers:`, Object.fromEntries(uploadResponse.headers.entries()));

      if (!uploadResponse.ok) {
        const errorText = await uploadResponse.text();
        console.error(`❌ Archive service error response:`, errorText);
        console.error(`❌ Request payload summary:`, {
          title: archiveData.title,
          contentType: archiveData.contentType,
          category: archiveData.category,
          contentSize: archiveData.content.length,
          tags: archiveData.tags
        });
        throw new Error(`Archive upload failed: ${uploadResponse.status} - ${errorText}`);
      }

      const uploadResult = await uploadResponse.json();
      console.log(`✅ Successfully exported question set ${setId} to archive as ${uploadResult.archiveId}`);
      
      // Also store locally in main DynamoDB table for list-local-archive
      const timestamp = new Date().toISOString();
      const localArchiveItem = {
        PK: 'ARCHIVE',
        SK: `ITEM#${uploadResult.archiveId}`,
        ArchiveId: uploadResult.archiveId,
        Title: archiveData.title,
        Description: archiveData.description,
        ContentType: archiveData.contentType,
        Category: archiveData.category,
        Tags: archiveData.tags,
        FileName: `${setId}.json`,
        FileSize: JSON.stringify(archiveData).length,
        CreatedAt: timestamp,
        UpdatedAt: timestamp,
        SourceType: 'questionset',
        SourceId: setId,
        ExportedBy: 'system'
      };
      
      await db.send(new PutCommand({
        TableName: process.env.TABLE_NAME,
        Item: localArchiveItem
      }));
      
      console.log(`📝 Also stored locally in main table for list-local-archive: ${uploadResult.archiveId}`);
      
      results.successful.push({
        id: setId,
        name: questionSet.name,
        archiveId: uploadResult.archiveId,
        questionsCount: questions.length
      });

    } catch (error) {
      console.error(`❌ Failed to export question set ${setId}:`, error);
      results.failed.push({
        id: setId,
        error: error.message
      });
    }
  }
}

async function exportPrompts(selectedIds, environment, results) {
  for (const promptId of selectedIds) {
    try {
      console.log(`📤 Exporting AI prompt: ${promptId}`);
      
      // Get AI prompt
      const promptResponse = await db.send(new GetCommand({
        TableName: process.env.TABLE_NAME,
        Key: { PK: 'AIPROMPTS', SK: `AIPROMPT#${promptId}` }
      }));

      if (!promptResponse.Item) {
        console.warn(`⚠️ AI prompt ${promptId} not found`);
        results.failed.push({ id: promptId, error: 'AI prompt not found' });
        continue;
      }

      const prompt = promptResponse.Item;

      // Transform to archive format
      const archiveData = {
        title: `${prompt.name} (${environment})`,
        description: `${prompt.description || 'AI prompt'} - Exported from ${environment} environment`,
        content: JSON.stringify({
          metadata: {
            promptId: promptId,
            name: prompt.name,
            description: prompt.description,
            gameType: prompt.gameType,
            category: prompt.category,
            status: prompt.status,
            isDefault: prompt.isDefault,
            createdAt: prompt.createdAt,
            updatedAt: prompt.updatedAt
          },
          prompt: {
            systemPrompt: prompt.systemPrompt,
            userPrompt: prompt.userPrompt,
            variables: prompt.variables
          }
        }, null, 2),
        contentType: 'prompt',
        category: prompt.gameType || 'general',
        tags: [
          environment,
          prompt.gameType || 'general',
          prompt.category || 'uncategorized',
          prompt.status || 'active',
          ...(prompt.isDefault ? ['default'] : [])
        ]
      };

      // Upload to archive service
      const uploadResponse = await fetch(`${ARCHIVE_SERVICE_URL}/archive/items`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(archiveData)
      });

      if (!uploadResponse.ok) {
        const errorText = await uploadResponse.text();
        throw new Error(`Archive upload failed: ${uploadResponse.status} - ${errorText}`);
      }

      const uploadResult = await uploadResponse.json();
      console.log(`✅ Successfully exported AI prompt ${promptId} to archive as ${uploadResult.archiveId}`);
      
      // Also store locally in main DynamoDB table for list-local-archive
      const timestamp = new Date().toISOString();
      const localArchiveItem = {
        PK: 'ARCHIVE',
        SK: `ITEM#${uploadResult.archiveId}`,
        ArchiveId: uploadResult.archiveId,
        Title: archiveData.title,
        Description: archiveData.description,
        ContentType: archiveData.contentType,
        Category: archiveData.category,
        Tags: archiveData.tags,
        FileName: `${promptId}.json`,
        FileSize: JSON.stringify(archiveData).length,
        CreatedAt: timestamp,
        UpdatedAt: timestamp,
        SourceType: 'prompt',
        SourceId: promptId,
        ExportedBy: 'system'
      };
      
      await db.send(new PutCommand({
        TableName: process.env.TABLE_NAME,
        Item: localArchiveItem
      }));
      
      console.log(`📝 Also stored locally in main table for list-local-archive: ${uploadResult.archiveId}`);
      
      results.successful.push({
        id: promptId,
        name: prompt.name,
        archiveId: uploadResult.archiveId,
        gameType: prompt.gameType
      });

    } catch (error) {
      console.error(`❌ Failed to export AI prompt ${promptId}:`, error);
      results.failed.push({
        id: promptId,
        error: error.message
      });
    }
  }
}