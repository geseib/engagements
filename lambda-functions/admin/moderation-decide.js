// lambda-functions/admin/moderation-decide.js
/**
 * POST /admin/moderation/decide — the person's answer (spec §6.1).
 *
 *   approve  REVIEW ← passed (reviewer, note, notice) · publish FROM THE SNAPSHOT
 *            · sensitivity on the public row · share stamp published · log
 *            decided + published · queue row deleted · snapshot kept (D9)
 *   reject   REVIEW ← flagged (reviewer, note) · share stamp flagged with the
 *            note · snapshot deleted · log decided · queue row deleted
 *
 * The REVIEW move is a conditional Put on the row's current status
 * (transitionReview), so two reviewers cannot both decide: the loser is told
 * who did. The org's content rows are never read or written here — approve
 * publishes what was judged, not what the org has since edited.
 *
 * The snapshot's OWN `source` is what publishSnapshot trusts to derive the
 * public set id (setRef(snapshot.source) -> publicSetIdFor(orgId, setId)) —
 * provenance travels with the judged content, not with the queue pointer.
 * A snapshot whose source names a different org/set than the sk being decided
 * is treated exactly as a missing one: there is nothing here that is really
 * this set's judged content to publish.
 *
 * ── THE QUEUE ROW IS THE COMPLETION MARKER (Ruling R9) ─────────────────────
 *
 * The transition (REVIEW -> passed/flagged) runs BEFORE publish, sensitivity,
 * the share stamp, the log, and the queue-row delete — so a throw anywhere in
 * that tail used to leave a REVIEW row that reads as "decided" while nothing
 * downstream of it actually happened: a stale share stamp, a public set live
 * with no sensitivity, or no public set at all, and a queue row that never
 * goes away. Worse, a retry then read the already-moved REVIEW row and was
 * told "Already decided by <name>" — the reviewer whose click never finished,
 * with no way to finish it.
 *
 * The fix is that the queue row is deleted LAST on both paths, so its
 * presence is the one honest signal that a decision is still incomplete. A
 * queue row that still exists beside an already-decided REVIEW row is not a
 * second decision — it is the first one, crashed. The SAME decision, sent
 * again (by the same reviewer or a different one), RESUMES: it does not
 * re-transition the REVIEW row, it re-runs every write after the transition
 * so whatever didn't land the first time lands now, and it never repeats a
 * write that is not naturally idempotent (the `decided` log entry). A
 * DIFFERENT decision on an already-decided review is still refused as
 * somebody else's call to make.
 *
 * dismiss / take down / keep-with-a-notice are answers to REPORTED rows and
 * arrive with reports (Stage 3); a reported-row sk is refused here.
 */
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, GetCommand, UpdateCommand } = require('@aws-sdk/lib-dynamodb');
const { S3Client } = require('@aws-sdk/client-s3');
const tenant = require('./shared/tenant');
const { queueKey, deleteQueueRow } = require('./shared/moderation-queue');
const { STATUS, readReview, transitionReview } = require('./shared/set-review');
const { publishSnapshot } = require('./shared/publish-set');
const { writeShareStamp } = require('./shared/share-stamp');
const { appendReviewEvent } = require('./shared/review-log');
const { readSnapshot, deleteSnapshot } = require('./shared/snapshot-store');
const { setMetadataKey } = require('./shared/set-version');

const db = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const s3 = new S3Client({});
const TABLE = () => process.env.TABLE_NAME;
const BUCKET = () => process.env.AI_PROMPTS_BUCKET || '';
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type,Authorization,X-Engage-Org', 'Access-Control-Allow-Methods': 'POST,OPTIONS', 'Content-Type': 'application/json' };
const json = (statusCode, body) => ({ statusCode, headers: cors, body: JSON.stringify(body) });

const NOTE_MAX = 500;
const NOTICE_ID = /^[a-z0-9-]{1,40}$/;
// Matches declaredNotice's own cap (check-question-set.js `slice(0, 8)`).
const NOTICE_MAX = 8;
const DECISIONS = ['approve', 'reject'];
const OPEN = [STATUS.ESCALATED, STATUS.APPEALED];

const reviewerOf = (event) => String(event?.requestContext?.authorizer?.lambda?.username || event?.requestContext?.authorizer?.lambda?.userId || 'engage').trim();

/** Only the org shape decides here; PUBLIC# and PLATFORM# rows are reports (Stage 3). */
function parseOrgSk(raw) {
  const m = /^([A-Za-z0-9_-]+)#([A-Za-z0-9_-]+)#v(\d+)$/.exec(String(raw || '').trim());
  return m ? { sk: m[0], ref: { scope: 'org', orgId: m[1], setId: m[2] }, version: Number(m[3]) } : null;
}

