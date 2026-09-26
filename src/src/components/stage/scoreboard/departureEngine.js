/**
 * A · THE DEPARTURE BOARD — the split-flap engine.
 *
 * Ported from docs/design/scoreboard-2026-09-25/a-departure-board.html, whose
 * header is the design: a fixed grid of flap modules in a housing, one
 * character per flap, and every change happening by flaps FALLING. Cells that
 * do not change do not move; changed cells rattle through one to three
 * intermediate characters and land, staggered by line then by column, so a
 * page change reads as a wave travelling down the board. The board wakes
 * blank and flaps to page 1.
 *
 * WHY IMPERATIVE. A Room page is ~11 lines x ~31 flaps, each running its own
 * few-step sequence on its own clock. As React state that is hundreds of
 * re-renders a second; as the mockup does it — one DOM node per flap, glyphs
 * and a parity class set directly — it is none. DepartureBoard.jsx owns the
 * container and hands it here; nothing else writes inside it.
 *
 * NAMES ARE TEXT, NEVER MARKUP: every glyph goes in through textContent.
 *
 * A LONG NAME TAKES A SECOND LINE OF FLAPS, wrapped at a word (or a hyphen),
 * never ellipsised. The board's line count is the most any page of the
 * current page size needs, so the grid never changes shape between pages —
 * exactly like a physical board, where a continuation line has blank
 * place/points flaps.
 */
import { movementLabel } from '../../../config/scoreboard';

const STEP_MS = 120;                        // one flap fall
const ALPHA = 'ABCDEFGHIJKLMNOPRSTUVWY';
const DIGITS = '0123456789';
const NAME_MAX = 24;                        // a 24-flap name module at most
const NAME_MIN = 12;

/*
  ONE FLAP PER CHARACTER AS A READER SEES IT. A string's `length` and
  `split('')` count UTF-16 units, so an emoji (two units) or a flag (four, two
  code points) was cut in half across two flaps, each showing a broken glyph.
  Graphemes where the runtime can segment them, code points otherwise.
*/
const segmenter = typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function'
  ? new Intl.Segmenter(undefined, { granularity: 'grapheme' })
  : null;
export function graphemes(text) {
  const str = String(text ?? '');
  return segmenter ? Array.from(segmenter.segment(str), (s) => s.segment) : Array.from(str);
}
const width = (text) => graphemes(text).length;

/** Break a name into lines of at most `n` characters: at spaces, then at hyphens, then hard. */
export function wrapName(name, n) {
  const words = String(name || '').toUpperCase().split(/\s+/).filter(Boolean);
  const tokens = [];
  for (const w of words) {
    if (width(w) <= n) { tokens.push(w); continue; }
    for (const part of w.split(/(?<=-)/)) {
      const chars = graphemes(part);
      for (let i = 0; i < chars.length; i += n) tokens.push(chars.slice(i, i + n).join(''));
    }
  }
  const lines = [];
  let line = '';
  for (const t of tokens) {
    const glue = line && !line.endsWith('-') ? ' ' : '';
    if (!line) line = t;
    else if (width(line + glue + t) <= n) line += glue + t;
    else { lines.push(line); line = t; }
  }
  if (line) lines.push(line);
  return lines.length ? lines : [''];
}

/** Column widths for the whole field, so the grid is the same shape on every page. */
export function columnsFor(allRows) {
  const rows = allRows || [];
  return {
    pos: Math.max(2, ...rows.map((r) => width(r.place))),
    pts: Math.max(2, ...rows.map((r) => width(r.total))),
    mv: Math.max(3, ...rows.map((r) => width(movementLabel(r.movement).text))),
  };
}

/** The lines of flaps one page needs: each row, then its name's continuation lines. */
export function linesFor(rows, n) {
  const out = [];
  for (const r of rows) {
    const mv = movementLabel(r.movement);
    wrapName(r.name, n).forEach((nm, i) => out.push(i === 0
      ? { pos: String(r.place), nm, pts: String(r.total), mv: mv.text, mk: mv.kind }
      : { pos: '', nm, pts: '', mv: '', mk: 'eq' }));
  }
  return out;
}

