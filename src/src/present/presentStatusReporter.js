/**
 * THE ROOM'S WINDOW REPORTS ITSELF (host standards §1; host console spec 4.2).
 *
 * Every room's window (/present for Call & Answer, and the Build Room wall,
 * present/buildwall/) tells the server whether it is visible and full screen
 * with a PRESENT_STATUS message on its viewer socket. The host's laptop reads
 * the result back as "on, full screen / open, not full screen / hidden / not
 * open" (config/presentStatus.js). One copy of the rules, shared:
 *
 *   - a report on every fullscreen and visibility change;
 *   - THE FIRST REPORT WAITS FOR THE SOCKET: `sendCleanMessage` returns false
 *     until the socket is open, and a fixed one-shot was lost whenever the
 *     connect took longer, leaving the host's "Room's window" on unknowns until
 *     the minute tick. So it is tried every second until a send is accepted,
 *     at most FIRST_REPORT_TRIES times;
 *   - a heartbeat every minute, so the server's clock can tell a closed tab
 *     from a quiet one (presentStatus.js STALE_MS).
 *
 * The caller wires its own reconnect (it also refetches then) and calls
 * `report()` from it. Never imports the signed-in fetch.
 */
import { fullscreenElement } from '../utils/fullscreen';

export const FIRST_REPORT_EVERY_MS = 1000;
export const FIRST_REPORT_TRIES = 10;
export const HEARTBEAT_MS = 60 * 1000;

/** What the room's window tells the host console. */
export function presentStatusPayload({ fullscreen, hidden }) {
  return { fullscreen: Boolean(fullscreen), visible: !hidden };
}

/**
 * Start reporting on `socket` (the WebSocketClient). Returns `{ report, stop }`:
 * `report()` sends one now (true when the socket took it); `stop()` removes
 * every listener and timer.
 */
export function startPresentStatus(socket) {
  const report = () => socket.sendCleanMessage('PRESENT_STATUS', presentStatusPayload({
    fullscreen: Boolean(fullscreenElement()),
    hidden: typeof document !== 'undefined' && document.visibilityState === 'hidden',
  }));
  const onChange = () => { report(); };
  document.addEventListener('fullscreenchange', onChange);
  document.addEventListener('webkitfullscreenchange', onChange);
  document.addEventListener('visibilitychange', onChange);
  let firstReport = null;
  let tries = 0;
  const tryFirstReport = () => {
    tries += 1;
    if (report() === true || tries >= FIRST_REPORT_TRIES) { firstReport = null; return; }
    firstReport = setTimeout(tryFirstReport, FIRST_REPORT_EVERY_MS);
  };
  firstReport = setTimeout(tryFirstReport, FIRST_REPORT_EVERY_MS);
  const tick = setInterval(report, HEARTBEAT_MS);
  const stop = () => {
    if (firstReport) clearTimeout(firstReport);
    firstReport = null;
    clearInterval(tick);
    document.removeEventListener('fullscreenchange', onChange);
    document.removeEventListener('webkitfullscreenchange', onChange);
    document.removeEventListener('visibilitychange', onChange);
  };
  return { report, stop };
}
