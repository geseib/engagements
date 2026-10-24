#!/usr/bin/env node
/**
 * Delete Engage-library question sets that were switched off because a newer
 * set replaced them.
 *
 *   AWS_PROFILE=adminaccess node scripts/delete-question-sets.js <table> <setId>... [--apply]
 *
 * WHY. retire-question-sets.js switches a replaced set off and keeps it, so
 * it can be switched back on. Once its replacement has been in use, the owner
 * may want it gone (owner, 24 Oct 2026, of the Build Room's old sets: "old
 * build room sets, then yes"). This deletes it with the console's own sweep
 * (admin/shared/set-delete.js: every version partition, then the index row
 * last), so a half-finished run can simply be run again.
 *
 * IT REFUSES, per set, rather than delete:
 *   - anything outside the Engage library (PK SETS): never an organisation's set;
 *   - a set that is still switched on: retire it first;
 *   - a set a session that has not expired still names (its METADATA
 *     QuestionSetId): that session's report and rounds read it.
 * Without --apply it only reads, and says per set what it would remove.
 */
const path = require('path');
const { createRequire } = require('module');

// The SDK is installed under lambda-functions/, not at the repo root, as the
// neighbouring scripts (update-ai-prompt.js, apply-repo-prompts.js) resolve it.
const lambdaRequire = createRequire(path.join(__dirname, '..', 'lambda-functions', 'package.json'));
const { DynamoDBClient } = lambdaRequire('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, GetCommand, ScanCommand } = lambdaRequire('@aws-sdk/lib-dynamodb');

const ADMIN = path.join(__dirname, '..', 'lambda-functions', 'admin', 'shared');
const { deleteSetRows, setPartitions } = require(path.join(ADMIN, 'set-delete'));
const { collectPartitionKeys } = require(path.join(ADMIN, 'ddb-delete'));
const tenant = require(path.join(ADMIN, 'tenant'));

const LIBRARY_PK = 'SETS';

/** Sessions, not yet expired, whose METADATA names one of these sets. */
async function sessionsUsing(db, tableName, setIds, now) {
  const using = new Map(setIds.map((id) => [id, []]));
  let ExclusiveStartKey;
  do {
    const res = await db.send(new ScanCommand({
      TableName: tableName,
      FilterExpression: 'SK = :m AND attribute_exists(QuestionSetId)',
      ExpressionAttributeValues: { ':m': 'METADATA' },
      ProjectionExpression: 'PK, QuestionSetId, #t',
      ExpressionAttributeNames: { '#t': 'ttl' },
      ExclusiveStartKey,
    }));
    for (const row of res.Items || []) {
      const live = !row.ttl || Number(row.ttl) > now;
      if (live && using.has(row.QuestionSetId)) using.get(row.QuestionSetId).push(String(row.PK).replace('GAME#', ''));
    }
    ExclusiveStartKey = res.LastEvaluatedKey;
  } while (ExclusiveStartKey);
  return using;
}

async function deleteSets(db, tableName, setIds, { apply = false, now = Math.floor(Date.now() / 1000) } = {}) {
  const lines = [];
  let failed = false;
  const using = await sessionsUsing(db, tableName, setIds, now);
  for (const setId of setIds) {
    const meta = (await db.send(new GetCommand({ TableName: tableName, Key: { PK: LIBRARY_PK, SK: `SET#${setId}` } }))).Item;
    if (!meta) { lines.push(`  ${setId}: not on this table, nothing to delete`); continue; }
    const name = meta.name || meta.Name || setId;
    if (meta.active !== false) { lines.push(`  ${setId}: "${name}" is still switched on; REFUSED (retire it first)`); failed = true; continue; }
    const sessions = using.get(setId) || [];
    if (sessions.length) { lines.push(`  ${setId}: "${name}" is named by live session(s) ${sessions.join(', ')}; REFUSED`); failed = true; continue; }
    const ref = { scope: tenant.PLATFORM, setId };
    if (!apply) {
      let rows = 1;
      for (const partition of setPartitions(ref, meta)) {
        rows += (await collectPartitionKeys(db, tableName, partition)).keys.length; // eslint-disable-line no-await-in-loop
      }
      lines.push(`  ${setId}: "${name}" (${meta.engagementType || '?'}, ${meta.questionCount ?? '?'} questions) WOULD BE DELETED: ${rows} row(s)`);
      continue;
    }
    try {
      const { itemsDeleted } = await deleteSetRows(db, tableName, ref, meta);
      lines.push(`  ${setId}: "${name}" deleted (${itemsDeleted} row(s))`);
    } catch (error) {
      lines.push(`  ${setId}: "${name}" FAILED: ${error.message} (run again to finish)`);
      failed = true;
    }
  }
  return { lines, failed };
}

module.exports = { deleteSets };

if (require.main === module) {
  const args = process.argv.slice(2);
  const apply = args.includes('--apply');
  const [tableName, ...setIds] = args.filter((a) => !a.startsWith('--'));
  if (!tableName || !setIds.length) {
    console.error('usage: delete-question-sets.js <table> <setId>... [--apply]');
    process.exit(2);
  }
  const db = DynamoDBDocumentClient.from(new DynamoDBClient({}));
  deleteSets(db, tableName, setIds, { apply }).then(({ lines, failed }) => {
    console.log(`${apply ? 'DELETING' : 'DRY RUN — would delete'} ${setIds.length} set(s) on ${tableName}`);
    lines.forEach((l) => console.log(l));
    if (!apply) console.log('Dry run only. Re-run with --apply to delete.');
    process.exit(failed ? 1 : 0);
  }).catch((error) => { console.error(error); process.exit(1); });
}
