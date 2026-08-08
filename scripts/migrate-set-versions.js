#!/usr/bin/env node
/**
 * Migrate question sets from the pre-versioning layout to versioned ones.
 *
 *   AWS_PROFILE=adminaccess node scripts/migrate-set-versions.js <table>            # DRY RUN
 *   AWS_PROFILE=adminaccess node scripts/migrate-set-versions.js <table> --apply
 *   AWS_PROFILE=adminaccess node scripts/migrate-set-versions.js <table> --apply --only=arttitles,greatesthits
 *
 * See docs/superpowers/specs/2026-08-08-question-set-versioning-design.md.
 *
 * BEFORE                          AFTER
 *   PK=SETS  SK=SET#<id>            unchanged, plus activeVersion:1 and versions[]
 *   PK=SET#<id>  QUESTION#…         STILL THERE — untouched
 *                CATEGORY#…
 *                                   PK=SET#<id>#v1  QUESTION#…  (a COPY)
 *                                                   CATEGORY#…
 *
 * It COPIES. The legacy rows are deliberately left in place, so rolling this
 * back is one `REMOVE activeVersion, versions` per set and needs no restore —
 * the resolver's third step falls straight back to `SET#<id>`. A later sweep
 * removes the legacy rows once every environment is migrated and settled; that
 * sweep is explicitly NOT this script.
 *
 * IDEMPOTENT. A set that already carries activeVersion or a versions[] entry is
 * skipped outright, so re-running cannot double-migrate, cannot renumber, and
 * cannot overwrite a version written by a replace since the last run.
 *
 * Reads are paginated Queries against known partitions — never a Scan — and
 * writes go through the same batched, UnprocessedItems-retrying helper the
 * importer uses.
 *
 * Style follows scripts/seed-personas.js and scripts/cull-ai-prompts.js: dry run
 * by default, --apply to write.
 */
const path = require('path');
const { createRequire } = require('module');

