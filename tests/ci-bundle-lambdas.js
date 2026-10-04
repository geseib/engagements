/**
 * THE BUNDLER CHANGES WHERE THE CODE LIVES, AND NOTHING ELSE — scripts/ci/bundle-lambdas.js
 *
 * The deploy no longer runs `sam build`. The bundler writes
 * .aws-sam/bundled/template.yaml from template-clean.yaml, and that file is
 * what CloudFormation receives. So the rewrite must touch the 119 CodeUri lines
 * and not one other byte: an IAM statement, a route or an environment variable
 * altered on the way would deploy without anyone having written it.
 *
 * The template checks run without esbuild. The bundling checks need
 * scripts/ci/node_modules (npm ci --prefix scripts/ci) and FAIL without it:
 * a skipped check is how the client-s3 leak got through.
 *
 * // rejects: a function the scanner misses (the column-0 comment that once hid
 * //          three), a rewrite that changes any line but CodeUri, a function
 * //          with zero or two CodeUri/Handler lines, a handler file that does
 * //          not exist, an UNBUNDLED name the template lacks, a floating esbuild
 * //          pin; and a bundle that takes a package from OUTSIDE the function's
 * //          folder (the first CI run, 1ce362bf, failed on exactly that: locally
 * //          esbuild had found @aws-sdk/client-s3 in the main checkout's root).
 */
const suiteFinished = require('./helpers/finish-guard');
const fs = require('fs');
const path = require('path');
const {
  readFunctions, rewriteTemplate, handlerFile, bundleOne, UNBUNDLED,
} = require('../scripts/ci/bundle-lambdas.js');
const os = require('os');

const REPO = path.join(__dirname, '..');
const TEXT = fs.readFileSync(path.join(REPO, 'template-clean.yaml'), 'utf8');

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
function throws(fn, pattern, what) {
  try { fn(); } catch (err) {
    if (pattern.test(err.message)) return;
    throw new Error(`${what}: threw "${err.message}", expected ${pattern}`);
  }
  throw new Error(`${what}: did not throw`);
}

const fns = readFunctions(TEXT);
const typeCount = (TEXT.match(/^ {4}Type:\s*AWS::Serverless::Function\s*$/gm) || []).length;

check('finds every AWS::Serverless::Function in template-clean.yaml', () => {
  eq(typeCount > 100, true, 'sanity: the template defines >100 functions');
  eq(fns.length, typeCount, 'functions found vs Type lines');
  eq(new Set(fns.map((f) => f.name)).size, fns.length, 'unique names');
});

check('every handler file exists in its CodeUri folder', () => {
  const missing = fns.filter((f) => !fs.existsSync(path.join(REPO, f.codeUri, handlerFile(f.handler))));
  eq(missing.map((f) => f.name).join(','), '', 'missing handler files');
});

check('the rewrite changes exactly the CodeUri lines, one per function', () => {
  const to = Object.fromEntries(fns.map((f) => [f.name, `fn/${f.name}/`]));
  const before = TEXT.split('\n');
  const after = rewriteTemplate(TEXT, to).split('\n');
  eq(after.length, before.length, 'line count');
  const changed = before.map((l, i) => [l, after[i]]).filter(([a, b]) => a !== b);
  eq(changed.length, fns.length, 'changed lines');
  for (const [a, b] of changed) {
    eq(/^ {6}CodeUri: \S+$/.test(a) && /^ {6}CodeUri: fn\/[A-Za-z0-9]+\/$/.test(b), true, `non-CodeUri change: ${a.trim()} -> ${b.trim()}`);
  }
});

check('the rewrite refuses a function with no bundle location', () => {
  throws(() => rewriteTemplate(TEXT, {}), /no bundle location/, 'empty mapping');
});

const synthetic = (body) => `Resources:\n${body}\nOutputs:\n  X:\n    Value: 1\n`;
const fnBlock = (name, extra = '') => `  ${name}:\n    Type: AWS::Serverless::Function\n    Properties:\n      CodeUri: lambda-functions/game/\n      Handler: a.handler\n${extra}`;

check('a column-0 comment inside Resources does not end it', () => {
  const got = readFunctions(synthetic(`${fnBlock('A')}# a column-0 comment\n${fnBlock('B')}`));
  eq(got.map((f) => f.name).join(','), 'A,B', 'functions');
});

check('non-function resources and nested CodeUri-like keys are ignored', () => {
  const got = readFunctions(synthetic(`  Table:\n    Type: AWS::DynamoDB::Table\n    Properties:\n      CodeUri: not-a-function\n${fnBlock('A')}`));
  eq(got.map((f) => f.name).join(','), 'A', 'functions');
});

check('a function with two CodeUri lines, or none, is an error', () => {
  throws(() => readFunctions(synthetic(fnBlock('A', '      CodeUri: lambda-functions/admin/\n'))), /expected one CodeUri/, 'two');
  throws(() => readFunctions(synthetic('  A:\n    Type: AWS::Serverless::Function\n    Properties:\n      Handler: a.handler\n')), /expected one CodeUri/, 'none');
});

