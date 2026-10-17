#!/usr/bin/env node
/**
 * Update an EXISTING AI prompt in place (same prompt id) from a JSON file.
 *
 *   AWS_PROFILE=adminaccess node scripts/update-ai-prompt.js <tier> <file.json>            # DRY RUN
 *   AWS_PROFILE=adminaccess node scripts/update-ai-prompt.js <tier> <file.json> --apply
 *
 *   options:
 *     --prompt-id <id>    target this id instead of finding it by the file's name
 *     --expect "<text>"   after applying, the new S3 body must contain this text
 *     --all-fields        also send name, status, tags, category, isDefault and
 *                         questionSetIds from the file (default: content only)
 *
 * WHY NOT install-ai-prompt.js. That script CREATES — a new prompt id. A question
 * set is bound to its Workie by id (SET metadata `promptId`), so a new record
 * changes nothing that runs. A fix to a bound prompt has to be an update of the
 * record the set already points at, with a new version so the old body survives.
 *
 * WHY THE HANDLER. Like install-ai-prompt.js, this does not reimplement the
 * write: it invokes `admin/update-ai-prompt.js` in-process with a synthetic
 * event, so versioning, the S3 key layout and the template guards are whatever
 * the application says they are. Unlike create, the update handler checks the
 * caller itself (canManagePrompt), so the event carries a platform-admin
 * identity: the `admins` group and no active organisation — the only identity
 * allowed to change Engage's own library.
 *
 * PLATFORM AND PUBLIC ONLY. Org Workies are encrypted (their names cannot be
 * matched here) and are frozen while team authoring is off; this refuses them.
 *
 * The table and bucket are read off the tier's live create-ai-prompt function,
 * never guessed from the tier name.
 */
const path = require('path');
const fs = require('fs');
const { createRequire } = require('module');

const REPO = path.join(__dirname, '..');
const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const positional = args.filter((a, i) => !a.startsWith('--') && !['--prompt-id', '--expect'].includes(args[i - 1]));
const [tier, file] = positional;
const apply = flag('--apply');
const allFields = flag('--all-fields');
const wantedId = opt('--prompt-id');
const expect = opt('--expect');

if (!['dev', 'test', 'prod'].includes(tier) || !file) {
  console.error('usage: update-ai-prompt.js <dev|test|prod> <file.json> [--prompt-id <id>] [--expect "<text>"] [--all-fields] [--apply]');
  process.exit(2);
}

const CONTENT_FIELDS = ['description', 'scenario', 'template', 'instructions', 'outputFormat', 'outputSections', 'angleWeights'];
const META_FIELDS = ['name', 'status', 'tags', 'category', 'isDefault', 'questionSetIds'];

