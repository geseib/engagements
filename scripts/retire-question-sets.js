#!/usr/bin/env node
/**
 * Switch off Engage-library question sets that a newer set replaces.
 *
 *   AWS_PROFILE=adminaccess node scripts/retire-question-sets.js <table> <setId>... [--apply]
 *
 * WHY. install-question-set.js never overwrites: a set's id is its title, and a
 * new set under a new title sits beside the old one. When a set is REPLACED
 * (2026-10-24: the Build Room's two sets per kind of build became one), the old
 * ones must stop being offered, or the library lists both. This switches them
 * off (`active = false`, the toggle the console's switch writes) rather than
 * deleting them: an inactive set is hidden from every host's list and from the
 * Build Room's Ask the room (game/get-question-sets.js reads `active !== false`),
 * stays in the console for Engage staff, and can be switched back on there.
 *
 * Without --apply it only reads and says, per set, what it would do. Only the
 * Engage library (PK SETS) is touched: never an organisation's sets.
 */
const path = require('path');
const { createRequire } = require('module');

const REPO = path.join(__dirname, '..');
const lambdaRequire = createRequire(path.join(REPO, 'lambda-functions', 'package.json'));
const { DynamoDBClient } = lambdaRequire('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, GetCommand, UpdateCommand } = lambdaRequire('@aws-sdk/lib-dynamodb');

const LIBRARY_PK = 'SETS';

/**
 * Per set id: what is there and what happens to it. Returns lines to print and
 * whether anything failed. `db` is a DynamoDB document client.
 */
async function retireSets(db, tableName, setIds, { apply = false, now = new Date() } = {}) {
  const lines = [];
  let failed = false;
  for (const setId of setIds) {
    let item;
    try {
      item = (await db.send(new GetCommand({ TableName: tableName, Key: { PK: LIBRARY_PK, SK: `SET#${setId}` } }))).Item;
    } catch (err) {
      lines.push(`  ${setId}: could not read (${err.message || err.name})`);
      failed = true;
      continue;
    }
    if (!item) { lines.push(`  ${setId}: not on this table, nothing to retire`); continue; }
    const what = `"${item.name || item.title || setId}" (${item.engagementType || '?'}, ${item.questionCount ?? '?'} questions)`;
    if (item.active === false) { lines.push(`  ${setId}: ${what} is already switched off`); continue; }
    if (!apply) { lines.push(`  ${setId}: ${what} WOULD BE SWITCHED OFF`); continue; }
    await db.send(new UpdateCommand({
      TableName: tableName,
      Key: { PK: LIBRARY_PK, SK: `SET#${setId}` },
      UpdateExpression: 'SET active = :off, updatedAt = :at',
      ConditionExpression: 'attribute_exists(PK)',
      ExpressionAttributeValues: { ':off': false, ':at': now.toISOString() },
    }));
    lines.push(`  ${setId}: ${what} switched off`);
  }
  return { lines, failed };
}

module.exports = { retireSets, LIBRARY_PK };

if (require.main === module) {
  const argv = process.argv.slice(2);
  const [tableName, ...setIds] = argv.filter((a) => !a.startsWith('--'));
  const apply = argv.includes('--apply');
  if (!tableName || !setIds.length) {
    console.error('usage: retire-question-sets.js <table> <setId>... [--apply]');
    process.exit(2);
  }
  console.log(`${apply ? 'Retiring' : 'DRY RUN — would retire'} ${setIds.length} set(s) on ${tableName}`);
  retireSets(DynamoDBDocumentClient.from(new DynamoDBClient({})), tableName, setIds, { apply })
    .then(({ lines, failed }) => {
      lines.forEach((l) => console.log(l));
      if (!apply) console.log('Dry run only. Re-run with --apply to switch them off.');
      // A dry run that cannot read (no credentials) has still said what it would look for.
      process.exit(failed && apply ? 1 : 0);
    })
    .catch((e) => { console.error('error:', e); process.exit(1); });
}
