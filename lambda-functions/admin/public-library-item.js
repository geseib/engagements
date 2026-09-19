// lambda-functions/admin/public-library-item.js
/**
 * GET|DELETE /admin/public-library/{publicSetId} — a public set's standing,
 * and takedown (spec §5.2, §10.4, §10.5).
 *
 * GET is the score card's data: what the public row says about itself (source
 * org, versions, notice), the org's REVIEW facts for the version it came from,
 * and the review log. Reports (Stage 3) and access rows (Stage 5) join later.
 *
 * ── WHAT THE CHECK MEASURED, NAMED BY TEXT (2026-09-19) ────────────────────
 *
 * The owner: the card "doesn't reveal much". The review now carries `tally`
 * (per category, in questions) and `observed` (every band the check saw), and
 * GET projects both with `reasons`. Each observation is named by its question's
 * TEXT, read from the public copy's own question rows by id: publish copies the
 * judged snapshot's rows byte-for-byte, keys and all (shared/publish-set.js),
 * so the review's ids are the public copy's ids. Not the S3 snapshot —
 * snapshots expire after 30 days and this function has no S3 grant — and not
 * the org's rows, which are encrypted and may have been edited since. A review
 * checked before measuring existed projects `tally: null` and no observations.
 *
 * DELETE is takedown. It reads `source*` off the public row, logs `taken-down`
 * with the note on the org set's log, flags the org's share stamp ONLY IF it
 * still names this public set (D11), deletes any queue row for the set, and
 * ONLY THEN deletes the whole public partition in batches (unpublishSet). IT
 * NEVER TOUCHES THE ORG'S REVIEW ROW — a Put there would erase the org's own
 * findings and hash; the author's editor reads the note from the stamp and
 * renders 06.
 *
 * ── WHY THE DESTRUCTIVE DELETE RUNS LAST (Ruling R10) ──────────────────────
 *
 * `unpublishSet` deletes the public metadata row as part of its batch. Reviewer
 * found that running it FIRST means a throw in any later write — the log
 * append, the guarded stamp, a queue delete — leaves the public rows gone, the
 * org's stamp still `published` and naming a set that no longer exists, the
 * queue row present, and `taken-down` never logged. Worse: every retry then
 * 404s (GET included, since `readPublicMeta` is the first thing both verbs do)
 * — staff cannot even open the entry to try again.
 *
 * Ordering the org-side writes FIRST and the delete LAST means a crash leaves
 * the set still listed and GET/DELETE still reachable, and the NEXT click just
 * finishes the job: the log append is benign to repeat (it is an append, not a
 * replace), the guarded stamp write quietly returns null once the stamp no
 * longer names this set (so a retry after the stamp already flipped is a
 * no-op, not a re-throw), the queue deletes are unconditional deletes of a key
 * that may already be gone, and `unpublishSet` itself no-ops once the public
 * metadata row it keys off is gone. A crashed takedown is finished by the next
 * click, never stuck half-done.
 */
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, GetCommand } = require('@aws-sdk/lib-dynamodb');
const tenant = require('./shared/tenant');
const { setMetadataKey, setPartition, queryPartition } = require('./shared/set-version');
const { unpublishSet } = require('./shared/publish-set');
const { readReview } = require('./shared/set-review');
const { readReviewLog, appendReviewEvent } = require('./shared/review-log');
const { writeShareStamp } = require('./shared/share-stamp');
const { queueSk, deleteQueueRow } = require('./shared/moderation-queue');

const db = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const TABLE = () => process.env.TABLE_NAME;
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type,Authorization,X-Engage-Org', 'Access-Control-Allow-Methods': 'GET,DELETE,OPTIONS', 'Content-Type': 'application/json' };
const json = (statusCode, body) => ({ statusCode, headers: cors, body: JSON.stringify(body) });
const NOTE_MAX = 500;
const reviewerOf = (event) => String(event?.requestContext?.authorizer?.lambda?.username || event?.requestContext?.authorizer?.lambda?.userId || 'engage').trim();

const pubRefOf = (publicSetId) => ({ scope: 'public', orgId: '', setId: String(publicSetId || '').trim() });
const sourceOf = (meta) => ({ scope: 'org', orgId: String(meta.sourceOrgId || ''), setId: String(meta.sourceSetId || '') });

async function readPublicMeta(publicSetId) {
  const id = String(publicSetId || '').trim();
  if (!/^[A-Za-z0-9_-]+$/.test(id)) return null;
  const res = await db.send(new GetCommand({ TableName: TABLE(), Key: setMetadataKey(pubRefOf(id)) }));
  return res && res.Item ? res.Item : null;
}

const SET_SUBJECT = '(set)';
const QUESTION_PREFIX = 'QUESTION#';
const lines = (...values) => values.map((v) => (typeof v === 'string' ? v.trim() : '')).filter(Boolean).join('\n');

/**
 * Name each observation by its text (see the header). A question reads as a
 * room sees it asked — title, then detail, one per line; the set's own
 * subject by the public set's title and description. An id the active public
 * copy does not hold gets '' rather than a guess.
 */
