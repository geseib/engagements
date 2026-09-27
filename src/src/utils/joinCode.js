/**
 * WHAT A FOUR-DIGIT CODE OPENS — GET /join/{code}
 * (lambda-functions/websocket/events/resolve-code.js), asked by every place a
 * participant types or follows a code: the join box (hooks/useJoinCode.js, on
 * /join and the marketing home) and the player page (PlayerPage.jsx, for a
 * code in its link or its form). One question in one module, so no two of
 * them can disagree about where an event's code goes (events M2).
 *
 * PARTICIPANT-SAFE. The request names the one code the participant already
 * has, on a public route that answers its kind and, for an event, the title
 * and date the code already opens (tests/event-public-reads.js). It is the
 * only request here that is not under `games/{id}`, which is why
 * __tests__/joinCode.test.js pins its exact shape.
 */

/** The attendee's page (components/event/EventAttendeePage.jsx). */
export const eventPath = (code) => `/play?event=${code}`;
/** The player page, as every session has always been joined. */
export const sessionPath = (code) => `/play?gameId=${code}`;

/**
 * 'event' | 'session' | 'missing' | 'unknown'. `missing` is the route's 404:
 * nothing is running with that code. `unknown` is everything the check could
 * not settle — a network failure, a 5xx, a body that names no kind, a code
 * that is not four digits (never sent) — and every caller treats it as a
 * session, exactly as before events existed: a check that can strand a
 * participant is worse than no check.
 */
export async function resolveJoinCode(code, {
  apiBase = window.API_BASE,
  fetchImpl = (...args) => fetch(...args),
} = {}) {
  if (!/^\d{4}$/.test(String(code || ''))) return 'unknown';
  try {
    const res = await fetchImpl(`${apiBase}join/${code}`);
    if (!res) return 'unknown';
    if (res.status === 404) return 'missing';
    if (!res.ok) return 'unknown';
    const body = await res.json().catch(() => null);
    if (body && body.kind === 'event') return 'event';
    if (body && body.kind === 'session') return 'session';
    return 'unknown';
  } catch (_) {
    return 'unknown';
  }
}

/** Where a code of this kind is joined. Everything that is not an event is a session. */
export const joinPathFor = (code, kind) => (kind === 'event' ? eventPath(code) : sessionPath(code));
