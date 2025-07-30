const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, PutCommand, BatchWriteCommand, GetCommand } = require('@aws-sdk/lib-dynamodb');

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
    const { selectedItems, importType, conflictResolution = 'rename' } = JSON.parse(event.body);
    
    if (!selectedItems || !Array.isArray(selectedItems) || selectedItems.length === 0) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({
          error: 'selectedItems array is required and must not be empty'
        })
      };
    }

    if (!importType || !['questionsets', 'prompts'].includes(importType)) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({
          error: 'importType must be either "questionsets" or "prompts"'
        })
      };
    }

    console.log(`🚀 Starting import of ${selectedItems.length} ${importType} items from archive`);

    const results = {
      successful: [],
      failed: [],
      conflicts: [],
      totalRequested: selectedItems.length
    };

    // Determine current environment
    const environment = process.env.STACK_NAME || process.env.AWS_LAMBDA_FUNCTION_NAME || 'unknown';
    const env = environment.includes('dev') ? 'dev' : 
                environment.includes('test') ? 'test' : 
                environment.includes('prod') ? 'prod' : 'unknown';

    if (importType === 'questionsets') {
      await importQuestionSets(selectedItems, env, conflictResolution, results);
    } else if (importType === 'prompts') {
      await importPrompts(selectedItems, env, conflictResolution, results);
    }

    console.log(`✅ Import completed. Success: ${results.successful.length}, Failed: ${results.failed.length}, Conflicts: ${results.conflicts.length}`);

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({
        message: `Import completed. ${results.successful.length} items imported successfully.`,
        results: results
      })
    };

  } catch (error) {
    console.error('❌ Import from archive failed:', error);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({
        error: 'Import from archive failed',
        details: error.message
      })
    };
  }
};

async function importQuestionSets(selectedArchiveIds, environment, conflictResolution, results) {
  for (const archiveId of selectedArchiveIds) {
    try {
      console.log(`📥 Importing question set from archive: ${archiveId}`);
      
      // Get content from archive service
      const archiveResponse = await fetch(`${ARCHIVE_SERVICE_URL}/archive/items/${archiveId}`);
      
      if (!archiveResponse.ok) {
        throw new Error(`Failed to fetch from archive: ${archiveResponse.status}`);
      }

      const archiveData = await archiveResponse.json();
      
      // Extract the actual item data
      const archiveItem = archiveData.item || archiveData;
      
      // Check if the archive item response already includes a downloadUrl
      let csvContent = '';
      
      if (archiveData.downloadUrl) {
        // Use the signed S3 URL from the archive item response
        console.log(`📥 Downloading content from signed URL: ${archiveData.downloadUrl}`);
        const contentResponse = await fetch(archiveData.downloadUrl);
        
        if (contentResponse.ok) {
          csvContent = await contentResponse.text();
          console.log(`📄 Downloaded CSV content, size: ${csvContent.length} characters`);
        } else {
          throw new Error(`Failed to download from signed URL: ${contentResponse.status} - ${contentResponse.statusText}`);
        }
      } else {
        throw new Error('Archive item response missing downloadUrl');
      }
      
      if (!csvContent || csvContent.trim().length === 0) {
        throw new Error(`Downloaded content is empty for item ${archiveId}`);
      }
      
      console.log(`📄 Downloaded CSV content, size: ${csvContent.length} characters`);
      
      // Parse metadata from archive item (not from CSV)
      const metadata = {
        name: archiveItem.Title.replace(' (dev)', '').replace(' (test)', '').replace(' (prod)', ''),
        description: archiveItem.Description,
        engagementType: extractEngagementType(archiveItem.Tags || []), // Extract from tags
        sourceEnvironment: extractSourceEnvironment(archiveItem.Tags || [])
      };
      
      // Use existing CSV upload logic by creating a synthetic upload request
      const uploadHandler = require('./upload-questions');
      
      // Prepare the upload request data
      const finalName = conflictResolution === 'rename' ? 
        `${metadata.name} (Imported ${new Date().toISOString().split('T')[0]})` : 
        metadata.name;
      
      const uploadRequest = {
        body: JSON.stringify({
          fileName: `${finalName}.csv`,
          fileContent: csvContent,
          customTitle: finalName,
          customDescription: `${metadata.description} (Imported from ${metadata.sourceEnvironment || 'archive'})`,
          customInstructions: '',
          aiContextInstructions: '',
          promptId: '',
          engagementType: metadata.engagementType || 'call-and-answer',
          isAIGenerated: false
        })
      };

      // Call the existing upload handler
      const uploadResult = await uploadHandler.handler(uploadRequest);
      
      if (uploadResult.statusCode !== 200) {
        throw new Error(`Upload failed: ${uploadResult.body}`);
      }

      const uploadData = JSON.parse(uploadResult.body);
      console.log(`✅ Successfully imported question set ${archiveId} as ${uploadData.setId} with ${uploadData.questionsImported} questions`);
      
      // Track conflicts if renamed
      if (conflictResolution === 'rename' && finalName !== metadata.name) {
        results.conflicts.push({
          archiveId,
          originalName: metadata.name,
          resolvedName: finalName,
          action: 'renamed'
        });
      }
      
      results.successful.push({
        archiveId,
        newId: uploadData.setId,
        name: finalName,
        questionsImported: uploadData.questionsImported,
        originalName: metadata.name
      });

    } catch (error) {
      console.error(`❌ Failed to import question set ${archiveId}:`, error);
      results.failed.push({
        archiveId,
        error: error.message
      });
    }
  }
}

