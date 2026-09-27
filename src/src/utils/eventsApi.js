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
