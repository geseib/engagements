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
 * What to print above an answer when THE SESSION SETTING has its own opinion.
 *
 * `displayLabelFor` decides from the row alone, which is right for a payload
 * the server redacted. It is wrong for the RESULTS view, where every row
 * already carries its author — get-results.js's enterResultsState sets
 * AuthorsRevealed unconditionally, so the server sends the names whether or not
 * this session attributes them. Passing `authorsHidden` makes the label obey
 * the host's setting instead of the row.
 *
 * `authorsHidden` USED TO BE A PER-ROUND PROJECTOR TOGGLE (`authorsHiddenOnStage`,
 * a Show/Hide button on the RESULTS stage) and it is now the session setting —
 * `anonymityActive({ gameType, anonymousUntilReveal })`, i.e. one flag, set in
 * one place, for the whole session. The owner ruled out a per-round override:
 * *"Just leave the decision to the host."* The old toggle's reasoning is kept
 * rather than deleted, because the half of it that mattered is still true:
 *
 * DISPLAY ONLY, AND SAY SO. The payload was already delivered; this un-sends
 * nothing. It is a projector control, never a security control. What the
 * setting DOES change on the wire is the other direction — switching
 * attribution ON reveals the round server-side, and that cannot be taken back.
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
 * The server's participation list, out of a `/games/{id}/state` payload.
 *
 * `answerProgress.answererIds` is the authoritative answer to "who has acted",
 * and it is deliberately public — get-answers.js:216 spells out why: "who has
 * not acted yet is a different fact from who wrote what". get-game-state.js
 * emits it only under `?includeHostData=true` and only while the round is in
 * `ASK#`, so a payload without it is not "nobody has answered" — it is "this
 * payload says nothing about participation".
 *
 * RETURNS null FOR THAT CASE, and a list otherwise. The distinction is the
 * whole reason this is a function: a caller that read a missing `answerProgress`
 * as `[]` would blank `playersWhoAnswered` every time a refresh raced the round
 * into VOTE, which is the same clobber `answeredNamesFrom`'s doc-block warns
 * about from the other direction.
 *
 * Blanks dropped and names deduplicated, matching `rosterNames` below: the
 * count derived from this list (answeredCountFrom) would otherwise be inflated
 * by a duplicate row, and a blank would inflate the freshness check in
 * waitingRoster and unblock a stale list.
 */
export function answererIdsFrom(stateData) {
  const ids = stateData && stateData.answerProgress && stateData.answerProgress.answererIds;
  if (!Array.isArray(ids)) return null;
  return Array.from(new Set(
    ids.filter((n) => typeof n === 'string' && n.length > 0)
  ));
}

/**
 * How many responses are in for the round on the stage.
 *
 * THE METER'S NUMERATOR, and it needs two sources because on a hidden round
 * neither is complete on its own:
 *
 *   - `answeredNames` is the server's participation list, written by
 *     restoreGameState from `answerProgress.answererIds`. Authoritative, but
 *     only as fresh as the last resync — and nothing resyncs when an answer
 *     lands, so on its own this froze the count until the host happened to
 *     refocus the tab or the socket reconnected.
 *   - `answerRows` is the `/answers` payload, refetched on EVERY `playerAnswered`
 *     frame (that refetch is unconditional — see playerAnsweredActions). One row
 *     per responder, redacted or not, so its length is the live count even when
 *     it carries no names at all.
 *
 * The larger of the two, never a sum: they describe the same people. The rows
 * lead between resyncs; the server's list leads in the moment after a restore,
 * before the first `/answers` call has returned.
 */
