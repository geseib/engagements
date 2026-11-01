/**
 * THE PARTICIPANT'S WAIT FOR A NAME (experience plan §4.4 steps 2–7;
 * owner's timing, 1 Nov 2026: "Ask again after 1 minute, the request lapses
 * after 10, a grant stays open 5").
 *
 * useHandoverFlow owns the checked ask, the quiet retry of the join, Ask
 * again, the lapse and Not now. Driven here on fake timers with stub `ask` and
 * `claim`, so every timing is asserted at its edge rather than waited for.
 *
 * What each test rejects is in its `// rejects:` line.
 */
import { renderHook, act } from '@testing-library/react';
import useHandoverFlow from '../hooks/useHandoverFlow';
import { HANDOVER_TIMING, handoverWaitView, timingFromReply, formatAgo } from '../config/handoverWait';

const T = HANDOVER_TIMING;
const notYet = { ok: false, failure: { kind: 'name-taken', playerName: 'Sam', message: 'taken' } };
const notNow = { ok: false, failure: { kind: 'name-taken', playerName: 'Sam', message: 'no', handoverRefused: true } };
const granted = { ok: true, data: { success: true, isReconnection: true } };

function setup({ askReply = { ok: true, askAgainAfterSeconds: 60, lapseSeconds: 600 }, claims = [] } = {}) {
  const queue = [...claims];
  const ask = jest.fn(async () => (typeof askReply === 'function' ? askReply() : askReply));
  const claim = jest.fn(async () => (queue.length ? queue.shift() : notYet));
  const onIn = jest.fn();
  const onStop = jest.fn();
  const hook = renderHook(() => useHandoverFlow({ ask, claim, onIn, onStop }));
  return { ask, claim, onIn, onStop, hook, current: () => hook.result.current };
}

/** Advance the fake clock and let every promise the timers started settle. */
async function advance(ms) {
  await act(async () => {
    jest.advanceTimersByTime(ms);
  });
  await act(async () => { await Promise.resolve(); });
}

async function askNow(h) {
  await act(async () => { await h.current().requestHandover(); });
}

beforeEach(() => { jest.useFakeTimers(); });
afterEach(() => { jest.useRealTimers(); });

describe('the ask is checked', () => {
  // rejects: "Asked the host" over an ask that never arrived.
  test('a failed ask is askFailed, with the server\'s sentence, and nothing is retried', async () => {
    const h = setup({ askReply: { ok: false, message: 'The host could not be asked just now.' } });
    await askNow(h);
    expect(h.current().stage).toBe('askFailed');
    expect(h.current().error).toBe('The host could not be asked just now.');
    expect(h.current().canAskAgain).toBe(true);
    await advance(T.retryEveryMs * 3);
    expect(h.claim).not.toHaveBeenCalled();
  });

  test('an ask that throws (no network) is askFailed too', async () => {
    const h = setup({ askReply: () => { throw new Error('offline'); } });
    await askNow(h);
    expect(h.current().stage).toBe('askFailed');
    expect(h.current().error).toMatch(/did not reach the host/);
  });

  test('Try again after a failure asks again and can succeed', async () => {
    let first = true;
    const h = setup({ askReply: () => { const r = first ? { ok: false } : { ok: true }; first = false; return r; } });
    await askNow(h);
    expect(h.current().stage).toBe('askFailed');
    await askNow(h);
    expect(h.current().stage).toBe('waiting');
    expect(h.ask).toHaveBeenCalledTimes(2);
  });
});

