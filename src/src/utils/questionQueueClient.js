/**
 * THE WIRE HALF OF THE QUEUE. No React, no arithmetic — that is
 * `config/questionQueue.js`, which is shared with the Lambda.
 *
 * Split from the arithmetic for the reason `utils/nextQuestion.js` records: the
 * thing that decides what a host is TOLD when a press fails should not live in
 * the file that no test can reach. Both functions here return a result object
 * and NEITHER EVER THROWS, so a caller mid-session never has to wrap a press in
 * a try/catch it might forget.
 *
 * ── WHY `changed: false` IS NOT AN ERROR ───────────────────────────────────
 *
 * The endpoint answers 200 with `{ changed: false, refused: '<reason>' }` when
 * a press could not do anything — `full`, `duplicate`, `at-edge`,
 * `not-queued`. That is the server being explicit rather than the server
 * failing, and this module keeps the distinction: `ok: true` with a `refused`
 * string. Collapsing the two would either put an error banner in front of a
 * host who pressed ↑ on the first row, or hide a real 403 behind a shrug.
 *
 * Of those four reasons only ONE is worth interrupting a host for. `at-edge`,
 * `duplicate` and `not-queued` all describe a button that was already at rest
 * — the row is first, the question is already queued, the row was removed by
 * the phone a second ago — and the list on screen already shows the truth.
 * `full` is different: the host asked for a 25th question and did not get it,
 * and nothing on screen says so. `REFUSALS_WORTH_SAYING` is that distinction,
 * held here rather than in the component so the phone remote and the stage
 * cannot disagree about which refusals are silent.
 */

import { authFetch } from '../auth/authFetch';
import { describeFailure } from './nextQuestion';
import { normaliseQueue } from '../config/questionQueue';

/**
 * The one refusal a host must be told about, because it is the only one whose
 * cause is invisible on the surface that produced it. See the header.
 */
export const REFUSALS_WORTH_SAYING = {
  full: 'The queue is full — 24 questions is the limit. Remove one first.',
};

/** A refusal string, as something to show, or null when it is self-evident. */
export function refusalMessage(refused) {
  return REFUSALS_WORTH_SAYING[refused] || null;
}

/**
 * The server's queue payload, reduced to what a surface renders.
 *
 * `normaliseQueue` runs on the way IN as well as on the way out of the Lambda,
 * which is not belt-and-braces: an older client's write can leave a duplicate
 * or a blank in the stored array, and the row keyed on a blank string would
 * collide with every other blank in React's reconciler.
 */
function project(payload, fallback) {
  const body = payload && typeof payload === 'object' ? payload : {};
  return {
    queue: normaliseQueue(body.queue),
    version: Number(body.version) || 0,
    // Explicitly `?? null`, never `|| null`: `changed: false` is a real answer
    // and must survive, and version 0 is the version of an empty queue.
    changed: body.changed ?? null,
    refused: body.refused ?? null,
    staleView: Boolean(body.staleView),
    ...fallback,
  };
}

/**
 * Read the running order.
 *
 * A failure returns `ok: false` AND an empty queue rather than throwing, so a
 * panel that renders `result.queue` unconditionally shows an empty list and its
 * error, instead of a blank screen from an unhandled rejection. The caller
 * decides whether to keep what it already had — `GameHostPage` does, because a
 * queue that vanishes on one flaky GET is worse than a queue that is stale.
 */
export async function fetchQueue({ fetchFn = authFetch, apiBase, gameId }) {
  let response;
  try {
    response = await fetchFn(`${apiBase}games/${encodeURIComponent(gameId)}/queue`, {
      method: 'GET',
    });
  } catch (e) {
    return { ok: false, queue: [], version: 0, error: e?.message || 'The request did not reach the server.' };
  }

  if (!response.ok) {
    return { ok: false, queue: [], version: 0, error: await describeFailure(response) };
  }

  try {
    return { ok: true, ...project(await response.json()), error: null };
  } catch {
    // A 200 whose body will not parse tells us nothing about the queue. Say so
    // rather than reporting an empty queue as fact — the caller keeps its copy.
    return { ok: false, queue: [], version: 0, error: 'The queue could not be read.' };
  }
}

/**
 * Change the running order — ONE OPERATION, never an array.
 *
 * `expectedVersion` travels with every op and is ADVISORY at the far end: the
 * server records the disagreement as `staleView` and applies the op anyway,
 * because the op is replayed against the list the server has just read. That is
 * the whole point of ops-not-arrays and it is why a host on a two-second-stale
 * phone can still reorder without stomping the stage.
 */
export async function postQueueOp({
  fetchFn = authFetch, apiBase, gameId, op, questionKey, expectedVersion,
}) {
  let response;
  try {
    response = await fetchFn(`${apiBase}games/${encodeURIComponent(gameId)}/queue`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ op, questionKey, expectedVersion }),
    });
  } catch (e) {
    return { ok: false, queue: null, version: null, error: e?.message || 'The request did not reach the server.' };
  }

  if (!response.ok) {
    return { ok: false, queue: null, version: null, error: await describeFailure(response) };
  }

  try {
    const projected = project(await response.json());
    return {
      ok: true,
      ...projected,
      message: refusalMessage(projected.refused),
      error: null,
    };
  } catch {
    /*
      A 2xx MEANS THE WRITE LANDED, and `queue: null` says "I cannot tell you
      what it looks like now" rather than "it is empty". The same call the
      round-advance path makes for the same reason: reporting a landed write as
      a failure invites a second press, and a second `add` is a duplicate while
      a second `earlier` moves the row twice.

      The WebSocket announcement repairs the view on its own; the caller re-reads
      rather than guessing.
    */
    return { ok: true, queue: null, version: null, stale: true, error: null };
  }
}
