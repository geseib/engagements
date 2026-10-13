#!/usr/bin/env node
/**
 * shoot.js — screenshots of a unit's routes in every skin, side by side.
 *
 * Serves src/dist (build it first: cd src && npm run build) from a tiny local server with an
 * index.html fallback and a STUB /config.js whose API_BASE is /__api/ on the same server, so
 * every API call is answered from scripts/skins/fixtures/shoot/ and no real tier is ever
 * called. Chromium from the repo-root playwright (no install).
 *
 * For each skin: localStorage['engage.skin'] is set before the page loads (what the boot
 * script will read after Phase 0d) and document.documentElement.dataset.skin is asserted after load;
 * before 0d no boot script exists, so the attribute is FORCED and the log says so. Before 0a
 * there is no styles/skins/present.css, so Present renders as Classic — expected.
 *
 * Writes docs/design/themes/shots/<unit>/<route>@<w>-<skin>.png (git-ignored) plus
 * index.html (Classic | Present per route and width) and boxes.json: every dialog and menu's
 * getBoundingClientRect at each width, and any box that moves > 0.5px between skins (layout
 * must not move) or overflows the viewport (memory "Dialogs on screen").
 */
const fs = require('fs');
const path = require('path');
const http = require('http');
const C = require('./lib/common');

const FIX = path.join(__dirname, 'fixtures', 'shoot');
const DIST = path.join(C.REPO, 'src', 'dist');
const SHOTS = path.join(C.REPO, 'docs', 'design', 'themes', 'shots');

const HELP = `usage: node scripts/skins/shoot.js (--unit <id> | --routes <list>) [options]

  --unit <id>        routes from docs/design/themes/units.json ("public", "present", "play",
                     "/path", "gallery:<id>" — gallery mounts are skipped until the gallery exists)
  --routes <list>    comma-separated: public | present | present:<moment> | /path?query
  --skins <list>     default: classic,present
  --widths <list>    default: 375,660,1280 (the Presentation also gets 1920x1080 per profile)
  --out <dir>        default: docs/design/themes/shots/<unit or "adhoc">
  --dist <dir>       default: src/dist
  --port <n>         default 4719 (fixed: the lobby prints the origin; baselines must match)
  --selftest         shoot /present (answering) at 375 in classic; assert a PNG and a skin attribute
  --selftest --plant   shoot a moment with no fixture: the self-test must fail
  --help`;

const VIEWPORT_H = { 375: 812, 660: 900, 1280: 800, 1920: 1080 };
const PROFILES = ['room', 'tv', 'call', 'table'];

function loadPlaywright() {
  try { return require(path.join(C.REPO, 'node_modules', 'playwright')); } catch (e) {
    throw new Error('playwright is not in the repo-root node_modules. Do not npm install in a worktree: run from the main checkout, or resolve it from there.');
  }
}

/* ---------- the server ---------- */

const STUB_CONFIG = (origin) => `window.API_BASE = '${origin}/__api/';
window.WS_URL = 'ws://127.0.0.1:9/';
window.USER_POOL_ID = 'us-east-1_SKINSFIXTURE';
window.USER_POOL_CLIENT_ID = 'skinsfixtureclient';
window.COGNITO_DOMAIN = 'skins-fixture';
window.ENV = 'development';
`;

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.woff2': 'font/woff2', '.ico': 'image/x-icon' };

function serve(dist, port) {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url, 'http://x');
      if (url.pathname === '/config.js') {
        res.writeHead(200, { 'content-type': 'text/javascript' });
        res.end(STUB_CONFIG(`http://${req.headers.host}`));
        return;
      }
      if (url.pathname.startsWith('/__api/')) { res.writeHead(404, { 'content-type': 'application/json' }); res.end('{"error":"no fixture"}'); return; }
      let file = path.join(dist, decodeURIComponent(url.pathname));
      if (!file.startsWith(dist) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(dist, 'index.html');
      res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' });
      fs.createReadStream(file).pipe(res);
    });
    // A FIXED port: the origin is printed on the lobby (join URL + QR), so a random port
    // would differ between a baseline run and the next one.
    server.on('error', reject);
    server.listen(port, '127.0.0.1', () => resolve(server));
  });
}

/* ---------- fixtures behind /__api/ ---------- */

function presentFixture(id) {
  const [moment, profile] = String(id).split('~');
  const f = path.join(FIX, 'present', `${moment}.json`);
  if (!fs.existsSync(f)) return null;
  const fx = JSON.parse(fs.readFileSync(f, 'utf8'));
  fx.state = { ...fx.state, gameId: id, stageProfile: profile || fx.state.stageProfile || null };
  return fx;
}