describe('waiting: the quiet retry', () => {
  // rejects: a wait that never lands the phone in the session by itself.
  test('the join is retried every few seconds, and a grant lands the phone in', async () => {
    const h = setup({ claims: [notYet, notYet, granted] });
    await askNow(h);
    expect(h.current().stage).toBe('waiting');
    expect(h.claim).not.toHaveBeenCalled();
    await advance(T.retryEveryMs);
    expect(h.claim).toHaveBeenCalledTimes(1);
    await advance(T.retryEveryMs);
    expect(h.claim).toHaveBeenCalledTimes(2);
    await advance(T.retryEveryMs);
    expect(h.claim).toHaveBeenCalledTimes(3);
    expect(h.current().stage).toBe('granted');
    expect(h.onIn).not.toHaveBeenCalled();
    await advance(T.grantedHoldMs);
    expect(h.onIn).toHaveBeenCalledWith(granted.data);
  });

  // rejects: a retry loop that keeps joining after it is in.
  test('the retry stops on a grant', async () => {
    const h = setup({ claims: [granted] });
    await askNow(h);
    await advance(T.retryEveryMs);
    await advance(T.retryEveryMs * 5);
    expect(h.claim).toHaveBeenCalledTimes(1);
  });

  // rejects: retrying after the host said no.
  test('Not now stops the retry, shows declined, and Ask again waits thirty seconds', async () => {
    const h = setup({ claims: [notNow] });
    await askNow(h);
    await advance(T.retryEveryMs);
    expect(h.current().stage).toBe('declined');
    await advance(T.retryEveryMs * 5);
    expect(h.claim).toHaveBeenCalledTimes(1);
    expect(h.current().canAskAgain).toBe(false);
    await advance(T.askAgainAfterDeclineMs);
    expect(h.current().canAskAgain).toBe(true);
    await askNow(h);
    expect(h.current().stage).toBe('waiting');
  });

  // rejects: a phone that gives up on a network blip.
  test('a network failure or a 5xx keeps waiting', async () => {
    const h = setup({ claims: [{ ok: false, failure: { kind: 'network' } }, { ok: false, failure: { kind: 'error' } }, granted] });
    await askNow(h);
    await advance(T.retryEveryMs);
    await advance(T.retryEveryMs);
    expect(h.current().stage).toBe('waiting');
    await advance(T.retryEveryMs);
    expect(h.current().stage).toBe('granted');
  });

  // rejects: retrying into a session that has gone.
  test('a refusal of another kind stops and hands it to the page', async () => {
    const gone = { ok: false, failure: { kind: 'not-found', message: 'No session' } };
    const h = setup({ claims: [gone] });
    await askNow(h);
    await advance(T.retryEveryMs);
    expect(h.onStop).toHaveBeenCalledWith(gone.failure);
    expect(h.current().stage).toBe('idle');
    await advance(T.retryEveryMs * 3);
    expect(h.claim).toHaveBeenCalledTimes(1);
  });

  // rejects: picking another name leaving a loop joining in the background.
  test('reset (pick another name) stops the retry', async () => {
    const h = setup();
    await askNow(h);
    await advance(T.retryEveryMs);
    act(() => h.current().reset());
    expect(h.current().stage).toBe('idle');
    await advance(T.retryEveryMs * 5);
    expect(h.claim).toHaveBeenCalledTimes(1);
  });
});

