/**
 * THE HOST'S FIVE SURVEY CALLS — close, warn, end, progress, people.
 *
 * The contract is docs/design/survey-redesign/IMPLEMENTATION-phase-2.md §2
 * ("Routes"). Every one of these routes carries the Cognito authorizer and
 * answers 404 to a caller who may not drive the session, so the host page
 * hands in `authFetch` as `fetchFn`; this file never reaches for it itself,
 * the same way utils/commentsClient.js does not, so it stays importable
 * anywhere. The phone has its own client (utils/surveyClient.js) for the four
 * PUBLIC player routes — the two must not share a file, because a phone that
 * imported this one would be one refactor away from calling a host route.
 *
 * Opening a survey is not here: it is `POST /games/{id}/start`, the same
 * route every session type starts through, and GameHostPage's startSession
 * is its one caller.
 *
 * ── NOTHING HERE THROWS ────────────────────────────────────────────────────
 *
 * Every function resolves `{ ok, status, …, error }`. A rejected promise on
 * the stage is a white screen in front of a room; the dock needs a sentence it
 * can show beside the button that was pressed.
 */

/** A human sentence for a failed response, preferring the server's own. */
async function describeFailure(response) {
  try {
    const body = await response.json();
    if (body && typeof body.error === 'string' && body.error.trim()) return body.error;
    if (body && typeof body.message === 'string' && body.message.trim()) return body.message;
  } catch {
    /* A body that will not parse tells us nothing; fall through to the status. */
  }
  if (response.status === 409) return 'The survey is not in a state that allows that.';
  if (response.status === 404) return 'This session could not be found.';
  return `That did not go through (${response.status}).`;
}

const routeFor = (apiBase, gameId, leaf) => `${apiBase}games/${encodeURIComponent(gameId)}/survey/${leaf}`;

/** One call, one shape. `pick` turns a parsed 2xx body into the fields a caller wants. */
async function call({ fetchFn = fetch, apiBase, gameId, leaf, method, pick }) {
  let response;
  try {
    response = await fetchFn(routeFor(apiBase, gameId, leaf), method === 'POST'
      ? { method: 'POST', headers: { 'Content-Type': 'application/json' } }
      : { method: 'GET' });
  } catch (e) {
    return { ok: false, status: 0, error: e?.message || 'That did not reach the server.' };
  }
  if (!response.ok) {
    return { ok: false, status: response.status, error: await describeFailure(response) };
  }
  let body = {};
  try {
    body = (await response.json()) || {};
  } catch {
    // A 2xx whose body will not parse still means the act landed. Saying
    // otherwise would invite the host to press Close a second time.
  }
  return { ok: true, status: response.status, error: null, ...pick(body) };
}

/**
 * Per-question counts in the progress shape, `[{qid, answered}]`, whichever
 * shape they arrived in. /progress sends that list; the close response is cut
 * from the aggregate, whose `PerQuestion` is a MAP of qid → `{n, …}`
 * (§2 "Aggregate"). Both are read here so the stage's rows survive the close
 * whichever the backend settles on. A map keeps its insertion order, which is
 * the aggregate's `Order`.
 */
function perQuestionRows(value) {
  if (Array.isArray(value)) return value;
  if (!value || typeof value !== 'object') return [];
  return Object.entries(value).map(([qid, v]) => ({
    qid,
    answered: Number(v && (v.answered ?? v.n)) || 0,
  }));
}

/**
 * SURVEY#OPEN → SURVEY#CLOSED. Idempotent on the server: a second close
 * returns the stored counts and broadcasts nothing. The counts, never the
 * texts — open answers stay out of every host response until phase 3.
 *
 * `closedAt` is the close's own stamp (STATE's ClosedAt, the same one the
 * `surveyClosed` frame carries). The host orders later progress frames by it,
 * so a frame sent before the close cannot overwrite the frozen counts.
 */
export function closeSurvey({ fetchFn, apiBase, gameId }) {
  return call({
    fetchFn, apiBase, gameId, leaf: 'close', method: 'POST',
    pick: (b) => ({
      n: Number(b.n) || 0,
      finished: Number(b.finished) || 0,
      perQuestion: perQuestionRows(b.perQuestion),
      closedAt: typeof b.closedAt === 'string' && b.closedAt ? b.closedAt : null,
    }),
  });
}

/** Tell every phone the survey closes in two minutes. The survey stays open. */
export function warnSurvey({ fetchFn, apiBase, gameId }) {
  return call({
    fetchFn, apiBase, gameId, leaf: 'warning', method: 'POST',
    pick: (b) => ({ warnedAt: b.warnedAt || null }),
  });
}

/** SURVEY#CLOSED → ENDED. 409 while the survey is still open — close it first. */
export function endSurvey({ fetchFn, apiBase, gameId }) {
  return call({
    fetchFn, apiBase, gameId, leaf: 'end', method: 'POST',
    pick: (b) => ({ state: b.state || 'ENDED' }),
  });
}

/**
 * Where the room is: `{gameId, started, finished, perQuestion:[{qid, answered}], at}`
 * — the same payload the `surveyProgress` broadcast carries, so a reload and a
 * frame land in the same state. Counts only; no respondent id, no name.
 */
export function fetchSurveyProgress({ fetchFn, apiBase, gameId }) {
  return call({
    fetchFn, apiBase, gameId, leaf: 'progress', method: 'GET',
    pick: (b) => ({ progress: b }),
  });
}

/**
 * Who is still going, for the host to chase — `{people:[{name, status}]}`
 * where status is 'finished' | 'partway' | 'not-started'.
 *
 * A 409 is the ANONYMOUS answer, not a fault: an Anonymous survey records no
 * names, so there are none to list. It comes back as `ok: true` with an empty
 * list — the same move `fetchFeedbackRound` makes with its 409 — so the stage
 * renders "no names" rather than an error.
 */
export async function fetchSurveyPeople({ fetchFn, apiBase, gameId }) {
  const result = await call({
    fetchFn, apiBase, gameId, leaf: 'people', method: 'GET',
    pick: (b) => ({ people: Array.isArray(b.people) ? b.people : [] }),
  });
  if (!result.ok && result.status === 409) return { ok: true, status: 409, error: null, people: [] };
  return result.ok ? result : { ...result, people: [] };
}