function parseBody(event) {
  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { return { error: 'The request body is not JSON.' }; }
  const parsed = parseOrgSk(body.sk);
  if (!parsed) return { error: 'That is not a queue entry this screen decides.' };
  const decision = String(body.decision || '').trim();
  if (!DECISIONS.includes(decision)) return { error: 'The decision must be approve or reject.' };
  // Minor #4: a non-string note (an object, an array, a number...) must be
  // refused, not silently coerced -- String({}) is '[object Object]'.
  if (body.note !== undefined && body.note !== null && typeof body.note !== 'string') {
    return { error: 'The note must be text.' };
  }
  const note = String(body.note || '').trim();
  if (note.length > NOTE_MAX) return { error: `The note is over ${NOTE_MAX} characters.` };
  const notice = Array.isArray(body.notice) ? body.notice.map((n) => String(n || '').trim()).filter(Boolean) : [];
  // Minor #2: this is a SHAPE check, not a whitelist -- say what a valid id
  // looks like, not that it's unrecognised.
  if (notice.length > NOTICE_MAX || notice.some((n) => !NOTICE_ID.test(n))) {
    return { error: 'A content notice id is lowercase letters, digits and dashes, up to 40 characters, and there are at most 8 of them.' };
  }
  return { ...parsed, decision, note, notice };
}

/**
 * Ruling R5: does this snapshot's own provenance name the set being decided?
 * publishSnapshot derives the public set id from `snapshot.source`, so a
 * snapshot that parses but points elsewhere must never be published under
 * this sk's identity — that would publish org_other's content as org_acme's.
 * Compared as strings, orgId and setId only; scope is not part of the check
 * (an org-shaped queue sk always implies scope 'org' on both sides here).
 */
const sameSet = (source, ref) => Boolean(source)
  && String(source.orgId || '') === String(ref.orgId || '')
  && String(source.setId || '') === String(ref.setId || '');

async function writeSensitivity(pubRef, notice) {
  await db.send(new UpdateCommand({
    TableName: TABLE(),
    Key: setMetadataKey(pubRef),
    UpdateExpression: 'SET sensitivity = :n',
    ExpressionAttributeValues: { ':n': notice },
    ConditionExpression: 'attribute_exists(PK)',
  }));
}

