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
 *
 * WHOSE, AND SEALED. A job is read only by the user who started it, acting for
 * the same organisation, through the builder that started it — `isCallersJob`
 * below, the one statement of that rule. A job id is not a capability: it sits
 * in localStorage and in every network panel, and the authorizer opens the
 * builders' polls to hosts as well as admins.
 *
 * An organisation's content on the row — ENCRYPTED_FIELDS.job in
 * tenant-crypto.js — is sealed under that organisation's key on every write
 * whose caller passes `sealFor`, and opened by `openJob` on the owner's read.
 * `sealFor` is OPT-IN per call site rather than inferred from the caller on the
 * row: the set-check jobs share these helpers, their worker reads `request`
 * straight off the row, and they carry ids and bands rather than content.
 * Engage's own library (no organisation) is plaintext by decision, as every
 * platform row is.
 */

const { PutCommand, GetCommand, UpdateCommand } = require('@aws-sdk/lib-dynamodb');
const { encryptItem, decryptItem } = require('./tenant-crypto');

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
 * The job's content fields, sealed under `orgId` — or returned untouched when
 * there is none, which is Engage's own library. Only the fields
 * ENCRYPTED_FIELDS.job names are touched; counts, phase and status stay
 * readable, because they are what the privacy page already concedes is visible.
 */
async function sealJobFields(orgId, fields) {
  return orgId ? encryptItem(orgId, 'job', fields) : fields;
}

/**
 * The row as its owner reads it: every sealed field opened under the org that
 * started the job. A platform row, and a field written before sealing began,
 * pass through as they are.
 */
async function openJob(item) {
  if (!item || !item.callerOrgId) return item;
  return decryptItem(item.callerOrgId, 'job', item);
}

/**
 * IS THIS THE CALLER'S JOB? The user who started it, acting for the same
 * organisation — or for none, on both sides — and read through the builder
 * that started it. Everything else is "not found", never "not yours", and the
 * refusal carries nothing of the job.
 *
 * A job that recorded no user is nobody's (createJob writes no owner rather
 * than an owner of ''), and a caller with no user id owns nothing — `'' === ''`
 * would otherwise hand every such job to every such request.
 */
function isCallersJob(job, { kind, userId, orgId }) {
  return Boolean(job)
    && job.kind === kind
    && Boolean(userId)
    && job.callerUserId === userId
    && (job.callerOrgId || '') === (orgId || '');
}

/**
 * Create the record BEFORE the worker is invoked. If the self-invoke fails, the
 * client still has something to poll that explains why, instead of a jobId that
 * 404s forever.
 *
 * `sealFor` — the caller's organisation, or absent — seals `request` and the
 * empty `items` from the row's first write.
 */
async function createJob(dynamodb, tableName, {
  jobId, kind, requested, request = {}, caller = {}, sealFor = '',
}) {
  const now = new Date().toISOString();
  const content = await sealJobFields(sealFor, { items: [], request });
  const item = {
    ...jobKey(jobId),
    jobId,
    kind,
    status: STATUS.QUEUED,
    // WHO ASKED. Captured here, on the authorised POST, because the worker is
    // invoked with `InvocationType: 'Event'` and carries no authorizer context
    // at all — see shared/generated-set.js, note 3. The job row is the carrier
    // rather than the dispatch payload for two reasons: the row already exists
    // before the dispatch and is already what the client polls, so there is one
    // truth and not two that can disagree; and `__workerMode` is an invocation
    // path with no authorizer, so an owner read out of the payload would be an
    // owner whoever invoked the function chose. This row can only be written by
    // the POST that CognitoAuthorizer let through.
    //
    // Absent when the caller could not be identified, which records no owner
    // rather than an owner of '' — the same rule question-set-access.js's
    // `ownerStamp` follows, and for the same reason.
    ...(caller.userId ? { callerUserId: caller.userId } : {}),
    ...(caller.username && caller.username !== 'unknown'
      ? { callerUsername: caller.username } : {}),
    // WHOSE LIBRARY THE RESULT BELONGS IN. Same rule as the two above: written
    // only when the POST actually carried one, so Engage staff authoring the
    // shared library (no active org, by design — see tenant.canManageScope)
    // leave both absent and keep writing platform content.
    ...(caller.orgId ? { callerOrgId: caller.orgId } : {}),
    ...(caller.orgRole ? { callerOrgRole: caller.orgRole } : {}),
    requested,
    completed: 0,
    phase: 'Queued',
    items: content.items,
    warnings: [],
    request: content.request,
    createdAt: now,
    updatedAt: now,
    ttl: ttlFromNow(),
  };
  await dynamodb.send(new PutCommand({ TableName: tableName, Item: item }));
  return item;
}