export function createDepartureEngine(container, {
  reduced = () => false,
  random = Math.random,
  schedule = (fn, ms) => setTimeout(fn, ms),
  cancel = (t) => clearTimeout(t),
} = {}) {
  const doc = container.ownerDocument;
  const body = doc.createElement('div');
  body.className = 'sb-sfb-body';
  const inner = doc.createElement('div');
  inner.className = 'sb-sfb-inner';
  const heads = doc.createElement('div');
  heads.className = 'sb-sfb-heads';
  heads.setAttribute('aria-hidden', 'true');
  [['Pos', 'sb-h-r'], ['Player', ''], ['Pts', 'sb-h-r'], ['Move', '']].forEach(([label, cls]) => {
    const s = doc.createElement('span');
    if (cls) s.className = cls;
    s.textContent = label;
    heads.appendChild(s);
  });
  const grid = doc.createElement('div');
  grid.className = 'sb-sfb-grid';
  inner.appendChild(heads);
  inner.appendChild(grid);
  body.appendChild(inner);
  container.appendChild(body);

  let field = [];
  let size = 10;
  let cols = columnsFor([]);
  let geom = null;
  let cells = [];
  let gen = 0;
  let timers = [];
  let current = [];

  const clearTimers = () => { timers.forEach(cancel); timers = []; };

  const pages = () => {
    const out = [];
    for (let i = 0; i < Math.max(1, Math.ceil(field.length / size)); i += 1) out.push(field.slice(i * size, i * size + size));
    return out;
  };

  function fit() {
    const W = body.clientWidth;
    const H = body.clientHeight - 4;
    const win = doc.defaultView;
    const vh = (win && win.innerHeight ? win.innerHeight : 0) / 100;
    const floor = parseFloat(win ? win.getComputedStyle(container).getPropertyValue('--floor') : '') || 20;
    const headFs = parseFloat(win ? win.getComputedStyle(heads.firstChild).fontSize : '') || floor;
    const headH = headFs * 1.25;
    const fixed = cols.pos + cols.pts + cols.mv;
    const minCw = floor / 0.62 / 1.4;
    const all = pages();
    const lineCount = (n) => Math.max(size, ...all.map((p) => linesFor(p, n).length));
    for (let cw = 90; cw >= minCw; cw -= 0.25) {
      const ch = cw * 1.4; const cgap = cw * 0.1; const colgap = cw * 0.7; const lgap = ch * 0.14;
      const n = Math.floor((W - 3 * colgap + cgap * 4) / (cw + cgap)) - fixed;
      if (n < NAME_MIN) continue;
      const nm = Math.min(n, NAME_MAX);
      const L = lineCount(nm);
      const h = headH + (0.8 * vh + 4) + L * ch + (L - 1) * lgap;
      if (h <= H) return { cw, ch, cgap, colgap, lgap, n: nm, L, fs: ch * 0.62 };
    }
    const cw = minCw; const ch = cw * 1.4;
    return { cw, ch, cgap: cw * 0.1, colgap: cw * 0.7, lgap: ch * 0.14, n: NAME_MIN, L: lineCount(NAME_MIN), fs: ch * 0.62 };
  }

  function mkFlap() {
    const el = doc.createElement('span');
    el.className = 'sb-fl';
    const halves = ['sb-fh sb-ft', 'sb-fh sb-fb', 'sb-fh sb-lf sb-flt', 'sb-fh sb-lf sb-flb'].map((cls) => {
      const h = doc.createElement('span');
      h.className = cls;
      const b = doc.createElement('b');
      h.appendChild(b);
      el.appendChild(h);
      return b;
    });
    return { el, g: halves, ch: ' ', k: 'sb-k-nm', par: 0 };
  }

  const setGlyph = (b, ch, k) => { b.textContent = ch === ' ' ? '' : ch; b.className = k; };
  function setStatic(c, ch, k) {
    c.el.classList.remove('sb-p0', 'sb-p1');
    c.g.forEach((b) => setGlyph(b, ch, k));
    c.ch = ch; c.k = k;
  }

  const sameShape = (a, b) => a && b && ['cw', 'n', 'L'].every((k) => a[k] === b[k])
    && a.cols.pos === b.cols.pos && a.cols.pts === b.cols.pts && a.cols.mv === b.cols.mv;

  /** Lay the grid out. Keeps the flaps (and what they say) when the shape is unchanged. */
  function build() {
    const next = { ...fit(), cols: { ...cols } };
    if (cells.length && sameShape(next, geom)) return;
    geom = next;
    const px = (v) => `${v}px`;
    inner.style.setProperty('--cw', px(geom.cw));
    inner.style.setProperty('--ch', px(geom.ch));
    inner.style.setProperty('--cgap', px(geom.cgap));
    inner.style.setProperty('--colgap', px(geom.colgap));
    inner.style.setProperty('--lgap', px(geom.lgap));
    inner.style.setProperty('--fs', px(geom.fs));
    inner.style.setProperty('--st', `${STEP_MS}ms`);
    const w = (n) => px(n * geom.cw + (n - 1) * geom.cgap);
    [cols.pos, geom.n, cols.pts, cols.mv].forEach((n, i) => { heads.children[i].style.width = w(n); });
    grid.textContent = '';
    cells = [];
    for (let l = 0; l < geom.L; l += 1) {
      const ln = doc.createElement('div');
      ln.className = 'sb-sfb-ln';
      const row = [];
      for (const n of [cols.pos, geom.n, cols.pts, cols.mv]) {
        const cg = doc.createElement('span');
        cg.className = 'sb-cg';
        for (let i = 0; i < n; i += 1) { const c = mkFlap(); cg.appendChild(c.el); row.push(c); }
        ln.appendChild(cg);
      }
      grid.appendChild(ln);
      cells.push(row);
    }
  }

  function targetsFor(rows) {
    const specs = linesFor(rows, geom.n);
    const out = [];
    for (let l = 0; l < geom.L; l += 1) {
      const s = specs[l] || { pos: '', nm: '', pts: '', mv: '', mk: 'eq' };
      const seg = (txt, n, right) => {
        const chars = graphemes(txt).slice(0, n);
        const pad = Array(n - chars.length).fill(' ');
        return right ? [...pad, ...chars] : [...chars, ...pad];
      };
      const chars = [...seg(s.pos, cols.pos, true), ...seg(s.nm, geom.n), ...seg(s.pts, cols.pts, true), ...seg(s.mv, cols.mv)];
      const kinds = [
        ...Array(cols.pos).fill('sb-k-pos'), ...Array(geom.n).fill('sb-k-nm'),
        ...Array(cols.pts).fill('sb-k-pts'), ...Array(cols.mv).fill(`sb-k-${s.mk}`),
      ];
      out.push(chars.map((ch, i) => [ch, kinds[i]]));
    }
    return out;
  }

  /** Flap to `rows`. Returns the ms until the last flap lands. */
  function show(rows) {
    current = rows;
    gen += 1;
    const my = gen;
    clearTimers();
    const T = targetsFor(rows);
    const still = reduced();
    let end = 0;
    T.forEach((line, l) => line.forEach(([ch, k], c) => {
      const cell = cells[l][c];
      if (cell.ch === ch && cell.k === k) return;
      if (still) { setStatic(cell, ch, k); return; }
      const pool = /[0-9]/.test(ch) || k === 'sb-k-pos' || k === 'sb-k-pts' ? DIGITS : ALPHA;
      const hops = ch === ' ' && cell.ch === ' ' ? 0 : 1 + Math.floor(random() * 3);
      const seq = [];
      for (let i = 0; i < hops; i += 1) seq.push([pool[Math.floor(random() * pool.length)], k]);
      seq.push([ch, k]);
      const start = l * 70 + c * 22 + random() * 40;
      seq.forEach(([to, tk], i) => {
        timers.push(schedule(() => {
          if (my !== gen) return;
          const [t, b, lt, lb] = cell.g;
          setGlyph(t, to, tk); setGlyph(lb, to, tk);                 // new: static top, rising lower leaf
          setGlyph(b, cell.ch, cell.k); setGlyph(lt, cell.ch, cell.k); // old: static bottom, falling top leaf
          cell.par ^= 1;
          cell.el.classList.remove('sb-p0', 'sb-p1');
          cell.el.classList.add(`sb-p${cell.par}`);
          cell.ch = to; cell.k = tk;
        }, start + i * STEP_MS));
      });
      end = Math.max(end, start + seq.length * STEP_MS);
    }));
    return end;
  }

  /** Instant, used after a resize and by reduced motion. */
  function snap(rows) {
    gen += 1;
    clearTimers();
    current = rows;
    targetsFor(rows).forEach((line, l) => line.forEach(([ch, k], c) => setStatic(cells[l][c], ch, k)));
  }

  return {
    /**
     * The whole field and the page size: they fix the grid's shape. A new
     * shape is built blank (the board wakes blank and flaps to its page); the
     * same shape — a refetch after a round is scored — keeps its flaps, so
     * only the cells that change move.
     */
    loadField(allRows, pageSize) {
      field = allRows || [];
      size = pageSize || 10;
      cols = columnsFor(field);
      clearTimers();
      gen += 1;
      build();
    },
    show,
    snap,
    /** Re-measure (a resize, a profile change) and redraw the current page at once. */
    relayout() {
      geom = null;
      build();
      snap(current);
    },
    /** What each line of flaps says now, for tests and the curious. */
    text() {
      return cells.map((row) => row.map((c) => c.ch).join(''));
    },
    /** ...and flap by flap. */
    cells() {
      return cells.map((row) => row.map((c) => c.ch));
    },
    destroy() {
      gen += 1;
      clearTimers();
      body.remove();
    },
  };
}
