/**
 * AI scenario generation — asynchronous, structured, tag-suggesting.
 *
 * THE BUG THIS REPLACES. The old handler generated inside the HTTP request and
 * the owner saw "Batch 2 of 20: HTTP 503 - retrying in 3s". The 503 was not
 * Bedrock and not Lambda concurrency: this handler could only ever return 200,
 * 429 or 500, and the client's error text was empty, meaning the body was not
 * JSON. It came from API Gateway. `RestApi` is an AWS::Serverless::HttpApi,
 * whose 30s integration timeout is a hard ceiling, and CloudWatch put this
 * function's Duration at 28.4s average / 40.1s maximum. The gateway was hanging
 * up on a Lambda that was still working.
 *
 * Batch size could not fix it. max_tokens was `1000 + count * 700` — 1700 even
 * at count=1 — and at the ~45 output tokens/sec measured here that is ~38s of
 * generation. The floor was already above the ceiling, which is why shrinking
 * batches to one item made things worse rather than better.
 *
 * WHAT CHANGED
 *   1. Async. POST creates a job and returns 202; a self-invoked worker runs
 *      with the full 900s Lambda timeout; the client polls (see
 *      shared/generation-jobs.js for why polling and not WebSocket).
 *   2. Few large calls instead of many tiny ones. Twenty parallel one-item calls
 *      were each blind to the other nineteen, which is why duplicates appeared.
 *   3. Tool use instead of regex-parsing prose, plus a real truncation check.
 *   4. Hard length limits in the prompt. Unbounded "detailed" output was the
 *      root cause of BOTH the latency and the truncation.
 *   5. Suggested tags, produced by the same call that writes the content.
 *
 * Also fixed: the prompt template lookup. This handler read
 * `AIPROMPT#GENERATION#<scenarioType>#<engagementType>`, but the rows were
 * re-keyed to `AIPROMPT#gen-<gameType>-<scenarioType>`. Every single invocation
 * logged "No prompt template found … using fallback", so all 22 curated
 * generation prompts were dead and the generic fallback — which has no length
 * guidance — ran every time.
 */

const { BedrockRuntimeClient, InvokeModelCommand } = require('@aws-sdk/client-bedrock-runtime');
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, GetCommand } = require('@aws-sdk/lib-dynamodb');
const { LambdaClient, InvokeCommand } = require('@aws-sdk/client-lambda');

const { normalizeGameType, gameTypeSpellings } = require('./shared/game-types');
const { normalizeTags } = require('./shared/tags');
const {
  itemsPerCall, maxTokensFor, perItemTokens,
  lengthGuidance, tagGuidance, buildItemsTool, invokeStructured,
} = require('./shared/structured-generation');
const {
  newJobId, createJob, updateJobProgress, completeJob, failJob, getJob, jobToResponse,
} = require('./shared/generation-jobs');

const bedrockClient = new BedrockRuntimeClient({ region: process.env.AWS_REGION });
const lambda = new LambdaClient({ region: process.env.AWS_REGION });
const tableName = process.env.TABLE_NAME;
const dynamodb = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
  marshallOptions: { removeUndefinedValues: true },
});

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};
const json = (statusCode, body) => ({ statusCode, body: JSON.stringify(body), headers: CORS });

const MAX_COUNT = 100;
/** Observed Sonnet throughput on this account. Used only to budget the deadline. */
const OUTPUT_TOKENS_PER_SEC = 45;

// ---------------------------------------------------------------- templates

const buildFallbackTemplate = (engagementType, prompt) => {
  if (engagementType === 'wavelength') {
    return {
      basePrompt: prompt || 'Create wavelength subjects for a team word-association alignment game. Each item is a single short, evocative SUBJECT (1-4 words, e.g. "Remote Work", "Customer Trust") that every participant responds to by listing up to 10 words or short phrases that come to mind; the game then measures how many words overlap across participants. Pick subjects broad enough that everyone can produce 10 associations, yet specific enough that overlap is meaningful. Mix concrete and abstract subjects. Do NOT write questions, scenarios, sentences to complete, or anything with a correct answer.',
      contextTemplate: '\n\nContext: {context}',
      audienceTemplate: '\nAudience: {audience}',
      categoryTemplate: '\nOrganize subjects into EXACTLY {numberOfCategories} categories - no more, no less.\nMust include these categories: {mustHaveCategories}',
    };
  }
  return {
    basePrompt: prompt || 'Create scenarios based on the requirements provided',
    contextTemplate: '\n\nContext: {context}',
    audienceTemplate: '\nAudience: {audience}',
    categoryTemplate: '\nOrganize scenarios into EXACTLY {numberOfCategories} categories - no more, no less.\nMust include these categories: {mustHaveCategories}',
  };
};

