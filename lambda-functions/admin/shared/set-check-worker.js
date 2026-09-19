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
 *   explanations         what it saw, worst first — at most 12 Haiku calls
 *   REVIEW row           the gate, and what the check measured (the tally)
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
const { checkQuestions, checkText, tallyOf, OUTCOME } = require('./content-guardrail');
const { buildSnapshot, contentHash, questionText, setText, snapshotHasImages } = require('./publishable');
const { explainFindings } = require('./finding-explanations');
const { publishSnapshot, platformPromptExists } = require('./publish-set');
const { writeShareStamp } = require('./share-stamp');
const { appendReviewEvent } = require('./review-log');
const { upsertQueueRow } = require('./moderation-queue');
const { recordUnits } = require('./check-quota');
const { getJob, updateJobProgress, completeJob, failJob } = require('./generation-jobs');

const BUDGET_FLOOR_MS = 20000;
// A declared notice on the queue row is an id ("graphic-medical"), at most 40
// characters wherever one is checked (moderation-decide.js NOTICE_ID). The
// entry point caps how many (check-question-set.js) but not how long, and the
// row is a pointer: ≤4KB, because the whole queue is read in one Query (spec §3.2).
const NOTICE_CHARS = 40;
const AS_STATUS = { [OUTCOME.PASSED]: STATUS.PASSED, [OUTCOME.FLAGGED]: STATUS.FLAGGED, [OUTCOME.ESCALATED]: STATUS.ESCALATED };
const worstOf = (a, b) => {
  const rank = { [OUTCOME.FLAGGED]: 0, [OUTCOME.ESCALATED]: 1, [OUTCOME.PASSED]: 2 };
  return rank[a] <= rank[b] ? a : b;
};
const snapshotKeyFor = (source, version, checkedAt) => `moderation/${source.orgId}/${source.setId}/v${version}/${String(checkedAt).replace(/[:.]/g, '-')}.json`;
const minimalFinding = ({ questionId, category, band }) => ({ questionId: questionId === undefined ? null : questionId, category, band });

/**
 * Every finding is also an observation (the same filter, seen and held), and
 * the sentences are written for the observations. The review dialog and the
 * author's banner read FINDINGS, so each finding carries its observation's.
 */
