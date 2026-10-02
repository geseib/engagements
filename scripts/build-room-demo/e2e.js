// The whole Build Room story, end to end, in a real browser: host + 3 phones +
// Claude (the real engage-mcp.mjs over stdio). Screenshots + a transcript.
const { chromium } = require('@playwright/test');
const { hostPage } = require('./host');
const { phone } = require('./phones');
const { mcp } = require('./mcp-client');
const fs = require('fs');
const OUT = process.argv[2];
const T = []; const say = (who, text) => { T.push(`\n### ${who}\n${text}`); console.log(`[${who}] ${String(text).slice(0, 160).replace(/\n/g, ' ')}`); };
const shot = (p, n, full = true) => p.screenshot({ path: `${OUT}/e2e-${n}.png`, fullPage: full });
const rejoin = async (p) => { await p.reload(); await p.waitForTimeout(1500); const b = p.getByRole('button', { name: /^Rejoin as/ }); if (await b.count()) await b.click(); await p.waitForTimeout(2000); };
const pick = async (p, title, why) => { await p.getByText(title).first().click(); if (why) await p.getByLabel(/Why/).fill(why); await p.getByRole('button', { name: /^Pick/ }).click(); await p.waitForTimeout(600); };
(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const host = await hostPage(browser);
  await host.goto('http://localhost:8790/build');
  await host.getByLabel('Title').fill('Volunteer sign-up for the food bank');
  await host.getByLabel(/Goal/).fill('A one-page site where a volunteer can pick a shift in under a minute, on a phone.');
  await host.getByRole('button', { name: 'Create room' }).click();
  await host.waitForURL(/gameId=/); const GAME = new URL(host.url()).searchParams.get('gameId');
  await host.getByRole('button', { name: 'Connect Claude Code' }).first().click();
  await host.getByRole('button', { name: 'Mint a key' }).click(); await host.waitForTimeout(800);
  const key = (/eng_\d{4}_[A-Za-z0-9_-]{43}/.exec(await host.innerText('body')) || [])[0];
  await host.getByRole('button', { name: 'Done' }).click();
  const claude = mcp(key); await claude.init();
  say('Claude: room_status', await claude.call('room_status', {}));
  say('Claude: post_update', await claude.call('post_update', { text: 'Plan: a shift calendar, a short sign-up form, then a confirmation text. Starting with the header.' }));
  say('Claude: ask_room_to_choose', await claude.call('ask_room_to_choose', { question: 'Which header should volunteers see first?', context: 'Both are running on the laptop. I will flip between them.', options: [{ title: 'Bold banner', description: 'Big Volunteer button over a photo', url: 'http://localhost:5173/a' }, { title: 'Calm photo + calendar', description: 'Shifts visible straight away', url: 'http://localhost:5173/b' }] }));
  // Claude builds two quick mockups, screenshots them, and shares each onto its option.
  const shots = require('fs').mkdtempSync(require('path').join(require('os').tmpdir(), 'brm-shots-'));
  const mock = async (file, bg, fg, headline, sub) => {
    const pg = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    await pg.setContent(`<body style="margin:0;font-family:system-ui;background:${bg};color:${fg};height:800px;display:flex;flex-direction:column;justify-content:center;padding:0 90px"><div style="font-size:22px;letter-spacing:.2em;opacity:.8">EASTSIDE FOOD BANK</div><h1 style="font-size:84px;margin:.2em 0">${headline}</h1><p style="font-size:30px;max-width:900px">${sub}</p><a style="display:inline-block;margin-top:30px;background:${fg};color:${bg};font-size:30px;padding:22px 40px;border-radius:14px;width:max-content">Pick a shift</a></body>`);
    await pg.screenshot({ path: require('path').join(shots, file) }); await pg.close();
  };
  await mock('a.png', '#E8452C', '#FFF7E8', 'Volunteer this week', 'Big, bold, one button. Shifts on the next page.');
  await mock('b.png', '#F4EFE6', '#1F3B2D', 'Saturday 9-12 · 4 spots left', 'The calendar first: see a shift, tap it, done.');
  say('Claude: share_image A', await claude.call('share_image', { path: require('path').join(shots, 'a.png'), caption: 'Choice A: bold banner', kind: 'mockup', askId: '001', label: 'A' }));
  say('Claude: share_image B', await claude.call('share_image', { path: require('path').join(shots, 'b.png'), caption: 'Choice B: calm photo and calendar', kind: 'mockup', askId: '001', label: 'B' }));
  await host.waitForTimeout(9000); // the 8s poll brings Claude's ask in
  await shot(host, '01-host-proposed');
  await host.getByRole('button', { name: /open to the room/i }).click(); await host.waitForTimeout(800);
  const priya = await phone(browser, GAME, 'Priya'); const marcus = await phone(browser, GAME, 'Marcus'); const ana = await phone(browser, GAME, 'Ana');
  await pick(priya, 'Calm photo + calendar', 'Seeing the dates first is what I would want');
  await pick(marcus, 'Bold banner'); await pick(ana, 'Calm photo + calendar', 'Feels calmer on a small screen');
  await host.reload(); await host.waitForTimeout(1500);
  await shot(host, '02-host-live');
  await host.keyboard.press('p'); await host.waitForTimeout(500);
  await shot(host, '03-wall-present-live');
  await host.keyboard.press('p'); await host.waitForTimeout(300);
  const waiting = claude.call('wait_for_room', { askId: '001', maxWaitSeconds: 120 });
  await host.getByRole('button', { name: /^Close/ }).first().click(); await host.waitForTimeout(800);
  await host.getByRole('textbox', { name: 'Direction for Claude' }).fill('Use B, the calm photo with the calendar. Keep the logo from A, and make the sign-up button bigger.');
  await host.getByPlaceholder(/show how many spots/).fill('Marcus: people on phones miss small buttons');
  await host.locator('section.brm-decide').getByRole('button', { name: /Send to Claude/ }).click();
  say('Claude: wait_for_room 001', await waiting);
  await rejoin(priya); await shot(priya, '04-phone-decided', false);
  say('Claude: post_update showing', await claude.call('post_update', { kind: 'showing', text: 'Header B is on screen: calm photo, calendar first, a bigger Sign up button.', link: 'http://localhost:5173/' }));
  await host.getByRole('checkbox', { name: /Review Claude/ }).count().then(() => {});
  say('Claude: ask_room_to_rate', await claude.call('ask_room_to_rate', { question: 'How close is this header to what we want?', lowLabel: 'Far off', highLabel: 'Ship it' }));
  await host.reload(); await host.waitForTimeout(1500);
  await host.getByRole('button', { name: /open to the room/i }).click(); await host.waitForTimeout(800);
  for (const [p, r] of [[priya, '5'], [marcus, '3'], [ana, '4']]) { await rejoin(p); await p.getByRole('radio', { name: `${r} of 5` }).click(); if (p === priya) await shot(p, '05-phone-rate', false); await p.locator('.plr-dock button, button').filter({ hasText: /^(Rate|Send|Submit|Pick)/ }).last().click(); await p.waitForTimeout(500); }
  // an idea from a phone, any time
  await ana.getByRole('button', { name: /Send an idea/ }).click();
  await ana.getByRole('textbox').last().fill('Add a map of where to park');
  await ana.getByRole('button', { name: /^Send idea/ }).click(); await ana.waitForTimeout(800);
  await host.reload(); await host.waitForTimeout(1500);
  await host.getByRole('button', { name: /^Close/ }).first().click(); await host.waitForTimeout(800);
  await shot(host, '06-host-rating-results');
  const waiting2 = claude.call('wait_for_room', { askId: '002', maxWaitSeconds: 60 });
  await host.locator('section.brm-decide').getByRole('button', { name: /Send to Claude/ }).click(); await host.waitForTimeout(800);
  say('Claude: wait_for_room 002', await waiting2);
  // host triages the idea, and logs what the room said out loud
  await host.locator('.brm-idea').getByRole('button', { name: 'Send to Claude' }).first().click(); await host.waitForTimeout(600);
  await host.getByPlaceholder('Log what the room said…').fill('The room liked the friendly tone. Keep the copy warm.');
  await host.getByLabel('Send to Claude', { exact: true }).check().catch(() => {});
  await host.getByRole('button', { name: 'Log', exact: true }).click(); await host.waitForTimeout(600);
  say('Claude: check_directions', await claude.call('check_directions', {}));
  say('Claude: post_update milestone', await claude.call('post_update', { kind: 'milestone', text: 'Sign-up form done: no account needed, shift end times and the last bus shown.' }));
  await host.reload(); await host.waitForTimeout(1500);
  await shot(host, '07-host-idle');
  await host.keyboard.press('p'); await host.waitForTimeout(500); await shot(host, '08-wall-present-idle'); await host.keyboard.press('p');
  await mock('final.png', '#F4EFE6', '#1F3B2D', 'Saturday 9-12 · 4 spots left', 'No account needed. Last bus 12:40. Parking map below.');
  say('Claude: share_image final', await claude.call('share_image', { path: require('path').join(shots, 'final.png'), caption: 'The finished sign-up page', kind: 'final' }));
  say('Claude: wrap_up', await claude.call('wrap_up', { summary: 'The room chose a calm header with the shift calendar first, asked for no account and clear bus times, and rated the header 4 out of 5. The site lets a volunteer pick a shift in under a minute.', built: ['Header B with the food bank logo', 'Shift calendar with end times and the last bus', 'Sign-up form with no account', 'Parking map'], links: [{ label: 'Open the demo', url: 'http://localhost:5173/' }, { label: 'Repository', url: 'https://github.com/example/foodbank-signup' }], nextSteps: ['Send a confirmation text', 'Test with five volunteers'] }));
  // After the wrap-up Claude keeps listening; the host steers from the screen.
  const listening = claude.call('wait_for_direction', { maxWaitSeconds: 120 });
  await host.waitForTimeout(1500);
  await host.reload(); await host.waitForTimeout(1500);
  await shot(host, '08b-host-wrapped');
  await host.getByLabel('Tell Claude').fill('Add a one-line note on parking under the form.');
  await host.locator('.brm-next').getByRole('button', { name: 'Send to Claude' }).click();
  say('Claude: wait_for_direction (after wrap-up)', await listening);
  await host.keyboard.press('p'); await host.waitForTimeout(400); await shot(host, '08c-wall-wrapped'); await host.keyboard.press('p');
  await host.reload(); await host.waitForTimeout(1500);
  await host.getByRole('button', { name: 'End session' }).first().click(); await host.waitForTimeout(500);
  const confirm = host.getByRole('button', { name: /^End/ }); if (await confirm.count() > 1) await confirm.last().click();
  await host.waitForTimeout(1500);
  await rejoin(priya); await shot(priya, '09-phone-ended', false);
  await host.goto(`http://localhost:8790/build?gameId=${GAME}&view=report`); await host.waitForTimeout(2000);
  await shot(host, '10-report');
  fs.writeFileSync(`${OUT}/e2e-claude-transcript.md`, `# What Claude saw (game ${GAME})\n${T.join('\n')}\n`);
  claude.close(); await browser.close();
})().catch((e) => { console.error('E2E FAILED', e.message.split('\n').slice(0, 6).join('\n')); process.exit(1); });
