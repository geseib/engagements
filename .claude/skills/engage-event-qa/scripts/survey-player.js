// Paste into the driver (run.sh). Defines G.survey(name, idx) which answers any survey to the end.
G.texts = ['More time for the small-group parts.', 'The agenda was clear; the pace was good.', 'Would like the slides shared afterwards.', 'Great energy in the room.', 'Shorter intro, longer discussion.'];
G.survey = async (n, idx) => { const p = P[n]; const seen = [];
  for (let step = 0; step < 25; step++) { const body = await text(p, 3000);
    if (/that(’|')s everything/.test(body)) { seen.push('DONE'); break; }
    if (/Check your answers/.test(body) && await p.getByRole('button', { name: /Send my answers/ }).count()) { await p.getByRole('button', { name: /Send my answers/ }).click(); await sleep(3000); continue; }
    const btns = await p.$$eval('button', (e) => e.map((x) => ({ l: x.getAttribute('aria-label') || '', t: (x.innerText || '').trim(), d: x.disabled })));
    const rate = btns.filter((b) => /^\d+ of \d+$/.test(b.l)); let kind = '';
    if (rate.length) { kind = 'rating'; await p.locator(`button[aria-label="${rate[(idx + 3) % rate.length].l}"]`).click(); }
    else if (btns.some((b) => /^Add /.test(b.l || b.t))) { kind = 'rank'; for (const b of btns.filter((b) => /^Add /.test(b.l || b.t))) await p.getByRole('button', { name: b.l || b.t }).first().click().catch(() => {}); }
    else { const radios = await p.locator('[role=radio], input[type=radio]').count();
      const opts = btns.filter((b) => b.t && !/^(Back|Next|Skip|AGENDA|Review|Agenda|Change|Answer)$/.test(b.t) && !b.l.startsWith('Help') && !b.d && !/Something else/.test(b.t));
      if (radios) { kind = 'radio'; await p.locator('[role=radio], input[type=radio]').nth(idx % radios).click(); }
      else if (opts.length) { kind = 'choice'; await p.locator('button').filter({ hasText: opts[idx % opts.length].t }).first().click(); }
      const ta = p.locator('textarea:visible, input[type=text]:visible'); if (await ta.count()) { kind += ' text'; await ta.first().fill(G.texts[idx % 5]); } }
    seen.push(kind);
    const nx = p.getByRole('button', { name: /^(Next|Review)$/ }); if (await nx.count()) await nx.first().click(); else { const sk = p.getByRole('button', { name: 'Skip' }); if (await sk.count()) await sk.click(); }
    await sleep(1200); }
  return seen; };
