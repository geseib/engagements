/**
 * THE ARCHIVE SCRIPTS, RUN — against a stubbed aws, curl and sam, so their failure paths are
 * exercised without touching AWS or the network.
 *
 * scripts/archive-access-check.sh and scripts/archive-drill.sh are the proof, before and after
 * the archive is locked, that no tier is cut off and no route is left open, and
 * scripts/deploy-archive.sh is what locks it. Their happy paths run live; their failure paths
 * cannot, so this suite puts an `aws`, a `curl`, a `sam` and an `mv` of its own first on PATH
 * and drives all three scripts through the failures that matter: a route left open, an archive
 * that does not answer, a simulation call that fails, a function that cannot be read, an export
 * call that fails, a removal that cannot finish or leaves rows behind, a stack whose outputs
 * cannot be read or are not what a tier can sign for, a config that cannot be moved into place,
 * and a deploy that fails. It also runs one whole drill through restore and removal, one whose
 * restore comes back active, and every mode of the deploy script, because a check that can
 * never pass live looks exactly like a check that has not been reached. Each run is judged by
 * its exit status, its combined output, and the calls the stubs logged.
 *
 * EVERY DEPLOY-SCRIPT RUN GETS A THROWAWAY REPO: a temp directory holding copies of the two
 * scripts, the template, config/archive-service.json and lambda-functions/archive/ (what the
 * template's CodeUri names, so the stubbed build resolves it as the real one would), committed
 * once. The script's git checks run there, and nothing it writes can reach the real config.
 *
 * STUB_SCENARIO (comma-separated) selects the failures a stub injects; STUB_LOG collects one
 * line per call, the program name and its arguments; STUB_STATE is a fresh directory per run
 * where the aws stub keeps the set id it was given and the markers (restored, set-removed,
 * media-removed) that let a whole drill answer in sequence. The stubs are node scripts written
 * from the four functions below, so they are real code here and self-contained there.
 *
 * // rejects: verify passing with a route that does not require AWS_IAM; a curl or simulation
 * //          failure that ends the run without a summary; an expired token reported as a
 * //          missing deploy; the drill reading a stale reply as a failed call's answer, or an
 * //          eventually consistent one as the row's state; a removal that leaves something
 * //          behind without naming it; a drill whose inactive check cannot pass, or that calls
 * //          a set removed without looking at its rows; a deploy that ignores its mode, deploys
 * //          uncommitted changes, builds a CodeUri that does not resolve, writes the config
 * //          from outputs it could not read, leaves a temporary config beside the real one,
 * //          guesses what a failed deploy did, or leaves the operator unsure whether the
 * //          archive is locked.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const { spawnSync } = require('child_process');

const REPO = path.join(__dirname, '..');

const onPath = (cmd) => {
  const r = spawnSync(cmd, ['--version'], { encoding: 'utf8' });
  return !r.error && r.status === 0;
};
if (!onPath('bash') || !onPath('jq')) {
  console.log('skipped: bash and jq are required to run the archive scripts');
  process.exit(0);
}

let pass = 0; let fail = 0;
const check = (label, fn) => {
  try { fn(); console.log(`  ok   - ${label}`); pass += 1; } catch (e) {
    console.log(`  FAIL - ${label}\n         ${e.message}`); fail += 1;
  }
};

// ── The stubs ───────────────────────────────────────────────────────────────

/** `aws`, answering exactly the calls the three scripts make. Anything else is a loud failure. */
function awsStub() {
  const fs = require('fs');
  const path = require('path');
  const argv = process.argv.slice(2);
  if (process.env.STUB_LOG) fs.appendFileSync(process.env.STUB_LOG, `aws ${argv.join(' ')}\n`);
  const scenarios = String(process.env.STUB_SCENARIO || '').split(',').filter(Boolean);
  const has = (scenario) => scenarios.includes(scenario);
  const option = (flag) => { const i = argv.indexOf(flag); return i === -1 ? '' : String(argv[i + 1] || ''); };
  const say = (text) => process.stdout.write(`${text}\n`);
  const awsError = (code) => {
    process.stderr.write(`An error occurred (${code}) when calling the ${argv[1]} operation: stubbed failure\n`);
    process.exit(254);
  };
  const unexpected = () => { process.stderr.write(`unexpected aws call: ${argv.join(' ')}\n`); process.exit(99); };
  // What one drill has done so far: the set id it created, and the markers later calls answer by.
  const state = process.env.STUB_STATE || __dirname;
  const marked = (name) => fs.existsSync(path.join(state, name));
  const mark = (name) => fs.writeFileSync(path.join(state, name), '');
  const savedSetId = () => (marked('set-id') ? fs.readFileSync(path.join(state, 'set-id'), 'utf8').trim() : '');

  switch (argv.slice(0, 2).join(' ')) {
    case 'sts get-caller-identity':
      say('239601476690');
      break;
    case 'lambda get-function-configuration': {
      const name = option('--function-name');
      if (has(`config-error:${name}`)) awsError('ExpiredTokenException');
      say(JSON.stringify({
        Role: `arn:aws:iam::239601476690:role/${name}-role`,
        Environment: { Variables: { ARCHIVE_SERVICE_URL: 'https://9gi7xpycsf.execute-api.us-east-1.amazonaws.com' } },
      }));
      break;
    }
    case 'iam simulate-principal-policy':
      if (has('simulate-error') && option('--resource-arns').endsWith('POST/archive/search')) awsError('AccessDenied');
      say('allowed');
      break;
    case 'apigatewayv2 get-routes': {
      const routes = ['GET /archive/items', 'GET /archive/items/{archiveId}', 'POST /archive/items',
        'PUT /archive/items/{archiveId}', 'DELETE /archive/items/{archiveId}', 'POST /archive/search'];
      say(routes.map((route) => `${route}\t${has('route-open') && route.startsWith('PUT ') ? 'NONE' : 'AWS_IAM'}`).join('\n'));
      break;
    }
    case 'lambda invoke': {
      const name = option('--function-name');
      const outfile = argv[argv.length - 1];
      const reply = (body) => {
        fs.writeFileSync(outfile, JSON.stringify({ statusCode: 200, body: JSON.stringify(body) }));
        say('{"StatusCode":200}');
      };
      if (name.endsWith('-admin-archive-items')) reply({ count: 2, items: [] });
      else if (name.endsWith('-admin-upload-questions')) {
        const body = JSON.parse(JSON.parse(option('--payload')).body);
        fs.writeFileSync(path.join(state, 'set-id'), String(body.customTitle || ''));
        reply({});
      } else if (name.endsWith('-admin-delete-question-set')) {
        if (has('set-removal-fails')) awsError('ServiceException');
        if (marked('restored')) mark('set-removed');
        reply({});
      } else if (name.endsWith('-admin-export-to-archive')) {
        if (has('export-call-fails')) awsError('ServiceException');
        reply({ results: { successful: [{ archiveId: 'arc-drill', snapshotId: 'snap-drill', media: { copied: 1, missing: [] } }], failed: [] } });
      } else if (name.endsWith('-admin-import-from-archive')) {
        mark('restored');
        reply({
          results: { successful: [{ archiveId: 'arc-drill', kind: 'set', id: savedSetId(), mode: 'created', version: 1, active: false }], failed: [] },
          becameActive: [],
          media: { copied: 1, kept: 0, missing: [] },
        });
      } else unexpected();
      break;
    }
    case 'cloudformation describe-stacks': {
      // The deploy script reads one output per call: --query "Stacks[0].Outputs[?OutputKey=='<key>'].OutputValue".
      if (has('outputs-fail')) awsError('ValidationError');
      const key = (/OutputKey=='([A-Za-z]+)'/.exec(option('--query')) || [])[1] || '';
      const outputs = {
        ArchiveDomainUrl: 'https://archive.seibtribe.us',
        ArchiveApiUrl: has('outputs-empty') ? 'None'
          : has('outputs-wrong-url') ? 'https://archive.seibtribe.us'
            : 'https://9gi7xpycsf.execute-api.us-east-1.amazonaws.com',
        ArchiveTableName: has('outputs-empty-table') ? 'None' : 'engage2-archive',
        ArchiveBucketName: 'engage2-archive-content',
      };
      if (!outputs[key]) unexpected();
      say(outputs[key]);
      break;
    }
    case 'cloudformation describe-stack-resources':
      say(option('--stack-name'));
      break;
    case 'dynamodb get-item':
      // Seconds after a delete or a restore, an eventually consistent read can answer from
      // before it, so a correct drill could fail. Only a consistent read is answered here.
      if (!argv.includes('--consistent-read')) { process.stderr.write('consistent read required\n'); process.exit(99); }
      // With --query it is step 3 asking whether the set is gone; without, step 4 reading the row.
      if (argv.includes('--query')) say('None');
      else say(JSON.stringify({ Item: { SK: { S: `SET#${savedSetId()}` }, activeVersion: { N: '1' }, active: { BOOL: has('restored-active') } } }));
      break;
    case 'dynamodb query': {
      if (!argv.includes('COUNT')) unexpected();
      if (!argv.includes('--consistent-read')) { process.stderr.write('consistent read required\n'); process.exit(99); }
      const partition = String((JSON.parse(option('--expression-attribute-values'))[':pk'] || {}).S || '');
      // Under rows-remain the restored partition keeps its rows after the set is removed.
      say(partition.endsWith('#v1') && marked('restored') && (has('rows-remain') || !marked('set-removed')) ? '5' : '0');
      break;
    }
    case 's3 cp':
      break;
    case 's3 rm':
      if (String(argv[2] || '').startsWith('s3://engage2-archive-content/archive/media/')) mark('media-removed');
      break;
    case 's3api head-object':
      say('{}');
      break;
    case 's3api list-objects-v2':
      if (option('--prefix') === 'archive/media/snap-drill/' && !marked('media-removed')) say(`archive/media/snap-drill/sets/${savedSetId()}/drill.png`);
      else say('None');
      break;
    default:
      unexpected();
  }
}