/**
 * Find the curated prompt row.
 *
 * Tries every spelling the row may legitimately be stored under rather than one
 * exact string — comparing raw game-type strings is exactly what kept this (and
 * other) lookups silently empty. The legacy `AIPROMPT#GENERATION#…` key is still
 * probed last because dev has been re-keyed and the other stacks may not be.
 */
async function resolvePromptTemplate({ scenarioType, engagementType, prompt }) {
  const gameType = normalizeGameType(engagementType);
  const type = String(scenarioType || '').trim().toLowerCase();
  const candidates = [];
  if (type) {
    for (const spelling of gameTypeSpellings(gameType)) {
      candidates.push(`AIPROMPT#gen-${spelling}-${type}`);
    }
    for (const spelling of gameTypeSpellings(gameType)) {
      candidates.push(`AIPROMPT#GENERATION#${type}#${spelling}`);
    }
  }

  for (const SK of candidates) {
    try {
      const res = await dynamodb.send(new GetCommand({ TableName: tableName, Key: { PK: 'AIPROMPTS', SK } }));
      if (res.Item && res.Item.basePrompt) {
        console.log('✅ Using curated prompt template:', SK);
        return { template: res.Item, source: SK };
      }
    } catch (error) {
      console.error(`❌ Error reading prompt template ${SK}:`, error.message);
    }
  }

  console.warn(`⚠️ No curated prompt for ${type}/${gameType} (tried ${candidates.length} keys), using fallback`);
  return { template: buildFallbackTemplate(engagementType, prompt), source: 'fallback' };
}

// ------------------------------------------------------------------ prompts

function buildPrompt({
  template, engagementType, count, difficulty, context, audience, customPrompt,
  categories, mustHaveCategories, alreadyUsedTitles,
}) {
  const itemNoun = engagementType === 'wavelength' ? 'wavelength subjects' : 'scenarios';
  let p = `Create ${count} ${itemNoun}. ${template.basePrompt}`;

  if (context && template.contextTemplate) p += template.contextTemplate.replace('{context}', context);
  if (audience && template.audienceTemplate) p += template.audienceTemplate.replace('{audience}', audience);
  if (customPrompt) p += `\n\nAdditional Requirements: ${customPrompt}`;

  const levelLabel = engagementType === 'trivia' ? 'Difficulty Level' : 'Level of Detail';
  if (difficulty) p += `\n\n${levelLabel}: ${difficulty}`;

  if (template.categoryTemplate && (categories || mustHaveCategories)) {
    let categoryText = template.categoryTemplate;
    if (categories) categoryText = categoryText.replace('{numberOfCategories}', categories);
    if (mustHaveCategories) categoryText = categoryText.replace('{mustHaveCategories}', mustHaveCategories);
    p += `\n${categoryText}`;
  }

  // Later chunks must know what earlier ones produced. The old design had no
  // equivalent — twenty parallel calls each believed they were the only one.
  if (alreadyUsedTitles && alreadyUsedTitles.length > 0) {
    p += `\n\nALREADY GENERATED for this set — do not repeat, rephrase, or write a near-variant of any of these:\n`;
    p += alreadyUsedTitles.map((t) => `- ${t}`).join('\n');
  }

  p += lengthGuidance(engagementType);
  p += tagGuidance();
  p += `\n\nReturn the items by calling the emit_items tool. Do not write prose.`;
  return p;
}

// ------------------------------------------------------------ normalisation

const titleTokens = (title) =>
  String(title || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean);

/**
 * Safety net only — prompt-level avoidance is the primary dedup mechanism now,
 * so this can afford to be conservative, and needs to be.
 *
 * The threshold inherited from the client-side version (4+ tokens, 80% overlap)
 * is a hair trigger on real titles: "Handling a difficult customer escalation"
 * and "Handling a difficult customer complaint" share 4 of 5 tokens and are
 * different scenarios. Dropping one of those silently — server-side, where
 * nobody sees it — is worse than letting a genuine near-duplicate through for
 * the owner to delete. Identical token sets are still always caught.
 */
