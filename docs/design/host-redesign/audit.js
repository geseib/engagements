/* ===========================================================================
   Host stage audit — the checks the FIRST sweep could not fail.
   ===========================================================================

   The original sweep asserted three things: the page does not scroll, no rect
   falls outside the viewport, and no text is under 20px. All sixteen mockups
   passed, and a design critic then found nine blocking defects — six of which
   were sitting inside those three assertions' blind spot.

   The blind spot is specific and worth naming, because it is the reason a
   green sweep meant nothing:

     `.stage` is `overflow: hidden`. `.content` was a `justify-content: center`
     flex column, also `overflow: hidden`. When content exceeds that box a
     centred column overflows BOTH ends and both ends are clipped. There is no
     scrollbar (overflow is hidden), and there is no out-of-bounds rect (the
     clipper's own rect is in bounds). The content is silently decapitated —
     the top of the question is the first thing to go — and every assertion
     the sweep made was still true.

   So the assertions below are built around the failure mode rather than
   around the happy path. The load-bearing one is A2: for every element that
   clips, compare its scroll size against its client size. That single check
   catches the decapitation, the Field Notes overflow, the six-option trivia
   clip and the rail truncation, because all four are the same bug.

   A2 has to tolerate DELIBERATE truncation (line clamps, ellipsis), so A7
   exists to stop that tolerance becoming a loophole: anything that truncates
   must prove it declared a truncation that actually renders. "Clipped with no
   ellipsis" — the rail defect — is exactly the gap between A2 and A7.

   Usage
   -----
   Loaded by audit.html, which runs it over every mockup in a hidden iframe at
   every profile x viewport. Also runnable from a console against any base
   path:  await window.HostAudit.runAll({ base: '_baseline/' })

   Everything here is intended to port to component tests as-is: the checks
   take a Document and a viewport, and know nothing about how the page got
   there.
   =========================================================================== */

