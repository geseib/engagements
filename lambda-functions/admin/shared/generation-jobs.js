/**
 * Job records for asynchronous AI generation.
 *
 * WHY THIS EXISTS. Generation used to run inside the HTTP request. `RestApi` is
 * an `AWS::Serverless::HttpApi`, whose 30-second integration timeout is a hard,
 * non-configurable ceiling — while the Lambda itself is configured for 900s.
 * Measured Bedrock latency for a SINGLE detailed scenario was 33-40s, so the
 * gateway hung up on a Lambda that was still working and returned its own
 * non-JSON 503. That is the "Batch 2 of 20: HTTP 503" the owner reported: not
 * Bedrock throttling, not Lambda concurrency, just a wall clock.
 *
 * Shrinking the batch could never fix it. max_tokens was `1000 + count * 700`,
 * so even count=1 asked for 1700 tokens, and at the ~45 output tokens/sec this
 * account actually gets from Sonnet that is ~38s of generation before the first
 * byte of the response is returned. The floor was already over the ceiling.
 *
 * So generation moved off the request entirely: POST creates a job and returns
 * 202 immediately, a self-invoked worker does the slow part with the Lambda's
 * full 900s, and the client polls this record.
 *
 * Delivery is POLLING, not WebSocket, deliberately. get-ai-summary.js solves the
 * same problem with `broadcastToGame(gameId, …)`, but that channel is
 * game-scoped and the admin AI builders have no gameId and no socket. Inventing
 * an admin WebSocket channel to avoid an HTTP poll would be a lot of new
 * infrastructure for a screen one person uses at a time.
 *
 * These records are GENUINELY EPHEMERAL and SHOULD expire — the opposite of the
 * configuration rows that were silently self-deleting because someone stamped a
 * `ttl` on them. A few days is long enough to debug a failed run and short
 * enough that the table does not accumulate dead result blobs.
 */

const { PutCommand, GetCommand, UpdateCommand } = require('@aws-sdk/lib-dynamodb');

const JOB_PK = 'AIJOBS';
const JOB_SK_PREFIX = 'AIJOB#';

/** Long enough to debug yesterday's failure, short enough not to accumulate. */
const JOB_TTL_SECONDS = 3 * 24 * 60 * 60;

const STATUS = {
  QUEUED: 'queued',
  RUNNING: 'running',
  COMPLETE: 'complete',
  ERROR: 'error',
};

const jobKey = (jobId) => ({ PK: JOB_PK, SK: `${JOB_SK_PREFIX}${jobId}` });

/** Collision-resistant enough for a per-admin, per-click identifier. */
function newJobId() {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

const ttlFromNow = () => Math.floor(Date.now() / 1000) + JOB_TTL_SECONDS;

/**
 * Create the record BEFORE the worker is invoked. If the self-invoke fails, the
 * client still has something to poll that explains why, instead of a jobId that
 * 404s forever.
 */
async function createJob(dynamodb, tableName, { jobId, kind, requested, request = {} }) {
  const now = new Date().toISOString();
  const item = {
    ...jobKey(jobId),
    jobId,
    kind,
    status: STATUS.QUEUED,
    requested,
    completed: 0,
    phase: 'Queued',
    items: [],
    warnings: [],
    request,
    createdAt: now,
    updatedAt: now,
    ttl: ttlFromNow(),
  };
  await dynamodb.send(new PutCommand({ TableName: tableName, Item: item }));
  return item;
}

/**
 * Incremental progress, not just a terminal result.
 *
 * A four-minute job that reports nothing until it finishes is indistinguishable
 * from a hung one, which is most of why the old failure felt so bad. `items` is
 * written on every update too, so a worker that dies mid-run still leaves the
 * scenarios it already produced behind rather than throwing them away.
 */
async function updateJobProgress(dynamodb, tableName, jobId, { completed, phase, items, warnings }) {
  const sets = ['#status = :running', 'updatedAt = :now'];
  const names = { '#status': 'status' };
  const values = { ':running': STATUS.RUNNING, ':now': new Date().toISOString() };

  if (typeof completed === 'number') { sets.push('completed = :completed'); values[':completed'] = completed; }
  if (phase) { sets.push('phase = :phase'); values[':phase'] = phase; }
  if (Array.isArray(items)) { sets.push('#items = :items'); names['#items'] = 'items'; values[':items'] = items; }
  if (Array.isArray(warnings)) { sets.push('warnings = :warnings'); values[':warnings'] = warnings; }

  await dynamodb.send(new UpdateCommand({
    TableName: tableName,
    Key: jobKey(jobId),
    UpdateExpression: `SET ${sets.join(', ')}`,
    ExpressionAttributeNames: names,
    ExpressionAttributeValues: values,
  }));
}

async function completeJob(dynamodb, tableName, jobId, { items, warnings = [] }) {
  await dynamodb.send(new UpdateCommand({
    TableName: tableName,
    Key: jobKey(jobId),
    UpdateExpression:
      'SET #status = :status, #items = :items, warnings = :warnings, completed = :completed, phase = :phase, updatedAt = :now',
    ExpressionAttributeNames: { '#status': 'status', '#items': 'items' },
    ExpressionAttributeValues: {
      ':status': STATUS.COMPLETE,
      ':items': items,
      ':warnings': warnings,
      ':completed': items.length,
      ':phase': `Generated ${items.length} of ${items.length}`,
      ':now': new Date().toISOString(),
    },
  }));
}

/**
 * Failure keeps whatever was already produced. A run that generated 14 of 20
 * and then hit a Bedrock error is far more useful surfaced as "14 scenarios and
 * here is what went wrong" than as a bare error.
 */
async function failJob(dynamodb, tableName, jobId, message, { items } = {}) {
  const sets = ['#status = :status', 'errorMessage = :error', 'phase = :phase', 'updatedAt = :now'];
  const names = { '#status': 'status' };
  const values = {
    ':status': STATUS.ERROR,
    ':error': String(message || 'Generation failed'),
    ':phase': 'Failed',
    ':now': new Date().toISOString(),
  };
  if (Array.isArray(items)) {
    sets.push('#items = :items', 'completed = :completed');
    names['#items'] = 'items';
    values[':items'] = items;
    values[':completed'] = items.length;
  }
  await dynamodb.send(new UpdateCommand({
    TableName: tableName,
    Key: jobKey(jobId),
    UpdateExpression: `SET ${sets.join(', ')}`,
    ExpressionAttributeNames: names,
    ExpressionAttributeValues: values,
  }));
}

async function getJob(dynamodb, tableName, jobId) {
  const res = await dynamodb.send(new GetCommand({ TableName: tableName, Key: jobKey(jobId) }));
  return res.Item || null;
}

/** Poll payload. Deliberately omits `request` — the client already has it. */
function jobToResponse(item) {
  if (!item) return null;
  return {
    jobId: item.jobId,
    status: item.status,
    phase: item.phase || '',
    requested: item.requested || 0,
    completed: item.completed || 0,
    items: item.items || [],
    warnings: item.warnings || [],
    error: item.errorMessage || null,
    updatedAt: item.updatedAt,
  };
}

module.exports = {
  JOB_PK,
  JOB_SK_PREFIX,
  JOB_TTL_SECONDS,
  STATUS,
  jobKey,
  newJobId,
  createJob,
  updateJobProgress,
  completeJob,
  failJob,
  getJob,
  jobToResponse,
};
