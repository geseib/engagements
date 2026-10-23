#!/usr/bin/env node
/**
 * Bring a tier's live Workie prompts up to the versions kept in the repo.
 *
 *   aws sso login --profile <profile>
 *   AWS_PROFILE=<profile> node scripts/apply-repo-prompts.js --tier test             # DRY RUN
 *   AWS_PROFILE=<profile> node scripts/apply-repo-prompts.js --tier test --apply
 *
 *   options:
 *     --only "<text>"    only prompts whose name contains this text (case ignored)
 *     --include-edited   also replace prompts edited on the tier since they were
 *                        taken from the repo (skipped by default; see below)
 *     --confirm-prod     required with --tier prod --apply
 *     --by <email>       recorded as who saved the version (default: the
 *                        caller identity's ARN from STS)
 *
 * WHAT IT DOES. Exactly what the admin library's "Repo has a newer version" →
 * Review → "Save as version N" does, for every prompt that has one, without
 * clicking through each. It lists the library with the real
 * `admin/get-ai-prompts.js` handler, matches each prompt to
 * `src/src/config/repoPrompts.json` with the library's own matcher
 * (`src/src/utils/repoPromptMatch.js`), and saves with the real
 * `admin/update-ai-prompt.js` handler using the body the library sends
 * (`{ from: 'repo', repoSource, ...fields }`). So the version history, the S3
 * key layout and the template guards are the application's, and every save is
 * a new version: the old one stays and can be made live again from the
 * prompt's Versions tab.
 *
 * EDITED HERE. A prompt that was taken from the repo and then changed on the
 * tier is skipped unless --include-edited: the repo's text would replace an
 * edit someone made on purpose. (The edit would survive in the history, but it
 * would no longer be live.)
 *
 * PLATFORM AND PUBLIC ONLY. An organisation's own Workies are theirs; the list
 * runs as a platform admin with no organisation, so it never sees them.
 *
 * WHERE. The table, bucket and the rest of the environment are read off the
 * tier's live get-ai-prompts function, never guessed. Credentials come from
 * the SDK's default chain, so an `aws sso login` profile works as is.
 */
const path = require('path');
const fs = require('fs');
const { createRequire } = require('module');
const { pathToFileURL } = require('url');

const REPO = path.join(__dirname, '..');
const STACKS = { dev: 'engagedev', test: 'engagetest', prod: 'engageprod' };
const LISTABLE_SCOPES = ['platform', 'public'];

/** The platform-admin identity the authorizer would hand these handlers. */
function adminEvent(by, extra = {}) {
  return {
    ...extra,
    requestContext: {
      ...(extra.requestContext || {}),
      authorizer: {
        lambda: { userId: 'script:apply-repo-prompts', username: 'apply-repo-prompts', email: by, groups: 'admins', status: 'enabled' },
      },
    },
  };
}

function bodyOf(res) {
  try { return JSON.parse(res && res.body ? res.body : '{}'); } catch (e) { return {}; }
}

async function listPrompts(listHandler, by) {
  const res = await listHandler(adminEvent(by, {
    queryStringParameters: { includeContent: 'true', promptType: 'analysis' },
    requestContext: { http: { method: 'GET', path: '/admin/ai-prompts' } },
  }));
  const out = bodyOf(res);
  if (!res || res.statusCode >= 300) throw new Error(`listing the library failed (${res && res.statusCode}): ${out.error || out.message || ''}`);
  return out.prompts || [];
}

/**
 * One row per prompt in the library: what the repo says about it, and what
 * this run will do. Pure — the test drives it with fakes.
 */
