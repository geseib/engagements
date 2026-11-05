const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
module.exports = (jobs) => {
  const groups = [];
  for (const j of jobs) { let g = groups.find((x) => x.name === j.group); if (!g) groups.push(g = { name: j.group, jobs: [] }); g.jobs.push(j); }
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>New host and participant shots</title>
<style>
:root{color-scheme:light dark;--bg:#fff;--fg:#1B2942;--mut:#5E6167;--rule:#ddd}
@media (prefers-color-scheme:dark){:root{--bg:#0F1A2E;--fg:#F4EDE4;--mut:#9BA8BE;--rule:#25375A}}
body{margin:0;padding:16px;background:var(--bg);color:var(--fg);font:14px/1.45 system-ui,sans-serif}
h1{font-size:20px;margin:0 0 4px} h2{font-size:16px;margin:32px 0 10px;border-top:1px solid var(--rule);padding-top:14px}
.note{color:var(--mut);max-width:70ch}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(440px,1fr));gap:18px}
.grid.phone{grid-template-columns:repeat(auto-fill,minmax(220px,1fr))}
figure{margin:0} figcaption{font-size:13px;margin-bottom:6px} figcaption code{color:var(--mut);font-size:11px;display:block}
img{width:100%;border:1px solid var(--rule);display:block}
a{color:inherit}
</style></head><body>
<h1>What a new host and a new participant see</h1>
<p class="note">The real built bundle (src/dist) against a fake API: Call &amp; Answer session "${esc(jobs[0] && 'Northwind Q4 planning offsite')}". Generated ${esc(new Date().toISOString())}. Click a shot for full size.</p>
${groups.map((g) => `<h2>${esc(g.name)}</h2><div class="grid${/phone/i.test(g.name) ? ' phone' : ''}">${g.jobs.map((j) => `<figure><figcaption>${esc(j.caption)}<code>${esc(j.name)}.png</code></figcaption><a href="${esc(j.name)}.png"><img loading="lazy" src="${esc(j.name)}.png" alt="${esc(j.caption)}"></a></figure>`).join('')}</div>`).join('\n')}
</body></html>`;
};
