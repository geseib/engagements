/**
 * The Build Room MCP server (src/public/engage-mcp.mjs), driven over stdio.
 *
 * The host runs this file under their own Claude Code, so the only contract
 * that matters is the wire: newline-delimited JSON-RPC on stdin/stdout, and
 * the HTTP calls it makes to /games/{gameId}/build/*. This suite starts a fake
 * Engage API on an ephemeral port, spawns the real script against it, and
 * speaks MCP to it exactly as Claude Code would.
 *
 * Stdout is checked line by line: a single stray console.log in the server
 * corrupts the MCP stream for the client, so anything non-JSON there fails.
 */
const suiteFinished = require('./helpers/finish-guard');
const assert = require('assert');
const http = require('http');
const path = require('path');
const { spawn } = require('child_process');

const SCRIPT = path.join(__dirname, '..', 'src', 'public', 'engage-mcp.mjs');
const KEY = 'eng_4321_s3cr3tS3cr3t';

let pass = 0, fail = 0;
async function check(label, fn) {
  try { await fn(); console.log(`  PASS  ${label}`); pass++; }
  catch (e) { console.log(`  FAIL  ${label}\n        ${e && e.stack ? e.stack.split('\n').slice(0, 3).join('\n        ') : e}`); fail++; }
}

// ---------------------------------------------------------------- fake API --

const requests = [];
let askPolls = 0;
let failNext401 = false;

const choiceAsk = (status) => ({
  askId: '003', kind: 'choice', prompt: 'Which header?', detail: 'Two directions', status, source: 'agent',
  options: [
    { label: 'A', title: 'Bold dark hero', detail: 'Big type', url: null },
    { label: 'B', title: 'Light minimal', detail: 'Calm', url: 'https://example.com/b' },
  ],
  maxPicks: 1,
  results: {
    total: 5,
    options: [
      { label: 'A', title: 'Bold dark hero', count: 2, pct: 40, voters: [] },
      { label: 'B', title: 'Light minimal', count: 3, pct: 60, voters: [] },
    ],
    whys: [{ label: 'B', text: 'easier to read', playerName: 'Ana' }],
  },
  decision: status === 'decided'
    ? { direction: 'Go with B, but keep the logo from A and make the CTA bigger', chosen: ['B'], note: 'room said bigger CTA', decidedAt: 'x' }
    : null,
});

