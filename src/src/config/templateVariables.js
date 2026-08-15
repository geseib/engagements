/**
 * The template-variable catalogue — the single answer to "what is a variable?"
 *
 * A prompt's output format is free text containing `{tokens}`. Exactly one
 * place substitutes them: the `templateVars` object in get-ai-summary.js. Any
 * token not in there survives the substitution loop and lands on a projector
 * as literal `{text}`.
 *
 * Before this file there were three disagreeing lists:
 *
 *   - AIPromptManager.jsx redeclared 49 entries for its chip palette.
 *   - ai-generate-prompt.js kept its own table keyed by the LEGACY spellings
 *     (`callandanswer`, `polls`), so the dashed ids the UI actually sends
 *     missed and the lookup yielded []. The model was then handed an empty
 *     "AVAILABLE TEMPLATE VARIABLES:" heading and an instruction to use the
 *     list, so it invented variables. Where the table did hit, its `wavelength`
 *     row named five variables that have never existed.
 *   - ai-prompt-advisor.js was asked to validate variable usage while being
 *     told nothing at all.
 *
 * ⚠️ DUPLICATED ON PURPOSE, exactly like game-types.js. `lambda-functions/admin/`
 * and `lambda-functions/game/` are separate CodeUri in template-clean.yaml and
 * `src/` is a separate webpack build, so a module outside the bundle is simply
 * not there. The three copies must stay BYTE-IDENTICAL:
 *
 *   - lambda-functions/game/template-variables.js        (this file, canonical)
 *   - lambda-functions/admin/shared/template-variables.js
 *   - src/src/config/templateVariables.js
 *
 * tests/template-variable-catalogue.js fails if they differ, if anything here
 * is not substituted by get-ai-summary.js, or if get-ai-summary.js gains a key
 * that is neither catalogued nor listed internal below. Copy the file; do not
 * edit one.
 *
 * This module deliberately imports nothing — a relative path would resolve
 * differently in each of the three bundles.
 *
 * TWO LISTS, on purpose:
 *
 *   TEMPLATE_VARIABLES          advertised — chips, the AI generator, the advisor
 *   INTERNAL_TEMPLATE_VARIABLES resolvable but not worth advertising (aliases,
 *                               prompt plumbing). NEVER rejected at save time:
 *                               live prompts use {totalPlayers}, and a gate
 *                               built off the advertised list alone would break
 *                               them.
 *
 * `gameTypes` uses canonical dashed ids only (src/src/config/gameTypes.js).
 * Callers normalise before asking; this module does no aliasing of its own.
 *
 * ============================================================================
 * WHAT `gameTypes` MEANS, AND THE AUDIT THAT CORRECTED IT (2026-08-15)
 * ============================================================================
 *
 * THE RULE, stated once so the next edit can be checked against it:
 *
 *   A type belongs in `gameTypes` when a real round of that type substitutes
 *   this variable with information about THAT round. Not when the key exists —
 *   every key exists for every type, because `templateVars` is one flat object
 *   built on every path. `{pollOptions}` has a key on a wavelength round; it
 *   holds the empty string.
 *
 * WHY THAT DISTINCTION IS THE WHOLE POINT. A variable that resolves to nothing
 * does not error, does not warn, and does not leave visible braces. The
 * sentence built around it simply loses its content, and the model is handed a
 * prompt that reads as if the data were there. That is the exact mechanism that
 * produced the live summary reading "I notice you haven't provided the [Summary
 * of the core idea/response being analyzed] yet" — so a wrong tag here is not a
 * cosmetic defect, it is the same failure one level up.
 *
 * HOW EACH TAG WAS DETERMINED: by reading the assignment in
 * lambda-functions/game/get-ai-summary.js, not by reading the variable's name.
 * Every correction below carries its line. The three structural facts the audit
 * turned on:
 *
 *   1. The vote tally loop is gated `gameType !== 'trivia' && !== 'wavelength'`
 *      (:803). Poll and survey run a VOTE phase (config/gameTypes.js `phases`)
 *      and take that loop; trivia and wavelength never store a `#VOTE#` row at
 *      all. So every first/second/third-place figure is zero for those two.
 *   2. Wavelength never writes a `PLAYER#…#SCORE` record — get-results.js:341
 *      routes it to handleWavelengthResults, which computes a team score and
 *      writes no per-player row. So the leaderboard (:1478) is empty and every
 *      score variable derived from it is empty for wavelength ALONE.
 *   3. Several variables branch explicitly on `gameType === 'trivia' ? … : …`
 *      (:1568, :1577, :1606, :1674). Both arms produce a value. A tag of
 *      `['call-and-answer']` on those hid a working variable from three types.
 *
 * `survey` is tagged as the code WOULD behave, and no survey round has ever
 * run: upload-questions.js refuses survey uploads, so no survey set exists.
 * A survey falls through the trivia and poll branches and takes the vote loop,
 * which is why it tracks poll everywhere except `pollOptions` — assigned only
 * inside `gameType === 'polls' || 'poll'` (:1863).
 *
 * `alwaysEmpty` is the one flag that overrides `gameTypes`: it marks a variable
 * that is hardcoded to '' on every path, deliberately. Two of them exist. They
 * stay advertised so an author hunting for participation figures finds out WHY
 * there are none instead of finding nothing, and the editor refuses to insert
 * them. See the note on `participationRate`.
 */

