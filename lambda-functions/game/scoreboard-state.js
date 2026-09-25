/**
 * THE SCOREBOARD'S SESSION STATE — the closed vocabulary and its one reader.
 *
 * docs/superpowers/specs/2026-09-25-scoreboard-design.md §2–§3. The board is a
 * session-level fact on the STATE row:
 *
 *   STATE.Scoreboard = { open, style, openedAt, page }
 *
 *   open      is the board on the room's screen
 *   style     which of the three looks: departure | olympic | tote
 *   openedAt  when THIS opening began — a new value restarts the auto-flip;
 *             re-opening an open board keeps it, so a double-tap does not
 *   page      a step counter the REMOTE drives ("next page"). The stage turns
 *             its own pages locally (auto-flip, ← →) and applies only the
 *             change in this number, because the number of pages depends on
 *             the screen's display profile, which the server never sees.
 *
 * ── WHY THIS IS ITS OWN FILE ───────────────────────────────────────────────
 *
 * Two readers: `scoreboard.js` (the writer) and `get-game-state.js` (what the
 * refreshed host page and the polling phone read back). stage-beats.js made
 * the same move for the same reason — requiring the handler would drag an API
 * Gateway Management client into a read path that needs none.
 *
 * MIRRORED IN `src/src/config/scoreboard.js` as `SCOREBOARD_STYLES`; Lambda
 * bundles are per-directory and the frontend module is ESM, so a require
 * across that boundary is impossible. `tests/scoreboard-route.js` reads the
 * frontend copy as text and fails if the two drift.
 */
const { normalizeGameType, isKnownGameType } = require('./game-types');

/** The three looks, in the order V cycles them. The first is the default. */
const SCOREBOARD_STYLES = ['departure', 'olympic', 'tote'];
const DEFAULT_STYLE = SCOREBOARD_STYLES[0];

/** Owner, 2026-09-25: Trivia and Call & Answer only. */
const SCOREBOARD_GAME_TYPES = ['trivia', 'call-and-answer'];

/** The remote's page steps. */
const STEPS = ['next', 'prev'];

/**
 * Does this session's type have a board at all? Legacy spellings resolve
 * ('quiz' is trivia); an unknown spelling does not — normalizeGameType falls
 * back to call-and-answer for junk, so it is checked for being a real
 * spelling first.
 */
function hasScoreboard(gameType) {
  return isKnownGameType(gameType) && SCOREBOARD_GAME_TYPES.includes(normalizeGameType(gameType));
}

/**
 * Whatever is stored, as a board this build can act on. Never undefined: a
 * session nobody has opened a board in reads closed, in the default look, so
 * no client invents its own default.
 */
function normaliseScoreboard(value) {
  const v = value && typeof value === 'object' ? value : {};
  const page = Number.isInteger(v.page) ? v.page : 0;
  return {
    open: v.open === true,
    style: SCOREBOARD_STYLES.includes(v.style) ? v.style : DEFAULT_STYLE,
    page,
    openedAt: typeof v.openedAt === 'string' && v.openedAt ? v.openedAt : null,
  };
}

module.exports = {
  SCOREBOARD_STYLES, DEFAULT_STYLE, SCOREBOARD_GAME_TYPES, STEPS,
  hasScoreboard, normaliseScoreboard,
};
