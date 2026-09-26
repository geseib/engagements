/**
 * B · THE OLYMPIC BOARD — the results-board engine.
 *
 * Ported from docs/design/scoreboard-2026-09-25/b-olympic-board.html, whose
 * header is the design: every row is a LANE — a full-width band with a
 * hard-edged rank block at its left, a three-letter code where the nation
 * would sit (the first three letters of the name as typed), the name in heavy
 * expanded capitals and the mark right-aligned in big tabular figures. Places
 * 1–3 are medal blocks; the leader's lane is taller, carries a gold keyline
 * and gets one light sweep when it posts. Results POST: the old list clears
 * to the right, then each lane wipes in from the left, one after another.
 *
 * Imperative for departureEngine.js's reason, and so the motion is the
 * mockup's line for line. NAMES ARE TEXT, NEVER MARKUP.
 *
 * A long name wraps inside its lane; nothing is ever ellipsised. The board's
 * scale (--fit) is found once per page size, on the TALLEST page (fitScale.js)
 * — the first carries the leader's taller lane, but a later one may carry the
 * name that wraps — and held for every page, so the type does not jump when
 * the page turns and no page clips its last lane.
 */
import { movementLabel } from '../../../config/scoreboard';
import { fitScale, pagesOf } from './fitScale';

/** The three-letter code: the first three letters of the name as typed. */
export function laneCode(name) {
  return String(name || '').normalize('NFD').replace(/[^A-Za-z]/g, '').slice(0, 3).toUpperCase();
}

export function createOlympicEngine(container, {
  reduced = () => false,
  schedule = (fn, ms) => setTimeout(fn, ms),
  cancel = (t) => clearTimeout(t),
} = {}) {
  const doc = container.ownerDocument;
  const heads = doc.createElement('div');
  heads.className = 'sb-olb-cols sb-olb-heads';
  heads.setAttribute('aria-hidden', 'true');
  [['Rank', 'sb-h-rk'], ['Player', 'sb-h-nm'], ['Move', 'sb-h-mv'], ['Pts', 'sb-h-pt']].forEach(([label, cls]) => {
    const s = doc.createElement('span');
    s.className = cls;
    s.textContent = label;
    heads.appendChild(s);
  });
  const list = doc.createElement('ol');
  list.className = 'sb-olb-rows';
  list.setAttribute('role', 'list');
  container.appendChild(heads);
  container.appendChild(list);

  let gen = 0;
  let pending = [];
  let current = [];
  let pages = [[]];
  const clearPending = () => { pending.forEach(cancel); pending = []; };

  const span = (cls, text) => {
    const s = doc.createElement('span');
    s.className = cls;
    if (text !== undefined) s.textContent = text;
    return s;
  };

  function lane(r, i) {
    const li = doc.createElement('li');
    li.className = `sb-orow sb-olb-cols${r.rank === 1 ? ' sb-lead' : ''}`;
    li.style.setProperty('--d', `${(i * 0.11).toFixed(2)}s`);
    const mv = movementLabel(r.movement);
    li.appendChild(span(`sb-rk${r.rank <= 3 ? ` sb-m${r.rank}` : ''}`, r.place));
    li.appendChild(span('sb-tg', laneCode(r.name)));
    li.appendChild(span('sb-onm', r.name));
    li.appendChild(span(`sb-mv sb-${mv.kind}`, mv.text));
    li.appendChild(span('sb-pt', String(r.total)));
    if (r.rank === 1) {
      const sweep = span('sb-sweep');
      sweep.setAttribute('aria-hidden', 'true');
      li.appendChild(sweep);
    }
    li.setAttribute('aria-label', `${r.place} ${r.name}, ${r.total} points, ${mv.spoken}`);
    return li;
  }

  function paint(rows, animate) {
    list.textContent = '';
    rows.forEach((r, i) => {
      const li = lane(r, i);
      if (animate) li.classList.add('sb-post');
      list.appendChild(li);
    });
  }

  function fit() {
    fitScale(pages, {
      setFit: (f) => container.style.setProperty('--fit', f.toFixed(2)),
      paint: (page) => paint(page, false),
      overflows: () => list.scrollHeight > list.clientHeight + 1,
    });
    list.textContent = '';
  }

  /** Post `rows`. Returns the ms until the last lane lands. */
  function show(rows) {
    current = rows;
    gen += 1;
    const my = gen;
    clearPending();
    if (reduced()) { paint(rows, false); return 0; }
    const old = [...list.children];
    let wait = 0;
    if (old.length) {
      old.forEach((li, i) => {
        li.classList.remove('sb-post');
        li.style.setProperty('--d', `${(i * 0.03).toFixed(2)}s`);
        li.classList.add('sb-clear');
      });
      wait = 220 + old.length * 30;
    }
    pending.push(schedule(() => { if (my === gen) paint(rows, true); }, wait));
    return wait + (Math.max(rows.length, 1) - 1) * 110 + 700 + (rows.some((r) => r.rank === 1) ? 900 : 0);
  }

  return {
    loadField(allRows, pageSize) {
      gen += 1;
      clearPending();
      pages = pagesOf(allRows || [], pageSize || 10);
      fit();
    },
    show,
    snap(rows) { gen += 1; clearPending(); current = rows; paint(rows, false); },
    relayout() { gen += 1; clearPending(); fit(); paint(current, false); },
    destroy() { gen += 1; clearPending(); heads.remove(); list.remove(); },
  };
}
