#!/usr/bin/env node
/**
 * BUILD ROOM REMOTE SHARE, TASK 0: what a Cloudflare quick tunnel really does.
 * docs/superpowers/plans/2026-10-16-build-room-remote-share.md, Task 0.
 *
 * Run on a laptop with internet (not the cloud container: its proxy refuses
 * github.com and Cloudflare). Needs Node 18+ and nothing else. Writes nothing
 * outside a temporary folder, which it deletes, and prints a report:
 *
 *   node docs/design/build-room-remote-share/spike.mjs > spike-report.md
 *
 * Paste spike-report.md back into the session. Takes about 3 minutes.
 *
 * What it does:
 *   1. Reads cloudflared's latest release; downloads the five assets the
 *      plugin will pin; computes their SHA-256 here and compares with
 *      GitHub's own digest.
 *   2. Starts a tiny local server (http + a websocket upgrade), opens one
 *      quick tunnel to it, records the exact line carrying the address and
 *      how long until the address answers.
 *   3. Opens FOUR tunnels at once, then closes and reopens them three times
 *      within a minute, recording any refusal.
 *   4. Through one tunnel: a websocket upgrade, and which client-address
 *      headers arrive. And what a visitor gets when the local server is down.
 *
 * SPIKE_FAKE_CLOUDFLARED=<path> skips the downloads and runs that program
 * instead (how this script was tested without network).
 */
import { createHash, randomBytes } from 'node:crypto';
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync, chmodSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir, platform, arch } from 'node:os';
import { join } from 'node:path';
import http from 'node:http';
import https from 'node:https';

const ASSETS = ['cloudflared-darwin-arm64.tgz', 'cloudflared-darwin-amd64.tgz', 'cloudflared-linux-amd64', 'cloudflared-linux-arm64', 'cloudflared-windows-amd64.exe'];
const ADDRESS_RE = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/;
const FAKE = process.env.SPIKE_FAKE_CLOUDFLARED || '';
const dir = mkdtempSync(join(tmpdir(), 'engage-spike-'));
const out = [];
const say = (s = '') => out.push(s);
const t0 = () => Date.now();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const children = new Set();

function cleanup() {
  for (const c of children) { try { c.kill('SIGTERM'); } catch {} }
  try { rmSync(dir, { recursive: true, force: true }); } catch {}
}
process.on('exit', cleanup);
process.on('SIGINT', () => { cleanup(); process.exit(130); });

// ── 1. The release and its hashes ─────────────────────────────────────────
async function release() {
  const r = await fetch('https://api.github.com/repos/cloudflare/cloudflared/releases/latest', { headers: { 'User-Agent': 'engage-spike' } });
  if (!r.ok) throw new Error(`GitHub API ${r.status}`);
  return r.json();
}

async function download(url, file) {
  const r = await fetch(url, { headers: { 'User-Agent': 'engage-spike' }, redirect: 'follow' });
  if (!r.ok) throw new Error(`${r.status} for ${url}`);
  const buf = Buffer.from(await r.arrayBuffer());
  writeFileSync(file, buf);
  return { sha256: createHash('sha256').update(buf).digest('hex'), bytes: buf.length };
}

function ownAsset() {
  const a = arch() === 'arm64' ? 'arm64' : 'amd64';
  if (platform() === 'darwin') return `cloudflared-darwin-${a}.tgz`;
  if (platform() === 'linux') return `cloudflared-linux-${a}`;
  if (platform() === 'win32') return 'cloudflared-windows-amd64.exe';
  throw new Error(`no asset for ${platform()} ${arch()}`);
}

