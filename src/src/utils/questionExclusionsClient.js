/**
 * THE WIRE HALF OF THE DISABLED-QUESTIONS LIST — the queue client's sibling,
 * for `GET`/`POST /games/{gameId}/exclusions` (question-exclusions.js).
 *
 * Same contract as questionQueueClient.js, and the same reasons: no throw
 * ever, `changed: false` is an answer not an error, `excluded: null` on an
 * unreadable 2xx means "the write landed, re-read" and never "the list is
 * empty".
 */
import { authFetch } from '../auth/authFetch';

async function describeFailure(response) {
  try {
    const body = await response.json();
    if (body && body.error) return body.error;
  } catch { /* fall through to the status line */ }
  return `The server answered ${response.status}.`;
}

function project(payload) {
  const body = payload && typeof payload === 'object' ? payload : {};
  return {
    excluded: Array.isArray(body.excluded) ? body.excluded : [],
    version: Number(body.version) || 0,
    changed: body.changed ?? null,
    refused: body.refused ?? null,
    staleView: Boolean(body.staleView),
  };
}

export async function fetchExclusions({ fetchFn = authFetch, apiBase, gameId }) {
  let response;
  try {
    response = await fetchFn(`${apiBase}games/${encodeURIComponent(gameId)}/exclusions`, {
      method: 'GET',
    });
  } catch (e) {
    return { ok: false, excluded: [], version: 0, error: e?.message || 'The request did not reach the server.' };
  }

  if (!response.ok) {
    return { ok: false, excluded: [], version: 0, error: await describeFailure(response) };
  }

  try {
    return { ok: true, ...project(await response.json()), error: null };
  } catch {
    return { ok: false, excluded: [], version: 0, error: 'The disabled list could not be read.' };
  }
}

export async function postExclusionOp({
  fetchFn = authFetch, apiBase, gameId, op, questionKey, expectedVersion,
}) {
  let response;
  try {
    response = await fetchFn(`${apiBase}games/${encodeURIComponent(gameId)}/exclusions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ op, questionKey, expectedVersion }),
    });
  } catch (e) {
    return { ok: false, excluded: null, version: null, error: e?.message || 'The request did not reach the server.' };
  }

  if (!response.ok) {
    return { ok: false, excluded: null, version: null, error: await describeFailure(response) };
  }

  try {
    return { ok: true, ...project(await response.json()), error: null };
  } catch {
    // The write landed; what the list looks like now is unknown — re-read,
    // never guess, never invite a second press by calling this a failure.
    return { ok: true, excluded: null, version: null, stale: true, error: null };
  }
}
