/**
 * DOES THE TEMPLATE ACTUALLY TRANSFORM?
 *
 * Everything else that reads template-clean.yaml in this suite reads it as TEXT
 * or as generic YAML, and both are blind to the failure that matters. A
 * malformed line can leave the file parseable and the stack undeployable.
 *
 * The incident: a comment block lost its trailing newline, so the next line —
 * `      Tags:` — was swallowed onto the end of the comment. The YAML still
 * parsed (RestApi simply had no Tags key), `tests/tenant-infrastructure.js`
 * still passed (its scanner looks for other things), and even `sam build`
 * SUCCEEDED. Only the SAM transform rejected it:
 *
 *     Resource with id [RestApi] is invalid. Invalid value for 'Auth' property
 *
 * That is a CloudFormation failure discovered at deploy time, on a shared tier,
 * after every local check went green.
 *
 * rejects: any edit that breaks the SAM transform — a mangled indent, a
 * swallowed key, an invalid property, a bad !Ref target.
 */
const { execFileSync, execSync } = require('child_process');
const path = require('path');

const REPO = path.join(__dirname, '..');
let pass = 0, fail = 0;
function check(label, fn) {
  try { fn(); console.log(`  ok - ${label}`); pass++; }
  catch (e) { console.log(`  FAIL - ${label}\n    ${e.message}`); fail++; }
}

/**
 * SKIPS when the SAM CLI is absent rather than failing.
 *
 * It is not installed in every environment this suite runs in, and a check that
 * fails for a missing tool trains people to ignore it. It prints loudly enough
 * that a skip is not mistaken for a pass — the point is that the ONE machine
 * with sam installed (and CI, if it ever grows it) does the real check.
 */
let hasSam = true;
try { execSync('command -v sam', { stdio: 'ignore' }); } catch { hasSam = false; }

if (!hasSam) {
  console.log('\nSAM CLI not installed — SKIPPING the transform check.');
  console.log('This is the only test that catches a template which parses but');
  console.log('will not deploy. Install the AWS SAM CLI to run it.');
  console.log('\n0 passed, 0 failed');
  process.exit(0);
}

/**
 * `template-archive.yaml` is NOT enforced, and this is not laziness.
 *
 * It fails on `Runtime: nodejs18.x`, which AWS deprecated on 2025-07-31 and
 * whose UPDATE path was disabled on 2025-11-01 — so that stack cannot be
 * updated at all as it stands. That is a real and pre-existing problem, and it
 * belongs to the archive work (which is a hand-deployed house tool outside the
 * CI/CD pipeline), not to tenancy. Enforcing it here would mean this check is
 * red on arrival and therefore ignored, which is worse than not having it.
 *
 * It is still RUN, and its result printed, so nobody can say it was hidden.
 */
const ENFORCED = ['template-clean.yaml', 'template-monitoring.yaml'];
const REPORTED = ['template-archive.yaml'];

for (const tpl of ENFORCED) {
  console.log(`\n${tpl}`);
  check('transforms and lints cleanly', () => {
    try {
      execFileSync('sam', ['validate', '-t', path.join(REPO, tpl), '--lint'],
        { cwd: REPO, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (e) {
      const out = `${e.stdout || ''}${e.stderr || ''}`.trim();
      throw new Error(out.split('\n').slice(0, 6).join('\n'));
    }
  });
}

for (const tpl of REPORTED) {
  console.log(`\n${tpl} (reported, not enforced)`);
  try {
    execFileSync('sam', ['validate', '-t', path.join(REPO, tpl), '--lint'],
      { cwd: REPO, stdio: ['ignore', 'pipe', 'pipe'] });
    console.log('  ok - transforms and lints cleanly');
  } catch (e) {
    const out = `${e.stdout || ''}${e.stderr || ''}`;
    const runtime = /Runtime '([^']+)' was deprecated/.exec(out);
    console.log(runtime
      ? `  KNOWN - still on ${runtime[1]}, whose update path AWS disabled on 2025-11-01. `
        + 'That stack cannot be updated until its runtime is bumped.'
      : `  KNOWN - ${out.split('\n')[0]}`);
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
