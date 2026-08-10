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
 * `RoomMeter` refuses to name anybody and keeps refusing. A roster is every
 * name, unordered, complete, and it says who is present and who is late. A
 * podium is three names, ordered, earned, and it says what the room just did.
 * The first is surveillance; the second is why people came.
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