function withExplanations(findings, observed) {
  const said = new Map();
  for (const o of observed) {
    const k = `${o.questionId}|${o.category}`;
    if (o.explanation && !said.has(k)) said.set(k, o.explanation);
  }
  return findings.map((f) => {
    const explanation = said.get(`${f.questionId}|${f.category}`);
    return explanation ? { ...f, explanation } : f;
  });
}

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
  // Hoisted like `findings`: a check that measured everything and then failed
  // in bookkeeping still records what it measured. Null until it has.
  let observed = null; let tally = null;
  // Hoisted above the try: the snapshot is uploaded early and a failure any
  // time after that must still be able to point a reviewer at it, rather
  // than orphaning the S3 object the moment something downstream throws.
  let snapshot = null; let snapshotKey = null;

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
    snapshot = buildSnapshot({ source, version, meta: plainMeta, categories, questions, checkedAt });
    snapshot.contentHash = contentHash(snapshot);
    const promptDropped = Boolean(plainMeta.promptId) && !(await platformPromptExists(db, tableName, plainMeta.promptId));

    snapshotKey = snapshotKeyFor(source, version, checkedAt);
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
    const inBudget = () => remaining() > BUDGET_FLOOR_MS;
    const result = await checkQuestions(
      questions.map((q) => ({ id: String(q.SK).replace('QUESTION#', ''), text: questionText(q) })),
      {
        budget: inBudget,
        onEach: (i, n) => {
          if (i % 5 === 0 || i === n) updateJobProgress(db, tableName, jobId, { completed: i, phase: `Checking ${i} of ${n}` }).catch(() => {});
        },
      },
    );
    // A budget already declared exhausted is not spent on one more call.
    const setResult = result.stopped
      ? { outcome: OUTCOME.PASSED, findings: [], observed: [], checked: 0, clean: 0 }
      : await checkText(setText(plainMeta, categories), '(set)');
    findings = [...result.findings, ...setResult.findings];
    observed = [...result.observed, ...setResult.observed];
    // What was MEASURED — every band seen, per category, in questions. It
    // decides nothing: the status below is computed from findings alone. The
    // set's own text was reached unless the budget stopped the check first;
    // whether the guardrail READ it, tallyOf tells from the findings.
    tally = tallyOf({ observed, findings, questions: result.checked, setTextReached: !result.stopped });
    checked = result.checked + setResult.checked;
    clean = result.clean + setResult.clean;
    const note = `${clean}/${checked} clean`;
    if (result.stopped) reasons.push('timeout');
    if (findings.some((f) => String(f.band).toUpperCase() === 'MEDIUM')) reasons.push('guardrail');

    let status = AS_STATUS[worstOf(result.outcome, setResult.outcome)] || STATUS.ESCALATED;
    if (status !== STATUS.FLAGGED && reasons.length) status = STATUS.ESCALATED;
    // The sentences are written for what the check SAW — passed sets too — in
    // one allowance of 12 Haiku calls, worst band first, and each finding
    // takes its observation's. A budget already declared exhausted
    // (`result.stopped`) is not spent on them at all — BUDGET_FLOOR_MS is 20s
    // and that many calls do not fit in it, risking the Lambda being killed
    // before writeReview below ever runs — and the budget is asked again
    // before every call, since a check that merely finished late is in the
    // same danger. The row still gets its outcome; a reader sees the
    // band-only sentence (finding-explanations.js's bandSentence fallback)
    // where the model's explanation would have been.
    if (!result.stopped) {
      observed = await explainFindings(bedrock, InvokeModelCommand, snapshot, observed, { budget: inBudget });
      findings = withExplanations(findings, observed);
    }

    await recordUnits(db, tableName, orgId, checked);
    await writeReview(db, tableName, source, version, {
      status, findings, note, jobId,
      contentHash: snapshot.contentHash, snapshotKey, reasons, checkedBy: job.callerUserId || null,
      promptDropped, declaredNotice, tally, observed,
    });
    // The log is the memory and keeps the small tally; the observations live
    // on the REVIEW row only, so a log row does not grow with the set.
    await appendReviewEvent(db, tableName, source, 'checked', {
      version, outcome: status, reasons, checked, clean, contentHash: snapshot.contentHash, snapshotKey,
      findings: findings.map(minimalFinding), tally, by: job.callerUserId || null,
    });

    let published = null;
    if (status === STATUS.ESCALATED) {
      const bands = {};
      for (const f of findings) if (f.band && f.band !== 'NONE') bands[f.category] = f.band;
      // The queue's reason is only 'escalated'; `checkReasons` says what for,
      // so the queue can say "Images" or "Declared: …" of a set the guardrail
      // had nothing against, rather than "Uncertain" (moderationRow.js).
      await upsertQueueRow(db, tableName, {
        ref: source, version, reason: 'escalated',
        orgId, orgName: await orgName(db, tableName, orgId), setId: source.setId, title: plainMeta.name || source.setId,
        gameType: plainMeta.engagementType || '', questionCount: questions.length, bands,
        uncertainQuestionIds: findings.filter((f) => f.questionId && f.questionId !== '(set)').map((f) => f.questionId),
        checkReasons: reasons, declaredNotice: declaredNotice.map((n) => String(n).slice(0, NOTICE_CHARS)),
        snapshotKey, contentHash: snapshot.contentHash,
      });
      await appendReviewEvent(db, tableName, source, 'escalated', { version, reasons });
      await writeShareStamp(db, tableName, source, { version, status: 'escalated', contentHash: snapshot.contentHash, reasons, jobId });
    } else if (status === STATUS.PASSED && request.publish !== false) {
      published = await publishSnapshot(db, tableName, snapshot, {
        review: { findings, note }, sourceOrgName: await orgName(db, tableName, orgId), promptDropped,
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
      // Carry the pointer, not delete the object: if the snapshot made it to
      // S3 before this error, a reviewer must still be able to find it.
      await writeReview(db, tableName, source, version, {
        status: STATUS.ESCALATED, findings, note: error.message, jobId, reasons: ['error'], checkedBy: job.callerUserId || null,
        contentHash: snapshot ? snapshot.contentHash : null, snapshotKey, tally, observed,
      });
      await appendReviewEvent(db, tableName, source, 'checked', {
        version, outcome: STATUS.ESCALATED, reasons: ['error'], error: error.message, snapshotKey, ...(tally ? { tally } : {}),
      });
      await upsertQueueRow(db, tableName, {
        ref: source, version, reason: 'escalated', orgId,
        setId: source.setId,
        title: snapshot && snapshot.meta && snapshot.meta.name ? snapshot.meta.name : source.setId,
        // The snapshot is already in hand here — free to carry, and the queue
        // row would otherwise say nothing about what kind of set this is.
        gameType: snapshot && snapshot.meta ? snapshot.meta.engagementType || '' : '',
        questionCount: snapshot ? snapshot.questions.length : 0,
        // Every field a check puts on the pointer, given again: an escalated
        // version can be checked again, and the upsert keeps what it is not given.
        bands: {}, uncertainQuestionIds: [], checkReasons: ['error'], declaredNotice: [],
        orgName: await orgName(db, tableName, orgId),
        snapshotKey, contentHash: snapshot ? snapshot.contentHash : null,
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
