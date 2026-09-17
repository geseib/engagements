// lambda-functions/admin/shared/set-check-worker.js
/**
 * THE CHECK, RUN AS A WORKER — spec §4.
 *
 * Invoked with `InvocationType: 'Event'` and no authorizer context: WHO asked
 * is read from the job row, which only the authorised POST could have written
 * (generation-jobs.js, createJob). Everything the worker decides lands in rows
 * — the REVIEW row, the share stamp, the log, the queue — never only in the
 * job response, so a closed browser changes nothing.
 *
 * Order matters and is deliberate:
 *   snapshot → S3        so a person can review exactly what was judged
 *   guardrail            per question, then the set prose as one more subject
 *   explanations         flagged/escalated only — a handful of Haiku calls
 *   REVIEW row           the gate
 *   log, queue, publish  the record, the person, the library
 *
 * Everything unknown fails toward a person (spec §11): a thrown error, a
 * snapshot that would not upload, an image the text filters cannot see, a
 * declared notice, a budget that ran out — each escalates with its reason.
 */
const { GetCommand } = require('@aws-sdk/lib-dynamodb');
const { PutObjectCommand } = require('@aws-sdk/client-s3');
const { InvokeModelCommand } = require('@aws-sdk/client-bedrock-runtime');
const tenant = require('./tenant');
const { setRef, setMetadataKey, resolvePartitionFromMeta, toVersion, queryPartition } = require('./set-version');
const { decryptItem } = require('./tenant-crypto');
const { writeReview, STATUS } = require('./set-review');
const { checkQuestions, checkText, OUTCOME } = require('./content-guardrail');
const { buildSnapshot, contentHash, questionText, setText, snapshotHasImages } = require('./publishable');
const { explainFindings } = require('./finding-explanations');
const { publishSnapshot, platformPromptExists } = require('./publish-set');
const { writeShareStamp } = require('./share-stamp');
const { appendReviewEvent } = require('./review-log');
const { upsertQueueRow } = require('./moderation-queue');
const { recordUnits } = require('./check-quota');
const { getJob, updateJobProgress, completeJob, failJob } = require('./generation-jobs');

const BUDGET_FLOOR_MS = 20000;
const AS_STATUS = { [OUTCOME.PASSED]: STATUS.PASSED, [OUTCOME.FLAGGED]: STATUS.FLAGGED, [OUTCOME.ESCALATED]: STATUS.ESCALATED };
const worstOf = (a, b) => {
  const rank = { [OUTCOME.FLAGGED]: 0, [OUTCOME.ESCALATED]: 1, [OUTCOME.PASSED]: 2 };
  return rank[a] <= rank[b] ? a : b;
};
const snapshotKeyFor = (source, version, checkedAt) => `moderation/${source.orgId}/${source.setId}/v${version}/${String(checkedAt).replace(/[:.]/g, '-')}.json`;
const minimalFinding = ({ questionId, category, band }) => ({ questionId: questionId === undefined ? null : questionId, category, band });

