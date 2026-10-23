#!/usr/bin/env node
/**
 * Backfill #45's bell entries for Claude's unsaved question sets.
 *
 * Since #45 a Build Room writes a quiet entry in the host's bell when Claude
 * sends it a question set, and the entry turns into a reminder two days before
 * the session ends. Sets that arrived before that change have no entry, so
 * their host would never be reminded. This finds every unsaved set whose
 * session is still alive and writes the entry the room would have written
 * (build-room.js `unsavedSetNote`, the same words), skipping any that has one.
 *
 * Ask Claude for questions reached dev and test on 22 Oct 2026 and never
 * prod before #45, so only those two tiers can have sets to cover.
 *
 *   node scripts/backfill-claude-set-reminders.js <table>            # dry run
 *   TENANT_KMS_KEY_ID=<key> node scripts/backfill-claude-set-reminders.js <table> --apply
 *
 * A team room's set and session title are sealed, so reading them and sealing
 * the entry need the tier's tenant key (the stack's TenantKey; the functions
 * carry it as TENANT_KMS_KEY_ID). Without it, a dry run still counts team rows
 * and --apply refuses them.
 */
const path = require('path');

const REPO = path.join(__dirname, '..');
const [, , tableName, ...flags] = process.argv;
const apply = flags.includes('--apply');
if (!tableName) {
  console.error('usage: backfill-claude-set-reminders.js <table-name> [--apply]');
  process.exit(2);
}
// Read by notifications.js and tenant-crypto.js when they are called.
process.env.TABLE_NAME = tableName;

const GAME = path.join(REPO, 'lambda-functions', 'game');
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, ScanCommand, GetCommand } = require('@aws-sdk/lib-dynamodb');
const { decryptItem } = require(path.join(GAME, 'tenant-crypto'));
const { notificationsPk } = require(path.join(GAME, 'tenant'));
const inbox = require(path.join(GAME, 'notifications'));
const { _internals: { unsavedSetNote } } = require(path.join(GAME, 'build-room'));

const db = DynamoDBDocumentClient.from(new DynamoDBClient({}), { marshallOptions: { removeUndefinedValues: true } });
const hasKey = Boolean(process.env.TENANT_KMS_KEY_ID || process.env.KMS_KEY_ID);

async function unsavedSets(now) {
  const rows = [];
  let ExclusiveStartKey;
  do {
    const res = await db.send(new ScanCommand({
      TableName: tableName,
      FilterExpression: 'begins_with(SK, :q) AND attribute_not_exists(SavedAt) AND (attribute_not_exists(#ttl) OR #ttl > :now)',
      ExpressionAttributeNames: { '#ttl': 'ttl' },
      ExpressionAttributeValues: { ':q': 'BUILD#QSET#', ':now': now },
      ExclusiveStartKey,
    }));
    rows.push(...(res.Items || []));
    ExclusiveStartKey = res.LastEvaluatedKey;
  } while (ExclusiveStartKey);
  return rows;
}

(async () => {
  const now = Math.floor(Date.now() / 1000);
  const sets = await unsavedSets(now);
  console.log(`${apply ? 'Backfilling' : 'DRY RUN'}: ${sets.length} unsaved Claude set(s) in live rows of "${tableName}"\n`);

  const tally = { written: 0, would: 0, has: 0, ended: 0, noHost: 0, sealed: 0, failed: 0 };
  const metas = new Map();
  for (const row of sets) {
    const gameId = String(row.PK).replace('GAME#', '');
    if (!metas.has(gameId)) {
      const got = await db.send(new GetCommand({ TableName: tableName, Key: { PK: row.PK, SK: 'METADATA' } }));
      metas.set(gameId, got && got.Item);
    }
    let meta = metas.get(gameId);
    const label = `${gameId} ${row.QSetId}`;
    if (!meta || meta.GameType !== 'build' || !(Number(meta.ttl) > now)) { tally.ended += 1; console.log(`  ended    ${label}`); continue; }
    if (!meta.CreatedBy) { tally.noHost += 1; console.log(`  no host  ${label}`); continue; }
    const orgId = meta.orgId || meta.OrgId || '';

    const existing = await db.send(new GetCommand({
      TableName: tableName,
      Key: { PK: notificationsPk(meta.CreatedBy), SK: `NOTE#claudeset#${gameId}-${row.QSetId}` },
    }));
    if (existing && existing.Item) { tally.has += 1; console.log(`  has one  ${label}`); continue; }

    let set = row;
    if (orgId) {
      if (!hasKey) { tally.sealed += 1; console.log(`  sealed   ${label} (team room; needs TENANT_KMS_KEY_ID)`); continue; }
      try {
        meta = await decryptItem(orgId, 'session', meta);
        set = await decryptItem(orgId, 'buildQSet', row);
      } catch (error) {
        tally.failed += 1; console.log(`  FAILED   ${label}: ${error.message}`); continue;
      }
    }
    const note = unsavedSetNote({ gameId, meta, orgId, ttl: Number(meta.ttl) }, { QSetId: row.QSetId, Title: set.Title });
    if (!apply) { tally.would += 1; console.log(`  would    ${label}  "${set.Title}"`); continue; }
    if (await inbox.notify(db, note)) { tally.written += 1; console.log(`  written  ${label}`); } else { tally.failed += 1; console.log(`  FAILED   ${label}`); }
  }

  console.log(`\n${JSON.stringify(tally)}`);
  if (!apply && tally.would) console.log('Run again with --apply to write them.');
  process.exit(tally.failed ? 1 : 0);
})().catch((error) => { console.error(error); process.exit(1); });
