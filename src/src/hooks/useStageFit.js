import { useEffect } from 'react';
import { searchScale, buildSacrificeList, isAbbreviated } from './fitPolicy';

/**
 * The DOM half of the fitter — measure and apply. fitPolicy.js owns every
 * decision (what scale is clean, what order to sacrifice in); this file's
 * only job is reading the box and writing the DOM.
 *
 * Ported from docs/design/host-redesign/02-ask-call-and-answer.html,
 * lines 803-1036.
 */

/** Room-facing CONTENT. These may never be abbreviated. Chrome — rail title,
 *  roster names, podium names — may, and is excluded here on purpose. */
const CONTENT = '.q,.qdetail,.recap,.opt .txt,.card .ans,.notes .lead,.notes li span,.hero,.terms .t';

/** Per-profile scale floor, read off the box because Task 1's profile has
 *  already applied it to the stylesheet by the time this runs (the hook must
 *  not import displayProfile.js itself). A profile may never shrink its
 *  content below the profile beneath it: without this floor the TV ladder
 *  scaled itself down to 26.8px on a dense VOTE state while Room rendered the
 *  same text at 30.2px — the big-screen profile ending up SMALLER than the
 *  projector one, which defeats the point of having it. */
function minFit(box) {
  const v = parseFloat(getComputedStyle(box).getPropertyValue('--fit-min'));
  return Number.isFinite(v) && v > 0 ? v : 0.55;
}

/** Ceiling for the scale search. 1 normally — the profile ladder is what the
 *  room needs — but a state carrying a single object (a subject word, a
 *  champion, a join code) may opt into growth via data-grow, because a
 *  ladder derived for a dense screen under-uses a sparse one. The ladder is a
 *  legibility floor, not a ceiling. */
function maxFit(box) {
  return parseFloat(box.dataset.grow) || 1;
}

/** Vertical only. This is the axis .content competes on, and adding width
 *  here would import the same sub-pixel noise the truncation predicate had to
 *  be rescued from. */
function over(box) { return box.scrollHeight > box.clientHeight + 1; }

/** Both axes, for chrome. The rail overflows sideways, and reusing the
 *  vertical-only predicate for it meant the rail's own sacrifice loop could
 *  never see the thing it existed to fix: measured at 1280 with a timer
 *  armed, 1298px of content in a 1280px bar, and not one group dropped. */
function overAny(box) {
  return box.scrollHeight > box.clientHeight + 1 || box.scrollWidth > box.clientWidth + 2;
}

/** Has anything in this box actually lost content? Delegates the "did this
 *  element lie" judgment to fitPolicy's isAbbreviated — the tolerance for
 *  fractional-line-height phantom overflow lives there, once, rather than
 *  being re-derived here. */
function truncated(box) {
  const els = box.querySelectorAll(CONTENT);
  for (let i = 0; i < els.length; i += 1) {
    if (isAbbreviated(getComputedStyle(els[i]), els[i])) return true;
  }
  return false;
}

function clean(box) { return !over(box) && !truncated(box); }
function setFit(box, v) { box.style.setProperty('--fit', v.toFixed(4)); }

/** Measure both column counts and keep the shorter. Width is the cheapest
 *  lever on the stage, so this runs before every scale search. */
function chooseLayout(box) {
  const grid = box.querySelector('.opts:not(.list)');
  if (!grid) return;
  let best = '1';
  let bestH = Infinity;
  ['1', '2'].forEach((n) => {
    grid.dataset.cols = n;
    const h = box.scrollHeight;
    if (h < bestH - 1) { bestH = h; best = n; }
  });
  grid.dataset.cols = best;
}

/** Clears every piece of reduction state BEFORE anything is measured. The
 *  hook runs on mount, on resize, and whenever the question or answer list
 *  changes — in practice on every render — so a fitter that accumulates
 *  reductions instead of recomputing them converges on an empty screen. */
function reset(box) {
  box.removeAttribute('data-clamped');
  box.style.removeProperty('--fit');
  const grid = box.querySelector('.opts:not(.list)');
  if (grid) delete grid.dataset.cols;
  box.querySelectorAll('[data-drop]').forEach((g) => { g.hidden = false; });
  const note = box.querySelector('.reduced');
  if (note) { note.hidden = true; note.textContent = ''; }
}

/** Raw [data-drop] groups in this box, ordered cheapest-loss-first. Handed to
 *  fitPolicy's buildSacrificeList rather than sorted here a second time. */
function readDropGroups(box) {
  return Array.prototype.slice.call(box.querySelectorAll('[data-drop]'))
    .map((el) => ({ el, order: +el.dataset.drop, note: el.dataset.dropNote || null }))
    .sort((a, b) => a.order - b.order);
}

