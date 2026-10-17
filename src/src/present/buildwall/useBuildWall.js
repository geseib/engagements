/**
 * THE BUILD ROOM WALL'S ONE SOURCE: THE SERVER (parity PLAN §2.4, §2.9a; B7).
 *
 * Reads ONE public route, keyed, with the plain fetch (never the signed-in one):
 *   GET games/{id}/build-play/wall?k=<wallKey>        build-store.js wallView
 * and its pictures through
 *   GET games/{id}/build-play/wall/images/{imageId}?k=<wallKey>
 *
 * FRAMES ARE REFETCH SIGNALS ONLY: `buildChanged` (and `gameEnded`) say "look
 * again"; their payload is never read. Debounced 400 ms, so a burst is one
 * read. Coming back online, the tab becoming visible and a reconnect refetch
 * too, and an 8 s poll heals a missed frame (as the host page does).
 *
 * The socket is the /present viewer's (connect.js `viewer=present&viewerId=`):
 * never a player, never a host, one id per tab. The window reports itself
 * through the shared reporter (present/presentStatusReporter.js).
 *
 * Holds nothing but the last body. A reply overtaken by a newer request is
 * dropped, and so is one whose `rev` (then `wall.rev`) is older than the one
 * shown, so a slow answer cannot walk the wall back.
 *
 *   status  'loading' | 'ok' | 'link-changed' (403: a rotated or wrong key)
 *           | 'not-found' (404: not a Build Room, or gone)
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import webSocketClient from '../../WebSocketClient';
import { startPresentStatus } from '../presentStatusReporter';
import { viewerIdForTab } from '../usePresentation';
import { isStale } from './wallRoom';

export const REFETCH_DEBOUNCE_MS = 400;
export const WALL_POLL_MS = 8000;
export const WALL_FRAMES = ['buildChanged', 'gameEnded'];

const apiBase = () => {
  const b = String((typeof window !== 'undefined' && window.API_BASE) || '');
  return b ? `${b.replace(/\/+$/, '')}/` : '';
};
const seg = (v) => encodeURIComponent(String(v || ''));

/** The address of one picture on the wall: an <img> sends no headers, so the key rides in the query. */
export function wallImageUrl(gameId, k, imageId) {
  return `${apiBase()}games/${seg(gameId)}/build-play/wall/images/${seg(imageId)}?k=${seg(k)}`;
}

const tabViewerId = () => {
  let storage = null;
  try { storage = window.sessionStorage; } catch (e) { storage = null; }
  return viewerIdForTab(storage);
};

export default function useBuildWall(gameId, k) {
  const [read, setRead] = useState({ status: 'loading', wall: null });
  const seqRef = useRef(0);
  const appliedRef = useRef(0);
  const shownRef = useRef(null);
  const debounceRef = useRef(null);

  const refetch = useCallback(async () => {
    if (!gameId) { setRead({ status: 'not-found', wall: null }); return; }
    seqRef.current += 1;
    const seq = seqRef.current;
    let res;
    try {
      res = await fetch(`${apiBase()}games/${seg(gameId)}/build-play/wall?k=${seg(k)}`);
    } catch (e) {
      return; // offline: the poll, `online` or a reconnect tries again
    }
    if (seq < appliedRef.current) return; // overtaken
    if (res.status === 403) { appliedRef.current = seq; setRead({ status: 'link-changed', wall: null }); return; }
    if (res.status === 404) { appliedRef.current = seq; setRead({ status: 'not-found', wall: null }); return; }
    if (!res.ok) return;
    let body = null;
    try { body = await res.json(); } catch (e) { body = null; }
    if (!body || seq < appliedRef.current) return;
    if (isStale(shownRef.current, body)) return;
    appliedRef.current = seq;
    shownRef.current = body;
    setRead({ status: 'ok', wall: body });
  }, [gameId, k]);

  const schedule = useCallback(() => {
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => { refetch(); }, REFETCH_DEBOUNCE_MS);
  }, [refetch]);

  // First read, the viewer socket and the window's own report.
  useEffect(() => {
    if (!gameId) { refetch(); return undefined; }
    refetch();
    webSocketClient.connect(gameId, null, false, { viewerId: tabViewerId() });
    WALL_FRAMES.forEach((type) => webSocketClient.onMessage(type, () => schedule()));
    const status = startPresentStatus(webSocketClient);
    webSocketClient.onReconnected(() => { schedule(); status.report(); });
    return () => {
      clearTimeout(debounceRef.current);
      status.stop();
      WALL_FRAMES.forEach((type) => webSocketClient.offMessage(type));
      webSocketClient.onReconnected(null);
      webSocketClient.disconnect();
    };
  }, [gameId, refetch, schedule]);

  // Online again, or visible again: look, and reconnect a socket that gave up.
  useEffect(() => {
    if (!gameId) return undefined;
    const wake = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
      if (webSocketClient.isConnected && !webSocketClient.isConnected()) {
        webSocketClient.connect(gameId, null, false, { viewerId: tabViewerId() });
      }
      schedule();
    };
    window.addEventListener('online', wake);
    document.addEventListener('visibilitychange', wake);
    return () => {
      window.removeEventListener('online', wake);
      document.removeEventListener('visibilitychange', wake);
    };
  }, [gameId, schedule]);

  // The poll heals a missed frame. A changed link or a gone session will not come back by itself.
  const settled = read.status === 'link-changed' || read.status === 'not-found';
  useEffect(() => {
    if (!gameId || settled) return undefined;
    const timer = setInterval(() => { refetch(); }, WALL_POLL_MS);
    return () => clearInterval(timer);
  }, [gameId, settled, refetch]);

  const loadImage = useCallback((imageId) => wallImageUrl(gameId, k, imageId), [gameId, k]);
  return { ...read, loadImage, refetch };
}
