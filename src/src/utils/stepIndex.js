/**
 * MOVING ONE AT A TIME THROUGH A LIST, WITH THE ENDS HANDLED THE SAME WAY EVERY
 * TIME.
 *
 * Extracted from `utils/answerSpotlight.js` when the session history became a
 * second consumer. It is the same problem twice — a dialog showing one item out
 * of a list, with Previous and Next — and the rules that matter are the ones
 * about the EDGES, which are exactly the ones a second hand-written copy gets
 * subtly different.
 *
 * The rules, and why each is the way it is:
 *
 *   CLAMPED, NOT WRAPPED. Next on the last item does nothing and says so with a
 *   disabled control. Both consumers are read in front of a room — the host
 *   stepping through responses out loud, or back through earlier rounds — and
 *   silently restarting at the top reads as "there is more".
 *
 *   A STEP AT AN END RETURNS THE SAME INDEX, never null. `null` is the closed
 *   state in both callers, so returning it from a step would dismiss the dialog
 *   the moment somebody pressed Next once too often.
 *
 *   AN OUT-OF-RANGE OPEN RETURNS null RATHER THAN CLAMPING. This is the one
 *   asymmetry and it is deliberate: a click on a row that is no longer there —
 *   the list re-rendered under the pointer, a page turned mid-tap — must open
 *   NOTHING. Clamping would show a different person's response, with their name
 *   on it, to a room.
 */

/** Is there a real item at this position? */
export function inRange(index, total) {
  return Number.isInteger(index) && index >= 0 && index < total;
}

/** The item to open, or `null` for "open nothing". */
export function openAt(index, total) {
  return inRange(index, total) ? index : null;
}

/** One step, clamped at both ends. `null` only when there was nothing open. */
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
 * "3 of 12", 1-based, because a person reads it and says it out loud. Empty
 * string when there is nothing to number, so a caller can render it
 * unconditionally without printing "0 of 0".
 */
export function positionLabel(index, total) {
  return inRange(index, total) ? `${index + 1} of ${total}` : '';
}
