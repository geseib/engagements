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
 * ALL THREE TEMPLATES ARE ENFORCED.
 *
 * template-archive.yaml was only reported while it pinned nodejs18.x, which fails the lint.
 * It moved to nodejs22.x in the archive lock-down
 * (docs/superpowers/specs/2026-09-14-archive-full-fidelity-design.md, amendment A1), so it now
 * has to transform and lint as cleanly as the other two.
 */
const ENFORCED = ['template-clean.yaml', 'template-monitoring.yaml', 'template-archive.yaml'];

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

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
