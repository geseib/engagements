// REMOTE SHARE, end to end in a real browser (docs/design/build-room-remote-share).
// The host shares the demo, opens it to people who are not here, a phone opens it
// through the "tunnel", a second device uses the same person's link, and Cloudflare
// refuses once. Screenshots of each state into OUT.
//
// No network: cloudflared is the stand-in from tests/engage-cloudflared-fetch.js, a
// fake public DNS answers here, and the browser's requests to the tunnel's address
// are routed to the stand-in. Everything else is real: the plugin, the gateway, the
// build-room handler (server.js) and the built frontend.
//
//   cd src && npm run build && cd ..
//   node scripts/build-room-demo/server.js &
//   node scripts/build-room-demo/remote-e2e.js /tmp/remote-shots
const { chromium } = require('@playwright/test');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { hostPage } = require('./host');
const { phone } = require('./phones');
const { mcp } = require('./mcp-client');

const OUT = process.argv[2] || fs.mkdtempSync(path.join(os.tmpdir(), 'remote-shots-'));
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const shot = (p, n, full = false) => p.screenshot({ path: path.join(OUT, `${n}.png`), fullPage: full });
const say = (s) => console.log(`[remote-e2e] ${s}`);
async function until(fn, ms = 30000, label = 'condition') {
  const end = Date.now() + ms;
  for (;;) { try { if (await fn()) return; } catch { /* keep trying */ } if (Date.now() > end) throw new Error(`timed out: ${label}`); await sleep(400); }
}

// ── The project: a small demo app Claude "built", served from its own folder ──
const work = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'remote-demo-')));
const project = path.join(work, 'project'); fs.mkdirSync(path.join(project, 'demo'), { recursive: true });
fs.writeFileSync(path.join(project, 'demo', 'index.html'), `<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><title>Pick a shift</title>
<body style="margin:0;font-family:system-ui;background:#F4EFE6;color:#1F3B2D;padding:28px">
<div style="letter-spacing:.2em;font-size:13px;opacity:.75">EASTSIDE FOOD BANK</div>
<h1 style="font-size:34px;margin:.3em 0">Saturday 9-12 · 4 spots left</h1>
<p style="font-size:18px">See a shift, tap it, done. No account needed.</p>
<a style="display:inline-block;margin-top:14px;background:#1F3B2D;color:#F4EFE6;font-size:20px;padding:14px 26px;border-radius:12px">Pick a shift</a></body>`);
fs.writeFileSync(path.join(project, 'serve.js'), "const h=require('http'),f=require('fs'),p=require('path');h.createServer((q,s)=>{const u=decodeURIComponent(q.url.split('?')[0]);const file=p.join(__dirname,u.endsWith('/')?u+'index.html':u);if(!file.startsWith(__dirname)||!f.existsSync(file)){s.writeHead(404);return s.end('no');}s.writeHead(200,{'Content-Type':'text/html'});f.createReadStream(file).pipe(s);}).listen(0,'127.0.0.1',function(){console.log('PORT '+this.address().port)});");

// ── The stand-in cloudflared and a fake public DNS ──
const tools = path.join(work, 'tools'); fs.mkdirSync(tools);
const MODE = path.join(tools, 'mode'); fs.writeFileSync(MODE, 'ok');
const CF_PORT = 47800 + Math.floor(Math.random() * 100);
fs.writeFileSync(path.join(tools, 'fake.js'), `
const fs = require('fs'); const http = require('http');
const mode = fs.readFileSync(process.env.FAKE_CF_MODE_FILE, 'utf8').trim();
const a = process.argv; const target = new URL(a[a.indexOf('--url') + 1]);
if (mode === '429') { process.stderr.write('quick tunnel provisioning failed with status 429\\n'); process.exit(1); }
const s = http.createServer((req, res) => {
  const up = http.request({ host: target.hostname, port: target.port, path: req.url, method: req.method, headers: req.headers }, (r) => { res.writeHead(r.statusCode, r.headers); r.pipe(res); });
  up.on('error', () => { res.writeHead(502); res.end('error code: 502'); }); req.pipe(up);
});
s.on('error', (e) => { if (e.code === 'EADDRINUSE') setTimeout(() => s.listen(Number(process.env.FAKE_CF_PORT), '127.0.0.1'), 200); });
s.on('listening', () => process.stderr.write('INF |  https://fake-tunnel-name.trycloudflare.com  |\\n'));
s.listen(Number(process.env.FAKE_CF_PORT), '127.0.0.1');`);
const cf = path.join(tools, 'cloudflared'); fs.writeFileSync(cf, `#!/bin/sh\nexec "${process.execPath}" "${path.join(tools, 'fake.js')}" "$@"\n`); fs.chmodSync(cf, 0o755);
const dns = http.createServer((q, s) => { s.setHeader('Content-Type', 'application/dns-json'); s.end(JSON.stringify({ Status: 0, Answer: [{ type: 1, data: '127.0.0.1' }] })); });

