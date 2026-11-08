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
 *   - Wait on Workie without end. A read that is slow is waited for
 *     NOTES_WAIT_MAX_MS and then the room moves on; a read that failed is
 *     not waited for at all.
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

/**
 * One response on the wall (two surfaces): long enough to read it aloud-ish,
 * never a flash, never parked. A quote reads faster than Workie's prose.
 */
export const RESPONSE_MS_PER_WORD = 280;
export const RESPONSE_MIN_MS = 7000;
export const RESPONSE_MAX_MS = 22000;

/**
 * WORKIE NEVER HOLDS THE ROOM (owner, session 8741, 2026-11-07: "in auto mode
 * it should not get hung up on the workie").
 *
 * In 8741 every one of 22 reads was written 2.3–5.2 s after the reveal. Under
 * auto the read beat starts at least RESULTS_PAGE_MS (12 s) after the reveal,
 * so a read still missing NOTES_WAIT_MAX_MS into the beat is ~37 s late —
 * seven times the slowest the session saw — and is either failing or badly
 * stuck. The page's own watchdog (utils/aiSummaryRecovery.js) waits 45 s plus
 * two 5 s polls before it calls a failure: right for the host's banner, far
 * too long for a room watching "Workie is writing…". 25 s is also inside the
 * one-page dwell range below (NOTES_MAX_MS), so a late read never parks the
 * room longer than one dense page of prose would.
 *
 * A read that FAILED is not waited for at all: a short beat for the room to
 * see the failure line, then on. A read that arrives after auto has moved on
 * only fills in state — nothing turns the stage back (applyAISummary sets the
 * insights and nothing else).
 */
export const NOTES_WAIT_MAX_MS = 25000;
export const NOTES_FAILED_MS = 6000;

/**
 * Whether Auto walks the responses one by one. Two surfaces only, and never
 * for Trivia or Poll: their answers are options, so roundStep gives RESULTS
 * no "Show response" secondary (dev QA 2 Nov) and a walk decision there was a
 * timer that fired at nothing, forever (session 8741, round 22).
 */
export const CHOICE_GAME_TYPES = Object.freeze(['trivia', 'poll']);
export function walksResponses(twoSurfaces, gameType) {
  return Boolean(twoSurfaces) && !CHOICE_GAME_TYPES.includes(String(gameType || '').toLowerCase());
}

export function responseDwellMs(text) {
  const words = String(text || '').trim().split(/\s+/).filter(Boolean).length;
  return Math.max(RESPONSE_MIN_MS, Math.min(RESPONSE_MAX_MS, words * RESPONSE_MS_PER_WORD));
}

/** How long a page of prose deserves, from what is actually on it. */
export function notesDwellMs(pageText) {
  const words = String(pageText || '').trim().split(/\s+/).filter(Boolean).length;
  return Math.max(NOTES_MIN_MS, Math.min(NOTES_MAX_MS, words * NOTES_MS_PER_WORD));
}

/**
 * The next automatic act, or null to sit still.
 *
 * Returns { kind: 'page' | 'primary' | 'secondary' | 'leave', delayMs, why }:
 *   'page'    — turn the stage's page (setStagePageIndex(page + 1))
 *   'primary' — press the dock's primary action for this phase, which is
 *               already phase-correct: Start Voting on ASK (or Show Results on
 *               a no-vote type), Show Results on VOTE, What We Heard on
 *               RESULTS, Next Round on FIELD_NOTES.
 *   'leave'   — FIELD_NOTES with Workie's read still not written after
 *               NOTES_WAIT_MAX_MS: the dock's secondary, "Start round N".
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
  // Workie's read failed (aiSummaryFailure) — nothing left to wait for.
  notesFailed = false,
  // TWO SURFACES (owner, 2026-10-13): walk the response navigator at RESULTS
  // instead of paging cards. `responseCount` is how many there are,
  // `responseText` the one on the wall in RESPONSES.
  walkResponses = false,
  responseCount = 0,
  responseText = '',
} = {}) {
  if (!enabled || playerCount <= 0) return null;

  if (walkResponses && phase === 'RESULTS' && responseCount > 0) {
    // The tally first, then the first response, through the dock's secondary.
    return { kind: 'secondary', delayMs: RESULTS_PAGE_MS, why: 'the tally has had its moment; the responses next' };
  }
  if (phase === 'RESPONSES') {
    // The dock's primary is already the right step: Next part, Next response,
    // and after the last, What we heard.
    return { kind: 'primary', delayMs: responseDwellMs(responseText), why: 'this response has been read' };
  }

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
      // VOTING SHOWS THE RESPONSES (owner, 2026-10-13: "when in auto mode it
      // will cycle through them over and over unless the host click forward or
      // all responses have been cast"). The dock's secondary is Next response,
      // which wraps from the last to the first.
      if (walkResponses && responseCount > 1) {
        return { kind: 'secondary', delayMs: responseDwellMs(responseText), why: 'this response has been read; the next while the room votes' };
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
      // Wait for Workie's read — but never without end (NOTES_WAIT_MAX_MS
      // above). 'leave' is the dock's own secondary before the read is
      // written ("Start round N", SkipForward); the caller measures the wait
      // from when the beat began, so an unrelated re-render does not restart
      // it. A failed read leaves sooner, through the primary, which the dock
      // already offers once the failure is known (notesReadyFor).
      if (!notesReady) {
        if (notesFailed) return { kind: 'primary', delayMs: NOTES_FAILED_MS, why: 'Workie could not write this one — on to the next round' };
        return { kind: 'leave', delayMs: NOTES_WAIT_MAX_MS, why: 'Workie is still writing — not holding the room for it' };
      }
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
