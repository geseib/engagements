/**
 * BUILD ROOM CREW MODE — the MCP side (src/public/engage-mcp.mjs).
 *
 * Builders bring their own Claude Code; the host's Claude reviews and merges
 * (docs/design/build-room-crew/FLOWS.md). The same server serves both roles,
 * told apart by the key. This suite spawns the real script twice — once with a
 * builder's key, once with the host's Claude's — against a fake Engage API,
 * each in a throwaway folder that is a REAL git repository, so share_work's
 * diffstat and format-patch, share_repo's branch and remote reads and
 * announce_merge's push check all run real git.
 *
 * The API itself is specified by tests/build-crew.js; the fake here answers
 * with the same shapes (every response may carry inbox: [...]).
 */
const suiteFinished = require('./helpers/finish-guard');
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn, execFileSync } = require('child_process');

const SCRIPT = path.join(__dirname, '..', 'src', 'public', 'engage-mcp.mjs');
const BUILDER_KEY = `eng_4321_${'b'.repeat(43)}`;
const HOST_KEY = `eng_4321_${'h'.repeat(43)}`;
const BASE = 'build-room/4321';
const SHARE = '5e1f9a';

let pass = 0; let fail = 0;
async function check(name, fn) {
  try { await fn(); console.log(`  PASS  ${name}`); pass += 1; } catch (e) { console.log(`  FAIL  ${name}\n        ${String(e.stack).split('\n').slice(0, 4).join('\n        ')}`); fail += 1; }
}

// ------------------------------------------------------------- git fixtures --

const tmp = (name) => fs.mkdtempSync(path.join(os.tmpdir(), `engage-crew-${name}-`));
const gitIn = (dir, ...args) => execFileSync('git', ['-c', 'user.name=Test', '-c', 'user.email=t@example.com', ...args], { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const write = (dir, f, body) => fs.writeFileSync(path.join(dir, f), body);

// The builder: the room's base branch, then their own branch with two commits.
const builderDir = tmp('builder');
gitIn(builderDir, 'init', '-q');
gitIn(builderDir, 'checkout', '-q', '-b', 'main');
write(builderDir, 'index.html', '<h1>Food bank</h1>\n<p>Sign up</p>\n');
gitIn(builderDir, 'add', '-A'); gitIn(builderDir, 'commit', '-q', '-m', 'start');
gitIn(builderDir, 'checkout', '-q', '-b', BASE);
gitIn(builderDir, 'checkout', '-q', '-b', 'crew/priya/parking');
write(builderDir, 'map.html', '<div id="map"></div>\n<ul><li>Lot A</li></ul>\n<script></script>\n');
gitIn(builderDir, 'add', '-A'); gitIn(builderDir, 'commit', '-q', '-m', 'Parking map');
write(builderDir, 'index.html', '<h1>Food bank</h1>\n<a href="map.html">Parking</a>\n');
gitIn(builderDir, 'add', '-A'); gitIn(builderDir, 'commit', '-q', '-m', 'Link the map');
write(builderDir, 'wip.txt', 'not committed yet\n');
const shots = tmp('shots');
const PNG = Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), Buffer.from('parking map pixels')]);
fs.writeFileSync(path.join(shots, 'map.png'), PNG);

// The host: a project with a public origin and no base branch yet.
const hostDir = tmp('host');
gitIn(hostDir, 'init', '-q');
gitIn(hostDir, 'checkout', '-q', '-b', 'main');
write(hostDir, 'index.html', '<h1>Food bank</h1>\n');
gitIn(hostDir, 'add', '-A'); gitIn(hostDir, 'commit', '-q', '-m', 'start');
gitIn(hostDir, 'remote', 'add', 'origin', 'https://github.com/george/foodbank.git');

// ----------------------------------------------------------------- fake API --

const requests = [];
let builderMode = 'fork';
let runCrewCode = false;
let firstBuilderState = true;
const PATCH_TEXT = 'From 1234567 Mon Sep 17 00:00:00 2001\nSubject: [PATCH] Confirmation text\n\ndiff --git a/text.js b/text.js\n+send("Thanks")\n';

