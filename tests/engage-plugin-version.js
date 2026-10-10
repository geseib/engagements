/**
 * THE ENGAGE PLUGIN'S VERSION MOVES WITH ITS CODE — src/public/engage-mcp.mjs
 *
 * The Build Room page's one install command compares this file's VERSION with
 * the version Claude Code has installed, and does nothing when they match
 * ("You're all set"). So a change shipped under an unchanged VERSION would
 * never reach a laptop that already has the plugin. Until 2026-10-04 the
 * version sat at 1.1.0 through every change since the plugin was written.
 *
 * This pins the file's fingerprint (with the VERSION line blanked) to the
 * version it shipped as. Change the file and this fails until you bump
 * VERSION and update PIN below to what the failure prints.
 *
 * // rejects: a change to engage-mcp.mjs without a VERSION bump, and a bump
 * //          that does not go up.
 */
const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const PIN = { version: '1.15.0', sha256: 'ed9bb480d3d8f01498e0a851327a5d0d66b231a0150a6bc0ef630f8b9faa9b2e' };

const text = fs.readFileSync(path.join(__dirname, '..', 'src', 'public', 'engage-mcp.mjs'), 'utf8');
const version = (text.match(/const VERSION = '([^']+)';/) || [])[1];
const sha256 = crypto.createHash('sha256').update(text.replace(/const VERSION = '[^']+';/, "const VERSION = '<v>';")).digest('hex');
const newer = (a, b) => {
  const x = a.split('.').map(Number); const y = b.split('.').map(Number);
  for (let i = 0; i < 3; i += 1) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0);
  return false;
};

let failed = 0;
const check = (name, fn) => {
  try { fn(); console.log(`  PASS  ${name}`); } catch (e) { failed += 1; console.log(`  FAIL  ${name}\n        ${e.message}`); }
};
check('engage-mcp.mjs declares a semver VERSION', () => {
  assert.ok(/^\d+\.\d+\.\d+$/.test(version || ''), `VERSION is ${JSON.stringify(version)}`);
});
check('the code and its version move together', () => {
  if (sha256 === PIN.sha256) {
    assert.strictEqual(version, PIN.version, `only VERSION changed (${PIN.version} -> ${version}); set PIN.version to '${version}'`);
    return;
  }
  assert.ok(version !== PIN.version, `engage-mcp.mjs changed but VERSION is still ${version}. Bump VERSION, then set PIN to { version: '<new>', sha256: '${sha256}' }`);
  assert.ok(newer(version, PIN.version), `VERSION must go up from ${PIN.version}, not to ${version}`);
  assert.fail(`VERSION is bumped to ${version}; now set PIN to { version: '${version}', sha256: '${sha256}' }`);
});
// ---- The server knows the current version (copy pass 2026-10-10) -----------
// build-store.js's LATEST_PLUGIN is what the host's Session panel and Claude's
// tool replies compare the running plugin with. It must be the plugin's own
// VERSION, so the two move together: bump both or neither.
check('the server\'s LATEST_PLUGIN is this file\'s VERSION', () => {
  const store = require('../lambda-functions/game/build-store');
  assert.strictEqual(store.LATEST_PLUGIN, version, `build-store.js LATEST_PLUGIN is ${store.LATEST_PLUGIN} but engage-mcp.mjs VERSION is ${version}; move them together`);
});

check('the plugin sends its version on every Engage call, and a browser never does', () => {
  assert.ok(/'X-Engage-Plugin': VERSION/.test(text), 'engage-mcp.mjs api() must send X-Engage-Plugin: VERSION');
  const calls = (text.match(/\bfetch\(/g) || []).length;
  // Two fetches: the Engage API call, and the local gateway probe (localhost, not Engage).
  assert.ok(calls >= 1);
  // The browser app (host page, phones) must never carry it: a custom header there needs a CORS allow-list entry.
  const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => (d.isDirectory() ? (d.name === 'node_modules' ? [] : walk(path.join(dir, d.name))) : [path.join(dir, d.name)]));
  const offenders = walk(path.join(__dirname, '..', 'src', 'src')).filter((f) => /\.(jsx?|mjs)$/.test(f) && !f.includes('__tests__') && /X-Engage-Plugin/i.test(fs.readFileSync(f, 'utf8')));
  assert.deepStrictEqual(offenders, [], `a browser file sends X-Engage-Plugin: ${offenders.join(', ')}`);
});

console.log(failed ? `\n${failed} failed` : '\nall passed, 0 failed');
process.exit(failed ? 1 : 0);
