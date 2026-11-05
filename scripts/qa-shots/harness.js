#!/usr/bin/env node
/* New-host / new-participant screenshots of the REAL built bundle against a fake API.
   Pattern from scripts/skins/shoot.js (stub /config.js, index.html fallback, /__api/ fixtures,
   /present moment fixtures).

   Usage (build first: cd src && npm run build):
     node scripts/qa-shots/harness.js [--only <substr>] [--debug]
   Writes PNGs, run-log.txt and contact.html to $SHOTS_OUT (default: <os tmpdir>/engage-shots),
   never into the repo. Scenario data: fake.js. Shot list: jobs.js. See
   docs/handoff/noise-review-2026-11-05.md. */
const fs = require('fs');
const path = require('path');
const http = require('http');
const { chromium, devices } = require('playwright');
const F = require('./fake');

const REPO = path.resolve(__dirname, '..', '..');
const DIST = path.join(REPO, 'src', 'dist');
const PRESENT_FIX = path.join(REPO, 'scripts', 'skins', 'fixtures', 'shoot', 'present');
const OUT = process.env.SHOTS_OUT || path.join(require('os').tmpdir(), 'engage-shots');
fs.mkdirSync(OUT, { recursive: true });
const PORT = 4723;
// A preinstalled browser (Claude Code cloud containers) wins over the repo's playwright's own.
const CHROMIUM = process.env.CHROMIUM_PATH || (fs.existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : '');
const LAUNCH = CHROMIUM ? { executablePath: CHROMIUM } : {};
const ARGS = process.argv.slice(2);
const ONLY = ARGS.includes('--only') ? ARGS[ARGS.indexOf('--only') + 1] : null;
const DEBUG = ARGS.includes('--debug');

// shoot.js's STUB_CONFIG, verbatim
const STUB_CONFIG = (origin) => `window.API_BASE = '${origin}/__api/';
window.WS_URL = 'ws://127.0.0.1:9/';
window.USER_POOL_ID = 'us-east-1_SKINSFIXTURE';
window.USER_POOL_CLIENT_ID = 'skinsfixtureclient';
window.COGNITO_DOMAIN = 'skins-fixture';
window.ENV = 'development';
`;
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.woff2': 'font/woff2', '.ico': 'image/x-icon' };

function serve() {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url, 'http://x');
      if (url.pathname === '/config.js') { res.writeHead(200, { 'content-type': 'text/javascript' }); res.end(STUB_CONFIG(`http://${req.headers.host}`)); return; }
      if (url.pathname.startsWith('/__api/')) { res.writeHead(404, { 'content-type': 'application/json' }); res.end('{"error":"no fixture"}'); return; }
      let file = path.join(DIST, decodeURIComponent(url.pathname));
      if (!file.startsWith(DIST) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(DIST, 'index.html');
      res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' });
      fs.createReadStream(file).pipe(res);
    });
    server.on('error', reject);
    server.listen(PORT, '127.0.0.1', () => resolve(server));
  });
}

// shoot.js's presentFixture: /present?gameId=<moment>
function presentFixture(id) {
  const f = path.join(PRESENT_FIX, `${String(id).split('~')[0]}.json`);
  if (!fs.existsSync(f)) return null;
  const fx = JSON.parse(fs.readFileSync(f, 'utf8'));
  fx.state = { ...fx.state, gameId: id };
  return fx;
}
function presentRespond(p, req) {
  let m; let id = null;
  if ((m = p.match(/^games\/([^/]+)\/state$/))) { const fx = presentFixture(m[1]); return fx && fx.state; }
  if ((m = p.match(/^games\/([^/]+)\/answers$/))) { const fx = presentFixture(m[1]); return fx && (fx.answers || []); }
  if ((m = p.match(/^games\/([^/]+)\/ai-summary$/))) { const fx = presentFixture(m[1]); return fx && fx.summary; }
  if (p === 'games/get-results') { try { id = JSON.parse(req.postData() || '{}').gameId; } catch (_) { /* none */ } const fx = presentFixture(id); return fx && fx.results; }
  return null;
}

