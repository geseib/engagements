/**
 * THE FOUR CALLS A PHONE MAKES IN A SURVEY.
 *
 * The route contract is docs/design/survey-redesign/IMPLEMENTATION-phase-2.md
 * §2 "Routes", and this file speaks it and nothing else:
 *
 *   GET  games/{id}/survey           the questions, the state, Names, the warning
 *   PUT  games/{id}/survey/answers   one answer — an idempotent overwrite of one key
 *   POST games/{id}/survey/submit    "Send": marks the row complete
 *   POST games/{id}/survey/mine      this phone's own row, for resume
 *
 * PLAYER CALLS ONLY. The host's close / warning / end / progress / people
 * calls go through `authFetch` from the host page and are not here — a phone
 * holds no Cognito identity, which is also why every call below uses plain
 * `fetch` (the same reason `utils/commentsClient.js` does).
 *
 * `mine` IS A POST, deliberately: its body carries the respondent id or the
 * clientId, a capability that must stay out of URLs and access logs (the plan's
 * deviation from PLAN.md, precedent `POST /games/get-results`).
 *
 * NOTHING HERE THROWS. Every function resolves an object with `ok`, and says
 * which of the contract's failures it met (`closed`, `notStarted`, `missing`,
 * `retry`) so the caller can act on it rather than parse a status code.
 */
import { namesMode } from '../config/surveyNames';

const enc = encodeURIComponent;
const JSON_HEADERS = { 'Content-Type': 'application/json' };

async function readJson(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

const serverSaid = (body) => (body && typeof body.error === 'string' && body.error.trim() ? body.error : null);

/**
 * What the request body says about WHO is answering, per the Names mode.
 *
 *   Anonymous     { respondentId }                     nothing about the person
 *   Who finished  { respondentId, player }             the server marks who finished,
 *                                                       and files answers under the id
 *   Named         { player }                           answers filed under the person
 *
 * `player` is `{name, clientId}`: the server checks the clientId against the one
 * stamped on `PLAYER#<name>` at join. The server derives the row key from the
 * session's Names value and never trusts one the phone sends.
 */
export function identityFor(names, { respondentId, playerName, clientId }) {
  const mode = namesMode(names).id;
  const player = { name: playerName, clientId: clientId ?? null };
  if (mode === 'named') return { player };
  if (mode === 'finished') return { respondentId, player };
  return { respondentId };
}

/** The survey: `{ok, survey}`, or `{ok:false, notStarted | notSurvey | error}`. */
export async function fetchSurvey({ fetchFn = fetch, apiBase, gameId }) {
  let response;
  try {
    response = await fetchFn(`${apiBase}games/${enc(gameId)}/survey`, { method: 'GET' });
  } catch (e) {
    return { ok: false, status: 0, error: 'The survey could not be loaded. Check your connection and try again.' };
  }
  const body = await readJson(response);
  if (response.status === 409) return { ok: false, status: 409, notStarted: true, error: null };
  if (response.status === 404) {
    return { ok: false, status: 404, notSurvey: true, error: serverSaid(body) || 'This session is not a survey.' };
  }
  if (!response.ok) {
    return { ok: false, status: response.status, error: serverSaid(body) || `The survey could not be loaded (${response.status}).` };
  }
  if (!body || !Array.isArray(body.questions)) {
    return { ok: false, status: response.status, error: 'The survey could not be read.' };
  }
  return { ok: true, status: response.status, survey: body };
}

/**
 * Save one answer. `value: null` clears it.
 *
 * `retry: true` for the failures worth trying again (no connection, 5xx, 429);
 * `closed: true` for 409 (the survey closed under the person); anything else —
 * 400 a value the server refused, 403 `NOT_YOU` — is final for that value.
 */
export async function saveAnswer({ fetchFn = fetch, apiBase, gameId, qid, value, identity }) {
  let response;
  try {
    response = await fetchFn(`${apiBase}games/${enc(gameId)}/survey/answers`, {
      method: 'PUT',
      headers: JSON_HEADERS,
      body: JSON.stringify({ qid, value, ...identity }),
    });
  } catch (e) {
    return { ok: false, retry: true, error: 'No connection.' };
  }
  const body = await readJson(response);
  if (response.ok) {
    return {
      ok: true,
      rev: body?.rev ?? null,
      answered: body?.answered ?? null,
      complete: body?.complete === true,
    };
  }
  if (response.status === 409) return { ok: false, closed: true, error: serverSaid(body) || 'The survey is closed.' };
  if (response.status === 429 || response.status >= 500) {
    return { ok: false, retry: true, error: serverSaid(body) || `The server did not save it (${response.status}).` };
  }
  const code = body?.code || (body?.error === 'NOT_YOU' ? 'NOT_YOU' : null);
  const error = code === 'NOT_YOU'
    ? 'This name is answering on another device.'
    : serverSaid(body) || 'That answer was not accepted.';
  return { ok: false, retry: false, status: response.status, code, error };
}

/** "Send my answers". `missing` lists the required qids the server still lacks (422). */
export async function submitSurvey({ fetchFn = fetch, apiBase, gameId, identity }) {
  let response;
  try {
    response = await fetchFn(`${apiBase}games/${enc(gameId)}/survey/submit`, {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ ...identity }),
    });
  } catch (e) {
    return { ok: false, error: 'That did not send. Check your connection and try again.' };
  }
  const body = await readJson(response);
  if (response.ok) return { ok: true, complete: body?.complete !== false };
  if (response.status === 409) return { ok: false, closed: true, error: serverSaid(body) || 'The survey is closed.' };
  if (response.status === 422) {
    return { ok: false, missing: Array.isArray(body?.missing) ? body.missing : [], error: serverSaid(body) };
  }
  return { ok: false, error: serverSaid(body) || `That did not send (${response.status}).` };
}

/** This phone's own row: `{answers, answered, complete, rev}`; a 404 is simply "nothing yet". */
export async function fetchMine({ fetchFn = fetch, apiBase, gameId, identity }) {
  let response;
  try {
    response = await fetchFn(`${apiBase}games/${enc(gameId)}/survey/mine`, {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ ...identity }),
    });
  } catch (e) {
    return { ok: false, answers: {}, error: 'No connection.' };
  }
  const body = await readJson(response);
  if (response.status === 404) return { ok: true, none: true, answers: {}, answered: [], complete: false, rev: null };
  if (response.status === 409) return { ok: false, closed: true, answers: {} };
  if (!response.ok) return { ok: false, answers: {}, status: response.status, error: serverSaid(body) };
  return {
    ok: true,
    answers: body && body.answers && typeof body.answers === 'object' ? body.answers : {},
    answered: Array.isArray(body?.answered) ? body.answered : [],
    complete: body?.complete === true,
    rev: body?.rev ?? null,
  };
}