function apiHandler(log) {
  return async (route) => {
    const req = route.request();
    const u = new URL(req.url());
    const p = u.pathname.replace(/^\/__api\//, '');
    let m;
    let body = null;
    if ((m = p.match(/^games\/([^/]+)\/state$/))) { const fx = presentFixture(decodeURIComponent(m[1])); body = fx && fx.state; }
    else if ((m = p.match(/^games\/([^/]+)\/answers$/))) { const fx = presentFixture(decodeURIComponent(m[1])); body = fx && (fx.answers || []); }
    else if ((m = p.match(/^games\/([^/]+)\/ai-summary$/))) { const fx = presentFixture(decodeURIComponent(m[1])); body = fx && fx.summary; }
    else if (p === 'games/get-results') {
      let id = null; try { id = JSON.parse(req.postData() || '{}').gameId; } catch (_) { /* none */ }
      const fx = presentFixture(id); body = fx && fx.results;
    } else {
      const f = path.join(FIX, 'api', `${p.replace(/[^\w-]+/g, '_')}.json`);
      if (fs.existsSync(f)) body = JSON.parse(fs.readFileSync(f, 'utf8'));
    }
    if (body === null || body === undefined) {
      log.push(`404 ${req.method()} /__api/${p}${u.search}`);
      return route.fulfill({ status: 404, contentType: 'application/json', body: '{"error":"no fixture"}' });
    }
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  };
}

/* ---------- routes ---------- */

function routesFor(o) {
  const spec = JSON.parse(fs.readFileSync(path.join(FIX, 'routes.json'), 'utf8'));
  let list = [];
  if (o.unit) {
    const u = require('./lib/manifest').load().find((x) => x.id === o.unit);
    if (!u) throw new Error(`unit ${o.unit} not in units.json`);
    list = u.routes || [];
  }
  if (o.routes) list = list.concat(String(o.routes).split(',').map((s) => s.trim()).filter(Boolean));
  const out = []; const skipped = [];
  for (const r of list) {
    if (r === 'public') spec.public.forEach((p) => out.push({ kind: 'page', path: p }));
    else if (r === 'present') spec.present.forEach((m) => out.push({ kind: 'present', moment: m }));
    else if (r.startsWith('present:')) out.push({ kind: 'present', moment: r.slice(8) });
    else if (r === 'play') { if (!spec.play.length) skipped.push('play: no /play fixtures yet (W6-a adds them)'); spec.play.forEach((p) => out.push({ kind: 'page', path: p })); }
    else if (r.startsWith('gallery:')) skipped.push(`${r}: no skin gallery yet (TOOLING-BRIEF §5.3, owner's yes needed) — rely on classicEquivalence and an owner walk on dev`);
    else if (r.startsWith('/')) out.push({ kind: 'page', path: r });
    else skipped.push(`${r}: unknown route spec`);
  }
  return { routes: out, skipped };
}

const slug = (s) => s.replace(/^\//, '').replace(/[^\w-]+/g, '_') || 'root';

/* ---------- shooting ---------- */

const BOXES = `(() => {
  const sel = '[role=dialog],[role=menu],[role=listbox],dialog[open],[aria-modal=true],.modal,.modal-content';
  return [...document.querySelectorAll(sel)].map((el, i) => {
    const r = el.getBoundingClientRect();
    const id = el.id || el.getAttribute('aria-label') || (el.className && String(el.className).split(' ')[0]) || el.tagName;
    return { key: id + '#' + i, x: r.x, y: r.y, w: r.width, h: r.height, right: r.right, innerWidth: window.innerWidth };
  });
})()`;

async function shootOne(browser, origin, job, skin, width, height, outDir, log) {
  // reduced motion + disabled animations: a phase wipe caught mid-flight is not a skin difference
  const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1, reducedMotion: 'reduce' });
  await context.addInitScript((s) => {
    try { localStorage.setItem('engage.skin', s); } catch (_) { /* private mode */ }
    window.__skinsForced = false;
    document.addEventListener('DOMContentLoaded', () => {
      if (document.documentElement.dataset.skin !== s) { document.documentElement.dataset.skin = s; window.__skinsForced = true; }
    });
  }, skin);
  const page = await context.newPage();
  await page.route(`${origin}/__api/**`, apiHandler(log));
  await page.route(/^https?:\/\/(?!127\.0\.0\.1|fonts\.googleapis\.com|fonts\.gstatic\.com)/, (r) => { log.push(`blocked ${r.request().url().slice(0, 100)}`); return r.abort(); });
  const url = job.kind === 'present'
    ? `${origin}/present?gameId=${encodeURIComponent(job.moment + (job.profile ? `~${job.profile}` : ''))}`
    : `${origin}${job.path}`;
  await page.goto(url, { waitUntil: 'load', timeout: 30000 });
  try { await page.waitForLoadState('networkidle', { timeout: 8000 }); } catch (_) { /* sockets keep trying; fine */ }
  await page.evaluate(() => document.fonts && document.fonts.ready);
  await page.waitForTimeout(1000);
  // the Presentation measures and fits its canvas; refit once more after fonts settle so a
  // late font swap cannot leave a sub-pixel difference between two runs
  await page.evaluate(() => window.dispatchEvent(new Event('resize')));
  await page.waitForTimeout(700);
  const attr = await page.evaluate(() => ({ skin: document.documentElement.dataset.skin || null, forced: !!window.__skinsForced }));
  if (attr.skin !== skin) log.push(`${url}: data-skin is ${attr.skin}, wanted ${skin}`);
  const name = `${job.kind === 'present' ? `present-${job.moment}${job.profile ? `-${job.profile}` : ''}` : slug(job.path)}@${width}-${skin}.png`;
  await page.screenshot({ path: path.join(outDir, name), fullPage: job.kind !== 'present', animations: 'disabled', caret: 'hide' });
  const boxes = await page.evaluate(BOXES);
  await context.close();
  return { name, attr, boxes };
}

