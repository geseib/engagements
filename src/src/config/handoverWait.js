/**
 * MOVING A NAME TO THIS DEVICE: THE PHONE'S CLOCK (experience plan §4.4).
 *
 * The owner's timing, 1 Nov 2026: "Ask again after 1 minute, the request
 * lapses after 10, a grant stays open 5." The server says the first two in
 * its reply to the ask (request-handover.js: `askAgainAfterSeconds`,
 * `lapseSeconds`), and these are only the fallbacks for a reply that does not.
 * The grant window is the server's alone (handover.js): the phone retries the
 * join every few seconds, so it spends a grant long before five minutes pass.
 *
 * Pure: every function takes `now`, so the screen's states are testable
 * without a timer.
 */

export const HANDOVER_TIMING = Object.freeze({
  /** Ask again appears after this long with no answer. */
  askAgainAfterMs: 60 * 1000,
  /** The ask lapses: the phone stops waiting, the host's item disappears. */
  lapseAfterMs: 10 * 60 * 1000,
  /** After "Not now", Ask again waits this long (§4.4 step 7). */
  askAgainAfterDeclineMs: 30 * 1000,
  /** The quiet retry of the join while waiting. */
  retryEveryMs: 4 * 1000,
  /** "You're in as Sam" stays up this long before the live screen. */
  grantedHoldMs: 1500,
});

/**
 * The timing for one ask: the server's numbers where it sent them, the
 * fallbacks otherwise. A number that is not a positive finite one is ignored
 * rather than trusted — a zero lapse would end the wait before it began.
 */
export function timingFromReply(reply, base = HANDOVER_TIMING) {
  const seconds = (value) => (Number.isFinite(Number(value)) && Number(value) > 0 ? Number(value) * 1000 : null);
  return {
    ...base,
    askAgainAfterMs: seconds(reply && reply.askAgainAfterSeconds) ?? base.askAgainAfterMs,
    lapseAfterMs: seconds(reply && reply.lapseSeconds) ?? base.lapseAfterMs,
  };
}

/**
 * What the screen offers right now.
 *
 *   lapsed       the wait is over: the ask is more than lapseAfterMs old
 *   canAskAgain  Ask again is on offer (always, once the wait has ended in
 *                a failure, a lapse or a refusal that has had its pause)
 *   agoMs        how long ago the ask went, for "Asked 0:20 ago"
 */
export function handoverWaitView({ stage, askedAt, declinedAt, now, timing = HANDOVER_TIMING }) {
  const agoMs = askedAt ? Math.max(0, now - askedAt) : 0;
  if (stage === 'waiting') {
    return {
      lapsed: agoMs >= timing.lapseAfterMs,
      canAskAgain: agoMs >= timing.askAgainAfterMs,
      agoMs,
    };
  }
  if (stage === 'declined') {
    const since = declinedAt ? Math.max(0, now - declinedAt) : 0;
    return { lapsed: false, canAskAgain: since >= timing.askAgainAfterDeclineMs, agoMs };
  }
  if (stage === 'lapsed' || stage === 'askFailed') return { lapsed: stage === 'lapsed', canAskAgain: true, agoMs };
  return { lapsed: false, canAskAgain: false, agoMs };
}

/** "0:20", "1:05", "12:00": how long ago, as the screen says it. */
export function formatAgo(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = String(total % 60).padStart(2, '0');
  return `${minutes}:${seconds}`;
}
