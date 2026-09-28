/**
 * THE CONSOLE'S CALLS TO THE EVENT ROUTES (lambda-functions/websocket/events/).
 *
 * One small module so the screens hold no URLs: EventsPanel, EventBuilder,
 * EventDetailsDialog and EventItemDialog import these and nothing else.
 * Every call goes through `authFetch`, which carries the Cognito token and the
 * active organisation (X-Engage-Org) — the event routes sit behind the
 * authorizer and a bare `fetch` would be refused.
 *
 * A refusal throws EventsApiError carrying the server's own sentence (`error`),
 * its status and its body, so a screen can show "This event has 8 engagements,
 * the most one can hold" exactly as the server said it, and tell a cap (409
 * with `cap`) from a changed agenda (409 with `code: 'agenda_changed'`).
 */
import { authFetch } from '../auth/authFetch';
import { adminApiUrl } from './adminApi';

export class EventsApiError extends Error {
  constructor(message, status, body) {
    super(message);
    this.name = 'EventsApiError';
    this.status = status;
    this.body = body || {};
  }
}

async function call(path, { method = 'GET', body } = {}) {
  const init = { method };
  if (body !== undefined) {
    init.headers = { 'Content-Type': 'application/json' };
    init.body = JSON.stringify(body);
  }
  const res = await authFetch(adminApiUrl(path), init);
  const parsed = await res.json().catch(() => ({}));
  if (!res.ok) throw new EventsApiError(parsed.error || `HTTP ${res.status}`, res.status, parsed);
  return parsed;
}

const enc = encodeURIComponent;

/** The acting organisation's events, soonest first. */
export async function listEvents() {
  const body = await call('events');
  return Array.isArray(body.events) ? body.events : [];
}

/** `{ event, items }` — one event and its agenda, in order. */
export const getEvent = (code) => call(`events/${enc(code)}`);

export async function createEvent(fields) {
  return (await call('events', { method: 'POST', body: fields })).event;
}

export async function updateEvent(code, fields) {
  return (await call(`events/${enc(code)}`, { method: 'PUT', body: fields })).event;
}

/**
 * `{ deleted }` — the event, its agenda and its join code, in one step.
 * Refused (409, the server's sentence) unless every item is still planned.
 */
export const deleteEvent = (code) => call(`events/${enc(code)}`, { method: 'DELETE' });

/** `{ item }`. `item` is `{ type, title, description, minutes, position, setRef? }`. */
export const addItem = (code, item) => call(`events/${enc(code)}/items`, { method: 'POST', body: item });

/** `{ item }`. `fields` may carry `version` — "Use vN". */
export const updateItem = (code, itemId, fields) =>
  call(`events/${enc(code)}/items/${enc(itemId)}`, { method: 'PUT', body: fields });

export const removeItem = (code, itemId) =>
  call(`events/${enc(code)}/items/${enc(itemId)}`, { method: 'DELETE' });

/** The whole agenda's order, every item once. */
export const reorderItems = (code, order) =>
  call(`events/${enc(code)}/items`, { method: 'PUT', body: { order } });

/**
 * RUNNING THE DAY (events M3) — POST events/{code}/run.
 * `action` is start | resume | pause | end | extend | end-event; every one but
 * end-event names an item. Answers `{ event, items, gameId? }`, the same shape
 * as getEvent, so the stage and the builder redraw from what the server holds.
 * A refusal (409 with `code`: run_changed, survey_open, item_done, …) throws
 * EventsApiError with the server's own sentence.
 */
export const runEvent = (code, action, itemId) =>
  call(`events/${enc(code)}/run`, { method: 'POST', body: itemId ? { action, itemId } : { action } });

// ── A presentation's slides (27 Sep 2026; events/deck-store.js) ────────────
/**
 * `{ upload: { key, url, contentType, expiresIn, maxBytes, name } }` — one
 * signed PUT for a PDF the host chose. The file then goes straight to storage
 * (`putDeckFile`), and `key` rides on the item's `deck` when it is saved.
 */
export const signDeckUpload = (code, file) => call(`events/${enc(code)}/deck`, {
  method: 'POST',
  body: { name: file.name, size: file.size, type: file.type || '' },
});

/**
 * The file itself, PUT to the signed URL — not through authFetch: the URL is
 * the credential, and a bearer token must never travel to storage. An
 * XMLHttpRequest rather than fetch, for its upload progress (`onProgress`,
 * 0 to 1): a 50 MB deck on a venue's network takes long enough to need one.
 */
export function putDeckFile(upload, file, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', upload.url);
    xhr.setRequestHeader('Content-Type', upload.contentType || 'application/pdf');
    if (xhr.upload && onProgress) {
      xhr.upload.onprogress = (e) => { if (e.lengthComputable && e.total) onProgress(e.loaded / e.total); };
    }
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else reject(new EventsApiError('The PDF did not upload. Try again.', xhr.status));
    };
    xhr.onerror = () => reject(new EventsApiError('The PDF did not upload. Check the connection and try again.', 0));
    xhr.send(file);
  });
}

/** `{ deck: { id, url, pages, page, bytes, expiresIn } }` — a signed read of the slides, for the stage. */
export const readDeck = (code, itemId) => call(`events/${enc(code)}/items/${enc(itemId)}/deck`);

/**
 * `{ itemId, page }` — the slide the stage is on, kept on the item so a
 * reload lands on it and phones following the talk can show it.
 */
export const turnPage = (code, itemId, page) => call(`events/${enc(code)}/run`, {
  method: 'POST',
  body: { action: 'page', itemId, page },
});
