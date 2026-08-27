/**
 * THE THREE CALLS A FEEDBACK ROUND MAKES.
 *
 * An injectable client rather than bare `fetch` at each call site, following
 * `utils/questionQueueClient.js`: the same three calls are made from the
 * participant's page and (for the read half) from the host's, and a helper is
 * the difference between one description of a failure and three.
 *
 * `fetchFn` defaults to the global `fetch` and NOT to `authFetch`, which is the
 * decision worth stating: all three routes are PUBLIC, because a participant
 * holds no Cognito identity — the same reason `POST /games/{id}/votes` is
 * public. What is closed is OPENING a feedback round, which goes through
 * `POST /stage-beat` and its Cognito authorizer, from the host's page, with
 * `authFetch`. Reaching for `authFetch` here would 401 every phone in the room.
 *
 * ── NOTHING HERE THROWS ────────────────────────────────────────────────────
 *
 * Every function resolves `{ok, …, error}`. A rejected promise on the
 * participant's surface is a blank screen mid-session, and the one function
 * that matters most — `postComment` — is holding prose that exists nowhere
 * else. Its caller must be able to keep the words and show the reason, which it
 * cannot do from inside a `catch` it did not write.
 */

/** A human sentence for a failed response, preferring the server's own. */
async function describeFailure(response) {
  try {
    const body = await response.json();
    if (body && typeof body.error === 'string' && body.error.trim()) return body.error;
  } catch {
    /* A body that will not parse tells us nothing; fall through to the status. */
  }
  if (response.status === 409) return 'The host has closed this round.';
  if (response.status === 404) return 'This session could not be found.';
  return `That did not send (${response.status}).`;
}

/**
 * Post one comment.
 *
 * The anchor is passed straight through from the section that was clicked and
 * is never re-derived here: on a round with tied scores two rows print the same
 * rank, so a position recomputed at send time can attach a comment to the wrong
 * response.
 */
export async function postComment({
  fetchFn = fetch, apiBase, gameId,
  questionNumber, playerName,
  anchorKind, anchorRef, anchorLabel, anchorExcerpt, text,
}) {
  let response;
  try {
    response = await fetchFn(`${apiBase}games/${encodeURIComponent(gameId)}/comments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        questionNumber, playerName,
        anchorKind, anchorRef, anchorLabel, anchorExcerpt, text,
      }),
    });
  } catch (e) {
    return { ok: false, error: e?.message || 'The comment did not reach the server.' };
  }

  if (!response.ok) return { ok: false, error: await describeFailure(response) };

  try {
    const body = await response.json();
    return { ok: true, comment: body.comment || null, error: null };
  } catch {
    // A 201 whose body will not parse still means the comment landed. Saying
    // otherwise would invite the participant to post it twice.
    return { ok: true, comment: null, error: null };
  }
}

/**
 * The one round the host has opened for feedback, with its comments.
 *
 * A 409 is NOT an error here — it is the ordinary state of a session that is
 * not in a feedback round, which is most of the time. It comes back as
 * `ok: true` with `round: null` so a caller can render "not open" without
 * treating the common case as a failure. `loadRounds` in `GameHostPage` handles
 * a 404 the same way and for the same reason.
 */
export async function fetchFeedbackRound({ fetchFn = fetch, apiBase, gameId }) {
  let response;
  try {
    response = await fetchFn(
      `${apiBase}games/${encodeURIComponent(gameId)}/feedback-round`,
      { method: 'GET' },
    );
  } catch (e) {
    return { ok: false, round: null, error: e?.message || 'The request did not reach the server.' };
  }

  if (response.status === 409) {
    return { ok: true, round: null, questionNumber: null, notOpen: true, error: null };
  }
  if (!response.ok) {
    return { ok: false, round: null, error: await describeFailure(response) };
  }

  try {
    const body = await response.json();
    return {
      ok: true,
      round: body.round || null,
      questionNumber: body.questionNumber || null,
      notOpen: false,
      error: null,
    };
  } catch {
    return { ok: false, round: null, error: 'The round could not be read.' };
  }
}

/**
 * Every comment on one round.
 *
 * Separate from `fetchFeedbackRound` because it is what a `commentPosted` frame
 * triggers, and re-fetching the whole round to pick up one new comment would
 * make a busy room re-read its own report forty times a minute.
 */
export async function fetchComments({ fetchFn = fetch, apiBase, gameId, questionNumber }) {
  const query = questionNumber
    ? `?questionNumber=${encodeURIComponent(questionNumber)}`
    : '';
  let response;
  try {
    response = await fetchFn(
      `${apiBase}games/${encodeURIComponent(gameId)}/comments${query}`,
      { method: 'GET' },
    );
  } catch (e) {
    return { ok: false, comments: [], error: e?.message || 'The request did not reach the server.' };
  }

  if (!response.ok) return { ok: false, comments: [], error: await describeFailure(response) };

  try {
    const body = await response.json();
    return { ok: true, comments: Array.isArray(body.comments) ? body.comments : [], error: null };
  } catch {
    // Report the failure rather than an empty list: the caller keeps what it
    // already had, and a room's comments vanishing on one flaky GET is worse
    // than comments that are a few seconds stale.
    return { ok: false, comments: [], error: 'The comments could not be read.' };
  }
}
