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
const HOST = process.argv[2] || '127.0.0.1';
const expectHost = (port) => (HOST === '::1' ? '[::1]:' : 'localhost:') + port;
const app = http.createServer((req, res) => {
  const port = app.address().port;
  console.log('SEEN ' + JSON.stringify({ url: req.url, host: req.headers.host, origin: req.headers.origin, cookie: req.headers.cookie || '' }));
  if (req.headers.host !== expectHost(port)) { res.writeHead(403); return res.end('Blocked request. This host is not allowed.'); }
  if (req.url === '/near') { res.writeHead(302, { Location: 'http://localhost:' + port + '0/x' }); return res.end(); }
  if (req.url === '/go') { res.writeHead(302, { Location: 'http://localhost:' + port + '/there' }); return res.end(); }
  if (req.url === '/demo/') { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); return res.end('<!DOCTYPE HTML><html><head><title>Directory listing for /demo/</title></head><body><a href="index.html">index.html</a></body></html>'); }
  if (req.url === '/gz/') {
    // npx serve compresses when the browser asks for it, and browsers always do.
    const body = '<html><head><title>Index of /gz/</title></head></html>';
    if (/gzip/.test(req.headers['accept-encoding'] || '')) { res.writeHead(200, { 'Content-Type': 'text/html', 'Content-Encoding': 'gzip' }); return res.end(require('zlib').gzipSync(body)); }
    res.writeHead(200, { 'Content-Type': 'text/html' }); return res.end(body);
  }
  if (req.url === '/served/') { res.writeHead(200, { 'Content-Type': 'text/html' }); return res.end('<html><head><title>Index of /served/</title></head></html>'); }
  res.writeHead(200, { 'Content-Type': 'text/html' });
  res.end('<h1>Four in a row</h1>');
});
app.on('upgrade', (req, socket) => {
  socket.write('HTTP/1.1 101 Switching Protocols\\r\\nUpgrade: echo\\r\\nConnection: Upgrade\\r\\n\\r\\n');
  socket.on('data', (d) => socket.write(d));
  socket.on('error', () => {});
});
app.on('error', () => console.log('FAIL'));
app.listen(0, HOST, () => console.log('PORT ' + app.address().port));
`;

const seen = [];
let appPort = 0;
let wanted = false;
let apiDown = false;
let targets = [];
let scopes = null; // null: an older Engage that sends none
let another = false;
let roles = null; // null: an Engage before 1.20.0 that names no roles
const reports = [];
// A second session on this laptop (Share demo S3 d): its own room, its own reports.
const SECOND = '4893';
const second = { wanted: false, targets: [], reports: [] };
const api = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    res.setHeader('Content-Type', 'application/json');
    if (req.url.includes(`/games/${SECOND}/`)) {
      if (req.url.endsWith('/build/state')) return res.end(JSON.stringify({ gameId: SECOND, title: 'Second room', inbox: [] }));
      if (req.url.endsWith('/build/share/report')) { second.reports.push(JSON.parse(body)); return res.end(JSON.stringify({ wanted: second.wanted, targets: second.targets })); }
      return res.end('{}');
    }
    if (req.url.endsWith('/build/state')) return res.end(JSON.stringify({ gameId: '4821', title: 'Four in a row', inbox: [] }));
    if (req.url.endsWith('/build/share/report')) {
      if (apiDown) { res.statusCode = 500; return res.end('{"error":"down"}'); }
      reports.push(JSON.parse(body));
      return res.end(JSON.stringify(another ? { wanted: false, targets: [], another: true } : { wanted, targets, ...(scopes ? { scopes } : {}), ...(roles ? { roles } : {}) }));
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
  // The key in the folder; the API from the user's own setup (here ENGAGE_API), never the folder (F1).
  fs.writeFileSync(path.join(dir, '.engage', 'session.json'), JSON.stringify({ key: KEY, tier: 'prod' }));
  fs.writeFileSync(path.join(dir, 'app.js'), APP_SOURCE);

  const procs = [];
  function startApp(host) {
    const proc = spawn(process.execPath, ['app.js', host], { cwd: dir, stdio: ['ignore', 'pipe', 'inherit'] });
    procs.push(proc);
    const me = { port: 0, failed: false };
    let out = '';
    proc.stdout.on('data', (d) => {
      out += d.toString();
      let nl;
      while ((nl = out.indexOf('\n')) !== -1) {
        const line = out.slice(0, nl); out = out.slice(nl + 1);
        if (line.startsWith('PORT ')) me.port = Number(line.slice(5));
        else if (line === 'FAIL') me.failed = true;
        else if (line.startsWith('SEEN ')) seen.push(JSON.parse(line.slice(5)));
      }
    });
    return me;
  }
  const main = startApp('127.0.0.1');
  await until(() => main.port);
  appPort = main.port;
  const appOrigin = `http://localhost:${appPort}`;

  const base = 47000 + Math.floor(Math.random() * 1000);
  const env = { ...process.env, CLAUDE_PROJECT_DIR: dir, ENGAGE_LAN_ADDRESS: '127.0.0.1', ENGAGE_LAN_PORT: String(base), ENGAGE_LAN_FAST_MS: '100', ENGAGE_LAN_IDLE_MS: '100', ENGAGE_LAN_LOST_MS: '600', ENGAGE_ACTIVITY_MS: '60000' };
  delete env.ENGAGE_KEY;
  env.ENGAGE_API = `http://127.0.0.1:${api.address().port}/`;
  env.ENGAGE_ALLOW_LOCAL_API = '1';
  const child = spawn(process.execPath, [SCRIPT], { cwd: dir, env, stdio: ['pipe', 'pipe', 'pipe'] });
  let childOut = '';
  child.stdout.on('data', (d) => { childOut += d.toString(); });
  const gw = `http://127.0.0.1:${base}`;

  console.log('\nThe Wi-Fi gateway');
  await check('before connect in this process, the share loop never reports (security review F1)', async () => {
    await sleep(600); // six idle rounds' worth
    assert.strictEqual(reports.length, 0);
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'connect', arguments: {} } }) + '\n');
    await until(() => childOut.includes('"id":1'));
    assert.ok(!/"isError":true/.test(childOut), childOut);
  });
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
    // Shared while it ran in this project (its owner was confirmed), then stopped.
    const second = startApp('127.0.0.1');
    await until(() => second.port);
    const secondOrigin = `http://localhost:${second.port}`;
    targets = [appOrigin, secondOrigin];
    await until(() => lastReport().map.length === 2);
    const lanSecond = lastReport().map.find((m) => m.local === secondOrigin).lan;
    procs[procs.length - 1].kill();
    await sleep(200);
    const r = await get(`${lanSecond}/`, { Cookie: cookie });
    assert.strictEqual(r.status, 502);
    assert.match(r.body, /not answering/);
    targets = [appOrigin];
  });
  await check('an address whose server cannot be confirmed as this project\'s is never opened (security review F4)', async () => {
    // Port 1: nothing listens there, and no other suite running alongside can take it
    // (a freed ephemeral port can be re-bound by a parallel test inside the 400ms below).
    const deadOrigin = 'http://localhost:1';
    targets = [appOrigin, deadOrigin];
    // Wait for a report that reflects these targets (under load the last one can
    // still carry the previous step's stopped app), then one more sync after it:
    // the unconfirmed address must be absent from both.
    const locals = () => (lastReport().map || []).map((m) => m.local);
    await until(() => JSON.stringify(locals()) === JSON.stringify([appOrigin]));
    const seen = reports.length;
    await until(() => reports.length > seen);
    assert.deepStrictEqual(locals(), [appOrigin]);
    targets = [deadOrigin];
    await until(() => lastReport().status === 'failed');
    assert.match(lastReport().error, /could not confirm port \d+ is this project's server/);
    targets = [appOrigin];
    await until(() => lastReport().status === 'live');
    // Closing everything minted a new key: carry on with it.
    key = lastReport().key;
    cookie = (await get(`${gw}/?k=${key}`)).headers['set-cookie'][0].split(';')[0];
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
  await check('the plugin names itself, the same name every round (one reporter per room, 1.18.0)', async () => {
    const names = reports.slice(-3).map((r) => r.reporter);
    assert.match(names[0], /^[A-Za-z0-9_-]{16}$/);
    assert.ok(names.every((n) => n === names[0]));
  });
  await check('another copy holds the room: this one closes its door and stays closed', async () => {
    another = true;
    await until(() => lastReport().status === 'off');
    await assert.rejects(get(`${gw}/`, { Cookie: cookie }));
    another = false;
    await until(() => lastReport().status === 'live');
    key = lastReport().key;
    cookie = (await get(`${gw}/?k=${key}`)).headers['set-cookie'][0].split(';')[0];
  });
  await check('it never opens a port for an address that is not on this laptop', async () => {
    targets = [appOrigin, 'http://192.168.1.50:3000'];
    await sleep(400);
    assert.strictEqual(lastReport().map.length, 1);
  });
  await check('a key holder cannot be bounced to another site through the redirect', async () => {
    const r = await get(`${gw}/.//evil.com/x?k=${lastReport().key}`);
    assert.strictEqual(r.status, 302);
    assert.strictEqual(r.headers.location, '/evil.com/x');
    const r2 = await get(`${gw}///evil.com/y?k=${lastReport().key}`);
    assert.ok(!r2.headers.location.startsWith('//'), r2.headers.location);
  });
  await check('a redirect to a different port that merely starts with the app\'s origin is left alone', async () => {
    const c = (await get(`${gw}/?k=${lastReport().key}`)).headers['set-cookie'][0].split(';')[0];
    const r = await get(`${gw}/near`, { Cookie: c });
    assert.strictEqual(r.headers.location, `http://localhost:${appPort}0/x`);
  });
  await check('x.localhost is never forwarded to, even with nothing listening on it', async () => {
    targets = [appOrigin, `http://foo.localhost:${appPort}`, 'http://127.0.0.999:80'];
    await sleep(400);
    assert.deepStrictEqual(lastReport().map.map((m) => m.local), [appOrigin]);
  });
  await check('an app on [::1] is reached (brackets stripped)', async () => {
    const v6 = startApp('::1');
    await until(() => v6.port || v6.failed);
    if (v6.failed) { console.log('        (skipped: this machine cannot bind ::1)'); return; }
    targets = [appOrigin, `http://[::1]:${v6.port}`];
    await until(() => lastReport().map.length === 2);
    const lanV6 = lastReport().map.find((m) => m.local.includes('::1')).lan;
    const c = (await get(`${gw}/?k=${lastReport().key}`)).headers['set-cookie'][0].split(';')[0];
    const r = await get(`${lanV6}/`, { Cookie: c });
    assert.strictEqual(r.status, 200);
    assert.match(r.body, /Four in a row/);
    targets = [appOrigin];
  });
  console.log('\nWhat a shared server may show (Share demo S1, 1.19.0; dev game 1215)');
  const scoped = async () => {
    targets = [appOrigin];
    scopes = { [appOrigin]: ['/demo/'] };
    await sleep(400);
    return (await get(`${gw}/?k=${lastReport().key}`)).headers['set-cookie'][0].split(';')[0];
  };
  await check('a page inside a linked folder opens', async () => {
    const c = await scoped();
    const r = await get(`${gw}/demo/index.html`, { Cookie: c, 'Sec-Fetch-Dest': 'document' });
    assert.strictEqual(r.status, 200);
    assert.match(r.body, /Four in a row/);
  });
  await check('a page outside every linked folder is "not found", and the app never sees it', async () => {
    const c = await scoped();
    const before = seen.length;
    for (const p of ['/', '/secret.txt', '/demo', '/demox/a.html', '/%2e%2e/secret.txt']) {
      const r = await get(`${gw}${p}`, { Cookie: c, 'Sec-Fetch-Dest': 'document' });
      assert.strictEqual(r.status, 404, `${p} gave ${r.status}`);
    }
    // A request without Sec-Fetch-Dest is treated as a page: the strict reading.
    assert.strictEqual((await get(`${gw}/secret.txt`, { Cookie: c })).status, 404);
    assert.strictEqual(seen.length, before, 'nothing out of scope reached the app');
  });
  await check('a linked page may load its own files and call its API from anywhere on its server', async () => {
    const c = await scoped();
    const from = `${gw}/demo/index.html`;
    for (const [p, dest] of [['/assets/app.js', 'script'], ['/styles/site.css', 'style'], ['/api/scores', 'empty']]) {
      const r = await get(`${gw}${p}`, { Cookie: c, 'Sec-Fetch-Dest': dest, Referer: from });
      assert.strictEqual(r.status, 200, `${p} (${dest}) gave ${r.status}`);
    }
    // ...but not as a page, and not when the page asking is itself out of scope.
    assert.strictEqual((await get(`${gw}/assets/app.js`, { Cookie: c, 'Sec-Fetch-Dest': 'document', Referer: from })).status, 404);
    assert.strictEqual((await get(`${gw}/assets/app.js`, { Cookie: c, 'Sec-Fetch-Dest': 'script', Referer: `${gw}/other/page.html` })).status, 404);
  });
  await check('a folder listing is never shown, even inside a linked folder', async () => {
    const c = await scoped();
    const r = await get(`${gw}/demo/`, { Cookie: c, 'Sec-Fetch-Dest': 'document' });
    assert.strictEqual(r.status, 404);
    assert.ok(!/Directory listing|index\.html/.test(r.body), r.body);
    scopes = { [appOrigin]: ['/'] };
    await sleep(400);
    const r2 = await get(`${gw}/served/`, { Cookie: c, 'Sec-Fetch-Dest': 'document' });
    assert.strictEqual(r2.status, 404);
    // A compressed listing too: a page is always asked for uncompressed, so it can be read.
    const r3 = await get(`${gw}/gz/`, { Cookie: c, 'Sec-Fetch-Dest': 'document', 'Accept-Encoding': 'gzip, deflate, br' });
    assert.strictEqual(r3.status, 404);
  });
  await check('an older Engage (no scopes) keeps the old behaviour: the whole app opens', async () => {
    scopes = null;
    await sleep(400);
    const c = (await get(`${gw}/?k=${lastReport().key}`)).headers['set-cookie'][0].split(';')[0];
    assert.strictEqual((await get(`${gw}/anything`, { Cookie: c, 'Sec-Fetch-Dest': 'document' })).status, 200);
  });
  console.log('\nWhich server is which, and which session (Share demo S3, 1.20.0)');
  const shareFile = path.join(dir, '.engage', 'share.json');
  const statusFile = path.join(dir, '.engage', 'share-status.json');
  const freshCookie = async () => (await get(`${gw}/?k=${lastReport().key}`)).headers['set-cookie'][0].split(';')[0];
  await check('every gateway answer names its session: X-Engage-Session', async () => {
    const c = await freshCookie();
    const locked = await get(`${gw}/`);
    const redirect = await get(`${gw}/?k=${lastReport().key}`);
    const page = await get(`${gw}/`, { Cookie: c, 'Sec-Fetch-Dest': 'document' });
    scopes = { [appOrigin]: ['/demo/'] };
    await sleep(400);
    const notShared = await get(`${gw}/secret.txt`, { Cookie: c, 'Sec-Fetch-Dest': 'document' });
    scopes = null;
    await sleep(400);
    for (const [what, r, status] of [['locked', locked, 403], ['redirect', redirect, 302], ['page', page, 200], ['not shared', notShared, 404]]) {
      assert.strictEqual(r.status, status, `${what} gave ${r.status}`);
      assert.strictEqual(r.headers['x-engage-session'], '4821', `${what} lacks the header`);
    }
  });
  await check('the gateway\'s own pages name the session: its code and the room\'s title', async () => {
    const locked = await get(`${gw}/`);
    assert.match(locked.body, /Build Room 4821 \u00b7 Four in a row/);
    scopes = { [appOrigin]: ['/demo/'] };
    await sleep(400);
    const nf = await get(`${gw}/secret.txt`, { Cookie: await freshCookie(), 'Sec-Fetch-Dest': 'document' });
    assert.match(nf.body, /Not part of the shared build/);
    assert.match(nf.body, /Build Room 4821 \u00b7 Four in a row/);
    scopes = null;
    await sleep(400);
  });
  await check('.engage/share.json is reported each round: the demo, the mockups and the label, checked', async () => {
    fs.writeFileSync(shareFile, JSON.stringify({ demo: `${appOrigin}/demo/index.html`, mockups: `http://127.0.0.1:${appPort}/mockups/`, label: 'Blue <table> & co' }));
    await until(() => (lastReport().declared || {}).label === 'Blue <table> & co');
    assert.deepStrictEqual(lastReport().declared, { demo: `${appOrigin}/demo/index.html`, mockups: `http://127.0.0.1:${appPort}/mockups/`, label: 'Blue <table> & co' });
    // The label names the session on the gateway's pages, escaped.
    const locked = await get(`${gw}/`);
    assert.match(locked.body, /Build Room 4821 \u00b7 Blue &lt;table&gt; &amp; co/);
    assert.ok(!locked.body.includes('<table>'), locked.body);
  });
  await check('a share.json that is not JSON, or names another machine, declares nothing; the share carries on', async () => {
    fs.writeFileSync(shareFile, '{ not json');
    let n = reports.length;
    await until(() => reports.length > n + 1);
    assert.deepStrictEqual(lastReport().declared, {});
    assert.strictEqual(lastReport().status, 'live');
    fs.writeFileSync(shareFile, JSON.stringify({ demo: 'http://192.168.1.50:3000/', mockups: 'https://example.com/', label: 7 }));
    n = reports.length;
    await until(() => reports.length > n + 1);
    assert.deepStrictEqual(lastReport().declared, {});
    fs.writeFileSync(shareFile, JSON.stringify({ label: 'x'.repeat(5000) }));
    n = reports.length;
    await until(() => reports.length > n + 1);
    assert.deepStrictEqual(lastReport().declared, {}, 'a file over 4 KB is not read');
    fs.writeFileSync(shareFile, JSON.stringify({ label: 'y'.repeat(100) }));
    n = reports.length;
    await until(() => reports.length > n + 1);
    assert.deepStrictEqual(lastReport().declared, { label: 'y'.repeat(60) });
    fs.rmSync(shareFile);
    n = reports.length;
    await until(() => reports.length > n + 1);
    assert.deepStrictEqual(lastReport().declared, {});
  });
  await check('.engage/share-status.json lists each server local, Wi-Fi and role, and never the key', async () => {
    fs.writeFileSync(shareFile, JSON.stringify({ label: 'Blue table' }));
    roles = { [appOrigin]: 'demo' };
    const read = () => { try { return JSON.parse(fs.readFileSync(statusFile, 'utf8')); } catch { return null; } };
    const st = await until(() => { const x = read(); return x && x.label === 'Blue table' && x.servers.length && x.servers[0].role === 'demo' ? x : null; });
    assert.deepStrictEqual(Object.keys(st).sort(), ['gameId', 'label', 'servers', 'updatedAt']);
    assert.strictEqual(st.gameId, '4821');
    assert.deepStrictEqual(st.servers, [{ local: appOrigin, lan: gw, role: 'demo' }]);
    assert.ok(Date.now() - Date.parse(st.updatedAt) < 5000, st.updatedAt);
    const raw = fs.readFileSync(statusFile, 'utf8');
    assert.ok(!raw.includes(lastReport().key), 'the Wi-Fi key is a secret');
    assert.ok(!raw.includes('kkkkkkkk'), 'so is the session key');
    // An Engage that names no roles: the servers are listed with none.
    roles = null;
    await until(() => { const x = read(); return x && x.servers.length && x.servers[0].role === null; });
    // Turned off: nothing listed.
    wanted = false;
    await until(() => { const x = read(); return x && x.servers.length === 0; });
    wanted = true;
    await until(() => lastReport().status === 'live');
    fs.rmSync(shareFile);
  });
  await check('a second session on this laptop opens in its own port block, 4900 + (code mod 100) x 10, skipping a port in use', async () => {
    const block = 4900 + (Number(SECOND) % 100) * 10;
    // Something else already holds the block's first port.
    const squatter = net.createServer();
    const squatted = await new Promise((r) => { squatter.once('error', () => r(false)); squatter.listen(block, '127.0.0.1', () => r(true)); });
    const sub = path.join(dir, 'second');
    fs.mkdirSync(path.join(sub, '.engage'), { recursive: true });
    fs.writeFileSync(path.join(sub, '.engage', 'session.json'), JSON.stringify({ key: `eng_${SECOND}_${'q'.repeat(43)}`, tier: 'prod' }));
    const env2 = { ...env, CLAUDE_PROJECT_DIR: sub };
    delete env2.ENGAGE_LAN_PORT;
    const child2 = spawn(process.execPath, [SCRIPT], { cwd: sub, env: env2, stdio: ['pipe', 'pipe', 'ignore'] });
    procs.push(child2);
    let out2 = '';
    child2.stdout.on('data', (d) => { out2 += d.toString(); });
    child2.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'connect', arguments: {} } }) + '\n');
    await until(() => out2.includes('"id":1'));
    second.targets = [appOrigin]; second.wanted = true;
    const live = await until(() => { const r = second.reports[second.reports.length - 1]; return r && r.status === 'live' ? r : null; });
    const port = Number(new URL(live.map[0].lan).port);
    assert.ok(port > block && port < block + 10, `port ${port} is outside ${block + 1}..${block + 9}`);
    if (!squatted) console.log('        (the block\'s first port was already taken by something else)');
    const r = await get(`${live.map[0].lan}/`);
    assert.strictEqual(r.headers['x-engage-session'], SECOND);
    assert.match(r.body, /Build Room 4893 \u00b7 Second room/);
    // Two sessions, two status files, each naming its own room.
    assert.strictEqual(JSON.parse(fs.readFileSync(path.join(sub, '.engage', 'share-status.json'), 'utf8')).gameId, SECOND);
    child2.kill();
    squatter.close();
  });

  await check('the plugin wrote nothing to stdout but its one JSON-RPC reply (that is the MCP stream)', async () => {
    const lines = childOut.split('\n').filter(Boolean);
    assert.strictEqual(lines.length, 1, childOut);
    assert.strictEqual(JSON.parse(lines[0]).id, 1);
  });

  await check('lost contact with Engage: the door closes by itself, it does not stay open', async () => {
    const live = (await get(`${gw}/?k=${lastReport().key}`));
    assert.strictEqual(live.status, 302);
    apiDown = true;
    await until(async () => { try { await get(`${gw}/`); return false; } catch { return true; } }, 4000);
    apiDown = false;
  });

  child.kill();
  for (const pr of procs) pr.kill();
  api.close();
  console.log(`\n${pass} passed, ${failed} failed`);
  suiteFinished();
  process.exit(failed ? 1 : 0);
})();
