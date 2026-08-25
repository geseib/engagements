import React, { useState, useEffect, useRef, useCallback } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import webSocketClient from './WebSocketClient';
import { requestNextQuestion } from './utils/nextQuestion';
import { fetchQueue, postQueueOp } from './utils/questionQueueClient';
import { postExclusionOp } from './utils/questionExclusionsClient';
import { queueEnqueue, queueMove, queueRemove, normaliseQueue, materializePlanOps } from './config/questionQueue';
import { focusFromFrame, focusToStage, focusRequest, sameFocus } from './config/stageFocus';
import IssueFab from './components/IssueFab';
import QuickstartMenu from './components/QuickstartMenu';
import GameSetupDialog from './components/GameSetupDialog';
import WelcomeScreen from './components/WelcomeScreen';
import HostQuestionSetsDialog from './components/HostQuestionSetsDialog';
import WavelengthConvergence from './components/stage/WavelengthConvergence';
import Icon from './components/Icon';
import Modal from './components/Modal';
import SetImageBadge from './components/SetImageBadge';
import SessionHistoryPanel from './components/SessionHistoryPanel';
import InviteDialog from './components/InviteDialog';
import HostActionBar from './components/HostActionBar';
import GameReport from './components/GameReport';
import AISummaryStatus from './components/AISummaryStatus';
import Stage from './components/stage/Stage';
import Rail from './components/stage/Rail';
import RoomMeter from './components/stage/RoomMeter';
import Podium from './components/stage/Podium';
import WavelengthSessionVocabulary from './components/stage/WavelengthSessionVocabulary';
import Dock from './components/stage/Dock';
import Pager from './components/stage/Pager';
import SessionSetupPanel from './components/stage/SessionSetupPanel';
import { loadProfile, saveProfile, toggleBigScreen } from './config/displayProfile';
import {
  pageSizeFor, pageSlice, prosePageSlice, proseBudgetFor, pageCount, clampPage,
} from './config/stagePaging';
import { assignPlacements, placeLabel } from './config/podium';
import { autoDecision } from './config/autoMode';
import AnswerSpotlight from './components/AnswerSpotlight';
import ConfirmDialog from './components/ConfirmDialog';
import { pageOf } from './utils/answerSpotlight';
import PastRound from './components/PastRound';
import { roundsFrom } from './config/sessionHistory';
import { qrOverlayClassName } from './utils/qrOverlayClassName';
import { shortcutsSuppressed, qrOverlayInstructions } from './utils/hostOverlays';
import {
  resolveInstruction, currentQuestionOf, resolveRoundNoun, pluralRoundNoun,
} from './config/instructions';
import { resetGameSession } from './config/gameSession';
import {
  classifyAISummaryFailure, shouldAutoRetry, autoRetryDelayMs, isOnline,
  AI_NOTIFICATION_TIMEOUT_MS, AI_POLL_ATTEMPTS, AI_POLL_INTERVAL_MS,
} from './utils/aiSummaryRecovery';
import { createGameBody, updateGameBody } from './config/createGame';
import { DEFAULT_SCOPE } from './utils/setRef';
import { gameTypeMeta, gameTypeLabel } from './config/gameTypes';
import {
  hostControlsFor, phaseOfGameState, isLobbyState, HOST_INTENTS, roomIsComplete,
  stageBeatFromFrame,
} from './config/hostControls';
import {
  anonymityApplies, authorsHiddenNow, createPayloadFor, displayLabelFor,
  stageLabelFor, standingsVisible, playerAnsweredActions, answeredNamesFrom,
  answeredCountFrom, waitingRoster, joinedRoster, answererIdsFrom,
} from './config/anonymity';
import { useAuth } from './auth/AuthContext';
import { authFetch } from './auth/authFetch';

const API_BASE = window.API_BASE;

/**
 * How far above its ladder each state may grow, from the mockups' own
 * `data-grow` attributes (01-lobby: 1.5, 02-ask: 1.35). Everything denser than
 * those runs at the ladder.
 */
const STAGE_GROW = { LOBBY: '1.5', ASK: '1.35', ENDED: '1.5' };

/** Trivia answer slots, in display order. */
const TRIVIA_OPTION_KEYS = ['optionA', 'optionB', 'optionC', 'optionD', 'optionE', 'optionF'];

/**
 * Is this option slot the correct answer?
 *
 * Question sets in the wild record `correctAnswer` four different ways —
 * "OptionA", "A", the option's own text, or an array of any of those — so the
 * comparison has to try all of them. Lifted verbatim out of the RESULTS render
 * when that moved onto the stage; the logic is unchanged.
 */
function isCorrectTriviaOption(question, key, letter) {
  if (!question) return false;
  const optionId = `Option${letter}`;
  const candidates = Array.isArray(question.correctAnswer)
    ? question.correctAnswer
    : [question.correctAnswer];

  for (const correct of candidates) {
    if (!correct) continue;
    if (correct === optionId || correct === letter || correct === question[key]) return true;
    if (typeof correct === 'string' && correct.startsWith('Option')) {
      const correctLetter = correct.replace('Option', '');
      if (`option${correctLetter}` === key || correctLetter === letter) return true;
    }
    if (typeof correct === 'string' && correct.length === 1 && /[A-F]/.test(correct)) {
      if (`option${correct}` === key || correct === letter) return true;
    }
  }
  return false;
}

