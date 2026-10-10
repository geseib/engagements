/**
 * KEEP A POPOVER ON SCREEN (owner, 2026-10-07: "be mindful of when dialog
 * modals appear off screen"). A menu or panel that hangs from a button is
 * placed by CSS beside that button. When the header wraps, the button moves,
 * and a panel anchored to its right edge runs off the left of the window
 * (measured on dev at 659px: the Wi-Fi panel 321px off, the More menu 93px).
 * Choosing a side in CSS cannot fix that, because the side that fits depends
 * on where the button landed. So, once open, the panel is measured and slid
 * back inside the window, and its height is capped so it scrolls rather than
 * running off the bottom.
 */
import { useLayoutEffect } from 'react';

/** The space kept between a popover and the window's edge. */
export const GUTTER = 16;
const MIN_HEIGHT = 160;

/** How far to slide a popover sideways (px, + is right) to keep it in the window. */
export function nudgeX(rect, viewportWidth, gutter = GUTTER) {
  if (rect.width > viewportWidth - 2 * gutter || rect.left < gutter) return gutter - rect.left;
  if (rect.right > viewportWidth - gutter) return viewportWidth - gutter - rect.right;
  return 0;
}

/** The height a popover may use below its top before it would leave the window. */
export function roomBelow(rect, viewportHeight, gutter = GUTTER) {
  return Math.max(MIN_HEIGHT, Math.floor(viewportHeight - rect.top - gutter));
}

/** While `open`, keep the element `ref` points at inside the window, on open, on resize, and when `placeKey` changes
 * (a panel whose content grows, such as a Wi-Fi panel opened inside it). */
export function useKeepOnScreen(ref, open, placeKey) {
  useLayoutEffect(() => {
    const el = ref.current;
    if (!open || !el) return undefined;
    const place = () => {
      el.style.transform = '';
      el.style.maxHeight = '';
      const r = el.getBoundingClientRect();
      const dx = nudgeX(r, window.innerWidth);
      if (dx) el.style.transform = `translateX(${Math.round(dx)}px)`;
      const room = roomBelow(r, window.innerHeight);
      if (r.height > room) {
        el.style.maxHeight = `${room}px`;
        el.style.overflowY = 'auto';
      }
    };
    place();
    window.addEventListener('resize', place);
    // The anchor can move without a resize: the Stage dock's Space hint comes
    // and goes with the pointer and slides the HOST button 107px (walked on
    // test at 659px; the open list ended 91px off the right). Follow it.
    const anchor = el.parentElement;
    const where = () => {
      if (!anchor) return '';
      const a = anchor.getBoundingClientRect();
      return `${Math.round(a.left)},${Math.round(a.top)}`;
    };
    let last = where();
    let frame = 0;
    const watch = () => {
      const now = where();
      if (now !== last) { last = now; place(); }
      frame = window.requestAnimationFrame(watch);
    };
    frame = window.requestAnimationFrame(watch);
    return () => {
      window.removeEventListener('resize', place);
      window.cancelAnimationFrame(frame);
    };
  }, [ref, open, placeKey]);
}
