// Shared client helpers for AI generation endpoints.
//
// API Gateway HTTP APIs enforce a hard ~30s integration timeout, so large
// generations must be split into small batches that each finish well under
// 30s. These helpers run those batches in parallel (with a concurrency cap
// to respect Bedrock rate limits) and turn HTTP failures into actionable
// error messages instead of "Unknown error".

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

// Run an array of async task functions with a concurrency cap.
// Results are returned in task order. The first task failure rejects.
export const runWithConcurrency = async (taskFns, limit = 3) => {
  const results = new Array(taskFns.length);
  let nextIndex = 0;

  const worker = async () => {
    while (nextIndex < taskFns.length) {
      const i = nextIndex++;
      results[i] = await taskFns[i]();
    }
  };

  const workerCount = Math.max(1, Math.min(limit, taskFns.length));
  await Promise.all(Array.from({ length: workerCount }, worker));
  return results;
};
