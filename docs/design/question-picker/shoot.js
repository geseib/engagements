// Renders each frame of index.html to 1-*.png beside it, and reports overflow, sideways clipping
// and any text below the 12px floor (adapted from docs/design/session-menu/shoot.js).
//   node docs/design/question-picker/shoot.js            all frames
//   node docs/design/question-picker/shoot.js f-3        only that one
const path = require('path');
const { chromium } = require('/opt/node22/lib/node_modules/playwright');

const FRAMES = [
  ['f-1', '1-today.png'],
  ['f-2', '1-doors.png'],
  ['f-3', '1-picker-open.png'],
  ['f-4', '1-search-filter.png'],
  ['f-5', '1-after-ask-next.png'],
  ['f-6', '1-one-screen.png'],
  ['f-7', '1-phone.png'],
];
// Containers that clip on purpose (a scrolling region in the real thing).
const CLIPS = ['frame', 'content', 'cc', 'rail', 'smbody', 'ph-body', 'sm', 'f-sheet', 'olist', 'more-in',
  'pk', 'pk-b', 'pk-f', 'pk-l', 'pk-p', 'rsec', 'f-crop'];

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const page = await browser.newPage({ viewport: { width: 2400, height: 1100 }, deviceScaleFactor: 2 });
  await page.goto(`file://${path.join(__dirname, 'index.html')}`);
  await page.evaluate(() => document.fonts.ready);
  let problems = 0;
  const only = process.argv.slice(2);
  for (const [id, file] of FRAMES.filter(([f]) => !only.length || only.includes(f))) {
    const report = await page.evaluate(({ rootId, clips }) => {
      const root = document.getElementById(rootId);
      const out = [];
      for (const el of root.querySelectorAll('*')) {
        const own = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
        if (own && parseFloat(getComputedStyle(el).fontSize) < 12) out.push(`below 12px: "${el.textContent.trim().slice(0, 30)}"`);
      }
      for (const fr of root.querySelectorAll('.frame')) {
        const fb = fr.getBoundingClientRect();
        for (const el of fr.querySelectorAll('*')) {
          if (el.closest('svg') && el.tagName !== 'svg') continue;
          if (el.classList.contains('pin')) continue;
          if (el.closest('.scrim')) continue;
          const r = el.getBoundingClientRect();
          if (!r.width || !r.height) continue;
          if (r.right > fb.right + 1 || r.bottom > fb.bottom + 1 || r.left < fb.left - 1) {
            out.push(`spills: <${el.tagName.toLowerCase()} class="${el.className.baseVal ?? el.className}"> "${(el.textContent || '').trim().slice(0, 40)}" (${Math.round(r.right - fb.right)}px right, ${Math.round(r.bottom - fb.bottom)}px down)`);
          }
          const cs = getComputedStyle(el);
          if ((cs.overflow === 'hidden' || cs.overflowX === 'hidden') && el.scrollWidth > el.clientWidth + 1 && cs.textOverflow !== 'ellipsis'
            && !clips.some((c) => el.classList.contains(c))) {
            out.push(`cut sideways: <${el.tagName.toLowerCase()} class="${el.className}"> "${(el.textContent || '').trim().slice(0, 40)}"`);
          }
        }
        for (const el of fr.querySelectorAll('.content, .rail, .smbody, .ph-body, .pk-l, .pk-f, .pk-p')) {
          if (el.scrollHeight > el.clientHeight + 1) out.push(`clipped bottom: .${el.className.split(' ')[0]} hides ${el.scrollHeight - el.clientHeight}px`);
        }
      }
      return out;
    }, { rootId: id, clips: CLIPS });
    if (report.length) { problems += report.length; console.log(`${id}:\n  ${report.join('\n  ')}`); } else console.log(`${id}: clean`);
    await page.locator(`#${id}`).screenshot({ path: path.join(__dirname, file) });
    console.log('wrote', file);
  }
  await browser.close();
  process.exitCode = problems ? 1 : 0;
})();
