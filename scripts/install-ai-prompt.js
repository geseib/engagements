#!/usr/bin/env node
/**
 * Install an AI prompt from a JSON file.
 *
 *   AWS_PROFILE=adminaccess node scripts/install-ai-prompt.js <table> <bucket> <file.json>          # DRY RUN
 *   AWS_PROFILE=adminaccess node scripts/install-ai-prompt.js <table> <bucket> <file.json> --apply
 *
 * WHY THIS EXISTS. A prompt is two records in two different stores — a pointer
 * at PK=AIPROMPTS / SK=AIPROMPT#<id> carrying an `s3Key`, and the body itself in
 * the ai-prompts bucket. Writing them by hand is how they drift apart, and a
 * pointer whose S3 object is missing is not a loud failure: `get-ai-summary.js`
 * falls through to buildFallback() and the round gets canned text with no
 * Bedrock call and no error. That exact state was found live on engagedev
 * (trivia and poll both dead) and is what prompted this script.
 *
 * So this does NOT reimplement the write. It invokes the real
 * `admin/create-ai-prompt.js` handler in-process with a synthetic event — the
 * same code path the admin UI uses, minus the HTTP hop. That means the isDefault
 * bookkeeping, the GAMETYPE#/CATEGORY# lookup row and the S3 key layout are
 * whatever the application says they are, today and after anyone changes them.
 *
 * Auth note: the Cognito authorizer lives on the API Gateway route, not in the
 * handler, so calling the handler directly needs only AWS credentials for the
 * table and bucket.
 */
const path = require('path');
const fs = require('fs');
const { createRequire } = require('module');

const REPO = path.join(__dirname, '..');

const [, , tableName, bucket, file, ...flags] = process.argv;
const apply = flags.includes('--apply');

if (!tableName || !bucket || !file) {
  console.error('usage: install-ai-prompt.js <table-name> <bucket> <file.json> [--apply]');
  process.exit(2);
}

const body = JSON.parse(fs.readFileSync(file, 'utf8'));

// The handler reads these at module load, so they must be set before require().
process.env.TABLE_NAME = tableName;
process.env.AI_PROMPTS_BUCKET = bucket;

const lambdaRequire = createRequire(path.join(REPO, 'lambda-functions', 'package.json'));
const { DynamoDBClient } = lambdaRequire('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, QueryCommand } = lambdaRequire('@aws-sdk/lib-dynamodb');
const db = DynamoDBDocumentClient.from(new DynamoDBClient({}));

(async () => {
  console.log(`${apply ? 'Installing' : 'DRY RUN — would install'} "${body.name}"`);
  console.log(`  gameType : ${body.gameType}`);
  console.log(`  category : ${body.category || '(none)'}`);
  console.log(`  isDefault: ${Boolean(body.isDefault)}`);
  console.log(`  table    : ${tableName}`);
  console.log(`  bucket   : ${bucket}\n`);

  // Report what already claims the default slot, because installing an
  // isDefault prompt silently clears the flag from whatever held it.
  if (body.isDefault) {
    const existing = await db.send(new QueryCommand({
      TableName: tableName,
      KeyConditionExpression: 'PK = :p AND begins_with(SK, :s)',
      ExpressionAttributeValues: { ':p': 'AIPROMPTS', ':s': 'AIPROMPT#' },
    }));
    const holders = (existing.Items || []).filter(
      (i) => i.gameType === body.gameType && i.isDefault
    );
    if (holders.length) {
      console.log(`  NOTE: these currently hold isDefault for "${body.gameType}" and will lose it:`);
      holders.forEach((h) => console.log(`        ${h.SK}  ${h.name || ''}`));
      console.log('');
    }
  }

  if (!apply) {
    console.log('Dry run only. Re-run with --apply to write.');
    return;
  }

  const { handler } = require(path.join(REPO, 'lambda-functions', 'admin', 'create-ai-prompt.js'));
  const res = await handler({ body: JSON.stringify(body) });

  const payload = JSON.parse(res.body || '{}');
  if (res.statusCode >= 300) {
    console.error(`FAILED ${res.statusCode}:`, payload.error || payload.message || res.body);
    process.exit(1);
  }

  const promptId = payload.prompt?.id || payload.promptId || payload.id;
  console.log(`  created  ${promptId}`);

  // Prove BOTH halves landed. A pointer without a body is the failure this
  // script exists to prevent, so it is checked rather than assumed.
  const { S3Client, HeadObjectCommand } = lambdaRequire('@aws-sdk/client-s3');
  const s3 = new S3Client({});
  const { GetCommand } = lambdaRequire('@aws-sdk/lib-dynamodb');
  const rec = await db.send(new GetCommand({
    TableName: tableName,
    Key: { PK: 'AIPROMPTS', SK: `AIPROMPT#${promptId}` },
  }));
  if (!rec.Item) { console.error('  VERIFY FAILED: no pointer record'); process.exit(1); }
  console.log(`  pointer  ok   s3Key=${rec.Item.s3Key}`);
  if (rec.Item.ttl) { console.error('  VERIFY FAILED: pointer carries a ttl — see docs/02-data-model.md'); process.exit(1); }

  try {
    await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: rec.Item.s3Key }));
    console.log('  body     ok');
  } catch (e) {
    console.error(`  VERIFY FAILED: body missing at s3://${bucket}/${rec.Item.s3Key} (${e.name})`);
    process.exit(1);
  }

  console.log('\nBoth halves verified.');
})().catch((e) => { console.error('error:', e); process.exit(1); });
