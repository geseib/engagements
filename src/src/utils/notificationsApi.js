/**
 * THE BELL'S INBOX, from the browser — admin/orgs/my-notifications.js.
 *
 * Two kinds of entry arrive together: STORED ones (an AI draft ready, partly
 * ready or failed — read/unread, gone when the draft is decided) and LIVE ones
 * (an invitation, people waiting in a team you run, sets the check sent back,
 * Engage's own queues — there while the thing waits, gone when it is dealt
 * with). Each carries a `link`; `destinationOf` turns it into a place.
 */
import { authFetch } from '../auth/authFetch';
import { ENGAGE_KEY } from './libraries';

const base = () => `${(typeof window !== 'undefined' && window.API_BASE) || ''}me/notifications`;

export async function listNotifications() {
  const res = await authFetch(`${base()}/list`);
  if (!res.ok) throw new Error(`The notifications could not be read (HTTP ${res.status}).`);
  const data = await res.json();
  return {
    items: Array.isArray(data.items) ? data.items : [],
    unread: Number(data.unread) || 0,
  };
}

export async function markNotificationRead(id) {
  await authFetch(`${base()}/${encodeURIComponent(id)}/read`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
}

export async function markAllNotificationsRead() {
  await authFetch(`${base()}/read-all`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
}

/**
 * WHERE A NOTIFICATION GOES: `{ libraryKey, url }`.
 *
 *   draft     the question sets, with that draft's review open
 *   section   a console section (members, billing, moderation …)
 *   invites   the Overview, where invitations are answered
 *
 * `libraryKey` is the library to stand in first (an org id, or Engage); '' when
 * any library will do. The console switches to it before going there, since
 * the review and the section both belong to that library.
 */
export function destinationOf(link) {
  if (!link || typeof link !== 'object') return { libraryKey: '', url: '/admin' };
  const libraryKey = link.orgId || '';
  if (link.type === 'draft' && link.draftId) {
    return { libraryKey, url: `/admin?section=questionsets&draft=${encodeURIComponent(link.draftId)}` };
  }
  if (link.type === 'section' && link.section) {
    return { libraryKey, url: `/admin?section=${encodeURIComponent(link.section)}` };
  }
  if (link.type === 'invites') return { libraryKey: '', url: '/admin?section=overview' };
  return { libraryKey, url: '/admin' };
}

/** "3 days left" / "today" — a draft's notification says how long is left. */
export function daysLeftLabel(daysLeft) {
  if (daysLeft === null || daysLeft === undefined) return '';
  if (daysLeft <= 0) return 'expires today';
  return `${daysLeft} day${daysLeft === 1 ? '' : 's'} left`;
}

export const isEngage = (key) => key === ENGAGE_KEY;
