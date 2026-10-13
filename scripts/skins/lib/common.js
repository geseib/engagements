/**
 * Shared plumbing for scripts/skins/*: paths, file walks, argv, self-test runner.
 * Node 18-safe (no Object.groupBy, no toSorted), no dependencies.
 */
const fs = require('fs');
const path = require('path');

const REPO = path.resolve(__dirname, '..', '..', '..');
const SRC = path.join(REPO, 'src', 'src');
const TESTS = path.join(SRC, '__tests__');

function walk(dir, pred, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === 'node_modules' || e.name === 'dist') continue;
      walk(p, pred, out);
    } else if (pred(p)) out.push(p);
  }
  return out;
}

/** Every stylesheet under src/src, as paths relative to src/src, sorted. */
function cssFiles(root = SRC) {
  return walk(root, (p) => p.endsWith('.css')).map((p) => path.relative(root, p)).sort();
}

/** Every .js/.jsx under src/src outside __tests__ and testing/, relative, sorted. */
function jsxFiles(root = SRC) {
  return walk(root, (p) => /\.(jsx?|mjs)$/.test(p))
    .map((p) => path.relative(root, p))
    .filter((p) => !p.split(path.sep).includes('__tests__') && !p.startsWith(`testing${path.sep}`))
    .sort();
}

/** Skin values files are exempt from the literal gate (they ARE the values). */
function isSkinValuesFile(rel) {
  return rel.split(path.sep).join('/').startsWith('styles/skins/');
}

let testCache = null;
function testTexts(root = SRC) {
  if (testCache && testCache.root === root) return testCache.list;
  const dir = path.join(root, '__tests__');
  const list = fs.existsSync(dir)
    ? fs.readdirSync(dir).filter((f) => /\.(js|jsx)$/.test(f)).map((f) => ({ f, t: fs.readFileSync(path.join(dir, f), 'utf8') }))
    : [];
  testCache = { root, list };
  return list;
}

/** Tests that name this stylesheet by basename (how INVENTORY counted them). */
function testsNaming(rel, root = SRC) {
  const base = path.basename(rel).replace(/\./g, '\\.');
  const re = new RegExp(`(^|[^\\w.-])${base}`);
  const hits = testTexts(root).filter((x) => re.test(x.t)).map((x) => x.f).sort();
  return {
    cssTests: hits,
    paletteTests: hits.filter((f) => /Palette\.test\.js$/.test(f)).map((f) => f.replace(/\.test\.js$/, '')),
  };
}

/** Minimal argv: --flag, --key value, --key=value; positional in _. */
function args(argv = process.argv.slice(2)) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (!a.startsWith('--')) { out._.push(a); continue; }
    const eq = a.indexOf('=');
    if (eq > 0) { out[a.slice(2, eq)] = a.slice(eq + 1); continue; }
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith('--')) { out[key] = next; i += 1; } else out[key] = true;
  }
  return out;
}

/** Normalise a user-supplied stylesheet path to "relative to src/src". */
function relCss(p, root = SRC) {
  const abs = path.isAbsolute(p) ? p : (fs.existsSync(path.resolve(p)) ? path.resolve(p) : path.join(root, p));
  return path.relative(root, abs);
}

/**
 * Self-test runner: each case is [name, fn]; fn throws to fail. Exits 0 when all pass.
 * Tools run their self-test on fixtures under scripts/skins/fixtures/, and each one
 * includes a PLANTED failure that must be detected — a self-test that cannot fail
 * proves nothing.
 */
function selftest(tool, cases) {
  let failed = 0;
  for (const [name, fn] of cases) {
    try { fn(); console.log(`  ok   ${name}`); } catch (e) { failed += 1; console.log(`  FAIL ${name}\n       ${e.message}`); }
  }
  console.log(`${tool} self-test: ${cases.length - failed}/${cases.length} passed`);
  process.exit(failed ? 1 : 0);
}

function assert(cond, msg) { if (!cond) throw new Error(msg); }

function tmpDir(prefix) {
  const os = require('os');
  return fs.mkdtempSync(path.join(os.tmpdir(), `skins-${prefix}-`));
}

module.exports = {
  REPO, SRC, TESTS, walk, cssFiles, jsxFiles, isSkinValuesFile, testsNaming, testTexts,
  args, relCss, selftest, assert, tmpDir,
};
