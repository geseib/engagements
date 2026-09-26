import { useEffect, useRef } from 'react';
import { scoreboardKeyIntent } from '../../../config/scoreboard';

/**
 * The host page's scoreboard keys: S opens and closes, and with the board
 * open V cycles the look and Escape or Space close it.
 *
 * docs/superpowers/specs/2026-09-25-scoreboard-design.md §3. A hook rather
 * than an inline listener in GameHostPage because that page cannot mount in
 * jsdom, and a listener nothing can exercise is a listener that quietly
 * changes (components/stage/Pager.jsx says the same thing).
 *
 * The page's ← / → belong to Scoreboard.jsx while it is up (it owns the
 * page); both read config/scoreboard.js's one key map.
 *
 * SPACE CLOSES AND DOES NOT ADVANCE. The page passes `scoreboardOpen` to
 * `shortcutsSuppressed`, which is what HostActionBar's Space listener is
 * gated on, so while the board is open that listener is not registered at
 * all. This handler also stops the press from reaching any window listener
 * registered after it — belt and braces for the one key that would move a
 * live room.
 *
 * `enabled` is the page's "not while the session menu is open" — the menu
 * owns Escape while it is up.
 *
 * FIX ROUND 1: Escape held BOTH keys at once was possible once the session
 * panel could open OVER an open board (components/stage/useSessionPanelKey.js
 * carries the full mechanism this note only summarises). The panel's own
 * `document` closer runs first in bubble order and calls `onClose()`; before
 * this SAME Escape finishes propagating to `window`, React can flush that
 * update and this hook's own effect — which, now that `setupPanelOpen` just
 * went false, re-enables and re-attaches THIS listener to `window`, a target
 * the event has not reached yet. So the freshly re-armed board listener saw
 * and acted on the very same Escape: one press closed the panel AND the
 * board. The guard below is scoped to `Escape`/`\` only — the two keys the
 * panel's own closer answers — so it cannot change how Space, S, V or the
 * arrows behave; none of those is ever the panel's key, and nothing else on
 * this page preventDefaults them ahead of this listener.
 */
export default function useScoreboardKeys({
  enabled = true, open = false, canOpen = false,
  onOpen = () => {}, onClose = () => {}, onCycleStyle = () => {},
} = {}) {
  const latest = useRef(null);
  latest.current = { open, canOpen, onOpen, onClose, onCycleStyle };

  useEffect(() => {
    if (!enabled) return undefined;
    const onKeyDown = (event) => {
      // See the FIX ROUND 1 note above — an Escape (or `\`, though this
      // board never matches `\` itself) already consumed by another
      // `document`-level listener on this SAME keystroke is not this
      // listener's to act on a second time.
      if ((event.key === 'Escape' || event.key === '\\') && event.defaultPrevented) return;
      const l = latest.current;
      const intent = scoreboardKeyIntent(event, { open: l.open });
      if (intent === 'toggle') {
        if (l.open) { event.preventDefault(); l.onClose(); }
        else if (l.canOpen) { event.preventDefault(); l.onOpen(); }
        return;
      }
      if (!l.open) return;
      if (intent === 'style') {
        event.preventDefault();
        l.onCycleStyle();
      } else if (intent === 'close') {
        event.preventDefault();
        if (typeof event.stopImmediatePropagation === 'function') event.stopImmediatePropagation();
        l.onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [enabled]);
}
