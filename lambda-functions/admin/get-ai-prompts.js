const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, QueryCommand } = require('@aws-sdk/lib-dynamodb');
const { S3Client, ListObjectsV2Command, GetObjectCommand } = require('@aws-sdk/client-s3');
const { normalizeGameType } = require('./shared/game-types');
const { isUsableSummaryPrompt, summaryPromptDefect, inferPromptType, normalizeOutputSections } = require('./shared/prompt-shape');
const { readablePromptRefs, promptKey } = require('./shared/prompt-access');
const { PLATFORM, ORG, PUBLIC } = require('./shared/tenant');

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
  console.log('🔍 Get AI Prompts - Event:', JSON.stringify(event, null, 2));

  try {
    // Handle CORS preflight
    if (event.requestContext?.http?.method === 'OPTIONS') {
      return {
        statusCode: 200,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Headers': 'Content-Type',
          'Access-Control-Allow-Methods': 'GET, OPTIONS'
        },
        body: ''
      };
    }

    const queryParams = event.queryStringParameters || {};
    const gameType = queryParams.gameType;     // any spelling — normalized below
    const category = queryParams.category;     // specific category filter
    const status = queryParams.status;         // active, draft, archived
    const promptType = queryParams.promptType; // analysis | generation

    console.log(`🔍 Fetching AI prompts - gameType: ${gameType}, category: ${category}, status: ${status}, promptType: ${promptType}`);

    /*
      EVERY LIBRARY THIS CALLER MAY SEE, MERGED — not one partition any more.

      `readablePromptRefs` is the authority (shared/prompt-access.js ->
      tenant.js): the caller's own org, then the platform library, then public.
      Platform is in that list for EVERYBODY with an account, which is what
      keeps Engage's Workies available to every organisation.

      One Query per scope, run CONCURRENTLY: they hit different partitions, so
      sequential awaits would only add latency. Three at most.

      A FRESH INPUT OBJECT PER REF, and that is not a style preference. The
      FilterExpression and its values are per-QueryCommand; sharing one object
      across a Promise.all and reassigning `:pk` between sends is a race in
      which every query can end up reading the last `:pk` written.

      `promptKey(ref).PK` rather than a literal: nothing outside tenant.js may
      spell a partition key, and a hand-built 'ORG#'+id+'#AIPROMPTS' here is
      exactly the drift that ends with two spellings of one partition.

      `begins_with(SK, 'AIPROMPT#')` STAYS. The bare partition also holds
      PERSONA#<id> rows and the GAMETYPE#…#CATEGORY#… default pointer, both of
      which are platform-only by decision (tenant.js:114-131); this condition is
      the only thing keeping them out of the prompt library.
    */
    const buildQuery = (pk) => {
      const q = {
        TableName: tableName,
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
        ExpressionAttributeValues: { ':pk': pk, ':sk': 'AIPROMPT#' }
      };
      // Only `category` and `status` are exact-match, so only they can be
      // pushed down into a FilterExpression. `gameType` and `promptType` need
      // normalisation / shape-inference and are applied in JS below — a
      // FilterExpression on the raw stored value is exactly what made a
      // `poll`-spelled filter miss every `polls`-spelled row.
      const filterExpressions = [];
      if (category) {
        filterExpressions.push('category = :category');
        q.ExpressionAttributeValues[':category'] = category;
      }
      if (status) {
        filterExpressions.push('#status = :status');
        q.ExpressionAttributeValues[':status'] = status;
        q.ExpressionAttributeNames = { '#status': 'status' };
      }
      if (filterExpressions.length > 0) q.FilterExpression = filterExpressions.join(' AND ');
      return q;
    };

    const refs = readablePromptRefs(event, '');
    const perScope = await Promise.all(refs.map(async (ref) => {
      const res = await dynamodb.send(new QueryCommand(buildQuery(promptKey(ref).PK)));
      // The ref travels with the row: it named the partition, so it cannot
      // disagree with where the row actually is.
      return ((res && res.Items) || []).map((item) => ({ item, ref }));
    }));

    let promptsMetadata = perScope.flat();

    console.log(`📊 Found ${promptsMetadata.length} prompt metadata records across ${refs.length} scope(s)`);

    if (gameType && gameType !== 'all') {
      const wanted = normalizeGameType(gameType);
      const before = promptsMetadata.length;
      promptsMetadata = promptsMetadata.filter(({ item }) => normalizeGameType(item.gameType) === wanted);
      console.log(`🎮 gameType "${gameType}" → "${wanted}": ${before} → ${promptsMetadata.length}`);
    }

    if (promptType && promptType !== 'all') {
      // D16: this param was sent by AIGenerationPromptEditor and AIScenarioBuilder
      // and silently ignored, so their "generation only" lists contained
      // everything. Inference beats the stored attribute because rows written
      // before D15 was fixed are mislabeled `generation` (see prompt-shape.js).
      const before = promptsMetadata.length;
      promptsMetadata = promptsMetadata.filter(({ item }) => inferPromptType(item) === promptType);
      console.log(`🏷️ promptType "${promptType}": ${before} → ${promptsMetadata.length}`);
    }

    /**
     * Decorate a record so the UI never has to re-derive vocabulary or guess
     * whether a prompt can serve as a summary prompt.
     *
     * - `gameType` is returned CANONICAL (dashed). `gameTypeStored` keeps the
     *   raw value so a cull/migration script can still see what is on disk.
     * - `promptId` is synthesized from the SK when the record has none.
     *   `populate-generation-prompts.js` wrote rows with no `promptId` at all,
     *   and `<option value={undefined}>` makes the browser fall back to the
     *   option's LABEL TEXT — selecting one wrote garbage like
     *   "Lessons Learned Scenarios (call-and-answer - )" into a set's promptId.
     *   `malformed: true` marks them for the cull script.
     * - `summaryPromptStatus` is the picker's grey-out signal (R1b).
     */
    const decorate = (prompt, promptContent, ref) => {
      const synthesizedId = String(prompt.SK || '').replace(/^AIPROMPT#/, '') || undefined;
      const shapeSource = promptContent || prompt;
      const known = Boolean(promptContent) || Boolean(prompt.basePrompt);

      return {
        ...prompt,
        ...(promptContent ? { promptContent } : {}),
        // THE OTHER HALF OF THE REFERENCE. `retro` in an organisation and
        // `retro` on the platform are two different Workies, so a client that
        // holds only a promptId cannot address either. Taken from the REF that
        // named the partition — a row cannot disagree with where it is.
        scope: ref.scope,
        orgId: ref.orgId || null,
        promptId: prompt.promptId || synthesizedId,
        malformed: !prompt.promptId,
        gameType: normalizeGameType(prompt.gameType),
        gameTypeStored: prompt.gameType,
        promptType: inferPromptType(prompt),
        promptTypeStored: prompt.promptType,
        // The prompt's declared output shape, for the picker's shape preview.
        // Prefer the S3 copy when we have it — that is the one the summary
        // engine actually reads; the DynamoDB copy is a mirror kept so the list
        // response carries the shape without an S3 read per option.
        ...(normalizeOutputSections(shapeSource && shapeSource.outputSections)
          ? { outputSections: normalizeOutputSections(shapeSource.outputSections) }
          : {}),
        summaryPromptStatus: known
          ? (isUsableSummaryPrompt(shapeSource) ? 'usable' : 'unusable')
          : 'unknown',
        summaryPromptDefect: known ? summaryPromptDefect(shapeSource) : null,
      };
    };

    // Enrich with S3 data if needed
    const enrichedPrompts = await Promise.all(promptsMetadata.map(async ({ item: prompt, ref }) => {
      try {
        // Get latest version from S3 if needed
        if (prompt.s3Key && queryParams.includeContent === 'true') {
          const s3Response = await s3Client.send(new GetObjectCommand({
            Bucket: aiPromptsBucket,
            Key: prompt.s3Key
          }));

          const content = await s3Response.Body.transformToString();
          return decorate(prompt, JSON.parse(content), ref);
        }

        return decorate(prompt, null, ref);
      } catch (s3Error) {
        console.warn(`⚠️ Could not fetch S3 content for ${prompt.s3Key}:`, s3Error.message);
        return decorate(prompt, null, ref);
      }
    }));

    const unusable = enrichedPrompts.filter(p => p.summaryPromptStatus === 'unusable');
    if (unusable.length > 0) {
      console.warn(`⚠️ ${unusable.length} prompt(s) cannot serve as summary prompts: ` +
        unusable.map(p => `${p.promptId} (${p.summaryPromptDefect})`).join('; '));
    }
    const malformed = enrichedPrompts.filter(p => p.malformed);
    if (malformed.length > 0) {
      console.warn(`⚠️ ${malformed.length} prompt row(s) have no promptId attribute — ` +
        `id synthesized from SK: ${malformed.map(p => p.promptId).join(', ')}`);
    }

    // ORG, THEN PLATFORM, THEN PUBLIC — and newest first within each.
    //
    // `readablePromptRefs` already encodes this rank and the reason for it:
    // your own content is what you meant. A flat updatedAt sort interleaves a
    // team's four Workies with Engage's twenty-two, in the one surface built to
    // show them their own.
    //
    // For a caller with no organisation the refs are [platform, public] and
    // there are no public prompt rows yet, so this orders identically to the
    // flat sort it replaces for every caller that exists today.
    const SCOPE_RANK = { [ORG]: 0, [PLATFORM]: 1, [PUBLIC]: 2 };
    enrichedPrompts.sort((a, b) =>
      ((SCOPE_RANK[a.scope] ?? 9) - (SCOPE_RANK[b.scope] ?? 9))
      || (new Date(b.updatedAt) - new Date(a.updatedAt)));

    console.log(`✅ Successfully retrieved ${enrichedPrompts.length} AI prompts`);

    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'GET, OPTIONS'
      },
      body: JSON.stringify({
        prompts: enrichedPrompts,
        totalCount: enrichedPrompts.length,
        filters: {
          gameType,
          gameTypeNormalized: gameType && gameType !== 'all' ? normalizeGameType(gameType) : gameType,
          category,
          status,
          promptType
        }
      })
    };

  } catch (error) {
    console.error('❌ Error fetching AI prompts:', error);
    return {
      statusCode: 500,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'GET, OPTIONS'
      },
      body: JSON.stringify({
        error: 'Failed to fetch AI prompts',
        message: error.message
      })
    };
  }
};