const crewFor = (role) => ({
  enabled: true, repoUrl: 'https://github.com/george/foodbank', baseBranch: BASE, baseCommit: 'e91b04d', baseNote: '', baseMovedAt: null,
  modes: ['fork', 'patch'], runCrewCode,
  builders: [
    { name: 'Priya', mode: builderMode, branch: 'crew/priya/parking', commit: '9c41d7a', status: 'building', note: '', taskId: '001', shareIds: [SHARE] },
    { name: 'Sam', mode: 'fork', branch: 'crew/sam/list', commit: '', status: 'needs-rebase', note: 'Header.tsx clashes', taskId: '001', shareIds: [] },
  ],
  tasks: [
    { taskId: '001', text: 'Parking map', detail: 'Lots and walking times', claimedBy: ['Priya', 'Sam'], state: 'open' },
    { taskId: '002', text: 'Confirmation text', detail: '', claimedBy: [], state: 'open' },
  ],
  shares: [{
    shareId: SHARE, builder: 'Priya', taskId: '001', title: 'Parking map', lane: 'shared', featured: true, prUrl: '', mergedCommit: '',
    versions: [{ v: 1, summary: 'A map of three lots.', branch: 'crew/priya/parking', commit: '9c41d7a', forkUrl: 'https://github.com/priya-k/foodbank', diffstat: { files: ['map.html'], fileCount: 1, added: 3, removed: 0 }, imageIds: ['ab12'], hasPatch: false },
      { v: 2, summary: 'Lit lots marked.', unsure: 'Lot hours are typed by hand.', branch: '', commit: 'a1b2c3d', forkUrl: '', diffstat: { files: ['map.html', 'text.js'], fileCount: 2, added: 9, removed: 1 }, imageIds: [], hasPatch: true }],
    reactions: { 'looks-right': 2, question: 1, concern: 0 },
    comments: [{ kind: 'question', text: 'Does it work at night?', by: 'room', name: 'Ana', version: 1 }],
    reviews: [{ version: 1, does: 'Adds a map.', fits: ['Clashes with Sam in Header.tsx'], risk: 'Low', suggestions: ['Move hours into lots.json'], recommendation: 'merge-after-changes', testsRun: false, runCrewCode: false }],
  }],
  pipeline: { building: 1, shared: 1, reviewed: 0, pr: 0, merged: 0, 'not-now': 0 },
});