/** Palette header order. A category with no variable in it is a dead header. */
const VARIABLE_CATEGORY_ORDER = [
  'Set Info',
  'Game Info',
  'Player Info',
  'Question Info',
  'Answers',
  'Votes',
  'Vote Tally',
  'Results',
  'Scores',
  'Wavelength',
];

const ALL_TYPES = ['call-and-answer', 'trivia', 'poll', 'wavelength', 'survey'];

/**
 * The types that run a VOTE phase (config/gameTypes.js `phases`), and so are
 * the only ones with `QUESTION#nnn#VOTE#` rows for get-ai-summary.js:803-829
 * to tally. Trivia and wavelength are routed past that loop entirely, so every
 * ballot-derived figure is zero for them.
 */
const VOTED_TYPES = ['call-and-answer', 'poll', 'survey'];

/**
 * Every type but wavelength: the ones whose round produces a per-player ranked
 * answer list AND accrues `PLAYER#…#SCORE` rows. This replaces the old
 * `SCORED_TYPES = ['call-and-answer', 'trivia']`, which was wrong in both
 * directions — poll and survey score exactly like call-and-answer
 * (get-results.js:465-511 is on their path), and wavelength scores per team
 * rather than per player and writes no score row at all.
 */
const RANKED_TYPES = ['call-and-answer', 'trivia', 'poll', 'survey'];

