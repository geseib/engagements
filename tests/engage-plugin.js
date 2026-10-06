/**
 * THE ENGAGE PLUGIN PATH — connect once per project, keep every step in git.
 *
 * Drives the real src/public/engage-mcp.mjs against a fake Engage API in
 * throwaway folders (never this repository):
 *   - `connect` saves the key in the project's .engage/ (git-ignored) and
 *     every tool works from then on with no environment variables;
 *   - `checkpoint` makes a plain folder a git repository, commits, and puts
 *     the commit on the room's timeline;
 *   - `--checkpoint` (the plugin's Stop hook) commits in a CONNECTED project
 *     and does nothing at all in any other folder;
 *   - `--install-plugin` writes a local marketplace with the plugin, its
 *     commands and its hook, and says what to run when `claude` is absent.
 */
const suiteFinished = require('./helpers/finish-guard');
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn, spawnSync, execFileSync } = require('child_process');

const SCRIPT = path.join(__dirname, '..', 'src', 'public', 'engage-mcp.mjs');
const KEY = `eng_4321_${'k'.repeat(43)}`;
const requests = [];

const server = http.createServer((req, res) => {
  let raw = '';
  req.on('data', (c) => { raw += c; });
  req.on('end', () => {
    requests.push({ method: req.method, url: req.url, auth: req.headers.authorization, body: raw ? JSON.parse(raw) : undefined });
    const send = (status, obj) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
    if (req.headers.authorization !== `Bearer ${KEY}`) return send(403, { message: 'Forbidden' });
    const p = req.url.replace(/^\/dev\/games\/4321\/build\//, '');
    if (req.method === 'GET' && p === 'state') {
      return send(200, { gameId: '4321', title: 'Sign-up site', goal: 'Pick a shift fast', state: 'STARTED', players: [], playerCount: 0, asks: [], log: [], inbox: [] });
    }
    if (req.method === 'POST' && p === 'log') return send(201, { entry: { logId: 'l1', ...JSON.parse(raw) }, inbox: [] });
    if (req.method === 'POST' && p === 'activity') return send(200, { activity: JSON.parse(raw).items });
    // A proposed choice the host has not opened, and a direction the host sent
    // meanwhile ("make mockups"): wait_for_room must hand it over at once.
    if (req.method === 'GET' && p === 'asks/008') {
      return send(200, {
        ask: { askId: '008', kind: 'choice', prompt: 'Which header?', status: 'decided', options: [{ label: 'A', title: 'Bold' }, { label: 'B', title: 'Calm' }],
          results: { total: 0, options: [{ label: 'A', title: 'Bold', count: 0, pct: 0 }, { label: 'B', title: 'Calm', count: 0, pct: 0 }], whys: [] },
          decision: { direction: 'Which header: Calm', chosen: ['B'], spoken: true, method: 'spoken' } },
        inbox: [],
      });
    }
    if (req.method === 'GET' && p === 'asks/007') {
      return send(200, {
        ask: { askId: '007', kind: 'choice', prompt: 'Which header?', status: 'proposed', options: [{ label: 'A', title: 'Bold' }, { label: 'B', title: 'Calm' }] },
        inbox: [{ id: 'd1', text: 'Before ask 007 opens: make a quick mockup of each option.', from: 'host' }],
      });
    }
    if (req.method === 'POST' && p === 'asks') {
      const b = JSON.parse(raw);
      return send(201, { ask: { askId: '001', kind: b.kind, prompt: b.prompt, status: 'proposed', options: (b.options || []).map((o, i) => ({ ...o, label: 'AB'[i] })) }, inbox: [] });
    }
    return send(404, { error: `no route ${p}` });
  });
});

const tmp = (name) => fs.mkdtempSync(path.join(os.tmpdir(), `engage-${name}-`));
const gitIn = (dir, ...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' }).trim();

function mcpChild(env) {
  const child = spawn(process.execPath, [SCRIPT], { env: { PATH: process.env.PATH, HOME: env.HOME || process.env.HOME, ...env }, stdio: ['pipe', 'pipe', 'pipe'] });
  const pending = new Map();
  let buf = '';
  let id = 0;
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (d) => {
    buf += d;
    let nl;
    while ((nl = buf.indexOf('\n')) !== -1) {
      const line = buf.slice(0, nl); buf = buf.slice(nl + 1);
      const m = JSON.parse(line);
      if (pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    }
  });
  const request = (method, params) => new Promise((resolve) => { id += 1; pending.set(id, resolve); child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n'); });
  const call = async (name, args) => { const r = await request('tools/call', { name, arguments: args }); return { text: r.result.content[0].text, isError: Boolean(r.result.isError) }; };
  return { child, request, call };
}

let pass = 0; let fail = 0;
async function check(name, fn) {
  try { await fn(); console.log(`  PASS  ${name}`); pass += 1; } catch (e) { console.log(`  FAIL  ${name}\n        ${e.stack.split('\n').slice(0, 3).join('\n        ')}`); fail += 1; }
}

(async () => {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const API = `http://127.0.0.1:${server.address().port}/dev/`;
  const home = tmp('home');
  const project = tmp('project');
  fs.writeFileSync(path.join(project, 'index.html'), '<h1>Volunteer</h1>\n');
  const mcp = mcpChild({ HOME: home, CLAUDE_PROJECT_DIR: project });
  await mcp.request('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } });

  console.log('\nconnect once per project');
  await check('before connecting, tools say how to connect', async () => {
    const r = await mcp.call('room_status', {});
    assert.ok(r.isError && /\/engage:connect/.test(r.text), r.text);
  });
  await check('connect saves the key in .engage/ (git-ignored) and the room answers', async () => {
    const r = await mcp.call('connect', { key: KEY, api: API });
    assert.ok(!r.isError, r.text);
    assert.ok(/Connected this project/.test(r.text) && /Sign-up site/.test(r.text), r.text);
    const saved = JSON.parse(fs.readFileSync(path.join(project, '.engage', 'session.json'), 'utf8'));
    assert.deepStrictEqual([saved.key, saved.api], [KEY, API]);
    assert.strictEqual(fs.readFileSync(path.join(project, '.engage', '.gitignore'), 'utf8'), '*\n');
    assert.strictEqual(fs.statSync(path.join(project, '.engage', 'session.json')).mode & 0o077, 0, 'the key file is private to its owner');
  });
  await check('a bad key is refused without saving anything', async () => {
    const r = await mcp.call('connect', { key: 'not-a-key' });
    assert.ok(r.isError && /does not look like a session key/.test(r.text), r.text);
  });

  console.log('\ncheckpoints');
  await check('checkpoint makes a plain folder a repository, commits, and tells the room', async () => {
    assert.ok(!fs.existsSync(path.join(project, '.git')));
    const r = await mcp.call('checkpoint', { message: 'Header B, as the room chose' });
    assert.ok(!r.isError, r.text);
    assert.ok(/Made this folder a git repository/.test(r.text), r.text);
    assert.strictEqual(gitIn(project, 'log', '-1', '--format=%s'), 'Header B, as the room chose');
    // The key never enters git.
    assert.ok(!gitIn(project, 'ls-files').split('\n').some((f) => f.startsWith('.engage')));
    const posted = requests.filter((q) => q.method === 'POST' && q.url.endsWith('/build/log')).pop();
    assert.strictEqual(posted.body.kind, 'checkpoint');
    assert.ok(/^commit [0-9a-f]{7,} · 2 files$/.test(posted.body.detail), posted.body.detail);
  });
  await check('nothing changed, nothing committed', async () => {
    const before = gitIn(project, 'rev-list', '--count', 'HEAD');
    const r = await mcp.call('checkpoint', { message: 'again' });
    assert.ok(/Nothing to commit/.test(r.text), r.text);
    assert.strictEqual(gitIn(project, 'rev-list', '--count', 'HEAD'), before);
  });
  console.log('\na link is checked before the room sees it (2026-10-02: a second session pointed at the first one\'s server)');
  // A dev server left running by ANOTHER project, from another folder.
  const serve = (cwd) => new Promise((resolve) => {
    const c = spawn(process.execPath, ['-e', "const s=require('http').createServer((q,r)=>r.end('hi')).listen(0,'127.0.0.1',()=>console.log(s.address().port))"], { cwd, stdio: ['ignore', 'pipe', 'ignore'] });
    c.stdout.once('data', (d) => resolve({ child: c, port: Number(String(d).trim()) }));
  });
  const foodbank = tmp('foodbank');
  const old = await serve(foodbank);
  await check('a link served from another folder is refused, and nothing is posted', async () => {
    const before = requests.length;
    const r = await mcp.call('post_update', { kind: 'showing', text: 'The site is up', link: `http://localhost:${old.port}/` });
    assert.ok(r.isError, r.text);
    assert.ok(/Nothing was posted/.test(r.text) && r.text.includes(fs.realpathSync(foodbank)) && /not in this project/.test(r.text), r.text);
    assert.strictEqual(requests.length, before, 'no request reached Engage');
    const c = await mcp.call('ask_room_to_choose', { question: 'Which?', options: [{ title: 'A', url: `http://localhost:${old.port}/a` }, { title: 'B' }] });
    assert.ok(c.isError && /Nothing was posted/.test(c.text), c.text);
    assert.strictEqual(requests.length, before);
  });
  const mine = await serve(project);
  await check('this project\'s own server is fine', async () => {
    const r = await mcp.call('post_update', { kind: 'showing', text: 'The site is up', link: `http://localhost:${mine.port}/` });
    assert.ok(!r.isError && !/CHECK THESE LINKS/.test(r.text), r.text);
    const c = await mcp.call('ask_room_to_choose', { question: 'Which?', options: [{ title: 'A', url: `http://localhost:${mine.port}/a` }, { title: 'B' }] });
    assert.ok(!c.isError, c.text);
    // The pictures come before the wait (owner, 2026-10-04).
    assert.ok(/PREVIEWS BEFORE YOU WAIT/.test(c.text) && /share_image it onto its option/.test(c.text) && /label A, B/.test(c.text), c.text);
  });
  await check('a decided ask tells Claude the question and the answer, and nothing about how (owner, 2026-10-06)', async () => {
    const r = await mcp.call('get_results', { askId: '008' });
    assert.ok(/THE ROOM DECIDED \(final — build this\):\n  Which header: Calm/.test(r.text), r.text);
    assert.ok(!/out loud|Chosen:|wheel|vote/i.test(r.text.split('THE ROOM DECIDED')[1]), r.text);
    assert.ok(!/0 \(0%\)/.test(r.text), `the tally was printed:\n${r.text}`);
  });
  await check('a direction sent while Claude waits on an ask reaches it at once, not after the wait', async () => {
    const t0 = Date.now();
    const r = await mcp.call('wait_for_room', { askId: '007', maxWaitSeconds: 60 });
    assert.ok(Date.now() - t0 < 5000, `took ${Date.now() - t0}ms`);
    assert.ok(/sent you a direction while you waited on ask 007/.test(r.text) && /make a quick mockup of each option/.test(r.text), r.text);
    assert.ok(/call wait_for_room with askId "007" again/.test(r.text), r.text);
  });
  await check('a link nothing answers is posted with a warning to start the server', async () => {
    old.child.kill(); mine.child.kill();
    await new Promise((r) => setTimeout(r, 200));
    const r = await mcp.call('post_update', { kind: 'showing', text: 'Up', link: `http://localhost:${old.port}/` });
    assert.ok(!r.isError && /Nothing answers at/.test(r.text) && /address already in use/.test(r.text), r.text);
  });
  mcp.child.kill();

  console.log('\nwhat Claude is doing, live (owner, 2026-10-04)');
  const activityHook = (cwd, data) => spawnSync(process.execPath, [SCRIPT, '--activity'],
    { input: JSON.stringify(data), env: { PATH: process.env.PATH, HOME: home, CLAUDE_PROJECT_DIR: cwd }, encoding: 'utf8', timeout: 10000 });
  const activityPath = path.join(project, '.engage', 'activity.jsonl');
  const linesIn = () => (fs.existsSync(activityPath) ? fs.readFileSync(activityPath, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
  await check('the hook writes one plain line per tool, and never a command\'s arguments', async () => {
    fs.writeFileSync(activityPath, '');
    for (const data of [
      { tool_name: 'Edit', tool_input: { file_path: '/Users/x/app/src/Header.jsx', old_string: 'SECRET-OLD', new_string: 'SECRET-NEW' } },
      { tool_name: 'Bash', tool_input: { command: 'API_TOKEN=sk-live-123 cd app && npm run dev -- --token sk-live-456' } },
      { tool_name: 'Grep', tool_input: { pattern: 'password=hunter2' } },
      { tool_name: 'WebFetch', tool_input: { url: 'https://docs.example.com/a?key=abc' } },
      { tool_name: 'mcp__other__read_secrets', tool_input: { q: 'x' } },
    ]) {
      const r = activityHook(project, data);
      assert.strictEqual(r.status, 0, r.stderr);
      assert.strictEqual(r.stdout, '', 'a hook prints nothing');
    }
    assert.deepStrictEqual(linesIn().map((l) => [l.kind, l.text]), [
      ['edit', 'Edited Header.jsx'], ['run', 'Ran npm run dev'], ['search', 'Searched the code'], ['web', 'Looked at docs.example.com'],
    ]);
    const raw = fs.readFileSync(activityPath, 'utf8');
    for (const secret of ['SECRET', 'sk-live', 'hunter2', 'key=abc', '/Users/x']) assert.ok(!raw.includes(secret), `${secret} leaked`);
  });
  await check('in any other folder the hook writes nothing', async () => {
    const other = tmp('other-activity');
    activityHook(other, { tool_name: 'Edit', tool_input: { file_path: 'a.js' } });
    assert.ok(!fs.existsSync(path.join(other, '.engage')), 'never writes outside a Build Room project');
  });
  await check('the server sends the lines to the room in a batch and empties the file', async () => {
    const before = requests.filter((q) => q.url.endsWith('/build/activity')).length;
    const pump = mcpChild({ HOME: home, CLAUDE_PROJECT_DIR: project, ENGAGE_ACTIVITY_MS: '200' });
    try {
      const deadline = Date.now() + 5000;
      while (requests.filter((q) => q.url.endsWith('/build/activity')).length === before && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 50));
      }
      const sentNow = requests.filter((q) => q.url.endsWith('/build/activity')).slice(before);
      assert.strictEqual(sentNow.length, 1, 'one batch');
      assert.deepStrictEqual(sentNow[0].body.items.map((i) => i.text), ['Edited Header.jsx', 'Ran npm run dev', 'Searched the code', 'Looked at docs.example.com']);
      assert.strictEqual(fs.readFileSync(activityPath, 'utf8'), '', 'the file is emptied');
    } finally {
      pump.child.kill();
    }
  });

  console.log('\nthe Stop hook');
  // Async on purpose: the fake API lives in THIS process, and spawnSync would
  // block it from answering the hook's request.
  const hook = (dir, input) => new Promise((resolve) => {
    const c = spawn(process.execPath, [SCRIPT, '--checkpoint'], { env: { PATH: process.env.PATH, HOME: home }, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = ''; let stderr = '';
    c.stdout.on('data', (d) => { stdout += d; });
    c.stderr.on('data', (d) => { stderr += d; });
    c.on('close', (status) => resolve({ status, stdout, stderr }));
    c.stdin.end(input !== undefined ? input : JSON.stringify({ cwd: dir, session_id: 's1', hook_event_name: 'Stop' }));
  });
  await check('in a connected project it commits the turn, named after Claude\'s last update', async () => {
    fs.writeFileSync(path.join(project, 'form.html'), '<form></form>\n');
    fs.writeFileSync(path.join(project, '.engage', 'last-update.txt'), 'Sign-up form done');
    const r = await hook(project);
    assert.strictEqual(r.status, 0, r.stderr);
    assert.strictEqual(r.stdout, '', 'a Stop hook prints nothing');
    assert.strictEqual(gitIn(project, 'log', '-1', '--format=%s'), 'Build Room 4321: Sign-up form done');
    const posted = requests.filter((q) => q.method === 'POST' && q.url.endsWith('/build/log')).pop();
    assert.deepStrictEqual([posted.body.kind, posted.body.text], ['checkpoint', 'Sign-up form done']);
  });
  await check('in any other folder it touches nothing', async () => {
    const other = tmp('other');
    fs.writeFileSync(path.join(other, 'notes.txt'), 'private\n');
    const r = await hook(other);
    assert.strictEqual(r.status, 0);
    assert.ok(!fs.existsSync(path.join(other, '.git')), 'never git init outside a Build Room project');
  });
  await check('it never fails the turn, even with a broken stdin', async () => {
    const r = await hook(null, 'not json');
    assert.strictEqual(r.status, 0);
  });

  console.log('\ninstalling the plugin');
  await check('writes a local marketplace with the plugin, its commands and its hook', async () => {
    const r = spawnSync(process.execPath, [SCRIPT, '--install-plugin', '--api', API], { env: { PATH: '/nonexistent', HOME: home }, encoding: 'utf8', timeout: 20000 });
    assert.strictEqual(r.status, 0, r.stderr);
    const root = path.join(home, '.engage', 'claude-plugin');
    const market = JSON.parse(fs.readFileSync(path.join(root, '.claude-plugin', 'marketplace.json'), 'utf8'));
    assert.deepStrictEqual(market.plugins.map((p) => [p.name, p.source]), [['engage', './engage']]);
    const plug = path.join(root, 'engage');
    assert.strictEqual(JSON.parse(fs.readFileSync(path.join(plug, '.claude-plugin', 'plugin.json'), 'utf8')).name, 'engage');
    assert.deepStrictEqual(JSON.parse(fs.readFileSync(path.join(plug, '.mcp.json'), 'utf8')).mcpServers.engage.args, ['${CLAUDE_PLUGIN_ROOT}/engage-mcp.mjs']);
    const hooks = JSON.parse(fs.readFileSync(path.join(plug, 'hooks', 'hooks.json'), 'utf8'));
    assert.ok(/--checkpoint/.test(hooks.hooks.Stop[0].hooks[0].command));
    assert.ok(fs.readFileSync(path.join(plug, 'engage-mcp.mjs')).equals(fs.readFileSync(SCRIPT)), 'the plugin carries this exact server');
    for (const c of ['connect', 'kickoff', 'ideas', 'ab-mockups', 'wrap-up', 'continue', 'join', 'early-look', 'review', 'share-repo']) {
      assert.ok(fs.existsSync(path.join(plug, 'commands', `${c}.md`)), `${c} command`);
    }
    assert.ok(/\$ARGUMENTS/.test(fs.readFileSync(path.join(plug, 'commands', 'connect.md'), 'utf8')));
    // The crew commands: /engage:join <key>, /engage:early-look, /engage:review.
    assert.deepStrictEqual(fs.readdirSync(path.join(plug, 'commands')).sort(),
      ['ab-mockups.md', 'connect.md', 'continue.md', 'early-look.md', 'ideas.md', 'join.md', 'kickoff.md', 'preview.md', 'review.md', 'share-repo.md', 'wrap-up.md']);
    // The live view: one plain line per tool, from a PostToolUse hook on every tool.
    assert.strictEqual(hooks.hooks.PostToolUse[0].matcher, '*');
    assert.ok(/--activity/.test(hooks.hooks.PostToolUse[0].hooks[0].command));
    assert.ok(/npm run dev|dev server/.test(fs.readFileSync(path.join(plug, 'commands', 'preview.md'), 'utf8')));
    const join = fs.readFileSync(path.join(plug, 'commands', 'join.md'), 'utf8');
    assert.ok(/argument-hint: <key>/.test(join) && /connect with key "\$ARGUMENTS"/.test(join) && /crew_status/.test(join) && /claim_task/.test(join), join);
    const review = fs.readFileSync(path.join(plug, 'commands', 'review.md'), 'utf8');
    assert.ok(/UNTRUSTED/.test(review) && /Run crew code/.test(review) && /review_share/.test(review), review);
    assert.ok(/share_work/.test(fs.readFileSync(path.join(plug, 'commands', 'early-look.md'), 'utf8')));
    assert.deepStrictEqual(JSON.parse(fs.readFileSync(path.join(home, '.engage', 'config.json'), 'utf8')), { api: API });
    // With no claude on PATH it says exactly what to type instead, then the next step.
    assert.ok(/\/plugin marketplace add/.test(r.stdout) && /mint a key and copy the connect command/.test(r.stdout), r.stdout);
  });

  // ── Check, then install / update / "all set" (owner, 2026-10-04) ──────────
  // A fake `claude` answers `plugin list --json` from a state file and logs
  // every call, so each case shows exactly what the installer asked it to do.
  const VERSION = fs.readFileSync(SCRIPT, 'utf8').match(/const VERSION = '([^']+)'/)[1];
  const bin = tmp('bin');
  const claudeLog = path.join(bin, 'calls.log');
  const claudeState = path.join(bin, 'state.json');
  fs.writeFileSync(path.join(bin, 'claude'), [
    '#!/bin/sh',
    `echo "$*" >> "${claudeLog}"`,
    'case "$*" in',
    '  "--version") echo "2.1.0 (Claude Code)" ;;',
    `  "plugin list --json") cat "${claudeState}" ;;`,
    'esac',
    'exit 0',
  ].join('\n'));
  fs.chmodSync(path.join(bin, 'claude'), 0o755);
  const installWith = (state, api = API) => {
    fs.writeFileSync(claudeState, JSON.stringify(state));
    fs.writeFileSync(claudeLog, '');
    const r = spawnSync(process.execPath, [SCRIPT, '--install-plugin', '--api', api],
      { env: { PATH: `${bin}:/usr/bin:/bin`, HOME: home }, encoding: 'utf8', timeout: 20000 });
    assert.strictEqual(r.status, 0, r.stderr);
    const calls = fs.readFileSync(claudeLog, 'utf8').trim().split('\n').filter(Boolean);
    return { out: r.stdout, calls, changing: calls.filter((c) => !/^(--version|plugin list --json)$/.test(c)) };
  };
  const entry = (version, enabled = true) => [{ id: 'engage@engage-local', version, enabled, scope: 'user' }];
  const pluginJson = () => path.join(home, '.engage', 'claude-plugin', 'engage', '.claude-plugin', 'plugin.json');

  await check('not installed: it installs this version and says so', async () => {
    const r = installWith([]);
    assert.ok(r.calls.includes('plugin install engage@engage-local'), r.calls.join(' | '));
    assert.ok(r.out.includes(`Installed the Engage plugin ${VERSION}`), r.out);
    assert.strictEqual(JSON.parse(fs.readFileSync(pluginJson(), 'utf8')).version, VERSION);
  });
  await check('this version, on: "You\'re all set", and nothing is changed', async () => {
    const before = fs.statSync(pluginJson()).mtimeMs;
    const r = installWith(entry(VERSION));
    assert.deepStrictEqual(r.changing, [], `asked claude to change something: ${r.changing.join(' | ')}`);
    assert.ok(r.out.includes(`You're all set: the Engage plugin ${VERSION} is installed and on.`), r.out);
    assert.strictEqual(fs.statSync(pluginJson()).mtimeMs, before, 'the plugin files were rewritten');
  });
  await check('an older version: it updates to this one and says from what', async () => {
    const r = installWith(entry('1.1.0'));
    assert.ok(r.calls.includes('plugin update engage@engage-local'), r.calls.join(' | '));
    assert.ok(r.out.includes(`Updated the Engage plugin from 1.1.0 to ${VERSION}`) && /Restart Claude Code/.test(r.out), r.out);
  });
  await check('this version but turned off: it turns it back on', async () => {
    const r = installWith(entry(VERSION, false));
    assert.ok(r.calls.includes('plugin enable engage@engage-local'), r.calls.join(' | '));
    assert.ok(!r.calls.some((c) => /plugin (install|update)/.test(c)), r.calls.join(' | '));
    assert.ok(/turned off\. It is on again/.test(r.out), r.out);
  });
  await check('moving to another Engage site: the API follows, even when the plugin is current', async () => {
    const other = 'https://other.example/dev/';
    const r = installWith(entry(VERSION), other);
    assert.ok(r.out.includes(`It now talks to ${other}`), r.out);
    assert.deepStrictEqual(JSON.parse(fs.readFileSync(path.join(home, '.engage', 'config.json'), 'utf8')), { api: other });
    installWith(entry(VERSION)); // back to the test API for the checks below
  });
  await check('after install, connect needs only the key', async () => {
    const fresh = tmp('fresh');
    const m2 = mcpChild({ HOME: home, CLAUDE_PROJECT_DIR: fresh });
    await m2.request('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } });
    const r = await m2.call('connect', { key: KEY });
    m2.child.kill();
    assert.ok(!r.isError, r.text);
  });

  server.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  suiteFinished();
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
