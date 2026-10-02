/**
 * THE FOUR CALLS A PHONE MAKES IN A BUILD ROOM.
 *
 * The contract is docs/design/build-room/PLAN.md §6.2, served by
 * lambda-functions/game/build-room.js (`routePlay`):
 *
 *   GET  games/{id}/build-play/state?playerName=&clientId=   PublicState (§6.3)
 *   POST games/{id}/build-play/respond   {playerName, clientId, askId, text | choice[] + why | rating + why}
 *   POST games/{id}/build-play/vote      {playerName, clientId, askId, respIds[]}
 *   POST games/{id}/build-play/idea      {playerName, clientId, text}
 *
 * PLAIN `fetch`, NO AUTH. A phone holds no Cognito identity; the server checks
 * `{playerName, clientId}` against the PLAYER# row the join wrote, and the
 * clientId is the one the join flow minted (components/joinResult.js
 * `getClientId`).
 *
 * NOTHING HERE THROWS. Every call resolves `{ok, status, data, error}`, and
 * `error` is the server's own sentence when it sent one ("That question is no
 * longer open", "Up to 3 suggestions each"), so the screen can show it as is.
 * `stale` marks the 409 that means the ask moved on under the phone — the
 * caller refetches rather than leaving a dead form up.
 */

const JSON_HEADERS = { 'Content-Type': 'application/json' };
const enc = encodeURIComponent;

export const STALE_ASK = 'That question is no longer open';

function base(apiBase, gameId) {
  const root = String(apiBase || '');
  return `${root}${root && !root.endsWith('/') ? '/' : ''}games/${enc(gameId)}/build-play/`;
}

async function readJson(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

async function call(url, init) {
  let response;
  try {
    response = await fetch(url, init);
  } catch {
    return { ok: false, status: 0, data: null, error: 'Could not reach the room. Check your connection and try again.' };
  }
  const data = await readJson(response);
  if (response.ok) return { ok: true, status: response.status, data: data || {}, error: null };
  const said = data && typeof data.error === 'string' && data.error.trim() ? data.error.trim() : null;
  return {
    ok: false,
    status: response.status,
    data,
    error: said || 'Something went wrong. Try again.',
    stale: response.status === 409,
  };
}

const identity = ({ playerName, clientId }) => ({ playerName, clientId: clientId || '' });

const post = (apiBase, gameId, route, who, body) => call(`${base(apiBase, gameId)}${route}`, {
  method: 'POST',
  headers: JSON_HEADERS,
  body: JSON.stringify({ ...identity(who), ...body }),
});

/** GET state — the room as this phone may see it. */
export function fetchBuildState({ apiBase, gameId, playerName, clientId }) {
  const q = `playerName=${enc(playerName || '')}&clientId=${enc(clientId || '')}`;
  return call(`${base(apiBase, gameId)}state?${q}`, { method: 'GET' });
}

/** POST respond. `answer` is `{text}` (Ideas), `{choice, why}` (Choose) or `{rating, why}` (Rate). */
export function sendResponse({ apiBase, gameId, playerName, clientId }, askId, answer) {
  return post(apiBase, gameId, 'respond', { playerName, clientId }, { askId, ...answer });
}

/** POST vote — an approval ballot of suggestion ids. */
export function sendVote({ apiBase, gameId, playerName, clientId }, askId, respIds) {
  return post(apiBase, gameId, 'vote', { playerName, clientId }, { askId, respIds });
}

/** POST idea — a thought for the host, at any time. */
export function sendIdea({ apiBase, gameId, playerName, clientId }, text) {
  return post(apiBase, gameId, 'idea', { playerName, clientId }, { text });
}
