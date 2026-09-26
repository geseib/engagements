import { useEffect, useRef } from 'react';
import { isTypingTarget } from '../HostActionBar';

/**
 * THE SESSION PANEL'S OPEN HALF. Owner report, 26 Sep 2026: "the '\' does
 * close the session menu on the host screen but will not open it." The close
 * half has always lived in SessionSetupPanel's own document listener
 * (mounted only while the panel is rendered) — this is the other half,
 * mounted while it is NOT.
 *
 * Modeled on `components/stage/scoreboard/useScoreboardKeys.js`: a
 * page-level hook because the panel toggles OVER a stage that stays mounted
 * (unlike `SurveyWalkthrough`, which replaces the stage, so mounting IS
 * opening for it). GameHostPage.jsx calls this ABOVE its early returns, for
 * the same reason it calls `useScoreboardKeys` there — a hook below a
 * conditional return breaks React's hook order.
 *
 * `enabled` carries every reason this must stay silent: hostOverlays.js's
 * `sessionPanelKeyLive` (the overlay terms `scoreboardKeysLive` yields to),
 * ANDed at the call site with "no surface has replaced the stage" and "there
 * is a game" — the exact shape `useScoreboardKeys`'s own `enabled` is built
 * from in GameHostPage.jsx. This hook decides nothing about any of that; it
 * only decides, for a document already agreed to be listening, whether THIS
 * keystroke means open.
 *
 * ── ONE PRESS, ONE CHANGE — AND WHY `enabled` ALONE DOES NOT GUARANTEE IT ──
 *
 * Fix round 1 (reviewer repro, real Chromium + React 18.3.1, `scratchpad/
 * bsrepro/jsdom-flushsync.js`): with this listener on `window` and
 * SessionSetupPanel's closer on `document`, ONE press of `\` while the panel
 * was open closed it AND immediately reopened it. `sessionPanelKeyLive`'s
 * `setupPanelOpen` term does flip `enabled` false the instant the panel
 * opens — but "the instant" is not soon enough. The panel's `document`
 * listener runs first in the bubble order (target → … → document → window)
 * and calls `onClose()`, which is a state update; before this SAME keydown
 * finishes propagating to `window`, the browser can run a microtask
 * checkpoint, React flushes that update AND this hook's passive effect, and
 * the effect re-attaches this listener to `window` — a target the event has
 * not reached yet in ITS OWN propagation. So the freshly re-armed `window`
 * listener is still downstream of the current dispatch and DOES see and act
 * on the very same keystroke: close, then instantly reopen. `jsdom`'s
 * `fireEvent` inside `act()` never produces that microtask interleaving
 * (React's test-mode batching swallows it), which is why the original tests
 * were green against this — `sessionPanelOpenKey.test.jsx` now closes with
 * `flushSync` specifically to reproduce it.
 *
 * The actual fix is putting this listener on the SAME target and phase as
 * the closer: `document`. Per the DOM dispatch algorithm, invoking a target
 * snapshots that target's listener list before calling any of them — a
 * listener (re-)added to `document` from inside another `document`
 * listener's own callback, during the SAME dispatch, is not part of that
 * snapshot and cannot fire until the NEXT event reaches `document`. That
 * guarantee holds regardless of timing, batching mode, or React version,
 * which `enabled` toggling alone never could. `event.defaultPrevented` is a
 * second, independent guard for the same hazard (any path that still
 * delivers an already-consumed keystroke here), and `event.repeat` is
 * guarded so holding `\` down cannot toggle at the OS repeat rate — the
 * same asymmetry `HostActionBar.jsx`'s own advance key carries.
 */
export function sessionPanelKeyIntent(event) {
  if (!event || event.key !== '\\') return null;
  if (event.repeat) return null;
  if (event.defaultPrevented) return null;
  if (event.metaKey) return null;
  // A bare Ctrl+\ is left for the browser/OS. AltGr layouts report Ctrl+Alt
  // and type `\` that way, so Ctrl WITH Alt still opens.
  if (event.ctrlKey && !event.altKey) return null;
  if (isTypingTarget(event.target)) return null;
  return 'open';
}

export default function useSessionPanelKey({ enabled = false, onOpen = () => {} } = {}) {
  const latest = useRef(onOpen);
  latest.current = onOpen;

  useEffect(() => {
    if (!enabled) return undefined;
    const onKeyDown = (event) => {
      if (sessionPanelKeyIntent(event) !== 'open') return;
      event.preventDefault();
      latest.current();
    };
    // `document`, not `window` — see the header above. SessionSetupPanel's
    // own closer is also on `document`; same target, same (bubble) phase.
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [enabled]);
}
