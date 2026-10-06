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

const PIN = { version: '1.8.0', sha256: 'd31dbf8a2609cb5bcf1f826e8871b6d53e3f07420fb1039ec87056792a2dfbfc' };

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
console.log(failed ? `\n${failed} failed` : '\n2 passed, 0 failed');
process.exit(failed ? 1 : 0);
