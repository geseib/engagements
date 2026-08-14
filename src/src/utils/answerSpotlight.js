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
 * ── WHY THE INDEX ARITHMETIC IS ITS OWN MODULE ─────────────────────────────
 *
 * Because the spotlight moves through the WHOLE list and the grid behind it
 * shows one page, and those two facts fight. The card the host clicked is at
 * `answerPage.offset + i` — a page-relative position turned absolute — and
 * every step from there has to stay absolute or Next would walk off the end of
 * the visible page and stop. Getting that wrong is silent: it looks like the
 * button simply does not work on the last card of each page, which is the same
 * symptom as three of the bugs already fixed this week.
 *
 * ── CLAMPED, NOT WRAPPED ───────────────────────────────────────────────────
 *
 * Next on the last answer does nothing and says so with a disabled control,
 * rather than jumping back to the first. In front of a room the host is reading
 * down a list out loud; silently restarting reads as "there are more" and costs
 * them the sentence. `positionLabel` exists for the same reason — "3 of 12" is
 * what tells them how much is left.
 */

/** Is there a real answer at this position? */
function inRange(index, total) {
  return Number.isInteger(index) && index >= 0 && index < total;
}

/**
 * The answer to open, or `null` for "open nothing".
 *
 * `null` rather than a clamped index for an out-of-range request: a click on a
 * card that is no longer there — the list re-rendered under the pointer, a page
 * turned mid-tap — must open NOTHING. Clamping it to the nearest valid answer
 * would spotlight a different person's response than the one that was touched,
 * on a projector, with their name on it.
 */
export function openAt(index, total) {
  return inRange(index, total) ? index : null;
}

/**
 * One step through the full list, clamped at both ends.
 *
 * Returns the SAME index at an end rather than null, because null closes the
 * dialog — and a Next press on the last answer must not dismiss what the host
 * is reading.
 */
export function step(index, delta, total) {
  if (!inRange(index, total)) return null;
  const next = index + delta;
  return inRange(next, total) ? next : index;
}

/** Whether the control that moves by `delta` can do anything from here. */
export function canStep(index, delta, total) {
  return inRange(index, total) && inRange(index + delta, total);
}

/**
 * "3 of 12", 1-based, because it is read by a person and spoken in a room.
 * Empty string when there is nothing to number, so the caller can render it
 * unconditionally without printing "0 of 0".
 */
export function positionLabel(index, total) {
  return inRange(index, total) ? `${index + 1} of ${total}` : '';
}

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
