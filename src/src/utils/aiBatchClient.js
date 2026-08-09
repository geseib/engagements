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
const POLL_TIMEOUT_MS = 10 * 60 * 1000;

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

// Poll a generation job to completion.
//
// Reports incremental progress rather than only a terminal result: a run that
// takes minutes and says nothing is indistinguishable from a hung one, which is
// most of why the old failure felt so bad.
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

  while (true) {
    if (isCancelled()) throw new Error(`${label}: cancelled`);
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error(`${label}: timed out after ${Math.round(timeoutMs / 60000)} minutes. The job may still finish - reopen the builder to check.`);
    }

    await sleep(intervalMs);

    let job;
    try {
      const response = await authFetch(`${url}/${encodeURIComponent(jobId)}`, { method: 'GET' });
      if (response.status === 404) {
        throw new Error(`${label}: job ${jobId} not found or expired`);
      }
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      job = await response.json();
      consecutiveErrors = 0;
    } catch (error) {
      // A transient poll failure must not kill a job that is still running.
      consecutiveErrors += 1;
      if (consecutiveErrors >= 5) {
        throw new Error(`${label}: lost contact with the job (${error.message})`);
      }
      onStatus(`⏳ ${label}: reconnecting...`);
      continue;
    }

    onProgress(job);
    if (job.phase) onStatus(job.phase);

    if (job.status === 'complete') return job;
    if (job.status === 'error') {
      const err = new Error(job.error || `${label} failed`);
      err.partialItems = job.items || [];
      throw err;
    }
  }
};