/** Seal whichever of `items` and `meta` this write carries. */
async function sealedContent(sealFor, { items, meta }) {
  const content = {};
  if (Array.isArray(items)) content.items = items;
  if (meta && typeof meta === 'object') content.meta = meta;
  return sealJobFields(sealFor, content);
}

/**
 * Incremental progress, not just a terminal result.
 *
 * A four-minute job that reports nothing until it finishes is indistinguishable
 * from a hung one, which is most of why the old failure felt so bad. `items` is
 * written on every update too, so a worker that dies mid-run still leaves the
 * scenarios it already produced behind rather than throwing them away.
 */
async function updateJobProgress(dynamodb, tableName, jobId, {
  completed, phase, items, warnings, meta, sealFor = '',
}) {
  const sets = ['#status = :running', 'updatedAt = :now'];
  const names = { '#status': 'status' };
  const values = { ':running': STATUS.RUNNING, ':now': new Date().toISOString() };
  const content = await sealedContent(sealFor, { items, meta });

  if (typeof completed === 'number') { sets.push('completed = :completed'); values[':completed'] = completed; }
  if (phase) { sets.push('phase = :phase'); values[':phase'] = phase; }
  if ('items' in content) { sets.push('#items = :items'); names['#items'] = 'items'; values[':items'] = content.items; }
  if (Array.isArray(warnings)) { sets.push('warnings = :warnings'); values[':warnings'] = warnings; }
  // Set-level result, distinct from the items: the survey builder's AI-improved
  // title and description. Written only when a worker actually produced one, so
  // every existing caller is unaffected.
  if ('meta' in content) { sets.push('#meta = :meta'); names['#meta'] = 'meta'; values[':meta'] = content.meta; }

  await dynamodb.send(new UpdateCommand({
    TableName: tableName,
    Key: jobKey(jobId),
    UpdateExpression: `SET ${sets.join(', ')}`,
    ExpressionAttributeNames: names,
    ExpressionAttributeValues: values,
  }));
}

async function completeJob(dynamodb, tableName, jobId, {
  items, warnings = [], meta, promptSource, sealFor = '',
}) {
  const content = await sealedContent(sealFor, { items, meta });
  const sets = [
    '#status = :status', '#items = :items', 'warnings = :warnings',
    'completed = :completed', 'phase = :phase', 'updatedAt = :now',
  ];
  const names = { '#status': 'status', '#items': 'items' };
  const values = {
    ':status': STATUS.COMPLETE,
    ':items': content.items,
    ':warnings': warnings,
    ':completed': items.length,
    ':phase': `Generated ${items.length} of ${items.length}`,
    ':now': new Date().toISOString(),
  };
  // Omitted meta must LEAVE an earlier one alone, not overwrite it with null —
  // the survey worker writes meta on its first pass and completes much later.
  if ('meta' in content) { sets.push('#meta = :meta'); names['#meta'] = 'meta'; values[':meta'] = content.meta; }
  /*
    WHICH PROMPT PRODUCED THIS. Not a warning — a warning is for a problem, and
    this is provenance, wanted just as much when the run went well. Without it,
    editing a generation prompt and re-running tells you nothing about whether
    the edit was used, which is how "I changed it and nothing happened" starts.
    Omitted leaves an earlier value alone, for the same reason meta does.
  */
  if (promptSource && typeof promptSource === 'object') {
    sets.push('promptSource = :promptSource');
    values[':promptSource'] = promptSource;
  }

  await dynamodb.send(new UpdateCommand({
    TableName: tableName,
    Key: jobKey(jobId),
    UpdateExpression: `SET ${sets.join(', ')}`,
    ExpressionAttributeNames: names,
    ExpressionAttributeValues: values,
  }));
}

