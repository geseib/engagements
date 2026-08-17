/**
 * WHO ACTUALLY PLAYED, out of the rows a `begins_with(SK, 'PLAYER#')` query
 * returns.
 *
 * THE RULE, AND WHY IT KEEPS BEING GOT WRONG. Each participant writes THREE
 * rows under that prefix — `PLAYER#{name}`, `PLAYER#{name}#SCORE` and
 * `PLAYER#{name}#STATE` — so the length of that query's result is about three
 * times the room. `create-report.js` shipped exactly that bug: a four-person
 * session announced twelve players on the front page of its report.
 *
 * That rule now has two readers (the report, and the session-history counts),
 * so it lives here rather than being written a second and third time. A count
 * that is wrong in one place and right in another is worse than one that is
 * wrong everywhere, because nobody can tell which to believe.
 *
 * DEDUPE, NOT JUST FILTER. A player who rejoins can leave more than one
 * `PLAYER#{name}` row behind — the name handover and the rejoin path both write
 * one — so the filtered list still over-counts without the map. The most
 * recently joined record wins, which is what the report wants when it reaches
 * for a player's details.
 *
 * REMOVED PLAYERS ARE KEPT. `player-presence.js` draws the line: counts about
 * the room RIGHT NOW drop them, counts about the session that HAPPENED keep
 * them. Both callers here are the second kind — a report and a history list are
 * records of something that already occurred. A history row saying "8 players"
 * about a session eleven people sat through is a rewritten history.
 */

/** The deduplicated participant records, newest join per name. */
function uniquePlayerRecords(rows) {
  const main = (rows || []).filter((row) => (
    row
    && typeof row.SK === 'string'
    && row.SK.startsWith('PLAYER#')
    && !row.SK.includes('#SCORE')
    && !row.SK.includes('#STATE')
  ));

  const byName = new Map();
  main.forEach((row) => {
    const name = row.PlayerName || row.playerName;
    const existing = byName.get(name);
    if (!existing || (row.JoinedAt && (!existing.JoinedAt || row.JoinedAt > existing.JoinedAt))) {
      byName.set(name, row);
    }
  });

  return Array.from(byName.values());
}

/** How many people took part, counted from the main rows only. */
function countPlayers(rows) {
  return uniquePlayerRecords(rows).length;
}

/**
 * HOW MANY DISTINCT PEOPLE THESE ROWS MENTION — a different question from
 * `countPlayers`, and the right one for a list that reads old sessions.
 *
 * THE THREE ROWS HAVE THREE DIFFERENT LIFETIMES, and that is what makes this
 * necessary:
 *
 *     PLAYER#{name}          7 days   (join-game.js:338)
 *     PLAYER#{name}#SCORE   30 days   (join-game.js:361)
 *     the session itself    90 days   (schema-compliant-manager.js:19)
 *
 * So a session stays in the history list for 90 days, but the rows
 * `countPlayers` reads vanish after 7. Using it for the list would have made
 * the Players column read **0 for every session older than a week** — a
 * confident, wrong number, which is worse than no column at all.
 *
 * This counts distinct names across ANY `PLAYER#` row, which survives as long
 * as the score rows do. The count is trustworthy for 30 days and impossible
 * after that; `get-games-list.js` is what knows the session's age and turns an
 * unknowable zero into null.
 *
 * The report keeps `uniquePlayerRecords`: it runs beside a live session, needs
 * the records themselves and not just a tally, and a score row carries none of
 * the joined-at detail it reads.
 */
function countParticipants(rows) {
  const names = new Set();
  (rows || []).forEach((row) => {
    if (!row || typeof row.SK !== 'string' || !row.SK.startsWith('PLAYER#')) return;
    const name = row.PlayerName || row.playerName;
    // A row with no name cannot be attributed to anybody, and counting it would
    // invent a participant. Every writer sets one — see clean-state-manager.js:99
    // and join-game.js:356 — so an absent name means a row shape we do not know.
    if (name) names.add(name);
  });
  return names.size;
}

module.exports = { uniquePlayerRecords, countPlayers, countParticipants };
