/**
 * PUBLISH A VERSION WHOSE REVIEW PASSED, FROM THE ORGANISATION'S OWN ROWS.
 *
 * The direct share: `POST /admin/question-sets/{setId}/publish`, and the
 * "Make public" of a set held while leaving a plan (orgs/leave-plan.js) when
 * the version it holds has already passed the content check. The two share
 * ONE routine because every gate below is a way to put the wrong thing in the
 * public library, and a second copy of the gates is a second place to forget
 * one. The body of this function is what `publish-question-set.js share()`
 * used to hold, moved here unchanged and in the same order.
 *
 * ── WHY THIS IS NOT IN publish-set.js ─────────────────────────────────────
 *
 * publish-set.js publishes FROM A SNAPSHOT (the check worker, the staff
 * decision) and needs no key. This reads the org's LIVE rows, which are
 * ciphertext, so it requires tenant-crypto — and every function that requires
 * this file must therefore hold kms:Decrypt (tests/kms-grants-match-code.js
 * walks the require graph and fails the build otherwise). Kept apart so that
 * ModerationDecideFunction and the check worker, which never decrypt, are not
 * made to.
 *
 * ── THE GATES, IN ORDER ───────────────────────────────────────────────────
 *
 *   1. the version's review PASSED (`mayPublish` — one value, not a blocklist;
 *      `escalated` BLOCKS)
 *   2. the version has questions
 *   3. the set is FILED on a shelf (shared/set-topics.js)
 *   4. the content is still what was judged — `review.contentHash` against the
 *      snapshot built now [R25]: set prose is edited in place with no new
 *      version, and that prose is part of what the guardrail judged
 *
 * Each refusal is a 409 — the request is well formed, the SET is not ready —
 * and carries a `reason` a caller can branch on without reading the sentence.
 */
const { GetCommand } = require('@aws-sdk/lib-dynamodb');
const tenant = require('./tenant');
const { resolvePartitionFromMeta, toVersion, queryPartition } = require('./set-version');
const { decryptItem } = require('./tenant-crypto');
const { readReview, mayPublish, STATUS } = require('./set-review');
const { resolveSetTopic, setTopicRefusal, UNFILED } = require('./set-topics');
const { buildSnapshot, contentHash } = require('./publishable');
const { platformPromptExists, publishSnapshot } = require('./publish-set');
const { writeShareStamp } = require('./share-stamp');
const { appendReviewEvent } = require('./review-log');

/**
 * The snapshot of one version as it stands NOW, decrypted — what a publish
 * would put in the library, and what its hash is compared against.
 *
 * @returns {Promise<{ snapshot: object, plainMeta: object, questionCount: number }>}
 */
async function liveSnapshot(db, tableName, source, meta, version) {
  const orgId = source.orgId;
  const resolved = resolvePartitionFromMeta(source, meta, toVersion(version));
  const { items: rows } = await queryPartition(db, tableName, resolved.pk);
  const plainMeta = await decryptItem(orgId, 'set', meta);
  const questions = [];
  const categories = [];
  for (const row of rows) {
    const sk = String(row.SK || '');
    if (sk.startsWith('QUESTION#')) questions.push(await decryptItem(orgId, 'question', row)); // eslint-disable-line no-await-in-loop
    else if (sk.startsWith('CATEGORY#')) categories.push(row);
  }
  const snapshot = buildSnapshot({ source, version: resolved.version, meta: plainMeta, categories, questions });
  snapshot.contentHash = contentHash(snapshot);
  return { snapshot, plainMeta, questionCount: questions.length };
}

/**
 * Publish `version` of the org set `source` (whose metadata row is `meta`).
 *
 * @param {object} opts
 * @param {object} opts.source   setRef({ scope: 'org', orgId, setId })
 * @param {object} opts.meta     the set's metadata row, as read
 * @param {*}      opts.version  the version asked for (null = the active one)
 * @param {boolean} opts.resume  publish-set.js's `resume`: converge onto a public
 *                               version that already records this exact content
 *                               instead of minting another. The direct share
 *                               passes false — a second share is meant to land
 *                               as a new public version. A held set passes true:
 *                               "make this public" of a version already live
 *                               must not add a duplicate listing.
 * @returns {Promise<{ status: number, body: object, reason: string, review: object,
 *                     published?: object, version: (number|null) }>}
 */
