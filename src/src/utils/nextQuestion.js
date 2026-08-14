/**
 * ADVANCING THE ROUND, AND SAYING TRUTHFULLY WHETHER IT WORKED.
 *
 * Reported from a live session on a 100-question set: pressing Next Question
 * showed "Failed to start next question", and then the next question appeared
 * anyway. Both halves were real. The round HAD advanced; the message was wrong.
 *
 * ── WHY THE MESSAGE LIED ───────────────────────────────────────────────────
 *
 * Two separate faults in `handleNextQuestion`, and they compound.
 *
 * 1. THE ERROR PATH COULD THROW. On a non-OK response it read the body with
 *    `await res.json()` to build a specific message. A body that is not JSON —
 *    API Gateway's HTML on a 504, an empty 502, anything from a proxy — makes
 *    that line throw, and the throw lands in the outer catch, which says
 *    "Failed to start next question. Please try again." So the one case where
 *    the server had something useful to say is the exact case where its message
 *    was replaced by a generic one.
 *
 * 2. THE CATCH COVERED THE WHOLE TURN, NOT THE ADVANCE. Once the POST returns
 *    OK the round HAS advanced server-side and the backend has already
 *    broadcast it over the WebSocket. Everything after that — reading the
 *    question, refreshing players, reloading category counts — is follow-up. A
 *    failure there is worth knowing about, but it is not the advance failing,
 *    and reporting it as one tells the host to retry something that already
 *    happened. Retrying skips a question.
 *
 * Together they produce the report: an alert claiming failure, immediately
 * followed by the WebSocket delivering the question that did in fact start.
 *
 * ── WHY THIS IS A MODULE ───────────────────────────────────────────────────
 *
 * `GameHostPage.jsx` cannot be mounted in jsdom at all — its own test suite is
 * one of the five that have never run, and `sessionSetupPanel.test.jsx` was
 * written against an extracted panel for the same reason. Logic that decides
 * what a host is TOLD about a failed round transition should not be the part of
 * the codebase that no test can reach, so it lives here and is tested directly.
 */

/**
 * Read a failed response without ever throwing.
 *
 * The rule: try JSON, fall back to text, fall back to the status line. A body
 * that is not JSON is the normal shape of an infrastructure failure — the
 * gateway and the load balancer do not speak this API's error format — so the
 * reader has to survive it. Returning a usable string in every branch is the
 * whole job; a reader that throws is what turned a 504 into "please try again".
 */
export async function describeFailure(response) {
  const status = response?.status;
  const statusPart = status ? `HTTP ${status}` : 'no response';

  let raw = '';
  try {
    raw = await response.text();
  } catch {
    // A body that cannot even be read as text. The status is still worth having.
    return statusPart;
  }

  const trimmed = (raw || '').trim();
  if (!trimmed) return statusPart;

  try {
    const parsed = JSON.parse(trimmed);
    const message = parsed?.error || parsed?.message;
    if (message) return `${message} (${statusPart})`;
  } catch {
    // Not JSON. Fall through to the text branch below rather than giving up:
    // an HTML error page still says which layer refused, and "Endpoint request
    // timed out" is worth more to whoever is standing in front of a room than
    // "Unknown error".
  }

  // Collapse whitespace so an HTML page does not paste a wall into an alert,
  // and cap it so the useful first clause survives.
  const flattened = trimmed.replace(/\s+/g, ' ');
  const clipped = flattened.length > 200 ? `${flattened.slice(0, 200)}…` : flattened;
  return `${clipped} (${statusPart})`;
}

/**
 * Ask the server to advance the round.
 *
 * Returns `{ advanced, data, error }` and never throws. `advanced: true` means
 * the round moved and the backend has broadcast it — from that point the host
 * must NOT be told to retry, whatever else goes wrong afterwards.
 */
export async function requestNextQuestion({ fetchFn, apiBase, gameId, body = {} }) {
  let response;
  try {
    response = await fetchFn(`${apiBase}games/${gameId}/next-question`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch (e) {
    // The request never landed. Nothing advanced, and retrying is the right
    // advice — this is the one case where "please try again" is honest.
    return { advanced: false, data: null, error: e?.message || 'The request did not reach the server.' };
  }

  if (!response.ok) {
    return { advanced: false, data: null, error: await describeFailure(response) };
  }

  try {
    return { advanced: true, data: await response.json(), error: null };
  } catch {
    /*
      THE AWKWARD ONE, AND IT IS DELIBERATELY `advanced: true`.

      A 2xx means the handler ran and the round moved; the backend has already
      broadcast the new question. Only the body was unreadable. Reporting this
      as a failure would tell the host to press Next again, which skips a
      question in front of a room — a worse outcome than a round that advanced
      with a stale panel, which the WebSocket repairs on its own.
    */
    return { advanced: true, data: null, error: 'The round advanced, but its details could not be read.' };
  }
}
