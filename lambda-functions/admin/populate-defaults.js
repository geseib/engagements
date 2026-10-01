/**
 * Seed the built-in AI summary ("analysis") prompts.
 *
 * SINGLE SOURCE OF TRUTH: ./default-ai-prompts.json.
 *
 * There used to be two drifted copies of these defaults (D18) — a large inline
 * literal in this file and the JSON — plus a second, unrouted handler
 * (populate-default-prompts.js) that read the JSON and wrote the legacy
 * `AI_PROMPT#/METADATA` key nothing else reads. The JSON was the richer of the
 * two (it had the wavelength prompts this file lacked entirely), so it won;
 * the inline literal and the dead handler are gone.
 *
 * ============================================================================
 * `name` IS THE IDENTITY OF A DEFAULT PROMPT. DO NOT RENAME ONE CASUALLY.
 * ============================================================================
 * A promptId is minted here (`generatePromptId`) and is not derived from
 * anything in the JSON, so it cannot be recovered from the file. The ONLY
 * anchor tying a JSON entry to the row it seeded last time is the exact
 * `name` string, matched at :~120 below. Consequences, both of which are
 * silent:
 *
 *   - Change a `name` and the overwrite path stops finding the existing row.
 *     A NEW promptId is minted, a SECOND row appears for the same prompt, and
 *     every question set carrying the old promptId keeps pointing at the old
 *     row — which now holds the text nobody meant to keep.
 *   - Keep a `name` and `--overwrite` rewrites the same promptId in place, so
 *     every set that references it picks up the new text with no re-attach.
 *
 * So: rewriting a prompt's TEXT is free. Renaming it orphans every set that
 * points at it. The 2026-08-15 rewrite of all nineteen prompts deliberately
 * preserved all nineteen names for exactly this reason.
 *
 * ============================================================================
 * THE TWO HALVES, AND WHY THIS FILE USED TO DEFEAT THEM
 * ============================================================================
 * The editor and the JSON are both built around two named halves —
 * `instructions` ("what the AI is given") and `outputFormat` ("what the AI
 * writes"). This file used to flatten them back out:
 *
 *     template:     promptData.template,
 *     instructions: promptData.template,   // "use template as instructions"
 *     outputFormat: "Provide your analysis in the specified format …",
 *
 * get-ai-summary.js:2168 takes `template` and NEVER READS the other two when
 * it is present, and promptPreflight's `promptSources` mirrors that rule. So a
 * record written that way has an outputFormat that is decorative: the engine
 * discards it, the preflight declines to report on it, and the boilerplate
 * sentence above was the only format contract nineteen prompts ever carried.
 *
 * The JSON now ships the halves and this writer passes them through untouched.
 * `template` is written ONLY when a hand-edited entry still has one, and then
 * the halves are left off entirely rather than faked, so the record says which
 * shape it actually is.
 */
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, PutCommand, QueryCommand } = require('@aws-sdk/lib-dynamodb');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const { normalizeGameType } = require('./shared/game-types');
const { normalizeOutputSections } = require('./shared/prompt-shape');
const tenant = require('./shared/tenant');
const { promptRefusalMessage, isInternalCall } = require('./shared/prompt-access');
const { callerUserId } = require('./shared/question-set-access');
const defaultPrompts = require('./default-ai-prompts.json');

