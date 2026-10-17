/**
 * BUILD ROOM REMOTE SHARE — the remote gateway inside the real plugin
 * (src/public/engage-mcp.mjs), against a fake Engage API and real apps.
 * Plan docs/superpowers/plans/2026-10-16-build-room-remote-share.md Task 4;
 * spec §4.1. The harness is tests/engage-lan-gateway.js's.
 *
 * No tunnel here (that is Task 5): the gateway is reached directly on
 * 127.0.0.1, which is exactly where cloudflared will reach it.
 */
const suiteFinished = require('./helpers/finish-guard');
const assert = require('assert');
const http = require('http');
const net = require('net');
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
async function until(fn, ms = 6000) {
  const end = Date.now() + ms;
  for (;;) { const v = await fn(); if (v) return v; if (Date.now() > end) throw new Error('timed out'); await sleep(50); }
}
const hashOf = (k) => crypto.createHash('sha256').update(k).digest('base64url');

// The app: records what it saw (tagged with its name), echoes after an upgrade.
const APP_SOURCE = `
const http = require('http');
const NAME = process.argv[2];
const app = http.createServer((req, res) => {
  console.log('SEEN ' + JSON.stringify({ app: NAME, url: req.url, host: req.headers.host, cookie: req.headers.cookie || '' }));
  res.writeHead(200, { 'Content-Type': 'text/html' });
  res.end('<h1>' + NAME + '</h1>');
});
app.on('upgrade', (req, socket) => {
  socket.write('HTTP/1.1 101 Switching Protocols\\r\\nUpgrade: echo\\r\\nConnection: Upgrade\\r\\n\\r\\n');
  socket.on('data', (d) => socket.write(d));
  socket.on('error', () => {});
});
app.listen(0, '127.0.0.1', () => console.log('PORT ' + app.address().port));
`;

const seen = [];
let wanted = false; let remoteWanted = false; let targets = []; let remoteKeys = []; let apiDown = false;
const checkOk = new Map(); // hash -> player, for keys minted "since the last round"
const checks = [];
const reports = [];
const api = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    res.setHeader('Content-Type', 'application/json');
    if (req.url.endsWith('/build/state')) return res.end(JSON.stringify({ gameId: '4821', title: 'Four in a row', inbox: [] }));
    if (apiDown) { res.statusCode = 500; return res.end('{"error":"down"}'); }
    if (req.url.endsWith('/build/share/report')) {
      reports.push(JSON.parse(body));
      return res.end(JSON.stringify({ wanted, targets, ...(remoteWanted ? { remoteWanted, remoteKeys } : {}) }));
    }
    if (req.url.endsWith('/build/share/remote-check')) {
      const { hash } = JSON.parse(body);
      checks.push(hash);
      return res.end(JSON.stringify(checkOk.has(hash) ? { ok: true, player: checkOk.get(hash), inbox: [] } : { ok: false, inbox: [] }));
    }
    res.end('{}');
  });
});
const lastReport = () => reports[reports.length - 1] || {};
const roundsAfter = async (n = 2) => { const at = reports.length; await until(() => reports.length >= at + n); };

