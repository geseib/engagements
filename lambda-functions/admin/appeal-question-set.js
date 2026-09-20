/**
 * "ASK FOR A HUMAN REVIEW" — 06-share-rejected.html, spec §2 and §9.
 *
 *   POST /question-sets/{setId}/appeal   { version, message }
 *
 * Only a FLAGGED version can be appealed: an escalated one is already with a
 * person, a passed one has nothing to appeal. The transition is conditional on
 * the current state, so a check finishing at the same moment cannot be
 * overwritten. The findings stay on the row — the reviewer needs them.
 */
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, GetCommand } = require('@aws-sdk/lib-dynamodb');
const { setMetadataKey, resolvePartitionFromMeta, toVersion, setRef } = require('./shared/set-version');
const tenant = require('./shared/tenant');
const { decryptItem } = require('./shared/tenant-crypto');
const { readReview, transitionReview, publishedKey, STATUS } = require('./shared/set-review');
const { upsertQueueRow } = require('./shared/moderation-queue');
const { appendReviewEvent } = require('./shared/review-log');
const { writeShareStamp } = require('./shared/share-stamp');
const { callerUserId } = require('./shared/question-set-access');

const db = DynamoDBDocumentClient.from(new DynamoDBClient({}), { marshallOptions: { removeUndefinedValues: true } });
const TABLE = () => process.env.TABLE_NAME;
const cors = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };
const json = (statusCode, body) => ({ statusCode, headers: cors, body: JSON.stringify(body) });
const fail = (statusCode, error) => json(statusCode, { error });
const MESSAGE_MAX = 500;

exports.handler = async (event) => {
  const method = String(event?.requestContext?.http?.method || 'POST').toUpperCase();
  if (method === 'OPTIONS') return { statusCode: 200, headers: cors, body: '' };
  const setId = String(event?.pathParameters?.setId || '').trim();
  if (!setId) return fail(400, 'Which set?');
  const orgId = tenant.callerOrgId(event);
  if (!orgId) return fail(400, 'Choose an organisation first.');
  if (!tenant.canManageScope(event, tenant.ORG, orgId, 'admin')) {
    return fail(403, 'Only an owner or admin of this organisation can ask for a human review.');
  }
  let body = {};
  try { body = JSON.parse(event.body || '{}'); } catch { return fail(400, 'That request body is not JSON.'); }
  const message = String(body.message || '').trim().slice(0, MESSAGE_MAX);
  const source = setRef({ scope: tenant.ORG, orgId, setId });

  try {
    const meta = (await db.send(new GetCommand({ TableName: TABLE(), Key: setMetadataKey(source) }))).Item;
    if (!meta) return fail(404, 'That set is not one of yours.');
    const version = resolvePartitionFromMeta(source, meta, toVersion(body.version)).version;
    /*
      A VERSION THE LIBRARY IS SERVING HAS NOTHING TO APPEAL — and it comes
      BEFORE the status check below, because that is the true reason.

      Engage staff can re-run the content check on the version the public library
      already serves (check-question-set.js `{ recheck: true }`). A HIGH band
      writes FLAGGED onto this REVIEW row while publishing nothing, taking
      nothing down and — deliberately — writing no share stamp, so the set goes
      on reading `published` to its author. From that FLAGGED this route used to
      take an appeal, and every step of it was wrong: the share stamp went to
      `appealed`, moving the author's own live set out of its published state;
      the queue row the re-check raised was bumped, which cleared the `recheck`
      flag moderation-decide.js refuses on; and Approve there then published a
      SECOND public version of content already live.

      The refusal stands on its own without any of that: an appeal asks for the
      set to be published, and it already is. `PUBLISHED` is deleted when a
      listing is taken down (publish-set.unpublishSet), which is the state that
      genuinely has something to say — and it says it through the takedown note.
    */
    const served = (await db.send(new GetCommand({ TableName: TABLE(), Key: publishedKey(source, version) }))).Item;
    if (served) {
      return json(409, {
        error: 'That version is in the public library right now, so there is nothing to appeal.',
        publicSetId: served.publicSetId || '',
      });
    }
    const current = await readReview(db, TABLE(), source, version);
    if (current.status !== STATUS.FLAGGED) {
      return json(409, { error: 'Only a version the check flagged can be sent to a person.', status: current.status });
    }
    const moved = await transitionReview(db, TABLE(), source, version, STATUS.FLAGGED, {
      status: STATUS.APPEALED, appealMessage: message, appealedBy: callerUserId(event) || null, appealedAt: new Date().toISOString(),
    });
    if (!moved) {
      // `current` is the status as it stood before the race, not after it —
      // re-read so a caller told "reload and try again" is told what it would
      // actually see.
      const now = await readReview(db, TABLE(), source, version);
      return json(409, { error: 'This version changed while you were writing. Reload and try again.', status: now.status });
    }

    const plainMeta = await decryptItem(orgId, 'set', meta);
    const orgRow = (await db.send(new GetCommand({ TableName: TABLE(), Key: { PK: tenant.orgPk(orgId), SK: 'METADATA' } }))).Item;
    const bands = {};
    for (const f of moved.findings || []) if (f.band && f.band !== 'NONE') bands[f.category] = f.band;
    await upsertQueueRow(db, TABLE(), {
      ref: source, version, reason: 'appealed',
      orgId, orgName: (orgRow && orgRow.name) || '', setId, title: plainMeta.name || setId,
      gameType: plainMeta.engagementType || '', questionCount: Number(meta.questionCount) || 0, bands,
      uncertainQuestionIds: (moved.findings || []).map((f) => f.questionId).filter((id) => id && id !== '(set)'),
      snapshotKey: moved.snapshotKey || null, contentHash: moved.contentHash || null, appealMessage: message,
    });
    await appendReviewEvent(db, TABLE(), source, 'appealed', { version, message, by: callerUserId(event) || null });
    await writeShareStamp(db, TABLE(), source, { version, status: 'appealed', contentHash: moved.contentHash });
    console.log(`🙋 ${orgId}/${setId} v${version} appealed`);
    return json(200, { version, status: STATUS.APPEALED });
  } catch (error) {
    console.error('appeal error:', error);
    return fail(500, `Could not send that for review: ${error.message}`);
  }
};
