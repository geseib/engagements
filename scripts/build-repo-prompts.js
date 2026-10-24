#!/usr/bin/env node
/**
 * THE REPO'S PROMPT FILES, AS THE ADMIN LIBRARY SEES THEM.
 *
 *   node scripts/build-repo-prompts.js           # write src/src/config/repoPrompts.json
 *   node scripts/build-repo-prompts.js --check   # exit 1 if the committed file is stale
 *
 * The prompts kept in the repo — `demo-sets/*.prompt.json` (one Workie per demo
 * set), `prompts/tier-defaults/*.prompt.json` (the per-game-type defaults
 * curated on a tier) and `lambda-functions/admin/default-ai-prompts.json` (the
 * built-in defaults) — travel with every deploy. The admin Prompts library compares
 * each live prompt with its repo file and offers "Repo has a newer version"
 * (docs/design/prompt-versions/). The frontend cannot import outside src/, so
 * this writes what it needs into src/src/config/repoPrompts.json: name, game
 * type, the content fields the file carries, per-field and whole hashes, the
 * source path, and when the repo last changed it.
 *
 * Runs in src/'s `prebuild`, AND its output is committed, so a build with no
 * git (CodeBuild's source artifact has no .git) and a fresh checkout agree.
 * tests/repo-prompts-fresh.js fails when the committed file is stale.
 *
 * THE HASHES ARE THE LAMBDA'S. `fieldHashes`/`contentHash` come from
 * lambda-functions/admin/shared/prompt-versions.js, the module get-ai-prompts.js
 * hashes the live text with, so the two sides cannot disagree about what
 * "the same" means.
 *
 * DATES ARE STABLE. An entry whose hash has not changed keeps the commitDate
 * already in the committed file, so rebuilding never churns it; a changed or
 * new entry takes the file's last commit date from git, or today when the file
 * has uncommitted changes (it is about to be committed), or null without git.
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const REPO = path.join(__dirname, '..');
const OUT = path.join(REPO, 'src', 'src', 'config', 'repoPrompts.json');
const versions = require(path.join(REPO, 'lambda-functions', 'admin', 'shared', 'prompt-versions.js'));
const { normalizeGameType } = require(path.join(REPO, 'lambda-functions', 'admin', 'shared', 'game-types.js'));

const DEMO_DIR = 'demo-sets';
// Prompts curated on a tier and then kept here, so the library and
// scripts/apply-repo-prompts.js can carry them to the next tier. Compared
// only: populate-defaults does NOT seed from this folder, because each tier
// already has these rows and a second default per game type is a bug.
const TIER_DIR = 'prompts/tier-defaults';

function git(args) {
  try {
    return execFileSync('git', args, { cwd: REPO, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return null;
  }
}

function fileCommitDate(relPath) {
  const dirty = git(['status', '--porcelain', '--', relPath]);
  if (dirty) return new Date().toISOString().slice(0, 10);
  const date = git(['log', '-1', '--format=%cI', '--', relPath]);
  return date || null;
}

function entryFor({ key, relPath, raw, gameType, categoryKey }) {
  const fields = versions.CONTENT_FIELDS.filter((f) => raw[f] !== undefined && raw[f] !== null);
  const values = {};
  for (const f of fields) values[f] = raw[f];
  return {
    key,
    path: relPath,
    source: relPath === versions.DEFAULTS_REPO_PATH ? 'defaults' : relPath.split('/').slice(0, -1).join('/'),
    name: String(raw.name || '').trim(),
    gameType: normalizeGameType(raw.gameType || gameType),
    ...(raw.category || categoryKey ? { category: raw.category || categoryKey } : {}),
    ...(categoryKey ? { scenario: categoryKey } : {}),
    ...(raw.promptId ? { promptId: String(raw.promptId) } : {}),
    ...(raw.isDefault === true ? { isDefault: true } : {}),
    fields,
    values,
    fieldHashes: versions.fieldHashes(raw, fields),
    hash: versions.contentHash(raw, fields),
  };
}

/** Every repo prompt, in a stable order, without dates. */
function collect() {
  const entries = [];
  for (const dir of [DEMO_DIR, TIER_DIR]) {
    const files = fs.readdirSync(path.join(REPO, dir))
      .filter((f) => f.endsWith('.prompt.json'))
      .sort();
    for (const f of files) {
      const relPath = `${dir}/${f}`;
      const raw = JSON.parse(fs.readFileSync(path.join(REPO, relPath), 'utf8'));
      entries.push(entryFor({ key: relPath, relPath, raw }));
    }
  }
  const defaults = JSON.parse(fs.readFileSync(path.join(REPO, versions.DEFAULTS_REPO_PATH), 'utf8'));
  for (const [gameType, categories] of Object.entries(defaults)) {
    for (const [categoryKey, raw] of Object.entries(categories)) {
      entries.push(entryFor({
        key: versions.defaultsRepoKey(gameType, categoryKey),
        relPath: versions.DEFAULTS_REPO_PATH,
        raw,
        gameType,
        categoryKey,
      }));
    }
  }
  return entries;
}

function readCommitted() {
  try { return JSON.parse(fs.readFileSync(OUT, 'utf8')); } catch { return null; }
}

/** The file as it should be, keeping committed dates for unchanged entries. */
function build({ committed = readCommitted() } = {}) {
  const before = new Map(((committed && committed.prompts) || []).map((p) => [p.key, p]));
  const dates = new Map();
  const prompts = collect().map((entry) => {
    const prior = before.get(entry.key);
    let commitDate = prior && prior.hash === entry.hash ? (prior.commitDate || null) : undefined;
    if (commitDate === undefined) {
      if (!dates.has(entry.path)) dates.set(entry.path, fileCommitDate(entry.path));
      commitDate = dates.get(entry.path);
    }
    return { ...entry, commitDate };
  });
  return {
    _comment: 'GENERATED by scripts/build-repo-prompts.js from demo-sets/*.prompt.json, '
      + 'prompts/tier-defaults/*.prompt.json and lambda-functions/admin/default-ai-prompts.json. '
      + 'Do not edit; run the script.',
    schema: 1,
    prompts,
  };
}

/** Everything but the dates — what "stale" is judged on. */
function comparable(file) {
  return JSON.stringify(((file && file.prompts) || []).map(({ commitDate, ...rest }) => rest));
}

function isFresh(committed = readCommitted()) {
  return Boolean(committed) && comparable(committed) === comparable(build({ committed }));
}

module.exports = { build, collect, comparable, isFresh, OUT };

if (require.main === module) {
  if (process.argv.includes('--check')) {
    if (isFresh()) {
      console.log('repoPrompts.json is current.');
      process.exit(0);
    }
    console.error('src/src/config/repoPrompts.json is stale. Run: node scripts/build-repo-prompts.js');
    process.exit(1);
  }
  const next = build();
  const text = `${JSON.stringify(next, null, 2)}\n`;
  const prior = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8') : '';
  if (prior !== text) fs.writeFileSync(OUT, text);
  console.log(`repoPrompts.json: ${next.prompts.length} repo prompts${prior === text ? ' (unchanged)' : ' (written)'}`);
}
