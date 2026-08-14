/**
 * READING ONE ANSWER PROPERLY, AND MOVING THROUGH THE REST.
 *
 *   "when the results or voting screen are there it should be easy to click on
 *    an answer and it expand on a large modal, with a x to close or click off
 *    the modal to go back, in case we want to read the answer. we should also
 *    be able to scroll or click through when more answers than fit on the
 *    screen."
 *
 * The stage already pages — `pageSlice` cuts `answers` into screenfuls and the
 * host clicks through them. That solves "how do I SEE answer nine"; it does not
 * solve "I want to READ answer nine", because a card sized to fit eight of its
 * siblings on a projector is sized to be glanced at, not read from.
 *
 * ── WHERE THE STEPPING WENT ────────────────────────────────────────────────
 *
 * `openAt`, `step`, `canStep` and `positionLabel` now live in `utils/stepIndex.js`
 * and are re-exported here. The session history dialog is a second consumer of
 * exactly the same rules — one item out of a list, Previous and Next, and the
 * edges are what matter — and the alternative was a second hand-written copy of
 * the edge cases. Re-exported rather than moved outright so this module's own
 * callers and tests keep one import.
 *
 * ── WHAT IS STILL SPECIFIC TO ANSWERS ──────────────────────────────────────
 *
 * `pageOf`, below. It exists because the spotlight moves through the WHOLE list
 * while the grid behind it shows one page, and those two facts fight. The card
 * the host clicked is at `answerPage.offset + i` — a page-relative position
 * turned absolute — and every step from there stays absolute, so Next does not
 * walk off the end of the visible page and stop. Getting that wrong is silent:
 * it looks like the button simply does not work on the last card of each page.
 */
export { openAt, step, canStep, positionLabel } from './stepIndex';
import { inRange } from './stepIndex';

/**
 * Which page holds this answer — so closing the spotlight can leave the grid
 * showing the card that was just being read, rather than the page it was opened
 * from. Without this, clicking Next past a page boundary and then closing drops
 * the host back three answers behind where they got to.
 */
export function pageOf(index, pageSize) {
  if (!inRange(index, Infinity) || !Number.isInteger(pageSize) || pageSize <= 0) return 0;
  return Math.floor(index / pageSize);
}