function planRows(prompts, entries, match, { only, includeEdited }) {
  const wanted = only ? String(only).toLowerCase() : '';
  const rows = [];
  for (const prompt of prompts) {
    if (wanted && !String(prompt.name || '').toLowerCase().includes(wanted)) continue;
    const status = match.repoStatusOf(prompt, entries);
    let action = 'none';
    let note = '';
    if (!status) { note = 'live text could not be read'; }
    else if (status.state === match.REPO_STATE.NONE) { note = 'not in the repo'; }
    else if (status.state === match.REPO_STATE.MATCHES) { note = 'matches the repo'; }
    else if (prompt.scope && !LISTABLE_SCOPES.includes(prompt.scope)) { note = `skipped: ${prompt.scope} prompt`; }
    else if (status.editedHere && !includeEdited) { note = 'skipped: edited on this tier since it was taken from the repo (--include-edited)'; }
    else { action = 'save'; note = `repo is newer: ${status.changed.join(', ')}`; }
    rows.push({ prompt, status, action, note });
  }
  // Two live prompts matched to one repo file is legal (an import beside its
  // original) but worth seeing before both are rewritten.
  const byKey = {};
  rows.filter((r) => r.status && r.status.entry).forEach((r) => {
    (byKey[r.status.entry.key] = byKey[r.status.entry.key] || []).push(r);
  });
  Object.values(byKey).filter((group) => group.length > 1).forEach((group) => {
    group.forEach((r) => { r.shared = group.length; });
  });
  return rows;
}

/** The body the library's Review → Save sends (AIPromptManager.jsx). */
function saveBody(prompt, entry) {
  return {
    from: 'repo',
    repoSource: { key: entry.key, path: entry.path, fields: entry.fields, commitDate: entry.commitDate || undefined },
    ...entry.values,
    ...(prompt.scope ? { scope: prompt.scope } : {}),
  };
}

async function saveRow(updateHandler, row, by) {
  const { prompt, status } = row;
  const res = await updateHandler(adminEvent(by, {
    pathParameters: { promptId: prompt.promptId },
    queryStringParameters: prompt.scope ? { scope: prompt.scope } : {},
    body: JSON.stringify(saveBody(prompt, status.entry)),
    requestContext: { http: { method: 'PUT', path: `/admin/ai-prompts/${prompt.promptId}` } },
  }));
  const out = bodyOf(res);
  if (!res || res.statusCode >= 300) return { ok: false, error: `${res && res.statusCode} ${out.error || out.message || ''}`.trim() };
  return { ok: true };
}

/**
 * Plan, optionally save, then list again and check every saved prompt now
 * matches the repo. Returns `{ rows, saved, failed, unverified }`.
 */
async function run({ listHandler, updateHandler, entries, match, apply, only, includeEdited, by, log = () => {} }) {
  const prompts = await listPrompts(listHandler, by);
  const rows = planRows(prompts, entries, match, { only, includeEdited });
  for (const r of rows) {
    const v = r.prompt.version ? `v${r.prompt.version}` : 'v?';
    const mark = r.action === 'save' ? (apply ? 'SAVE ' : 'WOULD') : '     ';
    log(`  ${mark} ${String(r.prompt.name || r.prompt.promptId).padEnd(46)} ${v.padEnd(5)} ${r.note}`);
    if (r.shared) log(`        note: ${r.shared} live prompts match ${r.status.entry.key}`);
  }
  const toSave = rows.filter((r) => r.action === 'save');
  const result = { rows, saved: [], failed: [], unverified: [] };
  if (!apply || toSave.length === 0) return result;

  for (const r of toSave) {
    // eslint-disable-next-line no-await-in-loop
    const out = await saveRow(updateHandler, r, by);
    if (out.ok) result.saved.push(r); else result.failed.push({ ...r, error: out.error });
  }
  const after = await listPrompts(listHandler, by);
  for (const r of result.saved) {
    const now = after.find((p) => p.promptId === r.prompt.promptId && (p.scope || '') === (r.prompt.scope || ''));
    const status = now && match.repoStatusOf(now, entries);
    if (!status || status.state !== match.REPO_STATE.MATCHES) result.unverified.push(r);
    else r.newVersion = now.version;
  }
  return result;
}

module.exports = { planRows, saveBody, run, adminEvent };

