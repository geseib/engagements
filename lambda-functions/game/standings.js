/**
 * THE SCOREBOARD'S NUMBERS — places, ties, and movement since the last round.
 *
 * docs/superpowers/specs/2026-09-25-scoreboard-design.md §4. Two pure pieces,
 * no AWS, so both the writer (get-results.js) and the reader (get-players.js)
 * hold exactly one definition of each rule.
 *
 * ── THE WRITE: scoreRowAfterRound ─────────────────────────────────────────
 *
 * A player's `PLAYER#<name>#SCORE` row holds one running total. Movement needs
 * the total BEFORE the latest round too, so when a round's points land the row
 * also keeps:
 *
 *   prevScore     the total before this round
 *   prevScoredAt  when that total was set — the old row's `updatedAt`, but only
 *                 if the old row came from a SCORED round. The row join-game.js
 *                 writes at `afterRound: "000"` is dated by a join, not a round.
 *
 * Both scoring paths in get-results.js (trivia and call-and-answer) build the
 * item from this, so neither can forget a field the other writes.
 *
 * ── THE READ: computeStandings ────────────────────────────────────────────
 *
 * Places use COMPETITION ranking: equal totals share a place and the next
 * place skips them (81, 78, 72, 66, 66, 63 → 1, 2, 3, 4, 4, 6).
 *
 * The latest round is the highest `afterRound` across the rows. A player whose
 * row is AT that round stood at `prevScore` before it; everybody else's total
 * did not move in it. Ranking those previous totals the same way gives the
 * previous place, and movement is previous place minus place (positive: up).
 *
 * NEW IS DECIDED BY WHEN SOMEBODY JOINED, not by whether a row exists. Every
 * player gets a score row the moment they join (afterRound "000"), so "had a
 * row before the latest round" is true of everybody and could never say NEW.
 * The previous standings were fixed the moment the previous round was scored;
 * whoever joined after that had no place in them. That moment is the latest
 * of: `updatedAt` on rows last scored BEFORE the latest round, and
 * `prevScoredAt` on rows scored IN it. Rows of players who have since been
 * removed still count as evidence of it, which is why `rows` covers everyone
 * while `players` is only the room.
 *
 * When no such moment exists, the latest round is the first one anybody
 * scored in, and the whole board is NEW — the spec's "treat the board's first
 * scored round as all new".
 *
 * A ROW WRITTEN BEFORE `prevScore` EXISTED, at the latest round, has an
 * unknowable previous total. It reads as unchanged (movement 0, no previous
 * score) — never as NEW, which would be a claim about the person rather than
 * about missing data — and stands in the previous ranking at its current
 * total, the best estimate there is.
 */

/** '006' → 6, 6 → 6, '000' / undefined / junk → 0. */
function roundNumber(value) {
  const n = parseInt(String(value ?? '').replace(/\D/g, ''), 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

const isNumber = (v) => typeof v === 'number' && Number.isFinite(v);

/**
 * The score row's fields after `points` land for `round`.
 *
 * @param {object|undefined} existing  the row as it stood, if any
 * @param {number} points              this round's points (> 0; callers skip 0)
 * @param {string} round               the padded round, e.g. '006'
 * @param {string} now                 ISO timestamp
 */
function scoreRowAfterRound(existing, points, round, now) {
  const before = existing ? (Number(existing.score) || 0) : 0;
  const scoredBefore = Boolean(existing) && roundNumber(existing.afterRound) > 0 && Boolean(existing.updatedAt);
  return {
    score: before + points,
    prevScore: before,
    ...(scoredBefore ? { prevScoredAt: existing.updatedAt } : {}),
    afterRound: round,
    updatedAt: now,
  };
}

/** Competition ranks for `values` (a Map key → number): 1 + how many are strictly higher. */
function competitionRanks(values) {
  const all = [...values.values()];
  const ranks = new Map();
  for (const [key, value] of values) {
    ranks.set(key, 1 + all.filter((other) => other > value).length);
  }
  return ranks;
}

/**
 * @param {{ players: {name: string, joinedAt?: string}[], rows: Object<string, object> }} input
 *   players  who is in the room now (removed players excluded)
 *   rows     the PLAYER#<name>#SCORE rows, by name — everyone's, removed included
 * @returns {{ afterRound: number|null,
 *             standings: Map<string, { rank: number, movement: number|'new', previousScore: number|null }> }}
 */
function computeStandings({ players = [], rows = {} } = {}) {
  const rowOf = (name) => (rows && Object.prototype.hasOwnProperty.call(rows, name) ? rows[name] : null);
  const totalOf = (name) => Number(rowOf(name)?.score) || 0;

  const allRows = Object.values(rows || {}).filter(Boolean);
  const latest = allRows.reduce((max, row) => Math.max(max, roundNumber(row.afterRound)), 0);

  // The moment the previous standings were fixed.
  let fixedAt = null;
  for (const row of allRows) {
    const r = roundNumber(row.afterRound);
    const stamp = r > 0 && r < latest ? row.updatedAt : (r === latest ? row.prevScoredAt : null);
    if (typeof stamp === 'string' && stamp && (fixedAt === null || stamp > fixedAt)) fixedAt = stamp;
  }

  const now = new Map(players.map((p) => [p.name, totalOf(p.name)]));
  const ranks = competitionRanks(now);

  const standings = new Map();
  if (latest === 0) {
    for (const p of players) standings.set(p.name, { rank: ranks.get(p.name), movement: 0, previousScore: null });
    return { afterRound: null, standings };
  }

  const legacy = new Set();
  const isNew = new Set();
  const before = new Map();
  for (const p of players) {
    const row = rowOf(p.name);
    const atLatest = row && roundNumber(row.afterRound) === latest;
    if (atLatest && !isNumber(row.prevScore)) {
      legacy.add(p.name);
      before.set(p.name, totalOf(p.name));
      continue;
    }
    if (fixedAt === null || (typeof p.joinedAt === 'string' && p.joinedAt > fixedAt)) {
      isNew.add(p.name);
      continue;
    }
    before.set(p.name, atLatest ? row.prevScore : totalOf(p.name));
  }

  const previousRanks = competitionRanks(before);
  for (const p of players) {
    const rank = ranks.get(p.name);
    if (isNew.has(p.name)) {
      standings.set(p.name, { rank, movement: 'new', previousScore: null });
    } else if (legacy.has(p.name)) {
      standings.set(p.name, { rank, movement: 0, previousScore: null });
    } else {
      standings.set(p.name, { rank, movement: previousRanks.get(p.name) - rank, previousScore: before.get(p.name) });
    }
  }
  return { afterRound: latest, standings };
}

module.exports = { computeStandings, scoreRowAfterRound, roundNumber };
