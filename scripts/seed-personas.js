#!/usr/bin/env node
/**
 * Seed the Workie persona library into DynamoDB.
 *
 *   AWS_PROFILE=adminaccess node scripts/seed-personas.js <table>          # dry run
 *   AWS_PROFILE=adminaccess node scripts/seed-personas.js <table> --apply
 *   AWS_PROFILE=adminaccess node scripts/seed-personas.js <table> --apply --overwrite
 *
 * Personas live at PK=AIPROMPTS, SK=PERSONA#<personaId>, alongside the existing
 * AI prompts, and are editable in the admin UI once seeded. This script is the
 * starting point only — by default it will NOT overwrite a persona that already
 * exists, so re-running it never clobbers wording someone has since edited.
 */
const path = require('path');
const { createRequire } = require('module');

// The AWS SDK is installed under lambda-functions/, not at the repo root, and
// Node resolves from this file's directory upward — so ask for it from there
// explicitly rather than relying on where the script happens to be run from.
const REPO = path.join(__dirname, '..');
const lambdaRequire = createRequire(path.join(REPO, 'lambda-functions', 'package.json'));
const { DynamoDBClient } = lambdaRequire('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, GetCommand, PutCommand } = lambdaRequire('@aws-sdk/lib-dynamodb');
const { SEED_PERSONAS } = require(path.join(REPO, 'lambda-functions', 'game', 'personas.js'));

const [, , tableName, ...flags] = process.argv;
const apply = flags.includes('--apply');
const overwrite = flags.includes('--overwrite');

if (!tableName) {
  console.error('usage: seed-personas.js <table-name> [--apply] [--overwrite]');
  process.exit(2);
}

const db = DynamoDBDocumentClient.from(new DynamoDBClient({}));

(async () => {
  console.log(`${apply ? 'Seeding' : 'DRY RUN — would seed'} ${SEED_PERSONAS.length} personas into "${tableName}"\n`);

  let created = 0, skipped = 0, updated = 0;

  for (const persona of SEED_PERSONAS) {
    const key = { PK: 'AIPROMPTS', SK: `PERSONA#${persona.personaId}` };

    const existing = await db.send(new GetCommand({ TableName: tableName, Key: key }));
    if (existing.Item && !overwrite) {
      console.log(`  skip     ${persona.personaId.padEnd(18)} already exists (use --overwrite to replace)`);
      skipped++;
      continue;
    }

    const item = {
      ...key,
      personaId: persona.personaId,
      name: persona.name,
      tagline: persona.tagline,
      icon: persona.icon,
      voice: persona.voice,
      gameTypes: persona.gameTypes || ['all'],
      isDefault: persona.isDefault === true,
      sortOrder: persona.sortOrder ?? 500,
      status: 'active',
      updatedAt: new Date().toISOString(),
    };

    if (apply) {
      await db.send(new PutCommand({ TableName: tableName, Item: item }));
    }
    console.log(`  ${existing.Item ? 'replace ' : 'create  '} ${persona.personaId.padEnd(18)} ${persona.name}`);
    existing.Item ? updated++ : created++;
  }

  console.log(`\n${created} created, ${updated} replaced, ${skipped} skipped`);
  if (!apply) console.log('\nDry run only. Re-run with --apply to write.');
})().catch((err) => {
  console.error('seed failed:', err);
  process.exit(1);
});
