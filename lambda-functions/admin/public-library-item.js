// lambda-functions/admin/public-library-item.js
/**
 * GET|DELETE /admin/public-library/{publicSetId} — a public set's standing,
 * and takedown (spec §5.2, §10.4, §10.5).
 *
 * GET is the score card's data: what the public row says about itself (source
 * org, versions, notice), the org's REVIEW facts for the version it came from,
 * and the review log. Reports (Stage 3) and access rows (Stage 5) join later.
 *
 * DELETE is takedown. It reads `source*` off the public row, deletes the whole
 * public partition in batches (unpublishSet), logs `taken-down` with the note
 * on the org set's log, and flags the org's share stamp ONLY IF it still names
 * this public set (D11). IT NEVER TOUCHES THE ORG'S REVIEW ROW — a Put there
 * would erase the org's own findings and hash; the author's editor reads the
 * note from the stamp and renders 06.
 */
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, GetCommand } = require('@aws-sdk/lib-dynamodb');
const tenant = require('./shared/tenant');
const { setMetadataKey } = require('./shared/set-version');
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

async function standing(meta, publicSetId) {
  const source = sourceOf(meta);
  const version = Number(meta.sourceVersion) || 0;
  const review = source.orgId && source.setId && version ? await readReview(db, TABLE(), source, version) : { status: 'unreviewed' };
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
    questionCount: Number(meta.questionCount) || Number(latest.questionCount) || 0,
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
    const note = String(body.note || '').trim();
    if (!note) return json(400, { error: 'A takedown needs a note: the organisation reads it.' });
    if (note.length > NOTE_MAX) return json(400, { error: `The note is over ${NOTE_MAX} characters.` });

    const source = sourceOf(meta);
    const version = Number(meta.sourceVersion) || 0;
    const reviewer = reviewerOf(event);
    await unpublishSet(db, TABLE(), source, pubRefOf(publicSetId));
    if (source.orgId && source.setId) {
      await appendReviewEvent(db, TABLE(), source, 'taken-down', { version, publicSetId, note, reviewer });
      await writeShareStamp(db, TABLE(), source, { version, status: 'flagged', note }, { onlyIfPublicSetId: publicSetId });
      if (version) await deleteQueueRow(db, TABLE(), queueSk(source, version));
    }
    await deleteQueueRow(db, TABLE(), queueSk(pubRefOf(publicSetId), 0));
    return json(200, { takenDown: publicSetId });
  } catch (error) {
    console.error('❌ public-library item failed:', error);
    return json(500, { error: `Could not do that: ${error.message}` });
  }
};
