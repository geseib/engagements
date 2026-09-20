/**
 * RUN THE CONTENT CHECK ON ONE VERSION, AND RECORD WHAT IT SAID.
 *
 *   POST /question-sets/{setId}/check   { version }
 *
 * (No `/admin` in the path, whatever this docstring said before: the template
 * mounts it at `/question-sets/{setId}/check` and the dialog calls exactly that
 * — src/src/components/ShareSetDialog.jsx via adminApiUrl.)
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
 *
 * ── AND STAFF RE-RUNNING ONE THE LIBRARY ALREADY SERVES ────────────────
 *
 *   POST /question-sets/{publicSetId}/check   { recheck: true }
 *
 * The owner, of the public sets they already have: the score card shows nothing
 * of what the check measured, because those checks predate the measuring. The
 * only cure is to run the check again — and the ordinary route PUBLISHES, which
 * for a live listing would mint a second public version of identical content
 * (publish-set.js bumps without `resume`), move the author's share stamp off
 * `published`, and replace the review row that records a person's approval.
 *
 * So `recheck` is a different request, defined by what it must not disturb, and
 * the differences all live in the four arguments `startCheck` takes for it:
 *
 *   the version    is the PUBLIC row's `sourceVersion` and nothing else — NULL
 *                  included, which is the legacy partition and is what three of
 *                  the four entries on dev carry. A caller naming any other
 *                  version is refused, so this is not a way to read an
 *                  organisation's other content. Only staff acting as Engage
 *                  may ask at all (`tenant.canManageScope`'s interlock).
 *   `publish`      false, always.
 *   `stamp`        false: the author's set goes on reading `published`.
 *   `keep`/`restore` carry the human decision across the lock and back out of a
 *                  failed dispatch (`set-review.decisionOf`, `abandonCheck`).
 *
 * The organisation's daily cap is not reserved for it either: the work is
 * Engage's, and twenty re-checks would otherwise lock an author out of sharing
 * for the day. The guardrail calls are still counted, on `staffUnits`.
 *
 * ── AND ENGAGE'S OWN SETS, WHICH NOTHING HAS EVER CHECKED ──────────────────
 *
 *   POST /question-sets/{setId}/check          as Engage, with no org
 *
 * A PLATFORM set is served to every organisation, so it reaches further than
 * anything in the public library, and it is the one library with no measurement
 * at all (spec §10.5, parked since). It is checked the same way — the same
 * worker, the same guardrail, the same REVIEW row — and differs in what it must
 * not do, which is everything an organisation's share does afterwards:
 *
 *   nothing publishes    `publish: false`. There is no public copy of an Engage
 *                        set to mint: the set already IS what every
 *                        organisation reads.
 *   nothing is stamped   `stamp: false`. A share stamp is an author's account of
 *                        where their set went, and this set has no author
 *                        outside Engage and has gone nowhere.
 *   nobody is charged    `reserveSubmit` is not called and no units are
 *                        recorded: there is no organisation whose cap could be
 *                        spent, and `staffUnits` lives on an organisation's own
 *                        row. The set's review log carries what was checked.
 *   only staff may ask   `tenant.canManageScope(PLATFORM)` — the `admins` group
 *                        AND no active organisation. No flag in the body selects
 *                        this branch, because none could: a caller inside an
 *                        organisation always has an orgId and is answered by the
 *                        branch below, and one without an orgId who is not staff
 *                        is refused exactly as before.
 *
 * An outcome worse than `passed` — `flagged` included, since unlike an
 * organisation's submission there is no author being told to fix it — raises a
 * queue row on `PLATFORM#<setId>`, the key §3.2 reserves for Engage's own set.
 */
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, GetCommand } = require('@aws-sdk/lib-dynamodb');
const { S3Client } = require('@aws-sdk/client-s3');
const { BedrockRuntimeClient } = require('@aws-sdk/client-bedrock-runtime');
const { LambdaClient, InvokeCommand } = require('@aws-sdk/client-lambda');
const {
  setMetadataKey, resolvePartitionFromMeta, toVersion, setRef, setPartition, queryPartition,
} = require('./shared/set-version');
const tenant = require('./shared/tenant');
const { callerUserId } = require('./shared/question-set-access');
const { callerUsername } = require('./shared/require-admin');
const { beginCheck, abandonCheck, readReview, decisionOf, declarationOf } = require('./shared/set-review');
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

/** Whose content this is, for a log line: an org id, or the library's name. */
const sourceLabel = (source) => source.orgId || source.scope;

/**
 * TAKE THE LOCK, WRITE THE JOB, DISPATCH THE WORKER — for all three callers.
 *
 * One routine rather than three because each of the three failure paths has to
 * undo exactly what the step before it did: a lock somebody else holds is a 409
 * and nothing more, a job row that would not write releases the lock, and a
 * dispatch that would not go releases the lock AND fails the job so the client
 * polls an explanation instead of a jobId that 404s for ever. Two copies of
 * that would drift, and the half that drifted would leave a version `checking`
 * for the stale window with nothing running.
 */
