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
 * What to print above an answer when the STAGE has its own opinion.
 *
 * `displayLabelFor` decides from the row alone, which is right for a payload
 * the server redacted. It is wrong for the RESULTS view, where every row
 * already carries its author (voting closed, so the server sent the names) and
 * the host wants the projector to stop showing them again. Passing
 * `authorsHidden` makes the label obey the stage instead of the row.
 *
 * DISPLAY ONLY, AND SAY SO. The payload was already delivered; this un-sends
 * nothing. It is a projector control, never a security control.
 */
export function stageLabelFor(answer, index, { authorsHidden } = {}) {
  return authorsHidden ? `Response ${index + 1}` : displayLabelFor(answer, index);
}

/**
 * What the host must do when a `playerAnswered` frame arrives.
 *
 * THE FRAME IS REDACTED WHILE A ROUND IS HIDDEN — message.js strips
 * `playerName` on purpose, so the host learns THAT somebody answered without
 * learning who. Both facts have to survive that:
 *
 *   - `refetchQuestion` is unconditional. It is what repopulates the host's
 *     `answers` array, and `answers.length` is the only thing that enables the
 *     ASK primary (hostControls.js: 'Nobody has answered yet'). There is no
 *     poll behind it; if this is skipped the host can never start voting, which
 *     is the normal path for an anonymous call-and-answer round.
 *   - `markAnswered` is the name, when there is one. Absent on a hidden round,
 *     where the roster ticks come from the server's participation list instead
 *     (get-game-state's answerProgress.answererIds).
 *
 * Returned as a decision rather than performed here so it can be tested
 * without mounting a 5000-line component.
 */
export function playerAnsweredActions(data) {
  const frame = data || {};
  const name = typeof frame.playerName === 'string' && frame.playerName.length > 0
    ? frame.playerName
    : null;
  const question = frame.questionNumber ?? null;
  return { markAnswered: name, refetchQuestion: question };
}

/**
 * The author names carried by a list of answer rows, with the redacted ones
 * dropped rather than kept as `undefined`.
 *
 * The host's "who has answered" ticks match on player name, so a list of
 * `undefined` ticks nobody — and worse, overwrites the correct list the server
 * already supplied. Callers must treat an empty result as "this payload says
 * nothing about participation" and leave the existing list alone, which is
 * exactly what a fully-redacted round returns.
 */
export function answeredNamesFrom(answers) {
  return (answers || [])
    .map((a) => (a && typeof a.playerName === 'string' ? a.playerName : ''))
    .filter(Boolean);
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
 * Whether standings may be shown ALONGSIDE A ROUND'S ANSWERS. See §5.6.4: a
 * score printed next to a response is attribution by arithmetic — it names the
 * author as surely as a label would — so it goes wherever the names go.
 *
 * SCOPED TO THE RESULTS VIEW, deliberately. This used to gate the per-player
 * score on the persistent roster, which renders in every phase, so it deleted
 * standings from LOBBY, ASK and VOTE as well and kept round 3's
 * already-revealed totals hidden all through round 4 — with nowhere else for
 * the host to see them. A cumulative total during an unrevealed round leaks
 * nothing anyway: no points exist until RESULTS, and entering RESULTS is what
 * reveals.
 *
 * `authorsRevealed` here is whatever currently decides the labels — on the
 * RESULTS stage that is the local display toggle, not the server flag, so that
 * hiding the names takes the arithmetic with it.
 */
export function standingsVisible({ gameType, anonymousUntilReveal, authorsRevealed } = {}) {
  return !anonymityActive({ gameType, anonymousUntilReveal }) || authorsRevealed === true;
}

/**
 * Which ballot row is this player's own.
 *
 * A player seeing their own answer marked is correct and not a leak (§5.6.7).
 * But the ballot is redacted, so the only handle is the text they submitted.
 * Returns -1 when there is no match, including for an empty submission — which
 * must never match row 0.
 */
export function ownAnswerIndex(ballot, ownAnswerText) {
  const needle = String(ownAnswerText ?? '').trim();
  if (!needle) return -1;
  return (ballot || []).findIndex(
    (row) => String(row?.answer ?? '').trim() === needle
  );
}
