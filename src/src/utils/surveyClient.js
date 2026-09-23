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
 * `nothingAnswered`, `retry`) so the caller can act on it rather than parse a
 * status code.
 *
 * THE CODE DECIDES, NOT THE STATUS. Every refusal is `{error, code}`
 * (lambda-functions/game/survey-answers.js). A 409 used to be read as "the
 * survey closed", and it is not only that: the server's optimistic lock gives
 * up after three lost races and answers `CONFLICT` — "try again" — which put
 * the closed screen in front of a person whose survey was still open. So:
 *
 *   SURVEY_CLOSED              closed; stop saving (409)
 *   NOT_OPEN                   not open yet; keep the answer and try again (409)
 *   CONFLICT, BUSY             try again with a back-off (409 then, 503 now)
 *   any 5xx, 429, no network   try again with a back-off
 *
 * A 409 carrying no code this file knows is retried rather than read as
 * closed: a phone that keeps trying is still told of a real close by the
 * `surveyClosed` frame and `/state`, while a phone wrongly shown "closed"
 * stops saving answers that would have counted.
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

const codeOf = (body) => (body && typeof body.code === 'string' ? body.code : null);

/** Was this refusal the survey having closed? The code says so; nothing else does. */
const saysClosed = (body) => codeOf(body) === 'SURVEY_CLOSED';

/** Is this a failure worth sending again, the same value, after a pause? */
const worthRetrying = (status) => status === 0 || status === 409 || status === 429 || status >= 500;

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
  if (response.status === 409) {
    // GET answers 409 only before the survey opens (NOT_OPEN); a closed one is
    // a 200 with its state. A SURVEY_CLOSED here is still honoured as closed.
    if (saysClosed(body)) return { ok: false, status: 409, closed: true, error: null };
    return { ok: false, status: 409, notStarted: true, error: null };
  }
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
 * `closed: true` only for `SURVEY_CLOSED`. `retry: true` for everything worth
 * trying again — no connection, 5xx (503 `BUSY` / `CONFLICT` among them), 429,
 * and a 409 that is not a close (`CONFLICT` from the first backend, `NOT_OPEN`
 * with `notOpen: true`). Anything else — 400 a value the server refused, 403
 * `NOT_YOU` — is final for that value.
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
  if (saysClosed(body)) return { ok: false, closed: true, code: 'SURVEY_CLOSED', error: serverSaid(body) || 'The survey is closed.' };
  if (worthRetrying(response.status)) {
    return {
      ok: false,
      retry: true,
      status: response.status,
      code: codeOf(body),
      notOpen: codeOf(body) === 'NOT_OPEN',
      error: serverSaid(body) || `The server did not save it (${response.status}).`,
    };
  }
  const code = body?.code || (body?.error === 'NOT_YOU' ? 'NOT_YOU' : null);
  const error = code === 'NOT_YOU'
    ? 'This name is answering on another device.'
    : serverSaid(body) || 'That answer was not accepted.';
  return { ok: false, retry: false, status: response.status, code, error };
}

/**
 * "Send my answers". Sending twice is harmless — the server answers a row
 * already complete with 200 — so a `retry: true` failure (as `saveAnswer`'s)
 * may simply be sent again.
 *
 * 422 comes in two kinds: `MISSING` lists the required qids the server still
 * lacks; `NOTHING_ANSWERED` (with `nothingAnswered: true`) is a Send with no
 * answer at all, and `missing` then lists whatever is required, possibly none.
 */
export async function submitSurvey({ fetchFn = fetch, apiBase, gameId, identity }) {
  let response;
  try {
    response = await fetchFn(`${apiBase}games/${enc(gameId)}/survey/submit`, {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ ...identity }),
    });
  } catch (e) {
    return { ok: false, retry: true, status: 0, error: 'That did not send. Check your connection and try again.' };
  }
  const body = await readJson(response);
  if (response.ok) return { ok: true, complete: body?.complete !== false };
  if (saysClosed(body)) return { ok: false, closed: true, code: 'SURVEY_CLOSED', error: serverSaid(body) || 'The survey is closed.' };
  if (response.status === 422) {
    return {
      ok: false,
      code: codeOf(body),
      nothingAnswered: codeOf(body) === 'NOTHING_ANSWERED',
      missing: Array.isArray(body?.missing) ? body.missing : [],
      error: serverSaid(body),
    };
  }
  if (worthRetrying(response.status)) {
    return {
      ok: false,
      retry: true,
      status: response.status,
      code: codeOf(body),
      notOpen: codeOf(body) === 'NOT_OPEN',
      error: serverSaid(body) || `That did not send (${response.status}).`,
    };
  }
  return { ok: false, status: response.status, code: codeOf(body), error: serverSaid(body) || `That did not send (${response.status}).` };
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
  if (saysClosed(body)) return { ok: false, closed: true, answers: {} };
  if (response.status === 409) return { ok: false, notOpen: codeOf(body) === 'NOT_OPEN', answers: {}, status: 409, error: serverSaid(body) };
  if (!response.ok) return { ok: false, answers: {}, status: response.status, error: serverSaid(body) };
  return {
    ok: true,
    answers: body && body.answers && typeof body.answers === 'object' ? body.answers : {},
    answered: Array.isArray(body?.answered) ? body.answered : [],
    complete: body?.complete === true,
    rev: body?.rev ?? null,
  };
}
