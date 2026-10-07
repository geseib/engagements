/**
 * BUILD ROOM WI-FI SHARE — the host's chip, as pure rules
 * (docs/design/build-room-lan-share/PLAN.md §4, mockups L1-L3).
 * `lan` is the server's lanHostView (lambda-functions/game/build-lan.js).
 */
export const QUIET_AFTER_MS = 2 * 60 * 1000;

const LOOPBACK = /^(localhost|[^.]+\.localhost|127\.\d+\.\d+\.\d+|\[::1\]|::1)$/i;
function isLoopback(url) {
  try { return LOOPBACK.test(new URL(String(url)).hostname); } catch (e) { return false; }
}

export function wifiState(lan, now) {
  const l = lan || {};
  if (!l.wanted || l.status === 'off' || !l.status) return { state: 'off', label: 'Wi-Fi · Off', open: 0 };
  if (l.status === 'failed') return { state: 'failed', label: "Wi-Fi · Didn't start", open: 0 };
  if (l.status !== 'live') return { state: 'starting', label: 'Wi-Fi · Starting…', open: 0 };
  const open = Number(l.open) || 0;
  const since = l.liveSince ? Date.parse(now) - Date.parse(l.liveSince) : 0;
  if (open === 0 && since >= QUIET_AFTER_MS) return { state: 'quiet', label: 'Wi-Fi · On · none open yet', open: 0 };
  return { state: 'on', label: `Wi-Fi · On · ${open} open`, open };
}

export function shouldOfferWifi(room) {
  const lan = (room && room.lan) || {};
  if (lan.wanted || lan.offerDismissed) return false;
  const shown = ((room && room.log) || []).some((l) => l.by === 'agent' && isLoopback(l.link));
  const option = ((room && room.asks) || []).some((a) => (a.options || []).some((o) => isLoopback(o.url)));
  return shown || option;
}
