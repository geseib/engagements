/**
 * BUILD ROOM WI-FI SHARE — the gateway inside the real plugin
 * (src/public/engage-mcp.mjs), against a fake Engage API and a real app.
 * docs/design/build-room-lan-share/PLAN.md §2 and §5.
 *
 * ENGAGE_LAN_ADDRESS=127.0.0.1 stands in for the Wi-Fi address: CI has no
 * Wi-Fi, and what is under test is the lock and the forwarding.
 *
 * The app runs as its own process with its cwd inside the project folder,
 * because the gateway refuses a target whose listening process runs outside
 * the project (an earlier session's server). It prints "PORT <n>" once, then
 * one JSON line per request it served ("SEEN {...}") on stdout, which is how
 * the test learns what the app received.
 */
const suiteFinished = require('./helpers/finish-guard');
const assert = require('assert');
const http = require('http');
const net = require('net');
const fs = require('fs');
const os = require('os');
const path = require('path');
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

// The app, as a separate process: refuses a foreign Host like Vite, records
// what it saw, echoes raw bytes after an upgrade.
const APP_SOURCE = `
const http = require('http');
const app = http.createServer((req, res) => {
  const port = app.address().port;
  console.log('SEEN ' + JSON.stringify({ url: req.url, host: req.headers.host, origin: req.headers.origin, cookie: req.headers.cookie || '' }));
  if (req.headers.host !== 'localhost:' + port) { res.writeHead(403); return res.end('Blocked request. This host is not allowed.'); }
  if (req.url === '/go') { res.writeHead(302, { Location: 'http://localhost:' + port + '/there' }); return res.end(); }
  res.writeHead(200, { 'Content-Type': 'text/html' });
  res.end('<h1>Four in a row</h1>');
});
app.on('upgrade', (req, socket) => {
  socket.write('HTTP/1.1 101 Switching Protocols\\r\\nUpgrade: echo\\r\\nConnection: Upgrade\\r\\n\\r\\n');
  socket.on('data', (d) => socket.write(d));
  socket.on('error', () => {});
});
app.listen(0, '127.0.0.1', () => console.log('PORT ' + app.address().port));
`;

const seen = [];
let appPort = 0;
let wanted = false;
let targets = [];
const reports = [];
const api = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    res.setHeader('Content-Type', 'application/json');
    if (req.url.endsWith('/build/share/report')) {
      reports.push(JSON.parse(body));
      return res.end(JSON.stringify({ wanted, targets }));
    }
    res.end('{}');
  });
});

const lastReport = () => reports[reports.length - 1] || {};
function get(url, headers = {}) {
  return new Promise((resolve, reject) => {
    http.get(url, { headers }, (res) => {
      let b = ''; res.on('data', (c) => { b += c; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: b }));
    }).on('error', reject);
  });
}