async function getBinary() {
  if (FAKE) { say('_SPIKE_FAKE_CLOUDFLARED set: downloads skipped, a stand-in runs. Not a real result._'); return FAKE; }
  const rel = await release();
  say(`## 1. Release`);
  say(`Version **${rel.tag_name}**, published ${rel.published_at}.`);
  say('');
  say('| Asset | Bytes | SHA-256 computed here | GitHub digest | Match |');
  say('|---|---|---|---|---|');
  const files = {};
  for (const name of ASSETS) {
    const asset = (rel.assets || []).find((x) => x.name === name);
    if (!asset) { say(`| ${name} | – | missing from the release | | ✗ |`); continue; }
    const file = join(dir, name);
    const got = await download(asset.browser_download_url, file);
    const digest = String(asset.digest || '').replace(/^sha256:/, '');
    const inBody = String(rel.body || '').includes(got.sha256);
    say(`| ${name} | ${got.bytes} | \`${got.sha256}\` | ${digest ? `\`${digest}\`` : '(none)'} | ${digest ? (digest === got.sha256 ? '✓' : '✗') : ''}${inBody ? ' (also in release notes)' : ''} |`);
    files[name] = file;
  }
  const mine = ownAsset();
  if (!files[mine]) throw new Error(`could not get ${mine}`);
  let bin = files[mine];
  if (mine.endsWith('.tgz')) {
    const x = join(dir, 'x');
    execFileSync('mkdir', ['-p', x]);
    execFileSync('tar', ['-xzf', bin, '-C', x]);
    const found = readdirSync(x).find((n) => n.startsWith('cloudflared'));
    if (!found) throw new Error('no cloudflared inside the .tgz');
    bin = join(x, found);
  }
  if (platform() !== 'win32') chmodSync(bin, 0o755);
  say('');
  say(`This laptop: ${platform()} ${arch()}, ran \`${mine}\`.`);
  return bin;
}

// ── A tiny origin: echoes headers; answers a websocket upgrade ────────────
function origin() {
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, headers: req.headers }));
  });
  server.on('upgrade', (req, socket) => {
    const accept = createHash('sha1').update(`${req.headers['sec-websocket-key']}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest('base64');
    socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
    socket.end();
  });
  return new Promise((r) => server.listen(0, '127.0.0.1', () => r({ server, port: server.address().port })));
}

// ── One tunnel ─────────────────────────────────────────────────────────────
function openTunnel(bin, port) {
  return new Promise((resolve) => {
    const start = t0();
    const c = spawn(bin, ['tunnel', '--no-autoupdate', '--url', `http://127.0.0.1:${port}`], { stdio: ['ignore', 'pipe', 'pipe'] });
    children.add(c);
    const lines = [];
    let done = false;
    const finish = (v) => { if (!done) { done = true; resolve({ ...v, child: c, lines, ms: t0() - start }); } };
    const onData = (stream) => (b) => {
      for (const l of String(b).split(/\r?\n/)) {
        if (!l.trim()) continue;
        lines.push(`[${stream}] ${l}`);
        const m = ADDRESS_RE.exec(l);
        if (m) finish({ address: m[0], line: `[${stream}] ${l}` });
      }
    };
    c.stdout.on('data', onData('stdout'));
    c.stderr.on('data', onData('stderr'));
    c.on('exit', (code) => { children.delete(c); finish({ error: `exited with ${code} before an address` }); });
    setTimeout(() => finish({ error: 'no address after 60 s' }), 60000);
  });
}

function close(t) { if (t && t.child) { try { t.child.kill('SIGTERM'); } catch {} children.delete(t.child); } }

