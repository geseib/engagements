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
 * THE BUDGET is eight tries with jittered exponential backoff — waits drawn
 * from [c/2, c] for a ceiling c of 25, 50, 100, 200, 400, 400, 400 ms, so at
 * most ~1.6 s of waiting and usually well under a second. Jitter matters more
 * than the numbers: forty phones retrying on the same fixed schedule collide
 * again on every beat. After the budget the caller answers 503 {code:'BUSY'},
 * which the phone retries on its own — never a 409, which the phone reads as a
 * statement about the survey's state.
 *
 * `timing` is exported mutable so a test can shrink the waits (not the number
 * of tries) instead of sleeping for real.
 */

const timing = { tries: 8, baseMs: 25, capMs: 400 };

/** A write refused because a transaction holds its item — retry it. */
const isConflictError = (err) => Boolean(err && (
  err.name === 'TransactionConflictException' || err.name === 'TransactionInProgressException'
));

/** A TransactWriteItems cancelled because one of its items was locked by another. */
const cancelledByConflict = (err) => Boolean(err && err.name === 'TransactionCanceledException'
  && (err.CancellationReasons || []).some((r) => r && r.Code === 'TransactionConflict'));

/** How long to wait after the `attempt`-th busy try (1-based): equal jitter under a doubling ceiling. */
function backoffMs(attempt) {
  const ceiling = Math.min(timing.capMs, timing.baseMs * (2 ** Math.max(0, attempt - 1)));
  return Math.ceil(ceiling / 2 + Math.random() * (ceiling / 2));
}

const pause = (attempt) => new Promise((resolve) => { setTimeout(resolve, backoffMs(attempt)); });

/**
 * Run `fn`, again after a jittered pause each time it is refused as busy, up to
 * the budget. Any other error — a failed condition included — passes straight
 * through; the last busy error is rethrown once the budget is spent (the
 * handler turns it into 503 BUSY).
 */
async function retryOnConflict(fn) {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await fn();
    } catch (err) {
      if (!isConflictError(err) || attempt >= timing.tries) throw err;
      await pause(attempt);
    }
  }
}

module.exports = { timing, isConflictError, cancelledByConflict, backoffMs, pause, retryOnConflict };