async function runSetCheck({ db, tableName, s3, bucket, bedrock }, { jobId }, context) {
  const job = await getJob(db, tableName, jobId);
  if (!job) { console.error(`🔎 check job ${jobId}: no job row`); return; }
  const orgId = job.callerOrgId;
  const request = job.request || {};
  const source = setRef({ scope: tenant.ORG, orgId, setId: request.setId });
  const version = toVersion(request.version);
  const checkedAt = new Date().toISOString();
  const declaredNotice = Array.isArray(request.declaredNotice) ? request.declaredNotice : [];
  const reasons = [];
  let findings = []; let checked = 0; let clean = 0;

  try {
    await updateJobProgress(db, tableName, jobId, { completed: 0, phase: 'Reading the set…' });
    const meta = (await db.send(new GetCommand({ TableName: tableName, Key: setMetadataKey(source) }))).Item;
    if (!meta) throw new Error('That set no longer exists');
    const resolved = resolvePartitionFromMeta(source, meta, version);
    const { items: rows } = await queryPartition(db, tableName, resolved.pk);
    const plainMeta = await decryptItem(orgId, 'set', meta);
    const questions = []; const categories = [];
    for (const row of rows) {
      const sk = String(row.SK || '');
      if (sk.startsWith('QUESTION#')) questions.push(await decryptItem(orgId, 'question', row)); // eslint-disable-line no-await-in-loop
      else if (sk.startsWith('CATEGORY#')) categories.push(row);
    }
    const snapshot = buildSnapshot({ source, version, meta: plainMeta, categories, questions, checkedAt });
    snapshot.contentHash = contentHash(snapshot);
    const promptDropped = Boolean(plainMeta.promptId) && !(await platformPromptExists(db, tableName, plainMeta.promptId));

    let snapshotKey = snapshotKeyFor(source, version, checkedAt);
    try {
      await s3.send(new PutObjectCommand({ Bucket: bucket, Key: snapshotKey, Body: JSON.stringify(snapshot), ContentType: 'application/json' }));
    } catch (error) {
      console.warn(`⚠️ snapshot upload failed for ${orgId}/${source.setId} v${version}: ${error.message}`);
      reasons.push('snapshot');
      snapshotKey = null;
    }
    if (snapshotHasImages(snapshot)) reasons.push('images');
    if (declaredNotice.length) reasons.push('declared');

    const remaining = () => (context && typeof context.getRemainingTimeInMillis === 'function' ? context.getRemainingTimeInMillis() : Infinity);
    const result = await checkQuestions(
      questions.map((q) => ({ id: String(q.SK).replace('QUESTION#', ''), text: questionText(q) })),
      {
        budget: () => remaining() > BUDGET_FLOOR_MS,
        onEach: (i, n) => {
          if (i % 5 === 0 || i === n) updateJobProgress(db, tableName, jobId, { completed: i, phase: `Checking ${i} of ${n}` }).catch(() => {});
        },
      },
    );
    const setResult = await checkText(setText(plainMeta, categories), '(set)');
    findings = [...result.findings, ...setResult.findings];
    checked = result.checked + setResult.checked;
    clean = result.clean + setResult.clean;
    if (result.stopped) reasons.push('timeout');
    if (findings.some((f) => String(f.band).toUpperCase() === 'MEDIUM')) reasons.push('guardrail');

    let status = AS_STATUS[worstOf(result.outcome, setResult.outcome)] || STATUS.ESCALATED;
    if (status !== STATUS.FLAGGED && reasons.length) status = STATUS.ESCALATED;
    if (status !== STATUS.PASSED) findings = await explainFindings(bedrock, InvokeModelCommand, snapshot, findings);

    await recordUnits(db, tableName, orgId, checked);
    await writeReview(db, tableName, source, version, {
      status, findings, note: `${clean}/${checked} clean`, jobId,
      contentHash: snapshot.contentHash, snapshotKey, reasons, checkedBy: job.callerUserId || null,
      promptDropped, declaredNotice,
    });
    await appendReviewEvent(db, tableName, source, 'checked', {
      version, outcome: status, reasons, checked, clean, contentHash: snapshot.contentHash, snapshotKey,
      findings: findings.map(minimalFinding), by: job.callerUserId || null,
    });

    let published = null;
    if (status === STATUS.ESCALATED) {
      const bands = {};
      for (const f of findings) if (f.band && f.band !== 'NONE') bands[f.category] = f.band;
      await upsertQueueRow(db, tableName, {
        ref: source, version, reason: 'escalated',
        orgId, orgName: await orgName(db, tableName, orgId), setId: source.setId, title: plainMeta.name || source.setId,
        gameType: plainMeta.engagementType || '', questionCount: questions.length, bands,
        uncertainQuestionIds: findings.filter((f) => f.questionId && f.questionId !== '(set)').map((f) => f.questionId),
        snapshotKey, contentHash: snapshot.contentHash,
      });
      await appendReviewEvent(db, tableName, source, 'escalated', { version, reasons });
      await writeShareStamp(db, tableName, source, { version, status: 'escalated', contentHash: snapshot.contentHash, reasons, jobId });
    } else if (status === STATUS.PASSED && request.publish !== false) {
      published = await publishSnapshot(db, tableName, snapshot, {
        review: { findings, note: `${clean}/${checked} clean` }, sourceOrgName: await orgName(db, tableName, orgId), promptDropped,
      });
      await writeShareStamp(db, tableName, source, {
        version, status: 'published', publicSetId: published.publicSetId, publicVersion: published.publicVersion, contentHash: snapshot.contentHash,
      });
      await appendReviewEvent(db, tableName, source, 'published', {
        version, publicSetId: published.publicSetId, publicVersion: published.publicVersion, contentHash: snapshot.contentHash, promptDropped,
      });
    } else {
      await writeShareStamp(db, tableName, source, { version, status, contentHash: snapshot.contentHash, jobId });
    }

    await completeJob(db, tableName, jobId, {
      items: findings.map(minimalFinding),
      meta: {
        outcome: status, version, checked, clean, reasons, promptDropped,
        publicSetId: published ? published.publicSetId : null,
        publicVersion: published ? published.publicVersion : null,
      },
    });
    console.log(`🔎 ${orgId}/${source.setId} v${version}: ${status} (${clean}/${checked} clean)${published ? ` → public ${published.publicSetId} v${published.publicVersion}` : ''}`);
  } catch (error) {
    console.error(`❌ check job ${jobId} failed:`, error);
    try {
      await writeReview(db, tableName, source, version, {
        status: STATUS.ESCALATED, findings, note: error.message, jobId, reasons: ['error'], checkedBy: job.callerUserId || null,
      });
      await appendReviewEvent(db, tableName, source, 'checked', { version, outcome: STATUS.ESCALATED, reasons: ['error'], error: error.message });
      await upsertQueueRow(db, tableName, {
        ref: source, version, reason: 'escalated', orgId, setId: source.setId, title: source.setId, questionCount: 0, bands: {}, orgName: await orgName(db, tableName, orgId),
      });
      await appendReviewEvent(db, tableName, source, 'escalated', { version, reasons: ['error'] });
      await writeShareStamp(db, tableName, source, { version, status: 'escalated', reasons: ['error'], jobId });
    } catch (inner) {
      console.error(`❌ and could not record the failure: ${inner.message}`);
    }
    await failJob(db, tableName, jobId, `The check could not finish: ${error.message}`);
  }
}
async function orgName(db, tableName, orgId) {
  try {
    const row = (await db.send(new GetCommand({ TableName: tableName, Key: { PK: tenant.orgPk(orgId), SK: 'METADATA' } }))).Item;
    return (row && row.name) || '';
  } catch { return ''; }
}
module.exports = { runSetCheck, snapshotKeyFor, BUDGET_FLOOR_MS };
