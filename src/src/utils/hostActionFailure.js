/**
 * WHAT THE HOST SCREEN SAYS WHEN ONE OF ITS BUTTONS IS REFUSED.
 *
 * Reported by the owner, 2026-10-12, on dev: a host screen left open for hours
 * answered Next Round with a browser alert, "Failed to get next question:
 * Unauthorized (HTTP 401)". Two things were true at once. The sign-in had run
 * out (sessionExpiry.js handles that), AND the session itself had been ended at
 * 15:42 UTC from another screen — had the request carried a token, next-question
 * would have answered 400 "Cannot advance from state 'ENDED'", and that would
 * have been an alert too. The owner: "Still would be nice to avoid and go to
 * the report instead."
 *
 * So a refused host action is decided here, in this order:
 *
 *   1. The sign-in is gone → say NOTHING. The page is already swapping to the
 *      sign-in form (AuthContext), and that form is the message.
 *   2. The session has ENDED (read fresh from /host-state, because every route
 *      words an ended session differently — next-question's 400, a 404 from a
 *      route that no longer finds a round) → the screen goes to its ENDED
 *      phase, whose one primary is Open Session Report, with a plain line in
 *      the dock.
 *   3. Anything else → the reason, in the dock beside the button that was
 *      pressed (sessionActionError → dockHint). Never alert().
 *
 * Nothing here retries the action. The host presses the button again.
 */
import { isSessionExpired } from '../auth/sessionExpiry';

export const ENDED_ELSEWHERE = 'This session has ended. Open the report to see how it went.';
export const ENDED_AFTER_SIGN_IN = 'This session has ended. Here is its report.';

/** Is this session over, according to the server right now? Never throws. */
export async function sessionHasEnded({ fetchFn, apiBase, gameId }) {
  if (!gameId) return false;
  try {
    const res = await fetchFn(`${apiBase}games/${gameId}/host-state`);
    if (!res || !res.ok) return false;
    const data = await res.json();
    return Boolean(data && data.state === 'ENDED');
  } catch (_) {
    return false;
  }
}

/**
 * Decide what a refused host action means. Returns one of
 * `{ kind: 'expired' }`, `{ kind: 'ended', message }`, `{ kind: 'failed', message }`.
 */
export async function classifyHostActionFailure({ message, fetchFn, apiBase, gameId }) {
  if (isSessionExpired()) return { kind: 'expired' };
  const ended = await sessionHasEnded({ fetchFn, apiBase, gameId });
  // The state read can itself be the request that finds the sign-in gone.
  if (isSessionExpired()) return { kind: 'expired' };
  if (ended) return { kind: 'ended', message: ENDED_ELSEWHERE };
  return { kind: 'failed', message: message || 'That did not work. Please try again.' };
}
