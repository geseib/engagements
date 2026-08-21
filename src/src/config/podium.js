/**
 * The podium — who the room's screen may name, and when.
 *
 * The owner's rulings, in force: **top three, never a full roster**; **RESULTS
 * and ENDED only**; **wavelength gets none**. This module is the whole of that
 * decision, kept out of GameHostPage.jsx for the reason `config/hostControls.js`
 * gives — that file needs an AuthProvider to render at all, so a rule written
 * inside it is a rule nothing can test.
 *
 * WHY THIS IS NOT A ROSTER, AND WHY THAT DISTINCTION IS THE WHOLE POINT.
 * A roster is every name, unordered, complete, and it says who is present and
 * who is late. A podium is three names, ordered, earned, and it says what the
 * room just did. The first is surveillance; the second is why people came.
 *
 * This used to read "`RoomMeter` refuses to name anybody and keeps refusing".
 * IT NO LONGER DOES, and it has since moved twice, so here is the current
 * state rather than a note about the last change:
 *
 *   1. The owner decided the meter may name WHO IS STILL WAITING during a
 *      round, on demand (RoomMeter.jsx's doc-block, anonymity.js's
 *      `waitingRoster`).
 *   2. The owner has now ALSO asked the LOBBY to name WHO HAS JOINED
 *      (`joinedRoster`) — *"so we know who has joined, and for small groups
 *      easily see who is missing."* An earlier version of this file said the
 *      lobby was excluded precisely because a joined list is the opposite
 *      polarity; that exclusion is retired, and the reasoning is kept in
 *      `joinedRoster` rather than deleted.
 *
 * NONE OF IT REACHES THE PODIUM, which is the only reason this paragraph is
 * short. The podium's limits are its own: three names, ordered, earned, and
 * only where a result exists. What the pair still guarantees between them is
 * the thing that matters here — a full roster WITH SCORES never goes on the
 * wall. The meter's lists carry no score at all (that is `standingsVisible`'s
 * job, and it is unmoved), and the podium's three carry one but are never the
 * roster.
 */
import { standingsVisible } from './anonymity';
import { hostRunsVotePhase } from './hostControls';

/** Three. A podium, not a leaderboard. */
export const PODIUM_SIZE = 3;

/**
 * The two states that have a result to celebrate.
 *
 * These are also exactly the states where `RoomMeter` returns null
 * (GameHostPage's meter block), which is not a coincidence: the podium exists
 * precisely where the meter does not, so nothing competes for the space and
 * nothing has to be dropped to make room.
 */
const PODIUM_PHASES = new Set(['RESULTS', 'ENDED']);

/**
 * Rankings with ties handled: equal scores share a rank, and the next player
 * skips the ones they tied with (9, 9, 3 → ranks 1, 1, 3).
 *
 * MOVED HERE FROM GameHostPage.jsx, not copied. The podium needs exactly this
 * arithmetic, and the page still imports it for the session-report modal, so
 * there is one definition rather than two that drift. (`PlayerPage.jsx` and
 * `config/setupPanel.js` each hold their own; folding those in is a separate
 * change to files this one does not own.)
 */
export const calculatePlayerRankings = (players) => {
  // Sort players by score (descending)
  const sortedPlayers = [...players].sort((a, b) => (b.score || 0) - (a.score || 0));

  let currentRank = 1;
  const rankedPlayers = [];

  for (let i = 0; i < sortedPlayers.length; i++) {
    const player = sortedPlayers[i];
    const playerScore = player.score || 0;

    // If this isn't the first player and score is different from previous,
    // update rank to current position + 1
    if (i > 0 && playerScore !== (sortedPlayers[i - 1].score || 0)) {
      currentRank = i + 1;
    }

    rankedPlayers.push({
      ...player,
      rank: currentRank
    });
  }

  return rankedPlayers;
};

/**
 * A place, said as a place: 1 → "1st", 2 → "2nd", 3 → "3rd", 11 → "11th".
 * 0/undefined — "no place", an unvoted answer — stays the quiet dot the card
 * has always drawn.
 */
