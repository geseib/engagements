/**
 * RUN THE CONTENT CHECK ON ONE VERSION, AND RECORD WHAT IT SAID.
 *
 *   POST /admin/question-sets/{setId}/check   { version }
 *
 * This is the link between the two halves that already exist:
 * `shared/content-guardrail.js` knows how to judge content, and
 * `shared/set-review.js` knows where the answer belongs. Without it nothing can
 * ever reach `passed`, so `publish-question-set.js` refuses everything — which
 * is the correct failure, and a useless product.
 *
 * ── A JOB ──────────────────────────────────────────────────────────────
 *
 * The POST takes the lock and the quota, writes the job row with the caller,
 * self-invokes, and answers 202. The worker (`shared/set-check-worker.js`)
 * does everything else against the function's 900s. `checking` older than
 * fifteen minutes reads as unfinished (`set-review.isUnfinished`).
 */
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, GetCommand } = require('@aws-sdk/lib-dynamodb');
const { S3Client } = require('@aws-sdk/client-s3');
const { BedrockRuntimeClient } = require('@aws-sdk/client-bedrock-runtime');
const { LambdaClient, InvokeCommand } = require('@aws-sdk/client-lambda');
const { setMetadataKey, resolvePartitionFromMeta, toVersion, setRef } = require('./shared/set-version');
const tenant = require('./shared/tenant');
const { callerUserId } = require('./shared/question-set-access');
const { callerUsername } = require('./shared/require-admin');
const { beginCheck, abandonCheck } = require('./shared/set-review');
const { reserveSubmit, DEFAULT_DAILY_CAP } = require('./shared/check-quota');
const { writeShareStamp } = require('./shared/share-stamp');
const { newJobId, createJob, getJob, jobToResponse, failJob } = require('./shared/generation-jobs');
const { runSetCheck } = require('./shared/set-check-worker');

const db = DynamoDBDocumentClient.from(new DynamoDBClient({}), { marshallOptions: { removeUndefinedValues: true } });
const s3 = new S3Client({ region: process.env.AWS_REGION });
const bedrock = new BedrockRuntimeClient({ region: process.env.AWS_REGION || 'us-east-1' });
const lambda = new LambdaClient({ region: process.env.AWS_REGION });
const TABLE = () => process.env.TABLE_NAME;

const cors = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };
const json = (statusCode, body) => ({ statusCode, headers: cors, body: JSON.stringify(body) });
const fail = (statusCode, error) => json(statusCode, { error });

exports.handler = async (event, context) => {
  // The worker: invoked with InvocationType 'Event', against the full 900s.
  if (event && event.__workerMode === true) {
    await runSetCheck({ db, tableName: TABLE(), s3, bucket: process.env.AI_PROMPTS_BUCKET, bedrock }, { jobId: event.jobId }, context);
    return { statusCode: 200, body: 'ok' };
  }
  const method = String(event?.requestContext?.http?.method || 'POST').toUpperCase();
  if (method === 'OPTIONS') return { statusCode: 200, headers: cors, body: '' };

  const setId = String(event?.pathParameters?.setId || '').trim();
  if (!setId) return fail(400, 'Which set?');
  const orgId = tenant.callerOrgId(event);
  if (!orgId) return fail(400, 'Choose an organisation before checking a question set.');

  // THE POLL, TENANT-SCOPED. A job id is not a capability: only the org that
  // asked may read the answer. Anything else is "not found", never "not yours".
  const jobIdParam = event?.pathParameters?.jobId;
  if (method === 'GET' || jobIdParam) {
    if (!jobIdParam) return fail(400, 'jobId is required');
    const job = await getJob(db, TABLE(), jobIdParam);
    if (!job || job.kind !== 'set-check' || job.callerOrgId !== orgId) return fail(404, 'Job not found or expired');
    return json(200, jobToResponse(job));
  }

  // The same bar as publishing: this is the step before it.
  if (!tenant.canManageScope(event, tenant.ORG, orgId, 'admin')) {
    return fail(403, 'Only an owner or admin of this organisation can submit a set for review.');
  }
  let body = {};
  try { body = JSON.parse(event.body || '{}'); } catch { return fail(400, 'That request body is not JSON.'); }
  const source = setRef({ scope: tenant.ORG, orgId, setId });

  try {
    const meta = (await db.send(new GetCommand({ TableName: TABLE(), Key: setMetadataKey(source) }))).Item;
    if (!meta) return fail(404, 'That set is not one of yours.');
    const resolved = resolvePartitionFromMeta(source, meta, toVersion(body.version));
    const version = resolved.version;

    const cap = Number(process.env.CHECK_DAILY_CAP) || DEFAULT_DAILY_CAP;
    const quota = await reserveSubmit(db, TABLE(), orgId, { cap });
    if (!quota.ok) return json(429, { error: `This organisation has used today's ${cap} checks. Try again tomorrow.`, cap });

    const jobId = newJobId();
    if (!await beginCheck(db, TABLE(), source, version, { jobId })) {
      return json(409, { error: 'This version is already being checked.', status: 'checking' });
    }
    const request = {
      setId, version,
      publish: body.publish !== false,
      declaredNotice: Array.isArray(body.declaredNotice) ? body.declaredNotice.map(String).slice(0, 8) : [],
    };
    try {
      await createJob(db, TABLE(), {
        jobId, kind: 'set-check', requested: Number(meta.questionCount) || 0, request,
        caller: { userId: callerUserId(event), username: callerUsername(event), orgId, orgRole: tenant.callerOrgRole(event) },
      });
    } catch (error) {
      // The lock was taken for a job that will never exist: release it now
      // rather than leaving the version "checking" for the stale window.
      await abandonCheck(db, TABLE(), source, version, { jobId });
      throw error;
    }
    try {
      await lambda.send(new InvokeCommand({
        FunctionName: context.functionName,
        InvocationType: 'Event',
        Payload: Buffer.from(JSON.stringify({ __workerMode: true, jobId })),
      }));
    } catch (error) {
      console.error('❌ Failed to dispatch the check worker:', error);
      await abandonCheck(db, TABLE(), source, version, { jobId });
      await failJob(db, TABLE(), jobId, `Could not start the content check: ${error.message}`);
      return json(500, { error: `Could not start the content check: ${error.message}`, jobId });
    }
    try {
      await writeShareStamp(db, TABLE(), source, { version, status: 'checking', jobId });
    } catch (error) {
      // The worker is already running and writes the real outcome over this
      // stamp; the submit succeeded and must say so.
      console.warn(`⚠️ share stamp not written for ${orgId}/${setId} v${version} (${error.message}); the worker will write the outcome`);
    }
    console.log(`🔎 dispatched check ${jobId} for ${orgId}/${setId} v${version}`);
    return json(202, { jobId, version, status: 'queued' });
  } catch (error) {
    console.error('check error:', error);
    return fail(500, `Could not check that set: ${error.message}`);
  }
};
