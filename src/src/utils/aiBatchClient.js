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

// Phase 1 of two-phase generation: ask the generation endpoint to plan a
// list of distinct topics BEFORE fanning out parallel batches. Each batch is
// then anchored to its assigned topics (via assignedTopics/otherTopics in the
// batch payload), which prevents parallel batches from producing duplicate or
// near-identical items. Returns the topic list, or null on any failure so the
// caller can fall back to the older per-batch angle hints instead of failing
// the whole generation.
export const planGenerationTopics = async (url, payload, expectedCount, options = {}) => {
  const { label = 'Topic planning', onStatus = () => {} } = options;
  try {
    onStatus(`🧭 Planning ${expectedCount} distinct topics...`);
    const result = await postGenerationBatch(
      url,
      { ...payload, planTopics: true, count: expectedCount },
      { label, onStatus, maxRetries: 1 }
    );
    const topics = (Array.isArray(result?.topics) ? result.topics : [])
      .map((t) => String(t).trim())
      .filter(Boolean);
    if (topics.length < expectedCount) {
      console.warn(`⚠️ ${label}: expected ${expectedCount} topics but got ${topics.length} - falling back to angle hints`);
      return null;
    }
    return topics.slice(0, expectedCount);
  } catch (error) {
    console.warn(`⚠️ ${label} failed (${error.message}) - falling back to angle hints`);
    return null;
  }
};

// Safety net after merging parallel batch results: drop items whose titles
// are near-duplicates of an earlier item (same normalized token set, or very
// high token overlap for longer titles). Topic anchoring is the primary
// duplicate-prevention mechanism; this just catches strays.
const titleTokens = (title) =>
  String(title || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);

export const dropNearDuplicates = (items, getTitle = (item) => item?.title) => {
  const kept = [];
  const keptTokenSets = [];

  for (const item of items) {
    const tokens = titleTokens(getTitle(item));
    const tokenSet = new Set(tokens);
    const isDuplicate = tokens.length > 0 && keptTokenSets.some((prevSet) => {
      const overlap = tokens.filter((t) => prevSet.has(t)).length;
      const sameSet = overlap === tokenSet.size && overlap === prevSet.size;
      const highOverlap = Math.min(tokenSet.size, prevSet.size) >= 4 &&
        overlap / Math.min(tokenSet.size, prevSet.size) >= 0.8;
      return sameSet || highOverlap;
    });

    if (isDuplicate) {
      console.warn(`⚠️ Dropping near-duplicate generated item: "${getTitle(item)}"`);
    } else {
      kept.push(item);
      keptTokenSets.push(tokenSet);
    }
  }
  return kept;
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