async function run(o) {
  const dist = o.dist ? path.resolve(o.dist) : DIST;
  if (!fs.existsSync(path.join(dist, 'index.html'))) throw new Error(`${dist}/index.html missing: cd src && npm run build`);
  const { routes, skipped } = routesFor(o);
  const skins = (o.skins || 'classic,present').split(',');
  const widths = (o.widths || '375,660,1280').split(',').map(Number);
  const outDir = path.resolve(o.out || path.join(SHOTS, o.unit || 'adhoc'));
  fs.mkdirSync(outDir, { recursive: true });
  const { chromium } = loadPlaywright();
  const server = await serve(dist, Number(o.port || 4719));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch();
  const log = []; const shots = [];
  try {
    const jobs = [];
    for (const r of routes) {
      for (const w of widths) jobs.push({ ...r, width: w, height: VIEWPORT_H[w] || 900 });
      if (r.kind === 'present') for (const p of PROFILES) jobs.push({ ...r, profile: p, width: 1920, height: 1080 });
    }
    for (const j of jobs) {
      for (const s of skins) {
        const res = await shootOne(browser, origin, j, s, j.width, j.height, outDir, log);
        shots.push({ ...j, skin: s, ...res });
        process.stdout.write('.');
      }
    }
  } finally {
    await browser.close();
    server.close();
  }
  process.stdout.write('\n');
  const boxReport = compareBoxes(shots, skins);
  fs.writeFileSync(path.join(outDir, 'boxes.json'), JSON.stringify({ moved: boxReport.moved, overflow: boxReport.overflow, shots: shots.map((s) => ({ name: s.name, boxes: s.boxes, skin: s.attr })) }, null, 2));
  fs.writeFileSync(path.join(outDir, 'index.html'), indexHtml(o.unit || 'adhoc', shots, skins, skipped, log, boxReport));
  return { outDir, shots, skipped, log, boxReport };
}

function compareBoxes(shots, skins) {
  const moved = []; const overflow = [];
  const key = (s) => `${s.kind === 'present' ? s.moment + (s.profile || '') : s.path}@${s.width}`;
  const by = {};
  for (const s of shots) (by[key(s)] = by[key(s)] || {})[s.skin] = s;
  for (const [k, group] of Object.entries(by)) {
    const base = group[skins[0]];
    for (const s of Object.values(group)) {
      for (const b of s.boxes) if (b.right > b.innerWidth + 0.5 || b.x < -0.5) overflow.push(`${k} ${s.skin} ${b.key}: x=${b.x.toFixed(1)} right=${b.right.toFixed(1)} innerWidth=${b.innerWidth}`);
      if (s === base) continue;
      for (const b of s.boxes) {
        const o = base.boxes.find((x) => x.key === b.key);
        if (!o) { moved.push(`${k} ${b.key}: only in ${s.skin}`); continue; }
        const d = Math.max(Math.abs(o.x - b.x), Math.abs(o.y - b.y), Math.abs(o.w - b.w), Math.abs(o.h - b.h));
        if (d > 0.5) moved.push(`${k} ${b.key}: moved ${d.toFixed(1)}px between ${skins[0]} and ${s.skin}`);
      }
    }
  }
  return { moved, overflow };
}

