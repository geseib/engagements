#!/usr/bin/env node
/**
 * Backfill `hasImages` on question-set metadata.
 *
 * upload-questions.js sets this at import time, but sets imported before that
 * change have no flag, so every set picker would treat them as image-free.
 * Derives the truth from the questions themselves.
 *
 *   AWS_PROFILE=adminaccess node scripts/backfill-set-has-images.js <table>
 *   AWS_PROFILE=adminaccess node scripts/backfill-set-has-images.js <table> --apply
 */
const path = require('path');
const { createRequire } = require('module');

const REPO = path.join(__dirname, '..');
// The SDK lives under lambda-functions/, not the repo root.
const lambdaRequire = createRequire(path.join(REPO, 'lambda-functions', 'package.json'));
const { DynamoDBClient } = lambdaRequire('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, QueryCommand, ScanCommand, UpdateCommand } = lambdaRequire('@aws-sdk/lib-dynamodb');

const [, , tableName, ...flags] = process.argv;
const apply = flags.includes('--apply');
if (!tableName) {
  console.error('usage: backfill-set-has-images.js <table-name> [--apply]');
  process.exit(2);
}

const db = DynamoDBDocumentClient.from(new DynamoDBClient({}));

/** Follow LastEvaluatedKey — a 160-question set does not fit in one page. */
async function queryAll(params) {
  const items = [];
  let ExclusiveStartKey;
  do {
    const res = await db.send(new QueryCommand({ ...params, ExclusiveStartKey }));
    items.push(...(res.Items || []));
    ExclusiveStartKey = res.LastEvaluatedKey;
  } while (ExclusiveStartKey);
  return items;
}

(async () => {
  const sets = [];
  let ExclusiveStartKey;
  do {
    const res = await db.send(new ScanCommand({
      TableName: tableName,
      FilterExpression: 'PK = :p',
      ExpressionAttributeValues: { ':p': 'SETS' },
      ExclusiveStartKey,
    }));
    sets.push(...(res.Items || []));
    ExclusiveStartKey = res.LastEvaluatedKey;
  } while (ExclusiveStartKey);

  console.log(`${apply ? 'Backfilling' : 'DRY RUN'} hasImages across ${sets.length} sets in "${tableName}"\n`);

  let changed = 0, same = 0;
  for (const set of sets) {
    const setId = String(set.SK).replace('SET#', '');
    const questions = await queryAll({
      TableName: tableName,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
      ExpressionAttributeValues: { ':pk': `SET#${setId}`, ':sk': 'QUESTION#' },
      ProjectionExpression: 'Image',
    });
    const hasImages = questions.some((q) => String(q.Image || '').trim().length > 0);

    if (set.hasImages === hasImages) { same++; continue; }
    if (apply) {
      await db.send(new UpdateCommand({
        TableName: tableName,
        Key: { PK: 'SETS', SK: set.SK },
        UpdateExpression: 'SET hasImages = :v',
        ExpressionAttributeValues: { ':v': hasImages },
      }));
    }
    console.log(`  ${hasImages ? 'IMAGES ' : 'none   '} ${setId.padEnd(46)} (${questions.length} questions)`);
    changed++;
  }

  console.log(`\n${changed} updated, ${same} already correct`);
  if (!apply) console.log('\nDry run only. Re-run with --apply to write.');
})().catch((err) => { console.error('backfill failed:', err); process.exit(1); });
