const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const fs = require('fs'); const S = __dirname;
(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const p = await b.newPage({ viewport: { width: 1000, height: 1200 } });
  await p.route('https://fonts.googleapis.com/**', r => r.fulfill({ contentType: 'text/css',
    body: fs.readFileSync(S + '/fonts/fonts.css', 'utf8').replace(/url\(([^)]+)\)/g, (m, f) => `url(file://${S}/fonts/${f})`) }));
  await p.goto('file:///home/user/engagements/docs/design/report-refresh/pages.html');
  await p.addScriptTag({ path: '/home/user/engagements/src/node_modules/html2pdf.js/dist/html2pdf.bundle.min.js' });
  await p.evaluate(() => document.fonts.ready);
  const url = await p.evaluate(async () => {
    const el = document.getElementById('L2');
    el.style.boxShadow = 'none';
    return html2pdf().set({ margin: 0, image: { type: 'jpeg', quality: 0.8 }, html2canvas: { scale: 2, useCORS: true, letterRendering: true },
      jsPDF: { unit: 'pt', format: 'letter' } }).from(el).outputPdf('dataurlstring');
  });
  fs.writeFileSync(S + '/proof-L2.pdf', Buffer.from(url.split(',')[1], 'base64'));
  await b.close();
})();
