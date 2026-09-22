import { useEffect, useState } from 'react';
import { prefersReducedMotion } from './useScrollProgress';

/**
 * True once the element has been at least `threshold` visible, and true for
 * ever after: the one performing block on the home page plays once, then
 * stays still (RATIONALE 2026-09-22 §1 change 5; motion-primitives `in-view`).
 *
 * Where there is no IntersectionObserver (jsdom, an old engine) it is true
 * immediately — the honest fallback is the final frame, never a blank block.
 */
export default function useInViewOnce(ref, threshold = 0.35) {
  const [inView, setInView] = useState(() => typeof IntersectionObserver !== 'function');

  useEffect(() => {
    if (inView) return undefined;
    const el = ref.current;
    if (!el || typeof IntersectionObserver !== 'function') {
      setInView(true);
      return undefined;
    }
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) {
        setInView(true);
        observer.disconnect();
      }
    }, { threshold });
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref, threshold, inView]);

  return inView;
}

/**
 * Counts from 0 to `target` over `duration` ms with a cubic ease-out once
 * `go` is true (react-bits CountUp / motion-primitives animated-number, by
 * hand). Reduced motion, or no requestAnimationFrame, lands on the target at
 * once. The value shown before `go` is 0, matching the bars drawn at zero.
 */
export function useCountUp(target, go, duration = 700) {
  const [value, setValue] = useState(0);

  useEffect(() => {
    if (!go) return undefined;
    if (prefersReducedMotion() || typeof window === 'undefined' || typeof window.requestAnimationFrame !== 'function') {
      setValue(target);
      return undefined;
    }
    let frame = 0;
    const t0 = performance.now();
    const step = (t) => {
      const k = Math.min(1, (t - t0) / duration);
      const eased = 1 - (1 - k) ** 3;
      setValue(Math.round(target * eased));
      if (k < 1) frame = window.requestAnimationFrame(step);
    };
    frame = window.requestAnimationFrame(step);
    return () => { if (frame) window.cancelAnimationFrame(frame); };
  }, [target, go, duration]);

  return value;
}