function request(port, pathAndQuery, headers = {}, host = '127.0.0.1') {
  return new Promise((resolve, reject) => {
    http.get({ host, port, path: pathAndQuery, headers }, (res) => {
      let b = ''; res.on('data', (c) => { b += c; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: b }));
    }).on('error', reject);
  });
}
/** A device: its own cookie jar. */
function device(port) {
  const jar = new Map();
  const cookieHeader = () => [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
  return {
    jar,
    async get(p, extra = {}) {
      const r = await request(port, p, { ...(jar.size ? { Cookie: cookieHeader() } : {}), ...extra });
      for (const c of r.headers['set-cookie'] || []) { const [kv] = c.split(';'); const i = kv.indexOf('='); jar.set(kv.slice(0, i), kv.slice(i + 1)); }
      return r;
    },
    cookieHeader,
  };
}
function upgrade(port, cookie) {
  return new Promise((resolve) => {
    const sock = net.connect(port, '127.0.0.1', () => {
      sock.write(`GET /hmr HTTP/1.1\r\nHost: x\r\nConnection: Upgrade\r\nUpgrade: echo\r\n${cookie ? `Cookie: ${cookie}\r\n` : ''}\r\n`);
    });
    let got = '';
    sock.on('data', (d) => { got += d.toString(); if (/\r\n\r\n/.test(got)) resolve({ sock, head: got.split('\r\n')[0] }); });
    sock.on('error', () => resolve({ sock, head: 'error' }));
    sock.on('close', () => resolve({ sock, head: got.split('\r\n')[0] || 'closed' }));
  });
}

(async () => {
  await new Promise((r) => api.listen(0, '127.0.0.1', r));
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'remote-')));
  fs.mkdirSync(path.join(dir, '.engage'));
  fs.writeFileSync(path.join(dir, '.engage', 'session.json'), JSON.stringify({ key: KEY, tier: 'prod' }));
  fs.writeFileSync(path.join(dir, 'app.js'), APP_SOURCE);
  // No tunnel in this suite (Task 5 has its own): a cloudflared that never
  // prints an address, so nothing reaches the network and remote stays "not yet live".
  const quiet = path.join(dir, 'quiet-cloudflared');
  fs.writeFileSync(quiet, '#!/bin/sh\nexec sleep 600\n'); fs.chmodSync(quiet, 0o755);
  const procs = [];
  function startApp(name) {
    const proc = spawn(process.execPath, ['app.js', name], { cwd: dir, stdio: ['ignore', 'pipe', 'inherit'] });
    procs.push(proc);
    const me = { port: 0 };
    let out = '';
    proc.stdout.on('data', (d) => {
      out += d.toString();
      let nl;
      while ((nl = out.indexOf('\n')) !== -1) {
        const line = out.slice(0, nl); out = out.slice(nl + 1);
        if (line.startsWith('PORT ')) me.port = Number(line.slice(5));
        else if (line.startsWith('SEEN ')) seen.push(JSON.parse(line.slice(5)));
      }
    });
    return me;
  }
  const first = startApp('first'); const second = startApp('second');
  await until(() => first.port && second.port);
  const firstOrigin = `http://localhost:${first.port}`; const secondOrigin = `http://localhost:${second.port}`;

  const base = 48000 + Math.floor(Math.random() * 500);
  const rbase = base + 600;
  const env = { ...process.env, CLAUDE_PROJECT_DIR: dir, ENGAGE_LAN_ADDRESS: '127.0.0.1', ENGAGE_LAN_PORT: String(base), ENGAGE_REMOTE_PORT: String(rbase), ENGAGE_LAN_FAST_MS: '100', ENGAGE_LAN_IDLE_MS: '100', ENGAGE_LAN_LOST_MS: '600', ENGAGE_ACTIVITY_MS: '60000', ENGAGE_REMOTE_WAIT_MS: '1500', ENGAGE_CLOUDFLARED: quiet, ENGAGE_TUNNEL_TIMEOUT_MS: '600000', HOME: dir };
  delete env.ENGAGE_KEY;
  env.ENGAGE_API = `http://127.0.0.1:${api.address().port}/`;
  env.ENGAGE_ALLOW_LOCAL_API = '1';
  const child = spawn(process.execPath, [SCRIPT], { cwd: dir, env, stdio: ['pipe', 'pipe', 'pipe'] });
  let childOut = '';
  child.stdout.on('data', (d) => { childOut += d.toString(); });
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'connect', arguments: {} } }) + '\n');
  await until(() => childOut.includes('"id":1'));

  console.log('\nThe remote gateway');
  await check('remote not wanted: the report says off, and nothing listens on the remote port', async () => {
    await roundsAfter(2);
    assert.deepStrictEqual(lastReport().remote, { status: 'off', address: '', target: '', error: '', devices: {} });
    await assert.rejects(request(rbase, '/'));
  });
  await check('wanted: one gateway opens on 127.0.0.1 for the newest thing Claude showed', async () => {
    wanted = true; remoteWanted = true; targets = [secondOrigin, firstOrigin];
    await until(async () => { try { await request(rbase, '/'); return true; } catch { return false; } });
    await roundsAfter(2);
    assert.strictEqual(lastReport().remote.target, firstOrigin);
    assert.strictEqual(lastReport().remote.error, '');
    assert.strictEqual(lastReport().remote.status, 'off', 'not live until a tunnel answers (Task 5)');
  });
  await check('it binds 127.0.0.1 only: another local address of this machine is refused', async () => {
    const other = Object.values(os.networkInterfaces()).flat().find((n) => n && (n.family === 'IPv4' || n.family === 4) && !n.internal);
    if (!other) { console.log('        (no other IPv4 address on this machine; nothing to try)'); return; }
    await assert.rejects(request(rbase, '/', {}, other.address));
  });
  await check('no key: the locked page, and the app never sees it', async () => {
    const n = seen.length;
    const r = await request(rbase, '/');
    assert.strictEqual(r.status, 403);
    assert.match(r.body, /Open this from the Build Room/);
    await sleep(150);
    assert.strictEqual(seen.length, n);
  });
  const PRIYA = 'priyaPRIYApriyaPRIYAaa';
  const phone = device(rbase);
  await check('a key whose hash Engage sent: two cookies (key, device), HttpOnly and Secure, and the key leaves the address', async () => {
    remoteKeys = [{ hash: hashOf(PRIYA), player: 'Priya' }];
    await roundsAfter(2);
    const r = await phone.get(`/board?x=1&k=${PRIYA}`);
    assert.strictEqual(r.status, 302);
    assert.strictEqual(r.headers.location, '/board?x=1');
    const sc = r.headers['set-cookie'];
    assert.strictEqual(sc.length, 2);
    for (const c of sc) { assert.match(c, /HttpOnly/); assert.match(c, /Secure/); assert.match(c, /SameSite=Lax/); }
    assert.deepStrictEqual([...phone.jar.keys()].sort(), ['engage_dev', 'engage_rk']);
  });
  await check('with the cookies: the newest app, which never sees the gateway\'s cookies', async () => {
    const r = await phone.get('/board?x=1', { Cookie: `${phone.cookieHeader()}; theme=dark` });
    assert.strictEqual(r.status, 200);
    assert.match(r.body, /first/);
    const last = await until(() => seen[seen.length - 1]);
    assert.strictEqual(last.app, 'first');
    assert.ok(!/engage_/.test(last.cookie), last.cookie);
    assert.ok(last.cookie.includes('theme=dark'));
  });
  await check('a key minted since the last round: one check with Engage, then in', async () => {
    const SAM = 'samSAMsamSAMsamSAMsa12';
    checkOk.set(hashOf(SAM), 'Sam');
    await sleep(1100);
    const n = checks.length;
    const r = await device(rbase).get(`/?k=${SAM}`);
    assert.strictEqual(r.status, 302);
    assert.deepStrictEqual(checks.slice(n), [hashOf(SAM)]);
  });
  await check('twenty wrong keys in a second: at most one check with Engage', async () => {
    await sleep(1100);
    const n = checks.length;
    const results = await Promise.all(Array.from({ length: 20 }, (_, i) => request(rbase, `/?k=wrongWRONGwrong${String(i).padStart(7, '0')}`)));
    assert.ok(results.every((x) => x.status === 403));
    assert.ok(checks.length - n <= 1, `${checks.length - n} checks`);
  });
  await check('a room pressing together: one check, and the rest let in by the next round, not locked out', async () => {
    await sleep(1100);
    const fresh = Array.from({ length: 6 }, (_, i) => `freshFRESHfresh${String(i).padStart(7, '0')}`);
    for (const k of fresh) checkOk.set(hashOf(k), `P${k.slice(-1)}`);
    const n = checks.length;
    const pending = fresh.map((k) => request(rbase, `/?k=${k}`));
    await sleep(50);
    // Engage's next round knows them all (they were minted before the presses).
    remoteKeys = [{ hash: hashOf(PRIYA), player: 'Priya' }, ...fresh.map((k) => ({ hash: hashOf(k), player: `P${k.slice(-1)}` }))];
    const results = await Promise.all(pending);
    assert.deepStrictEqual(results.map((x) => x.status), fresh.map(() => 302));
    assert.ok(checks.length - n <= 1, `${checks.length - n} checks`);
    remoteKeys = [{ hash: hashOf(PRIYA), player: 'Priya' }];
    await roundsAfter(2);
  });
  await check('the same wrong key twice, a second apart: asked about once', async () => {
    await sleep(1100);
    const n = checks.length;
    await request(rbase, '/?k=onceONCEonceONCEonce12');
    await sleep(1100);
    await request(rbase, '/?k=onceONCEonceONCEonce12');
    assert.strictEqual(checks.slice(n).filter((h) => h === hashOf('onceONCEonceONCEonce12')).length, 1);
  });
  await check('with a key: /@fs/, /@id/ and source maps are refused, encoded or not, and never reach the app', async () => {
    const n = seen.length;
    for (const p of ['/@fs/etc/passwd', '/%40fs/etc/passwd', '/@id/virtual:x', '/src/main.js.map', '/SRC/MAIN.JS.MAP']) {
      const r = await phone.get(p);
      assert.strictEqual(r.status, 404, p);
    }
    await sleep(150);
    assert.strictEqual(seen.length, n);
  });
  await check('an upgrade without the key cookie is refused; with it, it reaches the app', async () => {
    const no = await upgrade(rbase, '');
    assert.match(no.head, /403/);
    no.sock.destroy();
    const yes = await upgrade(rbase, phone.cookieHeader());
    assert.match(yes.head, /101/);
    yes.sock.destroy();
  });
  await check('two devices on Priya\'s key: the report says Priya, 2', async () => {
    const laptop = device(rbase);
    await laptop.get(`/?k=${PRIYA}`);
    await laptop.get('/');
    await phone.get('/');
    await roundsAfter(2);
    assert.strictEqual(lastReport().remote.devices.Priya, 2);
  });
  await check('the Wi-Fi gateway is unaffected: still live, on its own port, with its own key', async () => {
    assert.strictEqual(lastReport().status, 'live');
    const r = await request(base, `/?k=${lastReport().key}`);
    assert.strictEqual(r.status, 302);
  });
  await check('Claude shows something new: the same port, now the new app; open sockets to the old one close', async () => {
    const ws = await upgrade(rbase, phone.cookieHeader());
    assert.match(ws.head, /101/);
    let closed = false; ws.sock.on('close', () => { closed = true; });
    targets = [firstOrigin, secondOrigin];
    await until(() => lastReport().remote && lastReport().remote.target === secondOrigin);
    await until(() => closed, 3000);
    const r = await phone.get('/');
    assert.match(r.body, /second/);
  });
  await check('a key Engage no longer sends (removed, moved, replaced): its cookie opens nothing', async () => {
    remoteKeys = [];
    checkOk.clear();
    await roundsAfter(2);
    const r = await phone.get('/');
    assert.strictEqual(r.status, 403);
  });
  await check('a target in another folder is not shared, and the report says why', async () => {
    const otherDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'other-')));
    fs.writeFileSync(path.join(otherDir, 'app.js'), APP_SOURCE);
    const proc = spawn(process.execPath, ['app.js', 'foreign'], { cwd: otherDir, stdio: ['ignore', 'pipe', 'inherit'] });
    procs.push(proc);
    let port = 0;
    proc.stdout.on('data', (d) => { const m = /PORT (\d+)/.exec(String(d)); if (m) port = Number(m[1]); });
    await until(() => port);
    targets = [firstOrigin, `http://localhost:${port}`];
    await until(() => /another folder|could not confirm/.test(lastReport().remote.error || ''));
    assert.strictEqual(lastReport().remote.status, 'failed');
    assert.strictEqual(lastReport().remote.target, '');
    targets = [firstOrigin];
  });
  await check('remote off: the remote port closes; the Wi-Fi share stays', async () => {
    remoteWanted = false;
    await until(async () => { try { await request(rbase, '/'); return false; } catch { return true; } });
    await roundsAfter(2);
    assert.strictEqual(lastReport().remote.status, 'off');
    assert.strictEqual(lastReport().status, 'live');
  });
  await check('lost contact with Engage: the remote gateway closes by itself', async () => {
    remoteWanted = true;
    await until(async () => { try { await request(rbase, '/'); return true; } catch { return false; } });
    apiDown = true;
    await until(async () => { try { await request(rbase, '/'); return false; } catch { return true; } }, 4000);
    apiDown = false;
  });

  child.kill();
  for (const pr of procs) pr.kill();
  api.close();
  console.log(`\n${pass} passed, ${failed} failed`);
  suiteFinished();
  process.exit(failed ? 1 : 0);
})();
