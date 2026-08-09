/**
 * Which sessions offer anonymous responses, and what setup sends.
 *
 * Kept out of GameHostPage because these are two decisions worth reading on
 * their own, and because that file is 5000 lines.
 */
import { hostRunsVotePhase } from './hostControls';

/**
 * Anonymity applies exactly to the formats that hold a vote — call-and-answer,
 * poll, survey. That is not a new taxonomy: hostRunsVotePhase already computes
 * this set, and deriving from it means the two cannot drift.
 *
 * Trivia's response is a letter, so there is nothing authored to attribute;
 * wavelength never attributes on the stage. For those the option is hidden
 * rather than shown-and-disabled, because an option that cannot do anything is
 * a question a host should not be asked.
 */
export function anonymityApplies(gameType) {
  return hostRunsVotePhase(gameType);
}

/**
 * The anonymity part of the create payload.
 *
 * Sends `false` EXPLICITLY for non-voting types rather than omitting the key.
 * The backend gate defaults ON for anything that is not exactly `false`, so an
 * omitted key would mark a trivia game anonymous with nothing to anonymise —
 * harmless today, confusing in a payload diff, and a trap if trivia ever gains
 * a free-text round.
 */
export function createPayloadFor({ gameType, anonymousResponses } = {}) {
  if (!anonymityApplies(gameType)) return { anonymousUntilReveal: false };
  return { anonymousUntilReveal: anonymousResponses !== false };
}

/**
 * A row is redacted when it has no usable author, which is the client half of
 * the backend's omit-don't-null rule. Treats null and '' as redacted too, so a
 * partial payload can never render an empty label or the string "null".
 */
export function isRedacted(answer) {
  return !(answer && typeof answer.playerName === 'string' && answer.playerName.length > 0);
}

/**
 * What to print above an answer. `Response N` is 1-based because it is read
 * aloud in a room — "look at response three", not "response two".
 */
export function displayLabelFor(answer, index) {
  return isRedacted(answer) ? `Response ${index + 1}` : answer.playerName;
}

/**
 * Whether THIS game actually withheld authorship — the type supports it AND
 * the host didn't turn it off for this particular game. `anonymousUntilReveal`
 * is the per-game flag from setup (createPayloadFor), read back from
 * get-game.js, which already normalizes it with the same default-ON rule the
 * backend gate uses — only an explicit `false` turns it off — so this trusts
 * whatever boolean it was handed rather than re-deriving a default.
 *
 * A game whose type supports anonymity but that had it explicitly switched
 * off never had anything to hide, so nothing here should ever gate on it:
 * standings stay visible throughout, and there is no reveal to offer.
 */
export function anonymityActive({ gameType, anonymousUntilReveal }) {
  return anonymityApplies(gameType) && anonymousUntilReveal !== false;
}

/**
 * Whether standings may be shown. See §5.6.4: a live leaderboard during an
 * anonymous round is attribution by arithmetic, so it waits for the reveal —
 * but only for a round that is actually anonymous in the first place.
 */
export function standingsVisible({ gameType, anonymousUntilReveal, authorsRevealed } = {}) {
  return !anonymityActive({ gameType, anonymousUntilReveal }) || authorsRevealed === true;
}
