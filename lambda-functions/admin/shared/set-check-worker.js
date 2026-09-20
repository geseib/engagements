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
const {
  setRef, setMetadataKey, resolvePartitionFromMeta, toVersion, queryPartition, setPartition,
} = require('./set-version');
const { decryptItem } = require('./tenant-crypto');
const { writeReview, readReview, decisionOf, STATUS } = require('./set-review');
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
  // STAFF RE-RUNNING THE CHECK ON A VERSION THE PUBLIC LIBRARY ALREADY SERVES
  // (check-question-set.js). It publishes nothing, moves no share stamp, and
  // keeps the human decision it found; an outcome worse than `passed` is queued
  // for a person instead, because nothing may be taken down without one.
  const recheck = request.recheck === true;
  const checkedAt = new Date().toISOString();
  const declaredNotice = Array.isArray(request.declaredNotice) ? request.declaredNotice : [];
  const reasons = [];
  let findings = []; let checked = 0; let clean = 0;
  // What a PERSON decided about this version, carried across the lock row by
  // beginCheck's `keep` and written back below — including out of the catch
  // block, so no failure of ours erases an approval.
  let decision = {};
  // WHAT THE AUTHOR DECLARED when they shared it, carried the same way and for
  // a sharper reason: everything else a check rewrites it could measure again,
  // and this it cannot. `declaredNotice` is the author's own statement about
  // their own content; the content says nothing about it. A re-check writing its
  // own empty list over it would erase it for good, and with it the score card's
  // account of why a person was ever in this set's history.
  let carriedDeclared = [];
  /** What the carry inherited, over whatever this submission declared (nothing). */
  const declaredOnRow = () => (carriedDeclared.length ? carriedDeclared : declaredNotice);
  /**
   * ...and the reason that NAMES it, which the score card's "Why a person was
   * needed" line reads. It joins the row AFTER the status has been computed from
   * the check's own reasons: that is what keeps a carried declaration from
   * holding the set a second time where a person has already ruled on it. Where
   * nobody has, it went in before the status instead (see below) and this is a
   * no-op. The failure path does not use it — there the reasons are the
   * failure's alone, because `error` is why a person is needed now, and the
   * declaration is still on the row either way.
   */
  const reasonsOnRow = (list) => (carriedDeclared.length && !list.includes('declared') ? [...list, 'declared'] : list);
  // Hoisted like `findings`: a check that measured everything and then failed
  // in bookkeeping still records what it measured. Null until it has.
  let observed = null; let tally = null;
  // Hoisted above the try: the snapshot is uploaded early and a failure any
  // time after that must still be able to point a reviewer at it, rather
  // than orphaning the S3 object the moment something downstream throws.
  let snapshot = null; let snapshotKey = null;

  try {
    await updateJobProgress(db, tableName, jobId, { completed: 0, phase: 'Reading the set…' });
    if (recheck) {
      const previous = await readReview(db, tableName, source, version);
      decision = decisionOf(previous);
      carriedDeclared = Array.isArray(previous.declaredNotice) ? previous.declaredNotice : [];
    }
    const meta = (await db.send(new GetCommand({ TableName: tableName, Key: setMetadataKey(source) }))).Item;
    if (!meta) throw new Error('That set no longer exists');
    // A re-check judges the EXACT version the library serves. Resolution would
    // substitute the organisation's active version for one since deleted, or for
    // the legacy partition of a set since versioned — judging content nobody
    // published while the review row claimed to describe the published one.
    const pk = recheck ? setPartition(source, version) : resolvePartitionFromMeta(source, meta, version).pk;
    const { items: rows } = await queryPartition(db, tableName, pk);
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
    // A declaration NOBODY HAS RULED ON still holds the set, exactly as it does
    // on the organisation's own check. With a ruling carried forward it does
    // not: a version carrying a declaration reaches the library only because a
    // person decided about that declaration, and re-escalating on it would
    // queue every declared listing in the library on every staff re-check and
    // bury the findings that are real.
    if (carriedDeclared.length && !decision.reviewer) reasons.push('declared');

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

    // A re-check is Engage's own work: the calls are recorded beside the
    // organisation's ledger rather than in it (check-quota.js), and its daily
    // cap was never reserved.
    await recordUnits(db, tableName, orgId, checked, recheck ? { field: 'staffUnits' } : {});
    await writeReview(db, tableName, source, version, {
      status, findings, note, jobId,
      contentHash: snapshot.contentHash, snapshotKey, checkedBy: job.callerUserId || null,
      promptDropped, tally, observed,
      reasons: reasonsOnRow(reasons), declaredNotice: declaredOnRow(),
      // LAST, so a person's decision outlives the count this check would
      // otherwise write over their words.
      ...decision,
    });
    // The log is the memory and keeps the small tally; the observations live
    // on the REVIEW row only, so a log row does not grow with the set.
    await appendReviewEvent(db, tableName, source, 'checked', {
      version, outcome: status, reasons, checked, clean, contentHash: snapshot.contentHash, snapshotKey,
      findings: findings.map(minimalFinding), tally, by: job.callerUserId || null,
      // The customer's log is where they see what Engage did to their set, so a
      // re-check says so and names the staff member who ran it.
      ...(recheck ? { recheck: true, reviewer: job.callerUsername || '', publicSetId: request.publicSetId || '' } : {}),
    });

    let published = null;
    /*
      WHO HAS TO LOOK AT THIS.

      An ordinary check escalates to a person and tells a FLAGGED set's author to
      fix it, which is why `flagged` is deliberately not a queue item.

      A re-check has no author in the loop: nobody asked for it, and its outcome
      is never told to them (the share stamp is not written). So anything worse
      than `passed` — flagged included — goes to the queue, or the finding is
      thrown away while the library goes on serving the set.

      KNOWN LIMIT, for a set shared before versioning existed: its queue SK is
      `<org>#<set>#v0` (moderation-queue.queueSk counts a null version as v0),
      and `moderation-get.js` and `moderation-decide.js` both refuse a `v0` key
      on purpose — they reserve v0 to mean "not a version" so a queue row can
      never be read as the legacy partition. So such a row LISTS but does not
      open, and the surface that acts on it is the score card, which now shows
      the escalation, what held it, and Take down. Taking the set down clears
      the row (public-library-item.js deletes exactly this key). Pre-existing:
      an ordinary check of a legacy set has always queued the same way.
    */
    const toAPerson = status === STATUS.ESCALATED || (recheck && status !== STATUS.PASSED);
    if (toAPerson) {
      const bands = {};
      for (const f of findings) if (f.band && f.band !== 'NONE') bands[f.category] = f.band;
      await upsertQueueRow(db, tableName, {
        ref: source, version, reason: 'escalated',
        orgId, orgName: await orgName(db, tableName, orgId), setId: source.setId, title: plainMeta.name || source.setId,
        gameType: plainMeta.engagementType || '', questionCount: questions.length, bands,
        uncertainQuestionIds: findings.filter((f) => f.questionId && f.questionId !== '(set)').map((f) => f.questionId),
        snapshotKey, contentHash: snapshot.contentHash,
        // WHERE IT IS DECIDED. A row raised over a version the library already
        // serves is not a publish request, and moderation-decide.js refuses it:
        // approving would mint a second public version of content already live,
        // rejecting would stamp its author for a check nobody told them about.
        // So the row says which listing it is about and staff open its score
        // card, which shows the escalation, what held it, and Take down.
        recheck, ...(recheck && request.publicSetId ? { publicSetId: request.publicSetId } : {}),
      });
      await appendReviewEvent(db, tableName, source, 'escalated', { version, reasons });
    }
    if (recheck) {
      // NOTHING ELSE. No publish (R1: the library is left exactly as it is,
      // including its active version), and no share stamp (R3: the author's set
      // goes on reading `published`, because as far as they are concerned it is).
      console.log(`🔎 re-check only: ${orgId}/${source.setId} v${version} → ${status}, nothing published`);
    } else if (status === STATUS.ESCALATED) {
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
        // Only the CARRY here, never this submission's own list: a failure of
        // ours must not erase what the author declared, and an ordinary check
        // that failed goes on writing exactly the row it always did.
        ...(carriedDeclared.length ? { declaredNotice: carriedDeclared } : {}),
        // A failure of ours is not a reason to lose a person's decision either.
        // `note` comes with it, so the reviewer's words are kept over this
        // error's message — the message is on the job and in the log.
        ...decision,
      });
      await appendReviewEvent(db, tableName, source, 'checked', {
        version, outcome: STATUS.ESCALATED, reasons: ['error'], error: error.message, snapshotKey, ...(tally ? { tally } : {}),
        ...(recheck ? { recheck: true, reviewer: job.callerUsername || '', publicSetId: request.publicSetId || '' } : {}),
      });
      await upsertQueueRow(db, tableName, {
        ref: source, version, reason: 'escalated', orgId,
        setId: source.setId,
        title: snapshot && snapshot.meta && snapshot.meta.name ? snapshot.meta.name : source.setId,
        // The snapshot is already in hand here — free to carry, and the queue
        // row would otherwise say nothing about what kind of set this is.
        gameType: snapshot && snapshot.meta ? snapshot.meta.engagementType || '' : '',
        questionCount: snapshot ? snapshot.questions.length : 0,
        bands: {}, orgName: await orgName(db, tableName, orgId),
        snapshotKey, contentHash: snapshot ? snapshot.contentHash : null,
        recheck, ...(recheck && request.publicSetId ? { publicSetId: request.publicSetId } : {}),
      });
      await appendReviewEvent(db, tableName, source, 'escalated', { version, reasons: ['error'] });
      // R3 holds through a failure too: a re-check that could not finish is not
      // news the author's set should carry. The queue row above is who looks.
      if (!recheck) await writeShareStamp(db, tableName, source, { version, status: 'escalated', reasons: ['error'], jobId });
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
