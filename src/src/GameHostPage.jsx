import React, { useState, useEffect, useRef } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import html2pdf from 'html2pdf.js';
import webSocketClient from './WebSocketClient';
import MarkdownRenderer from './components/MarkdownRenderer';
import IssueFab from './components/IssueFab';
import QuickstartMenu from './components/QuickstartMenu';
import WavelengthWordCloud from './components/WavelengthWordCloud';
import Icon from './components/Icon';
import RankIcon from './components/RankIcon';
import SetImageBadge, { imageMarkerSuffix } from './components/SetImageBadge';
import HostActionBar from './components/HostActionBar';
import Stage from './components/stage/Stage';
import Rail from './components/stage/Rail';
import RoomMeter from './components/stage/RoomMeter';
import Dock from './components/stage/Dock';
import { loadProfile, saveProfile } from './config/displayProfile';
import { qrOverlayClassName } from './utils/qrOverlayClassName';
import { shortcutsSuppressed, qrOverlayInstructions } from './utils/hostOverlays';
import {
  resolveInstruction, currentQuestionOf, resolveRoundNoun, pluralRoundNoun,
} from './config/instructions';
import { resetGameSession } from './config/gameSession';
import { gameTypeMeta } from './config/gameTypes';
import {
  hostControlsFor, phaseOfGameState, isLobbyState, HOST_INTENTS, roomIsComplete,
} from './config/hostControls';
import {
  anonymityApplies, anonymityActive, createPayloadFor, displayLabelFor,
  stageLabelFor, standingsVisible, playerAnsweredActions, answeredNamesFrom,
  answeredCountFrom,
} from './config/anonymity';
import { useAuth } from './auth/AuthContext';
import { authFetch } from './auth/authFetch';

const API_BASE = window.API_BASE;

