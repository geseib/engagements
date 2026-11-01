// Renders each frame of index.html to 1-*.png beside it.
//   node docs/design/phone-comments/shoot.js
const path = require('path');
const { chromium } = require('/opt/node22/lib/node_modules/playwright');

const FRAMES = [
  ['f-today', '1-01-today.png'],
  ['f-today-novotes', '1-02-today-empty-list.png'],
  ['f-proposed', '1-03-proposed-panel.png'],
  ['f-compose-workie', '1-04-compose-workies-read.png'],
  ['f-compose-answer', '1-05-compose-one-response.png'],
  ['f-sent', '1-06-sent.png'],
  ['f-many', '1-07-many-responses.png'],
  ['f-small', '1-08-small-360-panel.png'],
  ['f-small-compose', '1-09-small-360-compose.png'],
  ['f-entry', '1-10-way-in.png'],
];

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const page = await browser.newPage({ viewport: { width: 1320, height: 1000 }, deviceScaleFactor: 2 });
  await page.goto(`file://${path.join(__dirname, 'index.html')}`);
  await page.evaluate(() => document.fonts.ready);
  for (const [id, file] of FRAMES) {
    await page.locator(`#${id}`).screenshot({ path: path.join(__dirname, file) });
    console.log('wrote', file);
  }
  await browser.close();
})();
