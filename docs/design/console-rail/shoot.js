// Renders each frame of index.html to N-*.png beside it, and reports text below the 12px
// floor and anything that spills out of its frame.   node docs/design/console-rail/shoot.js
const path = require('path');
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const FRAMES = [
  ['f-1', '1-answering-people-open.png'],
  ['f-2', '2-answering-people-closed.png'],
  ['f-3', '3-voting.png'],
  ['f-4', '4-everyones-in.png'],
  ['f-5', '5-needs-you-people-closed.png'],
  ['f-6', '6-results-scores.png'],
  ['f-7', '7-headers-every-moment.png'],
  ['f-8', '8-person-row-by-format.png'],
];
(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const page = await browser.newPage({ viewport: { width: 1340, height: 1000 }, deviceScaleFactor: 2 });
  await page.goto(`file://${path.join(__dirname, 'index.html')}`);
  let problems = 0;
  for (const [id, file] of FRAMES) {
    const out = await page.evaluate((rootId) => {
      const root = document.getElementById(rootId); const fb = root.getBoundingClientRect(); const o = [];
      for (const el of root.querySelectorAll('*')) {
        if (el.closest('svg') && el.tagName !== 'svg') continue;
        if (el.classList.contains('pin')) continue;
        const own = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
        const cs = getComputedStyle(el);
        if (own && parseFloat(cs.fontSize) < 12) o.push(`below 12px: ${el.className} "${el.textContent.trim().slice(0, 30)}"`);
        const r = el.getBoundingClientRect();
        if (r.width && r.height && (r.right > fb.right + 1 || r.bottom > fb.bottom + 1)) o.push(`spills: ${el.className} "${(el.textContent || '').trim().slice(0, 30)}"`);
        if (own && el.scrollWidth > el.clientWidth + 1 && cs.overflow === 'hidden' && cs.textOverflow !== 'ellipsis') o.push(`cut: ${el.className} "${el.textContent.trim().slice(0, 30)}"`);
      }
      return o;
    }, id);
    if (out.length) { problems += out.length; console.log(id, out.join('\n  ')); } else console.log(id, 'ok');
    await page.locator(`#${id}`).screenshot({ path: path.join(__dirname, file) });
  }
  await browser.close();
  process.exitCode = problems ? 1 : 0;
})();