function get(url) {
  const lib = url.startsWith('https:') ? https : http;
  return new Promise((resolve) => {
    const req = lib.get(url, { timeout: 15000 }, (res) => {
      let body = ''; res.on('data', (d) => { body += d; }); res.on('end', () => resolve({ status: res.statusCode, body }));
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', (e) => resolve({ status: 0, body: e.message }));
  });
}

/** How long until the address answers 200 (Cloudflare's DNS can lag the address line). */
async function untilAnswers(address, limitMs = 60000) {
  const start = t0();
  let last = null;
  while (t0() - start < limitMs) {
    last = await get(`${address}/hello`);
    if (last.status === 200) return { ms: t0() - start, last };
    await sleep(1000);
  }
  return { ms: null, last };
}

function wsUpgrade(address) {
  const u = new URL(address);
  const lib = u.protocol === 'https:' ? https : http;
  return new Promise((resolve) => {
    const req = lib.request({ host: u.hostname, port: u.port || (u.protocol === 'https:' ? 443 : 80), path: '/ws', headers: { Connection: 'Upgrade', Upgrade: 'websocket', 'Sec-WebSocket-Version': '13', 'Sec-WebSocket-Key': randomBytes(16).toString('base64') }, timeout: 15000 });
    req.on('upgrade', (res, socket) => { socket.destroy(); resolve(`101 (upgrade passed through)`); });
    req.on('response', (res) => resolve(`${res.statusCode} (no upgrade)`));
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', (e) => resolve(`error: ${e.message}`));
    req.end();
  });
}

// ── Run ────────────────────────────────────────────────────────────────────
async function main() {
  say('# Remote share spike report');
  say(`Run ${new Date().toISOString()} on ${platform()} ${arch()}, Node ${process.version}.`);
  say('');
  const bin = await getBinary();
  try { say(`\`${execFileSync(bin, ['--version'], { encoding: 'utf8' }).trim()}\``); } catch (e) { say(`--version failed: ${e.message}`); }
  const o = await origin();

  say(''); say('## 2. One tunnel');
  const one = await openTunnel(bin, o.port);
  if (one.error) {
    say(`**Failed:** ${one.error}. Output:`); say('```'); say(one.lines.slice(-30).join('\n')); say('```');
  } else {
    say(`Address line after ${one.ms} ms:`); say('```'); say(one.line); say('```');
    const a = await untilAnswers(one.address);
    say(a.ms === null ? `**Never answered 200** in 60 s; last: ${a.last.status} ${a.last.body.slice(0, 200)}` : `Answered 200 after a further **${a.ms} ms**.`);
    say(''); say('## 4. Through that tunnel');
    say(`- Websocket upgrade: **${await wsUpgrade(one.address)}**`);
    const h = await get(`${one.address}/headers`);
    let headers = {};
    try { headers = JSON.parse(h.body).headers || {}; } catch {}
    const addrHeaders = Object.keys(headers).filter((k) => /^(cf-|x-forwarded|x-real-ip|true-client-ip|cdn-loop)/.test(k)).sort();
    say(`- Client-address headers the origin received: ${addrHeaders.map((k) => `\`${k}\``).join(', ') || '(none)'}`);
    say(`- \`cf-connecting-ip\` present: **${'cf-connecting-ip' in headers ? 'yes' : 'no'}**`);
    o.server.close(); await sleep(500);
    const down = await get(`${one.address}/down`);
    say(`- With the local server stopped, a visitor gets: **${down.status}** \`${down.body.replace(/\s+/g, ' ').slice(0, 160)}\``);
    say(''); say('Full output of this tunnel (last 40 lines):'); say('```'); say(one.lines.slice(-40).join('\n')); say('```');
  }
  close(one);

  say(''); say('## 3. Four at once, then reopened three times');
  const o2 = await origin();
  say('| Round | Opened | Slowest address (ms) | All answered 200 | Errors |');
  say('|---|---|---|---|---|');
  const started = t0();
  for (let round = 1; round <= 4; round += 1) {
    const four = await Promise.all([0, 1, 2, 3].map(() => openTunnel(bin, o2.port)));
    const ok = four.filter((t) => t.address);
    const answered = await Promise.all(ok.map((t) => untilAnswers(t.address, 45000)));
    const errs = four.filter((t) => t.error).map((t) => `${t.error}: ${(t.lines.filter((l) => /err|fail|429|limit|too many/i.test(l)).slice(-2).join(' / ') || '').slice(0, 200)}`);
    say(`| ${round === 1 ? '1 (first four)' : `${round} (reopen ${round - 1})`} | ${ok.length}/4 | ${ok.length ? Math.max(...ok.map((t) => t.ms)) : '–'} | ${answered.every((a) => a.ms !== null) && ok.length === 4 ? 'yes' : `no (${answered.filter((a) => a.ms !== null).length})`} | ${errs.join('; ') || '–'} |`);
    four.forEach(close);
    await sleep(2000);
  }
  say(''); say(`Rounds 2–4 opened within ${Math.round((t0() - started) / 1000)} s of the first.`);
  o2.server.close();
}

main().then(() => { console.log(out.join('\n')); cleanup(); process.exit(0); })
  .catch((e) => { say(''); say(`**Stopped:** ${e && e.stack ? e.stack.split('\n').slice(0, 3).join(' | ') : e}`); console.log(out.join('\n')); cleanup(); process.exit(1); });
