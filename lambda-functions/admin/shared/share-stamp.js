/**
 * THE `share` STAMP ON THE ORG SET'S METADATA ROW — spec §3.1.
 *
 * The list's cache: "Who can see it" reads this and nothing else, so the list
 * is not one REVIEW read per version per set. The per-version REVIEW row stays
 * the gate and the PUBLISHED row stays the Versions panel's fact.
 *
 * Written with UpdateCommand on the ONE attribute, never by a read-modify-write
 * Put of the row: the row's other fields are ciphertext under the org's key,
 * and a platform-mode caller (takedown, later) must be able to write this
 * without holding that key and without touching anything else.
 *
 * The map is REPLACED, not merged. Each writer knows the whole truth of the
 * moment it writes; a merge would let a flagged v3 keep v2's publicSetId.
 */
const { UpdateCommand } = require('@aws-sdk/lib-dynamodb');
const { setMetadataKey } = require('./set-version');

const SHARE_STATUSES = Object.freeze(['checking', 'passed', 'published', 'flagged', 'escalated', 'appealed', 'unpublished']);
const FIELDS = Object.freeze(['version', 'status', 'publicSetId', 'publicVersion', 'note', 'contentHash', 'jobId', 'reasons']);

async function writeShareStamp(db, tableName, sourceRef, stamp, { now = new Date() } = {}) {
  if (!SHARE_STATUSES.includes(stamp && stamp.status)) {
    throw new Error(`share-stamp: refusing status ${JSON.stringify(stamp && stamp.status)}`);
  }
  const share = Object.fromEntries(FIELDS.filter((f) => stamp[f] !== undefined && stamp[f] !== null).map((f) => [f, stamp[f]]));
  share.at = now.toISOString();
  await db.send(new UpdateCommand({
    TableName: tableName,
    Key: setMetadataKey(sourceRef),
    UpdateExpression: 'SET #share = :share',
    ExpressionAttributeNames: { '#share': 'share' },
    ExpressionAttributeValues: { ':share': share },
  }));
  return share;
}
const readShareStamp = (meta) => (meta && meta.share && typeof meta.share === 'object' ? meta.share : null);
module.exports = { SHARE_STATUSES, writeShareStamp, readShareStamp };
