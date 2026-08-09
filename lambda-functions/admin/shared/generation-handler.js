/**
 * The generation-job handler, once.
 *
 * WHY THIS EXISTS. `RestApi` is an `AWS::Serverless::HttpApi`, whose 30-second
 * integration timeout is a hard, non-configurable ceiling — while the Lambdas
 * behind it are configured for 900s. Generation that runs inside the request
 * races a wall clock it cannot see, and when it loses, API Gateway returns its
 * own non-JSON 503 while the Lambda is still working. That is the "HTTP 503"
 * the AI builders reported. Shrinking the batch could not help: the per-call
 * token floor was already above the ceiling.
 *
 * So the request stops generating. POST creates a job and returns 202, a
 * self-invoked Event worker does the slow part against the full 900s, and the
 * client polls. See shared/generation-jobs.js for why polling and not
 * WebSocket.
 *
 * ai-generate-scenarios.js carries its own inline copy of this flow. It is
 * deliberately NOT migrated here: it is the proven, deployed reference, and its
 * test suite is what guards this factory's behaviour. Migrating it is a
 * follow-up once the four builders converted onto this factory are proven.
 */

const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient } = require('@aws-sdk/lib-dynamodb');
const { BedrockRuntimeClient, InvokeModelCommand } = require('@aws-sdk/client-bedrock-runtime');
const { LambdaClient, InvokeCommand } = require('@aws-sdk/client-lambda');

const { itemsPerCall, maxTokensFor, perItemTokens, invokeStructured } = require('./structured-generation');
const {
  newJobId, createJob, updateJobProgress, completeJob, failJob, getJob, jobToResponse,
} = require('./generation-jobs');

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};
const json = (statusCode, body) => ({ statusCode, body: JSON.stringify(body), headers: CORS });

/** Observed Sonnet throughput on this account. Used only to budget the deadline. */
const OUTPUT_TOKENS_PER_SEC = 45;

const titleTokens = (title) =>
  String(title || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean);