(function (global) {
  'use strict';

  /* --------------------------------------------------------------- config */

  const FILES = [
    '01-lobby.html', '02-ask-call-and-answer.html', '03-ask-trivia.html',
    '04-ask-wavelength.html', '05-vote.html', '06-results-call-and-answer.html',
    '07-results-trivia.html', '08-results-wavelength.html', '09-field-notes.html',
    '10-ended.html', '11-console.html', '12-density-table.html',
    '13-density-call.html', '14-density-tv.html', '15-edge-minimum.html',
    '16-phase-wipe.html',
    '18-question-browser.html', '19-how-to-play.html', '21-results-revealed.html',
    // Stageless surfaces. A phone and a setup form are never projected, so the
    // angular floors, the fitter invariants and the single-progress-statement
    // rule are all meaningless for them — but "does the page scroll" and "is
    // the text readable" still are, so they are checked for those rather than
    // dropped. Silently excluding a page is how a surface stops being verified.
    '17-remote.html', '20-setup.html',
  ];
  const STAGELESS = new Set(['17-remote.html', '20-setup.html']);

  /* Legacy names, so the same audit runs against the pre-revision baseline. */
  const BASELINE_FILES = [
    '01-lobby.html', '02-ask-call-and-answer.html', '03-ask-trivia.html',
    '04-ask-wavelength.html', '05-vote.html', '06-results-call-and-answer.html',
    '07-results-trivia.html', '08-results-wavelength.html', '09-field-notes.html',
    '10-ended.html', '11-console.html', '12-density-table.html',
    '13-density-call.html', '14-edge-40-players.html', '15-edge-long-question.html',
    '16-phase-wipe.html',
  ];

  /* The two viewports the brief pins, plus the two the density switch turns on
     and the one the rail was measured to fail at. */
  const VIEWPORTS = [
    [1920, 1080], [1280, 720], [1600, 900], [1512, 945], [3840, 2160],
  ];

  /* Angular floors, not pixel floors — see spec section 4.2. A pixel floor is
     only meaningful once you fix the viewing distance and the pixel density,
     and the four display profiles fix them differently. */
  const PROFILE_FLOOR = { 'd-room': 20, 'd-tv': 26, 'd-call': 20, 'd-table': 16 };
  const PROFILES = ['d-room', 'd-tv', 'd-call', 'd-table'];

  /* Elements permitted below their profile's floor, because they are operator
     affordances read at arm's length and are SUPPOSED to be illegible from the
     back row. Every entry here is a deliberate exemption, not an oversight. */
  const FLOOR_EXEMPT = ['.console', '.console-edge', '.tag', '.dock-more'];

  /* ------------------------------------------------------------- utilities */

  const clips = (cs) => /hidden|clip|auto|scroll/.test(cs.overflowY) ||
                        /hidden|clip|auto|scroll/.test(cs.overflowX);

  /** Does this element declare a truncation that will actually render? */
  function truncation(cs) {
    const clamp = cs.webkitLineClamp || cs['-webkit-line-clamp'];
    if (clamp && clamp !== 'none') return 'line-clamp';
    // text-overflow only renders on a block container with non-wrapping inline
    // content. On a flex container it is inert — which is precisely how the
    // rail came to clip mid-glyph while the spec promised an ellipsis.
    if (cs.textOverflow === 'ellipsis' &&
        /nowrap|pre$/.test(cs.whiteSpace) &&
        !/flex|grid/.test(cs.display)) return 'ellipsis';
    return null;
  }

  const sel = (el) => {
    const c = (el.className && el.className.baseVal !== undefined)
      ? el.className.baseVal : (el.className || '');
    return el.tagName.toLowerCase() + (c ? '.' + String(c).trim().split(/\s+/).join('.') : '');
  };

  const inside = (el, selector) => !!(el.closest && el.closest(selector));
  const exempt = (el) => FLOOR_EXEMPT.some((s) => inside(el, s));

  /**
   * Every element on the stage that is worth measuring.
   *
   * A drawn QR code is ~900 <rect> children; walking them multiplied every
   * check by three orders of magnitude and made the suite too slow to iterate
   * with. SVG internals have no CSS box worth asserting on, so the whole
   * subtree is skipped at the root.
   */
  function stageElements(doc) {
    const out = [];
    if (!doc.querySelector('.stage')) {
      const walk0 = (node) => {
        for (let el = node.firstElementChild; el; el = el.nextElementSibling) {
          if (el.tagName === 'svg' || el.tagName === 'SVG') { out.push(el); continue; }
          out.push(el);
          if (el.firstElementChild) walk0(el);
        }
      };
      walk0(doc.body);
      return out;
    }
    const walk = (node) => {
      for (let el = node.firstElementChild; el; el = el.nextElementSibling) {
        const tag = el.tagName;
        if (tag === 'svg' || tag === 'SVG') { out.push(el); continue; }
        out.push(el);
        if (el.firstElementChild) walk(el);
      }
    };
    doc.querySelectorAll('.stage').forEach((s) => { out.push(s); walk(s); });
    return out;
  }

  /**
   * One read-only pass per rendered page.
   *
   * The checks below all want the same three things about the same elements:
   * computed style, box geometry, and scroll-vs-client size. Letting each
   * check fetch them independently meant five traversals and ~1000 style
   * resolutions per render, which made a full run too slow to iterate with.
   * Everything is gathered here in a single pass and the checks become pure
   * functions over the snapshot — which is also the shape they need to be in
   * to port into component tests.
   */
  function snapshot(doc) {
    const win = doc.defaultView;
    return stageElements(doc).map((el) => {
      const cs = win.getComputedStyle(el);
      return {
        el, cs,
        sel: sel(el),
        rect: el.getBoundingClientRect(),
        sh: el.scrollHeight, ch: el.clientHeight,
        sw: el.scrollWidth, cw: el.clientWidth,
        inConsole: inside(el, '.console'),
        inTag: inside(el, '.tag'),
        // Purely decorative: marked aria-hidden and carrying no text. The dusk
        // field deliberately bleeds past the frame and is clipped by design;
        // clipping art is not the same event as clipping a question.
        decorative: !!(el.closest('[aria-hidden="true"]') && !el.textContent.trim()),
        clippedByAncestor: (function () {
          let p = el.parentElement;
          while (p && p !== doc.documentElement) {
            const pcs = win.getComputedStyle(p);
            if (/hidden|clip|auto|scroll/.test(pcs.overflowY) ||
                /hidden|clip|auto|scroll/.test(pcs.overflowX)) return true;
            p = p.parentElement;
          }
          return false;
        })(),
        exempt: exempt(el),
        leaf: el.children.length === 0 && !!el.textContent.trim(),
        fontSize: parseFloat(cs.fontSize),
        shown: cs.display !== 'none' && cs.visibility !== 'hidden',
      };
    });
  }

  function srgb(c) { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }
  function lum(rgb) { return 0.2126 * srgb(rgb[0]) + 0.7152 * srgb(rgb[1]) + 0.0722 * srgb(rgb[2]); }
  function parseRGB(s) {
    const m = String(s).match(/-?[\d.]+/g);
    return m ? [+m[0], +m[1], +m[2], m[3] === undefined ? 1 : +m[3]] : null;
  }
  function effectiveBg(el, win) {
    let n = el;
    while (n && n.nodeType === 1) {
      const c = parseRGB(win.getComputedStyle(n).backgroundColor);
      if (c && c[3] > 0.55) return c;
      n = n.parentElement;
    }
    return [15, 26, 46, 1];
  }
  function contrast(a, b) {
    const la = lum(a), lb = lum(b);
    return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
  }

  /* ------------------------------------------------------------ the checks */

  /** A1 — the page itself must not scroll, in either axis. */
  function A1(doc, w, h, add) {
    const de = doc.documentElement;
    if (de.scrollHeight > h + 1) add('A1', `page scrolls vertically by ${de.scrollHeight - h}px`);
    if (de.scrollWidth > w + 1) add('A1', `page scrolls horizontally by ${de.scrollWidth - w}px`);
  }

  /**
   * A2 — SILENT CLIPPING. The check the first sweep did not have.
   *
   * Any element that clips and whose content exceeds its box is losing content
   * with no scrollbar and no signal, unless it declared a truncation. This is
   * the assertion that catches decapitated questions, the Field Notes
   * overflow, the six-option trivia clip and the mid-glyph rail cut.
   */
  function A2(snap, w, h, add) {
    snap.forEach((n) => {
      if (n.inConsole) return;                     // the one surface allowed to scroll
      if (n.decorative) return;                    // see snapshot(): bleeding art is not lost content
      if (!clips(n.cs)) return;
      const dy = n.sh - n.ch, dx = n.sw - n.cw;
      if (dy <= 2 && dx <= 2) return;
      if (truncation(n.cs)) return;                // deliberate; A7 polices it
      if (/auto|scroll/.test(n.cs.overflowY) && dy > 2) {
        add('A2', `${n.sel} SCROLLS on the stage (${dy}px of hidden content)`);
        return;
      }
      add('A2', `${n.sel} clips ${dy > 2 ? dy + 'px vertically' : ''}` +
                `${dy > 2 && dx > 2 ? ' and ' : ''}${dx > 2 ? dx + 'px horizontally' : ''}` +
                ` with no ellipsis and no clamp (content ${n.sh}px in a ${n.ch}px box)`);
    });
  }

  /** A3 — nothing may render outside the stage box. */
  function A3(snap, w, h, add) {
    snap.forEach((n) => {
      if (n.inConsole || n.inTag || n.decorative) return;
      // An element an ancestor is already clipping has not escaped the frame —
      // the room never sees it there. A2 owns that failure; double-reporting it
      // here would make one defect look like twenty.
      if (n.clippedByAncestor) return;
      const r = n.rect;
      if (r.width === 0 && r.height === 0) return;
      const over = Math.max(r.bottom - h, r.right - w, -r.top, -r.left);
      if (over > 2) add('A3', `${n.sel} is ${Math.round(over)}px outside the viewport`);
    });
  }

  /** A4 — no room-facing text below the profile's floor. */
  /**
   * The floor is read from the stylesheet's own `--floor`, not from a table
   * here. A profile may legitimately declare a different floor at a viewport
   * where its ladder cannot be honoured — the TV profile drops to the Room
   * ladder below 820px tall rather than clip — and an audit that asserted a
   * hardcoded 26px there would be reporting the fallback as a defect. A5
   * separately asserts that each profile declares the floor the spec says it
   * should at the viewports where its own ladder applies.
   */
  function A4(snap, w, h, add, profile) {
    const declared = parseFloat(
      snap[0] && snap[0].el.ownerDocument.defaultView
        .getComputedStyle(snap[0].el.ownerDocument.documentElement)
        .getPropertyValue('--floor'));
    const floor = Number.isFinite(declared) ? declared : (PROFILE_FLOOR[profile] || 20);
    snap.forEach((n) => {
      if (n.exempt || !n.leaf || !n.shown) return;
      if (n.fontSize < floor - 0.5) {
        add('A4', `${n.sel} is ${n.fontSize.toFixed(1)}px, under the ${floor}px floor ${profile} declares here — "${n.el.textContent.trim().slice(0, 26)}"`);
      }
    });
  }

  /**
   * A6 — the primary action must be visible, inside the viewport with real
   * clearance, and must be the topmost element at its own centre. The last
   * clause is what catches the Console drawer sitting on top of it.
   */
  function A6(doc, w, h, add) {
    const btn = doc.querySelector('.dock .btn.primary');
    if (!btn) { add('A6', 'no primary action found in the dock'); return; }
    const r = btn.getBoundingClientRect();
    if (r.right > w - 8 || r.left < 8 || r.bottom > h - 4 || r.top < 0) {
      add('A6', `primary action has under 8px clearance (right edge at ${r.right.toFixed(1)} of ${w}, bottom ${r.bottom.toFixed(1)} of ${h})`);
    }
    const hit = doc.elementFromPoint((r.left + r.right) / 2, (r.top + r.bottom) / 2);
    if (hit && hit !== btn && !btn.contains(hit)) {
      add('A6', `primary action is COVERED at its centre by ${sel(hit)} — the session cannot be advanced by click`);
    }
    if (!doc.querySelector('.dock .dock-more')) {
      add('A6', 'no Console entry point in the dock — the operator surface is unreachable without a keystroke');
    }
  }

  /**
   * A7 — a truncating element must prove its truncation renders.
   * A2 waves through anything that declares a clamp or an ellipsis; without
   * A7 that tolerance would let "clipped mid-word with no ellipsis" pass by
   * simply adding an inert `text-overflow` to a flex container.
   */
  function A7(snap, w, h, add) {
    snap.forEach((n) => {
      if (n.inConsole) return;
      if (!clips(n.cs)) return;
      if (n.sw - n.cw <= 2 && n.sh - n.ch <= 2) return;
      if (!truncation(n.cs)) return;                  // A2 already reported it
      if (n.cs.textOverflow === 'ellipsis' && /flex|grid/.test(n.cs.display)) {
        add('A7', `${n.sel} sets text-overflow:ellipsis on a ${n.cs.display} container — inert, it will clip mid-glyph`);
      }
    });
    // The inverse trap: an element declaring an ellipsis it can never render.
    snap.forEach((n) => {
      if (n.cs.textOverflow !== 'ellipsis') return;
      if (!/flex|grid/.test(n.cs.display)) return;
      add('A7', `${n.sel} declares an ellipsis it cannot render (display:${n.cs.display})`);
    });
  }

  /**
   * Room-facing CONTENT — the things that may never be abbreviated. Chrome
   * (rail title, roster names, podium names) is excluded on purpose: those
   * may ellipsis, and the drop order handles them.
   */
  const CONTENT_SEL = '.q,.qdetail,.recap,.opt .txt,.card .ans,.notes .lead,.notes li span,' +
    '.hero,.terms .t,.anon-line,.dock .status,.dock .hint,.pod .nm,.howto span';

  /**
   * A10 — A REDUCTION MAY ONLY FIRE WHEN SPACE IS ACTUALLY EXHAUSTED.
   *
   * This is the check whose absence let the worst defect in the design ship
   * twice. Measured on 03-ask-trivia at 1920x1080 before the fix: the content
   * box was 800px, its children consumed 669px, and the fitter had still
   * clamped five of six options and stepped the type down a rung. 131px sat
   * unused. Every previous assertion passed, because none of them looked at
   * the space a reduction had failed to use.
   *
   * Epsilon is one line of the largest text in the box, not a fixed number:
   * text reflows in whole lines, so no fitter can ever land closer than that.
   * Anything beyond one line is the fitter leaving space on the table.
   */
  /**
   * A10 — a reduction may only fire when space is actually exhausted.
   *
   * The previous implementation was circular, and the circularity was mine:
   * epsilon included the height of the group that had just been dropped, so
   * dropping a card always excused a card-sized gap and the check could never
   * catch over-reduction. It passed on a screen that discarded an answer while
   * keeping a 233px standings column and leaving 117px empty.
   *
   * The question it must ask is not "is the leftover space small?" but
   * "WOULD A CHEAPER REDUCTION HAVE FIT?" — which is answerable by experiment,
   * without reimplementing the fitter: revert the most expensive reduction and
   * see whether the box can still be made clean by scaling alone.
   */
  function A10(snap, w, h, add) {
    const doc = snap.length ? snap[0].el.ownerDocument : null;
    if (!doc) return;
    const win = doc.defaultView;

    doc.querySelectorAll('.content').forEach((box) => {
      const child = box.firstElementChild;
      if (!child) return;

      const truncates = (el) => {
        const cs = win.getComputedStyle(el);
        const clamp = cs.webkitLineClamp;
        const declares = (clamp && clamp !== 'none' && clamp !== '') ||
          (cs.textOverflow === 'ellipsis' && /nowrap|pre$/.test(cs.whiteSpace));
        if (!declares) return false;
        const lh = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.2;
        return el.scrollHeight > el.clientHeight + Math.max(2, lh * 0.5) ||
               el.scrollWidth > el.clientWidth + 2;
      };
      const overflows = () => box.scrollHeight > box.clientHeight + 1;
      const cleanNow = () => !overflows() &&
        ![...box.querySelectorAll(CONTENT_SEL)].some(truncates);

      const fitAttr = () => {
        const v = parseFloat(win.getComputedStyle(box).getPropertyValue('--fit'));
        return Number.isFinite(v) ? v : 1;
      };
      const maxFit = parseFloat(box.dataset.grow) || 1;
      const minFit = parseFloat(win.getComputedStyle(box).getPropertyValue('--fit-min')) || 0.55;
      const setFit = (v) => box.style.setProperty('--fit', v.toFixed(4));

      /**
       * Can scaling alone, within the permitted range, make this clean?
       * Six steps rather than twelve: this is a boolean question, and each
       * step forces a layout — twelve took the suite from 13s to 397s.
       */
      const STEPS = 6;
      const scaleFindsClean = () => {
        for (let k = 0; k <= STEPS; k++) {
          setFit(maxFit - (maxFit - minFit) * (k / STEPS));
          if (cleanNow()) return true;
        }
        return false;
      };

      const main = box.closest('.main');
      const meterTaken = !!(main && main.dataset.autoSolo);
      const dropped = [...box.querySelectorAll('[data-drop]')].filter((e) => e.hidden);
      const clamped = box.hasAttribute('data-clamped');
      const scaled = fitAttr() < maxFit - 0.001;

      const savedFit = box.style.getPropertyValue('--fit');
      const restore = () => {
        if (savedFit) box.style.setProperty('--fit', savedFit);
        else box.style.removeProperty('--fit');
      };

      // --- A10a: was the most expensive reduction necessary? ---------------
      // Order of expense, cheapest first: scale, meter column, dropped groups,
      // clamp. Revert the dearest active one and retry with scaling alone.
      let revert = null, label = '';
      if (clamped) {
        label = 'the terminal clamp';
        revert = () => { box.removeAttribute('data-clamped'); };
      } else if (dropped.length) {
        const last = dropped.sort((a, b) => (+b.dataset.drop) - (+a.dataset.drop))[0];
        label = 'dropping "' + (last.dataset.dropNote || 'a group') + '"';
        revert = () => { last.hidden = false; };
      } else if (meterTaken) {
        label = 'taking the meter column';
        revert = () => {
          main.classList.remove('solo');
          const m = main.querySelector('.meter');
          if (m) m.hidden = false;
        };
      }

      if (revert) {
        const undo = [];
        if (clamped) undo.push(() => box.setAttribute('data-clamped', 'on'));
        revert();
        const avoidable = scaleFindsClean();
        // put it back exactly as it was
        if (clamped) box.setAttribute('data-clamped', 'on');
        if (dropped.length) dropped.forEach((e) => { e.hidden = true; });
        if (meterTaken) {
          main.classList.add('solo');
          const m = main.querySelector('.meter');
          if (m) m.hidden = true;
        }
        restore();
        if (avoidable) {
          add('A10', `${label} was avoidable — reverting it and scaling alone still fits cleanly. ` +
                     `A cheaper reduction existed and the fitter did not take it.`);
          return;
        }
      }

      // --- A10b: did the scale search find the LARGEST clean scale? --------
      if (scaled) {
        const cur = fitAttr();
        const up = Math.min(maxFit, cur * 1.06);
        setFit(up);
        const stillClean = cleanNow();
        restore();
        if (stillClean) {
          add('A10', `type was scaled to ${cur.toFixed(2)} but ${up.toFixed(2)} also fits cleanly — ` +
                     `the scale search under-shot`);
          return;
        }
      }

      // --- A10c: no reduction at all, and a lot of the stage unused --------
      // This never used to run, so a state could sit 38% empty invisibly.
      if (!scaled && !clamped && !dropped.length && !meterTaken) {
        const unused = box.clientHeight - child.getBoundingClientRect().height;
        const frac = unused / Math.max(1, box.clientHeight);
        if (frac > 0.25 && !box.dataset.grow) {
          add('A10', `${Math.round(frac * 100)}% of the stage is unused with no reduction active and ` +
                     `no data-grow declared — the state should either grow into the space or lose it`);
        }
      }
    });
  }

  /**
   * A11 — room-facing content is never abbreviated.
   *
   * The design's rule, and the one all three first-look evaluators reduced
   * their objections to: if it does not fit, the type steps down, the layout
   * changes, and chrome is sacrificed — before a single word is cut.
   */
  function A11(snap, w, h, add) {
    const doc = snap.length ? snap[0].el.ownerDocument : null;
    if (!doc) return;
    const win = doc.defaultView;
    doc.querySelectorAll(CONTENT_SEL).forEach((e) => {
      if (e.closest('.console')) return;
      const cs = win.getComputedStyle(e);
      // Only an element that DECLARES a truncation can abbreviate anything.
      // Ordinary text wraps and grows its parent, which A2 owns. Checking
      // every element instead produces phantom failures from sub-pixel
      // line-heights — the same artefact that broke the fitter itself.
      if (!truncation(cs)) return;
      const lh = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.2;
      const dy = e.scrollHeight - e.clientHeight;
      const dx = e.scrollWidth - e.clientWidth;
      if (dy > Math.max(2, lh * 0.5) || dx > 2) {
        add('A11', `${sel(e)} is abbreviated on the stage — "` +
                   `${e.textContent.trim().slice(0, 34)}…" (${dy > 2 ? dy + 'px of text below the clamp' : dx + 'px cut horizontally'})`);
      }
    });
  }

  /**
   * A12 — progress is stated once.
   *
   * Section 2.8 of the spec names five simultaneous statements of answer
   * progress as the cause of the crowding the redesign exists to fix, and the
   * redesign then shipped six of its own. Counting them is trivial and nobody
   * did it, so: at most one element on the stage may carry a progress numeral.
   * The dock may carry a readiness judgement, which is why the pattern below
   * matches numerals rather than words.
   */
  const PROGRESS_RE = /\b\d+\s*(?:\/|of)\s*\d+\b/;
  function A12(snap, w, h, add) {
    const doc = snap.length ? snap[0].el.ownerDocument : null;
    if (!doc) return;
    const parts = [];

    // The meter's labelled fraction is one statement even though it is two
    // nodes — "31" and " / 40". Counting leaves alone missed it entirely,
    // which meant this check was passing by accident on the very layout it
    // exists to police. Count the component, not the text node.
    doc.querySelectorAll('.main .meter .count').forEach((e) => {
      if (PROGRESS_RE.test(e.textContent.replace(/\s+/g, ' '))) parts.push('meter fraction');
    });
    doc.querySelectorAll('.main .bar2').forEach(() => parts.push('progress bar'));
    doc.querySelectorAll('.main .dots').forEach(() => parts.push('dot matrix'));
    doc.querySelectorAll('.main .allin').forEach(() => parts.push('"everyone is in"'));

    // Anything else on the stage or in the dock carrying a progress numeral.
    // Pagination ("responses 1-3 of 20") states a different fact and is not
    // counted; nor is the round number in the rail.
    doc.querySelectorAll('.main *, .dock *').forEach((e) => {
      if (e.children.length || e.closest('.console') || e.closest('.pager')) return;
      if (e.closest('.meter')) return;
      const t = (e.textContent || '').trim();
      if (t && PROGRESS_RE.test(t)) parts.push('"' + t.slice(0, 24) + '"');
    });

    if (parts.length > 1) {
      add('A12', `progress is stated ${parts.length} times in one viewport ` +
                 `(${parts.join(', ')}) — spec section 2.8 allows one`);
    }
  }

  /**
   * A13 — no roster name on a stage outside a revealed state.
   *
   * Anonymity was applied to the files in front of me rather than derived
   * across the set, so two documents kept author names: 16-phase-wipe (the
   * transition INTO voting, the exact moment the guarantee takes force) and
   * 12-density-table (a stage profile marking non-responders by name, while
   * the Console next door promised names are never on the stage).
   *
   * A document where naming is legitimate says so with
   * `.stage[data-attribution="revealed"]`. Everything else fails.
   */
  const ROSTER = ['Priya', 'Marcus Ola', 'Dana Whitfield', 'Lee Chen', 'Tomás', 'Aisha Bello',
    'Jordan Pike', 'Nadia', 'Sam Okafor', 'Ingrid', 'Beatriz', 'Wes Duncan', 'Aleksandra',
    'Hiroshi', 'Yuki Tanaka', 'Kofi', 'Elena Petrova', 'Henrik', 'Rosa Delgado', 'Idris'];

  function A13(snap, w, h, add) {
    const doc = snap.length ? snap[0].el.ownerDocument : null;
    if (!doc) return;
    const stage = doc.querySelector('.stage');
    if (!stage) return;
    if (stage.dataset.attribution === 'revealed') return;
    // The Console is operator chrome, but section 11.4 already removed names
    // from it, so it is deliberately NOT exempt here.
    const text = stage.textContent || '';
    const hits = ROSTER.filter((n) => text.includes(n));
    if (hits.length) {
      add('A13', `roster name(s) on a stage that is not a revealed state: ${hits.join(', ')} — ` +
                 `either the state must not attribute, or it must declare data-attribution="revealed"`);
    }
  }

  /** A9 — contrast, measured rather than asserted, with the black-lift model. */
  function A9(snap, w, h, add) {
    // Implement the model the spec documents, not a harsher ad-hoc one.
    // Section 4.3 states that a projector in a lit room lifts the effective
    // background from #0F1A2E toward #2A3550; an earlier draft of this check
    // added a flat +34 per channel, which was more pessimistic than the
    // spec's own table and produced failures the design had not actually
    // committed. An audit that is stricter than the specification it enforces
    // is as untrustworthy as one that is looser.
    const LIFT_TARGET = [42, 53, 80];           // #2A3550
    const BASE = [15, 26, 46];                  // #0F1A2E
    const lift = (c) => [0, 1, 2].map((i) =>
      Math.min(255, c[i] + (LIFT_TARGET[i] - BASE[i])));
    snap.forEach((n) => {
      if (n.exempt || !n.leaf || !n.shown) return;
      const fg = parseRGB(n.cs.color); if (!fg) return;
      const bg = effectiveBg(n.el, n.el.ownerDocument.defaultView);
      const lifted = lift(bg);
      const ratio = contrast(fg, lifted);
      const large = n.fontSize >= 24 || (n.fontSize >= 18.66 && parseInt(n.cs.fontWeight, 10) >= 700);
      const need = large ? 3 : 4.5;
      if (ratio < need) {
        add('A9', `${n.sel} contrast ${ratio.toFixed(2)}:1 after black-lift, needs ${need}:1 at ${n.fontSize.toFixed(0)}px`);
      }
    });
  }

  /* ------------------------------------------------------------ stress pass */

  /**
   * A8 — wide-face stress.
   *
   * The mockups fall back to system faces; production self-hosts Archivo
   * Expanded, which is materially wider, and every width-sensitive claim in
   * the spec was therefore measured against the wrong metrics. We cannot load
   * the real face without an external asset, so we simulate the penalty:
   * +5.5% tracking on display type approximates ~+15% advance width, and the
   * direction of the error is the same. A1/A2/A3/A6 are re-run under it.
   */
  function applyWideFace(doc) {
    const s = doc.createElement('style');
    s.id = '__wideface';
    s.textContent = `.rail *, .q, .hero, .opt .txt, .btn, .pod *, .meter .count,
      .joininfo .url, .joininfo .code, .chip, .rail-join code, .cloud .w
      { letter-spacing: 0.055em !important; word-spacing: 0.08em !important; }`;
    doc.head.appendChild(s);
    if (doc.defaultView.__fit) doc.defaultView.__fit();
  }
  function removeWideFace(doc) {
    const s = doc.getElementById('__wideface');
    if (s) s.remove();
    if (doc.defaultView.__fit) doc.defaultView.__fit();
  }

  /* ----------------------------------------------------------------- driver */

  function setProfile(doc, profile) {
    if (!profile) return;
    const root = doc.documentElement;
    PROFILES.forEach((p) => root.classList.remove(p));
    doc.body && PROFILES.forEach((p) => doc.body.classList.remove(p));
    root.classList.add(profile);
    if (doc.defaultView.__fit) doc.defaultView.__fit();
  }

  function checkOne(doc, w, h, profile, file) {
    const issues = [];
    const add = (code, msg) => issues.push({ code, msg });
    if (file && STAGELESS.has(file)) {
      // A document-shaped surface is SUPPOSED to scroll vertically — a phone
      // and a setup form both do — so asserting otherwise would import a stage
      // rule into a place it does not belong. Horizontal scroll is still always
      // a defect, and contrast still always applies.
      try {
        const de = doc.documentElement;
        if (de.scrollWidth > w + 1) {
          add('A1', `page scrolls horizontally by ${de.scrollWidth - w}px`);
        }
        A9(snapshot(doc), w, h, add);
      } catch (e) { add('ERR', String(e && e.message || e)); }
      return issues;
    }
    try {
      const snap = snapshot(doc);
      A1(doc, w, h, add); A2(snap, w, h, add); A3(snap, w, h, add);
      A4(snap, w, h, add, profile); A6(doc, w, h, add); A7(snap, w, h, add);
      A9(snap, w, h, add); A10(snap, w, h, add); A11(snap, w, h, add); A12(snap, w, h, add);
      A13(snap, w, h, add);
    } catch (e) {
      add('ERR', String(e && e.message || e));
    }
    return issues;
  }

  /**
   * A5 — the three (now four) display profiles must actually render
   * differently. The original `--k` multiplier was declared on `:root` where
   * `--k` was already 1, so custom-property substitution had happened before
   * the density class on `body` could take effect: Room, Call and Table
   * produced byte-identical type and only the boxes shrank. Two of the three
   * mandated viewing contexts had never been rendered. This check is the
   * reason that cannot recur.
   */
  async function checkDensities(loader, file, base) {
    const out = [];
    const measured = {};
    const doc = await loader.load(base + file, 1920, 1080);
    for (const p of PROFILES) {
      setProfile(doc, p);
      await new Promise((r) => setTimeout(r, 40));
      // Chrome answers "did the profile change anything" — the fitter cannot
      // touch it. But chrome ALONE is blind to the failure that matters: a
      // profile whose content is scaled down past the profile beneath it. TV
      // was rendering VOTE answers at 26.8px against Room's 30.2px — the
      // big-screen profile smaller than the projector one — and chrome-only
      // A5 could not see it. So measure both.
      const q = doc.querySelector('.dock .btn.primary') ||
                doc.querySelector('.q, .hero, .joininfo .code');
      const meta = doc.querySelector('.chip, .kicker, .rail-ctx, .meter h4');
      const contentEl = doc.querySelector('.opt .txt, .card .ans, .q, .hero, .notes .lead');
      const win = doc.defaultView;
      measured[p] = {
        q: q ? +parseFloat(win.getComputedStyle(q).fontSize).toFixed(1) : null,
        meta: meta ? +parseFloat(win.getComputedStyle(meta).fontSize).toFixed(1) : null,
        content: contentEl ? +parseFloat(win.getComputedStyle(contentEl).fontSize).toFixed(1) : null,
        hair: win.getComputedStyle(doc.documentElement).getPropertyValue('--hair').trim(),
        field: (doc.querySelector('.field')
          ? win.getComputedStyle(doc.querySelector('.field')).backgroundImage.slice(0, 24) : ''),
        floor: PROFILE_FLOOR[p],
        declaredFloor: parseFloat(win.getComputedStyle(doc.documentElement).getPropertyValue('--floor')),
      };
    }
    const room = measured['d-room'], tv = measured['d-tv'],
          call = measured['d-call'], table = measured['d-table'];

    // Either tier may be pinned by a clamp at a given viewport, so the profiles
    // are required to differ on at least one of them.
    const differs = (a, b, pct) => !!(a && b) && (
      (a.q && b.q && Math.abs(a.q - b.q) / a.q >= pct) ||
      (a.meta && b.meta && Math.abs(a.meta - b.meta) / a.meta >= pct));

    if (!differs(room, table, 0.15)) {
      out.push({ code: 'A5', msg: `Room and Table render the same type (chrome ${room.q}/${room.meta}px vs ${table.q}/${table.meta}px) — the profile is a no-op` });
    }
    if (!differs(room, tv, 0.15)) {
      out.push({ code: 'A5', msg: `Room and Large TV render the same type (chrome ${room.q}/${room.meta}px vs ${tv.q}/${tv.meta}px)` });
    }
    // Call deliberately shares Room's ladder (see spec 4.4) but MUST differ
    // structurally, or it is not a profile at all.
    if (call.hair === room.hair && call.field === room.field) {
      out.push({ code: 'A5', msg: 'Call is indistinguishable from Room — neither the hairline weight nor the field treatment changed' });
    }
    // A bigger profile must never render its CONTENT smaller than a smaller
    // one after fitting. If it cannot fit at that size it must sacrifice.
    if (tv.content && room.content && tv.content < room.content - 0.5) {
      out.push({ code: 'A5', msg: `TV renders content at ${tv.content}px, SMALLER than Room's ${room.content}px — ` +
        `the larger profile is scaling below the smaller one instead of sacrificing` });
    }
    if (call.content && room.content && Math.abs(call.content - room.content) > room.content * 0.02) {
      out.push({ code: 'A5', msg: `Call renders content at ${call.content}px against Room's ${room.content}px — ` +
        `section 4.2 says Call keeps Room's ladder, so this difference is unintended` });
    }
    for (const p of PROFILES) {
      if (measured[p].meta && measured[p].meta < measured[p].declaredFloor - 0.5) {
        out.push({ code: 'A5', msg: `${p} label tier ${measured[p].meta}px is under the ${measured[p].declaredFloor}px floor it declares` });
      }
      if (Math.abs(measured[p].declaredFloor - measured[p].floor) > 0.5) {
        out.push({ code: 'A5', msg: `${p} declares a ${measured[p].declaredFloor}px floor at 1920x1080; the spec's table says ${measured[p].floor}px` });
      }
    }
    return { issues: out, measured };
  }

  /* --------------------------------------------------------------- harness */

  /**
   * One reusable iframe.
   *
   * Parsing a page carrying a 900-rect inline QR plus a 20KB stylesheet costs
   * far more than every check combined, so the harness loads a page ONCE per
   * (file, viewport) and switches display profile in place on the live
   * document. That is both ~4x faster and strictly more faithful: all four
   * profiles are then measured against exactly the same DOM, which is the
   * claim A5 is trying to make.
   */
  function makeLoader(host) {
    const fr = document.createElement('iframe');
    fr.style.cssText = 'border:0;width:10px;height:10px';
    host.appendChild(fr);
    let current = null;
    return {
      frame: fr,
      /**
       * Re-assigning an identical `src` does not reliably fire `load`, so the
       * second viewport of a file used to hang the whole run waiting for an
       * event that never came. Only navigate when the URL actually changes;
       * otherwise resize the frame and re-run the page's own fitter, which is
       * what a real viewport change does anyway.
       */
      load(url, w, h) {
        fr.style.width = w + 'px';
        fr.style.height = h + 'px';
        if (current === url && fr.contentDocument && fr.contentDocument.readyState === 'complete') {
          return new Promise((resolve) => {
            const win = fr.contentWindow;
            if (win.__fit) win.__fit();
            win.dispatchEvent(new win.Event('resize'));
            setTimeout(() => resolve(fr.contentDocument), 30);
          });
        }
        current = url;
        return new Promise((resolve) => {
          // A missed `load` event must never wedge the whole run. Any harness
          // that can hang is a harness that reports "still running" instead of
          // reporting a defect, which is the same failure mode as a check that
          // cannot fail.
          let settled = false;
          const finish = () => {
            if (settled) return;
            settled = true;
            if (fr.contentWindow && fr.contentWindow.__fit) fr.contentWindow.__fit();
            setTimeout(() => resolve(fr.contentDocument), 20);
          };
          fr.onload = () => setTimeout(finish, 20);
          setTimeout(finish, 4000);
          fr.src = url;
        });
      },
      destroy() { fr.remove(); },
    };
  }

  async function runAll(opts) {
    opts = opts || {};
    const base = opts.base || '';
    const files = opts.files || (base.indexOf('_baseline') === 0 ? BASELINE_FILES : FILES);
    const viewports = opts.viewports || VIEWPORTS;
    const profiles = opts.profiles || PROFILES;

    const host = document.createElement('div');
    host.style.cssText = 'position:fixed;left:-99999px;top:0;width:0;height:0;overflow:hidden';
    document.body.appendChild(host);
    const loader = makeLoader(host);

    const report = { base, failures: [], counts: {}, densities: null, pages: 0, checks: 0 };

    // A5 once — it is a property of the stylesheet, not of a page.
    try {
      const d = await checkDensities(loader, files[2] || files[0], base);
      report.densities = d.measured;
      d.issues.forEach((i) => report.failures.push(Object.assign({ file: '(all)', vp: '1920x1080', profile: '-' }, i)));
    } catch (e) {
      report.failures.push({ file: '(all)', vp: '-', profile: '-', code: 'A5', msg: 'density probe threw: ' + e.message });
    }

    for (const file of files) {
      report.pages++;
      if (global.__auditProgress) global.__auditProgress(file, report.pages, files.length);
      for (const [w, h] of viewports) {
        const doc = await loader.load(base + file, w, h);
        for (const profile of profiles) {
          setProfile(doc, profile);
          await new Promise((r) => setTimeout(r, 25));
          report.checks++;

          checkOne(doc, w, h, profile, file).forEach((i) =>
            report.failures.push(Object.assign({ file, vp: `${w}x${h}`, profile }, i)));

          // A8 — same render, wide-face stress, geometry checks only.
          applyWideFace(doc);
          await new Promise((r) => setTimeout(r, 20));
          const stress = [];
          const addS = (code, msg) => stress.push({ code: 'A8/' + code, msg });
          if (!STAGELESS.has(file)) {
            const snapS = snapshot(doc);
            A1(doc, w, h, addS); A2(snapS, w, h, addS); A3(snapS, w, h, addS); A6(doc, w, h, addS);
          }
          stress.forEach((i) =>
            report.failures.push(Object.assign({ file, vp: `${w}x${h}`, profile }, i)));
          removeWideFace(doc);
        }
      }
    }

    host.remove();
    report.failures.forEach((f) => { report.counts[f.code] = (report.counts[f.code] || 0) + 1; });
    report.pass = report.failures.length === 0;
    return report;
  }

  global.HostAudit = { runAll, checkOne, checkDensities, FILES, BASELINE_FILES, VIEWPORTS, PROFILES, PROFILE_FLOOR };
})(window);
