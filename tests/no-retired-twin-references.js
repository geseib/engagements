/**
 * THE RETIRED TWIN STAYS DELETED, AND THE DEPLOY RULE STAYS TRUE.
 *
 * ── WHAT THIS EXISTS TO PREVENT ────────────────────────────────────────────
 *
 * Two errors in this repository have each cost real time, and both were the
 * same kind of error: a document or a script that named the wrong target and
 * nobody noticed, because nothing could notice.
 *
 *   1. THE DEAD TWIN. `eng*`/`engdev` is an off-pipeline duplicate stack frozen
 *      at a 2026-07-02 bundle. `CLAUDE.md` records the two days lost to an
 *      environment table that pointed at it: every change shipped since July was
 *      invisible there, so deploys read as "the deploy did nothing". Three
 *      scripts published to it, and the root `package.json` put all three one
 *      `npm run` away.
 *
 *   2. THE FALSE DEPLOY RULE. Ten places claimed a branch push does not deploy,
 *      three of them inside `CLAUDE.md`, contradicting its own verified opening.
 *      A branch push DOES deploy. Anyone who trusted the wrong half pushed to
 *      `dev` to share work and shipped it. The root cause is that `b6929cac`
 *      rewrote `cicd/pipeline-clean.yaml` to be tags-only and was never applied,
 *      so documents written from that file described infrastructure that does
 *      not exist.
 *
 * Both were fixed by hand twice before. Prose does not hold — this does.
 *
 * ── WHAT IT CHECKS, AND WHAT IT DELIBERATELY ALLOWS ────────────────────────
 *
 * CODE, NOT PROSE. Comments and documentation may discuss the twin at length,
 * and must: explaining why a target is wrong is how the next person avoids it.
 * What may not happen is a file that *executes* against it, or a markdown code
 * block someone can copy and run. So `.js` comments are stripped, `.sh`/`.yaml`
 * `#` comments are stripped, and markdown is scanned inside fenced blocks only.
 *
 * `docs/archive/` is skipped whole. Its files are dated historical records and
 * rewriting them would be forging the record.
 *
 * // rejects: a script, buildspec, package.json entry or runnable doc snippet
 * //          that targets the retired twin; and any file that states the false
 * //          deploy rule as fact.
 */
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { execFileSync } = require('child_process');

const REPO = path.join(__dirname, '..');

let pass = 0; let fail = 0;
const check = (label, fn) => {
  try { fn(); console.log(`  ok   - ${label}`); pass += 1; } catch (e) {
    console.log(`  FAIL - ${label}\n         ${e.message}`); fail += 1;
  }
};

const tracked = execFileSync('git', ['ls-files'], { cwd: REPO, encoding: 'utf8' })
  .split('\n').filter(Boolean)
  .filter((f) => !f.startsWith('docs/archive/'))
  .filter((f) => fs.existsSync(path.join(REPO, f)));

const EXT = (f) => path.extname(f).toLowerCase();
const SCANNABLE = new Set(['.js', '.jsx', '.sh', '.yaml', '.yml', '.json', '.md', '.toml']);

/** Only the parts a machine would run. */
function executableText(rel) {
  const src = fs.readFileSync(path.join(REPO, rel), 'utf8');
  const ext = EXT(rel);
  if (ext === '.js' || ext === '.jsx') {
    return src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');
  }
  if (ext === '.sh' || ext === '.yaml' || ext === '.yml' || ext === '.toml') {
    return src.split('\n').map((l) => l.replace(/(^|\s)#.*$/, '$1')).join('\n');
  }
  if (ext === '.md') {
    // fenced blocks only — prose is free to explain the twin
    return (src.match(/```[\s\S]*?```/g) || []).join('\n');
  }
  return src; // .json has no comments
}

console.log('1. the deleted hand-deploy scripts are not invoked');

/* deploy-clean.sh is NOT here on purpose. It survives as a guarded escape
   hatch: it refuses engagetest, engageprod and every twin stack by name, and
   refuses to deploy at all when the Google OAuth parameters are missing. The
   four below have no guarded form — they only ever reached the twin. */
const DELETED_SCRIPTS = [
  'deployall',
  'deploy-frontend-eng.sh',
  'deploy-dev-full.sh',
  'update-frontend-env.sh',
];

const invoked = [];
for (const rel of tracked.filter((f) => SCANNABLE.has(EXT(f)))) {
  const text = executableText(rel);
  for (const s of DELETED_SCRIPTS) {
    // an invocation, not a mention: ./x, sh x, npm-script value, or bare at line start
    const re = new RegExp(`(\\./|\\bsh\\s+|\\bbash\\s+|"\\s*\\./?)${s.replace('.', '\\.')}\\b`);
    if (re.test(text)) invoked.push(`${rel} -> ${s}`);
  }
}
// rejects: a runnable reference to a script deleted in 0968435f.
check('no runnable reference to a deleted deploy script', () => {
  assert.deepStrictEqual(invoked, [],
    `these would run a script that no longer exists:\n         ${invoked.join('\n         ')}`);
});

check('and the scripts really are gone', () => {
  for (const s of DELETED_SCRIPTS) {
    const atRoot = fs.existsSync(path.join(REPO, s));
    const inScripts = fs.existsSync(path.join(REPO, 'scripts', s));
    assert.ok(!atRoot && !inScripts, `${s} is back`);
  }
});

// rejects: re-adding the npm front door that put the twin one keystroke away.
check('package.json exposes no deploy script', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(REPO, 'package.json'), 'utf8'));
  const deployish = Object.keys(pkg.scripts || {}).filter((k) => /deploy/i.test(k));
  assert.deepStrictEqual(deployish, [],
    `the pipeline is the deploy; found: ${deployish.join(', ')}`);
});