async function withText(observed, meta, publicSetId) {
  const rows = observed.filter((o) => o && typeof o === 'object');
  const texts = new Map();
  if (rows.some((o) => o.questionId && o.questionId !== SET_SUBJECT)) {
    const pk = setPartition(pubRefOf(publicSetId), meta.activeVersion);
    const { items } = await queryPartition(db, TABLE(), pk, QUESTION_PREFIX);
    for (const row of items) texts.set(String(row.SK).slice(QUESTION_PREFIX.length), lines(row.Title, row.Detail));
  }
  const setName = lines(meta.name, meta.description);
  return rows.map((o) => ({ ...o, text: o.questionId === SET_SUBJECT ? setName : (texts.get(o.questionId) || '') }));
}

async function standing(meta, publicSetId) {
  const source = sourceOf(meta);
  const version = Number(meta.sourceVersion) || 0;
  const review = source.orgId && source.setId && version ? await readReview(db, TABLE(), source, version) : { status: 'unreviewed' };
  const observed = Array.isArray(review.observed) ? await withText(review.observed, meta, publicSetId) : [];
  const log = source.orgId && source.setId ? await readReviewLog(db, TABLE(), source) : [];
  const versions = Array.isArray(meta.versions) ? meta.versions : [];
  const latest = versions.find((v) => Number(v.version) === Number(meta.activeVersion)) || versions[versions.length - 1] || {};
  return {
    publicSetId,
    name: meta.name || '',
    description: meta.description || '',
    engagementType: meta.engagementType || '',
    sourceOrgId: source.orgId,
    sourceOrgName: meta.sourceOrgName || '',
    sourceSetId: source.setId,
    sourceVersion: version,
    publicVersion: Number(meta.activeVersion) || 0,
    // The public copy's OWN count: publish records the question rows it
    // copied on the version entry (shared/publish-set.js). The row's top-level
    // `questionCount` is the organisation's, spread across at publish, and so
    // counts the org's ACTIVE version — not the one shared, whenever a past
    // version is. Only a row whose version carries no count falls back to it.
    questionCount: Number(latest.questionCount) || Number(meta.questionCount) || 0,
    contentHash: meta.contentHash || '',
    sensitivity: Array.isArray(meta.sensitivity) ? meta.sensitivity : [],
    promptDropped: meta.promptDropped === true,
    publishedAt: latest.createdAt || null,
    review: {
      status: review.status || 'unreviewed',
      reviewer: review.reviewer || '',
      decidedAt: review.decidedAt || null,
      note: review.note || '',
      notice: Array.isArray(review.notice) ? review.notice : [],
      findings: Array.isArray(review.findings) ? review.findings : [],
      checkedAt: review.checkedAt || null,
      reasons: Array.isArray(review.reasons) ? review.reasons : [],
      // null, not {}: "checked before measuring existed" is not "measured,
      // and nothing seen" (content-guardrail.js tallyOf, `scope: 'full'`).
      tally: review.tally && typeof review.tally === 'object' ? review.tally : null,
      observed,
    },
    log,
  };
}

exports.handler = async (event) => {
  const method = event.requestContext?.http?.method || event.httpMethod;
  if (method === 'OPTIONS') return { statusCode: 204, headers: cors, body: '' };
  if (!tenant.canManageScope(event, tenant.PLATFORM, '')) {
    return json(403, { error: 'The public library is managed by Engage staff acting as Engage.' });
  }
  const publicSetId = String(event.pathParameters?.publicSetId || '').trim();
  try {
    const meta = await readPublicMeta(publicSetId);
    if (!meta) return json(404, { error: 'No such public set.' });

    if (method === 'GET') return json(200, await standing(meta, publicSetId));
    if (method !== 'DELETE') return json(405, { error: 'Method not allowed' });

    let body;
    try { body = JSON.parse(event.body || '{}'); } catch { return json(400, { error: 'The request body is not JSON.' }); }
    // A present-but-wrong-type note (an object, a number, `false`…) must be
    // refused rather than silently coerced to a string like '[object Object]'
    // — that would land in the organisation's log and stamp as if it were the
    // reviewer's own words. Absent (`undefined`) or explicit `null` reads as
    // "no note", caught by the emptiness check below, same as always.
    if (body.note !== undefined && body.note !== null && typeof body.note !== 'string') {
      return json(400, { error: 'The note must be text.' });
    }
    const note = String(body.note || '').trim();
    if (!note) return json(400, { error: 'A takedown needs a note: the organisation reads it.' });
    if (note.length > NOTE_MAX) return json(400, { error: `The note is over ${NOTE_MAX} characters.` });

    const source = sourceOf(meta);
    const version = Number(meta.sourceVersion) || 0;
    const reviewer = reviewerOf(event);
    // R10: the organisation is told FIRST — the destructive delete is LAST.
    // See the handler docstring for why.
    if (source.orgId && source.setId) {
      await appendReviewEvent(db, TABLE(), source, 'taken-down', { version, publicSetId, note, reviewer });
      await writeShareStamp(db, TABLE(), source, { version, status: 'flagged', note }, { onlyIfPublicSetId: publicSetId });
      if (version) await deleteQueueRow(db, TABLE(), queueSk(source, version));
    }
    await deleteQueueRow(db, TABLE(), queueSk(pubRefOf(publicSetId), 0));
    await unpublishSet(db, TABLE(), source, pubRefOf(publicSetId));
    return json(200, { takenDown: publicSetId });
  } catch (error) {
    console.error('❌ public-library item failed:', error);
    return json(500, { error: `Could not do that: ${error.message}` });
  }
};
