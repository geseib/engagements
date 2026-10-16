/**
 * IS THIS ROUND ANSWER ON TIME, LATE, OR REFUSED? (session flow v3 §4.4)
 *
 * An answer for round n is on time while the session is at ASK#n. It is LATE,
 * and kept apart from the round, when it reaches the server after round n
 * moved on: VOTE#n, RESULTS#n, or any later round. It is refused before its
 * round started, for a round that never ran, once the session has ENDED (owner,
 * 15 Oct, Q4: a late answer to a round is accepted only while the session is
 * running), and for anything that is not a round (a survey).
 *
 * A late answer is never added to votes, scores, Workie's read or the session
 * meter (session-count.js): it is kept so the host can review it, and the
 * report lists it under "Arrived late".
 */
const ROUND = /^(ASK|VOTE|RESULTS?)#(\d+)$/i;

function answerTiming(state, round) {
  const n = Number(round);
  const m = ROUND.exec(String(state || '').trim());
  if (!m || !Number.isInteger(n) || n < 1) return 'refused';
  const at = Number(m[2]);
  const kind = m[1].toUpperCase();
  if (at === n) return kind === 'ASK' ? 'on-time' : 'late';
  return at > n ? 'late' : 'refused';
}

/** 30 days, as comments: the report needs it as long as it needs them. */
const LATE_TTL_DAYS = 30;

module.exports = { answerTiming, LATE_TTL_DAYS };
