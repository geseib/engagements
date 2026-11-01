// Renders each frame of index.html to p-*.png beside it, and checks every frame for
// overflow (a descendant that spills past its frame, or text cut without an ellipsis).
//   node docs/design/experience-plan/shoot.js
const path = require('path');
const { chromium } = require('/opt/node22/lib/node_modules/playwright');

const FRAMES = [
  ['f-p1', 'p-1-frame-two-screen-ca.png'],
  ['f-p2', 'p-2-frame-two-screen-trivia.png'],
  ['f-p3', 'p-3-one-screen-and-remote.png'],
  ['f-p4', 'p-4-takeover-participant.png'],
  ['f-p5', 'p-5-primitives-before-after.png'],
];

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const page = await browser.newPage({ viewport: { width: 1800, height: 1100 }, deviceScaleFactor: 2 });
  await page.goto(`file://${path.join(__dirname, 'index.html')}`);
  await page.evaluate(() => document.fonts.ready);
  let problems = 0;
  for (const [id, file] of FRAMES) {
    const report = await page.evaluate((rootId) => {
      const root = document.getElementById(rootId);
      const out = [];
      // Each .frame inside (or the root itself) bounds its descendants.
      const frames = root.classList.contains('frame') ? [root] : [...root.querySelectorAll('.frame')];
      for (const fr of frames) {
        const fb = fr.getBoundingClientRect();
        for (const el of fr.querySelectorAll('*')) {
          if (el.closest('svg') && el.tagName !== 'svg') continue;
          if (el.classList.contains('pin') || el.classList.contains('anno-tag') || el.classList.contains('anno-fmt')) continue;
          const r = el.getBoundingClientRect();
          if (r.width === 0 || r.height === 0) continue;
          if (r.right > fb.right + 1 || r.bottom > fb.bottom + 1 || r.left < fb.left - 1) {
            out.push(`spills: <${el.tagName.toLowerCase()} class="${el.className.baseVal ?? el.className}"> "${(el.textContent || '').trim().slice(0, 40)}" (${Math.round(r.right - fb.right)}px right, ${Math.round(r.bottom - fb.bottom)}px down)`);
          }
          const cs = getComputedStyle(el);
          const clipsX = cs.overflow === 'hidden' || cs.overflowX === 'hidden';
          if (clipsX && el.scrollWidth > el.clientWidth + 1 && cs.textOverflow !== 'ellipsis' && !el.classList.contains('frame') && !el.classList.contains('content') && !el.classList.contains('cc') && !el.classList.contains('ppl') && !el.classList.contains('stg')) {
            out.push(`cut sideways: <${el.tagName.toLowerCase()} class="${el.className}"> "${(el.textContent || '').trim().slice(0, 40)}"`);
          }
        }
        // Stacked regions that are clipped vertically: report how much is hidden.
        for (const el of fr.querySelectorAll('.content, .ppl, .stg, .cc')) {
          if (el.scrollHeight > el.clientHeight + 1) out.push(`clipped bottom: .${el.className.split(' ')[0]} hides ${el.scrollHeight - el.clientHeight}px`);
        }
      }
      return out;
    }, id);
    if (report.length) { problems += report.length; console.log(`${id}:\n  ` + report.join('\n  ')); } else console.log(`${id}: no overflow`);
    await page.locator(`#${id}`).screenshot({ path: path.join(__dirname, file) });
    console.log('wrote', file);
  }
  await browser.close();
  process.exitCode = problems ? 1 : 0;
})();