const server = http.createServer((req, res) => {
  let raw = '';
  req.on('data', (c) => { raw += c; });
  req.on('end', () => {
    const body = raw ? JSON.parse(raw) : undefined;
    const role = req.headers.authorization === `Bearer ${BUILDER_KEY}` ? 'builder' : req.headers.authorization === `Bearer ${HOST_KEY}` ? 'agent' : null;
    const p = req.url.replace(/^\/dev\/games\/4321\/build\//, '');
    requests.push({ method: req.method, p, role, body });
    const send = (status, obj) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ inbox: [], ...obj })); };
    if (!role) return send(403, { message: 'Forbidden' });
    const hostOnly = ['crew/settings', 'crew/tasks', 'crew/base', `crew/shares/${SHARE}/review`, `crew/shares/${SHARE}/patch`];
    if (role === 'builder' && hostOnly.includes(p)) return send(403, { error: 'Builders cannot do that' });

    if (req.method === 'GET' && p === 'state') {
      const common = { gameId: '4321', title: 'Food bank sign-up', goal: 'Sign up in a minute', state: 'STARTED', playerCount: 6, log: [], outcome: null };
      if (role === 'builder') {
        const inbox = firstBuilderState ? [{ id: 'f1', text: 'Feedback on your early look: show which lots are lit', from: 'host', askId: null, shareId: SHARE }] : [];
        firstBuilderState = false;
        return send(200, { ...common, you: { role: 'builder', name: 'Priya' }, crew: crewFor('builder'), inbox });
      }
      return send(200, { ...common, asks: [], settings: { reviewAgentAsks: true }, you: { role: 'host-claude' }, crew: crewFor('agent') });
    }
    if (req.method === 'POST' && p === 'images') return send(201, { image: { imageId: `ab${requests.length}`, bytes: 26, kind: body.kind } });
    if (req.method === 'POST' && p === 'crew/me') return send(200, { builder: { name: 'Priya', mode: body.mode || builderMode, status: body.status || 'building', branch: body.branch || '', commit: body.commit || '', note: body.note || '', taskId: '001' } });
    if (req.method === 'POST' && p === 'crew/tasks/001/claim') return send(200, { taskId: '001', builder: 'Priya', inbox: [{ id: 't1', text: 'You took a task: Parking map', from: 'host', askId: null, shareId: null }] });
    if (req.method === 'POST' && p === 'crew/shares') {
      if (body.patch && Buffer.byteLength(body.patch) > 300 * 1024) return send(400, { error: 'The patch is over 300 KB' });
      return send(201, { share: { shareId: body.shareId || SHARE, builder: 'Priya', title: body.title, lane: 'shared', versions: [{ v: 1, branch: body.branch, commit: body.commit, forkUrl: body.forkUrl || '', diffstat: body.diffstat, imageIds: body.imageIds || [], hasPatch: Boolean(body.patch) }] } });
    }
    if (req.method === 'POST' && [`crew/shares/${SHARE}/pr`, `crew/shares/${SHARE}/comments`, 'crew/help'].includes(p)) return send(p === 'crew/help' ? 201 : 200, { ok: true });
    if (req.method === 'POST' && p === 'crew/settings') return send(200, { crew: { enabled: true, repoUrl: body.repoUrl || '', baseBranch: body.baseBranch, baseCommit: body.baseCommit || '', modes: ['fork', 'patch'], runCrewCode } });
    if (req.method === 'POST' && p === 'crew/tasks') return send(201, { task: { taskId: '003', text: body.text, detail: body.detail || '', claimedBy: [], state: 'open' } });
    if (req.method === 'GET' && p === `crew/shares/${SHARE}`) return send(200, { share: crewFor('agent').shares[0], crew: { ...crewFor('agent'), builders: undefined } });
    if (req.method === 'GET' && p === `crew/shares/${SHARE}/patch`) return send(200, { shareId: SHARE, v: 2, patch: PATCH_TEXT });
    if (req.method === 'POST' && p === `crew/shares/${SHARE}/review`) {
      if (body.testsRun && !runCrewCode) return send(409, { error: 'Run crew code is Off, so the review cannot say it ran their tests. Read the code only, or ask the host to switch it on.', inbox: [{ id: 'r9', text: 'Review Sam\'s too', from: 'host' }] });
      return send(201, { ok: true });
    }
    if (req.method === 'POST' && p === 'crew/base') return send(200, { crew: { ...crewFor('agent'), baseCommit: body.commit } });
    return send(404, { error: `no route ${req.method} ${p}` });
  });
});

// ------------------------------------------------------------- MCP client --

function mcpChild(key, dir, api) {
  const child = spawn(process.execPath, [SCRIPT], { env: { PATH: process.env.PATH, HOME: tmp('home'), ENGAGE_API: api, ENGAGE_KEY: key, CLAUDE_PROJECT_DIR: dir }, stdio: ['pipe', 'pipe', 'pipe'] });
  const pending = new Map();
  const nonJson = [];
  let buf = '';
  let id = 0;
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (d) => {
    buf += d;
    let nl;
    while ((nl = buf.indexOf('\n')) !== -1) {
      const line = buf.slice(0, nl); buf = buf.slice(nl + 1);
      let m;
      try { m = JSON.parse(line); } catch { nonJson.push(line); continue; }
      if (pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    }
  });
  child.stderr.on('data', () => {});
  const request = (method, params) => new Promise((resolve, reject) => {
    id += 1;
    const t = setTimeout(() => reject(new Error(`timeout on ${method}`)), 8000);
    pending.set(id, (m) => { clearTimeout(t); resolve(m); });
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
  });
  const call = async (name, args) => { const r = await request('tools/call', { name, arguments: args }); return { text: r.result.content.map((c) => c.text).join('\n'), isError: Boolean(r.result.isError) }; };
  return { child, request, call, nonJson };
}