describe('the clock: Ask again after a minute, lapse after ten', () => {
  // rejects: Ask again shown at once (pestering) or never (stuck).
  test('Ask again appears after one minute of waiting, not before', async () => {
    const h = setup();
    await askNow(h);
    await advance(T.askAgainAfterMs - 1000);
    expect(h.current().canAskAgain).toBe(false);
    expect(formatAgo(h.current().agoMs)).toBe('0:59');
    await advance(1000);
    expect(h.current().canAskAgain).toBe(true);
    expect(h.current().stage).toBe('waiting');
  });

  test('Ask again re-sends the ask and starts the clock over', async () => {
    const h = setup();
    await askNow(h);
    await advance(T.askAgainAfterMs);
    await askNow(h);
    expect(h.ask).toHaveBeenCalledTimes(2);
    expect(h.current().agoMs).toBe(0);
    expect(h.current().canAskAgain).toBe(false);
  });

  // rejects: a wait that outlives the host's item, or one that ends early.
  test('after ten minutes the ask lapses and the retry stops', async () => {
    const h = setup();
    await askNow(h);
    await advance(T.lapseAfterMs - 1000);
    expect(h.current().stage).toBe('waiting');
    const before = h.claim.mock.calls.length;
    await advance(1000);
    expect(h.current().stage).toBe('lapsed');
    expect(h.current().canAskAgain).toBe(true);
    await advance(T.retryEveryMs * 5);
    expect(h.claim.mock.calls.length).toBeLessThanOrEqual(before + 1);
    const settled = h.claim.mock.calls.length;
    await advance(T.retryEveryMs * 5);
    expect(h.claim.mock.calls.length).toBe(settled);
  });

  // rejects: the phone hard-coding a number the server has changed.
  test('the server\'s timings win over the fallbacks', async () => {
    const h = setup({ askReply: { ok: true, askAgainAfterSeconds: 5, lapseSeconds: 20 } });
    await askNow(h);
    await advance(5000);
    expect(h.current().canAskAgain).toBe(true);
    await advance(15000);
    expect(h.current().stage).toBe('lapsed');
  });
});

describe('the pure pieces', () => {
  test('timingFromReply ignores nonsense rather than trusting it', () => {
    expect(timingFromReply({ askAgainAfterSeconds: 0, lapseSeconds: 'x' })).toEqual(HANDOVER_TIMING);
    expect(timingFromReply(null)).toEqual(HANDOVER_TIMING);
    expect(timingFromReply({ lapseSeconds: 30 }).lapseAfterMs).toBe(30000);
  });

  test('the owner\'s numbers are the fallbacks', () => {
    expect(T.askAgainAfterMs).toBe(60 * 1000);
    expect(T.lapseAfterMs).toBe(10 * 60 * 1000);
    expect(T.askAgainAfterDeclineMs).toBe(30 * 1000);
  });

  test('handoverWaitView at the edges', () => {
    const at = 1_000_000;
    expect(handoverWaitView({ stage: 'waiting', askedAt: at, now: at + T.askAgainAfterMs - 1 }).canAskAgain).toBe(false);
    expect(handoverWaitView({ stage: 'waiting', askedAt: at, now: at + T.askAgainAfterMs }).canAskAgain).toBe(true);
    expect(handoverWaitView({ stage: 'waiting', askedAt: at, now: at + T.lapseAfterMs }).lapsed).toBe(true);
    expect(handoverWaitView({ stage: 'idle', now: at }).canAskAgain).toBe(false);
    expect(formatAgo(65 * 1000)).toBe('1:05');
  });
});

describe('dev QA 1 Nov: Ask again after Not now', () => {
  // rejects: Ask again never returning after Not now. The one-second tick
  //          alone decided it; the moment it is due is now scheduled on its
  //          own, so it arrives even when the browser drops the interval.
  test('Ask again appears at thirty seconds even if the one-second tick never runs', async () => {
    const realSetInterval = global.setInterval;
    global.setInterval = () => 0;
    try {
      const h = setup({ claims: [notNow] });
      await askNow(h);
      await advance(T.retryEveryMs);
      expect(h.current().stage).toBe('declined');
      await advance(T.askAgainAfterDeclineMs - 10);
      expect(h.current().canAskAgain).toBe(false);
      await advance(20);
      expect(h.current().canAskAgain).toBe(true);
    } finally {
      global.setInterval = realSetInterval;
    }
  });

  // rejects: a Not now heard by a fresh join resetting to the first ask.
  test('declined() puts the flow on Not now, with no retry and Ask again after thirty seconds', async () => {
    const h = setup();
    await act(async () => { h.current().declined(); });
    expect(h.current().stage).toBe('declined');
    expect(h.current().canAskAgain).toBe(false);
    await advance(T.askAgainAfterDeclineMs);
    expect(h.current().canAskAgain).toBe(true);
    expect(h.claim).not.toHaveBeenCalled();
  });
});
