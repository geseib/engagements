/**
 * The decisions behind "Workie's summary didn't arrive".
 *
 * The reported failure was three fetches dying with ERR_INTERNET_DISCONNECTED
 * while a host stood in front of a room. Nothing reached the API, so nothing
 * would ever come back — and the code logged to a console nobody was looking at.
 * These tests pin the two judgements that make that recoverable: WHAT to say
 * (offline is not "the server said no") and WHETHER to try again (never at a
 * 4xx, never forever).
 */
import {
  classifyAISummaryFailure, shouldAutoRetry, autoRetryDelayMs, isOnline,
  AI_FAILURE_OFFLINE, AI_FAILURE_UNREACHABLE, AI_FAILURE_REJECTED,
  AI_FAILURE_SERVER, AI_FAILURE_TIMEOUT, AI_MAX_AUTO_RETRIES,
} from '../utils/aiSummaryRecovery';

describe('classifyAISummaryFailure', () => {
  // rejects: collapsing the offline case into the generic network/server copy.
  // A host who has lost wifi must be told THAT, because the fix is in the room.
  it('calls a disconnected browser offline, and says nothing was sent', () => {
    const failure = classifyAISummaryFailure({
      error: new TypeError('Failed to fetch'), online: false,
    });

    expect(failure.kind).toBe(AI_FAILURE_OFFLINE);
    expect(failure.headline).toMatch(/offline/i);
    expect(failure.detail).toMatch(/never left this browser/i);
    expect(failure.autoRetryable).toBe(true);
  });

  // rejects: treating any thrown fetch as "you are offline" when the browser
  // says it is connected — that copy would send a host hunting for wifi they
  // already have.
  it('separates a browser that is online but could not reach the server', () => {
    const failure = classifyAISummaryFailure({
      error: new TypeError('Failed to fetch'), online: true,
    });

    expect(failure.kind).toBe(AI_FAILURE_UNREACHABLE);
    expect(failure.headline).not.toMatch(/offline/i);
    expect(failure.autoRetryable).toBe(true);
  });

  // rejects: classifying an HTTP status as a network failure. The request DID
  // arrive; saying "you're offline" would be a lie about what happened.
  it('reports a 4xx as the server answering, and refuses to auto-retry it', () => {
    const failure = classifyAISummaryFailure({ status: 404, online: true });

    expect(failure.kind).toBe(AI_FAILURE_REJECTED);
    expect(failure.status).toBe(404);
    expect(failure.detail).toContain('404');
    expect(failure.autoRetryable).toBe(false);
  });

  // rejects: lumping 5xx in with 4xx and giving up on a transient outage.
  it('treats a 5xx as temporary and retryable', () => {
    const failure = classifyAISummaryFailure({ status: 503, online: true });

    expect(failure.kind).toBe(AI_FAILURE_SERVER);
    expect(failure.detail).toContain('503');
    expect(failure.autoRetryable).toBe(true);
  });

  // rejects: leaving the "trigger worked, nothing ever came back" case
  // unclassified — the lost-WebSocket-push hang, which is the same forever-wait
  // by a different route.
  it('has a verdict for a notification that never arrived', () => {
    const failure = classifyAISummaryFailure({ phase: 'notification', online: true });

    expect(failure.kind).toBe(AI_FAILURE_TIMEOUT);
    expect(failure.headline).toMatch(/never reported back/i);
    // Already polled by the time we get here; another automatic round is noise.
    expect(failure.autoRetryable).toBe(false);
  });

  // rejects: auto-retrying a generation the worker itself reported as failed.
  it('does not auto-retry a generation the server said failed', () => {
    const failure = classifyAISummaryFailure({ phase: 'generation' });

    expect(failure.autoRetryable).toBe(false);
    expect(failure.headline).toMatch(/could not write/i);
  });

  // rejects: a failure object with no words in it. The whole point is that
  // something reaches the stage; empty copy renders an empty banner.
  it('always carries a headline and a detail to put on the stage', () => {
    const cases = [
      { error: new TypeError('Failed to fetch'), online: false },
      { error: new TypeError('Failed to fetch'), online: true },
      { status: 404, online: true },
      { status: 500, online: true },
      { phase: 'notification', online: true },
      { phase: 'generation' },
    ];
    for (const input of cases) {
      const failure = classifyAISummaryFailure(input);
      expect(typeof failure.headline).toBe('string');
      expect(failure.headline.length).toBeGreaterThan(0);
      expect(typeof failure.detail).toBe('string');
      expect(failure.detail.length).toBeGreaterThan(0);
    }
  });
});

describe('shouldAutoRetry', () => {
  const retryable = classifyAISummaryFailure({ status: 500, online: true });
  const notRetryable = classifyAISummaryFailure({ status: 400, online: true });

  // rejects: retrying a 4xx, which gets the identical answer and buries the
  // real problem under noise.
  it('never retries a failure marked not-retryable, even on the first attempt', () => {
    expect(shouldAutoRetry(notRetryable, 0)).toBe(false);
  });

  // rejects: an unbounded retry loop hammering the API from a live room.
  it('stops at the bound', () => {
    expect(shouldAutoRetry(retryable, 0)).toBe(true);
    expect(shouldAutoRetry(retryable, AI_MAX_AUTO_RETRIES - 1)).toBe(true);
    expect(shouldAutoRetry(retryable, AI_MAX_AUTO_RETRIES)).toBe(false);
    expect(shouldAutoRetry(retryable, AI_MAX_AUTO_RETRIES + 5)).toBe(false);
  });

  // rejects: dereferencing a null failure when nothing has gone wrong.
  it('has nothing to retry when there is no failure', () => {
    expect(shouldAutoRetry(null, 0)).toBe(false);
  });
});

describe('autoRetryDelayMs', () => {
  // rejects: a flat delay, or a first retry that fires instantly and simply
  // repeats the same dead network call.
  it('backs off between attempts', () => {
    expect(autoRetryDelayMs(0)).toBe(2000);
    expect(autoRetryDelayMs(1)).toBe(4000);
    expect(autoRetryDelayMs(1)).toBeGreaterThan(autoRetryDelayMs(0));
  });

  // rejects: an exponent left uncapped, which reaches minutes within a handful
  // of attempts.
  it('caps the wait', () => {
    expect(autoRetryDelayMs(20)).toBe(15000);
  });
});

describe('isOnline', () => {
  // rejects: reading navigator.onLine as a plain truthiness check, which makes
  // every runtime without a navigator look offline and mislabels every failure.
  it('assumes connected when the runtime cannot say', () => {
    expect(isOnline(null)).toBe(true);
    expect(isOnline({})).toBe(true);
  });

  it('believes the browser when it does say', () => {
    expect(isOnline({ onLine: false })).toBe(false);
    expect(isOnline({ onLine: true })).toBe(true);
  });
});