async function shot(browser, origin, job, log) {
  const ctxOpts = job.device
    ? { ...devices[job.device], deviceScaleFactor: 2, reducedMotion: 'reduce' }
    : { viewport: job.viewport, deviceScaleFactor: 1, reducedMotion: 'reduce' };
  if (job.device) delete ctxOpts.defaultBrowserType;
  const context = await browser.newContext(ctxOpts);
  const storage = { ...(job.host ? F.cognitoStorage() : {}), ...(job.storage || {}) };
  await context.addInitScript((kv) => { try { for (const [k, v] of Object.entries(kv)) localStorage.setItem(k, v); } catch (_) { /* none */ } }, storage);
  await context.route('**/*', async (route) => {
    const req = route.request();
    const u = new URL(req.url());
    if (u.hostname === '127.0.0.1' && u.pathname.startsWith('/__api/')) {
      const p = u.pathname.replace(/^\/__api\//, '');
      let res = null;
      if (job.present) { const b = presentRespond(p, req); if (b != null) res = { status: 200, body: b }; }
      else res = F.respond(job.scn, req.method(), p, u.searchParams, req.postData());
      if (!res) { log.push(`[${job.name}] 404 ${req.method()} /${p}${u.search}`); return route.fulfill({ status: 404, contentType: 'application/json', body: '{"error":"no fixture"}' }); }
      if (DEBUG) log.push(`[${job.name}] ${res.status} ${req.method()} /${p}${u.search}`);
      return route.fulfill({ status: res.status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(res.body) });
    }
    if (/cognito-idp\..*amazonaws\.com$/.test(u.hostname)) {
      const target = req.headers()['x-amz-target'] || '';
      log.push(`[${job.name}] cognito ${target}`);
      return route.fulfill({ status: 200, contentType: 'application/x-amz-json-1.1', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(F.cognitoRespond(target)) });
    }
    if (u.hostname === '127.0.0.1' || /fonts\.(googleapis|gstatic)\.com$/.test(u.hostname)) return route.continue();
    log.push(`[${job.name}] blocked ${req.url().slice(0, 100)}`);
    return route.abort();
  });
  // A live socket that answers pings: without it every page wears an "Offline. Reconnecting." banner
  // a real participant would not see. State itself arrives over HTTP (the fake API).
  await context.routeWebSocket(/^wss?:\/\//, (ws) => {
    ws.onMessage((msg) => { try { const m = JSON.parse(String(msg)); if (m.action === 'ping') ws.send(JSON.stringify({ type: 'pong' })); } catch (_) { /* ignore */ } });
  });
  const page = await context.newPage();
  if (DEBUG) page.on('console', (m) => { if (m.type() === 'error') log.push(`[${job.name}] console.error ${m.text().slice(0, 200)}`); });
  page.on('pageerror', (e) => log.push(`[${job.name}] PAGEERROR ${String(e).slice(0, 300)}`));
  await page.goto(origin + job.url, { waitUntil: 'load', timeout: 30000 });
  try { await page.waitForLoadState('networkidle', { timeout: 6000 }); } catch (_) { /* sockets retry */ }
  await page.evaluate(() => document.fonts && document.fonts.ready);
  await page.waitForTimeout(job.wait || 1500);
  if (job.act) { try { await job.act(page, job.scn); } catch (e) { log.push(`[${job.name}] ACT FAILED ${String(e.message).split('\n')[0]}`); } await page.waitForTimeout(900); }
  await page.evaluate(() => window.dispatchEvent(new Event('resize')));
  await page.waitForTimeout(500);
  const file = path.join(OUT, `${job.name}.png`);
  await page.screenshot({ path: file, fullPage: !!job.fullPage, animations: 'disabled', caret: 'hide' });
  if (DEBUG) {
    const txt = await page.evaluate(() => document.body.innerText.slice(0, 600).replace(/\s+/g, ' '));
    log.push(`[${job.name}] TEXT ${txt}`);
  }
  await context.close();
  return file;
}

const HOST_VP = { width: 1512, height: 945 };
const LAPTOP_VP = { width: 1512, height: 945 };
const ROOM_VP = { width: 1920, height: 1080 };
const TWO = { 'engage.surfaces': 'two' };
const ONE = { 'engage.surfaces': 'classic' };
const hostUrl = `/host?gameId=${F.GAME}`;
const playUrl = (name) => `/play?gameId=${F.GAME}${name ? `&name=${encodeURIComponent(name)}` : ''}`;

const JOBS = require('./jobs')({ F, HOST_VP, LAPTOP_VP, ROOM_VP, TWO, ONE, hostUrl, playUrl });

async function main() {
  if (!fs.existsSync(path.join(DIST, 'index.html'))) throw new Error('build first: cd src && npm run build');
  const server = await serve();
  const origin = `http://127.0.0.1:${PORT}`;
  const browser = await chromium.launch(LAUNCH);
  const log = []; const done = [];
  try {
    for (const job of JOBS) {
      if (ONLY && !job.name.includes(ONLY)) continue;
      done.push({ ...job, file: await shot(browser, origin, job, log) });
      process.stdout.write(`${job.name}\n`);
    }
  } finally { await browser.close(); server.close(); }
  fs.writeFileSync(path.join(OUT, 'run-log.txt'), [...new Set(log)].join('\n'));
  if (!ONLY) fs.writeFileSync(path.join(OUT, 'contact.html'), require('./contact')(JOBS));
  console.log([...new Set(log)].filter((l) => DEBUG || /404|PAGEERROR|ACT FAILED|blocked/.test(l)).join('\n'));
}
main().catch((e) => { console.error(e); process.exit(1); });
