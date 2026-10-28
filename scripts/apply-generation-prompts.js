#!/usr/bin/env node
/**
 * Bring a tier's question-GENERATION prompts (gen-<gameType>-<scenario>) up to
 * the repo's, lambda-functions/admin/populate-generation-prompts.js.
 *
 *   aws sso login --profile adminaccess
 *   AWS_PROFILE=adminaccess node scripts/apply-generation-prompts.js --tier test            # DRY RUN
 *   AWS_PROFILE=adminaccess node scripts/apply-generation-prompts.js --tier prod --apply --confirm-prod
 *
 *   options:
 *     --update        also rewrite the prompt TEXT of rows that differ from the repo
 *                     (default: only create the missing ones). Settings an admin may
 *                     have tuned (defaultSettings, tags, status) are kept. The previous
 *                     rows are saved to --backup first.
 *     --backup <file> where --update writes the rows it replaces
 *                     (default: generation-prompts-<tier>-<time>.json here)
 *
 * WHY THIS EXISTS. These rows drive the AI scenario builder: a host who picks
 * "Lessons Learned" gets that card's brief only if `AIPROMPT#gen-call-and-answer-
 * lessons-learned` exists. Without it ai-generate-scenarios.js falls back to
 * "Create scenarios based on the requirements provided" and the scenario never
 * reaches the model. Prod had none of the 22 (2026-10-25). The seeder that wrote
 * them on dev and test has no API route, and it Puts every row blind, which
 * would overwrite an edit made in the admin editor. This compares first.
 *
 * Generation rows have no S3 body and no version history: the row is the prompt.
 * That is why an update is opt-in and backed up.
 */
const path = require('path');
const fs = require('fs');
const { createRequire } = require('module');

const REPO = path.join(__dirname, '..');
const STACKS = { dev: 'engagedev', test: 'engagetest', prod: 'engageprod' };
const PK = 'AIPROMPTS';
// The prompt's text: what the scenario builder sends and the admin list shows.
// An update replaces only these.
const TEXT = ['name', 'description', 'basePrompt', 'contextTemplate', 'audienceTemplate', 'categoryTemplate',
  'outputFormat'];
// Settings an admin may have tuned on the tier. A created row takes the repo's;
// an update never touches them.
const SETTINGS = ['defaultSettings', 'tags', 'status'];
const CONTENT = [...TEXT, ...SETTINGS];

/*
  EQUAL WHATEVER ORDER A MAP'S KEYS COME BACK IN. DynamoDB does not keep the
  key order of a map attribute, so `defaultSettings` read back from the table
  can list its keys differently from the repo's object. Comparing raw
  JSON.stringify output called every freshly written row a MISMATCH: prod,
  2026-10-28, "0 written and verified, 22 mismatched" for 22 rows that were
  identical. Map keys are sorted before comparing; array order still counts.
*/
const canonical = (v) => {
  if (Array.isArray(v)) return v.map(canonical);
  if (v && typeof v === 'object') return Object.fromEntries(Object.keys(v).sort().map((k) => [k, canonical(v[k])]));
  return v === undefined ? null : v;
};
const same = (a, b) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));

/** The rows the repo describes, keyed by promptId, shaped as the seeder writes them. */
function repoRows(generationPrompts, normalizeGameType) {
  const rows = [];
  for (const [rawGameType, scenarios] of Object.entries(generationPrompts)) {
    const gameType = normalizeGameType(rawGameType);
    for (const [scenarioType, p] of Object.entries(scenarios)) {
      const promptId = `gen-${gameType}-${scenarioType}`;
      rows.push({
        PK, SK: `AIPROMPT#${promptId}`, promptId, promptType: 'generation', gameType, scenarioType,
        ...Object.fromEntries(CONTENT.map((k) => [k, p[k]])),
        isDefault: p.isDefault,
      });
    }
  }
  return rows;
}

/** Per repo row: create (missing), update (differs: which fields), or keep. Pure. */
function plan(repo, liveById) {
  return repo.map((row) => {
    const live = liveById[row.promptId];
    if (!live) return { row, action: 'create', changed: [] };
    const changed = TEXT.filter((k) => !same(live[k], row[k]));
    return { row, live, action: changed.length ? 'update' : 'keep', changed };
  });
}

/** The item written for a planned row: an update keeps the live row's identity and dates. */
function itemFor(entry, now) {
  if (entry.action === 'create') return { ...entry.row, createdAt: now, updatedAt: now, version: '1.0.0' };
  return {
    ...entry.live,
    ...Object.fromEntries(TEXT.map((k) => [k, entry.row[k]])),
    updatedAt: now,
    updatedBy: 'script:apply-generation-prompts',
  };
}

