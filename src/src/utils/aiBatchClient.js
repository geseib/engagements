// Shared client helpers for AI generation endpoints.
//
// Generation does NOT run inside the HTTP request. API Gateway's ~30s
// integration timeout is a hard ceiling and a full set takes minutes, so every
// builder POSTs to start a job, gets a 202 + jobId back, and polls. These
// helpers own the POST retry policy and the polling loop.

import { authFetch } from '../auth/authFetch';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Turn an HTTP failure into a message the admin can act on.
export const describeHttpError = (status, lambdaError, label) => {
  if (status === 401 || status === 403) {
    return `${label}: not authorized (HTTP ${status}). Your session may have expired - please sign in again and retry.`;
  }
  if (status === 429) {
    return `${label}: rate limited by the AI service (HTTP 429). Wait a minute and retry.`;
  }
  if (status === 503 || status === 504) {
    return `${label}: the request timed out at the API gateway (HTTP ${status}). Retry, or reduce the batch size.`;
  }
  if (status >= 500) {
    return `${label}: server error (HTTP ${status})${lambdaError ? ` - ${lambdaError}` : ''}. Please retry.`;
  }
  return `${label}: ${lambdaError || `request failed (HTTP ${status})`}`;
};

// POST a single generation batch with automatic retry on transient failures
// (network errors, 5xx, 429). 401/403 fail immediately since retrying an
// expired session is pointless. Returns the parsed JSON body on success.
export const postGenerationBatch = async (url, payload, options = {}) => {
  const { label = 'Batch 1', onStatus = () => {}, maxRetries = 2 } = options;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    let response;
    try {
      response = await authFetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
    } catch (networkError) {
      if (attempt < maxRetries) {
        const delay = 2000 * (attempt + 1);
        onStatus(`⏳ ${label}: network error, retrying in ${Math.round(delay / 1000)}s (attempt ${attempt + 1}/${maxRetries})...`);
        await sleep(delay);
        continue;
      }
      throw new Error(`${label}: network error - ${networkError.message}. Check your connection and retry.`);
    }

    // Gateway timeouts (503/504) often return non-JSON bodies - don't let
    // JSON parsing mask the real HTTP status.
    let result = null;
    try {
      result = await response.json();
    } catch (parseError) {
      result = null;
    }

    if (response.ok && result) {
      return result;
    }

    const status = response.status;
    const lambdaError = result?.error;

    if (status === 401 || status === 403) {
      throw new Error(describeHttpError(status, lambdaError, label));
    }

    const retryable = status === 429 || status >= 500;
    if (retryable && attempt < maxRetries) {
      // Rate limits need a long cool-down (Bedrock has per-minute quotas);
      // other 5xx/timeouts just need a short backoff before retrying.
      const delay = status === 429
        ? 30000 + attempt * 15000 + Math.random() * 5000
        : 3000 * (attempt + 1);
      onStatus(`⏳ ${label}: HTTP ${status}${lambdaError ? ` (${lambdaError})` : ''} - retrying in ${Math.round(delay / 1000)}s (attempt ${attempt + 1}/${maxRetries})...`);
      await sleep(delay);
      continue;
    }

    throw new Error(describeHttpError(status, lambdaError, label));
  }
};

// --- Asynchronous generation jobs -----------------------------------------
//
// Scenario generation no longer runs inside the HTTP request. It could not:
// API Gateway's 30s integration timeout is a hard ceiling and a single detailed
// scenario measured 33-40s in CloudWatch, so the gateway returned its own 503
// while the Lambda was still working. That is the "HTTP 503" the batching code
// above was built to retry around — retries never had a chance, because every
// attempt was equally too slow.
//
// The endpoint now returns 202 + a jobId and a self-invoked worker does the
// work. Results come back by polling: the admin builders have no gameId, so the
// WebSocket channel get-ai-summary uses (broadcastToGame) is not available here.

const POLL_INTERVAL_MS = 2000;

// PAST THE WORKER'S CEILING, DELIBERATELY. The generation Lambdas are
// configured `Timeout: 900` (template-clean.yaml — every AdminAIGenerate*
// function), i.e. fifteen minutes, and the worker itself only stops early when
// `getRemainingTimeInMillis()` says it must. This used to be ten minutes, so
// the watcher gave up on a job that was still legitimately working and told the
// operator it had "timed out" — and then advised them to "reopen the builder to
// check", which nothing made possible until the jobId was persisted.
//
// Sixteen minutes: the 900s ceiling plus room for the terminal write. If the
// Lambda timeout in the template ever changes, this has to move with it.
const POLL_TIMEOUT_MS = 16 * 60 * 1000;

