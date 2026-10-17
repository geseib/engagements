/**
 * LINKS FROM UNTRUSTED TEXT (docs/design/parity/PLAN.md §2.4, B5).
 *
 * Pure, and importing nothing: the room's window is built on buildScreens.js
 * and buildroom/screens/, which need `safeHref`, and must never pull the
 * host's signed-in client (buildHostApi.js imports authFetch). buildHostApi.js
 * re-exports it, so its own importers are unchanged.
 */

/** An http(s) URL as a string, or '' — anything Claude or a phone sent is untrusted. */
export function safeHref(value) {
  const s = String(value || '').trim();
  if (!s) return '';
  try {
    const u = new URL(s);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.toString() : '';
  } catch (e) {
    return '';
  }
}
