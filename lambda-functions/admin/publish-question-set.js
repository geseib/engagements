/**
 * SHARING A SET PUBLICLY, AND TAKING IT BACK.
 *
 *   POST   /admin/question-sets/{setId}/publish   { version }
 *   DELETE /admin/question-sets/{setId}/publish
 *
 * `docs/design/tenancy-redesign/05-share-review.html`: "Anyone using Engage will
 * be able to find this set, read every question in it, and copy it into their
 * own team."
 *
 * ── THIS IS NOT `copy-question-set.js` REVERSED ───────────────────────────
 *
 * The design said it was. Agent review found four differences, and every one of
 * them is a way to ship something that looks correct:
 *
 * 1. THE COPY DESTROYS VERSION HISTORY — `activeVersion: null, versions: []`,
 *    landing in the unversioned legacy partition. Publish does the opposite: a
 *    public set HAS versions, because re-sharing adds one and each public
 *    version carries its own review record.
 *
 * 2. THE COPY RENAMES ON COLLISION (`freeSetId`: `teamretro` -> `teamretro2`).
 *    Fatal here. A re-share must land on the SAME public set as a new version,
 *    or "the library keeps serving v2 until somebody deliberately shares again"
 *    is unimplementable and every share spawns an orphan. The public id is
 *    DERIVED from `{orgId, setId}` and is therefore stable.
 *
 * 3. THE COPY REFUSES AN ORG SOURCE. This one takes nothing else.
 *
 * 4. ENCRYPTION RUNS THE OTHER WAY. Org content is ciphertext; public content
 *    must be plaintext or the shared library is unreadable — the same argument
 *    `upload-questions.js` makes for not encrypting it in the first place. So
 *    this DECRYPTS on the way out, and getting that backwards produces a public
 *    set full of base64 that still passes a row-count check.
 *
 * ── THE GATES ─────────────────────────────────────────────────────────────
 *
 * A set must be FILED before it is shared — one shelf from shared/set-topics.js
 * — which is the owner's own *"req at least 1 pretty broad for public ones"*.
 * An unfiled set goes on living in its own organisation; it does not get into
 * the library everybody browses.
 *
 * Only a version whose review PASSED may be published, and `mayPublish` tests
 * for that one value rather than listing blockers, so a status added later is
 * refused by default. `escalated` BLOCKS: `11-moderation.html` is a queue of
 * sets "waiting for a person", not a notification that publishing went ahead.
 *
 * ── WHO ───────────────────────────────────────────────────────────────────
 *
 * An org ADMIN or OWNER. Copying a shared set INTO your team is any member's
 * call because it affects only that team; publishing OUT of it puts your
 * organisation's material in front of everyone, which is not.
 */
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, GetCommand } = require('@aws-sdk/lib-dynamodb');
const { setMetadataKey, setRef } = require('./shared/set-version');
const tenant = require('./shared/tenant');
const { publicSetIdFor, unpublishSet } = require('./shared/publish-set');
const { publishLiveVersion } = require('./shared/publish-live');
const { settleHeldSet } = require('./shared/public-hold');
const { writeShareStamp } = require('./shared/share-stamp');
const { appendReviewEvent } = require('./shared/review-log');

const db = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const TABLE = () => process.env.TABLE_NAME;

const cors = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };
const json = (statusCode, body) => ({ statusCode, headers: cors, body: JSON.stringify(body) });
const fail = (statusCode, error) => json(statusCode, { error });

exports.handler = async (event) => {
  const method = String(event?.requestContext?.http?.method || 'POST').toUpperCase();
  const setId = String(event?.pathParameters?.setId || '').trim();
  if (!setId) return fail(400, 'Which set?');

  const orgId = tenant.callerOrgId(event);
  if (!orgId) return fail(400, 'Choose an organisation before sharing a question set.');

  // Publishing puts your organisation's material in front of everyone. Copying
  // one IN is a member's call; this is not.
  if (!tenant.canManageScope(event, tenant.ORG, orgId, 'admin')) {
    return fail(403, 'Only an owner or admin of this organisation can share a set publicly.');
  }

  const source = setRef({ scope: tenant.ORG, orgId, setId });
  const pubRef = setRef({ scope: tenant.PUBLIC, orgId: '', setId: publicSetIdFor(orgId, setId) });

  try {
    if (method === 'DELETE') return await unpublish(source, pubRef);
    return await share(event, source, pubRef, orgId, setId);
  } catch (error) {
    console.error('publish error:', error);
    return fail(500, `Could not share that set: ${error.message}`);
  }
};

async function share(event, source, pubRef, orgId, setId) {
  let body = {};
  try { body = JSON.parse(event.body || '{}'); } catch { return fail(400, 'That request body is not JSON.'); }

  const metaRes = await db.send(new GetCommand({ TableName: TABLE(), Key: setMetadataKey(source) }));
  const meta = metaRes.Item;
  if (!meta) return fail(404, 'That set is not one of yours.');

  /*
   * THE GATES AND THE PUBLISH — review PASSED, questions present, FILED on a
   * shelf, content unchanged since it was judged [R25] — then the snapshot,
   * the share stamp and the log. All of it lives in shared/publish-live.js,
   * moved there unchanged and in the same order, because "Make public" on a set
   * held while leaving a plan (orgs/leave-plan.js) publishes through exactly
   * the same gates. Each refusal is the 409 this route has always answered.
   *
   * Placed after the ownership read above, so a stranger aiming at another
   * organisation's set still gets the 404 and learns nothing from the gates.
   */
  const result = await publishLiveVersion(db, TABLE(), { source, meta, version: body.version, resume: false });
  if (result.status !== 201) return json(result.status, result.body);

  /*
   * A SET SOMEBODY HELD FOR THE LIBRARY (shared/public-hold.js) leaves its
   * organisation once a copy of it is live — whichever door the copy went out
   * of, this one included. After the publish, never before it: the promise was
   * "not deleted until accepted", and a delete that ran first and a publish that
   * then failed would break it. A settle that fails is logged and the share
   * still stands: the set simply stays held, and "Make public" again finishes it.
   */
  let privateCopyRemoved = false;
  try {
    const settled = await settleHeldSet(db, TABLE(), source, { outcome: 'published', version: result.version });
    privateCopyRemoved = settled.action === 'deleted';
  } catch (error) {
    console.error(`⚠️ ${orgId}/${setId} is public, but its hold could not be settled:`, error);
  }
  return json(201, { ...result.body, ...(privateCopyRemoved ? { privateCopyRemoved: true } : {}) });
}

/**
 * Take it out of the library.
 *
 * Copies other teams already made are UNTOUCHED and independent —
 * `copy-question-set.js` guarantees that and says so. Unpublishing withdraws
 * the listing, it does not reach into anybody's team.
 */
async function unpublish(source, pubRef) {
  const { removed } = await unpublishSet(db, TABLE(), source, pubRef);
  if (removed === 0) return json(200, { removed: 0, note: 'That set is not in the public library.' });
  await writeShareStamp(db, TABLE(), source, { version: null, status: 'unpublished' });
  await appendReviewEvent(db, TABLE(), source, 'unpublished', { publicSetId: pubRef.setId, removed });
  console.log(`🌍 unpublished ${pubRef.setId}: ${removed} row(s) removed`);
  return json(200, { removed, publicSetId: pubRef.setId });
}
