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
 *  roster names, podium names — may, and is excluded here on purpose.
 *  `.svw .svr-bar-l` / `.svw .svr-rank-l` joined fix round 1 (I1): the survey
 *  walk-through's choice-bar and rank-item labels, once styles/stage.css
 *  stopped letting them ellipsis unconditionally — the same "may only be
 *  clamped behind [data-clamped=\"on\"]" contract every other entry here
 *  already holds to. */
const CONTENT = '.q,.qdetail,.recap,.opt .txt,.card .ans,.notes .lead,.notes li span,.hero,.terms .t,.svw .svr-bar-l,.svw .svr-rank-l';

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
    /*
     * AND THE HOST'S FRAME ABOVE THE STAGE (experience plan 2h). Where "Your
     * part now" sits under the top bar (`.dock--part` inside `.stage-now`)
     * there is no bottom dock, so `--dock-measured` is 0 and the panels run to
     * the bottom edge; instead they start below the frame, at
     * `--stage-now-bottom` (the Needs-you line's bottom edge, or Your part
     * now's), because the Session menu opens "over the content area, never
     * over Your part now" (PLAN §3.2b) and must leave the main button live.
     */
    const publishDockHeight = () => {
      const rootStyle = document.documentElement.style;
      const dock = root.querySelector('.dock:not(.dock--part)');
      if (dock) {
        const h = Math.ceil(dock.getBoundingClientRect().height);
        if (h > 0) rootStyle.setProperty('--dock-measured', `${h}px`);
      } else if (root.querySelector('.dock--part')) {
        rootStyle.setProperty('--dock-measured', '0px');
      }
      const frame = root.querySelector('.stage-needs') || root.querySelector('.stage-now');
      if (frame) {
        const b = Math.ceil(frame.getBoundingClientRect().bottom);
        if (b > 0) rootStyle.setProperty('--stage-now-bottom', `${b}px`);
      }
    };

    /*
     * CONTENT THAT GROWS AFTER THE FIT (experience plan 2h, measured in
     * Chromium). A reveal that lands a beat after its render (trivia's
     * RESULTS: the split and the CORRECT mark arrive ~1.5s later, with no new
     * fitKey) grew `.content` 36px past its box at TV 1280x720 and nothing
     * re-fitted. It used to be rescued by accident: the bottom dock's status
     * changed height at about the same moment and its observer refitted. With
     * Your part now on top, at one fixed height, that accident is gone, so the
     * content's own box is watched: `settled` is each fitbox's height as the
     * last run left it, and only a change from THAT refits. A run is
     * deterministic, so the run it triggers leaves the same heights and the
     * observer goes quiet (no loop).
     */
    const fitboxes = Array.prototype.slice.call(root.querySelectorAll('.content > .fitbox'));
    const contents = fitboxes.map((el) => el.parentNode).filter(Boolean);
    const settled = new Map();
    const remember = () => fitboxes.forEach((el) => settled.set(el, Math.round(el.getBoundingClientRect().height)));

    const run = () => {
      root.querySelectorAll('.content').forEach(fitContent);
      root.querySelectorAll('.rail, .meter').forEach(fitChrome);
      publishDockHeight();
      remember();
    };

    run();
    // One more after paint: web fonts and images land after the first pass
    // and change every measurement taken before them.
    const raf = requestAnimationFrame(run);
    // And once the web fonts are in: one frame is not always enough (measured
    // 17 Oct 2026, the Build Room's window at 1366x768 TV: a fit taken on the
    // fallback font left Claude's status line 32px under the dock). The wall's
    // canvas (present/PresentStage.jsx) waits on the same promise.
    let live = true;
    if (typeof document !== 'undefined' && document.fonts && document.fonts.ready) {
      document.fonts.ready.then(() => { if (live) run(); }).catch(() => {});
    }
    window.addEventListener('resize', run);
    // The dock is an auto grid row: when it takes a second line (Dock.jsx
    // useCrowded, which runs after this) the stage loses height and the fit
    // taken before it is stale (walk of dev 92f8b24d: TV results at 1366x768
    // left at --fit 1 with 86px over). Refit when the dock's height changes.
    // The frame's rows above the stage (2h) are auto rows too: a top bar or a
    // Your part now that changes height changes `.main`'s box the same way.
    // `.main` itself too: it is the box every row above and below takes from.
    // The heights are taken NOW, not at the observer's first callback: a row
    // that settled between this effect and that callback (measured: a frame
    // row 6px taller once its fonts were in, TV 1366x768) was otherwise
    // recorded as the baseline and never refitted.
    // And the meter, by its WIDTH: a count or a name list arriving widens its
    // column and narrows the content's, which then wraps taller (measured:
    // a closed survey at TV 1366x768 left 2px over). A meter the fitter hides
    // changes size too; the refit lands where the first did and goes quiet.
    const watched = Array.prototype.slice.call(root.querySelectorAll('.dock, .stage-top, .stage-now, .stage-needs, .main, .meter'));
    const sizeOf = (el) => { const b = el.getBoundingClientRect(); return `${Math.round(b.width)}x${Math.round(b.height)}`; };
    const heights = new Map(watched.map((el) => [el, sizeOf(el)]));
    const ro = watched.length && typeof ResizeObserver === 'function'
      ? new ResizeObserver(() => {
        let changed = false;
        watched.forEach((el) => {
          const h = sizeOf(el);
          if (heights.has(el) && heights.get(el) !== h) changed = true;
          heights.set(el, h);
        });
        if (changed) run();
      })
      : null;
    if (ro) watched.forEach((el) => ro.observe(el));
    let grewRaf = 0;
    const grew = fitboxes.length && typeof ResizeObserver === 'function'
      ? new ResizeObserver(() => {
        if (grewRaf) return;
        grewRaf = requestAnimationFrame(() => {
          grewRaf = 0;
          if (!live) return;
          const moved = fitboxes.some((el) => settled.has(el)
            && Math.abs(Math.round(el.getBoundingClientRect().height) - settled.get(el)) > 1);
          // A FIT TAKEN AT THE EDGE (measured on the merge of 2h with 2f/2g:
          // Trivia answering at TV 1280x720 fitted with its box at 444px and
          // 445px of content, inside the 1px tolerance; the box then settled
          // a sub-pixel shorter, 443px, which no rounded size above shows,
          // and stayed 2px over). So the content boxes are watched too, and
          // one that is over and not clamped refits. A run always ends clean
          // or clamped, and a clamped box is over by design, so this cannot
          // loop.
          const edge = contents.some((box) => box.dataset.clamped !== 'on' && over(box));
          if (moved || edge) run();
        });
      })
      : null;
    if (grew) fitboxes.forEach((el) => grew.observe(el));
    if (grew) contents.forEach((el) => grew.observe(el));
    return () => {
      live = false;
      cancelAnimationFrame(raf);
      if (grewRaf) cancelAnimationFrame(grewRaf);
      window.removeEventListener('resize', run);
      if (ro) ro.disconnect();
      if (grew) grew.disconnect();
      // Nothing else removes a property set on the document root, and a stale
      // one would size a panel on a page that has no dock at all.
      document.documentElement.style.removeProperty('--dock-measured');
      document.documentElement.style.removeProperty('--stage-now-bottom');
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}
