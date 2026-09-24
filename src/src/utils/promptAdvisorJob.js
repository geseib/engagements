/**
 * Start a prompt-advisor job and wait for it — no React.
 *
 * WHY. The advisor used to POST and wait for the analysis in the same request.
 * A Sonnet analysis takes 35-60 seconds and the API's gateway gives up at 30,
 * so every run came back as a gateway 503 — and the dialog said "Failed to
 * analyze prompt" without reading the status or the body. The server now
 * answers 202 with a job id (lambda-functions/admin/ai-prompt-advisor.js) and
 * the analysis is read from `GET admin/ai-prompt-advisor/{jobId}`.
 *
 * The polling loop is the builders' own `pollGenerationJob`: it polls once at
 * once and then on an interval, treats a 404 as "gone" rather than a transient
 * fault, and resolves on BOTH terminal states. Only the start and the reading
 * of the answer are the advisor's.
 *
 * THE POLL WIRE, exactly: `{ jobId, status, phase, error, result, createdAt,
 * updatedAt }`, `status` ∈ queued | running | complete | error, and `result`
 * is `{ analysisType, promptId, gameType, analysis, metadata }` when complete.
 */
import { authFetch } from '../auth/authFetch';
import { pollGenerationJob } from './aiBatchClient';

/** Every few seconds: an analysis takes a minute or two, so faster buys nothing. */
export const ADVISOR_POLL_INTERVAL_MS = 3000;

/**
 * EIGHT MINUTES, and the reason for the number. The worker's reply budget is
 * 16,000 tokens (ai-prompt-advisor.js, MAX_TOKENS); at the ~45 tokens/s this
 * account measures from Sonnet, a reply that used all of it would take about
 * six minutes. A real run takes one to two. Past eight something is wrong, and
 * the person is told so rather than left watching a spinner. The job itself
 * may still finish; nothing is lost but the wait, because nothing is written.
 */
export const ADVISOR_GIVE_UP_MS = 8 * 60 * 1000;

/** A message as a sentence, so it can sit between two others. */
export function asSentence(message) {
  const text = String(message ?? '').trim();
  if (!text) return '';
  return /[.!?]$/.test(text) ? text : `${text}.`;
}

/** A start that failed, as a sentence. The server's own words win when it sent any. */
export function describeAdviceStartFailure(status, serverMessage) {
  const said = typeof serverMessage === 'string' ? serverMessage.trim().replace(/\.$/, '') : '';
  if (status === 401) {
    return 'Your session has expired (HTTP 401). Sign in again and retry.';
  }
  if (said) return `${said} (HTTP ${status}).`;
  if (status === 403) return 'Your account is not permitted to use the prompt advisor (HTTP 403).';
  if (status === 503 || status === 504) {
    return `The server did not answer in time (HTTP ${status}). Try again in a minute.`;
  }
  return `The request failed (HTTP ${status}).`;
}

/** POST the analysis request. Resolves `{ jobId, status, analysisType }`; throws a readable Error. */
export async function startPromptAdvice(url, payload) {
  const response = await authFetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  // A gateway page is not JSON; its status must survive the failed parse.
  let body = null;
  try { body = await response.json(); } catch { body = null; }

  if (!response.ok) {
    throw new Error(describeAdviceStartFailure(response.status, body && (body.error || body.message)));
  }
  if (!body || !body.jobId) {
    throw new Error('The server accepted the request but returned no job to follow.');
  }
  return body;
}

/** What the dialog says while the job runs. */
export function describeAdviceProgress(job, elapsedMs) {
  const seconds = Math.max(0, Math.round((Number(elapsedMs) || 0) / 1000));
  const phase = (job && job.status === 'queued') || !job?.phase
    ? 'Waiting to start'
    : job.phase;
  return `${phase} — ${seconds}s so far. An analysis usually takes one to two minutes; keep this window open…`;
}

/**
 * Wait for the job to finish. Resolves with the job's `result`; throws an
 * Error whose message is the one to show — the server's own when the job
 * failed, and a true sentence for the ways waiting itself can end.
 */
export async function waitForPromptAdvice(url, jobId, {
  intervalMs = ADVISOR_POLL_INTERVAL_MS,
  giveUpMs = ADVISOR_GIVE_UP_MS,
  onProgress = () => {},
  isCancelled = () => false,
} = {}) {
  let job;
  try {
    job = await pollGenerationJob(url, jobId, {
      label: 'Prompt advisor',
      intervalMs,
      timeoutMs: giveUpMs,
      onProgress,
      isCancelled,
    });
  } catch (error) {
    if (error && error.timedOut) {
      const minutes = Math.max(1, Math.round(giveUpMs / 60000));
      throw new Error(`The analysis had not finished after ${minutes} minute${minutes === 1 ? '' : 's'}, `
        + 'so this window stopped waiting. Nothing was changed. Run it again; if it keeps happening, '
        + 'the AI service may be slow right now.');
    }
    if (error && error.jobMissing) {
      throw new Error('The analysis could no longer be found — it may have expired. Run it again.');
    }
    throw error;
  }

  if (job.status === 'error') {
    throw new Error(job.error || 'The analysis failed without saying why.');
  }
  if (!job.result || !job.result.analysis) {
    throw new Error('The analysis finished but came back empty. Run it again.');
  }
  return job.result;
}
