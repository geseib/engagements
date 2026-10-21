/**
 * ON THIS NETWORK OR ELSEWHERE (plugin 1.24.2, owner 21 Oct 2026: "i cant tell
 * who is connect local vs remote"). With remote share on, everyone opens the
 * demo through Cloudflare, so the route no longer says who is in the room. The
 * plugin compares each visitor's public address (Cloudflare's
 * cf-connecting-ip) with the laptop's own: IPv4 whole, IPv6 by its first 64
 * bits, the part every device on one Wi-Fi shares.
 *
 * The pure rules, run in a child: importing the plugin starts its MCP loop,
 * which ends when stdin closes.
 *
 * // rejects: an IPv6 phone on the room's Wi-Fi read as elsewhere because its
 * //          own interface bits differ; any match while the laptop does not
 * //          know its own address.
 */
const suiteFinished = require('./helpers/finish-guard');
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const SCRIPT = path.join(__dirname, '..', 'src', 'public', 'engage-mcp.mjs');
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'near-'));
const probe = `
const m = await import(${JSON.stringify(SCRIPT)});
const self = { v4: '203.0.113.7', v6: '2001:db8:aa:1' };
const out = {
  v6: ['2001:db8:aa:1:1c2b:3d4e:5f60:7a8b', '2001:0db8:00aa:0001::5', '[2001:db8:aa:1::9]', 'fe80::1%en0', '2001:db8::', 'not-an-ip', '203.0.113.7'].map(m.v6Network),
  near: [
    ['203.0.113.7', self], ['203.0.113.8', self],
    ['2001:db8:aa:1:dead:beef:0:1', self], ['2001:db8:aa:2::1', self],
    ['::ffff:203.0.113.7', self], ['', self], ['203.0.113.7', { v4: '', v6: '' }], ['2001:db8:aa:1::1', { v4: '203.0.113.7', v6: '' }],
  ].map(([ip, s]) => m.nearAddress(ip, s)),
};
process.stdout.write('RESULT ' + JSON.stringify(out) + '\\n');
process.exit(0);
`;

let pass = 0; let fail = 0;
function check(label, fn) {
  try { fn(); pass += 1; console.log(`  PASS  ${label}`); } catch (e) { fail += 1; console.log(`  FAIL  ${label}\n        ${e.message}`); }
}

const r = spawnSync(process.execPath, ['--input-type=module', '-e', probe], {
  env: { PATH: process.env.PATH, HOME: home }, stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8', timeout: 20000,
});
const line = (r.stdout || '').split('\n').find((l) => l.startsWith('RESULT '));
console.log('\non this network or elsewhere (1.24.2)');
check('the plugin loads and answers', () => assert.ok(line, `no result: ${r.stderr}`));
const got = line ? JSON.parse(line.slice(7)) : { v6: [], near: [] };
check('IPv6: the network part, however it is written; not an IPv6 address gives nothing', () => {
  assert.deepStrictEqual(got.v6, ['2001:db8:aa:1', '2001:db8:aa:1', '2001:db8:aa:1', 'fe80:0:0:0', '2001:db8:0:0', '', '']);
});
check('IPv4 whole; IPv6 by network; a mapped IPv4 as IPv4; nothing matches an empty address or an unknown laptop', () => {
  assert.deepStrictEqual(got.near, [true, false, true, false, true, false, false, false]);
});

fs.rmSync(home, { recursive: true, force: true });
console.log(`\n${pass} passed, ${fail} failed`);
suiteFinished();
process.exit(fail ? 1 : 0);
