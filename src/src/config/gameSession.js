/**
 * Everything the host screen knows about *the game it is currently running*.
 *
 * The bug that prompted this module: the host could be mid-game, hit "Switch
 * Game", Quick Start a new one, and still be looking at the previous game —
 * old question, old phase, old answers — until they manually refreshed the
 * browser. Nothing on the create/join paths cleared per-game state, and the
 * server restore (`restoreGameState`) only ever *adds*: on a freshly started
 * game the backend reports `currentQuestion: 0`, so the whole
 * `if (questionNumber > 0)` branch that loads questions/answers/progress is
 * skipped and the previous game's values survive untouched.
 *
 * There were also two competing half-resets — `handleStartNewGame` set a
 * hand-picked dozen setters inline, and a dead `handleNewGame` that reset
 * nothing at all. A partial reset is worse than none: it produces a mostly-new
 * game with one stale panel, which nobody notices until it misleads a room.
 *
 * So: ONE list, here, and one `resetGameSession()` that every switch/create/join
 * path calls. Adding a new piece of per-game state means adding it here — and
 * `__tests__/gameSession.test.js` fails if the host's setter map drifts from
 * this list, so "I forgot to reset it" cannot ship quietly.
 *
 * NOT included, deliberately:
 *   - navigation/modal flags (showWelcomeScreen, showQuickstartMenu,
 *     showNewGameDialog, showReportsModal) — the caller drives those, and
 *     resetting them here would fight the caller.
 *   - the create dialog's own inputs (engagementType, triviaTimer,
 *     randomizeQuestions, newGameSetId, eventDetails) — they are the form, not
 *     the game.
 *   - libraries that are refetched anyway (questionSets, personas).
 *   - the display profile and qrSidebarVisible — room-display preferences. A
 *     host running a projector wants it to stay a projector across games; the
 *     profile is persisted to localStorage for the same reason, and a reset
 *     here would undo a reload's whole point.
 *   - wsConnected — owned by the WebSocket client's own callback.
 */

/**
 * A fresh initial value for every per-game key.
 *
 * Returns a NEW object with NEW collection instances on every call, so two
 * resets can never end up sharing a Set or an array.
 *
 * `questions` and `currentQuestionId` are listed adjacently on purpose. They
 * must always move together: `currentQuestionOf()` resolves the live question
 * by id, so clearing one without the other reintroduces the Art Title round
 * bug fixed in 6cba1525, where the instruction resolver got `undefined` and
 * every art round showed the generic call-and-answer prompt.
 */
export function initialGameSession() {
  return {
    // --- the round in play ---------------------------------------------
    gameState: 'CREATED',
    currentGameType: 'call-and-answer',
    // Whether THIS game holds authorship back until reveal — set once at
    // creation (config/anonymity.js: createPayloadFor) and constant for the
    // game's lifetime. Default ON, matching the backend gate's own default,
    // so the brief window before a restored game's real value loads is the
    // safe (hidden) state rather than the open one.
    anonymousUntilReveal: true,
    questions: [],
    currentQuestionId: '',
    currentQuestionIndex: -1,
    lessonNumber: 0,
    // Whether the round in play has shown its authors. Round-scoped, exactly
    // like lessonNumber — a new game must not inherit the last one's reveal.
    authorsRevealed: false,
    // The projector-only override on top of it. Same reason it is listed here:
    // a host who hid the names on the last game's final round must not walk
    // into the next game's results with them already hidden.
    authorsHiddenOnStage: false,

    // --- the room ------------------------------------------------------
    players: [],
    answers: [],
    playersWhoAnswered: [],
    votes: [],
    playersWhoVoted: [],
    currentQuestionVotes: [],

    // --- what the question set says ------------------------------------
    selectedSetId: '',
    customInstruction: null,
    setRoundNoun: null,
    categories: [],
    activeCategoryIds: new Set(),
    categoryCounts: null,
    categoryBitmasks: null,
    isTogglingCategory: false,

    // --- Workie's voice for this session --------------------------------
    gamePersonaId: '',
    personaSwitchStatus: '',

    // --- AI summaries ---------------------------------------------------
    aiSummaries: {},
    currentAIInsights: null,
    loadingAIInsights: false,

    // --- reports ---------------------------------------------------------
    showReport: false,
    reportData: null,
    showFinalReport: false,

    // --- panels and transient banners tied to the current game ----------
    eventTitle: '',
    lessonExpanded: false,
    instructionsVisible: false,
    showExpandedQR: false,
    questionSetTabVisible: false,
    showQuestionBrowser: false,
    browsingQuestions: [],
    selectedCategory: '',
    inviteCopied: false,
    isLoadingData: false,
    isRestoringState: false,
    manualStateChange: false,
    gameDebugMode: false,
  };
}

/** Every per-game key, in declaration order. */
export function gameSessionKeys() {
  return Object.keys(initialGameSession());
}

/**
 * Put every per-game value back to its initial state.
 *
 * @param setters  { key: setterFn } — one React setter per key above.
 * @param overrides values to use instead of the initial one (e.g. the new
 *                  game's title, so the caller does not have to reset-then-set
 *                  and risk the two landing in the wrong order).
 * @returns the values that were applied, for assertions and logging.
 *
 * A missing setter is a programming error, but it is reported rather than
 * thrown: losing one field is bad, blowing up halfway through a game switch
 * and leaving the host on a half-reset screen is worse.
 */
export function resetGameSession(setters, overrides = {}) {
  const applied = { ...initialGameSession(), ...overrides };
  const missing = [];

  for (const key of Object.keys(applied)) {
    const setter = setters && setters[key];
    if (typeof setter !== 'function') {
      missing.push(key);
      continue;
    }
    setter(applied[key]);
  }

  if (missing.length > 0) {
    console.error(
      `resetGameSession: no setter supplied for ${missing.join(', ')} — ` +
      'these will keep the previous game\'s values.'
    );
  }

  return applied;
}
