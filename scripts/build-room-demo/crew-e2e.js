// Crew mode, end to end, in a real browser with real git: the host's page,
// the host's Claude and two builders' Claudes (the real engage-mcp.mjs, each
// in its own clone), two builders and two followers on phones.
// Run: node scripts/build-room-demo/server.js &  then  node scripts/build-room-demo/crew-e2e.js <outdir>
const { chromium } = require('@playwright/test');
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { hostPage } = require('./host');
const { phone } = require('./phones');
const { mcp } = require('./mcp-client');
const OUT = process.argv[2];
const API = 'http://localhost:8790/api/';
const T = [];
const say = (who, text) => { T.push(`\n### ${who}\n${text}`); console.log(`[${who}] ${String(text).slice(0, 170).replace(/\n/g, ' ')}`); };
const shot = (p, n, full = true) => p.screenshot({ path: `${OUT}/crew-${n}.png`, fullPage: full });
const git = (cwd, ...a) => execFileSync('git', a, { cwd, encoding: 'utf8' }).trim();
const hostApi = async (method, p, body) => { const r = await fetch(`${API}${p}`, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }); return r.json(); };
const write = (dir, file, text) => { fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true }); fs.writeFileSync(path.join(dir, file), text); };

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  // The host's project: a real repo the whole crew can reach.
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'crew-'));
  const hostRepo = path.join(root, 'foodbank');
  fs.mkdirSync(hostRepo);
  git(hostRepo, 'init', '-q', '-b', 'main');
  write(hostRepo, 'index.html', '<h1>Eastside Food Bank</h1>\n<div id="calendar"></div>\n');
  git(hostRepo, 'add', '-A'); git(hostRepo, '-c', 'user.name=George', '-c', 'user.email=g@x', 'commit', '-q', '-m', 'Start');

  const host = await hostPage(browser);
  await host.goto('http://localhost:8790/build');
  await host.getByLabel('Title').fill('Volunteer sign-up for the food bank');
  await host.getByLabel(/Goal/).fill('A one-page site where a volunteer can pick a shift in under a minute, on a phone.');
  await host.getByRole('button', { name: 'Create room' }).click();
  await host.waitForURL(/gameId=/); const GAME = new URL(host.url()).searchParams.get('gameId');
  const room = `games/${GAME}/build`;

  // Open to a crew, through the real dialog.
  await host.getByRole('button', { name: /Open to a crew/ }).first().click();
  await host.waitForTimeout(500);
  await shot(host, '01-open-dialog', false);
  await host.getByRole('dialog').getByRole('button', { name: /Open to a crew/ }).click();
  await host.waitForTimeout(800);
  // The host's Claude: a host key, then share the repo and propose tasks.
  const { key: hostKey } = await hostApi('POST', `${room}/keys`, {});
  const hc = mcp(hostKey, { CLAUDE_PROJECT_DIR: hostRepo }); await hc.init();
  git(hostRepo, 'remote', 'add', 'origin', hostRepo);
  git(hostRepo, 'branch', `build-room/${GAME}`);
  // origin is this same folder in the demo, so a fetch stands in for the push.
  git(hostRepo, 'fetch', '-q', 'origin');
  say('Host Claude: share_repo', await hc.call('share_repo', { baseBranch: `build-room/${GAME}` }));
  for (const t of [['Parking map', 'Show the three lots and walking times'], ['Confirmation text', 'A friendly text after sign-up'], ['Shift reminders', 'A reminder the day before']]) say('Host Claude: propose_task', await hc.call('propose_task', { text: t[0], detail: t[1] }));

  // Two builders and two followers join on phones.
  const priyaP = await phone(browser, GAME, 'Priya');
  const samP = await phone(browser, GAME, 'Sam');
  const anaP = await phone(browser, GAME, 'Ana');
  const marcusP = await phone(browser, GAME, 'Marcus');
  const builderKey = async (p, name) => {
    await p.reload(); await p.waitForTimeout(1200);
    const rejoin = p.getByRole('button', { name: /^Rejoin as/ }); if (await rejoin.count()) { await rejoin.click(); await p.waitForTimeout(1800); }
    await p.getByRole('button', { name: 'I have Claude Code' }).click(); await p.waitForTimeout(1200);
    if (name === 'Priya') await shot(p, '02-phone-builder-key', false);
    const k = (/eng_\d{4}_[A-Za-z0-9_-]{43}/.exec(await p.innerText('body')) || [])[0];
    say(`${name}'s phone`, `key shown once: ${k ? 'yes' : 'NO'}`);
    return k;
  };
  const priyaKey = await builderKey(priyaP, 'Priya');
  const samKey = await builderKey(samP, 'Sam');

  // Each builder clones the host's repo and runs their own Claude in it.
  const clone = (name) => { const d = path.join(root, name.toLowerCase()); git(root, 'clone', '-q', hostRepo, d); git(d, 'checkout', '-q', `build-room/${GAME}`); return d; };
  const priyaDir = clone('Priya'); const samDir = clone('Sam');
  const pc = mcp(priyaKey, { CLAUDE_PROJECT_DIR: priyaDir }); await pc.init();
  const sc = mcp(samKey, { CLAUDE_PROJECT_DIR: samDir }); await sc.init();
  for (const [c, d, n] of [[pc, priyaDir, 'priya'], [sc, samDir, 'sam']]) {
    git(d, 'checkout', '-q', '-b', `crew/${n}/parking`);
    say(`${n} Claude: crew_status`, await c.call('crew_status', { branch: `crew/${n}/parking`, status: 'building' }));
    say(`${n} Claude: claim_task`, await c.call('claim_task', { taskId: '1' }));
  }
  await anaP.reload(); await anaP.waitForTimeout(2500);

  // Priya builds, screenshots, and shares an early look.
  write(priyaDir, 'map.html', '<div id="map">Lot A · Lot B · Lot C</div>\n');
  git(priyaDir, 'add', '-A'); git(priyaDir, '-c', 'user.name=Priya', '-c', 'user.email=p@x', 'commit', '-q', '-m', 'Parking map');
  const mk = async (file, bg, fg, h) => { const pg = await browser.newPage({ viewport: { width: 1200, height: 750 } }); await pg.setContent(`<body style="margin:0;font-family:system-ui;background:${bg};color:${fg};height:750px;padding:60px"><h1 style="font-size:64px">${h}</h1><div style="display:flex;gap:20px">${['A', 'B', 'C'].map((l) => `<div style="flex:1;height:300px;border-radius:16px;background:${fg};color:${bg};font-size:48px;display:grid;place-items:center">Lot ${l}</div>`).join('')}</div></body>`); await pg.screenshot({ path: file }); await pg.close(); };
  await mk(path.join(priyaDir, 'map.png'), '#F4EFE6', '#1F3B2D', 'Where to park');
  say('Priya Claude: share_work', await pc.call('share_work', { title: 'Parking map', summary: 'A map of the three lots under the shift calendar, with walking times.', unsure: 'Lot hours are typed in by hand.', feedbackWanted: 'Is a map better than a list?', imagePaths: ['map.png'] }));
  await host.reload(); await host.waitForTimeout(1500);
  await host.getByRole('tab', { name: /crew/i }).first().click().catch(async () => { await host.getByRole('button', { name: /The crew/ }).first().click(); });
  await host.waitForTimeout(800);
  await shot(host, '03-crew-board');
  // Put it on the wall; the room reacts.
  await host.getByRole('button', { name: 'Put on the wall' }).first().click(); await host.waitForTimeout(1000);
  for (const [p, kind, text] of [[anaP, 'Question', 'Does it show which lots are lit at night?'], [marcusP, 'Looks right', '']]) {
    await p.reload(); await p.waitForTimeout(1200);
    const rejoin = p.getByRole('button', { name: /^Rejoin as/ }); if (await rejoin.count()) { await rejoin.click(); await p.waitForTimeout(1800); }
    await p.getByRole('button', { name: kind }).first().click(); await p.waitForTimeout(300);
    if (text) { await p.getByRole('textbox').last().fill(text); await p.getByRole('button', { name: /^Send/ }).last().click(); }
    await p.waitForTimeout(800);
  }
  await shot(anaP, '04-phone-early-look', true);
  // Feedback to Priya's Claude, and a review by the host's Claude.
  await host.reload(); await host.waitForTimeout(1500);
  await hostApi('GET', `${room}/state`).then(async (st) => {
    const share = st.crew.shares[0];
    await hostApi('POST', `${room}/crew/shares/${share.shareId}/feedback`, { text: 'Keep the map. Mark which lots are lit at night.' });
    await hostApi('POST', `${room}/crew/shares/${share.shareId}/review-request`);
    say('Priya Claude: check_directions', await pc.call('check_directions', {}));
    write(priyaDir, 'map.html', '<div id="map">Lot A (lit) · Lot B · Lot C (lit)</div>\n');
    git(priyaDir, 'add', '-A'); git(priyaDir, '-c', 'user.name=Priya', '-c', 'user.email=p@x', 'commit', '-q', '-m', 'Mark lit lots');
    say('Priya Claude: share_work v2', await pc.call('share_work', { shareId: share.shareId, title: 'Parking map', summary: 'Lit lots are marked.', imagePaths: ['map.png'] }));
    say('Host Claude: check_directions', await hc.call('check_directions', {}));
    say('Host Claude: get_share', (await hc.call('get_share', { shareId: share.shareId })).slice(0, 700));
    say('Host Claude: review_share', await hc.call('review_share', { shareId: share.shareId, does: 'Adds a map of the three lots under the calendar, lit lots marked.', fits: ['Applies cleanly to the base branch'], risk: 'Low. No tests cover the map yet.', suggestions: ['Move the lot hours into a data file', 'Add one test for a closed lot'], recommendation: 'merge-after-changes', testsRun: false }));
    git(priyaDir, 'push', '-q', 'origin', `crew/priya/parking`);
    say('Priya Claude: share_pr', await pc.call('share_pr', { shareId: share.shareId, prUrl: 'https://github.com/george/foodbank/pull/7' }));
    // The host's Claude merges Priya's branch into the base, and tells the crew.
    git(hostRepo, 'checkout', '-q', `build-room/${GAME}`);
    git(hostRepo, '-c', 'user.name=George', '-c', 'user.email=g@x', 'merge', '-q', '--no-ff', '-m', "Merge Priya's parking map", 'crew/priya/parking');
    git(hostRepo, 'fetch', '-q', 'origin');
    say('Host Claude: announce_merge', await hc.call('announce_merge', { shareId: share.shareId, note: "Priya's parking map" }));
    say('Sam Claude: check_directions', await sc.call('check_directions', {}));
    say('Sam Claude: crew_status', await sc.call('crew_status', { status: 'needs-rebase', note: 'map.html clashes with my list' }));
  });
  await host.reload(); await host.waitForTimeout(1500);
  await host.getByRole('button', { name: /The crew/ }).first().click().catch(() => {});
  await host.waitForTimeout(800);
  await shot(host, '05-crew-after-merge');
  await host.keyboard.press('p'); await host.waitForTimeout(500); await shot(host, '06-wall-present', false); await host.keyboard.press('p');
  await priyaP.reload(); await priyaP.waitForTimeout(1500);
  const rejoin = priyaP.getByRole('button', { name: /^Rejoin as/ }); if (await rejoin.count()) { await rejoin.click(); await priyaP.waitForTimeout(1800); }
  await shot(priyaP, '07-phone-builder-lane', true);
  await host.goto(`http://localhost:8790/build?gameId=${GAME}&view=report`); await host.waitForTimeout(2000);
  await shot(host, '08-report');
  fs.writeFileSync(`${OUT}/crew-transcript.md`, `# Crew mode run (game ${GAME})\n${T.join('\n')}\n`);
  for (const c of [hc, pc, sc]) c.close();
  await browser.close();
})().catch((e) => { console.error('CREW E2E FAILED', e.message.split('\n').slice(0, 8).join('\n')); process.exit(1); });