let inboxPolls = 0;
const server = http.createServer((req, res) => {
  let raw = '';
  req.on('data', c => { raw += c; });
  req.on('end', () => {
    const rec = { method: req.method, url: req.url, auth: req.headers.authorization, body: raw ? JSON.parse(raw) : undefined };
    requests.push(rec);
    const send = (status, obj) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
    if (failNext401) { failNext401 = false; return send(401, { error: 'Key revoked' }); }
    const p = req.url.replace(/^\/dev\/games\/4321\/build\//, '');
    if (req.method === 'GET' && p === 'state') {
      return send(200, {
        gameId: '4321', title: 'Launch site', goal: 'Build a landing page for the meetup', state: 'STARTED',
        players: ['Ana', 'Bo'], playerCount: 2, settings: { reviewAgentAsks: true },
        currentAskId: '003',
        asks: [{ askId: '001', kind: 'suggest', prompt: 'Name?', status: 'decided', decision: { direction: 'Call it Summit' } },
          choiceAsk('live')],
        log: [{ logId: 'l1', kind: 'progress', text: 'Scaffolded the app', by: 'agent' },
          { logId: 'l2', kind: 'note', text: 'HOST SECRET NOTE', by: 'host' }],
        ideas: [], outcome: null, rev: 7,
        inbox: [],
      });
    }
    if (req.method === 'POST' && p === 'asks') {
      return send(200, { ask: { ...choiceAsk('proposed'), results: { total: 0 } }, inbox: [] });
    }
    if (req.method === 'GET' && p === 'asks/003') {
      askPolls++;
      return send(200, { ask: choiceAsk(askPolls >= 3 ? 'decided' : 'live'), inbox: [] });
    }
    if (req.method === 'GET' && p === 'inbox?listening=1') {
      inboxPolls++;
      return send(200, { inbox: inboxPolls >= 3 ? [{ id: 'd7', text: 'Make the button green', from: 'host', askId: null, createdAt: 'now' }] : [] });
    }
    if (req.method === 'POST' && p === 'log') {
      return send(200, {
        entry: { logId: 'l9', kind: rec.body.kind, text: rec.body.text },
        inbox: [{ id: 'd1', text: 'The room says the colours are too dark', from: 'host', askId: null, createdAt: 'now' }],
      });
    }
    return send(404, { error: `no route ${req.method} ${p}` });
  });
});

// ------------------------------------------------------------- MCP client --

function startChild(api) {
  const child = spawn(process.execPath, [SCRIPT], {
    env: { ...process.env, ENGAGE_API: api, ENGAGE_KEY: KEY, ENGAGE_POLL_MS: '50' },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const pending = new Map();
  const nonJson = [];
  const notifications = [];
  const unsolicited = [];
  let buf = '';
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', chunk => {
    buf += chunk;
    let nl;
    while ((nl = buf.indexOf('\n')) !== -1) {
      const line = buf.slice(0, nl); buf = buf.slice(nl + 1);
      let msg;
      try { msg = JSON.parse(line); } catch { nonJson.push(line); continue; }
      if (msg.id !== undefined && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
      else if (msg.method) notifications.push(msg);
      else unsolicited.push(msg);
    }
  });
  child.stderr.on('data', () => {});
  let nextId = 1;
  const request = (method, params, timeoutMs = 4000) => new Promise((resolve, reject) => {
    const id = nextId++;
    const t = setTimeout(() => { pending.delete(id); reject(new Error(`timeout waiting for ${method}`)); }, timeoutMs);
    pending.set(id, msg => { clearTimeout(t); resolve(msg); });
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
  });
  const notify = (method, params) => child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n');
  return { child, request, notify, nonJson, notifications, unsolicited };
}

const textOf = (r) => r.result.content.map(c => c.text).join('\n');

// ------------------------------------------------------------------ suite --

let mcp;
const hardStop = setTimeout(() => {
  console.log('  FAIL  suite exceeded 10s');
  if (mcp) mcp.child.kill('SIGKILL');
  process.exit(1);
}, 10000);

(async () => {
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const API = `http://127.0.0.1:${server.address().port}/dev`; // no trailing slash on purpose
  mcp = startChild(API);

  console.log('\n1. handshake');
  await check('initialize echoes a supported protocol and carries instructions', async () => {
    const r = await mcp.request('initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 't', version: '0' } });
    assert.strictEqual(r.result.protocolVersion, '2025-03-26');
    assert.deepStrictEqual(r.result.serverInfo.name, 'engage');
    assert.ok(r.result.capabilities.tools && r.result.capabilities.prompts);
    assert.ok(typeof r.result.instructions === 'string' && r.result.instructions.length > 200);
    assert.ok(/wrap_up/.test(r.result.instructions) && /final/.test(r.result.instructions));
  });
  await check('an unknown protocol version falls back to 2025-06-18', async () => {
    const r = await mcp.request('initialize', { protocolVersion: '1999-01-01' });
    assert.strictEqual(r.result.protocolVersion, '2025-06-18');
  });
  await check('notifications/initialized gets no reply; ping does', async () => {
    const before = mcp.unsolicited.length;
    mcp.notify('notifications/initialized');
    const r = await mcp.request('ping', {});
    assert.deepStrictEqual(r.result, {});
    assert.strictEqual(mcp.unsolicited.length, before, 'a notification was answered');
  });
  await check('unknown method -> -32601', async () => {
    const r = await mcp.request('resources/list', {});
    assert.strictEqual(r.error.code, -32601);
  });

  console.log('\n2. listings');
  await check('tools/list has all ten tools with object schemas', async () => {
    const r = await mcp.request('tools/list', {});
    const names = r.result.tools.map(t => t.name).sort();
    assert.deepStrictEqual(names, ['ask_room_for_ideas', 'ask_room_to_choose', 'ask_room_to_rate', 'check_directions',
      'get_results', 'post_update', 'room_status', 'wait_for_direction', 'wait_for_room', 'wrap_up']);
    for (const t of r.result.tools) {
      assert.strictEqual(t.inputSchema.type, 'object', t.name);
      assert.ok(t.description && t.description.length > 40, t.name);
    }
  });
  await check('prompts/list and prompts/get kickoff', async () => {
    const l = await mcp.request('prompts/list', {});
    assert.deepStrictEqual(l.result.prompts.map(p => p.name), ['kickoff', 'ideas', 'ab-mockups', 'wrap-up', 'continue']);
    const g = await mcp.request('prompts/get', { name: 'kickoff' });
    const m = g.result.messages[0];
    assert.strictEqual(m.role, 'user');
    assert.strictEqual(m.content.type, 'text');
    assert.ok(/room_status/.test(m.content.text) && /post_update/.test(m.content.text));
    const ab = await mcp.request('prompts/get', { name: 'ab-mockups', arguments: { topic: 'header', count: '3' } });
    assert.ok(/3 variants/.test(ab.result.messages[0].content.text));
    const bad = await mcp.request('prompts/get', { name: 'ideas', arguments: {} });
    assert.strictEqual(bad.error.code, -32602);
  });

  console.log('\n3. tools against the fake API');
  await check('room_status renders goal, players, current ask, hides host notes', async () => {
    const r = await mcp.request('tools/call', { name: 'room_status', arguments: {} });
    const t = textOf(r);
    assert.ok(!r.result.isError);
    assert.ok(/Build a landing page/.test(t) && /2 players/.test(t) && /Which header\?/.test(t) && /Call it Summit/.test(t), t);
    assert.ok(!/HOST SECRET NOTE/.test(t));
  });
  await check('ask_room_to_choose posts the contract body and returns labels + badges', async () => {
    requests.length = 0;
    const r = await mcp.request('tools/call', { name: 'ask_room_to_choose', arguments: {
      question: 'Which header?', context: 'Two directions',
      options: [{ title: 'Bold dark hero', description: 'Big type' }, { title: 'Light minimal', description: 'Calm', url: 'https://example.com/b' }],
    } });
    assert.strictEqual(requests.length, 1);
    const q = requests[0];
    assert.strictEqual(q.method, 'POST');
    assert.strictEqual(q.url, '/dev/games/4321/build/asks');
    assert.strictEqual(q.auth, `Bearer ${KEY}`);
    assert.deepStrictEqual(q.body, { kind: 'choice', prompt: 'Which header?', detail: 'Two directions',
      options: [{ title: 'Bold dark hero', detail: 'Big type' }, { title: 'Light minimal', detail: 'Calm', url: 'https://example.com/b' }] });
    const t = textOf(r);
    assert.ok(/Choice A — Bold dark hero/.test(t) && /Choice B — Light minimal/.test(t), t);
    assert.ok(/position:fixed/.test(t) && />Choice B<\/div>/.test(t));
    assert.ok(/proposed/.test(t));
  });
  await check('input validation: one option is refused without an API call', async () => {
    requests.length = 0;
    const r = await mcp.request('tools/call', { name: 'ask_room_to_choose', arguments: { question: 'x', options: [{ title: 'only' }] } });
    assert.strictEqual(r.result.isError, true);
    assert.strictEqual(requests.length, 0);
  });
  await check('wait_for_room polls until decided and returns the direction (with progress)', async () => {
    requests.length = 0; askPolls = 0;
    const r = await mcp.request('tools/call', { name: 'wait_for_room', arguments: { askId: '003', maxWaitSeconds: 5 }, _meta: { progressToken: 'p1' } });
    const t = textOf(r);
    assert.ok(requests.length >= 3, `polled ${requests.length} times`);
    assert.ok(requests.every(q => q.method === 'GET' && q.url === '/dev/games/4321/build/asks/003'));
    assert.ok(/DIRECTION/.test(t) && /keep the logo from A/.test(t), t);
    assert.ok(/Choice B — Light minimal: 3 \(60%\)/.test(t) && /easier to read/.test(t), t);
    assert.ok(mcp.notifications.some(n => n.method === 'notifications/progress' && n.params.progressToken === 'p1'));
  });
  await check('wait_for_room times out cleanly while the ask is still live', async () => {
    askPolls = -1000;
    const r = await mcp.request('tools/call', { name: 'wait_for_room', arguments: { askId: 3, maxWaitSeconds: 1 } });
    const t = textOf(r);
    assert.ok(!r.result.isError);
    assert.ok(/Still waiting/.test(t) && /wait_for_room again/.test(t), t);
  });
  await check('post_update posts to log and renders the inbox direction', async () => {
    requests.length = 0;
    const r = await mcp.request('tools/call', { name: 'post_update', arguments: { text: 'Header B in place' } });
    assert.deepStrictEqual(requests[0].body, { kind: 'progress', text: 'Header B in place' });
    assert.strictEqual(requests[0].url, '/dev/games/4321/build/log');
    const t = textOf(r);
    assert.ok(/DIRECTION FROM THE ROOM \(via the host\)/.test(t) && /colours are too dark/.test(t), t);
  });
  await check('wait_for_direction listens until the host sends something, then hands it over', async () => {
    const before = requests.length;
    const r = await mcp.request('tools/call', { name: 'wait_for_direction', arguments: { maxWaitSeconds: 30 } });
    const t = r.result.content[0].text;
    assert.ok(!r.result.isError, t);
    assert.ok(/Make the button green/.test(t) && /DIRECTION FROM THE ROOM/.test(t), t);
    const polls = requests.slice(before).filter(q => q.url.endsWith('/build/inbox?listening=1'));
    assert.strictEqual(polls.length, 3);
  });
  await check('prompts/get continue tells Claude to pick up directions and keep listening', async () => {
    const r = await mcp.request('prompts/get', { name: 'continue', arguments: {} });
    const t = r.result.messages[0].content.text;
    assert.ok(/check_directions/.test(t) && /wait_for_direction/.test(t), t);
  });
  await check('a 401 becomes an isError result that explains the key', async () => {
    failNext401 = true;
    const r = await mcp.request('tools/call', { name: 'check_directions', arguments: {} });
    const t = textOf(r);
    assert.strictEqual(r.result.isError, true);
    assert.ok(/401/.test(t) && /Key revoked/.test(t) && /revoked/.test(t) && /mint a new key/.test(t), t);
  });

  console.log('\n4. stdout hygiene');
  await check('nothing non-JSON was written to stdout, and nothing unsolicited', async () => {
    assert.deepStrictEqual(mcp.nonJson, []);
    assert.deepStrictEqual(mcp.unsolicited, []);
  });

  console.log('\n5. unconfigured server');
  await check('missing env still starts and every tool explains the setup', async () => {
    const child = spawn(process.execPath, [SCRIPT], { env: { PATH: process.env.PATH }, stdio: ['pipe', 'pipe', 'ignore'] });
    try {
      const out = await new Promise((resolve, reject) => {
        let buf = '';
        const t = setTimeout(() => reject(new Error('no reply')), 3000);
        child.stdout.on('data', c => {
          buf += c;
          if (buf.split('\n').filter(Boolean).length >= 2) { clearTimeout(t); resolve(buf.split('\n').filter(Boolean).map(l => JSON.parse(l))); }
        });
        child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05' } }) + '\n');
        child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'room_status', arguments: {} } }) + '\n');
      });
      assert.strictEqual(out[0].result.protocolVersion, '2024-11-05');
      assert.strictEqual(out[1].result.isError, true);
      assert.ok(/ENGAGE_KEY is not set/.test(out[1].result.content[0].text) && /claude mcp add engage/.test(out[1].result.content[0].text));
    } finally { child.kill('SIGKILL'); }
  });

  mcp.child.kill('SIGKILL');
  server.close();
  clearTimeout(hardStop);
  console.log(`\n${pass} passed, ${fail} failed`);
  suiteFinished();
  process.exit(fail === 0 ? 0 : 1);
})().catch(e => {
  console.log(`  FAIL  suite crashed: ${e && e.stack}`);
  if (mcp) mcp.child.kill('SIGKILL');
  process.exit(1);
});