const since = (n) => requests.slice(n);
let builder; let hostClaude;
const hardStop = setTimeout(() => {
  console.log('  FAIL  suite exceeded 30s');
  for (const m of [builder, hostClaude]) if (m) m.child.kill('SIGKILL');
  process.exit(1);
}, 30000);

(async () => {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const API = `http://127.0.0.1:${server.address().port}/dev/`;
  builder = mcpChild(BUILDER_KEY, builderDir, API);
  hostClaude = mcpChild(HOST_KEY, hostDir, API);
  for (const m of [builder, hostClaude]) await m.request('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } });

  console.log('\nlistings');
  const CREW = ['crew_status', 'claim_task', 'share_work', 'share_pr', 'ask_for_help', 'comment_share', 'share_repo', 'propose_task', 'get_share', 'review_share', 'announce_merge'];
  await check('tools/list carries every crew tool with an object schema', async () => {
    const r = await builder.request('tools/list', {});
    const byName = Object.fromEntries(r.result.tools.map((t) => [t.name, t]));
    for (const n of CREW) {
      assert.ok(byName[n], `missing ${n}`);
      assert.strictEqual(byName[n].inputSchema.type, 'object', n);
      assert.strictEqual(byName[n].inputSchema.additionalProperties, false, n);
      assert.ok(byName[n].description.length > 80, n);
    }
    assert.deepStrictEqual(byName.share_work.inputSchema.required, ['title', 'summary']);
    assert.deepStrictEqual(byName.review_share.inputSchema.properties.recommendation.enum, ['merge', 'merge-after-changes', 'not-yet']);
    assert.ok(/untrusted/i.test(byName.review_share.description) && /testsRun false/.test(byName.review_share.description) && /Run crew code/.test(byName.review_share.description));
    assert.deepStrictEqual(byName.crew_status.inputSchema.properties.status.enum, ['setting-up', 'building', 'synced', 'needs-rebase', 'idle']);
  });
  await check('prompts join, early-look and review exist and say the right things', async () => {
    const l = await builder.request('prompts/list', {});
    const names = l.result.prompts.map((p) => p.name);
    for (const n of ['join', 'early-look', 'review']) assert.ok(names.includes(n), n);
    const join = (await builder.request('prompts/get', { name: 'join', arguments: { key: BUILDER_KEY } })).result.messages[0].content.text;
    assert.ok(join.includes(`connect with key "${BUILDER_KEY}"`) && /crew\/<my name>\/<task>/.test(join) && /crew_status/.test(join) && /ask me which to take/.test(join), join);
    const look = (await builder.request('prompts/get', { name: 'early-look', arguments: {} })).result.messages[0].content.text;
    assert.ok(/screenshot/.test(look) && /share_work/.test(look) && /unsure/.test(look), look);
    const review = (await builder.request('prompts/get', { name: 'review', arguments: {} })).result.messages[0].content.text;
    assert.ok(/UNTRUSTED/.test(review) && /get_share/.test(review) && /fetchPatch/.test(review) && /review_share/.test(review) && /run nothing of theirs/.test(review), review);
  });
  await check('the instructions carry a crew section for each role', async () => {
    const r = await builder.request('initialize', { protocolVersion: '2025-06-18' });
    const t = r.result.instructions;
    assert.ok(/BUILDER/.test(t) && /share_work/.test(t) && /crew\/<your name>\/<task>/.test(t), t);
    assert.ok(/HOST'S CLAUDE/.test(t) && /Run crew code/.test(t) && /announce_merge/.test(t) && /untrusted/.test(t));
  });

  console.log('\nroom_status shows the crew, per role');
  await check('a builder sees the board: their card, the tasks, the early looks, no asks', async () => {
    const r = await builder.call('room_status', {});
    assert.ok(!r.isError, r.text);
    for (const re of [/You: a builder, Priya/, /Crew mode: on/, /base branch build-room\/4321 at e91b04d/, /Builders \(2 of 8\)/, /Priya \(you\): building · task 001 Parking map/,
      /Sam: needs-rebase.*Header\.tsx clashes/, /Open tasks \(2\)/, /002 · Confirmation text · free/, /taken by Priya, Sam/, new RegExp(`${SHARE} · Priya: "Parking map" · early look · v2 · on the wall · 2 looks right, 1 question, 0 concern`),
      /Pipeline: building 1 · early look 1/, /Next for you/]) {
      assert.ok(re.test(r.text), `${re}\n${r.text}`);
    }
    assert.ok(!/Current ask/.test(r.text), 'a builder has no asks');
    assert.ok(/DIRECTION FROM THE ROOM/.test(r.text) && new RegExp(`re early look ${SHARE}`).test(r.text), 'the inbox is shown, tagged with its early look');
  });
  await check('the host\'s Claude sees the switch, prominently, and what waits for review', async () => {
    const r = await hostClaude.call('room_status', {});
    assert.ok(!r.isError, r.text);
    assert.ok(/You: the host's Claude/.test(r.text) && /RUN CREW CODE: OFF/.test(r.text) && /not reviewed yet/.test(r.text) && /Current ask: none/.test(r.text), r.text);
  });

  console.log('\nbuilder tools');
  await check('crew_status sends what it is given; needs-rebase must say which files', async () => {
    const n = requests.length;
    const r = await builder.call('crew_status', { mode: 'fork', forkUrl: 'https://github.com/priya-k/foodbank', branch: 'crew/priya/parking', status: 'synced' });
    assert.ok(!r.isError && /synced/.test(r.text), r.text);
    assert.deepStrictEqual(since(n).map((q) => [q.method, q.p, q.body]), [['POST', 'crew/me', { mode: 'fork', forkUrl: 'https://github.com/priya-k/foodbank', branch: 'crew/priya/parking', status: 'synced' }]]);
    const bad = await builder.call('crew_status', { status: 'needs-rebase' });
    assert.ok(bad.isError && /which files clash/.test(bad.text), bad.text);
  });
  await check('claim_task pads the id and hands over the task as a direction', async () => {
    const n = requests.length;
    const r = await builder.call('claim_task', { taskId: '1' });
    assert.strictEqual(since(n)[0].p, 'crew/tasks/001/claim');
    assert.ok(/You took task 001/.test(r.text) && /You took a task: Parking map/.test(r.text), r.text);
  });
  await check('share_work reads branch, commit and diffstat from git, uploads the screenshots first, keeps the inbox', async () => {
    firstBuilderState = true;
    const n = requests.length;
    const r = await builder.call('share_work', { title: 'Parking map', summary: 'A map of the lots, linked from the home page.', unsure: 'Lot hours are typed by hand.', imagePaths: [path.join(shots, 'map.png')] });
    assert.ok(!r.isError, r.text);
    const calls = since(n);
    assert.deepStrictEqual(calls.map((q) => `${q.method} ${q.p}`), ['GET state', 'POST images', 'POST crew/shares']);
    assert.ok(Buffer.from(calls[1].body.data, 'base64').equals(PNG));
    const b = calls[2].body;
    const numstat = gitIn(builderDir, 'diff', '--numstat', `${BASE}...HEAD`).split('\n').map((l) => l.split('\t'));
    assert.deepStrictEqual(b.diffstat, {
      files: numstat.map((x) => x[2]), fileCount: 2,
      added: numstat.reduce((a, x) => a + Number(x[0]), 0), removed: numstat.reduce((a, x) => a + Number(x[1]), 0),
    });
    assert.deepStrictEqual(b.diffstat.files.sort(), ['index.html', 'map.html']);
    assert.strictEqual(b.commit, gitIn(builderDir, 'rev-parse', '--short', 'HEAD'));
    assert.strictEqual(b.branch, 'crew/priya/parking');
    assert.deepStrictEqual(b.imageIds, [calls[1] && `ab${requests.indexOf(calls[1]) + 1}`]);
    assert.strictEqual(b.patch, undefined, 'fork mode sends no patch');
    assert.ok(new RegExp(`Shared early look ${SHARE} v1`).test(r.text) && /\+\d+ -\d+/.test(r.text) && /screenshots: 1/.test(r.text), r.text);
    assert.ok(/1 uncommitted file is not in these numbers \(wip\.txt\)/.test(r.text), r.text);
    assert.ok(/show which lots are lit/.test(r.text), 'the direction that arrived on the state read is not lost');
  });
  await check('share_work checks the screenshots before sending anything', async () => {
    const n = requests.length;
    const r = await builder.call('share_work', { title: 'x', summary: 'y', imagePaths: ['nope.png'] });
    assert.ok(r.isError && /Take the screenshot first/.test(r.text), r.text);
    assert.strictEqual(requests.length, n);
  });
  await check('patch true sends the real git format-patch against the base', async () => {
    const n = requests.length;
    const r = await builder.call('share_work', { title: 'Parking map', summary: 'As a patch.', unsure: 'none', patch: true });
    assert.ok(!r.isError, r.text);
    const sent = since(n).find((q) => q.p === 'crew/shares').body.patch;
    const expected = execFileSync('git', ['format-patch', '--stdout', `${BASE}..HEAD`], { cwd: builderDir, encoding: 'utf8' });
    assert.strictEqual(sent, expected);
    assert.ok(/^From [0-9a-f]{40} /.test(sent) && /Subject: \[PATCH 1\/2\] Parking map/.test(sent));
    assert.ok(/a patch \(\d+ KB, 2 commits\)/.test(r.text), r.text);
  });
  await check('in patch mode the patch goes by default', async () => {
    builderMode = 'patch';
    const n = requests.length;
    await builder.call('share_work', { title: 'Parking map', summary: 'Patch mode.', shareId: SHARE });
    const b = since(n).find((q) => q.p === 'crew/shares').body;
    builderMode = 'fork';
    assert.ok(b.patch && b.shareId === SHARE, JSON.stringify(b).slice(0, 200));
  });
  await check('a patch over 300 KB is refused and nothing is sent', async () => {
    gitIn(builderDir, 'checkout', '-q', '-b', 'crew/priya/huge');
    write(builderDir, 'big.txt', Array.from({ length: 9000 }, (_, i) => `line ${i} ${'x'.repeat(40)}`).join('\n'));
    gitIn(builderDir, 'add', 'big.txt'); gitIn(builderDir, 'commit', '-q', '-m', 'huge');
    const n = requests.length;
    const r = await builder.call('share_work', { title: 'Huge', summary: 'Too big.', patch: true });
    gitIn(builderDir, 'checkout', '-q', 'crew/priya/parking');
    assert.ok(r.isError && /Nothing was shared/.test(r.text) && /limit is 300 KB/.test(r.text) && /use a fork/.test(r.text), r.text);
    assert.ok(!since(n).some((q) => q.p === 'crew/shares' || q.p === 'images'), 'no early look and no upload');
  });
  await check('share_pr, comment_share and ask_for_help reach their routes', async () => {
    const n = requests.length;
    const pr = await builder.call('share_pr', { shareId: SHARE, prUrl: 'https://github.com/george/foodbank/pull/7' });
    const cm = await builder.call('comment_share', { shareId: SHARE, text: 'Suggestion 1: done in v3' });
    const hp = await builder.call('ask_for_help', { text: 'The rebase keeps failing on Header.tsx' });
    assert.ok(!pr.isError && /PR open/.test(pr.text) && !cm.isError && !hp.isError, [pr.text, cm.text, hp.text].join('\n'));
    assert.deepStrictEqual(since(n).map((q) => [q.p, q.body]), [
      [`crew/shares/${SHARE}/pr`, { prUrl: 'https://github.com/george/foodbank/pull/7' }],
      [`crew/shares/${SHARE}/comments`, { text: 'Suggestion 1: done in v3' }],
      ['crew/help', { text: 'The rebase keeps failing on Header.tsx' }],
    ]);
    const bad = await builder.call('share_pr', { shareId: SHARE, prUrl: 'github.com/x' });
    assert.ok(bad.isError && /https link/.test(bad.text));
  });
  await check('a builder calling a host tool is told it is the other role\'s', async () => {
    const r = await builder.call('review_share', { shareId: SHARE, does: 'x', recommendation: 'merge' });
    assert.ok(r.isError && /403/.test(r.text) && /other role/.test(r.text) && !/key was refused/.test(r.text), r.text);
  });

  console.log('\nthe host\'s Claude');
  await check('share_repo reads origin, creates the base branch from HEAD, never pushes, and says to push', async () => {
    const head = gitIn(hostDir, 'rev-parse', '--short', 'HEAD');
    const n = requests.length;
    const r = await hostClaude.call('share_repo', { baseBranch: BASE });
    assert.ok(!r.isError, r.text);
    assert.deepStrictEqual(since(n).map((q) => [q.p, q.body]), [['crew/settings', { repoUrl: 'https://github.com/george/foodbank.git', baseBranch: BASE, baseCommit: head }]]);
    assert.strictEqual(gitIn(hostDir, 'rev-parse', '--short', BASE), head, 'the branch exists now');
    assert.strictEqual(gitIn(hostDir, 'rev-parse', '--abbrev-ref', 'HEAD'), 'main', 'nothing was checked out');
    assert.ok(/Created the branch build-room\/4321/.test(r.text) && /PUSH THE BASE BRANCH NOW/.test(r.text) && /git push -u origin build-room\/4321/.test(r.text) && /RUN CREW CODE: OFF/.test(r.text), r.text);
  });
  await check('propose_task posts the task', async () => {
    const n = requests.length;
    const r = await hostClaude.call('propose_task', { text: 'Shift reminders by SMS', detail: 'A text the day before' });
    assert.deepStrictEqual(since(n)[0].body, { text: 'Shift reminders by SMS', detail: 'A text the day before' });
    assert.ok(/Task 003 is on the crew board/.test(r.text), r.text);
  });
  await check('get_share renders versions, where the code is, reactions, comments, reviews and the switch', async () => {
    const r = await hostClaude.call('get_share', { shareId: SHARE });
    assert.ok(!r.isError, r.text);
    for (const re of [/RUN CREW CODE: OFF/, /v1.*A map of three lots/, /code: fork https:\/\/github\.com\/priya-k\/foodbank branch crew\/priya\/parking at 9c41d7a/,
      /code: a patch carried by Engage \(call get_share with fetchPatch true/, /change: 2 files, \+9 -1 \(map\.html, text\.js\)/, /unsure about: Lot hours/,
      /Reactions: 2 looks right, 1 question, 0 concern/, /Ana: Does it work at night\?/, /merge after changes · tests not run · Run crew code was Off/, /1\. Move hours into lots\.json/,
      /fetchPatch true to save it/]) {
      assert.ok(re.test(r.text), `${re}\n${r.text}`);
    }
  });
  await check('get_share with fetchPatch writes the patch into .engage/patches and prints only its path', async () => {
    const n = requests.length;
    const r = await hostClaude.call('get_share', { shareId: SHARE, fetchPatch: true });
    assert.ok(!r.isError, r.text);
    assert.deepStrictEqual(since(n).map((q) => q.p), [`crew/shares/${SHARE}`, `crew/shares/${SHARE}/patch`]);
    const file = path.join(hostDir, '.engage', 'patches', `${SHARE}-v2.patch`);
    assert.strictEqual(fs.readFileSync(file, 'utf8'), PATCH_TEXT);
    assert.ok(r.text.includes(file) && /1 file: text\.js/.test(r.text) && /git am/.test(r.text) && /Run crew code is Off/.test(r.text), r.text);
    assert.ok(!r.text.includes('send("Thanks")'), 'the patch itself is never printed');
    assert.ok(!gitIn(hostDir, 'status', '--porcelain').includes('.engage'), 'the patch stays out of git');
  });
  await check('review_share: a 409 (tests run while the switch is Off) is explained, not just echoed', async () => {
    const r = await hostClaude.call('review_share', { shareId: SHARE, does: 'Adds a map.', recommendation: 'merge', testsRun: true, testsSummary: '42 passed' });
    assert.ok(r.isError, r.text);
    assert.ok(/was not posted/.test(r.text) && /HTTP 409/.test(r.text) && /Run crew code is Off/.test(r.text) && /testsRun false/.test(r.text) && /ask the host to switch Run crew code On/.test(r.text), r.text);
    assert.ok(/Review Sam's too/.test(r.text), 'an inbox on the error is not lost');
  });
  await check('review_share passes the card through', async () => {
    const n = requests.length;
    const r = await hostClaude.call('review_share', { shareId: SHARE, does: 'Adds a map of three lots.', fits: ['Clashes with Sam in Header.tsx'], risk: 'Low', suggestions: ['Move hours into lots.json', 'Add one test'], recommendation: 'merge-after-changes' });
    assert.ok(!r.isError, r.text);
    assert.deepStrictEqual(since(n)[0].body, { does: 'Adds a map of three lots.', fits: ['Clashes with Sam in Header.tsx'], risk: 'Low', suggestions: ['Move hours into lots.json', 'Add one test'], recommendation: 'merge-after-changes', testsRun: false });
    assert.ok(/merge after changes, tests not run/.test(r.text), r.text);
  });
  await check('announce_merge refuses a base this clone shows unpushed, then announces the commit from git', async () => {
    write(hostDir, 'map.html', '<div id="map"></div>\n');
    gitIn(hostDir, 'checkout', '-q', BASE);
    gitIn(hostDir, 'add', 'map.html'); gitIn(hostDir, 'commit', '-q', '-m', 'Merge Priya\'s parking map');
    gitIn(hostDir, 'checkout', '-q', 'main');
    const n = requests.length;
    const refused = await hostClaude.call('announce_merge', { shareId: SHARE });
    assert.ok(refused.isError && /Nothing was announced/.test(refused.text) && /git push origin build-room\/4321/.test(refused.text), refused.text);
    assert.ok(!since(n).some((q) => q.p === 'crew/base'));
    // As a push leaves it: origin's copy of the branch at the same commit.
    gitIn(hostDir, 'update-ref', `refs/remotes/origin/${BASE}`, BASE);
    const m = requests.length;
    const r = await hostClaude.call('announce_merge', { shareId: SHARE, note: 'Priya\'s parking map' });
    assert.ok(!r.isError, r.text);
    const posted = since(m).find((q) => q.p === 'crew/base').body;
    assert.deepStrictEqual(posted, { commit: gitIn(hostDir, 'rev-parse', '--short', BASE), shareId: SHARE, note: 'Priya\'s parking map' });
    assert.ok(/moved to/.test(r.text) && /marked merged/.test(r.text), r.text);
  });

  console.log('\nstdout hygiene');
  await check('neither server wrote anything but JSON-RPC to stdout', async () => {
    assert.deepStrictEqual(builder.nonJson, []);
    assert.deepStrictEqual(hostClaude.nonJson, []);
  });

  for (const m of [builder, hostClaude]) m.child.kill('SIGKILL');
  server.close();
  clearTimeout(hardStop);
  console.log(`\n${pass} passed, ${fail} failed`);
  suiteFinished();
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.log(`  FAIL  suite crashed: ${e && e.stack}`);
  for (const m of [builder, hostClaude]) if (m) m.child.kill('SIGKILL');
  process.exit(1);
});