/**
 * Safety net only — prompt-level avoidance is the primary dedup mechanism, so
 * this is deliberately conservative. The old client-side threshold (4+ tokens,
 * 80% overlap) is a hair trigger on real titles: two questions differing only in
 * their last word are usually two questions. Identical token sets are always
 * caught; anything looser needs 5+ tokens and 90% overlap.
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

function makeGenerationHandler(config) {
  const {
    kind, tokenKind,
    parseRequest, buildTool, buildPrompt, normalizeItem,
    extractMeta = null,
    titleOf = (item) => item?.title,
  } = config;

  const tableName = process.env.TABLE_NAME;
  const dynamodb = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
    marshallOptions: { removeUndefinedValues: true },
  });
  const bedrockClient = new BedrockRuntimeClient({ region: process.env.AWS_REGION });
  const lambda = new LambdaClient({ region: process.env.AWS_REGION });

  async function runWorker(event, context) {
    const { jobId, payload } = event;
    const produced = [];
    const keptTokenSets = [];
    const warnings = [];
    let meta = null;

    try {
      const { total, config: reqConfig } = parseRequest(payload);
      const perCall = itemsPerCall(tokenKind);
      const tool = buildTool(reqConfig);

      await updateJobProgress(dynamodb, tableName, jobId, {
        completed: 0,
        phase: total <= perCall
          ? `Generating ${total} in a single pass...`
          : `Generating ${total} in ${Math.ceil(total / perCall)} passes...`,
      });

      let isFirstPass = true;
      while (produced.length < total) {
        const chunkSize = Math.min(perCall, total - produced.length);

        // Stop cleanly rather than being killed mid-call: a partial result that
        // is saved beats a full result that is lost.
        const estimatedMs = ((chunkSize * perItemTokens(tokenKind)) / OUTPUT_TOKENS_PER_SEC) * 1000 * 1.5 + 30000;
        const remainingMs = typeof context?.getRemainingTimeInMillis === 'function'
          ? context.getRemainingTimeInMillis()
          : Infinity;
        if (remainingMs < estimatedMs) {
          warnings.push(`Stopped after ${produced.length} of ${total} to stay inside the function time limit. Run again to generate more.`);
          break;
        }

        const promptFor = (count) => buildPrompt({
          config: reqConfig,
          count,
          alreadyUsedTitles: produced.map(titleOf).filter(Boolean),
          isFirstPass,
        });

        let result;
        try {
          result = await invokeStructured(bedrockClient, InvokeModelCommand, {
            prompt: promptFor(chunkSize),
            tool,
            maxTokens: maxTokensFor(tokenKind, chunkSize),
          });
        } catch (error) {
          if (error.name === 'OutputTruncatedError' && chunkSize > 1) {
            // Truncation means this chunk was too ambitious, not that the run is
            // doomed. Halving is cheaper than failing the whole job.
            warnings.push(`A pass of ${chunkSize} exceeded the output budget; continuing in smaller passes.`);
            const halved = Math.max(1, Math.floor(chunkSize / 2));
            result = await invokeStructured(bedrockClient, InvokeModelCommand, {
              prompt: promptFor(halved),
              tool,
              maxTokens: maxTokensFor(tokenKind, halved),
            });
          } else {
            throw error;
          }
        }

        // Set-level output (e.g. an improved survey title) is asked for on the
        // FIRST pass only — re-deriving it per chunk invites the model to
        // contradict itself — and is written immediately so it survives a later
        // failure.
        if (isFirstPass && extractMeta) {
          const extracted = extractMeta(result, reqConfig);
          if (extracted && typeof extracted === 'object' && Object.keys(extracted).length > 0) {
            meta = extracted;
          }
        }
        isFirstPass = false;

        const batch = Array.isArray(result?.items) ? result.items : [];
        if (batch.length === 0) {
          warnings.push('A generation pass returned no items; stopping early.');
          break;
        }

        let added = 0;
        for (const raw of batch) {
          if (produced.length >= total) break;
          const item = normalizeItem(raw, reqConfig);
          if (!item) continue;
          const title = titleOf(item);
          if (!title) continue;
          if (isNearDuplicate(title, keptTokenSets)) {
            console.warn(`⚠️ Dropping near-duplicate: "${title}"`);
            continue;
          }
          keptTokenSets.push(new Set(titleTokens(title)));
          produced.push(item);
          added += 1;
        }

        await updateJobProgress(dynamodb, tableName, jobId, {
          completed: produced.length,
          phase: `Generated ${produced.length} of ${total}...`,
          items: produced,
          warnings,
          meta,
        });

        // No forward progress means another pass will not help either.
        if (added === 0) {
          warnings.push('A generation pass produced only duplicates; stopping early.');
          break;
        }
      }

      await completeJob(dynamodb, tableName, jobId, { items: produced, warnings, meta });
      console.log(`✅ Job ${jobId} complete: ${produced.length} items`);
    } catch (error) {
      console.error(`❌ Job ${jobId} failed:`, error);
      await failJob(dynamodb, tableName, jobId, error.message, { items: produced });
    }
  }

  return async function handler(event, context) {
    // Async worker: invoked with InvocationType 'Event', so it runs against the
    // Lambda's own 900s timeout and never touches API Gateway's 30s ceiling.
    if (event && event.__workerMode === true) {
      await runWorker(event, context);
      return { statusCode: 200, body: 'ok' };
    }

    const method = event?.requestContext?.http?.method || event?.httpMethod;
    if (method === 'OPTIONS') return { statusCode: 200, headers: CORS, body: '' };

    try {
      const jobIdParam = event?.pathParameters?.jobId || event?.queryStringParameters?.jobId;
      if (method === 'GET' || jobIdParam) {
        if (!jobIdParam) return json(400, { error: 'jobId is required' });
        const item = await getJob(dynamodb, tableName, jobIdParam);
        if (!item) return json(404, { error: 'Job not found or expired' });
        return json(200, jobToResponse(item));
      }

      if (!event.body) return json(400, { error: 'No request body provided' });
      const payload = JSON.parse(event.body);

      const { total } = parseRequest(payload);
      const jobId = newJobId();

      await createJob(dynamodb, tableName, {
        jobId, kind, requested: total, request: { kind, count: total },
      });

      try {
        await lambda.send(new InvokeCommand({
          FunctionName: context.functionName,
          InvocationType: 'Event',
          Payload: Buffer.from(JSON.stringify({ __workerMode: true, jobId, payload })),
        }));
      } catch (error) {
        // The job row already exists, so surface the failure there too — a
        // client polling a job that will never start deserves an explanation.
        console.error('❌ Failed to dispatch generation worker:', error);
        await failJob(dynamodb, tableName, jobId, `Could not start generation worker: ${error.message}`);
        return json(500, { error: `Could not start generation: ${error.message}`, jobId });
      }

      console.log(`🚀 Dispatched ${kind} generation job ${jobId} for ${total} items`);
      return json(202, { jobId, status: 'queued', requested: total });
    } catch (error) {
      console.error(`❌ AI ${kind} generation error:`, error);
      return json(500, { error: `Failed to generate ${kind}: ${error.message || 'unexpected error'}` });
    }
  };
}

module.exports = { makeGenerationHandler, isNearDuplicate, titleTokens, CORS, OUTPUT_TOKENS_PER_SEC };