const TEMPLATE_VARIABLES = [
  // ---- SET INFO ------------------------------------------------------------
  // All five: :1410-1458 reads the set's metadata row with no game-type branch.
  {
    name: 'questionSetName',
    description: 'Name of the question set being used',
    category: 'Set Info',
    gameTypes: ALL_TYPES,
    example: 'Amazon Leadership Principles, Team Building Icebreakers',
  },
  {
    name: 'questionSetDescription',
    description: 'Description of the question set theme and purpose',
    category: 'Set Info',
    gameTypes: ALL_TYPES,
    example: 'Questions designed to explore leadership scenarios and decision-making',
  },
  {
    name: 'categoryCount',
    description: 'Number of different categories in the question set',
    category: 'Set Info',
    gameTypes: ALL_TYPES,
    example: '8 categories, 5 different themes',
  },
  {
    name: 'totalQuestions',
    description: 'Total number of questions in the question set',
    category: 'Set Info',
    gameTypes: ALL_TYPES,
    example: '25 questions, 120 total questions',
  },
  {
    name: 'sessionContext',
    description: 'Combined context about the session including set name and description',
    category: 'Set Info',
    gameTypes: ALL_TYPES,
    example: 'a Team Building session using Amazon Leadership Principles',
  },

  // ---- GAME INFO -----------------------------------------------------------
  // All five: :2017-2021 copies session metadata, no branch.
  {
    name: 'eventTitle',
    description: 'Title of the session as entered by the host',
    category: 'Game Info',
    gameTypes: ALL_TYPES,
    example: 'Q4 Leadership Workshop, Friday Team Building',
  },
  {
    name: 'gameType',
    description: 'Type of engagement being played',
    category: 'Game Info',
    gameTypes: ALL_TYPES,
    example: 'call-and-answer, trivia, poll, wavelength',
  },
  {
    name: 'gameId',
    description: 'Unique identifier for this session',
    category: 'Game Info',
    gameTypes: ALL_TYPES,
    example: '1234, 5678',
  },
  {
    name: 'sessionDuration',
    description: 'How long the session has been running',
    category: 'Game Info',
    gameTypes: ALL_TYPES,
    example: '15 minutes, 32 seconds, 1 hour, 45 minutes',
  },
  {
    name: 'currentRound',
    description: 'Current round number being analysed',
    category: 'Game Info',
    gameTypes: ALL_TYPES,
    example: '1, 3, 15',
  },

  // ---- PLAYER INFO ---------------------------------------------------------
  {
    name: 'totalParticipants',
    description: 'Total number of players who joined the session',
    category: 'Player Info',
    gameTypes: ALL_TYPES,
    example: '12 players, 8 participants',
  },
  {
    // AUDIT: was ['call-and-answer']. :1523 is
    // `(votes && votes.length > 0) ? votes.length : answers.length` on every
    // path — but trivia and wavelength never store a vote (:803), so for those
    // two it is `answers.length` by construction and the description above it
    // ("participated in voting") states something that did not happen. Poll and
    // survey do vote, so they are added and the two vote-less types stay out.
    name: 'activeParticipants',
    description: 'Number of players who participated in voting',
    category: 'Player Info',
    gameTypes: VOTED_TYPES,
    example: '8 players voted, 6 active voters',
  },
  {
    name: 'playerNames',
    description: 'Comma-separated list of all player names',
    category: 'Player Info',
    gameTypes: ALL_TYPES,
    example: 'Alice, Bob, Charlie, Diana',
  },
  {
    // AUDIT: was ['call-and-answer', 'trivia']. :1659 slices the leaderboard,
    // which is built from `PLAYER#…#SCORE` rows (:1478). Poll and survey write
    // those rows on the same path call-and-answer does (get-results.js:465);
    // wavelength writes none (get-results.js:341).
    name: 'playerRankings',
    description: 'Formatted leaderboard with player rankings and scores',
    category: 'Player Info',
    gameTypes: RANKED_TYPES,
    example: '1st: Alice (15 pts), 2nd: Bob (12 pts), 3rd: Charlie (8 pts)',
  },
  {
    // AUDIT: was ['call-and-answer', 'trivia']. Same source as playerRankings
    // (:1664).
    name: 'topPerformers',
    description: 'Top 3 players with the highest scores',
    category: 'Player Info',
    gameTypes: RANKED_TYPES,
    example: 'Alice (15 pts), Bob (12 pts), Charlie (8 pts)',
  },

  // ---- QUESTION INFO -------------------------------------------------------
  {
    name: 'question',
    description: 'The main question text (title, or the detail when there is no title)',
    category: 'Question Info',
    gameTypes: ALL_TYPES,
    example: 'Tell me about a time when you had to work with ambiguity',
  },
  {
    // NEW. The owner's own model of a prompt opens with one line for "here is
    // what was asked" and he had to write two variables to get it. Both halves
    // already existed and neither was composite, so every prompt in the product
    // reinvents the label — "Question: {questionTitle}" / "Detail:
    // {questionDetail}" — and a prompt that forgets the second silently drops
    // the context the question depends on. Assembled at get-ai-summary.js:2040.
    name: 'questionInfo',
    description: 'What was asked: the question title and its detail, already labelled',
    category: 'Question Info',
    gameTypes: ALL_TYPES,
    example: 'Question: Working with Ambiguity\nDetail: Consider a time when you did not have all the information...',
  },
  {
    name: 'questionTitle',
    description: 'The question title or main prompt',
    category: 'Question Info',
    gameTypes: ALL_TYPES,
    example: 'Working with Ambiguity, Leadership Challenge',
  },
  {
    name: 'questionDetail',
    description: 'Additional context and details about the question',
    category: 'Question Info',
    gameTypes: ALL_TYPES,
    example: 'In this scenario, consider times when you did not have all the information...',
  },
  {
    name: 'questionCategory',
    description: 'Category or theme of the current question',
    category: 'Question Info',
    gameTypes: ALL_TYPES,
    example: 'Leadership, Problem Solving, Team Dynamics',
  },
  {
    name: 'questionNumber',
    description: 'Current question number in the session',
    category: 'Question Info',
    gameTypes: ALL_TYPES,
    example: '1, 5, 12',
  },
  {
    // Trivia only, twice over: assigned at :1760 inside the trivia branch, and
    // the fallback at :2056 is itself gated on `gameType === 'trivia'`.
    name: 'correctAnswer',
    description: 'The correct answer for a trivia question',
    category: 'Question Info',
    gameTypes: ['trivia'],
    example: 'The correct answer is B: Machine Learning',
  },
  {
    // Trivia only: :1755, and the fallback at :2042 is trivia-gated too.
    name: 'triviaChoices',
    description: 'All multiple-choice options for a trivia question',
    category: 'Question Info',
    gameTypes: ['trivia'],
    example: 'A) Artificial Intelligence, B) Machine Learning, C) Deep Learning, D) Neural Networks',
  },
  {
    // :2071 reads `question.answerDetails` with no branch, but only the trivia
    // CSV carries that column (upload-questions.js) — every other type resolves
    // it to the literal 'No explanation provided'.
    name: 'answerDetails',
    description: "The question author's background note explaining the answer",
    category: 'Question Info',
    gameTypes: ['trivia'],
    example: 'Machine Learning is a subset of AI that focuses on learning from data...',
  },
  {
    // :2072, same reasoning as answerDetails — the default is 'medium' for a
    // type whose questions have no difficulty column.
    name: 'difficulty',
    description: 'Difficulty level of the question',
    category: 'Question Info',
    gameTypes: ['trivia'],
    example: 'easy, medium, hard',
  },
  {
    // AUDIT: was ['poll', 'survey']. :1712 initialises it to '' and :1871 is
    // the ONLY assignment, inside `gameType === 'polls' || gameType === 'poll'`
    // (:1863). A survey round enters no branch at all, so `{pollOptions}` is
    // empty on every survey — advertised data that cannot arrive, which is
    // precisely the class of defect that broke the live prompt.
    name: 'pollOptions',
    description: 'The options that were on screen for this poll',
    category: 'Question Info',
    gameTypes: ['poll'],
    example: 'A) Ship it Friday, B) Wait for the audit, C) Split the release',
  },

  // ---- ANSWERS -------------------------------------------------------------
  {
    // AUDIT: was ['call-and-answer', 'trivia']. :2003-2005 maps `answers` with
    // no game-type branch whatsoever, and :2076 assigns it. Every type that has
    // answers has this.
    name: 'playerAnswers',
    description: 'All player responses to the question, with names',
    category: 'Answers',
    gameTypes: ALL_TYPES,
    example: 'Alice: "I approached the customer concern by...", Bob: "In my experience..."',
  },
  {
    // AUDIT: was ['call-and-answer', 'trivia', 'poll']. :2077 is literally the
    // same value as playerAnswers, so the two cannot have different tags.
    name: 'playerResponses',
    description: 'All player responses to the question, with names (same content as playerAnswers)',
    category: 'Answers',
    gameTypes: ALL_TYPES,
    example: 'Alice: "I approached the customer concern by...", Bob: "In my experience..."',
  },
  {
    // AUDIT: was missing wavelength. :2078 is `rankedAnswers.length`, built at
    // :1377 from `answers` with no branch.
    name: 'responseCount',
    description: 'Number of players who submitted a response',
    category: 'Answers',
    gameTypes: ALL_TYPES,
    example: '8 responses, 12 participants answered',
  },
  {
    // AUDIT: was ['call-and-answer']. :1393-1407 builds it for every type; the
    // only branch is the points LABEL at :1405 ('points' for trivia, 'vote
    // points' otherwise). Note the standing advice: this is the raw dump, and a
    // prompt asked to SUMMARISE responses usually wants {topVotedAnswers}.
    name: 'responsesText',
    description: 'Numbered list of all player responses with names — the raw dump, not a summary',
    category: 'Answers',
    gameTypes: ALL_TYPES,
    example: '1. Alice: "I approached this by...", 2. Bob: "My strategy was..."',
  },
  {
    // AUDIT: was ['trivia']. Assigned twice — :1839 in the trivia branch AND
    // :1881 in the poll branch, where it formats as "option: n votes". The name
    // is misleading for a poll; the value is real, and hiding it left a poll
    // author with no per-option distribution at all.
    name: 'triviaResponses',
    description: 'How the answers were distributed across the choices (trivia and polls both)',
    category: 'Answers',
    gameTypes: ['trivia', 'poll'],
    example: 'Alice: A (Incorrect), Bob: B (Correct), Charlie: C (Incorrect)',
  },
  {
    // :2083 is `gameType === 'trivia' ? correctCount : 0` — an explicit zero
    // everywhere else.
    name: 'correctCount',
    description: 'Number of players who answered the trivia question correctly',
    category: 'Answers',
    gameTypes: ['trivia'],
    example: '5 out of 8 players answered correctly',
  },
  {
    // AUDIT: was ['poll', 'survey']. :1644 is `[...new Set(answers.map(...))]`,
    // no branch. It is the most useful variable there is for a call-and-answer
    // round with repeated sentiment, and it was hidden from one.
    name: 'uniqueAnswers',
    description: 'The distinct answers given, with how many chose each',
    category: 'Answers',
    gameTypes: ALL_TYPES,
    example: 'Ship it Friday (5), Wait for the audit (3)',
  },
  {
    // AUDIT: was ['poll', 'survey']. :1648, derived from uniqueAnswers, no
    // branch.
    name: 'answerCategories',
    description: 'Responses grouped into themes',
    category: 'Answers',
    gameTypes: ALL_TYPES,
    example: 'Speed-first (5), Risk-first (3)',
  },

  // ---- VOTES ---------------------------------------------------------------
  {
    // AUDIT: was ['call-and-answer']. :2087 is `votes.length`. The votes query
    // (:753-760) runs for every type, but only the three VOTE-phase types ever
    // store a `#VOTE#` row, so it is a constant 0 for trivia and wavelength.
    name: 'voteCount',
    description: 'Total number of votes cast',
    category: 'Votes',
    gameTypes: VOTED_TYPES,
    example: '24 total votes, 8 voting players',
  },
  {
    // ALWAYS EMPTY, on every engagement type. :2091 is a hardcoded ''. The
    // reasoning is written out at :1530-1551 and is worth not re-deriving: the
    // figure was `activeParticipants / totalParticipants`, and since
    // `totalParticipants` IS `answers.length` (:1267) and `activeParticipants`
    // collapses to `answers.length` whenever a round has no votes, it read 100%
    // on every round ever summarised — and it was interpolated into the live
    // prompt, so the model was told the room's participation was total, and
    // hosts read that out loud.
    //
    // Kept advertised rather than deleted or hidden: an author hunting for a
    // participation figure needs to find out that there is none and why, and a
    // token with no key at all would render as literal braces on a projector.
    // `alwaysEmpty` is what stops the editor inserting it.
    name: 'votingParticipation',
    description: 'Percentage of players who participated in voting — REMOVED, resolves to nothing',
    category: 'Votes',
    gameTypes: ALL_TYPES,
    alwaysEmpty: true,
    example: '(empty — there is no honest denominator in the summary path)',
  },
  {
    // AUDIT: was ['call-and-answer']. :1554-1565 gives every type a value, but
    // trivia and wavelength get a fixed sentence about not voting rather than
    // an observation of this round. Tagged to the types where it varies.
    name: 'votingPattern',
    description: 'How the votes were distributed — concentrated on one answer or spread',
    category: 'Votes',
    gameTypes: VOTED_TYPES,
    example: 'Votes concentrated on two responses; nobody ranked the rest',
  },
  {
    // AUDIT: was ['call-and-answer', 'wavelength']. consensusLabel (:1598,
    // consensus.js) returns a fixed string for trivia and a real measure for
    // everything else; wavelength's is recomputed at :1999 from the connection
    // score. Poll and survey take the measured branch and were missing.
    name: 'consensusLevel',
    description: 'Level of agreement among voters',
    category: 'Votes',
    gameTypes: ['call-and-answer', 'poll', 'survey', 'wavelength'],
    example: 'Strong consensus, Moderate agreement, Diverse opinions',
  },

  // ---- VOTE TALLY ----------------------------------------------------------
  {
    // AUDIT: was ['call-and-answer']. :1568 is an explicit
    // `gameType === 'trivia' ? <score tally> : <vote tally>` — BOTH arms
    // produce a value, and the trivia arm carries the answer text and points.
    // Excluded for wavelength only, where every row would read "(N vote
    // points)" for a team score nobody voted on.
    name: 'voteTally',
    description: 'Ranked list of this round\'s answers with their point totals',
    category: 'Vote Tally',
    gameTypes: RANKED_TYPES,
    example: '1. Ship it Friday (13 vote points), 2. Wait for the audit (8 vote points)',
  },
  {
    /*
      AUDIT: was ['call-and-answer']. :1577, same explicit trivia/non-trivia
      branch as voteTally.

      SECOND AUDIT — THE DESCRIPTION AND EXAMPLE WERE BOTH WRONG, and wrong in
      the direction that matters. This entry said "Top 3 most-voted responses"
      and gave "Alice's response (13 points)". On a CALL-AND-ANSWER round the
      engine emits `${playerName}: ${score} vote points` (:1582) — a name and a
      number, and NO RESPONSE TEXT AT ALL. Only the trivia arm (:1579) includes
      the answer. Under anonymity the name degrades too, so the whole variable
      renders as "a participant: 13 vote points" repeated three times.

      This is the exact defect the catalogue exists to have audited out of it,
      and it survived the game-type audit because that pass compared `gameTypes`
      against the engine and took the prose on trust. A wrong tag renders empty
      and is noticed; wrong PROSE sends an author to the wrong variable and the
      prompt still produces confident output about nothing.

      If you want the responses themselves, use {responsesText} (:1406, which is
      `rank: player - "answer" (N vote points)`). That is the only variable that
      carries the text of every response.
    */
    name: 'topVotedAnswers',
    description: 'Top 3 by vote. TRIVIA: name, answer and points. Every other type: name and points ONLY — no response text (use {responsesText} for that).',
    category: 'Vote Tally',
    gameTypes: RANKED_TYPES,
    example: 'trivia — "Alice: Paris - 30 points" · call-and-answer — "Alice: 13 vote points"',
  },
  {
    // AUDIT: was ['call-and-answer']. :1706 reads firstPlace/secondPlace/
    // thirdPlace, which are only ever incremented inside the ballot loop at
    // :804-829 — skipped for trivia and wavelength (:803), so those two would
    // read "0 first-place, 0 second-place, 0 third-place votes" for every row.
    name: 'votingBreakdown',
    description: 'Per-response vote counts by rank',
    category: 'Vote Tally',
    gameTypes: VOTED_TYPES,
    example: 'Response 1: 3x1st, 1x2nd; Response 2: 1x1st, 3x3rd',
  },

  // ---- RESULTS -------------------------------------------------------------
  {
    // AUDIT: was ['call-and-answer', 'trivia']. :1606 branches trivia/other;
    // both arms produce a value. Excluded for wavelength, whose "votes" are a
    // team score repeated per player.
    name: 'finalResults',
    description: 'Top 3 results with rankings and scores or correctness',
    category: 'Results',
    gameTypes: RANKED_TYPES,
    example: 'Alice: Leadership approach (13 points), Bob: Process improvement (8 points)',
  },
  {
    // AUDIT: was ['call-and-answer', 'trivia']. :1617, same shape.
    name: 'winnerInfo',
    description: 'Information about the winner(s) of this round',
    category: 'Results',
    gameTypes: RANKED_TYPES,
    example: 'Winner: Alice with "I approached the problem by..." (13 vote points)',
  },
  {
    // AUDIT: was ['call-and-answer', 'trivia', 'wavelength']. :1624-1639 is a
    // three-way branch whose `else` covers poll and survey.
    name: 'resultsSummary',
    description: 'One-line summary of the round result and participation',
    category: 'Results',
    gameTypes: ALL_TYPES,
    example: 'Clear winner with 54% of possible vote points',
  },
  {
    // ALWAYS EMPTY, on every engagement type. :2105 is a hardcoded ''. Same
    // removal and same reasoning as votingParticipation above — see :1530-1551.
    name: 'participationRate',
    description: 'Participation statistics for answering and voting — REMOVED, resolves to nothing',
    category: 'Results',
    gameTypes: ALL_TYPES,
    alwaysEmpty: true,
    example: '(empty — the old figure was 100% by construction on every round)',
  },
  {
    // Trivia only: :1715 initialises '', :1846 assigns inside the trivia branch.
    name: 'triviaCorrectness',
    description: 'Correctness summary for a trivia question',
    category: 'Results',
    gameTypes: ['trivia'],
    example: '5 correct answers, 3 incorrect answers (62% accuracy)',
  },

  // ---- SCORES --------------------------------------------------------------
  // Every entry here derives from either the `PLAYER#…#SCORE` rows (:1478) or
  // the round's `sortedAnswers`. Wavelength has neither in a per-player form,
  // and poll and survey have both — the old `SCORED_TYPES` was wrong on all
  // three counts.
  {
    name: 'cumulativeScores',
    description: 'All player scores accumulated across every round so far',
    category: 'Scores',
    gameTypes: RANKED_TYPES,
    example: 'Alice: 28 points, Bob: 22 points, Charlie: 15 points',
  },
  {
    name: 'scoreChanges',
    description: 'Points earned by each player in this specific round',
    category: 'Scores',
    gameTypes: RANKED_TYPES,
    example: 'Alice: +13 points, Bob: +8 points, Charlie: +5 points',
  },
  {
    name: 'roundScores',
    description: 'This round\'s scores as a standalone table',
    category: 'Scores',
    gameTypes: RANKED_TYPES,
    example: 'Alice 13, Bob 8, Charlie 5',
  },
  {
    name: 'leaderboard',
    description: 'Current top 5 players with rankings and total scores',
    category: 'Scores',
    gameTypes: RANKED_TYPES,
    example: '1st: Alice (28 pts), 2nd: Bob (22 pts), 3rd: Charlie (15 pts)',
  },
  {
    // AUDIT: was ['call-and-answer', 'trivia'] — and trivia is the one type it
    // actively misinforms. :1703 builds it from `ScoringConfig`'s first/second/
    // third-place VOTE ranks. A trivia round awards `answer.PointsEarned`
    // (:834), a base score plus a speed bonus, and never consults that config.
    // So a trivia prompt naming this variable told the model a scoring scheme
    // the round did not use.
    name: 'scoringSystem',
    description: 'How vote points were awarded this round',
    category: 'Scores',
    gameTypes: VOTED_TYPES,
    example: '3 points for a first-place vote, 2 for second, 1 for third',
  },
  {
    name: 'averageScore',
    description: 'Average score across all players',
    category: 'Scores',
    gameTypes: RANKED_TYPES,
    example: '18.5 points, 12.3 points',
  },

  // ---- WAVELENGTH ----------------------------------------------------------
  // All eight verified populated in the wavelength branch (:1884-2000) and
  // nowhere else; :2119-2126 assigns them.
  {
    name: 'wavelengthTopic',
    description: 'The topic players associated words with',
    category: 'Wavelength',
    gameTypes: ['wavelength'],
    example: 'Innovation, Leadership, Teamwork',
  },
  {
    name: 'wavelengthWords',
    description: 'All words submitted by players, grouped by player',
    category: 'Wavelength',
    gameTypes: ['wavelength'],
    example: 'Alice: [creativity, solutions]; Bob: [change, ideas]',
  },
  {
    name: 'commonWords',
    description: 'Words that two or more players thought of — the team alignment',
    category: 'Wavelength',
    gameTypes: ['wavelength'],
    example: 'creativity, innovation, ideas, solutions',
  },
  {
    name: 'commonWordsCount',
    description: 'How many words showed team alignment',
    category: 'Wavelength',
    gameTypes: ['wavelength'],
    example: '4, 7',
  },
  {
    name: 'totalUniqueWords',
    description: 'How many distinct words the room submitted in total',
    category: 'Wavelength',
    gameTypes: ['wavelength'],
    example: '23, 41',
  },
  {
    name: 'connectionScore',
    description: "Percentage showing how aligned the team's thinking was",
    category: 'Wavelength',
    gameTypes: ['wavelength'],
    example: '65%, 42%',
  },
  {
    name: 'wordAnalysis',
    description: 'Prose summary of the common words and the connection rate',
    category: 'Wavelength',
    gameTypes: ['wavelength'],
    example: '4 common words found out of 23 unique words (17% connection rate). Common words: ideas (3x)...',
  },
  {
    name: 'teamScore',
    description: "The team's collective score for the wavelength round",
    category: 'Wavelength',
    gameTypes: ['wavelength'],
    example: '4, 7',
  },
];