(async () => {
  await new Promise((r) => api.listen(0, '127.0.0.1', r));
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'lan-')));
  fs.mkdirSync(path.join(dir, '.engage'));
  fs.writeFileSync(path.join(dir, '.engage', 'session.json'), JSON.stringify({ key: KEY, api: `http://127.0.0.1:${api.address().port}/` }));
  fs.writeFileSync(path.join(dir, 'app.js'), APP_SOURCE);

  const appProc = spawn(process.execPath, ['app.js'], { cwd: dir, stdio: ['ignore', 'pipe', 'inherit'] });
  let out = '';
  appProc.stdout.on('data', (d) => {
    out += d.toString();
    let nl;
    while ((nl = out.indexOf('\n')) !== -1) {
      const line = out.slice(0, nl); out = out.slice(nl + 1);
      if (line.startsWith('PORT ')) appPort = Number(line.slice(5));
      else if (line.startsWith('SEEN ')) seen.push(JSON.parse(line.slice(5)));
    }
  });
  await until(() => appPort);
  const appOrigin = `http://localhost:${appPort}`;

  const base = 47000 + Math.floor(Math.random() * 1000);
  const env = { ...process.env, CLAUDE_PROJECT_DIR: dir, ENGAGE_LAN_ADDRESS: '127.0.0.1', ENGAGE_LAN_PORT: String(base), ENGAGE_LAN_FAST_MS: '100', ENGAGE_LAN_IDLE_MS: '100', ENGAGE_ACTIVITY_MS: '60000' };
  delete env.ENGAGE_KEY; delete env.ENGAGE_API;
  const child = spawn(process.execPath, [SCRIPT], { cwd: dir, env, stdio: ['pipe', 'pipe', 'pipe'] });
  let childOut = '';
  child.stdout.on('data', (d) => { childOut += d.toString(); });
  const gw = `http://127.0.0.1:${base}`;

  console.log('\nThe Wi-Fi gateway');
  await check('off: the plugin reports off, and nothing listens', async () => {
    await until(() => reports.length >= 2);
    assert.strictEqual(lastReport().status, 'off');
    await assert.rejects(get(`${gw}/`));
  });

  let key;
  await check('on: a gateway opens for the app Claude showed, and the report says live with a key', async () => {
    targets = [appOrigin]; wanted = true;
    await until(() => lastReport().status === 'live');
    key = lastReport().key;
    assert.match(key, /^[A-Za-z0-9_-]{22}$/);
    assert.deepStrictEqual(lastReport().map, [{ local: appOrigin, lan: gw }]);
  });
  await check('no key and no cookie: the locked page, and the app never sees the request', async () => {
    const n = seen.length;
    const r = await get(`${gw}/`);
    assert.strictEqual(r.status, 403);
    assert.match(r.body, /Open this from the Build Room/);
    await sleep(150);
    assert.strictEqual(seen.length, n);
  });
  await check('a wrong key and a wrong cookie are refused the same way', async () => {
    const n = seen.length;
    const a = await get(`${gw}/?k=${'x'.repeat(22)}`);
    const b = await get(`${gw}/`, { Cookie: 'engage_lan=nope' });
    assert.strictEqual(a.status, 403);
    assert.strictEqual(b.status, 403);
    await sleep(150);
    assert.strictEqual(seen.length, n);
  });
  let cookie;
  await check('the key becomes a cookie and the address loses it', async () => {
    const n = seen.length;
    const r = await get(`${gw}/b?x=1&k=${key}`);
    assert.strictEqual(r.status, 302);
    assert.strictEqual(r.headers.location, '/b?x=1');
    cookie = r.headers['set-cookie'][0].split(';')[0];
    assert.match(r.headers['set-cookie'][0], /HttpOnly/);
    assert.match(r.headers['set-cookie'][0], /SameSite=Lax/);
    await sleep(150);
    assert.strictEqual(seen.length, n, 'the redirect must not reach the app');
  });
  await check('with the cookie: the app, seeing localhost as its host and origin, without the gateway\'s cookie', async () => {
    const r = await get(`${gw}/`, { Cookie: `${cookie}; theme=dark`, Origin: gw });
    assert.strictEqual(r.status, 200);
    assert.match(r.body, /Four in a row/);
    const last = await until(() => seen[seen.length - 1]);
    assert.strictEqual(last.host, `localhost:${appPort}`);
    assert.strictEqual(last.origin, appOrigin);
    assert.ok(!last.cookie.includes('engage_lan'));
    assert.ok(last.cookie.includes('theme=dark'));
  });
  await check('a redirect to the app\'s own address comes back as the gateway\'s', async () => {
    const r = await get(`${gw}/go`, { Cookie: cookie });
    assert.strictEqual(r.headers.location, `${gw}/there`);
  });
  await check('an upgrade without the cookie is refused and never reaches the app', async () => {
    const n = seen.length;
    const sock = net.connect(base, '127.0.0.1');
    await new Promise((r) => sock.on('connect', r));
    sock.write(`GET /hmr HTTP/1.1\r\nHost: 127.0.0.1:${base}\r\nUpgrade: echo\r\nConnection: Upgrade\r\n\r\n`);
    let got = '';
    sock.on('data', (d) => { got += d.toString(); });
    await until(() => got.includes('403'));
    assert.ok(!got.includes('101'));
    sock.destroy();
    assert.strictEqual(seen.length, n);
  });
  await check('a websocket-style upgrade passes through both ways', async () => {
    const sock = net.connect(base, '127.0.0.1');
    await new Promise((r) => sock.on('connect', r));
    sock.write(`GET /hmr HTTP/1.1\r\nHost: 127.0.0.1:${base}\r\nUpgrade: echo\r\nConnection: Upgrade\r\nCookie: ${cookie}\r\n\r\n`);
    let got = '';
    sock.on('data', (d) => { got += d.toString(); });
    await until(() => got.includes('101'));
    sock.write('ping');
    await until(() => got.includes('ping'));
    sock.destroy();
  });
  await check('the count says how many devices opened it', async () => {
    await until(() => lastReport().open >= 1);
  });
  await check('an app that has stopped answers with a plain 502, it does not hang', async () => {
    const dead = http.createServer();
    await new Promise((r) => dead.listen(0, '127.0.0.1', r));
    const deadOrigin = `http://localhost:${dead.address().port}`;
    await new Promise((r) => dead.close(r));
    targets = [appOrigin, deadOrigin];
    await until(() => lastReport().map.length === 2);
    const second = lastReport().map.find((m) => m.local === deadOrigin).lan;
    const r = await get(`${second}/`, { Cookie: cookie });
    assert.strictEqual(r.status, 502);
    assert.match(r.body, /not answering/);
    targets = [appOrigin];
  });
  await check('turned off: the port closes, an open hot-reload socket is cut, and the report says off', async () => {
    const sock = net.connect(base, '127.0.0.1');
    await new Promise((r) => sock.on('connect', r));
    sock.write(`GET /hmr HTTP/1.1\r\nHost: 127.0.0.1:${base}\r\nUpgrade: echo\r\nConnection: Upgrade\r\nCookie: ${cookie}\r\n\r\n`);
    let got = ''; let closed = false;
    sock.on('data', (d) => { got += d.toString(); });
    sock.on('close', () => { closed = true; });
    await until(() => got.includes('101'));
    wanted = false;
    await until(() => lastReport().status === 'off');
    await until(() => closed);
    await assert.rejects(get(`${gw}/`, { Cookie: cookie }));
  });
  await check('turned on again: a new key, and the old cookie is refused', async () => {
    wanted = true;
    await until(() => lastReport().status === 'live');
    assert.notStrictEqual(lastReport().key, key);
    const r = await get(`${gw}/`, { Cookie: cookie });
    assert.strictEqual(r.status, 403);
  });
  await check('it never opens a port for an address that is not on this laptop', async () => {
    targets = [appOrigin, 'http://192.168.1.50:3000'];
    await sleep(400);
    assert.strictEqual(lastReport().map.length, 1);
  });
  await check('the plugin wrote nothing to stdout (that is the MCP stream)', async () => {
    assert.strictEqual(childOut, '');
  });

  child.kill();
  appProc.kill();
  api.close();
  console.log(`\n${pass} passed, ${failed} failed`);
  suiteFinished();
  process.exit(failed ? 1 : 0);
})();
