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
 * `sessionPanelKeyLive`'s own `setupPanelOpen` term is what keeps this quiet
 * once the panel is open — closing from here as well would mean two
 * listeners hearing the same keystroke, which is either a close-then-reopen
 * or an open-then-close in the same press. One press, one change.
 */
export function sessionPanelKeyIntent(event) {
  if (!event || event.key !== '\\') return null;
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
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [enabled]);
}
