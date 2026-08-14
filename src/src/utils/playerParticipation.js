/**
 * HAS THIS PLAYER ALREADY RESPONDED — asked of the server, and read safely.
 *
 * Reported from a live session: *"if a player switches away from the tab after
 * answering or voting, the screen resets as if they have not already
 * answered."* Coming back re-offers the form to someone who is already done,
 * mid-round, in a room — and inviting a second submission is the harm, not the
 * wrong pixels.
 *
 * ── WHY THE TAB SWITCH IS WHAT TRIGGERS IT ─────────────────────────────────
 *
 * PlayerPage resyncs on `visibilitychange`, `focus`, `online` and `pageshow`
 * (the A2 resume handler — it exists to survive a phone lock and a bfcache
 * restore, and it should stay). Every one of those calls `checkGameState`,
 * which re-reads participation. So the reset is not caused by leaving the tab;
 * it is caused by the re-read that returning triggers, and any resync would do
 * it. Backgrounding a tab is simply the easiest way to provoke one.
 *
 * ── THE TWO FAULTS ─────────────────────────────────────────────────────────
 *
 * 1. IT ASKED THE WRONG ENDPOINT. Both checks read `GET /games/{id}/state` and
 *    then dug through `answerProgress.answererIds` / `votingProgress.votersIds`
 *    — the HOST's roster lists. That request carries no player identity at all,
 *    so get-game-state.js takes its `if (!playerId || includeHostData)` branch
 *    and answers as though a host had asked. Worse, those two lists are emitted
 *    only during their own phase: `answerProgress` exists solely while the state
 *    is `ASK#`, `votingProgress` solely while it is `VOTE#`. Resync during
 *    RESULTS, or in the beat after the host closes the round, and the list the
 *    check depends on is simply not in the payload.
 *
 *    `GET /games/{id}/state/{playerName}` already existed and already answers
 *    this exact question — `playerQuestionState.hasAnswered` / `.hasVoted`, each
 *    a direct GetItem on that player's own answer and vote rows
 *    (`QUESTION#{nnn}#ANSWER#{playerName}`). It is gated on there being a
 *    current question rather than on the phase, so it keeps answering after the
 *    round moves on. Nothing in the client had ever called it.
 *
 * 2. "I COULD NOT FIND OUT" WAS REPORTED AS "YOU DID NOT RESPOND". The answer
 *    path already knew this — its doc-block spelled out that collapsing the two
 *    "is what lets a single flaky refresh throw away a submitted answer" — and
 *    returned `null` for the unknown case. The VOTE path returned plain `false`
 *    from three separate exits (not-ok response, missing list, thrown error) and
 *    its caller assigned that straight into state. So on the vote screen every
 *    unreadable resync actively un-voted the player. One path was hardened and
 *    the other was left, which is the argument for both of them living here.
 *
 * Kept out of PlayerPage.jsx for the reason config/anonymity.js and
 * utils/nextQuestion.js give: a rule spread through a several-thousand-line
 * component is a rule that gets re-derived by hand at each call site, which is
 * exactly how fault 2 came to exist in one path and not the other.
 *
 * NOT because the component is untestable — `__tests__/playerAnswerPersistence
 * .test.jsx` mounts PlayerPage and drives real `visibilitychange` events
 * through it, and that suite is where these fixes are proved end to end. (Its
 * own `PlayerPage.test.jsx` is one of the five suites that have never run, which
 * is a different and older problem.) The two levels do different work: the
 * mounted suite proves the screen behaves, and the unit tests below pin the
 * decision itself, including the combinations a mounted test would need a
 * fixture apiece to reach.
 */

/**
 * Where to ask about one player.
 *
 * The name is a PATH SEGMENT, and player names are free text typed on a phone —
 * spaces, slashes, emoji, '#'. Un-encoded, "Dana R/W" would address a route
 * that does not exist and a '#' would truncate the request at the fragment.
 * Names are the primary key for players in this system (`PLAYER#{playerName}`),
 * so this is the id, not a display string.
 */
export function participationUrl(apiBase, gameId, playerName) {
  return `${apiBase}games/${encodeURIComponent(gameId)}/state/${encodeURIComponent(playerName)}`;
}

/**
 * What a `/state/{playerName}` payload says about this player's round.
 *
 * `null` means THE PAYLOAD DID NOT SAY — a response from before a question
 * started, a partial body, a shape that changed. It never means "no". Every
 * caller has to treat the two differently or fault 2 above comes back.
 *
 * Anything that is not a real boolean reads as `null` rather than being coerced.
 * A missing key, an explicit `null`, and the string "false" are all "did not
 * say"; `Boolean("false")` is `true`, which is exactly the kind of coercion
 * that would mark an unanswered player as done.
 */
export function participationFrom(stateData) {
  const round = stateData && stateData.playerQuestionState;
  const flag = (value) => (typeof value === 'boolean' ? value : null);
  return {
    answered: flag(round && round.hasAnswered),
    voted: flag(round && round.hasVoted),
    // Which round the answer is ABOUT. A payload that raced the host onto the
    // next question describes a different round than the screen does, and a
    // caller that cannot tell would carry a stale `true` into a fresh question
    // and suppress the form for someone who has not responded to it.
    questionNumber: (round && round.questionNumber) ?? null,
  };
}

/**
 * THE RULE THAT DECIDES WHAT THE PLAYER SEES, and the whole point of the module.
 *
 * The server wins whenever it has an opinion. When it does not, only a genuinely
 * NEW question may lower the flag — a refresh that learned nothing must never
 * un-answer somebody. Lifted verbatim from the guard the answer path already
 * had, so that the vote path is now held to the same rule instead of a weaker
 * one written separately.
 *
 * Note the asymmetry, which is deliberate: an unknown result on the SAME
 * question preserves whatever the screen already believed — including a `true`.
 * The failure modes are not equal. Wrongly showing "your answer is in" to
 * someone who has not answered costs them one round; wrongly re-offering the
 * form to someone who has answered invites a duplicate submission and tells
 * them, in front of a room, that their response was lost.
 */
export function nextParticipation({ current, server, isNewQuestion }) {
  if (typeof server === 'boolean') return server;
  if (isNewQuestion) return false;
  return current === true;
}
