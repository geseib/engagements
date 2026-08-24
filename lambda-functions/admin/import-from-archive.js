const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, PutCommand, BatchWriteCommand, GetCommand, QueryCommand } = require('@aws-sdk/lib-dynamodb');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const { normalizeGameType, DEFAULT_GAME_TYPE } = require('./shared/game-types');
const { inferPromptType } = require('./shared/prompt-shape');
const { promptNameFromTags, resolveLocalPromptId } = require('./shared/archive-prompt-link');

const db = DynamoDBDocumentClient.from(new DynamoDBClient());
const s3Client = new S3Client({});

// Archive service configuration
const ARCHIVE_SERVICE_URL = process.env.ARCHIVE_SERVICE_URL || 'https://archive.seibtribe.us';

exports.handler = async (event) => {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Engage-Org'
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
          console.log(`📄 Content preview (first 500 chars): ${csvContent.substring(0, 500)}`);
          console.log(`📄 Content type from response: ${contentResponse.headers.get('content-type')}`);
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
      
      /*
        RE-LINK THE SET TO ITS PROMPT, BY NAME.

        This passed a hardcoded `promptId: ''`, and the exporter carried nothing
        about the prompt anyway — so every set imported into another tier
        arrived unlinked and silently fell back to the game-type default. On
        2026-08-15 that was all thirteen sets in prod, including the eight demo
        sets, each of which has a Workie written specifically for it.

        Matched on NAME because ids are minted per tier and dev's means nothing
        here. See shared/archive-prompt-link.js for how that degrades: no match
        imports unlinked exactly as before, two matches take the first and say
        so, and neither writes a WRONG link — a set pointed at somebody else's
        prompt would say the wrong things to a real room.

        IMPORT PROMPTS BEFORE SETS. The resolution happens now, against what is
        in the table now; a set imported first stays unlinked even if its prompt
        arrives a minute later. The note below is logged so that ordering is
        discoverable from a run rather than only from this comment.
      */
      const wantedPromptName = promptNameFromTags(archiveItem.Tags);
      let linkedPromptId = '';
      if (wantedPromptName) {
        const local = await db.send(new QueryCommand({
          TableName: process.env.TABLE_NAME,
          KeyConditionExpression: 'PK = :pk',
          ExpressionAttributeValues: { ':pk': 'AIPROMPTS' },
        }));
        const { promptId, matched } = resolveLocalPromptId(wantedPromptName, local.Items || []);
        linkedPromptId = promptId;
        if (matched === 0) {
          console.warn(
            `⚠️ ${archiveId}: no local prompt named "${wantedPromptName}" — importing unlinked. `
            + `Import the prompts first, then re-import this set (or attach it by hand).`
          );
        } else if (matched > 1) {
          console.warn(`⚠️ ${archiveId}: ${matched} local prompts named "${wantedPromptName}"; linked the first (${promptId}).`);
        } else {
          console.log(`🔗 ${archiveId}: linked to local prompt ${promptId} ("${wantedPromptName}")`);
        }
      }

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
          promptId: linkedPromptId,
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
          console.log(`📄 Content preview (first 500 chars): ${contentText.substring(0, 500)}`);
          console.log(`📄 Content type from response: ${contentResponse.headers.get('content-type')}`);
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

      /*
        A PROMPT IS A TWO-STORE RECORD, AND THIS ONLY EVER WROTE ONE OF THEM.

        create-ai-prompt.js writes the body to AI_PROMPTS_BUCKET at
        `prompts/{gameType}/{promptId}/v{n}.json` and points the DynamoDB row's
        `s3Key` at it. Every reader follows that pointer — export-to-archive.js
        does, and get-ai-summary.js resolves a template through it.

        This function wrote no S3 object and no `s3Key`. It put the text inline
        as `systemPrompt`/`userPrompt`, two attributes nothing in the product
        reads. So an imported prompt was bodyless to every consumer: it appeared
        in the library, could be attached to a question set, and produced
        nothing — falling back to the game-type default with no error anywhere.

        Four smaller faults in the same object, each independently enough to
        make the row wrong:

          status: 'inactive'   Not in the vocabulary. It is active | draft |
                               archived (update-ai-prompt.js whitelists exactly
                               those; get-ai-prompts.js and the library filter
                               compare exact strings). 'inactive' matches no
                               filter, so an imported prompt was invisible in
                               the console that was supposed to review it.
                               `draft` is the state this was reaching for.

          'callandanswer'      An ALIAS, not a canonical id. shared/game-types.js
                               canonicalises it to 'call-and-answer'; the
                               per-set picker compares exact strings. Routed
                               through normalizeGameType now.

          variables: []        The export writes an object. Defaulting to an
                               array put two types in one attribute.

          no promptType        So the console could not tell an analysis prompt
                               from a generation one, which is the distinction
                               shared/prompt-shape.js exists to keep.
      */
      const timestamp = new Date().toISOString();
      const gameType = normalizeGameType(metadata.gameType) || DEFAULT_GAME_TYPE;
      const promptType = metadata.promptType || inferPromptType(prompt);

      // Everything the archive carried, minus the three legacy aliases the
      // exporter adds for old importers — they are duplicates of instructions
      // and outputFormat, and writing them back would put two copies of the
      // same text in the body.
      const { systemPrompt, userPrompt, ...bodyFields } = prompt;
      const promptBody = {
        ...bodyFields,
        id: newPromptId,
        version: 1,
        name: finalName,
        gameType,
        promptType,
        isDefault: false,
        status: 'draft',
        createdAt: timestamp,
        updatedAt: timestamp,
        // Preserved rather than dropped: an archive whose body predates the
        // structured fields carries its text ONLY in these two.
        ...(bodyFields.instructions === undefined && systemPrompt ? { instructions: systemPrompt } : {}),
        ...(bodyFields.outputFormat === undefined && userPrompt ? { outputFormat: userPrompt } : {}),
      };

      if (!process.env.AI_PROMPTS_BUCKET) {
        throw new Error(
          'AI_PROMPTS_BUCKET is not set on the import function, so the prompt body cannot be stored. '
          + 'This is a deployment fault, not a problem with this archive item. Redeploy with '
          + 'AI_PROMPTS_BUCKET and an S3 write policy (template-clean.yaml, AdminImportFromArchiveFunction).'
        );
      }

      const s3Key = `prompts/${gameType}/${newPromptId}/v1.json`;
      console.log(`💾 Writing imported prompt body to s3://${process.env.AI_PROMPTS_BUCKET}/${s3Key}`);
      await s3Client.send(new PutObjectCommand({
        Bucket: process.env.AI_PROMPTS_BUCKET,
        Key: s3Key,
        Body: JSON.stringify(promptBody, null, 2),
        ContentType: 'application/json',
        Metadata: {
          promptId: newPromptId,
          gameType,
          version: '1',
          status: 'draft'
        }
      }));

      // Create AI prompt record
      const promptRecord = {
        PK: 'AIPROMPTS',
        SK: `AIPROMPT#${newPromptId}`,
        promptId: newPromptId,
        name: finalName,
        description: metadata.description ? `${metadata.description} (Imported from archive)` : 'Imported from archive',
        gameType,
        promptType,
        category: metadata.category || 'imported',
        // Draft, not 'inactive': see the note above. Deliberately not `active` —
        // an import is somebody else's text arriving in this environment and it
        // should be read before a room hears it.
        status: 'draft',
        isDefault: false, // Never import as default
        // The SHAPE FIELDS ON THE ROW, mirroring create-ai-prompt.js. The
        // console's list reads promptType and the usability chip off the row
        // without fetching the body, so a row missing these reads as broken.
        ...(promptBody.scenario && { scenario: promptBody.scenario }),
        ...(promptBody.scenarioType && { scenarioType: promptBody.scenarioType }),
        ...(promptBody.basePrompt && { basePrompt: promptBody.basePrompt }),
        ...(promptBody.contextTemplate && { contextTemplate: promptBody.contextTemplate }),
        ...(promptBody.audienceTemplate && { audienceTemplate: promptBody.audienceTemplate }),
        ...(promptBody.categoryTemplate && { categoryTemplate: promptBody.categoryTemplate }),
        ...(promptBody.outputFormat && { outputFormat: promptBody.outputFormat }),
        ...(promptBody.outputSections && { outputSections: promptBody.outputSections }),
        ...(promptBody.defaultSettings && { defaultSettings: promptBody.defaultSettings }),
        questionSetIds: [],
        tags: Array.isArray(promptBody.tags) ? promptBody.tags : [],
        s3Key,
        version: 1,
        createdAt: timestamp,
        updatedAt: timestamp,
        // NO `ttl`. Same reason create-ai-prompt.js records: the table expires
        // on `ttl`, and prompts are configuration rather than session data.
        importedFrom: {
          archiveId: archiveId,
          originalId: metadata.promptId,
          importedAt: timestamp,
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