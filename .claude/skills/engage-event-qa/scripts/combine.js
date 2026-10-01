// Stitch screenshots side by side:  QA_DIR=... node combine.js out.png 700 a.png b.png ...
const { chromium } = require(process.env.PLAYWRIGHT || 'playwright'); const fs = require('fs');
const S = process.env.QA_DIR || process.cwd(); const [out, h, ...files] = process.argv.slice(2);
(async () => { const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1600, height: +h + 20 } });
  await p.setContent('<body style="margin:0;background:#888;display:flex;gap:8px;align-items:flex-start">' + files.map((f) => `<img style="height:${h}px" src="data:image/png;base64,${fs.readFileSync(`${S}/shots/${f}`).toString('base64')}">`).join('') + '</body>');
  await p.screenshot({ path: `${S}/shots/${out}`, fullPage: true }); await b.close(); })();
