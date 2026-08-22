/**
 * AUTO-MODE — the session runs itself while everyone keeps up.
 *
 * The owner: "Could we have a setting that is auto-mode which advances things
 * forward when everyone has answered. obviously we need to pause on the
 * responses to give adequate time to read everything through each page of the
 * responses."
 *
 * PURE DECISIONS, NO TIMERS. Given a snapshot of the round, `autoDecision`
 * answers "what would a patient host do next, and after how long" — or null
 * for "nothing; wait for the room". GameHostPage owns the one setTimeout and
 * performs the action through the SAME paths the keyboard uses (a page turn is
 * setStagePageIndex, an advance is the dock's primary action), so auto-mode
 * cannot invent a fifth way to move the room. That is also what makes this
 * file testable as arithmetic.
 *
 * WHAT IT NEVER DOES:
 *   - Start the session, or the first round. Opening the doors and putting the
 *     first question up are the host's deliberate acts; auto-mode takes over
 *     only once a round is running.
 *   - Advance on a room where nobody is in. `playerCount === 0` disables every
 *     rule — "everyone has answered" is vacuously true of an empty room and
 *     acting on it would sprint a session nobody is playing.
 *   - Fire while an overlay is up. The caller gates on the same suppressor the
 *     keyboard uses, so a host reading an answer in the spotlight, or holding
 *     a pinned QR, has implicitly pressed pause.
 *
 * THE DWELLS. Response pages get a flat per-page allowance — they are short
 * quotes, and a room reads them at roughly a page per ten seconds with talk in
 * between. Workie's pages are PROSE, so their dwell is derived from the words
 * actually on the page at a comfortable read-aloud-ish pace, clamped: the
 * floor stops a two-line page from flashing past, the ceiling stops a dense
 * page from parking the room for a minute. Every number is a named export so
 * a taste change is a one-line edit with a test behind it.
 */

/** Everyone is in — one beat of "look at that" before the stage moves. */
export const AUTO_GRACE_MS = 4000;

/** A page of response cards: read two or three quotes, hear the room react. */
export const RESULTS_PAGE_MS = 12000;

/** Workie prose: ~200 words a minute, clamped to sane bounds per page. */
export const NOTES_MS_PER_WORD = 300;
export const NOTES_MIN_MS = 9000;
export const NOTES_MAX_MS = 26000;

/** How long a page of prose deserves, from what is actually on it. */
export function notesDwellMs(pageText) {
  const words = String(pageText || '').trim().split(/\s+/).filter(Boolean).length;
  return Math.max(NOTES_MIN_MS, Math.min(NOTES_MAX_MS, words * NOTES_MS_PER_WORD));
}

/**
 * The next automatic act, or null to sit still.
 *
 * Returns { kind: 'page' | 'primary', delayMs, why }:
 *   'page'    — turn the stage's page (setStagePageIndex(page + 1))
 *   'primary' — press the dock's primary action for this phase, which is
 *               already phase-correct: Start Voting on ASK (or Show Results on
 *               a no-vote type), Show Results on VOTE, What We Heard on
 *               RESULTS, Next Round on FIELD_NOTES.
 * `why` is a short sentence for the log and the dock's own hint line.
 */
export function autoDecision({
  enabled = false,
  phase = '',
  playerCount = 0,
  answeredCount = 0,
  votedCount = 0,
  page = 0,
  pages = 1,
  pageText = '',
  notesReady = false,
} = {}) {
  if (!enabled || playerCount <= 0) return null;

  switch (phase) {
    case 'ASK':
      if (answeredCount >= playerCount && answeredCount > 0) {
        return { kind: 'primary', delayMs: AUTO_GRACE_MS, why: 'everyone has answered' };
      }
      return null;
    case 'VOTE':
      if (votedCount >= playerCount && votedCount > 0) {
        return { kind: 'primary', delayMs: AUTO_GRACE_MS, why: 'everyone has voted' };
      }
      return null;
    case 'RESULTS':
      // Page through every page of responses at reading pace, dwell on the
      // last one just as long, and only then move to What We Heard. This is
      // the "adequate time to read everything" the owner asked for — skipping
      // straight to Workie with page 2 unshown would be auto-mode eating the
      // room's own words.
      if (page < pages - 1) {
        return { kind: 'page', delayMs: RESULTS_PAGE_MS, why: `responses page ${page + 1} of ${pages} read` };
      }
      return { kind: 'primary', delayMs: RESULTS_PAGE_MS, why: 'the tally has had its moment' };
    case 'FIELD_NOTES':
      // Nothing moves until Workie has actually written — a countdown over a
      // spinner would advance past a summary nobody saw.
      if (!notesReady) return null;
      if (page < pages - 1) {
        return { kind: 'page', delayMs: notesDwellMs(pageText), why: `Workie page ${page + 1} of ${pages} read` };
      }
      return { kind: 'primary', delayMs: notesDwellMs(pageText) + AUTO_GRACE_MS, why: 'the reading is done — next round' };
    default:
      // LOBBY and ENDED are the host's own moments, and any phase this file
      // has never heard of gets stillness rather than a guess.
      return null;
  }
}
