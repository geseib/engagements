/**
 * ENDING A SESSION EARLY — POST /games/{gameId}/end.
 *
 * Task 4, 2026-09-26 bug sweep: before this route existed, a trivia, poll,
 * call-and-answer or wavelength session reached ENDED only when
 * next-question.js's pool-dry path ran out of questions to serve. A host who
 * wanted to stop after round 4 of 10 had no way to.
 *
 * Mirrors utils/nextQuestion.js's `requestNextQuestion`: never throws, and
 * tells the truth about whether the write landed rather than turning a bad
 * response body into a thrown exception the caller has to guess the meaning
 * of.
 */
import { describeFailure } from './nextQuestion';

/**
 * Ask the server to end this session.
 *
 * Returns `{ ended, data, error }` and never throws. `ended: true` means
 * STATE now reads ENDED (or already did — the route is idempotent, so a
 * second call is not a fault and still reports `ended: true`).
 */
export async function requestEndSession({ fetchFn = fetch, apiBase, gameId }) {
  let response;
  try {
    response = await fetchFn(`${apiBase}games/${gameId}/end`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (e) {
    return { ended: false, data: null, error: e?.message || 'The request did not reach the server.' };
  }

  if (!response.ok) {
    return { ended: false, data: null, error: await describeFailure(response) };
  }

  try {
    return { ended: true, data: await response.json(), error: null };
  } catch {
    // A 2xx means the handler ran and STATE now reads ENDED; only the body
    // was unreadable. Reporting this as a failure would invite a second
    // click, which the route tolerates but which gains nothing.
    return { ended: true, data: null, error: 'The session ended, but its details could not be read.' };
  }
}
