import { useEffect, useRef, useState } from 'react';
import { fullscreenElement, isFullscreenKey, toggleFullscreen } from '../utils/fullscreen';

/**
 * F TAKES THE HOST'S SCREEN FULL SCREEN, and F again (or Esc) brings it back
 * (utils/fullscreen.js says why the browser, not this hook, holds the state).
 *
 * Mounted by each host screen — the main screen and a session's stage
 * (GameHostPage), an event's stage (EventStage), an event's agenda
 * (HostEventAgenda) — and by no phone page: a phone's F is a letter. Call it
 * ABOVE any early return, like every other key hook on those pages.
 *
 * `target` says WHAT goes full screen when F is pressed, asked at the press:
 * the whole page by default; the slide itself on an event's stage while a
 * talk's slides are up, so the room sees the slide and nothing else.
 *
 * On `document`, bubble phase, beside useSessionPanelKey's `\` — a handler
 * that took the press first (`defaultPrevented`) keeps it.
 */
export default function useFullscreenKey({ enabled = true, target = null } = {}) {
  const pick = useRef(target);
  pick.current = target;

  useEffect(() => {
    if (!enabled || typeof document === 'undefined') return undefined;
    const onKeyDown = (event) => {
      if (!isFullscreenKey(event)) return;
      event.preventDefault();
      const el = typeof pick.current === 'function' ? pick.current() : null;
      toggleFullscreen(el || undefined);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [enabled]);
}

/** The element that is full screen now (null when none), kept current. */
export function useFullscreenElement() {
  const [el, setEl] = useState(() => fullscreenElement());
  useEffect(() => {
    if (typeof document === 'undefined') return undefined;
    const changed = () => setEl(fullscreenElement());
    document.addEventListener('fullscreenchange', changed);
    document.addEventListener('webkitfullscreenchange', changed);
    changed();
    return () => {
      document.removeEventListener('fullscreenchange', changed);
      document.removeEventListener('webkitfullscreenchange', changed);
    };
  }, []);
  return el;
}