// The AWS SDK is installed under lambda-functions/, not at the repo root.
const REPO = path.join(__dirname, '..');
const lambdaRequire = createRequire(path.join(REPO, 'lambda-functions', 'package.json'));
const { DynamoDBClient } = lambdaRequire('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, QueryCommand, UpdateCommand } = lambdaRequire('@aws-sdk/lib-dynamodb');

// The SAME resolution/copy helper the lambdas use, so the layout this script
// produces cannot drift from the layout the runtime expects.
const {
  copyPartition,
  knownVersions,
  queryPartition,
  setPartition,
  toVersion,
} = require(path.join(REPO, 'lambda-functions', 'admin', 'shared', 'set-version.js'));

const [, , tableName, ...flags] = process.argv;
const apply = flags.includes('--apply');
const onlyFlag = flags.find((f) => f.startsWith('--only='));
const only = onlyFlag ? onlyFlag.split('=')[1].split(',').map((s) => s.trim()).filter(Boolean) : null;

if (!tableName) {
  console.error('usage: migrate-set-versions.js <table-name> [--apply] [--only=setId,setId]');
  process.exit(2);
}

const db = DynamoDBDocumentClient.from(new DynamoDBClient({}));

/** Every set metadata row, following LastEvaluatedKey to the end. */
async function readAllSets() {
  const items = [];
  let exclusiveStartKey;
  let pages = 0;

  do {
    const res = await db.send(new QueryCommand({
      TableName: tableName,
      KeyConditionExpression: 'PK = :pk',
      ExpressionAttributeValues: { ':pk': 'SETS' },
      ExclusiveStartKey: exclusiveStartKey,
    }));
    items.push(...(res.Items || []));
    exclusiveStartKey = res.LastEvaluatedKey;
    pages++;
  } while (exclusiveStartKey);

  console.log(`read ${items.length} set(s) from PK=SETS in ${pages} page(s)\n`);
  return items;
}

(async () => {
  console.log(`${apply ? 'APPLYING to' : 'DRY RUN against'} table "${tableName}"`);
  if (only) console.log(`limited to: ${only.join(', ')}`);
  console.log('');

  const sets = await readAllSets();

  let migrated = 0, skippedVersioned = 0, skippedEmpty = 0, rowsCopied = 0;

  for (const meta of sets) {
    const setId = String(meta.SK).replace('SET#', '');
    if (only && !only.includes(setId)) continue;

    const name = meta.name || meta.Name || '(unnamed)';
    const active = toVersion(meta.activeVersion);
    const known = knownVersions(meta);

    // Idempotence guard. Anything already versioned — by a previous run of this
    // script or by a replace — is left completely alone.
    if (active !== null || known.length > 0) {
      console.log(`SKIP  ${setId}  "${name}"  — already versioned (active v${active ?? '-'}, versions [${known.join(', ')}])`);
      skippedVersioned++;
      continue;
    }

    const legacyPk = setPartition(setId, null);
    const { items: legacyItems, pages } = await queryPartition(db, tableName, legacyPk);

    if (legacyItems.length === 0) {
      // A metadata row with no content partition. Giving it activeVersion:1
      // would point every reader at an empty partition, which is strictly worse
      // than leaving it on the legacy branch where it at least fails the same
      // way it does today.
      console.log(`SKIP  ${setId}  "${name}"  — no content rows under ${legacyPk}`);
      skippedEmpty++;
      continue;
    }

    const questionCount = legacyItems.filter((i) => String(i.SK).startsWith('QUESTION#')).length;
    const categoryCount = legacyItems.filter((i) => String(i.SK).startsWith('CATEGORY#')).length;

    console.log(`COPY  ${setId}  "${name}"  ${legacyItems.length} row(s) `
      + `(${questionCount} question, ${categoryCount} category) in ${pages} page(s) -> ${setPartition(setId, 1)}`);
    console.log(`      then SET activeVersion = 1`);

    if (apply) {
      const copied = await copyPartition(db, tableName, legacyPk, setPartition(setId, 1));
      rowsCopied += copied;

      // Content FIRST, pointer second — the same ordering the importer uses.
      // A crash between the two leaves an unreferenced v1 partition and a set
      // that still reads its legacy rows: the next run copies again (harmless,
      // same keys, same content) and completes the pointer.
      await db.send(new UpdateCommand({
        TableName: tableName,
        Key: { PK: 'SETS', SK: `SET#${setId}` },
        // Aliased throughout, matching the lambdas.
        UpdateExpression: 'SET #activeVersion = :v, #versions = :versions, #updatedAt = :now',
        // Never overwrite a version that appeared between the read and here.
        ConditionExpression: 'attribute_not_exists(#activeVersion)',
        ExpressionAttributeNames: {
          '#activeVersion': 'activeVersion',
          '#versions': 'versions',
          '#updatedAt': 'updatedAt',
        },
        ExpressionAttributeValues: {
          ':v': 1,
          ':versions': [{
            version: 1,
            createdAt: meta.createdAt || meta.CreatedAt || new Date().toISOString(),
            questionCount: meta.questionCount || questionCount,
            categoryCount: meta.categoryCount || categoryCount,
            sourceFile: meta.sourceFile || '',
            note: 'migrated from the pre-versioning layout',
          }],
          ':now': new Date().toISOString(),
        },
      })).catch((e) => {
        if (e.name === 'ConditionalCheckFailedException') {
          console.log(`      ⚠️ ${setId} gained an activeVersion mid-run; pointer left alone (the v1 copy is harmless)`);
          return;
        }
        throw e;
      });
    }

    migrated++;
  }

  console.log('');
  console.log(`sets migrated:            ${migrated}`);
  console.log(`skipped (already versioned): ${skippedVersioned}`);
  console.log(`skipped (no content):     ${skippedEmpty}`);
  if (apply) console.log(`rows copied:              ${rowsCopied}`);
  if (!apply) console.log('\nDry run only. Re-run with --apply to write.');
  console.log('\nLegacy SET#<id> rows are left in place on purpose — rollback is '
    + '`REMOVE activeVersion, versions` and needs no restore.');
})().catch((err) => {
  console.error('migration failed:', err);
  process.exit(1);
});
