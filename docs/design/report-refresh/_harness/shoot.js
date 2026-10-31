const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const fs = require('fs'); const path = require('path');
const S = __dirname, OUT = '/home/user/engagements/docs/design/report-refresh/shots';
(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const p = await b.newPage({ viewport: { width: 900, height: 1200 }, deviceScaleFactor: 2 });
  await p.route('https://fonts.googleapis.com/**', r => r.fulfill({ contentType: 'text/css',
    body: fs.readFileSync(S + '/fonts/fonts.css', 'utf8').replace(/url\(([^)]+)\)/g, (m, f) => `url(file://${S}/fonts/${f})`) }));
  await p.route('https://fonts.gstatic.com/**', r => r.abort());
  p.on('pageerror', e => console.log('pageerror', e.message));
  await p.goto('file:///home/user/engagements/docs/design/report-refresh/pages.html');
  await p.evaluate(() => document.fonts.ready); await p.waitForTimeout(400);
  console.log(await p.evaluate(() => [...document.fonts].filter(f => f.status === 'loaded').length + ' fonts loaded'));
  const ids = process.argv.slice(2).length ? process.argv.slice(2) : ['L1','L2','L3','L4','L5','E1','E2','E3','V1','A1','A3'];
  for (const id of ids) await (await p.$('#' + id)).screenshot({ path: `${OUT}/proposal-${id}.png` });
  // greyscale with backgrounds off: what a mono laser with "background graphics" unticked gives
  await p.addStyleTag({ content: '.page{filter:grayscale(1)} .workie{background:none!important}' });
  for (const id of ['L1', 'L2']) await (await p.$('#' + id)).screenshot({ path: `${OUT}/proposal-${id}-grey-noink.png` });
  // overflow check: any .body whose content runs past its box
  console.log(await p.evaluate(() => [...document.querySelectorAll('.page')].map(pg => { const bd = pg.querySelector('.body'); return pg.id + ':' + (bd.scrollHeight - bd.clientHeight); }).join(' ')));
  await b.close();
})();
