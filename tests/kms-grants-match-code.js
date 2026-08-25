/**
 * DOES EVERY FUNCTION THAT ENCRYPTS ACTUALLY HAVE A KEY?
 *
 * The set of Lambdas that touch tenant content is not a list anybody maintains —
 * it is a consequence of which modules `require` which. `game/get-results.js`
 * pulling in `tenant-crypto` is obvious; `AdminAIGenerateTriviaFunction` needing
 * `kms:Decrypt` because its worker calls `upload-questions` five requires deep
 * is not, and neither is `StartVoteFunction`. Enumerating them by hand missed
 * six of thirty-two on the first pass.
 *
 * So this walks the require graph from each function's real entry point and
 * insists the template agrees with it. It is the only check that keeps working
 * when somebody adds encryption to a handler months from now.
 *
 * THE FAILURE IS A PRODUCTION-ONLY 500. Everything passes locally — the tests
 * stub KMS — and the handler throws `AccessDeniedException` the first time a
 * real tenant uses it. Nothing else in the suite can see that.
 *
 * rejects: a handler acquiring tenant-crypto without its IAM; a KMS grant
 * widened past this one key; GenerateDataKey spreading beyond the two paths
 * that mint an org's key.
 */
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const REPO = path.join(__dirname, '..');
const template = fs.readFileSync(path.join(REPO, 'template-clean.yaml'), 'utf8');

let pass = 0, fail = 0;
function check(label, fn) {
  try { fn(); console.log(`  ok - ${label}`); pass++; }
  catch (e) { console.log(`  FAIL - ${label}\n    ${e.message}`); fail++; }
}

/** Transitive local requires of one file. Relative paths only — a bare package
 *  name is a dependency, not our code, and cannot pull in tenant-crypto. */
const REQ = /require\(\s*'(\.[^']+)'\s*\)/g;
function deps(file, seen = new Set()) {
  const p = path.normalize(file);
  if (seen.has(p) || !fs.existsSync(p)) return seen;
  seen.add(p);
  let src;
  try { src = fs.readFileSync(p, 'utf8'); } catch { return seen; }
  for (const m of src.matchAll(REQ)) {
    const base = path.normalize(path.join(path.dirname(p), m[1]));
    for (const c of [base, `${base}.js`, path.join(base, 'index.js')]) {
      if (c.endsWith('.js') && fs.existsSync(c)) { deps(c, seen); break; }
    }
  }
  return seen;
}

/** Every `Name: { CodeUri, Handler, block }` in the template. */
function functions() {
  const out = [];
  const lines = template.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const m = /^ {2}([A-Za-z][A-Za-z0-9]*):\s*$/.exec(lines[i]);
    if (!m) continue;
    let end = i + 1;
    while (end < lines.length && !/^ {2}[A-Za-z][A-Za-z0-9]*:\s*$/.test(lines[end])) end++;
    const body = lines.slice(i, end).join('\n');
    if (!/Type:\s*AWS::Serverless::Function/.test(body)) continue;
    const uri = (/CodeUri:\s*(\S+)/.exec(body) || [])[1];
    const handler = (/Handler:\s*(\S+)/.exec(body) || [])[1];
    if (uri && handler && handler.includes('.')) {
      out.push({ name: m[1], uri: uri.replace(/\/$/, ''), handler, body });
    }
  }
  return out;
}

const fns = functions();

console.log('\n1. the scanner found the functions at all');
check('a plausible number of Serverless functions', () =>
  assert.ok(fns.length > 60, `found only ${fns.length}`));
check('their entry files exist on disk', () => {
  const missing = fns.filter((f) =>
    !fs.existsSync(path.join(REPO, f.uri, `${f.handler.replace(/\.[^.]+$/, '')}.js`)));
  assert.deepStrictEqual(missing.map((f) => f.name), [],
    'a CodeUri/Handler pair points at no file — the scan below is blind to it');
});

console.log('\n2. every function that reaches tenant-crypto has kms:Decrypt');
const MINT_PATHS = ['create-org.js', 'personal-org.js'];
const needsKms = [];
for (const f of fns) {
  const entry = path.join(REPO, f.uri, `${f.handler.replace(/\.[^.]+$/, '')}.js`);
  const tree = [...deps(entry)];
  if (!tree.some((t) => t.endsWith('tenant-crypto.js'))) continue;
  const mints = tree.some((t) => MINT_PATHS.some((m) => t.endsWith(m)));
  needsKms.push({ ...f, mints });
}
check('the graph walk finds a substantial set (guards this check)', () =>
  assert.ok(needsKms.length > 20,
    `only ${needsKms.length} functions reach tenant-crypto — the require walk is broken, `
    + 'and every assertion below would pass vacuously'));

for (const f of needsKms) {
  check(`${f.name} may decrypt`, () =>
    assert.ok(/kms:Decrypt/.test(f.body),
      'it reaches tenant-crypto but has no kms:Decrypt — it will throw '
      + 'AccessDeniedException the first time a real tenant uses it, and nothing '
      + 'in the local suite can see that because KMS is stubbed'));
}

console.log('\n3. only the org-creating paths may MINT a key');
for (const f of needsKms) {
  if (f.mints) {
    check(`${f.name} may mint (it creates organisations)`, () =>
      assert.ok(/kms:GenerateDataKey/.test(f.body),
        'it creates an org but cannot mint its data key, so every set and '
        + 'session in that org fails to encrypt'));
  } else {
    check(`${f.name} may NOT mint`, () =>
      assert.ok(!/kms:GenerateDataKey/.test(f.body),
        'GenerateDataKey has spread beyond org creation'));
  }
}

console.log('\n4. no grant is wider than the one key');
for (const f of needsKms) {
  check(`${f.name} names the key by ARN`, () => {
    const stmt = f.body.slice(f.body.indexOf('kms:Decrypt'));
    assert.ok(/Resource:\s*!GetAtt TenantKey\.Arn/.test(stmt),
      'the KMS grant does not name TenantKey — a wildcard here would let this '
      + 'function decrypt with any key in the account');
  });
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