async function startCheck({
  source, version, request, caller, requested, keep = null, restore = null, stamp = true,
}, context) {
  const jobId = newJobId();
  if (!await beginCheck(db, TABLE(), source, version, { jobId, keep })) {
    return json(409, { error: 'This version is already being checked.', status: 'checking' });
  }
  try {
    await createJob(db, TABLE(), { jobId, kind: 'set-check', requested, request, caller });
  } catch (error) {
    // The lock was taken for a job that will never exist: release it now
    // rather than leaving the version "checking" for the stale window.
    await abandonCheck(db, TABLE(), source, version, { jobId, restore });
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
    await abandonCheck(db, TABLE(), source, version, { jobId, restore });
    await failJob(db, TABLE(), jobId, `Could not start the content check: ${error.message}`);
    return json(500, { error: `Could not start the content check: ${error.message}`, jobId });
  }
  if (stamp) {
    try {
      await writeShareStamp(db, TABLE(), source, { version, status: 'checking', jobId });
    } catch (error) {
      // The worker is already running and writes the real outcome over this
      // stamp; the submit succeeded and must say so.
      console.warn(`⚠️ share stamp not written for ${source.orgId}/${source.setId} v${version} (${error.message}); the worker will write the outcome`);
    }
  }
  console.log(`🔎 dispatched check ${jobId} for ${sourceLabel(source)}/${source.setId} v${version}${request.recheck ? ' (staff re-check)' : ''}${request.platform ? ' (Engage\'s own set)' : ''}`);
  return json(202, {
    jobId, version, status: 'queued',
    ...(request.recheck ? { recheck: true } : {}),
    ...(request.platform ? { platform: true } : {}),
  });
}


/**
 * THE PLATFORM RE-CHECK. Everything about which set and which version is read
 * from the PUBLIC metadata row — never from the request — which is what makes
 * this path unable to reach any content the library is not already serving.
 */
async function recheckPublished(event, publicSetId, body, context) {
  const pubRef = setRef({ scope: tenant.PUBLIC, orgId: '', setId: publicSetId });
  const pubMeta = (await db.send(new GetCommand({ TableName: TABLE(), Key: setMetadataKey(pubRef) }))).Item;
  if (!pubMeta) return fail(404, 'No such public set.');
  const source = setRef({ scope: tenant.ORG, orgId: String(pubMeta.sourceOrgId || ''), setId: String(pubMeta.sourceSetId || '') });
  if (!source.orgId || !source.setId) return fail(409, 'That public entry does not name the organisation it came from.');

  // NULL IS A VERSION: the legacy, unsuffixed partition. A caller may confirm
  // the version it means and may not choose another one.
  const version = toVersion(pubMeta.sourceVersion);
  if (body.version !== undefined && body.version !== null && toVersion(body.version) !== version) {
    const named = version ? `version ${version}` : 'the unversioned content';
    return fail(400, `Only the version this entry was published from can be re-checked — ${named}.`);
  }

  const meta = (await db.send(new GetCommand({ TableName: TABLE(), Key: setMetadataKey(source) }))).Item;
  if (!meta) return fail(404, 'The organisation no longer has the set this entry was published from.');
  // The EXACT partition that version names, never a resolution: with the
  // version deleted, or absent as it is for a legacy set the organisation has
  // since versioned, `resolvePartitionFromMeta` substitutes the organisation's
  // active version — and the check would judge content nobody published while
  // the review row it wrote claimed to describe the published one.
  const { items } = await queryPartition(db, TABLE(), setPartition(source, version), 'QUESTION#');
  if (!items.length) {
    return fail(409, 'The organisation no longer holds the questions this entry was published from, so there is nothing to re-check.');
  }

  const previous = await readReview(db, TABLE(), source, version);
  return startCheck({
    source,
    version,
    requested: items.length,
    request: {
      setId: source.setId, version, publish: false, declaredNotice: [], recheck: true, publicSetId,
    },
    // WHO: the staff member, so the organisation's log names them. WHOSE
    // CONTENT: the source org, which is what the worker decrypts and reads with.
    caller: { userId: callerUserId(event), username: callerUsername(event), orgId: source.orgId },
    // ACROSS THE LOCK: the human decision, and the notice the AUTHOR declared.
    // `declaredNotice: []` in the request above is deliberate — a re-check does
    // not re-declare anything, it inherits, and the worker reads what it
    // inherits off the lock row these two put there. Without them beginCheck's
    // Put would replace the review row and the worker would write its own empty
    // list over both.
    keep: { ...decisionOf(previous), ...declarationOf(previous) },
    restore: previous,
    stamp: false,
  }, context);
}

/**
 * ENGAGE'S OWN SET. Reached only by staff acting as Engage, and only for a set
 * that is really in the platform library — the metadata read below is against
 * the platform partition and nothing else, so this branch cannot be steered at
 * an organisation's content by the id in the path.
 *
 * The version is resolved the ordinary way (`resolvePartitionFromMeta`) rather
 * than pinned the way a re-check pins one: a re-check exists to judge what the
 * library is ALREADY serving, which may not be the active version, while an
 * Engage set's active version IS what every organisation plays. A caller may
 * still name one explicitly, which is how a version that is not active gets
 * looked at before it is promoted.
 */