// Utility function to calculate proper rankings with tie handling
const calculatePlayerRankings = (players) => {
  // Sort players by score (descending)
  const sortedPlayers = [...players].sort((a, b) => (b.score || 0) - (a.score || 0));
  
  let currentRank = 1;
  const rankedPlayers = [];
  
  for (let i = 0; i < sortedPlayers.length; i++) {
    const player = sortedPlayers[i];
    const playerScore = player.score || 0;
    
    // If this isn't the first player and score is different from previous, 
    // update rank to current position + 1
    if (i > 0 && playerScore !== (sortedPlayers[i - 1].score || 0)) {
      currentRank = i + 1;
    }
    
    rankedPlayers.push({
      ...player,
      rank: currentRank
    });
  }
  
  return rankedPlayers;
};

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
  
  // `isLobbyState` is imported from config/hostControls.js, beside
  // `phaseOfGameState`. It was a closure here, where no test could reach it,
  // and it is the correction to the defect this whole change is named after —
  // a finished session rendering the lobby.
  const [players, setPlayers] = useState([]);
  const [questions, setQuestions] = useState([]);
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(-1);
  const [currentQuestionId, setCurrentQuestionId] = useState('');
  const [answers, setAnswers] = useState([]);
  const [gameState, setGameStateRaw] = useState('CREATED'); // CREATED, STARTED, ASK#001, VOTE#001, RESULTS#001, etc.
  
  // Debug wrapper for setGameState
  const setGameState = (newState) => {
    console.log(`🚨 DEBUG: setGameState called - changing from "${gameState}" to "${newState}"`);
    console.trace('🚨 DEBUG: setGameState call stack');
    setGameStateRaw(newState);
  };
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
  // Closed by default. It is a fixed 300–600px panel over a fixed-height
  // stage; opening it is a deliberate inspection, and the dock's SETUP button
  // is its permanent, discoverable entry point.
  const [qrSidebarVisible, setQrSidebarVisible] = useState(false);
  const [instructionsVisible, setInstructionsVisible] = useState(false);
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
  const [questionSetTabVisible, setQuestionSetTabVisible] = useState(false);
  const [showReport, setShowReport] = useState(false);
  const [reportData, setReportData] = useState(null);
  const [lessonNumber, setLessonNumber] = useState(0);
  // SERVER TRUTH: has this round's AuthorsRevealed been set? It flips
  // automatically when the round enters RESULTS (get-results.js's
  // enterResultsState); handleRevealAuthors is the override for a host who
  // wants names back before voting closes.
  const [authorsRevealed, setAuthorsRevealed] = useState(false);
  // DISPLAY ONLY, and deliberately separate from the above. The RESULTS payload
  // has already been delivered with its names in it; this decides whether the
  // projector prints them. It un-sends nothing and must never be described as
  // a security control. Resets per round.
  const [authorsHiddenOnStage, setAuthorsHiddenOnStage] = useState(false);

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

  // Question Browser State
  const [showQuestionBrowser, setShowQuestionBrowser] = useState(false);
  const [browsingQuestions, setBrowsingQuestions] = useState([]);
  const [selectedCategory, setSelectedCategory] = useState('');
  const [loadingQuestions, setLoadingQuestions] = useState(false);

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
  const [showQuickstartMenu, setShowQuickstartMenu] = useState(false);
  const [newGameSetId, setNewGameSetId] = useState('');
  const [eventTitle, setEventTitle] = useState('');
  const [eventDetails, setEventDetails] = useState('');
  const [gameAiContext, setGameAiContext] = useState('');
  const [engagementType, setEngagementType] = useState('call-and-answer'); // 'call-and-answer', 'trivia', or 'wavelength'
  const [triviaTimer, setTriviaTimer] = useState(30); // Timer for trivia questions in seconds
  const [randomizeQuestions, setRandomizeQuestions] = useState(true); // Default ON - randomize question order
  const [anonymousResponses, setAnonymousResponses] = useState(true); // Default ON - hide authorship until the round reveals

  // Workie's voice. '' means "adapt to the session" — the designed default, and
  // deliberately NOT the legacy prompt template's baked-in persona. See
  // docs/superpowers/specs/2026-08-07-workie-personas-design.md.
  // Two lists, because the two pickers are filtered by different game types.
  // `engagementType` is the create dialog's choice; `currentGameType` is loaded
  // from the game's own metadata when a session is resumed and the two do
  // diverge — resuming a trivia game leaves `engagementType` on whatever the
  // dialog last held.
  const [personas, setPersonas] = useState([]);           // create dialog
  const [gamePersonas, setGamePersonas] = useState([]);   // live game
  const [newGamePersonaId, setNewGamePersonaId] = useState('');
  const [gamePersonaId, setGamePersonaId] = useState('');       // the live game's voice
  const [personaSwitchStatus, setPersonaSwitchStatus] = useState('');

  // Question Set Management
  const [questionSets, setQuestionSets] = useState([]);
  const [selectedSetId, setSelectedSetId] = useState('');
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
  useEffect(() => { setResultsBeat('results'); }, [currentQuestionId, gameState]);

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
            setBigScreenMode(prev => !prev);
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
  // missed (e.g. host WS reconnect), clear the spinner and re-fetch the now-persisted item.
  const aiWatchdogRef = useRef(null);
  
  // The three celebratory flash alerts are gone — see the render. They were
  // full-screen overlays that covered the stage, including the advance
  // control, for three or four seconds while a room waited on the host. The
  // room meter already states where the room is, continuously and without
  // taking the screen.
  const [inviteCopied, setInviteCopied] = useState(false);
  
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
    currentQuestionId: setCurrentQuestionId,
    currentQuestionIndex: setCurrentQuestionIndex,
    lessonNumber: setLessonNumber,
    authorsRevealed: setAuthorsRevealed,
    authorsHiddenOnStage: setAuthorsHiddenOnStage,
    players: setPlayers,
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
    lessonExpanded: setLessonExpanded,
    instructionsVisible: setInstructionsVisible,
    showExpandedQR: setShowExpandedQR,
    qrMode: setQrMode,
    questionSetTabVisible: setQuestionSetTabVisible,
    showQuestionBrowser: setShowQuestionBrowser,
    browsingQuestions: setBrowsingQuestions,
    selectedCategory: setSelectedCategory,
    inviteCopied: setInviteCopied,
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
    if (aiWatchdogRef.current) clearTimeout(aiWatchdogRef.current);
    resetGameSession(gameSessionSetters, overrides);
  };

  /**
   * Open a different game. THE choke point — every create/join/continue path
   * goes through here, so per-game state can never be half-cleared.
   *
   * The reset and the `setGameId` land in the same React 18 batch, so the
   * screen never renders the new game id against the old game's data. The
   * `[gameId]` effect then restores the new game from the server onto a clean
   * slate — which matters because `restoreGameState()` only *adds*: a
   * just-started game reports `currentQuestion: 0` and skips the entire
   * question/answer/progress branch, so anything left behind would survive.
   */
  const switchToGame = (nextGameId, overrides = {}) => {
    console.log(`🔁 HOST: switching to game ${nextGameId} (from ${gameId || 'none'})`);
    leaveCurrentGame(overrides);
    setGameId(nextGameId);
    setShowWelcomeScreen(false);
  };


  // Fetch question set custom instruction (similar to player screen)
  const fetchQuestionSetInstruction = async (setId) => {
    if (!setId) {
      setCustomInstruction(null);
      setSetRoundNoun(null);
      return;
    }

    try {
      console.log('📋 HOST: Fetching instruction for set:', setId);
      const res = await fetch(`${API_BASE}question-sets`);
      const data = await res.json();
      const questionSet = data.sets?.find(set => set.id === setId);
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

  useEffect(() => {
    fetchPersonas(engagementType, setPersonas);
    // A voice that no longer suits the newly-chosen type must not stay selected.
    setNewGamePersonaId((current) => (current ? '' : current));
  }, [engagementType]); // eslint-disable-line react-hooks/exhaustive-deps

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
      const response = await fetch(`${API_BASE}games/${gameId}/persona`, {
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

  // Start/refresh the async-generation watchdog. If aiSummaryReady never arrives
  // (missed WS push), clear the spinner after ~45s and re-fetch the persisted item.
  const startAIWatchdog = (questionId) => {
    if (aiWatchdogRef.current) clearTimeout(aiWatchdogRef.current);
    aiWatchdogRef.current = setTimeout(() => {
      console.warn('⏰ AI summary watchdog fired — re-fetching persisted summary');
      fetchAISummary(questionId).then(summary => {
        if (summary && (summary.summary || summary.markdownResponse)) {
          setCurrentAIInsights({
            summary: summary.summary,
            discussionTopics: summary.discussionQuestions || [],
            nextSteps: summary.nextSteps || [],
            markdownResponse: summary.markdownResponse || null,
            prompt: gameDebugMode ? summary.debugPrompt : undefined,
            debugPrompt: gameDebugMode ? summary.debugPrompt : undefined
          });
        }
      }).finally(() => setLoadingAIInsights(false));
    }, 45000);
  };

  // Regenerate AI Summary with new generation. The server now returns 202
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
    setLoadingAIInsights(true);
    startAIWatchdog(currentQuestionNum);

    try {
      const debugParam = gameDebugMode ? '&debug=true' : '';
      // Fire-and-forget: response is 202 {status:'generating'}; result comes via WS.
      const response = await fetch(`${API_BASE}games/${gameId}/ai-summary?questionId=${currentQuestionNum}&generateNew=true${debugParam}`);
      if (!response.ok && response.status !== 202) {
        console.error('❌ Failed to trigger AI Summary regeneration. Status:', response.status);
        setLoadingAIInsights(false);
        if (aiWatchdogRef.current) clearTimeout(aiWatchdogRef.current);
      } else {
        console.log('✅ AI Summary regeneration triggered (awaiting WebSocket completion)');
      }
    } catch (error) {
      console.error('❌ Error triggering AI Summary regeneration:', error);
      setLoadingAIInsights(false);
      if (aiWatchdogRef.current) clearTimeout(aiWatchdogRef.current);
    }
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
      
      // Reload category counts to reflect decremented values after question completion
      if (categoryCounts) {
        console.log('📊 Reloading category counts after question completion');
        loadCategoryCounts();
      }
      
      // In WebSocket mode, we still need to trigger AI generation but rely on WebSocket for completion notification
      if (useWebSocket) {
        console.log('🔌 WebSocket mode: Triggering AI generation and waiting for WebSocket notification');
        
        // Check if AI summary already exists first
        fetchAISummary(questionId).then(existingSummary => {
          if (existingSummary && existingSummary.summary) {
            console.log('✅ Found existing AI summary');
            setCurrentAIInsights({
              summary: existingSummary.summary,
              discussionTopics: existingSummary.discussionQuestions || [],
              nextSteps: existingSummary.nextSteps || [],
              markdownResponse: existingSummary.markdownResponse || null,
              prompt: gameDebugMode ? existingSummary.debugPrompt : undefined,
              debugPrompt: gameDebugMode ? existingSummary.debugPrompt : undefined
            });
            setLoadingAIInsights(false);
          } else {
            // Trigger AI generation - WebSocket will notify us when done (server returns 202)
            console.log('🤖 Triggering AI generation, will wait for WebSocket notification...');
            startAIWatchdog(questionId);
            fetch(`${API_BASE}games/${gameId}/ai-summary?questionId=${questionId}&generateNew=true`, {
              method: 'GET',
              headers: { 'Content-Type': 'application/json' }
            }).catch(error => {
              console.error('❌ Failed to trigger AI generation:', error);
              setLoadingAIInsights(false);
              if (aiWatchdogRef.current) clearTimeout(aiWatchdogRef.current);
            });
          }
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
  }, [gameId]);

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
        // Hidden round: the roster ticks come from the server's participation
        // list (get-game-state's answerProgress.answererIds) on the next
        // resync, not from this frame.
        console.log('🔒 Answer received on an anonymous round — no name to mark');
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

    webSocketClient.onMessage('aiSummaryReady', (data) => {
      console.log('🔌 AI Summary ready notification:', data);
      if (aiWatchdogRef.current) clearTimeout(aiWatchdogRef.current);
      // Fetch the AI summary from API
      if (data.questionId) {
        console.log(`🔌 Fetching AI summary for question ${data.questionId}`);
        fetchAISummary(data.questionId).then(summary => {
          if (summary) {
            console.log('🔌 AI Summary fetched successfully:', summary);
            setCurrentAIInsights({
              summary: summary.summary,
              discussionTopics: summary.discussionQuestions || [],
              nextSteps: summary.nextSteps || [],
              markdownResponse: summary.markdownResponse || null,
              prompt: gameDebugMode ? summary.debugPrompt : undefined,
              debugPrompt: gameDebugMode ? summary.debugPrompt : undefined
            });
            setLoadingAIInsights(false);
            console.log('🔌 AI Summary state updated');
          } else {
            console.log('🔌 AI Summary fetch returned null/empty');
          }
        }).catch(error => {
          console.error('🔌 Error fetching AI summary:', error);
          setLoadingAIInsights(false);
        });
      }
    });

    // Async generation failed on the worker — clear the spinner so it can't hang.
    webSocketClient.onMessage('aiSummaryError', (data) => {
      console.error('🔌 AI Summary generation failed:', data);
      if (aiWatchdogRef.current) clearTimeout(aiWatchdogRef.current);
      setLoadingAIInsights(false);
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
      webSocketClient.offMessage('gameStateChanged');
      webSocketClient.offMessage('questionStarted');
      webSocketClient.offMessage('playerAnswered');
      webSocketClient.offMessage('playerVoted');
      webSocketClient.offMessage('votingStarted');
      webSocketClient.offMessage('authorsRevealed');
      webSocketClient.offMessage('aiSummaryReady');
      webSocketClient.offMessage('aiSummaryError');
    };
  }, [gameId, useWebSocket]);

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
      fetchCategories(selectedSetId);
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

        // First, load question sets for the restored game
        console.log(`🔍 HOST: Loading question sets for restored game...`);
        await fetchQuestionSets(true); // true = during restoration, no auto-selection
        if (superseded()) return false;

        // Restore basic game metadata
        if (gameStateData.gameMetadata) {
          setEventTitle(gameStateData.gameMetadata.title || '');
          setCurrentGameType(gameStateData.gameMetadata.gameType || 'call-and-answer');
          // Show the voice the game is actually set to, not a fresh default.
          setGamePersonaId(gameStateData.gameMetadata.personaId || '');
          const restoredSetId = gameStateData.gameMetadata.questionSetId || '';
          setSelectedSetId(restoredSetId);
          fetchQuestionSetInstruction(restoredSetId);
          console.log(`🎮 HOST: Restored game metadata`);
          
          // Restore categories from bitmask if we have a question set
          if (restoredSetId) {
            await fetchCategories(restoredSetId, true); // true = restore from game bitmask
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
                } else {
                  // Call-and-answer results format: { voteTallies: {...} }
                  console.log(`📊 HOST STATE RESTORE: Processing call-and-answer results with voteTallies`);
                  formattedAnswers = resultsData.voteTallies && Object.keys(resultsData.voteTallies).length > 0
                    ? Object.values(resultsData.voteTallies).map((tally, index) => {
                        console.log(`📊 HOST: Formatting tally ${index}:`, tally);
                        return {
                          player: tally.playerName,
                          playerName: tally.playerName, // for displayLabelFor
                          answer: tally.answerText,
                          points: tally.totalScore,
                          placement: tally.firstPlace > 0 ? 1 : tally.secondPlace > 0 ? 2 : tally.thirdPlace > 0 ? 3 : 0,
                          votes: tally.firstPlace + tally.secondPlace + tally.thirdPlace
                        };
                      })
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
    } catch (e) {
      console.error('fetchPlayers error', e);
    }
  };


  const fetchQuestionSets = async (duringRestoration = false) => {
    try {
      const res = await fetch(`${API_BASE}question-sets`);
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
        setSelectedSetId(firstSetId);
        fetchCategories(firstSetId);
        fetchQuestionSetInstruction(firstSetId);
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

  const fetchCategories = async (setId, restoreFromGame = false) => {
    if (!setId) {
      setCategories([]);
      setActiveCategoryIds(new Set());
      return;
    }
    
    try {
      const res = await fetch(`${API_BASE}question-sets/${setId}/categories`);
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
      
      const response = await fetch(`${API_BASE}games/${gameId}/toggle-category`, {
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

  // Fetch questions for browsing by category
  const fetchQuestionsForBrowsing = async (category = '') => {
    // Try to get setId from current questions first, then fall back to selectedSetId
    const setId = questions[0]?.setId || selectedSetId;
    
    if (!setId) {
      console.error('No question set available for browsing - neither selectedSetId nor current game questions found');
      console.log('Current state:', { selectedSetId, questionsCount: questions?.length, firstQuestion: questions?.[0] });
      return;
    }

    console.log(`📚 Using question set ID for browsing: "${setId}" (source: ${questions[0]?.setId ? 'current game' : 'selectedSetId'})`);
    
    setLoadingQuestions(true);
    try {
      const url = category 
        ? `${API_BASE}question-sets/${setId}/questions?category=${encodeURIComponent(category)}`
        : `${API_BASE}question-sets/${setId}/questions`;
      
      console.log(`🔍 Browsing questions: ${url}`);
      const response = await fetch(url);
      
      if (!response.ok) {
        console.error(`❌ Failed to fetch questions: ${response.status}`);
        setBrowsingQuestions([]);
        setSelectedCategory(category);
        return;
      }
      
      const data = await response.json();
      console.log(`📚 API Response:`, data);
      console.log(`🔍 Sample question fields:`, data.questions?.[0] ? Object.keys(data.questions[0]) : 'No questions');
      console.log(`🔍 Sample question data:`, data.questions?.[0]);
      setBrowsingQuestions(data.questions || []);
      setSelectedCategory(category);
      console.log(`✅ Loaded ${data.questions?.length || 0} questions for browsing`);
    } catch (error) {
      console.error('❌ Failed to fetch questions for browsing:', error);
      setBrowsingQuestions([]);
      setSelectedCategory(category);
    } finally {
      setLoadingQuestions(false);
    }
  };

  // Open question browser
  const openQuestionBrowser = (category = '') => {
    console.log(`🔍 Opening question browser for category: "${category}"`);
    console.log(`📚 Selected set ID: "${selectedSetId}"`);
    console.log(`🎮 Current game questions:`, questions?.length || 0);
    
    console.log(`🔄 About to set showQuestionBrowser to true...`);
    setShowQuestionBrowser(true);
    console.log(`✅ Set showQuestionBrowser to true`);
    
    // Force a re-render check
    setTimeout(() => {
      console.log(`⏱️ State check after timeout - showQuestionBrowser should be true`);
    }, 100);
    fetchQuestionsForBrowsing(category);
  };

  // Close question browser  
  const closeQuestionBrowser = () => {
    setShowQuestionBrowser(false);
    setBrowsingQuestions([]);
    setSelectedCategory('');
  };

  // Select a specific question to trigger as the next question
  const selectQuestion = async (selectedQuestion) => {
    try {
      console.log(`🎯 HOST: Selecting specific question:`, selectedQuestion);
      
      // Close the question browser first so confirmation modal appears on top
      setShowQuestionBrowser(false);
      
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
      const nextQuestionRes = await fetch(`${API_BASE}games/${gameId}/next-question`, {
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

  // DEBUG: Track all modal state changes
  useEffect(() => {
    console.log('🔍 MODAL STATE CHANGE - All modal states:', {
      showQuestionBrowser,
      showExpandedQR,
      showNewGameDialog,
      showConfirmModal,
      gameState,
      isConnected: webSocketClient?.isConnected?.() || false
    });
  }, [showQuestionBrowser, showExpandedQR, showNewGameDialog, showConfirmModal]);

  // DEBUG: Track component mounting/updating
  useEffect(() => {
    console.log('🔄 GameHostPage component mounted/updated');
    console.log('📊 showQuestionBrowser on mount:', showQuestionBrowser);
  }, []);

  // DEBUG: Specific tracking of showQuestionBrowser changes
  useEffect(() => {
    console.log('🎯 showQuestionBrowser changed to:', showQuestionBrowser);
    if (showQuestionBrowser) {
      console.log('👀 Modal should be VISIBLE now!');
    } else {
      console.log('👻 Modal should be HIDDEN now');
    }
  }, [showQuestionBrowser]);


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
      
      // Use the new next-question API that handles category selection and progression
      const nextQuestionRes = await fetch(`${API_BASE}games/${gameId}/next-question`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody)
      });
      
      if (!nextQuestionRes.ok) {
        const errorData = await nextQuestionRes.json();
        console.error('Failed to get next question:', errorData);
        alert(`Failed to get next question: ${errorData.error || 'Unknown error'}`);
        return;
      }
      
      const nextQuestionData = await nextQuestionRes.json();
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
      setPlayersWhoAnswered([]);
      setVotes([]);
      setPlayersWhoVoted([]);
      setCurrentQuestionVotes([]);
      setLessonNumber(lessonNumber);
      setAuthorsRevealed(false); // A new round starts anonymous, not the last one's reveal
      setAuthorsHiddenOnStage(false); // and not with the last round's projector override, either
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
      console.error('Failed to get next question', e);
      alert('Failed to start next question. Please try again.');
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
      const startVoteRes = await fetch(`${API_BASE}games/${gameId}/start-vote`, {
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
        // Wavelength results format: Just the raw answers with words
        console.log(`🌊 HOST: Processing wavelength results with ${resultsData.answers?.length || 0} answers`);
        
        formattedAnswers = (resultsData.answers || []).map(answer => ({
          player: answer.playerName,
          playerName: answer.playerName, // for displayLabelFor
          answer: answer.answer || answer.ProcessedWords?.join(',') || '', // Comma-separated words
          points: 0, // No points in wavelength
          submittedAt: answer.submittedAt
        }));
        
        console.log(`🌊 HOST: Formatted ${formattedAnswers.length} wavelength answers for word cloud`);
        
      } else {
        // Call-and-answer results format: { voteTallies: {...} }
        console.log(`💬 HOST: Processing call-and-answer results with voteTallies`);
        
        formattedAnswers = resultsData.voteTallies && Object.keys(resultsData.voteTallies).length > 0
          ? Object.values(resultsData.voteTallies).map(tally => ({
              player: tally.playerName,
              playerName: tally.playerName, // for displayLabelFor
              answer: tally.answerText,
              points: tally.totalScore,
              placement: tally.firstPlace > 0 ? 1 : tally.secondPlace > 0 ? 2 : tally.thirdPlace > 0 ? 3 : 0,
              votes: tally.firstPlace + tally.secondPlace + tally.thirdPlace
            }))
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
      // Results open with the names showing; the stage toggle is an override
      // the host applies afterwards, not a state a new round inherits.
      setAuthorsHiddenOnStage(false);
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

  // THE EARLY REVEAL — reachable only from ASK# / VOTE#. AuthorsRevealed flips
  // by itself when voting closes (get-results.js:enterResultsState), so this
  // endpoint is load-bearing exactly when the host wants the names up first.
  // The RESULTS-phase control is a separate, purely-local display toggle and
  // deliberately does NOT come through here: the rows it renders are
  // tally-shaped (points/votes/placement) and this endpoint answers with
  // ballot-shaped ones, so calling it there blanked the whole panel.
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

  const handleSwitchGame = () => {
    // Leaving the game the host is watching. Every per-game value goes back to
    // its initial state HERE, before the welcome screen appears, so whichever
    // route they take next (Quick Start, create, continue, history) starts
    // clean and there is no window where the new game id renders against the
    // old game's question, phase and answers.
    //
    // Order matters: read selectedSetId before the reset clears it, so the
    // create dialog still opens on the set they were just using.
    setNewGameSetId(selectedSetId);
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
      const response = await fetch(`${API_BASE}games/${selectedGameId}/start`, {
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
  
  const copyPlayerUrl = (gameId) => {
    const playerUrl = `${window.location.origin}/player?gameId=${gameId}`;
    navigator.clipboard.writeText(playerUrl).then(() => {
      console.log('📋 Player URL copied to clipboard');
    }).catch(err => {
      console.error('❌ Failed to copy player URL:', err);
    });
  };
  
  const copyInviteInfo = (game) => {
    const inviteText = `Join the engagement!\n\nGame ID: ${game.gameId}\nURL: ${window.location.origin}/player?gameId=${game.gameId}\n\nTitle: ${game.eventTitle || 'Engagement Session'}`;
    navigator.clipboard.writeText(inviteText).then(() => {
      console.log('📋 Invite info copied to clipboard');
    }).catch(err => {
      console.error('❌ Failed to copy to clipboard:', err);
    });
  };

  const handleStartNewGame = async () => {
    if (!newGameSetId || !eventTitle.trim()) {
      alert('Please select a question set and enter an event title.');
      return;
    }

    try {
      // Clear all game data from database (always call, backend handles empty gameId gracefully)
      console.log(`🗑️ HOST: Clearing old game data (gameId: ${gameId || 'none'})`);
      const clearResponse = await authFetch(`${API_BASE}admin/clear-game/${gameId || 'empty'}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });

      if (clearResponse.ok) {
        const clearData = await clearResponse.json();
        console.log(`✅ HOST: Clear response:`, clearData);
        if (clearData.status === 'no_game_id') {
          console.log(`📝 HOST: No previous game to clear - starting fresh`);
        } else {
          console.log(`🗑️ HOST: Cleared ${clearData.itemsDeleted} items from previous game`);
        }
      }
    } catch (e) {
      console.error('handleStartNewGame clear error', e);
      // Don't fail the new game creation if clear fails
      console.log(`⚠️ HOST: Clear failed, but continuing with new game creation`);
    }
    
    // Create the game first - let backend generate the gameId
    console.log(`🆕 HOST: Creating new game with backend-generated ID`);
    
    // Drop the game that was on screen. This used to be a hand-picked dozen
    // setters here, which left questions/currentQuestionId/aiSummaries/
    // customInstruction/categories behind — the "mostly new game with one stale
    // panel" failure. One list now, in config/gameSession.js.
    //
    // `eventTitle` is carried through as an override because on this path it is
    // also the create dialog's own input, which the host has just typed.
    // `activeCategoryIds` is read from this closure below (pre-reset), so the
    // categories the host picked still reach the create call.
    leaveCurrentGame({
      eventTitle,
      currentGameType: engagementType,
      selectedSetId: newGameSetId,
      // Also an override rather than a post-reset setAnonymousUntilReveal:
      // the create call below sends this same value, so seeding it here
      // means the host screen never shows the (safe-default) previous
      // game's flag for the moment before the create response returns.
      anonymousUntilReveal: createPayloadFor({ gameType: engagementType, anonymousResponses }).anonymousUntilReveal,
    });
    fetchQuestionSetInstruction(newGameSetId);

    // Create the game directly with the backend API
    try {
      // Convert activeCategoryIds Set to array for selectedCategories
      const selectedCategories = Array.from(activeCategoryIds);
      
      const createResponse = await fetch(`${API_BASE}games`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          eventTitle: eventTitle,
          engagementInfo: eventDetails || null,
          aiContext: gameAiContext || null,
          gameType: engagementType,
          questionSetId: newGameSetId,
          randomizeQuestions: randomizeQuestions,
          selectedCategories: selectedCategories,
          triviaTimer: engagementType === 'trivia' ? triviaTimer : null,
          // '' means "adapt to the session". create-game.js only stores
          // PersonaId when this is non-empty.
          personaId: newGamePersonaId || '',
          hostName: 'Host',
          ...createPayloadFor({ gameType: engagementType, anonymousResponses }),
        })
      });

      if (createResponse.ok) {
        const gameData = await createResponse.json();
        console.log(`✅ HOST: Game created successfully:`, gameData);
        
        // Game created successfully - now show game history
        const newGameId = gameData.gameId;
        console.log(`✅ HOST: Game ${newGameId} created successfully - showing game history`);
        console.log(`🎯 HOST: IMPORTANT - We should now see the game history modal instead of going to game screen`);
        
        // Store event title in localStorage as backup
        localStorage.setItem(`game_${newGameId}_title`, eventTitle);
        
        // Close new game dialog
        setShowNewGameDialog(false);
        
        // Show game history with the new game highlighted
        await fetchGamesList();
        setReportsModalMode('select');
        setShowReportsModal(true);
        
        console.log(`🎯 HOST: New game created with ID ${newGameId}, set "${newGameSetId}", title "${eventTitle}" - showing in history`);
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
    
    console.log(`🎯 HOST: New game started with set "${newGameSetId}", title "${eventTitle}", and AI context: ${gameAiContext ? 'provided' : 'none'}`);
    
    // Carry the chosen voice into the live game so the in-game picker opens on
    // it, then reset the dialog's own fields for the next engagement.
    setGamePersonaId(newGamePersonaId || '');
    setPersonaSwitchStatus('');
    setGameAiContext('');
    setNewGamePersonaId('');
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
  const createInvite = async () => {
    if (!gameId || !eventTitle) {
      console.error('Cannot create invite: missing gameId or eventTitle');
      return;
    }

    const gameUrl = `https://eng.dev.seibtribe.us/play?gameId=${gameId}`;
    const questionSet = questionSets.find(set => set.id === selectedSetId);
    
    // Get selected categories text
    const selectedCategoriesList = categories.filter(cat => activeCategoryIds.has(cat.name));
    const catText = selectedCategoriesList.length > 0 
      ? selectedCategoriesList.map(cat => `${cat.name} (${cat.questionCount})`).join(', ')
      : 'All categories';

    const inviteText = `ENGAGEMENT INVITATION

${eventTitle}

You're invited to participate in an interactive engagement session!

DETAILS:
• Type: ${engagementType === 'call-and-answer' ? 'Call and Answer (Discussion + Voting)' : 
                engagementType === 'trivia' ? 'Trivia (Questions Only)' : 
                'Wavelength (Word Association & Alignment)'}
• Question Set: ${questionSet?.name || questionSet?.title || 'Unknown Set'}
• Categories: ${catText}
${gameAiContext ? `• Context: ${gameAiContext}` : ''}

TO JOIN:
Click this link or copy it to your browser:
${gameUrl}

INSTRUCTIONS:
1. Click the link above or paste it into your browser
2. Enter your name when prompted
3. Wait for the host to begin
4. Participate by answering questions and voting

Ready to engage? See you there!`;

    try {
      await navigator.clipboard.writeText(inviteText);
      // The button itself says "Copied!" for four seconds. A full-screen
      // overlay to say the same thing is a modal in front of a live room.
      setInviteCopied(true);
      setTimeout(() => setInviteCopied(false), 4000);
      
      console.log('📋 Invite copied to clipboard');
      console.log('Invite text:', inviteText);
    } catch (error) {
      console.error('Failed to copy invite to clipboard:', error);
      // Fallback: show invite text in an alert
      alert('Invite text (copy manually):\n\n' + inviteText);
    }
  };

  const fetchGamesList = async () => {
    try {
      const res = await fetch(`${API_BASE}games`);
      const data = await res.json();
      setGamesList(data.games || []);
    } catch (error) {
      console.error('Error fetching games list:', error);
      alert('Failed to load games list. Please try again.');
    }
  };

  const handleViewReports = async () => {
    await fetchGamesList();
    setReportsModalMode('reports');
    setShowReportsModal(true);
  };


  const generateReportForGame = async (targetGameId, targetEventTitle) => {
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

      // Close reports modal and show report
      setShowReportsModal(false);
      setReportData(gameData);
      setShowReport(true);
      console.log('📊 Report generated successfully');
    } catch (error) {
      console.error('Error generating report:', error);
      alert('Failed to generate report. Please try again.');
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

  // Function to close all side panels
  const closeAllSidePanels = () => {
    setQrSidebarVisible(false);
    setInstructionsVisible(false);
    setQuestionSetTabVisible(false);
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

  // Render the welcome screen if no game is selected
  if (showWelcomeScreen) {
    return (
      <div className="welcome-screen">
        {/* The decorative parallax hero is gone. It was 250px+ of CDN-hosted
            stock photography above every screen it appeared on, and its own
            stylesheet already collapsed it during a live round because it was
            spending the fold on a word the host already knew. */}
        <h2 className="welcome-title">{currentGameType === 'trivia' ? 'Trivia' : 'Engagements'}</h2>

        <div className="welcome-content">
          <div className="welcome-card">
            <h3>Get Started</h3>
            <p>Choose how you'd like to begin your collaborative learning session:</p>
            
            <div className="welcome-options">
              <button className="btn-secondary btn-large welcome-btn" onClick={() => setShowQuickstartMenu(true)}>
                <Icon name="Lightning" weight="duotone" size={20} color="var(--primary)" /> Quick Start
              </button>

              <button className="btn-primary btn-large welcome-btn" onClick={handleWelcomeNewGame}>
                <Icon name="Target" weight="duotone" size={20} /> Create Engagement
              </button>
              
              <div className="continue-game-section">
                <h4>Continue Existing Game</h4>
                <div className="continue-game-form">
                  <input
                    type="text"
                    value={continueGameId}
                    onChange={(e) => setContinueGameId(e.target.value)}
                    placeholder="Enter 4-digit Game ID"
                    className="input-field game-id-input"
                    maxLength="4"
                  />
                  <button 
                    className="btn-secondary" 
                    onClick={handleContinueGame}
                    disabled={!continueGameId.trim()}
                  >
                    Continue Game
                  </button>
                </div>
              </div>
              
              <button className="btn-secondary btn-large welcome-btn" onClick={handleViewGameHistory}>
                <Icon name="ClipboardText" weight="bold" size={20} /> View Game History
              </button>
              
              {/* User Info and Sign Out */}
              {currentUser && (
                <div className="welcome-user-info" style={{
                  marginTop: '20px',
                  padding: '12px',
                  backgroundColor: '#f8f9fa',
                  border: '1px solid #dee2e6',
                  borderRadius: '6px',
                  textAlign: 'center',
                  fontSize: '14px'
                }}>
                  <div style={{ marginBottom: '6px' }}>
                    <strong>{currentUser.attributes?.name || 'User'}</strong>
                  </div>
                  {currentUser.groups?.includes('admins') && (
                    <div style={{ color: '#007bff', fontWeight: '500', fontSize: '12px', marginBottom: '8px' }}>
                      Administrator
                    </div>
                  )}
                  <button 
                    onClick={handleSignOut}
                    className="btn-secondary"
                    style={{
                      padding: '6px 12px',
                      fontSize: '12px',
                      minHeight: 'auto'
                    }}
                  >
                    Sign Out
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Render the report if it's being shown
  if (showReport && reportData) {
    return <GameReport reportData={reportData} onClose={() => setShowReport(false)} />;
  }


  // Render the game history modal if it's being shown
  if (showReportsModal) {
    // Sort games by creation date (newest first) and find the most recent
    const sortedGames = [...gamesList].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    const mostRecentGameId = sortedGames.length > 0 ? sortedGames[0].gameId : null;
    
    return (
      <div className="new-game-overlay">
        <div className="new-game-dialog reports-modal">
          <div className="modal-header">
            <h2 className="modal-title">
              {reportsModalMode === 'select'
                ? <><Icon name="GameController" weight="duotone" size={24} color="var(--primary)" /> Game History</>
                : <><Icon name="ChartBar" weight="duotone" size={24} color="var(--primary)" /> Game Reports</>}
            </h2>
            <div className="modal-subtitle">
              {reportsModalMode === 'select' ? 'Select a game to start or continue' : 'View past game reports'}
            </div>
          </div>
          
          <div className="dialog-content">
            <div className="games-list">
              {gamesList.length === 0 ? (
                <div className="empty-state">
                  <div className="empty-icon"><Icon name="Target" weight="duotone" size={48} color="var(--primary)" /></div>
                  <p>No games found.</p>
                  <small>Create your first engagement session to get started!</small>
                </div>
              ) : (
                sortedGames.map((game, index) => {
                  const isRecent = game.gameId === mostRecentGameId;
                  const isCurrent = game.gameId === gameId;
                  const isFirst = index === 0;
                  const displayTitle = game.title || game.eventTitle || 'Engagement Session';
                  
                  return (
                    <div 
                      key={game.gameId} 
                      className={`game-history-item ${isCurrent ? 'current-game' : ''} ${isRecent ? 'recent-game' : ''} ${isFirst ? 'first-game' : ''}`}
                    >
                      <div className="game-header">
                        <div className="game-title-section">
                          <h3 className="game-title">
                            {displayTitle}
                            {isRecent && <span className="new-badge"><Icon name="Sparkle" weight="fill" size={13} /> Latest</span>}
                            {isCurrent && <span className="current-badge"><Icon name="MapPin" weight="fill" size={13} /> Current</span>}
                          </h3>
                          <div className="game-id">#{game.gameId}</div>
                        </div>
                        <div className="game-status-badges">
                          {game.started ? (
                            <span className="status-badge started"><Icon name="Play" weight="fill" size={13} /> Started</span>
                          ) : (
                            <span className="status-badge pending"><Icon name="Pause" weight="fill" size={13} /> Ready to Start</span>
                          )}
                        </div>
                      </div>
                      
                      <div className="game-details">
                        <div className="game-info-grid">
                          <div className="info-item">
                            <span className="info-label">Type:</span>
                            <span className="info-value">
                              <Icon
                                name={gameTypeMeta(game.gameType).icon}
                                weight="bold"
                                size={15}
                                color={gameTypeMeta(game.gameType).accent}
                              />{' '}
                              {gameTypeMeta(game.gameType).label}
                            </span>
                          </div>
                          <div className="info-item">
                            <span className="info-label">Question Set:</span>
                            <span className="info-value">
                              {game.questionSetId || 'Unknown'}
                              <SetImageBadge hasImages={questionSets.find(s => s.id === game.questionSetId)?.hasImages} />
                            </span>
                          </div>
                          <div className="info-item">
                            <span className="info-label">Created:</span>
                            <span className="info-value">
                              {game.createdAt ? new Date(game.createdAt).toLocaleDateString('en-US', {
                                month: 'short',
                                day: 'numeric',
                                hour: '2-digit',
                                minute: '2-digit'
                              }) : 'Unknown'}
                            </span>
                          </div>
                          {game.lastPlayedAt && (
                            <div className="info-item">
                              <span className="info-label">Last Played:</span>
                              <span className="info-value">
                                {new Date(game.lastPlayedAt).toLocaleDateString('en-US', {
                                  month: 'short',
                                  day: 'numeric',
                                  hour: '2-digit',
                                  minute: '2-digit'
                                })}
                              </span>
                            </div>
                          )}
                        </div>
                      </div>
                      
                      <div className="game-actions">
                        <button 
                          className="game-action-btn category-style-btn"
                          onClick={(e) => {
                            e.stopPropagation();
                            copyPlayerUrl(game.gameId);
                          }}
                          title="Copy player URL"
                        >
                          <Icon name="LinkSimple" weight="bold" size={16} /> Player URL
                        </button>
                        <button 
                          className="game-action-btn category-style-btn"
                          onClick={(e) => {
                            e.stopPropagation();
                            copyInviteInfo(game);
                          }}
                          title="Copy invite info"
                        >
                          <Icon name="ClipboardText" weight="bold" size={16} /> Invite
                        </button>
                        {game.started && (
                          <button 
                            className="game-action-btn category-style-btn"
                            onClick={(e) => {
                              e.stopPropagation();
                              generateReportForGame(game.gameId, displayTitle);
                            }}
                            title="View detailed game report"
                          >
                            <Icon name="ChartBar" weight="bold" size={16} /> Report
                          </button>
                        )}
                        <button 
                          className={`game-action-btn category-style-btn primary-action-btn ${game.started ? 'continue-btn' : 'start-btn'}`}
                          onClick={() => {
                            if (game.started) {
                              // Continue existing game
                              selectGameFromHistory(game.gameId, displayTitle);
                            } else {
                              // Start new game
                              startGameFromHistory(game.gameId, displayTitle);
                            }
                          }}
                        >
                          {game.started
                            ? <><Icon name="Play" weight="fill" size={16} /> Continue</>
                            : <><Icon name="PlayCircle" weight="fill" size={16} /> Start Game</>}
                        </button>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
          
          <div className="dialog-actions">
            <button 
              className="btn-secondary modal-close-btn" 
              onClick={() => {
                setShowReportsModal(false);
                if (reportsModalMode === 'select' && isLobbyState(gameState) && lessonNumber === 0) {
                  setShowWelcomeScreen(true);
                }
              }}
            >
              <Icon name="X" weight="bold" size={16} /> {reportsModalMode === 'select' ? 'Cancel' : 'Close'}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Render the new game dialog if it's being shown
  if (showNewGameDialog) {
    return (
      <div className="new-game-overlay">
        <div className="new-game-dialog">
          <h2>{isLobbyState(gameState) && lessonNumber === 0 ? 'Create Engagement' : 'Start New Game'}</h2>
          <div className="dialog-content">
            <div className="form-group">
              <label>Event Title:</label>
              <input
                type="text"
                value={eventTitle}
                onChange={(e) => setEventTitle(e.target.value)}
                placeholder="Enter event title (e.g., Team Leadership Workshop)"
                className="dialog-input"
              />
            </div>
            
            <div className="form-group">
              <label>Event Details (Optional):</label>
              <textarea
                value={eventDetails}
                onChange={(e) => setEventDetails(e.target.value)}
                placeholder="Describe the session details, purpose, or context that will be visible to participants (e.g., 'This workshop focuses on improving team collaboration and communication skills')"
                className="dialog-textarea"
                rows="2"
                maxLength="300"
              />
              <small className="dialog-help-text">
                This information will be shown to participants when they join. {eventDetails.length}/300 characters
              </small>
            </div>
            
            <div className="form-group">
              <label>Engagement Type:</label>
              <select 
                value={engagementType} 
                onChange={(e) => {
                  setEngagementType(e.target.value);
                  setNewGameSetId(''); // Reset selected set when type changes
                }}
                className="dialog-select"
              >
                <option value="call-and-answer">Call and Answer</option>
                <option value="trivia">Trivia</option>
                <option value="wavelength">Wavelength</option>
              </select>
            </div>
            
            <div className="form-group">
              <label>Question Set:</label>
              <select 
                value={newGameSetId} 
                onChange={(e) => {
                  setNewGameSetId(e.target.value);
                  if (e.target.value) {
                    fetchCategories(e.target.value);
                    fetchQuestionSetInstruction(e.target.value);
                  } else {
                    setCustomInstruction(null);
                  }
                }}
                className="dialog-select"
              >
                <option value="">Select a question set...</option>
                {questionSets
                  .filter(set => set.engagementType === engagementType)
                  .map(set => (
                    <option key={set.id} value={set.id}>
                      {set.name} ({set.totalQuestions} questions){imageMarkerSuffix(set.hasImages)}
                    </option>
                  ))}
              </select>
            </div>
            
            {newGameSetId && (
              <div className="form-group">
                <label>Categories:</label>
                <div className="category-selection">
                  <div className="category-button-grid">
                    {categories.map(category => (
                      <button
                        key={category.name}
                        type="button"
                        className={`category-button ${activeCategoryIds.has(category.name) ? 'selected' : ''}`}
                        onClick={() => toggleCategoryActive(category.name)}
                      >
                        <span className="category-name">{category.name}</span>
                        <span className="category-count">({category.questionCount})</span>
                      </button>
                    ))}
                  </div>
                  <small>
                    {activeCategoryIds.size === 0 
                      ? 'No categories selected - all categories will be included'
                      : `${activeCategoryIds.size} category(ies) selected`
                    }
                  </small>
                </div>
              </div>
            )}
            
            {engagementType === 'trivia' && (
              <div className="form-group">
                <label>Timer (seconds per question):</label>
                <input
                  type="number"
                  value={triviaTimer}
                  onChange={(e) => setTriviaTimer(Math.max(10, Math.min(300, parseInt(e.target.value) || 30)))}
                  min="10"
                  max="300"
                  step="10"
                  className="dialog-input"
                />
                <small className="dialog-help-text">
                  Players will have {triviaTimer} seconds to answer each question.
                </small>
              </div>
            )}

            <div className="form-group">
              <label>
                <input
                  type="checkbox"
                  checked={randomizeQuestions}
                  onChange={(e) => setRandomizeQuestions(e.target.checked)}
                  className="dialog-checkbox"
                />
                Randomize Question Order
              </label>
              <small className="dialog-help-text">
                {randomizeQuestions
                  ? "Questions will be selected randomly from available categories"
                  : "Questions will be asked in order, completing each category before moving to the next"
                }
              </small>
            </div>

            {/* Checked against `engagementType` — this dialog's own type
                picker — not `currentGameType`, which still names whatever
                game is on screen until this new one is created. */}
            {anonymityApplies(engagementType) && (
              <div className="setup-section">
                <h3>Responses</h3>
                <label className="setup-toggle">
                  <input
                    type="checkbox"
                    checked={anonymousResponses}
                    onChange={(e) => setAnonymousResponses(e.target.checked)}
                  />
                  <span className="setup-toggle-label">Anonymous responses</span>
                </label>
                {/* Default ON, so this copy has to make an ALREADY-ACTIVE guarantee legible
                    to a host who never touches it. The second clause is the surprising one,
                    so it is stated rather than implied. */}
                <p className="setup-help">
                  Until voting closes, nobody sees who wrote which answer — not the room,
                  not you. The room votes on the answers, not on the people.
                </p>
                <p className="setup-help setup-help--muted">
                  {anonymousResponses
                    ? 'This hides names, not identities. In a small group, people may still recognise each other’s answers.'
                    : 'Every answer is labelled with its author from the moment voting opens.'}
                </p>
              </div>
            )}

            <div className="form-group">
              <label>AI Context (Optional):</label>
              <textarea
                value={gameAiContext}
                onChange={(e) => setGameAiContext(e.target.value)}
                placeholder="Describe your project, team context, or goals to help AI provide more relevant analysis (e.g., 'Building a new application to support engineering learning' or 'Team working on improving collaboration and communication')"
                className="dialog-textarea"
                rows="3"
                maxLength="500"
              />
              <small className="dialog-help-text">
                This helps AI provide more contextual analysis during the session. {gameAiContext.length}/500 characters
              </small>
            </div>

            <div className="form-group">
              <label htmlFor="new-game-persona">Workie's Voice (Optional):</label>
              <select
                id="new-game-persona"
                value={newGamePersonaId}
                onChange={(e) => setNewGamePersonaId(e.target.value)}
                className="dialog-select"
              >
                {/* Adapting to the session is the designed default, not a
                    fallback — a fixed persona is what made Workie refuse a
                    holiday icebreaker as "insufficient for business analysis". */}
                <option value="">Adapt to the session (recommended)</option>
                {personas.map((persona) => (
                  <option key={persona.personaId} value={persona.personaId}>
                    {persona.name}{persona.tagline ? ` — ${persona.tagline}` : ''}
                  </option>
                ))}
              </select>
              <small className="dialog-help-text">
                {newGamePersonaId
                  ? 'Workie will keep this voice for the whole session. You can change it mid-game.'
                  : 'Workie reads the room and picks its own register — playful for an icebreaker, analytical for a retro.'}
              </small>
            </div>
          </div>

          <div className="dialog-actions">
            <button 
              className="btn-secondary" 
              onClick={() => {
                setShowNewGameDialog(false);
                if (isLobbyState(gameState) && lessonNumber === 0) {
                  setShowWelcomeScreen(true);
                }
              }}
            >
              Cancel
            </button>
            <button 
              className="btn-primary" 
              onClick={handleStartNewGame}
              disabled={!newGameSetId || !eventTitle.trim()}
            >
              Create Engagement
            </button>
          </div>
        </div>
      </div>
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

  const hostControls = hostControlsFor({
    gameType: currentGameType,
    phase: hostPhase,
    roundNoun: getHostRoundNoun(),
    playerCount: players.length,
    answeredCount,
    votedCount: playersWhoVoted.length,
    answerCount: answers.length,
    hasQuestionSet: Boolean(selectedSetId),
  });

  // A keyboard shortcut must never fire underneath something the host is
  // reading or filling in.
  // The rule itself lives in utils/hostOverlays.js, where a test can reach it:
  // a PREVIEW must leave SPACE live, only a PINNED QR gates it.
  const anyOverlayOpen = shortcutsSuppressed({
    showConfirmModal, showQuestionBrowser, showExpandedQR,
    showReportsModal, lessonExpanded, isLoadingData, qrMode,
  });

  const runHostAction = (action) => {
    if (!action) return;
    // Advancing clears the room-facing chrome: the Game Info / How to Play
    // rails are inspection surfaces, not part of the round.
    closeAllSidePanels();
    // A pinned QR is chrome too -- advancing the round clears it the same way.
    setQrMode(null);
    switch (action.intent) {
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
        // Client-side beat: the round does not move, the stage does.
        setResultsBeat('field-notes');
        break;
      case HOST_INTENTS.REPORT:
        // generateReportForGame, not setShowFinalReport: `showFinalReport` is
        // a flag nothing renders (it only gates the keyboard shortcut), so
        // pointing ENDED's primary at it would have made the one control on
        // the last screen of the session do nothing at all.
        generateReportForGame(gameId, eventTitle);
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
    // is a roster of names, which RoomMeter refuses on purpose.
    return null;
  })();

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

  // DEBUG: Track every render with modal state
  console.log(`🎨 RENDER: showQuestionBrowser=${showQuestionBrowser}, showExpandedQR=${showExpandedQR}`);

  return (
    <>
    {/* No `rail-right-*` / `rail-left` classes any more: those reserved a
        300–600px gutter for whichever panel was open, and the stage is a
        fixed-height grid — shrinking it every time the host opened Game Info
        is the fastest possible way to make a state stop fitting. The panels
        are fixed and overlay; advancing closes them. */}
    <div className="main-layout">
      {/* Instructions Sidebar */}
      <div className={`instructions-sidebar ${instructionsVisible ? 'visible' : ''}`}>
        <div className="instructions-content">
          <h3>Engagements</h3>
          <h4>How to Play</h4>
          
          {currentGameType === 'call-and-answer' && (
            <>
              <ol>
                <li><strong>Read the Content:</strong> Each round presents a scenario, lesson, or strategic question.</li>
                <li><strong>Provide Your Response:</strong> Players write thoughtful responses based on their experience and perspective.</li>
                <li><strong>Vote for Best Responses:</strong> Everyone votes on which responses are most insightful or valuable.</li>
                <li><strong>Collaborative Learning:</strong> Share insights and learn from each other's diverse perspectives.</li>
              </ol>
              <h4>Tips</h4>
              <ul>
                <li>Be specific about your context and situation</li>
                <li>Think about practical implementation steps</li>
                <li>Consider potential challenges and solutions</li>
                <li>Vote for responses that inspire your own work</li>
              </ul>
            </>
          )}
          
          {currentGameType === 'trivia' && (
            <>
              <ol>
                <li><strong>Read the Question:</strong> Each round presents a multiple-choice trivia question.</li>
                <li><strong>Select Your Answer:</strong> Choose the best answer from the available options (A, B, C, D).</li>
                <li><strong>See Results:</strong> Discover the correct answer and see how everyone performed.</li>
                <li><strong>Learn Together:</strong> Discuss interesting facts and expand your knowledge as a team.</li>
              </ol>
              <h4>Tips</h4>
              <ul>
                <li>Read all options carefully before selecting</li>
                <li>Trust your first instinct if unsure</li>
                <li>Learn from incorrect answers - they often contain valuable information</li>
                <li>Discuss interesting questions afterward to reinforce learning</li>
              </ul>
            </>
          )}
          
          {currentGameType === 'poll' && (
            <>
              <ol>
                <li><strong>Read the Poll Question:</strong> Each round presents a topic for group input and discussion.</li>
                <li><strong>Select Your Choice:</strong> Choose from the available options that best represents your view.</li>
                <li><strong>See Group Results:</strong> View how the group collectively responded to the question.</li>
                <li><strong>Facilitate Discussion:</strong> Use results as a starting point for meaningful group conversations.</li>
              </ol>
              <h4>Tips</h4>
              <ul>
                <li>Consider all perspectives before choosing</li>
                <li>Some polls may allow multiple selections</li>
                <li>Use results to understand group dynamics and preferences</li>
                <li>Follow up with discussion to dive deeper into the topic</li>
              </ul>
            </>
          )}
          
          {/* User Info and Sign Out */}
          <div style={{ 
            marginTop: 'auto', 
            paddingTop: '20px', 
            borderTop: '1px solid #e5e5e5',
            display: 'flex',
            flexDirection: 'column',
            gap: '10px'
          }}>
            {currentUser && (
              <div style={{ fontSize: '14px', color: '#666' }}>
                <strong>{currentUser.attributes?.name || 'User'}</strong>
                <div>{currentUser.attributes?.email}</div>
                {currentUser.groups?.includes('admins') && (
                  <div style={{ color: '#007bff', fontWeight: '500' }}>Administrator</div>
                )}
              </div>
            )}
            <button 
              onClick={handleSignOut}
              style={{
                padding: '8px 16px',
                backgroundColor: '#f8f9fa',
                border: '1px solid #ddd',
                borderRadius: '4px',
                color: '#666',
                fontSize: '14px',
                cursor: 'pointer',
                width: '100%'
              }}
            >
              Sign Out
            </button>
          </div>
          
        </div>
      </div>
      <div className="instructions-tab" onClick={() => setInstructionsVisible(!instructionsVisible)}>
        <span>
          {instructionsVisible
            ? <><Icon name="CaretLeft" weight="bold" size={14} /> Close</>
            : <><Icon name="CaretRight" weight="bold" size={14} /> How to Play</>}
        </span>
      </div>

      {/* QR Code Sidebar */}
      <div className={`qr-sidebar ${qrSidebarVisible ? 'visible' : ''} ${selectedSetId ? 'two-column' : ''}`}>
        <div className="qr-sidebar-columns">
          {/* Left Column - Join Info */}
          <div className="qr-column-left">
            <div className="qr-content">
              <h3>Join In</h3>
              <div className="join-url">
                <p>Players can join at:</p>
                {sidebarCopyMessage && (
                  <div className="copy-message">
                    <Icon name="Check" weight="bold" size={14} color="var(--success)" /> Link copied!
                  </div>
                )}
                <div 
                  className="url-display clickable-url" 
                  onClick={() => copyUrlToClipboard(playUrl, 'sidebar')}
                  title="Click to copy link"
                >
                  {playUrl}
                </div>
              </div>
              <div className="game-id">Game ID: <strong>{gameId}</strong></div>
              <div className="connection-status">
                {useWebSocket ? (
                  <span className={`status-indicator websocket ${wsConnected ? 'connected' : 'connecting'}`}>
                    <Icon
                      name={wsConnected ? 'Broadcast' : 'WifiSlash'}
                      weight="bold"
                      size={15}
                      color={wsConnected ? 'var(--success)' : 'var(--muted)'}
                    />{' '}
                    WebSocket {wsConnected ? 'Connected' : 'Connecting...'}
                  </span>
                ) : (
                  <span className="status-indicator polling">
                    <Icon name="ArrowsClockwise" weight="bold" size={15} color="var(--muted)" /> HTTP Polling Mode
                  </span>
                )}
              </div>
              {/* NOT PART OF "JOIN IN", and the separator says so.
                  This QR points at /remote, which is behind the host sign-in.
                  Sitting under the Join In heading, one paragraph below "Players
                  can join at:", it read as the player QR — so a host pointing a
                  latecomer at "the QR in the Join In panel" sent that player to
                  a login for an account they do not have. The caption was always
                  right; the framing was not. */}
              <div className="qr-section qr-section--remote">
                <h4 className="qr-section-heading">Your remote &mdash; host only</h4>
                {/* The host's own phone, scanned from arm's length, so 180px is
                    plenty and there is nothing to magnify. The click-to-expand
                    is deliberately gone: the expanded overlay renders `playUrl`,
                    so leaving it here would open a magnified PLAYER QR on top of
                    a REMOTE one. The room-facing QR is the rail's now (Task 2). */}
                <div className="qr-code-static">
                  <QRCodeSVG value={remoteUrl} size={180} />
                  <p>Scan to open the remote on your phone. Not the player link.</p>
                </div>
              </div>

              {/* THE ROSTER, off the stage.
                  A count is a nudge; a list of names is an attendance record,
                  and the room is the wrong audience for one — so this is not
                  in the stage's meter. It is not deleted either: the anonymity
                  work depends on the host being able to see cumulative
                  standings in every phase (no points exist for an unrevealed
                  round, so a running total leaks nothing), and before this
                  there was nowhere else to see them. This panel is host-only
                  and closed by default. */}
              {players.length > 0 && (
                <div className="host-roster">
                  <h4>{`Standings · ${players.length} player${players.length === 1 ? '' : 's'}`}</h4>
                  <ul>
                    {calculatePlayerRankings(players).map((player) => {
                      const name = player.name || player.playerName || 'Unknown Player';
                      const done = gameState.startsWith('ASK#')
                        ? playersWhoAnswered.includes(player.name)
                        : gameState.startsWith('VOTE#')
                          ? playersWhoVoted.includes(player.name)
                          : null;
                      return (
                        <li key={name}>
                          <span className="host-roster-name">{name}</span>
                          <span className="host-roster-score">{`${player.score || 0} pts`}</span>
                          {done !== null && (
                            <Icon
                              name={done ? 'CheckCircle' : 'Timer'}
                              weight={done ? 'fill' : 'bold'}
                              size={16}
                              color={done ? 'var(--success)' : 'var(--muted)'}
                            />
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}
            </div>
            <div className="qr-controls">
              <button 
                className={`btn-${inviteCopied ? 'success' : 'primary'}`}
                onClick={createInvite}
                title="Copy meeting invitation to clipboard"
              >
                <Icon name={inviteCopied ? 'Check' : 'ClipboardText'} weight="bold" size={16} /> {inviteCopied ? 'Copied!' : 'Copy Invite'}
              </button>
              {/* WHICH DISPLAY, not whether. This replaces the Big Screen ON/OFF
                  toggle: there is one layout now, and this chooses the type
                  ladder it is drawn at. Room and Table are inferred from the
                  viewport on first load; TV and Call cannot be detected in
                  principle — nothing reports a panel's physical size, and
                  nothing reports that the surface is being re-encoded into a
                  video call — so they are chosen here. The choice is persisted,
                  because a projector browser that reloads must come back
                  exactly as it was. The Console (spec §5.4) owns this
                  permanently; this is its interim home. */}
              <label className="display-profile-picker">
                <span>Display</span>
                <select
                  value={profile}
                  onChange={(e) => setProfile(e.target.value)}
                  title="The type ladder the stage is drawn at"
                >
                  <option value="room">Room — projector</option>
                  <option value="tv">TV — large panel</option>
                  <option value="call">Call — screen share</option>
                  <option value="table">Table — laptop</option>
                </select>
              </label>
              <button className="btn-secondary" onClick={handleViewReports}>
                View Reports
              </button>
              
              {/* GitHub Issue Reporting in Sidebar */}
              <div style={{ marginTop: '16px', display: 'flex', justifyContent: 'center' }}>
                <IssueFab context="host" gameId={gameId} />
              </div>
              <button className="btn-danger" onClick={handleSwitchGame}>
                Switch Game
              </button>
              
              {/* User Info and Sign Out */}
              {currentUser && (
                <div style={{ 
                  marginTop: '16px',
                  padding: '12px',
                  backgroundColor: '#f8f9fa',
                  borderRadius: '4px',
                  fontSize: '12px'
                }}>
                  <div style={{ marginBottom: '8px', color: '#666' }}>
                    <strong>{currentUser.attributes?.name || 'User'}</strong>
                    {currentUser.groups?.includes('admins') && (
                      <div style={{ color: '#007bff', fontWeight: '500' }}>Admin</div>
                    )}
                  </div>
                  <button 
                    onClick={handleSignOut}
                    style={{
                      padding: '6px 12px',
                      backgroundColor: '#fff',
                      border: '1px solid #ddd',
                      borderRadius: '3px',
                      color: '#666',
                      fontSize: '12px',
                      cursor: 'pointer',
                      width: '100%'
                    }}
                  >
                    Sign Out
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Right Column - Question Set Info */}
          {selectedSetId && (
            <div className="qr-column-right">
              <div className="question-set-panel">
                <div className="question-set-header">
                  <h3>
                <Icon name="Books" weight="duotone" size={20} color="var(--primary)" />
                {questionSets.find(set => set.id === selectedSetId)?.name || 'Unknown Set'}
                <SetImageBadge hasImages={questionSets.find(set => set.id === selectedSetId)?.hasImages} />
              </h3>
                  <div className="set-details">
                    {categoryCounts ? (
                      // Show dynamic total for active games
                      categories.reduce((total, category, index) => {
                        const position = index + 1;
                        let enabled = false;
                        let remaining = 0;
                        
                        // Check if category is enabled from bitmasks
                        if (position <= 8) {
                          enabled = categoryBitmasks['HostMask1-8']?.charAt(position - 1) === '1';
                          remaining = categoryCounts['1-8']?.[position - 1] || 0;
                        } else if (position <= 16) {
                          enabled = categoryBitmasks['HostMask9-16']?.charAt(position - 9) === '1';
                          remaining = categoryCounts['9-16']?.[position - 9] || 0;
                        } else if (position <= 24) {
                          enabled = categoryBitmasks['HostMask17-24']?.charAt(position - 17) === '1';
                          remaining = categoryCounts['17-24']?.[position - 17] || 0;
                        }
                        
                        // Only count questions from enabled categories
                        return enabled ? total + remaining : total;
                      }, 0)
                    ) : (
                      // Show static total for game setup
                      questionSets.find(set => set.id === selectedSetId)?.totalQuestions || 0
                    )} questions remaining
                  </div>
                </div>
                
                {categories.length > 0 && (
                  <div className="categories-section">
                    <h4>Categories</h4>
                    <div className="category-items-list">
                      {categories.map((category, index) => {
                        const position = index + 1;
                        let enabled = false;
                        let questionCount = category.questionCount;
                        let isClickable = false;

                        // For active games with dynamic counts, get live data
                        if (categoryCounts && categoryBitmasks) {
                          // Determine enabled state from bitmasks
                          if (position <= 8) {
                            enabled = categoryBitmasks['HostMask1-8']?.charAt(position - 1) === '1';
                            questionCount = categoryCounts['1-8']?.[position - 1] || 0;
                          } else if (position <= 16) {
                            enabled = categoryBitmasks['HostMask9-16']?.charAt(position - 9) === '1';
                            questionCount = categoryCounts['9-16']?.[position - 9] || 0;
                          } else if (position <= 24) {
                            enabled = categoryBitmasks['HostMask17-24']?.charAt(position - 17) === '1';
                            questionCount = categoryCounts['17-24']?.[position - 17] || 0;
                          }
                          isClickable = true;
                        } else {
                          // For game setup, use static selection
                          enabled = activeCategoryIds.has(category.name);
                        }

                        return (
                          <div key={category.name} className="category-item">
                            <button
                              type="button"
                              className={`category-button ${enabled ? 'selected' : ''} ${questionCount === 0 ? 'exhausted' : ''}`}
                              onClick={() => {
                                if (isClickable) {
                                  console.log(`🔘 Category toggle clicked: position=${position}, name=${category.name}, enabled=${enabled}, remaining=${questionCount}`);
                                  toggleCategoryDuringGame(position.toString(), category.name, !enabled);
                                } else {
                                  toggleCategoryActive(category.name);
                                }
                              }}
                              disabled={isTogglingCategory}
                            >
                              <span className="category-name">{category.name}</span>
                              <span className="category-count">({questionCount})</span>
                            </button>
                            <button
                              type="button"
                              className="category-browse-btn"
                              onClick={(e) => {
                                console.log(`🖱️ Browse button clicked for category: ${category.name}`);
                                e.stopPropagation();
                                openQuestionBrowser(category.name);
                              }}
                              title={`Browse questions in ${category.name} category`}
                            >
                              <Icon name="MagnifyingGlass" weight="bold" size={16} />
                            </button>
                          </div>
                        );
                      })}
                    </div>
                    {!categoryCounts && (
                      <small>
                        {activeCategoryIds.size === 0 
                          ? 'No categories selected - all categories will be included'
                          : `${activeCategoryIds.size} category(ies) selected`
                        }
                      </small>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
      <div className="qr-tab" onClick={() => setQrSidebarVisible(!qrSidebarVisible)}>
        <span>
          {qrSidebarVisible
            ? <>Hide <Icon name="CaretRight" weight="bold" size={14} /></>
            : <><Icon name="CaretLeft" weight="bold" size={14} /> Game Info</>}
        </span>
      </div>
      
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
          authorsRevealed, authorsHiddenOnStage,
          loadingAIInsights, currentAIInsights ? 1 : 0,
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
          ? <RoomMeter phase={hostPhase} heading={meter.heading} body={meter.body} complete={everybodyIn} />
          : null}
        dock={(
          <Dock
            status={dockStatus}
            hint={dockHint}
            kbd={dockKbd}
            onSetup={() => setQrSidebarVisible((open) => !open)}
            complete={everybodyIn}
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
              1  early-reveal / fn-controls   host-only controls
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
                {anonymityApplies(currentGameType) && anonymousUntilReveal && (
                  <p className="anon-line" data-drop="3" data-drop-note="Anonymity note">
                    <b>Answers are anonymous.</b> Nobody sees who wrote what — the
                    host included — until voting closes.
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
                  onClick={() => setLessonExpanded(true)}
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
                {(currentQuestion.questionDetail || currentQuestion.detail || currentQuestion.topic) && (
                  <p className="qdetail" data-drop="4" data-drop-note="Full prompt">
                    {currentGameType === 'wavelength' && currentQuestion.topic
                      ? currentQuestion.topic
                      : (currentQuestion.questionDetail || currentQuestion.detail)}
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
                {/* Every response, at once. What used to be here was a
                    one-at-a-time carousel with ‹ › arrows: it asked a room to
                    vote on a list it could only ever see one line of, and
                    asked the host to drive it while the room waited. */}
                <div className="cards">
                  {answers.map((answer, idx) => (
                    <div key={idx} className="card">
                      <div className="body">
                        <div className="ans">{`“${answer.answer}”`}</div>
                        <span className={`who ${authorsRevealed ? 'revealed' : 'anon'}`}>
                          {displayLabelFor(answer, idx)}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}

            {/* THE REVEAL, in the only phases where it means anything.
                AuthorsRevealed flips by itself when voting closes, so
                POST /reveal-authors is load-bearing exactly here — a host who
                wants the names on screen BEFORE the vote closes. Unlike the
                RESULTS toggle this is not cosmetic; it ends the round's
                anonymity for the whole room and cannot be undone, so the copy
                says so.

                It is host-only chrome, so it is droppable — and it is
                data-drop="1", the FIRST thing sacrificed on a dense ASK or
                VOTE, ahead of every room-facing line. It shipped at "4" once,
                which sorted it after the question's full prompt and after the
                VOTE recap: a dense round threw away the one sentence telling
                the room what it was voting about and kept a button only the
                host can press, plus two lines explaining it. */}
            {(hostPhase === 'ASK' || hostPhase === 'VOTE')
              && anonymityActive({ gameType: currentGameType, anonymousUntilReveal })
              && !authorsRevealed
              && answers.length > 0 && (
              <div className="early-reveal" data-drop="1">
                <button className="reveal-authors-btn" onClick={handleRevealAuthors}>
                  Reveal Authors
                </button>
                <p className="early-reveal-help">
                  Shows who wrote each response to everyone, now, instead of waiting for
                  voting to close. This cannot be undone.
                </p>
              </div>
            )}

            {hostPhase === 'RESULTS' && (
              <>
                <div className="kicker">
                  {`${getHostRoundNoun()} ${lessonNumber} · Results`}
                </div>

                {/* A PROJECTOR CONTROL, NOT A REVEAL. By the time RESULTS is on
                    screen the round is already revealed (get-results.js's
                    enterResultsState) and every row here carries its author, so
                    there is nothing left to fetch — this only decides whether
                    the room sees the names right now. It calls no endpoint. */}
                {/* NOT DROPPABLE, deliberately, and the one control here that
                    is not. On RESULTS the meter runs solo, so this was the
                    only data-drop group on the state — the first and only
                    thing the fitter sacrificed before the terminal clamp, with
                    no data-drop-note to say it had gone. Losing it while
                    `authorsHiddenOnStage` is false leaves every author's name
                    on the projector with no way to take it down. The
                    early-reveal control on ASK/VOTE stays droppable because
                    losing it fails safe in the other direction: it can only
                    ever reveal names, never strand them. */}
                {anonymityActive({ gameType: currentGameType, anonymousUntilReveal }) && (
                  <button
                    className="stage-authors-toggle"
                    onClick={() => setAuthorsHiddenOnStage((h) => !h)}
                  >
                    {authorsHiddenOnStage ? 'Show authors' : 'Hide authors'}
                  </button>
                )}

                {/* WHAT THIS STATE NO LONGER SHOWS, RECORDED.
                    Trivia's `trivia-player-scores` (every player, their
                    answer, isCorrect, +points and running total) and
                    wavelength's `wavelength-player-list` are both gone, and
                    neither is coming back in this shape: each is a list of
                    names with a score beside it, and the stage's binding
                    constraint is that it never names a person. What replaces
                    them is not decided here — 07-results-trivia's own answer is
                    a Standings roster in the meter, which RoomMeter refuses by
                    test for the same reason. That conflict is real and it is
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
                  /* `stage` drops the white card, the panel's own name and the
                     duplicate word list, and lets styles/stage.css cap the
                     drawing so it cannot be clipped by .content's overflow.
                     The cloud itself is unchanged and still provisional —
                     .terms replaces it in plan 4. */
                  <WavelengthWordCloud
                    stage
                    answers={answers}
                    promptWord={currentQuestion?.topic || currentQuestion?.title || 'WAVELENGTH'}
                    gameState={gameState}
                  />
                ) : (
                  <div className="cards">
                    {answers.map((answer, idx) => {
                      const points = answer.points || 0;
                      const player = players.find((p) => p.name === answer.player);
                      // The stage toggle beats the row here: these rows always
                      // carry their author by the time RESULTS is showing.
                      const displayName = stageLabelFor(answer, idx, { authorsHidden: authorsHiddenOnStage });
                      // Attribution by arithmetic: a score that jumps names its
                      // author as surely as a label would, so hiding the names
                      // takes the arithmetic with it or the button is
                      // decorative. Cumulative standings stay off the stage
                      // entirely — a list of names is an attendance record.
                      const showPoints = standingsVisible({
                        gameType: currentGameType,
                        anonymousUntilReveal,
                        authorsRevealed: !authorsHiddenOnStage,
                      });
                      return (
                        <div key={idx} className={`card ${answer.placement === 1 ? 'lead' : ''}`}>
                          <span className="rank">{answer.placement || '·'}</span>
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
              </>
            )}

            {hostPhase === 'FIELD_NOTES' && (
              <>
                <div className="kicker">What we heard</div>
                {loadingAIInsights ? (
                  <p className="qdetail">Workie is reading the responses…</p>
                ) : currentAIInsights ? (
                  // `two` is the mockup's own two-column Field Notes grid
                  // (09-field-notes): width is the cheapest lever on the
                  // stage, and this state needs it most. It only applies to
                  // the structured path, which has two children to split. The
                  // markdown path is ONE child, so a two-column grid would
                  // squeeze it into half the stage; stage.css splits that one
                  // with CSS columns instead.
                  <div className={`notes${currentAIInsights.markdownResponse ? '' : ' two'}`}>
                    {currentAIInsights.markdownResponse ? (
                      <MarkdownRenderer
                        content={currentAIInsights.markdownResponse}
                        className="notes-md"
                      />
                    ) : (
                      <>
                        <p className="lead">{currentAIInsights.summary}</p>
                        <ol>
                          {(currentAIInsights.discussionTopics || []).map((topic, idx) => (
                            <li key={idx}><b>{idx + 1}</b><span>{topic}</span></li>
                          ))}
                          {(currentAIInsights.nextSteps || []).map((step, idx) => (
                            <li key={`n${idx}`}><b>→</b><span>{step}</span></li>
                          ))}
                        </ol>
                      </>
                    )}
                  </div>
                ) : (
                  <p className="qdetail">
                    Nothing to read back yet — this fills in once responses are in.
                  </p>
                )}

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
                <p className="qdetail">
                  {`${players.length} in the room · the full write-up is in the session report`}
                </p>
              </>
            )}

          </div>
          {/* What the fitter sacrificed, said out loud. Never a silent cut. */}
          <p className="reduced" hidden />
        </div>
      </Stage>

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
        <div className="expanded-lesson-overlay" onClick={() => setLessonExpanded(false)}>
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
            {currentGameType === 'wavelength' && (questions[0].topic || questions[0].detail) && (
              <div className="expanded-lesson-detail wavelength-topic-expanded">
                {questions[0].topic
                  ? (<><strong>Topic:</strong> {questions[0].topic}</>)
                  : questions[0].detail}
              </div>
            )}
            <div className="expanded-lesson-prompt">
              <strong>{getHostInstructionText(currentQuestionOf(questions, currentQuestionId))}</strong>
            </div>
          </div>
        </div>
      )}
      
      {/* Custom Confirmation Modal */}
      {showConfirmModal && (
        <div className="expanded-qr-overlay" onClick={confirmModalProps.onCancel}>
          <div className="expanded-qr-content confirmation-modal" onClick={(e) => e.stopPropagation()}>
            <div className="confirmation-header">
              <h2>{confirmModalProps.title}</h2>
            </div>
            <div className="confirmation-message">
              {confirmModalProps.message}
            </div>
            <div className="dialog-actions">
              <button 
                className="btn-secondary" 
                onClick={confirmModalProps.onCancel}
              >
                Cancel
              </button>
              <button 
                className="btn-primary" 
                onClick={confirmModalProps.onConfirm}
              >
                {confirmModalProps.confirmText}
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
    
    {/* MODAL PORTAL - OUTSIDE ALL PARALLAX CONTAINERS */}
    {showQuestionBrowser && (
      <div style={{
        position: 'fixed',
        top: 0,
        left: 0,
        width: '100vw',
        height: '100vh',
        backgroundColor: 'rgba(0, 0, 0, 0.8)',
        zIndex: 999999,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center'
      }}>
        <div className="question-browser-modal">
          <div className="question-browser-header">
            <h2><Icon name="MagnifyingGlass" weight="duotone" size={22} color="var(--primary)" />Browse Questions — {selectedCategory}</h2>
            <p className="question-count">{browsingQuestions?.length || 0} questions found</p>
          </div>
          
          {loadingQuestions ? (
            <div className="loading-indicator">
              <div className="spinner"></div>
              <span>Loading questions...</span>
            </div>
          ) : browsingQuestions?.length > 0 ? (
            <div className="questions-table-container">
              <table className="questions-table">
                <thead>
                  <tr>
                    <th>Question</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {browsingQuestions.map((question, index) => (
                    <tr key={question.id || index} className="question-row">
                      <td className="question-cell">
                        <div className="question-title">{question.title || question.Title}</div>
                        {(question.questionDetail || question.QuestionDetail || question.detail || question.Detail || question.customInstructions || question.CustomInstructions) && (
                          <div className="question-detail">
                            {question.questionDetail || question.QuestionDetail || question.detail || question.Detail || question.customInstructions || question.CustomInstructions}
                          </div>
                        )}
                        {(question.optionA || question.OptionA) && (
                          <div className="question-options">
                            <div>A) {question.optionA || question.OptionA}</div>
                            <div>B) {question.optionB || question.OptionB}</div>
                            <div>C) {question.optionC || question.OptionC}</div>
                            <div>D) {question.optionD || question.OptionD}</div>
                            {(question.correctAnswer || question.CorrectAnswer) && (
                              <div className="correct-answer"><Icon name="CheckCircle" weight="fill" size={14} color="var(--success)" /> Correct: {question.correctAnswer || question.CorrectAnswer}</div>
                            )}
                          </div>
                        )}
                      </td>
                      <td className="action-cell">
                        <button 
                          className="btn-primary select-question-btn"
                          onClick={() => selectQuestion(question)}
                          title="Select this question as the next question"
                        >
                          Select
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="no-questions">
              <p>No questions found for the "{selectedCategory}" category.</p>
              <p>Try browsing a different category or check your question sets.</p>
            </div>
          )}
          
          <div className="question-browser-footer">
            <button 
              className="btn-secondary"
              onClick={() => setShowQuestionBrowser(false)}
            >
              Close Browser
            </button>
          </div>
        </div>
      </div>
    )}
    </>
  );
}

// Game Report Component
function GameReport({ reportData, onClose }) {
  const { gameId, eventTitle, players, questions, allAnswers, allVotes } = reportData;
  // Same round noun the live screens use. resolveRoundNoun() identifies an art
  // round by a non-empty `image`/`Image` on the question — art is not a game
  // type, so the artwork is the only signal. create-report.js projects `image`
  // onto questionData for exactly this; if it is ever absent the helper simply
  // falls back to the game type's noun, so the report degrades to "Round"
  // rather than breaking.
  const reportRoundNoun = (questionData) =>
    resolveRoundNoun(questionData, reportData.gameType, reportData.roundNoun);

  // The header counts the whole set, so it must not judge by question 1 alone —
  // a set whose first question happens to carry no image would be headed
  // "3 Rounds" while every row beneath it said "Artwork".
  const headerSampleQuestion =
    (questions || []).map((q) => q?.questionData).find((q) => (q?.image || q?.Image || '').trim())
    || questions?.[0]?.questionData;
  const [isSaving, setIsSaving] = useState(false);
  const [showSaveReportModal, setShowSaveReportModal] = useState(false);
  const [saveModalData, setSaveModalData] = useState(null);
  const [saveAsPermanent, setSaveAsPermanent] = useState(false);
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [confirmModalProps, setConfirmModalProps] = useState({
    title: '',
    message: '',
    confirmText: 'Proceed',
    onConfirm: () => {},
    onCancel: () => {}
  });

  const initiateSaveReport = () => {
    setShowSaveReportModal(true);
  };
  
  const saveReportToPDF = async (permanent = false) => {
    if (isSaving) return;
    
    setIsSaving(true);
    setShowSaveReportModal(false);
    try {
      // Generate PDF from the report content
      const element = document.querySelector('.report-container');
      
      const opt = {
        margin: [0.5, 0.5, 0.5, 0.5],
        filename: `${eventTitle.replace(/[^a-zA-Z0-9\s-]/g, '').replace(/\s+/g, '-')}-${new Date().toISOString().split('T')[0]}.pdf`,
        image: { type: 'jpeg', quality: 0.98 },
        html2canvas: { 
          scale: 2,
          useCORS: true,
          letterRendering: true,
          scrollX: 0,
          scrollY: 0
        },
        jsPDF: { 
          unit: 'in', 
          format: 'letter', 
          orientation: 'portrait' 
        }
      };

      // Generate PDF as blob
      const pdfBlob = await html2pdf().set(opt).from(element).outputPdf('dataurlstring');
      
      // Extract base64 data
      const base64Data = pdfBlob.split(',')[1];
      
      // Send to backend for S3 storage
      const response = await fetch(`${API_BASE}games/${gameId}/save-report`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          gameId,
          eventTitle,
          pdfBlob: base64Data,
          permanent: permanent
        })
      });
      
      if (!response.ok) {
        throw new Error('Failed to save report');
      }
      
      const result = await response.json();
      
      // Store result for success modal
      setSaveModalData(result);
      
      // Show appropriate notification based on save type
      const message = permanent 
        ? 'Report saved permanently! Your report will be kept for 1 year.'
        : 'Report saved! Download link expires in 24 hours.';
      
      setConfirmModalProps({
        title: 'Report Saved Successfully',
        message: `${message}\n\nWould you like to download the report now?`,
        confirmText: 'Download Now',
        cancelText: 'Copy Link',
        onConfirm: () => {
          window.open(result.downloadUrl, '_blank');
          setShowConfirmModal(false);
        },
        onCancel: () => {
          navigator.clipboard.writeText(result.downloadUrl).then(() => {
            // Show brief success message
            const successDiv = document.createElement('div');
            successDiv.className = 'clipboard-success';
            successDiv.textContent = 'Download link copied to clipboard!';
            document.body.appendChild(successDiv);
            setTimeout(() => successDiv.remove(), 3000);
          }).catch(() => {
            // Fallback: show the URL in an input for manual copying
            const input = document.createElement('input');
            input.value = result.downloadUrl;
            input.select();
            document.execCommand('copy');
          });
          setShowConfirmModal(false);
        }
      });
      setShowConfirmModal(true);
      
    } catch (error) {
      console.error('Error saving report:', error);
      alert('Failed to save report. Please try again.');
    } finally {
      setIsSaving(false);
    }
  };


  return (
    <>
    <div className="report-container">
      <div className="report-header">
        <h2 className="report-title">Engagements Game Report</h2>
        
        <div className="report-summary">
          <h3>{eventTitle}</h3>
          <div className="report-date">
            {new Date().toLocaleDateString('en-US', { 
              weekday: 'long', 
              year: 'numeric', 
              month: 'long', 
              day: 'numeric' 
            })}
          </div>
          <div className="report-meta">
            <span>Game ID: <strong>{gameId}</strong></span>
            <span>{players.length} Player{players.length !== 1 ? 's' : ''}</span>
            <span>
              {questions.length}{' '}
              {pluralRoundNoun(reportRoundNoun(headerSampleQuestion), questions.length)}
            </span>
          </div>
        </div>
        
        <div className="report-header-actions">
          <button 
            className="btn-primary" 
            onClick={initiateSaveReport}
            disabled={isSaving}
          >
            {isSaving ? 'Saving...' : 'Save Report'}
          </button>
          <button className="btn-secondary report-close" onClick={onClose}>
            <Icon name="ArrowLeft" weight="bold" size={16} /> Back to Game
          </button>
        </div>
      </div>

      <div className="report-content">
        {questions.map((question, qIdx) => {
          // Extract question data from backend format
          const questionNumber = question.questionNumber;
          const questionData = question.questionData || {};
          const questionAnswers = question.answers || [];
          const aiSummary = question.aiSummary;
          
          // Calculate rankings from backend data
          const rankedAnswers = questionAnswers.sort((a, b) => b.totalScore - a.totalScore);
          const topAnswers = rankedAnswers.slice(0, 3); // Show top 3
          
          return (
            <div key={questionNumber} className="report-question">
              <div className="report-question-header">
                <h3 className="report-lesson-heading">
                  {reportRoundNoun(questionData)} {qIdx + 1} - {questionData.title || `${reportRoundNoun(questionData)} ${questionNumber}`}
                </h3>
                <div className="field-badge">{questionData.category || 'General'}</div>
              </div>
              
              {questionData.detail && (
                <div className="report-lesson-detail">
                  {questionData.detail}
                </div>
              )}
              
              {/* Trivia Question Options - show choices with correct answer marked */}
              {reportData.gameType === 'trivia' && (
                <div className="report-trivia-choices">
                  <h4>Answer Choices:</h4>
                  <div className="trivia-options-report">
                    {['A', 'B', 'C', 'D', 'E', 'F'].map(letter => {
                      const optionField = `option${letter}`;
                      const optionText = questionData[optionField];
                      if (!optionText) return null;
                      
                      // Check if this option is the correct answer
                      const correctAnswer = questionData.correctAnswer || questionData.CorrectAnswer;
                      const isCorrect = correctAnswer === `Option${letter}` || correctAnswer === optionText;
                      
                      return (
                        <div key={letter} className={`trivia-option-report ${isCorrect ? 'correct-answer' : ''}`}>
                          <span className="option-letter">{letter})</span>
                          <span className="option-text">{optionText}</span>
                          {isCorrect && <span className="correct-indicator"><Icon name="CheckCircle" weight="fill" size={14} color="var(--success)" /> Correct Answer</span>}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
              
              {/* AI Summary for this question */}
              {aiSummary && (
                <div className="report-ai-summary">
                  <h4><Icon name="Sparkle" weight="duotone" size={18} color="var(--primary)" />AI Analysis</h4>
                  
                  <div className="report-ai-content">
                    {aiSummary.markdownResponse ? (
                      // Use Markdown renderer if available
                      <MarkdownRenderer 
                        content={aiSummary.markdownResponse} 
                        className="report-ai-markdown"
                      />
                    ) : (
                      // Fallback to structured display
                      <>
                        {/* Summary */}
                        {aiSummary.summaryText && (
                          <div className="report-ai-text">
                            <h5>Summary</h5>
                            <p>{aiSummary.summaryText}</p>
                          </div>
                        )}
                        
                        {/* Conversation Starters */}
                        {aiSummary.discussionQuestions && aiSummary.discussionQuestions.length > 0 && (
                          <div className="report-ai-discussion">
                            <h5>Conversation Starters</h5>
                            <ul>
                              {aiSummary.discussionQuestions.map((discussionQuestion, idx) => (
                                <li key={idx}>{discussionQuestion}</li>
                              ))}
                            </ul>
                          </div>
                        )}
                        
                        {/* Next Steps */}
                        {aiSummary.nextSteps && aiSummary.nextSteps.length > 0 && (
                          <div className="report-ai-steps">
                            <h5>Next Steps</h5>
                            <ul>
                              {aiSummary.nextSteps.map((step, idx) => (
                                <li key={idx}>{step}</li>
                              ))}
                            </ul>
                          </div>
                        )}
                      </>
                    )}
                  </div>
                </div>
              )}
              
              <div className="report-answers">
                <h4>Player Applications:</h4>
                {questionAnswers.length > 0 ? (
                  questionAnswers.map((answer, aIdx) => (
                    <div key={aIdx} className={`report-answer ${answer.rank <= 3 ? 'winner' : ''}`}>
                      {answer.rank <= 3 && (
                        <div className="winner-badge">{answer.rankDisplay}</div>
                      )}
                      <div className="answer-text">"{answer.answerText}"</div>
                      <div className="answer-meta">
                        <span className="answer-author">by {answer.playerName}</span>
                        <span className="answer-points">{answer.totalScore} point{answer.totalScore !== 1 ? 's' : ''}</span>
                        <span className="answer-breakdown">({answer.voteBreakdown})</span>
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="no-answers">No answers recorded for this question.</div>
                )}
              </div>
            </div>
          );
        })}
        
        <div className="report-final-scores">
          <h3>Final Scores</h3>
          <div className="score-grid">
            {(() => {
              // Debug logging to understand data structure
              console.log('🔍 Players data in report:', players);
              console.log('🔍 Sample player:', players[0]);
              
              // Map backend player data to expected format for calculatePlayerRankings
              const playersWithScore = players.map(player => ({
                ...player,
                name: player.playerName || player.name,
                score: player.totalScore || player.score || 0
              }));
              
              console.log('🔍 Players with score mapping:', playersWithScore);
              
              const rankedPlayers = calculatePlayerRankings(playersWithScore);
              console.log('🔍 Ranked players:', rankedPlayers);
              const highestScore = rankedPlayers[0]?.score || 0;
              
              return rankedPlayers.map((player, idx) => {
                const isChampion = (player.score || 0) === highestScore;
                const rankIcon = <RankIcon rank={player.rank} size={18} />;
                return (
                  <div key={player.name} className={`score-item ${isChampion ? 'champion' : ''}`}>
                    {isChampion && <div className="champion-badge"><Icon name="Trophy" weight="duotone" size={16} color="var(--primary)" /> Session Champion</div>}
                    <div className="player-name">{rankIcon} #{player.rank} {player.name}</div>
                    <div className="player-final-score">{player.score || 0} points</div>
                  </div>
                );
              });
            })()}
          </div>
        </div>
      </div>
    </div>
      
      {/* Save Report Modal */}
      {showSaveReportModal && (
        <div className="expanded-qr-overlay" onClick={() => setShowSaveReportModal(false)}>
          <div className="expanded-qr-content save-report-modal" onClick={(e) => e.stopPropagation()}>
            <div className="confirmation-header">
              <h2>Save Report Options</h2>
            </div>
            <div className="save-report-content">
              <p className="save-description">
                Choose how you'd like to save this report:
              </p>
              
              <div className="save-option">
                <input 
                  type="radio" 
                  id="save-temporary" 
                  name="saveType" 
                  checked={!saveAsPermanent}
                  onChange={() => setSaveAsPermanent(false)}
                />
                <label htmlFor="save-temporary">
                  <strong>Temporary Save (24 hours)</strong>
                  <span className="save-option-desc">Report will be automatically deleted after 24 hours</span>
                </label>
              </div>
              
              <div className="save-option">
                <input 
                  type="radio" 
                  id="save-permanent" 
                  name="saveType" 
                  checked={saveAsPermanent}
                  onChange={() => setSaveAsPermanent(true)}
                />
                <label htmlFor="save-permanent">
                  <strong>Permanent Save (1 year)</strong>
                  <span className="save-option-desc">Report will be kept for 1 year for future reference</span>
                </label>
              </div>
            </div>
            
            <div className="dialog-actions">
              <button 
                className="btn-secondary" 
                onClick={() => setShowSaveReportModal(false)}
              >
                Cancel
              </button>
              <button 
                className="btn-primary" 
                onClick={() => saveReportToPDF(saveAsPermanent)}
                disabled={isSaving}
              >
                {isSaving ? 'Saving...' : 'Save Report'}
              </button>
            </div>
          </div>
        </div>
      )}
      
      {/* Success Confirmation Modal */}
      {showConfirmModal && (
        <div className="expanded-qr-overlay" onClick={confirmModalProps.onCancel}>
          <div className="expanded-qr-content confirmation-modal" onClick={(e) => e.stopPropagation()}>
            <div className="confirmation-header">
              <h2>{confirmModalProps.title}</h2>
            </div>
            <div className="confirmation-message">
              {confirmModalProps.message}
            </div>
            <div className="dialog-actions">
              <button 
                className="btn-secondary" 
                onClick={confirmModalProps.onCancel}
              >
                {confirmModalProps.cancelText || 'Cancel'}
              </button>
              <button 
                className="btn-primary" 
                onClick={confirmModalProps.onConfirm}
              >
                {confirmModalProps.confirmText}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

export default GameHostPage;