// Generate unique ID for prompts (same as other admin functions)
const generatePromptId = () => {
  return Date.now().toString(36) + Math.random().toString(36).substr(2);
};

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
  /*
    THIS USED TO PRINT THE WHOLE EVENT — every header, the bearer JWT in
    Authorization among them — and then the body twice more, raw and parsed.
    The one thing the body says that matters, the overwrite flag, is logged
    below on its own. Trace the request, not quote it
    (tests/lambda-event-not-logged.js).
  */
  console.log('🚀 Populate Default AI Prompts', JSON.stringify({
    method: event.requestContext?.http?.method,
    path: event.requestContext?.http?.path,
    sub: callerUserId(event) || null,
  }));

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

    /*
      ENGAGE MODE ONLY — docs/superpowers/specs/2026-09-24-prompt-admin-engage-mode-design.md.
      The authorizer checks the group, not the mode, so this handler checks
      the mode itself. This writes Engage's own library — with overwrite, over every default — and it had no check at all: any admin, acting for any team, could run it. Engage mode, never team authoring.
    */
    if (!isInternalCall(event) && !tenant.canManageScope(event, tenant.PLATFORM, '')) {
      return {
        statusCode: 403,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Headers': 'Content-Type',
          'Access-Control-Allow-Methods': 'POST, OPTIONS'
        },
        body: JSON.stringify({ error: promptRefusalMessage(event, null) })
      };
    }

    console.log('🔄 Starting default AI prompts population...');
    
    // Check for overwrite parameter
    const body = event.body ? JSON.parse(event.body) : {};
    const overwrite = body.overwrite || false;
    console.log(`🔄 Overwrite mode: ${overwrite}`);
    
    const results = {
      created: 0,
      skipped: 0,
      overwritten: 0,
      errors: 0,
      // A shipped default that was written as NOT default because the tier
      // already has its own (see ONE DEFAULT PER GAME TYPE, below).
      defaultsKept: [],
      prompts: []
    };

    // Check existing prompts to avoid duplicates.
    //
    // This used to Scan `begins_with(PK, 'AI_PROMPT#')` — the LEGACY key — while
    // writing to `PK='AIPROMPTS'`. It therefore never found anything it had
    // previously written, "skip existing" never fired, and every run minted a
    // fresh promptId for the same prompt. That is how seven call-and-answer
    // prompts all ended up flagged isDefault (D17). Query the key we actually
    // write.
    //
    // Every page, too: a prompt past the first 1 MB would read as missing and
    // be minted again. tests/library-reads-paged.js.
    console.log('📋 Checking existing prompts...');
    const existingPrompts = { Items: [] };
    let ExclusiveStartKey;
    do {
      const page = await dynamodb.send(new QueryCommand({
        TableName: tableName,
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
        ExpressionAttributeValues: {
          ':pk': 'AIPROMPTS',
          ':sk': 'AIPROMPT#'
        },
        ExclusiveStartKey,
      }));
      existingPrompts.Items.push(...(page.Items || []));
      ExclusiveStartKey = page.LastEvaluatedKey;
    } while (ExclusiveStartKey);

    console.log(`📊 Found ${existingPrompts.Items?.length || 0} existing prompts`);

    // Process each game type and category
    /*
      ONE DEFAULT PER GAME TYPE — and the tier's own default wins.

      The JSON marks one prompt per game type isDefault. A tier whose prompts
      have been curated since (engagedev's "Call & Answer — Advisor Read",
      "Trivia - Round Call", …) already has a default under a DIFFERENT name,
      so seeding used to add a second one per type. get-ai-summary.js then
      resolved the tie by category and oldest createdAt — the curated prompt
      usually won, but the library showed two defaults and the outcome rested
      on a tie-break nobody chose (2026-10-01, after the button was pressed on
      engagetest).

      So the incumbent is found first, and a shipped default is written as
      NOT default when the tier already has an active default of that type
      under another name. A row that IS the incumbent stays default when it is
      overwritten, whatever the JSON says, so a reseed can never leave a type
      with none. A type with no default at all still gets the JSON's.
    */
    const isDefaultRow = (item) => item && (item.isDefault === true || item.isDefault === 'true')
      && item.status !== 'archived' && item.promptType !== 'generation';
    // When a tier ALREADY has two (engagetest after the 2026-10-01 press), the
    // incumbent is the one get-ai-summary.js would pick on a tie — oldest
    // createdAt, then promptId — so pressing the button again demotes the
    // duplicates instead of keeping whichever row DynamoDB returned first.
    const age = (item) => [String(item.createdAt || '9999'), String(item.promptId || '')];
    const older = (a, b) => {
      const [ca, ia] = age(a);
      const [cb, ib] = age(b);
      return ca < cb || (ca === cb && ia < ib);
    };
    const incumbentByType = {};
    for (const item of existingPrompts.Items || []) {
      if (!isDefaultRow(item)) continue;
      const type = normalizeGameType(item.gameType);
      if (!type) continue;
      if (!incumbentByType[type] || older(item, incumbentByType[type])) incumbentByType[type] = item;
    }

    for (const [rawGameType, categories] of Object.entries(defaultPrompts)) {
      // The JSON already uses canonical ids; normalize anyway so a hand-edit
      // that reintroduces `polls` cannot re-split the vocabulary.
      const gameType = normalizeGameType(rawGameType);
      console.log(`🎮 Processing ${gameType} prompts...`);

      for (const [categoryKey, promptData] of Object.entries(categories)) {
        try {
          // Check if prompt already exists
          const existingPrompt = existingPrompts.Items?.find(item => item.name === promptData.name);
          const promptExists = !!existingPrompt;
          
          console.log(`📋 Processing prompt: ${promptData.name}`);
          console.log(`📋 Prompt exists: ${promptExists}`);
          console.log(`📋 Overwrite flag: ${overwrite}`);
          console.log(`📋 Existing prompt:`, existingPrompt ? { id: existingPrompt.promptId, name: existingPrompt.name } : null);
          
          if (promptExists && !overwrite) {
            console.log(`⏭️ Skipping existing prompt: ${promptData.name}`);
            results.skipped++;
            continue;
          }
          
          if (promptExists && overwrite) {
            console.log(`🔄 Overwriting existing prompt: ${promptData.name} with ID: ${existingPrompt.promptId}`);
          } else if (!promptExists) {
            console.log(`✨ Creating new prompt: ${promptData.name}`);
          }

          // Use existing promptId when overwriting, generate new one when creating
          const promptId = promptExists && overwrite ? existingPrompt.promptId : generatePromptId();
          const timestamp = new Date().toISOString();
          // Overwriting keeps the row's birth date: get-ai-summary.js breaks a
          // tie between defaults by oldest createdAt, and a reseed must not
          // move a prompt to the back of that queue.
          const createdAt = (promptExists && overwrite && existingPrompt.createdAt) || timestamp;
          // ONE DEFAULT PER GAME TYPE (above).
          const incumbent = incumbentByType[gameType];
          const isIncumbent = Boolean(incumbent) && incumbent.name === promptData.name;
          const isDefault = isIncumbent || (promptData.isDefault === true && !incumbent);
          if (promptData.isDefault === true && !isDefault) {
            results.defaultsKept.push({ gameType, kept: incumbent.name, notDefault: promptData.name });
            console.log(`🛡️ ${gameType}: keeping "${incumbent.name}" as the default; "${promptData.name}" is seeded as not default`);
          }

          // Validate the declared shape at seed time so a typo in the JSON is
          // caught here rather than silently ignored at runtime.
          const outputSections = normalizeOutputSections(promptData.outputSections);
          if (promptData.outputSections && !outputSections) {
            console.warn(`⚠️ ${promptData.name}: outputSections is malformed — seeding without it (the default triad will apply)`);
          }

          // THE SHAPE GATE, checked here rather than at runtime.
          //
          // get-ai-summary.js:2168-2174 accepts a `template`, or `instructions`
          // AND `outputFormat` together, and nothing else. A record satisfying
          // neither does not fail loudly at runtime: resolvePromptTemplate
          // rejects it, the game silently falls back to the game-type default,
          // and the seeded prompt has no effect anybody can see. Refuse to
          // write it instead, so a bad hand-edit to the JSON is a visible error
          // in this handler's results rather than a prompt that exists and does
          // nothing.
          const hasTemplate = typeof promptData.template === 'string' && promptData.template.trim();
          const hasHalves = typeof promptData.instructions === 'string' && promptData.instructions.trim()
            && typeof promptData.outputFormat === 'string' && promptData.outputFormat.trim();
          if (!hasTemplate && !hasHalves) {
            throw new Error(
              `${promptData.name}: needs either a template, or both instructions and outputFormat `
              + '(get-ai-summary.js:2168-2174 accepts nothing else)'
            );
          }

          // Store prompt template in S3 (matching create-ai-prompt format)
          const version = 1;
          const s3Key = `prompts/${gameType}/${promptId}/v${version}.json`;

          // Use the same structure as create-ai-prompt.js for consistency
          const s3Data = {
            id: promptId,
            version,
            name: promptData.name,
            description: promptData.description,
            gameType: gameType,
            category: promptData.category,
            scenario: categoryKey,
            // The two halves, passed through as authored. `template` is written
            // ONLY for a legacy entry that still has one — writing both would
            // hand the engine a `template` that suppresses the halves at
            // :2168, which is the bug this replaced.
            ...(hasTemplate
              ? { template: promptData.template }
              : { instructions: promptData.instructions, outputFormat: promptData.outputFormat }),
            // A prompt's own declared output shape, when it has one. Runtime
            // reads promptData from S3 first, so it has to travel here — a
            // shape stored only in DynamoDB would never reach the model.
            // Absent means "use the system default triad".
            ...(outputSections && { outputSections }),
            promptType: 'analysis',
            isDefault,
            status: 'active',
            questionSetIds: [],
            tags: promptData.tags || [],
            createdAt,
            updatedAt: timestamp,
            metadata: {
              author: 'system',
              createdBy: 'populate-defaults',
              format: 'legacy'
            }
          };
          
          await s3Client.send(new PutObjectCommand({
            Bucket: aiPromptsBucket,
            Key: s3Key,
            Body: JSON.stringify(s3Data, null, 2),
            ContentType: 'application/json'
          }));

          // Store metadata in DynamoDB using current structure
          const metadataRecord = {
            PK: 'AIPROMPTS',
            SK: `AIPROMPT#${promptId}`,
            promptId: promptId,
            name: promptData.name,
            description: promptData.description,
            // Canonical, and the SAME value used for the S3 key above — those
            // two used to disagree (`gameType` loop key vs `promptData.gameType`).
            gameType: gameType,
            promptType: 'analysis',
            category: promptData.category,
            scenario: categoryKey,
            status: promptData.status,
            // One per game type — the tier's own if it has one (ONE DEFAULT PER
            // GAME TYPE, above).
            isDefault,
            tags: promptData.tags,
            // Mirrored onto the metadata row so the admin prompt picker can show
            // a prompt's output shape from the list response, without an S3 read
            // per option. The runtime authority is still the S3 copy.
            ...(outputSections && { outputSections }),
            s3Key: s3Key,
            s3Bucket: aiPromptsBucket,
            createdAt,
            updatedAt: timestamp,
            createdBy: 'system',
            version: '1.0',
            usageCount: 0
          };

          // Use conditional expression only if not overwriting
          const putCommand = {
            TableName: tableName,
            Item: metadataRecord
          };
          
          if (!overwrite) {
            putCommand.ConditionExpression = 'attribute_not_exists(PK)';
          }

          await dynamodb.send(new PutCommand(putCommand));
          if (isDefault && !incumbentByType[gameType]) incumbentByType[gameType] = metadataRecord;

          if (promptExists && overwrite) {
            console.log(`✅ Overwritten default prompt: ${promptData.name}`);
            results.overwritten++;
          } else {
            console.log(`✅ Created default prompt: ${promptData.name}`);
            results.created++;
          }
          results.prompts.push({
            id: promptId,
            name: promptData.name,
            gameType: gameType,
            category: promptData.category
          });

        } catch (error) {
          console.error(`❌ Error creating prompt ${promptData.name}:`, error);
          results.errors++;
        }
      }
    }

    console.log(`🎉 Default prompts population completed!`);
    console.log(`📊 Results: ${results.created} created, ${results.skipped} skipped, ${results.errors} errors`);

    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'POST, OPTIONS'
      },
      body: JSON.stringify({
        success: true,
        message: 'Default AI prompts populated successfully',
        results: results
      })
    };

  } catch (error) {
    console.error('❌ Error populating default prompts:', error);
    return {
      statusCode: 500,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'POST, OPTIONS'
      },
      body: JSON.stringify({ 
        error: 'Failed to populate default prompts',
        message: error.message 
      })
    };
  }
};