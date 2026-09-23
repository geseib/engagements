/**
 * WHEN A ROOM ANSWERS TOGETHER, THE ONE STATE ROW IS BUSY.
 *
 * Every survey answer is a TransactWriteItems carrying a ConditionCheck on
 * `GAME#<id>/STATE` (survey-answers.js): it is what makes close final. But
 * DynamoDB locks EVERY item in a transaction for the transaction's life —
 * a ConditionCheck included — so:
 *
 *   - two phones answering at the same instant cancel each other, the loser
 *     with CancellationReasons[0].Code === 'TransactionConflict';
 *   - the host's close or warning (an UpdateItem on STATE) landing while an
 *     answer's transaction holds STATE fails with TransactionConflictException.
 *
 * Neither means anything is wrong: the write simply has to go again a moment
 * later. Before this module both were rethrown and answered 500, which is what
 * a room of forty pressing the same button got. This file is the one place
 * that says what "busy" looks like and how long to keep trying.
 *
 * THROTTLING IS BUSY TOO. Every answer in a session writes the one partition
 * `GAME#<id>`, so a big room outruns that partition's write rate and DynamoDB
 * refuses for load: `ThrottlingException` (on dev, a 240-answer burst, reason
 * TableWriteKeyRangeThroughputExceeded), `ProvisionedThroughputExceededException`,
 * `RequestLimitExceeded`, or a cancelled transaction whose reason is
 * `ThrottlingError` / `ProvisionedThroughputExceeded`. Each of those arrives
 * AFTER the SDK's own three attempts, and each used to be a 500. Like a
 * conflict it means "again, a moment later", so it shares the budget below.
 *
 * THE BUDGET is eight tries with jittered exponential backoff — waits drawn
 * from [c/2, c] for a ceiling c of 25, 50, 100, 200, 400, 400, 400 ms, so at
 * most ~1.6 s of our own waiting and usually well under a second. Jitter
 * matters more than the numbers: forty phones retrying on the same fixed
 * schedule collide again on every beat.
 *
 * AND A CLOCK: no new try starts once `deadlineMs` has passed since the first.
 * A conflict fails in milliseconds, but a throttled send has already spent the
 * SDK's back-off (500 ms-based, up to ~3 s a send), so eight of them could run
 * into the function's 30 s timeout — and a timed-out Lambda is a 500 at the
 * edge, the one answer this module exists to prevent.
 *
 * After the budget the caller answers 503 {code:'BUSY'}, which the phone
 * retries on its own — never a 409, which the phone reads as a statement about
 * the survey's state, and never a 500.
 *
 * `timing` is exported mutable so a test can shrink the waits (not the number
 * of tries) instead of sleeping for real, and move the clock.
 */

const timing = { tries: 8, baseMs: 25, capMs: 400, deadlineMs: 8000 };

/** Refused because a transaction holds the item. */
const CONFLICT_ERRORS = ['TransactionConflictException', 'TransactionInProgressException'];
/** Refused for load: the partition's, the table's or the account's throughput. */
const THROTTLE_ERRORS = ['ThrottlingException', 'ProvisionedThroughputExceededException', 'RequestLimitExceeded'];
/** A TransactWriteItems cancellation reason that means the same two things. */
const BUSY_REASONS = ['TransactionConflict', 'ThrottlingError', 'ProvisionedThroughputExceeded'];

/** A write refused because a transaction holds its item — retry it. */
const isConflictError = (err) => Boolean(err && CONFLICT_ERRORS.includes(err.name));

/** A read or write refused for throughput — retry it. */
const isThrottleError = (err) => Boolean(err && THROTTLE_ERRORS.includes(err.name));

/** A TransactWriteItems cancelled because an item was locked by another, or throttled. */
const cancelledAsBusy = (err) => Boolean(err && err.name === 'TransactionCanceledException'
  && (err.CancellationReasons || []).some((r) => r && BUSY_REASONS.includes(r.Code)));

/** Anything that means "again, a moment later" — never a failed condition, never a bad request. */
const isBusyError = (err) => isConflictError(err) || isThrottleError(err) || cancelledAsBusy(err);

/** How long to wait after the `attempt`-th busy try (1-based): equal jitter under a doubling ceiling. */
function backoffMs(attempt) {
  const ceiling = Math.min(timing.capMs, timing.baseMs * (2 ** Math.max(0, attempt - 1)));
  return Math.ceil(ceiling / 2 + Math.random() * (ceiling / 2));
}

const pause = (attempt) => new Promise((resolve) => { setTimeout(resolve, backoffMs(attempt)); });

/**
 * After `attempt` busy tries, the first of which began at `startedAt`: may
 * another start? Not past the eighth, and not once the clock has run out.
 */
function mayRetry(attempt, startedAt, now = Date.now()) {
  return attempt < timing.tries && now - startedAt < timing.deadlineMs;
}

/**
 * Run `fn`, again after a jittered pause each time it is refused as busy, while
 * the budget allows. Any other error — a failed condition included — passes
 * straight through; the last busy error is rethrown once the budget is spent
 * (the handler turns it into 503 BUSY).
 */
async function retryWhenBusy(fn) {
  const startedAt = Date.now();
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await fn();
    } catch (err) {
      if (!isBusyError(err) || !mayRetry(attempt, startedAt)) throw err;
      await pause(attempt);
    }
  }
}

module.exports = {
  timing, isBusyError, isConflictError, isThrottleError, cancelledAsBusy, backoffMs, pause, mayRetry, retryWhenBusy,
};
