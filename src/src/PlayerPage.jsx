import React, { useState, useEffect, useRef } from 'react';
import webSocketClient from './WebSocketClient';
import IssueFab from './components/IssueFab';
import Icon from './components/Icon';
import RankIcon, { rankLabel, VOTE_POSITIONS } from './components/RankIcon';
import { gameTypeMeta } from './config/gameTypes';
import { resolveInstruction, resolveRoundNoun } from './config/instructions';
import { displayLabelFor, ownAnswerIndex } from './config/anonymity';
import {
  participationUrl, participationFrom, nextParticipation,
} from './utils/playerParticipation';
import JoinNameCollision from './components/JoinNameCollision';
import AnswerSpotlight from './components/AnswerSpotlight';
import { getClientId, classifyJoinFailure } from './components/joinResult';

const API_BASE = window.API_BASE;

// `fetchQuestionSetInstruction` runs on every question, and the only endpoint
// that carries a set's customInstruction/roundNoun is the FULL /question-sets
// list. That was O(questions) full-list downloads per player per game. The
// metadata cannot change mid-game, so resolve each setId once and share the
// answer across every player component instance. The value is the in-flight
// promise, so N questions arriving together still make one request.
const questionSetMetaCache = new Map();

const loadQuestionSetMeta = (setId) => {
  const cached = questionSetMetaCache.get(setId);
  if (cached) return cached;

  const pending = (async () => {
    const response = await fetch(`${API_BASE}question-sets`);
    if (!response.ok) throw new Error(`question-sets returned ${response.status}`);
    const data = await response.json();
    const questionSet = data.sets?.find((set) => set.id === setId);
    return {
      customInstruction: questionSet?.customInstruction || null,
      roundNoun: questionSet?.roundNoun || null,
    };
  })();

  // Never cache a failure: a transient network error would otherwise wedge the
  // player on the default instruction for the rest of the game.
  pending.catch(() => questionSetMetaCache.delete(setId));

  questionSetMetaCache.set(setId, pending);
  return pending;
};

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

// Helper function to get instruction text.
// The game type used to be hardcoded to 'call-and-answer', so poll and survey
// never saw their own default — pass the real type.
const getPlayerInstructionText = (customInstruction, currentQuestion, gameType) =>
  resolveInstruction(currentQuestion, customInstruction, gameType);

/**
 * WHICH RANK CURRENTLY HOLDS THIS ANSWER — the one rule both ballots read.
 *
 * `votes` is a single object, `{ first, second, third }`, holding BALLOT INDICES
 * AS STRINGS (the `<option value>` a select hands back). The quick ballot and
 * the detailed ballot are that one object rendered twice, and this is the
 * question each of them asks of it. It used to be asked twice, differently: the
 * detailed view had a private `getVotePosition`, and the quick view re-derived
 * it inline with `Object.values(votes).includes(...)` — which answers "is it
 * ranked?" but not "where?", and so could not annotate anything or agree with
 * the other view about it.
 *
 * `String(answerIndex)` because callers hold the index as a number (the map
 * index) while `votes` holds it as a string. `0 === '0'` is false, and that
 * mismatch would silently mean "answer 0 is never ranked anywhere".
 *
 * No "and the slot is not empty" guard, though an empty slot holds '' and every
 * caller passes a real ballot index: `String(idx)` is never '', so such a guard
 * can never change an answer. It was written, a mutation removing it survived
 * the whole suite, and it was deleted rather than covered — an unreachable
 * clause reads as a protection that is not there.
 */
const RANK_SLOTS = ['first', 'second', 'third'];

export const rankHolding = (votes, answerIndex) =>
  RANK_SLOTS.find((slot) => votes[slot] === String(answerIndex)) || null;

// Which round the player is on. The payload spells this three different ways
// depending on which endpoint answered (get-question sends lessonNumber +
// questionNumber + id, get-game-state sends id, and the results-reconstruction
// fallback sends none of them), so fall back to the phase string last.
const roundNumberOf = (question, gameState) => {
  const candidates = [question?.lessonNumber, question?.questionNumber, question?.id];
  for (const candidate of candidates) {
    const n = parseInt(candidate, 10);
    if (Number.isFinite(n) && n > 0) return n;
  }
  const fromState = parseInt(String(gameState || '').split('#')[1], 10);
  return Number.isFinite(fromState) && fromState > 0 ? fromState : null;
};

