/**
 * THE ROUND NUMBER, DERIVED ONCE.
 *
 * The `STATE` row carries two fields that both look like they identify the
 * current question, and only one of them can be used to build a DynamoDB key:
 *
 *   LessonNumber       1, 2, 3 …  the ROUND. `next-question.js:678-679` sets it
 *                      and derives `QUESTION#${padded}` from it in the same
 *                      breath, so it is the number every round-scoped row is
 *                      filed under.
 *   CurrentQuestionId  the SOURCE question id — `nextQuestion.questionId`,
 *                      written at `next-question.js:717`. It identifies a row in
 *                      a question SET (`c005#001`), not a round in this game.
 *
 * ── THE BUG THIS EXISTS TO STOP HAPPENING AGAIN ────────────────────────────
 *
 * `get-players.js` built its readiness queries as
 * `QUESTION#${CurrentQuestionId}#ANSWER#`, which for a real session expands to
 * `QUESTION#c005#001#ANSWER#` and matches nothing, ever. So `hasAnswered` and
 * `hasVoted` were false for every player in every session, `isReady` was false
 * throughout ASK and VOTE, and `readyCount` / `answeredCount` / `votedCount` /
 * `readyPercentage` were all permanently 0.
 *
 * Reported by the owner as *"still to answer did not change when players have
 * answered, although the count above stays accurate (1 of 2 answered)"* — and
 * that pairing is the tell. The count that stayed right comes from
 * `get-game-state.js`, which derives the round number correctly at :63; the
 * list that never changed comes from `get-players.js`, which did not. TWO
 * PLACES COMPUTING THE SAME KEY FROM THE SAME ROW, DIFFERENTLY, is the entire
 * cause, so there is now one place, and both call it.
 *
 * The visible symptom was on the host's phone (`config/hostRemote.js`'s
 * `waitingOn` filters on `readiness[field]`), because that is the only surface
 * that prints the names from this projection. The host's main stage was NOT
 * affected — its "still to answer" comes from `get-game-state`'s `answererIds`
 * via `waitingRoster`, which was reading the correct source all along.
 *
 * ── WHAT THIS DELIBERATELY DOES NOT DO ─────────────────────────────────────
 *
 * `get-answers.js:43-49` and `get-votes.js:40-46` derive the same number with an
 * extra `else` branch that falls back to `CurrentQuestionId` when
 * `LessonNumber` is absent. That fallback builds the same unmatchable key this
 * file exists to prevent — but it can only fire before any round has started,
 * when there are no answers or votes to find either way, so it is a dead branch
 * rather than a live fault. They are left alone on purpose: both are covered by
 * tests that pin their current behaviour, and widening this change into two
 * more live routes to delete an unreachable `else` is not a trade worth making
 * inside a bug fix. If one of them ever grows a live failure, this is the
 * function it should adopt.
 */

/**
 * The zero-padded round number for the round currently in play, or `null` when
 * no round has started.
 *
 * Takes the raw `STATE` item so callers do not have to agree on a reshaping
 * first — the shape of that row is the thing being interpreted.
 *
 * `null` rather than `'000'` for "no round": `'000'` is a legal-looking key
 * prefix and would silently query a partition that cannot exist, which is the
 * failure mode being fixed. A caller must handle the absence explicitly.
 */
function currentRoundNumber(stateItem) {
  const lessonNumber = Number(stateItem && stateItem.LessonNumber) || 0;
  return lessonNumber > 0 ? String(lessonNumber).padStart(3, '0') : null;
}

module.exports = { currentRoundNumber };