/** `curl`, answering 403 like a locked archive, or not at all under `curl-down`. */
function curlStub() {
  const fs = require('fs');
  const argv = process.argv.slice(2);
  if (process.env.STUB_LOG) fs.appendFileSync(process.env.STUB_LOG, `curl ${argv.join(' ')}\n`);
  const scenarios = String(process.env.STUB_SCENARIO || '').split(',').filter(Boolean);
  if (scenarios.includes('curl-down')) {
    process.stdout.write('000');
    process.exit(28);
  }
  process.stdout.write('403');
}

/**
 * `sam`, whose build resolves every CodeUri the way the real one does — against --base-dir
 * when given, otherwise against the template's own directory — and fails on one that is not
 * there, then copies the template into its build directory, as the real one leaves a template
 * there. Its deploy only logs. Anything else is a loud failure.
 */
function samStub() {
  const fs = require('fs');
  const path = require('path');
  const argv = process.argv.slice(2);
  if (process.env.STUB_LOG) fs.appendFileSync(process.env.STUB_LOG, `sam ${argv.join(' ')}\n`);
  const scenarios = String(process.env.STUB_SCENARIO || '').split(',').filter(Boolean);
  const has = (scenario) => scenarios.includes(scenario);
  const option = (flag) => { const i = argv.indexOf(flag); return i === -1 ? '' : String(argv[i + 1] || ''); };
  switch (argv[0]) {
    case 'build': {
      if (has('sam-build-fails')) { process.stderr.write('Build Failed: stubbed failure\n'); process.exit(1); }
      const template = path.resolve(option('-t'));
      const base = option('--base-dir') ? path.resolve(option('--base-dir')) : path.dirname(template);
      for (const [, codeUri] of fs.readFileSync(template, 'utf8').matchAll(/^\s*CodeUri:\s*(\S+)/gm)) {
        const resolved = path.resolve(base, codeUri);
        if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
          process.stderr.write(`CodeUri not found: ${resolved}\n`);
          process.exit(1);
        }
      }
      const dir = path.resolve(option('--build-dir'));
      fs.mkdirSync(dir, { recursive: true });
      fs.copyFileSync(template, path.join(dir, 'template.yaml'));
      break;
    }
    case 'deploy':
      if (has('sam-deploy-fails')) { process.stderr.write('Error: Failed to create/update the stack: stubbed failure\n'); process.exit(1); }
      break;
    default:
      process.stderr.write(`unexpected sam call: ${argv.join(' ')}\n`);
      process.exit(99);
  }
}

