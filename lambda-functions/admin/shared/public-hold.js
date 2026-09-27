/**
 * A SET HELD FOR THE PUBLIC LIBRARY — kept until a copy is accepted, then gone.
 *
 * The owner, 27 Sep 2026, on leaving a paid plan: *"they can before deleting
 * also click a make public button (but they will be told they will not be
 * deleted until they are accepted into public (a copy) or they come back and
 * uncheck make public"*.
 *
 * So "Make public" is not a delete and not a publish. It is a HOLD: an
 * attribute on the set's own metadata row that says "this set is on its way to
 * the public library, and once a copy of it is live there, remove it from
 * here". Until then the set is untouched — it lists, plays and edits exactly as
 * before — and it is NOT COUNTED against the free allowance (usage.js
 * `countSets`), because it is about to leave. Everything that ends a hold lives
 * in this file, so no path can end one differently:
 *
 *   accepted  the version held went live in the public library (the direct
 *             publish, the check worker on `passed`, a person's approve in
 *             Moderation) → the set is DELETED, every version, by the same
 *             sweep `DELETE /admin/question-sets/{setId}` uses (set-delete.js).
 *   declined  a person rejected it in Moderation, or the content check flagged
 *             it → the hold is RELEASED and the set counts again; the row says
 *             why, so the dialog can tell the person rather than have a set
 *             silently reappear in their count.
 *   unticked  the person changed their mind → released, counts again.
 *   changed   the library accepted the version held, but the set has a newer
 *             version now → released rather than deleted: deleting would throw
 *             away content the public copy does not have.
 *
 * ── THE ROWS ──────────────────────────────────────────────────────────────
 *
 *   <scope>SETS / SET#<id>   publicHold          { at, by, version }
 *                            publicHoldReleased  { at, reason, note, version }
 *
 * Both on the METADATA row and written with UpdateCommand on the one attribute,
 * never a read-modify-write Put — the row's other fields are ciphertext under
 * the org's key (the same rule share-stamp.js follows), and this file never
 * holds that key. That is also what lets ModerationDecideFunction and the check
 * worker call it without kms:Decrypt.
 *
 * A write to that row is a stream record on `ORG#<org>#SETS`, so holding or
 * releasing a set re-counts the organisation's sets on its own
 * (usage-stream.js) — the free-tier gate follows without anything here
 * touching a USAGE# row.
 *
 * ── NEITHER ATTRIBUTE MAY REACH THE PUBLIC COPY ──────────────────────────
 *
 * The snapshot a check takes is the whole metadata row, so a set held BEFORE
 * its check carries `publicHold` into the snapshot. publish-set.js strips both
 * attributes from what it writes to the public row (`PRIVATE_META`, below):
 * who held it, and when, is the organisation's business and not the library's.
 */
const { GetCommand, UpdateCommand } = require('@aws-sdk/lib-dynamodb');
const { setMetadataKey, toVersion } = require('./set-version');
const { deleteSetRows } = require('./set-delete');

const HOLD = 'publicHold';
const RELEASED = 'publicHoldReleased';
/** The metadata attributes that are the organisation's own and never published. */
const PRIVATE_META = Object.freeze([HOLD, RELEASED]);

const RELEASE_REASONS = Object.freeze(['declined', 'flagged', 'unticked', 'changed']);
const NOTE_MAX = 500;

const isConditionFailure = (e) => e && (e.name === 'ConditionalCheckFailedException' || e.code === 'ConditionalCheckFailedException');
const isHeld = (meta) => Boolean(meta && meta[HOLD] && typeof meta[HOLD] === 'object');
const holdOf = (meta) => (isHeld(meta) ? meta[HOLD] : null);
const releasedOf = (meta) => (meta && meta[RELEASED] && typeof meta[RELEASED] === 'object' ? meta[RELEASED] : null);

/**
 * Hold a set. Conditional on the row existing, so a set deleted a moment ago
 * is not resurrected as a nameless stub under ORG#<org>#SETS (share-stamp.js
 * makes the same point). Clears any earlier release note — a set held again is
 * not "declined" any more. Returns false when the set is gone.
 */
async function markHeld(db, tableName, ref, { version = null, by = '', now = new Date() } = {}) {
  try {
    await db.send(new UpdateCommand({
      TableName: tableName,
      Key: setMetadataKey(ref),
      UpdateExpression: 'SET #hold = :hold REMOVE #rel',
      ConditionExpression: 'attribute_exists(PK)',
      ExpressionAttributeNames: { '#hold': HOLD, '#rel': RELEASED },
      ExpressionAttributeValues: {
        ':hold': { at: now.toISOString(), by: String(by || ''), version: toVersion(version) },
      },
    }));
    return true;
  } catch (e) {
    if (isConditionFailure(e)) return false;
    throw e;
  }
}

