/**
 * THE BEATS OF RESULTS — the closed set, and nothing else.
 *
 * A round's RESULTS phase moves through three beats, in this order:
 *
 *   results      the tally
 *   field-notes  "What We Heard" — the AI's read-back of the round
 *   feedback     a FEEDBACK ROUND: the room holds this round's own report and
 *                comments on sections of it
 *
 * ── WHY THIS IS ITS OWN FILE ───────────────────────────────────────────────
 *
 * The list used to live inside `stage-beat.js`, the endpoint that writes it,
 * which was fine while `stage-beat.js` was the only file that cared. It is not:
 * `get-game-state.js` is the one endpoint the host page and the phone remote
 * BOTH read the beat back from, and it had its own hard-coded equality test
 * against `'field-notes'`. When `feedback` was added, that test reported every
 * stored `feedback` as `results`, to every client, with the row on disk
 * perfectly correct and nothing wrong in any log.
 *
 * A second reader is what turns a constant into a shared vocabulary. Requiring
 * the *handler* to get at its constant would have pulled an API Gateway
 * Management client and a broadcast function into a read path that needs
 * neither, so the vocabulary moves here and both files require this.
 *
 * ── CLOSED, AND WHY THAT MATTERS MORE THAN IT USUALLY DOES ─────────────────
 *
 * An open set fails in the worst way available: the write succeeds, the frame
 * goes out, every client compares the value against a list it is not in, and
 * the host watches a button do nothing in front of a room, with no error
 * anywhere in the system. So every reader tests membership of THIS array and
 * never equality against one member of it.
 *
 * MIRRORED IN `src/src/config/hostControls.js` as `STAGE_BEATS`. Lambda bundles
 * are per-directory, there are no layers, and the frontend module is ESM, so a
 * require() across that boundary is impossible — the same rule `round-kinds.js`
 * and `game-types.js` follow. `tests/feedback-round-beat.js` reads the frontend
 * copy as text and fails the build if the two drift.
 */

/** The only three there are, in the order a round moves through them. */
const BEATS = ['results', 'field-notes', 'feedback'];

/**
 * The beat a round is on when nothing has been written.
 *
 * Explicit rather than undefined: "the host has not moved this round" and "the
 * host moved it back to the tally" are the same picture on stage but different
 * facts on the wire, and a client inventing its own default is how two surfaces
 * come to disagree about what the room is looking at.
 */
const DEFAULT_BEAT = 'results';

/** What a READER should treat a stored value as. Unknown resolves rather than
 *  throwing: a reader's job is to render the room, not to police the table. */
function resolveBeat(value) {
  return BEATS.includes(value) ? value : DEFAULT_BEAT;
}

module.exports = { BEATS, DEFAULT_BEAT, resolveBeat };
