/**
 * WHAT THE ROOM IS LOOKING AT CLOSELY, as arithmetic. No fetch, no React.
 *
 * The owner: the phone remote should be able to *"enlarge a question, a
 * specific response, etc."* — on the room's screen, not the phone's.
 *
 * Three surfaces hold an opinion about the focus and they cannot share a
 * runtime: the stage (which renders it), the phone (which polls `/state` every
 * two seconds and is a beat behind by construction) and `stage-focus.js` (the
 * only writer). The rules live here once so the phone's button and the stage's
 * spotlight cannot come to mean different things — the same deal
 * `config/questionQueue.js` has with `queue-order.js`.
 *
 * ── EVERY FRAME IS ROUND-ADDRESSED, AND THAT IS THE WHOLE SAFETY STORY ─────
 *
 * A focus is an INDEX INTO A ROUND'S ANSWERS. Round 4's answers are different
 * rows from round 3's, so a frame that arrives late — a slow socket, a phone
 * that was in a pocket — must be dropped rather than applied, or the room gets
 * "response 2" of a round it has left, meaning whatever is now second: a real
 * answer, attributed to a real person, that the host never chose.
 *
 * `stageBeatFromFrame` in `utils/hostOverlays.js`-adjacent code does exactly
 * this for the beat, and this is deliberately its sibling.
 */

/** The closed set the writer enforces. Mirrors FOCUS_KINDS in stage-focus.js. */
export const FOCUS_KINDS = ['none', 'question', 'answer'];

/** Nothing enlarged. A value, never an absence — see stage-focus.js's header. */
export const NO_FOCUS = { focus: 'none', index: null };

/** Round numbers travel padded ('007') and bare (7). One spelling for compares. */
const roundKey = (value) => {
  const digits = String(value ?? '').trim().replace(/\D/g, '');
  return digits === '' ? null : String(Number(digits));
};

/**
 * Which round a game state string is on. `RESULTS#007` → '7'.
 *
 * Returns null for LOBBY, CREATED, STARTED and ENDED — states with no round, in
 * which no focus can be valid. A frame arriving during ENDED is dropped rather
 * than opening a spotlight over a finished session's podium.
 */
export function roundOfState(state) {
  const match = /^(?:ASK|VOTE|RESULTS)#(\d+)$/.exec(String(state ?? '').trim());
  return match ? roundKey(match[1]) : null;
}

/**
 * A `stageFocusChanged` frame, as something to apply — or null to ignore it.
 *
 * Returns null, never NO_FOCUS, when the frame is not ours. The two are
 * opposites and confusing them is the bug this function exists to prevent:
 * NO_FOCUS CLOSES what is open, so answering a stale frame with it would have a
 * late arrival from round 3 shut the spotlight the host just opened on round 4.
 */
export function focusFromFrame(frame, currentState) {
  if (!frame || typeof frame !== 'object') return null;

  const here = roundOfState(currentState);
  if (here === null) return null;
  if (roundKey(frame.questionNumber) !== here) return null;

  return normaliseFocus(frame);
}

/**
 * Whatever a payload says, as a focus this build can act on.
 *
 * An unknown kind resolves to NO_FOCUS rather than being passed along: a client
 * from a different deploy is the one case where "do nothing, visibly" beats
 * "hand it on and let three more layers each fail to recognise it".
 */
export function normaliseFocus(value) {
  const kind = value && value.focus;

  if (kind === 'question') return { focus: 'question', index: null };

  if (kind === 'answer') {
    /*
      TWO GUARDS, AND BOTH ARE LOAD-BEARING IN OPPOSITE DIRECTIONS.

      Coming IN: `Number(null)` is 0 and `Number('')` is 0, so a payload that
      simply forgot its index would normalise to "the FIRST response" — a real
      answer, attributed to a real person, put on a wall because a field was
      missing. Only `undefined` gives the NaN a bare Number() check would catch.
      This suite caught exactly that; the comment below was already written
      about the hazard while the code still had it.

      Coming OUT: `Number.isInteger` and `>= 0`, never a truthiness test. Index 0
      is the first response and by far the most likely one a host enlarges, so
      `value.index || null` erases precisely that case and ships a control that
      works for every response except the top one.
    */
    if (value.index === null || value.index === undefined || value.index === '') return NO_FOCUS;
    const index = Number(value.index);
    if (!Number.isInteger(index) || index < 0) return NO_FOCUS;
    return { focus: 'answer', index };
  }

  return NO_FOCUS;
}

/**
 * The focus as the two pieces of client state the stage already has.
 *
 * `GameHostPage` holds `lessonExpanded` (the question, blown up) and
 * `spotlightIndex` (one response, full-screen) and they are MUTUALLY EXCLUSIVE
 * in a way nothing enforced before this: both are independent booleans/indices
 * set by separate buttons, so a page could hold both at once and stack one
 * overlay on the other. Deriving both from a single value is what makes that
 * unrepresentable.
 *
 * `answerCount` clamps. The writer deliberately does not range-check the index
 * — that would mean querying the answers on every tap, while a room waits, on a
 * count that is still moving — so the SURFACE is where an index past the end
 * resolves to "nothing open" rather than to an empty spotlight.
 */
export function focusToStage(focus, { answerCount = 0 } = {}) {
  const { focus: kind, index } = normaliseFocus(focus);

  if (kind === 'question') return { lessonExpanded: true, spotlightIndex: null };
  if (kind === 'answer' && index < answerCount) {
    return { lessonExpanded: false, spotlightIndex: index };
  }
  return { lessonExpanded: false, spotlightIndex: null };
}

/**
 * The body `POST /games/{id}/stage-focus` wants, or null when there is nothing
 * sendable — no round, or a focus the closed set does not contain.
 *
 * Both callers go through here rather than building the object twice: the phone
 * and the stage post to the same endpoint, and this is the file that knows
 * `questionNumber` is required and that only an answer carries an index.
 */
export function focusRequest({ focus, index, state } = {}) {
  const round = roundOfState(state);
  if (round === null) return null;

  const normalised = normaliseFocus({ focus, index });

  // 'none' is sendable — closing is a thing the host DID and it has to travel.
  if (!FOCUS_KINDS.includes(normalised.focus)) return null;

  return {
    focus: normalised.focus,
    index: normalised.focus === 'answer' ? normalised.index : null,
    questionNumber: Number(round),
  };
}

/**
 * Is this focus already what the room is showing?
 *
 * The host is standing in front of a room and will double-tap. A press that
 * changes nothing should cost no request at all — the same reasoning the queue's
 * `changed: false` path carries, and the same reasoning behind stage-beat's
 * idempotence.
 */
export function sameFocus(a, b) {
  const x = normaliseFocus(a);
  const y = normaliseFocus(b);
  return x.focus === y.focus && x.index === y.index;
}
