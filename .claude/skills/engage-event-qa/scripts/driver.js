// Long-lived Playwright driver. Start: QA_DIR=/path/to/scratch node driver.js
// Then POST JS bodies to http://127.0.0.1:9333 (see run.sh). In scope:
//   G (globals; G.host(name,stateFile,vp), G.phone(name,vp), G.b browser, G.log console errors)
//   P (pages by name), shot(page,name), text(page,n), sleep(ms), log(...), S (QA_DIR), BASE
const http = require('http'); const fs = require('fs');
const { chromium } = require(process.env.PLAYWRIGHT || 'playwright');
const S = process.env.QA_DIR || process.cwd(); const BASE = process.env.ENGAGE_BASE || 'https://engage.dev.seibtribe.us';
fs.mkdirSync(S + '/shots', { recursive: true });
let n = 100; const shot = async (p, name) => { const f = `${S}/shots/${++n}-${name}.png`; await p.screenshot({ path: f }); return f; };
const text = async (p, len = 1500) => (await p.innerText('body')).slice(0, len);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const G = { pages: {}, ctxs: {}, log: [], require };
(async () => {
  G.b = await chromium.launch();
  const hook = (p, name) => { p.on('console', (m) => { if (m.type() === 'error') G.log.push(`[${name}] ${m.text().slice(0, 200)}`); }); p.on('pageerror', (e) => G.log.push(`[${name}] PAGEERROR ${e.message.slice(0, 200)}`)); };
  const add = async (name, opts) => { const c = await G.b.newContext(opts); const p = await c.newPage(); hook(p, name); G.ctxs[name] = c; G.pages[name] = p; return p; };
  G.host = (name, state, vp = { width: 1280, height: 800 }) => add(name, { viewport: vp, storageState: `${S}/${state}` });
  G.phone = (name, vp = { width: 390, height: 844 }) => add(name, { viewport: vp, isMobile: vp.width < 900, hasTouch: true, deviceScaleFactor: 2 });
  G.rl = async (names) => { await Promise.all(names.map((x) => G.pages[x].reload().catch(() => {}))); await sleep(7000); };
  http.createServer((q, r) => { let body = ''; q.on('data', (d) => (body += d)); q.on('end', async () => {
    const out = []; const log = (...a) => out.push(a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' '));
    try { const fn = new Function('G', 'P', 'shot', 'text', 'S', 'BASE', 'sleep', 'log', 'fs', `return (async()=>{${body}})()`);
      const res = await fn(G, G.pages, shot, text, S, BASE, sleep, log, fs); if (res !== undefined) log(res);
    } catch (e) { log('ERR', e.message.split('\n').slice(0, 3).join(' | ')); }
    r.end(out.join('\n') + '\n'); }); }).listen(9333, () => console.log('driver up on 9333'));
})();
