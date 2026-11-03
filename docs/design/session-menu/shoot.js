// Renders each frame of index.html to 1-*.png beside it, and reports overflow and any text
// below the 12px floor (adapted from docs/design/impromptu-ask/shoot.js).
//   node docs/design/session-menu/shoot.js            all frames
//   node docs/design/session-menu/shoot.js f-2        only that one
const path = require('path');
const { chromium } = require('/opt/node22/lib/node_modules/playwright');

const FRAMES = [
  ['f-1', '1-ca-up-next.png'],
  ['f-2', '1-ca-sections.png'],
  ['f-3', '1-ca-more-options.png'],
  ['f-4', '1-ca-event.png'],
  ['f-5', '1-trivia-wavelength.png'],
  ['f-6', '1-survey.png'],
  ['f-7', '1-build-room.png'],
  ['f-8', '1-phone-remote.png'],
  ['f-9', '1-one-screen.png'],
  ['f-10', '1-before-after.png'],
];

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const page = await browser.newPage({ viewport: { width: 3000, height: 1100 }, deviceScaleFactor: 2 });
  await page.goto(`file://${path.join(__dirname, 'index.html')}`);
  await page.addStyleTag({ content: '.doc{max-width:none}.scroll{overflow:visible}' });
  await page.evaluate(() => document.fonts.ready);
  let problems = 0;
  const only = process.argv.slice(2);
  for (const [id, file] of FRAMES.filter(([f]) => !only.length || only.includes(f))) {
    const report = await page.evaluate((rootId) => {
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
          const r = el.getBoundingClientRect();
          if (!r.width || !r.height) continue;
          if (r.right > fb.right + 1 || r.bottom > fb.bottom + 1 || r.left < fb.left - 1) {
            out.push(`spills: <${el.tagName.toLowerCase()} class="${el.className.baseVal ?? el.className}"> "${(el.textContent || '').trim().slice(0, 40)}" (${Math.round(r.right - fb.right)}px right, ${Math.round(r.bottom - fb.bottom)}px down)`);
          }
          const cs = getComputedStyle(el);
          if ((cs.overflow === 'hidden' || cs.overflowX === 'hidden') && el.scrollWidth > el.clientWidth + 1 && cs.textOverflow !== 'ellipsis'
            && !['frame', 'content', 'cc', 'rail', 'smbody', 'ph-body', 'smenu', 'doc-in', 'olist', 'sm', 'f-sheet', 'ph-body', 'more-in'].some((c) => el.classList.contains(c))) {
            out.push(`cut sideways: <${el.tagName.toLowerCase()} class="${el.className}"> "${(el.textContent || '').trim().slice(0, 40)}"`);
          }
        }
        for (const el of fr.querySelectorAll('.content, .rail, .smbody, .ph-body')) {
          if (el.scrollHeight > el.clientHeight + 1) out.push(`clipped bottom: .${el.className.split(' ')[0]} hides ${el.scrollHeight - el.clientHeight}px`);
        }
      }
      return out;
    }, id);
    if (report.length) { problems += report.length; console.log(`${id}:\n  ${report.join('\n  ')}`); } else console.log(`${id}: clean`);
    await page.locator(`#${id}`).screenshot({ path: path.join(__dirname, file) });
    console.log('wrote', file);
  }
  await browser.close();
  process.exitCode = problems ? 1 : 0;
})();
