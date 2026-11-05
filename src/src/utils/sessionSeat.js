/**
 * THIS BROWSER'S SEAT IN A SESSION, IN TWO COPIES (dev QA 5 Nov 2026).
 *
 * The session join's twin of utils/attendeeApi.js (an event's attendee):
 * a browser is not a person, so the name lives in two places.
 *
 *   localStorage    `playerName_<code>`, the BROWSER's: every tab, everyone
 *                   who picks up the laptop. The key the page has always used.
 *   sessionStorage  the same key, THIS TAB's: a reload, or coming back to the
 *                   session in the same tab, finds it.
 *
 * Coming back to `/play?gameId=4821` with a seat here offers it instead of a
 * blank form: this tab's own copy is "Welcome back, Priya." with Rejoin; only
 * the browser's copy (a new tab, maybe a second person) asks "Are you Priya?"
 * with I'm someone else, the 5 Nov rule for an event, now for a session too.
 * Every storage call is guarded: a browser that keeps nothing joins as ever.
 */
export const seatKey = (code) => `playerName_${code}`;

function box(kind) {
  try {
    return window[kind] || null;
  } catch (_) {
    return null;
  }
}

function readFrom(kind, code) {
  try {
    const store = box(kind);
    const name = store && store.getItem(seatKey(code));
    return typeof name === 'string' && name.trim() ? name : null;
  } catch (_) {
    return null;
  }
}

/**
 * `{ name, thisTab }`, or null. The browser's copy is the seat (forgetting it
 * forgets the seat, as it always has); `thisTab` says this tab holds the same
 * name. A tab copy the browser no longer has is not a seat.
 */
export function readSeat(code) {
  if (!code) return null;
  const browser = readFrom('localStorage', code);
  if (!browser) return null;
  return { name: browser, thisTab: readFrom('sessionStorage', code) === browser };
}

export function saveSeat(code, name) {
  if (!code || !name) return;
  for (const kind of ['localStorage', 'sessionStorage']) {
    try {
      const store = box(kind);
      if (store) store.setItem(seatKey(code), name);
    } catch (_) { /* this browser cannot keep it; the player is still in */ }
  }
}

export function forgetSeat(code) {
  if (!code) return;
  for (const kind of ['localStorage', 'sessionStorage']) {
    try {
      const store = box(kind);
      if (store) store.removeItem(seatKey(code));
    } catch (_) { /* nothing to forget */ }
  }
}

/**
 * The session code a `/play` link carries: `?gameId=4821` (every link this
 * app makes, utils/joinCode.js sessionPath) or `?code=4821` (a shortened or
 * hand-typed link; dev QA 5 Nov came back on one and found a blank form, the
 * page read `gameId` only). `gameId` as given; `code` only as four digits.
 */
export function sessionCodeFrom(search) {
  try {
    const params = new URLSearchParams(search || '');
    const gameId = (params.get('gameId') || '').trim();
    if (gameId) return gameId; // as the page has always taken it
    const code = (params.get('code') || '').trim();
    return /^\d{4}$/.test(code) ? code : null;
  } catch (_) {
    return null;
  }
}
