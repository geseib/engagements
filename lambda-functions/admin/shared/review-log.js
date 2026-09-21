/**
 * EVERY REVIEW IS A RECORD — spec §3.4.
 *
 * The version's REVIEW row is the gate and is rewritten on every check; this
 * partition is the memory. Append-only, platform-owned, plaintext, no TTL. It
 * holds nothing an author has not already asked to make public, except a
 * reporter's own note.
 *
 * Declared HERE and not in tenant.js: that file is triplicated across the game,
 * websocket and admin bundles with a drift guard, and no runtime reader needs
 * this partition.
 */
const { PutCommand, QueryCommand } = require('@aws-sdk/lib-dynamodb');

const EVENTS = Object.freeze([
  'checked', 'escalated', 'appealed', 'decided', 'reported', 'taken-down',
  'unpublished', 'published', 'notice-set', 'notice-cleared', 'access',
  // Staff looked at what a re-check of a listing the library already serves
  // found, and left the listing serving. Its own event and NOT `decided`: that
  // one means a version was approved or rejected, and moderation-decide.js reads
  // the log for it when it resumes a crashed decision — recording this as
  // `decided` would tell a resume that somebody had ruled on the version.
  'left-serving',
]);
const clean = (v) => (typeof v === 'string' ? v.trim() : '');

function reviewLogPk(ref) {
  const scope = clean(ref && ref.scope) || 'platform';
  const orgId = scope === 'org' ? clean(ref && ref.orgId) : '';
  const setId = clean(ref && ref.setId);
  if (!setId) throw new Error('review-log: a set id is required');
  if (scope === 'org' && !orgId) throw new Error('review-log: scope "org" requires an orgId');
  return `REVIEWLOG#${scope}#${orgId || '-'}#${setId}`;
}
let seq = 0;
async function appendReviewEvent(db, tableName, ref, event, data = {}, { now = new Date() } = {}) {
  if (!EVENTS.includes(event)) throw new Error(`review-log: refusing to record event ${JSON.stringify(event)}`);
  seq = (seq + 1) % 1000000;
  const at = now.toISOString();
  const item = {
    ...data,
    // The computed keys come LAST so a caller's `data` can never rename the
    // event, move the row to another partition, or forge its time.
    PK: reviewLogPk(ref),
    SK: `${at}#${String(seq).padStart(6, '0')}#${event}`,
    event,
    at,
  };
  await db.send(new PutCommand({ TableName: tableName, Item: item }));
  return item;
}
async function readReviewLog(db, tableName, ref) {
  const items = [];
  let ExclusiveStartKey;
  do {
    const res = await db.send(new QueryCommand({ // eslint-disable-line no-await-in-loop
      TableName: tableName,
      KeyConditionExpression: 'PK = :pk',
      ExpressionAttributeValues: { ':pk': reviewLogPk(ref) },
      ExclusiveStartKey,
    }));
    items.push(...((res && res.Items) || []));
    ExclusiveStartKey = res && res.LastEvaluatedKey;
  } while (ExclusiveStartKey);
  return items;
}
module.exports = { EVENTS, reviewLogPk, appendReviewEvent, readReviewLog };
