/**
 * Where to go back to after an OAuth round trip.
 *
 * `ProtectedRoute` renders the sign-in form in place, so an email/password
 * sign-in never leaves the URL and needs none of this. The social path does
 * leave: the browser goes to Cognito and comes back to the callback route,
 * and nothing recorded where the host was heading. `OAuthCallback` therefore
 * hardcoded `/` -- which is the HOST PAGE, so a host scanning the remote QR
 * and choosing Google landed on a second host screen on their phone, opening a
 * second host socket and evicting the projector.
 *
 * The value survives a cross-origin redirect, so it is untrusted on the way
 * back out. Only a same-origin path is ever returned.
 */
export const RETURN_KEY = 'authReturnTo';

/** Auth surfaces are never a destination; returning to one loops the sign-in. */
const NEVER_RETURN_TO = ['/auth', '/login', '/register'];

export function rememberReturnPath(location = window.location) {
  try {
    const path = `${location.pathname || ''}${location.search || ''}`;
    if (path) sessionStorage.setItem(RETURN_KEY, path);
  } catch (_) {
    /* private mode, quota — the flow still works, it just lands on the default */
  }
}

export function takeReturnPath(storage = sessionStorage) {
  let value = null;
  try {
    value = storage.getItem(RETURN_KEY);
    storage.removeItem(RETURN_KEY);
  } catch (_) {
    return null;
  }
  if (typeof value !== 'string' || !value) return null;

  // Resolved with the same WHATWG URL algorithm the browser applies to
  // `window.location.href = value`, not a prefix check. For http/https that
  // algorithm treats a backslash as a forward slash and strips embedded
  // tab/CR/LF before it decides what the authority is, so a string like
  // "/\evil.example/steal" starts with a single "/" and contains no "//" --
  // passing a `startsWith` guard -- while still resolving to a different
  // origin. Only a real parse-and-compare catches that.
  let url;
  try {
    url = new URL(value, window.location.origin);
  } catch (_) {
    return null;
  }
  if (url.origin !== window.location.origin) return null;

  const path = url.pathname;
  if (NEVER_RETURN_TO.some((p) => path === p || path.startsWith(`${p}/`))) return null;

  // Reconstructed from the parsed URL, not the raw stored string -- the raw
  // string can still carry the backslash/control-character tricks above even
  // after they've been proven to resolve to our own origin.
  return `${url.pathname}${url.search}`;
}