async function publishLiveVersion(db, tableName, {
  source, meta, version = null, resume = false,
}) {
  const orgId = source.orgId;
  const resolved = resolvePartitionFromMeta(source, meta, toVersion(version));
  const v = resolved.version;

  // THE GATE. Read from the version's own row — see shared/set-review.js for
  // why it is a row and not a field on `versions[]`.
  const review = await readReview(db, tableName, source, v);
  if (!mayPublish(review)) {
    return {
      status: 409,
      reason: 'not-passed',
      review,
      version: v,
      body: {
        error: review.status === STATUS.ESCALATED
          ? 'This version is with a person at Engage. You will hear back either way.'
          : 'This version has not passed the content check yet.',
        status: review.status,
        findings: review.findings || [],
      },
    };
  }

  const { items: rows } = await queryPartition(db, tableName, resolved.pk);
  if (!rows.some((r) => String(r.SK || '').startsWith('QUESTION#'))) {
    return { status: 409, reason: 'no-questions', review, version: v, body: { error: 'That version has no questions to share.' } };
  }

  const plainMeta = await decryptItem(orgId, 'set', meta);

  /*
   * THE SHELF GATE. The owner's sentence was *"req at least 1 pretty broad for
   * public ones"*, and this is the "public ones": the library everybody
   * browses, where a topic filter is worth having only if what is on the
   * shelves is filed. A set may go on living unfiled in its own organisation;
   * it does not get into the library unfiled. Read from `plainMeta` rather than
   * `meta` even though `ENCRYPTED_FIELDS.set` does not name `topic` — a second
   * reader deciding for itself which fields are sealed is the drift
   * edit-question-set.js warns about.
   */
  if (resolveSetTopic(plainMeta.topic) === UNFILED) {
    return { status: 409, reason: 'unfiled', review, version: v, body: { error: setTopicRefusal(plainMeta.topic) } };
  }

  const questions = [];
  const categories = [];
  for (const row of rows) {
    const sk = String(row.SK || '');
    if (sk.startsWith('QUESTION#')) questions.push(await decryptItem(orgId, 'question', row)); // eslint-disable-line no-await-in-loop
    else if (sk.startsWith('CATEGORY#')) categories.push(row);
  }
  const snapshot = buildSnapshot({ source, version: v, meta: plainMeta, categories, questions });
  snapshot.contentHash = contentHash(snapshot);

  /*
   * THE RE-SHARE GATE [R25]. `mayPublish` only asks whether this version was
   * ever judged PASSED — not whether the judged content is what is about to be
   * published. The question rows are immutable, but the set-level prose is
   * edited in place with no new version, and that prose IS part of what the
   * guardrail judged. An older `passed` review with no recorded hash (every row
   * from before [R2] shipped) carries no hash to compare and is unaffected.
   */
  if (review.contentHash && review.contentHash !== snapshot.contentHash) {
    return {
      status: 409,
      reason: 'changed',
      review,
      version: v,
      body: { error: 'This set has changed since it was checked. Submit it for review again.', status: review.status },
    };
  }

  const promptDropped = Boolean(plainMeta.promptId) && !(await platformPromptExists(db, tableName, plainMeta.promptId));
  const orgRow = (await db.send(new GetCommand({ TableName: tableName, Key: { PK: tenant.orgPk(orgId), SK: 'METADATA' } }))).Item;
  const published = await publishSnapshot(db, tableName, snapshot, {
    review, sourceOrgName: (orgRow && orgRow.name) || '', promptDropped, resume,
  });
  await writeShareStamp(db, tableName, source, {
    version: v, status: 'published', publicSetId: published.publicSetId, publicVersion: published.publicVersion, contentHash: snapshot.contentHash,
  });
  await appendReviewEvent(db, tableName, source, 'published', {
    version: v, publicSetId: published.publicSetId, publicVersion: published.publicVersion, contentHash: snapshot.contentHash, promptDropped,
  });

  console.log(`🌍 published ${orgId}/${source.setId} v${v} as public ${published.publicSetId} v${published.publicVersion}`);
  return {
    status: 201,
    reason: 'published',
    review,
    version: v,
    published,
    body: {
      publicSetId: published.publicSetId,
      publicVersion: published.publicVersion,
      sourceVersion: v,
      rowsPublished: published.rowsPublished,
      promptDropped,
    },
  };
}

module.exports = { liveSnapshot, publishLiveVersion };
