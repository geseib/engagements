/**
 * THE CANVAS (two-surface PLAN 2.6, D1).
 *
 * A fixed 1920x1080 logical page, scaled to the window and centred, so every
 * screen measures the same thing. Owns:
 *   - the html lock (`present-locked`) and the profile's root class while
 *     mounted, removed on unmount (the Scoreboard overlay reads the root
 *     ladder, as it does on the host's stage);
 *   - the scale (--present-scale, --present-x, --present-y);
 *   - the measured fit: shrink the moment to the profile's --fit-min, then
 *     drop the optional block ([data-drop]), then shrink a response's text from
 *     the primary size to the secondary, then mark data-fit="miss". It never
 *     scrolls and never clips silently.
 *
 * Renders no control of any kind: no button, link or role="button".
 */
import React, { useEffect, useLayoutEffect, useRef } from 'react';
import { profileClass, PROFILES, DEFAULT_PROFILE } from '../config/displayProfile';
import Ground from '../components/ui/Ground';

export const CANVAS_W = 1920;
export const CANVAS_H = 1080;

/** The ladders present.css restates, for the fitter (presentLadder test holds them equal). */
export const PRESENT_LADDERS = {
  room: { hero: 91, primary: 60, secondary: 40, body: 30, meta: 21, fitMin: 0.55, floor: 20 },
  call: { hero: 91, primary: 60, secondary: 40, body: 30, meta: 21, fitMin: 0.55, floor: 20 },
  tv: { hero: 119, primary: 80, secondary: 52, body: 38, meta: 26, fitMin: 0.78, floor: 26 },
  table: { hero: 64, primary: 43, secondary: 28, body: 22, meta: 16, fitMin: 0.55, floor: 16 },
};

const overflows = (el) => Boolean(el) && (el.scrollHeight > el.clientHeight + 1 || el.scrollWidth > el.clientWidth + 1);

/** Fit one canvas. Exported for the fitter test; returns 'ok' or 'miss'. */
export function fitCanvas(canvas, profile) {
  if (!canvas) return 'ok';
  const ladder = PRESENT_LADDERS[profile] || PRESENT_LADDERS[DEFAULT_PROFILE];
  const main = canvas.querySelector('.present-main');
  const drops = Array.from(canvas.querySelectorAll('[data-drop]'));
  drops.forEach((el) => { el.hidden = false; });
  canvas.style.setProperty('--fit', '1');
  let ok = true;
  if (main) {
    let fit = 1;
    while (overflows(main) && fit > ladder.fitMin) {
      fit = Math.max(ladder.fitMin, Number((fit - 0.03).toFixed(2)));
      canvas.style.setProperty('--fit', String(fit));
    }
    if (overflows(main) && drops.length) drops.forEach((el) => { el.hidden = true; });
    if (overflows(main)) ok = false;
  }
  canvas.querySelectorAll('.present-fit-text').forEach((el) => {
    let size = ladder.primary;
    el.style.fontSize = `${size}px`;
    while (overflows(el) && size > ladder.secondary) {
      size = Math.max(ladder.secondary, size - 2);
      el.style.fontSize = `${size}px`;
    }
    // Past the secondary size the response should have been cut into parts;
    // when it was not (no measurer has published yet), shrink to the floor
    // rather than clip, and say so.
    while (overflows(el) && size > ladder.floor) {
      size = Math.max(ladder.floor, size - 2);
      el.style.fontSize = `${size}px`;
    }
    if (overflows(el)) ok = false;
  });
  canvas.dataset.fit = ok ? 'ok' : 'miss';
  return ok ? 'ok' : 'miss';
}

function useScaleToWindow(target) {
  useLayoutEffect(() => {
    const root = target.current;
    if (!root) return undefined;
    const apply = () => {
      const w = root.clientWidth || window.innerWidth || CANVAS_W;
      const h = root.clientHeight || window.innerHeight || CANVAS_H;
      const s = Math.min(w / CANVAS_W, h / CANVAS_H) || 1;
      root.style.setProperty('--present-scale', String(s));
      root.style.setProperty('--present-x', `${Math.round((w - CANVAS_W * s) / 2)}px`);
      root.style.setProperty('--present-y', `${Math.round((h - CANVAS_H * s) / 2)}px`);
    };
    apply();
    window.addEventListener('resize', apply);
    let observer = null;
    if (typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver(apply);
      observer.observe(root);
    }
    return () => {
      window.removeEventListener('resize', apply);
      if (observer) observer.disconnect();
    };
  }, [target]);
}

export default function PresentStage({ profile, fitKey, overlay, fitcheck = false, children }) {
  const p = PROFILES.includes(profile) ? profile : DEFAULT_PROFILE;
  const rootRef = useRef(null);

  useEffect(() => {
    const html = document.documentElement;
    html.classList.add('present-locked');
    return () => { html.classList.remove('present-locked'); };
  }, []);

  useEffect(() => {
    const html = document.documentElement;
    const cls = profileClass(p);
    PROFILES.forEach((x) => html.classList.remove(profileClass(x)));
    html.classList.add(cls);
    return () => { html.classList.remove(cls); };
  }, [p]);

  useScaleToWindow(rootRef);

  // Fit after layout, and again once the web fonts have arrived (a fallback
  // font measures differently).
  useLayoutEffect(() => {
    // Ground (components/ui) paints the canvas and takes no ref, so the fitter
    // finds the canvas inside the root.
    const canvasOf = () => (rootRef.current ? rootRef.current.querySelector('.present-canvas') : null);
    fitCanvas(canvasOf(), p);
    let live = true;
    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(() => { if (live) fitCanvas(canvasOf(), p); }).catch(() => {});
    }
    return () => { live = false; };
  }, [p, fitKey]);

  return (
    <div
      ref={rootRef}
      className={`present${fitcheck ? ' is-fitcheck' : ''}`}
      data-theme="dark"
      data-surface="wall"
      data-profile={p}
      aria-live="polite"
    >
      <Ground variant="wall" className="present-canvas" data-fit="ok">
        {children}
      </Ground>
      {overlay}
    </div>
  );
}