function GameHostPage() {
  // 🎯 AUTHENTICATION
  const { currentUser, signOut } = useAuth();
  
  // 🎯 GAME ID MANAGEMENT: Use URL as single source of truth
  const [gameId, setGameId] = useState('');
  /*
    Bumped by every switchToGame(), including one that re-opens the game
    already in `gameId`. It exists ONLY to re-fire the restore effect in that
    same-id case — React bails out of a same-id setGameId entirely, and an
    effect keyed on `[gameId]` alone never ran, leaving the freshly cleared
    slate on screen as the session (game 5486). See switchToGame.
  */
  const [sessionEpoch, setSessionEpoch] = useState(0);
  
  // `isLobbyState` is imported from config/hostControls.js, beside
  // `phaseOfGameState`. It was a closure here, where no test could reach it,
  // and it is the correction to the defect this whole change is named after —
  // a finished session rendering the lobby.
  const [players, setPlayers] = useState([]);
  /* THE PEOPLE THE HOST HAS REMOVED, held separately from `players` and not
     merged back in anywhere.

     That separation is what makes the feature safe in a 5,000-line component:
     `players.length` appears a dozen times in here as the denominator of "N
     answered", the LOBBY count, the "waiting for" copy and two confirm
     dialogs. Because get-players.js filters the departed out of `players`
     server-side, every one of those became a count of the room without being
     touched. The only screen that needs the departed is the Players tab, and
     it takes them as its own prop. */
  const [removedPlayers, setRemovedPlayers] = useState([]);
  const [questions, setQuestions] = useState([]);
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(-1);
  const [currentQuestionId, setCurrentQuestionId] = useState('');
  const [answers, setAnswers] = useState([]);
  /* Wavelength RESULTS payload (wordAnalysis): landed words, near-miss tier,
     denominator, matching mode. Set from the close-round/get-results response,
     upgraded in place by the `wavelengthAnalysisReady` frame when the
     clustering worker finishes, cleared with the rest of the round state. */
  const [wavelengthAnalysis, setWavelengthAnalysis] = useState(null);
  const [gameState, setGameStateRaw] = useState('CREATED'); // CREATED, STARTED, ASK#001, VOTE#001, RESULTS#001, etc.
  
  // Debug wrapper for setGameState
  const setGameState = (newState) => {
    console.log(`🚨 DEBUG: setGameState called - changing from "${gameState}" to "${newState}"`);
    console.trace('🚨 DEBUG: setGameState call stack');
    setGameStateRaw(newState);
  };

  /**
   * `gameState`, readable from inside the WebSocket effect.
   *
   * That effect is registered once per (gameId, useWebSocket), so anything it
   * closes over is frozen at the render that registered it — the same trap
   * `remoteActionsRef` exists for further down. A handler that needs to know
   * which round is on screen (`stageBeatChanged`) would otherwise compare every
   * announcement against 'CREATED' and silently ignore all of them.
   */
  const gameStateRef = useRef(gameState);
  useEffect(() => { gameStateRef.current = gameState; }, [gameState]);
  /*
    THE ROUND'S ANSWERS, FOR THE FROZEN CLOSURES — same reason as the line above.

    `stageFocusChanged` clamps an incoming spotlight index against how many
    responses actually exist, so that a focus for a response that has not
    arrived opens nothing rather than an empty overlay. The WebSocket effect
    registers ONCE, at first render, when `answers` is `[]` — so reading the
    state directly would compare every index against 0 and the phone's spotlight
    would never open at all.
  */
  const answersRef = useRef([]);
  /*
    A FOCUS RESTORED FROM THE SERVER, WAITING FOR ITS ANSWERS.

    `restoreGameState` learns the round's focus before it fetches the round's
    responses, and `AnswerSpotlight` reads `answers[index].points` — so applying
    a spotlight index against an empty array throws. Parked here, drained below
    the moment the rows land, cleared either way so a stale focus cannot reopen
    on a later round.
  */
  const pendingFocusRef = useRef(null);
  useEffect(() => {
    answersRef.current = answers;

    if (!pendingFocusRef.current) return;
    const restored = focusToStage(pendingFocusRef.current, { answerCount: answers.length });
    pendingFocusRef.current = null;
    setLessonExpanded(restored.lessonExpanded);
    setSpotlightIndex(restored.spotlightIndex);
  }, [answers]);
  const [currentGameType, setCurrentGameType] = useState('call-and-answer'); // Track the type of the current game
  // Whether THIS game holds authorship back until reveal — the per-game flag
  // from setup (config/anonymity.js), as opposed to anonymityApplies(), which
  // only knows whether the TYPE supports it. Default ON, matching the backend.
  const [anonymousUntilReveal, setAnonymousUntilReveal] = useState(true);
  const [playersWhoAnswered, setPlayersWhoAnswered] = useState([]);

  /**
   * How many responses are in — the number the meter prints, the number the
   * dock reasons about, and the number the "not everyone has answered" warnings
   * quote.
   *
   * NOT `playersWhoAnswered.length`. That list is names, and on an anonymous
   * round the `playerAnswered` frame carries none by design, so it could only
   * grow on a re-sync: the count sat still while the room typed and jumped when
   * the host happened to refocus the tab, and "Start Voting" warned that 0 of 8
   * had answered when all 8 had. See config/anonymity.js: answeredCountFrom.
   *
   * Declared up here with the state it derives from, because the confirmation
   * handlers below close over it as well as the render does.
   */
  const answeredCount = answeredCountFrom(playersWhoAnswered, answers);

  const [votes, setVotes] = useState([]);
  const [playersWhoVoted, setPlayersWhoVoted] = useState([]);
  const [currentQuestionVotes, setCurrentQuestionVotes] = useState([]);
  const [manualStateChange, setManualStateChange] = useState(false);
  const [lessonExpanded, setLessonExpanded] = useState(false);
  // THE ONE HOST PANEL. It replaced both edge tabs, both side panels and the
  // full-screen question browser — four surfaces, one dock button. Closed by
  // default: it is a fixed overlay over a fixed-height stage, so opening it is
  // a deliberate inspection, and the dock's SETUP button is its permanent,
  // discoverable entry point (`\` is an accelerator only).
  const [setupPanelOpen, setSetupPanelOpen] = useState(false);




  const [showExpandedQR, setShowExpandedQR] = useState(false);
  /**
   * null | 'preview' | 'pinned'.
   *
   * Three values rather than a boolean because only ONE of them may suppress
   * the SPACE shortcut. A host who rests the mouse near the rail and loses
   * their advance key has been given a worse screen; a pinned QR is a
   * deliberate act with a deliberate dismissal, so that one counts.
   */
  const [qrMode, setQrMode] = useState(null);
  // No other overlay on this page has an Escape handler to fold into, so this
  // one is scoped to qrMode alone rather than joining a shared listener.
  useEffect(() => {
    if (!qrMode) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') setQrMode(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [qrMode]);
  /**
   * null | 'preview' | 'pinned' — the meter's waiting-list reveal.
   *
   * Three values and an Escape handler, mirroring qrMode above, because it is
   * the same interaction (RoomMeter.jsx's doc-block says which two details
   * differ and why). It is NOT a term in shortcutsSuppressed: the list draws a
   * few lines inside the meter's own column and covers nothing, least of all
   * the dock, so suppressing the advance key for it would take SPACE away
   * while the dock still advertised it.
   */
  const [rosterMode, setRosterMode] = useState(null);
  useEffect(() => {
    if (!rosterMode) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') setRosterMode(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [rosterMode]);
  /**
   * WHICH PAGE OF THE STAGE IS ON THE WALL.
   *
   * One index, three states. VOTE and RESULTS page the answer list; FIELD_NOTES
   * pages Workie's summary, which is prose rather than items and is cut by
   * config/stagePaging.js's `prosePageSlice`. They share this because the key
   * below carries the PHASE, so they can never be live at once and a second
   * piece of state would only be a second reset to keep in step with this one.
   *
   * KEYED TO THE BEAT, WHICH IS WHAT MAKES THE RESET FREE. The state carries
   * the phase and round it belongs to and is read back only for that beat, so a
   * new round starts at page 1 with no effect to run — the same shape as
   * `rosterMode` above, and chosen for the same reason plus one more: RESUME.md
   * records that the `resultsBeat` reset effect is fragile on purpose and has
   * already cost one live defect, because an effect that resets on a dependency
   * change fires on dependency changes nobody intended. A key comparison cannot
   * do that. Nothing reflows when the beat changes underneath the host; the page
   * simply reads 0 for a beat it was not set on.
   *
   * ANSWERS ARRIVE WHILE THE HOST IS PAGING, so the index is CLAMPED rather
   * than reset when the list shrinks (config/stagePaging.js's clampPage). A page
   * turn is never undone by an unrelated arrival, and a host parked past the end
   * lands on the last page that exists rather than on a blank stage.
   */
  const [stagePage, setStagePage] = useState(null);
  /**
   * The pending hidden-round participation refresh — see
   * `scheduleAnswererSync`, which is where the whole mechanism is explained.
   * A ref rather than state because nothing renders from it and a re-render
   * per socket frame is what this is trying to avoid in the first place.
   */
  const answererSyncRef = useRef(null);
  // A timer may outlive a render; it must never outlive the page. Without this
  // a fetch fires into an unmounted component after the host has left the
  // stage, which React answers with a warning and nobody reads.
  useEffect(() => () => {
    if (answererSyncRef.current) clearTimeout(answererSyncRef.current);
    answererSyncRef.current = null;
  }, []);

  const [showReport, setShowReport] = useState(false);
  const [reportData, setReportData] = useState(null);
  // 'idle' | 'loading' | 'ready' | 'error'. The report is BUILT on demand —
  // `POST games/{id}/report` re-derives it every time — so opening it is a
  // request, not a navigation, and the shell has to be able to say so.
  const [reportStatus, setReportStatus] = useState('idle');
  const [reportError, setReportError] = useState(null);
  // Which session the open report is for, so Try again can retry THAT one.
  // Not `gameId`: the report is also opened from the history list, for
  // sessions that are not the one currently loaded.
  const [reportTarget, setReportTarget] = useState(null);
  const [lessonNumber, setLessonNumber] = useState(0);

  /**
   * THE ROUNDS PLAYED SO FAR — for the Rounds tab and the dialog behind it.
   *
   * NO NEW ENDPOINT. `POST /games/{gameId}/report` already assembles exactly
   * this: create-report.js queries the results rows, the votes, the AI
   * summaries and each round's source question, ranks the answers, and returns
   * one entry per round. It is also the route that already redacts correctly
   * for this data, and reimplementing that judgement somewhere else is the
   * specific mistake that hid the names and the podium for a whole session
   * earlier this week. config/sessionHistory.js has the full reasoning,
   * including what the call costs.
   *
   * Refetched whenever the round advances, so a host who opens the tab after
   * three more rounds does not read a stale list. `lessonNumber` is the trigger
   * rather than `gameState` because a single round passes through ASK, VOTE and
   * RESULTS and only the last of those changes what this shows.
   */
  const [rounds, setRounds] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [pastRoundIndex, setPastRoundIndex] = useState(null);
  /*
    WHICH ANSWER IS BEING READ IN FULL, or null. An ABSOLUTE index into
    `answers`, never a page-relative one — utils/answerSpotlight.js has why that
    distinction is the whole of the arithmetic.

    IT LIVES UP HERE BECAUSE IT IS A HOOK, and that is not a style preference.
    It was declared beside `answerPage`, ~1000 lines down and BELOW five early
    returns (showQuickstartMenu, showWelcomeScreen, showReport, showReportsModal,
    showNewGameDialog). On the Quick Start menu the component returned at the
    first of those and this `useState` never ran; picking a lesson cleared the
    flag, the render carried past it, and React counted one more hook than the
    time before — error #310, and a blank page in front of a host.

    Every hook has to run on every render. The helper below may stay where it
    is, because a function is not a hook.
  */
  const [spotlightIndex, setSpotlightIndex] = useState(null);
  const [regeneratingRounds, setRegeneratingRounds] = useState([]);

  const loadRounds = useCallback(async () => {
    if (!gameId) return;
    setHistoryLoading(true);
    try {
      const res = await fetch(`${API_BASE}games/${gameId}/report`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      if (!res.ok) {
        // A session with no completed round has no report, and that is the
        // normal state for the first few minutes of every game — not an error
        // worth putting in front of the host. The tab's empty copy says it.
        console.log(`ℹ️ HOST: no session report yet (${res.status})`);
        setRounds([]);
        return;
      }
      setRounds(roundsFrom(await res.json()));
    } catch (e) {
      console.error('Failed to load session rounds', e);
    } finally {
      setHistoryLoading(false);
    }
  }, [gameId]);

  useEffect(() => {
    if (setupPanelOpen) loadRounds();
  }, [setupPanelOpen, lessonNumber, loadRounds]);
  // The ENDED stage for wavelength aggregates every round's stored word
  // analysis into the session vocabulary — which lives in the report the
  // Sessions panel also reads. Fetch it on arrival at ENDED, or the band
  // would only appear for a host who happened to open that panel first.
  useEffect(() => {
    if (gameState === 'ENDED' && currentGameType === 'wavelength') loadRounds();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameState, currentGameType]);
  // SERVER TRUTH: has this round's AuthorsRevealed been set? It flips
  // automatically when the round enters RESULTS (get-results.js's
  // enterResultsState); handleRevealAuthors is the override for a host who
  // wants names back before voting closes.
  const [authorsRevealed, setAuthorsRevealed] = useState(false);
  // `authorsHiddenOnStage` USED TO BE HERE — a per-round, RESULTS-only display
  // toggle sitting beside a per-round server reveal, two controls for one
  // decision. The owner replaced both with ONE session setting in the sidebar's
  // Settings tab: *"Just leave the decision to the host."* That setting is
  // `anonymousUntilReveal` (above), and `stageLabelFor` now reads it. The
  // display-only caveat this comment carried is preserved in that function's
  // doc-block, because it is still true of the hide direction.
  //
  // The other half of the same ruling: whether the room meter may name who has
  // not responded yet while the session is hiding authors. It replaces
  // config/anonymity.js's MIN_ANONYMOUS_ANSWERS block, which withheld that list
  // below five responses with no override — dead for a whole session in a room
  // of four, which is the room the owner runs.
  const [nameWaitingWhenAnonymous, setNameWaitingWhenAnonymous] = useState(true);

  // AUTO-MODE — the session advances itself when everyone has responded,
  // dwelling on each page of responses and Workie prose first. The decisions
  // are config/autoMode.js's; the one timer that acts on them lives in the
  // effect just above the early returns, and it presses the SAME primary the
  // SPACE key does, so auto-mode cannot reach a state the host could not.
  const [autoMode, setAutoMode] = useState(false);
  // What the timer needs from the bottom of the render — hostControls' primary,
  // runHostAction, the stage pager — captured by plain assignment down where
  // they exist. A ref rather than deps because those are derived per render,
  // hundreds of lines below the first early return, where no hook may live.
  const autoActRef = useRef(null);

  // Custom instruction state for question set instructions
  const [customInstruction, setCustomInstruction] = useState(null);
  const [setRoundNoun, setSetRoundNoun] = useState(null); // per-set override, e.g. "Lesson"
  
  // Reports List Modal
  const [showReportsModal, setShowReportsModal] = useState(false);
  const [gamesList, setGamesList] = useState([]);
  const [reportsModalMode, setReportsModalMode] = useState('reports'); // 'reports' or 'select'
  
  // `showFinalReport` used to live here. Nothing ever rendered it, and after
  // the end-of-game dialog was deleted nothing set it either, so it survived
  // only as a term in `anyOverlayOpen` that could never be true. ENDED's
  // primary calls generateReportForGame directly.

  // WebSocket state
  const [wsConnected, setWsConnected] = useState(false);
  const [useWebSocket, setUseWebSocket] = useState(true); // Always use WebSocket

  // Flag to prevent auto-selection during game state restoration
  const [isRestoringState, setIsRestoringState] = useState(false);

  // The question browser is a SECTION of the setup panel now, not a modal, so
  // there is no separate "is it open" flag to keep in step with the panel's own
  // — `showQuestionBrowser` was that flag, and it was also the term that took
  // SPACE away while the browser covered the dock. What is left is the data.
  const [browsingQuestions, setBrowsingQuestions] = useState([]);
  const [loadingQuestions, setLoadingQuestions] = useState(false);
  /**
   * Which questions this host has already asked, so the browser can dim them
   * and offer `Ask again` rather than making the host remember.
   *
   * SESSION-LOCAL, AND THAT IS A LIMITATION WORTH KNOWING. The server tracks
   * "used" by round number (`QUESTION#<n>#RESULTS`) and by decrementing the
   * category counters — never as a list of set-question ids. `GET /games/{id}`
   * does return a `usedQuestions` array, but nothing ever writes it, so reading
   * it would report every question as unasked. This accumulates what the client
   * can actually see: the questions it has watched go by. It resets on reload.
   */
  const [usedQuestionIds, setUsedQuestionIds] = useState([]);

  /*
    THE RUNNING ORDER, AND WHY IT IS THREE PIECES OF STATE.

    `questionQueue` is the list; `queueVersion` is what the server had when we
    last heard from it, sent back with every op as `expectedVersion`; and
    `queueBusyKeys` names the rows with a request in flight so a host cannot
    fire three `earlier` ops into a 200ms round trip and watch the row travel
    three places for one intent.

    THIS PAGE IS THE ONLY OPTIMISTIC COPY. `SessionSetupPanel` and `QueueList`
    are presentational and reorder nothing locally, because the correction
    arrives here — over the WebSocket — and two optimistic copies would fight:
    the panel's would re-apply on the frame that was already the panel's own
    edit coming home.
  */
  const [questionQueue, setQuestionQueue] = useState([]);
  /*
    The planned running order from the server, queued items and automatic picks
    together. Held but never edited here: unlike `questionQueue` above — which
    this page keeps an optimistic copy of so a reorder feels instant — this is
    derived state with no local edit to be optimistic about, so it is only ever
    replaced wholesale by `loadUpNext`.
  */
  const [upNext, setUpNext] = useState([]);
  const [upNextBlocked, setUpNextBlocked] = useState([]);
  // Served-but-labeled one-offs (category off) and the host's veto list, both
  // straight from GET /up-next — the panel renders them, the ops below edit
  // the veto, and the reload after each op is what keeps the three in step.
  const [upNextAdvisories, setUpNextAdvisories] = useState([]);
  const [upNextExcluded, setUpNextExcluded] = useState([]);
  const [queueVersion, setQueueVersion] = useState(0);
  const [queueBusyKeys, setQueueBusyKeys] = useState([]);

  // Sign-out handler
  const handleSignOut = () => {
    if (window.confirm('Are you sure you want to sign out?')) {
      signOut();
      window.location.href = '/auth';
    }
  };

  // Welcome Screen
  const [showWelcomeScreen, setShowWelcomeScreen] = useState(true);
  const [continueGameId, setContinueGameId] = useState('');
  
  // New Game Dialog
  const [showNewGameDialog, setShowNewGameDialog] = useState(false);
  /*
    THE SESSION BEING EDITED from history — `{ gameId, values }` or null, where
    `values` is what GET /games/{id}?role=host returned (the prefill).
    Deliberately NOT the page's own eventTitle/selectedSetId state: an edit
    targets a session that need not be the one on stage, and must not disturb
    it. Non-null renders <GameSetupDialog mode="edit"> over the history modal.
  */
  const [editTarget, setEditTarget] = useState(null);
  /*
    THERE IS DELIBERATELY NO "LAST-USED SET" STATE HERE ANY MORE. A
    `pendingSetId` used to survive `leaveCurrentGame()` so the create dialog
    reopened on the set the host was just running. The owner retired it: "the
    create engagement should not remember or preselect that last picked
    question set." Every create now starts with the set unchosen — which also
    keeps the Create button honestly disabled until a deliberate pick is made,
    instead of enabled on a leftover.
  */
  const [showQuickstartMenu, setShowQuickstartMenu] = useState(false);
  /*
    THE HOST'S SET SHELF, REACHED WITHOUT STARTING A SESSION.

    <HostQuestionSetsDialog> already existed, and had exactly one door: the set
    picker inside the create screen. So a host who wanted to fix a name, upload
    a set, or delete one had to begin an engagement they did not want and then
    abandon it. Navigation state like the flags beside it, not a game value —
    nothing here survives into a session.
  */
  const [showHostSets, setShowHostSets] = useState(false);
  const [eventTitle, setEventTitle] = useState('');

  // EVERY OTHER FIELD ON THE CREATE SCREEN LIVES IN <GameSetupDialog>.
  // `eventTitle` stays because it is not only the form's — it is a per-game key
  // (config/gameSession.js) that the live host screen reads and that
  // resetGameSession() clears.
  //
  // `triviaTimer` used to live here too. It was deleted: create-game.js:9's
  // destructure is a whitelist that never named it, nothing in the product
  // reads a timer, and there is no countdown on any screen. The control did
  // nothing and its help text promised players thirty seconds they never got.

  // Workie's voice. '' means "adapt to the session" — the designed default, and
  // deliberately NOT the legacy prompt template's baked-in persona. See
  // docs/superpowers/specs/2026-08-07-workie-personas-design.md.
  // Two lists, because the two pickers are filtered by different game types.
  // The create dialog owns its own choice; `currentGameType` is loaded from the
  // game's own metadata when a session is resumed.
  const [personas, setPersonas] = useState([]);           // create dialog
  const [gamePersonas, setGamePersonas] = useState([]);   // live game
  const [gamePersonaId, setGamePersonaId] = useState('');       // the live game's voice
  const [personaSwitchStatus, setPersonaSwitchStatus] = useState('');

  // Question Set Management
  const [questionSets, setQuestionSets] = useState([]);
  const [selectedSetId, setSelectedSetId] = useState('');
  /*
    THE OTHER HALF OF THE SELECTED SET. A setId names one set PER LIBRARY
    (utils/setRef.js), so every read derived from it — the categories, the
    custom instruction — needs to say which library it means. Without it those
    reads fall back to the backend's org-first SEARCH, which is right until two
    libraries hold the same slug.
  */
  const [selectedSetScope, setSelectedSetScope] = useState(DEFAULT_SCOPE);
  const [categories, setCategories] = useState([]);
  const [activeCategoryIds, setActiveCategoryIds] = useState(new Set());
  
  // Dynamic Category Management (for active games)
  const [categoryCounts, setCategoryCounts] = useState(null);
  const [categoryBitmasks, setCategoryBitmasks] = useState(null);
  const [isTogglingCategory, setIsTogglingCategory] = useState(false);


  // Confirmation modals
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [confirmModalProps, setConfirmModalProps] = useState({
    title: '',
    message: '',
    confirmText: 'Proceed',
    onConfirm: () => {},
    onCancel: () => {}
  });

  // Debug mode for AI prompts
  const [gameDebugMode, setGameDebugMode] = useState(false);
  
  /**
   * WHICH DISPLAY THE STAGE IS ON — the one parameter the whole shell reads.
   *
   * This replaces the old big-screen boolean, and replaces it rather than
   * joining it. Two layouts is what produced two ASK headers and two QR
   * blocks, and the mode reset itself to OFF on every mount, so a projector
   * browser that reloaded mid-session came back in the wrong layout in front
   * of a room. The profile is read from localStorage on mount and written back
   * on every change: never lose the presentation state on reload.
   *
   * TV and Call are undetectable in principle and are chosen in the Console
   * (spec §5.4, plan 3). Until that ships they are reachable by setting
   * `engage.displayProfile` in localStorage; Room and Table are inferred from
   * the viewport width.
   */
  const [profile, setProfile] = useState(
    () => loadProfile(window.localStorage, window.innerWidth)
  );
  useEffect(() => { saveProfile(window.localStorage, profile); }, [profile]);

  /**
   * Which beat of RESULTS is on screen.
   *
   * RESULTS is two beats now (config/hostControls.js): the tally, then the
   * discussion prompt. A host who wants to talk over the scores should not
   * also be projecting the AI's paragraph. Reset whenever the round changes,
   * so the next round's results open on the tally.
   */
  const [resultsBeat, setResultsBeat] = useState('results');

  /**
   * The beat the SERVER last reported, AND the exact game state it reported it
   * for. Both halves, because a bare beat outlives the round it belongs to.
   *
   * The failure it prevents: the host opens the read-back on round 2, a
   * restore stamps 'field-notes' here, the room moves to round 3, and the
   * `questionStarted` broadcast that would have refreshed this never arrives —
   * host connections have been evicted mid-session before, and that is the
   * defect this whole feature was built on top of. Round 3's results would
   * then open straight on the AI paragraph with the tally never shown, which
   * is precisely what the reset below exists to prevent.
   *
   * Addressing it by state string rather than trusting a refresh makes the
   * stale case unrepresentable: the beat applies to one state and no other.
   * Same discipline as `stageBeatFromFrame`, which ignores an announcement for
   * a round the room has left.
   */
  const serverStageBeatRef = useRef({ state: null, beat: 'results' });
  // ─────────────────────────────────────────────────────────────────────────
  // FRAGILE ON PURPOSE, AND ALREADY EXPENSIVE ONCE. Read before touching.
  //
  // Any change that makes one of these deps move WITHOUT the round moving
  // silently knocks the stage back to the tally beat. That is exactly what
  // happened: handleShowResults wrote a round number into `currentQuestionId`,
  // the close-round broadcast's restoreGameState rewrote it to the question's
  // real id, this effect re-ran, and the host's "What We Heard" tap was
  // discarded (see the long note at handleShowResults).
  //
  // The server-side beat does NOT fire this — `stageBeatChanged` sets
  // `resultsBeat` directly and deliberately does not call restoreGameState, so
  // neither dep moves. Do not widen these deps, and do not add a re-sync to
  // that handler.
  // ─────────────────────────────────────────────────────────────────────────
  //
  // It resets to the SERVER's beat for the round, not the literal 'results'.
  // For a round change that is the same thing — a fresh ROUND# record has no
  // StageBeat and get-game-state reports 'results' — but on a host reload
  // mid-discussion it is the difference between the stage coming back on the
  // read-back the room is looking at and snapping to the tally while the phone
  // still says "Next Round". A ref, not state: this effect runs after the
  // render that restoreGameState triggered, so a setState there would lose to
  // it every time.
  //
  // The server's beat is honoured ONLY for the state it was read for. Anything
  // else — a new round, a phase move, a stale ref — falls back to the tally.
  useEffect(() => {
    const seen = serverStageBeatRef.current;
    setResultsBeat(seen && seen.state === gameState ? seen.beat : 'results');
  }, [currentQuestionId, gameState]);

  /**
   * Publish the beat so the OTHER device follows.
   *
   * Bidirectional is the point: tap "What We Heard" on the projector and the
   * phone's control moves on to "Next Round"; tap it on the phone and the
   * projector shows the read-back. The local setState below is optimistic so
   * the stage does not wait on a round trip; the POST is what carries it.
   *
   * Fire-and-forget. A failed publish must never block the beat the host asked
   * for on the screen they are standing in front of — the phone falls back to
   * its own two-second poll of get-game-state, which reads the same record.
   */
  const publishStageBeat = (beat) => {
    const round = phaseOfGameState(gameState) === 'RESULTS'
      ? parseInt(String(gameState).split('#')[1], 10)
      : null;
    if (!gameId || !round) return;
    // authFetch: /stage-beat carries the Cognito authorizer, like /close-round.
    authFetch(`${API_BASE}games/${gameId}/stage-beat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ beat, questionNumber: round }),
    }).catch((err) => console.error('Stage beat publish failed (continuing):', err));
  };

  // Host Remote drives the same actions the host toolbar does. The listener below
  // is registered once, so it must not close over a single render's handlers —
  // those capture a stale gameState/players. Every render refreshes this ref
  // instead (assigned just after the handlers are declared, further down).
  const remoteActionsRef = useRef({});

  // Listen for remote control commands from Host Remote app
  useEffect(() => {
    const handleRemoteCommand = (event) => {
      // Verify origin for security
      if (event.origin !== window.location.origin) return;
      
      if (event.data?.type === 'REMOTE_COMMAND') {
        const { command, data } = event.data;
        console.log('🎮 Remote command received:', command, data);
        
        switch (command) {
          case 'SCROLL_TO_TOP':
            window.scrollTo({ top: 0, behavior: 'smooth' });
            break;
          case 'SCROLL_TO_BOTTOM':
            window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
            break;
          case 'SCROLL_TO_RESULTS':
            const resultsElement = document.querySelector('.results-container, .game-results, .question-results');
            if (resultsElement) {
              resultsElement.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }
            break;
          case 'TOGGLE_BIG_SCREEN':
            // Was `setBigScreenMode(prev => !prev)` — the third call left behind
            // by a refactor that removed its state. displayProfile.js replaced
            // the boolean with four profiles and says so in its own header; this
            // handler was never updated, so the remote's big-screen button threw
            // instead of doing anything.
            setProfile((prev) => toggleBigScreen(prev, window.innerWidth));
            break;
          case 'NEXT_QUESTION':
            remoteActionsRef.current.nextQuestion?.();
            break;
          case 'START_VOTING':
            remoteActionsRef.current.startVoting?.();
            break;
          case 'SHOW_RESULTS':
            remoteActionsRef.current.showResults?.();
            break;
          default:
            console.log('🎮 Unknown remote command:', command);
        }
      }
    };

    window.addEventListener('message', handleRemoteCommand);
    return () => window.removeEventListener('message', handleRemoteCommand);
  }, []);
  
  // Check game status helper function
  const checkGameStatus = async (gameId) => {
    try {
      const response = await fetch(`${API_BASE}games/${gameId}?role=host`);
      if (response.ok) {
        const gameData = await response.json();
        return {
          exists: true,
          started: gameData.started === true
        };
      } else if (response.status === 404) {
        return { exists: false, started: false };
      } else {
        throw new Error(`HTTP ${response.status}`);
      }
    } catch (error) {
      console.error(`Error checking game ${gameId} status:`, error);
      return { exists: false, started: false };
    }
  };
  
  // AI Summary data
  const [aiSummaries, setAiSummaries] = useState({});
  const [currentAIInsights, setCurrentAIInsights] = useState(null);
  const [loadingAIInsights, setLoadingAIInsights] = useState(false);
  // Watchdog for async AI-summary generation: if the aiSummaryReady WS push is
  // missed (e.g. host WS reconnect), poll for the now-persisted item.
  const aiWatchdogRef = useRef(null);

  /**
   * WHAT THE HOST IS TOLD WHEN THE SUMMARY DOES NOT COME.
   *
   * `null` when nothing has gone wrong. Otherwise the classified failure from
   * utils/aiSummaryRecovery — headline, detail, and whether we may retry it
   * ourselves. Rendered by AISummaryStatus, which puts it ON THE STAGE: the old
   * code logged to the console and left the placeholder ("Nothing to read back
   * yet") on screen, which reads as "still working" to the one person in the
   * room who cannot afford to guess.
   *
   * NOT in config/gameSession.js's key list, so it is cleared by hand in
   * leaveCurrentGame() — exactly like aiWatchdogRef beside it. If someone opens
   * that file, both belong on the list.
   */
  const [aiSummaryFailure, setAiSummaryFailure] = useState(null);
  const [aiRetrying, setAiRetrying] = useState(false);
  // Which question the recovery machinery is working on, so the manual Try
  // again knows what to re-request without re-deriving it from a game state
  // that may have moved on.
  const aiQuestionRef = useRef(null);
  const aiRetryTimerRef = useRef(null);
  const aiPollTimerRef = useRef(null);

  /** Every AI timer, off. Called before starting anything and on leaving a game. */
  const clearAITimers = () => {
    if (aiWatchdogRef.current) clearTimeout(aiWatchdogRef.current);
    if (aiRetryTimerRef.current) clearTimeout(aiRetryTimerRef.current);
    if (aiPollTimerRef.current) clearTimeout(aiPollTimerRef.current);
    aiWatchdogRef.current = null;
    aiRetryTimerRef.current = null;
    aiPollTimerRef.current = null;
  };
  
  // The three celebratory flash alerts are gone — see the render. They were
  // full-screen overlays that covered the stage, including the advance
  // control, for three or four seconds while a room waited on the host. The
  // room meter already states where the room is, continuously and without
  // taking the screen.
  /*
    WHICH SESSION THE INVITE DIALOG IS FOR, or null when it is shut. One piece
    of state drives both buttons, which is what makes them "identical mech" —
    the session panel and the history list each only say WHICH session, and the
    dialog owns everything else.
  */
  const [inviteTarget, setInviteTarget] = useState(null);
  /*
    WHEN THE LIVE SESSION WAS CREATED, which the host page did not hold.
    The retention deadline is creation + 90 days, so the invite dialog cannot
    check a date without it. `get-game-state` already returns it as
    `gameMetadata.createdAt` and `restoreGameState` already calls that
    endpoint — it was simply never kept.
  */
  const [gameCreatedAt, setGameCreatedAt] = useState(null);
  
  // Loading overlay state
  const [isLoadingData, setIsLoadingData] = useState(false);
  const [loadingMessage, setLoadingMessage] = useState('Loading...');

  // Note: Save Report Modal state moved to GameReport component

  // 🔁 SWITCHING GAMES
  //
  // One map, one reset. Every per-game key in config/gameSession.js needs a
  // setter here — gameSession.test.js fails if the two drift, which is what
  // stops the next person from adding state and quietly forgetting to clear it.
  //
  // Keys deliberately absent from this map (and from gameSession.js) are the
  // navigation flags and the create-dialog inputs; see that file's header.
  const gameSessionSetters = {
    gameState: setGameState,
    currentGameType: setCurrentGameType,
    anonymousUntilReveal: setAnonymousUntilReveal,
    questions: setQuestions,
    usedQuestionIds: setUsedQuestionIds,
    currentQuestionId: setCurrentQuestionId,
    currentQuestionIndex: setCurrentQuestionIndex,
    lessonNumber: setLessonNumber,
    authorsRevealed: setAuthorsRevealed,
    nameWaitingWhenAnonymous: setNameWaitingWhenAnonymous,
    autoMode: setAutoMode,
    players: setPlayers,
    removedPlayers: setRemovedPlayers,
    answers: setAnswers,
    playersWhoAnswered: setPlayersWhoAnswered,
    votes: setVotes,
    playersWhoVoted: setPlayersWhoVoted,
    currentQuestionVotes: setCurrentQuestionVotes,
    selectedSetId: setSelectedSetId,
    customInstruction: setCustomInstruction,
    setRoundNoun: setSetRoundNoun,
    categories: setCategories,
    activeCategoryIds: setActiveCategoryIds,
    categoryCounts: setCategoryCounts,
    categoryBitmasks: setCategoryBitmasks,
    isTogglingCategory: setIsTogglingCategory,
    gamePersonaId: setGamePersonaId,
    personaSwitchStatus: setPersonaSwitchStatus,
    aiSummaries: setAiSummaries,
    currentAIInsights: setCurrentAIInsights,
    loadingAIInsights: setLoadingAIInsights,
    showReport: setShowReport,
    reportData: setReportData,
    eventTitle: setEventTitle,
    gameCreatedAt: setGameCreatedAt,
    lessonExpanded: setLessonExpanded,
    showExpandedQR: setShowExpandedQR,
    qrMode: setQrMode,
    setupPanelOpen: setSetupPanelOpen,
    browsingQuestions: setBrowsingQuestions,
    isLoadingData: setIsLoadingData,
    isRestoringState: setIsRestoringState,
    manualStateChange: setManualStateChange,
    gameDebugMode: setGameDebugMode,
  };

  // The game every in-flight async write is allowed to touch. Bumped
  // synchronously the instant the host leaves a game, so a `restoreGameState()`
  // that was already awaiting the old game's API cannot land afterwards and
  // repaint the previous session over the new one.
  const activeGameIdRef = useRef('');

  /**
   * Leave whatever game is on screen. Clears every per-game value.
   *
   * Called on its own when the host goes back to the welcome screen, and via
   * `switchToGame()` on every path that opens a different game.
   */
  const leaveCurrentGame = (overrides = {}) => {
    activeGameIdRef.current = '';
    clearAITimers();
    // Per-game, but not on gameSession.js's list — see the state declaration.
    // A failure banner carried into the next game would be a lie about it.
    setAiSummaryFailure(null);
    setAiRetrying(false);
    aiQuestionRef.current = null;
    resetGameSession(gameSessionSetters, overrides);
  };

  /**
   * Open a game. THE choke point — every create/join/continue path goes
   * through here, so per-game state can never be half-cleared.
   *
   * The reset and the `setGameId` land in the same React 18 batch, so the
   * screen never renders the new game id against the old game's data. The
   * restore effect then loads the game from the server onto a clean slate —
   * which matters because `restoreGameState()` only *adds*: a just-started
   * game reports `currentQuestion: 0` and skips the entire
   * question/answer/progress branch, so anything left behind would survive.
   *
   * THE EPOCH IS WHY RETURNING TO THE *SAME* SESSION WORKS — game 5486. The
   * restore effect used to key on `[gameId]` alone, and a same-id setGameId
   * is a state update React bails out of entirely: leaving a session (which
   * clears every per-game value but not `gameId`) and then re-opening THAT
   * session never re-fired the restore, so the host got the cleared slate as
   * the session — no categories, no questions, "not able to start session".
   * A different game changed the id and worked, which is exactly the shape
   * the owner reported: "the issue only happens when you leave a session and
   * come back to the same session." The epoch bumps on EVERY switch, so the
   * effect re-fires whether or not the id changed.
   */
  const switchToGame = (nextGameId, overrides = {}) => {
    console.log(`🔁 HOST: switching to game ${nextGameId} (from ${gameId || 'none'})`);
    leaveCurrentGame(overrides);
    setGameId(nextGameId);
    setSessionEpoch((epoch) => epoch + 1);
    setShowWelcomeScreen(false);
  };


  // Fetch question set custom instruction (similar to player screen)
  const fetchQuestionSetInstruction = async (setId, scope = '') => {
    if (!setId) {
      setCustomInstruction(null);
      setSetRoundNoun(null);
      return;
    }

    try {
      console.log('📋 HOST: Fetching instruction for set:', setId);
      // authFetch: the question-set routes now carry the Cognito authorizer.
      // They were public, so any caller could read any set's content.
      const res = await authFetch(`${API_BASE}question-sets`);
      const data = await res.json();
      // MATCHED ON THE PAIR when the caller knows it. `find(s => s.id === setId)`
      // returns whichever library happens to come first in the response, so an
      // org set could be described by Engage's set of the same name.
      const questionSet = data.sets?.find((set) => set.id === setId
        && (!scope || (set.scope || DEFAULT_SCOPE) === scope));
      if (questionSet && questionSet.customInstruction) {
        console.log('📋 HOST: Found custom instruction:', questionSet.customInstruction);
        setCustomInstruction(questionSet.customInstruction);
      } else {
        console.log('📋 HOST: No custom instruction found, using default');
        setCustomInstruction(null);
      }
      setSetRoundNoun(questionSet?.roundNoun || null);
    } catch (error) {
      console.error('Error fetching question set instruction:', error);
      setCustomInstruction(null);
      setSetRoundNoun(null);
    }
  };

  // Instruction hierarchy lives in config/instructions.js so the host and the
  // player screen cannot drift apart (they had, on Art Title rounds).
  const getHostInstructionText = (currentQuestion, gameType = currentGameType) =>
    resolveInstruction(currentQuestion, customInstruction, gameType);

  // Same idea for what a round is called. Every label site used to inline its
  // own ternary, which is why ASK said "Lesson 3" and RESULTS "Question 3".
  const getHostRoundNoun = (question = questions[0], gameType = currentGameType) =>
    resolveRoundNoun(question, gameType, setRoundNoun);

  /**
   * Load the persona library for an engagement type.
   *
   * The endpoint honours the personas' own `gameTypes`, so a trivia session is
   * only offered voices that suit trivia (plus the ones marked "all"). A
   * failure here is never fatal: with no personas the picker shows only "Adapt
   * to the session", which is the default behaviour anyway.
   */
  const fetchPersonas = async (gameType, apply) => {
    try {
      const query = gameType ? `?gameType=${encodeURIComponent(gameType)}` : '';
      const response = await authFetch(`${API_BASE}admin/personas${query}`);
      if (!response.ok) {
        console.warn(`⚠️ HOST: persona list unavailable (${response.status}) — defaulting to adaptive voice`);
        apply([]);
        return;
      }
      const data = await response.json();
      apply(data.personas || []);
    } catch (error) {
      console.warn('⚠️ HOST: could not load personas — defaulting to adaptive voice:', error.message);
      apply([]);
    }
  };

  // The create dialog owns its own format choice, so it tells us when to
  // reload the voices it may offer. (Clearing a now-unsuitable selection is the
  // dialog's own business and happens there.)
  const handleSetupFormatChange = (gameType) => fetchPersonas(gameType, setPersonas);

  useEffect(() => {
    fetchPersonas(currentGameType, setGamePersonas);
  }, [currentGameType]); // eslint-disable-line react-hooks/exhaustive-deps

  /**
   * Switch Workie's voice mid-session.
   *
   * This applies from the NEXT question — the summary on screen was already
   * written. Redo (beside this control) rewrites the current one.
   */
  const handleChangeGamePersona = async (personaId) => {
    const previous = gamePersonaId;
    setGamePersonaId(personaId);
    setPersonaSwitchStatus('Saving...');
    try {
      const response = await authFetch(`${API_BASE}games/${gameId}/persona`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ personaId: personaId || '' })
      });
      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error.error || `HTTP ${response.status}`);
      }
      const picked = gamePersonas.find((p) => p.personaId === personaId);
      setPersonaSwitchStatus(
        picked
          ? `${picked.name} takes over from the next question.`
          : 'Workie adapts to the session from the next question.'
      );
    } catch (error) {
      console.error('❌ HOST: failed to switch persona:', error);
      setGamePersonaId(previous); // don't leave the picker claiming a change that never landed
      setPersonaSwitchStatus(`Could not switch voice: ${error.message}`);
    }
  };


  // Generate a random 4-digit game ID
  function generateGameId() {
    return Math.floor(1000 + Math.random() * 9000).toString();
  }

  // Handle debug mode toggle - client-side only, no server call needed
  const handleToggleGameDebugMode = () => {
    const newDebugMode = !gameDebugMode;
    setGameDebugMode(newDebugMode);
    console.log(`🐛 Game ${gameId} debug mode ${newDebugMode ? 'ENABLED' : 'DISABLED'}`);
    
    // Store in localStorage for persistence
    localStorage.setItem(`game_debug_mode_${gameId}`, newDebugMode.toString());
  };

  // Fetch AI summary for a specific question from DynamoDB
  const fetchAISummary = async (questionId) => {
    if (!gameId || !questionId) return null;
    
    try {
      const debugParam = gameDebugMode ? '?debug=true' : '';
      const response = await fetch(`${API_BASE}games/${gameId}/ai-summary${debugParam}`);
      
      if (response.ok) {
        const summaryData = await response.json();
        // Update local state with fetched data
        setAiSummaries(prev => ({
          ...prev,
          [questionId]: summaryData
        }));
        console.log(`✅ AI summary fetched from DB for question ${questionId}`);
        console.log(`✅ Summary preview:`, summaryData.summaryText ? summaryData.summaryText.substring(0, 100) + '...' : 'NO SUMMARY TEXT');
        return summaryData;
      } else if (response.status === 404) {
        console.log(`ℹ️ No AI summary exists in DB for question ${questionId} yet`);
        return null;
      } else {
        console.error(`❌ Failed to fetch AI summary for question ${questionId}. Status:`, response.status);
        return null;
      }
    } catch (error) {
      console.error(`❌ Error fetching AI summary for question ${questionId}:`, error);
      return null;
    }
  };

  /**
   * Put a fetched summary on the stage. Returns whether there was one.
   *
   * This shape was written out three times — the load effect, the watchdog and
   * the aiSummaryReady handler — and the three had already drifted on what
   * counts as "a summary" (one accepted `markdownResponse` alone, one did not).
   */
  const applyAISummary = (summary) => {
    if (!summary || !(summary.summary || summary.markdownResponse)) return false;
    setCurrentAIInsights({
      summary: summary.summary,
      discussionTopics: summary.discussionQuestions || [],
      nextSteps: summary.nextSteps || [],
      markdownResponse: summary.markdownResponse || null,
      prompt: gameDebugMode ? summary.debugPrompt : undefined,
      debugPrompt: gameDebugMode ? summary.debugPrompt : undefined
    });
    return true;
  };

  /**
   * The push never came. Go and look for the summary anyway.
   *
   * The worker WRITES THE ITEM BEFORE IT BROADCASTS, so a lost `aiSummaryReady`
   * (a host WS reconnect, a connection the stale-connection sweep had already
   * dropped) usually means a finished summary sitting in DynamoDB with nobody
   * fetching it. Poll before declaring anything.
   */
  const pollForAISummary = async (questionId, attempt = 0) => {
    const summary = await fetchAISummary(questionId);
    if (applyAISummary(summary)) {
      setAiSummaryFailure(null);
      setLoadingAIInsights(false);
      return;
    }
    if (attempt + 1 < AI_POLL_ATTEMPTS) {
      aiPollTimerRef.current = setTimeout(
        () => pollForAISummary(questionId, attempt + 1), AI_POLL_INTERVAL_MS
      );
      return;
    }
    // Polled and found nothing. Say so — waiting forever is never correct.
    console.warn(`⏰ AI summary for ${questionId}: no notification and nothing persisted`);
    setLoadingAIInsights(false);
    setAiSummaryFailure(classifyAISummaryFailure({ phase: 'notification', online: isOnline() }));
  };

  // Start/refresh the async-generation watchdog. If aiSummaryReady never arrives
  // (missed WS push), go looking for the persisted item, then report failure.
  const startAIWatchdog = (questionId) => {
    if (aiWatchdogRef.current) clearTimeout(aiWatchdogRef.current);
    aiWatchdogRef.current = setTimeout(() => {
      console.warn('⏰ AI summary watchdog fired — polling for the persisted summary');
      pollForAISummary(questionId, 0);
    }, AI_NOTIFICATION_TIMEOUT_MS);
  };

  /**
   * Fire the generate trigger once and report what happened. No state, no
   * retrying, no rendering — just "did the request reach the API and get a yes".
   */
  const triggerAISummary = async (questionId) => {
    const debugParam = gameDebugMode ? '&debug=true' : '';
    try {
      // Fire-and-forget: response is 202 {status:'generating'}; result comes via WS.
      const response = await fetch(
        `${API_BASE}games/${gameId}/ai-summary?questionId=${questionId}&generateNew=true${debugParam}`,
        { method: 'GET', headers: { 'Content-Type': 'application/json' } }
      );
      if (!response.ok && response.status !== 202) {
        return {
          ok: false,
          failure: classifyAISummaryFailure({ status: response.status, online: isOnline() }),
        };
      }
      return { ok: true };
    } catch (error) {
      // THE REPORTED DEFECT LIVES HERE. `ERR_INTERNET_DISCONNECTED` lands in
      // this branch: the request never left the browser, so the server will
      // never generate anything and `aiSummaryReady` will never fire. The old
      // code logged and returned, and the host waited out the rest of the
      // session in front of a screen that looked like it was still thinking.
      return { ok: false, failure: classifyAISummaryFailure({ error, online: isOnline() }) };
    }
  };

  /**
   * THE one entry point for "make a summary for this question".
   *
   * Success hands the wait to the watchdog. Failure lands on the stage as a
   * sentence the host can act on, and — for a failure that could plausibly
   * succeed next time — schedules a bounded, backed-off retry. A 4xx is never
   * retried automatically: the server has answered, and asking again is noise.
   */
  const startAISummaryGeneration = async (questionId, attempt = 0) => {
    if (!questionId) return;
    aiQuestionRef.current = questionId;
    clearAITimers();
    setAiSummaryFailure(null);
    setAiRetrying(false);
    setLoadingAIInsights(true);

    console.log(`🤖 Triggering AI generation for ${questionId} (attempt ${attempt + 1})`);
    const result = await triggerAISummary(questionId);

    if (result.ok) {
      console.log('✅ AI generation triggered (awaiting WebSocket completion)');
      startAIWatchdog(questionId);
      return;
    }

    console.error(`❌ Failed to trigger AI generation (${result.failure.kind}):`, result.failure.headline);
    setLoadingAIInsights(false);
    setAiSummaryFailure(result.failure);

    if (shouldAutoRetry(result.failure, attempt)) {
      setAiRetrying(true);
      aiRetryTimerRef.current = setTimeout(
        () => startAISummaryGeneration(questionId, attempt + 1), autoRetryDelayMs(attempt)
      );
    }
  };

  /**
   * Ask for a past round's AI summary to be written again.
   *
   * THROUGH `triggerAISummary`, NOT ITS OWN FETCH — and the first draft of this
   * did roll its own, which `aiSummaryWiring.test.js` caught. That test exists
   * because a second hand-rolled trigger has already shipped once as a bug: it
   * carried its own `.catch` that logged and cleared the watchdog, so a throw
   * left the host with no request in flight, no notification coming, and no
   * sign of either. `ERR_INTERNET_DISCONNECTED` lands in exactly that branch.
   *
   * So this reuses the one function that classifies its own failure, and gets
   * the offline case, the 4xx case and the honest message for free. The only
   * thing added here is the per-round busy flag, because unlike the live round
   * a host can start several of these and they finish in whatever order the
   * workers finish.
   *
   * The 202 means "started", never "finished". The flag is released by the
   * `aiSummaryReady` frame, not here — clearing it on the response would
   * re-enable the button while the worker is still running, which is the whole
   * thing it exists to prevent.
   */
  const regenerateRoundSummary = async (roundNumber) => {
    if (regeneratingRounds.includes(roundNumber)) return;
    setRegeneratingRounds((prev) => [...prev, roundNumber]);

    const result = await triggerAISummary(encodeURIComponent(roundNumber));
    if (!result.ok) {
      setRegeneratingRounds((prev) => prev.filter((n) => n !== roundNumber));
      // `headline` and `detail` are what classifyAISummaryFailure actually
      // returns — there is no `message`, and reaching for one would have put
      // the fallback sentence in front of the host on every real failure,
      // discarding the specific one the classifier had worked out.
      const f = result.failure;
      alert(f ? `${f.headline}\n\n${f.detail}`
        : 'The summary could not be regenerated. Please try again.');
    }
  };

  /** The host pressing "Try again" on the failure. Attempts start over. */
  const handleRetryAISummary = () => {
    const questionId = aiQuestionRef.current || gameState.match(/#(\d+)/)?.[1];
    if (!questionId) return;
    setCurrentAIInsights(null);
    startAISummaryGeneration(questionId, 0);
  };

  // Regenerate AI Summary with new generation. The server returns 202
  // (generation runs async) and the completed summary arrives via the
  // aiSummaryReady WebSocket event, which renders it. We only kick it off here.
  const handleRegenerateAISummary = async () => {
    const currentQuestionNum = gameState.match(/#(\d+)/)?.[1];
    if (!currentQuestionNum) {
      console.log('⚠️ No current question number found for regeneration');
      return;
    }

    console.log('🔄 Regenerating AI Summary for question:', currentQuestionNum);
    setCurrentAIInsights(null); // Clear current insights to show loading
    await startAISummaryGeneration(currentQuestionNum, 0);
  };

  // Generate AI prompt from template
  const generateAIPrompt = (question, playerAnswers) => {
    const questionTitle = question?.title || question?.question || 'Strategic Question';
    const questionDetail = question?.detail || '';
    
    // Sort answers by votes (if available) or just use order
    const sortedAnswers = playerAnswers.map((answer, idx) => ({
      rank: idx + 1,
      player: answer.name,
      answer: answer.answer
    }));
    
    const answersText = sortedAnswers.map(item => 
      `${item.rank}. ${item.player}: "${item.answer}"`
    ).join('\n\n');
    
    return `You are an expert business strategist analyzing responses from an "Engagements" strategic thinking session.

LESSON DETAILS:
Question: "${questionTitle}"
Context: ${questionDetail || 'Strategic planning session'}

PLAYER RESPONSES (ranked by voting):
${answersText}

INSTRUCTIONS:
Please provide a strategic analysis with:

1. SUMMARY (2-3 sentences): Key insights and themes from these responses
2. DISCUSSION TOPICS (3 questions): Thought-provoking questions for deeper discussion
3. NEXT STEPS (3-4 items): Concrete, actionable recommendations

Focus on actionable business strategy insights.`;
  };

  // Removed loadAIInsights and generateNewAISummary - now handled directly in useEffect

  // Reload category counts when transitioning to ASK state (new question starts)
  useEffect(() => {
    if (gameState.startsWith('ASK#') && gameId) {
      console.log('📊 ASK state detected - reloading category counts for updated question counts');
      loadCategoryCounts();
    }
  }, [gameState, gameId]);

  // Load AI insights when in results state and we have answers
  useEffect(() => {
    if (gameState.startsWith('RESULTS#') && currentQuestionIndex >= 0 && answers.length > 0) {
      const questionId = String(currentQuestionIndex + 1).padStart(3, '0');
      console.log(`🤖 Starting AI insights load for question ${questionId} with ${answers.length} answers`);
      setLoadingAIInsights(true);
      setCurrentAIInsights(null);
      setAiSummaryFailure(null);
      aiQuestionRef.current = questionId;

      // Reload category counts to reflect decremented values after question completion
      if (categoryCounts) {
        console.log('📊 Reloading category counts after question completion');
        loadCategoryCounts();
      }
      
      // In WebSocket mode, we still need to trigger AI generation but rely on WebSocket for completion notification
      if (useWebSocket) {
        console.log('🔌 WebSocket mode: Triggering AI generation and waiting for WebSocket notification');
        
        // Check if AI summary already exists first. A failed *read* is not
        // reported on its own — it returns null, we fall through to the
        // trigger, and the trigger's own failure is the one the host sees.
        // (Offline, both fail; one message about it is the right number.)
        fetchAISummary(questionId).then(existingSummary => {
          if (applyAISummary(existingSummary)) {
            console.log('✅ Found existing AI summary');
            setLoadingAIInsights(false);
            return;
          }
          // Trigger AI generation - WebSocket will notify us when done (202).
          startAISummaryGeneration(questionId, 0);
        });
        return;
      }
      
      // REMOVED: AI insights polling - WebSocket handles notifications
    }
  }, [gameState, currentQuestionIndex, answers.length, gameId, gameDebugMode, useWebSocket]);

  // When the room finishes answering, close the expanded-question overlay so
  // the host is looking at the stage again. The celebratory full-screen alert
  // that used to fire here is deleted: it covered the stage — the advance
  // control included — for three seconds at exactly the moment the host wanted
  // to move on. The dock's status line already says "safe to move on", without
  // taking the screen to say it.
  useEffect(() => {
    if (gameState.startsWith('ASK#') && players.length > 0
        && answeredCount >= players.length && lessonExpanded) {
      setLessonExpanded(false);
    }
  }, [gameState, players.length, answeredCount, lessonExpanded]);

  // 🔗 Initialize game ID and event title from URL or generate new one
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const gameIdFromUrl = urlParams.get('gameId');
    const eventTitleFromUrl = urlParams.get('eventTitle');
    
    if (gameIdFromUrl) {
      console.log(`🔗 HOST: Found game ID in URL: ${gameIdFromUrl}`);
      
      // Check if this game exists and is started before proceeding
      checkGameStatus(gameIdFromUrl).then(gameStatus => {
        if (gameStatus.exists) {
          if (gameStatus.started) {
            // Game exists and is started - go to game screen
            console.log(`✅ HOST: Game ${gameIdFromUrl} exists and is started - proceeding to game screen`);
            setGameId(gameIdFromUrl);
            setShowWelcomeScreen(false);
            
            // Restore event title from URL or localStorage
            if (eventTitleFromUrl) {
              const decodedTitle = decodeURIComponent(eventTitleFromUrl);
              setEventTitle(decodedTitle);
              console.log(`🔗 HOST: Restored event title from URL: ${decodedTitle}`);
            } else {
              const storedTitle = localStorage.getItem(`game_${gameIdFromUrl}_title`);
              if (storedTitle) {
                setEventTitle(storedTitle);
                console.log(`🔗 HOST: Restored event title from localStorage: ${storedTitle}`);
              }
            }
          } else {
            // Game exists but not started - show welcome screen
            console.log(`⚠️ HOST: Game ${gameIdFromUrl} exists but not started - showing welcome screen`);
            setShowWelcomeScreen(true);
            // Show game history so user can start the game
            setTimeout(() => handleViewGameHistory(), 500);
          }
        } else {
          // Game doesn't exist - show welcome screen
          console.log(`❌ HOST: Game ${gameIdFromUrl} doesn't exist - showing welcome screen`);
          setShowWelcomeScreen(true);
        }
      }).catch(error => {
        console.error(`❌ Error checking game status:`, error);
        setShowWelcomeScreen(true);
      });
    } else {
      // No game ID in URL - show welcome screen
      console.log(`🏠 HOST: No game ID in URL - showing welcome screen`);
      setShowWelcomeScreen(true);
      // Load question sets for UI display (needed for set name display)
      fetchQuestionSets();
    }
  }, []);

  useEffect(() => {
    // Whatever we are about to load is now the only game allowed to write
    // state. Anything still awaiting for a previous game is dead on arrival.
    activeGameIdRef.current = gameId;

    // Only initialize game if we have a game ID
    if (!gameId) {
      console.log(`⏳ HOST: Waiting for game ID to be set...`);
      return;
    }

    console.log(`🚀 HOST: Initializing game ${gameId}`);
    
    // Create game in database when gameId changes, then fetch data
    const initializeGame = async () => {
      console.log(`🚀 HOST: Starting initialization for game ${gameId}`);
      
      // First, try to restore state to see if game exists
      const gameExists = await restoreGameState(); // This will determine if it's an existing game
      
      if (gameExists) {
        console.log(`✅ HOST: Game ${gameId} exists - restoration complete`);
        // Game already exists, just fetch players
        fetchPlayers('initial-load');
      } else {
        console.log(`⚠️ HOST: Game ${gameId} doesn't exist`);
        // If game doesn't exist, load question sets for new game creation
        console.log(`🔍 HOST: Loading question sets for new game...`);
        await fetchQuestionSets();
        
        // Only show welcome screen if we're not already in an active game
        // Don't auto-create games here - only through explicit user action
        if (!gameState || gameState === 'CREATED' || gameState === 'STARTED') {
          console.log(`⚠️ HOST: No active game state - showing welcome screen`);
          setShowWelcomeScreen(true);
        } else {
          console.log(`⚠️ HOST: Game in active state ${gameState} - keeping game interface`);
        }
        // Keep the gameId for potential game creation, don't clear it
      }
    };
    
    initializeGame();
    /*
      `sessionEpoch` is a dependency BECAUSE `gameId` alone is not enough:
      re-opening the very session the host just left keeps the id, React
      bails out of the no-op setGameId, and without the epoch this restore
      never ran — the cleared slate WAS the session. Game 5486's "all
      categories and questions are missing" repro, fixed at the dependency.
    */
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameId, sessionEpoch]);

  // REMOVED: HTTP polling - WebSocket handles all real-time updates // Include useWebSocket dependency

  // WebSocket connection effect - only runs when WebSocket is enabled
  useEffect(() => {
    if (!gameId || !useWebSocket) return;

    console.log(`🔌 HOST: Starting WebSocket connection for game ${gameId}`);

    // Set up WebSocket connection status callback
    webSocketClient.onConnectionStatusChange(setWsConnected);

    // A4: reconcile authoritative state on every reconnect. The host getting
    // stuck strands every player, so the same recovery wiring applies here.
    webSocketClient.onReconnected(() => {
      console.log('🔁 HOST: WS reconnected — restoring state');
      restoreGameState();
    });

    // Set up message handlers
    webSocketClient.onMessage('initialStateSync', (data) => {
      console.log('🔌 HOST: Received initial state sync notification:', data);
      // Fetch current game state from API
      restoreGameState();
    });

    webSocketClient.onMessage('playerJoined', (data) => {
      console.log('🔌 Player joined notification:', data);
      // Fetch updated players list
      fetchPlayers('websocket-join');
    });

    webSocketClient.onMessage('playerLeft', (data) => {
      console.log('🔌 Player left notification:', data);
      // Fetch updated players list
      fetchPlayers('websocket-leave');
    });

    /* SOMEBODY IS LOCKED OUT OF THEIR OWN NAME AND IS ASKING FOR IT BACK.
       Refetching is the whole handling: `get-players` carries the request as a
       flag on the roster row, so the Players tab shows "asking to take this
       name" beside the person's name the moment this lands. There is no toast
       — the host is running a room, and the decision belongs where the two
       buttons that answer it already are. */
    webSocketClient.onMessage('handoverRequested', (data) => {
      console.log('🔌 Handover requested notification:', data);
      fetchPlayers('websocket-handover-request');
    });

    /* The host's OTHER device did the removing. Without these the phone and
       the projector disagree about how many people are in the room, and
       therefore about how many the round is waiting for. */
    webSocketClient.onMessage('playerRemoved', (data) => {
      console.log('🔌 Player removed notification:', data);
      fetchPlayers('websocket-player-removed');
    });

    webSocketClient.onMessage('playerRestored', (data) => {
      console.log('🔌 Player restored notification:', data);
      fetchPlayers('websocket-player-restored');
    });

    // Game state change handlers
    webSocketClient.onMessage('gameStateChanged', (data) => {
      console.log('🔌 Game state changed notification:', data);
      // Fetch current game state from API
      restoreGameState();
    });

    webSocketClient.onMessage('questionStarted', (data) => {
      console.log('🔌 Question started notification:', data);
      // Fetch current game state from API
      restoreGameState();
      /*
        RE-READ THE RUNNING ORDER, because the round that just started may have
        BEEN the running order. `next-question.js` pops the head it serves — and
        discards any already-asked entries it skipped past on the way — but it
        does NOT broadcast `questionQueueChanged` for that write. Without this
        the question now on the room's screen also sits at #1 in the host's
        queue, which reads as the queue having done nothing.

        The phone remote needs no equivalent: it polls `/state`, and
        `get-game-state.js` projects the queue into that payload.

        `loadQueue` is safe to call from this frozen closure — it is a
        `useCallback` over `gameId` alone, and this effect re-registers on
        `gameId`, so the two can never be a version apart. That is not true of
        most handlers in here, which is why they use refs.
      */
      loadQueue();
      // The plan changes with the queue — the queued items lead it.
      loadUpNext();
    });

    webSocketClient.onMessage('playerAnswered', (data) => {
      console.log('🔌 Player answered notification:', data);
      // The two halves of this frame are INDEPENDENT, and used to be nested.
      //
      // message.js strips playerName while a round is hidden — correctly — but
      // the refetch below is what fills `answers`, and `answers.length` is the
      // only thing that enables the ASK primary (hostControls.js: 'Nobody has
      // answered yet'). Nothing polls. So gating the refetch on a name that is
      // deliberately absent left the host unable to start voting at all on the
      // normal path for an anonymous call-and-answer round, recoverable only by
      // a socket reconnect. See config/anonymity.js: playerAnsweredActions.
      const { markAnswered, refetchQuestion } = playerAnsweredActions(data);

      if (markAnswered) {
        setPlayersWhoAnswered(prev => {
          if (!prev.includes(markAnswered)) {
            console.log(`✅ Marking ${markAnswered} as answered`);
            return [...prev, markAnswered];
          }
          return prev;
        });
      } else {
        // HIDDEN ROUND: the frame carries no name, so the names have to be
        // asked for. This used to log and stop, which left `playersWhoAnswered`
        // frozen until the host happened to refocus the tab while the count
        // climbed beside it — and the waiting-list reveal, which refuses to
        // subtract a stale list, went dark for the rest of the round.
        //
        // Coalesced (scheduleAnswererSync): a burst of answers costs one
        // /state call, not one per frame. Hidden rounds only — the branch
        // above already has the name in hand and needs no request at all.
        console.log('🔒 Answer received on an anonymous round — pulling the participation list');
        scheduleAnswererSync();
      }

      // Unconditional: this is what enables the vote button.
      if (refetchQuestion) {
        console.log(`🔄 Refreshing answers for question ${refetchQuestion} to enable vote button`);
        fetchAnswersForQuestion(refetchQuestion);
      }
    });

    webSocketClient.onMessage('playerVoted', (data) => {
      console.log('🔌 Player voted notification:', data);
      // Use WebSocket data directly - mark player as voted and increment count
      if (data.playerName) {
        setPlayersWhoVoted(prev => {
          if (!prev.includes(data.playerName)) {
            console.log(`✅ Marking ${data.playerName} as voted`);
            return [...prev, data.playerName];
          }
          return prev;
        });
      }
    });

    webSocketClient.onMessage('votingStarted', (data) => {
      console.log('🔌 Voting started notification:', data);

      // Move the phase immediately when the frame says so — it avoids a beat of
      // stale header while the restore is in flight.
      if (data.newState) {
        setGameState(data.newState);
        console.log(`🔌 Updated game state to: ${data.newState}`);
      }

      // Then re-sync properly, exactly like questionStarted and
      // gameStateChanged do. Setting the phase alone was never enough: the
      // vote screen renders `answers`, and only restoreGameState's VOTE#
      // branch fetches them. This handler used to do nothing BUT the setState
      // above, and the broadcast carried no `newState`, so a vote opened from
      // the phone remote left the host page frozen on ASK with the whole room
      // already voting. Unconditional, so a frame missing the field still
      // recovers rather than silently no-op'ing again.
      restoreGameState();
    });

    webSocketClient.onMessage('authorsRevealed', (data) => {
      console.log('🔌 Authors revealed notification:', data);
      // Re-sync rather than patching state, exactly like questionStarted and
      // gameStateChanged. The attributed rows come back from the API.
      restoreGameState();
    });

    // The phone moved the beat. Follow it.
    //
    // NOTE THE ABSENCE OF restoreGameState. Every handler around this one
    // re-syncs, and this one must not: restoring rewrites `currentQuestionId`,
    // which is a dependency of the effect that RESETS `resultsBeat` to the
    // tally. A re-sync here would discard the very beat this frame delivered —
    // the precise mechanism of the defect fixed in Wave 0. The beat is not a
    // game-state fact; it needs no game-state read.
    //
    // The frame is round-addressed and stageBeatFromFrame enforces that: an
    // announcement for a round the room has already left is ignored rather than
    // opening the next round's tally on the previous round's prompt.
    webSocketClient.onMessage('stageBeatChanged', (data) => {
      console.log('🔌 Stage beat notification:', data);
      // gameStateRef, not gameState: this effect registered once and its
      // closure is frozen at 'CREATED'.
      const beat = stageBeatFromFrame(data, gameStateRef.current);
      if (beat) setResultsBeat(beat);
    });

    /*
      THE PHONE ENLARGED SOMETHING — or the other way round.

      `focusFromFrame` decides whether this frame is ours, and its answer is
      three-valued in a way that matters: a focus to apply, or NULL meaning
      "ignore, this is not our round". NULL IS NOT `{focus:'none'}` — that would
      CLOSE what is open, so a late frame from round 3 would shut the spotlight
      the host just opened on round 4. config/stageFocus.js carries the argument
      and a test named for it.

      NO restoreGameState, for stage-beat's reason: restoring rewrites
      `currentQuestionId`, whose change re-fires the beat-reset effect and
      discards the beat. A focus is not a game-state fact and needs no re-read.

      `answersRef` rather than `answers`: this effect registered once and its
      closure is frozen at the empty first render, so the clamp inside
      `focusToStage` would compare every index against 0 and open nothing. Same
      trap `gameStateRef` exists for.
    */
    webSocketClient.onMessage('stageFocusChanged', (data) => {
      console.log('🔌 Stage focus notification:', data);
      const focus = focusFromFrame(data, gameStateRef.current);
      if (!focus) return;

      const next = focusToStage(focus, { answerCount: answersRef.current.length });
      setLessonExpanded(next.lessonExpanded);
      setSpotlightIndex(next.spotlightIndex);
    });

    /*
      THE OTHER HOST SURFACE CHANGED THE RUNNING ORDER.

      Queue on the phone, watch the stage follow. The frame carries the whole
      list and its version, so this takes them verbatim rather than re-reading —
      the payload IS the read, and a GET here would race the next op.

      NO restoreGameState, for stage-beat's reason: the queue is not a game-state
      fact and a re-sync would rewrite `currentQuestionId`, discarding the beat.

      A frame with no queue is ignored rather than treated as empty. `?? null`
      and not `|| []`: an empty array is a real running order that a host just
      emptied, and it must land.
    */
    webSocketClient.onMessage('questionQueueChanged', (data) => {
      console.log('🔌 Question queue notification:', data);
      const list = data?.queue ?? null;
      if (!Array.isArray(list)) return;
      setQuestionQueue(normaliseQueue(list));
      setQueueVersion(Number(data.version) || 0);
    });

    webSocketClient.onMessage('aiSummaryReady', (data) => {
      console.log('🔌 AI Summary ready notification:', data);
      clearAITimers();
      setAiRetrying(false);
      /*
        A REGENERATED PAST ROUND ARRIVES HERE TOO, and this is the only signal
        that it did — the Rounds tab's Regenerate button gets a 202 and nothing
        else. Reload the list so the dialog shows the new text, and release the
        button, keyed on the round the push names rather than clearing them all:
        a host can start two and they finish in whatever order they finish.

        Unconditional rather than gated on the tab being open. The list is
        cheap, the dialog may be open over a different tab, and a stale summary
        that only refreshes on the next reopen is the bug this replaces.
      */
      if (data.questionId) {
        const done = String(data.questionId).padStart(3, '0');
        setRegeneratingRounds((prev) => prev.filter((n) => n !== done));
        loadRounds();
      }
      // Fetch the AI summary from API
      if (data.questionId) {
        console.log(`🔌 Fetching AI summary for question ${data.questionId}`);
        fetchAISummary(data.questionId).then(summary => {
          if (applyAISummary(summary)) {
            console.log('🔌 AI Summary state updated');
            setAiSummaryFailure(null);
            setLoadingAIInsights(false);
          } else {
            // The push said it was ready and the read came back empty. That is
            // a failure, not a shrug — the old code logged and left the spinner
            // running, which is the same forever-wait by another route.
            console.log('🔌 AI Summary fetch returned null/empty');
            setLoadingAIInsights(false);
            setAiSummaryFailure(
              classifyAISummaryFailure({ phase: 'notification', online: isOnline() })
            );
          }
        });
      }
    });

    // Beat two of the wavelength reveal: the clustering worker re-ran the
    // unanimity analysis with the model's merges and wrote it back before
    // broadcasting, so this frame is display-ready. A failed run arrives on
    // the SAME frame with clustering:'failed' — the stage then annotates
    // "matched on exact wording only" instead of waiting on the watchdog.
    webSocketClient.onMessage('wavelengthAnalysisReady', (data) => {
      console.log('🔌 Wavelength analysis ready:', data?.wordAnalysis?.matching, data?.wordAnalysis?.clustering);
      if (data && data.wordAnalysis) {
        setWavelengthAnalysis(data.wordAnalysis);
      }
    });

    // Async generation failed on the worker — say so, rather than leaving the
    // stage on a placeholder that reads as "still writing".
    webSocketClient.onMessage('aiSummaryError', (data) => {
      console.error('🔌 AI Summary generation failed:', data);
      clearAITimers();
      setAiRetrying(false);
      setLoadingAIInsights(false);
      // The server reached its own conclusion; this is not a network event, and
      // a blind auto-retry of a failing generation helps nobody.
      setAiSummaryFailure(classifyAISummaryFailure({ phase: 'generation' }));
    });

    webSocketClient.onMessage('gameEnded', (data) => {
      console.log('🔌 Game ended notification:', data);
      // A dialog box is not how a session ends. The stage moves to its ENDED
      // phase — its own chip, its own band, its own status line — and the
      // report is the dock's primary action there, reachable whenever the host
      // is ready rather than the instant the last round closes. The modal this
      // replaces also called five setters that do not exist on this component,
      // so confirming it threw.
      setGameState('ENDED');
      closeAllSidePanels();
    });

    // Connect as host - WebSocket is required
    console.log('🔌 HOST: Connecting WebSocket for real-time updates');
    webSocketClient.connect(gameId, null, true);

    return () => {
      console.log(`🔌 HOST: Disconnecting WebSocket for game ${gameId}`);
      webSocketClient.disconnect();
      webSocketClient.onConnectionStatusChange(null);
      webSocketClient.onReconnected(null);
      webSocketClient.offMessage('initialStateSync');
      webSocketClient.offMessage('playerJoined');
      webSocketClient.offMessage('playerLeft');
      webSocketClient.offMessage('handoverRequested');
      webSocketClient.offMessage('playerRemoved');
      webSocketClient.offMessage('playerRestored');
      webSocketClient.offMessage('gameStateChanged');
      webSocketClient.offMessage('questionStarted');
      webSocketClient.offMessage('playerAnswered');
      webSocketClient.offMessage('playerVoted');
      webSocketClient.offMessage('votingStarted');
      webSocketClient.offMessage('authorsRevealed');
      webSocketClient.offMessage('stageBeatChanged');
      webSocketClient.offMessage('stageFocusChanged');
      webSocketClient.offMessage('questionQueueChanged');
      webSocketClient.offMessage('wavelengthAnalysisReady');
      webSocketClient.offMessage('aiSummaryReady');
      webSocketClient.offMessage('aiSummaryError');
      // `gameEnded` was registered above and never removed here — a handler
      // that outlived its session and fired with a stale closure. Found by the
      // registered/removed symmetry test in __tests__/hostControls.test.js.
      webSocketClient.offMessage('gameEnded');
    };
  }, [gameId, useWebSocket]);

  /**
   * COMING BACK FROM A DROPPED CONNECTION.
   *
   * The host page already resyncs on `online`/`focus`/`visibilitychange` (the
   * effect below), but that resync runs `restoreGameState()`, and
   * `restoreGameState()` DOES NOT TOUCH THE SUMMARY on a live round — read its
   * RESULTS branch: it loads questions, answers and progress, and only ever
   * clears AI state on the no-round-in-play branch. The `aiSummaryReady`
   * handler is no help either, because when the trigger never left the browser
   * the server has nothing to announce.
   *
   * So the failure this listener recovers from is precisely the reported one:
   * host's wifi drops, the trigger throws, the room waits. Reconnecting is a
   * real event rather than a blind loop, so the attempt counter starts over.
   */
  useEffect(() => {
    if (!aiSummaryFailure || !aiSummaryFailure.autoRetryable) return undefined;
    const questionId = aiQuestionRef.current;
    if (!questionId) return undefined;

    const retryWhenBack = () => {
      console.log('🌐 HOST: back online — restarting the AI summary that never got out');
      startAISummaryGeneration(questionId, 0);
    };
    window.addEventListener('online', retryWhenBack);
    return () => window.removeEventListener('online', retryWhenBack);
  }, [aiSummaryFailure]); // eslint-disable-line react-hooks/exhaustive-deps

  // Timers outlive a render but must never outlive the page.
  useEffect(() => clearAITimers, []); // eslint-disable-line react-hooks/exhaustive-deps

  // A4: resume handler for the host — same visibility/online/focus/pageshow
  // resync as the player. A stuck host strands every player.
  useEffect(() => {
    if (!gameId || !useWebSocket) return;
    const resync = () => { webSocketClient.ensureConnected(); restoreGameState(); };
    const onVisible = () => { if (document.visibilityState === 'visible') resync(); };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('online', resync);
    window.addEventListener('focus', resync);
    window.addEventListener('pageshow', resync);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('online', resync);
      window.removeEventListener('focus', resync);
      window.removeEventListener('pageshow', resync);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameId, useWebSocket]);

  // REMOVED: WebSocket mode monitoring - WebSocket always enabled

  // Fetch categories when selectedSetId changes
  useEffect(() => {
    if (selectedSetId) {
      fetchCategories(selectedSetId, false, selectedSetScope);
    }
  }, [selectedSetId]);

  // OLD createGame function removed - now using handleStartNewGame which properly shows game history

  const restoreGameState = async () => {
    // The game this particular restore belongs to. Every await below is a
    // chance for the host to have switched games underneath us — a late reply
    // from the old game would otherwise repaint the previous session over the
    // new one, which reads as "it flickered back".
    const forGameId = gameId;
    const superseded = () => {
      if (activeGameIdRef.current === forGameId) return false;
      console.log(`🚫 HOST: discarding restore for game ${forGameId} — now on ${activeGameIdRef.current || 'none'}`);
      return true;
    };

    // Cleared in the `finally`, never inline. Four of the early returns below
    // (the manual-change latch, and every `superseded()` bail) used to skip the
    // reset entirely and strand this flag `true` for the rest of the session —
    // which then suppressed question-set auto-selection, because that reads
    // `isRestoringState` to know whether it is safe to choose one.
    setIsRestoringState(true); // Start restoration
    try {
      console.log(`🔄 HOST: Restoring game state for ${gameId}...`);

      // Don't restore state if we just manually changed it
      if (manualStateChange) {
        console.log(`⏭️ HOST: Skipping state restore - manual change in progress`);
        setManualStateChange(false); // Reset the flag
        return false; // Return false to indicate no restoration occurred
      }
      
      // Use new game state API with host data
      const stateRes = await fetch(`${API_BASE}games/${gameId}/state?includeHostData=true`);
      if (superseded()) return false;
      if (stateRes.ok) {
        const gameStateData = await stateRes.json();
        console.log(`📊 HOST: Found existing game state:`, gameStateData);

        // Which beat of RESULTS this round is on, per the ROUND# record. The
        // reset effect beside `resultsBeat` reads this, so a reload lands the
        // stage back where the room actually is rather than on the tally.
        // Normalised here so nothing downstream has to defend against a value
        // no client renders.
        //
        // Stamped WITH the state it describes. The reset effect honours the
        // beat only when the two still match, so this cannot outlive its round
        // if the broadcast that would have refreshed it never arrives.
        serverStageBeatRef.current = {
          state: gameStateData.state ?? null,
          beat: gameStateData.stageBeat === 'field-notes' ? 'field-notes' : 'results',
        };

        /*
          COME BACK UP ON WHATEVER THE ROOM IS LOOKING AT CLOSELY.

          A reload used to drop the room out of a spotlight nobody asked to
          close — the third of the three faults `stage-beat.js` lists, in its
          own form. `stageFocus` is a durable per-round fact now, so a restore
          can honour it.

          PARKED, NOT APPLIED, and that is not caution — it is required.
          `AnswerSpotlight` reads `answers[index].points`, so an index that
          outruns the loaded answers THROWS rather than rendering nothing. The
          answers for this round are fetched further down in this same restore
          and `answers` is still the previous round's (or empty) right here, so
          applying now would either open the wrong response or crash the page.

          `answerProgress` is not a way out: `get-game-state` only populates it
          for ASK#, and a spotlight is a RESULTS# thing, so it reads 0 in
          exactly the case that matters. The effect beside `answersRef` drains
          this once the rows are in and the count is real.
        */
        pendingFocusRef.current = gameStateData.stageFocus || null;

        // First, load question sets for the restored game
        console.log(`🔍 HOST: Loading question sets for restored game...`);
        await fetchQuestionSets(true); // true = during restoration, no auto-selection
        if (superseded()) return false;

        // Restore basic game metadata
        if (gameStateData.gameMetadata) {
          setEventTitle(gameStateData.gameMetadata.title || '');
          setCurrentGameType(gameStateData.gameMetadata.gameType || 'call-and-answer');
          // The retention deadline is creation + 90 days, and the invite dialog
          // cannot check a chosen date without this. Already in the payload.
          setGameCreatedAt(gameStateData.gameMetadata.createdAt || null);
          // Show the voice the game is actually set to, not a fresh default.
          setGamePersonaId(gameStateData.gameMetadata.personaId || '');
          const restoredSetId = gameStateData.gameMetadata.questionSetId || '';
          // The scope the SESSION pinned, not a fresh search. A session plays
          // one partition for its whole life; reloading the host screen must
          // read that one.
          const restoredSetScope = gameStateData.gameMetadata.questionSetScope || DEFAULT_SCOPE;
          setSelectedSetId(restoredSetId);
          setSelectedSetScope(restoredSetScope);
          fetchQuestionSetInstruction(restoredSetId, restoredSetScope);
          console.log(`🎮 HOST: Restored game metadata`);
          
          // Restore categories from bitmask if we have a question set
          if (restoredSetId) {
            await fetchCategories(restoredSetId, true, restoredSetScope); // true = restore from game bitmask
            if (superseded()) return false;
          }
        }

        // Parse and restore game state
        const currentState = gameStateData.state || 'LOBBY';
        let questionNumber = gameStateData.currentQuestion || 0;
        
        // Trust the currentQuestion from backend - don't override it by parsing state
        console.log(`🔄 HOST: Using lesson number ${questionNumber} from backend (state: ${currentState})`);
        
        // Only extract from state if backend didn't provide currentQuestion (legacy fallback)
        if (questionNumber === 0 && (currentState.includes('#'))) {
          const stateQuestionMatch = currentState.match(/#(\d+)/);
          if (stateQuestionMatch) {
            questionNumber = parseInt(stateQuestionMatch[1], 10);
            console.log(`🔄 HOST: Fallback: Extracted question number ${questionNumber} from state ${currentState}`);
          }
        }
        
        console.log(`📊 HOST: Current state: ${currentState}, Question: ${questionNumber}`);
        
        // Use server state directly instead of mapping to legacy format
        setGameState(currentState);
        console.log(`🎮 HOST: Set game state to ${currentState}`);

        // The durable fact, read straight from the ROUND# record (get-game-state
        // .js now includes it) rather than inferred from the state string. An
        // early reveal — the override for a host who reveals before closing the
        // vote — must survive an ordinary re-sync (reconnect, gameStateChanged,
        // questionStarted, votingStarted) that runs before RESULTS; deriving
        // from `currentState.startsWith('RESULTS#')` silently reverted exactly
        // that case, since none of those events are RESULTS transitions.
        setAuthorsRevealed(!!gameStateData.authorsRevealed);
        console.log(`🔍 HOST: Questions array length: ${questions.length}`);
        
        // If we have a current question, set it up
        if (questionNumber > 0) {
          setCurrentQuestionIndex(questionNumber - 1); // Convert to 0-based index
          setLessonNumber(questionNumber);
          
          // Get the current question data using new API (only if we have currentQuestionData)
          if (gameStateData.currentQuestionData) {
            // Use the question data from game state
            setQuestions([gameStateData.currentQuestionData]);
            // Without this the id lookup below misses after a refresh, and the
            // instruction resolver falls all the way through to the generic
            // call-and-answer default — even on an Art Title round.
            setCurrentQuestionId(gameStateData.currentQuestionData.id);
            console.log(`📝 HOST: Loaded question ${questionNumber} from game state:`, gameStateData.currentQuestionData.title);
          } else {
            // Try to fetch question data with question number
            try {
              const paddedQuestionNumber = String(questionNumber).padStart(3, '0');
              const questionRes = await fetch(`${API_BASE}games/${gameId}/question?role=host`);
              
              if (questionRes.ok) {
                const questionData = await questionRes.json();
                setQuestions([questionData]);
                setCurrentQuestionId(questionData.id);
                console.log(`📝 HOST: Loaded question ${questionNumber}:`, questionData.title);
                console.log('🔍 HOST: Question data keys:', Object.keys(questionData));
                console.log('🔍 HOST: Updated questions array:', [questionData]);
              } else {
                console.error(`❌ HOST: Failed to load question ${questionNumber}, status:`, questionRes.status);
                const errorText = await questionRes.text();
                console.error(`❌ HOST: Error response:`, errorText);
              }
            } catch (error) {
              console.error(`❌ Failed to load question ${questionNumber}:`, error);
            }
          }
          
          // If in voting or answer phase, get progress data
          if (currentState.startsWith('ASK#') && gameStateData.answerProgress) {
            setPlayersWhoAnswered(gameStateData.answerProgress.answererIds || []);
            console.log(`📝 HOST: ${gameStateData.answerProgress.answersReceived}/${gameStateData.answerProgress.totalPlayers} players have answered`);

            // If there are answers, load them to show the host what has been submitted
            if (gameStateData.answerProgress.answersReceived > 0) {
              console.log(`📝 HOST: Loading ${gameStateData.answerProgress.answersReceived} existing answers for display`);
              fetchAnswersForQuestion(questionNumber);
            } else {
              // ...and if there are NOT, say so. This branch used to be absent,
              // so `answers` kept the PREVIOUS round's rows whenever a round
              // opened through a re-sync rather than through this page's own
              // button — which is every round the phone remote deals. The host
              // then read the last round's count on the meter and got a live
              // "Start Voting" on a round nobody had answered, because
              // hostControls enables it from `answers.length`.
              console.log('🧹 HOST: no answers in for this round yet — clearing the previous round\'s');
              setAnswers([]);
            }
          }
          
          if (currentState.startsWith('VOTE#')) {
            // Get answers for voting display
            try {
              const paddedQuestionNumber = String(questionNumber).padStart(3, '0');
              const answersRes = await fetch(`${API_BASE}games/${gameId}/answers?role=host&questionId=${paddedQuestionNumber}`);
              
              if (answersRes.ok) {
                const answersData = await answersRes.json();
                setAnswers(answersData.answers || []);
                console.log(`🗳️ HOST: Loaded ${answersData.answers.length} answers for voting`);
              }
            } catch (error) {
              console.error(`❌ Failed to load answers for question ${questionNumber}:`, error);
            }
            
            // Set voting progress
            if (gameStateData.votingProgress) {
              const votersIds = gameStateData.votingProgress.votersIds || [];
              setPlayersWhoVoted(votersIds);
              console.log(`🗳️ HOST: ${gameStateData.votingProgress.votesReceived}/${gameStateData.votingProgress.totalPlayers} players have voted`);
              console.log(`🗳️ HOST: Restored voting progress - votersIds:`, votersIds);
              
              // If there are votes, load them to show the host the voting status
              if (gameStateData.votingProgress.votesReceived > 0) {
                console.log(`🗳️ HOST: Loading ${gameStateData.votingProgress.votesReceived} existing votes for display`);
                fetchVotesForQuestion(questionNumber);
              }
            }
          }
          
          if (currentState.startsWith('RESULTS#')) {
            // A READ, deliberately on the public route: the round is already
            // RESULTS#, so there is nothing to transition and this is the same
            // call a player's page makes. Only handleShowResults, which
            // actually closes the round, uses the authenticated close-round
            // route.
            try {
              const resultsRes = await fetch(`${API_BASE}games/get-results`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  gameId: gameId,
                  questionNumber: questionNumber
                })
              });
              
              if (resultsRes.ok) {
                const resultsData = await resultsRes.json();
                console.log(`🏆 HOST: Received results for question ${questionNumber}:`, resultsData);
                console.log(`🔍 HOST: voteTallies structure:`, resultsData.voteTallies);
                console.log(`🔍 HOST: voteTallies keys:`, Object.keys(resultsData.voteTallies || {}));
                
                // Format results based on game type - same logic as handleShowResults
                let formattedAnswers = [];
                
                // Handle different result formats based on game type
                if (resultsData.gameType === 'trivia') {
                  // Trivia results format: { answers: [...], leaderboard: [...] }
                  console.log(`🧠 HOST STATE RESTORE: Processing trivia results with ${resultsData.answers?.length || 0} answers`);
                  
                  formattedAnswers = (resultsData.answers || []).map(answer => ({
                    player: answer.playerName,
                    playerName: answer.playerName, // for displayLabelFor
                    answer: answer.answer, // Letter like 'A', 'B', 'C'
                    points: answer.pointsEarned || 0,
                    isCorrect: answer.isCorrect || false,
                    responseTimeMs: answer.responseTimeMs || 0,
                    speedBonus: answer.speedBonus || 0,
                    basePoints: answer.basePoints || 0,
                    submittedAt: answer.submittedAt
                  }));
                } else if (resultsData.gameType === 'wavelength') {
                  // This branch did not exist: a refresh mid-RESULTS fell
                  // through to the call-and-answer arm, found no voteTallies,
                  // and the stage rendered an empty cloud. The stored round
                  // carries everything — including the clustered analysis if
                  // the worker has already finished.
                  console.log(`🌊 HOST STATE RESTORE: Processing wavelength results with ${resultsData.answers?.length || 0} answers`);
                  formattedAnswers = (resultsData.answers || []).map(answer => ({
                    player: answer.playerName,
                    playerName: answer.playerName, // for displayLabelFor
                    answer: answer.answer || answer.words?.join(',') || '',
                    points: 0, // No points in wavelength
                    submittedAt: answer.submittedAt
                  }));
                  setWavelengthAnalysis(resultsData.wordAnalysis || null);
                } else {
                  // Call-and-answer results format: { voteTallies: {...} }
                  console.log(`📊 HOST STATE RESTORE: Processing call-and-answer results with voteTallies`);
                  // `placement` comes from assignPlacements — the answer's
                  // PLACE in the round by total points, ties shared. The old
                  // inline derivation was "best rank any voter gave it", which
                  // badged every answer with one first-choice vote as 1.
                  formattedAnswers = resultsData.voteTallies && Object.keys(resultsData.voteTallies).length > 0
                    ? assignPlacements(Object.values(resultsData.voteTallies).map((tally, index) => {
                        console.log(`📊 HOST: Formatting tally ${index}:`, tally);
                        return {
                          player: tally.playerName,
                          playerName: tally.playerName, // for displayLabelFor
                          answer: tally.answerText,
                          points: tally.totalScore,
                          votes: tally.firstPlace + tally.secondPlace + tally.thirdPlace
                        };
                      }))
                    : [];
                }
                
                console.log(`🎯 HOST: Final formatted answers:`, formattedAnswers);
                setAnswers(formattedAnswers);
                console.log(`🏆 HOST: Loaded ${formattedAnswers.length} formatted results for question ${questionNumber}`);
              }
            } catch (error) {
              console.error(`❌ Failed to load results for question ${questionNumber}:`, error);
            }
          }
        } else {
          // No round in play — a game that has been created or started but not
          // yet advanced. This branch used to not exist, and that was the bug:
          // restore only ever ADDED, so a freshly started game (which reports
          // currentQuestion: 0) left the previous session's question, answers
          // and progress on screen until the host refreshed the browser.
          //
          // `questions` and `currentQuestionId` clear together, always — see
          // config/instructions.js for what happens when they don't.
          console.log(`🧹 HOST: Game ${forGameId} has no current round — clearing round state`);
          setQuestions([]);
          setCurrentQuestionId('');
          setCurrentQuestionIndex(-1);
          setLessonNumber(0);
          setAnswers([]);
          setWavelengthAnalysis(null);
          setPlayersWhoAnswered([]);
          setVotes([]);
          setPlayersWhoVoted([]);
          setCurrentQuestionVotes([]);
          setCurrentAIInsights(null);
          setLoadingAIInsights(false);
        }

        // Fetch current players with scores
        await fetchPlayers('state-restore');
        if (superseded()) return false;

        // Load dynamic category management data for active games
        await loadCategoryCounts();

        return true; // Successfully restored existing game

      } else {
        console.log(`ℹ️ HOST: No existing game state found - starting fresh`);
        return false; // No existing game found
      }
    } catch (e) {
      console.error('Error restoring game state:', e);
      return false; // Restoration failed
    } finally {
      setIsRestoringState(false); // End restoration, on every path out
    }
  };

  const fetchAnswersForQuestion = async (questionNumber) => {
    try {
      console.log(`📡 HOST: Fetching answers for question ${questionNumber}`);
      const paddedQuestionNumber = String(questionNumber).padStart(3, '0');
      const url = `${API_BASE}games/${gameId}/answers?role=host&questionId=${paddedQuestionNumber}`;
      console.log(`📡 HOST: API call: ${url}`);
      
      const res = await fetch(url);
      const json = await res.json();
      console.log(`📊 HOST: Raw answer response:`, json);
      
      const questionAnswers = json.answers || [];
      console.log(`🔍 HOST: Answers for question ${questionNumber}:`, questionAnswers);
      
      setAnswers(questionAnswers);

      // Participation is derived from these rows ONLY when they carry names.
      // On a hidden round every row is redacted, so this used to write
      // [undefined, undefined] over the correct answererIds list restoreGameState
      // had just set six lines earlier — no player card ever showed its tick.
      // An empty result means "this payload says nothing about who answered",
      // which is not the same as "nobody answered". See answeredNamesFrom.
      const playerNames = answeredNamesFrom(questionAnswers);
      if (playerNames.length > 0) {
        setPlayersWhoAnswered(playerNames);
        console.log(`✅ HOST: Set playersWhoAnswered to:`, playerNames);
      } else {
        console.log('🔒 HOST: answers carry no attribution — leaving playersWhoAnswered as the server set it');
      }
      console.log(`📝 HOST: Loaded ${questionAnswers.length} answers for question ${questionNumber}`);
    } catch (e) {
      console.error('Error fetching answers for question:', e);
    }
  };

  /**
   * WHO HAS ANSWERED, PULLED FROM THE SERVER BECAUSE THE FRAME COULD NOT SAY.
   *
   * THE DEFECT THIS FIXES. On a hidden round message.js strips `playerName`
   * from every `playerAnswered` frame (correctly — it would otherwise hand the
   * host's socket a live author-to-answer mapping). The unconditional /answers
   * refetch still moves the COUNT, because redacted rows are still rows and
   * `answeredCountFrom` takes the larger of the two sources. But nothing moved
   * the NAMES: `playersWhoAnswered` was written only by restoreGameState, which
   * runs on mount, reconnect or refocus. So the count climbed, the name list
   * stood still, and `waitingRoster`'s freshness guard correctly refused to
   * print a list it knew was stale — for the rest of the round. What the owner
   * saw was a reveal that stopped working the moment the second person
   * answered.
   *
   * IT EXPOSES NOTHING NEW. `answerProgress.answererIds` is the same field
   * restoreGameState already reads on every resync, on the same public route,
   * and get-answers.js:216 documents it as deliberately public: "who has not
   * acted yet is a different fact from who wrote what."
   *
   * `includeHostData=true` because get-game-state only assembles
   * `answerProgress` under that flag — without it this would read a payload
   * with no participation in it at all and quietly do nothing.
   */
  const refreshAnswerersFromState = async (forGameId) => {
    try {
      const res = await fetch(`${API_BASE}games/${forGameId}/state?includeHostData=true`);
      if (!res.ok) return;
      const stateData = await res.json();
      // The host may have switched games while this was in flight; the same
      // guard restoreGameState uses, for the same reason.
      if (activeGameIdRef.current !== forGameId) {
        console.log(`🚫 HOST: discarding answerer sync for game ${forGameId}`);
        return;
      }
      const ids = answererIdsFrom(stateData);
      // null means the payload said nothing about participation — the round has
      // moved to VOTE, or the read raced a state change. Leave the list alone
      // rather than blanking it; an empty ARRAY is a different answer and is
      // applied, because that one means "the server says nobody yet".
      if (!ids) return;
      setPlayersWhoAnswered(ids);
      console.log(`🔄 HOST: participation list refreshed from /state — ${ids.length} answered`);
    } catch (e) {
      // Best effort. The count is already correct without this; only the names
      // lag, and the next frame schedules another attempt.
      console.error('Error refreshing the participation list:', e);
    }
  };

  /**
   * COALESCED, NOT DEBOUNCED, AND THE DIFFERENCE MATTERS HERE.
   *
   * Ten people answering at once must not fire ten /state calls. Two ways to
   * arrange that, and this one takes the second:
   *
   *   - A resetting debounce (clear the timer, start it again on every frame)
   *     STARVES under exactly the load this feature is for. A room answering
   *     steadily every 300ms would push the refresh back forever and the names
   *     would never arrive — the same defect being fixed, wearing a timer.
   *   - COALESCING: the first frame schedules a refresh, and every frame that
   *     arrives before it fires is absorbed by the one already pending. A burst
   *     of ten costs one call, and a steady stream refreshes on a fixed
   *     cadence instead of never.
   *
   * WORST CASE, 40-PERSON ROOM: one /state call per ANSWERER_SYNC_MS window,
   * so at most 2.5/s however fast the frames arrive, AND at most one per
   * answer. The worst case is therefore 40 calls for a 40-person round — the
   * case where every answer lands more than 400ms after the last, spread over
   * the whole round, and never more than the 40 /answers refetches that
   * already fire beside them unconditionally. A room answering within a few
   * seconds of each other, which is the normal one, is one or two calls for
   * the entire round.
   *
   * Trailing rather than leading: the value wanted is the state AFTER the burst
   * has been written, and a leading-edge call would read the server before the
   * answers that triggered it had landed.
   */
  const ANSWERER_SYNC_MS = 400;

  const scheduleAnswererSync = () => {
    // A refresh is already pending; it will see everything that arrived in the
    // meantime. This early return IS the coalescing.
    if (answererSyncRef.current) return;
    const forGameId = gameId;
    answererSyncRef.current = setTimeout(() => {
      answererSyncRef.current = null;
      refreshAnswerersFromState(forGameId);
    }, ANSWERER_SYNC_MS);
  };

  const fetchVotesForQuestion = async (questionNumber) => {
    try {
      console.log(`📡 HOST: Fetching votes for question ${questionNumber}`);
      const paddedQuestionNumber = String(questionNumber).padStart(3, '0');
      const url = `${API_BASE}games/${gameId}/votes?role=host&questionNumber=${paddedQuestionNumber}`;
      console.log(`📡 HOST: API call: ${url}`);
      
      const res = await fetch(url);
      const json = await res.json();
      console.log(`📊 HOST: Raw votes response:`, json);
      
      const questionVotes = json.votes || [];
      setVotes(questionVotes);
      setCurrentQuestionVotes(questionVotes);
      
      // Track who has voted
      const votersSet = new Set(questionVotes.map(vote => vote.voter));
      const voterNames = Array.from(votersSet);
      setPlayersWhoVoted(voterNames);
      console.log(`✅ HOST: Set playersWhoVoted to:`, voterNames);
      console.log(`🗳️ HOST: Loaded ${questionVotes.length} votes for question ${questionNumber}`);
    } catch (e) {
      console.error('Error fetching votes for question:', e);
    }
  };

  const fetchPlayers = async (reason = 'manual') => {
    try {
      console.log(`${useWebSocket ? '🔌' : '🔄'} Fetching players for game: ${gameId} (${reason})`);
      const res = await fetch(`${API_BASE}games/${gameId}/players`);
      
      if (!res.ok) {
        console.error(`fetchPlayers HTTP error: ${res.status} ${res.statusText}`);
        const errorText = await res.text();
        console.error('Error response:', errorText);
        return;
      }
      
      const json = await res.json();
      console.log('Players fetched:', json.players);
      
      // Transform player data to match frontend expectations
      const transformedPlayers = (json.players || []).map(player => ({
        ...player,
        name: player.playerName, // Map playerName to name
        score: player.totalScore || 0, // Map totalScore to score
        playerName: player.playerName, // Keep original for compatibility
        totalScore: player.totalScore || 0 // Keep original for compatibility
      }));
      
      console.log('Transformed players:', transformedPlayers);
      setPlayers(transformedPlayers);

      // WHO LEFT, kept apart. `players` above is the room, and every count in
      // this file is drawn from it; these are for the Players tab, which is the
      // only place a removal can be undone. `|| []` because a roster fetched
      // from a backend that predates removal has no such key, and an undefined
      // here would take the panel down.
      setRemovedPlayers((json.removedPlayers || []).map(player => ({
        ...player,
        name: player.playerName,
        score: player.totalScore || 0,
      })));
    } catch (e) {
      console.error('fetchPlayers error', e);
    }
  };

  /**
   * Take somebody out of the live counts, or put them back.
   *
   * SOFT, ALWAYS. The endpoint sets or clears one `RemovedAt` attribute and
   * deletes nothing — their answers, votes and points stay, and the session
   * report still counts them (create-report.js:147). Owner: *"this should not
   * eliminate any contribution they had made or points they had accumulated
   * before leaving. they will still show up in the data and reports."*
   *
   * Host-gated, so it carries the ID token like every other host action here.
   */
  const setPlayerRemoved = async (name, removed) => {
    try {
      const res = await authFetch(
        `${API_BASE}games/${gameId}/players/${encodeURIComponent(name)}/remove`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ removed }),
        }
      );
      if (!res.ok) {
        console.error(`setPlayerRemoved HTTP error: ${res.status}`);
        return;
      }
      await fetchPlayers(removed ? 'after-remove-player' : 'after-restore-player');
    } catch (e) {
      console.error('setPlayerRemoved error', e);
    }
  };

  /**
   * Unlock a name for exactly one handover.
   *
   * `bindToRequester` when somebody has actually asked through the app — the
   * grant then names them and nobody else can spend it. Open when the host is
   * acting on something said out loud, which is the commoner case in a room.
   * The requester's client id never reaches this page: the server reads it off
   * its own row, because a client id is the secret get-answers.js accepts as
   * proof of identity and GET /players is public.
   */
  const grantNameHandover = async (name, bindToRequester) => {
    try {
      const res = await authFetch(
        `${API_BASE}games/${gameId}/players/${encodeURIComponent(name)}/handover`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ bindToRequester: Boolean(bindToRequester) }),
        }
      );
      if (!res.ok) {
        console.error(`grantNameHandover HTTP error: ${res.status}`);
        return;
      }
      await fetchPlayers('after-grant-handover');
    } catch (e) {
      console.error('grantNameHandover error', e);
    }
  };


  const fetchQuestionSets = async (duringRestoration = false) => {
    try {
      // authFetch: the question-set routes now carry the Cognito authorizer.
      // They were public, so any caller could read any set's content.
      const res = await authFetch(`${API_BASE}question-sets`);
      const json = await res.json();
      const activeSets = json.sets?.filter(set => set.active) || [];
      setQuestionSets(activeSets);
      
      console.log(`🔍 HOST: fetchQuestionSets auto-selection check:`, {
        activeSetsCount: activeSets.length,
        selectedSetId,
        gameState,
        duringRestoration,
        shouldAutoSelect: activeSets.length > 0 && !selectedSetId && isLobbyState(gameState) && !duringRestoration
      });
      
      // Auto-select first set if none selected and no game is running
      // CRITICAL: Don't auto-select during state restoration to prevent override of restored questionSetId
      if (activeSets.length > 0 && !selectedSetId && isLobbyState(gameState) && !isRestoringState && !duringRestoration) {
        const firstSetId = activeSets[0].id;
        // The row carries its own scope (get-question-sets.js returns it beside
        // the id); auto-selection must not drop the half it already has.
        const firstSetScope = activeSets[0].scope || DEFAULT_SCOPE;
        setSelectedSetId(firstSetId);
        setSelectedSetScope(firstSetScope);
        fetchCategories(firstSetId, false, firstSetScope);
        fetchQuestionSetInstruction(firstSetId, firstSetScope);
        console.log(`🎯 HOST: Auto-selected first question set: ${firstSetId}`);
      } else if (selectedSetId) {
        console.log(`⏳ HOST: Question set already selected: ${selectedSetId}`);
      } else if (!isLobbyState(gameState)) {
        console.log(`⏳ HOST: Game in progress (${gameState}) - not auto-selecting question set`);
      } else if (isRestoringState || duringRestoration) {
        console.log(`🔄 HOST: State restoration in progress - skipping auto-selection`);
      } else {
        console.log(`⏳ HOST: No auto-selection - no active sets available`);
      }
    } catch (e) {
      console.error('fetchQuestionSets error', e);
    }
  };

  const fetchCategories = async (setId, restoreFromGame = false, scope = '') => {
    if (!setId) {
      setCategories([]);
      setActiveCategoryIds(new Set());
      return;
    }
    
    try {
      // authFetch: the question-set routes now carry the Cognito authorizer.
      // They were public, so any caller could read any set's content.
      // ?scope= NAMES THE LIBRARY. get-categories.js searches the caller's
      // readable scopes when this is absent — org, then platform, then public —
      // which resolves the right set almost always and the wrong one exactly
      // when two libraries hold this slug.
      const scopeQuery = scope ? `?scope=${encodeURIComponent(scope)}` : '';
      const res = await authFetch(`${API_BASE}question-sets/${setId}/categories${scopeQuery}`);
      const json = await res.json();
      const fetchedCategories = json.categories || [];
      setCategories(fetchedCategories);
      
      // If restoring from existing game, get the bitmask data
      if (restoreFromGame && gameId) {
        try {
          const gameRes = await fetch(`${API_BASE}games/${gameId}?role=host`);
          if (gameRes.ok) {
            const gameData = await gameRes.json();
            // The per-game anonymity flag (IMPORTANT 2): this is the one place
            // GameHostPage already consumes get-game.js's host response, so it
            // restores here rather than adding a second round-trip.
            setAnonymousUntilReveal(gameData.anonymousUntilReveal !== false);
            if (gameData.categoryState) {
              // Convert bitmask back to selected categories
              const selectedCategoryIds = convertBitmaskToCategories(gameData.categoryState, fetchedCategories);
              setActiveCategoryIds(new Set(selectedCategoryIds));
              console.log(`🔄 HOST: Restored ${selectedCategoryIds.length} selected categories from bitmask:`, selectedCategoryIds);
              return;
            }
          }
        } catch (error) {
          console.error('❌ Failed to restore categories from game bitmask:', error);
        }
      }
      
      // Initialize all categories as active by default (new game only)
      if (!restoreFromGame) {
        const allCategoryIds = new Set(fetchedCategories.map(cat => cat.name));
        setActiveCategoryIds(allCategoryIds);
        console.log(`🎯 HOST: Initialized all ${allCategoryIds.size} categories as active for new game`);
      } else {
        console.log(`✅ HOST: Categories restored from game - not initializing as new game`);
      }
    } catch (e) {
      console.error('fetchCategories error', e);
    }
  };

  /**
   * The create dialog picked (or cleared) a question set.
   *
   * The set id itself is the dialog's; what it hangs off — the category list,
   * the selection, the set's custom instruction — are per-game values this page
   * owns, so loading them stays here. Clearing goes through the same path so a
   * format switch cannot leave the previous set's categories on screen.
   */
  const handleSetupSetChange = (setId, scope = DEFAULT_SCOPE) => {
    setSelectedSetScope(scope || DEFAULT_SCOPE);
    fetchCategories(setId, false, scope);
    if (setId) {
      fetchQuestionSetInstruction(setId, scope);
    } else {
      setCustomInstruction(null);
    }
  };

  // Convert bitmask back to selected category names
  const convertBitmaskToCategories = (categoryState, allCategories) => {
    const selectedCategories = [];
    
    // Convert binary string masks to arrays for easier processing
    const hostMask1_8 = categoryState.hostMask1_8 || '00000000';
    const hostMask9_16 = categoryState.hostMask9_16 || '00000000';
    const hostMask17_24 = categoryState.hostMask17_24 || '00000000';
    
    console.log(`🔢 HOST: Converting bitmasks: ${hostMask1_8} ${hostMask9_16} ${hostMask17_24}`);
    
    // Check each category position in the bitmasks
    for (let i = 0; i < allCategories.length && i < 24; i++) {
      const category = allCategories[i];
      const bitPosition = i + 1;
      let isSelected = false;
      
      if (bitPosition <= 8) {
        const pos = bitPosition - 1;
        isSelected = hostMask1_8.charAt(pos) === '1';
      } else if (bitPosition <= 16) {
        const pos = bitPosition - 9;
        isSelected = hostMask9_16.charAt(pos) === '1';
      } else if (bitPosition <= 24) {
        const pos = bitPosition - 17;
        isSelected = hostMask17_24.charAt(pos) === '1';
      }
      
      if (isSelected) {
        selectedCategories.push(category.name);
      }
    }
    
    return selectedCategories;
  };

  const toggleCategoryActive = (categoryName) => {
    console.log(`🎯 Toggling category: ${categoryName}`);
    setActiveCategoryIds(prev => {
      const newSet = new Set(prev);
      if (newSet.has(categoryName)) {
        newSet.delete(categoryName);
        console.log(`❌ Deactivated category: ${categoryName}`);
      } else {
        newSet.add(categoryName);
        console.log(`✅ Activated category: ${categoryName}`);
      }
      console.log(`📋 Active categories now: ${Array.from(newSet).join(', ')}`);
      return newSet;
    });
  };

  // Load dynamic category counts and bitmasks for active games
  const loadCategoryCounts = async () => {
    if (!gameId) return;
    
    try {
      // Get category counts
      const countsRes = await fetch(`${API_BASE}games/${gameId}/state?includeHostData=true`);
      if (countsRes.ok) {
        const stateData = await countsRes.json();
        
        if (stateData.categoryCounts) {
          setCategoryCounts(stateData.categoryCounts);
          console.log(`📊 Loaded category counts:`, stateData.categoryCounts);
        }
        
        if (stateData.categoryState) {
          setCategoryBitmasks(stateData.categoryState);
          console.log(`🔢 Loaded category bitmasks:`, stateData.categoryState);
        }
      }
    } catch (error) {
      console.error('❌ Failed to load category counts:', error);
    }
  };

  // Toggle category during active game using backend API
  const toggleCategoryDuringGame = async (categoryId, categoryName, enabled) => {
    if (!gameId || isTogglingCategory) return;
    
    setIsTogglingCategory(true);
    try {
      console.log(`🎯 Toggling category ${categoryId} (${categoryName}) to ${enabled} for game ${gameId}`);
      
      const response = await authFetch(`${API_BASE}games/${gameId}/toggle-category`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          categoryId,
          categoryName,
          enabled
        })
      });
      
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to toggle category');
      }
      
      const result = await response.json();
      console.log(`✅ Category toggle successful:`, result);
      
      // Reload category counts to get updated state
      await loadCategoryCounts();
      
      return result;
    } catch (error) {
      console.error('❌ Failed to toggle category:', error);
      alert(`Failed to toggle category: ${error.message}`);
      throw error;
    } finally {
      setIsTogglingCategory(false);
    }
  };

  /**
   * Fetch the WHOLE set for the browser.
   *
   * It used to take a category and pass it to the API, because the only way in
   * was a per-category magnifier — so the host could never see the whole set at
   * once, which was this surface's worst structural defect. The chips in the
   * panel filter what is already here, client-side, so one fetch serves every
   * chip and switching between them costs nothing.
   */
  const fetchQuestionsForBrowsing = async () => {
    // Try to get setId from current questions first, then fall back to selectedSetId
    const setId = questions[0]?.setId || selectedSetId;

    if (!setId) {
      console.error('No question set available for browsing - neither selectedSetId nor current game questions found');
      return;
    }

    setLoadingQuestions(true);
    try {
      // authFetch: this route now carries the Cognito authorizer. It used to be
      // public, which meant a guessed set id read anyone's questions.
      const response = await authFetch(`${API_BASE}question-sets/${setId}/questions`);

      if (!response.ok) {
        console.error(`❌ Failed to fetch questions: ${response.status}`);
        setBrowsingQuestions([]);
        return;
      }

      const data = await response.json();
      setBrowsingQuestions(data.questions || []);
    } catch (error) {
      console.error('❌ Failed to fetch questions for browsing:', error);
      setBrowsingQuestions([]);
    } finally {
      setLoadingQuestions(false);
    }
  };

  /**
   * Drop the browser's data.
   *
   * This function existed and was ORPHANED: the modal's Close button called
   * `setShowQuestionBrowser(false)` directly and left `browsingQuestions` and
   * `selectedCategory` populated, so the next open rendered the previous set's
   * rows until the fetch landed. It is wired now — `closeAllSidePanels` calls
   * it — which is also what makes it correct across a Quick Start.
   */
  const closeQuestionBrowser = () => {
    setBrowsingQuestions([]);
  };

  /**
   * Opening the panel loads the set.
   *
   * The browser is a SECTION of the panel now, not a modal with its own entry
   * point — and the per-category magnifier that used to be its only caller was
   * deleted along with the category rows it sat in. Without this the Questions
   * tab renders its empty state forever, which is exactly how it shipped for
   * one commit before `setupPanelCallSite.test.js` grew an assertion for it.
   *
   * An effect rather than a call inside the `setSetupPanelOpen` updater: an
   * updater must be pure, and React invokes it twice under StrictMode.
   */
  useEffect(() => {
    if (setupPanelOpen) fetchQuestionsForBrowsing();
  }, [setupPanelOpen]); // eslint-disable-line react-hooks/exhaustive-deps

  /*
    ── THE QUEUE ────────────────────────────────────────────────────────────

    The other half of `selectQuestion`, and deliberately next to it: the two
    are the same decision taken at two different moments. `selectQuestion`
    interrupts the room now; these put the question in line.

    EVERY OP IS OPTIMISTIC AND THEN RECONCILED, in that order, because the
    alternative is a list that does not move until the server answers — and a
    host reordering a running order in front of a room reads a 200ms lag as a
    dead button and presses again.

    The optimistic step runs the SAME functions the Lambda runs
    (`config/questionQueue.js`, mirrored into `queue-order.js`), so the local
    guess and the server's answer can only differ when someone else edited in
    between. That is the case `staleView` reports and the WebSocket repairs.
  */

  /** Load the running order. Best-effort: a failure keeps whatever we have. */
  const loadQueue = useCallback(async () => {
    if (!gameId) return;
    const result = await fetchQueue({ apiBase: API_BASE, gameId });
    if (!result.ok) {
      // Deliberately NOT an alert. The queue is a panel a host may never open,
      // and a modal about it while they are running a round is worse than a
      // list that is briefly stale — which the next op or frame repairs.
      console.warn('⚠️ QUEUE: could not read the running order:', result.error);
      return;
    }
    setQuestionQueue(result.queue);
    setQueueVersion(result.version);
  }, [gameId]);

  /**
   * WHAT THE SESSION WILL ASK NEXT, INCLUDING THE PART NOBODY QUEUED.
   *
   * `GET /up-next` runs the real selection forward — see question-plan.js — so
   * this is the order the room actually gets rather than a guess about it. Read
   * only; peeking spends nothing.
   *
   * FETCHED BESIDE THE QUEUE, NEVER CACHED. The plan depends on the cursors,
   * the enabled categories and what has already been asked, so it is stale the
   * moment any of those move. Re-asking is a handful of reads and no writes, so
   * every caller re-fetches instead of holding a copy that quietly rots — the
   * same discipline the remote's category rows already follow.
   *
   * Silent on failure. This is a panel a host may never open, and a modal about
   * a preview while they are running a round is worse than a short list.
   */
  const loadUpNext = useCallback(async () => {
    if (!gameId) return;
    try {
      const res = await authFetch(`${API_BASE}games/${gameId}/up-next?count=6`);
      if (!res.ok) return;
      const payload = await res.json();
      setUpNext(Array.isArray(payload.upNext) ? payload.upNext : []);
      // The queue entries the plan cannot use — not in this set, no reachable
      // category — reported so the panel can say "parked" instead of letting
      // the host watch their own choice be skipped in silence.
      setUpNextBlocked(Array.isArray(payload.blocked) ? payload.blocked : []);
      // Served-but-labeled (a one-off from a switched-off category), and the
      // questions the host has disabled for this session.
      setUpNextAdvisories(Array.isArray(payload.advisories) ? payload.advisories : []);
      setUpNextExcluded(Array.isArray(payload.excluded) ? payload.excluded : []);
      /*
        THE SERVER'S OWN ASKED LIST corrects the watched one. Locally-watched
        ids stay (union, not replace — the round on screen is asked before the
        next poll), but the base truth is the REF rows, which is what makes
        the tags right after re-entering a played session and immune to what
        some other browser watched.
      */
      if (Array.isArray(payload.asked) && payload.asked.length) {
        setUsedQuestionIds((prev) => {
          const merged = new Set(prev);
          for (const id of payload.asked) merged.add(id);
          return merged.size === prev.length ? prev : [...merged];
        });
      }
    } catch (error) {
      console.warn('⚠️ UP NEXT: could not read what is coming:', error?.message);
    }
  }, [gameId]);

  /*
    Read it when the panel opens, alongside the questions themselves. Not on
    mount: a host who never opens the console never needs the list, and the
    drain happens server-side either way.
  */
  useEffect(() => {
    if (setupPanelOpen) { loadQueue(); loadUpNext(); }
    /*
      AND ON EVERY ROUND, because the plan is a function of what has already
      been asked. Without `currentQuestionId` here the panel would keep showing
      the question the room just answered as still "coming up" — the preview
      going stale in the one way a host would certainly notice.
    */
  }, [setupPanelOpen, currentQuestionId, loadQueue, loadUpNext]);

  /**
   * One op, applied locally, sent, then reconciled.
   *
   * `apply` is the matching pure function. When it refuses — the row is already
   * first, the question is already queued — NOTHING IS SENT. That is not an
   * optimisation: it is what keeps a double-tap on an edge button from being a
   * request whose 200 answer arrives after the host has moved on and re-renders
   * a list they have since changed.
   */
  const runQueueOp = useCallback(async (op, rawKey, apply) => {
    const key = String(rawKey ?? '').replace(/^QUESTION#/, '').trim();
    if (!key) return;

    const before = normaliseQueue(questionQueue);
    const local = apply(before);

    if (!local.changed) {
      // Say only what the host cannot see for themselves. `at-edge`,
      // `duplicate` and `not-queued` are all visible in the list in front of
      // them; a full queue is not — see REFUSALS_WORTH_SAYING.
      if (local.refused === 'full') {
        alert('The queue is full — 24 questions is the limit. Remove one from the running order first.');
      }
      return;
    }

    setQuestionQueue(local.queue);
    setQueueBusyKeys((prev) => (prev.includes(key) ? prev : [...prev, key]));

    const result = await postQueueOp({
      apiBase: API_BASE, gameId, op, questionKey: key, expectedVersion: queueVersion,
    });

    setQueueBusyKeys((prev) => prev.filter((k) => k !== key));

    if (!result.ok) {
      // PUT THE LIST BACK. An optimistic move that failed must not stay on
      // screen: the host would end the round expecting the question they
      // "moved" to the top and get the one that was actually there.
      setQuestionQueue(before);
      alert(`Could not change the running order: ${result.error}`);
      return;
    }

    // The server refused something the local copy accepted — only possible when
    // the other host surface changed the list in between. Its list is the one
    // that lands below, so this is a message, not a rollback.
    if (result.message) alert(result.message);

    // `queue: null` is a landed write whose body we could not read — re-read
    // rather than guess. Otherwise take the server's list verbatim; it is
    // authoritative and it already includes anything the other surface did.
    if (result.queue === null) {
      loadQueue();
      loadUpNext();
      return;
    }
    setQuestionQueue(result.queue);
    // Queueing something changes what follows it, so the tail is re-planned.
    loadUpNext();
    setQueueVersion(result.version);
  }, [gameId, questionQueue, queueVersion, loadQueue]);

  const handleQueueQuestion = useCallback(
    (question) => runQueueOp('add', question?.id, (q) => queueEnqueue(q, question?.id)),
    [runQueueOp],
  );

  const handleQueueRemove = useCallback(
    (key) => runQueueOp('remove', key, (q) => queueRemove(q, key)),
    [runQueueOp],
  );

  const handleQueueMove = useCallback(
    (key, direction) => runQueueOp(direction, key, (q) => queueMove(q, key, direction)),
    [runQueueOp],
  );

  /**
   * MOVING AN AUTO ROW MAKES THE WHOLE DISPLAYED PLAN MANUAL — the owner's own
   * semantics ("in a way all of them now are manually adjusted. that may not
   * make a difference"). config/questionQueue.js's materializePlanOps decides
   * the burst; this executes it as ordinary sequential ops, each one replayed
   * server-side against a fresh read, so a phone edit that interleaves is not
   * lost — the same property every single-op press already has.
   *
   * Optimistic like runQueueOp, but reconciled by RELOAD rather than by taking
   * one response verbatim: the burst's final state is the composition of
   * several writes, and the phone may have interleaved its own between them.
   */
  const handleAutoMove = useCallback(async (rawKey, direction) => {
    const key = String(rawKey ?? '').replace(/^QUESTION#/, '').trim();
    if (!key) return;

    const autoKeys = upNext
      .filter((row) => row && row.source === 'auto')
      .map((row) => String(row.questionId || '').replace(/^QUESTION#/, ''));

    const plan = materializePlanOps(questionQueue, autoKeys, key, direction);
    if (!plan.ops.length) {
      if (plan.refused === 'full') {
        alert('The queue is full — 24 questions is the limit. Remove one from the running order first.');
      }
      return;
    }

    setQuestionQueue(plan.queue);
    setQueueBusyKeys((prev) => (prev.includes(key) ? prev : [...prev, key]));

    let version = queueVersion;
    let failed = null;
    for (const op of plan.ops) {
      // Sequential on purpose: each op's meaning depends on the queue the one
      // before it produced, and the server applies each against what it just
      // read. Parallel posts would race each other for the version.
      // eslint-disable-next-line no-await-in-loop
      const result = await postQueueOp({
        apiBase: API_BASE, gameId, op: op.op, questionKey: op.questionKey, expectedVersion: version,
      });
      if (!result.ok) { failed = result.error; break; }
      if (result.version !== null) version = result.version;
    }

    setQueueBusyKeys((prev) => prev.filter((k) => k !== key));
    if (failed) alert(`Could not rearrange the running order: ${failed}`);
    // Authoritative state after a multi-write burst is the server's, not any
    // single response — re-read both halves of the panel.
    loadQueue();
    loadUpNext();
  }, [gameId, questionQueue, queueVersion, upNext, loadQueue, loadUpNext]);

  /**
   * DISABLE — the third of the owner's four queue verbs: this question is not
   * asked at all this session. For a QUEUED row it is two calls, un-queue then
   * veto, deliberately not a compound server op: each half is independently
   * safe, and a half-done pair leaves the question visible for a second press
   * instead of wedged. The serve honours the veto by union with the asked set
   * (next-question.js), so the drain also defends against the half-done case.
   */
  const handleDisableQuestion = useCallback(async (rawKey, { queued = false } = {}) => {
    const key = String(rawKey ?? '').replace(/^QUESTION#/, '').trim();
    if (!key) return;
    setQueueBusyKeys((prev) => (prev.includes(key) ? prev : [...prev, key]));

    let failed = null;
    if (queued) {
      const removed = await postQueueOp({
        apiBase: API_BASE, gameId, op: 'remove', questionKey: key, expectedVersion: queueVersion,
      });
      if (!removed.ok) failed = removed.error;
    }
    if (!failed) {
      const vetoed = await postExclusionOp({
        apiBase: API_BASE, gameId, op: 'add', questionKey: key,
      });
      if (!vetoed.ok) failed = vetoed.error;
    }

    setQueueBusyKeys((prev) => prev.filter((k) => k !== key));
    if (failed) alert(`Could not disable that question: ${failed}`);
    loadQueue();
    loadUpNext();
  }, [gameId, queueVersion, loadQueue, loadUpNext]);

  /** The way back from Disable — the veto lifts and the walk picks it up. */
  const handleRestoreQuestion = useCallback(async (rawKey) => {
    const key = String(rawKey ?? '').replace(/^QUESTION#/, '').trim();
    if (!key) return;
    const result = await postExclusionOp({
      apiBase: API_BASE, gameId, op: 'remove', questionKey: key,
    });
    if (!result.ok) alert(`Could not restore that question: ${result.error}`);
    loadQueue();
    loadUpNext();
  }, [gameId, loadQueue, loadUpNext]);

  // Select a specific question to trigger as the next question
  const selectQuestion = async (selectedQuestion) => {
    try {
      console.log(`🎯 HOST: Selecting specific question:`, selectedQuestion);

      // Close the panel first, so the confirmation is the only thing on screen
      // and the host is answering about the round rather than about the list.
      closeAllSidePanels();

      // Show confirmation when skipping to next question during Ask/Vote phase (same as handleNextQuestion)
      if (gameState.startsWith('ASK#') || gameState.startsWith('VOTE#')) {
        const proceed = await showConfirmation(
          'Skip to Selected Question?',
          'Do you want to skip the current question and move to the selected question?',
          'Skip to Question'
        );
        if (!proceed) return;
      }
      
      // Show loading overlay (same as handleNextQuestion)
      setIsLoadingData(true);
      setLoadingMessage('Loading Selected Question...');
      
      console.log(`🎯 HOST: Requesting specific question, current state: ${gameState}`);
      
      // Include skip action if we're forcing advancement from ASK/VOTE states (same logic as handleNextQuestion)
      const requestBody = {
        questionId: selectedQuestion.id,
        action: 'select_specific'
      };
      if (gameState.startsWith('ASK#') || gameState.startsWith('VOTE#')) {
        requestBody.action = 'skip_to_specific';
      }
      
      // Use the same next-question API that handleNextQuestion uses
      const nextQuestionRes = await authFetch(`${API_BASE}games/${gameId}/next-question`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody)
      });
      
      if (!nextQuestionRes.ok) {
        const errorData = await nextQuestionRes.json();
        console.error('Failed to select specific question:', errorData);
        alert(`Failed to select question: ${errorData.error || 'Unknown error'}`);
        return;
      }
      
      const nextQuestionData = await nextQuestionRes.json();
      console.log(`📝 HOST: Selected question response:`, nextQuestionData);
      
      const questionId = nextQuestionData.questionId;
      const lessonNumber = nextQuestionData.lessonNumber;
      const newState = nextQuestionData.state; // Use actual state from API (e.g., ASK#001)
      
      // Get the actual question details (same as handleNextQuestion)
      const questionLookupRes = await fetch(`${API_BASE}games/${gameId}/question?role=host`);
      
      if (!questionLookupRes.ok) {
        console.error('Failed to get question details:', questionLookupRes.status);
        return;
      }
      
      const questionData = await questionLookupRes.json();
      console.log(`🎲 HOST: Selected question data:`, questionData);
      
      // Use the exact same state management as handleNextQuestion
      setManualStateChange(true);
      setGameState(newState);
      setQuestions([questionData]);
      setLessonNumber(lessonNumber);
      setAuthorsRevealed(false); // A new round starts anonymous, not the last one's reveal

      // Notify players via WebSocket (exactly like handleNextQuestion)
      if (webSocketClient.isConnected()) {
        const messageType = newState;
        webSocketClient.sendCleanMessage(messageType, {
          lessonNumber,
          gameState: newState,
          currentQuestion: questionData
        });
        console.log(`📡 HOST: Sent WebSocket message - ${messageType}`);
      }
      
      // Close any open panels
      closeAllSidePanels();
      
      console.log(`✅ HOST: Successfully selected question ${questionId}, state: ${newState}`);
      
    } catch (error) {
      console.error('Error selecting question:', error);
      alert(`Error selecting question: ${error.message}`);
    } finally {
      setIsLoadingData(false);
    }
  };

  /**
   * Remember the questions this host has watched go by, so the browser can dim
   * them. See `usedQuestionIds` — this is the only signal the client has.
   */
  // Reads `questions[0]` rather than `currentQuestion`, which is derived from
  // it 1,400 lines below and would be in its temporal dead zone here.
  const askedQuestionId = questions[0]?.questionId;
  useEffect(() => {
    if (!askedQuestionId) return;
    setUsedQuestionIds((ids) => (ids.includes(askedQuestionId) ? ids : [...ids, askedQuestionId]));
  }, [askedQuestionId]);

  const checkAnswerStatus = async () => {
    try {
      // Get the current question number from game state instead of calculating from index
      const stateRes = await fetch(`${API_BASE}games/${gameId}/state`);
      const gameState = await stateRes.json();
      const questionNumber = gameState.currentQuestion;
      
      if (!questionNumber) {
        console.log(`⚠️ HOST: No current question found in game state`);
        return;
      }
      
      console.log(`🔍 HOST: Checking answer status for question ${questionNumber} (index ${currentQuestionIndex})`);
      
      const res = await fetch(`${API_BASE}games/${gameId}/answers?questionNumber=${questionNumber}`);
      const json = await res.json();
      console.log(`📊 HOST: Raw answer response:`, json);
      
      const currentAnswers = json.answers || [];
      
      console.log(`📝 HOST: Found ${currentAnswers.length} answers for question ${questionNumber}`);
      console.log(`👥 HOST: Players who answered:`, currentAnswers.map(a => a.name));
      
      setAnswers(currentAnswers);
      setPlayersWhoAnswered(currentAnswers.map(a => a.name));
    } catch (e) {
      console.error('checkAnswerStatus error', e);
    }
  };

  const fetchVotes = async () => {
    try {
      // Get the current question number from game state instead of calculating from index
      const stateRes = await fetch(`${API_BASE}games/${gameId}/state`);
      const gameState = await stateRes.json();
      const questionNumber = gameState.currentQuestion;
      
      if (!questionNumber) {
        console.log(`⚠️ HOST: No current question found in game state for votes`);
        return;
      }
      
      console.log(`🔄 POLLING: fetchVotes for question ${questionNumber} (index ${currentQuestionIndex})`);
      
      const url = `${API_BASE}games/${gameId}/votes?questionNumber=${questionNumber}`;
      console.log(`📡 POLLING API Call: ${url}`);
      
      const res = await fetch(url);
      const json = await res.json();
      const questionVotes = json.votes || [];
      
      console.log(`🔄 POLLING: Received ${questionVotes.length} votes for question ${questionNumber}:`, questionVotes);
      
      // ⚠️ WARNING: This updates the 'votes' state used by results display!
      // But results should use 'currentQuestionVotes' instead
      setVotes(questionVotes);
      
      // Track who has voted
      const votersSet = new Set(questionVotes.map(vote => vote.voter));
      setPlayersWhoVoted(Array.from(votersSet));
      
      console.log(`👥 POLLING: Players who voted: ${Array.from(votersSet).join(', ')}`);
    } catch (e) {
      console.error('fetchVotes error', e);
    }
  };

  // REMOVED: fetchGameStateForSync - WebSocket handles state synchronization

  const handleNextQuestion = async (forceSkip = false) => {
    // Show confirmation when skipping to next question during Ask/Vote phase
    if ((gameState.startsWith('ASK#') || gameState.startsWith('VOTE#')) && !forceSkip) {
      const proceed = await showConfirmation(
        'Skip to Next Question?',
        'Do you want to skip the current question and move to the next one?',
        'Skip Question'
      );
      if (!proceed) return;
    }

    // Show loading overlay
    setIsLoadingData(true);
    setLoadingMessage('Loading Next Question...');

    try {
      console.log(`🎯 HOST: Requesting next question, forceSkip: ${forceSkip}, current state: ${gameState}`);
      
      // Include skip action if we're forcing advancement from ASK/VOTE states
      const requestBody = {};
      if ((gameState.startsWith('ASK#') || gameState.startsWith('VOTE#')) && forceSkip) {
        requestBody.action = 'skip';
      }
      
      /*
        THE ADVANCE, AND ONLY THE ADVANCE.

        Reported live: "Failed to start next question", and then the next
        question appeared. Both were true — the round moved and the message said
        it had not. Two faults, and `utils/nextQuestion.js` carries the detail.

        The one that mattered here: this used to read a failed response with
        `await res.json()`, so a body that is not JSON — API Gateway's HTML on a
        504, an empty 502 — threw, and the throw landed in the outer catch, which
        blames the advance. The single case where the server had something useful
        to say was the case whose message got replaced by "please try again".

        Past this call the round HAS moved and the backend has broadcast it, so
        nothing below may tell the host to press again. Pressing again skips a
        question, live, in front of a room.
      */
      /* `authFetch`, NOT the bare global. `POST /games/{id}/next-question` was
         closed in Phase 0 — before that anyone holding a four-digit code could
         drive somebody else's live session — and this call site was missed
         because the fetch is not CALLED here, it is PASSED AS A VALUE. Grepping
         this line for `fetch(` finds `requestNextQuestion(`.

         It shipped as a 401 on the main control of the host page: start a
         quickstart, press next, "Unauthorized". __tests__/closedRoutesUseAuthFetch
         now scans for both shapes. */
      const attempt = await requestNextQuestion({
        fetchFn: authFetch, apiBase: API_BASE, gameId, body: requestBody,
      });

      if (!attempt.advanced) {
        console.error('Failed to get next question:', attempt.error);
        alert(`Failed to get next question: ${attempt.error}`);
        return;
      }
      if (attempt.error) {
        // Advanced, but its body was unreadable. Say so without implying a retry;
        // the WebSocket broadcast repairs the panel on its own.
        console.warn('Next question advanced with an unreadable body:', attempt.error);
      }
      if (!attempt.data) return;

      const nextQuestionData = attempt.data;
      console.log(`📝 HOST: Next question selected:`, nextQuestionData);
      
      const questionId = nextQuestionData.questionId;
      const lessonNumber = nextQuestionData.lessonNumber;
      const newState = nextQuestionData.state; // Use actual state from API (e.g., ASK#001)
      
      // Get the actual question details using the QUESTION#001#LOOKUP system
      const questionLookupRes = await fetch(`${API_BASE}games/${gameId}/question?role=host`);
      
      if (!questionLookupRes.ok) {
        console.error('Failed to get question details:', questionLookupRes.status);
        return;
      }
      
      const questionData = await questionLookupRes.json();
      console.log(`📝 HOST: Loaded question details:`, questionData.title);
      
      // Update local state - mark as manual change to prevent restore override
      setManualStateChange(true);
      setCurrentQuestionIndex(lessonNumber - 1); // Convert to 0-based index
      setGameState(newState); // Use actual state from API (e.g., ASK#001)
      
      // Clear all answer/voting state for new question
      console.log(`🧹 HOST: Clearing state for new question - resetting answers and players`);
      setAnswers([]);
      setWavelengthAnalysis(null);
      setPlayersWhoAnswered([]);
      setVotes([]);
      setPlayersWhoVoted([]);
      setCurrentQuestionVotes([]);
      setLessonNumber(lessonNumber);
      setAuthorsRevealed(false); // A new round starts anonymous, not the last one's reveal
      // `setAuthorsHiddenOnStage(false)` STOOD ON THE NEXT LINE AND DID NOT EXIST.
      // 72bf607c retired the per-round stage toggle and removed its useState and
      // every read of it — but left this write and one more in handleShowResults.
      // A call to an undeclared binding is a ReferenceError, thrown right here,
      // mid-update: `setCurrentQuestionId` and `setQuestions` below never ran, and
      // the outer catch told the host "the round moved on, but this screen could
      // not refresh". Which was true, and was this line.
      setCurrentQuestionId(questionId);
      
      // Set the questions array
      setQuestions([questionData]);
      
      // WebSocket notification is handled automatically by the backend
      console.log(`✅ HOST: Question ${lessonNumber} started successfully`);
      
      // Refresh players to show any updated status
      await fetchPlayers('after-next-question');
      
      // Reload category counts after transitioning to new question
      await loadCategoryCounts();
      
      // Reset manual state change flag after a delay to allow polling to resume
      setTimeout(() => {
        setManualStateChange(false);
      }, 3000);
      
    } catch (e) {
      /*
        THE ROUND HAS ALREADY MOVED BY THE TIME ANYTHING HERE CAN THROW.

        `requestNextQuestion` above never throws and returns early when the
        advance genuinely failed, so everything this catch can still see happens
        AFTER a successful POST — reading the question, and the state updates.
        The backend has broadcast the new round by then, which is why the
        original report was an error message followed by the question appearing.

        So this must not say "please try again". Re-pressing Next after a round
        that already advanced skips a question, live. Say what actually broke and
        let the WebSocket finish repairing the panel, which it does on its own.
      */
      console.error('Next question advanced, but the host panel could not refresh', e);
      alert('The round moved on, but this screen could not refresh. It should catch up on its own — do not press Next again.');
    } finally {
      // Hide loading overlay
      setIsLoadingData(false);
    }
  };

  const calculateTriviaScores = async () => {
    try {
      // Get current sequential question number and question data
      const stateRes = await fetch(`${API_BASE}games/${gameId}/state`);
      const currentState = stateRes.ok ? await stateRes.json() : {};
      const questionNumber = currentState.currentQuestion;
      const questionData = currentState.currentQuestionData;
      
      if (!questionNumber || !questionData) {
        console.log('⚠️ No current question data found for trivia scoring');
        return;
      }
      
      console.log(`🎯 CALCULATING TRIVIA SCORES FOR QUESTION: ${questionNumber}`);
      console.log(`✅ Correct answer: ${questionData.correctAnswer}`);
      console.log(`💰 Points per question: ${questionData.points || 10}`);
      
      // Get player answers for this question
      const answersRes = await fetch(`${API_BASE}games/${gameId}/answers?questionNumber=${questionNumber}`);
      const answersJson = await answersRes.json();
      const playerAnswers = answersJson.answers || [];
      
      console.log(`📋 Player answers:`, playerAnswers);
      
      // Calculate scores based on correct answers
      const playerScoreUpdates = {};
      const pointsPerCorrect = questionData.points || 10;
      
      playerAnswers.forEach(answer => {
        // Find the correct option text based on the letter answer
        const optionKey = `option${answer.answer}`;
        const playerAnswerText = questionData[optionKey];
        const playerOptionId = `Option${answer.answer}`;
        
        // Handle both array and string correctAnswer formats
        const correctAnswers = Array.isArray(questionData.correctAnswer) ? 
          questionData.correctAnswer : [questionData.correctAnswer];
        
        // Debug logging
        console.log(`🔍 Checking answer for ${answer.name}:`);
        console.log(`  - Player answered: "${answer.answer}"`);
        console.log(`  - Player option ID: "${playerOptionId}"`);
        console.log(`  - Correct answer(s): ${JSON.stringify(correctAnswers)}`);
        console.log(`  - Question data correctAnswer: "${questionData.correctAnswer}"`);
        
        const isCorrect = correctAnswers.includes(playerOptionId) || correctAnswers.includes(playerAnswerText);
        
        console.log(`👤 ${answer.name} answered: ${answer.answer} (${playerAnswerText}) - ${isCorrect ? '✅ CORRECT' : '❌ WRONG'}`);
        
        if (isCorrect) {
          playerScoreUpdates[answer.name] = pointsPerCorrect;
        }
      });
      
      console.log('🏆 TRIVIA SCORE UPDATES:', playerScoreUpdates);
      
      // Check if this question has already been scored
      const scoredQuestions = currentState.scoredQuestions || [];
      const alreadyScored = scoredQuestions.includes(questionNumber);
      
      if (alreadyScored) {
        console.log(`⚠️ TRIVIA QUESTION ${questionNumber} ALREADY SCORED - SKIPPING`);
        return;
      }
      
      // Update scores in backend
      if (Object.keys(playerScoreUpdates).length > 0) {
        console.log(`💾 UPDATING TRIVIA SCORES IN BACKEND:`, playerScoreUpdates);
        await fetch(`${API_BASE}games/${gameId}/scores`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            questionNumber: questionNumber,
            scores: playerScoreUpdates
          })
        });
        
        console.log(`✅ TRIVIA SCORES UPDATED SUCCESSFULLY`);
      } else {
        console.log(`📊 NO CORRECT ANSWERS - NO SCORE UPDATES NEEDED`);
      }
      
      // Refresh players to get updated scores
      await fetchPlayers();
      
    } catch (e) {
      console.error('Error calculating trivia scores:', e);
    }
  };

  const handleFinishQuestion = async () => {
    // For trivia and wavelength, go straight to results using the same unified mechanism as call-and-answer
    if (currentGameType === 'trivia' || currentGameType === 'wavelength') {
      // Warn if not all players have answered
      if (answeredCount < players.length) {
        const proceed = await showConfirmation(
          'Show Results?',
          `Only ${answeredCount} of ${players.length} players have answered. Do you want to show results anyway?`,
          'Show Results'
        );
        if (!proceed) return;
      }
      
      // Skip voting phase for both trivia and wavelength
      console.log(`🧠 ${currentGameType.toUpperCase()}: Using unified handleShowResults() mechanism (skipping voting phase)`);
      await handleShowResults();
      return;
    }
    
    // Call and Answer flow - proceed to voting
    // Warn if not all players have answered
    if (answeredCount < players.length) {
      const proceed = await showConfirmation(
        'Proceed to Voting?',
        `Only ${answeredCount} of ${players.length} players have answered. Do you want to proceed to voting anyway?`,
        'Proceed to Voting'
      );
      if (!proceed) return;
    }

    setManualStateChange(true);
    setGameState('voting');

    // Get answers and update state to voting using new API
    try {
      const questionNumber = lessonNumber; // Current question number
      
      // Start the voting process using the dedicated endpoint
      const startVoteRes = await authFetch(`${API_BASE}games/${gameId}/start-vote`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          questionNumber: questionNumber
        })
      });
      
      if (startVoteRes.ok) {
        const voteData = await startVoteRes.json();
        console.log(`🗳️ HOST: Vote started successfully:`, voteData);
        
        // The start-vote endpoint should return the answers
        if (voteData.answers) {
          setAnswers(voteData.answers);
          console.log(`🗳️ HOST: Loaded ${voteData.answers.length} answers for voting`);
        }
        // Update the local state to reflect the voting state
        setGameState(`VOTE#${questionNumber.toString().padStart(3, '0')}`);
      } else {
        console.error(`❌ HOST: Failed to start vote:`, startVoteRes.status);
        const errorData = await startVoteRes.json();
        console.error(`❌ HOST: Vote start error:`, errorData);
      }
    } catch (e) {
      console.error('Failed to start vote', e);
    }
  };

  const handleShowResults = async () => {
    // For trivia and wavelength games, no voting phase - skip vote check
    // For call-and-answer games, warn if not all players have voted
    if (currentGameType !== 'trivia' && currentGameType !== 'wavelength' && playersWhoVoted.length < players.length) {
      const proceed = await showConfirmation(
        'Show Results?',
        `Only ${playersWhoVoted.length} of ${players.length} players have voted. Do you want to show results anyway?`,
        'Show Results'
      );
      if (!proceed) return;
    }

    // Show loading overlay
    setIsLoadingData(true);
    setLoadingMessage('Calculating Results...');

    try {
      const questionNumber = lessonNumber; // Current question number
      
      console.log(`🎯 Getting results for question ${questionNumber}`);
      
      // CLOSING the round, not reading it — so this goes to the authenticated
      // route, with authFetch rather than fetch. Same handler and the same
      // response shape as POST /games/get-results, but that route is public
      // (PlayerPage needs it) and therefore now refuses to perform the
      // transition: the state write, the anonymity reveal, the scoring and the
      // broadcast are host-only. The player's read below is untouched.
      const resultsRes = await authFetch(`${API_BASE}games/${gameId}/close-round`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          questionNumber: questionNumber
        })
      });
      
      if (!resultsRes.ok) {
        console.error('Failed to get results:', resultsRes.status);
        return;
      }
      
      const resultsData = await resultsRes.json();
      console.log(`🏆 HOST: Received results for question ${questionNumber}:`, resultsData);
      console.log(`🎮 HOST: Game type: ${currentGameType}, Results game type: ${resultsData.gameType}`);
      
      let formattedAnswers = [];
      
      // Handle different result formats based on game type
      if (resultsData.gameType === 'trivia') {
        // Trivia results format: { answers: [...], leaderboard: [...] }
        console.log(`🧠 HOST: Processing trivia results with ${resultsData.answers?.length || 0} answers`);
        
        formattedAnswers = (resultsData.answers || []).map(answer => ({
          player: answer.playerName,
          playerName: answer.playerName, // for displayLabelFor
          answer: answer.answer, // Letter like 'A', 'B', 'C'
          points: answer.pointsEarned || 0,
          isCorrect: answer.isCorrect || false,
          responseTimeMs: answer.responseTimeMs || 0,
          speedBonus: answer.speedBonus || 0,
          basePoints: answer.basePoints || 0,
          submittedAt: answer.submittedAt
        }));
        
        console.log(`🧠 HOST: Formatted ${formattedAnswers.length} trivia answers:`, 
          formattedAnswers.map(a => `${a.player}: ${a.answer} (${a.isCorrect ? 'correct' : 'incorrect'}, ${a.points} pts)`));
        
      } else if (resultsData.gameType === 'wavelength' || currentGameType === 'wavelength') {
        // Wavelength: the analysis (landed words, near-miss, denominator,
        // matching mode) is the result; the answers ride along for the meter.
        console.log(`🌊 HOST: Processing wavelength results with ${resultsData.answers?.length || 0} answers`);

        formattedAnswers = (resultsData.answers || []).map(answer => ({
          player: answer.playerName,
          playerName: answer.playerName, // for displayLabelFor
          answer: answer.answer || answer.words?.join(',') || '', // Comma-separated words
          points: 0, // No points in wavelength
          submittedAt: answer.submittedAt
        }));
        setWavelengthAnalysis(resultsData.wordAnalysis || null);

        console.log(`🌊 HOST: Formatted ${formattedAnswers.length} wavelength answers`);

      } else {
        // Call-and-answer results format: { voteTallies: {...} }
        console.log(`💬 HOST: Processing call-and-answer results with voteTallies`);
        
        // Same placement rule as the restore path above — one definition, in
        // config/podium.js, so the two sites cannot disagree about what a
        // place is.
        formattedAnswers = resultsData.voteTallies && Object.keys(resultsData.voteTallies).length > 0
          ? assignPlacements(Object.values(resultsData.voteTallies).map(tally => ({
              player: tally.playerName,
              playerName: tally.playerName, // for displayLabelFor
              answer: tally.answerText,
              points: tally.totalScore,
              votes: tally.firstPlace + tally.secondPlace + tally.thirdPlace
            })))
          : []; // Empty array if no votes
      }
      
      setAnswers(formattedAnswers);
      console.log(`📊 HOST: Updated answers with ${formattedAnswers.length} results`);
      
      // Extract player score updates from results (already calculated by get-results API)
      const playerScoreUpdates = {};
      formattedAnswers.forEach(answer => {
        if (answer.points > 0) {
          playerScoreUpdates[answer.player] = answer.points;
        }
      });
      
      console.log('🏆 PLAYER SCORE UPDATES:', playerScoreUpdates);
      
      // Results are calculated dynamically by get-results API
      // Game state transitions will be handled by the polling mechanism
      console.log(`✅ RESULTS CALCULATED AND DISPLAYED FOR QUESTION ${questionNumber}`);
      
      // Refresh player data to show updated scores
      await fetchPlayers('after-start-question');
      
      // Reload category counts after showing results (categories may have been decremented)
      await loadCategoryCounts();
      

      // ─────────────────────────────────────────────────────────────────────
      // DO NOT reinstate `setCurrentQuestionId(questionNumber)` here.
      //
      // It stood on this line and it cost the host the "What We Heard" beat.
      // `currentQuestionId` holds the QUESTION'S OWN ID everywhere else — it
      // is looked up as `q.id` (config/instructions.js:110, reached via
      // `currentQuestionOf`), and every other writer honours that (:1247,
      // :1258, :2064). A ROUND NUMBER never matches, so from the moment
      // results opened the host instruction resolver fell through to its
      // generic default.
      //
      // Worse, it made the round's identity change without the round
      // changing. The sequence: this wrote `1`; `close-round` broadcast
      // `gameStateChanged`; `restoreGameState` rewrote `currentQuestionId` to
      // the real id (:1247); `gameState` was unchanged but that dep was not,
      // so the reset effect at :313 re-ran and forced `resultsBeat` back to
      // 'results'. A host who pressed "What We Heard" inside that socket
      // round-trip watched the beat get discarded and the button do nothing.
      //
      // It was invisible until the $connect fix (dev-v1.2.0) stopped the
      // host's CONNECTION# row being deleted out from under its open socket:
      // before that the host received no broadcasts, so nothing rewrote the
      // value and the beat stuck. Fixing the connection exposed this.
      //
      // Path-dependent, which is why it looked intermittent: it fires only
      // when the round is closed FROM THE HOST PAGE. Closed from the remote,
      // or arriving through any re-sync, `currentQuestionId` is already the
      // question id and the later restore writes the same value.
      // ─────────────────────────────────────────────────────────────────────

      // Fetch AI summary for this question if available (non-blocking)
      // This can happen in the background while results are shown
      fetchAISummary(questionNumber).catch(err => 
        console.error('Background AI summary fetch failed:', err)
      );
      
      // The backend sets the state to RESULTS#paddedQuestionId, so we need to match that format
      const paddedQuestionNumber = String(questionNumber).padStart(3, '0');
      const resultsState = `RESULTS#${paddedQuestionNumber}`;
      
      setManualStateChange(true);
      setGameState(resultsState);
      // get-results.js's enterResultsState already set AuthorsRevealed
      // unconditionally as part of this same request (Task 8) — mirror that
      // here instead of waiting for a re-sync to notice it.
      setAuthorsRevealed(true);
      // The second orphan from 72bf607c — see handleNextQuestion for the full
      // account. It threw here too, which cost the players their RESULT#nnn
      // frame: the notify block below never ran, so the room was left on the
      // voting screen until something else resynced it.
      console.log(`✅ HOST: Set game state to ${resultsState}`);
      
      // Notify players that results are ready
      if (webSocketClient.isConnected()) {
        const messageType = `RESULT#${paddedQuestionNumber}`;
        webSocketClient.sendCleanMessage(messageType, {
          questionNumber: paddedQuestionNumber,
          gameState: resultsState,
          gameType: currentGameType
        });
        console.log(`📡 HOST: Sent results notification to players: ${messageType}`);
      }
    } catch (e) {
      console.error('handleShowResults error', e);
      // Even on error, set to proper results state format
      const paddedQuestionNumber = String(lessonNumber).padStart(3, '0');
      const resultsState = `RESULTS#${paddedQuestionNumber}`;
      setGameState(resultsState);
      console.log(`⚠️ HOST: Error occurred, but still set game state to ${resultsState}`);
    } finally {
      // Hide loading overlay
      setIsLoadingData(false);
    }
  };

  // MAKING THE SERVER AGREE WITH THE HOST'S SETTING — no longer a button.
  //
  // IT USED TO BE THE "Reveal Authors" CONTROL on the ASK/VOTE stage: a
  // per-round override the host pressed to end one round's anonymity early. The
  // owner retired that shape — the decision is session-level and lives in the
  // Settings tab, with no per-round override — so this is now the MECHANISM
  // behind that setting rather than a thing a host presses. The effect below
  // calls it.
  //
  // IT IS STILL NEEDED, AND THE REASON IS THAT THE SERVER REDACTS, NOT THE
  // CLIENT. lambda-functions/game/anonymity.js strips playerName from every row
  // while the game's stored `anonymousUntilReveal` is on and the round is
  // unrevealed. A host who switches the setting to "show the names" would
  // otherwise get a stage that claims to attribute and prints "Response 1"
  // forever, because there is nothing in the payload to print. So the setting
  // reveals the round in play — which is exactly what this endpoint does, per
  // round, idempotently.
  //
  // The guard stays: an already-revealed round has nothing to fetch, and the
  // endpoint is idempotent anyway.
  //
  // authFetch, not fetch — the route carries the Cognito authorizer, because
  // any participant knows the four-digit game id and one unauthenticated POST
  // would otherwise end the whole room's anonymity.
  const handleRevealAuthors = async () => {
    if (authorsRevealed) return;
    try {
      const res = await authFetch(`${API_BASE}games/${gameId}/reveal-authors`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ questionNumber: lessonNumber })
      });
      if (!res.ok) {
        console.error('❌ HOST: reveal failed:', res.status);
        return;
      }
      const data = await res.json();
      setAnswers(data.answers || []);
      setAuthorsRevealed(true);
    } catch (e) {
      console.error('❌ HOST: reveal error', e);
    }
  };

  /**
   * THE SESSION SETTING, APPLIED TO WHATEVER ROUND IS IN PLAY.
   *
   * The host makes the call once, in the Settings tab; this is what carries it
   * into round 4 and round 5 without asking again. That is the difference
   * between a session setting and the per-round button it replaced — and it is
   * not the code deciding anything: every branch below is either "the host said
   * no" or "there is nothing to reveal".
   *
   * WHY IT CANNOT JUST TRUST THE CLIENT FLAG. `anonymousUntilReveal` is
   * editable here, but the copy the SERVER redacts from is the game's stored
   * HostPreferences, which this page does not write. Without this effect,
   * switching the setting on would attribute round 3 (whose reveal the switch
   * itself triggered) and silently stop attributing round 4.
   *
   * `answers.length` rather than a phase check: the endpoint answers with the
   * ballot, so there has to be a ballot. `handleRevealAuthors` is idempotent
   * and returns early once `authorsRevealed` is true, so this settles after one
   * call per round.
   */
  useEffect(() => {
    if (anonymousUntilReveal !== false) return;          // the host wants no names
    if (!anonymityApplies(currentGameType)) return;      // nothing authored to attribute
    if (authorsRevealed) return;                         // this round is already out
    if (!lessonNumber || answers.length === 0) return;   // nothing to reveal yet
    handleRevealAuthors();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anonymousUntilReveal, currentGameType, authorsRevealed, lessonNumber, answers.length]);

  // Refresh the Host Remote's action handles on every render so the one-time
  // window-message listener above always calls the current-state versions.
  // (Previously these were bare `nextQuestion`/`startVoting`/`showResults`
  // identifiers that never existed, so every remote advance was a silent no-op.)
  remoteActionsRef.current = {
    nextQuestion: handleNextQuestion,
    startVoting: handleFinishQuestion,
    showResults: handleShowResults,
  };

  // NOTE: there used to be a second, never-called `handleNewGame` here that
  // pre-selected the current set and cleared the event title before opening the
  // create dialog. It was orphaned when the welcome screen was added, and since
  // it reset no game state it was never the missing reset — the missing reset is
  // `leaveCurrentGame()`. Both of its behaviours survive: the set pre-selection
  // moved into handleSwitchGame below, and clearing the title is now part of
  // the central reset.

  /*
    THE LEAVE GUARD. Owner: "if this button is always around during an actual
    game, it needs a guard asking are you sure you want to leave, with the
    default no."

    The guard is on the ACT, not on any one button — the dock's Back to Menu
    (lobby and ended) and the settings panel's copy both route through here, so
    there is no unguarded door left to find. It asks only when leaving could
    surprise someone: a session with people in the room. An empty lobby, a
    CREATED session or a finished one leaves immediately — a confirmation with
    nothing at stake teaches people to click through confirmations.

    "Default no" is the FOCUS, not a checkbox: the Stay button takes focus on
    open, so Enter stays and Escape stays, and leaving requires aiming at the
    one button that leaves. Leaving is not destructive — the session stays
    live and Continue reopens it, and the dialog says so — which is why this
    is a small modal and not the type-to-confirm ceremony deletion gets.
  */
  const [confirmLeave, setConfirmLeave] = useState(false);

  const requestLeave = () => {
    const midSession = gameState !== 'CREATED' && gameState !== 'ENDED' && players.length > 0;
    if (midSession) {
      setConfirmLeave(true);
      return;
    }
    handleSwitchGame();
  };

  const handleSwitchGame = () => {
    // Leaving the game the host is watching. Every per-game value goes back to
    // its initial state HERE, before the welcome screen appears, so whichever
    // route they take next (Quick Start, create, continue, history) starts
    // clean and there is no window where the new game id renders against the
    // old game's question, phase and answers.
    //
    // Nothing is read out of the old game first. A `pendingSetId` used to be
    // captured here so the next create reopened on the set just played; the
    // owner retired that ("should not remember or preselect that last picked
    // question set"), so the reset is the whole handler.
    leaveCurrentGame();
    setShowWelcomeScreen(true);
    // Clear continue game input
    setContinueGameId('');
  };

  const handleWelcomeNewGame = async () => {
    setShowWelcomeScreen(false);
    // Fetch question sets before showing the dialog
    await fetchQuestionSets();
    setShowNewGameDialog(true);
  };

  const handleContinueGame = () => {
    const gameIdToUse = continueGameId.trim();
    if (!gameIdToUse || gameIdToUse.length !== 4) {
      alert('Please enter a valid 4-digit Game ID');
      return;
    }

    switchToGame(gameIdToUse);

    // Update URL
    const url = new URL(window.location);
    url.searchParams.set('gameId', gameIdToUse);
    window.history.replaceState(null, '', url);
    console.log(`🔗 HOST: Continuing game ${gameIdToUse}`);
  };

  const handleViewGameHistory = async () => {
    await fetchGamesList();
    setShowWelcomeScreen(false);
    setReportsModalMode('select');
    setShowReportsModal(true);
  };

  const selectGameFromHistory = (selectedGameId, selectedEventTitle) => {
    // Close the reports modal and set up the selected game
    setShowReportsModal(false);
    switchToGame(selectedGameId, { eventTitle: selectedEventTitle });

    // Update URL
    const url = new URL(window.location);
    url.searchParams.set('gameId', selectedGameId);
    url.searchParams.set('eventTitle', encodeURIComponent(selectedEventTitle));
    window.history.replaceState(null, '', url);
    console.log(`🔗 HOST: Continuing game ${selectedGameId} from history`);
  };
  
  const startGameFromHistory = async (selectedGameId, selectedEventTitle) => {
    try {
      console.log(`🚀 HOST: Starting game ${selectedGameId} from history`);
      
      // Call start-game API
      const response = await authFetch(`${API_BASE}games/${selectedGameId}/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });

      if (!response.ok) {
        throw new Error(`Failed to start game: ${response.status} ${response.statusText}`);
      }

      console.log(`✅ Game ${selectedGameId} started successfully from history`);
      
      // Close modal and go to game screen
      setShowReportsModal(false);
      switchToGame(selectedGameId, { eventTitle: selectedEventTitle || 'Engagement Session' });

      // Update URL to reflect the selected game
      const url = new URL(window.location);
      url.searchParams.set('gameId', selectedGameId);
      url.searchParams.set('eventTitle', encodeURIComponent(selectedEventTitle));
      window.history.replaceState(null, '', url);
      
    } catch (err) {
      console.error('❌ Error starting game from history:', err);
      alert(`Failed to start game: ${err.message}`);
    }
  };
  
  /*
    EDIT A SESSION BEFORE IT STARTS, from the history list. Prefill comes from
    the server, not from the row: the list rows carry no details/aiContext/
    persona, and inventing a prefill from partial data would blank fields on
    save. authFetch on both calls — GET for the host branch, PUT because the
    update route carries the Cognito authorizer.
  */
  const editGameFromHistory = async (selectedGameId) => {
    try {
      const res = await authFetch(`${API_BASE}games/${selectedGameId}?role=host`);
      if (!res.ok) throw new Error(`Failed to load session: ${res.status}`);
      const values = await res.json();
      if (values.started) {
        // The list can lag a start made from another tab; the backend would
        // refuse the PUT anyway, so say it before offering a form.
        alert('That session has already started and can no longer be edited.');
        return;
      }

      /*
        THE CATEGORIES, SO THE DIALOG CAN SHOW AND EDIT THEM. Reported: "the
        edit doesnt allow chaging the categories or even see the categories" —
        and it literally could not see them: the edit render passed no
        `categories` prop, so the grid rendered over an empty list.

        Fetched into editTarget rather than the page's shared `categories`
        state: that state belongs to the session ON STAGE, and an edit is about
        a different session — writing over it would repaint the live setup
        panel with another session's set.

        The selection is derived from the session's own HostMask bits with the
        same converter the stage restore uses, so what the dialog shows checked
        is exactly what the selector would play. A session whose masks predate
        STATE#CATS falls back to everything-enabled, which is what the selector
        does with it too.
      */
      let editCategories = [];
      try {
        // authFetch: this route now carries the Cognito authorizer.
        const catRes = await authFetch(`${API_BASE}question-sets/${values.questionSetId}/categories`);
        if (catRes.ok) editCategories = (await catRes.json()).categories || [];
      } catch (catErr) {
        console.warn('⚠️ EDIT: could not load categories for the dialog:', catErr?.message);
      }
      const selectedCategoryNames = values.categoryState
        ? convertBitmaskToCategories(values.categoryState, editCategories)
        : editCategories.map((c) => c.name);

      setEditTarget({
        gameId: selectedGameId,
        values: { ...values, selectedCategoryNames },
        categories: editCategories,
      });
    } catch (err) {
      console.error('❌ Error loading session for edit:', err);
      alert(`Failed to load session for editing: ${err.message}`);
    }
  };

  const handleSaveGameEdits = async (form) => {
    if (!editTarget) return;
    const targetId = editTarget.gameId;
    try {
      const res = await authFetch(`${API_BASE}games/${targetId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updateGameBody(form)),
      });
      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData.message || errorData.error || `${res.status}`);
      }
      console.log(`✅ HOST: Session ${targetId} updated`);
      setEditTarget(null);
      // The edited session may be the one on stage — keep the stage's own
      // title in step rather than showing the old name until the next load.
      if (targetId === gameId) setEventTitle(form.title);
      localStorage.setItem(`game_${targetId}_title`, form.title);
      // The history table reads the GAMES index row the backend just
      // mirrored onto; refetch so the list shows what actually landed.
      await fetchGamesList();
    } catch (err) {
      console.error('❌ Error saving session edits:', err);
      alert(`Failed to save changes: ${err.message}`);
    }
  };

  const copyPlayerUrl = (gameId) => {
    const playerUrl = `${window.location.origin}/player?gameId=${gameId}`;
    navigator.clipboard.writeText(playerUrl).then(() => {
      console.log('📋 Player URL copied to clipboard');
    }).catch(err => {
      console.error('❌ Failed to copy player URL:', err);
    });
  };
  

  /**
   * Create the engagement <GameSetupDialog> just described.
   *
   * `form` is the dialog's whole payload — title, format, set, the selected
   * CATEGORY IDS, details, AI context, persona, shuffle and anonymity. Taking
   * the ids in the argument is what removed this function's dependency on
   * closure timing: `leaveCurrentGame()` below clears `activeCategoryIds`, and
   * the create call used to read them back out of the pre-reset closure.
   */
  const handleStartNewGame = async (form) => {
    if (!form?.setId || !form.title?.trim()) {
      alert('Please select a question set and enter an event title.');
      return;
    }
    /*
      THE DESTRUCTIVE CLEAR THAT USED TO SIT HERE DELETED "80s 2" (issue #26).

      It read: "Clear all game data from database (always call...)" and POSTed
      /admin/clear-game/{gameId} — the id of WHATEVER SESSION WAS ON STAGE —
      before every create. CloudWatch shows it plainly: 10:17:46 "Successfully
      deleted game 9209 and all related data", 10:17:47 session "80s 3"
      created. 9209 was "80s 2". Creating a session destroyed the one the host
      was leaving.

      It was written for the one-throwaway-demo world where the page only ever
      held a single disposable session, and it survived into the world of
      durable sessions with history, reports and an Edit dialog — where "make
      a new one" must never mean "burn the old one". It also poisoned the
      history list downstream: the deleted session lingered in the stale UI,
      and starting that ghost produced the "no categories, and no questions
      left" zombie.

      Nothing replaces it. The LOCAL reset (leaveCurrentGame) already handles
      page state, and the database needs no clearing — old sessions are
      exactly what History exists to keep. Deleting a session is Delete's job,
      behind its own confirmation.
    */
    
    // Create the game first - let backend generate the gameId
    console.log(`🆕 HOST: Creating new game with backend-generated ID`);
    
    // Drop the game that was on screen. This used to be a hand-picked dozen
    // setters here, which left questions/currentQuestionId/aiSummaries/
    // customInstruction/categories behind — the "mostly new game with one stale
    // panel" failure. One list now, in config/gameSession.js.
    //
    // `eventTitle` is carried through as an override because on this path it is
    // also the create dialog's own input, which the host has just typed. The
    // categories are already in `form`, so nothing here has to be read back out
    // of a closure that this call is about to invalidate.
    leaveCurrentGame({
      eventTitle: form.title,
      currentGameType: form.gameType,
      selectedSetId: form.setId,
      // Also an override rather than a post-reset setAnonymousUntilReveal:
      // the create call below sends this same value, so seeding it here
      // means the host screen never shows the (safe-default) previous
      // game's flag for the moment before the create response returns.
      anonymousUntilReveal: createPayloadFor({
        gameType: form.gameType, anonymousResponses: form.anonymousResponses,
      }).anonymousUntilReveal,
    });
    fetchQuestionSetInstruction(form.setId, form.setScope);

    // Create the game directly with the backend API
    try {
      const createResponse = await authFetch(`${API_BASE}games`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(createGameBody(form))
      });

      if (createResponse.ok) {
        const gameData = await createResponse.json();
        console.log(`✅ HOST: Game created successfully:`, gameData);
        
        // Game created successfully - now show game history
        const newGameId = gameData.gameId;
        console.log(`✅ HOST: Game ${newGameId} created successfully - showing game history`);
        console.log(`🎯 HOST: IMPORTANT - We should now see the game history modal instead of going to game screen`);
        
        // Store event title in localStorage as backup
        localStorage.setItem(`game_${newGameId}_title`, form.title);

        // Close new game dialog
        setShowNewGameDialog(false);

        // Show game history with the new game highlighted
        await fetchGamesList();
        setReportsModalMode('select');
        setShowReportsModal(true);

        console.log(`🎯 HOST: New game created with ID ${newGameId}, set "${form.setId}", title "${form.title}" - showing in history`);
      } else {
        const errorData = await createResponse.json();
        console.error(`❌ HOST: Failed to create game:`, errorData);
        alert(`Failed to create game: ${errorData.error || 'Unknown error'}`);
        return;
      }
    } catch (error) {
      console.error('Failed to create game:', error);
      alert('Failed to create game. Please try again.');
      return;
    }
    
    console.log(`🎯 HOST: New game started with set "${form.setId}", title "${form.title}", and AI context: ${form.aiContext ? 'provided' : 'none'}`);

    // Carry the chosen voice into the live game so the in-game picker opens on
    // it. The dialog's own fields need no clearing: closing it unmounts it.
    setGamePersonaId(form.personaId || '');
    setPersonaSwitchStatus('');
  };

  const updateGameTitle = async (gameId, title) => {
    try {
      await fetch(`${API_BASE}games/${gameId}/update-title`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ eventTitle: title })
      });
      console.log(`📝 HOST: Updated game ${gameId} title to: ${title}`);
    } catch (error) {
      console.error('Error updating game title:', error);
    }
  };

  // Create and copy comprehensive meeting invite

  // authFetch, not fetch: GET /games now carries the Cognito authorizer and
  // requires the hosts or admins group, like /close-round and /reveal-authors.
  // This page sits behind ProtectedRoute so a token normally exists here, but
  // authFetch sends the request unauthenticated when the session has expired
  // (authFetch.js) — which is why the 401/403 is handled rather than falling
  // into the catch as an opaque "failed to load".
  const fetchGamesList = async () => {
    try {
      const res = await authFetch(`${API_BASE}games`);
      if (res.status === 401 || res.status === 403) {
        console.warn('GET /games refused — session expired or not a host/admin');
        setGamesList([]);
        alert('Your session has expired. Please sign in again to see your sessions.');
        return;
      }
      const data = await res.json();
      setGamesList(data.games || []);
    } catch (error) {
      console.error('Error fetching games list:', error);
      alert('Failed to load games list. Please try again.');
    }
  };

  /**
   * THE REPORT BUTTON OPENS THE REPORT.
   *
   * It used to open the games-history list, from which the host picked the
   * session they were already running and clicked Report a second time. Every
   * caller of this already knows which session it means — `gameId` is in scope
   * — so the list was a menu with the answer already on it.
   *
   * The list is not gone; it moved to where it is actually a choice. From
   * inside the report, `All session reports` reaches it (see
   * handleBrowseReportHistory), and it is still the fallback here for the one
   * case where the question is real: no session loaded, so there is no "this
   * one" to open.
   */
  const handleViewReports = async () => {
    if (gameId) {
      generateReportForGame(gameId, eventTitle);
      return;
    }
    await handleBrowseReportHistory();
  };

  /** The old behaviour, kept and reachable — just no longer the front door. */
  const handleBrowseReportHistory = async () => {
    // Order matters: the report is an early `return` above the whole page, so
    // it would swallow the modal if it were left standing.
    setShowReport(false);
    setReportStatus('idle');
    await fetchGamesList();
    setReportsModalMode('reports');
    setShowReportsModal(true);
  };


  const generateReportForGame = async (targetGameId, targetEventTitle) => {
    // Show the report SHELL first, in its loading state. `create-report` is a
    // POST that rebuilds the document server-side every time, so there is a
    // real wait here — and the two alternatives are both worse than a spinner:
    // staying on the previous screen makes the button look dead, and rendering
    // nothing until the payload lands is a blank page of unknown duration.
    setShowReportsModal(false);
    setReportTarget({ gameId: targetGameId, eventTitle: targetEventTitle });
    setReportError(null);
    setReportStatus('loading');
    setShowReport(true);
    try {
      console.log(`📊 Generating report for game ${targetGameId}...`);

      // Use the backend create-report endpoint instead of frontend logic
      const reportRes = await fetch(`${API_BASE}games/${targetGameId}/report`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        }
      });
      
      if (!reportRes.ok) {
        throw new Error(`Failed to create report: ${reportRes.status}`);
      }
      
      const reportData = await reportRes.json();
      const report = reportData.report;
      
      console.log(`📋 Retrieved ${report.detailedQuestions?.length || 0} questions with full data`);
      console.log('🔍 Report data structure:', {
        playerPerformance: report.playerPerformance?.length || 0,
        detailedQuestions: report.detailedQuestions?.length || 0,
        samplePlayer: report.playerPerformance?.[0],
        sampleQuestion: report.detailedQuestions?.[0]
      });
      
      // Debug player performance data specifically
      console.log('🎯 Backend playerPerformance data:', report.playerPerformance);
      if (report.playerPerformance) {
        report.playerPerformance.forEach((player, idx) => {
          console.log(`🎯 Backend Player ${idx + 1}: ${player.playerName} - totalScore: ${player.totalScore}`);
        });
      }
      
      // Use the report data directly from backend
      const finalEventTitle = targetEventTitle || report.gameTitle || 'Engagements Session';
      
      const gameData = {
        gameId: targetGameId,
        eventTitle: finalEventTitle,
        gameType: report.gameType, // Include gameType from the report
        // The set's round-label override. create-report.js emits it at the top
        // level; this object is rebuilt from scratch, so anything not forwarded
        // here is invisible to GameReport no matter what the backend sends.
        roundNoun: report.roundNoun,
        players: report.playerPerformance || [],
        questions: report.detailedQuestions || [],
        allAnswers: [],
        allVotes: []
      };

      // Transform the detailed questions data to match the frontend report format
      if (report.detailedQuestions && report.detailedQuestions.length > 0) {
        report.detailedQuestions.forEach(question => {
          // Add answers data
          gameData.allAnswers.push({
            questionNumber: question.questionNumber,
            answers: question.answers || []
          });
          
          // Add votes data (construct from answer rankings)
          const questionVotes = [];
          if (question.answers && question.answers.length > 0) {
            question.answers.forEach((answer, index) => {
              if (answer.totalScore > 0) {
                questionVotes.push({
                  playerName: answer.playerName,
                  answerIndex: index,
                  votes: answer.voteBreakdown || `${answer.firstPlace} first, ${answer.secondPlace} second, ${answer.thirdPlace} third`
                });
              }
            });
          }
          
          gameData.allVotes.push({
            questionNumber: question.questionNumber,
            votes: questionVotes
          });
          
          // No aiSummaries side-table. It was built here, destructured in
          // GameReport and then never read — the render uses
          // `question.aiSummary` straight off the question, which is also where
          // the persona attribution now lives.
        });
      }

      // Debug the gameData before setting it
      console.log('🎯 GameData players being passed to report:', gameData.players);
      gameData.players.forEach((player, idx) => {
        console.log(`🎯 GameData Player ${idx + 1}: ${player.playerName} - totalScore: ${player.totalScore}`);
      });

      setReportData(gameData);
      setReportStatus('ready');
      console.log('📊 Report generated successfully');
    } catch (error) {
      console.error('Error generating report:', error);
      // Not an alert(). The host is already looking at the report shell; an
      // alert dismisses to a blank one and offers no way to try again, which
      // is the bounce-to-nothing the whole change exists to remove.
      setReportError(error?.message || 'The report could not be built.');
      setReportStatus('error');
    }
  };

  const playUrl = `${window.location.protocol}//${window.location.host}/play?gameId=${gameId}`;
  // What the RAIL prints, which is a different job: the QR carries the whole
  // URL, and a room reading a bare address off a projector needs the shortest
  // thing that works. The player page takes the session code by hand.
  const joinDisplayUrl = `${window.location.host}/play`;
  // The HOST's own phone, not a player's. The stage's rail carries the player
  // join QR (see Rail's join code); this one hands the operator the remote.
  const remoteUrl = `${window.location.origin}/remote?gameId=${gameId}`;

  // State for copy confirmation messages
  const [sidebarCopyMessage, setSidebarCopyMessage] = useState(false);
  const [expandedCopyMessage, setExpandedCopyMessage] = useState(false);

  /**
   * Close the setup panel and drop what it was showing.
   *
   * `runHostAction` calls this first, and the reason is not tidiness: half the
   * panel is round-scoped — this round's actions, the remaining counts, the
   * browser's already-asked marks — and a phase change invalidates it in place.
   * Nothing is lost by closing, because every control in it commits on click.
   */
  const closeAllSidePanels = () => {
    setSetupPanelOpen(false);
    closeQuestionBrowser();
  };

  // Function to show custom confirmation modal
  const showConfirmation = (title, message, confirmText = 'Proceed') => {
    return new Promise((resolve) => {
      setConfirmModalProps({
        title,
        message,
        confirmText,
        onConfirm: () => {
          setShowConfirmModal(false);
          resolve(true);
        },
        onCancel: () => {
          setShowConfirmModal(false);
          resolve(false);
        }
      });
      setShowConfirmModal(true);
    });
  };

  // Copy URL to clipboard function
  const copyUrlToClipboard = async (url, location = 'sidebar') => {
    try {
      await navigator.clipboard.writeText(url);
      // Show appropriate copy message
      if (location === 'sidebar') {
        setSidebarCopyMessage(true);
        setTimeout(() => setSidebarCopyMessage(false), 2000);
      } else {
        setExpandedCopyMessage(true);
        setTimeout(() => setExpandedCopyMessage(false), 2000);
      }
    } catch (err) {
      // Fallback for browsers that don't support clipboard API
      const textArea = document.createElement('textarea');
      textArea.value = url;
      document.body.appendChild(textArea);
      textArea.select();
      document.execCommand('copy');
      document.body.removeChild(textArea);
      // Show appropriate copy message
      if (location === 'sidebar') {
        setSidebarCopyMessage(true);
        setTimeout(() => setSidebarCopyMessage(false), 2000);
      } else {
        setExpandedCopyMessage(true);
        setTimeout(() => setExpandedCopyMessage(false), 2000);
      }
    }
  };

  /**
   * AUTO-MODE'S ONE TIMER.
   *
   * config/autoMode.js decides WHAT a patient host would do next and after how
   * long; this effect is the only thing that DOES it. One decision, one
   * setTimeout, cleared whenever any input changes — so a late answer, a page
   * turn, or the host acting first simply restarts the clock rather than
   * racing it.
   *
   * IT LIVES ABOVE THE EARLY RETURNS AND MUST STAY THERE (hookDepOrder.test.js
   * fails the build otherwise), which is why it recomputes the phase and the
   * page arithmetic from raw state instead of reading `hostPhase` /
   * `stagePageIndex` — those are derived below the returns. The ACTIONS are
   * also derived down there, so they arrive through `autoActRef`, assigned by
   * the same render that draws the stage: whatever the timer fires against is
   * exactly what the host is looking at.
   *
   * Two layers of "the host has implicitly pressed pause":
   *   - the full-screen surfaces that replace the stage entirely (welcome,
   *     quickstart, dialogs, the report) — while one is up, the ref is stale
   *     and the room cannot see the stage, so nothing may move it;
   *   - `shortcutsSuppressed`, the same gate the SPACE key obeys, so a pinned
   *     QR or an open spotlight holds auto-mode exactly as it holds the
   *     keyboard.
   */
  useEffect(() => {
    if (!autoMode) return undefined;
    if (showQuickstartMenu || showWelcomeScreen || showNewGameDialog
        || showReport || showReportsModal || editTarget) return undefined;
    if (shortcutsSuppressed({
      showConfirmModal, showExpandedQR, showReportsModal,
      lessonExpanded, isLoadingData, qrMode,
      spotlightOpen: spotlightIndex !== null,
      pastRoundOpen: pastRoundIndex !== null,
    })) return undefined;

    const roundPhase = phaseOfGameState(gameState);
    const phase = gameState === 'ENDED'
      ? 'ENDED'
      : (roundPhase === 'RESULTS' && resultsBeat === 'field-notes' ? 'FIELD_NOTES' : roundPhase);

    // The stage's own page arithmetic, re-derived the way the render derives
    // it: the shared index keyed by phase#round, cut by the same slicers.
    const pageKey = `${phase}#${lessonNumber}`;
    const rawIndex = stagePage && stagePage.key === pageKey ? stagePage.index : 0;
    let page = 0;
    let pages = 1;
    let pageText = '';
    let notesReady = false;
    if (phase === 'RESULTS') {
      const slice = pageSlice(answers, rawIndex, pageSizeFor(profile));
      page = slice.page;
      pages = slice.pages;
    } else if (phase === 'FIELD_NOTES') {
      const md = currentAIInsights && currentAIInsights.markdownResponse;
      notesReady = Boolean(md) && !loadingAIInsights;
      if (notesReady) {
        const slice = prosePageSlice(md, rawIndex, proseBudgetFor(profile));
        page = slice.page;
        pages = slice.pages;
        pageText = slice.content;
      }
    }

    const decision = autoDecision({
      enabled: true,
      phase,
      playerCount: players.length,
      answeredCount,
      votedCount: playersWhoVoted.length,
      page, pages, pageText, notesReady,
    });
    if (!decision) return undefined;

    const timer = setTimeout(() => {
      const hands = autoActRef.current;
      if (!hands) return;
      if (decision.kind === 'page') {
        hands.turnTo(page + 1);
        return;
      }
      // The dock's own primary, through the dock's own runner — disabled means
      // disabled for auto-mode too (e.g. RESULTS with zero answers).
      if (!hands.primary || hands.primary.disabled) return;
      hands.run(hands.primary);
    }, decision.delayMs);
    return () => clearTimeout(timer);
  }, [autoMode, gameState, resultsBeat, lessonNumber, stagePage, answers,
    currentAIInsights, loadingAIInsights, profile, players.length, answeredCount,
    playersWhoVoted.length, showQuickstartMenu, showWelcomeScreen,
    showNewGameDialog, showReport, showReportsModal, editTarget,
    showConfirmModal, showExpandedQR, lessonExpanded, isLoadingData, qrMode,
    spotlightIndex, pastRoundIndex]);

  // Render the quickstart menu if it's being shown
  if (showQuickstartMenu) {
    return (
      <QuickstartMenu
        onGameCreated={(gameData) => {
          setShowQuickstartMenu(false);
          // switchToGame clears every per-game value in the same React batch as
          // the new gameId, so the quickstart game can never be drawn over the
          // previous session's question/phase/answers. The [gameId] effect then
          // restores the new game from the server onto a clean slate.
          switchToGame(gameData.gameId, {
            eventTitle: gameData.eventTitle,
            currentGameType: gameData.gameType || 'call-and-answer',
            selectedSetId: gameData.questionSetId || '',
          });
        }}
        onClose={() => setShowQuickstartMenu(false)}
      />
    );
  }

  // Render the welcome screen if no game is selected.
  //
  // The surface itself is <WelcomeScreen> — extracted, like GameSetupDialog
  // and SessionSetupPanel before it, because this file cannot be mounted in
  // jsdom at all and an inline surface here is an untestable one.
  //
  // The heading used to read `currentGameType === 'trivia' ? 'Trivia' : ...`.
  // It was always the second branch: nothing ever sets showWelcomeScreen back
  // to true, so currentGameType is still its initial 'call-and-answer' every
  // time this renders. The dead ternary went with the markup.
  if (showWelcomeScreen) {
    return (
      <>
        <WelcomeScreen
          currentUser={currentUser}
          continueGameId={continueGameId}
          onContinueGameIdChange={setContinueGameId}
          onContinue={handleContinueGame}
          onQuickStart={() => setShowQuickstartMenu(true)}
          onCreateEngagement={handleWelcomeNewGame}
          onViewHistory={handleViewGameHistory}
          onQuestionSets={() => setShowHostSets(true)}
          onSignOut={handleSignOut}
        />
        {/* A SIBLING OF THE SCREEN, NOT A CHILD. `.wel-page` is
            `position: fixed; inset: 0` with its own `data-theme="dark"`, so a
            dialog nested inside it would inherit the dusk tokens under
            `.qsets--onlight`'s white card and scroll with the page behind it.
            The scrim is fixed and z-index 10001, which is above everything the
            welcome screen paints, so a sibling lands exactly where it should.

            NO `onSetsChanged`. That prop exists so the create screen's picker
            can offer a set the moment it is made; here there is no picker on
            screen, and the page re-reads `questionSets` when the create dialog
            opens. */}
        {showHostSets && (
          <HostQuestionSetsDialog onClose={() => setShowHostSets(false)} />
        )}
      </>
    );
  }

  // Render the report if it's being shown.
  //
  // `showReport` alone, deliberately — NOT `showReport && reportData`. The
  // report is fetched, so there is a window in which the host has asked for it
  // and the payload has not landed; the old condition fell through that window
  // to the stage behind, so the button read as broken. GameReport owns the
  // wait now, via `status`.
  if (showReport) {
    return (
      <GameReport
        reportData={reportData}
        status={reportStatus}
        error={reportError}
        onClose={() => { setShowReport(false); setReportStatus('idle'); }}
        onRetry={reportTarget
          ? () => generateReportForGame(reportTarget.gameId, reportTarget.eventTitle)
          : null}
        onBrowseAll={handleBrowseReportHistory}
      />
    );
  }


  /*
    THE EDIT DIALOG — the same <GameSetupDialog>, pointed at an existing
    unstarted session. BEFORE the history branch below, because both are early
    returns and Edit is pressed from inside the history modal: this branch
    winning is what puts the form on screen, and clearing `editTarget` is what
    puts the history list back. The dialog stays pure-props: the prefill was
    fetched by editGameFromHistory and travels in as `initialValues`.
  */
  if (editTarget) {
    return (
      <GameSetupDialog
        mode="edit"
        initialValues={editTarget.values}
        questionSets={questionSets}
        personas={personas}
        categories={editTarget.categories || []}
        onFormatChange={handleSetupFormatChange}
        onCancel={() => setEditTarget(null)}
        onCreate={handleSaveGameEdits}
      />
    );
  }

  // Render the game history modal if it's being shown
  if (showReportsModal) {
    /*
      THE SESSION HISTORY. Extracted to components/SessionHistoryPanel.jsx —
      170 lines of card markup used to live here, one card per session with a
      title, a status badge and a four-item label/value grid. Forty sessions was
      forty stacked blocks of chrome, which is the wall RATIONALE §4 rejects and
      the argument the console already settled for question sets.

      The panel is presentational: it fetches nothing and every action below is
      a prop, which is what makes it mountable in jsdom instead of only
      reachable through this 5,000-line file.

      ONE BEHAVIOUR CHANGE, AND IT IS THE POINT. Owner: *"i cant edit the
      session without starting it today."* The card had ONE primary button that
      forked on `game.started` — an unstarted session's only door went through
      `startGameFromHistory`, which POSTs /start and lets players in. So a
      session could not be set up before the room arrived.

      `selectGameFromHistory` already loads a session without starting it and
      always did; it was simply never offered for an unstarted one. It is
      `onOpen` here, for both states — Open for a session that has not started,
      Continue for one that has. Starting is now its own separate control.
    */
    return (
      <div className="new-game-overlay">
        <div className="new-game-dialog reports-modal">
          <SessionHistoryPanel
            sessions={gamesList}
            currentGameId={gameId}
            mode={reportsModalMode}
            questionSets={questionSets}
            onCopyPlayerUrl={copyPlayerUrl}
            onInvite={(session) => setInviteTarget({
              gameId: session.gameId,
              title: session.title || session.eventTitle,
              gameType: session.gameType,
              setName: (questionSets.find((set) => set.id === session.questionSetId) || {}).name
                || session.questionSetId,
              /* null, not [] — a history row carries no category data, and []
                 would print "All categories" onto an invite nobody checked. */
              categories: null,
              createdAt: session.createdAt,
            })}
            onReport={generateReportForGame}
            onOpen={selectGameFromHistory}
            onStart={startGameFromHistory}
            onEdit={editGameFromHistory}
            onClose={() => {
              setShowReportsModal(false);
              if (reportsModalMode === 'select' && isLobbyState(gameState) && lessonNumber === 0) {
                setShowWelcomeScreen(true);
              }
            }}
          />
        </div>
        {/*
          MOUNTED HERE TOO, AND THAT IS NOT A DUPLICATE. This branch is an early
          `return`, so anything rendered in the main tree below is unreachable
          from session history — a single mount there would leave the history
          list's Invite button pressing nothing at all.
        */}
        <InviteDialog target={inviteTarget} onClose={() => setInviteTarget(null)} />
      </div>
    );
  }

  // THE CREATE SCREEN. Extracted to components/GameSetupDialog.jsx: it owns
  // the form and nothing else, and hands back one payload — including the
  // selected category ids, which is what freed handleStartNewGame from reading
  // them out of a closure leaveCurrentGame() had already invalidated.
  if (showNewGameDialog) {
    return (
      <GameSetupDialog
        isFirstEngagement={isLobbyState(gameState) && lessonNumber === 0}
        eventTitle={eventTitle}
        onEventTitleChange={setEventTitle}
        questionSets={questionSets}
        personas={personas}
        categories={categories}
        activeCategoryIds={activeCategoryIds}
        onToggleCategory={toggleCategoryActive}
        onFormatChange={handleSetupFormatChange}
        onQuestionSetChange={handleSetupSetChange}
        onCancel={() => {
          setShowNewGameDialog(false);
          if (isLobbyState(gameState) && lessonNumber === 0) {
            setShowWelcomeScreen(true);
          }
        }}
        onCreate={handleStartNewGame}
      />
    );
  }

  // ---------------------------------------------------------------------
  // The single advance control.
  //
  // Every phase used to render its own button at the bottom of its own
  // content, which is how "Next Question" ended up ~2800px down the document
  // on a 1280×800 laptop. config/hostControls.js now decides which one action
  // is available, and <HostActionBar> is the only thing that draws it.
  // ---------------------------------------------------------------------
  //
  // Two phases exist that the raw game state cannot express. FIELD_NOTES is a
  // second beat inside RESULTS, held on the client. ENDED is a session state
  // the backend does set, but `phaseOfGameState` maps anything that is not an
  // ASK#/VOTE#/RESULTS# marker onto the lobby — deliberately, since that is
  // the rule the rest of the page uses — so it is named here rather than by
  // widening that function and changing what every other caller sees.
  const roundPhase = phaseOfGameState(gameState);
  const hostPhase = gameState === 'ENDED'
    ? 'ENDED'
    : (roundPhase === 'RESULTS' && resultsBeat === 'field-notes' ? 'FIELD_NOTES' : roundPhase);

  /*
    WHERE THE READ-BACK IS, for the dock. On FIELD_NOTES the primary is a page
    turn until the last page is up (config/hostControls.js carries the
    argument), so the dock needs the same page arithmetic the stage itself
    uses — the shared beat-keyed index, cut by the same slicers, covering both
    of Workie's shapes. One page (or nothing yet) leaves the classic Next
    Round primary untouched.
  */
  const notesIndexRaw = stagePage && stagePage.key === `FIELD_NOTES#${lessonNumber}`
    ? stagePage.index : 0;
  let notesPages = 1;
  if (currentAIInsights && currentAIInsights.markdownResponse) {
    notesPages = prosePageSlice(
      currentAIInsights.markdownResponse, notesIndexRaw, proseBudgetFor(profile),
    ).pages;
  } else if (currentAIInsights) {
    const notePoints = (currentAIInsights.discussionTopics || []).length
      + (currentAIInsights.nextSteps || []).length;
    notesPages = pageCount(notePoints, pageSizeFor(profile));
  }
  const notesPage = clampPage(notesIndexRaw, notesPages);

  const hostControls = hostControlsFor({
    gameType: currentGameType,
    phase: hostPhase,
    roundNoun: getHostRoundNoun(),
    playerCount: players.length,
    answeredCount,
    votedCount: playersWhoVoted.length,
    answerCount: answers.length,
    hasQuestionSet: Boolean(selectedSetId),
    notesPage,
    notesPages,
  });

  // A keyboard shortcut must never fire underneath something the host is
  // reading or filling in.
  // The rule itself lives in utils/hostOverlays.js, where a test can reach it:
  // a PREVIEW must leave SPACE live, only a PINNED QR gates it.
  //
  // THE SETUP PANEL AND ITS QUESTION BROWSER ARE ABSENT ON PURPOSE. Both used
  // to belong here, when the browser was a full-screen scrim over the dock.
  // The panel stops at the top of the dock, so the primary button and its
  // SPACE chip stay visible and live underneath it — and the chip renders
  // exactly when this value is false, so suppressing here would make the host
  // watch the affordance blink out while looking at a working button. The
  // hazard that IS real is narrower: SPACE landing on a focused button inside
  // the panel. HostActionBar handles that by event target, not by geometry.
  /*
    `spotlightOpen` / `pastRoundOpen` — see the argument in utils/hostOverlays.js.

    Both dialogs step between answers with ArrowLeft/ArrowRight on `document`
    and neither stops propagation, so without these two terms the SAME
    keystroke also reached HostActionBar's window listener and advanced the
    live round out from under the host who was reading an answer aloud.

    Derived from the index state rather than a separate boolean, so the flag
    cannot drift from what is actually mounted: both dialogs render on
    `index !== null` and nothing else.
  */
  const anyOverlayOpen = shortcutsSuppressed({
    showConfirmModal, showExpandedQR,
    showReportsModal, lessonExpanded, isLoadingData, qrMode,
    spotlightOpen: spotlightIndex !== null,
    pastRoundOpen: pastRoundIndex !== null,
  });

  const runHostAction = (action) => {
    if (!action) return;
    // A page turn is a content move, not a round advance — it must not close
    // the panel the host is reading beside, nor unpin anything.
    if (action.intent !== HOST_INTENTS.PAGE) {
      // Advancing clears the room-facing chrome: the Game Info / How to Play
      // rails are inspection surfaces, not part of the round.
      closeAllSidePanels();
      // A pinned QR is chrome too -- advancing the round clears it the same way.
      setQrMode(null);
    }
    switch (action.intent) {
      case HOST_INTENTS.PAGE:
        // The dock's Next Page — the same shared beat-keyed index the ↑↓ keys
        // and the pips move, so the three routes cannot disagree.
        setStagePageIndex(stagePageIndex + 1);
        break;
      case HOST_INTENTS.START:
      case HOST_INTENTS.NEXT:
        handleNextQuestion(false);
        break;
      case HOST_INTENTS.SKIP:
        handleNextQuestion(true);
        break;
      case HOST_INTENTS.FINISH:
        handleFinishQuestion();
        break;
      case HOST_INTENTS.REVEAL:
        handleShowResults();
        break;
      case HOST_INTENTS.FIELD_NOTES:
        // The round does not move; the stage does. Local first so the stage
        // does not wait on a round trip, then published to /stage-beat so the
        // phone follows — that is what makes the two devices one control.
        setResultsBeat('field-notes');
        publishStageBeat('field-notes');
        break;
      case HOST_INTENTS.REPORT:
        // generateReportForGame, not setShowFinalReport: `showFinalReport` is
        // a flag nothing renders (it only gates the keyboard shortcut), so
        // pointing ENDED's primary at it would have made the one control on
        // the last screen of the session do nothing at all.
        generateReportForGame(gameId, eventTitle);
        break;
      case HOST_INTENTS.LEAVE:
        /*
          The same handler the settings panel's own control uses, deliberately.
          Leaving is one behaviour and it resets a long list of per-game state;
          a second implementation here would be a second chance to miss one of
          them, and the symptom would be the next session rendering against the
          last one's question.

          IT DOES NOT END THE SESSION — `leaveCurrentGame` is a local reset and
          the session stays live and rejoinable through Continue. That is why
          the label is Back to Menu rather than Exit: see the note on the
          settings panel's copy of this button.
        */
        requestLeave();
        break;
      default:
        console.warn(`Unknown host action intent: ${action.intent}`);
    }
  };

  // ---------------------------------------------------------------------
  // THE STAGE
  //
  // The rails no longer reserve a gutter. The stage is `height:100dvh` and it
  // is the whole viewport; Game Info and How to Play are fixed inspection
  // panels the host opens over it and that advancing closes again. Reserving
  // space for them would shrink the fixed-height stage every time one opened,
  // which is the fastest possible way to make a state stop fitting.
  // ---------------------------------------------------------------------

  const currentQuestion = questions[0] || null;
  const roundOf = questionSets.find(
    (s) => s.id === (currentQuestion?.setId || selectedSetId)
  )?.totalQuestions;

  // The phase BAR speaks in hues and knows five of them; the phase CHIP names
  // the state. FIELD_NOTES stays inside RESULTS' green — it is the same beat
  // of the round — and is distinguished by its word, not its colour.
  const BAR_PHASE = {
    LOBBY: 'lobby', ASK: 'ask', VOTE: 'vote',
    RESULTS: 'results', FIELD_NOTES: 'results', ENDED: 'done',
  };

  /**
   * The ONE progress count, and the only place it is stated.
   *
   * `hostControls.status.text` says the same thing in numerals ("31 of 40
   * answered…"), so it is deliberately NOT passed to the dock while the meter
   * is up — never state the same fact twice in one viewport. The dock gets a
   * sentence instead, which is what the mockups carry.
   */
  const meter = (() => {
    if (hostPhase === 'LOBBY') {
      return players.length
        ? { heading: 'In the room', body: String(players.length) }
        : null;
    }
    if (hostPhase === 'ASK') {
      return {
        heading: 'Answered',
        body: <>{answeredCount}<small>{` / ${players.length}`}</small></>,
      };
    }
    if (hostPhase === 'VOTE') {
      return {
        heading: 'Voted',
        body: <>{playersWhoVoted.length}<small>{` / ${players.length}`}</small></>,
      };
    }
    // RESULTS, FIELD_NOTES and ENDED run solo. The mockup's standings column
    // is a list of names WITH A SCORE BESIDE EACH, which is the half of the
    // old rule that did not get retired — see RoomMeter.jsx's doc-block and
    // standingsVisible().
    return null;
  })();

  /**
   * WHO THE METER MAY NAME — and it is a DIFFERENT SET IN THE LOBBY.
   *
   * TWO GATES, NOT ONE, because the two phases are answering two different
   * questions and the polarity is the whole decision:
   *
   *   - LOBBY → `joinedRoster`: who HAS joined. The owner asked for this
   *     directly — *"the lobby list is great, so we know who has joined, and
   *     for small groups easily see who is missing"* — and it is the inverse of
   *     the list the round phases print. RoomMeter labels it "Already joined"
   *     and stamps `data-list-kind="joined"` so the two can never be confused
   *     for one another on the wall.
   *   - ASK / VOTE → `waitingRoster`: who has NOT responded, subject to the
   *     host's own setting, because naming the waiters hands the room the
   *     answerer set by subtraction. That judgement is written out in
   *     config/anonymity.js, which is why this is a function call rather than
   *     four inline conditions. It used to be an automatic block below five
   *     responses; it is now `nameWaitingWhenAnonymous`, and the argument for
   *     the old number ships as copy in the Settings tab instead.
   *
   * THE LOBBY IS NOT ROUTED THROUGH THE ANSWER-COUNT THRESHOLD, deliberately.
   * `anonymityActive` is about authorship of ANSWERS; joining is not a
   * response, no round has opened, and `answers` is empty there — so the
   * threshold would compare against a constant zero and suppress the list
   * forever on exactly the anonymous formats the owner was looking at. The
   * argument in full is in `joinedRoster`'s doc-block, next to the code it
   * justifies.
   *
   * `null` from either means "do not offer the reveal at all".
   *
   * `authorsRevealed` is the SERVER flag — whether this round's names are out.
   * `anonymousUntilReveal` is the session setting. Both are needed: the first
   * says there is nothing left to protect on this round, the second says this
   * session never protected anything.
   */
  const revealNames = (() => {
    if (hostPhase === 'LOBBY') return joinedRoster({ players });
    if (hostPhase === 'ASK' || hostPhase === 'VOTE') {
      return waitingRoster({
        players,
        responded: hostPhase === 'VOTE' ? playersWhoVoted : playersWhoAnswered,
        respondedCount: hostPhase === 'VOTE' ? playersWhoVoted.length : answeredCount,
        answerCount: answers.length,
        gameType: currentGameType,
        anonymousUntilReveal,
        authorsRevealed,
        nameWaitingWhenAnonymous,
      });
    }
    return null;
  })();

  /**
   * The reveal's three handlers, Rail's QR trigger copied one for one — with
   * the two documented differences (RoomMeter.jsx): a click TOGGLES, because
   * there is no overlay to click away and a touchscreen has no Escape key;
   * and nothing here feeds `shortcutsSuppressed`, because the list covers
   * nothing.
   *
   * SCOPED TO THE ROUND IT WAS OPENED IN. `rosterMode` carries the phase and
   * round it belongs to, so a pinned list cannot ride into the next beat and
   * put names on the wall that nobody asked for — which would break the one
   * property that makes naming the waiting acceptable at all.
   */
  const rosterKey = `${hostPhase}#${lessonNumber}`;
  const rosterReveal = rosterMode && rosterMode.key === rosterKey ? rosterMode.mode : null;
  const rosterHandlers = {
    onPreview: () => setRosterMode((m) => (m && m.key === rosterKey && m.mode === 'pinned'
      ? m : { key: rosterKey, mode: 'preview' })),
    onPreviewEnd: () => setRosterMode((m) => (m && m.key === rosterKey && m.mode === 'pinned'
      ? m : null)),
    onPin: () => setRosterMode((m) => (m && m.key === rosterKey && m.mode === 'pinned'
      ? null : { key: rosterKey, mode: 'pinned' })),
  };
  /* null, not an empty object: RoomMeter renders the plain, non-interactive
     count unless it is handed both names and handlers, so a gated round — or
     a round everybody is already in — offers no affordance at all rather than
     a control that opens an empty list. */
  const meterWaiting = revealNames && revealNames.length
    ? { names: revealNames, mode: rosterReveal, ...rosterHandlers }
    : null;

  /**
   * THE ANSWER LIST, CUT INTO PAGES THE STAGE CAN ACTUALLY HOLD.
   *
   * The owner's report: *"when there are more answers than fit on the screen,
   * we dont provide a way to scroll/arrow through the answers. on a tv or
   * projector view these can even get cut off."* The fitter cannot fix that —
   * it shrinks to `--fit` and stops at the profile floor, and 07-results-trivia
   * is already AT the floor with `data-clamped="on"` at 1280x720 on real
   * content. Past the floor every lever removes content silently.
   *
   * The budget is per profile and DECLARED rather than measured; the reasoning
   * (a measured size moves under the host's eye, and jsdom cannot test a
   * measurement) is in config/stagePaging.js beside the numbers.
   *
   * `answerPage.offset` IS NOT A CONVENIENCE. Every anonymous response is labelled
   * positionally — `displayLabelFor(answer, index)` renders
   * `Response ${index + 1}` and PlayerPage renders the same label from the same
   * index on every phone in the room. Mapping a page with a fresh counter would
   * label page two's first card "Response 1" on the projector while twelve
   * phones called it "Response 4".
   */
  const stagePageSize = pageSizeFor(profile);
  const pageKey = `${hostPhase}#${lessonNumber}`;
  /* ONE INDEX FOR THE WHOLE STAGE, because the states that page are mutually
     exclusive and the key already carries the phase. FIELD_NOTES pages prose
     rather than answers (components/AISummaryStatus.jsx), and giving it a
     second piece of state would be a second reset to keep in step with this
     one — for a beat that can never be live at the same time. It reads 0 on
     arrival for free: `hostPhase` is part of the key, so entering FIELD_NOTES
     changes the key and the index is not carried over from RESULTS.

     BOTH GO IN `fitKey`. `answerPage.page` is clamped against `answers.length`,
     which on FIELD_NOTES is a single page — so it reads 0 however far the host
     has paged into the summary. Without the raw index beside it the fitter
     never re-runs on a notes page turn, and page 2 is drawn at the scale chosen
     for page 1. */
  const stagePageIndex = stagePage && stagePage.key === pageKey ? stagePage.index : 0;
  const setStagePageIndex = (index) => setStagePage({ key: pageKey, index });
  const answerPage = pageSlice(answers, stagePageIndex, stagePageSize);

  // AUTO-MODE'S HANDS — see the effect above the early returns. Assigned by
  // the same render that draws the stage, so when the timer fires it presses
  // exactly the primary the dock is showing, through the same runner, and
  // turns the same shared page index the arrow keys turn.
  autoActRef.current = {
    primary: hostControls.primary,
    run: runHostAction,
    turnTo: setStagePageIndex,
  };

  /*
    Closing returns the grid to the page holding whatever was reached, so a host
    who pages forward inside the dialog and then closes is not dropped back
    behind where they got to.

    A PLAIN FUNCTION, AND IT MAY LIVE DOWN HERE — it needs `stagePageSize` and
    `setStagePageIndex`, which are declared just above, and it runs from a
    click. `spotlightIndex` itself is a HOOK and had to move to the top; see
    its declaration for what that cost.
  */
  const closeSpotlight = () => {
    if (spotlightIndex !== null) setStagePageIndex(pageOf(spotlightIndex, stagePageSize));
    setSpotlightIndex(null);
    // …and tell the phone. See publishFocus: without this the remote keeps
    // offering "Close" for a spotlight the projector has already shut.
    publishFocus({ focus: 'none' });
  };

  /*
    ONE OPENER FOR ALL THREE WAYS IN — the card's click, the card's Enter/Space,
    and the spotlight's own next/previous arrows. They were three bare
    `setSpotlightIndex` calls, and three call sites is three chances for one of
    them to forget to announce itself. `sameFocus` keeps the arrows from posting
    when they land back where they already were.
  */
  const openSpotlight = (idx) => {
    setSpotlightIndex(idx);
    if (!sameFocus({ focus: 'answer', index: idx }, { focus: 'answer', index: spotlightIndex })) {
      publishFocus({ focus: 'answer', index: idx });
    }
  };

  /* The question, blown up for the room. Same deal as openSpotlight. */
  const expandQuestion = () => {
    setLessonExpanded(true);
    publishFocus({ focus: 'question' });
  };

  const collapseQuestion = () => {
    setLessonExpanded(false);
    publishFocus({ focus: 'none' });
  };

  /**
   * WHAT THE ROOM IS LOOKING AT CLOSELY, ANNOUNCED.
   *
   * `lessonExpanded` and `spotlightIndex` were client-only state on this page,
   * so the phone could neither drive them nor see them. `POST /stage-focus`
   * makes the focus a durable per-round fact and broadcasts it, exactly as
   * `stage-beat` did for the RESULTS beat — read that handler's header for the
   * full argument.
   *
   * BIDIRECTIONAL, hence this function. Tap it on the projector and the phone
   * follows; tap it on the phone and the projector follows. Both surfaces then
   * read one source of truth instead of two that drift.
   *
   * NO LOOP. The frame this produces comes back to `stageFocusChanged` below,
   * which only ever SETS state — it never re-publishes. That asymmetry is what
   * keeps the two directions from feeding each other.
   *
   * Silent on failure, deliberately. The overlay the host asked for is already
   * open in front of them; an alert saying the announcement failed would be a
   * modal about a thing that visibly worked, and the next tap or the next poll
   * repairs the other surface anyway.
   *
   * A PLAIN FUNCTION, NOT A useCallback, and that is forced rather than
   * stylistic: this sits BELOW an early return, and a hook after a conditional
   * return breaks the rule that every render must call the same hooks in the
   * same order. `closeSpotlight` immediately above carries the same note for
   * the same reason. It runs from a click and memoising it buys nothing.
   */
  const publishFocus = (focus) => {
    const body = focusRequest({ ...focus, state: gameStateRef.current });
    // No round on screen — nothing can be focused, so there is nothing to say.
    if (!body) return;

    authFetch(`${API_BASE}games/${gameId}/stage-focus`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }).catch((error) => {
      console.warn('⚠️ STAGE FOCUS: the room was not told:', error?.message);
    });
  };

  /**
   * Why the primary is greyed out, and the key that fires it when it is not.
   *
   * HostActionBar renders both itself and then hides both in big-screen mode —
   * the mode the dock always passes — so without these two the host sees a
   * disabled button with no reason and a keyboard shortcut with no sign it
   * exists, in all four profiles. The dock's own `.kbd` / `.hint` slots exist
   * for exactly this and were, until now, never passed anything.
   *
   * LOBBY is excluded because there the dock's STATUS is already the
   * explanation (see below), and because the lobby hint names a panel, which
   * the stage does not print.
   */
  // With nobody in the room yet, `hostControls.primary.hint` reads "Nobody
  // has answered yet" — true of an empty ASK, but the wrong reason: nobody
  // has JOINED. Dropping the hint here lets dockStatus below fall through to
  // statusTextFor's "Waiting for players to join…", which is already keyed
  // off playerCount === 0 for this exact case.
  const dockHint = hostControls.primary.disabled && hostPhase !== 'LOBBY' && players.length > 0
    ? hostControls.primary.hint
    : '';
  const dockKbd = !hostControls.primary.disabled && !anyOverlayOpen ? 'SPACE' : '';

  /**
   * The dock's room-facing sentence. Qualitative where the meter is already
   * quantitative, copied from the mockups rather than invented.
   *
   * It stands down when the hint is up. On ASK with nobody answered yet the
   * two said the same thing twice in one viewport — "Some are still answering"
   * beside "Nobody has answered yet" — and of the pair the hint is the one
   * that also explains the greyed-out button.
   */
  const everybodyIn = roomIsComplete({
    phase: hostPhase,
    responded: hostPhase === 'VOTE' ? playersWhoVoted.length : answeredCount,
    playerCount: players.length,
  });
  const dockStatus = dockHint
    ? ''
    : (hostPhase === 'ASK' || hostPhase === 'VOTE') && players.length > 0
      ? (everybodyIn
          ? 'Safe to move on'
          : `Some are still ${hostPhase === 'ASK' ? 'answering' : 'voting'}`)
      // In the lobby the meter is already showing the count, so the dock says
      // whether the host may go — not the same number a second time. When the
      // primary is disabled the config's copy IS the explanation, so it stands.
      : (hostPhase === 'LOBBY' && !hostControls.primary.disabled)
        ? 'Ready when you are'
        : hostControls.status.text;

  // Wavelength's two-beat reveal: beat one is a sentence, beat two a terms
  // flow of a different height, and the clustered upgrade can change the flow
  // again — three renders the fitter must re-measure. Derived here rather than
  // inline in fitKey so the <Stage> element stays small enough to read (and to
  // fit stageShell.test.jsx's composition window).
  const wavelengthFitKey = wavelengthAnalysis
    ? `${wavelengthAnalysis.matching}:${wavelengthAnalysis.clustering}:${wavelengthAnalysis.totalUniqueWords}`
    : '';

  return (
    <>
    {/* No `rail-right-*` / `rail-left` classes any more: those reserved a
        300–600px gutter for whichever panel was open, and the stage is a
        fixed-height grid — shrinking it every time the host opened Game Info
        is the fastest possible way to make a state stop fitting. The one
        remaining panel is fixed and overlays; advancing closes it. */}
    <div className="main-layout">

      {/* ------------------------------------------------------------------
          THE STAGE — one layout, four profiles, fixed height, never scrolls.

          This replaces BOTH of the layouts that used to live here: the
          standard document (a 250px decorative hero, a player roster, then the
          state) and the projector layout (a second, parallel set of headers
          and QR blocks inside the same JSX). Two modes is what produced two
          ASK headers and two QR blocks, and the mode reset on every reload, so
          it failed silently in front of a room. There is no third mode: what
          used to be the projector toggle is now the Room profile, and it
          survives a reload.

          Everything the ROOM sees is inside <Stage>. Everything only the HOST
          needs — Game Info, How to Play, the question browser, the report —
          is a fixed panel over it, opened deliberately and closed by
          advancing.
          ------------------------------------------------------------------ */}
      <Stage
        profile={profile}
        phase={BAR_PHASE[hostPhase] || 'lobby'}
        /* The fitter's deps live in Stage but the content that changes lives
           here. Without this a question arriving, an answer list growing or a
           reveal flipping would re-render the stage and never re-measure it. */
        fitKey={[
          hostPhase, currentQuestionId, questions.length, answers.length,
          players.length, playersWhoAnswered.length, playersWhoVoted.length,
          authorsRevealed, anonymousUntilReveal,
          // The reveal changes the meter's height and the fitter measures the
          // meter (`.rail, .meter`); without this it would never re-measure.
          rosterReveal || '', revealNames ? revealNames.length : -1,
          // A page turn replaces every card in the list without changing any
          // of the counts above it, so without this the fitter would keep the
          // scale it found for the previous page's content.
          answerPage.page, stagePageSize,
          // FIELD_NOTES' own page: answerPage.page clamps to 0 there.
          stagePageIndex,
          loadingAIInsights, currentAIInsights ? 1 : 0,
          wavelengthFitKey,
        ].join('|')}
        rail={(
          <Rail
            phase={hostPhase}
            title={eventTitle || 'Engagements'}
            context={{
              category: currentQuestion?.field || currentQuestion?.category || undefined,
              noun: getHostRoundNoun(),
              round: (hostPhase === 'LOBBY' || hostPhase === 'ENDED') ? undefined : lessonNumber,
              of: (hostPhase === 'LOBBY' || hostPhase === 'ENDED') ? undefined : roundOf,
            }}
            join={gameId
              ? (hostPhase === 'ENDED'
                ? { code: gameId, closed: true }
                : {
                    url: joinDisplayUrl,
                    code: gameId,
                    onPreview: () => setQrMode((mode) => (mode === 'pinned' ? mode : 'preview')),
                    onPreviewEnd: () => setQrMode((mode) => (mode === 'pinned' ? mode : null)),
                    onPin: () => setQrMode('pinned'),
                  })
              : {}}
          />
        )}
        meter={meter
          ? (
            <RoomMeter
              phase={hostPhase} heading={meter.heading} body={meter.body}
              complete={everybodyIn} waiting={meterWaiting}
            />
          )
          : null}
        dock={(
          <Dock
            status={dockStatus}
            hint={dockHint}
            kbd={dockKbd}
            onSetup={() => setSetupPanelOpen((open) => !open)}
            complete={everybodyIn}
            /* THE SAME ONE COUNT, NOT A SECOND ONE. This is the meter's own
               `heading` / `body`, handed to the dock so that the fitter taking
               the meter's COLUMN no longer takes the NUMBER with it — which is
               the owner's "the larger views also dont have the player counts".
               Only one of the two is ever visible and the switch is a CSS rule
               keyed on the fitter's own `data-auto-solo`; Dock.jsx and
               styles/stage.css both carry the argument next to the mechanism.
               Passing `meter` unchanged is deliberate: two sources for one
               fraction is how they drift apart. */
            progress={meter ? { ...meter, complete: everybodyIn } : null}
          >
            {/* Not reimplemented here. HostActionBar keeps its keyboard
                handling, its typing-target guard and its disabled hint; only
                its positioning changes, and `bigScreen` is what makes it a
                static element in a grid row rather than a fixed overlay. */}
            <HostActionBar
              controls={hostControls}
              onAction={runHostAction}
              bigScreen
              shortcutsEnabled={!anyOverlayOpen}
              /*
                → PAGES BEFORE IT ADVANCES. Reported: "host tend to skip the
                extra pages of the workie response by hitting the right
                arrow." On FIELD_NOTES with unread pages ahead, the advance
                key turns the page; on the LAST page it advances the round —
                the same mental model as a slide deck, where "next" moves
                through the content before it moves past it. The dock BUTTON
                always advances: a host who clicks Next Round means it.
              */
              interceptAdvance={() => {
                if (hostPhase !== 'FIELD_NOTES') return false;
                const md = currentAIInsights?.markdownResponse;
                if (!md) return false;
                const slice = prosePageSlice(md, stagePageIndex, proseBudgetFor(profile));
                if (slice.page >= slice.pages - 1) return false;
                setStagePageIndex(slice.page + 1);
                return true;
              }}
              /*
                ← STEPS BACKWARDS — pages first, then the beat. At the first
                Workie page it returns the room to the RESULTS tally, which is
                the "way to go backwards from the AI Workie screen to the
                results screen" and the key config/stagePaging.js reserved for
                exactly this. Published over /stage-beat, so the phone remote
                follows the step back the same way it follows the step in.
              */
              onBackKey={() => {
                if (hostPhase !== 'FIELD_NOTES') return false;
                if (stagePageIndex > 0) {
                  setStagePageIndex(stagePageIndex - 1);
                  return true;
                }
                setResultsBeat('results');
                publishStageBeat('results');
                return true;
              }}
              keyHint={hostPhase === 'FIELD_NOTES'
                ? '→ next page · ← back · at the end, → starts the next round'
                : ''}
            />
          </Dock>
        )}
      >
        {/* data-grow is the fitter's CEILING for this state, from the mockups.
            The ladder is a legibility floor, not a ceiling: a state carrying
            one object — a join code, a single prompt — under-uses a ladder
            derived for a dense screen, and 01-lobby/02-ask say by how much. */}
        {/* THE data-drop CONVENTION, stated once because it was inverted once.
            The fitter sacrifices ASCENDING: data-drop="1" goes first. The
            mockups fix the polarity — 06-results-call-and-answer numbers its
            un-noted CHROME "1" and "2" and its room-facing CONTENT "3" and
            "4" — so LOW NUMBERS ARE CHROME, HIGH NUMBERS ARE CONTENT, and a
            group carrying a data-drop-note (content announces its own loss)
            may never sort before a group without one (chrome goes silently).

            Numbering per state, in this file:
              1  fn-controls                  host-only controls
                 (`early-reveal` was the other 1 and is retired — the author
                  reveal is a session setting in the sidebar now, and a control
                  that is not on the stage cannot be sacrificed from it)
              2  debug-prompt-content         host-only, debug builds only
              3  anon-line / "How to answer"  room-facing, secondary
              4  "Full prompt" / .recap       room-facing, primary

            The numbers are scoped per .content and the phases are mutually
            exclusive, so ASK's 4 and VOTE's 4 never meet. Enforced by
            __tests__/stageShell.test.jsx, "chrome is sacrificed before
            content, in every state" — the check that was missing when a dense
            ASK threw away the question's full prompt and kept a host-only
            Reveal Authors button plus its two-line explanation. */}
        <div className="content" data-grow={STAGE_GROW[hostPhase] || '1'}>
          <div className="fitbox">

            {hostPhase === 'LOBBY' && (
              <>
                <div className="kicker">Scan to join · no app, no account</div>
                {gameId && (
                  <div className="joinblock">
                    <div className="qr">
                      <QRCodeSVG value={playUrl} size={512} level="M" includeMargin={false} />
                    </div>
                    <div className="joininfo">
                      <div className="lbl">Open on your phone</div>
                      <div className="url">{joinDisplayUrl}</div>
                      <div className="lbl">Session code</div>
                      <div className="code">{gameId}</div>
                    </div>
                  </div>
                )}
                {/* "until voting closes" USED TO END THIS SENTENCE and it is
                    now a lie: entering RESULTS reveals the round on the server,
                    but the stage attributes nobody unless the host's session
                    setting says to. So the room is told the fact that is
                    actually true — nobody is named — and told who can change
                    it. */}
                {anonymityApplies(currentGameType) && anonymousUntilReveal && (
                  <p className="anon-line" data-drop="3" data-drop-note="Anonymity note">
                    <b>Answers are anonymous.</b> Nobody sees who wrote what — the
                    host included — unless the host turns names on.
                  </p>
                )}
              </>
            )}

            {hostPhase === 'ASK' && currentQuestion && (
              <>
                {/* THE RECOVERY FOR A DROPPED PROMPT.
                    The full prompt below is data-drop="4" — the LAST thing the
                    fitter sacrifices on a dense ASK, after both host controls
                    and the how-to-answer line at "3" — but it can still go.
                    Click-to-expand is how the host gets it back, and without it
                    a dense round loses the prompt from both the room's screen
                    and the host's with no way to read it again. Mouse-only on
                    purpose: giving the heading a
                    tabIndex would put SPACE — the advance shortcut — on a
                    focusable element that also opens a modal. */}
                <h1
                  className="q"
                  data-expandable="1"
                  title="Show the full question"
                  onClick={expandQuestion}
                >
                  {currentQuestion.title || currentQuestion.question}
                </h1>
                {currentQuestion.image && (
                  <img
                    className="stage-art"
                    src={currentQuestion.image}
                    alt={currentQuestion.title || 'Artwork'}
                    onError={(e) => { e.currentTarget.style.display = 'none'; }}
                  />
                )}
                {/* WAVELENGTH SHOWS THE TERM AND NOTHING ABOUT IT. The owner,
                    off the AI Jargon set: "we dont want to give them ideas of
                    the meaning, we are looking to them to share their meaning."
                    A stored detail sentence IS a definition, so for wavelength
                    this line never renders — whatever the set carries. The
                    subject is the headline above; the how-to-answer line below
                    is the only other thing the room needs. */}
                {currentGameType !== 'wavelength'
                  && (currentQuestion.questionDetail || currentQuestion.detail) && (
                  <p className="qdetail" data-drop="4" data-drop-note="Full prompt">
                    {currentQuestion.questionDetail || currentQuestion.detail}
                  </p>
                )}
                {currentGameType === 'trivia' && (
                  <div className="opts">
                    {TRIVIA_OPTION_KEYS
                      .filter((key) => currentQuestion[key])
                      .map((key, index) => (
                        <div key={key} className="opt">
                          <span className="ltr">{String.fromCharCode(65 + index)}</span>
                          <span className="txt">{currentQuestion[key]}</span>
                        </div>
                      ))}
                  </div>
                )}
                <p className="qdetail" data-drop="3" data-drop-note="How to answer">
                  {getHostInstructionText(currentQuestionOf(questions, currentQuestionId))}
                </p>
              </>
            )}

            {hostPhase === 'VOTE' && (
              <>
                <div className="kicker">
                  {currentQuestion?.image ? 'Vote for the best title' : 'Vote for the best response'}
                </div>
                {currentQuestion && (
                  <p className="recap" data-drop="4" data-drop-note="The prompt">
                    {currentQuestion.title || currentQuestion.question}
                  </p>
                )}
                {currentQuestion?.image && (
                  <img
                    className="stage-art"
                    src={currentQuestion.image}
                    alt={currentQuestion.title || 'Artwork'}
                    onError={(e) => { e.currentTarget.style.display = 'none'; }}
                  />
                )}
                {/* A PAGE OF RESPONSES, NOT A CAROUSEL AND NOT A CLIFF.
                    What used to be here was a one-at-a-time carousel with ‹ ›
                    arrows: it asked a room to vote on a list it could only ever
                    see one line of, and asked the host to drive it while the
                    room waited. That was replaced by "every response, at once",
                    which is right until there are more responses than stage —
                    at which point the tail was simply cut off, with nothing on
                    screen saying so.
                    A page is the middle: as many as the profile can hold, a
                    printed position, and two keys the room can read off the
                    line itself. */}
                <div className="cards">
                  {answerPage.items.map((answer, i) => {
                    const idx = answerPage.offset + i;
                    return (
                      <div key={idx} className="card">
                        <div className="body">
                          <div className="ans">{`“${answer.answer}”`}</div>
                          <span className={`who ${authorsRevealed ? 'revealed' : 'anon'}`}>
                            {displayLabelFor(answer, idx)}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
                <Pager
                  total={answers.length}
                  page={answerPage.page}
                  pageSize={stagePageSize}
                  onPage={setStagePageIndex}
                  enabled={!anyOverlayOpen}
                />
              </>
            )}

            {/* THE "Reveal Authors" BUTTON USED TO BE HERE, on ASK and VOTE,
                with a two-line irreversibility warning beneath it.

                RETIRED, NOT LOST. It was a PER-ROUND override, and the owner
                ruled the decision session-level with none: *"Just leave the
                decision to the host"* — one setting, in the sidebar's Settings
                tab, for the whole session. Three things about it survive there:

                  - the endpoint. POST /reveal-authors is still what makes the
                    server stop redacting; it is now driven by the setting (see
                    the effect beside handleRevealAuthors) rather than pressed.
                  - the warning. "This cannot be undone" is the copy next to the
                    setting, where the host is actually deciding, instead of
                    beside a button on a stage the room is watching.
                  - the drop order. It was data-drop="1" — host-only chrome,
                    the first thing a dense ASK sacrificed, ahead of every
                    room-facing line — after shipping at "4" and throwing away
                    the question's own prompt to keep a button nobody in the
                    room can press. Nothing takes its number; the remaining
                    groups still sort chrome before content, which is the rule
                    stageShell.test.jsx holds. A control that is not on the
                    stage cannot be sacrificed from it. */}

            {hostPhase === 'RESULTS' && (
              <>
                <div className="kicker">
                  {`${getHostRoundNoun()} ${lessonNumber} · Results`}
                </div>

                {/* THE "Show authors / Hide authors" TOGGLE USED TO BE HERE.
                    RETIRED INTO THE SESSION SETTING, which is the same decision
                    made once instead of every round.

                    Its reasoning is kept because half of it is still true and
                    now belongs to the setting. It was A PROJECTOR CONTROL, NOT
                    A REVEAL: by the time RESULTS is on screen the round is
                    already revealed (get-results.js's enterResultsState) and
                    every row carries its author, so hiding a name here un-sends
                    nothing — it decides what the projector prints. That caveat
                    now lives in config/anonymity.js's stageLabelFor, next to
                    the code it describes, and in the Settings tab's own copy.

                    It was also the one control on this state that was NOT
                    droppable, because losing it would have left every author's
                    name on the projector with no way to take it down. That
                    hazard is gone with the button: the setting is in a panel
                    the fitter never touches, so the host can always reach it. */}

                {/* WHAT THIS STATE NO LONGER SHOWS, RECORDED.
                    Trivia's `trivia-player-scores` (every player, their
                    answer, isCorrect, +points and running total) and
                    wavelength's `wavelength-player-list` are both gone, and
                    neither is coming back in this shape: each is a list of
                    names WITH A SCORE BESIDE EACH, and a score beside a name
                    is attribution by arithmetic (standingsVisible, §5.6.4).
                    THE CONSTRAINT HAS NARROWED AND THIS HALF OF IT HAS NOT.
                    The meter now names who is still waiting (RoomMeter.jsx's
                    doc-block carries the owner's ruling) — a waiting list is
                    who has not acted, which is not authorship; a standings
                    roster is a scoreboard, which is. What replaces these is
                    still not decided here — 07-results-trivia's own answer is
                    a Standings roster in the meter, which RoomMeter still has
                    no slot for. That conflict is real and it is
                    plan 4/5's to settle; until it does, trivia's room-facing
                    payoff is the correct row and its share of the vote below.
                    The old empty-state is not restored either: it printed
                    JSON.stringify(answers) at a room. */}
                {currentGameType !== 'trivia' && answers.length === 0 ? (
                  <p className="qdetail">No responses came in for this one.</p>
                ) : currentGameType === 'trivia' ? (
                  <div className="opts">
                    {TRIVIA_OPTION_KEYS
                      .filter((key) => currentQuestion?.[key])
                      .map((key, index) => {
                        const letter = String.fromCharCode(65 + index);
                        const isCorrect = isCorrectTriviaOption(currentQuestion, key, letter);
                        const picked = answers.filter((a) => a.answer === letter).length;
                        const pct = answers.length
                          ? Math.round((picked / answers.length) * 100) : 0;
                        return (
                          <div key={key} className={`opt ${isCorrect ? 'correct' : 'dim'}`}>
                            <span className="fill" style={{ width: `${pct}%` }} />
                            <span className="ltr">{letter}</span>
                            <span className="txt">{currentQuestion[key]}</span>
                            <span className="pct">{`${pct}%`}</span>
                          </div>
                        );
                      })}
                  </div>
                ) : currentGameType === 'wavelength' ? (
                  /* The ranked .terms flow the mockup drew, carrying the
                     convergence spec's semantics: landed words (on EVERY
                     submitter's list) at full weight, everything else dimmer
                     with its count, one figure with its denominator in words.
                     Two beats — the exact analysis lands with the round close;
                     the clustered upgrade arrives over the socket
                     (wavelengthAnalysisReady) or the watchdog annotates the
                     exact result honestly. The packed word cloud is gone from
                     the stage: a packed cloud cannot guarantee the floor, and
                     raw frequency was the wrong claim anyway. */
                  <WavelengthConvergence analysis={wavelengthAnalysis} />
                ) : (
                  <div className="cards">
                    {answerPage.items.map((answer, i) => {
                      const idx = answerPage.offset + i;
                      const points = answer.points || 0;
                      const player = players.find((p) => p.name === answer.player);
                      // THE SETTING BEATS THE ROW HERE, and it has to: these rows
                      // always carry their author by the time RESULTS is showing,
                      // because entering RESULTS reveals the round server-side
                      // whatever the host chose. So the row cannot answer "may
                      // this name go on the wall".
                      //
                      // BUT THE SETTING IS `anonymous UNTIL REVEAL`, AND THIS IS
                      // THE REVEAL. This line used to ask `anonymityActive` alone,
                      // which is true for the whole session — so on an anonymous
                      // call-and-answer game the names never came back at RESULTS,
                      // reported as "it doesnt reveal names at the results for the
                      // round". `authorsHiddenNow` is the same question with the
                      // second half of the setting's name in it.
                      const displayName = stageLabelFor(answer, idx, {
                        authorsHidden: authorsHiddenNow({
                          gameType: currentGameType, anonymousUntilReveal, authorsRevealed,
                        }),
                      });
                      // Attribution by arithmetic: a score that jumps names its
                      // author as surely as a label would, so hiding the names
                      // takes the arithmetic with it or the setting is
                      // decorative. Cumulative standings stay off the stage
                      // entirely — a list of names is an attendance record.
                      // Pass the reveal flag itself. It used to pass
                      // `!anonymityActive(...)` in its place, which threw the
                      // flag away and hardcoded the session setting — so the
                      // points vanished with the names, for the same reason and
                      // in the same rounds.
                      const showPoints = standingsVisible({
                        gameType: currentGameType,
                        anonymousUntilReveal,
                        authorsRevealed,
                      });
                      /*
                        THE CARD OPENS. A card sized to fit a screenful of its
                        siblings is glanceable, not readable, and the host asked
                        to be able to read one: `<AnswerSpotlight>` below.

                        `idx` is ABSOLUTE — `answerPage.offset + i` — so Next
                        walks the whole round rather than stopping at the edge
                        of the visible page.

                        A div with a role and a key handler rather than a
                        <button>: the card carries its own block layout and a
                        button element would need every one of those properties
                        reset, and it must stay a legal parent for the tally.
                      */
                      return (
                        <div
                          key={idx}
                          className={`card is-openable ${answer.placement === 1 ? 'lead' : ''}`}
                          role="button"
                          tabIndex={0}
                          aria-label={`Read this answer in full: ${displayName}`}
                          onClick={() => openSpotlight(idx)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault();
                              openSpotlight(idx);
                            }
                          }}
                        >
                          {/* "1st", not "1" — the owner's word for it. */}
                          <span className="rank">{placeLabel(answer.placement)}</span>
                          <div className="body">
                            <div className="ans">{`“${answer.answer}”`}</div>
                            <span className="who revealed">{displayName}</span>
                          </div>
                          {showPoints && (
                            <span className="tally">
                              {`+${points}`}
                              <small>{`${answer.votes || 0} votes · ${player?.score || 0} total`}</small>
                            </span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* RESULTS PAGES TOO, AND ON THIS PHASE IT MATTERS MOST.
                    The meter is null here, so `.main` is solo from the start
                    and the fitter's cheapest lever — taking the meter's column
                    — does not exist. Everything the fitter has left removes
                    content, which is how a dense reveal reached `--fit .55`
                    with `data-clamped="on"` on real content. Trivia and
                    wavelength are excluded by construction: trivia's list is at
                    most six options and has a column-count lever of its own,
                    and the word cloud is one drawing rather than a list. */}
                {currentGameType !== 'trivia' && currentGameType !== 'wavelength' && (
                  <Pager
                    total={answers.length}
                    page={answerPage.page}
                    pageSize={stagePageSize}
                    onPage={setStagePageIndex}
                    enabled={!anyOverlayOpen}
                  />
                )}

                {/* THE PODIUM IS CONTENT, AND IT LIVES HERE — inside .content,
                    not in the meter and not in the setup panel.

                    The meter cannot hold it: it returns null on RESULTS,
                    FIELD_NOTES and ENDED, so the podium exists exactly where
                    the meter does not. And even if it could, fitPolicy.js
                    enters the meter into the sacrifice list at priority -1,
                    ahead of every data-drop group — a podium there would be
                    the FIRST thing thrown away on the densest results screen,
                    which is worse than no podium because the host has already
                    told the room it is coming.

                    THE PODIUM WENT MISSING ENTIRELY, and this prop is why.
                    It passed `!anonymityActive(...)` — the session setting,
                    inverted, standing in for the reveal flag — on the reasoning
                    that by RESULTS the server flag is true for every round and
                    so decides nothing. The first half is right; the conclusion
                    was not. Substituting the setting made the expression read
                    `false` for the whole of any anonymous call-and-answer
                    session, `standingsVisible` returned false with it, and
                    `podiumEntries` bailed at its second gate — no top three at
                    RESULTS, ever, on the format that has one. Reported together
                    with the missing names, because it is the same substitution
                    made twice.

                    So: pass the flag. It is false exactly while the round is
                    genuinely unrevealed, which is the case this gate is for, and
                    it carries the names and the arithmetic together — a score
                    that jumps names its author as surely as a label. */}
                <Podium
                  phase="RESULTS"
                  gameType={currentGameType}
                  anonymousUntilReveal={anonymousUntilReveal}
                  authorsRevealed={authorsRevealed}
                  players={players}
                />

                {/* Reading one answer properly. `answers` in FULL, not
                    `answerPage.items` — the pager is what the grid shows, and
                    the dialog steps through the whole round.

                    `labelFor` is passed rather than resolved inside the dialog
                    so anonymity stays decided in exactly one place: the same
                    `authorsHiddenNow` call the card behind it uses. A dialog
                    that re-derived it would be a fourth site to get wrong. */}
                <AnswerSpotlight
                  /*
                    THE ROOM'S COPY OF THIS DIALOG IS A DIFFERENT SIZE FROM THE
                    PHONE'S, and this class is the whole seam.

                      "when clicking on a title of a question or response, a
                       modal pops up but is the same size or smaller than what
                       was shown that not helpful it should make use of the
                       screen space and make the text large so all can really
                       read the text from a decent size room."

                    The base rules cap the dialog at 860px wide, 720px tall and
                    1.75rem of text — sized for the phone, where this component
                    also renders. On a 1080p projector that is under half the
                    width and smaller type than the card it was opened FROM, so
                    the one control whose entire job is "make this readable"
                    made it smaller.

                    `.plr-spot` is the player's own version of this seam, which
                    is why the fix is a sibling class rather than a rewrite of
                    the base: the phone keeps what it has, untouched.
                  */
                  surfaceClassName="stage-spot"
                  answers={answers}
                  index={spotlightIndex}
                  onIndex={openSpotlight}
                  onClose={closeSpotlight}
                  showPoints={standingsVisible({
                    gameType: currentGameType, anonymousUntilReveal, authorsRevealed,
                  })}
                  labelFor={(answer, idx) => stageLabelFor(answer, idx, {
                    authorsHidden: authorsHiddenNow({
                      gameType: currentGameType, anonymousUntilReveal, authorsRevealed,
                    }),
                  })}
                  title={`Round ${lessonNumber} response`}
                />
              </>
            )}

            {hostPhase === 'FIELD_NOTES' && (
              <>
                <div className="kicker">What we heard</div>
                {/* Four states, one component (components/AISummaryStatus.jsx):
                    writing, written, FAILED, and nothing yet. The fourth used
                    to stand in for the third — a trigger that never reached the
                    API left the nothing-yet placeholder on the wall, which is
                    indistinguishable from "still thinking" and stayed that way
                    for the rest of the session. */}
                {/* AND IT PAGES — the state the first pager missed. VOTE and
                    RESULTS page a LIST; Workie's summary is one continuous
                    document, so there were no items to slice and it simply ran
                    off the bottom of `.content{overflow:hidden}`. The same
                    three arguments the other two pagers take: the profile
                    decides the budget, the index is the stage's own beat-keyed
                    one, and `enabled` is the existing suppressor rather than a
                    second rule beside it. */}
                <AISummaryStatus
                  loading={loadingAIInsights}
                  insights={currentAIInsights}
                  failure={aiSummaryFailure}
                  retrying={aiRetrying}
                  onRetry={handleRetryAISummary}
                  profile={profile}
                  page={stagePageIndex}
                  onPage={setStagePageIndex}
                  enabled={!anyOverlayOpen}
                />

                {/* Host controls, so they are chrome and they are droppable —
                    but with NO data-drop-note. The note is the room-facing
                    announcement ("… — in the session report"), and a host
                    control that the fitter hid is not something the room lost;
                    saying so would print a sentence about a picker nobody in
                    the room can see. Notes belong on content.
                    Two different things, deliberately adjacent: the picker
                    changes the voice from the NEXT round on, Redo rewrites the
                    one on screen. */}
                <div className="fn-controls" data-drop="1">
                  <label className="ai-persona-switch-label" htmlFor="game-persona">
                    {`Voice (next ${getHostRoundNoun().toLowerCase()})`}
                  </label>
                  <select
                    id="game-persona"
                    className="ai-persona-select"
                    value={gamePersonaId}
                    onChange={(e) => handleChangeGamePersona(e.target.value)}
                    title="Changes Workie's voice from the next question onwards"
                  >
                    <option value="">Adapt to the session</option>
                    {gamePersonas.map((persona) => (
                      <option key={persona.personaId} value={persona.personaId}>
                        {persona.name}
                      </option>
                    ))}
                  </select>
                  <button
                    className="regenerate-ai-btn"
                    onClick={handleRegenerateAISummary}
                    title="Redo: rewrite the summary on screen now, in the current voice"
                    disabled={loadingAIInsights}
                  >
                    Redo
                  </button>
                  {personaSwitchStatus && (
                    <span className="ai-persona-switch-status">{personaSwitchStatus}</span>
                  )}
                </div>

                {gameDebugMode && currentAIInsights
                  && (currentAIInsights.debugPrompt || currentAIInsights.prompt) && (
                  <div className="debug-prompt-content" data-drop="2">
                    <div className="prompt-display">
                      {currentAIInsights.debugPrompt || currentAIInsights.prompt}
                    </div>
                  </div>
                )}
              </>
            )}

            {/* ENDED LEADS WITH THE CONCLUSION, NOT THE TITLE — 10-ended.
                This printed <h1 class="q">{eventTitle}</h1> while the rail
                printed the same title two inches above it: the same fact
                stated twice in one viewport, which the stage's binding
                constraints forbid. The title belongs to the rail, which
                carries it in every other state too; what the content owes the
                room here is what happened. The mockup's hero is a decided
                conclusion, which nothing in the game state can supply yet
                (that is plan 4/5's, with Field Notes) — so the hero is the
                honest one we do have, and the roll-up sits beneath it. */}
            {hostPhase === 'ENDED' && (
              <>
                <div className="kicker">Session complete</div>
                <h1 className="hero">
                  {`${lessonNumber} ${pluralRoundNoun(getHostRoundNoun(), lessonNumber).toLowerCase()} played`}
                </h1>
                {/* IN THE CONTENT FLOW, ABOVE THE PODIUM, UNDROPPABLE.
                    10-ended.html puts its people figure INSIDE the podium's
                    data-drop group, so under pressure the screen loses the one
                    number the owner asked for and keeps the sentence. This
                    line stays out here where nothing can sacrifice it.

                    It is a room count, not yet a participation rate. The
                    honest sentence — "34 of 40 people took part" — needs a
                    count of distinct people who answered at least once, which
                    only the server can compute (the names are in the sort key
                    and must not cross the wire). That count does not exist
                    yet, so this states what it can rather than a figure that
                    would be 100% by construction. */}
                <p className="qdetail">
                  {`${players.length} in the room · the full write-up is in the session report`}
                </p>

                {/* The mockup's second stat card — `Rounds captured · All
                    eight · 100%` — is deliberately NOT here. You only count
                    rounds that happened, so it can only ever read 100%: the
                    same structural lie as get-ai-summary.js:1599, drawn into
                    the design layer. The slot is the podium's, and the podium
                    is three cards.

                    `authorsRevealed` is the SERVER flag here, not the session
                    setting, and the difference is deliberate: the setting is
                    about attributing RESPONSES, and this podium attributes
                    none — it ranks people by a score, with no response on
                    screen to pin to anybody. Gating on the reveal having
                    happened is the point — a podium is a score table for the
                    whole session, and a session with an unrevealed round would
                    attribute it retroactively. */}
                {currentGameType === 'wavelength' ? (
                  /* No podium here and never was — wavelength writes no scores
                     and no Winners, and a podium would invent its numbers
                     (ended-screen review §1.4). The slot carries the one thing
                     the session actually produced: the words the whole room
                     said, combined from every round's stored analysis. */
                  <WavelengthSessionVocabulary rounds={rounds} loading={historyLoading} />
                ) : (
                  <Podium
                    phase="ENDED"
                    gameType={currentGameType}
                    anonymousUntilReveal={anonymousUntilReveal}
                    authorsRevealed={authorsRevealed}
                    players={players}
                  />
                )}
              </>
            )}

          </div>
          {/* What the fitter sacrificed, said out loud. Never a silent cut. */}
          <p className="reduced" hidden />
        </div>
      </Stage>

      {/* A SIBLING OF <Stage>, NOT A CHILD, and that is load-bearing. `.stage`
          is `height:100dvh` and this is a fixed overlay, so nothing about the
          grid changes when it opens and `useStageFit` is not re-entered.
          Mounted INSIDE the measured subtree, a tab list of unknown length
          would enter fitPolicy's world and drive the scale search to its
          floor. Its own geometry stops it at `--dock-measured`, because the
          dock is a no-overlay zone (audit A6). */}
      {setupPanelOpen && (
        <SessionSetupPanel
          rounds={rounds}
          historyLoading={historyLoading}
          onOpenRound={setPastRoundIndex}
          onClose={closeAllSidePanels}
          wsConnected={wsConnected}
          players={players}
          removedPlayers={removedPlayers}
          onRemovePlayer={(name) => setPlayerRemoved(name, true)}
          onRestorePlayer={(name) => setPlayerRemoved(name, false)}
          onGrantHandover={grantNameHandover}
          gameState={gameState}
          playersWhoAnswered={playersWhoAnswered}
          playersWhoVoted={playersWhoVoted}
          categories={categories}
          categoryCounts={categoryCounts}
          categoryBitmasks={categoryBitmasks}
          activeCategoryIds={activeCategoryIds}
          isTogglingCategory={isTogglingCategory}
          onToggleCategory={(row) => {
            if (row.live) {
              toggleCategoryDuringGame(String(row.position), row.name, !row.enabled);
            } else {
              toggleCategoryActive(row.name);
            }
          }}
          questions={browsingQuestions}
          loadingQuestions={loadingQuestions}
          usedQuestionIds={usedQuestionIds}
          onSelectQuestion={selectQuestion}
          questionQueue={questionQueue}
          queueBusyKeys={queueBusyKeys}
          upNext={upNext}
          upNextBlocked={upNextBlocked}
          upNextAdvisories={upNextAdvisories}
          upNextExcluded={upNextExcluded}
          onQueueQuestion={handleQueueQuestion}
          onQueueMove={handleQueueMove}
          onQueueRemove={handleQueueRemove}
          onAutoMove={handleAutoMove}
          onDisableQuestion={handleDisableQuestion}
          onRestoreQuestion={handleRestoreQuestion}
          gameId={gameId}
          playUrl={playUrl}
          remoteUrl={remoteUrl}
          joinLinkCopied={sidebarCopyMessage}
          onCopyJoinLink={() => copyUrlToClipboard(playUrl, 'sidebar')}
          onInvite={() => setInviteTarget({
            gameId,
            title: eventTitle,
            gameType: currentGameType,
            setName: (questionSets.find((set) => set.id === selectedSetId) || {}).name
              || (questionSets.find((set) => set.id === selectedSetId) || {}).title,
            categories: categories
              .filter((cat) => activeCategoryIds.has(cat.name))
              .map((cat) => ({ name: cat.name, questionCount: cat.questionCount })),
            createdAt: gameCreatedAt,
          })}
          suppressKeys={Boolean(inviteTarget)}
          onShowJoinCode={() => setQrMode('pinned')}
          profile={profile}
          onProfileChange={setProfile}
          /* THE TWO NAME DECISIONS, both session-level, both the host's.
             `anonymousUntilReveal` is the SAME flag the create dialog set —
             not a second one — so the setter is the same setter; the effect
             beside handleRevealAuthors is what makes the server agree when it
             turns off. `profile` is passed to this panel for the display
             picker and must never reach either of these. */
          gameType={currentGameType}
          anonymousUntilReveal={anonymousUntilReveal}
          onAnonymousUntilRevealChange={setAnonymousUntilReveal}
          nameWaitingWhenAnonymous={nameWaitingWhenAnonymous}
          onNameWaitingChange={setNameWaitingWhenAnonymous}
          autoMode={autoMode}
          onAutoModeChange={setAutoMode}
          answerCount={answers.length}
          authorsRevealed={authorsRevealed}
          onViewReports={handleViewReports}
          onShowHowToPlay={() => setLessonExpanded(true)}
          onSwitchGame={requestLeave}
          onSignOut={handleSignOut}
          // The group AdminPage's own ProtectedRoute requires. Offering the
          // link to a plain host would open a tab onto Access Denied.
          isAdmin={Boolean(currentUser?.groups?.includes('admins'))}
          issueControl={<IssueFab context="host" gameId={gameId} placement="inline" />}
        />
      )}

      {/*
        THE LEAVE GUARD'S QUESTION — see requestLeave for when it opens. Stay
        is first in DOM order and autofocused, so Enter stays, Escape stays,
        Tab lands on it, and the only way OUT of the session is aiming at the
        one button that says so: "with the default no", literally.
      */}
      {confirmLeave && (
        <Modal
          overlayClassName="modal-overlay"
          contentClassName="gsd new-game-dialog leave-guard"
          label="Leave this session?"
          onClose={() => setConfirmLeave(false)}
          closeOnBackdrop
          closeOnEscape
        >
          <h2>Leave this session?</h2>
          <div className="dialog-content">
            <p className="dialog-help-text" style={{ fontSize: '15px' }}>
              {`${players.length} ${players.length === 1 ? 'person is' : 'people are'} in the room. The session stays live — their screens keep working, and you can come back to it any time with Continue.`}
            </p>
            <div className="dialog-actions">
              <button
                type="button"
                className="btn-primary"
                autoFocus
                onClick={() => setConfirmLeave(false)}
              >
                Stay in the session
              </button>
              <button
                type="button"
                className="btn-secondary"
                onClick={() => { setConfirmLeave(false); handleSwitchGame(); }}
              >
                Back to Menu
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* Expanded QR Code Modal -- also the rail's pinned/previewed QR. Same
          overlay, same dismissal: the room only ever needs one way in.
          The preview modifier keeps the backdrop pointer-transparent -- see
          the class's comment in styles.css for why. */}
      {(showExpandedQR || qrMode) && (
        <div
          className={qrOverlayClassName(qrMode)}
          onClick={() => { setShowExpandedQR(false); setQrMode(null); }}
        >
          <div className="expanded-qr-content" onClick={(e) => e.stopPropagation()}>
            <div className="expanded-qr-header">
              <h2>{eventTitle || 'Engagements Session'}</h2>
            </div>
            <div className="expanded-qr-code">
              <QRCodeSVG value={playUrl} size={300} />
            </div>
            {expandedCopyMessage && (
              <div className="copy-message expanded-copy-message">
                <Icon name="Check" weight="bold" size={16} color="var(--success)" /> Link copied!
              </div>
            )}
            <div 
              className="expanded-qr-url clickable-url" 
              onClick={() => copyUrlToClipboard(playUrl, 'expanded')}
              title="Click to copy link"
            >
              {playUrl}
            </div>
            <div className="expanded-qr-game-id">
              Game ID: <strong>{gameId}</strong>
            </div>
            {/* A preview overlay is pointer-transparent, so "click anywhere"
                would be a click straight through onto the dock. */}
            <div className="expanded-qr-instructions">
              {qrOverlayInstructions(qrMode)}
            </div>
          </div>
        </div>
      )}
      
      {/* Loading Data Overlay */}
      {isLoadingData && (
        <div className="flash-alert-overlay">
          <div className="flash-alert">
            <div className="flash-alert-icon"><Icon name="Timer" weight="duotone" size={64} color="var(--primary)" /></div>
            <div className="flash-alert-text">{loadingMessage}</div>
            <div className="flash-alert-subtext">Please wait while we update the game...</div>
          </div>
        </div>
      )}

      {/* The three celebratory flash alerts are gone. Each was a full-screen
          overlay that covered the stage — including the advance control — for
          three or four seconds, at exactly the moment the host wanted to move
          on. The room meter and the dock's status line already say where the
          room is, continuously, without taking the screen to say it. The
          loading overlay above stays: it reports a real wait. */}

      {/* Expanded Lesson Modal */}
      {lessonExpanded && questions.length > 0 && (
        <div className="expanded-lesson-overlay" onClick={collapseQuestion}>
          <div className="expanded-lesson-content" onClick={(e) => e.stopPropagation()}>
            <div className="expanded-lesson-header">
              <div className="field-badge">
                {questions[0].field || questions[0].category}
              </div>
              {questions[0].school && (
                <div className="school-name">{questions[0].school}</div>
              )}
            </div>
            <div className="expanded-lesson-title">
              {currentGameType === 'trivia' ? 
                (questions[0].title) :
                (questions[0].title || questions[0].question)
              }
            </div>
            {questions[0].image && (
              <img
                src={questions[0].image}
                alt={questions[0].title || 'Artwork'}
                className="artwork-image artwork-image-expanded"
              onError={(e) => { e.currentTarget.style.display = 'none'; }}
              />
            )}
            {currentGameType === 'trivia' && (questions[0].questionDetail || questions[0].detail) && (
              <div className="expanded-lesson-detail">
                {questions[0].questionDetail || questions[0].detail}
              </div>
            )}
            {questions[0].detail && currentGameType !== 'wavelength' && (
              <div className="expanded-lesson-detail">
                {questions[0].detail}
              </div>
            )}
            {/* Wavelength: the term and nothing about it — a stored detail is
                a definition, and definitions are the players' job. The
                expanded view adds only the reminder of what to do. */}
            {currentGameType === 'wavelength' && (
              <div className="expanded-lesson-detail wavelength-topic-expanded">
                Everyone lists up to ten words or short phrases this term brings to mind.
              </div>
            )}
            <div className="expanded-lesson-prompt">
              <strong>{getHostInstructionText(currentQuestionOf(questions, currentQuestionId))}</strong>
            </div>
          </div>
        </div>
      )}
      
      {/* The are-you-sure dialog, now components/ConfirmDialog.jsx: ← cancels,
          → carries the advance through, and the buttons wear their keys — the
          owner's own gesture, since the hand that triggered this was already
          on the arrows. */}
      {showConfirmModal && (
        <ConfirmDialog
          title={confirmModalProps.title}
          message={confirmModalProps.message}
          confirmText={confirmModalProps.confirmText}
          onConfirm={confirmModalProps.onConfirm}
          onCancel={confirmModalProps.onCancel}
        />
      )}

      {/* GOING BACK THROUGH A ROUND THAT ALREADY HAPPENED.

          Mounted at the page root rather than inside the panel: the panel is
          presentational and unmounts when it closes, and a host who opens round
          two and then closes the sidebar should still be reading round two.
          It is also why `pastRoundIndex` lives on the page. */}
      <PastRound
        rounds={rounds}
        index={pastRoundIndex}
        onIndex={setPastRoundIndex}
        onClose={() => setPastRoundIndex(null)}
        onRegenerate={regenerateRoundSummary}
        regenerating={regeneratingRounds}
        /*
          NO `labelFor`. This prop is what hid the names in the rounds review,
          and removing it is the fix rather than correcting the expression.

          It answered a PER-ROUND question with a whole-session flag:
          `authorsRevealed` tracks the round currently in play, so while round
          four sat in ASK, rounds one to three were relabelled "Response 1, 2,
          3" — with their authors sitting unread in the payload the whole time.

          `POST /report` has already made this decision per round, through the
          same gate `GET /answers` uses, and encodes it by OMITTING playerName.
          PastRound now reads that with `displayLabelFor`, which decides from
          the row alone. Passing a second opinion in from here was the "two
          implementations of one anonymity rule" that config/sessionHistory.js
          warns about in its header.
        */
      />

    </div>

    {/* The session panel's Invite button opens the same dialog as session
        history's — one component, one piece of state, two openers. */}
    <InviteDialog target={inviteTarget} onClose={() => setInviteTarget(null)} />

    </>
  );
}

export default GameHostPage;