function isNearDuplicate(title, keptTokenSets) {
  const tokens = titleTokens(title);
  if (tokens.length === 0) return false;
  const set = new Set(tokens);
  return keptTokenSets.some((prev) => {
    const overlap = tokens.filter((t) => prev.has(t)).length;
    const sameSet = overlap === set.size && overlap === prev.size;
    const high = Math.min(set.size, prev.size) >= 5 && overlap / Math.min(set.size, prev.size) >= 0.9;
    return sameSet || high;
  });
}

function normalizeItem(raw) {
  return {
    id: Date.now() + Math.random(),
    active: true,
    title: String(raw?.title || '').trim(),
    category: String(raw?.category || '').trim(),
    detail: String(raw?.detail || '').trim(),
    customInstructions: String(raw?.customInstructions || '').trim(),
    // Normalised on write; readers tolerate legacy casing. See shared/tags.js.
    tags: normalizeTags(raw?.tags),
  };
}

// ------------------------------------------------------------------- worker

async function runWorker(event, context) {
  const { jobId, payload } = event;
  const produced = [];
  const keptTokenSets = [];
  const warnings = [];

  try {
    const {
      scenarioType, engagementType = 'call-and-answer', prompt, count, difficulty,
      context: brief, audience, customPrompt, numberOfCategories, mustHaveCategories,
    } = payload;

    const total = Math.min(Math.max(parseInt(count, 10) || 1, 1), MAX_COUNT);

    // The category clamp used to be Math.min(n, 24, chunkCount). With one item
    // per chunk that evaluated to 1 EVERY time — the logs read "Limited category
    // count from 5 to 1" — so each of the twenty calls invented its own single
    // category and a 5-category request came back with up to 20. Clamp against
    // the TOTAL, which is the number that was always meant.
    const categories = Math.min(parseInt(numberOfCategories, 10) || 3, 24, Math.max(total, 1));

    const { template, source } = await resolvePromptTemplate({ scenarioType, engagementType, prompt });
    if (source === 'fallback') {
      warnings.push('No curated prompt matched this type; used the generic fallback prompt.');
    }

    const perCall = itemsPerCall(engagementType);
    const tool = buildItemsTool(engagementType);

    await updateJobProgress(dynamodb, tableName, jobId, {
      completed: 0,
      phase: total <= perCall ? `Generating ${total} in a single pass...` : `Generating ${total} in ${Math.ceil(total / perCall)} passes...`,
    });

    while (produced.length < total) {
      const remainingItems = total - produced.length;
      const chunkSize = Math.min(perCall, remainingItems);

      // Stop cleanly rather than being killed mid-call: a partial result that
      // is saved beats a full result that is lost.
      const estimatedMs = ((chunkSize * perItemTokens(engagementType)) / OUTPUT_TOKENS_PER_SEC) * 1000 * 1.5 + 30000;
      const remainingMs = typeof context?.getRemainingTimeInMillis === 'function'
        ? context.getRemainingTimeInMillis()
        : Infinity;
      if (remainingMs < estimatedMs) {
        warnings.push(`Stopped after ${produced.length} of ${total} to stay inside the function time limit. Run again to generate more.`);
        break;
      }

      const chunkPrompt = buildPrompt({
        template,
        engagementType,
        count: chunkSize,
        difficulty,
        context: brief,
        audience,
        customPrompt,
        categories,
        mustHaveCategories,
        alreadyUsedTitles: produced.map((s) => s.title),
      });

      let result;
      try {
        result = await invokeStructured(bedrockClient, InvokeModelCommand, {
          prompt: chunkPrompt,
          tool,
          maxTokens: maxTokensFor(engagementType, chunkSize),
        });
      } catch (error) {
        if (error.name === 'OutputTruncatedError' && chunkSize > 1) {
          // Truncation means this chunk was too ambitious, not that the run is
          // doomed. Halving is cheaper than failing the whole job.
          warnings.push(`A pass of ${chunkSize} exceeded the output budget; continuing in smaller passes.`);
          const halved = Math.max(1, Math.floor(chunkSize / 2));
          result = await invokeStructured(bedrockClient, InvokeModelCommand, {
            prompt: buildPrompt({
              template, engagementType, count: halved, difficulty, context: brief, audience,
              customPrompt, categories, mustHaveCategories,
              alreadyUsedTitles: produced.map((s) => s.title),
            }),
            tool,
            maxTokens: maxTokensFor(engagementType, halved),
          });
        } else {
          throw error;
        }
      }

      const batch = Array.isArray(result?.items) ? result.items : [];
      if (batch.length === 0) {
        warnings.push('A generation pass returned no items; stopping early.');
        break;
      }

      let added = 0;
      for (const raw of batch) {
        if (produced.length >= total) break;
        const item = normalizeItem(raw);
        if (!item.title) continue;
        if (isNearDuplicate(item.title, keptTokenSets)) {
          console.warn(`⚠️ Dropping near-duplicate: "${item.title}"`);
          continue;
        }
        keptTokenSets.push(new Set(titleTokens(item.title)));
        produced.push(item);
        added += 1;
      }

      await updateJobProgress(dynamodb, tableName, jobId, {
        completed: produced.length,
        phase: `Generated ${produced.length} of ${total}...`,
        items: produced,
        warnings,
      });

      // No forward progress means another pass will not help either.
      if (added === 0) {
        warnings.push('A generation pass produced only duplicates; stopping early.');
        break;
      }
    }

    await completeJob(dynamodb, tableName, jobId, { items: produced, warnings });
    console.log(`✅ Job ${jobId} complete: ${produced.length} items`);
  } catch (error) {
    console.error(`❌ Job ${jobId} failed:`, error);
    await failJob(dynamodb, tableName, jobId, error.message, { items: produced });
  }
}

