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

/**
 * The closed set the writer enforces. Mirrors FOCUS_KINDS in stage-focus.js.
 * 'join' is accepted from older surfaces and means `join: true` (the QR side
 * panel, joinShown below); the server never stores it as the focus.
 */
export const FOCUS_KINDS = ['none', 'question', 'answer', 'join'];

/**
 * The phases an answer focus may be set in, stamped by the server from STATE.
 * Mirrors FOCUS_PHASES in lambda-functions/game/stage-beats.js
 * (tests/stage-focus-vote.js §7). VOTE's index is the voting order every
 * ballot shows; RESULTS' is tally order (config/navigatorOrder.js).
 */
export const FOCUS_PHASES = ['VOTE', 'RESULTS'];

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
export function focusFromFrame(frame, currentState, lastRev = null) {
  if (!frame || typeof frame !== 'object') return null;

  const here = roundOfState(currentState);
  if (here === null) return null;
  if (roundKey(frame.questionNumber) !== here) return null;

  // A FRAME OLDER THAN WHAT IS UP is dropped (two-surface PLAN 1.13): two
  // surfaces focusing at once, or a slow socket, must not put back a response
  // the host has already moved on from. A frame with no rev (an older
  // deploy) is applied as before.
  if (Number.isInteger(frame.rev) && Number.isInteger(lastRev) && frame.rev <= lastRev) return null;

  // AN ANSWER FOCUS STAMPED FOR ANOTHER PHASE is not ours (D5): during VOTE
  // its index is a voting-order position, at RESULTS a tally position, so a
  // VOTE frame applied at RESULTS would put a different, named response up.
  // An unstamped frame (an older deploy) is applied as before.
  if (frame.focus === 'answer' && FOCUS_PHASES.includes(frame.phase)) {
    const phaseHere = (/^(VOTE|RESULTS)#/.exec(String(currentState ?? '').trim()) || [])[1];
    if (frame.phase !== phaseHere) return null;
  }

  return normaliseFocus(frame);
}

/**
 * The extras a focus may carry (two-surface PLAN 1.10/1.13), each only when
 * sound: the part of a long response (answer only, 0 <= part < parts <= 9),
 * the phase the server stamped (FOCUS_PHASES) and the rev. Anything else is
 * dropped rather than passed on.
 */
function extrasOf(value, kind) {
  const out = {};
  if (kind === 'answer') {
    const { part, parts } = value;
    const partsOk = Number.isInteger(parts) && parts >= 1 && parts <= 9;
    const partOk = Number.isInteger(part) && part >= 0 && part < (partsOk ? parts : 9);
    // A part that does not fit its count makes the pair untrustworthy: both go.
    const pairBroken = part !== undefined && part !== null && !partOk;
    if (partsOk && !pairBroken) out.parts = parts;
    if (partOk) out.part = part;
    if (FOCUS_PHASES.includes(value.phase)) out.phase = value.phase;
  }
  if (Number.isInteger(value.rev) && value.rev >= 0) out.rev = value.rev;
  // The QR side panel (owner, 18 Oct 2026), beside any focus. Absent means
  // "this payload says nothing about it": a reader keeps what it had.
  if (typeof value.join === 'boolean') out.join = value.join;
  return out;
}

/**
 * IS THE QR UP ON THE WALL? (owner, 18 Oct 2026: "whenever the host wants to
 * show the qr code. it moves the screen around a bit so all content is there
 * but the qr code is avail"). Its own fact since then, `stageFocus.join`
 * (stage-focus.js StageJoin), beside whatever the focus is. A focus of 'join'
 * from an older deploy reads as up.
 */
export function joinShown(stageFocus) {
  const f = stageFocus && typeof stageFocus === 'object' ? stageFocus : {};
  if (typeof f.join === 'boolean') return f.join;
  return f.focus === 'join';
}

/**
 * The body that shows or hides the QR panel and touches nothing else, or null
 * outside a round. `focus` is left out on purpose: the server then keeps the
 * focus as it is (stage-focus.js), and 'none' would close a response.
 */
export function joinRequest({ join, state } = {}) {
  const round = roundOfState(state);
  if (round === null || typeof join !== 'boolean') return null;
  return { join, questionNumber: Number(round) };
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

  if (kind === 'question') return { focus: 'question', index: null, ...extrasOf(value, 'question') };
  // The join code and QR on the wall (owner, 2026-10-13); no index, like the question.
  if (kind === 'join') return { focus: 'join', index: null, ...extrasOf(value, 'join') };

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
    return { focus: 'answer', index, ...extrasOf(value, 'answer') };
  }

  const rest = value && typeof value === 'object' ? extrasOf(value, 'none') : {};
  return Object.keys(rest).length ? { ...NO_FOCUS, ...rest } : NO_FOCUS;
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
export function focusRequest({ focus, index, part, parts, state } = {}) {
  const round = roundOfState(state);
  if (round === null) return null;

  const normalised = normaliseFocus({ focus, index, part, parts });

  // 'none' is sendable — closing is a thing the host DID and it has to travel.
  if (!FOCUS_KINDS.includes(normalised.focus)) return null;

  return {
    focus: normalised.focus,
    index: normalised.focus === 'answer' ? normalised.index : null,
    // The part of a long response, only when a surface measured one.
    ...(normalised.focus === 'answer' && normalised.part !== undefined ? { part: normalised.part } : {}),
    ...(normalised.focus === 'answer' && normalised.parts !== undefined ? { parts: normalised.parts } : {}),
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
  return x.focus === y.focus && x.index === y.index && (x.part || 0) === (y.part || 0);
}
