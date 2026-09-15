/**
 * THE ARCHIVE SCRIPTS, RUN — against a stubbed aws and curl, so their failure paths are
 * exercised without touching AWS or the network.
 *
 * scripts/archive-access-check.sh and scripts/archive-drill.sh are the proof, before and after
 * the archive is locked, that no tier is cut off and no route is left open. Their happy paths
 * run live; their failure paths cannot, so this suite puts an `aws` and a `curl` of its own
 * first on PATH and drives both scripts through the failures that matter: a route left open,
 * an archive that does not answer, a simulation call that fails, a function that cannot be
 * read, an export call that fails, and a removal that cannot finish. It also runs one whole
 * drill through restore and removal, and one whose restore comes back active, because a check
 * that can never pass live looks exactly like a check that has not been reached. Each run is
 * judged by its exit status, its combined output, and the calls the stubs logged.
 *
 * STUB_SCENARIO (comma-separated) selects the failures a stub injects; STUB_LOG collects one
 * line per call, the program name and its arguments; STUB_STATE is a fresh directory per run
 * where the aws stub keeps the set id it was given and the markers (restored, set-removed,
 * media-removed) that let a whole drill answer in sequence. The stubs are node scripts written
 * from the two functions below, so they are real code here and self-contained there.
 *
 * // rejects: verify passing with a route that does not require AWS_IAM; a curl or simulation
 * //          failure that ends the run without a summary; an expired token reported as a
 * //          missing deploy; the drill reading a stale reply as a failed call's answer; a
 * //          removal that leaves something behind without naming it; a drill whose inactive
 * //          check cannot pass, or that calls a set removed without looking at its rows.
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

/** `aws`, answering exactly the calls the two scripts make. Anything else is a loud failure. */
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
    case 'cloudformation describe-stack-resources':
      say(option('--stack-name'));
      break;
    case 'dynamodb get-item':
      // With --query it is step 3 asking whether the set is gone; without, step 4 reading the row.
      if (argv.includes('--query')) say('None');
      else say(JSON.stringify({ Item: { SK: { S: `SET#${savedSetId()}` }, activeVersion: { N: '1' }, active: { BOOL: has('restored-active') } } }));
      break;
    case 'dynamodb query': {
      if (!argv.includes('COUNT')) unexpected();
      const partition = String((JSON.parse(option('--expression-attribute-values'))[':pk'] || {}).S || '');
      say(partition.endsWith('#v1') && marked('restored') && !marked('set-removed') ? '5' : '0');
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

const STUB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'archive-scripts-'));
for (const [name, fn] of [['aws', awsStub], ['curl', curlStub]]) {
  fs.writeFileSync(path.join(STUB_DIR, name), `#!/usr/bin/env node\n'use strict';\n(${fn.toString()})();\n`, { mode: 0o755 });
}

// ── Running a script ────────────────────────────────────────────────────────

let runs = 0;
/** One run of a script with the stubs first on PATH. Returns its status, combined output and the stub log. */
function run(script, args, scenario = '') {
  runs += 1;
  const log = path.join(STUB_DIR, `calls-${runs}.log`);
  const state = path.join(STUB_DIR, `state-${runs}`); // fresh per run, so no marker survives into the next
  fs.mkdirSync(state);
  const env = { ...process.env, PATH: `${STUB_DIR}:${process.env.PATH || ''}`, STUB_SCENARIO: scenario, STUB_LOG: log, STUB_STATE: state };
  const r = spawnSync('bash', [path.join('scripts', script), ...args], { cwd: REPO, env, encoding: 'utf8', timeout: 60000 });
  if (r.error) throw r.error;
  return {
    status: r.status,
    out: `${r.stdout || ''}${r.stderr || ''}`,
    calls: fs.existsSync(log) ? fs.readFileSync(log, 'utf8') : '',
  };
}

const TIERS = ['engagedev', 'engagetest'];
const exited = (r, status) => assert.strictEqual(r.status, status, `exited ${r.status}, not ${status}\n--- output ---\n${r.out}`);
const contains = (r, text) => assert.ok(r.out.includes(text), `the output lacks ${JSON.stringify(text)}\n--- output ---\n${r.out}`);
const lacks = (r, text) => assert.ok(!r.out.includes(text), `the output contains ${JSON.stringify(text)}\n--- output ---\n${r.out}`);
const noCalls = (r) => assert.strictEqual(r.calls, '', `the stubs were called:\n${r.calls}`);

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

fs.rmSync(STUB_DIR, { recursive: true, force: true });
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
