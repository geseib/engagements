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
 *     showNewGameDialog, showReportsModal, showSetsDialog) — the caller drives
 *     those, and resetting them here would fight the caller.
 *   - the create dialog's own inputs — they are the form, not the game, and
 *     since the extraction they live inside components/GameSetupDialog.jsx,
 *     which unmounts when the dialog closes: engagementType, newGameSetId,
 *     randomizeQuestions, anonymousResponses, eventDetails, gameAiContext,
 *     newGamePersonaId, localSets, localTitle. (This list named five and omitted three until the
 *     extraction. `localTitle` is the edit-mode title — an edit targets a
 *     session from history, not the one on stage, so it must not live in the
 *     page's `eventTitle`; it seeds from `initialValues` and dies with the
 *     dialog. `__tests__/gameSession.test.js` now fails if the dialog owns
 *     a key this file is responsible for, or owns one this list does not name.
 *     `triviaTimer` was on the old list and is deleted outright — the backend
 *     never read it. `localSets` joined that list with the host's question-set
 *     side task: it caches what `GET /admin/question-sets` returned while the
 *     host was making or renaming a set, so the picker can offer a new set at
 *     once rather than after a reload. That is library data, like `questionSets`
 *     below, and it dies with the dialog regardless.)
 *   - libraries that are refetched anyway (questionSets, personas).
 *   - the display profile — a room-display preference. A host running a
 *     projector wants it to stay a projector across games; the profile is
 *     persisted to localStorage for the same reason, and a reset here would
 *     undo a reload's whole point. `qrSidebarVisible` was named here on the
 *     same grounds and no longer exists: `setupPanelOpen` replaced it and IS
 *     reset, because the panel's contents are per-game rather than per-room.
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
    // Whether THIS game holds authorship back — chosen at creation
    // (config/anonymity.js: createPayloadFor) and NO LONGER constant for the
    // game's lifetime: the session sidebar's Settings tab now sets the same
    // flag while the session runs, because the owner asked for author reveal to
    // be *"just a setting on the settings tab in the session sidebar"*. One
    // flag, two places to set it — there is deliberately no second boolean for
    // the same decision. Default ON, matching the backend gate's own default,
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
    // `authorsHiddenOnStage` USED TO BE HERE — the projector-only override on
    // top of the reveal, a Show/Hide authors button that lived on the RESULTS
    // stage and reset every round. IT IS RETIRED, not lost: the owner ruled the
    // decision session-level with no per-round override, so
    // `anonymousUntilReveal` above now does its job and `stageLabelFor` reads
    // that instead. Its one surviving caveat moved with it into that function's
    // doc-block — hiding a name on the stage is display-only and un-sends
    // nothing. The reason it was listed here (a host who hid the names on the
    // last game's final round must not walk into the next game's results with
    // them already hidden) is answered by `anonymousUntilReveal` being reset
    // here too.
    //
    // Whether the room meter may name who has not responded yet, on a session
    // that is hiding authors. The second of the two name decisions the owner
    // moved out of the code (config/anonymity.js: MIN_ANONYMOUS_ANSWERS was a
    // hard block and is now a sentence). Listed here rather than treated as a
    // room preference like `profile`: it is a judgement about THIS room's
    // sensitivity, and carrying it into the next session's first round would be
    // the same "one stale panel" failure this module exists to stop.
    nameWaitingWhenAnonymous: true,

    // --- the room ------------------------------------------------------
    players: [],
    // WHO LEFT. Kept out of `players` by get-players.js, so every count the
    // page derives from `players.length` is a count of the room rather than of
    // the session's history. Per-game like the roster itself: a removal from
    // the last session must not follow the host into the next one.
    removedPlayers: [],
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

    // --- panels and transient banners tied to the current game ----------
    eventTitle: '',
    /*
      WHEN THIS SESSION WAS CREATED, which the invite dialog needs because the
      retention deadline is creation + 90 days.

      It is per-game and belongs on this list for exactly the reason the list
      exists: without it, switching sessions would leave the PREVIOUS session's
      creation date in place, and the dialog would check a chosen date against
      the wrong deadline — silently, and only in the direction that says yes.
      __tests__/gameSession.test.js caught the omission before it shipped.
    */
    gameCreatedAt: null,
    lessonExpanded: false,
    showExpandedQR: false,
    // The rail's QR: null | 'preview' | 'pinned'. Session-scoped like every
    // other overlay flag here — a QR left pinned when the host Quick Starts a
    // new game would otherwise stay full-screen over the new lobby, still
    // suppressing SPACE, rendering a join code for a game that no longer runs.
    qrMode: null,
    // The session setup panel, which replaced both side panels, both edge tabs
    // and the full-screen question browser. Unlike the display profile it is
    // NOT a room-display preference: all three of its tabs are about the game
    // in play — the roster, the live per-category remaining counts, and the
    // browser's already-asked marks — so leaving it open across a Quick Start
    // shows the next room the last game's facts.
    setupPanelOpen: false,
    browsingQuestions: [],
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
