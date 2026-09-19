/**
 * THE QUEUE IS A POINTER PARTITION — spec §3.2, decision D4.
 *
 * The table has no GSIs, so "every version waiting for a person" cannot be
 * queried from the REVIEW rows. One small row per waiting item, found by a
 * Query on `PK = MODERATION`. The SK is STABLE (no timestamp) so a repeat
 * report or an appeal bumps the row instead of re-keying it; `waitingSince`
 * is an attribute and the list sorts in memory — at tens of rows that is free.
 *
 * No TTL: a queue row must not vanish. Only a decision deletes it.
 * NEVER question text: the snapshot lives in S3 (`snapshotKey`).
 */
const { GetCommand, PutCommand, DeleteCommand, QueryCommand } = require('@aws-sdk/lib-dynamodb');

const QUEUE_PK = 'MODERATION';
const REASONS = Object.freeze(['escalated', 'appealed', 'reported', 'declared', 'images']);
/**
 * Fields a pointer may carry. Anything else — snapshots, questions — is refused by omission.
 * `checkReasons` is what a check escalation was FOR (the REVIEW row's reasons:
 * images, declared, guardrail, timeout, snapshot, error) and `declaredNotice`
 * the notices it names; like `bands`, a later check replaces them.
 */
const POINTER_FIELDS = Object.freeze([
  'orgId', 'orgName', 'setId', 'title', 'version', 'gameType', 'questionCount',
  'bands', 'uncertainQuestionIds', 'checkReasons', 'declaredNotice',
  'appealMessage', 'reports', 'snapshotKey', 'contentHash', 'publicSetId',
]);
const clean = (v) => (typeof v === 'string' ? v.trim() : '');
const versionOf = (version) => { const v = Number(version); return Number.isFinite(v) && v > 0 ? v : 0; };

function queueSk(ref, version) {
  const scope = clean(ref && ref.scope) || 'platform';
  const setId = clean(ref && ref.setId);
  if (!setId) throw new Error('moderation-queue: a set id is required');
  if (scope === 'org') {
    const orgId = clean(ref && ref.orgId);
    if (!orgId) throw new Error('moderation-queue: scope "org" requires an orgId');
    return `${orgId}#${setId}#v${versionOf(version)}`;
  }
  if (scope === 'public') return `PUBLIC#${setId}`;
  return `PLATFORM#${setId}`;
}
const queueKey = (sk) => ({ PK: QUEUE_PK, SK: sk });

async function upsertQueueRow(db, tableName, { ref, version, reason, ...fields }, { now = new Date() } = {}) {
  if (!REASONS.includes(reason)) throw new Error(`moderation-queue: refusing reason ${JSON.stringify(reason)}`);
  const sk = queueSk(ref, version);
  const existing = (await db.send(new GetCommand({ TableName: tableName, Key: queueKey(sk) }))).Item;
  const at = now.toISOString();
  const scope = clean(ref.scope) || 'platform';
  const pointer = Object.fromEntries(POINTER_FIELDS.filter((f) => f in fields).map((f) => [f, fields[f]]));
  const item = {
    ...(existing || {}),
    ...pointer,
    scope,
    setId: clean(ref.setId),
    ...(scope === 'org' ? { orgId: clean(ref.orgId), version: versionOf(version) } : {}),
    reasons: [...new Set([...((existing && existing.reasons) || []), reason])],
    waitingSince: (existing && existing.waitingSince) || at,
    latestAt: at,
    // The keys come LAST so nothing a caller passes — and nothing on an
    // existing row — can move this pointer to another key.
    ...queueKey(sk),
  };
  await db.send(new PutCommand({ TableName: tableName, Item: item }));
  return item;
}
async function deleteQueueRow(db, tableName, sk) {
  await db.send(new DeleteCommand({ TableName: tableName, Key: queueKey(sk) }));
}
async function listQueue(db, tableName) {
  const items = [];
  let ExclusiveStartKey;
  do {
    const res = await db.send(new QueryCommand({ // eslint-disable-line no-await-in-loop
      TableName: tableName,
      KeyConditionExpression: 'PK = :pk',
      ExpressionAttributeValues: { ':pk': QUEUE_PK },
      ExclusiveStartKey,
    }));
    items.push(...((res && res.Items) || []));
    ExclusiveStartKey = res && res.LastEvaluatedKey;
  } while (ExclusiveStartKey);
  return items.sort((a, b) => String(a.waitingSince).localeCompare(String(b.waitingSince)));
}
module.exports = { QUEUE_PK, REASONS, POINTER_FIELDS, queueSk, queueKey, upsertQueueRow, deleteQueueRow, listQueue };
