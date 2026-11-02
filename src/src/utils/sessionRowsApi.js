/**
 * THE TWO THINGS A SESSIONS ROW DOES ON ITS OWN, in either frame (experience
 * plan 4a): delete it, and copy its join link. Everything else a row offers is
 * a navigation or a host-page flow the frame supplies.
 *
 * Delete was the console's alone (SessionsPanel); the start screen's list had
 * no way to clear a session out. One call, so the two frames cannot delete a
 * session two different ways.
 */
import { authFetch } from '../auth/authFetch';
import { adminApiUrl } from './adminApi';
import { deleteEvent } from './eventsApi';
import { isEventRow, eventJoinPath } from '../config/engagementKinds';

/** An error the list can tell apart: the server wants staff to give a reason. */
function reasonRequired(message) {
  const err = new Error(message || 'A reason is required.');
  err.code = 'reason_required';
  return err;
}

/**
 * Delete one row: a session through clear-game, an event through its own
 * route (which takes its agenda, join code and item sessions; saved reports
 * stay). Resolves when it is gone; rejects with the server's sentence, or with
 * `code: 'reason_required'` when Engage staff must say why.
 */
export async function deleteSessionRow(row, reason = '') {
  if (isEventRow(row)) {
    try {
      await (reason ? deleteEvent(row.gameId, { reason }) : deleteEvent(row.gameId));
    } catch (err) {
      const body = (err && err.body) || {};
      if (body.code === 'reason_required' || err.code === 'reason_required') throw reasonRequired(err.message);
      throw err;
    }
    return;
  }
  const response = await authFetch(
    adminApiUrl(`admin/clear-game/${encodeURIComponent(row.gameId)}`),
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      ...(reason ? { body: JSON.stringify({ reason }) } : {}),
    },
  );
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (result.code === 'reason_required') throw reasonRequired(result.error);
    throw new Error(result.error || `Could not delete ${row.gameId}`);
  }
}

/** The address a participant joins by: a session's player link, or an event's. */
export function joinUrlFor(gameId, { event = false } = {}) {
  const origin = (typeof window !== 'undefined' && window.location.origin) || '';
  return event ? `${origin}${eventJoinPath(gameId)}` : `${origin}/player?gameId=${gameId}`;
}

/** Copy it. Resolves true when the clipboard took it. */
export async function copyJoinLink(gameId, opts = {}) {
  try {
    await navigator.clipboard.writeText(joinUrlFor(gameId, opts));
    return true;
  } catch (err) {
    return false;
  }
}