check('handler paths keep their folders', () => {
  eq(handlerFile('orgs/create-org.handler'), 'orgs/create-org.js', 'nested');
  eq(handlerFile('connect.handler'), 'connect.js', 'flat');
});

check('every UNBUNDLED function exists in the template', () => {
  for (const name of UNBUNDLED) eq(fns.some((f) => f.name === name), true, name);
});

check('scripts/ci pins its tools exactly, and the lockfile agrees', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(REPO, 'scripts/ci/package.json'), 'utf8'));
  const lock = JSON.parse(fs.readFileSync(path.join(REPO, 'scripts/ci/package-lock.json'), 'utf8'));
  for (const [name, version] of Object.entries(pkg.dependencies)) {
    eq(/^\d+\.\d+\.\d+$/.test(version), true, `${name} pinned exactly (got ${version})`);
    eq(lock.packages[`node_modules/${name}`].version, version, `${name} lockfile version`);
  }
});

// ── Bundling: only what the function's own folder holds ─────────────────────
async function bundlingChecks() {
  let esbuild;
  try {
    esbuild = require('../scripts/ci/node_modules/esbuild');
  } catch {
    failed += 1;
    console.log('  FAIL  esbuild is not installed: run `npm ci --prefix scripts/ci`');
    return;
  }
  // parent/node_modules stands for the main checkout's root node_modules: it holds
  // packages the function's folder does not, and none of them may be bundled.
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bundle-confine-'));
  const w = (rel, body) => {
    fs.mkdirSync(path.dirname(path.join(tmp, rel)), { recursive: true });
    fs.writeFileSync(path.join(tmp, rel), body);
  };
  const pkg = (rel, name, body) => {
    w(`${rel}/package.json`, JSON.stringify({ name, version: '1.0.0', main: 'index.js' }));
    w(`${rel}/index.js`, body);
  };
  pkg('node_modules/@aws-sdk/client-s3', '@aws-sdk/client-s3', 'module.exports = "LEAKED-S3";');
  pkg('node_modules/left-pad', 'left-pad', 'module.exports = "LEAKED-PAD";');
  pkg('node_modules/debug', 'debug', 'module.exports = "LEAKED-DEBUG";');
  const fn = path.join(tmp, 'fn');
  pkg('fn/node_modules/@aws-sdk/client-dynamodb', '@aws-sdk/client-dynamodb', 'module.exports = "PINNED-DDB";');
  pkg('fn/node_modules/lib', 'lib', 'let d; try { d = require("debug"); } catch (e) { d = null; } module.exports = d;');
  w('fn/ok.js', 'const ddb = require("@aws-sdk/client-dynamodb"); const s3 = require("@aws-sdk/client-s3");'
    + ' const lib = require("lib"); const crypto = require("crypto"); exports.handler = async () => [ddb, typeof s3, lib, typeof crypto];');
  w('fn/bad.js', 'const pad = require("left-pad"); exports.handler = async () => pad;');
  const out = path.join(tmp, 'out');
  try {
    const ok = await bundleOne(esbuild, { entry: path.join(fn, 'ok.js'), root: fn + path.sep, outfile: path.join(out, 'ok.js') });
    const code = fs.readFileSync(path.join(out, 'ok.js'), 'utf8');
    check('a package the folder installs is bundled at the folder\'s version', () => {
      eq(code.includes('PINNED-DDB'), true, 'pinned client-dynamodb in the bundle');
    });
    check('an @aws-sdk package the folder lacks is left to the runtime, never taken from a parent', () => {
      eq(code.includes('LEAKED-S3'), false, 'parent client-s3 bundled');
      eq(ok.external.includes('@aws-sdk/client-s3'), true, 'client-s3 external');
    });
    check('a library\'s optional require stays a runtime require, never taken from a parent', () => {
      eq(code.includes('LEAKED-DEBUG'), false, 'parent debug bundled');
      eq(ok.external.includes('debug'), true, 'debug external');
    });
    check('every bundled input lies inside the folder (a trailing slash on it changes nothing)', () => {
      const realFn = fs.realpathSync(fn);
      const outside = Object.keys(ok.metafile.inputs).map((p) => fs.realpathSync(path.resolve(p)))
        .filter((p) => !p.startsWith(realFn + path.sep));
      eq(outside.join(','), '', 'inputs outside the folder');
    });
    let badErr = '';
    try {
      await bundleOne(esbuild, { entry: path.join(fn, 'bad.js'), root: fn, outfile: path.join(out, 'bad.js') });
    } catch (err) { badErr = err.message; }
    check('our own code importing a package the folder does not install fails the build', () => {
      eq(/"left-pad" is not installed in/.test(badErr), true, `error was: ${badErr.split('\n')[0] || '(none)'}`);
    });
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

bundlingChecks().then(() => {
  suiteFinished();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
});
