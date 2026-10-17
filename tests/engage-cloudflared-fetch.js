/**
 * BUILD ROOM REMOTE SHARE — getting and running cloudflared, inside the real
 * plugin (src/public/engage-mcp.mjs). Plan
 * docs/superpowers/plans/2026-10-16-build-room-remote-share.md Task 5;
 * findings docs/design/build-room-remote-share/SPIKE.md.
 *
 * No network: a local server stands in for GitHub's release download and for
 * Cloudflare's public DNS, and the "cloudflared" it serves is a small shell
 * script that runs a stand-in (FAKE_SOURCE below) through a link named
 * fake-cloudflared, so `ps` names it the way the orphan check expects. The
 * stand-in's behaviour comes from a file the test rewrites: ok (prints an
 * address and forwards like a tunnel), 429 (refused), silent (never prints).
 */
const suiteFinished = require('./helpers/finish-guard');
const assert = require('assert');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');

const SCRIPT = path.join(__dirname, '..', 'src', 'public', 'engage-mcp.mjs');
const KEY = `eng_4821_${'k'.repeat(43)}`;
let pass = 0; let failed = 0;
async function check(label, fn) {
  try { await fn(); console.log(`  PASS  ${label}`); pass++; } catch (e) { console.log(`  FAIL  ${label}\n        ${e && e.stack ? e.stack.split('\n').slice(0, 3).join('\n        ') : e}`); failed++; }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms = 8000) {
  const end = Date.now() + ms;
  for (;;) { const v = await fn(); if (v) return v; if (Date.now() > end) throw new Error('timed out'); await sleep(50); }
}
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };

const work = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'cf-')));
const home = path.join(work, 'home'); fs.mkdirSync(home);
const project = path.join(work, 'project'); fs.mkdirSync(path.join(project, '.engage'), { recursive: true });
const tools = path.join(work, 'tools'); fs.mkdirSync(tools);
const MODE_FILE = path.join(tools, 'mode');
const SPAWN_LOG = path.join(tools, 'spawns');
fs.writeFileSync(SPAWN_LOG, '');
const setMode = (m) => fs.writeFileSync(MODE_FILE, m);
const spawns = () => fs.readFileSync(SPAWN_LOG, 'utf8').split('\n').filter(Boolean).map(Number);

// The stand-in cloudflared: --url <target>; forwards on FAKE_CF_PORT like a tunnel.
const FAKE_SOURCE = `
const fs = require('fs'); const http = require('http');
const mode = fs.readFileSync(process.env.FAKE_CF_MODE_FILE, 'utf8').trim();
fs.appendFileSync(process.env.FAKE_CF_SPAWN_LOG, process.pid + '\\n');
const a = process.argv; const target = new URL(a[a.indexOf('--url') + 1]);
if (mode === '429') { process.stderr.write('INF Requesting new quick Tunnel on trycloudflare.com...\\nquick tunnel provisioning failed with status 429\\n'); process.exit(1); }
if (mode === 'silent') { setInterval(() => {}, 1000); return; }
const s = http.createServer((req, res) => {
  const up = http.request({ host: target.hostname, port: target.port, path: req.url, method: req.method, headers: req.headers }, (r) => { res.writeHead(r.statusCode, r.headers); r.pipe(res); });
  up.on('error', () => { res.writeHead(502); res.end('error code: 502'); });
  req.pipe(up);
});
// The one before may not have let go of the port yet: wait for it, as a real tunnel waits for Cloudflare.
s.on('error', (e) => { if (e.code === 'EADDRINUSE') setTimeout(() => s.listen(Number(process.env.FAKE_CF_PORT), '127.0.0.1'), 200); });
s.on('listening', () => {
  process.stderr.write('INF |  Your quick Tunnel has been created! Visit it at (it may take some time to be reachable):  |\\n');
  process.stderr.write('INF |  https://fake-tunnel-name.trycloudflare.com                                           |\\n');
});
s.listen(Number(process.env.FAKE_CF_PORT), '127.0.0.1');
`;
fs.writeFileSync(path.join(tools, 'fake.js'), FAKE_SOURCE);
fs.symlinkSync(process.execPath, path.join(tools, 'fake-cloudflared'));
const GOOD = Buffer.from(`#!/bin/sh\nexec "${path.join(tools, 'fake-cloudflared')}" "${path.join(tools, 'fake.js')}" "$@"\n`);
const TAMPERED = Buffer.concat([GOOD, Buffer.from('# one byte more\n')]);
const GOOD_SHA = crypto.createHash('sha256').update(GOOD).digest('hex');
const ASSET = { 'linux-x64': 'cloudflared-linux-amd64', 'linux-arm64': 'cloudflared-linux-arm64' }[`${process.platform}-${process.arch}`];