/**
 * Release a hold, saying why. Conditional on there BEING one, so releasing a
 * set nobody held is a no-op rather than a note appearing out of nowhere.
 * `reason: ''` releases without leaving a note — for a hold this request itself
 * took and could not use (the check would not start), which is not news.
 * Returns whether a hold was released.
 */
async function releaseHold(db, tableName, ref, { reason = '', note = '', version = null, now = new Date() } = {}) {
  if (reason && !RELEASE_REASONS.includes(reason)) {
    throw new Error(`public-hold: refusing release reason ${JSON.stringify(reason)}`);
  }
  const names = { '#hold': HOLD };
  const values = {};
  let expr = 'REMOVE #hold';
  if (reason) {
    names['#rel'] = RELEASED;
    values[':rel'] = {
      at: now.toISOString(), reason, note: String(note || '').slice(0, NOTE_MAX), version: toVersion(version),
    };
    expr = 'SET #rel = :rel REMOVE #hold';
  }
  try {
    await db.send(new UpdateCommand({
      TableName: tableName,
      Key: setMetadataKey(ref),
      UpdateExpression: expr,
      ConditionExpression: 'attribute_exists(#hold)',
      ExpressionAttributeNames: names,
      ...(reason ? { ExpressionAttributeValues: values } : {}),
    }));
    return true;
  } catch (e) {
    if (isConditionFailure(e)) return false;
    throw e;
  }
}

/**
 * WHAT A DECISION ABOUT ONE VERSION MEANS FOR A HELD SET — called by every path
 * that decides a version's fate in the public library, AFTER that decision has
 * landed (the public copy is live, or the rejection is recorded).
 *
 *   outcome 'published'  the public copy of `version` is live
 *   outcome 'declined'   the library will not take `version`; `reason` is
 *                        'declined' (a person) or 'flagged' (the check)
 *
 * A decision about a version OTHER than the one held changes nothing: an old
 * escalated v1 being rejected says nothing about the v2 somebody is holding.
 *
 * Re-reads the row, because the caller's copy may predate the hold — a check
 * already running when "Make public" was pressed is the ordinary case, not the
 * edge one. Never touches a set that is not held.
 *
 * @returns {Promise<{ settled: boolean, action?: 'deleted'|'released', reason?: string, itemsDeleted?: number }>}
 */
async function settleHeldSet(db, tableName, ref, {
  outcome, version = null, reason = 'declined', note = '', now = new Date(),
} = {}) {
  const meta = (await db.send(new GetCommand({ TableName: tableName, Key: setMetadataKey(ref) }))).Item;
  if (!isHeld(meta)) return { settled: false, reason: 'not-held' };
  const heldVersion = toVersion(meta[HOLD].version);
  const decided = toVersion(version);
  if (decided !== heldVersion) return { settled: false, reason: 'other-version' };

  if (outcome === 'declined') {
    const released = await releaseHold(db, tableName, ref, {
      reason: reason === 'flagged' ? 'flagged' : 'declined', note, version: decided, now,
    });
    return released ? { settled: true, action: 'released' } : { settled: false, reason: 'not-held' };
  }
  if (outcome !== 'published') throw new Error(`public-hold: unknown outcome ${JSON.stringify(outcome)}`);

  // THE LIBRARY HAS A COPY OF THE VERSION HELD — but if the set has moved on
  // since (a newer version uploaded while it waited), that copy is not the
  // set any more. Keep it, and say so, rather than delete what was never
  // published.
  if (toVersion(meta.activeVersion) !== decided) {
    await releaseHold(db, tableName, ref, {
      reason: 'changed',
      note: 'The public library took the version you held, and this set has a newer one — so it was kept.',
      version: decided,
      now,
    });
    return { settled: true, action: 'released', reason: 'changed' };
  }

  const { itemsDeleted } = await deleteSetRows(db, tableName, ref, meta);
  console.log(`🌍 held set ${ref.orgId}/${ref.setId} v${decided} is public now — removed from its organisation (${itemsDeleted} rows)`);
  return { settled: true, action: 'deleted', itemsDeleted };
}

module.exports = {
  HOLD, RELEASED, PRIVATE_META, RELEASE_REASONS,
  isHeld, holdOf, releasedOf, markHeld, releaseHold, settleHeldSet,
};