function announce(box, lost) {
  const note = box.querySelector('.reduced');
  if (!note || !lost.length) return;
  note.hidden = false;
  note.textContent = `${lost.join(' · ')} — in the session report`;
}

/** Give the content the meter's column. Width is the cheapest lever on the
 *  stage: a wider measure means fewer lines, which buys height at no cost to
 *  type size and no cost to content. */
function widen(box) {
  const main = box.closest('.main');
  if (!main || main.classList.contains('solo')) return false;
  main.classList.add('solo');
  main.dataset.autoSolo = '1';
  const meter = main.querySelector('.meter');
  if (meter) meter.hidden = true;
  return true;
}

function unwiden(box) {
  const main = box.closest('.main');
  if (!main || !main.dataset.autoSolo) return;
  main.classList.remove('solo');
  delete main.dataset.autoSolo;
  const meter = main.querySelector('.meter');
  if (meter) meter.hidden = false;
}

function hasMeter(box) {
  const main = box.closest('.main');
  return Boolean(main && main.querySelector('.meter'));
}

function isSolo(box) {
  const main = box.closest('.main');
  return Boolean(main && main.classList.contains('solo'));
}

/** Room content: full size → smaller type → different layout → drop chrome
 *  → clamp. CHROME BEFORE CONTENT, ALWAYS — the meter enters the ordered
 *  sacrifice at priority -1, ahead of every content group, through
 *  buildSacrificeList rather than as a special case appended after the drop
 *  loop, which is what let a results state throw away an answer while
 *  keeping a 233px standings column. */
function fitContent(box) {
  reset(box);
  unwiden(box);
  chooseLayout(box);
  const trySearch = (isClean) => searchScale({
    min: minFit(box), max: maxFit(box), isClean, setScale: (v) => setFit(box, v),
  });
  if (trySearch(() => clean(box)) !== null) return;

  const list = buildSacrificeList({
    hasMeter: hasMeter(box), isSolo: isSolo(box), dropGroups: readDropGroups(box),
  });
  const lost = [];
  for (let i = 0; i < list.length; i += 1) {
    if (list[i].kind === 'meter') {
      widen(box);
    } else {
      list[i].el.hidden = true;
      if (list[i].note && lost.indexOf(list[i].note) === -1) lost.push(list[i].note);
      announce(box, lost);
    }
    chooseLayout(box);
    if (trySearch(() => clean(box)) !== null) return;
  }

  // Terminal. Everything above failed, so abbreviate and say so. Reaching
  // this point is a budget failure to fix, not a graceful landing.
  box.dataset.clamped = 'on';
  trySearch(() => !over(box));
}

/** Chrome boxes only sacrifice; their type is fixed by the profile and must
 *  not shrink with content, so there is no scale search here at all. */
function fitChrome(box) {
  reset(box);
  if (!overAny(box)) return;
  const list = buildSacrificeList({ hasMeter: false, isSolo: false, dropGroups: readDropGroups(box) });
  for (let i = 0; i < list.length; i += 1) {
    list[i].el.hidden = true;
    if (!overAny(box)) return;
  }
}

export default function useStageFit(stageRef, deps = []) {
  useEffect(() => {
    const root = stageRef.current;
    if (!root) return undefined;

    /**
     * Publish the dock's MEASURED height as `--dock-measured` on :root.
     *
     * The fixed side panels stop at the top of the dock so they cannot cover
     * the advance control (see styles.css, above `.instructions-sidebar`).
     * They cannot use `--dock-h` for that: `--dock-h` is the dock's
     * MIN-height, and the dock is an `auto` grid row whose content outgrows it
     * on a short viewport — measured at 1280x720 the dock stood 100px tall
     * against a 82.8px token in Table, so a panel subtracting the token still
     * lapped 17px over the dock, and 2px over the primary button itself.
     * Measuring is the only honest answer; `--dock-h` stays as the fallback
     * for the first paint, before this has run.
     */
    const publishDockHeight = () => {
      const dock = root.querySelector('.dock');
      if (!dock) return;
      const h = Math.ceil(dock.getBoundingClientRect().height);
      if (h > 0) document.documentElement.style.setProperty('--dock-measured', `${h}px`);
    };

    const run = () => {
      root.querySelectorAll('.content').forEach(fitContent);
      root.querySelectorAll('.rail, .meter').forEach(fitChrome);
      publishDockHeight();
    };

    run();
    // One more after paint: web fonts and images land after the first pass
    // and change every measurement taken before them.
    const raf = requestAnimationFrame(run);
    window.addEventListener('resize', run);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', run);
      // Nothing else removes a property set on the document root, and a stale
      // one would size a panel on a page that has no dock at all.
      document.documentElement.style.removeProperty('--dock-measured');
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}