let serve = TAMPERED;
const downloads = [];
let dohCalls = 0; let dohAfter = 3;
let wanted = false; let remoteWanted = false; let targets = []; let apiDown = false;
const reports = [];
const server = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    if (req.url.startsWith('/release/')) { downloads.push(req.url); res.writeHead(200); return res.end(serve); }
    if (req.url.startsWith('/dns-query')) {
      dohCalls += 1;
      res.setHeader('Content-Type', 'application/dns-json');
      return res.end(JSON.stringify(dohCalls > dohAfter ? { Status: 0, Answer: [{ name: 'fake-tunnel-name.trycloudflare.com', type: 1, data: '127.0.0.1' }] } : { Status: 3 }));
    }
    res.setHeader('Content-Type', 'application/json');
    if (req.url.endsWith('/build/state')) return res.end(JSON.stringify({ gameId: '4821', title: 'Four in a row', inbox: [] }));
    if (apiDown) { res.statusCode = 500; return res.end('{"error":"down"}'); }
    if (req.url.endsWith('/build/share/report')) {
      reports.push(JSON.parse(body));
      return res.end(JSON.stringify({ wanted, targets, ...(remoteWanted ? { remoteWanted, remoteKeys: [] } : {}) }));
    }
    res.end('{}');
  });
});
const lastRemote = () => (reports[reports.length - 1] || {}).remote || {};
const roundsAfter = async (n = 2) => { const at = reports.length; await until(() => reports.length >= at + n); };
async function remoteOffThenOn() {
  remoteWanted = false; await until(() => lastRemote().status === 'off'); await roundsAfter(2);
  remoteWanted = true;
}

