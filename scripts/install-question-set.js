#!/usr/bin/env node
/**
 * Install a question set from a CSV file.
 *
 *   AWS_PROFILE=adminaccess node scripts/install-question-set.js <table> <file.csv> --type trivia \
 *     --title "80s Trivia" --description "..." [--persona mtv-vjs] [--quickstart] [--apply]
 *
 * WHY THIS EXISTS. Until now the ONLY ways to install a set were the admin UI's
 * file picker and a hand-rolled API call — both behind the Cognito authorizer,
 * neither scriptable, and nothing in scripts/ covered it. So a 100-question set
 * could not be installed reproducibly, reviewed in a diff, or reinstalled into a
 * second environment without a human clicking.
 *
 * It does NOT reimplement the import. It invokes the real
 * `admin/upload-questions.js` handler in-process with a synthetic event — the
 * same code path the admin UI uses. The CSV parser, the category minting, the
 * `SET#…` / `QUESTION#c001#003` key shapes and the slug rules are therefore
 * whatever the application says they are, including after someone changes them.
 * Reimplementing any of that here would be a second source of truth that drifts.
 *
 * Auth note: the Cognito authorizer is on the API Gateway route, not in the
 * handler, so calling it directly needs only AWS credentials.
 *
 * `--persona` and `--quickstart` are applied AFTER the import, because
 * upload-questions.js writes neither: `personaId` is read off the SETS row by
 * get-ai-summary (precedence 2, below an explicit host pick), and `quickstart`
 * is the flag QuickstartMenu filters on.
 */
const path = require('path');
const fs = require('fs');
const { createRequire } = require('module');

const REPO = path.join(__dirname, '..');
const argv = process.argv.slice(2);
const [tableName, file] = argv.filter((a) => !a.startsWith('--'));
const flag = (name, fallback = null) => {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? fallback : (argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : true);
};
const apply = argv.includes('--apply');

if (!tableName || !file) {
  console.error('usage: install-question-set.js <table> <file.csv> --type <gameType> --title "..." [--description "..."] [--persona <id>] [--quickstart] [--apply]');
  process.exit(2);
}

const engagementType = flag('type', 'trivia');
const customTitle = flag('title');
const customDescription = flag('description', '');
const personaId = flag('persona');
const quickstart = argv.includes('--quickstart');

if (!customTitle) { console.error('--title is required'); process.exit(2); }

process.env.TABLE_NAME = tableName;

