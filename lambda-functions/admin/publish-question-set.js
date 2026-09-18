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
 * ── THE GATE ──────────────────────────────────────────────────────────────
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
const {
  setMetadataKey, resolvePartitionFromMeta, toVersion, queryPartition, setRef,
} = require('./shared/set-version');
const tenant = require('./shared/tenant');
const { decryptItem } = require('./shared/tenant-crypto');
const { readReview, mayPublish, STATUS } = require('./shared/set-review');
const { buildSnapshot, contentHash } = require('./shared/publishable');
const { publicSetIdFor, platformPromptExists, publishSnapshot, unpublishSet } = require('./shared/publish-set');
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

  const resolved = resolvePartitionFromMeta(source, meta, toVersion(body.version));
  const version = resolved.version;

  // THE GATE. Read from the version's own row — see shared/set-review.js for
  // why it is a row and not a field on `versions[]`.
  const review = await readReview(db, TABLE(), source, version);
  if (!mayPublish(review)) {
    return json(409, {
      error: review.status === STATUS.ESCALATED
        ? 'This version is with a person at Engage. You will hear back either way.'
        : 'This version has not passed the content check yet.',
      status: review.status,
      findings: review.findings || [],
    });
  }

  const { items: rows } = await queryPartition(db, TABLE(), resolved.pk);
  if (!rows.some((r) => String(r.SK || '').startsWith('QUESTION#'))) return fail(409, 'That version has no questions to share.');

  const plainMeta = await decryptItem(orgId, 'set', meta);
  const questions = [];
  const categories = [];
  for (const row of rows) {
    const sk = String(row.SK || '');
    if (sk.startsWith('QUESTION#')) questions.push(await decryptItem(orgId, 'question', row)); // eslint-disable-line no-await-in-loop
    else if (sk.startsWith('CATEGORY#')) categories.push(row);
  }
  const snapshot = buildSnapshot({ source, version, meta: plainMeta, categories, questions });
  snapshot.contentHash = contentHash(snapshot);

  /*
   * THE RE-SHARE GATE [R25]. `mayPublish` above only asks whether this version
   * was ever judged PASSED — it says nothing about whether the judged content
   * is what this call is about to publish. The version's question rows are
   * immutable, but the set-level prose (name, description, custom/AI-context
   * instructions, round brief) is edited in place with no new version
   * (edit-question-set.js), and that prose IS part of what the guardrail
   * judged (publishable.js's SET_FIELDS). So: submit v2 -> passes -> publish
   * -> edit the description -> unpublish -> `POST /publish {version:2}` would
   * otherwise republish the new, unjudged prose under the old verdict.
   *
   * [R2] recorded the hash rather than gating on it, on the premise that
   * publish always reads from the S3 snapshot. This path does not (that read
   * is Stage 2) — it rebuilds from the live org partition, which is exactly
   * what makes the edit-after-check window real. An older `passed` review
   * with no recorded hash (every row from before [R2] shipped) carries no
   * hash to compare and is unaffected.
   */
  if (review.contentHash && review.contentHash !== snapshot.contentHash) {
    return json(409, {
      error: 'This set has changed since it was checked. Submit it for review again.',
      status: review.status,
    });
  }

  const promptDropped = Boolean(plainMeta.promptId) && !(await platformPromptExists(db, TABLE(), plainMeta.promptId));
  const orgRow = (await db.send(new GetCommand({ TableName: TABLE(), Key: { PK: tenant.orgPk(orgId), SK: 'METADATA' } }))).Item;
  const published = await publishSnapshot(db, TABLE(), snapshot, {
    review, sourceOrgName: (orgRow && orgRow.name) || '', promptDropped,
  });
  await writeShareStamp(db, TABLE(), source, {
    version, status: 'published', publicSetId: published.publicSetId, publicVersion: published.publicVersion, contentHash: snapshot.contentHash,
  });
  await appendReviewEvent(db, TABLE(), source, 'published', {
    version, publicSetId: published.publicSetId, publicVersion: published.publicVersion, contentHash: snapshot.contentHash, promptDropped,
  });

  console.log(`🌍 published ${orgId}/${setId} v${version} as public ${published.publicSetId} v${published.publicVersion}`);
  return json(201, {
    publicSetId: published.publicSetId,
    publicVersion: published.publicVersion,
    sourceVersion: version,
    rowsPublished: published.rowsPublished,
    promptDropped,
  });
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