/**
 * Resolvable, but not advertised: aliases kept for prompts already in the wild,
 * and plumbing the system injects rather than the author.
 *
 * These are ACCEPTED everywhere a token is validated. They are omitted from the
 * chip palette and from what the AI generator and advisor are shown, so nothing
 * new gets written against a redundant spelling.
 */
const INTERNAL_TEMPLATE_VARIABLES = [
  { name: 'totalPlayers', reason: 'Alias of totalParticipants; the stock trivia templates use it.' },
  { name: 'gameContext', reason: 'Alias of eventTitle, kept for backward compatibility.' },
  { name: 'totalScores', reason: 'Alias of cumulativeScores.' },
  { name: 'questionContext', reason: 'Alias of questionDetail.' },
  { name: 'questionExplanation', reason: 'Alias of answerDetails.' },
  { name: 'voteData', reason: 'Raw vote structure; voteTally and votingBreakdown are the readable forms.' },
  { name: 'contextSections', reason: 'Session context block the system injects; not authored.' },
  { name: 'contextInstructions', reason: 'Follow-on instruction for the context block; not authored.' },
];

const ADVERTISED_NAMES = TEMPLATE_VARIABLES.map((v) => v.name);
const KNOWN_NAMES = new Set([...ADVERTISED_NAMES, ...INTERNAL_TEMPLATE_VARIABLES.map((v) => v.name)]);

