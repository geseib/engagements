/**
 * WHO IS STILL IN THE ROOM — which is NOT the same question as who was in it.
 *
 * Owner's request: *"if someone has left, the host should be able to remove
 * them so they are not in the next rounds counts. this should not eliminate any
 * contribution they had made or points they had accumulated before leaving.
 * they will still show up in the data and reports."*
 *
 * Both halves of that sentence are load-bearing, and they pull in opposite
 * directions, so the rule is written here once and imported rather than being
 * re-decided at each of the five places that count players.
 *
 * ── THE MODEL: ONE ATTRIBUTE, NO DELETION ──────────────────────────────────
 *
 * Removal is `RemovedAt` (an ISO timestamp) on `PLAYER#{name}`. Presence of the
 * attribute IS the removal. Nothing is deleted — not the player row, not
 * `PLAYER#{name}#SCORE`, not a single `QUESTION#nnn#ANSWER#{name}` or
 * `#VOTE#{name}`. There is no `DeleteCommand` anywhere in this feature, and the
 * IAM policies on the two new handlers are derived from that fact
 * (`remove-player.js` issues Get + Update and nothing else).
 *
 * A timestamp rather than a boolean because the "when" is worth having in a log
 * and in the roster ("left 14:02"), and because `attribute_exists(RemovedAt)` /
 * `attribute_not_exists(RemovedAt)` is what the ConditionExpressions want —
 * `Removed = false` and `Removed` absent are two spellings of the same state
 * and a condition has to handle both.
 *
 * ── WHICH COUNTS CHANGE, AND WHICH MUST NOT ────────────────────────────────
 *
 * DROPS THEM (a number about the room, right now):
 *   get-players.js       `stats` — readyCount/answeredCount/votedCount and the
 *                        totalPlayers they are a percentage of. This is what
 *                        the host reads as "waiting for N", and waiting on
 *                        somebody who went home is the defect being fixed.
 *   get-game-state.js    `answerProgress.totalPlayers` (:400) and
 *                        `votingProgress.totalPlayers` (:346) — the same number
 *                        on the player's device and in the host's progress bar.
 *
 * KEEPS THEM (a number about the session that happened):
 *   create-report.js     `gameStats.totalPlayers` (:147). A report that says
 *                        "8 players" about a session eleven people sat through
 *                        is a rewritten history, and nothing on screen would
 *                        ever reveal it.
 *   get-ai-summary.js    `totalParticipants` / `totalPlayers` (:2026-2027).
 *                        These are `answers.length` (:1267), not a roster
 *                        count, so removal cannot reach them by construction —
 *                        the answers are still there. Stated here anyway,
 *                        because the next person to "make removal consistent"
 *                        will come looking.
 *   the leaderboard      `get-ai-summary.js:1467` reads `PLAYER#…#SCORE` rows,
 *                        which removal does not touch. Points stand.
 *
 * The asymmetry is the feature. Get it backwards and the reports quietly lose
 * people, which no test notices unless one is written for it — so one is:
 * `tests/player-removal.js` §4.
 */

/**
 * Has the host removed this player from the room?
 *
 * Takes the raw DynamoDB item, so the callers that hold `Items` from a
 * `begins_with(SK, 'PLAYER#')` query can filter without reshaping first.
 */
function isRemoved(item) {
  return Boolean(item && item.RemovedAt);
}

/** The complement, as a predicate, because `.filter(p => !isRemoved(p))` reads worse. */
function isPresent(item) {
  return !isRemoved(item);
}

module.exports = { isRemoved, isPresent };