module.exports = { repoRows, plan, itemFor, same, CONTENT, TEXT, SETTINGS };

async function main() {
  const args = process.argv.slice(2);
  const flag = (n) => args.includes(n);
  const opt = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };
  const tier = opt('--tier');
  const apply = flag('--apply');
  const update = flag('--update');
  if (!STACKS[tier]) {
    console.error('usage: apply-generation-prompts.js --tier <dev|test|prod> [--update] [--backup <file>] [--apply] [--confirm-prod]');
    process.exit(2);
  }
  if (tier === 'prod' && apply && !flag('--confirm-prod')) {
    console.error('Refusing to write on prod without --confirm-prod. Run it on test first.');
    process.exit(2);
  }
  process.env.AWS_REGION = process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || 'us-east-1';

  const lambdaRequire = createRequire(path.join(REPO, 'lambda-functions', 'admin', 'package.json'));
  const { DynamoDBClient } = lambdaRequire('@aws-sdk/client-dynamodb');
  const { DynamoDBDocumentClient, GetCommand, PutCommand } = lambdaRequire('@aws-sdk/lib-dynamodb');
  const { STSClient, GetCallerIdentityCommand } = lambdaRequire('@aws-sdk/client-sts');
  try {
    await new STSClient({}).send(new GetCallerIdentityCommand({}));
  } catch (e) {
    console.error(`No AWS credentials (${e.name}). Run \`aws sso login --profile adminaccess\` and set AWS_PROFILE.`);
    process.exit(2);
  }

  const { generationPrompts } = require(path.join(REPO, 'lambda-functions', 'admin', 'populate-generation-prompts.js'));
  const { normalizeGameType } = require(path.join(REPO, 'lambda-functions', 'admin', 'shared', 'game-types.js'));
  if (!generationPrompts) throw new Error('populate-generation-prompts.js does not export generationPrompts');

  const table = STACKS[tier];
  const db = DynamoDBDocumentClient.from(new DynamoDBClient({}), { marshallOptions: { removeUndefinedValues: true } });
  const repo = repoRows(generationPrompts, normalizeGameType);
  const liveById = {};
  for (const r of repo) {
    // eslint-disable-next-line no-await-in-loop
    const res = await db.send(new GetCommand({ TableName: table, Key: { PK, SK: r.SK } }));
    if (res.Item) liveById[r.promptId] = res.Item;
  }
  const rows = plan(repo, liveById);
  const todo = rows.filter((e) => e.action === 'create' || (update && e.action === 'update'));

  console.log(`${apply ? 'APPLYING' : 'DRY RUN'} on ${tier} (${table}): ${repo.length} generation prompts in the repo\n`);
  for (const e of rows) {
    const mark = todo.includes(e) ? (apply ? 'WRITE' : 'WOULD') : '     ';
    const note = e.action === 'keep' ? 'matches the repo'
      : e.action === 'create' ? 'missing: create'
        : `differs: ${e.changed.join(', ')}${update ? '' : ' (kept; --update to replace)'}`;
    console.log(`  ${mark} ${e.row.promptId.padEnd(42)} ${note}`);
  }
  if (!apply) {
    console.log(`\n${todo.length} row(s) would be written. Dry run only; re-run with --apply.`);
    return;
  }
  const replaced = todo.filter((e) => e.action === 'update').map((e) => e.live);
  if (replaced.length) {
    const file = opt('--backup') || `generation-prompts-${tier}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
    fs.writeFileSync(file, `${JSON.stringify(replaced, null, 2)}\n`);
    console.log(`\n  backup of ${replaced.length} replaced row(s): ${file}`);
  }
  const now = new Date().toISOString();
  for (const e of todo) {
    const item = itemFor(e, now);
    // eslint-disable-next-line no-await-in-loop
    await db.send(new PutCommand({
      TableName: table,
      Item: item,
      // A create never overwrites a row that appeared since the read.
      ...(e.action === 'create' ? { ConditionExpression: 'attribute_not_exists(SK)' } : {}),
    }));
  }
  let bad = 0;
  for (const e of todo) {
    // eslint-disable-next-line no-await-in-loop
    const got = (await db.send(new GetCommand({ TableName: table, Key: { PK, SK: e.row.SK } }))).Item;
    const ok = got && (e.action === 'create' ? CONTENT : TEXT).every((k) => same(got[k], e.row[k]));
    if (!ok) bad += 1;
    console.log(`  ${ok ? 'verified' : 'MISMATCH'} ${e.row.promptId}`);
  }
  console.log(`\n${todo.length - bad} written and verified, ${bad} mismatched.`);
  if (bad) process.exit(1);
}

if (require.main === module) {
  main().catch((e) => { console.error('error:', e); process.exit(1); });
}