async function main() {
  const args = process.argv.slice(2);
  const flag = (name) => args.includes(name);
  const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
  const tier = opt('--tier');
  const apply = flag('--apply');
  if (!STACKS[tier]) {
    console.error('usage: apply-repo-prompts.js --tier <dev|test|prod> [--only "<text>"] [--include-edited] [--by <email>] [--apply] [--confirm-prod]');
    process.exit(2);
  }
  if (tier === 'prod' && apply && !flag('--confirm-prod')) {
    console.error('Refusing to save on prod without --confirm-prod. Apply on test first and look at a Workie read there.');
    process.exit(2);
  }
  process.env.AWS_REGION = process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || 'us-east-1';

  // The handlers resolve their SDK from lambda-functions/admin, then
  // lambda-functions. Check up front so a missing one is one clear line.
  const adminRequire = createRequire(path.join(REPO, 'lambda-functions', 'admin', 'package.json'));
  const needed = ['@aws-sdk/client-lambda', '@aws-sdk/client-sts', '@aws-sdk/client-s3', '@aws-sdk/client-dynamodb', '@aws-sdk/lib-dynamodb', '@aws-sdk/client-kms'];
  const missing = needed.filter((m) => { try { adminRequire.resolve(m); return false; } catch (e) { return true; } });
  if (missing.length) {
    console.error(`Missing packages. Run once:\n  (cd lambda-functions && npm ci) && (cd lambda-functions/admin && npm ci && npm install --no-save ${missing.join(' ')})`);
    process.exit(2);
  }
  const { LambdaClient, GetFunctionConfigurationCommand } = adminRequire('@aws-sdk/client-lambda');
  const { STSClient, GetCallerIdentityCommand } = adminRequire('@aws-sdk/client-sts');

  let identity;
  try {
    identity = await new STSClient({}).send(new GetCallerIdentityCommand({}));
  } catch (e) {
    console.error(`No AWS credentials (${e.name}). Run \`aws sso login --profile <profile>\` and set AWS_PROFILE.`);
    process.exit(2);
  }
  const by = (opt('--by') || identity.Arn || '').toLowerCase();

  const stack = STACKS[tier];
  const fn = await new LambdaClient({}).send(new GetFunctionConfigurationCommand({ FunctionName: `${stack}-admin-get-ai-prompts` }));
  const env = (fn.Environment && fn.Environment.Variables) || {};
  if (!env.TABLE_NAME || !env.AI_PROMPTS_BUCKET) throw new Error(`${stack}-admin-get-ai-prompts has no TABLE_NAME/AI_PROMPTS_BUCKET`);
  // The handlers read these at module load (and tenant-crypto reads the KMS
  // key), so the whole environment is set before require().
  Object.entries(env).forEach(([k, v]) => { if (process.env[k] === undefined) process.env[k] = v; });

  const entries = JSON.parse(fs.readFileSync(path.join(REPO, 'src', 'src', 'config', 'repoPrompts.json'), 'utf8')).prompts;
  const match = await import(pathToFileURL(path.join(REPO, 'src', 'src', 'utils', 'repoPromptMatch.js')).href);
  const quiet = !process.env.DEBUG;
  const realLog = console.log;
  if (quiet) { console.log = () => {}; console.warn = () => {}; }
  const listHandler = require(path.join(REPO, 'lambda-functions', 'admin', 'get-ai-prompts.js')).handler;
  const updateHandler = require(path.join(REPO, 'lambda-functions', 'admin', 'update-ai-prompt.js')).handler;
  const say = (s) => process.stdout.write(`${s}\n`);

  say(`${apply ? 'APPLYING' : 'DRY RUN'} on ${tier} (${stack}) as ${identity.Arn}`);
  say(`  table=${env.TABLE_NAME} bucket=${env.AI_PROMPTS_BUCKET}  repo prompts: ${entries.length}\n`);
  const result = await run({
    listHandler, updateHandler, entries, match, apply,
    only: opt('--only'), includeEdited: flag('--include-edited'), by, log: say,
  });
  if (quiet) console.log = realLog;

  const pending = result.rows.filter((r) => r.action === 'save');
  if (!apply) {
    say(`\n${pending.length} prompt(s) would get a new version from the repo. Dry run only; re-run with --apply.`);
    return;
  }
  say('');
  result.saved.filter((r) => r.newVersion).forEach((r) => say(`  saved     ${r.prompt.name}: v${r.prompt.version} -> v${r.newVersion}`));
  result.unverified.forEach((r) => say(`  UNVERIFIED ${r.prompt.name}: saved, but the library does not read it as matching the repo`));
  result.failed.forEach((r) => say(`  FAILED    ${r.prompt.name}: ${r.error}`));
  say(`\n${result.saved.length - result.unverified.length} saved and verified, ${result.unverified.length} unverified, ${result.failed.length} failed.`);
  if (result.failed.length || result.unverified.length) process.exit(1);
}

if (require.main === module) {
  main().catch((e) => { console.error('error:', e); process.exit(1); });
}