(async () => {
  await new Promise((r) => dns.listen(0, '127.0.0.1', r));
  const app = spawn(process.execPath, ['serve.js'], { cwd: project, stdio: ['ignore', 'pipe', 'inherit'] });
  let appPort = 0; app.stdout.on('data', (d) => { const m = /PORT (\d+)/.exec(String(d)); if (m) appPort = Number(m[1]); });
  await until(() => appPort, 5000, 'demo app');
  const demoUrl = `http://localhost:${appPort}/demo/index.html`;

  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const host = await hostPage(browser, 1440, 900);
  await host.goto('http://localhost:8790/build');
  await host.getByLabel('Title').fill('Volunteer sign-up for the food bank');
  await host.getByLabel(/Goal/).fill('A one-page site where a volunteer can pick a shift in under a minute, on a phone.');
  await host.getByRole('button', { name: 'Create room' }).click();
  await host.waitForURL(/gameId=/); const GAME = new URL(host.url()).searchParams.get('gameId');
  await host.getByRole('button', { name: 'Connect Claude Code' }).first().click();
  await host.getByRole('button', { name: 'Mint a key' }).click(); await sleep(800);
  const key = (/eng_\d{4}_[A-Za-z0-9_-]{43}/.exec(await host.innerText('body')) || [])[0];
  await host.getByRole('button', { name: 'Done' }).click();
  say(`room ${GAME}, demo at ${demoUrl}`);

  const claude = mcp(key, {
    CLAUDE_PROJECT_DIR: project, HOME: work, ENGAGE_ALLOW_LOCAL_API: '1', ENGAGE_LAN_ADDRESS: '127.0.0.1',
    ENGAGE_LAN_FAST_MS: '1000', ENGAGE_LAN_IDLE_MS: '1000', ENGAGE_CLOUDFLARED: cf, ENGAGE_DOH_URL: `http://127.0.0.1:${dns.address().port}/dns-query`,
    ENGAGE_TUNNEL_PROBE: `http://127.0.0.1:${CF_PORT}`, ENGAGE_TUNNEL_RETRY_MS: '3000', FAKE_CF_MODE_FILE: MODE, FAKE_CF_PORT: String(CF_PORT),
  });
  await claude.init();
  say(`connect: ${(await claude.call('connect', {})).split('\n')[0]}`);
  say(`post_update: ${(await claude.call('post_update', { kind: 'showing', text: 'The shift page is up: calendar first, one big button.', link: demoUrl, role: 'demo' })).split('\n')[0]}`);

  // The release gate (§2c): the host lets Claude's post through, if it is held.
  await host.reload(); await sleep(2500);
  const release = host.getByRole('button', { name: /Release to the room/ }).first();
  if (await release.count()) { await release.click(); await sleep(1000); say('released Claude\'s post'); }

  // Share demo on Wi-Fi.
  const chip = host.locator('button.brm-wifi').first();
  await chip.click(); await sleep(500);
  await host.getByRole('dialog', { name: 'Share demo' }).getByRole('button', { name: 'Share demo' }).click();
  await until(async () => /Demo shared on this Wi-Fi/.test(await host.innerText('body')), 30000, 'Wi-Fi share live');
  await sleep(500);
  const panel = host.getByRole('dialog', { name: 'Share demo' });
  if (!(await panel.count())) { await chip.click(); await sleep(400); }
  await shot(host, '01-host-R1-switch-off');
  say('R1: the switch, off');

  // Remote on: starting, then live.
  await host.getByRole('switch', { name: 'Also open it to people who are not here' }).click();
  await sleep(1200);
  await shot(host, '02-host-R3-starting');
  say('R3: starting');
  await until(async () => { await host.reload(); await sleep(1500); return /Demo shared, here and remote/.test(await host.innerText('body')) || (await host.locator('button.brm-wifi').first().click().then(async () => { await sleep(400); return /Demo shared, here and remote/.test(await host.innerText('body')); })); }, 60000, 'remote live');

  // A phone, "on mobile data": the tunnel's address goes to the stand-in.
  // Playwright routes a request but not the redirect that follows it (it would go
  // to the network), so the gateway's redirect is followed here: its cookies are
  // stored for the tunnel's address, as a browser would, and the page it points to
  // is fetched with them.
  const TUNNEL = 'fake-tunnel-name.trycloudflare.com';
  const routeTunnel = async (ctx) => ctx.route(`https://${TUNNEL}/**`, async (route) => {
    const u = new URL(route.request().url());
    const res = await route.fetch({ url: `http://127.0.0.1:${CF_PORT}${u.pathname}${u.search}`, maxRedirects: 0 });
    if (res.status() !== 302) return route.fulfill({ status: res.status(), headers: res.headers(), body: await res.body() });
    const set = res.headersArray().filter((h) => h.name.toLowerCase() === 'set-cookie').map((h) => h.value.split(';')[0]);
    await ctx.addCookies(set.map((kv) => ({ name: kv.slice(0, kv.indexOf('=')), value: kv.slice(kv.indexOf('=') + 1), domain: TUNNEL, path: '/', secure: true, httpOnly: true })));
    const cookie = [route.request().headers().cookie, ...set].filter(Boolean).join('; ');
    const next = await route.fetch({ url: `http://127.0.0.1:${CF_PORT}${res.headers().location}`, headers: { ...route.request().headers(), cookie }, maxRedirects: 0 });
    return route.fulfill({ status: next.status(), headers: next.headers(), body: await next.body() });
  });
  const priya = await phone(browser, GAME, 'Priya');
  await routeTunnel(priya.context());
  await until(async () => { await priya.reload(); await sleep(2000); const b = priya.getByRole('button', { name: /^Rejoin as/ }); if (await b.count()) { await b.click(); await sleep(2000); } return (await priya.getByRole('link', { name: 'Open the demo ↗' }).count()) > 0; }, 40000, 'phone button');
  await shot(priya, '03-phone-R4a-open-the-demo');
  say('R4 (a): the phone\'s button');
  const link = await priya.getByRole('link', { name: 'Open the demo ↗' }).getAttribute('href');
  say(`Priya's link: ${link.replace(/k=[^&#]+/, 'k=…')}`);
  const [opened] = await Promise.all([priya.context().waitForEvent('page'), priya.getByRole('link', { name: 'Open the demo ↗' }).click()]);
  await opened.waitForLoadState(); await sleep(1500);
  await shot(opened, '04-phone-demo-opened-through-the-tunnel');
  say(`the demo through the tunnel: ${(await opened.innerText('body')).split('\n')[1]}`);
  await shot(priya, '05-phone-R4d-didnt-open');

  // The same link pasted into a laptop browser: a second device on Priya's key.
  const laptopCtx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await routeTunnel(laptopCtx);
  const laptop = await laptopCtx.newPage();
  await laptop.goto(link); await sleep(1500);
  const laptopSees = (await laptop.innerText('body')).split('\n')[1];
  say(`a second device with Priya's link: ${laptopSees}`);
  // And a stranger with the bare address: the locked page.
  const strangerCtx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await routeTunnel(strangerCtx);
  const stranger = await strangerCtx.newPage();
  await stranger.goto('https://fake-tunnel-name.trycloudflare.com/demo/index.html'); await sleep(800);
  await shot(stranger, '06-stranger-locked-page');
  say(`a stranger with the bare address: ${(await stranger.innerText('body')).split('\n')[0]}`);

  await sleep(3500);
  await until(async () => { await host.reload(); await sleep(1500); await host.locator('button.brm-wifi').first().click(); await sleep(500); return /2 devices/.test(await host.innerText('body')); }, 30000, 'two devices on the host panel');
  await shot(host, '07-host-R2-who-opened-it');
  say('R2: who opened it');

  // Cloudflare refuses once: off, then on again with the stand-in answering 429.
  fs.writeFileSync(MODE, '429');
  await host.getByRole('switch', { name: 'Also open it to people who are not here' }).click(); await sleep(2500);
  await host.getByRole('switch', { name: 'Also open it to people who are not here' }).click();
  await until(async () => { await host.reload(); await sleep(1500); await host.locator('button.brm-wifi').first().click(); await sleep(500); return /not giving out new remote links/.test(await host.innerText('body')); }, 40000, 'refused');
  await shot(host, '08-host-R3-failed');
  say('R3: failed');

  await browser.close(); claude.close(); app.kill(); dns.close();
  say(`screenshots in ${OUT}`);
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