export function answeredCountFrom(answeredNames, answerRows) {
  return Math.max((answeredNames || []).length, (answerRows || []).length);
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
 *
 * ONE FLAG, TWO PLACES TO SET IT, AND THAT IS THE WHOLE DESIGN. The owner asked
 * for author reveal to become *"just a setting on the settings tab in the
 * session sidebar"*. That setting IS `anonymousUntilReveal` — the same per-game
 * flag `createPayloadFor` sends at setup and `get-game.js` reads back — surfaced
 * a second time while the session is running, NOT a new switch beside it. There
 * is deliberately no second "attribute authors" boolean anywhere: a pair of
 * flags for one decision, with a doc-block explaining which wins, is the bug
 * this file exists to stop shipping. The Settings tab's checkbox is
 * `anonymousUntilReveal === false`, and every consumer keeps asking this one
 * predicate.
 *
 * WHAT THE HOST'S CHOICE COSTS ON THE WIRE, because the two directions are not
 * symmetric and the copy at the control says so:
 *   - turning attribution ON has to reach the server. The server, not the
 *     client, is what strips the names (lambda-functions/game/anonymity.js), so
 *     the host page reveals the round in play (POST /reveal-authors) when this
 *     flips to `false`. That is irreversible for that round.
 *   - turning it back OFF is display-only. The names are already delivered;
 *     the stage stops printing them (`stageLabelFor`) and the arithmetic goes
 *     with them (`standingsVisible`), but nothing is un-sent.
 */
export function anonymityActive({ gameType, anonymousUntilReveal }) {
  return anonymityApplies(gameType) && anonymousUntilReveal !== false;
}

/**
 * ARE THIS ROUND'S AUTHORS STILL HIDDEN, RIGHT NOW.
 *
 * `anonymityActive` answers a different and weaker question — "does this SESSION
 * withhold authorship" — and it is true for the whole of a call-and-answer game
 * whose host left the default on. It is the first half of the setting's name.
 * This is the second half: *until reveal*. The reveal is not a maybe and not a
 * button any more; closing a round performs it, server-side and unconditionally
 * (get-results.js's enterResultsState, `Unconditional SET, so it is idempotent`),
 * and `authorsRevealed` is that write read back — from get-game-state on a
 * restore, from the `authorsRevealed` socket frame, or set locally the moment
 * the host closes the round.
 *
 * THE BUG THIS EXISTS TO STOP, reported live and worth naming because the shape
 * recurs: the RESULTS stage asked `anonymityActive` on its own. So on every
 * anonymous call-and-answer session the names never came back and the podium
 * never appeared — not at RESULTS, not ever — while the server had already sent
 * every author. The predicate was RIGHT in this file (`standingsVisible` below
 * has always had this shape) and WRONG at the three call sites that re-derived
 * it, which is precisely the argument for naming it once.
 *
 * `!== true` rather than `=== false`: an absent flag is not a reveal.
 */
export function authorsHiddenNow({ gameType, anonymousUntilReveal, authorsRevealed } = {}) {
  return anonymityActive({ gameType, anonymousUntilReveal }) && authorsRevealed !== true;
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
 * Exactly the negation of `authorsHiddenNow`, and now written as one so the two
 * cannot drift: the scores go wherever the names go is not a resemblance
 * between two rules, it is one rule asked from both directions.
 */
export function standingsVisible({ gameType, anonymousUntilReveal, authorsRevealed } = {}) {
  return !authorsHiddenNow({ gameType, anonymousUntilReveal, authorsRevealed });
}

/**
 * The roster as a list of names — deduplicated, blanks dropped.
 *
 * Deduplicated because the roster is keyed by name everywhere else in this
 * product (join-game.js writes PLAYER#{playerName}, which is why two people
 * called Chris silently merge) and because a repeated name would print the same
 * person twice on the wall. Blanks dropped because a roster entry with no name
 * would otherwise render as an empty pill.
 *
 * One helper rather than two copies: `waitingRoster` subtracts from it and
 * `joinedRoster` prints it, and the two must agree on what counts as a person
 * or the lobby and the round would name different rooms.
 */
function rosterNames(players) {
  return Array.from(new Set(
    (players || [])
      .map((p) => (p && (p.name || p.playerName)) || '')
      .filter((n) => typeof n === 'string' && n.length > 0)
  ));
}

/**
 * WHO HAS JOINED — the LOBBY's reveal, and the one list in this file whose
 * polarity is the people who HAVE acted rather than the people who have not.
 *
 * THE OWNER CHANGED THIS CALL, AND THE OLD REASONING IS RECORDED RATHER THAN
 * DELETED. This file, RoomMeter.jsx and config/podium.js all used to say the
 * lobby keeps a bare count, on the grounds that the only list a lobby can draw
 * is who has JOINED — the opposite polarity to "still waiting", and the
 * polarity the answer phases forbid. The owner has now asked for exactly that
 * list: *"the lobby list is great, so we know who has joined, and for small
 * groups easily see who is missing."* Both halves of that sentence are the
 * reason it is a different feature rather than the rejected one: there is no
 * invite list anywhere in this system, so nothing here can compute who is
 * missing — a host of twelve reads the joined names and does that subtraction
 * from their own knowledge of who was expected.
 *
 * IT IS A DIFFERENT LIST AND IT MUST READ AS ONE. RoomMeter labels this in the
 * lobby's own words ("Already joined"); a list of joiners under a waiting
 * caption would be an accusation rather than a nudge, and that is the failure
 * mode this polarity has.
 *
 * NO ANONYMITY GATE, AND THAT IS A DECISION, NOT AN OMISSION. `waitingRoster`'s
 * gate exists because naming the waiters hands the room the ANSWERER set by
 * subtraction, shrinking the anonymity set of the responses on the stage. In
 * the lobby there are no responses: no round has opened, `answers` is empty,
 * and there is nothing on the wall to attribute to anyone. Joining is not a
 * response — `anonymityActive` is about authorship of ANSWERS — and the roster
 * is not secret from the room in the first place: every player's own screen
 * lists it and get-players is unauthenticated. Routing this through
 * MIN_ANONYMOUS_ANSWERS would gate the lobby on a round that does not exist,
 * and since the response count there is always 0 it would suppress the list
 * permanently on every anonymous format — i.e. delete the feature that was
 * asked for while appearing to ship it.
 *
 * NO FRESHNESS GUARD EITHER, for the same structural reason: this is not a
 * subtraction, so there is no second source that can fall behind it. It is the
 * roster, printed. (`playerJoined` refetches the roster on every arrival, so it
 * is also the freshest list on this page.)
 *
 * Returns `null` for "nothing to offer" — an empty room — matching
 * waitingRoster so the call site can treat both the same way.
 */
export function joinedRoster({ players } = {}) {
  const roster = rosterNames(players);
  return roster.length ? roster : null;
}

/**
 * THE ROUND SIZE BELOW WHICH THE SUBTRACTION ACTUALLY IDENTIFIES SOMEBODY.
 *
 * THIS USED TO BE A GATE AND IT IS NOW A SENTENCE. The name is unchanged so
 * that anyone who grepped for the old rule lands here. `waitingRoster` used to
 * read:
 *
 *     if (hidden && answerCount < MIN_ANONYMOUS_ANSWERS) return null;
 *
 * — the waiting list simply withheld on an anonymous round until five responses
 * were in, with no way for a host to say otherwise. THE OWNER OVERRULED THAT:
 * *"i said it was ok to reveal names if the host really wants to. in small
 * groups it might be required that all fill out, but we dont want to force all
 * to fill out. the host has the info and the control."* The block also failed
 * exactly the room the owner runs — a team of four never reaches five
 * responses, so on that session the list was dead for the whole game and
 * nothing on screen said why.
 *
 * THE REASONING BEHIND THE NUMBER IS STILL TRUE, WHICH IS WHY IT IS KEPT.
 * Naming the waiters hands the room the answerer set by subtraction, which
 * drops every response on the stage from "one of N players" to "one of k".
 * k = 1 is certain attribution. k = 2 is a coin flip. k = 3 is PODIUM_SIZE —
 * the number this design already picked as "a list a room can hold in its
 * head", which is exactly the wrong property here. 5 is the first k where the
 * room's best guess is worse than one in four.
 *
 * So the number now decides HOW THE CAUTION IS WORDED (`waitingNamesCaution`),
 * not whether the host may proceed. Information, not gating: the host is told
 * what the list would give away, with the live response count in the sentence,
 * and then decides. It stays one named constant so the owner can move it in one
 * place after a rehearsal, which is still the only evidence that could settle
 * it.
 */
export const MIN_ANONYMOUS_ANSWERS = 5;

/**
 * WHAT TO TELL THE HOST NEXT TO THE "name who is still waiting" CONTROL.
 *
 * The replacement for the block above, and the whole of the difference between
 * the two designs: the old rule refused, this one explains and lets the host
 * decide. Returns `null` when there is nothing to caution about — a format with
 * no authorship to protect, a session with attribution switched on, or a round
 * whose authors are already out — because a warning that is always on screen is
 * a warning nobody reads.
 *
 * The response count is IN the sentence rather than implied by it. "This may
 * reduce anonymity" is a disclaimer; "2 responses are in, so a room that reads
 * the waiting list can work out who wrote them" is a fact the host can act on,
 * and it is the same fact the constant above was built from. `strong` is the
 * machine-readable half, so the panel can style it without re-deriving the
 * threshold.
 */
export function waitingNamesCaution({
  answerCount, gameType, anonymousUntilReveal, authorsRevealed,
} = {}) {
  const hidden = authorsHiddenNow({ gameType, anonymousUntilReveal, authorsRevealed });
  if (!hidden) return null;

  const n = Number(answerCount) || 0;
  if (n === 0) {
    return { strong: false, text: 'No responses are in yet, so there is nothing to work out.' };
  }
  if (n < MIN_ANONYMOUS_ANSWERS) {
    return {
      strong: true,
      text: `${n} response${n === 1 ? '' : 's'} in — few enough that a room reading the waiting list can work out who wrote them.`,
    };
  }
  return {
    strong: false,
    text: `${n} responses in — enough that the same subtraction still leaves the room guessing.`,
  };
}

/**
 * WHO IS STILL WAITING, and whether the stage may say so out loud.
 *
 * THE RULE THIS REPLACES. RoomMeter used to name nobody, ever, and
 * stageShell.test.jsx asserted it. The owner has now decided the meter names
 * WHO IS STILL WAITING — never who has answered — on demand, so a facilitator
 * can nudge Dana without projecting an operator surface (host-redesign/
 * CRITIQUE.md #3). This function is where that decision is enforced, because
 * a rule spread across a 5,000-line component is a rule nobody can test.
 *
 * IT IS A PROJECTOR CONTROL, NEVER A SECURITY CONTROL — the same disclaimer
 * stageLabelFor carries, and for the same reason: the server has already sent
 * this host everything below. `answerProgress.answererIds` is the full list of
 * who has answered and get-answers.js:216 documents it as deliberately public,
 * because "who has not acted yet is a different fact from who wrote what".
 * Nothing here un-sends anything. What it decides is what goes on the wall.
 *
 * THE ANONYMITY GATE IS NOW A HOST SETTING, AND THAT IS THE POINT OF THIS
 * REVISION. `nameWaitingWhenAnonymous` is that setting, and it replaces
 * `answerCount < MIN_ANONYMOUS_ANSWERS`, which withheld the list on an
 * anonymous round with no override at all. The owner overruled it — *"the host
 * has the info and the control"* — and the argument the constant encoded now
 * ships as copy beside the control (`waitingNamesCaution`) instead of as a
 * locked door. Read MIN_ANONYMOUS_ANSWERS' doc-block for the full history; the
 * paragraphs below are why the caution says what it says.
 *
 * DEFAULT ON, and that is a decision rather than laziness. The list is never up
 * unless the host hovers, focuses or clicks the meter, so defaulting on puts
 * nothing on a wall by itself — it only decides whether the affordance exists.
 * Defaulting off would rebuild the old block for the common case: the owner's
 * own session is a team of four, where the response count never reaches five,
 * and the host would have to go hunting through a settings tab to discover a
 * feature that had silently done nothing all game. Only an explicit `false`
 * turns it off, matching `anonymousUntilReveal`'s own default-ON rule so the two
 * host settings in this file read the same way.
 *
 * `answerCount` IS STILL A PARAMETER, and still the response count, because it
 * is what `waitingNamesCaution` words its sentence from. It no longer decides
 * anything here.
 *
 * DOES NAMING THE NON-ANSWERERS LEAK ANYTHING DURING AN ANONYMOUS ROUND? Yes,
 * and the leak runs opposite to the intuition. Naming the waiters names the
 * complement, so the room can subtract and obtain the answerer set exactly.
 * Every response on the stage goes from "written by one of the 40 people here"
 * to "written by one of these k". So:
 *
 *   - 39 of 40 answered, 1 waiting: naming that 1 tells the room nothing about
 *     any response. The other 39 are still 39 candidates.
 *   - 1 of 40 answered, 39 waiting: naming those 39 identifies the single
 *     author of the single response on the ballot, by elimination. Complete
 *     de-anonymisation, produced by a list that mentions that person's name
 *     nowhere.
 *
 * SO THE CAUTION COUNTS RESPONSES, NOT WAITERS. The obvious rule — "warn only
 * when at least a few people are waiting, so no one is singled out" — is
 * exactly backwards on both halves: it would flag the harmless 1-waiter case
 * and stay quiet on the catastrophic 39-waiter one. What is at risk is the
 * anonymity set of the CONTENT, and that set is the number of responses in the
 * round.
 *
 * Stated on ASK and on VOTE alike, with `answerCount` (responses in the
 * round) as the quantity in both — on VOTE the waiting list is the non-VOTERS,
 * which is not an authorship set at all, but the ballot with its k responses is
 * on the stage at exactly that moment, and one rule that is always about the
 * content on the wall is one rule to check. `17-remote.html`'s caption is
 * right that "who has not acted" is a different fact from "who wrote what" —
 * that argument survives per-person and dies on the complement, which is the
 * whole of the difference between a list on the host's phone and a list on a
 * projector.
 *
 * THE SECOND GUARD IS NOT ABOUT PRIVACY AT ALL. On a hidden round
 * `playersWhoAnswered` cannot grow from the socket — message.js strips the name
 * from every `playerAnswered` frame and answeredNamesFrom() returns nothing to
 * replace it (see fetchAnswersForQuestion, which leaves the list alone rather
 * than overwriting it with blanks) — while the row count keeps climbing.
 * Subtracting a stale list would print "still waiting: Dana" at a room twenty
 * seconds after Dana answered, and it would understate the answerer set, which
 * misattributes rather than merely leaking. So the list is offered only when
 * the names on hand account for every response counted.
 *
 * IT USED TO FIRE FOR THE WHOLE ROUND, and that is the defect the owner
 * reported as "the names lag the count". The names could only ever arrive on a
 * resync — mount, reconnect or refocus — so on a hidden round the reveal was
 * suppressed until the host happened to touch the tab. The host page now pulls
 * `answerProgress.answererIds` (answererIdsFrom) on the hidden branch of the
 * `playerAnswered` handler, coalesced, so the gap this guard covers is the
 * fraction of a second between a frame landing and that refresh returning. The
 * guard stays exactly as it is: it is what makes that window safe, and it is
 * still the only thing standing between a dropped refresh and a wrong name on
 * a projector. IT IS NOT THE ANONYMITY RULE AND MUST NOT BE RETIRED WITH IT —
 * correctness, not policy. A host setting cannot make a stale list accurate.
 *
 * Returns `null` for "do not offer this at all" — distinct from `[]`, which
 * means "offered, and nobody is waiting".
 */
export function waitingRoster({
  players,
  responded,
  respondedCount,
  answerCount,
  gameType,
  anonymousUntilReveal,
  authorsRevealed,
  nameWaitingWhenAnonymous,
} = {}) {
  // Deduplicated and blank-free — see rosterNames, which joinedRoster shares.
  const roster = rosterNames(players);
  if (roster.length === 0) return null;

  const acted = new Set(
    (responded || []).filter((n) => typeof n === 'string' && n.length > 0)
  );
  // CORRECTNESS, NOT POLICY, and it survived the owner's ruling untouched:
  // the meter's numerator can lead the names — never the other way round.
  const counted = Math.max(Number(respondedCount) || 0, acted.size);
  if (acted.size < counted) return null;

  // THE HOST'S CALL, not the code's. `answerCount` no longer appears in this
  // condition; it is the caution's quantity, not a threshold.
  const hidden = authorsHiddenNow({ gameType, anonymousUntilReveal, authorsRevealed });
  if (hidden && nameWaitingWhenAnonymous === false) return null;

  return roster.filter((name) => !acted.has(name));
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