async function importPrompts(selectedArchiveIds, environment, conflictResolution, results) {
  for (const archiveId of selectedArchiveIds) {
    try {
      console.log(`📥 Importing AI prompt from archive: ${archiveId}`);
      
      // Get content from archive service
      const archiveResponse = await fetch(`${ARCHIVE_SERVICE_URL}/archive/items/${archiveId}`);
      
      if (!archiveResponse.ok) {
        throw new Error(`Failed to fetch from archive: ${archiveResponse.status}`);
      }

      const archiveData = await archiveResponse.json();
      
      // Extract the actual item data
      const archiveItem = archiveData.item || archiveData;
      
      // Check if the archive item response already includes a downloadUrl
      let contentText = '';
      
      if (archiveData.downloadUrl) {
        // Use the signed S3 URL from the archive item response
        console.log(`📥 Downloading content from signed URL: ${archiveData.downloadUrl}`);
        const contentResponse = await fetch(archiveData.downloadUrl);
        
        if (contentResponse.ok) {
          contentText = await contentResponse.text();
          console.log(`📄 Downloaded prompt content, size: ${contentText.length} characters`);
        } else {
          throw new Error(`Failed to download from signed URL: ${contentResponse.status} - ${contentResponse.statusText}`);
        }
      } else {
        throw new Error('Archive item response missing downloadUrl');
      }
      
      if (!contentText || contentText.trim().length === 0) {
        throw new Error(`Downloaded content is empty for item ${archiveId}`);
      }
      const contentData = JSON.parse(contentText);

      const { metadata, prompt } = contentData;
      
      // Generate new ID to avoid conflicts
      const newPromptId = `imported-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      
      // Check for name conflicts
      let finalName = metadata.name;
      if (conflictResolution === 'rename') {
        finalName = `${metadata.name} (Imported ${new Date().toISOString().split('T')[0]})`;
        results.conflicts.push({
          archiveId,
          originalName: metadata.name,
          resolvedName: finalName,
          action: 'renamed'
        });
      }

      // Create AI prompt record
      const promptRecord = {
        PK: 'AIPROMPTS',
        SK: `AIPROMPT#${newPromptId}`,
        promptId: newPromptId,
        name: finalName,
        description: metadata.description ? `${metadata.description} (Imported from archive)` : 'Imported from archive',
        gameType: metadata.gameType || 'callandanswer',
        category: metadata.category || 'imported',
        status: 'inactive', // Start inactive for review
        isDefault: false, // Never import as default
        systemPrompt: prompt.systemPrompt,
        userPrompt: prompt.userPrompt,
        variables: prompt.variables || [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        importedFrom: {
          archiveId: archiveId,
          originalId: metadata.promptId,
          importedAt: new Date().toISOString(),
          sourceEnvironment: metadata.sourceEnvironment || 'unknown'
        }
      };

      // Save AI prompt
      await db.send(new PutCommand({
        TableName: process.env.TABLE_NAME,
        Item: promptRecord
      }));

      console.log(`✅ Successfully imported AI prompt ${archiveId} as ${newPromptId}`);
      
      results.successful.push({
        archiveId,
        newId: newPromptId,
        name: finalName,
        gameType: metadata.gameType,
        originalName: metadata.name
      });

    } catch (error) {
      console.error(`❌ Failed to import AI prompt ${archiveId}:`, error);
      results.failed.push({
        archiveId,
        error: error.message
      });
    }
  }
}

function extractSourceEnvironment(tags) {
  const envTags = tags.filter(tag => ['dev', 'test', 'prod'].includes(tag.toLowerCase()));
  return envTags.length > 0 ? envTags[0] : 'unknown';
}

function extractEngagementType(tags) {
  // Look for engagement type in tags (e.g., 'call-and-answer', 'trivia', 'poll', 'wavelength')
  const engagementTypes = ['call-and-answer', 'trivia', 'poll', 'wavelength', 'survey'];
  const typeTags = tags.filter(tag => engagementTypes.includes(tag.toLowerCase()));
  return typeTags.length > 0 ? typeTags[0] : 'call-and-answer'; // Default to call-and-answer
}

function countCategories(questions) {
  const categories = new Set();
  questions.forEach(q => {
    if (q.Category) {
      categories.add(q.Category);
    }
  });
  return categories.size;
}