/** `mv`, which is /bin/mv until `mv-fails` asks it to fail, so the config's move into place can be made to fail. */
function mvStub() {
  const fs = require('fs');
  const { spawnSync } = require('child_process');
  const argv = process.argv.slice(2);
  if (process.env.STUB_LOG) fs.appendFileSync(process.env.STUB_LOG, `mv ${argv.join(' ')}\n`);
  const scenarios = String(process.env.STUB_SCENARIO || '').split(',').filter(Boolean);
  if (scenarios.includes('mv-fails')) { process.stderr.write('mv: stubbed failure\n'); process.exit(1); }
  const r = spawnSync('/bin/mv', argv, { stdio: 'inherit' });
  process.exit(r.status === null ? 1 : r.status);
}

const STUB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'archive-scripts-'));
for (const [name, fn] of [['aws', awsStub], ['curl', curlStub], ['sam', samStub], ['mv', mvStub]]) {
  fs.writeFileSync(path.join(STUB_DIR, name), `#!/usr/bin/env node\n'use strict';\n(${fn.toString()})();\n`, { mode: 0o755 });
}

// ── Running a script ────────────────────────────────────────────────────────

let runs = 0;
/** A fresh stub log and state directory per run, so no call or marker survives into the next. */
function stubEnv(scenario) {
  runs += 1;
  const log = path.join(STUB_DIR, `calls-${runs}.log`);
  const state = path.join(STUB_DIR, `state-${runs}`);
  fs.mkdirSync(state);
  const env = { ...process.env, PATH: `${STUB_DIR}:${process.env.PATH || ''}`, STUB_SCENARIO: scenario, STUB_LOG: log, STUB_STATE: state };
  return { env, log };
}
/** One run of a script with the stubs first on PATH. Returns its status, combined output and the stub log. */
function run(script, args, scenario = '') {
  const { env, log } = stubEnv(scenario);
  const r = spawnSync('bash', [path.join('scripts', script), ...args], { cwd: REPO, env, encoding: 'utf8', timeout: 60000 });
  if (r.error) throw r.error;
  return {
    status: r.status,
    out: `${r.stdout || ''}${r.stderr || ''}`,
    calls: fs.existsSync(log) ? fs.readFileSync(log, 'utf8') : '',
  };
}