/**
 * Failure keeps whatever was already produced. A run that generated 14 of 20
 * and then hit a Bedrock error is far more useful surfaced as "14 scenarios and
 * here is what went wrong" than as a bare error.
 */
async function failJob(dynamodb, tableName, jobId, message, { items, sealFor = '' } = {}) {
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
    values[':items'] = (await sealedContent(sealFor, { items })).items;
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

/** What a job that recorded nobody is failed with. Our words, never content. */
const UNOWNED_JOB_MESSAGE = 'This job recorded no signed-in user, so nothing was generated. '
  + 'Sign in again and start it from the builder.';

/**
 * WHO ASKED, as a generation worker must establish it before it spends or
 * writes anything — or `null`, and the worker stops.
 *
 * The worker is invoked with `InvocationType: 'Event'` and has no authorizer
 * context, so the caller exists only on this row (createJob). An empty caller
 * is not a neutral default: `sealFor` becomes '' and the org's content is
 * written to the row in plaintext, and createSetForJob's synthetic event reads
 * as an INTERNAL invocation, which files the set in Engage's shared platform
 * library. So there are three ways to have no caller, and none of them runs:
 *
 *   - THE READ THROWS. Propagated, so the invocation fails and Lambda's async
 *     retry re-reads. Nothing has been spent or written yet, which is what
 *     makes the retry safe: Bedrock is paid for once, by whichever attempt
 *     could read its row. Failing the job instead would write to the very row
 *     that could not be read, and turn a blip into a lost run.
 *   - THE ROW IS ABSENT. `null`, with nothing written: an update would upsert
 *     an ownerless row with no ttl, and a retry would find it just as absent.
 *     The read is STRONGLY CONSISTENT so this is the truth — the POST put the
 *     row moments ago, and a replica that has not applied it yet answers "no
 *     item" to an eventually consistent read.
 *   - THE ROW NAMES NO USER. `null`, and the job is failed with a sentence:
 *     it can never be read back (isCallersJob), so there is no one to generate
 *     for. POSTs with no user have been refused with 401 since the ownership
 *     fix; this is the refusal for any row that predates it.
 */
async function workerCaller(dynamodb, tableName, jobId) {
  const res = await dynamodb.send(new GetCommand({
    TableName: tableName, Key: jobKey(jobId), ConsistentRead: true,
  }));
  const row = res.Item;
  if (!row) {
    console.error(`❌ Job ${jobId}: no job row, so no caller; generating nothing`);
    return null;
  }
  if (!row.callerUserId) {
    console.error(`❌ Job ${jobId}: the row names no user; generating nothing`);
    await failJob(dynamodb, tableName, jobId, UNOWNED_JOB_MESSAGE);
    return null;
  }
  return {
    userId: row.callerUserId,
    username: row.callerUsername,
    orgId: row.callerOrgId,
    orgRole: row.callerOrgRole,
  };
}

/**
 * Poll payload. Deliberately omits `request` — the client already has it — and
 * the caller identity, which is nobody's business but the worker's.
 *
 * Give it the row `openJob` returned, and only once `isCallersJob` said yes: a
 * sealed row passed straight in would hand the owner envelopes.
 *
 * `createdSet` is the field that stops the client creating a SECOND set. The
 * worker writes it BEFORE the job goes terminal, so any client that sees a
 * terminal job also sees the set; a `null` here genuinely means no set exists
 * and the manual "Load into System" path is the right thing to offer.
 */
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
    meta: item.meta || null,
    // Provenance, so the client can say which generation prompt ran.
    promptSource: item.promptSource || null,
    error: item.errorMessage || null,
    createdSet: item.createdSetId
      ? { setId: item.createdSetId, setName: item.createdSetName || item.createdSetId }
      : null,
    setCreationError: item.setCreationError || null,
    // The importer's 402 when the refusal was the stored-set allowance, whole
    // (generated-set.js) — so the builder can say who can fix it.
    setCreationLimit: item.setCreationLimit || null,
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
  workerCaller,
  jobToResponse,
  sealJobFields,
  openJob,
  isCallersJob,
};