export const placeLabel = (n) => {
  const place = Number(n) || 0;
  if (place <= 0) return '·';
  const tail = place % 100;
  const suffix = (tail >= 11 && tail <= 13) ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' }[place % 10] || 'th');
  return `${place}${suffix}`;
};

/**
 * An answer's PLACE in the round's standings, by total points, ties shared.
 *
 * The owner, watching three cards all badged "1": that badge was
 * `firstPlace > 0 ? 1 : …` — "the best rank any single voter gave it" — so any
 * answer with one first-choice vote wore a 1 regardless of where it actually
 * finished. It only ever looked right when totals happened to agree with it.
 * This is the same shared-tie arithmetic as calculatePlayerRankings, applied
 * to answers: equal points share a place, and a genuine three-way tie is
 * three 1sts — the display refusing to invent a winner the vote did not pick.
 */
export const assignPlacements = (answers) => {
  const order = [...answers].sort((a, b) => (b.points || 0) - (a.points || 0));
  const placeOf = new Map();
  let currentRank = 1;
  order.forEach((row, i) => {
    if (i > 0 && (row.points || 0) !== (order[i - 1].points || 0)) currentRank = i + 1;
    placeOf.set(row, currentRank);
  });
  return answers.map((row) => ({ ...row, placement: (row.points || 0) > 0 ? placeOf.get(row) : 0 }));
};

/**
 * What to call the top card.
 *
 * NAMED BY WHAT THE NUMBER IS. On a voted format the points are votes other
 * people gave you, so the honest word is "backed"; on trivia they are answers
 * you got right. A single "Champion" across both is wrong twice over — it
 * misdescribes the voted number, and it puts a game-show framing on a strategy
 * session, which is the specific objection the ENDED review records.
 */
function labelFor(rank, gameType) {
  if (rank !== 1) return `${rank}${rank === 2 ? 'nd' : rank === 3 ? 'rd' : 'th'}`;
  return hostRunsVotePhase(gameType) ? 'Most backed' : 'Top score';
}

/**
 * The podium, as data. An empty array means there is no podium — which is a
 * legitimate and common answer, not a failure.
 *
 * Three gates, and the order matters only in that each is cheap:
 *
 *  1. **Phase.** RESULTS and ENDED, per the owner.
 *  2. **Anonymity** — `standingsVisible`, the same predicate the answer cards
 *     already use. A score beside a response is attribution by arithmetic, and
 *     a session podium is a score table for the whole session, so it goes
 *     wherever the names go. `authorsRevealed` is whatever currently decides
 *     the labels: on RESULTS that is the local display toggle, so hiding the
 *     names takes the arithmetic with it; on ENDED it is the server flag.
 *  3. **Capability, not game type.** Only players who actually scored appear,
 *     so a session that produced no points produces no podium — without this
 *     module knowing anything about type strings. Wavelength writes no scores
 *     at all (`get-results.js:952-960` hardcodes `totalScore: 0` under a
 *     comment saying it will be calculated elsewhere; nothing calculates it),
 *     so it falls out here rather than being named and excluded. Survey is
 *     flagged rather than settled in `gameTypes.js:64-69`, and a capability
 *     gate means it cannot produce an empty podium if that ever changes.
 */
export function podiumEntries({
  phase,
  gameType,
  anonymousUntilReveal,
  authorsRevealed,
  players = [],
} = {}) {
  if (!PODIUM_PHASES.has(phase)) return [];
  if (!standingsVisible({ gameType, anonymousUntilReveal, authorsRevealed })) return [];

  return calculatePlayerRankings(players || [])
    .filter((player) => (player.score || 0) > 0)
    .slice(0, PODIUM_SIZE)
    .map((player) => ({
      rank: player.rank,
      name: player.name || player.playerName || 'Unknown Player',
      score: player.score || 0,
      label: labelFor(player.rank, gameType),
    }));
}