(async () => {
  if (!ASSET) { console.log('  (this suite runs on Linux x64/arm64 only: it serves the Linux asset)'); suiteFinished(); process.exit(0); }
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  // The app Claude showed, running in the project folder (the folder check, F4).
  fs.writeFileSync(path.join(project, 'app.js'), "require('http').createServer((q, s) => s.end('app')).listen(0, '127.0.0.1', function () { console.log('PORT ' + this.address().port); });");
  const app = spawn(process.execPath, ['app.js'], { cwd: project, stdio: ['ignore', 'pipe', 'inherit'] });
  let appPort = 0;
  app.stdout.on('data', (d) => { const m = /PORT (\d+)/.exec(String(d)); if (m) appPort = Number(m[1]); });
  await until(() => appPort);
  fs.writeFileSync(path.join(project, '.engage', 'session.json'), JSON.stringify({ key: KEY, tier: 'prod' }));

  const lanBase = 49000 + Math.floor(Math.random() * 300);
  const env = {
    ...process.env, HOME: home, CLAUDE_PROJECT_DIR: project,
    ENGAGE_LAN_ADDRESS: '127.0.0.1', ENGAGE_LAN_PORT: String(lanBase), ENGAGE_REMOTE_PORT: String(lanBase + 400),
    ENGAGE_LAN_FAST_MS: '100', ENGAGE_LAN_IDLE_MS: '100', ENGAGE_LAN_LOST_MS: '800', ENGAGE_ACTIVITY_MS: '60000',
    ENGAGE_API: `http://127.0.0.1:${port}/`, ENGAGE_ALLOW_LOCAL_API: '1',
    ENGAGE_CLOUDFLARED_BASE: `http://127.0.0.1:${port}/release/`, ENGAGE_CLOUDFLARED_SHA256: GOOD_SHA,
    ENGAGE_DOH_URL: `http://127.0.0.1:${port}/dns-query`, ENGAGE_TUNNEL_PROBE: `http://127.0.0.1:${lanBase + 800}`,
    ENGAGE_TUNNEL_TIMEOUT_MS: '1500', ENGAGE_TUNNEL_READY_MS: '15000', ENGAGE_TUNNEL_RETRY_MS: '2500',
    FAKE_CF_MODE_FILE: MODE_FILE, FAKE_CF_SPAWN_LOG: SPAWN_LOG, FAKE_CF_PORT: String(lanBase + 800),
  };
  delete env.ENGAGE_KEY; delete env.ENGAGE_CLOUDFLARED;
  const startPlugin = () => {
    const child = spawn(process.execPath, [SCRIPT], { cwd: project, env, stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '';
    child.stdout.on('data', (d) => { out += d.toString(); });
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'connect', arguments: {} } }) + '\n');
    return { child, out: () => out };
  };
  setMode('ok');
  let plugin = startPlugin();
  await until(() => plugin.out().includes('"id":1'));
  const appOrigin = `http://localhost:${appPort}`;
  const binDir = path.join(home, '.engage', 'bin');

  console.log('\nGetting cloudflared');
  await check('a download that does not match the pinned hash is refused, deleted, and never run', async () => {
    wanted = true; remoteWanted = true; targets = [appOrigin];
    await until(() => /did not match/.test(lastRemote().error || ''));
    assert.strictEqual(lastRemote().status, 'failed');
    assert.deepStrictEqual(spawns(), []);
    const left = fs.existsSync(binDir) ? fs.readdirSync(binDir) : [];
    assert.deepStrictEqual(left, [], `left behind: ${left}`);
  });
  await check('no new attempt inside the retry window, whatever the switch does', async () => {
    const n = downloads.length;
    await remoteOffThenOn();
    await sleep(600);
    assert.strictEqual(downloads.length, n);
  });

  console.log('\nThe tunnel');
  await check('the right file: installed once, run, and live only after public DNS has the name and a request gets through', async () => {
    serve = GOOD;
    await until(() => lastRemote().status === 'live', 15000);
    assert.strictEqual(lastRemote().address, 'https://fake-tunnel-name.trycloudflare.com');
    assert.ok(dohCalls > dohAfter, `public DNS asked ${dohCalls} times`);
    assert.strictEqual(spawns().length, 1);
    assert.ok(fs.existsSync(path.join(binDir, 'cloudflared-2026.10.1')));
    assert.ok(fs.existsSync(path.join(home, '.engage', 'cloudflared.pids')));
  });
  await check('Claude shows something new: the tunnel is not reopened', async () => {
    const n = spawns().length;
    targets = [appOrigin, `http://127.0.0.1:${appPort}`];
    await roundsAfter(4);
    assert.strictEqual(spawns().length, n);
    assert.strictEqual(lastRemote().status, 'live');
    targets = [appOrigin];
  });
  await check('remote off kills cloudflared; on again reuses the installed file (no download)', async () => {
    const pid = spawns()[spawns().length - 1];
    const d = downloads.length;
    remoteWanted = false;
    await until(() => !alive(pid));
    dohCalls = 0;
    await roundsAfter(2);
    remoteWanted = true;
    await until(() => lastRemote().status === 'live', 15000);
    assert.strictEqual(downloads.length, d);
    assert.strictEqual(spawns().length, 2);
  });
  await check('Cloudflare refuses (429): the plain words, and no reopen for a while', async () => {
    setMode('429');
    await remoteOffThenOn();
    await until(() => /not giving out new remote links/.test(lastRemote().error || ''));
    const n = spawns().length;
    await remoteOffThenOn();
    await sleep(800);
    assert.strictEqual(spawns().length, n, 'reopened inside the retry window');
    setMode('ok');
    await until(() => lastRemote().status === 'live', 15000);
    assert.ok(spawns().length > n, 'tried again after the window');
  });
  await check('no address ever printed: "did not give this laptop a remote link"', async () => {
    setMode('silent');
    await sleep(2600);
    await remoteOffThenOn();
    await until(() => /did not give this laptop a remote link/.test(lastRemote().error || ''), 10000);
    const pid = spawns()[spawns().length - 1];
    await until(() => !alive(pid));
    setMode('ok');
  });
  await check('Engage goes silent: cloudflared is killed with the gateway', async () => {
    await sleep(2600);
    await remoteOffThenOn();
    await until(() => lastRemote().status === 'live', 15000);
    const pid = spawns()[spawns().length - 1];
    apiDown = true;
    await until(() => !alive(pid), 6000);
    apiDown = false;
    await until(() => lastRemote().status === 'live', 20000);
  });
  await check('the plugin is stopped: cloudflared goes with it', async () => {
    const pid = spawns()[spawns().length - 1];
    plugin.child.kill('SIGTERM');
    await until(() => !alive(pid), 5000);
  });
  await check('one left by a crash (pid file) is killed when the next plugin opens a tunnel', async () => {
    const orphan = spawn(path.join(tools, 'fake-cloudflared'), [path.join(tools, 'fake.js'), '--url', 'http://127.0.0.1:1'], { env: { ...env, FAKE_CF_PORT: String(lanBase + 900) }, stdio: 'ignore', detached: true });
    orphan.unref();
    await until(() => spawns().includes(orphan.pid));
    fs.writeFileSync(path.join(home, '.engage', 'cloudflared.pids'), JSON.stringify([orphan.pid]));
    plugin = startPlugin();
    await until(() => plugin.out().includes('"id":1'));
    await until(() => !alive(orphan.pid), 15000);
    await until(() => lastRemote().status === 'live', 15000);
    plugin.child.kill('SIGTERM');
  });

  await sleep(300);
  for (const pid of spawns()) { try { process.kill(pid, 'SIGKILL'); } catch { /* gone */ } }
  app.kill();
  server.close();
  console.log(`\n${pass} passed, ${failed} failed`);
  suiteFinished();
  process.exit(failed ? 1 : 0);
})();