/** Is this a token get-ai-summary.js will actually substitute? */
function isKnownTemplateVariable(name) {
  return typeof name === 'string' && KNOWN_NAMES.has(name);
}

/**
 * Advertised variables available for one canonical game type id.
 *
 * `alwaysEmpty` entries are excluded here even though they list every type:
 * "available for this engagement type" has to mean "carries something on this
 * engagement type", or the filter this function exists for is decoration. They
 * remain in TEMPLATE_VARIABLES so a surface that wants to EXPLAIN them can, and
 * remain known so a prompt already using one is not rejected at save time.
 */
function variablesForGameType(gameType) {
  return TEMPLATE_VARIABLES.filter((v) => !v.alwaysEmpty && v.gameTypes.includes(gameType));
}

/** Palette headers for a game type, in declared order, with the empty ones dropped. */
function variableCategoriesForGameType(gameType) {
  const present = new Set(variablesForGameType(gameType).map((v) => v.category));
  return VARIABLE_CATEGORY_ORDER.filter((c) => present.has(c));
}

/** All palette headers, in declared order, with the empty ones dropped. */
function variableCategories() {
  const present = new Set(TEMPLATE_VARIABLES.map((v) => v.category));
  return VARIABLE_CATEGORY_ORDER.filter((c) => present.has(c));
}

