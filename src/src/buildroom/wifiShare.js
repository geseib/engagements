/**
 * BUILD ROOM WI-FI SHARE — the host's chip, as pure rules
 * (docs/design/build-room-lan-share/PLAN.md §4, mockups L1-L3; relabelled for
 * Share demo, docs/design/build-room-share-demo D2, owner 2026-10-10).
 * `lan` is the server's lanHostView (lambda-functions/game/build-lan.js).
 */
import { W } from './words';

export const QUIET_AFTER_MS = 2 * 60 * 1000;
/** Switched on this long ago with no answer from the plugin: it is old or not running. */
export const WAITING_AFTER_MS = 25 * 1000;

const LOOPBACK = /^(localhost|[^.]+\.localhost|127\.\d+\.\d+\.\d+|\[::1\]|::1)$/i;
function isLoopback(url) {
  try { return LOOPBACK.test(new URL(String(url)).hostname); } catch (e) { return false; }
}

export function wifiState(lan, now) {
  const l = lan || {};
  if (!l.wanted || l.status === 'off' || !l.status) return { state: 'off', label: W.shareDemo, open: 0 };
  if (l.status === 'failed') return { state: 'failed', label: W.shareFailed, open: 0 };
  if (l.status !== 'live') {
    const wantedAt = l.wantedAt ? Date.parse(l.wantedAt) : NaN;
    const answered = l.reportedAt && !(wantedAt && Date.parse(l.reportedAt) < wantedAt);
    if (wantedAt && !answered && new Date(now).getTime() - wantedAt > WAITING_AFTER_MS) {
      return { state: 'waiting', label: W.shareWaiting, open: 0 };
    }
    return { state: 'starting', label: W.shareStarting, open: 0 };
  }
  const open = Number(l.open) || 0;
  const since = l.liveSince ? new Date(now).getTime() - Date.parse(l.liveSince) : 0;
  if (open === 0 && since >= QUIET_AFTER_MS) return { state: 'quiet', label: W.shareQuiet, open: 0 };
  return { state: 'on', label: W.shareOn(open), open };
}

/**
 * SHARE DEMO's nudge (D1): once, when Claude first shows something running on
 * this laptop (a local link or option) or the first screenshot of it, until
 * the host answers. A mockup is an option's picture, not the running app.
 */
export function shouldOfferDemo(room) {
  const lan = (room && room.lan) || {};
  if (lan.wanted || lan.offerDismissed) return false;
  const shown = ((room && room.log) || []).some((l) => l.by === 'agent' && isLoopback(l.link));
  const option = ((room && room.asks) || []).some((a) => (a.options || []).some((o) => isLoopback(o.url)));
  const shot = ((room && room.images) || []).some((im) => im && im.kind !== 'mockup' && (im.by || 'agent') === 'agent');
  return shown || option || shot;
}
