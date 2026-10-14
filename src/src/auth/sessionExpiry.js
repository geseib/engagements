/**
 * WHEN A SIGN-IN RUNS OUT IN THE MIDDLE OF A SESSION.
 *
 * Reported by the owner, 2026-10-12, on dev: the host screen had been open for
 * hours, Next Round put up a browser alert reading "Failed to get next
 * question: Unauthorized (HTTP 401)", and nothing else happened. "Shouldn't it
 * just go to the login page and come back?"
 *
 * The 401 meant authFetch sent NO token at all: API Gateway answers 401 without
 * running the authorizer when the Authorization header is missing (a present
 * but bad token is the authorizer's 403). authFetch drops the header when
 * `getSession` cannot produce a valid session — and for a Google sign-in it
 * never could after the first hour, because the implicit grant returns no
 * refresh token (googleSignIn.js now asks for a code instead).
 *
 * This module is the one place that knows the sign-in has gone. authFetch
 * reports it here after a refresh has been tried and failed; AuthContext
 * listens, remembers where the host was, and swaps the page for the sign-in
 * form IN PLACE (ProtectedRoute), so the URL — `/?gameId=5479` — is what the
 * host comes back to. Screens read `isSessionExpired()` to stay quiet: the
 * sign-in form is the message, and an alert on top of it is noise.
 *
 * NOTHING IS REPLAYED. The request that failed is not retried after the host
 * signs in again; the host presses the button again themselves. A state change
 * fired automatically after a page load could skip a question in front of a
 * room.
 */
import { rememberReturnPath } from './returnPath';

const listeners = new Set();
let expired = false;

/** sessionStorage key: "the host was sent to sign in from here". */
export const RESUME_KEY = 'engage.resumeAfterSignIn';

export function isSessionExpired() {
  return expired;
}

/** A fresh sign-in has happened; the page is live again. */
export function clearSessionExpired() {
  expired = false;
}

/** Subscribe. Returns the unsubscribe. */
export function onSessionExpired(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * The sign-in is gone and could not be refreshed. Idempotent: a page firing
 * five requests at once produces one sign-in screen, not five.
 */
export function notifySessionExpired() {
  if (expired) return;
  expired = true;
  try {
    rememberReturnPath();
    const path = `${window.location.pathname || ''}${window.location.search || ''}`;
    sessionStorage.setItem(RESUME_KEY, path);
  } catch (_) {
    /* private mode — the in-place sign-in still keeps the URL */
  }
  listeners.forEach((fn) => {
    try { fn(); } catch (err) { console.error('session-expiry listener failed:', err); }
  });
}

/**
 * Did the host land here by signing in again after an expiry, on THIS session?
 * Consumes the marker, so it answers yes once.
 */
export function takeResumeFor(gameId, storage = (typeof sessionStorage !== 'undefined' ? sessionStorage : null)) {
  if (!gameId || !storage) return false;
  let value = null;
  try {
    value = storage.getItem(RESUME_KEY);
    if (!value) return false;
    const params = new URLSearchParams(value.split('?')[1] || '');
    if (params.get('gameId') !== String(gameId)) return false;
    storage.removeItem(RESUME_KEY);
    return true;
  } catch (_) {
    return false;
  }
}

/** Test hook. */
export function __resetSessionExpiryForTests() {
  expired = false;
  listeners.clear();
}
