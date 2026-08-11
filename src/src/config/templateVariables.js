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
const SCORED_TYPES = ['call-and-answer', 'trivia'];

const TEMPLATE_VARIABLES = [
  // ---- SET INFO ------------------------------------------------------------
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
    name: 'activeParticipants',
    description: 'Number of players who participated in voting',
    category: 'Player Info',
    gameTypes: ['call-and-answer'],
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
    name: 'playerRankings',
    description: 'Formatted leaderboard with player rankings and scores',
    category: 'Player Info',
    gameTypes: SCORED_TYPES,
    example: '1st: Alice (15 pts), 2nd: Bob (12 pts), 3rd: Charlie (8 pts)',
  },
  {
    name: 'topPerformers',
    description: 'Top 3 players with the highest scores',
    category: 'Player Info',
    gameTypes: SCORED_TYPES,
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
    name: 'correctAnswer',
    description: 'The correct answer for a trivia question',
    category: 'Question Info',
    gameTypes: ['trivia'],
    example: 'The correct answer is B: Machine Learning',
  },
  {
    name: 'triviaChoices',
    description: 'All multiple-choice options for a trivia question',
    category: 'Question Info',
    gameTypes: ['trivia'],
    example: 'A) Artificial Intelligence, B) Machine Learning, C) Deep Learning, D) Neural Networks',
  },
  {
    name: 'answerDetails',
    description: "The question author's background note explaining the answer",
    category: 'Question Info',
    gameTypes: ['trivia'],
    example: 'Machine Learning is a subset of AI that focuses on learning from data...',
  },
  {
    name: 'difficulty',
    description: 'Difficulty level of the question',
    category: 'Question Info',
    gameTypes: ['trivia'],
    example: 'easy, medium, hard',
  },
  {
    name: 'pollOptions',
    description: 'The options that were on screen for this poll',
    category: 'Question Info',
    gameTypes: ['poll', 'survey'],
    example: 'A) Ship it Friday, B) Wait for the audit, C) Split the release',
  },

  // ---- ANSWERS -------------------------------------------------------------
  {
    name: 'playerAnswers',
    description: 'All player responses to the question, with names',
    category: 'Answers',
    gameTypes: SCORED_TYPES,
    example: 'Alice: "I approached the customer concern by...", Bob: "In my experience..."',
  },
  {
    name: 'playerResponses',
    description: 'All player responses to the question, with names (same content as playerAnswers)',
    category: 'Answers',
    gameTypes: ['call-and-answer', 'trivia', 'poll'],
    example: 'Alice: "I approached the customer concern by...", Bob: "In my experience..."',
  },
  {
    name: 'responseCount',
    description: 'Number of players who submitted a response',
    category: 'Answers',
    gameTypes: ['call-and-answer', 'trivia', 'poll', 'survey'],
    example: '8 responses, 12 participants answered',
  },
  {
    name: 'responsesText',
    description: 'Numbered list of all player responses with names',
    category: 'Answers',
    gameTypes: ['call-and-answer'],
    example: '1. Alice: "I approached this by...", 2. Bob: "My strategy was..."',
  },
  {
    name: 'triviaResponses',
    description: 'Trivia answers showing which choice each player selected',
    category: 'Answers',
    gameTypes: ['trivia'],
    example: 'Alice: A (Incorrect), Bob: B (Correct), Charlie: C (Incorrect)',
  },
  {
    name: 'correctCount',
    description: 'Number of players who answered the trivia question correctly',
    category: 'Answers',
    gameTypes: ['trivia'],
    example: '5 out of 8 players answered correctly',
  },
  {
    name: 'uniqueAnswers',
    description: 'The distinct answers given, with how many chose each',
    category: 'Answers',
    gameTypes: ['poll', 'survey'],
    example: 'Ship it Friday (5), Wait for the audit (3)',
  },
  {
    name: 'answerCategories',
    description: 'Responses grouped into themes',
    category: 'Answers',
    gameTypes: ['poll', 'survey'],
    example: 'Speed-first (5), Risk-first (3)',
  },

  // ---- VOTES ---------------------------------------------------------------
  {
    name: 'voteCount',
    description: 'Total number of votes cast',
    category: 'Votes',
    gameTypes: ['call-and-answer'],
    example: '24 total votes, 8 voting players',
  },
  {
    name: 'votingParticipation',
    description: 'Percentage of players who participated in voting',
    category: 'Votes',
    gameTypes: ['call-and-answer'],
    example: '75%, 100%',
  },
  {
    name: 'votingPattern',
    description: 'How the votes were distributed — concentrated on one answer or spread',
    category: 'Votes',
    gameTypes: ['call-and-answer'],
    example: 'Votes concentrated on two responses; nobody ranked the rest',
  },
  {
    name: 'consensusLevel',
    description: 'Level of agreement among voters',
    category: 'Votes',
    gameTypes: ['call-and-answer', 'wavelength'],
    example: 'Strong consensus, Moderate agreement, Diverse opinions',
  },

  // ---- VOTE TALLY ----------------------------------------------------------
  {
    name: 'voteTally',
    description: 'Detailed breakdown of votes received by each response',
    category: 'Vote Tally',
    gameTypes: ['call-and-answer'],
    example: 'Alice: 3 first-place, 2 second-place votes (13 points)',
  },
  {
    name: 'topVotedAnswers',
    description: 'Top 3 most-voted responses with their vote detail',
    category: 'Vote Tally',
    gameTypes: ['call-and-answer'],
    example: "Alice's response (13 points), Bob's response (8 points)",
  },
  {
    name: 'votingBreakdown',
    description: 'Per-response vote counts by rank',
    category: 'Vote Tally',
    gameTypes: ['call-and-answer'],
    example: 'Response 1: 3x1st, 1x2nd; Response 2: 1x1st, 3x3rd',
  },

  // ---- RESULTS -------------------------------------------------------------
  {
    name: 'finalResults',
    description: 'Top 3 results with rankings and scores or correctness',
    category: 'Results',
    gameTypes: SCORED_TYPES,
    example: 'Alice: Leadership approach (13 points), Bob: Process improvement (8 points)',
  },
  {
    name: 'winnerInfo',
    description: 'Information about the winner(s) of this round',
    category: 'Results',
    gameTypes: SCORED_TYPES,
    example: 'Winner: Alice with "I approached the problem by..." (13 vote points)',
  },
  {
    name: 'resultsSummary',
    description: 'One-line summary of the round result and participation',
    category: 'Results',
    gameTypes: ['call-and-answer', 'trivia', 'wavelength'],
    example: 'Clear winner with 54% of possible vote points',
  },
  {
    name: 'participationRate',
    description: 'Participation statistics for answering and voting',
    category: 'Results',
    gameTypes: SCORED_TYPES,
    example: '100% answered, 75% voted',
  },
  {
    name: 'triviaCorrectness',
    description: 'Correctness summary for a trivia question',
    category: 'Results',
    gameTypes: ['trivia'],
    example: '5 correct answers, 3 incorrect answers (62% accuracy)',
  },

  // ---- SCORES --------------------------------------------------------------
  {
    name: 'cumulativeScores',
    description: 'All player scores accumulated across every round so far',
    category: 'Scores',
    gameTypes: SCORED_TYPES,
    example: 'Alice: 28 points, Bob: 22 points, Charlie: 15 points',
  },
  {
    name: 'scoreChanges',
    description: 'Points earned by each player in this specific round',
    category: 'Scores',
    gameTypes: SCORED_TYPES,
    example: 'Alice: +13 points, Bob: +8 points, Charlie: +5 points',
  },
  {
    name: 'roundScores',
    description: 'This round\'s scores as a standalone table',
    category: 'Scores',
    gameTypes: SCORED_TYPES,
    example: 'Alice 13, Bob 8, Charlie 5',
  },
  {
    name: 'leaderboard',
    description: 'Current top 5 players with rankings and total scores',
    category: 'Scores',
    gameTypes: SCORED_TYPES,
    example: '1st: Alice (28 pts), 2nd: Bob (22 pts), 3rd: Charlie (15 pts)',
  },
  {
    name: 'scoringSystem',
    description: 'How points were awarded this round',
    category: 'Scores',
    gameTypes: SCORED_TYPES,
    example: '3 points for a first-place vote, 2 for second, 1 for third',
  },
  {
    name: 'averageScore',
    description: 'Average score across all players',
    category: 'Scores',
    gameTypes: SCORED_TYPES,
    example: '18.5 points, 12.3 points',
  },

  // ---- WAVELENGTH ----------------------------------------------------------
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

/** Advertised variables available for one canonical game type id. */
function variablesForGameType(gameType) {
  return TEMPLATE_VARIABLES.filter((v) => v.gameTypes.includes(gameType));
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

/** The tokens in this text that nothing will ever substitute. */
function unknownVariableTokens(text) {
  return extractVariableTokens(text).filter((n) => !isKnownTemplateVariable(n));
}

module.exports = {
  TEMPLATE_VARIABLES,
  INTERNAL_TEMPLATE_VARIABLES,
  VARIABLE_CATEGORY_ORDER,
  isKnownTemplateVariable,
  variablesForGameType,
  variableCategories,
  variableCategoriesForGameType,
  extractVariableTokens,
  unknownVariableTokens,
};