function PlayerPage() {
  const [gameId, setGameId] = useState('');
  
  // Helper function to check if game is in waiting state
  const isWaitingState = (state) => {
    if (!state) return true; // Default to waiting state if no state
    return state === 'CREATED' || state === 'STARTED' || 
           (!state.startsWith('ASK#') && !state.startsWith('VOTE#') && !state.startsWith('RESULTS#'));
  };
  const [playerName, setPlayerName] = useState('');
  const [nameInput, setNameInput] = useState('');
  const [accessCodeInput, setAccessCodeInput] = useState('');
  const [needsAccessCode, setNeedsAccessCode] = useState(false);
  const [joined, setJoined] = useState(false);
  const [currentQuestion, setCurrentQuestion] = useState(null);
  const [answerInput, setAnswerInput] = useState('');
  // The text the player actually submitted, kept after answerInput clears, so
  // the anonymous ballot can find this player's own row by content — the only
  // handle left once the author fields are redacted (see ownAnswerIndex).
  const [mySubmittedAnswer, setMySubmittedAnswer] = useState('');
  const [hasAnswered, setHasAnswered] = useState(false);
  const [gameState, setGameState] = useState('CREATED'); // CREATED, STARTED, ASK#001, VOTE#001, RESULTS#001
  const [gameType, setGameType] = useState('call-and-answer'); // 'call-and-answer' or 'trivia'
  const [selectedTriviaAnswer, setSelectedTriviaAnswer] = useState(null); // For trivia: stores selected option letter
  const [wavelengthWords, setWavelengthWords] = useState(Array(10).fill('')); // For wavelength: stores 10 words
  const [answers, setAnswers] = useState([]);
  const [votes, setVotes] = useState({ first: '', second: '', third: '' });
  const [hasVoted, setHasVoted] = useState(false);
  /*
    `hasVoted`, readable from inside an async resync.

    `loadVotingData` has to know what the screen currently believes in order to
    decide whether an unreadable server answer may lower the flag — and it runs
    inside `checkGameState`, which the resume effect captured long ago, so the
    `hasVoted` binding in that closure is frozen at join time. Reading the state
    variable there is exactly the mistake that made the ballot-clearing check
    fire on every resync (voteRoundRef's comment has that story).

    Mirrored in an effect rather than written at each call site: there are five
    writers, and a ref that one of them forgets to update is worse than a ref
    that lags by a render. The lag is immaterial here — it is only consulted
    when the server had no opinion AND the round did not change, and in that
    case the value has not moved either.
  */
  const hasVotedRef = useRef(false);
  useEffect(() => { hasVotedRef.current = hasVoted; }, [hasVoted]);
  const [isAnswerInputFocused, setIsAnswerInputFocused] = useState(false);
  const [isDesktop, setIsDesktop] = useState(false);
  const [gameIdFromUrl, setGameIdFromUrl] = useState(false);
  const [lastVoteInteraction, setLastVoteInteraction] = useState(0);
  const [isUserVoting, setIsUserVoting] = useState(false);
  const [rejoinedPlayer, setRejoinedPlayer] = useState(false);
  const [rejoinPrompt, setRejoinPrompt] = useState(null); // { gameId, name } | null
  // A join the server refused because the name is already answering in this
  // session: { kind: 'name-taken' | 'name-unverified', playerName, message }.
  const [joinCollision, setJoinCollision] = useState(null);
  const [votingMode, setVotingMode] = useState('quick'); // 'quick' or 'detailed'
  /*
    Which response is being read in full, or null. An index into `answers`.

    On a phone the ballot is the screen most in need of this: the whole point of
    a ranked vote is comparing responses, and a card clipped to fit three of its
    siblings above the fold cannot be compared with anything.
  */
  const [spotlightIndex, setSpotlightIndex] = useState(null);
  const [playerScore, setPlayerScore] = useState(0);
  const [playerRanking, setPlayerRanking] = useState(null);
  const [playerScoreInfo, setPlayerScoreInfo] = useState(null);
  const [allPlayers, setAllPlayers] = useState([]);
  const [customInstruction, setCustomInstruction] = useState(null);
  const [setRoundNoun, setSetRoundNoun] = useState(null); // per-set override, e.g. "Lesson"
  // What the host typed into Event Details at setup. Stored by create-game.js
  // as `Details` and returned to participants by get-game.js as
  // `engagementInfo` — and until this existed, read by nothing at all, which
  // made the setup field's own help text ("shown to participants when they
  // join") false for the whole life of the field.
  const [engagementInfo, setEngagementInfo] = useState('');
  // Which question the on-screen draft belongs to. A ref, not state: it is
  // read and claimed inside async fetches that would otherwise close over a
  // stale value, and changing it must never itself cause a render.
  const draftQuestionKeyRef = useRef(null);
  // Which VOTE round the ballot on screen belongs to. A ref for the same reason
  // as the one above, and its absence is what un-voted people: the check that
  // cleared the ballot compared `gameState` against the server's, from inside
  // `checkGameState` — a function the resume effect captures once, with the
  // deps `[gameId, playerName, joined, useWebSocket]`. `gameState` is not among
  // them, so that closure keeps whatever the phase was when the player JOINED,
  // and the comparison was true on every single resync. Returning to the tab
  // during voting therefore cleared the ballot every time, before the "have you
  // already voted" check downstream had said anything at all.
  const voteRoundRef = useRef(null);
  const [results, setResults] = useState(null);

  // Game end modal state
  const [showGameEndModal, setShowGameEndModal] = useState(false);
  const [reportAvailable, setReportAvailable] = useState(false);
  const [reportUrl, setReportUrl] = useState(null);

  // WebSocket state
  const [wsConnected, setWsConnected] = useState(false);
  const [useWebSocket, setUseWebSocket] = useState(true); // Always use WebSocket

  // A3: monotonic phase guard — prevents a slow GET /state from clobbering a
  // newer phase delivered via WebSocket (or vice versa). Accepts both the WS
  // message spellings (RESULT#/END) and the server state spellings (RESULTS#/ENDED).
  const lastRankRef = useRef(-1);
  const stateRank = (s) => {
    if (!s) return -1;
    if (s === 'ENDED' || s === 'END') return Number.MAX_SAFE_INTEGER;
    const m = s.match(/^(ASK|VOTE|RESULTS?)#(\d+)/);   // accepts RESULT# and RESULTS#
    if (!m) return -1;                                  // CREATED/STARTED never overwrite a live phase
    const phase = { ASK: 0, VOTE: 1, RESULT: 2, RESULTS: 2 }[m[1]];
    return parseInt(m[2], 10) * 10 + phase;
  };
  const applyGameState = (next) => {
    const r = stateRank(next);
    if (r < lastRankRef.current) {
      console.log(`⏮️ PLAYER: ignoring stale ${next}`);
      return false;
    }
    lastRankRef.current = r;
    setGameState(next);
    return true;
  };

  // Detect desktop screens to prevent mobile overlay behavior
  useEffect(() => {
    const checkScreenSize = () => {
      setIsDesktop(window.innerWidth >= 768);
    };
    
    checkScreenSize();
    window.addEventListener('resize', checkScreenSize);
    
    return () => window.removeEventListener('resize', checkScreenSize);
  }, []);

  useEffect(() => {
    // 🔗 PLAYER: Get game ID from URL params (optional)
    const urlParams = new URLSearchParams(window.location.search);
    const gameIdFromUrl = urlParams.get('gameId');
    
    if (gameIdFromUrl) {
      console.log(`🎯 PLAYER: Found game ID in URL: ${gameIdFromUrl}`);
      setGameId(gameIdFromUrl);
      setGameIdFromUrl(true);

      // 👤 PLAYER: Check for automatic reconnection
      const nameFromUrl = urlParams.get('name') || '';
      const savedName = localStorage.getItem(`playerName_${gameIdFromUrl}`);
      
      console.log(`🔍 PLAYER: Checking reconnection - URL name: "${nameFromUrl}", Saved name: "${savedName}"`);
      
      if (nameFromUrl) {
        // Name in URL - try to auto-join
        console.log(`🚀 PLAYER: Attempting auto-join with name from URL: ${nameFromUrl}`);
        setNameInput(nameFromUrl);
        
        if (savedName === nameFromUrl) {
          // Previously joined this game with this name — confirm before rejoining
          // instead of silently auto-joining (B2).
          console.log(`✅ PLAYER: Saved name matches — staging rejoin prompt`);
          setRejoinPrompt({ gameId: gameIdFromUrl, name: nameFromUrl });
        } else {
          // Try to join automatically
          console.log(`🔄 PLAYER: Auto-joining with URL name (not previously saved)`);
          attemptAutoJoin(gameIdFromUrl, nameFromUrl);
        }
      } else if (savedName) {
        // No name in URL but we have saved name - pre-fill the form and offer rejoin (B2)
        console.log(`💾 PLAYER: Pre-filling form with saved name: ${savedName}`);
        setNameInput(savedName);
        setRejoinPrompt({ gameId: gameIdFromUrl, name: savedName });
      }
    } else {
      console.log(`🔗 PLAYER: No game ID in URL - showing manual join form`);
      // No game ID in URL - player will need to enter it manually
    }
  }, []);

  /**
   * The one place a join is actually attempted.
   *
   * Every entry point — the form, the auto-join from a shared URL, the access
   * code retry, and the rejoin prompt — goes through here. It used to be three
   * near-copies plus, in the rejoin case, no request at all: `handleRejoinConfirm`
   * set `joined = true` and stopped, so a player who tapped "Rejoin" believed
   * they were back in a session the server had never heard them return to —
   * no player row touched, no host notification, no state fetched. Every
   * caller now shares one request and one interpretation of the answer.
   *
   * `clientId` is what lets the server tell a returning player from a namesake
   * (see components/joinResult.js). `claimExisting` is only ever true when the
   * person has said so out loud.
   */
  const performJoin = async (gid, name, { accessCode = null, claimExisting = false } = {}) => {
    const trimmed = String(name || '').trim();
    const clientId = getClientId(gid);

    let response;
    try {
      response = await fetch(`${API_BASE}games/${gid}/players`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          playerName: trimmed,
          accessCode,
          clientId,
          claimExisting
        }),
      });
    } catch (error) {
      console.error('PLAYER: join request failed:', error);
      return {
        ok: false,
        failure: {
          kind: 'network',
          message: 'Network error. Please check your connection and try again.'
        }
      };
    }

    let data = null;
    try {
      data = await response.json();
    } catch (parseError) {
      // A non-JSON body (an HTML error page from the edge, say) is still a
      // result — classify it on status alone rather than throwing.
    }

    if (!response.ok) {
      return {
        ok: false,
        status: response.status,
        failure: classifyJoinFailure(response.status, data)
      };
    }

    return { ok: true, data: data || {} };
  };

  /** Everything that must be true once the server has actually let us in. */
  const enterSession = (gid, name, data) => {
    setPlayerName(name);
    setJoined(true);
    setJoinCollision(null);
    setRejoinPrompt(null);
    localStorage.setItem(`playerName_${gid}`, name);

    if (data.isReconnection || data.rejoined) {
      setRejoinedPlayer(true);
      console.log(`🔄 PLAYER: Server confirmed this is a reconnection`);
      // Vote/answer restoration happens in checkGameState below.
    }

    setTimeout(() => checkGameState(gid, name), 100);
  };

  /**
   * Turn a refusal into the screen that explains it.
   *
   * `quiet` is for the unattended auto-join off a shared URL: a name collision
   * still has to be shown (the player is about to be told they are in a
   * session they are not in), but "the host hasn't started yet" must not
   * ambush someone with a modal the instant the page loads — that case falls
   * through to the join form, as it always has.
   */
  const applyJoinFailure = (failure, name, { quiet = false } = {}) => {
    if (failure.kind === 'access-code') {
      console.log(`🔐 PLAYER: Game requires access code - showing access code input`);
      setNeedsAccessCode(true);
      setPlayerName(name);
      return;
    }

    if (failure.kind === 'name-taken' || failure.kind === 'name-unverified') {
      setJoinCollision({
        kind: failure.kind,
        playerName: failure.playerName || name,
        message: failure.message
      });
      return;
    }

    if (!quiet) alert(failure.message);
  };

  // 🔄 Attempt to automatically join the game
  const attemptAutoJoin = async (gameId, name, accessCode = null) => {
    console.log(`🔄 PLAYER: Auto-joining game ${gameId} as ${name}`);
    const trimmed = String(name || '').trim();
    const result = await performJoin(gameId, trimmed, { accessCode });

    if (!result.ok) {
      console.log(`❌ PLAYER: Auto-join refused (${result.failure.kind})`);
      setNameInput(trimmed);
      applyJoinFailure(result.failure, trimmed, { quiet: true });
      return;
    }

    console.log(`✅ PLAYER: Auto-join successful`, result.data);
    enterSession(gameId, trimmed, result.data);

    // Update URL to include name if not already there
    const url = new URL(window.location);
    url.searchParams.set('name', trimmed);
    window.history.replaceState(null, '', url);
  };

  // REMOVED: Partial vote system - not needed with simplified flow

  // REMOVED: HTTP polling - WebSocket handles all state updates

  // Monitor WebSocket mode changes from admin panel
  useEffect(() => {
    const checkWebSocketMode = () => {
      const adminSetting = localStorage.getItem('admin_websocket_mode');
      const windowSetting = window.WEBSOCKET_MODE;

      // Default to true if no setting exists (first time users)
      const adminMode = adminSetting !== null ? adminSetting === 'true' : true;
      const windowMode = windowSetting !== undefined ? windowSetting : true;
      const currentMode = adminMode && windowMode;

      if (currentMode !== useWebSocket) {
        console.log(`🔌 PLAYER: WebSocket mode changed: ${currentMode ? 'ENABLED' : 'DISABLED'}`);
        console.log(`🔍 PLAYER: Settings - admin: ${adminSetting}, window: ${windowSetting}, final: ${currentMode}`);
        setUseWebSocket(currentMode);
        window.WEBSOCKET_MODE = currentMode;
      }
    };

    const modeInterval = setInterval(checkWebSocketMode, 1000);
    return () => clearInterval(modeInterval);
  }, [useWebSocket]);

  /**
   * The host's session brief, fetched once the participant is in.
   *
   * `role=player` explicitly, though it no longer buys secrecy: the host view
   * of this endpoint DID return the private-game access code, and no longer
   * does — `role` is a query parameter on a public route, so it was never a
   * check, and the field is deleted rather than gated (get-game.js:71-92,
   * pinned by tests/get-game-access-code.js). The role is still sent because
   * the host branch carries setup fields a participant has no use for.
   *
   * Every failure is swallowed. The brief is a nicety; being in the room is
   * not, and a 404 or a flaky network must never take the lobby down with it.
   */
  useEffect(() => {
    if (!joined || !gameId) return undefined;
    let cancelled = false;

    (async () => {
      try {
        const res = await fetch(`${API_BASE}games/${gameId}?role=player`);
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled && typeof data.engagementInfo === 'string') {
          setEngagementInfo(data.engagementInfo);
        }
      } catch (error) {
        console.warn('PLAYER: session details unavailable:', error.message);
      }
    })();

    return () => { cancelled = true; };
  }, [joined, gameId]);

  // WebSocket connection effect - only runs when WebSocket is enabled and player has joined
  useEffect(() => {
    if (!gameId || !playerName || !joined || !useWebSocket) return;

    console.log(`🔌 PLAYER: Starting WebSocket connection for game ${gameId} as ${playerName}`);

    // Set up WebSocket connection status callback
    webSocketClient.onConnectionStatusChange(setWsConnected);

    // A2: reconcile authoritative phase on every successful reconnect. Any
    // ASK#→VOTE#→RESULTS# transition that fired while offline is caught here.
    webSocketClient.onReconnected(() => {
      console.log('🔁 PLAYER: WS reconnected — reconciling state');
      checkGameState();
    });

    // Initial state handler for reconnection/late joining
    webSocketClient.onMessage('initialStateSync', (data) => {
      console.log('🔌 PLAYER: Received initial state sync notification:', data);
      // Fetch current game state from API
      checkGameState();
    });

    // Game state change handlers
    webSocketClient.onMessage('gameStateChanged', (data) => {
      console.log('🔌 Player received game state change notification:', data);
      // Fetch current game state from API
      checkGameState();
    });

    webSocketClient.onMessage('questionStarted', (data) => {
      console.log('🔌 Player received question started notification:', data);
      // Parse the state message to extract question number
      const stateMessage = data.state; // e.g., "GAME#9402 ASK#001"
      if (stateMessage && stateMessage.includes('ASK#')) {
        const questionNumber = stateMessage.split('ASK#')[1]; // Extract "001"
        console.log(`🎯 Player calling get_question for question ${questionNumber}`);
        // Update game state first, then fetch question (guarded against stale races)
        if (applyGameState(`ASK#${questionNumber}`)) {
          fetchCurrentQuestion(questionNumber);
        }
      } else {
        console.log('⚠️ Player received questionStarted without valid state format');
      }
    });

    webSocketClient.onMessage('votingStarted', (data) => {
      console.log('🔌 Player received voting started notification:', data);
      // Parse the state message to extract question number
      const stateMessage = data.state; // e.g., "GAME#9402 VOTE#001"
      if (stateMessage && stateMessage.includes('VOTE#')) {
        const questionNumber = stateMessage.split('VOTE#')[1]; // Extract "001"
        console.log(`🗳️ Player calling voting for question ${questionNumber}`);
        // Update game state first, then fetch voting data (guarded against stale races)
        if (applyGameState(`VOTE#${questionNumber}`)) {
          // Clear previous votes when starting new voting round
          setVotes({ first: '', second: '', third: '' });
          setHasVoted(false);
          console.log('🔄 Cleared previous votes for new voting round');
          checkGameState();
        }
      } else {
        console.log('⚠️ Player received votingStarted without valid state format');
        // Fallback to checkGameState
        checkGameState();
      }
    });

    webSocketClient.onMessage('playerAnswered', (data) => {
      console.log('🔌 Player received player answered notification:', data);
      // This notification comes when any player submits an answer
      // We don't need to do anything special here for players
    });

    webSocketClient.onMessage('playerVoted', (data) => {
      console.log('🔌 Player received player voted notification:', data);
      // This notification comes when any player submits votes
      // We don't need to do anything special here for players
    });

    webSocketClient.onMessage('aiSummaryReady', (data) => {
      console.log('🔌 Player received AI Summary ready:', data);
      // Players might want to know when AI summary is ready to discuss
      // We don't currently show AI summaries to players, but this is available
    });

    // Parity with host: players don't render summaries, so just log the failure.
    webSocketClient.onMessage('aiSummaryError', (data) => {
      console.warn('🔌 Player received AI Summary error:', data);
    });

    // Results ready handler for trivia and call-and-answer
    webSocketClient.onMessage('hostMessage', (data) => {
      if (data.messageType && data.messageType.startsWith('RESULT#')) {
        console.log('🔌 Player received results ready notification (hostMessage):', data);
        const questionNumber = data.questionNumber;
        if (questionNumber) {
          console.log(`🎯 PLAYER: Results ready for question ${questionNumber}, fetching results...`);
          checkGameState(); // This will fetch the current game state and show results
        }
      }
    });

    // Direct resultsReady handler for proper WebSocket routing
    webSocketClient.onMessage('resultsReady', (data) => {
      console.log('🔌 Player received results ready notification (resultsReady):', data);
      const questionNumber = data.questionId || data.questionNumber;
      if (questionNumber) {
        console.log(`🎯 PLAYER: Results ready for question ${questionNumber}, updating state to RESULTS#${questionNumber}`);
        // Update local state to show results screen immediately (guarded against stale races)
        if (applyGameState(`RESULTS#${String(questionNumber).padStart(3, '0')}`)) {
          // Then fetch the actual results data
          checkGameState();
        }
      }
    });

    // Game ended handler
    webSocketClient.onMessage('gameEnded', (data) => {
      console.log('🔌 Player received game ended notification:', data);
      applyGameState('ENDED');
      setShowGameEndModal(true);
    });

    // Connect as player - WebSocket is required
    console.log('🔌 PLAYER: Connecting WebSocket for real-time updates');
    webSocketClient.connect(gameId, playerName, false);

    // Do a single explicit initial state check (onReconnected covers every
    // subsequent reopen; it does NOT fire on the first open).
    console.log('🔌 PLAYER: WebSocket connecting, doing initial state check');
    checkGameState();

    return () => {
      console.log(`🔌 PLAYER: Disconnecting WebSocket for game ${gameId}`);
      webSocketClient.disconnect();
      webSocketClient.onConnectionStatusChange(null);
      webSocketClient.onReconnected(null);
      webSocketClient.offMessage('initialStateSync');
      webSocketClient.offMessage('gameStateChanged');
      webSocketClient.offMessage('questionStarted');
      webSocketClient.offMessage('votingStarted');
      webSocketClient.offMessage('playerAnswered');
      webSocketClient.offMessage('playerVoted');
      webSocketClient.offMessage('aiSummaryReady');
      webSocketClient.offMessage('aiSummaryError');
      webSocketClient.offMessage('hostMessage');
      webSocketClient.offMessage('resultsReady');
      webSocketClient.offMessage('gameEnded');
    };
  }, [gameId, playerName, joined, useWebSocket]);

  // A2: resume handler — covers half-open sockets (phone lock) and backgrounded
  // mobile tabs. ensureConnected() reconnects a dead socket; checkGameState()
  // reconciles the phase. checkGameState is idempotent so concurrent events converge.
  useEffect(() => {
    if (!gameId || !playerName || !joined || !useWebSocket) return;
    const resync = () => { webSocketClient.ensureConnected(); checkGameState(); };
    const onVisible = () => { if (document.visibilityState === 'visible') resync(); };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('online', resync);
    window.addEventListener('focus', resync);
    window.addEventListener('pageshow', resync);   // iOS Safari bfcache restore
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('online', resync);
      window.removeEventListener('focus', resync);
      window.removeEventListener('pageshow', resync);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameId, playerName, joined, useWebSocket]);

  // Note: Removed auto-save localStorage functionality - now using server-side partial votes

  // Show rejoin notification
  useEffect(() => {
    if (rejoinedPlayer) {
      const timer = setTimeout(() => setRejoinedPlayer(false), 5000);
      return () => clearTimeout(timer);
    }
  }, [rejoinedPlayer]);

  const fetchQuestionSetInstruction = async (setId) => {
    if (!setId) {
      setCustomInstruction(null);
      setSetRoundNoun(null);
      return;
    }

    try {
      console.log('📋 PLAYER: Resolving instruction for set:', setId);
      const meta = await loadQuestionSetMeta(setId);
      if (meta.customInstruction) {
        console.log('📋 PLAYER: Found custom instruction:', meta.customInstruction);
      } else {
        console.log('📋 PLAYER: No custom instruction found, using default');
      }
      setCustomInstruction(meta.customInstruction);
      setSetRoundNoun(meta.roundNoun);
    } catch (error) {
      console.error('Error fetching question set instruction:', error);
      setCustomInstruction(null);
      setSetRoundNoun(null);
    }
  };

  const fetchPlayerRanking = async (gameIdOverride = null, playerNameOverride = null) => {
    const currentGameId = gameIdOverride || gameId;
    const currentPlayerName = playerNameOverride || playerName;
    
    if (!currentGameId || !currentPlayerName) {
      console.log('⏭️ PLAYER: Skipping fetchPlayerRanking - no gameId or playerName yet');
      return;
    }
    
    try {
      console.log('📊 PLAYER: Fetching player ranking data...');
      const playersRes = await fetch(`${API_BASE}games/${currentGameId}/players`);
      if (playersRes.ok) {
        const playersData = await playersRes.json();
        const players = playersData.players || [];
        setAllPlayers(players);
        
        // Find current player and calculate ranking with proper tie handling
        const currentPlayer = players.find(p => p.name === currentPlayerName);
        if (currentPlayer) {
          setPlayerScore(currentPlayer.score || 0);
          
          // Calculate proper rankings with tie handling
          const rankedPlayers = calculatePlayerRankings(players);
          const playerWithRank = rankedPlayers.find(p => p.name === currentPlayerName);
          const totalPlayers = players.length;
          
          if (playerWithRank) {
            setPlayerRanking({ rank: playerWithRank.rank, total: totalPlayers });
            console.log(`📊 PLAYER: ${currentPlayerName} rank ${playerWithRank.rank}/${totalPlayers} with ${currentPlayer.score || 0} points`);
          }
        } else {
          console.warn(`📊 PLAYER: Player ${currentPlayerName} not found in players list:`, players.map(p => p.name));
        }
      }
    } catch (error) {
      console.error('Error fetching player ranking:', error);
    }
  };

  /**
   * Has this player already answered the question that is currently open?
   *
   * Ask the endpoint that actually knows. This used to call
   * `/answers?player=…&question=…` and read `answerData.hasAnswer` — but
   * get-answers.js accepts only `role` and `questionId` (get-answers.js:12),
   * and no handler anywhere has ever emitted `hasAnswer`. The expression was
   * `undefined || false`, so this reported "you have not answered" to every
   * player on every call, forever. During ASK# that endpoint cannot answer the
   * question in principle: the player branch returns a bare count and
   * deliberately no names.
   *
   * `/state` does carry it, as `answerProgress.answererIds`
   * (get-game-state.js:398-402) — the exact counterpart of the
   * `votingProgress.votersIds` list checkPlayerVote reads below.
   *
   * Returns `null`, not `false`, when the roster is unavailable (off-phase
   * payload, bad response, network error). "I could not find out" and "you
   * did not answer" are different facts, and collapsing them is what lets a
   * single flaky refresh throw away a submitted answer.
   */
  const checkPlayerAnswer = async (gameId, playerName) => {
    /*
      THIS USED TO READ THE HOST'S ROSTER LIST, from `GET /state` with no player
      identity on it — so the server answered as if a host had asked, and the
      list it dug through (`answerProgress.answererIds`) only exists while the
      state is `ASK#`. Any resync after the round moved on found nothing and had
      to report "I could not find out". utils/playerParticipation.js has the
      full account; the short version is that `/state/{playerName}` reads this
      player's own answer row directly and keeps answering across phases.
    */
    try {
      const stateRes = await fetch(participationUrl(API_BASE, gameId, playerName));
      if (!stateRes.ok) return null;

      const { answered } = participationFrom(await stateRes.json());
      console.log(`📝 PLAYER: Answer check for ${playerName}: ${answered === null ? 'unknown' : answered ? 'already answered' : 'not answered yet'}`);
      return answered;
    } catch (error) {
      console.error('Error checking player answer:', error);
      return null;
    }
  };

  // Fetch current question using get_question API (same as host)
  const fetchCurrentQuestion = async (questionNumber) => {
    if (!gameId) {
      console.log('⏭️ PLAYER: Skipping fetchCurrentQuestion - no gameId');
      return;
    }
    
    try {
      console.log(`🎯 PLAYER: Fetching question ${questionNumber} for game ${gameId}`);
      const questionRes = await fetch(`${API_BASE}games/${gameId}/question?role=player`);
      
      if (!questionRes.ok) {
        console.error('❌ Failed to fetch question:', questionRes.status);
        return;
      }
      
      const questionData = await questionRes.json();
      console.log('✅ PLAYER: Received question data:', questionData);
      console.log('🔍 PLAYER: Question data keys:', Object.keys(questionData));
      console.log('🔍 PLAYER: Question title:', questionData.title);
      console.log('🔍 PLAYER: Current gameState when setting question:', gameState);
      
      if (questionData.title) {
        // Set the question data - question data is at top level, not nested
        setCurrentQuestion(questionData);
        console.log('✅ PLAYER: currentQuestion state updated with:', questionData);

        // Is this a different question, or the same one being re-read?
        //
        // This function runs far more often than the game advances: every
        // visibilitychange, focus, online and pageshow goes through the resync
        // effect, and so does every WS reconnect, gameStateChanged and
        // initialStateSync. Treating each of those as "a question arrived"
        // is what erased a tapped trivia option — and any typed text — between
        // the tap and Submit.
        //
        // Claimed before the await so a second refresh racing this one sees
        // the question as already processed and leaves the draft alone.
        const questionKey = String(
          questionData.questionNumber ?? questionData.id ?? questionNumber ?? ''
        );
        const isNewQuestion = questionKey !== draftQuestionKeyRef.current;
        draftQuestionKeyRef.current = questionKey;

        const hasAnswered = await checkPlayerAnswer(gameId, playerName);

        // The server is the authority when it has an opinion. When it does
        // not, only a genuinely new question may lower the flag — a refresh
        // that learned nothing must not un-answer someone. The rule is now
        // `nextParticipation` so the vote path below is held to the same one.
        setHasAnswered((current) => nextParticipation({
          current, server: hasAnswered, isNewQuestion,
        }));

        // Reset the draft for a new question only.
        if (isNewQuestion && hasAnswered !== true) {
          setAnswerInput('');
          setSelectedTriviaAnswer('');
          setMySubmittedAnswer('');
        }

        // Fetch question set instructions. The payload only started carrying
        // `setId` for players in this change; before that this guard could
        // never fire and per-set instructions were host-only.
        const setId = questionData.setId || questionData.questionSetId;
        if (setId) {
          fetchQuestionSetInstruction(setId);
        }
        
        console.log(`🎯 PLAYER: Question ${questionNumber} loaded, hasAnswered: ${hasAnswered}`);
      } else {
        console.log('⚠️ PLAYER: No question data received');
      }
    } catch (error) {
      console.error('❌ PLAYER: Error fetching question:', error);
    }
  };

  const checkGameState = async (gameIdOverride = null, playerNameOverride = null) => {
    const currentGameId = gameIdOverride || gameId;
    const currentPlayerName = playerNameOverride || playerName;
    
    if (!currentGameId || !currentPlayerName) {
      console.log('⏭️ PLAYER: Skipping checkGameState - no gameId or playerName yet');
      return;
    }
    
    try {
      // Get game state from the database
      const stateRes = await fetch(`${API_BASE}games/${currentGameId}/state`);
      const stateJson = await stateRes.json();
      console.log('🔍 PLAYER: Raw state API response:', stateJson);
      const serverGameState = stateJson.state || 'CREATED';
      const serverGameType = stateJson.gameType || 'call-and-answer';
      
      // Update game type if changed
      if (serverGameType !== gameType) {
        setGameType(serverGameType);
      }
      
      console.log(`🔄 PLAYER: Game state is ${serverGameState}`);

      // Set the game state through the monotonic guard (A3). If this HTTP
      // response is stale relative to a newer WS-delivered phase, skip it and
      // all its follow-up loads so we never flash backward.
      if (!applyGameState(serverGameState)) {
        console.log('⏮️ PLAYER: checkGameState result is stale — skipping follow-up loads');
        return;
      }

      // Handle different game states
      if (serverGameState.startsWith('ASK#')) {
        // Extract question number from ASK#001 format
        const questionNumber = serverGameState.split('#')[1];
        console.log(`🎯 PLAYER: ASK state detected, question ${questionNumber}`);
        
        // Use the new fetchCurrentQuestion function (same as WebSocket flow)
        await fetchCurrentQuestion(questionNumber);
        
      } else if (serverGameState.startsWith('VOTE#')) {
        // Extract question number from VOTE#001 format
        const questionNumber = serverGameState.split('#')[1];
        console.log(`🗳️ PLAYER: VOTE state detected, question ${questionNumber}`);
        
        // Clear the ballot only when the ROUND actually changed — see
        // voteRoundRef. Comparing phases here read a `gameState` frozen at join
        // time, so this fired on every resync and wiped a cast vote.
        // Claimed before the await below, matching fetchCurrentQuestion.
        const isNewVoteRound = questionNumber !== voteRoundRef.current;
        voteRoundRef.current = questionNumber;
        if (isNewVoteRound) {
          setVotes({ first: '', second: '', third: '' });
          setHasVoted(false);
          console.log(`🔄 Cleared previous votes for new voting round ${questionNumber}`);
        }
        
        // Load voting data for this question
        await loadVotingData(questionNumber, isNewVoteRound);
        
      } else if (serverGameState.startsWith('RESULTS#')) {
        // Extract question number from RESULTS#001 format
        const questionNumber = serverGameState.split('#')[1];
        console.log(`🏆 PLAYER: RESULTS state detected, question ${questionNumber}`);
        
        // Load results data for this question
        await loadResultsData(questionNumber);
        
      } else {
        // CREATED, STARTED, or other states (gameState already set via applyGameState)
        console.log(`⏳ PLAYER: Game in ${serverGameState} state`);
        setCurrentQuestion(null);
        setAnswers([]);
        setHasAnswered(false);
        setHasVoted(false);
        setMySubmittedAnswer('');
      }
      
    } catch (error) {
      console.error('❌ PLAYER: Error checking game state:', error);
    }
  };
  
  // Load voting data for the current question
  const loadVotingData = async (questionNumber, isNewVoteRound = false) => {
    if (!gameId || !playerName) {
      console.log('⏭️ PLAYER: Skipping loadVotingData - no gameId or playerName');
      return;
    }

    try {
      console.log(`🗳️ PLAYER: Loading voting data for question ${questionNumber} in game ${gameId}`);

      // First, check if player has already voted by checking game state.
      // `setHasVoted(hasAlreadyVoted)` stood here and assigned the raw result,
      // which is how a check that answered `false` for "I could not find out"
      // reached the screen as "you have not voted". Same rule as the answer
      // path now: the server wins when it has an opinion, and only a new round
      // may lower the flag without one.
      const votedOnServer = await checkPlayerVote(gameId, playerName, questionNumber);
      const hasAlreadyVoted = nextParticipation({
        current: hasVotedRef.current,
        server: votedOnServer,
        isNewQuestion: isNewVoteRound,
      });
      setHasVoted(hasAlreadyVoted);

      if (hasAlreadyVoted) {
        console.log(`✅ PLAYER: Already voted on question ${questionNumber} - showing vote submitted screen`);
        // Just need to load question data for display
        const stateRes = await fetch(`${API_BASE}games/${gameId}/state`);
        const stateData = await stateRes.json();
        
        if (stateData.currentQuestionData) {
          setCurrentQuestion(stateData.currentQuestionData);
        }
        return; // Don't need to load answers if already voted
      }
      
      // Player hasn't voted yet - load question and answers
      console.log(`📋 PLAYER: Not voted yet - loading question and answers`);
      
      // Get question data from game state
      const stateRes = await fetch(`${API_BASE}games/${gameId}/state`);
      const stateData = await stateRes.json();
      
      if (stateData.currentQuestionData) {
        setCurrentQuestion(stateData.currentQuestionData);
        console.log(`✅ PLAYER: Question data loaded: ${stateData.currentQuestionData.title}`);
      }
      
      // Get answers for voting
      const paddedQuestionNumber = String(questionNumber).padStart(3, '0');
      const answersRes = await fetch(`${API_BASE}games/${gameId}/answers?role=player&questionId=${paddedQuestionNumber}`);
      const answersJson = await answersRes.json();
      
      if (answersJson.answers && answersJson.answers.length > 0) {
        setAnswers(answersJson.answers);
        console.log(`✅ PLAYER: Loaded ${answersJson.answers.length} answers for voting`);
      } else {
        console.log(`⚠️ PLAYER: No answers found for voting on question ${questionNumber}`);
      }
    } catch (error) {
      console.error('❌ PLAYER: Error loading voting data:', error);
    }
  };
  
  // Load results data for the current question
  const loadResultsData = async (questionNumber) => {
    if (!gameId) {
      console.log('⏭️ PLAYER: Skipping loadResultsData - no gameId');
      return;
    }
    
    try {
      console.log(`🏆 PLAYER: Loading results data for question ${questionNumber} in game ${gameId}`);
      
      // Try to get the current question data, but don't block results if it fails
      try {
        const questionRes = await fetch(`${API_BASE}games/${gameId}/question?role=player`);
        if (questionRes.ok) {
          const questionData = await questionRes.json();
          if (questionData.title) {
            setCurrentQuestion(questionData);
          }
        } else {
          console.log(`ℹ️ PLAYER: Question endpoint not available (${questionRes.status}), proceeding with results only`);
        }
      } catch (questionError) {
        console.log(`ℹ️ PLAYER: Could not fetch question data:`, questionError.message);
      }
      
      // Get results for this question (independent of question data)
      const resultsRes = await fetch(`${API_BASE}games/get-results`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          gameId: gameId,
          questionNumber: questionNumber 
        })
      });
      const resultsJson = await resultsRes.json();
      
      // Handle both trivia and call-and-answer result formats
      if (resultsJson.voteTallies || resultsJson.answers) {
        setResults(resultsJson);
        
        // Try to reconstruct question data from results if we don't have it (works for both trivia and call-and-answer)
        if (!currentQuestion && resultsJson) {
          console.log(`🔍 PLAYER: Question data missing, checking if results contain question info`);
          if (resultsJson.question || resultsJson.questionTitle || resultsJson.questionDetail || resultsJson.correctAnswer || resultsJson.optionA) {
            
            // For trivia games, if correctAnswer is missing, try to determine it from player answers
            let correctAnswer = resultsJson.correctAnswer;
            if (!correctAnswer && resultsJson.gameType === 'trivia' && resultsJson.answers) {
              const correctPlayerAnswer = resultsJson.answers.find(answer => answer.isCorrect);
              if (correctPlayerAnswer) {
                correctAnswer = correctPlayerAnswer.answer;
                console.log(`🔧 PLAYER: Determined correct answer from player data: ${correctAnswer}`);
              }
            }
            
            const reconstructedQuestion = {
              title: resultsJson.question || resultsJson.questionTitle || resultsJson.questionDetail || 'Question',
              questionDetail: resultsJson.questionDetail || resultsJson.question || resultsJson.questionTitle,
              correctAnswer: correctAnswer,
              optionA: resultsJson.optionA,
              optionB: resultsJson.optionB,
              optionC: resultsJson.optionC,
              optionD: resultsJson.optionD,
              optionE: resultsJson.optionE,
              optionF: resultsJson.optionF
            };
            setCurrentQuestion(reconstructedQuestion);
            console.log(`🔧 PLAYER: Reconstructed question data from results:`, reconstructedQuestion);
          }
        }
        
        if (resultsJson.gameType === 'trivia') {
          console.log(`✅ PLAYER: Trivia results data loaded, answers:`, resultsJson.answers?.length || 0);
          console.log(`🔍 PLAYER: Full trivia results data:`, resultsJson);
          
          // For trivia, populate answers state with the trivia results answers
          if (resultsJson.answers) {
            setAnswers(resultsJson.answers.map(answer => ({
              name: answer.playerName, // Convert to expected format for UI
              player: answer.playerName,
              playerName: answer.playerName,
              answer: answer.answer,
              isCorrect: answer.isCorrect,
              points: answer.pointsEarned || 0,
              basePoints: answer.basePoints || 0,
              speedBonus: answer.speedBonus || 0,
              responseTimeMs: answer.responseTimeMs || 0
            })));
            console.log(`📊 PLAYER: Set answers state with trivia results for highlighting`);
          }
        } else {
          console.log(`✅ PLAYER: Call-and-answer results data loaded, voteTallies:`, Object.keys(resultsJson.voteTallies || {}).length);
        }
        
        // Get player rankings and score information for RESULTS display
        await loadPlayerScoreInfo(resultsJson);
      } else {
        console.log(`⚠️ PLAYER: No results data found for question ${questionNumber}`, resultsJson);
        
        // Still load player score info even if no results for this question
        await loadPlayerScoreInfo();
      }
      
    } catch (error) {
      console.error('❌ PLAYER: Error loading results data:', error);
    }
  };

  // Load player score info including ranking and total score
  const loadPlayerScoreInfo = async (currentResults = null) => {
    if (!gameId || !playerName) {
      console.log('⏭️ PLAYER: Skipping loadPlayerScoreInfo - no gameId or playerName');
      return;
    }
    
    try {
      console.log(`📊 PLAYER: Loading player score info for ${playerName} in game ${gameId}`);
      
      // Get all players with current scores and rankings
      const playersRes = await fetch(`${API_BASE}games/${gameId}/players`);
      const playersData = await playersRes.json();
      
      if (playersData.players) {
        // Sort players by total score (descending) to determine rankings
        const rankedPlayers = playersData.players.sort((a, b) => b.totalScore - a.totalScore);
        
        // Find current player in the rankings
        const currentPlayerIndex = rankedPlayers.findIndex(p => p.playerName === playerName);
        
        if (currentPlayerIndex !== -1) {
          const currentPlayer = rankedPlayers[currentPlayerIndex];
          
          // Calculate ranking with proper tie handling
          let rank = 1;
          for (let i = 0; i < currentPlayerIndex; i++) {
            if (rankedPlayers[i].totalScore > currentPlayer.totalScore) {
              rank = i + 2; // +2 because we want 1-based indexing and account for ties
              break;
            }
          }
          
          // Alternative simpler ranking: currentPlayerIndex + 1 (since array is sorted)
          // But using above logic for proper tie handling
          if (currentPlayerIndex === 0) {
            rank = 1; // First in sorted array = 1st place
          } else {
            // Check if tied with previous player
            if (rankedPlayers[currentPlayerIndex - 1].totalScore === currentPlayer.totalScore) {
              // Find the rank of the first player with this score
              for (let i = 0; i < currentPlayerIndex; i++) {
                if (rankedPlayers[i].totalScore === currentPlayer.totalScore) {
                  rank = i + 1;
                  break;
                }
              }
            } else {
              rank = currentPlayerIndex + 1; // Normal ranking
            }
          }
          
          // Get round score from current results (use parameter if provided, otherwise state)
          let roundScore = 0;
          const resultsToUse = currentResults || results;
          
          // Handle both trivia and call-and-answer result formats for round score
          if (resultsToUse) {
            if (resultsToUse.gameType === 'trivia' && resultsToUse.answers) {
              // Trivia format: find player in answers array
              const playerResult = resultsToUse.answers.find(answer => 
                answer.playerName === playerName
              );
              if (playerResult) {
                roundScore = playerResult.pointsEarned || 0;
                console.log(`📊 PLAYER: Found trivia round score for ${playerName}: ${roundScore}`);
              } else {
                console.log(`📊 PLAYER: No trivia round score found for ${playerName} in answers`);
              }
            } else if (resultsToUse.voteTallies) {
              // Call-and-answer format: find player in voteTallies
              const playerResult = Object.values(resultsToUse.voteTallies).find(tally => 
                tally.playerName === playerName
              );
              if (playerResult) {
                roundScore = playerResult.totalScore || 0;
                console.log(`📊 PLAYER: Found call-and-answer round score for ${playerName}: ${roundScore}`);
              } else {
                console.log(`📊 PLAYER: No call-and-answer round score found for ${playerName} in voteTallies`);
              }
            } else {
              console.log(`📊 PLAYER: No recognized results format for round score calculation`);
            }
          } else {
            console.log(`📊 PLAYER: No results data available for round score calculation`);
          }
          
          const scoreInfo = {
            playerName: currentPlayer.playerName,
            totalScore: currentPlayer.totalScore,
            roundScore: roundScore,
            rank: rank,
            totalPlayers: rankedPlayers.length,
            rankDisplay: rankLabel(rank)
          };
          
          setPlayerScoreInfo(scoreInfo);
          console.log(`📊 PLAYER: Score info loaded:`, scoreInfo);
        } else {
          console.log(`⚠️ PLAYER: Could not find ${playerName} in player rankings`);
        }
      }
    } catch (error) {
      console.error('❌ PLAYER: Error loading player score info:', error);
    }
  };
  
  /**
   * Has this player already voted this round? `null` when it could not be
   * established — see utils/playerParticipation.js.
   *
   * THE THREE `return false`s THIS REPLACES ARE THE BUG. A non-OK response, a
   * payload without the list, and a thrown request each reported a confident
   * "has not voted", and the caller assigned that straight into state — so every
   * unreadable resync actively un-voted the player and put the ballot back in
   * front of somebody who had already cast it. The answer path above had
   * documented that exact hazard and returned `null` for it; this one was never
   * brought into line. Both go through one helper now so they cannot diverge
   * again.
   *
   * The old comment block ("we don't have the playerId ... let's use a more
   * direct approach") was working around something that was not true:
   * `/games/{gameId}/state/{playerName}` existed the whole time, and the player
   * name IS the id — votes are stored at `QUESTION#{nnn}#VOTE#{playerName}`.
   */
  const checkPlayerVote = async (gameId, playerName, questionNumber) => {
    try {
      const stateRes = await fetch(participationUrl(API_BASE, gameId, playerName));
      if (!stateRes.ok) return null;

      const { voted } = participationFrom(await stateRes.json());
      console.log(`🗳️ PLAYER: Vote check for ${playerName}: ${voted === null ? 'unknown' : voted ? 'already voted' : 'not voted yet'}`);
      return voted;
    } catch (error) {
      console.error('Error checking player vote:', error);
      return null;
    }
  };

  const handleJoinGame = async (e) => {
    e.preventDefault();
    if (!nameInput.trim() || !gameId) return;

    const trimmed = nameInput.trim();
    const result = await performJoin(gameId, trimmed, {
      accessCode: accessCodeInput.trim() || null
    });

    if (!result.ok) {
      console.log(`❌ PLAYER: Join refused (${result.failure.kind})`);
      applyJoinFailure(result.failure, trimmed);
      return;
    }

    console.log('✅ PLAYER: Manual join success:', result.data);
    enterSession(gameId, trimmed, result.data);

    // Update URL to include both gameId and name for easy sharing/reconnection
    const url = new URL(window.location);
    url.searchParams.set('gameId', gameId);
    url.searchParams.set('name', trimmed);
    window.history.replaceState(null, '', url);
    console.log(`🔗 PLAYER: Updated URL for reconnection: ${url.search}`);
  };

  // Handle access code submission
  const handleAccessCodeSubmit = async (e) => {
    e.preventDefault();
    if (!accessCodeInput.trim()) return;
    
    const trimmed = nameInput.trim();
    const result = await performJoin(gameId, trimmed, {
      accessCode: accessCodeInput.trim()
    });

    if (!result.ok) {
      applyJoinFailure(result.failure, trimmed);
      return;
    }

    console.log('✅ PLAYER: Access code join success:', result.data);
    setNeedsAccessCode(false);
    enterSession(gameId, trimmed, result.data);
  };

  const handleSubmitAnswer = async (e, triviaAnswer = null) => {
    if (e) e.preventDefault();
    
    console.log(`🎯 PLAYER: handleSubmitAnswer called - gameType: ${gameType}, triviaAnswer: ${triviaAnswer}, hasAnswered: ${hasAnswered}`);
    
    // For trivia, use the provided answer; for wavelength, use words array; for call-and-answer, use the text input
    let answer;
    if (gameType === 'trivia') {
      answer = triviaAnswer;
    } else if (gameType === 'wavelength') {
      // Filter out empty words and join with commas
      answer = wavelengthWords.filter(word => word.trim()).join(',');
    } else {
      answer = answerInput.trim();
    }
    
    if (!answer || !currentQuestion) {
      console.log(`❌ PLAYER: Submit blocked - answer: ${answer}, currentQuestion: ${!!currentQuestion}`);
      return;
    }
    
    if (hasAnswered) {
      console.log(`❌ PLAYER: Submit blocked - already answered`);
      return;
    }

    try {
      // Use WebSocket to submit answer (following the ANSWER# pattern)
      let questionNumber = currentQuestion.questionNumber || currentQuestion.id;
      
      // Fallback: extract from game state if question number is not available
      if (!questionNumber && gameState && gameState.startsWith('ASK#')) {
        questionNumber = gameState.split('#')[1]; // Extract from "ASK#001"
      }
      
      const messageType = `ANSWER#${questionNumber}`;
      
      console.log(`🎯 PLAYER: Submitting answer via WebSocket - messageType: ${messageType}`);
      console.log(`🎯 PLAYER: DEBUG currentQuestion object:`, currentQuestion);
      console.log(`🎯 PLAYER: DEBUG questionNumber extracted: ${questionNumber}, gameState: ${gameState}`);
      console.log(`🎯 PLAYER: DEBUG answer: ${answer}, answerType: ${gameType === 'trivia' ? 'trivia' : gameType === 'wavelength' ? 'wavelength' : 'text'}`);
      
      // Send answer via WebSocket
      webSocketClient.sendCleanMessage(messageType, {
        answer: answer,
        answerType: gameType === 'trivia' ? 'trivia' : gameType === 'wavelength' ? 'wavelength' : 'text'
      });
      
      setHasAnswered(true);
      setMySubmittedAnswer(answer);
      setAnswerInput('');
      setSelectedTriviaAnswer('');
      setWavelengthWords(Array(10).fill(''));
      
      console.log(`✅ PLAYER: Answer submitted successfully`);
    } catch (e) {
      console.error('handleSubmitAnswer error', e);
      alert('Failed to submit answer. Please try again.');
    }
  };

  const handleVoteChange = (position, answerIndex) => {
    if (hasVoted) return;

    // Track user interaction to prevent polling interference
    setLastVoteInteraction(Date.now());
    setIsUserVoting(true);
    
    // Clear user voting flag after a longer delay to prevent state resets
    setTimeout(() => setIsUserVoting(false), 3000);

    /*
      THE KICK-OUT, which is the whole of ranked voting: one answer holds at
      most one rank, so picking it somewhere new vacates wherever it was.

      `picked` is normalised to a string because the two ballots hand this in
      differently — a select gives `e.target.value` (already a string), the
      detailed cards give the map index (a number) — and `votes` is compared by
      identity. An index arriving as a number would match nothing and leave a
      duplicate behind.

      TWO THINGS THIS DELIBERATELY DOES NOT SPECIAL-CASE, because a clause no
      test can kill is a clause nobody can trust:

        CLEARING. Picking "Pick player..." makes `picked` the empty string, so
        the sweep matches only ranks that are ALREADY empty and writes '' over
        ''. A guard around it would be unreachable.

        THE RANK BEING SET. The sweep may blank `position` itself, and the
        assignment on the next line puts the value straight back. `pos !==
        position` here would likewise never change an outcome — it was written,
        and a mutation removing it survived the whole suite, which is how it was
        caught.

      The equality test IS load-bearing: drop it and every pick wipes the ballot.
    */
    const picked = answerIndex === null || answerIndex === undefined
      ? ''
      : String(answerIndex);

    const newVotes = { ...votes };

    Object.keys(newVotes).forEach(pos => {
      if (newVotes[pos] === picked) {
        newVotes[pos] = '';
      }
    });

    newVotes[position] = picked;
    setVotes(newVotes);
    
    // Save partial vote to server immediately after vote change
    if (currentQuestion?.id) {
      // Vote changes are stored in component state only
    }
    
    // Enhanced logging with mobile detection
    const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
    console.log(`🗳️ Vote updated on ${isMobile ? 'MOBILE' : 'DESKTOP'}:`, newVotes, 'at', new Date().toLocaleTimeString());
    if (isMobile) {
      console.log('📱 Mobile voting debug:', {
        position,
        answerIndex,
        votes: newVotes,
        touchEvents: 'ontouchstart' in window,
        viewport: `${window.innerWidth}x${window.innerHeight}`
      });
    }
  };

  const handleSubmitVotes = async () => {
    if (hasVoted) return;
    
    const eligibleAnswers = answers;
    const requiredRanks = Math.min(3, eligibleAnswers.length);
    
    // Count non-empty votes
    const filledVotes = Object.values(votes).filter(v => v !== '').length;
    
    if (filledVotes < requiredRanks) {
      alert(`Please select answers for all ${requiredRanks} positions.`);
      return;
    }

    // Convert to backend format: { [answerIndex]: rank }
    const backendVotes = {};
    if (votes.first !== '') backendVotes[parseInt(votes.first)] = 1;
    if (votes.second !== '') backendVotes[parseInt(votes.second)] = 2;
    if (votes.third !== '') backendVotes[parseInt(votes.third)] = 3;
    
    // Validate that we have vote data
    if (Object.keys(backendVotes).length === 0) {
      console.error('🚨 PLAYER: No votes to submit!', { votes, backendVotes });
      alert('No votes selected. Please select your rankings first.');
      return;
    }

    try {
      // Get current question number from game state
      const stateRes = await fetch(`${API_BASE}games/${gameId}/state`);
      const stateJson = await stateRes.json();
      const currentQuestionNumber = stateJson.currentQuestion;

      if (!currentQuestionNumber) {
        alert('Unable to determine current question. Please try again.');
        return;
      }

      console.log(`🗳️ PLAYER: Submitting votes via HTTP API for question ${currentQuestionNumber}`);
      console.log(`🗳️ PLAYER: Vote data being sent:`, {
        playerName: playerName,
        questionNumber: currentQuestionNumber,
        votes: backendVotes
      });
      
      // Send vote via HTTP API (following design doc architecture)
      const voteRes = await fetch(`${API_BASE}games/${gameId}/votes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          playerName: playerName,
          questionNumber: currentQuestionNumber,
          votes: backendVotes
        })
      });
      
      if (!voteRes.ok) {
        const errorData = await voteRes.json();
        
        // Check if voting has closed
        if (errorData.error === 'Invalid game state for voting' && errorData.currentState && errorData.currentState.startsWith('RESULTS#')) {
          console.log('⏰ PLAYER: Voting has closed, transitioning to results');
          alert('Voting has closed. Moving to results...');
          
          // Update state to results
          setGameState(errorData.currentState);
          setHasVoted(true); // Prevent further vote attempts
          
          // Fetch current game state and results, including player score info
          await checkGameState();
          
          // Load player score information for the results display
          await loadPlayerScoreInfo();
          return;
        }
        
        throw new Error(errorData.error || 'Failed to submit vote');
      }
      
      setHasVoted(true);
      
      // Vote submitted successfully
      
      console.log(`✅ PLAYER: Vote submitted successfully`);
    } catch (e) {
      console.error('handleSubmitVotes error', e);
      alert(e.message || 'Failed to submit votes. Please try again.');
    }
  };

  // Check for report availability and handle download
  const checkAndDownloadReport = async () => {
    try {
      console.log('📊 PLAYER: Checking for report availability...');
      const response = await fetch(`${API_BASE}admin/reports/${gameId}`);
      
      if (response.ok) {
        const data = await response.json();
        if (data.downloadUrl) {
          console.log('📊 PLAYER: Report available, opening download...');
          setReportAvailable(true);
          setReportUrl(data.downloadUrl);
          // Open the report in a new tab
          window.open(data.downloadUrl, '_blank');
        } else {
          console.log('📊 PLAYER: Report not yet available');
          setReportAvailable(false);
        }
      } else {
        console.log('📊 PLAYER: Report not available (404)');
        setReportAvailable(false);
      }
    } catch (error) {
      console.error('📊 PLAYER: Error checking report:', error);
      setReportAvailable(false);
    }
  };

  // Close game end modal
  const closeGameEndModal = () => {
    setShowGameEndModal(false);
  };

  // B2: rejoin prompt handlers
  //
  // This used to flip `joined = true` and nothing else — no request, so the
  // server never learned the player was back. The player saw a session; the
  // session did not see the player. A rejoin is a join, and it can fail for
  // all the ordinary reasons (the host ended it, the row expired, the name is
  // now someone else's), so it goes through the same path and the same
  // failure handling as any other join.
  //
  // `claimExisting: true` is the person's own answer to "is this you?". The
  // prompt only appears when this browser's localStorage says it joined this
  // session under this name, and it only matters for rows created before
  // client ids existed — a row already stamped with a different id is refused
  // regardless of what is claimed here.
  const handleRejoinConfirm = async () => {
    if (!rejoinPrompt) return;
    const { gameId: gid, name } = rejoinPrompt;
    console.log(`✅ PLAYER: Rejoining game ${gid} as ${name}`);

    const result = await performJoin(gid, name, { claimExisting: true });

    if (!result.ok) {
      console.log(`❌ PLAYER: Rejoin refused (${result.failure.kind})`);
      // Fall back to the join form with the name filled in, so whatever went
      // wrong is something the player can act on.
      setGameId(gid);
      setNameInput(name);
      setRejoinPrompt(null);
      applyJoinFailure(result.failure, name);
      return;
    }

    lastRankRef.current = -1; // fresh phase tracking for this session
    // Restore the player's place (checkPlayerAnswer/checkPlayerVote guards
    // prevent re-answering/re-voting).
    enterSession(gid, name, result.data);
  };

  /**
   * "Yes, that Chris is me." Only reachable from the NAME_UNVERIFIED screen —
   * a row the server cannot attribute, because it was created before client
   * ids existed. A row that *is* attributed refuses this outright, server
   * side, so the button cannot be used to take someone else's place.
   */
  const handleCollisionRejoin = async () => {
    if (!joinCollision) return;
    const name = joinCollision.playerName;
    const result = await performJoin(gameId, name, { claimExisting: true });

    if (!result.ok) {
      applyJoinFailure(result.failure, name);
      return;
    }
    enterSession(gameId, name, result.data);
  };

  /** "No, I'm a different Chris." Back to the form with the name cleared. */
  const handleCollisionRename = () => {
    setJoinCollision(null);
    setNameInput('');
    setPlayerName('');
  };

  const handleRejoinDecline = () => {
    if (!rejoinPrompt) return;
    console.log(`🙅 PLAYER: Declining rejoin — joining as someone else`);
    localStorage.removeItem(`playerName_${rejoinPrompt.gameId}`);
    setNameInput('');
    setPlayerName('');
    setRejoinPrompt(null);
  };

  // Detailed voting component
  const DetailedVotingMode = ({ answers, votes, onVoteChange, onSubmitVotes, playerName, requiredVotes, mySubmittedAnswer }) => {
    const handleVoteClick = (answerIndex, position) => {
      // Track interaction to prevent polling interference
      setLastVoteInteraction(Date.now());
      setIsUserVoting(true);
      setTimeout(() => setIsUserVoting(false), 3000);
      
      // Pressing the rank this answer already holds takes it off the ballot;
      // pressing any other rank MOVES it there, and handleVoteChange vacates
      // the old one. Same `rankHolding` the badge and the quick options read.
      if (rankHolding(votes, answerIndex) === position) {
        onVoteChange(position, ''); // Remove vote
      } else {
        onVoteChange(position, answerIndex); // Assign vote (clears it from wherever it was)
      }
    };

    const ownIdx = ownAnswerIndex(answers, mySubmittedAnswer);

    return (
      <div className="detailed-voting">
        <div className="detailed-answers">
          {answers.map((answer, idx) => {
            // The SAME rule the quick ballot's options read. This was a private
            // `getVotePosition` here and an inline `Object.values(votes)
            // .includes(...)` over there — two answers to one question, which is
            // how the two ballots came to disagree about what a pick means.
            const currentPosition = rankHolding(votes, idx);
            const isOwn = idx === ownIdx;

            return (
              <div key={idx} className={`detailed-answer-card ${isOwn ? 'own-answer' : ''}`}>
                {/* THE TEXT OPENS; THE VOTE BUTTONS DO NOT.

                    Scoped to `.answer-content` rather than the whole card on
                    purpose. The card also holds the three rank buttons, and a
                    click handler on the card would fire behind every one of
                    them — so ranking an answer would also open a dialog over
                    the ballot the player is trying to fill in. This is a
                    ballot, not a results wall: reading has to be the secondary
                    gesture. */}
                <div
                  className="answer-content is-openable"
                  role="button"
                  tabIndex={0}
                  aria-label="Read this response in full"
                  onClick={() => setSpotlightIndex(idx)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      setSpotlightIndex(idx);
                    }
                  }}
                >
                  <div className="answer-text">"{answer.answer}"</div>
                  <div className="answer-author">- {displayLabelFor(answer, idx)}{isOwn ? ' (Yours)' : ''}</div>
                </div>

                <div className="vote-buttons">
                  {['first', 'second', 'third'].slice(0, requiredVotes).map(position => {
                    const isSelected = currentPosition === position;
                    const rank = VOTE_POSITIONS[position];

                    return (
                      <button
                        key={position}
                        className={`vote-btn-detailed ${isSelected ? 'selected' : ''}`}
                        onClick={() => handleVoteClick(idx, position)}
                        aria-pressed={isSelected}
                        aria-label={`Vote this answer ${rankLabel(rank)}`}
                        title={rankLabel(rank)}
                      >
                        <RankIcon rank={rank} size={26} />
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
        
        <div className="detailed-vote-submit">
          <div className="vote-progress">
            Voted: {Object.values(votes).filter(v => v !== '').length} of {requiredVotes}
          </div>
          <button 
            onClick={onSubmitVotes}
            className="btn-primary btn-large"
            disabled={Object.values(votes).filter(v => v !== '').length < requiredVotes}
          >
            Submit Votes
          </button>
        </div>
      </div>
    );
  };

  // The name is already answering in this session. Shown ahead of everything
  // else on the join side: it is the only screen that tells the second Chris
  // they are the second Chris, and it used to not exist — the server merged
  // them into the first Chris and said "Reconnected".
  if (!joined && joinCollision) {
    return (
      <div className="player-outer-container-full">
        <div className="player-container">
          <div className="join-screen">
            <JoinNameCollision
              kind={joinCollision.kind}
              playerName={joinCollision.playerName}
              message={joinCollision.message}
              onRejoinAnyway={handleCollisionRejoin}
              onUseAnotherName={handleCollisionRename}
            />
          </div>
        </div>
      </div>
    );
  }

  // Rejoin prompt (B2) — shown before the join screen when a saved identity is
  // detected, replacing the previous silent auto-join.
  if (!joined && rejoinPrompt) {
    return (
      <div className="player-outer-container-full">
        <div className="player-container">
          <div className="join-screen">
            <h1>Welcome back!</h1>
            <div className="game-info">
              <p>Rejoin game <strong>{rejoinPrompt.gameId}</strong> as <strong>{rejoinPrompt.name}</strong>?</p>
            </div>
            <div className="join-form">
              <button type="button" className="btn-primary btn-large" onClick={handleRejoinConfirm}>
                Rejoin as {rejoinPrompt.name}
              </button>
              <button type="button" className="btn-secondary btn-large" onClick={handleRejoinDecline}>
                Join as someone else
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Join screen
  if (!joined) {
    return (
      <div className="player-outer-container-full">
        <div className="player-container">
          <div className="parallax">
            <section className="parallax__header player-parallax">
              <div className="parallax__visuals">
                <div className="parallax__black-line-overflow"></div>
                <div data-parallax-layers className="parallax__layers">
                  <img src="https://cdn.prod.website-files.com/671752cd4027f01b1b8f1c7f/6717795be09b462b2e8ebf71_osmo-parallax-layer-3.webp" loading="eager" width="800" data-parallax-layer="1" alt="" className="parallax__layer-img" />
                  <img src="https://cdn.prod.website-files.com/671752cd4027f01b1b8f1c7f/6717795b4d5ac529e7d3a562_osmo-parallax-layer-2.webp" loading="eager" width="800" data-parallax-layer="2" alt="" className="parallax__layer-img" />
                  <div data-parallax-layer="3" className="parallax__layer-title">
                    <h2 className="parallax__title">Engagements</h2>
                  </div>
                  <img src="https://cdn.prod.website-files.com/671752cd4027f01b1b8f1c7f/6717795bb5aceca85011ad83_osmo-parallax-layer-1.webp" loading="eager" width="800" data-parallax-layer="4" alt="" className="parallax__layer-img" />
                </div>
                <div className="parallax__fade"></div>
              </div>
            </section>
          </div>
          
          <div className="join-screen">
            <h1>Join Engagements</h1>
            {gameId && (
              <div className="game-info">
                <p>Game ID: <strong>{gameId}</strong></p>
                <p className="reconnect-hint">
                  <Icon name="Lightbulb" weight="duotone" size={16} color="var(--primary)" /> Save this URL to easily reconnect later!
                </p>
              </div>
            )}
            {needsAccessCode ? (
              <div className="access-code-form">
                <h3><Icon name="Lock" weight="duotone" size={20} color="var(--primary)" />Private Game</h3>
                <p>This game requires an access code to join.</p>
                <form onSubmit={handleAccessCodeSubmit} className="join-form">
                  <input
                    type="text"
                    value={accessCodeInput}
                    onChange={(e) => setAccessCodeInput(e.target.value)}
                    placeholder="Enter Access Code"
                    className="input-field"
                    required
                  />
                  <button type="submit" className="btn-primary btn-large">
                    Join Game
                  </button>
                  <button 
                    type="button" 
                    className="btn-secondary btn-large"
                    onClick={() => {
                      setNeedsAccessCode(false);
                      setAccessCodeInput('');
                      setNameInput('');
                    }}
                  >
                    Back
                  </button>
                </form>
              </div>
            ) : (
              <form onSubmit={handleJoinGame} className="join-form">
                <input
                  type="text"
                  value={gameId}
                  onChange={(e) => setGameId(e.target.value)}
                  placeholder="Game ID"
                  className="input-field"
                  required
                  readOnly={gameIdFromUrl} // Make read-only if game ID came from URL
                />
                <input
                  type="text"
                  value={nameInput}
                  onChange={(e) => setNameInput(e.target.value)}
                  placeholder="Your Name"
                  className="input-field"
                  required
                />
                <button type="submit" className="btn-primary btn-large">
                  Join Game
                </button>
              </form>
            )}
          </div>
        </div>
      </div>
    );
  }

  // Which ballot row (if any) is this player's own submission — computed once
  // per render so both voting modes below mark the same row.
  const ownAnswerIdx = ownAnswerIndex(answers, mySubmittedAnswer);

  return (
    <div className="player-outer-container-full">
      <div className="player-info-external">
        <span className="player-name"><Icon name="UserCircle" weight="fill" size={16} /> {playerName}</span>
        <span className="game-id">Game: {gameId}</span>
        {currentQuestion && roundNumberOf(currentQuestion, gameState) !== null && (
          <span className="round-number">
            {resolveRoundNoun(currentQuestion, gameType, setRoundNoun)}{' '}
            {roundNumberOf(currentQuestion, gameState)}
          </span>
        )}
        <span 
          className={`websocket-indicator ${wsConnected ? 'connected' : 'disconnected'}`}
          onClick={() => window.location.reload()}
          style={{ cursor: 'pointer' }}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') window.location.reload(); }}
          title={wsConnected ? 'Live connection is healthy — tap to reload' : 'Not connected — tap to reload'}
        >
          <Icon
            name={wsConnected ? 'Broadcast' : 'WifiSlash'}
            weight="bold"
            size={14}
            color={wsConnected ? 'var(--success)' : 'var(--danger)'}
          />{' '}
          {wsConnected ? 'Connected' : 'Not Connected'}
        </span>
      </div>
      
      {rejoinedPlayer && (
        <div className="rejoin-notification" role="status">
          <Icon name="ArrowsClockwise" weight="bold" size={16} color="var(--success)" /> Welcome back! Your previous game state has been restored.
        </div>
      )}
      
      <div className="player-container">
        <div className="parallax">
          <section className="parallax__header player-parallax">
            <div className="parallax__visuals">
              <div className="parallax__black-line-overflow"></div>
              <div data-parallax-layers className="parallax__layers">
                <img src="https://cdn.prod.website-files.com/671752cd4027f01b1b8f1c7f/6717795be09b462b2e8ebf71_osmo-parallax-layer-3.webp" loading="eager" width="800" data-parallax-layer="1" alt="" className="parallax__layer-img" />
                <img src="https://cdn.prod.website-files.com/671752cd4027f01b1b8f1c7f/6717795b4d5ac529e7d3a562_osmo-parallax-layer-2.webp" loading="eager" width="800" data-parallax-layer="2" alt="" className="parallax__layer-img" />
                <div data-parallax-layer="3" className="parallax__layer-title">
                  <h2 className="parallax__title">Engagements</h2>
                </div>
                <img src="https://cdn.prod.website-files.com/671752cd4027f01b1b8f1c7f/6717795bb5aceca85011ad83_osmo-parallax-layer-1.webp" loading="eager" width="800" data-parallax-layer="4" alt="" className="parallax__layer-img" />
              </div>
              <div className="parallax__fade"></div>
            </div>
          </section>
        </div>

      <div className="game-content">
        {isWaitingState(gameState) && (
          <div className="waiting-screen">
            <h2><Icon name="CheckCircle" weight="duotone" size={28} color="var(--success)" />You're in!</h2>
            <p>Waiting for the game to start&hellip;</p>
            <div className="status-indicator">
              <div className="pulse"></div>
              <span>Ready to play</span>
            </div>
            {/* The setup screen's Event Details, on the screen it promises them
                on. Rendered only when there is something to render — the field
                is optional, and an empty labelled box on every lobby would be
                worse than the silence it replaces. */}
            {engagementInfo.trim() && (
              <div className="session-brief">
                <h3>About this session</h3>
                <p>{engagementInfo}</p>
              </div>
            )}
          </div>
        )}

        {gameState.startsWith('ASK#') && currentQuestion && (
          <div className="question-screen">
            <div className="question-header">
              <div className="field-badge">
                {currentQuestion.field || currentQuestion.category}
              </div>
              {currentQuestion.school && (
                <div className="school-name">{currentQuestion.school}</div>
              )}
            </div>
            {gameType === 'call-and-answer' && currentQuestion.image ? (
              /* "Art Title" round: the artwork is the prompt, so lead with the title
                 and show the piece. Detail is normally blank so it does not spoil it. */
              <>
                <div className="lesson-title">
                  {currentQuestion.title || currentQuestion.question}
                </div>
                <img
                  src={currentQuestion.image}
                  alt={currentQuestion.title || 'Artwork'}
                  className="artwork-image"
                onError={(e) => { e.currentTarget.style.display = 'none'; }}
                />
                {currentQuestion.detail && (
                  <div className="lesson-detail">
                    {currentQuestion.detail}
                  </div>
                )}
              </>
            ) : gameType === 'call-and-answer' ? (
              <>
                {/* Only show subtitle if title is different from detail and title is reasonably short */}
                {currentQuestion.title &&
                 currentQuestion.title !== (currentQuestion.detail || currentQuestion.question) &&
                 currentQuestion.title.length < 100 && (
                  <div className="lesson-subtitle">
                    {currentQuestion.title}
                  </div>
                )}
                <div className="lesson-title">
                  {currentQuestion.detail || currentQuestion.question}
                </div>
              </>
            ) : gameType === 'trivia' ? (
              <>
                <div className="lesson-title">
                  {currentQuestion.title || currentQuestion.question}
                </div>
                {currentQuestion.questionDetail && (
                  <div className="lesson-detail">
                    {currentQuestion.questionDetail}
                  </div>
                )}
              </>
            ) : (
              <div className="lesson-title">
                {currentQuestion.title || currentQuestion.question}
              </div>
            )}
            {gameType === 'wavelength' && (currentQuestion.topic || currentQuestion.detail) && (
              <div className="wavelength-topic lesson-detail">
                {currentQuestion.topic
                  ? (<><strong>Topic:</strong> {currentQuestion.topic}</>)
                  : currentQuestion.detail}
              </div>
            )}
            <div className="application-prompt">
              <strong>{getPlayerInstructionText(customInstruction, currentQuestion, gameType)}</strong>
            </div>
            
            {!hasAnswered ? (
              gameType === 'trivia' ? (
                <>
                  <div className="trivia-answer-options">
                    {['optionA', 'optionB', 'optionC', 'optionD', 'optionE', 'optionF']
                      .filter(key => currentQuestion[key])
                      .map((key, index) => {
                        const optionLetter = String.fromCharCode(65 + index);
                        const isSelected = selectedTriviaAnswer === optionLetter;
                        return (
                          <div
                            key={key}
                            className={`category-item trivia-option ${isSelected ? 'active' : ''}`}
                            onClick={() => setSelectedTriviaAnswer(optionLetter)}
                          >
                            <span className="category-name">
                              <span className="option-letter">{optionLetter}.</span> {currentQuestion[key]}
                            </span>
                          </div>
                        );
                      })}
                  </div>
                  
                  <div className="trivia-submit-container">
                    <button 
                      className="btn-primary btn-large"
                      onClick={() => handleSubmitAnswer(null, selectedTriviaAnswer)}
                      disabled={!selectedTriviaAnswer}
                    >
                      Submit Answer
                    </button>
                  </div>
                </>
              ) : gameType === 'wavelength' ? (
                <>
                  <div className="wavelength-input-grid">
                    {wavelengthWords.map((word, index) => (
                      <div key={index} className="wavelength-word-input">
                        <label className="word-label">Word {index + 1}</label>
                        <input
                          type="text"
                          value={word}
                          onChange={(e) => {
                            const newWords = [...wavelengthWords];
                            newWords[index] = e.target.value;
                            setWavelengthWords(newWords);
                          }}
                          placeholder={`Word ${index + 1}`}
                          className="word-input"
                          maxLength="50"
                        />
                      </div>
                    ))}
                  </div>
                  
                  <div className="wavelength-submit-container">
                    <button 
                      className="btn-primary btn-large"
                      onClick={handleSubmitAnswer}
                      disabled={wavelengthWords.filter(word => word.trim()).length === 0}
                    >
                      Submit Words ({wavelengthWords.filter(word => word.trim()).length}/10)
                    </button>
                  </div>
                </>
              ) : (
                <>
                  {isAnswerInputFocused && !isDesktop && (
                    <div className="mobile-input-overlay" onClick={() => setIsAnswerInputFocused(false)}>
                      <div className="mobile-input-container" onClick={(e) => e.stopPropagation()}>
                        <button 
                          className="mobile-minimize-btn mobile-minimize-left"
                          onClick={() => setIsAnswerInputFocused(false)}
                          type="button"
                          aria-label="Close the full-screen editor"
                          title="Close editor"
                        >
                          <Icon name="ArrowDown" weight="bold" size={20} />
                        </button>
                        <button
                          className="mobile-submit-btn-top"
                          onClick={handleSubmitAnswer}
                          type="button"
                          disabled={!answerInput.trim()}
                          aria-label="Submit answer"
                          title="Submit answer"
                        >
                          <Icon name="Airplane" weight="fill" size={20} />
                        </button>
                        <form onSubmit={handleSubmitAnswer} className="mobile-answer-form">
                          <textarea
                            value={answerInput}
                            onChange={(e) => setAnswerInput(e.target.value)}
                            placeholder={getPlayerInstructionText(customInstruction, currentQuestion, gameType)}
                            className="mobile-answer-input"
                            rows={12}
                            required
                            autoFocus
                            spellCheck={true}
                            autoComplete="on"
                            autoCorrect="on"
                            autoCapitalize="sentences"
                          />
                          <button type="submit" className="btn-primary btn-large mobile-submit-btn">
                            Submit Answer
                          </button>
                        </form>
                      </div>
                    </div>
                  )}
                <form onSubmit={handleSubmitAnswer} className="answer-form">
                  <textarea
                    value={answerInput}
                    onChange={(e) => setAnswerInput(e.target.value)}
                    onFocus={() => !isDesktop && setIsAnswerInputFocused(true)}
                    placeholder={getPlayerInstructionText(customInstruction, currentQuestion, gameType)}
                    className="answer-input"
                    rows={isDesktop ? 6 : 4}
                    required
                    spellCheck={true}
                    autoComplete="on"
                    autoCorrect="on"
                    autoCapitalize="sentences"
                  />
                  <button type="submit" className="btn-primary btn-large">
                    Submit Answer
                  </button>
                </form>
                </>
              )
            ) : (
              <div className="answer-submitted">
                <h3>
                  <Icon name="CheckCircle" weight="duotone" size={24} color="var(--success)" />
                  {/* Art Title rounds are call-and-answer with an image, so the
                      image check sits after the real game types and before the
                      generic call-and-answer wording. */}
                  {gameType === 'trivia' ? 'Answer Submitted!' :
                   gameType === 'wavelength' ? 'Words Submitted!' :
                   gameType === 'poll' ? 'Response Submitted!' :
                   currentQuestion?.image ? 'Title Submitted!' : 'Application Submitted!'}
                </h3>
                <p>Waiting for other players&hellip;</p>
              </div>
            )}
          </div>
        )}

        {/*
          `|| hasVoted` IS THE OTHER HALF OF THE TAB-SWITCH REPORT, and it is a
          blank screen rather than a reset one.

          `answers.length > 0` alone is right for the BALLOT — there is nothing
          to rank until the responses are in. It is wrong for the confirmation
          underneath it, because `loadVotingData` returns early once it learns
          this player has already voted and never loads the answers on that
          path. During the session that is invisible: the ballot was on screen a
          moment ago, so `answers` is still populated. Come back to the tab and
          the resync takes the early return with an empty `answers`, so this
          whole block renders nothing at all and a player who has voted is shown
          neither their ballot nor "Votes Submitted!".

          The ballot markup below stays behind `!hasVoted`, so it never renders
          against an empty list.
        */}
        {gameState.startsWith('VOTE#') && (answers.length > 0 || hasVoted) && (
          <div className="voting-screen">
            <h2>
              <Icon name="ListChecks" weight="duotone" size={26} color="var(--primary)" />
              {currentQuestion?.image ? 'Vote for the Best Title'
                : gameType === 'poll' ? 'Vote for the Best Response'
                : 'Vote for the Best Applications'}
            </h2>
            <p>
              {currentQuestion?.image
                ? 'Which title best captures this masterpiece?'
                : gameType === 'poll'
                  ? 'Which response best captures where the room should land?'
                  : 'Which applications would be most valuable for teams to implement?'}
            </p>

            {currentQuestion?.image && (
              <img
                src={currentQuestion.image}
                alt={currentQuestion.title || 'Artwork'}
                className="artwork-image artwork-image-voting"
                onError={(e) => { e.currentTarget.style.display = 'none'; }}
              />
            )}


            {!hasVoted ? (
              <>
                {/* Voting Mode Toggle */}
                <div className="voting-mode-toggle">
                  <button 
                    className={`mode-btn ${votingMode === 'quick' ? 'active' : ''}`}
                    onClick={() => setVotingMode('quick')}
                  >
                    Quick Vote
                  </button>
                  <button 
                    className={`mode-btn ${votingMode === 'detailed' ? 'active' : ''}`}
                    onClick={() => setVotingMode('detailed')}
                  >
                    Detailed Vote
                  </button>
                </div>
                
                {votingMode === 'quick' ? (
                  <>
                    <div className="voting-positions">
                    {['first', 'second', 'third'].slice(0, Math.min(3, answers.length)).map((position, posIndex) => (
                      <div key={position} className="vote-position">
                        <label className="position-label">
                          <RankIcon rank={VOTE_POSITIONS[position]} size={18} />{' '}
                          {rankLabel(VOTE_POSITIONS[position])}:
                        </label>
                        <select 
                          value={votes[position]} 
                          onChange={(e) => handleVoteChange(position, e.target.value)}
                          className="vote-select"
                        >
                          <option value="">Pick player...</option>
                          {answers.map((answer, idx) => {
                            /*
                              NOTHING IS DISABLED HERE, AND THAT IS THE FIX.

                                "the quick view method does not allow for you to
                                 switch votes ... i like how the detailed voted
                                 kicks out the choice anywhere else when you pick
                                 it, make that work for the quick vote."

                              This option used to carry `disabled={isSelected &&
                              !isCurrentSelection}` — an answer already ranked in
                              another slot could not be picked here. The kick-out
                              in `handleVoteChange` has always existed, but a
                              browser will not let you choose a disabled option,
                              so on the quick ballot it was unreachable code. To
                              move an answer from 2nd to 1st the player had to
                              find the 2nd select, empty it by hand, then come
                              back — which is not "switching a vote", it is a
                              puzzle. The detailed cards never had the guard,
                              which is exactly why one path worked.

                              THE LOST AFFORDANCE IS REPLACED, NOT DROPPED.
                              `disabled` was also the only signal that an answer
                              was spoken for, and a select gives us no styling to
                              lean on, so the option says WHERE it currently
                              sits. That text is the accessible name, so it is
                              announced rather than merely seen — and it is the
                              detailed view's `aria-pressed` said in words.
                            */
                            const heldRank = rankHolding(votes, idx);
                            const isCurrentSelection = heldRank === position;
                            const isOwn = idx === ownAnswerIdx;

                            // Truncate long answers for dropdown display
                            const truncatedAnswer = answer.answer.length > 20
                              ? answer.answer.substring(0, 20) + '...'
                              : answer.answer;

                            return (
                              <option
                                key={idx}
                                value={idx}
                                title={answer.answer} // Full answer on hover
                              >
                                "{truncatedAnswer}" - {displayLabelFor(answer, idx)}{isOwn ? ' (Yours)' : ''}
                                {heldRank && !isCurrentSelection
                                  ? ` — currently ${rankLabel(VOTE_POSITIONS[heldRank])}`
                                  : ''}
                              </option>
                            );
                          })}
                        </select>
                      </div>
                    ))}
                  </div>
                  
                  <div className="vote-submit">
                    <button 
                      onClick={handleSubmitVotes}
                      className="btn-primary btn-large"
                      disabled={Object.values(votes).filter(v => v !== '').length < Math.min(3, answers.length)}
                    >
                      Submit Votes
                    </button>
                  </div>
                  </>
                ) : (
                  <DetailedVotingMode
                    answers={answers}
                    votes={votes}
                    onVoteChange={handleVoteChange}
                    onSubmitVotes={handleSubmitVotes}
                    playerName={playerName}
                    requiredVotes={Math.min(3, answers.length)}
                    mySubmittedAnswer={mySubmittedAnswer}
                  />
                )}
              </>
            ) : (
              <div className="vote-submitted">
                <h3><Icon name="CheckCircle" weight="duotone" size={24} color="var(--success)" />Votes Submitted!</h3>
                <p>Waiting for results&hellip;</p>
              </div>
            )}
          </div>
        )}

        {gameState.startsWith('RESULTS#') && (
          <div className="results-screen">
            <h2>
              <Icon name={gameTypeMeta(gameType).icon} weight="duotone" size={26} color="var(--primary)" />
              {resolveRoundNoun(currentQuestion, gameType, setRoundNoun)}{' '}
              {parseInt(gameState.split('#')[1])} Results
            </h2>
            
            {gameType === 'trivia' ? (
              <div className="trivia-player-results">
                <div className="trivia-question-recap">
                  <h3>{currentQuestion?.questionDetail || currentQuestion?.title}</h3>
                </div>
                
                <div className="trivia-options-results">
                  {['optionA', 'optionB', 'optionC', 'optionD', 'optionE', 'optionF']
                    .filter(key => currentQuestion?.[key])
                    .map((key, index) => {
                      const optionLetter = String.fromCharCode(65 + index);
                      const optionId = `Option${optionLetter}`;
                      // Handle different correct answer formats (OptionA vs actual text)
                      const rawCorrectAnswer = currentQuestion?.correctAnswer;
                      let correctAnswers = Array.isArray(rawCorrectAnswer) ? rawCorrectAnswer : [rawCorrectAnswer];
                      
                      // Filter out null/undefined values
                      correctAnswers = correctAnswers.filter(ans => ans != null);
                      
                      // Comprehensive correct answer checking
                      let isCorrect = false;
                      
                      // Check all possible formats
                      for (const correctAns of correctAnswers) {
                        if (!correctAns) continue;
                        
                        // Direct matches
                        if (correctAns === optionId || // "OptionA"
                            correctAns === optionLetter || // "A"  
                            correctAns === currentQuestion?.[key]) { // actual option text
                          isCorrect = true;
                          break;
                        }
                        
                        // Handle "OptionA" format - convert to actual text and compare
                        if (typeof correctAns === 'string' && correctAns.startsWith('Option')) {
                          const correctLetter = correctAns.replace('Option', '');
                          const correctOptionKey = `option${correctLetter}`;
                          if (correctOptionKey === key || correctLetter === optionLetter) {
                            isCorrect = true;
                            break;
                          }
                        }
                        
                        // Handle letter format - convert to option key and compare  
                        if (typeof correctAns === 'string' && correctAns.length === 1 && correctAns.match(/[A-F]/)) {
                          const correctOptionKey = `option${correctAns}`;
                          if (correctOptionKey === key || correctAns === optionLetter) {
                            isCorrect = true;
                            break;
                          }
                        }
                      }
                      
                      // Find player's answer from the answers array (check both name formats)
                      const playerAnswer = answers.find(answer => 
                        answer.name === playerName || answer.playerName === playerName || answer.player === playerName
                      );
                      
                      // Player's answer can be in different formats: "A", "Option A", or the actual option text
                      const playerAnswerValue = playerAnswer?.answer;
                      const isPlayerChoice = playerAnswerValue === optionLetter || 
                                           playerAnswerValue === optionId || 
                                           playerAnswerValue === currentQuestion?.[key];
                      
                      // Debug logging for answer highlighting
                      console.log(`🎯 OPTION ${optionLetter} DEBUG:`);
                      console.log(`  key: "${key}", optionLetter: "${optionLetter}", optionId: "${optionId}"`);
                      console.log(`  Option Value: "${currentQuestion?.[key]}"`);
                      console.log(`  currentQuestion object:`, currentQuestion);
                      console.log(`  Raw correct answer: ${JSON.stringify(rawCorrectAnswer)}`);
                      console.log(`  Processed correct answers: ${JSON.stringify(correctAnswers)}`);
                      console.log(`  isCorrect calculation result: ${isCorrect}`);
                      console.log(`  Player answer value: "${playerAnswerValue}"`);
                      console.log(`  Player answer object:`, playerAnswer);
                      console.log(`  isPlayerChoice: ${isPlayerChoice}`);
                      console.log(`  Classes to apply: isCorrect=${isCorrect}, isPlayerChoice=${isPlayerChoice}, !isCorrect=${!isCorrect}`);
                      console.log(`  Will add player-wrong? ${isPlayerChoice && !isCorrect}`);
                      console.log(`  Will add player-correct? ${isPlayerChoice && isCorrect}`);
                      
                      let className = 'category-item trivia-result-option';
                      
                      // Add correct/incorrect base classes
                      if (isCorrect) {
                        className += ' correct';
                        console.log(`  ✅ Adding 'correct' class to option ${optionLetter}`);
                      } else {
                        className += ' incorrect';
                        console.log(`  ⚪ Adding 'incorrect' class to option ${optionLetter}`);
                      }
                      
                      // Add player-specific classes (these should have higher specificity)
                      if (isPlayerChoice && !isCorrect) {
                        className += ' player-wrong';
                        console.log(`  ❌ Adding 'player-wrong' class to option ${optionLetter} (player's wrong answer)`);
                      }
                      if (isPlayerChoice && isCorrect) {
                        className += ' player-correct';
                        console.log(`  🎯 Adding 'player-correct' class to option ${optionLetter} (player's correct answer)`);
                      }
                      
                      console.log(`  Final className: "${className}"`);
                      console.log(`  ---`);
                      
                      return (
                        <div key={key} className={className}>
                          <span className="category-name">
                            <span className="option-letter">{optionLetter}.</span> {currentQuestion[key]}
                            {isCorrect && <span className="correct-indicator"> <Icon name="CheckCircle" weight="fill" size={16} color="var(--success)" /></span>}
                            {isPlayerChoice && !isCorrect && <span className="wrong-indicator"> <Icon name="XCircle" weight="fill" size={16} color="var(--danger)" /></span>}
                            {isPlayerChoice && <span className="your-choice"> (Your Choice)</span>}
                          </span>
                        </div>
                      );
                    })}
                </div>
                
                <div className="player-results-summary">
                  {playerScoreInfo?.roundScore > 0 && (
                    <div className="round-score">
                      <span className="score-label">This Round:</span>
                      <span className="score-value">+{playerScoreInfo.roundScore} points</span>
                      {(() => {
                        // Find player's answer to show speed bonus breakdown
                        const playerAnswer = answers.find(answer => 
                          answer.name === playerName || answer.playerName === playerName || answer.player === playerName
                        );
                        if (playerAnswer && playerAnswer.speedBonus > 0) {
                          return (
                            <div className="speed-bonus-info">
                              <small>
                                ({playerAnswer.basePoints} base + {playerAnswer.speedBonus} speed bonus)
                                <span className="speed-icon"> <Icon name="Lightning" weight="fill" size={13} color="var(--primary)" /></span>
                              </small>
                            </div>
                          );
                        }
                        return null;
                      })()}
                    </div>
                  )}
                  <div className="player-total-score">
                    <span className="score-label">Total Score:</span>
                    <span className="score-value">{playerScoreInfo?.totalScore || playerScore} points</span>
                  </div>
                  {playerScoreInfo?.rankDisplay && (
                    <div className="player-ranking">
                      <span className="ranking-label">Ranking:</span>
                      <span className="ranking-value">{playerScoreInfo.rankDisplay} out of {playerScoreInfo.totalPlayers} players</span>
                    </div>
                  )}
                  
                  {playerRanking && playerScore > 0 && (
                    <div className="player-ranking">
                      <span className="ranking-label">Your Ranking:</span>
                      <span className="ranking-value">
                        <RankIcon rank={playerRanking.rank} size={18} />{' '}
                        {playerRanking.rank} of {playerRanking.total}
                      </span>
                    </div>
                  )}
                </div>
              </div>
            ) : gameType === 'wavelength' ? (
              <div className="wavelength-results">
                <div className="wavelength-question-recap">
                  <h3>{currentQuestion?.title}</h3>
                  {(currentQuestion?.topic || currentQuestion?.detail) && (
                    <div className="wavelength-topic-display">
                      {currentQuestion.topic
                        ? (<><strong>Topic:</strong> {currentQuestion.topic}</>)
                        : currentQuestion.detail}
                    </div>
                  )}
                </div>
                
                <div className="wavelength-common-words">
                  <h4><Icon name="Handshake" weight="duotone" size={20} color="var(--primary)" />Common Words</h4>
                  {answers && answers.length > 0 ? (
                    <div className="common-words-display">
                      {(() => {
                        // Process answers to find common words
                        const allWords = [];
                        const wordCounts = {};
                        
                        answers.forEach(answer => {
                          if (answer.answer) {
                            const words = answer.answer.split(',').map(w => w.trim().toLowerCase()).filter(w => w);
                            allWords.push(...words);
                            words.forEach(word => {
                              wordCounts[word] = (wordCounts[word] || 0) + 1;
                            });
                          }
                        });
                        
                        // Find words mentioned by 2+ players
                        const commonWords = Object.entries(wordCounts)
                          .filter(([word, count]) => count > 1)
                          .sort((a, b) => b[1] - a[1]);
                        
                        if (commonWords.length === 0) {
                          return <p className="no-common-words">No common words found — everyone had unique responses.</p>;
                        }
                        
                        return (
                          <div className="common-words-list">
                            {commonWords.map(([word, count]) => (
                              <div key={word} className="common-word-item">
                                <span className="word">{word}</span>
                                <span className="count">({count} {count === 1 ? 'player' : 'players'})</span>
                              </div>
                            ))}
                          </div>
                        );
                      })()}
                    </div>
                  ) : (
                    <p>No responses to display</p>
                  )}
                </div>
                
                <div className="wavelength-your-words">
                  <h4><Icon name="NotePencil" weight="duotone" size={20} color="var(--primary)" />Your Words</h4>
                  {(() => {
                    const playerAnswer = answers.find(answer => 
                      answer.name === playerName || answer.playerName === playerName || answer.player === playerName
                    );
                    
                    if (playerAnswer && playerAnswer.answer) {
                      const words = playerAnswer.answer.split(',').map(w => w.trim()).filter(w => w);
                      return (
                        <div className="player-words-display">
                          {words.map((word, index) => (
                            <span key={index} className="player-word">{word}</span>
                          ))}
                        </div>
                      );
                    }
                    
                    return <p>No words submitted</p>;
                  })()}
                </div>
                
                <div className="wavelength-stats">
                  <div className="stat-item">
                    <span className="stat-label">Total Responses:</span>
                    <span className="stat-value">{answers?.length || 0}</span>
                  </div>
                  <div className="stat-item">
                    <span className="stat-label">Unique Words:</span>
                    <span className="stat-value">
                      {(() => {
                        const allWords = new Set();
                        answers?.forEach(answer => {
                          if (answer.answer) {
                            answer.answer.split(',').forEach(word => {
                              const cleaned = word.trim().toLowerCase();
                              if (cleaned) allWords.add(cleaned);
                            });
                          }
                        });
                        return allWords.size;
                      })()}
                    </span>
                  </div>
                </div>
              </div>
            ) : (
              <div className="call-and-answer-results">
                <div className="player-results-summary">
                  {playerScoreInfo ? (
                    <>
                      <div className="player-ranking-display">
                        <span className="ranking-main">{playerScoreInfo.rankDisplay}</span>
                        <span className="ranking-detail">out of {playerScoreInfo.totalPlayers} players</span>
                      </div>
                      
                      <div className="player-scores-breakdown">
                        <div className="round-score">
                          <span className="score-label">This Round:</span>
                          <span className="score-value">+{playerScoreInfo.roundScore} points</span>
                        </div>
                        <div className="total-score">
                          <span className="score-label">Total Score:</span>
                          <span className="score-value">{playerScoreInfo.totalScore} points</span>
                        </div>
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="player-total-score">
                        <span className="score-label">Total Score:</span>
                        <span className="score-value">{playerScore} points</span>
                      </div>
                      
                      {playerRanking && playerScore > 0 && (
                        <div className="player-ranking">
                          <span className="ranking-label">Your Ranking:</span>
                          <span className="ranking-value">
                            <RankIcon rank={playerRanking.rank} size={18} />{' '}
                            {playerRanking.rank} of {playerRanking.total}
                          </span>
                        </div>
                      )}
                    </>
                  )}
                </div>
                
                <div className="results-message">
                  <p>Check the main screen for detailed results and AI insights!</p>
                </div>
              </div>
            )}
            
            <div className="status-indicator">
              <div className="pulse"></div>
              <span>Ready for next question</span>
            </div>
          </div>
        )}
      </div>
      </div>

      {/* Game End Modal */}
      {showGameEndModal && (
        <div className="modal-overlay" onClick={closeGameEndModal}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <h3><Icon name="FlagCheckered" weight="duotone" size={24} color="var(--primary)" />Game Complete!</h3>
            <p>All questions have been completed. Thank you for playing!</p>
            <div className="modal-actions">
              <button 
                className="btn-primary" 
                onClick={() => {
                  closeGameEndModal();
                  checkAndDownloadReport();
                }}
              >
                Download Report
              </button>
              <button 
                className="btn-secondary" 
                onClick={closeGameEndModal}
              >
                Close
              </button>
            </div>
            {!reportAvailable && (
              <div className="report-status">
                <p><em>If the report isn't ready yet, please ask the host to generate it.</em></p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Reading one response in full.

          MOUNTED ONCE, AT THE PAGE ROOT, rather than inside the voting view —
          `answers` is page state and the same list is on screen during VOTE and
          during RESULTS, so one mount serves both phases and there is one piece
          of open/closed state rather than two that can disagree.

          `displayLabelFor`, not `stageLabelFor`: on a player's own device the
          row decides. The server has already redacted what this player may not
          see, and there is no projector here for a session setting to protect.
          That is the same call the cards behind it make. */}
      <AnswerSpotlight
        answers={answers}
        index={spotlightIndex}
        onIndex={setSpotlightIndex}
        onClose={() => setSpotlightIndex(null)}
        labelFor={displayLabelFor}
        title="Response"
      />

      {/* GitHub Issue Reporting FAB */}
      <IssueFab context="player" gameId={gameId} />
    </div>
  );
}

export default PlayerPage;