const lambdaRequire = createRequire(path.join(REPO, 'lambda-functions', 'package.json'));
const { DynamoDBClient } = lambdaRequire('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, GetCommand, UpdateCommand, QueryCommand } = lambdaRequire('@aws-sdk/lib-dynamodb');
const db = DynamoDBDocumentClient.from(new DynamoDBClient({}));

const fileContent = fs.readFileSync(file, 'utf8');
const setId = customTitle.toLowerCase().replace(/[^a-z0-9]/g, '');

/**
 * Run the REAL upload-questions handler with every DynamoDB call intercepted.
 *
 * The handler builds its own document client at module scope, so the only seam
 * is the prototype — patch it BEFORE requiring the handler and every client,
 * whoever constructed it, goes through the recorder. Reads answer as though the
 * table were empty (which is the state a new install assumes); writes are
 * recorded and dropped.
 *
 * This is the whole point of a dry run: the CSV parser, the column mapping, the
 * skip rules and the key shapes are the application's, not a second
 * implementation here that drifts from it.
 */
async function dryImport() {
  const proto = DynamoDBDocumentClient.prototype;
  const realSend = proto.send;
  const writes = [];

  proto.send = async function (cmd) {
    const type = (cmd && cmd.constructor && cmd.constructor.name) || 'Unknown';
    if (type === 'GetCommand') return {};                 // nothing exists yet
    if (type === 'QueryCommand' || type === 'ScanCommand') return { Items: [], Count: 0 };
    if (type === 'BatchWriteCommand') {
      const reqs = Object.values(cmd.input.RequestItems || {})[0] || [];
      reqs.forEach((r) => {
        const item = r.PutRequest && r.PutRequest.Item;
        if (item) writes.push(`${item.PK} | ${item.SK}`);
      });
      return { UnprocessedItems: {} };
    }
    const item = cmd.input && cmd.input.Item;
    if (item) writes.push(`${item.PK} | ${item.SK}`);
    else writes.push(`${type} ${JSON.stringify((cmd.input && cmd.input.Key) || {})}`);
    return {};
  };

  try {
    const { handler } = require(path.join(REPO, 'lambda-functions', 'admin', 'upload-questions.js'));
    const res = await handler({
      body: JSON.stringify({
        fileName: path.basename(file),
        fileContent,
        customTitle,
        customDescription,
        engagementType,
      }),
    });
    const payload = JSON.parse(res.body || '{}');
    payload.__status = res.statusCode;
    if (res.statusCode >= 300) payload.__failed = true;
    return { payload, writes };
  } finally {
    proto.send = realSend;   // never leave the prototype patched
  }
}

function reportImport(payload, writes) {
  console.log('\n--- CSV verdict (real importer, nothing written) ---');
  if (payload.__failed) {
    console.error(`  REFUSED ${payload.__status}: ${payload.error || payload.message}`);
    return;
  }
  console.log(`  questions : ${payload.questionCount ?? '?'}`);
  console.log(`  categories: ${payload.categoryCount ?? '?'}`);
  console.log(`  rows that would be written: ${writes.length}`);

  const skipped = payload.skippedRows || [];
  if (payload.skippedRowCount) {
    // Silent row loss is the defect this whole report exists to surface.
    console.log(`  SKIPPED ${payload.skippedRowCount} row(s):`);
    skipped.slice(0, 20).forEach((r) => console.log(`    ${JSON.stringify(r)}`));
    if (skipped.length > 20) console.log(`    ...and ${skipped.length - 20} more`);
  } else {
    console.log('  skipped   : 0');
  }
}

(async () => {
  console.log(`${apply ? 'Installing' : 'DRY RUN — would install'} "${customTitle}"`);
  console.log(`  file      : ${file} (${fileContent.split('\n').length - 1} data rows)`);
  console.log(`  type      : ${engagementType}`);
  console.log(`  setId     : ${setId}`);
  console.log(`  persona   : ${personaId || '(none)'}`);
  console.log(`  quickstart: ${quickstart}`);
  console.log(`  table     : ${tableName}\n`);

  // THE CSV IS VALIDATED FIRST, AND OFFLINE.
  //
  // This used to sit after every AWS pre-flight call and behind `if (!apply)
  // return`, which meant the dry run never parsed the file at all — it checked
  // that the set did not exist and that a prompt was present, then stopped. So
  // `--apply` against a live table was the FIRST time a CSV was ever read, and
  // a dry run that printed no complaint had in fact validated nothing. Worse,
  // the pre-flight needs credentials, so without them the dry run died before
  // reaching any of it.
  //
  // Now the parse runs first and needs no credentials, so a CSV can be checked
  // on a laptop with no AWS access at all.
  // Only on a dry run: the --apply path invokes the handler for real below and
  // reports its own skippedRows, so doing both would parse twice and print the
  // importer's log twice.
  if (!apply) {
    const dry = await dryImport();
    reportImport(dry.payload, dry.writes);
    if (dry.payload.__failed) {
      console.error('\n  The importer REFUSED this file. Fix it before re-running.');
      process.exit(1);
    }
  }

  // The remaining checks genuinely need the table. In a dry run a credentials
  // failure is a warning, not an exit — the CSV verdict above is already the
  // useful half, and losing it to an expired SSO token is how this script
  // stopped being run at all.
  let existing;
  try {
    existing = await db.send(new GetCommand({
      TableName: tableName, Key: { PK: 'SETS', SK: `SET#${setId}` },
    }));
  } catch (err) {
    if (!apply) {
      console.log(`\n  (skipping table checks: ${err.message || err.name})`);
      console.log('  CSV verdict above is still valid. Re-run with credentials to check');
      console.log(`  that "${setId}" is free and that a default ${engagementType} prompt exists.`);
      return;
    }
    throw err;
  }
  if (existing.Item) {
    console.error(`  A set with id "${setId}" already exists. upload-questions.js refuses to`);
    console.error('  overwrite; replace it through the editor, or choose a different --title.');
    process.exit(1);
  }

  // A persona that does not exist would resolve to nothing and fall through
  // silently, which is exactly the class of failure worth catching here.
  if (personaId) {
    const p = await db.send(new GetCommand({
      TableName: tableName, Key: { PK: 'AIPROMPTS', SK: `PERSONA#${personaId}` },
    }));
    if (!p.Item) { console.error(`  persona "${personaId}" not found — seed it first`); process.exit(1); }
    if (p.Item.status && p.Item.status !== 'active') {
      console.error(`  persona "${personaId}" is ${p.Item.status}; it would fall through at resolve time`);
      process.exit(1);
    }
    console.log(`  persona "${personaId}" found and active: ${p.Item.name}`);
  }

  // The game type must have a USABLE default summary prompt, or the round makes
  // no Bedrock call and the room gets canned text with no error anywhere.
  const prompts = await db.send(new QueryCommand({
    TableName: tableName,
    KeyConditionExpression: 'PK = :p AND begins_with(SK, :s)',
    ExpressionAttributeValues: { ':p': 'AIPROMPTS', ':s': 'AIPROMPT#' },
  }));
  const def = (prompts.Items || []).find((i) => i.gameType === engagementType && i.isDefault);
  console.log(def
    ? `  default ${engagementType} prompt: ${def.SK} (${def.name})`
    : `  WARNING: no default ${engagementType} prompt — summaries will fall back to canned text`);
  console.log('');

  if (!apply) { console.log('Dry run only. Re-run with --apply to write.'); return; }

  const { handler } = require(path.join(REPO, 'lambda-functions', 'admin', 'upload-questions.js'));
  const res = await handler({
    body: JSON.stringify({
      fileName: path.basename(file),
      fileContent,
      customTitle,
      customDescription,
      engagementType,
    }),
  });

  const payload = JSON.parse(res.body || '{}');
  if (res.statusCode >= 300) {
    console.error(`FAILED ${res.statusCode}:`, payload.error || payload.message || res.body);
    process.exit(1);
  }
  console.log(`  imported: ${payload.questionCount ?? '?'} questions, ${payload.categoryCount ?? '?'} categories`);
  if (payload.skippedRows?.length) {
    console.log(`  SKIPPED ${payload.skippedRows.length} rows:`);
    payload.skippedRows.slice(0, 10).forEach((r) => console.log(`    ${JSON.stringify(r)}`));
  }

  // upload-questions.js writes neither of these.
  const sets = [];
  const vals = {};
  if (personaId) { sets.push('personaId = :pid'); vals[':pid'] = personaId; }
  if (quickstart) { sets.push('quickstart = :q'); vals[':q'] = true; }
  if (sets.length) {
    await db.send(new UpdateCommand({
      TableName: tableName,
      Key: { PK: 'SETS', SK: `SET#${setId}` },
      UpdateExpression: `SET ${sets.join(', ')}`,
      ExpressionAttributeValues: vals,
    }));
    console.log(`  set row updated: ${sets.join(', ')}`);
  }

  const final = await db.send(new GetCommand({
    TableName: tableName, Key: { PK: 'SETS', SK: `SET#${setId}` },
  }));
  const it = final.Item || {};
  console.log('\nVerified on the SETS row:');
  console.log(`  active=${it.active}  quickstart=${it.quickstart}  personaId=${it.personaId}`);
  console.log(`  engagementType=${it.engagementType}  questionCount=${it.questionCount}`);
  if (it.ttl) { console.error('  WARNING: this row carries a ttl — see docs/02-data-model.md'); }
})().catch((e) => { console.error('error:', e); process.exit(1); });
