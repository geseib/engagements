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

/**
 * THE RACE — who leads after this round and whether that changed, as facts,
 * so the read's "standings nudge" (owner, 2026-11-09: "trivia ... workie
 * response needed tightening up") is copied, never worked out. The prompt
 * already prints the standings; what it never said was the BEFORE, so "takes
 * the lead" (8741 round 14) was a guess the prompt could not check.
 *
 * Pure. `standings` is the leaderboard after this round ([{ name, score }],
 * any order); `roundPoints` is { name: points } scored THIS round. Before =
 * after minus this round. Null with fewer than two players, or before anybody
 * has scored.
 *
 * @returns {null | { leaders: string[], leadersBefore: string[], change: string, gap: number|null, block: string }}
 *   change is 'took' | 'broke-tie' | 'drew-level' | 'held' | 'first'.
 */
function raceSoFar(standings, roundPoints = {}, { round } = {}) {
  const rows = (standings || [])
    .filter((p) => p && typeof p.name === 'string' && p.name && Number.isFinite(Number(p.score)))
    .map((p) => ({ name: p.name, score: Number(p.score), before: Number(p.score) - (Number(roundPoints[p.name]) || 0) }));
  if (rows.length < 2) return null;
  const top = (key) => {
    const best = Math.max(...rows.map((r) => r[key]));
    return { best, names: rows.filter((r) => r[key] === best).map((r) => r.name) };
  };
  const now = top('score');
  if (!(now.best > 0)) return null;
  const was = top('before');
  const list = (names) => (names.length <= 2 ? names.join(' and ') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`);

  const lines = ['THE RACE — the standings after this round, as facts. Copy them; do not add, subtract or recount.'];
  let gap = null;
  if (now.names.length === 1) {
    const second = rows.filter((r) => r.name !== now.names[0]).sort((a, b) => b.score - a.score)[0];
    gap = now.best - second.score;
    lines.push(`- ${now.names[0]} leads on ${now.best} points, ${gap} ahead of ${second.name} on ${second.score}.`);
  } else {
    lines.push(`- ${list(now.names)} are level at the top on ${now.best} points.`);
  }

  let change;
  const same = now.names.length === was.names.length && now.names.every((n) => was.names.includes(n));
  if (!(was.best > 0) || Number(round) === 1) {
    change = 'first';
  } else if (same) {
    change = 'held';
    if (now.names.length === 1) {
      const leader = rows.find((r) => r.name === now.names[0]);
      const gapBefore = leader.before - Math.max(...rows.filter((r) => r !== leader).map((r) => r.before));
      const moved = gap > gapBefore ? 'grew' : (gap < gapBefore ? 'shrank' : 'stayed the same');
      lines.push(`- ${now.names[0]} already led before this round, by ${gapBefore}: the lead did not change hands and the gap ${moved}. Never say ${now.names[0]} "takes" the lead.`);
    } else {
      lines.push('- The top of the table was level before this round too.');
    }
  } else if (now.names.length === 1 && was.names.includes(now.names[0])) {
    change = 'broke-tie';
    lines.push(`- ${now.names[0]} broke a tie at the top this round (level before with ${list(was.names.filter((n) => n !== now.names[0]))}).`);
  } else if (now.names.length === 1) {
    change = 'took';
    lines.push(`- ${now.names[0]} took the lead this round from ${list(was.names)}.`);
  } else {
    change = 'drew-level';
    const caught = now.names.filter((n) => !was.names.includes(n));
    lines.push(`- ${list(caught.length ? caught : now.names)} drew level at the top this round.`);
  }
  lines.push('Mention the race only when a line above is worth a beat (a new leader, a tie at the top, a gap of a point or two); otherwise leave it out. Say nothing about the standings these lines do not show.');

  return { leaders: now.names, leadersBefore: was.names, change, gap, block: lines.join('\n') };
}

module.exports = { sessionSoFar, raceSoFar };
