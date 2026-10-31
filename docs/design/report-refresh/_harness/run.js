const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const fs = require('fs');
(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const p = await b.newPage({ viewport: { width: 1280, height: 1000 } });
  p.on('console', m => console.log('console:', m.text().slice(0, 200)));
  p.on('pageerror', e => console.log('pageerror:', e.message));
  await p.goto('file://' + __dirname + '/dist/index.html');
  await p.waitForSelector('.report-doc');
  await p.evaluate(() => document.fonts.ready);
  await p.waitForTimeout(500);
  console.log(await p.evaluate(() => [...document.fonts].filter(f => f.status === 'loaded').map(f => f.family + ' ' + f.weight + ' ' + f.stretch).join(' | ')));
  await p.screenshot({ path: __dirname + '/screen.png', fullPage: true });
  const url = await p.evaluate(() => window.makePdf());
  fs.writeFileSync(__dirname + '/baseline.pdf', Buffer.from(url.split(',')[1], 'base64'));
  await b.close();
})();