// ------------------------------------------------------------------ handler

exports.handler = async (event, context) => {
  // Async worker: invoked with InvocationType 'Event', so it runs against the
  // Lambda's own 900s timeout and never touches API Gateway's 30s ceiling.
  if (event && event.__workerMode === true) {
    await runWorker(event, context);
    return { statusCode: 200, body: 'ok' };
  }

  const method = event?.requestContext?.http?.method;
  if (method === 'OPTIONS') return { statusCode: 200, headers: CORS, body: '' };

  try {
    // ---- poll -------------------------------------------------------------
    const jobIdParam = event?.pathParameters?.jobId || event?.queryStringParameters?.jobId;
    if (method === 'GET' || jobIdParam) {
      if (!jobIdParam) return json(400, { error: 'jobId is required' });
      const item = await getJob(dynamodb, tableName, jobIdParam);
      if (!item) return json(404, { error: 'Job not found or expired' });
      return json(200, jobToResponse(item));
    }

    // ---- start ------------------------------------------------------------
    if (!event.body) return json(400, { error: 'No request body provided' });
    const payload = JSON.parse(event.body);

    const requested = Math.min(Math.max(parseInt(payload.count, 10) || 1, 1), MAX_COUNT);
    const jobId = newJobId();

    await createJob(dynamodb, tableName, {
      jobId,
      kind: 'scenarios',
      requested,
      request: {
        scenarioType: payload.scenarioType,
        engagementType: payload.engagementType,
        count: requested,
      },
    });

    try {
      await lambda.send(new InvokeCommand({
        FunctionName: context.functionName,
        InvocationType: 'Event',
        Payload: Buffer.from(JSON.stringify({ __workerMode: true, jobId, payload })),
      }));
    } catch (error) {
      // The job row already exists, so surface the failure there too — a client
      // polling a job that will never start deserves an explanation.
      console.error('❌ Failed to dispatch generation worker:', error);
      await failJob(dynamodb, tableName, jobId, `Could not start generation worker: ${error.message}`);
      return json(500, { error: `Could not start generation: ${error.message}`, jobId });
    }

    console.log(`🚀 Dispatched scenario generation job ${jobId} for ${requested} items`);
    return json(202, { jobId, status: 'queued', requested });
  } catch (error) {
    console.error('❌ AI scenario generation error:', error);
    return json(500, { error: `Failed to generate scenarios: ${error.message || 'unexpected error'}` });
  }
};