const CONFIG = 'config/archive-service.json';
const DEPLOY_FILES = ['scripts/deploy-archive.sh', 'scripts/archive-access-check.sh', CONFIG, 'template-archive.yaml'];
/** What the template's CodeUri names: copied so the stubbed build resolves it, as a real one must. */
const DEPLOY_DIRS = ['lambda-functions/archive'];
const REPOS = [];
/** A throwaway repo with copies of what the deploy script reads and writes, committed once, so no run can touch the real config. */
function deployRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'archive-deploy-'));
  REPOS.push(dir);
  for (const rel of DEPLOY_FILES) {
    fs.mkdirSync(path.join(dir, path.dirname(rel)), { recursive: true });
    fs.copyFileSync(path.join(REPO, rel), path.join(dir, rel));
    if (rel.endsWith('.sh')) fs.chmodSync(path.join(dir, rel), 0o755);
  }
  for (const rel of DEPLOY_DIRS) {
    fs.cpSync(path.join(REPO, rel), path.join(dir, rel), { recursive: true, filter: (src) => !src.includes('node_modules') });
  }
  const git = (...args) => {
    const r = spawnSync('git', args, { cwd: dir, encoding: 'utf8' });
    if (r.status !== 0) throw new Error(`git ${args.join(' ')} failed in the throwaway repo: ${r.stderr}`);
  };
  git('init', '-q');
  git('add', '-A');
  git('-c', 'user.name=test', '-c', 'user.email=test@example.com', 'commit', '-qm', 'fixture');
  return dir;
}
/**
 * One run of the deploy script in a fresh throwaway repo, after `prepare(repo)` has changed
 * whatever the check needs changed. Returns the run, the repo, and whether the config is
 * byte-identical afterwards.
 */
