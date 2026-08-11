/**
 * What to do — and what to SAY — when Workie's summary does not arrive.
 *
 * THE DEFECT THIS EXISTS FOR. The host flow is: fetch any existing summary →
 * if there is none, GET the `generateNew=true` trigger → then wait for the
 * `aiSummaryReady` WebSocket push to deliver the result. Every one of those
 * steps used to fail into a `console.error` and nothing else. When the trigger
 * throws, the request never reaches the API, so **no notification will ever
 * arrive** — and the stage went on showing the same benign line it shows before
 * anyone has answered ("Nothing to read back yet"). A host standing in front of
 * a room could not tell a dead summary from one still being written, forever.
 *
 * Two failures that look identical in a console are not the same event to the
 * person on stage, so they are not the same event here:
 *
 *   - the request NEVER LEFT THE BROWSER (`TypeError: Failed to fetch`, and
 *     `navigator.onLine === false`) — the server knows nothing about it, the
 *     host has lost their wifi, and the fix is in the room, not in the app; or
 *   - the SERVER ANSWERED AND SAID NO (an HTTP status) — the request arrived
 *     and was turned down, which is a different sentence and, for a 4xx, a
 *     different decision about whether retrying can possibly help.
 *
 * Nothing here touches the network or React. It classifies and it decides;
 * GameHostPage does the fetching and AISummaryStatus does the rendering.
 */

/** The browser has no connection at all. Nothing was sent. */
export const AI_FAILURE_OFFLINE = 'offline';
/** The fetch threw, but the browser believes it is online (DNS, CORS, dropped TLS). */
export const AI_FAILURE_UNREACHABLE = 'unreachable';
/** The server answered with a 4xx. Retrying the same request gets the same answer. */
export const AI_FAILURE_REJECTED = 'rejected';
/** The server answered with a 5xx (or another non-2xx we can retry). */
export const AI_FAILURE_SERVER = 'server';
/** Generation started, but no result ever came back — push lost, or never sent. */
export const AI_FAILURE_TIMEOUT = 'timeout';

/**
 * How long to wait for the `aiSummaryReady` push before going to look for the
 * summary ourselves. Generation on dev completes in ~5s; 45s is "something is
 * wrong", not "be patient".
 */
export const AI_NOTIFICATION_TIMEOUT_MS = 45000;

/**
 * A lost push does not mean a lost summary — the worker writes the item to
 * DynamoDB BEFORE it broadcasts, so the row is already there whenever the
 * broadcast is the thing that went missing (a reconnect mid-generation, a
 * connection this codebase's own stale-connection cleanup had already swept).
 * So poll before crying failure. Twice, spaced, then stop.
 */
export const AI_POLL_ATTEMPTS = 2;
export const AI_POLL_INTERVAL_MS = 5000;

/** Automatic retries of the trigger. BOUNDED — a room does not want a loop. */
export const AI_MAX_AUTO_RETRIES = 2;

/** True when the browser itself reports no connection. */
export function isOnline(nav = typeof navigator === 'undefined' ? null : navigator) {
  // An absent navigator (jsdom-less runtimes, SSR) is not evidence of being
  // offline; assume connected and let the fetch itself be the judge.
  if (!nav || typeof nav.onLine !== 'boolean') return true;
  return nav.onLine;
}

/**
 * Classify one failed attempt.
 *
 * @param {object}  input
 * @param {Error}  [input.error]   the thrown error, when the fetch never completed
 * @param {number} [input.status]  the HTTP status, when the server did answer
 * @param {boolean}[input.online]  navigator.onLine at the moment of failure
 * @param {string} [input.phase]   'trigger' (default) or 'notification'
 * @returns {{kind:string, headline:string, detail:string, autoRetryable:boolean, status:(number|null)}}
 */
export function classifyAISummaryFailure({
  error = null, status = null, online = true, phase = 'trigger',
} = {}) {
  // The trigger got through and the work may even have finished; what never
  // arrived is the answer. Retrying the trigger would only start it again, and
  // by this point we have already polled for the persisted item.
  if (phase === 'notification') {
    return {
      kind: AI_FAILURE_TIMEOUT,
      status: null,
      headline: 'Workie started, but never reported back.',
      detail: 'The summary was requested and nothing came back. '
        + 'Try again to rewrite it, or move the room on — the round still stands.',
      autoRetryable: false,
    };
  }

  // The worker told us, over the socket, that generation itself failed. The
  // request arrived, the model was reached, and the answer was "no". Retrying
  // is the host's call to make, never ours — an automatic loop here would hammer
  // a prompt that is failing for a reason.
  if (phase === 'generation') {
    return {
      kind: AI_FAILURE_SERVER,
      status: null,
      headline: 'Workie could not write the summary.',
      detail: 'Generation failed on the server. Try again, or move the room on — '
        + 'the round itself still stands.',
      autoRetryable: false,
    };
  }

  if (typeof status === 'number') {
    if (status >= 400 && status < 500) {
      return {
        kind: AI_FAILURE_REJECTED,
        status,
        headline: 'The server turned the summary down.',
        detail: `It answered HTTP ${status}, so the request did arrive — retrying it `
          + 'unchanged will get the same answer. Check the question set\'s AI prompt.',
        autoRetryable: false,
      };
    }
    return {
      kind: AI_FAILURE_SERVER,
      status,
      headline: 'The server could not start the summary.',
      detail: `It answered HTTP ${status}. This is usually temporary.`,
      autoRetryable: true,
    };
  }

  // No status: the request never completed. Whether that is the room's wifi or
  // something between here and the API is the whole distinction below.
  if (!online) {
    return {
      kind: AI_FAILURE_OFFLINE,
      status: null,
      headline: 'This device is offline.',
      detail: 'The request never left this browser, so nothing is being written. '
        + 'Reconnect and it will start again on its own.',
      autoRetryable: true,
    };
  }

  return {
    kind: AI_FAILURE_UNREACHABLE,
    status: null,
    headline: 'Could not reach the server.',
    detail: `The request did not get through${error && error.message ? ` (${error.message})` : ''}. `
      + 'Nothing was started.',
    autoRetryable: true,
  };
}

/**
 * May we start another attempt on our own?
 *
 * Never for a 4xx — the server has already given its answer and repeating the
 * question is noise. Never past the bound.
 */
export function shouldAutoRetry(failure, attempt, max = AI_MAX_AUTO_RETRIES) {
  if (!failure || !failure.autoRetryable) return false;
  return attempt < max;
}

/** Exponential, capped. 2s then 4s, so a blip is absorbed inside ~6 seconds. */
export function autoRetryDelayMs(attempt) {
  const step = 2000 * (2 ** Math.max(0, attempt));
  return Math.min(step, 15000);
}