function esc(s) { return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

function indexHtml(unit, shots, skins, skipped, log, boxes) {
  const rows = {};
  for (const s of shots) {
    const k = `${s.kind === 'present' ? `/present ${s.moment}${s.profile ? ` (${s.profile})` : ''}` : s.path} @ ${s.width}`;
    (rows[k] = rows[k] || {})[s.skin] = s;
  }
  const forced = shots.some((s) => s.attr.forced);
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Skin shots: ${esc(unit)}</title>
<style>
:root{color-scheme:light dark;--bg:#fff;--fg:#1B2942;--mut:#5E6167;--rule:#ddd}
@media (prefers-color-scheme:dark){:root{--bg:#0F1A2E;--fg:#F4EDE4;--mut:#9BA8BE;--rule:#25375A}}
body{margin:0;padding:16px;background:var(--bg);color:var(--fg);font:14px/1.45 system-ui,sans-serif}
h1{font-size:20px} h2{font-size:15px;margin:28px 0 8px;border-top:1px solid var(--rule);padding-top:12px}
.row{display:grid;grid-template-columns:repeat(${skins.length},minmax(0,1fr));gap:12px}
figure{margin:0} figcaption{color:var(--mut);font-size:12px;margin-bottom:4px}
img{max-width:100%;border:1px solid var(--rule);display:block}
.note{color:var(--mut)} pre{white-space:pre-wrap;font-size:12px}
</style></head><body>
<h1>Skin shots — ${esc(unit)}</h1>
<p class="note">${esc(new Date().toISOString())} · skins ${esc(skins.join(' | '))}${forced ? ' · <strong>data-skin was forced</strong> (no boot script yet: pre-Phase 0d)' : ''}</p>
${boxes.moved.length ? `<h2>Boxes that moved between skins (layout must not move)</h2><pre>${esc(boxes.moved.join('\n'))}</pre>` : '<p class="note">No dialog or menu box moved between skins.</p>'}
${boxes.overflow.length ? `<h2>Boxes off screen</h2><pre>${esc(boxes.overflow.join('\n'))}</pre>` : ''}
${skipped.length ? `<h2>Not shot</h2><pre>${esc(skipped.join('\n'))}</pre>` : ''}
${Object.entries(rows).map(([k, g]) => `<h2>${esc(k)}</h2><div class="row">${skins.map((s) => (g[s] ? `<figure><figcaption>${esc(s)}</figcaption><img loading="lazy" src="${esc(g[s].name)}" alt="${esc(`${k} in ${s}`)}"></figure>` : '<figure></figure>')).join('')}</div>`).join('\n')}
${log.length ? `<h2>Run log</h2><pre>${esc([...new Set(log)].join('\n'))}</pre>` : ''}
</body></html>`;
}

async function selftest(plant) {
  const out = C.tmpDir('shoot');
  let res; let err = null;
  try { res = await run({ routes: plant ? 'present:no-such-moment' : 'present:answering', skins: 'classic', widths: '375', out }); } catch (e) { err = e.message; }
  const cases = [
    ['the run completes', () => C.assert(!err, err)],
    ['a PNG is written for each viewport (375 + four 1920 profiles)', () => C.assert(fs.readdirSync(out).filter((f) => f.endsWith('.png')).length === 5, fs.readdirSync(out).join(' '))],
    ['<html data-skin> is classic after load', () => C.assert(res.shots.every((s) => s.attr.skin === 'classic'), JSON.stringify(res.shots.map((s) => s.attr)))],
    ['the Presentation read the fixture (no 404 for its state)', () => C.assert(!res.log.some((l) => /state/.test(l) && /^404/.test(l)), res.log.join('\n'))],
    ['index.html and boxes.json are written', () => C.assert(fs.existsSync(path.join(out, 'index.html')) && fs.existsSync(path.join(out, 'boxes.json')), 'missing')],
  ];
  C.selftest('shoot', cases);
}

async function main() {
  const o = C.args();
  if (o.help) { console.log(HELP); return; }
  if (o.selftest) { await selftest(!!o.plant); return; }
  if (!o.unit && !o.routes) { console.log(HELP); process.exit(2); }
  try {
    const res = await run(o);
    console.log(`${res.shots.length} shot(s) -> ${path.relative(C.REPO, res.outDir)}/index.html`);
    if (res.skipped.length) console.log(`not shot:\n  ${res.skipped.join('\n  ')}`);
    if (res.boxReport.moved.length) console.log(`MOVED between skins:\n  ${res.boxReport.moved.join('\n  ')}`);
    if (res.boxReport.overflow.length) console.log(`OFF SCREEN:\n  ${res.boxReport.overflow.join('\n  ')}`);
    const n404 = [...new Set(res.log.filter((l) => l.startsWith('404')))];
    if (n404.length) console.log(`unanswered API calls (add fixtures under scripts/skins/fixtures/shoot/api/):\n  ${n404.slice(0, 20).join('\n  ')}`);
    if (res.boxReport.moved.length) process.exitCode = 1;
  } catch (e) {
    console.error(e.message);
    process.exit(2);
  }
}

main();
