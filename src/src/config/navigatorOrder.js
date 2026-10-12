/**
 * ONE ORDER FOR "RESPONSE N" (docs/design/two-surface/PLAN.md D5, task 1.7).
 *
 * `/stage-focus` stores an INDEX, and an index means nothing without an
 * order. Two surfaces used to read it against two orders: the host page's
 * spotlight indexed its tally rows (assignPlacements), the Remote's list the
 * display order of /answers/host. At RESULTS, "Show response 2" on the phone
 * could put a different response on the wall. This module is the one
 * definition both read.
 *
 *   VOTE    — the voting order every ballot shows: answer-order.js's seeded
 *             per-round shuffle, already applied by /answers. Names never
 *             travel in this order (the owner's ruling: during voting the
 *             wall says "Response 3 · name hidden").
 *   RESULTS — tally order: most points first (then most votes), ties kept in
 *             voting order, through config/podium.js's assignPlacements.
 */
import { assignPlacements } from './podium';

const NAME_FIELDS = ['playerName', 'name', 'PlayerName', 'player', 'author', 'submittedAt'];

/** /answers in its own (voting) order, each row stamped with `position`, no names. */
export function voteOrder(answers) {
  if (!Array.isArray(answers)) return [];
  return answers.map((row, position) => {
    const out = { ...(row || {}), position };
    for (const field of NAME_FIELDS) delete out[field];
    return out;
  });
}

/**
 * get-results' `voteTallies` (keyed by display position, or an array in
 * display order) in tally order. `answers`, when given, fills in any response
 * the tally is missing, last and pointless, in voting order.
 */
export function tallyOrder(voteTallies, answers = []) {
  const entries = Array.isArray(voteTallies)
    ? voteTallies.map((t, i) => [i, t])
    : Object.entries(voteTallies && typeof voteTallies === 'object' ? voteTallies : {})
      .map(([key, t]) => [Number(key), t])
      .filter(([key]) => Number.isInteger(key) && key >= 0);

  const rows = entries
    .filter(([, t]) => t && typeof t === 'object')
    .map(([position, t]) => ({
      position,
      playerName: t.playerName,
      answer: t.answerText,
      points: Number(t.totalScore) || 0,
      votes: (Number(t.firstPlace) || 0) + (Number(t.secondPlace) || 0) + (Number(t.thirdPlace) || 0),
    }));

  const seen = new Set(rows.map((r) => r.position));
  (Array.isArray(answers) ? answers : []).forEach((a, position) => {
    if (seen.has(position)) return;
    rows.push({ position, playerName: a && a.playerName, answer: a && a.answer, points: 0, votes: 0 });
  });

  // Voting order first, so the stable sort inside assignPlacements keeps it
  // on every tie.
  rows.sort((x, y) => x.position - y.position);
  return assignPlacements(rows);
}

/** The row at `index`, or null when there is none. */
export function responseAt(order, index) {
  if (!Array.isArray(order) || !Number.isInteger(index) || index < 0) return null;
  return order[index] || null;
}
