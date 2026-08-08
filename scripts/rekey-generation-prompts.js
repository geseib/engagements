#!/usr/bin/env node
/**
 * Re-key the generation prompts that were written without a `promptId`.
 *
 * `populate-generation-prompts.js` used to write
 *     SK = AIPROMPT#GENERATION#<scenarioType>#<gameType>
 * with **no `promptId` attribute at all**. Those rows still match
 * `get-ai-prompts.js`'s `begins_with(SK, 'AIPROMPT#')`, so they appear in the
 * summary-prompt dropdown with `value={undefined}` — React omits the attribute,
 * the DOM option's value falls back to its label text, and selecting one writes
 * a string like "Lessons Learned Scenarios (call-and-answer - )" into a question
 * set's promptId. A dangling reference that silently falls back to the default.
 *
 * These rows are NOT junk. They are the question-GENERATION library that
 * `components/AIScenarioBuilder.jsx` reads (`?promptType=generation`), so
 * deleting them would empty the AI scenario generator. They only needed an id.
 *
 * The fixed writer now emits `promptId = gen-<gameType>-<scenarioType>` and
 * `SK = AIPROMPT#<promptId>`, so migrating means re-keying, not just patching
 * an attribute: write the new row first, verify it, then delete the old one.
 *
 *   node scripts/rekey-generation-prompts.js <table>            # dry run
 *   node scripts/rekey-generation-prompts.js <table> --apply
 *
 * Idempotent: a row already carrying a promptId is skipped.
 */
const path = require('path');
const { createRequire } = require('module');

// The AWS SDK is installed under lambda-functions/, not at the repo root.
const REPO = path.join(__dirname, '..');
const lambdaRequire = createRequire(path.join(REPO, 'lambda-functions', 'package.json'));
const { DynamoDBClient } = lambdaRequire('@aws-sdk/client-dynamodb');
const {
  DynamoDBDocumentClient, QueryCommand, PutCommand, DeleteCommand, GetCommand,
} = lambdaRequire('@aws-sdk/lib-dynamodb');

const table = process.argv[2];
const apply = process.argv.includes('--apply');

if (!table) {
  console.error('usage: node scripts/rekey-generation-prompts.js <table> [--apply]');
  process.exit(1);
}

const db = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const LEGACY_PREFIX = 'AIPROMPT#GENERATION#';

/** Paginated — a Query that stops at 1 MB is how partial migrations happen. */
async function findLegacyRows() {
  const rows = [];
  let ExclusiveStartKey;
  do {
    const page = await db.send(new QueryCommand({
      TableName: table,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
      ExpressionAttributeValues: { ':pk': 'AIPROMPTS', ':sk': LEGACY_PREFIX },
      ExclusiveStartKey,
    }));
    rows.push(...(page.Items || []));
    ExclusiveStartKey = page.LastEvaluatedKey;
  } while (ExclusiveStartKey);
  return rows;
}

(async () => {
  const rows = await findLegacyRows();
  console.log(`Found ${rows.length} legacy generation row(s) under ${LEGACY_PREFIX}\n`);

  let migrated = 0;
  let skipped = 0;

  for (const row of rows) {
    // SK = AIPROMPT#GENERATION#<scenarioType>#<gameType>
    const parts = String(row.SK).split('#');
    const scenarioType = parts[2];
    const gameType = parts[3];

    if (!scenarioType || !gameType) {
      console.log(`  SKIP  ${row.SK} — cannot parse scenarioType/gameType`);
      skipped++;
      continue;
    }
    if (row.promptId) {
      console.log(`  SKIP  ${row.SK} — already has promptId "${row.promptId}"`);
      skipped++;
      continue;
    }

    const promptId = `gen-${gameType}-${scenarioType}`;
    const newSK = `AIPROMPT#${promptId}`;
    const newRow = {
      ...row,
      SK: newSK,
      promptId,
      // The old rows predate the promptType convention; readers infer from
      // record shape, but being explicit costs nothing and helps the filter.
      promptType: row.promptType || 'generation',
    };
    // These rows must never expire — they are configuration, not session data.
    delete newRow.ttl;

    console.log(`  MOVE  ${row.SK}\n     -> ${newSK}   "${row.name || ''}"`);

    if (apply) {
      await db.send(new PutCommand({ TableName: table, Item: newRow }));

      // Verify the new row landed before removing the only other copy.
      const check = await db.send(new GetCommand({
        TableName: table, Key: { PK: 'AIPROMPTS', SK: newSK },
      }));
      if (!check.Item || check.Item.promptId !== promptId) {
        console.error(`     ABORT — ${newSK} did not read back; leaving the original in place.`);
        process.exitCode = 1;
        continue;
      }

      await db.send(new DeleteCommand({
        TableName: table, Key: { PK: 'AIPROMPTS', SK: row.SK },
      }));
    }
    migrated++;
  }

  console.log(`\n${apply ? 'Migrated' : 'Would migrate'}: ${migrated}   skipped: ${skipped}`);
  if (!apply) console.log('Dry run only. Re-run with --apply to write.');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