/** Does this variable resolve to '' on every engagement type, by design? */
function isAlwaysEmptyVariable(name) {
  const found = TEMPLATE_VARIABLES.find((v) => v.name === name);
  return Boolean(found && found.alwaysEmpty);
}

/**
 * The `{token}` names in a piece of prompt text, unique, in order of first
 * appearance.
 *
 * Deliberately strict: a bare identifier between braces and nothing else. A
 * prompt that shows the model a JSON example — `{ "instructions": "..." }` —
 * must not have that read as a variable, or the save gate would reject the
 * prompts that need it most.
 */
function extractVariableTokens(text) {
  if (typeof text !== 'string' || text.length === 0) return [];
  const seen = [];
  const re = /\{([A-Za-z_$][A-Za-z0-9_$]*)\}/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    if (!seen.includes(m[1])) seen.push(m[1]);
  }
  return seen;
}

/**
 * The `[bracketed]` spans in a piece of prompt text.
 *
 * NOT variables, and that is the entire point of having this function next to
 * `extractVariableTokens`. Square brackets read like a placeholder and are
 * prose: nothing substitutes them, so the model receives the literal words and
 * — on the live prompt that started this — answered them, producing a summary
 * that asked its own author for the responses.
 *
 * Markdown links are excluded: `[label](https://…)` is a link, not a direction.
 */
function extractBracketDirections(text) {
  if (typeof text !== 'string' || text.length === 0) return [];
  const seen = [];
  const re = /\[([^\][\n]{1,200})\](?!\()/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const body = m[1].trim();
    if (body && !seen.includes(body)) seen.push(body);
  }
  return seen;
}

/** The tokens in this text that nothing will ever substitute. */
function unknownVariableTokens(text) {
  return extractVariableTokens(text).filter((n) => !isKnownTemplateVariable(n));
}

module.exports = {
  TEMPLATE_VARIABLES,
  INTERNAL_TEMPLATE_VARIABLES,
  VARIABLE_CATEGORY_ORDER,
  isKnownTemplateVariable,
  isAlwaysEmptyVariable,
  variablesForGameType,
  variableCategories,
  variableCategoriesForGameType,
  extractVariableTokens,
  extractBracketDirections,
  unknownVariableTokens,
};
