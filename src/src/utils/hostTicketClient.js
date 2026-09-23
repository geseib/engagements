/**
 * ONE CALL: a single-use ticket that makes the host screen's socket a HOST one.
 *
 * `POST /games/{gameId}/host-ticket` carries the Cognito authorizer and answers
 * 404 to anyone who may not drive the session, so the host page hands in
 * `authFetch` as `fetchFn` — the same arrangement as utils/surveyHostClient.js,
 * which keeps this file free of the auth module and importable anywhere.
 *
 * The WebSocket client calls this before EVERY open (see WebSocketClient's
 * `hostTicket` option): the server spends a ticket on the handshake it rides
 * in on, and without one the connection is stored as a player's.
 *
 * NOTHING HERE THROWS. It resolves `{ ok, status, ticket, error }`, and a
 * refusal or a network failure is `ticket: null` — the socket client treats
 * that as a failed connect and tries again on its reconnect ladder.
 */

async function describeFailure(response) {
  try {
    const body = await response.json();
    if (body && typeof body.error === 'string' && body.error.trim()) return body.error;
  } catch {
    /* A body that will not parse tells us nothing; fall through to the status. */
  }
  return `No host ticket (${response.status}).`;
}

export async function requestHostTicket({ fetchFn = fetch, apiBase, gameId }) {
  let response;
  try {
    response = await fetchFn(`${apiBase}games/${encodeURIComponent(gameId)}/host-ticket`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (e) {
    return { ok: false, status: 0, ticket: null, error: e?.message || 'That did not reach the server.' };
  }
  if (!response.ok) {
    return { ok: false, status: response.status, ticket: null, error: await describeFailure(response) };
  }
  let body = {};
  try {
    body = (await response.json()) || {};
  } catch {
    /* handled below: no ticket is no ticket */
  }
  const ticket = typeof body.ticket === 'string' && body.ticket ? body.ticket : null;
  if (!ticket) {
    return { ok: false, status: response.status, ticket: null, error: 'The server answered without a ticket.' };
  }
  return { ok: true, status: response.status, ticket, error: null };
}
