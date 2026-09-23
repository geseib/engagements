/**
 * A SUITE THAT NEVER REACHES ITS END MUST NOT READ AS GREEN.
 *
 * ── WHAT THIS EXISTS TO PREVENT ────────────────────────────────────────────
 *
 * The backend gate is `for f in tests/*.js; do node "$f" || echo FAIL $f; done`
 * and it judges by exit code alone. Most suites are an async IIFE that ends in
 * `process.exit(fail ? 1 : 0)`. If one awaited promise never settles, Node does
 * not hang — the event loop empties and the process exits 0 without printing
 * its summary. On 2026-09-23 tests/name-handover.js printed four FAIL lines and
 * exited 0 that way: a race test awaited `table.hold(...).reached` for an
 * update the handler never sent, because a new guard had already answered 404.
 *
 * tests/helpers/finish-guard.js closes that hole with a 'beforeExit' hook, which
 * fires only when the loop empties by itself. This file proves the hook does
 * what it says, in real child processes, and that every async suite reaches it
 * — directly, or through a harness whose summary()/finish() marks it.
 *
 * // rejects: a finish guard that lets a stalled suite exit 0, or that fails a
 * //          suite which did finish and simply let the loop drain.
 * // rejects: a new async suite (or harness) that never arms the guard.
 */
const suiteFinished = require('./helpers/finish-guard');
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { spawnSync } = require('child_process');

const TESTS = __dirname;
const GUARD = path.join(TESTS, 'helpers', 'finish-guard.js');
const PLAYER_TABLE = path.join(TESTS, 'helpers', 'player-table.js');
const HARNESSES = ['archive-harness', 'moderation-harness', 'generation-job-harness'];

let pass = 0; let fail = 0;
const check = (label, fn) => {
  try { fn(); console.log(`  ok   - ${label}`); pass += 1; } catch (e) {
    console.log(`  FAIL - ${label}\n         ${e.message}`); fail += 1;
  }
};

/** Run `body` as its own node process with the guard required as `suiteFinished`. */
function runChild(body) {
  const script = `const suiteFinished = require(${JSON.stringify(GUARD)});\n${body}`;
  const out = spawnSync(process.execPath, ['-e', script], { encoding: 'utf8', timeout: 30000 });
  if (out.error) throw out.error;
  return out;
}

console.log('\n1. the guard, in real processes');

check('an await that never settles exits 1, not 0', () => {
  const out = runChild(`
    (async () => {
      await new Promise(() => {});
      suiteFinished();
      process.exit(0);
    })();`);
  assert.strictEqual(out.status, 1, `exit ${out.status}; stderr: ${out.stderr}`);
  assert.match(out.stderr, /SUITE DID NOT FINISH/);
});

check('the reason still gets out when the suite has muted console.log and stdout', () => {
  const out = runChild(`
    console.log = () => {};
    process.stdout.write = () => true;
    (async () => { await new Promise(() => {}); suiteFinished(); process.exit(0); })();`);
  assert.strictEqual(out.status, 1);
  assert.match(out.stderr, /SUITE DID NOT FINISH/);
});

check('the 2026-09-23 shape: awaiting hold().reached for a command never sent exits 1', () => {
  const out = runChild(`
    const { createTable } = require(${JSON.stringify(PLAYER_TABLE)});
    (async () => {
      const table = createTable();
      const latch = table.hold((command) => command.type === 'update');
      // The handler answers early — it reads, then returns 404 without updating.
      await table.doc.send({ type: 'get', input: { Key: { PK: 'GAME#1', SK: 'METADATA' } } });
      await latch.reached;
      suiteFinished();
      process.exit(0);
    })();`);
  assert.strictEqual(out.status, 1, `exit ${out.status}; stderr: ${out.stderr}`);
  assert.match(out.stderr, /SUITE DID NOT FINISH/);
});

check('a suite that finished and lets the loop drain (`if (fail) process.exit(1)`) exits 0, silently', () => {
  const out = runChild(`
    (async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      const fail = 0;
      suiteFinished();
      if (fail) process.exit(1);
    })();`);
  assert.strictEqual(out.status, 0, `exit ${out.status}; stderr: ${out.stderr}`);
  assert.strictEqual(out.stderr, '');
});

check('a finished suite with failures keeps its own exit code and gets no guard message', () => {
  const out = runChild(`
    (async () => { await Promise.resolve(); suiteFinished(); process.exit(1); })();`);
  assert.strictEqual(out.status, 1);
  assert.doesNotMatch(out.stderr, /SUITE DID NOT FINISH/);
});

console.log('\n2. every async suite reaches the guard');

const suites = fs.readdirSync(TESTS)
  .filter((f) => f.endsWith('.js') && !f.endsWith('.spec.js'))
  .map((f) => ({ file: f, src: fs.readFileSync(path.join(TESTS, f), 'utf8') }))
  // An await is what can stall; a suite with none runs straight to its exit.
  .filter(({ src }) => /\bawait\b/.test(src));

function howGuarded({ src }) {
  const direct = src.match(/const\s+(\w+)\s*=\s*require\(['"]\.\/helpers\/finish-guard['"]\)/);
  if (direct) {
    return new RegExp(`\\b${direct[1]}\\(\\);`).test(src) ? 'direct' : 'required but never called';
  }
  const harness = HARNESSES.find((h) => new RegExp(`require\\(['"]\\./helpers/${h}['"]\\)`).test(src));
  if (harness) {
    return /\b(summary|finish)\(\);/.test(src) ? 'harness' : `uses ${harness} but never calls its summary()/finish()`;
  }
  return 'not guarded';
}

check('the scan sees the async suites (a scan that finds none passes vacuously)', () => {
  assert.ok(suites.length > 100, `only ${suites.length} async suites found — the filter has rotted`);
  const byName = Object.fromEntries(suites.map((s) => [s.file, howGuarded(s)]));
  assert.strictEqual(byName['name-handover.js'], 'direct');
  assert.strictEqual(byName['moderation-decide.js'], 'harness');
  assert.strictEqual(byName['archive-restore.js'], 'harness');
});

check('every async suite arms the guard and marks it done', () => {
  const bad = suites
    .map((s) => ({ file: s.file, how: howGuarded(s) }))
    .filter(({ how }) => how !== 'direct' && how !== 'harness');
  assert.deepStrictEqual(bad, [],
    'these suites can stall and still exit 0 — add ' +
    "`const suiteFinished = require('./helpers/finish-guard');` at the top and " +
    '`suiteFinished();` just before the final process.exit / summary');
});

check("each harness marks the guard at the start of its own summary()/finish()", () => {
  const ends = {
    'archive-harness': /\bfinish\(\)\s*\{\s*suiteFinished\(\);/,
    'moderation-harness': /function summary\(\)\s*\{\s*suiteFinished\(\);/,
    'generation-job-harness': /function summary\(\)\s*\{\s*suiteFinished\(\);/,
  };
  for (const h of HARNESSES) {
    const src = fs.readFileSync(path.join(TESTS, 'helpers', `${h}.js`), 'utf8');
    assert.match(src, /const suiteFinished = require\('\.\/finish-guard'\);/, `${h} does not require the guard`);
    assert.match(src, ends[h], `${h}'s end function does not mark the guard`);
  }
});

console.log(`\n${pass} passed, ${fail} failed`);
suiteFinished();
process.exit(fail ? 1 : 0);