function runDeploy(args, scenario = '', prepare = () => {}) {
  const repo = deployRepo();
  prepare(repo);
  const before = fs.readFileSync(path.join(repo, CONFIG));
  const { env, log } = stubEnv(scenario);
  const r = spawnSync('bash', [path.join(repo, 'scripts', 'deploy-archive.sh'), ...args], { cwd: repo, env, encoding: 'utf8', timeout: 60000 });
  if (r.error) throw r.error;
  return {
    repo,
    status: r.status,
    out: `${r.stdout || ''}${r.stderr || ''}`,
    calls: fs.existsSync(log) ? fs.readFileSync(log, 'utf8') : '',
    configUnchanged: before.equals(fs.readFileSync(path.join(repo, CONFIG))),
  };
}

const TIERS = ['engagedev', 'engagetest'];
const exited = (r, status) => assert.strictEqual(r.status, status, `exited ${r.status}, not ${status}\n--- output ---\n${r.out}`);
const contains = (r, text) => assert.ok(r.out.includes(text), `the output lacks ${JSON.stringify(text)}\n--- output ---\n${r.out}`);
const lacks = (r, text) => assert.ok(!r.out.includes(text), `the output contains ${JSON.stringify(text)}\n--- output ---\n${r.out}`);
const noCalls = (r) => assert.strictEqual(r.calls, '', `the stubs were called:\n${r.calls}`);
/** The index in the stub log of the first call matching `pattern`, or -1. */
const callIndex = (r, pattern) => r.calls.split('\n').findIndex((line) => pattern.test(line));
/** The logged `sam deploy` call that carries `flag`, if any. */
const deployCall = (r, flag) => r.calls.split('\n').find((line) => line.startsWith('sam deploy ') && line.includes(flag));

// ── The checks ──────────────────────────────────────────────────────────────

console.log('1. both scripts refuse before they reach AWS');
check('access check with no mode prints usage, exits 2, and calls no AWS', () => {
  const r = run('archive-access-check.sh', []);
  exited(r, 2);
  contains(r, 'usage:');
  noCalls(r);
});
check('the drill refuses production before any AWS call', () => {
  const r = run('archive-drill.sh', ['engageprod']);
  exited(r, 2);
  contains(r, 'Refusing engageprod');
  noCalls(r);
});

console.log('\n2. verify proves the lock on every route, and says what is wrong');
check('verify passes only when every route requires AWS_IAM and a stranger is refused', () => {
  const r = run('archive-access-check.sh', ['verify', ...TIERS]);
  exited(r, 0);
  contains(r, 'all checks passed');
  contains(r, 'PUT /archive/items/{archiveId} requires AWS_IAM');
});
check('verify fails a route left open, and says which', () => {
  const r = run('archive-access-check.sh', ['verify', ...TIERS], 'route-open');
  exited(r, 1);
  contains(r, 'PUT /archive/items/{archiveId} is not locked');
  contains(r, '1 check(s) failed');
});
check('verify reports an archive it cannot reach instead of stopping silently', () => {
  const r = run('archive-access-check.sh', ['verify', ...TIERS], 'curl-down');
  exited(r, 1);
  contains(r, 'an unsigned request answered no answer (curl exit 28)');
  contains(r, '1 check(s) failed');
});

console.log('\n3. preflight counts every failure and finishes the run');
check('a failed simulation call is counted, and the other tier is still checked', () => {
  const r = run('archive-access-check.sh', ['preflight', ...TIERS], 'simulate-error');
  exited(r, 1);
  contains(r, 'may not invoke POST/archive/search (the simulation call failed');
  contains(r, 'engagetest');
  contains(r, '2 check(s) failed');
});
check('an unreadable function names the AWS error, not a missing deploy', () => {
  const r = run('archive-access-check.sh', ['preflight', ...TIERS], 'config-error:engagedev-admin-import-from-archive');
  exited(r, 1);
  contains(r, 'could not read engagedev-admin-import-from-archive');
  contains(r, 'ExpiredTokenException');
  lacks(r, 'does not exist — this tier');
  contains(r, 'engagetest');
  contains(r, '1 check(s) failed');
});