// Kick off a generation job. Returns { jobId, requested }.
export const startGenerationJob = async (url, payload, options = {}) => {
  const { label = 'Generation', onStatus = () => {} } = options;
  onStatus('Starting generation...');
  const result = await postGenerationBatch(url, payload, { label, onStatus });
  if (!result?.jobId) {
    throw new Error(`${label}: server did not return a job id`);
  }
  return result;
};

// Poll a generation job to a TERMINAL STATE — which includes failure.
//
// Reports incremental progress rather than only a terminal result: a run that
// takes minutes and says nothing is indistinguishable from a hung one, which is
// most of why the old failure felt so bad.
//
// THE CONTRACT, and the whole point of G1:
//
//   RESOLVES with the job for `status === 'complete'` AND `status === 'error'`.
//     A failed job is a real answer. `failJob` writes `items` and `completed`
//     alongside `status:'error'` in ONE UpdateCommand, so a job that died after
//     41 of 100 carries those 41 — plus `requested`, `warnings`, `phase` and
//     `meta`. This used to throw, and an Error can carry only what someone
//     remembers to hang on it: `err.partialItems` was set, and every other
//     field on the wire was dropped on the floor. Callers then branched on
//     `items.length > 0`, which is true for a partial failure, and drew the
//     success UI over it.
//
//   THROWS only for TRANSPORT failures, where there is genuinely no job to
//     show: the timeout, five consecutive poll errors, and a 404. Callers
//     distinguish the 404 by `error.jobMissing` — see resumeIsGone() in
//     utils/generationJob.js — because a stored id outliving the job row's
//     3-day TTL is ordinary, not an error worth alarming anyone with.
//
// Read the resolved job with `interpretGenerationJob()`. Do not re-derive the
// outcome from `items.length`.
export const pollGenerationJob = async (url, jobId, options = {}) => {
  const {
    label = 'Generation',
    onStatus = () => {},
    onProgress = () => {},
    intervalMs = POLL_INTERVAL_MS,
    timeoutMs = POLL_TIMEOUT_MS,
    isCancelled = () => false,
  } = options;

  const startedAt = Date.now();
  let consecutiveErrors = 0;
  // The FIRST poll happens immediately, before any sleep. `createJob` awaits its
  // Put before the endpoint returns 202, so the row always exists by the time we
  // ask — and on the resume path (a jobId recovered from localStorage) the
  // operator should not stare at a spinner for two seconds to be told the job
  // finished eight minutes ago, or that it is gone.
  let first = true;

  while (true) {
    if (isCancelled()) throw new Error(`${label}: cancelled`);
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error(`${label}: timed out after ${Math.round(timeoutMs / 60000)} minutes. The job may still finish - reopen the builder to check.`);
    }

    if (first) first = false;
    else await sleep(intervalMs);

    let job;
    try {
      const response = await authFetch(`${url}/${encodeURIComponent(jobId)}`, { method: 'GET' });
      if (response.status === 404) {
        // NOT a transient failure, and it must not be swallowed by the
        // reconnect counter below (it used to be: the throw was inside this
        // try, so a 404 retried five times and then reported "lost contact").
        // The job row carries a 3-day TTL stamped only at creation, so a 404 is
        // the ordinary end of a stored id, and the caller has to be able to
        // tell it apart from a network fault.
        const gone = new Error(`${label}: job ${jobId} not found or expired`);
        gone.jobMissing = true;
        gone.partialItems = [];
        throw gone;
      }
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      job = await response.json();
      consecutiveErrors = 0;
    } catch (error) {
      if (error.jobMissing) throw error;
      // A transient poll failure must not kill a job that is still running.
      consecutiveErrors += 1;
      if (consecutiveErrors >= 5) {
        const lost = new Error(`${label}: lost contact with the job (${error.message})`);
        lost.partialItems = [];
        throw lost;
      }
      onStatus(`⏳ ${label}: reconnecting...`);
      continue;
    }

    onProgress(job);
    if (job.phase) onStatus(job.phase);

    // Both terminal states RESOLVE. See the contract above: a failed job is an
    // answer, and throwing it away is what made a partial failure look like a
    // success. Do not "restore" the throw.
    if (job.status === 'complete' || job.status === 'error') return job;
  }
};
