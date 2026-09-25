/**
 * C · THE TOTE BOARD — the racecourse infield board engine.
 *
 * Ported from docs/design/scoreboard-2026-09-25/c-tote-board.html, whose
 * header is the design: a black infield board whose figures are LAMPS — 5x7
 * bulb matrices, warm white for the place and amber for the points — under
 * painted column heads, with a finish post standing before the points. And
 * the field MOVES. The first time a page comes up it shows the running order
 * as it stood after the previous round (the rail says "After round 5"),
 * holds a beat, then the rail turns to "After round 6", the lamps relight to
 * the new figures and every row rides to its new place at once: climbers pass
 * over fallers, anyone leaving the page rides off its top or bottom edge and
 * anyone arriving rides in, new players from below. The ▲ / ▼ / NEW markers
 * light only once the field has settled. Later visits to a page (the return
 * to the top page, a host's ← →) skip the replay and show the result.
 *
 * Imperative for departureEngine.js's reason: the ride is a FLIP over measured
 * row positions, which is DOM work, not render work. NAMES ARE TEXT.
 */
import { movementLabel, previousOrder } from '../../../config/scoreboard';
import { fitScale, pagesOf } from './fitScale';

/** 5x7 lamp font: digits and '='. */
const FONT = {
  0: ['01110', '10001', '10011', '10101', '11001', '10001', '01110'],
  1: ['00100', '01100', '00100', '00100', '00100', '00100', '01110'],
  2: ['01110', '10001', '00001', '00010', '00100', '01000', '11111'],
  3: ['11111', '00010', '00100', '00010', '00001', '10001', '01110'],
  4: ['00010', '00110', '01010', '10010', '11111', '00010', '00010'],
  5: ['11111', '10000', '11110', '00001', '00001', '10001', '01110'],
  6: ['00110', '01000', '10000', '11110', '10001', '10001', '01110'],
  7: ['11111', '00001', '00010', '00100', '01000', '01000', '01000'],
  8: ['01110', '10001', '10001', '01110', '10001', '10001', '01110'],
  9: ['01110', '10001', '10001', '01111', '00001', '00010', '01100'],
  '=': ['00000', '00000', '11111', '00000', '11111', '00000', '00000'],
  ' ': ['00000', '00000', '00000', '00000', '00000', '00000', '00000'],
};
const bits = (ch) => (FONT[ch] || FONT[' ']).join('');

/** Which lamps a figure lights, glyph by glyph — exported for tests. */
export function lampBits(text, glyphs) {
  const t = String(text).padStart(glyphs, ' ').slice(-glyphs);
  return t.split('').map(bits);
}

