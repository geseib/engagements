/**
 * ONE NUMBERING FOR EVERY LIST OF ROUNDS: a round's place in the session.
 *
 * The owner, on dev (3 Nov 2026): "i tested adding another question and its
 * list in rounds does not line up". With round 1 playing and one question of
 * the host's own queued next, the console rail's Round queue read
 * 1 (now) · 2 (Yours, next) · 3 · 4 … and the Session menu's Running order read
 * 1 (Yours) · 3 · 4 … — the queued rows were numbered by their place IN THE
 * QUEUE (`queueRows().position`) while the automatic rows under them carried
 * the server's ROUND number (`upNext[].round`), so the list said 1 and then
 * jumped to 3.
 *
 * Both lists now number through `numberRounds`, from the same base the
 * "Round N of M" wording uses: the round on screen (or the last one played).
 * The next round is base + 1, and every row the serve will actually take gets
 * the next number in turn. A row the serve passes over (a parked queue entry:
 * not in the set, no reachable category, an own question no longer waiting)
 * takes NO number, so the list never skips one: the plan gives those no round
 * either (lambda-functions/game/question-plan.js, `servable === false`).
 */

const asCount = (value) => {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
};

/**
 * The round the session is on: the one on screen, or with none on screen the
 * last one played. 0 before the first round. `liveN` is the page's lesson
 * number while a round is live; `played` are the ordinals of rounds played.
 */
export function sessionRoundBase(liveN = 0, played = []) {
  return Math.max(asCount(liveN), ...(played || []).map(asCount), 0);
}

/**
 * The base read from the server's plan, for a surface that has no lesson
 * number of its own (the phone): the plan's first row is the next round, so
 * the base is one less. 0 when the plan carries no round.
 */
export function baseFromPlan(upNext = []) {
  const first = (upNext || []).find((row) => row && asCount(row.round) > 0);
  return first ? asCount(first.round) - 1 : 0;
}

/**
 * The number each row takes, in serve order: base + 1, base + 2, … for every
 * row `skip` does not pass over, and null for those it does. Never a gap.
 */
export function numberRounds(base, rows = [], skip = () => false) {
  let n = asCount(base);
  return (rows || []).map((row, i) => (skip(row, i) ? null : ++n));
}

/**
 * The rail's planned rounds: the server's plan after the round on screen,
 * capped at `room` rows, numbered through `numberRounds` from `base`. The
 * first is "next", the rest "later"; the host's own question is marked.
 */
export function plannedRounds(base, upNext = [], { currentQuestionId = null, room = null } = {}) {
  const rows = (upNext || [])
    .filter((row) => row && String(row.questionId) !== String(currentQuestionId || ''));
  const shown = room === null ? rows : rows.slice(0, Math.max(0, room));
  const ns = numberRounds(base, shown);
  return shown.map((row, i) => ({
    n: ns[i],
    title: row.title || '',
    state: i === 0 ? 'next' : 'later',
    // The host's own question (impromptu ask): Yours on the rail too.
    own: row.source === 'own',
    key: String(row.questionId || '').replace(/^QUESTION#/, ''),
    source: row.source,
  }));
}
