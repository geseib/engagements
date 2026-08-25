const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, ScanCommand, QueryCommand, GetCommand, PutCommand } = require('@aws-sdk/lib-dynamodb');
const { S3Client, GetObjectCommand } = require('@aws-sdk/client-s3');
const { resolvePartitionFromMeta } = require('./shared/set-version');
const { inferPromptType } = require('./shared/prompt-shape');
const { promptLinkTag } = require('./shared/archive-prompt-link');

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

/*
  NAME THE EM DASH, BECAUSE THE ARCHIVE SERVICE CANNOT.

  On 2026-08-15 the four TRIVIA prompts for the demo quiz sets each failed this
  export with a flat 500 "Failed to upload archive item" while the four
  call-and-answer prompts in the same batch succeeded. The trivia prompts are
  named "Workie — <thing>" (U+2014 EM DASH); the others "Workie - <thing>"
  (ASCII hyphen). The archive service puts the title in S3 user metadata, which
  is an HTTP header, and Node throws ERR_INVALID_CHAR on any character outside
  /[\t\x20-\x7e\x80-\xff]/ — which an em dash is — before the request leaves the
  process. See the long note in lambda-functions/archive/upload-archive.js,
  where it is actually fixed.

  This exporter cannot fix that: the archive service is a separately deployed,
  SHARED stack (scripts/deploy-archive.sh, engage2-archive-service) that all
  three tiers talk to, so a patched exporter can still meet an unpatched
  archive. What it can do is stop the diagnosis costing another afternoon —
  when an upload fails and the title carries a character known to break that
  path, say so, with the character and its code point.

  Deliberately NOT a pre-flight rejection and NOT a sanitiser. Refusing the
  export would block a legitimate title, and rewriting the title would silently
  alter what the user wrote. This only annotates a failure that already happened.
*/
function describeTitleHazard(title) {
  // Node's own rule, from lib/_http_common.js checkInvalidHeaderChar. Matching
  // it exactly rather than testing for "> U+00FF" so that a stray newline or
  // control character — which breaks the request in precisely the same way and
  // is far harder to see in a title — is named too.
  const offenders = [...String(title || '')]
    .filter(ch => /[^\t\x20-\x7e\x80-\xff]/.test(ch))
    .map(ch => `${JSON.stringify(ch)} (U+${ch.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')})`);
  if (offenders.length === 0) return '';
  const unique = [...new Set(offenders)];
  return ` — NOTE: the title contains ${unique.join(', ')}, which Node refuses to put in an HTTP header. `
    + `The archive service copies the title into S3 user metadata, and user metadata is sent as the `
    + `x-amz-meta-* request headers, so this throws ERR_INVALID_CHAR inside the SDK and surfaces as `
    + `exactly this 500. If that is the cause, the fix is in lambda-functions/archive/upload-archive.js `
    + `and the archive service needs redeploying (scripts/deploy-archive.sh) — the title itself is fine.`;
}

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

      // Export the ACTIVE version's questions, falling back to the legacy
      // partition for a set that has never been versioned. Exporting the bare
      // `SET#<id>` partition after a replace would archive the superseded copy.
      const resolvedSet = resolvePartitionFromMeta(setId, questionSet, null);

      /*
        QUERY, PAGINATED — AND IT WAS A SCAN, WHICH SILENTLY EXPORTED NOTHING.

        Reported: "its wasnt in archive when you did it, and when i retryed
        archive, it says export completed, 0 items exported."

        This was a ScanCommand with `FilterExpression: 'PK = :pk AND
        begins_with(SK, :skPrefix)'` and no pagination. A Scan reads ONE 1 MB
        page of the whole table and applies the filter AFTER reading, so a set
        whose QUESTION# rows fall outside that first page comes back with zero
        items. `convertQuestionsToCSV` then returns '' (see :364-366), and the
        archive service refuses the upload with

            400 "Title, content, and contentType are required"

        — an error that names three fields and points at none of the cause.

        The failure is by TABLE POSITION, which is the worst shape a bug can
        have: it is perfectly reproducible for one set, looks like corrupt data
        for that set specifically, and moves to a different set the moment the
        table grows. On 2026-08-15 it took out exactly one of eight demo sets
        (`readyornot`) while a direct Query on the same partition returned all
        twelve of its questions.

        A Query on the partition key reads only that partition and needs no
        filter at all. The pagination loop is not optional either: one Query
        page is also capped at 1 MB, so a large set would truncate silently —
        the same class of bug one size down.
      */
      const questions = [];
      let lastKey;
      do {
        const page = await db.send(new QueryCommand({
          TableName: process.env.TABLE_NAME,
          KeyConditionExpression: 'PK = :pk AND begins_with(SK, :skPrefix)',
          ExpressionAttributeValues: {
            ':pk': resolvedSet.pk,
            ':skPrefix': 'QUESTION#'
          },
          ExclusiveStartKey: lastKey
        }));
        questions.push(...(page.Items || []));
        lastKey = page.LastEvaluatedKey;
      } while (lastKey);

      /*
        AN EMPTY SET IS NOW A NAMED FAILURE, NOT A 400 FROM THREE HOPS AWAY.
        The archive's own message cannot say which field was empty or why, and
        that is what made this look like bad data rather than a bad read.
      */
      if (questions.length === 0) {
        console.warn(`⚠️ ${setId}: query returned no questions; refusing to archive an empty set`);
        results.failed.push({
          id: setId,
          error: `No questions found in partition ${resolvedSet.pk}. The set metadata says `
            + `${questionSet.questionCount ?? 'an unknown number of'} questions, so this is a read `
            + `problem, not an empty set.`
        });
        continue;
      }
      
      // Convert questions to CSV format for import compatibility
      const csvContent = convertQuestionsToCSV(questions, questionSet.engagementType);

      /*
        CARRY THE PROMPT LINK, BY NAME.

        The set row's `promptId` names the Workie that reads its rounds back to
        the room, and it means nothing in another tier — ids are minted per
        environment. Nothing about the prompt was in the archive item at all, so
        every imported set arrived unlinked and fell back to the game-type
        default. See shared/archive-prompt-link.js for why a name and not an id.

        A missing prompt row is NOT a failure. The set is still worth archiving;
        it just travels without a link, which is what it did before this existed.
      */
      let promptTag = null;
      if (questionSet.promptId) {
        try {
          const linked = await db.send(new GetCommand({
            TableName: process.env.TABLE_NAME,
            Key: { PK: 'AIPROMPTS', SK: `AIPROMPT#${questionSet.promptId}` }
          }));
          if (linked.Item && linked.Item.name) {
            promptTag = promptLinkTag(linked.Item.name);
            console.log(`🔗 ${setId} carries prompt link "${linked.Item.name}"`);
          } else {
            console.warn(`⚠️ ${setId}: promptId ${questionSet.promptId} names no prompt row; exporting unlinked`);
          }
        } catch (linkError) {
          console.warn(`⚠️ ${setId}: could not read linked prompt: ${linkError.message}; exporting unlinked`);
        }
      }

      // Transform to archive format
      const archiveData = {
        title: `${questionSet.name} (${environment})`,
        description: `${questionSet.description || 'Question set'} - Exported from ${environment} environment`,
        content: csvContent,
        contentType: 'questionset',
        category: questionSet.engagementType || 'general',
        tags: [
          environment,
          questionSet.engagementType || 'call-and-answer',
          `questions:${questions.length}`,
          ...(questionSet.isAIGenerated ? ['ai-generated'] : []),
          ...(promptTag ? [promptTag] : [])
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
        throw new Error(
          `Archive upload failed for "${questionSet.name}" (${setId}): `
          + `${uploadResponse.status} ${errorText}`
          + describeTitleHazard(archiveData.title)
        );
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
        FileName: `${setId}.csv`,
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

      /*
        AN UNREADABLE BODY IS NOW A NAMED FAILURE, NOT A SUCCESSFUL EMPTY SHELL.

        A prompt is a TWO-STORE record: the pointer row read above, and the body
        itself in AI_PROMPTS_BUCKET at `s3Key`. This block used to swallow every
        S3 error into `promptContent = {}` and carry on, so a prompt whose body
        was missing, unreadable or not JSON was archived with instructions,
        outputFormat, template and scenario all '' — uploaded with a 200 and
        reported to the caller as a success.

        That is the same defect as the empty-CSV bug fixed in 338af103, one
        record type over: a read that failed, handed onward as valid empty
        content for something downstream to misdiagnose. It is worse here,
        because it does not even fail — the archive quietly fills with hollow
        prompts and looks like a backup it is not. `install-ai-prompt.js` already
        treats a pointer without a body as a hard error for exactly this reason.

        Refusing on the READ, not on the fields: which fields a body carries
        depends on its format (a generation prompt has `basePrompt`, a legacy one
        `template`, a structured one `instructions`), so field-presence checks
        would reject valid prompts. What is never valid is having no body at all.
      */
      let promptContent;
      /*
        THE MISCONFIGURATION THAT MADE EVERY ARCHIVED PROMPT EMPTY, NAMED.

        This function had no AI_PROMPTS_BUCKET and no S3 read policy at all
        (template-clean.yaml, both added alongside this check), so the body
        fetch below failed on every prompt and the old catch turned that into
        `promptContent = {}` and a 200. Nine prompts reached the shared archive
        with instructions, outputFormat, template and scenario all '' — a
        backup of nothing, reported as nine successes.

        Checked SEPARATELY from the fetch, and before it, because the two
        failures need different sentences: an unreadable body is a broken
        record and the operator can go look at it, whereas an unset bucket is a
        deployment fault that would otherwise be reported once per prompt as if
        each prompt were individually at fault.
      */
      if (!process.env.AI_PROMPTS_BUCKET) {
        console.error('❌ AI_PROMPTS_BUCKET is not set on this function; prompt bodies cannot be read');
        results.failed.push({
          id: promptId,
          name: prompt.name,
          step: 'config',
          error: 'AI_PROMPTS_BUCKET is not set on the export function, so no prompt body can be read. '
            + 'This is a deployment fault, not a problem with this prompt: every prompt in this run will '
            + 'fail the same way. Redeploy with AI_PROMPTS_BUCKET and an S3 read policy on the AI prompts '
            + 'bucket (template-clean.yaml, AdminExportToArchiveFunction).'
        });
        continue;
      }
      if (!prompt.s3Key) {
        console.warn(`⚠️ ${promptId}: pointer row carries no s3Key; refusing to archive a bodyless prompt`);
        results.failed.push({
          id: promptId,
          name: prompt.name,
          step: 's3-read-body',
          error: `Prompt ${promptId} ("${prompt.name}") has no s3Key on its DynamoDB row, so its body `
            + `cannot be read. Archiving it would store an empty prompt and report success. This is a `
            + `broken record, not an empty prompt.`
        });
        continue;
      }
      try {
        console.log(`📥 Fetching prompt content from S3: ${prompt.s3Key}`);
        const s3Response = await s3Client.send(new GetObjectCommand({
          Bucket: process.env.AI_PROMPTS_BUCKET,
          Key: prompt.s3Key
        }));

        const s3Content = await s3Response.Body.transformToString();
        promptContent = JSON.parse(s3Content);
        if (!promptContent || typeof promptContent !== 'object' || Object.keys(promptContent).length === 0) {
          throw new Error(`body parsed to ${JSON.stringify(promptContent)} — no fields`);
        }
        console.log(`✅ Successfully fetched S3 content for prompt ${promptId} (${s3Content.length} chars)`);
      } catch (s3Error) {
        console.warn(`⚠️ ${promptId}: could not read body at ${prompt.s3Key}:`, s3Error.message);
        results.failed.push({
          id: promptId,
          name: prompt.name,
          step: 's3-read-body',
          error: `Could not read the prompt body at s3://${process.env.AI_PROMPTS_BUCKET}/${prompt.s3Key} `
            + `(${s3Error.name}: ${s3Error.message}). The DynamoDB pointer exists but its body does not, `
            + `so this is a read problem, not an empty prompt — archiving it would have stored a hollow `
            + `record and called it a success.`
        });
        continue;
      }

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
            // The SHAPE, carried explicitly. `inferPromptType` reads it back
            // from the body, but a reader of the archive file should not have
            // to re-derive which of two incompatible kinds of prompt this is.
            promptType: prompt.promptType || inferPromptType(promptContent),
            version: prompt.version,
            createdAt: prompt.createdAt,
            updatedAt: prompt.updatedAt
          },
          /*
            THE WHOLE BODY, VERBATIM — NOT FIVE HAND-PICKED FIELDS.

            This used to copy exactly instructions, outputFormat, template and
            scenario. Those are the ANALYSIS shape. A GENERATION prompt (the 22
            `gen-*` rows, written by AIGenerationPromptEditor) keeps its text in
            basePrompt, contextTemplate, audienceTemplate, categoryTemplate and
            outputSections — none of which were in that list. So a generation
            prompt archived as four empty strings and reported success, which is
            the same data-loss shape as the dropped CSV columns fixed twice
            before in this area.

            An allow-list is the wrong tool here. The two shapes are documented
            in shared/prompt-shape.js and a third is possible; every time a
            field is added to create-ai-prompt.js this list would silently start
            losing it again, with no test able to notice because the export
            would still be a success. Copying the body wholesale cannot go stale.

            The three legacy aliases stay, AFTER the spread so they can never
            shadow a real field. Archives written before this change carry only
            systemPrompt/userPrompt, and an importer that has not been updated
            still reads them.
          */
          prompt: {
            ...promptContent,
            systemPrompt: promptContent.systemPrompt || promptContent.instructions || '',
            userPrompt: promptContent.userPrompt || promptContent.outputFormat || '',
            variables: promptContent.variables || {}
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

      console.log(`📤 Uploading prompt ${promptId} to ${ARCHIVE_SERVICE_URL}/archive/items`);
      console.log(`📦 Archive data size: ${JSON.stringify(archiveData).length} bytes, content: ${archiveData.content.length} chars`);

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
        console.error(`❌ Archive service rejected prompt ${promptId}:`, uploadResponse.status, errorText);
        console.error(`❌ Request payload summary:`, {
          title: archiveData.title,
          contentType: archiveData.contentType,
          category: archiveData.category,
          contentSize: archiveData.content.length,
          tags: archiveData.tags
        });
        throw new Error(
          `Archive upload failed for "${prompt.name}" (${promptId}): `
          + `${uploadResponse.status} ${errorText}`
          + describeTitleHazard(archiveData.title)
        );
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

function convertQuestionsToCSV(questions, engagementType) {
  if (!questions || questions.length === 0) {
    return '';
  }

  // Determine CSV format based on engagement type
  if (engagementType === 'trivia') {
    // Trivia format: Category,Title,Detail,OptionA,OptionB,OptionC,OptionD,CorrectAnswer,AnswerDetails,Difficulty
    const headers = ['Category', 'Title', 'Detail', 'OptionA', 'OptionB', 'OptionC', 'OptionD', 'CorrectAnswer', 'AnswerDetails', 'Difficulty'];
    const rows = questions.map(q => [
      q.Category || '',
      q.Title || q.Prompt || '',
      q.Detail || '',
      q.optionA || '',
      q.optionB || '',
      q.optionC || '',
      q.optionD || '',
      q.correctAnswer || '',
      q.AnswerDetails || '',
      q.difficulty || 'medium'
    ]);
    
    return [headers, ...rows]
      .map(row => row.map(cell => `"${(cell || '').toString().replace(/"/g, '""')}"`).join(','))
      .join('\n');
  } else {
    // Call-and-answer format: Category,Title,Detail,CustomInstructions[,AnswerDetails][,Image]
    //
    // Art-title sets are call-and-answer sets that carry two extra fields: Image
    // (the artwork key/URL) and AnswerDetails (the real title + a point of
    // trivia, revealed only at RESULTS). The fixed four columns below used to
    // silently drop both on every archive export, so an archived art set lost
    // its artwork and its reveal on import — including a re-import into the
    // SAME environment it was archived from; it just always gets noticed as a
    // cross-environment failure because that's when someone re-imports.
    // Emit them only when the set actually has them, so an ordinary set keeps
    // its familiar four-column shape. This mirrors the identical fix already
    // applied to the sibling CSV export in download-question-set.js.
    const hasAnswerDetails = questions.some(q => (q.AnswerDetails || '').trim());
    const hasImages = questions.some(q => (q.Image || '').trim());

    const headers = ['Category', 'Title', 'Detail', 'CustomInstructions']
      .concat(hasAnswerDetails ? ['AnswerDetails'] : [])
      .concat(hasImages ? ['Image'] : []);

    const rows = questions.map(q => [
      q.Category || '',
      q.Title || q.Prompt || '',
      q.Detail || '',
      q.CustomInstructions || ''
    ]
      .concat(hasAnswerDetails ? [q.AnswerDetails || ''] : [])
      .concat(hasImages ? [q.Image || ''] : []));

    return [headers, ...rows]
      .map(row => row.map(cell => `"${(cell || '').toString().replace(/"/g, '""')}"`).join(','))
      .join('\n');
  }
}