exports.handler = async (event) => {
  const method = event.requestContext?.http?.method || event.httpMethod;
  if (method === 'OPTIONS') return { statusCode: 204, headers: cors, body: '' };
  if (!tenant.canManageScope(event, tenant.PLATFORM, '')) {
    return json(403, { error: 'Decisions are for Engage staff acting as Engage.' });
  }
  const input = parseBody(event);
  if (input.error) return json(400, { error: input.error });
  const { sk, ref, version, decision, note, notice } = input;
  const reviewer = reviewerOf(event);
  try {
    const row = await db.send(new GetCommand({ TableName: TABLE(), Key: queueKey(sk) }));
    if (!row || !row.Item) return json(404, { error: 'Nothing is waiting under that entry — it may already be decided.' });
    const pointer = row.Item;
    const review = await readReview(db, TABLE(), ref, version);
    const decidedAt = new Date().toISOString();

    // Ruling R9: the queue row is the LAST write on both the approve and the
    // reject path -- deleted only once publish/stamp/log have all landed. So
    // a queue row that still exists beside an ALREADY-decided REVIEW row is
    // not a second decision; it is the first one, crashed between the
    // transition and the delete. The SAME decision, replayed, RESUMES: no
    // new transition (the recorded reviewer/note/notice win over whatever
    // this retry sent), and every write after the transition runs again so
    // whatever didn't land the first time -- the publish, the sensitivity,
    // the stamp -- lands now. A DIFFERENT decision on an already-decided
    // review is refused as somebody else's call; a status this screen never
    // opens (unreviewed, checking...) is refused as not waiting at all.
    const resumingApprove = review.status === STATUS.PASSED && decision === 'approve';
    const resumingReject = review.status === STATUS.FLAGGED && decision === 'reject';

    if (!OPEN.includes(review.status) && !resumingApprove && !resumingReject) {
      if (review.status === STATUS.PASSED || review.status === STATUS.FLAGGED) {
        return json(409, { error: `Already decided by ${review.reviewer || 'somebody else'}.`, status: review.status });
      }
      return json(409, { error: `That entry is not waiting for a decision (status: ${review.status}).`, status: review.status });
    }

    if (resumingApprove) {
      const snapshot = pointer.snapshotKey ? await readSnapshot(s3, BUCKET(), pointer.snapshotKey) : null;
      if (!snapshot || !sameSet(snapshot.source, ref)) {
        return json(409, { error: 'The snapshot is gone, so there is nothing to publish — ask the organisation to submit it again.' });
      }
      const resumedNotice = Array.isArray(review.notice) ? review.notice : [];
      const published = await publishSnapshot(db, TABLE(), snapshot, {
        review, sourceOrgName: pointer.orgName || '', promptDropped: review.promptDropped === true, resume: true,
      });
      if (resumedNotice.length) await writeSensitivity(published.pubRef, resumedNotice);
      await writeShareStamp(db, TABLE(), ref, {
        version, status: 'published', publicSetId: published.publicSetId, publicVersion: published.publicVersion, contentHash: snapshot.contentHash || review.contentHash,
      });
      // The decision itself was already logged (or never will be — either
      // way this is not a new decision); only the completion is new.
      await appendReviewEvent(db, TABLE(), ref, 'published', { version, publicSetId: published.publicSetId, publicVersion: published.publicVersion, by: reviewer, resumed: true });
      await deleteQueueRow(db, TABLE(), sk);
      return json(200, { decision, publicSetId: published.publicSetId, publicVersion: published.publicVersion, resumed: true });
    }

    if (resumingReject) {
      const resumedNote = review.note || '';
      await writeShareStamp(db, TABLE(), ref, { version, status: 'flagged', note: resumedNote, contentHash: review.contentHash });
      if (pointer.snapshotKey) await deleteSnapshot(s3, BUCKET(), pointer.snapshotKey);
      await deleteQueueRow(db, TABLE(), sk);
      return json(200, { decision, resumed: true });
    }

    if (decision === 'approve') {
      const snapshot = pointer.snapshotKey ? await readSnapshot(s3, BUCKET(), pointer.snapshotKey) : null;
      if (!snapshot || !sameSet(snapshot.source, ref)) {
        return json(409, { error: 'The snapshot is gone, so there is nothing to publish — ask the organisation to submit it again.' });
      }
      const moved = await transitionReview(db, TABLE(), ref, version, review.status, {
        status: STATUS.PASSED, reviewer, decidedAt, note, ...(notice.length ? { notice } : {}),
      });
      if (!moved) {
        const now = await readReview(db, TABLE(), ref, version);
        return json(409, { error: `Already decided by ${now.reviewer || 'somebody else'}.`, status: now.status });
      }
      const published = await publishSnapshot(db, TABLE(), snapshot, {
        review: moved, sourceOrgName: pointer.orgName || '', promptDropped: review.promptDropped === true,
      });
      if (notice.length) await writeSensitivity(published.pubRef, notice);
      await writeShareStamp(db, TABLE(), ref, {
        version, status: 'published', publicSetId: published.publicSetId, publicVersion: published.publicVersion, contentHash: snapshot.contentHash || review.contentHash,
      });
      await appendReviewEvent(db, TABLE(), ref, 'decided', { version, decision, reviewer, note, notice, publicSetId: published.publicSetId, publicVersion: published.publicVersion });
      await appendReviewEvent(db, TABLE(), ref, 'published', { version, publicSetId: published.publicSetId, publicVersion: published.publicVersion, by: reviewer });
      await deleteQueueRow(db, TABLE(), sk);
      return json(200, { decision, publicSetId: published.publicSetId, publicVersion: published.publicVersion });
    }

    const moved = await transitionReview(db, TABLE(), ref, version, review.status, { status: STATUS.FLAGGED, reviewer, decidedAt, note });
    if (!moved) {
      const now = await readReview(db, TABLE(), ref, version);
      return json(409, { error: `Already decided by ${now.reviewer || 'somebody else'}.`, status: now.status });
    }
    await writeShareStamp(db, TABLE(), ref, { version, status: 'flagged', note, contentHash: review.contentHash });
    if (pointer.snapshotKey) await deleteSnapshot(s3, BUCKET(), pointer.snapshotKey);
    await appendReviewEvent(db, TABLE(), ref, 'decided', { version, decision, reviewer, note });
    await deleteQueueRow(db, TABLE(), sk);
    return json(200, { decision });
  } catch (error) {
    console.error('❌ decide failed:', error);
    return json(500, { error: `Could not record that decision: ${error.message}` });
  }
};