async function checkPlatformSet(event, setId, body, context) {
  const source = setRef({ scope: tenant.PLATFORM, orgId: '', setId });
  const meta = (await db.send(new GetCommand({ TableName: TABLE(), Key: setMetadataKey(source) }))).Item;
  if (!meta) return fail(404, 'That set is not one of Engage\'s.');
  const { version } = resolvePartitionFromMeta(source, meta, toVersion(body.version));

  // ACROSS THE LOCK, for the same reason the re-check carries them: `beginCheck`
  // replaces the row, so a decision a person made about this version — and a
  // notice declared on it — would be gone the moment a second check started,
  // and gone for good if the dispatch then failed.
  const previous = await readReview(db, TABLE(), source, version);
  return startCheck({
    source,
    version,
    requested: Number(meta.questionCount) || 0,
    request: {
      setId, version, publish: false, declaredNotice: [], platform: true,
    },
    // WHO: the staff member. WHOSE CONTENT: nobody's — there is no orgId here,
    // and the worker reads that absence as "platform, and plaintext".
    caller: { userId: callerUserId(event), username: callerUsername(event) },
    keep: { ...decisionOf(previous), ...declarationOf(previous) },
    restore: previous,
    stamp: false,
  }, context);
}

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
  // Engage staff, AND acting as Engage rather than standing inside a customer's
  // team — tenant.canManageScope's interlock, not the group alone.
  const asEngage = tenant.canManageScope(event, tenant.PLATFORM, '');

  // THE POLL, TENANT-SCOPED. A job id is not a capability: the org that asked
  // may read the answer, and staff acting as Engage may read a re-check, which
  // is the only kind of job they can start. Anything else is "not found", never
  // "not yours".
  const jobIdParam = event?.pathParameters?.jobId;
  if (method === 'GET' || jobIdParam) {
    if (!jobIdParam) return fail(400, 'jobId is required');
    if (!orgId && !asEngage) return fail(400, 'Choose an organisation before checking a question set.');
    const job = await getJob(db, TABLE(), jobIdParam);
    const staffJob = (job && job.request && (job.request.recheck === true || job.request.platform === true)) === true;
    const mine = Boolean(job) && job.kind === 'set-check'
      && ((orgId && job.callerOrgId === orgId) || (asEngage && staffJob));
    if (!mine) return fail(404, 'Job not found or expired');
    return json(200, jobToResponse(job));
  }

  let body = {};
  try { body = JSON.parse(event.body || '{}'); } catch { return fail(400, 'That request body is not JSON.'); }

  try {
    // STAFF RE-RUNNING A PUBLISHED VERSION'S CHECK. Asked for explicitly, so
    // nothing an organisation sends can land here by accident, and refused for
    // everyone else — an organisation keeps exactly the check it had.
    if (body.recheck === true) {
      if (!asEngage) {
        return fail(403, 'Only Engage staff, acting as Engage, can re-run the check on a set the public library serves.');
      }
      return await recheckPublished(event, setId, body, context);
    }

    // ENGAGE'S OWN LIBRARY. Staff acting as Engage have no active organisation
    // by definition (tenant.canManageScope's interlock), so this is where they
    // land — and this used to be the sentence that turned them away. A caller
    // with no org who is NOT staff is still told exactly what they were told
    // before, which is the whole of the change to this path.
    if (!orgId) {
      if (asEngage) return await checkPlatformSet(event, setId, body, context);
      return fail(400, 'Choose an organisation before checking a question set.');
    }
    // The same bar as publishing: this is the step before it.
    if (!tenant.canManageScope(event, tenant.ORG, orgId, 'admin')) {
      return fail(403, 'Only an owner or admin of this organisation can submit a set for review.');
    }
    const source = setRef({ scope: tenant.ORG, orgId, setId });
    const meta = (await db.send(new GetCommand({ TableName: TABLE(), Key: setMetadataKey(source) }))).Item;
    if (!meta) return fail(404, 'That set is not one of yours.');
    const resolved = resolvePartitionFromMeta(source, meta, toVersion(body.version));
    const version = resolved.version;

    const cap = Number(process.env.CHECK_DAILY_CAP) || DEFAULT_DAILY_CAP;
    const quota = await reserveSubmit(db, TABLE(), orgId, { cap });
    if (!quota.ok) return json(429, { error: `This organisation has used today's ${cap} checks. Try again tomorrow.`, cap });

    return await startCheck({
      source,
      version,
      requested: Number(meta.questionCount) || 0,
      request: {
        setId, version,
        publish: body.publish !== false,
        declaredNotice: Array.isArray(body.declaredNotice) ? body.declaredNotice.map(String).slice(0, 8) : [],
      },
      caller: { userId: callerUserId(event), username: callerUsername(event), orgId, orgRole: tenant.callerOrgRole(event) },
    }, context);
  } catch (error) {
    console.error('check error:', error);
    return fail(500, `Could not check that set: ${error.message}`);
  }
};
