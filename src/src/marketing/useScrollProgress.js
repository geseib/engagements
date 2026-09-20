import { useEffect, useState } from 'react';

export function prefersReducedMotion() {
  return typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * How far down the document the reader is, 0..1, sampled once per frame.
 * Under reduced motion it is pinned at 1: the scene is static and the climber
 * is already on the summit, which is the honest still of this page.
 *
 * `prefersReducedMotion()` used to be read once, at mount, which meant a
 * reader who changed the OS setting mid-visit kept whichever mode the page
 * loaded in until they reloaded. Fix round 2: `reduced` is now state,
 * subscribed to the media query's own `change` event, so flipping the OS
 * setting flips this page live — progress pins to 1 and the scroll/resize
 * listeners below detach the moment it turns on, and re-attach the moment it
 * turns back off. `matchMedia` and `addEventListener` on its result are both
 * guarded: jsdom's default environment has neither.
 */
export default function useScrollProgress() {
  const [reduced, setReduced] = useState(prefersReducedMotion());

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return undefined;
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    if (typeof query.addEventListener !== 'function') return undefined;
    const onChange = (event) => setReduced(event.matches);
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);

  const [progress, setProgress] = useState(reduced ? 1 : 0);

  useEffect(() => {
    if (reduced) {
      setProgress(1);
      return undefined;
    }
    let frame = 0;
    const read = () => {
      frame = 0;
      const doc = document.documentElement;
      const span = doc.scrollHeight - window.innerHeight;
      setProgress(span > 0 ? Math.min(1, Math.max(0, window.scrollY / span)) : 0);
    };
    const onScroll = () => { if (!frame) frame = window.requestAnimationFrame(read); };
    read();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, [reduced]);

  return progress;
}
