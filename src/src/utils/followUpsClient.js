/**
 * THE FOLLOW-UP ASKS' ROUTES, for the host's screens and the room's
 * (lambda-functions/game/followups.js; docs/design/followup-icons).
 *
 * The host's calls go through the `fetchFn` the caller hands in (authFetch on
 * the laptop and the Remote); the room's are plain fetch. Every result is
 * `{ ok, status, body, error }`. A 404 from the host's round read means the
 * feature is off for this tier: `enabled: false`, never an error.
 */
const pad = (round) => String(parseInt(String(round), 10) || 0).padStart(3, '0');

async function call(fetchFn, url, init) {
  let res;
  try {
    res = await fetchFn(url, init);
  } catch (e) {
    return { ok: false, status: 0, body: null, error: 'That did not reach the server.' };
  }
  let body = null;
  try { body = await res.json(); } catch (e) { body = null; }
  return { ok: res.ok, status: res.status, body, error: res.ok ? null : ((body && body.error) || 'That did not work.') };
}

const post = (body) => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

export async function fetchRoundAsks({ fetchFn, apiBase, gameId, round }) {
  const r = await call(fetchFn, `${apiBase}games/${encodeURIComponent(gameId)}/followups/round/${pad(round)}`);
  if (r.status === 404) return { ok: true, enabled: false, suggestions: null, asks: [], live: null };
  if (!r.ok) return { ok: false, enabled: true, error: r.error };
  return { ok: true, enabled: true, suggestions: r.body.suggestions || null, asks: r.body.asks || [], live: r.body.live || null };
}

export function sendAsk({ fetchFn, apiBase, gameId, round, ask }) {
  return call(fetchFn, `${apiBase}games/${encodeURIComponent(gameId)}/followups/send`, post({ round: pad(round), ...ask }));
}

export function closeAsk({ fetchFn, apiBase, gameId, round, askId }) {
  return call(fetchFn, `${apiBase}games/${encodeURIComponent(gameId)}/followups/asks/${encodeURIComponent(askId)}/close`, post({ round: pad(round) }));
}

export function cancelAsk({ fetchFn, apiBase, gameId, round, askId }) {
  return call(fetchFn, `${apiBase}games/${encodeURIComponent(gameId)}/followups/asks/${encodeURIComponent(askId)}/cancel`, post({ round: pad(round) }));
}

export function pickIdea({ fetchFn, apiBase, gameId, round, askId, id, picked }) {
  return call(fetchFn, `${apiBase}games/${encodeURIComponent(gameId)}/followups/asks/${encodeURIComponent(askId)}/pick`, post({ round: pad(round), id, picked }));
}

/** The room's read: the round's current ask (live, or the last whose results were shown). */
export async function fetchLiveAsk({ fetchFn = fetch, apiBase, gameId, playerName, clientId }) {
  const q = playerName ? `?playerName=${encodeURIComponent(playerName)}${clientId ? `&clientId=${encodeURIComponent(clientId)}` : ''}` : '';
  const r = await call(fetchFn, `${apiBase}games/${encodeURIComponent(gameId)}/followup-play/live${q}`);
  if (r.status === 404) return { ok: true, ask: null, yours: null };
  if (!r.ok) return { ok: false, error: r.error };
  return { ok: true, ask: r.body.ask || null, yours: r.body.yours === undefined ? null : r.body.yours };
}

export function answerAsk({ fetchFn = fetch, apiBase, gameId, round, askId, playerName, clientId, value }) {
  return call(fetchFn, `${apiBase}games/${encodeURIComponent(gameId)}/followup-play/asks/${encodeURIComponent(askId)}/answer`,
    post({ round: pad(round), playerName, clientId, value }));
}