export function createToteEngine(container, {
  reduced = () => false,
  random = Math.random,
  schedule = (fn, ms) => setTimeout(fn, ms),
  cancel = (t) => clearTimeout(t),
  onRound = () => {},
} = {}) {
  const doc = container.ownerDocument;
  const heads = doc.createElement('div');
  heads.className = 'sb-tote-cols sb-tote-heads';
  heads.setAttribute('aria-hidden', 'true');
  [['Pos', 'sb-h-r'], ['Player', ''], ['Move', ''], ['Pts', 'sb-h-r']].forEach(([label, cls]) => {
    const s = doc.createElement('span');
    if (cls) s.className = cls;
    s.textContent = label;
    heads.appendChild(s);
  });
  const win = doc.createElement('div');
  win.className = 'sb-tote-win';
  const list = doc.createElement('ol');
  list.className = 'sb-tote-rows';
  list.setAttribute('role', 'list');
  win.appendChild(list);
  container.appendChild(heads);
  container.appendChild(win);

  let gen = 0;
  let pending = [];
  let field = [];
  let prev = [];
  let size = 10;
  let posN = 2;
  let ptsN = 2;
  let current = [];
  let currentRound = null;
  const clearPending = () => { pending.forEach(cancel); pending = []; };
  const later = (fn, ms, my) => pending.push(schedule(() => { if (my === gen) fn(); }, ms));

  function lamps(text, white, n) {
    const box = doc.createElement('span');
    box.className = `sb-lamps${white ? ' sb-wht' : ''}`;
    box.setAttribute('aria-hidden', 'true');
    for (let g = 0; g < n; g += 1) {
      const lg = doc.createElement('span');
      lg.className = 'sb-lg';
      for (let k = 0; k < 35; k += 1) lg.appendChild(doc.createElement('i'));
      box.appendChild(lg);
    }
    setLamps(box, text, false);
    return box;
  }

  function setLamps(box, text, animate) {
    const glyphs = lampBits(text, box.children.length);
    [...box.children].forEach((lg, g) => {
      const b = glyphs[g];
      [...lg.children].forEach((dot, k) => {
        const on = b[k] === '1';
        const was = dot.classList.contains('sb-on');
        dot.classList.remove('sb-up', 'sb-dn');
        if (animate && on !== was) {
          dot.style.setProperty('--ld', `${(random() * 0.22).toFixed(3)}s`);
          dot.classList.add(on ? 'sb-up' : 'sb-dn');
        }
        dot.classList.toggle('sb-on', on);
      });
    });
    box.dataset.figure = String(text);
  }

  function row(r, { was = false } = {}) {
    const li = doc.createElement('li');
    li.className = 'sb-trow sb-tote-cols';
    li.dataset.id = r.id;
    const mv = movementLabel(r.movement);
    const showPrev = was && r.previousScore !== null && r.previousPlace;
    li.appendChild(lamps(showPrev ? r.previousPlace : r.place, true, posN));
    const nm = doc.createElement('span');
    nm.className = 'sb-tnm';
    nm.textContent = r.name;
    li.appendChild(nm);
    const m = doc.createElement('span');
    m.className = `sb-mvk sb-${mv.kind}`;
    m.textContent = mv.text;
    li.appendChild(m);
    li.appendChild(lamps(showPrev ? r.previousScore : r.total, false, ptsN));
    li.setAttribute('aria-label', `${r.place} ${r.name}, ${r.total} points, ${mv.spoken}`);
    return li;
  }

  function paint(rows, opts = {}) {
    list.textContent = '';
    rows.forEach((r, i) => {
      const li = row(r, opts);
      if (opts.pre) li.classList.add('sb-pre');
      if (opts.enter) { li.style.setProperty('--rd', `${(i * 0.06).toFixed(2)}s`); li.classList.add('sb-enter'); }
      list.appendChild(li);
    });
  }

  /* One scale for every page, found on the tallest (fitScale.js): the row
     list clips, so a page fitted to page 1 alone lost the last row of a later
     page whose name wrapped. The replay's "before" order is a page of its own
     rows too, so it is measured with them. */
  function fit() {
    fitScale([...pagesOf(field, size), ...(prev.length ? pagesOf(prev, size) : [])], {
      setFit: (f) => container.style.setProperty('--fit', f.toFixed(2)),
      paint: (page) => paint(page),
      overflows: () => list.scrollHeight > win.clientHeight + 1,
    });
    list.textContent = '';
  }

  const tops = () => {
    const m = new Map();
    [...list.children].forEach((li) => m.set(li.dataset.id, { top: li.offsetTop, h: li.offsetHeight, el: li }));
    return m;
  };

  /**
   * Show a page. With `replay`, first the order after the previous round, then
   * the ride to this round's. Returns the ms until the markers have lit.
   * `afterRound` is the round the figures belong to; the previous one is N-1.
   */
  function show(rows, { replay = false, page = 0, afterRound = null } = {}) {
    current = rows;
    currentRound = afterRound;
    gen += 1;
    const my = gen;
    clearPending();
    if (reduced()) { onRound(afterRound); paint(rows); return 0; }
    const old = [...list.children];
    let t = 0;
    if (old.length) {
      old.forEach((li, i) => { li.className = 'sb-trow sb-tote-cols sb-leave'; li.style.setProperty('--rd', `${(i * 0.03).toFixed(2)}s`); });
      t = 340 + old.length * 30;
    }
    if (!replay) {
      later(() => { onRound(afterRound); paint(rows, { enter: true }); }, t, my);
      return t + (Math.max(rows.length, 1) - 1) * 60 + 520;
    }

    const a = page * size;
    const before = prev.slice(a, a + size);
    const prevIndex = new Map(prev.map((r, i) => [r.id, i]));
    const curIndex = new Map(field.map((r, i) => [r.id, i]));
    const byId = new Map(field.map((r) => [r.id, r]));

    // 1. the running order as it stood
    later(() => { onRound(afterRound ? afterRound - 1 : null); paint(before, { was: true, pre: true, enter: true }); }, t, my);
    t += (Math.max(before.length, 1) - 1) * 60 + 520 + 1100;

    // 2. the field moves
    later(() => {
      const pre = tops();
      const winH = win.clientHeight;
      onRound(afterRound);
      paint(rows.map((r) => ({ ...r, previousPlace: (prev.find((p) => p.id === r.id) || {}).previousPlace })), { was: true, pre: true });
      const post = tops();
      const gap = parseFloat(doc.defaultView ? doc.defaultView.getComputedStyle(list).rowGap : '') || 8;
      const dur = 1.05;
      const cameFromAbove = (id) => prevIndex.has(id) && prevIndex.get(id) < a;
      const fromAbove = [...post].filter(([id]) => !pre.has(id) && cameFromAbove(id));
      const fromBelow = [...post].filter(([id]) => !pre.has(id) && !cameFromAbove(id));
      const upDy = -(Math.max(0, ...fromAbove.map(([, r]) => r.top + r.h)) + gap);
      const downDy = winH + gap - Math.min(winH, ...fromBelow.map(([, r]) => r.top));
      post.forEach(({ top, el }, id) => {
        const r = byId.get(id);
        let dy;
        if (pre.has(id)) dy = pre.get(id).top - top;
        else if (cameFromAbove(id)) dy = upDy;
        else dy = downDy;
        el.style.setProperty('--dy', `${dy}px`);
        el.style.setProperty('--dur', `${dur}s`);
        el.style.setProperty('--rd', '0s');
        if (dy > 0) el.classList.add('sb-climb');
        el.classList.add('sb-ride');
        // relight: place and points go from the old figures to the new
        setLamps(el.children[0], r.place, true);
        setLamps(el.children[3], r.total, true);
      });
      const leaving = [...pre].filter(([id]) => !post.has(id));
      const offTop = leaving.filter(([id]) => (curIndex.get(id) ?? Infinity) < a);
      const offBottom = leaving.filter(([id]) => !((curIndex.get(id) ?? Infinity) < a));
      const outUp = -(Math.max(0, ...offTop.map(([, r]) => r.top + r.h)) + gap);
      const outDown = winH + gap - Math.min(winH, ...offBottom.map(([, r]) => r.top));
      pre.forEach(({ top, el }, id) => {           // riders leaving this page
        if (post.has(id)) return;
        const g = el.cloneNode(true);
        g.classList.remove('sb-enter');
        g.classList.add('sb-ghost');
        g.setAttribute('aria-hidden', 'true');
        g.style.top = `${top}px`;
        g.style.setProperty('--dy', `${(curIndex.get(id) ?? Infinity) < a ? outUp : outDown}px`);
        g.style.setProperty('--dur', `${dur}s`);
        g.style.setProperty('--rd', '0s');
        g.classList.add('sb-ride');
        list.appendChild(g);
      });
    }, t, my);
    t += 1050 + 120;

    // 3. settled: the markers light, top to bottom
    later(() => {
      list.querySelectorAll('.sb-ghost').forEach((g) => g.remove());
      [...list.children].forEach((li, i) => {
        li.style.setProperty('--md', `${(i * 0.07).toFixed(2)}s`);
        li.classList.remove('sb-pre', 'sb-ride', 'sb-climb');
        li.classList.add('sb-lit');
      });
    }, t, my);
    return t + rows.length * 70 + 340;
  }

  return {
    loadField(allRows, pageSize) {
      gen += 1;
      clearPending();
      field = allRows || [];
      size = pageSize || 10;
      prev = previousOrder(field);
      posN = Math.max(2, ...field.map((r) => String(r.place).length), ...prev.map((r) => String(r.previousPlace).length));
      ptsN = Math.max(2, ...field.map((r) => String(r.total).length));
      container.style.setProperty('--lamp-pos-n', String(posN));
      container.style.setProperty('--lamp-pts-n', String(ptsN));
      fit();
    },
    /** Is there a previous round to replay from? */
    hasHistory() { return prev.length > 0; },
    show,
    snap(rows) { gen += 1; clearPending(); current = rows; paint(rows); },
    /* A resize mid-replay abandons the replay for the result: the rail must
       follow, or it would go on saying "After round 5" over round 6. */
    relayout() { gen += 1; clearPending(); fit(); onRound(currentRound); paint(current); },
    destroy() { gen += 1; clearPending(); heads.remove(); win.remove(); },
  };
}