console.log('\n2. nothing executes against the retired twin');

/* The twin's own identifiers. `engdev` as a BARE WORD is excluded here because
   it legitimately survives in two live places: the SSM fallback paths
   `/engdev/google/client-*` that buildspec-dev.yml and deploy-clean.sh really
   do read, and deploy-clean.sh's list of stack names it refuses. Those are the
   twin being handled correctly, not targeted. */
const TWIN = [
  ['h1jcmja0w1', "the twin's REST API id"],
  ['r4c24mqku1', "the twin's WebSocket API id"],
  ['eng.dev.seibtribe.us', 'the twin dev host (live dev is engage.dev.seibtribe.us)'],
  ['eng.test.seibtribe.us', 'the twin test host'],
  ['engdev-web', "the twin's frontend bucket"],
];

const targeting = [];
for (const rel of tracked.filter((f) => SCANNABLE.has(EXT(f)))) {
  const text = executableText(rel);
  for (const [needle, why] of TWIN) {
    if (text.includes(needle)) targeting.push(`${rel}: ${needle} (${why})`);
  }
}
// rejects: THE DEAD TWIN, reached by code rather than by a stale doc.
check('no executable code names a twin host, API id or bucket', () => {
  assert.deepStrictEqual(targeting, [],
    `these point at the retired stack:\n         ${targeting.join('\n         ')}`);
});

console.log('\n3. the deploy rule is not restated falsely');

/* The rule lives in CLAUDE.md's first two sections and nowhere else. These
   phrasings are the specific false claims that were repeated ten times; the
   check covers prose as well as code, because a false rule does its damage by
   being read. */
const FALSE_RULE = [
  'deploys nothing',
  'branch push does not deploy',
  'branch push is not a deploy',
  'A branch push does NOT deploy',
  'triggered by git tags only',
  'tag-triggered only',
];

const restated = [];
for (const rel of tracked.filter((f) => SCANNABLE.has(EXT(f)))) {
  const src = fs.readFileSync(path.join(REPO, rel), 'utf8');
  for (const phrase of FALSE_RULE) {
    const i = src.toLowerCase().indexOf(phrase.toLowerCase());
    if (i === -1) continue;
    // A line that marks the claim as wrong is the fix, not the offence.
    const line = src.slice(src.lastIndexOf('\n', i) + 1, src.indexOf('\n', i) + 1 || undefined);
    if (/\b(not applied|not true|intended|used to|no longer|false|was wrong|stale)\b/i.test(line)) continue;
    restated.push(`${rel}: "${phrase}"`);
  }
}
// rejects: the contradiction returning. It was fixed by hand twice.
check('no file asserts that a branch push is inert', () => {
  assert.deepStrictEqual(restated, [],
    `a branch push DOES deploy — see CLAUDE.md:\n         ${restated.join('\n         ')}`);
});

// rejects: losing the verified rule itself, which is what all of the above protects.
check('CLAUDE.md still states the real rule', () => {
  const src = fs.readFileSync(path.join(REPO, 'CLAUDE.md'), 'utf8');
  assert.ok(/BOTH a `<tier>-v\*` TAG AND A PUSH TO THE TIER BRANCH DEPLOY/i.test(src)
    || /both.*tag.*and.*branch push.*deploy/i.test(src),
  'CLAUDE.md no longer states that both a tag and a branch push deploy');
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
