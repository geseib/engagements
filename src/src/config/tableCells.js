/**
 * HOW A LIST CELL PRINTS A VALUE IT MIGHT NOT HAVE.
 *
 * Three list screens draw rows of the same shape — question sets, the admin's
 * sessions, and the host's session history — and every one of them needs the
 * same two answers: a date that might be missing, and now a count that might be
 * unknown.
 *
 * `formatWhen` already existed TWICE, byte for byte including its doc comment,
 * in `SessionsPanel.jsx` and `QuestionSetsPanel.jsx`. The session-history panel
 * was about to import one of those copies, and adding `countOrDash` beside it
 * would have made the admin panel import back from the host panel — a cycle
 * between two components that have no business knowing about each other. Both
 * live here instead, and all three screens import from one place.
 *
 * THE DISTINCTION BOTH FUNCTIONS EXIST TO PRESERVE. "There is nothing" and "we
 * could not find out" are different facts, and a list that renders the second
 * as the first is the empty-state-that-lies rule in miniature — a session whose
 * player query failed must not claim nobody joined.
 */

/** A date that is present, formatted; a date that is absent, an em dash. */
export function formatWhen(value) {
  if (!value) return '—';
  const when = new Date(value);
  if (Number.isNaN(when.getTime())) return '—';
  return when.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

/**
 * A count that is present, printed; a count that is absent, an em dash.
 *
 * Tests null and undefined rather than falsiness, deliberately. `0` is a real
 * and honest answer — a session nobody joined genuinely had no players — so a
 * `!value` guard, which is the obvious way to write this, would silently
 * relabel every empty session "unknown".
 */
export function countOrDash(value) {
  return value === null || value === undefined ? '—' : String(value);
}
