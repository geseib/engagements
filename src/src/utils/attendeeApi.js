/**
 * THE ATTENDEE'S CALLS (events M2–M4) — the public event routes a phone,
 * laptop or tablet makes, and where it keeps its place in the event.
 *
 *   GET  events/{code}/agenda            the agenda: every item, its state,
 *                                        and the live item's session code
 *   GET  events/{code}/agenda?view=now   what is live now, and `rev` — polled
 *   POST events/{code}/attendees         a name → the attendee's token
 *   GET  events/{code}/me                the token → the attendee's own name
 *
 * Every one is PUBLIC (lambda-functions/websocket/events/get-agenda.js,
 * attendees.js): an attendee has no account, so a plain `fetch` and never
 * `authFetch`. The token rides in `Authorization: Bearer` on /me only; joining
 * an item sends it in the join's body (PlayerPage, `attendeeToken`).
 *
 * A refusal throws AttendeeApiError with the server's own sentence, its status
 * and its body, so a screen can tell "not joined" (401) from "no such event"
 * (404) from "the day is over" (409 event_ended).
 */
export class AttendeeApiError extends Error {
  constructor(message, status, body) {
    super(message);
    this.name = 'AttendeeApiError';
    this.status = status;
    this.body = body || {};
  }
}

const apiBase = () => window.API_BASE || '';
const enc = encodeURIComponent;

async function call(path, init) {
  const res = await fetch(`${apiBase()}${path}`, init);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new AttendeeApiError(body.error || `HTTP ${res.status}`, res.status, body);
  return body;
}

/** `{ event, items }` — the public agenda. */
export const getAgenda = (code) => call(`events/${enc(code)}/agenda`);

/** `{ code, state, liveItemId, live, rev }` — what is live now. Cheap; polled. */
export async function getNow(code) {
  const body = await call(`events/${enc(code)}/agenda?view=now`);
  return body.now || null;
}

/** `{ token, attendee: { name, joinedAt } }`. */
export const joinEvent = (code, name) => call(`events/${enc(code)}/attendees`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ name }),
});

/** `{ attendee: { name, joinedAt } }`, or AttendeeApiError 401 when the token is not known. */
export const whoAmI = (code, token) => call(`events/${enc(code)}/me`, {
  headers: { Authorization: `Bearer ${token}` },
});

// ── Where the phone keeps its place ─────────────────────────────────────────
/**
 * ONE KEY PER EVENT: `engage.event.<code>` → `{ token, name }`. The token is
 * the only proof this browser joined; the name is kept beside it so a reload
 * can say "Priya" before /me answers. Every read and write is wrapped:
 * private browsing can throw on localStorage, and an attendee who cannot keep
 * a token simply types their name again next time.
 */
export const attendeeKey = (code) => `engage.event.${code}`;

function store() {
  try {
    return window.localStorage || null;
  } catch (_) {
    return null;
  }
}

export function readAttendee(code) {
  try {
    const raw = store() && store().getItem(attendeeKey(code));
    const parsed = raw ? JSON.parse(raw) : null;
    if (parsed && typeof parsed.token === 'string' && parsed.token) {
      return { token: parsed.token, name: typeof parsed.name === 'string' ? parsed.name : '' };
    }
  } catch (_) { /* unreadable: treated as not joined */ }
  return null;
}

export function saveAttendee(code, { token, name }) {
  try {
    if (store()) store().setItem(attendeeKey(code), JSON.stringify({ token, name }));
  } catch (_) { /* this browser cannot keep it; the attendee is still in for this visit */ }
}

export function forgetAttendee(code) {
  try {
    if (store()) store().removeItem(attendeeKey(code));
  } catch (_) { /* nothing to forget */ }
}
