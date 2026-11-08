/**
 * THE SESSION SO FAR — the earlier rounds of a trivia session, as facts the
 * read is handed, so a claim about them is copied rather than invented.
 *
 * Session 8741 (dev, 2026-11-07, trivia, 22 rounds, 4 players): round 14's
 * read said "it was a clean sweep, and the first time the four of them agreed
 * on something this session". All four had been right in rounds 1, 2, 3, 6,
 * 11, 12 and 13 already; round 14 was the eighth. The prompt carried THIS
 * round's "4 of 4 players correct" and the running totals, and nothing about
 * any earlier round, so "the first time" had nothing to be checked against
 * and the model filled the gap. The fix is the missing fact, plus a
 * read-check rule (read-check.js `historyIssues`) for the claim when it is
 * still made.
 *
 * Pure: the caller reads the rows. Earlier rounds count the scorer's own
 * stored `IsCorrect` (websocket/message.js), the judgement the scoreboard was
 * built from; THIS round uses the tally the prompt itself prints, so the two
 * lines of the prompt cannot disagree.
 */

const ANSWER_SK = /^QUESTION#(\d+)#ANSWER#/;

/**
 * @param {object[]} rows       answer rows of the session (SK + IsCorrect), any order
 * @param {object}   current    { round, correct, answered } for the round being read
 * @returns {null | { rounds: Array<{round, correct, answered}>, allRight: number[],
 *                    priorAllRight: number, streak: number, block: string }}
 *   null before round 2 (there is no "so far" to state) or with nothing counted.
 */
function sessionSoFar(rows, current = {}) {
  const round = Number(current.round);
  if (!(round >= 2)) return null;
  const byRound = new Map();
  for (const row of rows || []) {
    const m = ANSWER_SK.exec(String((row && row.SK) || ''));
    if (!m) continue;
    const n = Number(m[1]);
    if (!(n >= 1) || n >= round) continue; // earlier rounds only; this one comes from `current`
    const r = byRound.get(n) || { round: n, correct: 0, answered: 0 };
    r.answered += 1;
    if (row.IsCorrect === true) r.correct += 1;
    byRound.set(n, r);
  }
  const rounds = [...byRound.values()].sort((a, b) => a.round - b.round);
  const answered = Number(current.answered) || 0;
  if (answered > 0) rounds.push({ round, correct: Number(current.correct) || 0, answered });
  if (rounds.length < 2) return null;

  const everyoneRight = (r) => r.answered > 0 && r.correct === r.answered;
  const allRight = rounds.filter(everyoneRight).map((r) => r.round);
  const prior = rounds.filter((r) => r.round < round);
  const priorAllRight = prior.filter(everyoneRight).length;
  const thisRound = rounds.find((r) => r.round === round) || null;
  // Consecutive everyone-right rounds ending with this one (0 when this one was not).
  let streak = 0;
  if (thisRound) {
    for (let i = rounds.length - 1; i >= 0 && everyoneRight(rounds[i]); i -= 1) {
      if (rounds[i].round !== round - streak) break; // a gap (an unanswered round) ends the run
      streak += 1;
    }
  }

  const lines = [
    'THE SESSION SO FAR — facts about the earlier rounds of this session. Copy them; do not add, subtract or recount.',
    `- Correct answers, round by round: ${rounds.map((r) => `round ${r.round} ${r.correct} of ${r.answered}`).join('; ')}.`,
    allRight.length
      ? `- Everyone who answered was right in ${allRight.length} of ${rounds.length} rounds so far (rounds ${allRight.join(', ')}).`
      : `- No round so far has had everyone right.`,
  ];
  if (thisRound && everyoneRight(thisRound)) {
    lines.push(priorAllRight > 0
      ? `- This is NOT the first round everyone got right: ${priorAllRight} earlier round${priorAllRight === 1 ? '' : 's'} had everyone right too.`
      : '- This is the first round of the session where everyone was right.');
    if (streak >= 2) lines.push(`- Everyone has been right ${streak} rounds in a row, counting this one.`);
  }
  lines.push('Say nothing about earlier rounds ("the first time", "again", "in a row", a streak, a comeback) that these lines do not show.');

  return { rounds, allRight, priorAllRight, streak, block: lines.join('\n') };
}

module.exports = { sessionSoFar };