const lambdaRequire = createRequire(path.join(REPO, 'lambda-functions', 'package.json'));
const { DynamoDBClient } = lambdaRequire('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, QueryCommand, GetCommand } = lambdaRequire('@aws-sdk/lib-dynamodb');
const { S3Client, GetObjectCommand, HeadObjectCommand } = lambdaRequire('@aws-sdk/client-s3');
const { LambdaClient, GetFunctionConfigurationCommand } = lambdaRequire('@aws-sdk/client-lambda');

const fileBody = JSON.parse(fs.readFileSync(file, 'utf8'));
const short = (v) => { const s = JSON.stringify(v); return s === undefined ? '(absent)' : (s.length > 90 ? `${s.slice(0, 87)}...` : s); };

async function queryAll(db, params) {
  const items = [];
  let ExclusiveStartKey;
  do {
    // eslint-disable-next-line no-await-in-loop
    const res = await db.send(new QueryCommand({ ...params, ExclusiveStartKey }));
    items.push(...(res.Items || []));
    ExclusiveStartKey = res.LastEvaluatedKey;
  } while (ExclusiveStartKey);
  return items;
}

async function readBody(s3, bucket, key) {
  const res = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  return JSON.parse(await res.Body.transformToString());
}

(async () => {
  const fn = await new LambdaClient({}).send(new GetFunctionConfigurationCommand({
    FunctionName: `engage${tier}-admin-create-ai-prompt`,
  }));
  const env = fn.Environment?.Variables || {};
  const tableName = env.TABLE_NAME;
  const bucket = env.AI_PROMPTS_BUCKET;
  if (!tableName || !bucket) throw new Error(`engage${tier}-admin-create-ai-prompt has no TABLE_NAME/AI_PROMPTS_BUCKET`);
  // The handler reads these at module load, so they must be set before require().
  process.env.TABLE_NAME = tableName;
  process.env.AI_PROMPTS_BUCKET = bucket;

  const db = DynamoDBDocumentClient.from(new DynamoDBClient({}));
  const s3 = new S3Client({});

  // Platform, then public. Exact name, or the name an archive import gave it
  // ("<name> (Imported YYYY-MM-DD)").
  const rows = [];
  for (const [scope, pk] of [['platform', 'AIPROMPTS'], ['public', 'PUBLIC#AIPROMPTS']]) {
    // eslint-disable-next-line no-await-in-loop
    const items = await queryAll(db, {
      TableName: tableName,
      KeyConditionExpression: 'PK = :p AND begins_with(SK, :s)',
      ExpressionAttributeValues: { ':p': pk, ':s': 'AIPROMPT#' },
    });
    items.forEach((i) => rows.push({ scope, item: i }));
  }
  const idOf = (i) => i.SK.slice('AIPROMPT#'.length);
  const nameMatches = (n) => typeof n === 'string'
    && (n === fileBody.name || /^ \(Imported \d{4}-\d{2}-\d{2}\)$/.test(n.slice(fileBody.name.length)) && n.startsWith(fileBody.name));
  const matches = wantedId
    ? rows.filter((r) => idOf(r.item) === wantedId)
    : rows.filter((r) => nameMatches(r.item.name));

  console.log(`${apply ? 'APPLYING' : 'DRY RUN'} on ${tier}: table=${tableName} bucket=${bucket}`);
  if (matches.length !== 1) {
    console.error(`Expected exactly one prompt ${wantedId ? `with id ${wantedId}` : `named "${fileBody.name}"`}, found ${matches.length}:`);
    matches.forEach((m) => console.error(`  ${m.scope}  ${idOf(m.item)}  "${m.item.name}"  v${m.item.version}`));
    process.exit(1);
  }
  const { scope, item } = matches[0];
  const promptId = idOf(item);
  console.log(`  prompt   : ${promptId}  (${scope})  "${item.name}"`);
  console.log(`  version  : ${item.version}   s3Key: ${item.s3Key}   status: ${item.status}`);

  // Which sets run this prompt (bound by id).
  const sets = (await queryAll(db, {
    TableName: tableName,
    KeyConditionExpression: 'PK = :p AND begins_with(SK, :s)',
    ExpressionAttributeValues: { ':p': 'SETS', ':s': 'SET#' },
  })).filter((s) => s.promptId === promptId && !s.SK.includes('#', 4));
  console.log(`  bound to : ${sets.map((s) => `${s.SK.slice(4)} "${s.name || s.title || ''}"`).join(', ') || '(no platform set)'}`);

  const current = item.s3Key ? await readBody(s3, bucket, item.s3Key) : {};
  const fields = allFields ? [...CONTENT_FIELDS, ...META_FIELDS] : CONTENT_FIELDS;
  const payload = { createNewVersion: true };
  console.log('\n  field changes:');
  for (const k of fields) {
    if (fileBody[k] === undefined) continue;
    const cur = META_FIELDS.includes(k) ? item[k] : current[k];
    const same = JSON.stringify(cur) === JSON.stringify(fileBody[k]);
    console.log(`    ${same ? 'same  ' : 'CHANGE'} ${k}${same ? '' : `\n           was ${short(cur)}\n           now ${short(fileBody[k])}`}`);
    payload[k] = fileBody[k];
  }
  const skipped = META_FIELDS.filter((k) => !fields.includes(k) && fileBody[k] !== undefined
    && JSON.stringify(item[k]) !== JSON.stringify(fileBody[k]));
  skipped.forEach((k) => console.log(`    kept   ${k} = ${short(item[k])} (file has ${short(fileBody[k])}; --all-fields to send)`));

  if (!apply) {
    console.log(`\n  would write v${Number(item.version || 0) + 1} alongside v${item.version}. Dry run only; re-run with --apply.`);
    return;
  }

  const { handler } = require(path.join(REPO, 'lambda-functions', 'admin', 'update-ai-prompt.js'));
  const res = await handler({
    pathParameters: { promptId },
    queryStringParameters: { scope },
    body: JSON.stringify(payload),
    requestContext: {
      http: { method: 'PUT', path: `/admin/ai-prompts/${promptId}` },
      authorizer: { lambda: { groups: ['admins'], userId: 'script:update-ai-prompt' } },
    },
  });
  const out = JSON.parse(res.body || '{}');
  if (res.statusCode >= 300) {
    console.error(`FAILED ${res.statusCode}:`, out.error || out.message || res.body);
    process.exit(1);
  }
  console.log(`\n  handler  : ${res.statusCode} ${out.message || ''}`);

  // Prove both halves, and that the old version is still there.
  const after = (await db.send(new GetCommand({ TableName: tableName, Key: { PK: item.PK, SK: item.SK } }))).Item;
  const fail = (m) => { console.error(`  VERIFY FAILED: ${m}`); process.exit(1); };
  if (!after) fail('pointer row is gone');
  console.log(`  pointer  : v${item.version} -> v${after.version}   ${item.s3Key} -> ${after.s3Key}`);
  if (after.s3Key === item.s3Key || String(after.version) === String(item.version)) fail('pointer did not move');
  const fresh = await readBody(s3, bucket, after.s3Key);
  for (const k of Object.keys(payload).filter((f) => f !== 'createNewVersion' && CONTENT_FIELDS.includes(f))) {
    if (JSON.stringify(fresh[k]) !== JSON.stringify(payload[k])) fail(`new body's ${k} differs from the file`);
  }
  console.log('  new body : matches the file');
  if (expect) {
    if (!JSON.stringify(fresh).includes(expect)) fail(`new body lacks "${expect}"`);
    console.log(`  new body : contains "${expect}"`);
  }
  if (item.s3Key) {
    await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: item.s3Key }));
    console.log(`  old body : still at ${item.s3Key}`);
  }
  console.log('\nVerified.');
})().catch((e) => { console.error('error:', e); process.exit(1); });
