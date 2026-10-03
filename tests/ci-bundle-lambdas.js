/**
 * THE BUNDLER CHANGES WHERE THE CODE LIVES, AND NOTHING ELSE — scripts/ci/bundle-lambdas.js
 *
 * The deploy no longer runs `sam build`. The bundler writes
 * .aws-sam/bundled/template.yaml from template-clean.yaml, and that file is
 * what CloudFormation receives. So the rewrite must touch the 119 CodeUri lines
 * and not one other byte: an IAM statement, a route or an environment variable
 * altered on the way would deploy without anyone having written it.
 *
 * Runs without esbuild or the network; the full bundle is exercised by
 * `node scripts/ci/bundle-lambdas.js` (see its header).
 *
 * // rejects: a function the scanner misses (the column-0 comment that once hid
 * //          three), a rewrite that changes any line but CodeUri, a function
 * //          with zero or two CodeUri/Handler lines, a handler file that does
 * //          not exist, an UNBUNDLED name the template lacks, a runtime-SDK
 * //          folder that has grown a package.json, and a floating esbuild pin.
 */
const fs = require('fs');
const path = require('path');
const {
  readFunctions, rewriteTemplate, handlerFile, UNBUNDLED, RUNTIME_SDK_FOLDERS,
} = require('../scripts/ci/bundle-lambdas.js');

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

check('runtime-SDK folders still have no package.json (else their SDK must be bundled)', () => {
  for (const folder of RUNTIME_SDK_FOLDERS) {
    eq(fs.existsSync(path.join(REPO, folder, 'package.json')), false, `${folder}package.json`);
    eq(fns.some((f) => f.codeUri === folder), true, `${folder} is used by a function`);
  }
});

check('every other CodeUri folder has a package.json (its SDK is bundled from it)', () => {
  const others = [...new Set(fns.map((f) => f.codeUri))].filter((c) => !RUNTIME_SDK_FOLDERS.has(c));
  for (const folder of others) eq(fs.existsSync(path.join(REPO, folder, 'package.json')), true, `${folder}package.json`);
});

check('scripts/ci pins its tools exactly, and the lockfile agrees', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(REPO, 'scripts/ci/package.json'), 'utf8'));
  const lock = JSON.parse(fs.readFileSync(path.join(REPO, 'scripts/ci/package-lock.json'), 'utf8'));
  for (const [name, version] of Object.entries(pkg.dependencies)) {
    eq(/^\d+\.\d+\.\d+$/.test(version), true, `${name} pinned exactly (got ${version})`);
    eq(lock.packages[`node_modules/${name}`].version, version, `${name} lockfile version`);
  }
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
