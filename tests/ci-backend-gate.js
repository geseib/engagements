/**
 * THE BACKEND GATE SKIPS ONLY WHEN IT IS SURE — scripts/ci/backend-gate.sh
 *
 * The gate lets a deploy skip `sam build` and `sam deploy` (~22 of ~27 minutes)
 * when nothing the backend is built from changed since the last successful
 * deploy of that stack. A wrong "skip" ships a frontend against a backend that
 * is missing its change, silently. So every doubt must come out as "run", and
 * this file proves each one against the real script with a fake `aws` on PATH.
 *
 * It also pins the buildspecs: all three call the gate, only sam build and sam
 * deploy sit behind it, and lint / jest / webpack / the S3 sync never do.
 *
 * // rejects: a skip with no marker, a changed lambda file / template /
 * //          buildspec / parameter, a stack touched since the recorded deploy,
 * //          a stack not in a clean *_COMPLETE state, an SSM or CloudFormation
 * //          error, FORCE_FULL_DEPLOY=true; and a buildspec that gates a
 * //          frontend check or runs sam outside the gate.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const REPO = path.join(__dirname, '..');
const SCRIPT = path.join(REPO, 'scripts/ci/backend-gate.sh');

let passed = 0;
let failed = 0;
function check(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`  PASS  ${name}`);
  } catch (err) {
    failed += 1;
    console.log(`  FAIL  ${name}\n        ${err.message}`);
  }
}
function eq(actual, expected, what) {
  if (actual !== expected) throw new Error(`${what}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

// ── A throwaway repo with a fake `aws` whose answers live in files ──────────
function makeWorld() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'backend-gate-'));
  const w = (rel, body) => {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), body);
  };
  w('lambda-functions/game/a.js', 'module.exports = 1;\n');
  w('lambda-functions/admin/b.js', 'module.exports = 2;\n');
  w('template-clean.yaml', 'Resources: {}\n');
  w('buildspec-dev.yml', 'version: 0.2\n');
  w('src/src/App.jsx', 'export default 1;\n');
  w('scripts/ci/backend-gate.sh', fs.readFileSync(SCRIPT, 'utf8'));

  const state = path.join(dir, '.fake');
  fs.mkdirSync(state);
  fs.writeFileSync(path.join(state, 'stack'), 'UPDATE_COMPLETE\t2026-10-02T10:00:00Z\n');
  // The fake aws: describe-stacks, ssm get-parameter / put-parameter. A file
  // named fail-<service> makes that service exit 255, as an expired token does.
  w('.bin/aws', `#!/usr/bin/env bash
S="${state}"
case "$1 $2" in
  "cloudformation describe-stacks")
    [ -f "$S/fail-cloudformation" ] && exit 255
    cat "$S/stack" ;;
  "ssm get-parameter")
    [ -f "$S/fail-ssm" ] && exit 255
    [ -f "$S/param" ] || { echo "ParameterNotFound" >&2; exit 254; }
    cat "$S/param" ;;
  "ssm put-parameter")
    [ -f "$S/fail-ssm" ] && exit 255
    while [ $# -gt 0 ]; do [ "$1" = "--value" ] && { printf '%s\\n' "$2" > "$S/param"; }; shift; done ;;
  *) echo "fake aws: unexpected $*" >&2; exit 1 ;;
esac
`);
  fs.chmodSync(path.join(dir, '.bin/aws'), 0o755);

  const env = (extra = {}) => ({
    PATH: `${path.join(dir, '.bin')}:${process.env.PATH}`,
    HOME: process.env.HOME,
    ENVIRONMENT: 'dev',
    STACK_NAME: 'engagedev',
    PARAM_OVERRIDES: 'Environment=dev GitHubToken=secret',
    CODEBUILD_RESOLVED_SOURCE_VERSION: 'abcdef0123456789',
    ...extra,
  });
  const run = (sub, extra) =>
    execFileSync('bash', ['scripts/ci/backend-gate.sh', sub], { cwd: dir, env: env(extra), stdio: ['ignore', 'pipe', 'pipe'] })
      .toString().trim();
  const fp = (extra) => run('fingerprint', extra);
  const gate = (extra = {}) => run('check', { BACKEND_FP: fp(extra), ...extra });
  const record = (extra = {}) => run('record', { BACKEND_FP: fp(extra), ...extra });
  return {
    dir, state, w, fp, gate, record,
    setStack: (s) => fs.writeFileSync(path.join(state, 'stack'), s),
    fail: (svc) => fs.writeFileSync(path.join(state, `fail-${svc}`), ''),
    param: () => fs.readFileSync(path.join(state, 'param'), 'utf8').trim(),
    cleanup: () => fs.rmSync(dir, { recursive: true, force: true }),
  };
}

function withRecorded(fn) {
  const world = makeWorld();
  try {
    world.record();
    fn(world);
  } finally {
    world.cleanup();
  }
}

console.log('backend-gate.sh decisions');

check('no marker yet (first gated deploy) -> run', () => {
  const world = makeWorld();
  try { eq(world.gate(), 'run', 'decision'); } finally { world.cleanup(); }
});

check('recorded and nothing changed -> skip', () => withRecorded((w) => {
  eq(w.gate(), 'skip', 'decision');
}));

check('the marker holds the fingerprint, stack time and commit, never a secret', () => withRecorded((w) => {
  const [fp, updated, commit] = w.param().split(' ');
  eq(/^[0-9a-f]{64}$/.test(fp), true, 'fingerprint shape');
  eq(updated, '2026-10-02T10:00:00Z', 'stack LastUpdatedTime');
  eq(commit, 'abcdef012345', 'commit');
  eq(w.param().includes('secret'), false, 'secret in marker');
}));

check('a frontend-only change -> skip', () => withRecorded((w) => {
  w.w('src/src/App.jsx', 'export default 2;\n');
  eq(w.gate(), 'skip', 'decision');
}));

check('a lambda file changed -> run', () => withRecorded((w) => {
  w.w('lambda-functions/game/a.js', 'module.exports = 3;\n');
  eq(w.gate(), 'run', 'decision');
}));

check('a lambda file added -> run', () => withRecorded((w) => {
  w.w('lambda-functions/game/new.js', '\n');
  eq(w.gate(), 'run', 'decision');
}));

check('a lambda file deleted -> run', () => withRecorded((w) => {
  fs.rmSync(path.join(w.dir, 'lambda-functions/admin/b.js'));
  eq(w.gate(), 'run', 'decision');
}));

check('bytes moved between two files (same concatenation) -> run', () => withRecorded((w) => {
  w.w('lambda-functions/admin/b.js', '');
  w.w('lambda-functions/game/a.js', 'module.exports = 1;\nmodule.exports = 2;\n');
  eq(w.gate(), 'run', 'decision');
}));

check('node_modules under lambda-functions is ignored', () => withRecorded((w) => {
  w.w('lambda-functions/admin/node_modules/x/index.js', 'junk\n');
  eq(w.gate(), 'skip', 'decision');
}));

check('template-clean.yaml changed -> run', () => withRecorded((w) => {
  w.w('template-clean.yaml', 'Resources: {A: 1}\n');
  eq(w.gate(), 'run', 'decision');
}));

check('the buildspec changed -> run', () => withRecorded((w) => {
  w.w('buildspec-dev.yml', 'version: 0.2\n# sam pin moved\n');
  eq(w.gate(), 'run', 'decision');
}));

check('a deploy parameter changed (e.g. a rotated secret) -> run', () => withRecorded((w) => {
  eq(w.gate({ PARAM_OVERRIDES: 'Environment=dev GitHubToken=rotated' }), 'run', 'decision');
}));

check('the stack was updated since the recorded deploy -> run', () => withRecorded((w) => {
  w.setStack('UPDATE_COMPLETE\t2026-10-02T11:30:00Z\n');
  eq(w.gate(), 'run', 'decision');
}));

for (const status of ['UPDATE_ROLLBACK_COMPLETE', 'UPDATE_IN_PROGRESS', 'UPDATE_ROLLBACK_FAILED']) {
  check(`stack status ${status} -> run`, () => withRecorded((w) => {
    w.setStack(`${status}\t2026-10-02T10:00:00Z\n`);
    eq(w.gate(), 'run', 'decision');
  }));
}

check('CloudFormation unreadable -> run', () => withRecorded((w) => {
  w.fail('cloudformation');
  eq(w.gate(), 'run', 'decision');
}));

check('SSM unreadable -> run', () => withRecorded((w) => {
  w.fail('ssm');
  eq(w.gate(), 'run', 'decision');
}));

check('FORCE_FULL_DEPLOY=true -> run', () => withRecorded((w) => {
  eq(w.gate({ FORCE_FULL_DEPLOY: 'true' }), 'run', 'decision');
}));

check('no fingerprint (missing template) -> run, and record writes nothing', () => {
  const world = makeWorld();
  try {
    fs.rmSync(path.join(world.dir, 'template-clean.yaml'));
    eq(world.fp(), '', 'fingerprint');
    eq(world.gate(), 'run', 'decision');
    world.record();
    eq(fs.existsSync(path.join(world.state, 'param')), false, 'marker written');
  } finally { world.cleanup(); }
});

check('empty STACK_NAME -> run', () => withRecorded((w) => {
  eq(w.gate({ STACK_NAME: '' }), 'run', 'decision');
}));

check('record never fails the build, even when SSM is down', () => {
  const world = makeWorld();
  try {
    world.fail('ssm');
    world.record(); // execFileSync throws on a non-zero exit
  } finally { world.cleanup(); }
});

check('record refuses a stack that is not cleanly complete', () => {
  const world = makeWorld();
  try {
    world.setStack('UPDATE_ROLLBACK_COMPLETE\t2026-10-02T10:00:00Z\n');
    world.record();
    eq(fs.existsSync(path.join(world.state, 'param')), false, 'marker written');
  } finally { world.cleanup(); }
});

// ── The buildspecs: the gate wraps sam, and nothing else ────────────────────
console.log('buildspecs');
for (const tier of ['dev', 'test', 'prod']) {
  const lines = fs.readFileSync(path.join(REPO, `buildspec-${tier}.yml`), 'utf8')
    .split('\n')
    .filter((l) => /^\s*- /.test(l)); // commands only, comments dropped

  check(`${tier}: computes the fingerprint and asks the gate before any sam command`, () => {
    const fpAt = lines.findIndex((l) => l.includes('backend-gate.sh fingerprint'));
    const checkAt = lines.findIndex((l) => l.includes('backend-gate.sh check'));
    const firstSam = lines.findIndex((l) => /\bsam (build|deploy)\b/.test(l));
    const paramsAt = lines.findIndex((l) => l.includes('PARAM_OVERRIDES="Environment='));
    eq(fpAt > paramsAt && paramsAt >= 0, true, 'fingerprint after the parameter list');
    eq(checkAt > fpAt, true, 'check after fingerprint');
    eq(firstSam > checkAt, true, 'sam after check');
  });

  check(`${tier}: every sam build / sam deploy sits behind BACKEND_ACTION`, () => {
    const sam = lines.filter((l) => /\bsam (build|deploy)\b/.test(l));
    eq(sam.length, 2, 'sam command lines');
    for (const l of sam) eq(l.includes('BACKEND_ACTION'), true, `ungated: ${l.trim().slice(0, 80)}`);
  });

  check(`${tier}: records the marker only on the path that deployed`, () => {
    const rec = lines.filter((l) => l.includes('backend-gate.sh record'));
    eq(rec.length, 1, 'record lines');
    eq(/\$BACKEND_ACTION" != "skip"/.test(rec[0]), true, 'record guarded by != skip');
  });

  check(`${tier}: lint, jest, webpack and the S3 sync are never gated`, () => {
    for (const cmd of ['npm run lint', 'npm test', 'npm run build', 'aws s3 sync']) {
      const hits = lines.filter((l) => l.includes(cmd));
      eq(hits.length >= 1, true, `${cmd} present`);
      for (const l of hits) eq(/BACKEND_ACTION|BACKEND_FP|backend-gate/.test(l), false, `${cmd} gated`);
    }
  });
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