console.log('\n4. the drill reports a failed call as itself, and names what it could not remove');
check('a failed export call is reported as itself, and the set is removed on exit', () => {
  const r = run('archive-drill.sh', ['engagedev'], 'export-call-fails');
  exited(r, 1);
  contains(r, 'could not invoke engagedev-admin-export-to-archive');
  contains(r, 'drill FAILED on engagedev: the export call failed');
  lacks(r, 'nothing was archived');
  lacks(r, 'LEFT BEHIND');
  assert.ok(/^aws lambda invoke .*engagedev-admin-delete-question-set/m.test(r.calls), `the set was not deleted on exit; the stubs saw:\n${r.calls}`);
  // The export never named a snapshot, so the trap must search archive/media/ for images copied under one it never learned.
  assert.ok(/^aws s3api list-objects-v2 .*--prefix archive\/media\/ /m.test(r.calls), `the trap did not search archive/media/ for copied images; the stubs saw:\n${r.calls}`);
});
check('what the drill could not remove is named', () => {
  const r = run('archive-drill.sh', ['engagedev'], 'export-call-fails,set-removal-fails');
  exited(r, 1);
  contains(r, 'LEFT BEHIND - set archivedrilldev');
});

console.log('\n5. a whole drill runs through restore and removal');
check('a drill whose restore comes back whole passes, and removes what it made', () => {
  const r = run('archive-drill.sh', ['engagedev']);
  exited(r, 0);
  for (const line of ['drill passed on engagedev', 'ok   - and inactive there', 'ok   - all five content rows are back',
    'ok   - no copied image is left in the archive', 'ok   - no content rows are left']) contains(r, line);
  lacks(r, 'FAIL');
  lacks(r, 'LEFT BEHIND');
  // Step 5's order in the stub log: the restore, then the backup deleted through the relay, then its copied
  // image removed, then the restored set deleted. Each is the first matching line after the previous one.
  const lines = r.calls.split('\n');
  const after = (from, pattern) => lines.findIndex((line, i) => i > from && pattern.test(line));
  const restored = after(-1, /^aws lambda invoke .*engagedev-admin-import-from-archive/);
  const backupDeleted = after(restored, /^aws lambda invoke .*engagedev-admin-archive-items/);
  const imageRemoved = after(backupDeleted, /^aws s3 rm s3:\/\/engage2-archive-content\/archive\/media\/snap-drill\/sets\//);
  const setRemoved = after(imageRemoved, /^aws lambda invoke .*engagedev-admin-delete-question-set/);
  assert.ok([restored, backupDeleted, imageRemoved, setRemoved].every((i) => i !== -1),
    `step 5 did not run in order (restore ${restored}, relay delete ${backupDeleted}, image rm ${imageRemoved}, set delete ${setRemoved}); the stubs saw:\n${r.calls}`);
});
check('a restore that comes back active fails the drill, and removal still runs', () => {
  const r = run('archive-drill.sh', ['engagedev'], 'restored-active');
  exited(r, 1);
  contains(r, 'and inactive there: expected false, got true');
  contains(r, 'drill FAILED on engagedev');
  assert.ok(/^aws lambda invoke .*engagedev-admin-archive-items/m.test(r.calls), `step 5 did not run; the stubs saw:\n${r.calls}`);
});
check('content rows the removal left behind fail the drill, are never called removed, and are named on exit', () => {
  const r = run('archive-drill.sh', ['engagedev'], 'rows-remain');
  exited(r, 1);
  contains(r, 'no content rows are left: expected 0+0, got 0+5');
  lacks(r, 'ok   - the set and its image are removed');
  contains(r, 'LEFT BEHIND - content rows (0+5)');
});

console.log('\n6. the deploy script refuses before it touches anything, and preview leaves the stack alone');
check('the deploy script with no mode prints usage and calls nothing', () => {
  const r = runDeploy([]);
  exited(r, 2);
  contains(r, 'usage:');
  noCalls(r);
});
check('preview runs the pre-flight, shows the change set, and nothing is deployed', () => {
  const r = runDeploy(['preview']);
  exited(r, 0);
  const preflight = callIndex(r, /^aws lambda get-function-configuration /);
  const build = callIndex(r, /^sam build /);
  assert.ok(preflight !== -1 && build !== -1 && preflight < build, `the pre-flight did not run before the build; the stubs saw:\n${r.calls}`);
  assert.ok(deployCall(r, '--no-execute-changeset'), `no sam deploy with --no-execute-changeset; the stubs saw:\n${r.calls}`);
  assert.ok(!deployCall(r, '--no-confirm-changeset'), `preview executed a change set; the stubs saw:\n${r.calls}`);
  contains(r, 'Nothing was deployed');
  // SAM prints change-set actions as `+ Add`, `* Modify` and `- Delete`; the reader is told what not to see in those words.
  contains(r, '- Delete');
  assert.ok(r.configUnchanged, 'preview changed the config');
});
check('lock refuses to deploy when a tier fails the pre-flight', () => {
  const r = runDeploy(['lock'], 'config-error:engagetest-admin-archive-items');
  assert.notStrictEqual(r.status, 0, `exited 0 after a failed pre-flight\n--- output ---\n${r.out}`);
  assert.ok(!/^sam (build|deploy)/m.test(r.calls), `sam was called after a failed pre-flight; the stubs saw:\n${r.calls}`);
});
check('lock refuses uncommitted template changes before calling anything', () => {
  const r = runDeploy(['lock'], '', (repo) => fs.appendFileSync(path.join(repo, 'template-archive.yaml'), '# an uncommitted edit\n'));
  exited(r, 2);
  contains(r, 'Refusing');
  noCalls(r);
});
check('preview refuses uncommitted changes, but unlock only warns', () => {
  const edit = (repo) => fs.appendFileSync(path.join(repo, 'template-archive.yaml'), '# an uncommitted edit\n');
  const preview = runDeploy(['preview'], '', edit);
  exited(preview, 2);
  contains(preview, 'Refusing');
  noCalls(preview);
  // The rollback must not be refused for the sake of a clean tree: it runs when something is already wrong.
  const unlock = runDeploy(['unlock'], '', edit);
  contains(unlock, 'WARNING: deploying uncommitted changes');
  assert.ok(deployCall(unlock, '--no-confirm-changeset'), `unlock did not go on to deploy; the stubs saw:\n${unlock.calls}`);
});

console.log('\n7. lock records the outputs, verifies, and never leaves its state unclear');
check('lock deploys, keeps an unchanged config unchanged, verifies, and points to the drill', () => {
  const r = runDeploy(['lock']);
  exited(r, 0);
  const deploy = deployCall(r, '--no-confirm-changeset');
  assert.ok(deploy, `no executing sam deploy; the stubs saw:\n${r.calls}`);
  assert.ok(deploy.includes('--region us-east-1'), `sam deploy does not pin its region: ${deploy}`);
  const deployed = callIndex(r, /^sam deploy .*--no-confirm-changeset/);
  const routes = callIndex(r, /^aws apigatewayv2 get-routes /);
  assert.ok(routes !== -1 && routes > deployed, `verify did not run after the deploy; the stubs saw:\n${r.calls}`);
  assert.ok(r.configUnchanged, 'an unchanged stack changed the config');
  contains(r, 'Now run: scripts/archive-drill.sh engagedev');
  lacks(r, 'NOTE:');
  lacks(r, 'THE SHARED ARCHIVE IS NOW LOCKED');
});
check('lock never writes a config from outputs it could not read, and says the archive is locked', () => {
  for (const scenario of ['outputs-fail', 'outputs-empty']) {
    const r = runDeploy(['lock'], scenario);
    exited(r, 1);
    assert.ok(r.configUnchanged, `${scenario}: the config was written from outputs the script could not read`);
    for (const text of ['THE SHARED ARCHIVE IS NOW LOCKED', 'was left unchanged', 'scripts/deploy-archive.sh unlock']) contains(r, text);
    assert.ok(!/^aws apigatewayv2 get-routes/m.test(r.calls), `${scenario}: verify ran on a config that was not written; the stubs saw:\n${r.calls}`);
  }
});
check('lock never records a missing table, bucket or domain output', () => {
  const r = runDeploy(['lock'], 'outputs-empty-table');
  exited(r, 1);
  assert.ok(r.configUnchanged, 'the config was written with no table name');
  contains(r, 'was left unchanged');
  assert.ok(!/^aws apigatewayv2 get-routes/m.test(r.calls), `verify ran on a config that was not written; the stubs saw:\n${r.calls}`);
});
check('lock refuses an ArchiveApiUrl that is not an execute-api URL', () => {
  // A request signed for the CloudFront name arrives with a Host it no longer names, so this URL locks every tier out.
  const r = runDeploy(['lock'], 'outputs-wrong-url');
  exited(r, 1);
  assert.ok(r.configUnchanged, 'the config was written with a URL no tier can sign for');
  contains(r, 'is not an execute-api URL');
  assert.ok(!/^aws apigatewayv2 get-routes/m.test(r.calls), `verify ran on a config that was not written; the stubs saw:\n${r.calls}`);
});
check('a config that cannot be moved into place leaves no trace and says the archive is locked', () => {
  const r = runDeploy(['lock'], 'mv-fails');
  exited(r, 1);
  assert.ok(r.configUnchanged, 'a failed move changed the config');
  contains(r, 'THE SHARED ARCHIVE IS NOW LOCKED');
  contains(r, 'could not be moved into place');
  const leftovers = fs.readdirSync(path.join(r.repo, 'config')).filter((name) => name.startsWith('archive-service.json.'));
  assert.deepStrictEqual(leftovers, [], 'a temporary config was left beside the real one');
});
check('a failed verify after lock says the archive is locked and how to unlock it', () => {
  const r = runDeploy(['lock'], 'route-open');
  exited(r, 1);
  for (const text of ['is not locked', 'THE SHARED ARCHIVE IS NOW LOCKED', 'scripts/deploy-archive.sh unlock']) contains(r, text);
});

console.log('\n8. unlock is the rollback, and a failed deploy says where to look');
check('unlock deploys without the pre-flight a rejected signature would fail, and removes only the lock', () => {
  const r = runDeploy(['unlock'], 'config-error:engagedev-admin-archive-items');
  const deployed = callIndex(r, /^sam deploy /);
  const preflight = callIndex(r, /^aws lambda get-function-configuration /);
  assert.ok(deployed !== -1, `unlock did not deploy; the stubs saw:\n${r.calls}`);
  assert.ok(preflight === -1 || deployed < preflight, `the pre-flight ran before the unlock deployed; the stubs saw:\n${r.calls}`);
  const built = path.join(r.repo, '.aws-sam/archive-unlock-build/template.yaml');
  assert.ok(fs.existsSync(built), 'the unlocked template was not built into .aws-sam/archive-unlock-build');
  const text = fs.readFileSync(built, 'utf8');
  for (const s of ['ArchiveApi:', 'Properties: {}', 'ListArchiveFunction']) assert.ok(text.includes(s), `the built template lacks ${JSON.stringify(s)}`);
  assert.ok(!text.includes('DefaultAuthorizer: AWS_IAM'), 'the built template still carries the lock');
  contains(r, 'THE SHARED ARCHIVE IS UNLOCKED');
  // The hint must not chain preview into lock: the change set is there to be read first.
  lacks(r, 'preview && ');
  exited(r, 1); // the pre-flight after the unlock still fails in this scenario
});
check('a failed deploy says where to look, without guessing what the stack did', () => {
  const r = runDeploy(['lock'], 'sam-deploy-fails');
  exited(r, 1);
  // sam deploy can exit non-zero after the change set ran, so the script may not claim a rollback.
  for (const text of ['did not report success', '--region us-east-1', 'continue-update-rollback', 'scripts/deploy-archive.sh unlock']) contains(r, text);
  assert.ok(!/describe-stacks/.test(r.calls), `outputs were read after a failed deploy; the stubs saw:\n${r.calls}`);
});

for (const repo of REPOS) fs.rmSync(repo, { recursive: true, force: true });
fs.rmSync(STUB_DIR, { recursive: true, force: true });
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
