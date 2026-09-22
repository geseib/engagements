import { useEffect } from 'react';

const NARROW = '(max-width: 720px)';
const BAND = '--mk-ridge-band';

/**
 * Under 720px the ridge's amber glow anchors to the hero's MEASURED height
 * rather than the 92vh the stylesheet assumes. With the product still in the
 * hero the content out-measures a phone viewport, and a glow clamped to 60%
 * of 92vh rose into the lead (found rendered — RATIONALE 2026-09-22 §1
 * change 1). The scene reads `--mk-ridge-band` from `.mk-root`
 * (RidgeScene.css), so that is where the measured value is published; at
 * wider widths the property is cleared and the stylesheet's own value runs.
 *
 * jsdom has neither matchMedia nor ResizeObserver: every step is guarded and
 * the hook does nothing there.
 */
export default function useHeroBand(heroRef) {
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return undefined;
    const hero = heroRef.current;
    const root = hero && hero.closest('.mk-root');
    if (!hero || !root) return undefined;
    const query = window.matchMedia(NARROW);

    const publish = () => {
      if (query.matches) root.style.setProperty(BAND, `${Math.round(hero.getBoundingClientRect().height)}px`);
      else root.style.removeProperty(BAND);
    };

    publish();
    const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(publish) : null;
    if (ro) ro.observe(hero);
    if (typeof query.addEventListener === 'function') query.addEventListener('change', publish);
    window.addEventListener('resize', publish);
    return () => {
      if (ro) ro.disconnect();
      if (typeof query.removeEventListener === 'function') query.removeEventListener('change', publish);
      window.removeEventListener('resize', publish);
      root.style.removeProperty(BAND);
    };
  }, [heroRef]);
}
