/**
 * THE SCOREBOARD FLASH — the standings, briefly, between two trivia rounds.
 *
 * The owner, 2026-11-09: "i think scoring is more interesting here, i think
 * both in standard mode and automode we need a quick flashup of the
 * scoreboard after each round."
 *
 * WHAT IT IS. When the host presses Start round N after a trivia round's
 * results and Workie's read — or Auto presses it — the room first sees the
 * scoreboard (the same board S opens, on this screen and on /present, since
 * the board is the server's) for a few seconds, and then the next round
 * opens by itself. Pressing Start round N again, Space, Escape, the board's X
 * or a clicker's → skips the rest of it. Not after the last round: the end
 * of the session has its own standings, and the flash would double them.
 *
 * ONE TIMER. The flash's countdown is the only clock running while it is up:
 * Auto's own timer stands still while the board is open (autoMode.js,
 * SCORE_FLASH, and the page's overlay gate), and the flash then opens the
 * round through the very path the press would have taken
 * (handleNextQuestion), so there is no second way to advance the room.
 *
 * NAMES. The flash is the board, unchanged: whatever the board shows or
 * hides, the flash does. Trivia boards name players with their totals (the
 * owner's scoreboard ruling, config/scoreboard.js).
 *
 * Pure: no React, no timers. useScoreFlash.js owns the timeout.
 */

/** The lengths the host chooses between, in seconds. */
export const SCORE_FLASH_CHOICES = Object.freeze([3, 5, 8]);
export const DEFAULT_SCORE_FLASH_SECONDS = 5;

/** The formats that flash. Trivia only: a Call & Answer round's read is the moment. */
export const FLASH_GAME_TYPES = Object.freeze(['trivia']);

export function flashesByDefault(gameType) {
  return FLASH_GAME_TYPES.includes(String(gameType || '').toLowerCase());
}

/** A setting as stored or chosen, read back as one this build can act on. */
export function normaliseScoreFlash(value, gameType) {
  const v = value && typeof value === 'object' ? value : {};
  const seconds = SCORE_FLASH_CHOICES.includes(Number(v.seconds)) ? Number(v.seconds) : DEFAULT_SCORE_FLASH_SECONDS;
  const on = typeof v.on === 'boolean' ? v.on : flashesByDefault(gameType);
  return { on: on && flashesByDefault(gameType), seconds };
}

export function scoreFlashMs(seconds) {
  const s = SCORE_FLASH_CHOICES.includes(Number(seconds)) ? Number(seconds) : DEFAULT_SCORE_FLASH_SECONDS;
  return s * 1000;
}

/**
 * Does pressing Start round N flash the board first?
 *
 *   on              the session's setting
 *   gameType        trivia only
 *   phase           the host phase: after the reveal (RESULTS) or the read (FIELD_NOTES)
 *   nextRoundExists a round follows; the last round leads into the end as it always did
 *   boardAvailable  scoreboardAvailability().enabled — a round has been scored
 *   boardOpen       the host already has the board up: the room has seen it
 */
export function scoreFlashApplies({
  on = false, gameType = '', phase = '', nextRoundExists = false, boardAvailable = false, boardOpen = false,
} = {}) {
  return Boolean(on)
    && flashesByDefault(gameType)
    && (phase === 'RESULTS' || phase === 'FIELD_NOTES')
    && Boolean(nextRoundExists)
    && Boolean(boardAvailable)
    && !boardOpen;
}

/**
 * A clicker's "next" while the board flashes: → , PageDown, Enter. Space and
 * Escape already close the board (config/scoreboard.js scoreboardKeyIntent),
 * and closing it during the flash skips it the same way.
 */
export function flashSkipKey(event) {
  if (!event || event.metaKey || event.ctrlKey || event.altKey) return false;
  const tag = event.target && event.target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return false;
  return event.key === 'ArrowRight' || event.key === 'PageDown' || event.key === 'Enter';
}

/** Seconds left, whole and never below zero, for the board's countdown. */
export function secondsLeft(startedAt, ms, now = Date.now()) {
  return Math.max(0, Math.ceil((Number(startedAt) + Number(ms) - now) / 1000));
}

/**
 * This round's biggest gains, from the board's own rows (config/scoreboard.js
 * boardRows: total and previousScore): [{ name, gain }], largest first, ties
 * by name, at most `limit`. Nobody who gained nothing; nobody new to the
 * board (no previous total to gain from).
 */
export function roundGains(rows, limit = 3) {
  return (Array.isArray(rows) ? rows : [])
    .filter((r) => r && r.movement !== 'new' && Number.isFinite(r.previousScore))
    .map((r) => ({ name: r.name, gain: Number(r.total) - Number(r.previousScore) }))
    .filter((r) => r.gain > 0)
    .sort((a, b) => (b.gain - a.gain) || a.name.localeCompare(b.name))
    .slice(0, limit);
}

const STORE = 'engage.scoreFlash.';

/** The host's choice for this session, from this browser — {} when none or unreadable. */
export function loadScoreFlash(gameId) {
  if (!gameId) return {};
  try {
    const raw = window.localStorage.getItem(STORE + gameId);
    const v = raw ? JSON.parse(raw) : {};
    return v && typeof v === 'object' ? v : {};
  } catch {
    return {};
  }
}

export function saveScoreFlash(gameId, value) {
  if (!gameId) return;
  try {
    window.localStorage.setItem(STORE + gameId, JSON.stringify({ on: Boolean(value.on), seconds: Number(value.seconds) }));
  } catch {
    // A private window: the choice lasts the page, which is all it needs.
  }
}
