import React, { useState, useEffect, useRef } from 'react';
import webSocketClient from './WebSocketClient';
import IssueFab from './components/IssueFab';
import Icon from './components/Icon';
import RankIcon, { rankLabel, VOTE_POSITIONS } from './components/RankIcon';
import { gameTypeMeta } from './config/gameTypes';

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

// Helper function to get instruction text
const getPlayerInstructionText = (customInstruction, currentQuestion) => {
  // Question-level custom instructions take priority
  if (currentQuestion && currentQuestion.customInstructions) {
    return currentQuestion.customInstructions;
  }
  // Then question set level custom instruction
  if (customInstruction) {
    return customInstruction;
  }
  // Default fallback
  return 'How could you adapt this lesson to your work, project, or team?';
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
  const [hasAnswered, setHasAnswered] = useState(false);
  const [gameState, setGameState] = useState('CREATED'); // CREATED, STARTED, ASK#001, VOTE#001, RESULTS#001
  const [gameType, setGameType] = useState('call-and-answer'); // 'call-and-answer' or 'trivia'
  const [selectedTriviaAnswer, setSelectedTriviaAnswer] = useState(null); // For trivia: stores selected option letter
  const [wavelengthWords, setWavelengthWords] = useState(Array(10).fill('')); // For wavelength: stores 10 words
  const [answers, setAnswers] = useState([]);
  const [votes, setVotes] = useState({ first: '', second: '', third: '' });
  const [hasVoted, setHasVoted] = useState(false);
  const [isAnswerInputFocused, setIsAnswerInputFocused] = useState(false);
  const [isDesktop, setIsDesktop] = useState(false);
  const [gameIdFromUrl, setGameIdFromUrl] = useState(false);
  const [lastVoteInteraction, setLastVoteInteraction] = useState(0);
  const [isUserVoting, setIsUserVoting] = useState(false);
  const [rejoinedPlayer, setRejoinedPlayer] = useState(false);
  const [rejoinPrompt, setRejoinPrompt] = useState(null); // { gameId, name } | null
  const [votingMode, setVotingMode] = useState('quick'); // 'quick' or 'detailed'
  const [playerScore, setPlayerScore] = useState(0);
  const [playerRanking, setPlayerRanking] = useState(null);
  const [playerScoreInfo, setPlayerScoreInfo] = useState(null);
  const [allPlayers, setAllPlayers] = useState([]);
  const [customInstruction, setCustomInstruction] = useState(null);
  const [lastProcessedQuestionId, setLastProcessedQuestionId] = useState(null);
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

  // 🔄 Attempt to automatically join the game
  const attemptAutoJoin = async (gameId, name, accessCode = null) => {
    try {
      console.log(`🔄 PLAYER: Auto-joining game ${gameId} as ${name}`);
      const joinRes = await fetch(`${API_BASE}games/${gameId}/players`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          playerName: name.trim(),
          accessCode: accessCode 
        }),
      });

      if (joinRes.ok) {
        const joinData = await joinRes.json();
        console.log(`✅ PLAYER: Auto-join successful`, joinData);
        
        setPlayerName(name.trim());
        setJoined(true);
        localStorage.setItem(`playerName_${gameId}`, name.trim());
        
        // Check if auto-join was a rejoin (server sends isReconnection)
        if (joinData.isReconnection || joinData.rejoined) {
          setRejoinedPlayer(true);
          console.log(`🔄 PLAYER: Auto-rejoined existing player`);
          // Note: Vote restoration will happen automatically in checkGameState when entering voting phase
        }
        
        // Immediately check game state to load current question/voting/results
        setTimeout(() => checkGameState(gameId, name.trim()), 100);
        
        // Update URL to include name if not already there
        const url = new URL(window.location);
        url.searchParams.set('name', name.trim());
        window.history.replaceState(null, '', url);
      } else {
        // Check if this is an access code error
        try {
          const errorData = await joinRes.json();
          if (errorData.error === 'Access code required') {
            console.log(`🔐 PLAYER: Game requires access code - showing access code input`);
            setNeedsAccessCode(true);
            setPlayerName(name.trim());
            return;
          }
        } catch (parseError) {
          // Ignore parse errors for non-JSON responses
        }
        console.log(`❌ PLAYER: Auto-join failed - will show join form`);
      }
    } catch (e) {
      console.error('PLAYER: Auto-join error:', e);
    }
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
      return;
    }
    
    try {
      console.log('📋 PLAYER: Fetching instruction for set:', setId);
      const response = await fetch(`${API_BASE}question-sets`);
      if (response.ok) {
        const data = await response.json();
        const questionSet = data.sets?.find(set => set.id === setId);
        if (questionSet && questionSet.customInstruction) {
          console.log('📋 PLAYER: Found custom instruction:', questionSet.customInstruction);
          setCustomInstruction(questionSet.customInstruction);
        } else {
          console.log('📋 PLAYER: No custom instruction found, using default');
          setCustomInstruction(null);
        }
      }
    } catch (error) {
      console.error('Error fetching question set instruction:', error);
      setCustomInstruction(null);
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

  // Check if player has already answered this question
  const checkPlayerAnswer = async (gameId, playerName, questionNumber) => {
    try {
      const answerRes = await fetch(`${API_BASE}games/${gameId}/answers?player=${encodeURIComponent(playerName)}&question=${questionNumber}`);
      if (answerRes.ok) {
        const answerData = await answerRes.json();
        return answerData.hasAnswer || false;
      }
      return false;
    } catch (error) {
      console.error('Error checking player answer:', error);
      return false;
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
        
        // Check if player has already answered this question
        const hasAnswered = await checkPlayerAnswer(gameId, playerName, questionNumber);
        setHasAnswered(hasAnswered);
        
        // Reset answer input for new question
        if (!hasAnswered) {
          setAnswerInput('');
          setSelectedTriviaAnswer('');
        }
        
        // Fetch question set instructions
        if (questionData.setId) {
          fetchQuestionSetInstruction(questionData.setId);
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
        
        // Clear previous votes when moving to new voting round
        if (gameState !== serverGameState) {
          setVotes({ first: '', second: '', third: '' });
          setHasVoted(false);
          console.log('🔄 Cleared previous votes for new voting round');
        }
        
        // Load voting data for this question
        await loadVotingData(questionNumber);
        
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
      }
      
    } catch (error) {
      console.error('❌ PLAYER: Error checking game state:', error);
    }
  };
  
  // Load voting data for the current question
  const loadVotingData = async (questionNumber) => {
    if (!gameId || !playerName) {
      console.log('⏭️ PLAYER: Skipping loadVotingData - no gameId or playerName');
      return;
    }
    
    try {
      console.log(`🗳️ PLAYER: Loading voting data for question ${questionNumber} in game ${gameId}`);
      
      // First, check if player has already voted by checking game state
      const hasAlreadyVoted = await checkPlayerVote(gameId, playerName, questionNumber);
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
  
  // Check if player has already voted by checking if vote record exists
  const checkPlayerVote = async (gameId, playerName, questionNumber) => {
    try {
      // We need to check if the vote record exists for this player
      // Since we don't have the playerId, we'll need to use a different approach
      // The WebSocket system stores votes with the player name, so let's check directly
      
      // First, let's try to find the player ID by getting all players and finding by name
      // But for now, let's use a more direct approach - check if the player is in the hasVoted list
      
      const stateRes = await fetch(`${API_BASE}games/${gameId}/state`);
      if (stateRes.ok) {
        const stateData = await stateRes.json();
        
        // Check if this player is in the voters list during voting phase
        if (stateData.votingProgress && stateData.votingProgress.votersIds) {
          const hasVoted = stateData.votingProgress.votersIds.includes(playerName);
          console.log(`🗳️ PLAYER: Vote check for ${playerName}: ${hasVoted ? 'already voted' : 'not voted yet'}`);
          return hasVoted;
        }
      }
      return false;
    } catch (error) {
      console.error('Error checking player vote:', error);
      return false;
    }
  };

  const handleJoinGame = async (e) => {
    e.preventDefault();
    if (!nameInput.trim() || !gameId) return;

    try {
      const apiUrl = `${API_BASE}games/${gameId}/players`;
      console.log('🔍 DEBUGGING API Call:');
      console.log('  - Game ID:', gameId);
      console.log('  - API_BASE:', API_BASE);
      console.log('  - Full URL:', apiUrl);
      console.log('  - Current domain:', window.location.host);
      console.log('  - Current pathname:', window.location.pathname);
      
      const joinRes = await fetch(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          playerName: nameInput.trim(),
          accessCode: accessCodeInput.trim() || null
        }),
      });

      console.log('📡 RESPONSE DEBUGGING:');
      console.log('  - Status:', joinRes.status);
      console.log('  - OK:', joinRes.ok);
      console.log('  - Headers:', Object.fromEntries(joinRes.headers.entries()));
      
      // Check content type to see if we're getting HTML instead of JSON
      const contentType = joinRes.headers.get('content-type');
      console.log('  - Content-Type:', contentType);

      if (!joinRes.ok) {
        try {
          const errorData = await joinRes.json();
          console.log('Join error response:', errorData);
          
          // Check if this is an access code error
          if (errorData.error === 'Access code required') {
            setNeedsAccessCode(true);
            return;
          }
          
          alert(errorData.message || errorData.error || 'Failed to join game. Please check the game ID and try again.');
        } catch (parseError) {
          console.error('Failed to parse error response:', parseError);
          alert('Failed to join game. Please check the game ID and try again.');
        }
        return;
      }

      // Only set state if join was successful
      const successData = await joinRes.json();
      console.log('✅ PLAYER: Manual join success:', successData);
      
      setPlayerName(nameInput.trim());
      setJoined(true);
      localStorage.setItem(`playerName_${gameId}`, nameInput.trim());
      
      // Check if this was a rejoin (server sends isReconnection)
      if (successData.isReconnection || successData.rejoined) {
        setRejoinedPlayer(true);
        console.log(`🔄 PLAYER: Rejoined successfully`);
        // Note: Vote restoration will happen automatically in checkGameState when entering voting phase
      }
      
      // Immediately check game state to load current question/voting/results
      setTimeout(() => checkGameState(gameId, nameInput.trim()), 100);
      
      // Update URL to include both gameId and name for easy sharing/reconnection
      const url = new URL(window.location);
      url.searchParams.set('gameId', gameId);
      url.searchParams.set('name', nameInput.trim());
      window.history.replaceState(null, '', url);
      console.log(`🔗 PLAYER: Updated URL for reconnection: ${url.search}`);
    } catch (e) {
      console.error('handleJoinGame fetch error:', e);
      console.error('Error details:', {
        message: e.message,
        name: e.name,
        stack: e.stack
      });
      alert('Network error. Please check your connection and try again.');
    }
  };

  // Handle access code submission
  const handleAccessCodeSubmit = async (e) => {
    e.preventDefault();
    if (!accessCodeInput.trim()) return;
    
    try {
      const joinRes = await fetch(`${API_BASE}games/${gameId}/players`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          playerName: nameInput.trim(),
          accessCode: accessCodeInput.trim()
        }),
      });

      if (joinRes.ok) {
        const successData = await joinRes.json();
        console.log('✅ PLAYER: Access code join success:', successData);
        
        setPlayerName(nameInput.trim());
        setJoined(true);
        setNeedsAccessCode(false);
        localStorage.setItem(`playerName_${gameId}`, nameInput.trim());
        
        // Check if this was a rejoin (server sends isReconnection)
        if (successData.isReconnection || successData.rejoined) {
          setRejoinedPlayer(true);
        }
        
        // Immediately check game state to load current question/voting/results
        setTimeout(() => checkGameState(gameId, nameInput.trim()), 100);
      } else {
        const errorData = await joinRes.json();
        alert(errorData.message || errorData.error || 'Invalid access code. Please try again.');
      }
    } catch (error) {
      console.error('Access code submission error:', error);
      alert('Network error. Please check your connection and try again.');
    }
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

    const newVotes = { ...votes };
    
    // Clear this answer from other positions if it's already selected
    Object.keys(newVotes).forEach(pos => {
      if (newVotes[pos] === answerIndex && pos !== position) {
        newVotes[pos] = '';
      }
    });
    
    // Set the new vote - answerIndex comes as string from select onChange
    newVotes[position] = answerIndex;
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
  const handleRejoinConfirm = () => {
    if (!rejoinPrompt) return;
    const { gameId: gid, name } = rejoinPrompt;
    console.log(`✅ PLAYER: Rejoining game ${gid} as ${name}`);
    setPlayerName(name);
    setJoined(true);
    localStorage.setItem(`playerName_${gid}`, name);
    lastRankRef.current = -1; // fresh phase tracking for this session
    setRejoinPrompt(null);
    // Restore the player's place (checkPlayerAnswer/checkPlayerVote guards
    // prevent re-answering/re-voting).
    setTimeout(() => checkGameState(gid, name), 100);
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
  const DetailedVotingMode = ({ answers, votes, onVoteChange, onSubmitVotes, playerName, requiredVotes }) => {
    const handleVoteClick = (answerIndex, position) => {
      // Track interaction to prevent polling interference
      setLastVoteInteraction(Date.now());
      setIsUserVoting(true);
      setTimeout(() => setIsUserVoting(false), 3000);
      
      // If this position is already assigned to this answer, remove it
      if (votes[position] === answerIndex.toString()) {
        onVoteChange(position, ''); // Remove vote
      } else {
        onVoteChange(position, answerIndex.toString()); // Assign vote (will automatically clear from other positions)
      }
    };

    const getVotePosition = (answerIndex) => {
      if (votes.first === answerIndex.toString()) return 'first';
      if (votes.second === answerIndex.toString()) return 'second';
      if (votes.third === answerIndex.toString()) return 'third';
      return null;
    };

    return (
      <div className="detailed-voting">
        <div className="detailed-answers">
          {answers.map((answer, idx) => {
            const currentPosition = getVotePosition(idx);
            
            return (
              <div key={idx} className={`detailed-answer-card ${answer.name === playerName ? 'own-answer' : ''}`}>
                <div className="answer-content">
                  <div className="answer-text">"{answer.answer}"</div>
                  <div className="answer-author">by {answer.name}{answer.name === playerName ? ' (You)' : ''}</div>
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

  return (
    <div className="player-outer-container-full">
      <div className="player-info-external">
        <span className="player-name"><Icon name="UserCircle" weight="fill" size={16} /> {playerName}</span>
        <span className="game-id">Game: {gameId}</span>
        {currentQuestion && <span className="lesson-number">Lesson {currentQuestion.id}</span>}
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
            {gameType === 'call-and-answer' ? (
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
              <strong>{gameType === 'trivia' ? 'Select the best answer:' :
                       gameType === 'wavelength' ? (currentQuestion?.customInstructions || customInstruction || 'Enter up to 10 words or short phrases that come to mind:') :
                       getPlayerInstructionText(customInstruction, currentQuestion)}</strong>
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
                            placeholder={currentQuestion?.customInstructions || 
                              (gameType === 'wavelength' ? 'Enter up to 10 words or short phrases that come to mind...' :
                               gameType === 'poll' ? 'Share your opinion...' :
                               'Describe how you would apply this lesson to your work, project, or team...')}
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
                    placeholder={currentQuestion?.customInstructions || 
                      (gameType === 'wavelength' ? 'Enter up to 10 words or short phrases that come to mind...' :
                       gameType === 'poll' ? 'Share your opinion...' :
                       'Describe how you would apply this lesson to your work, project, or team...')}
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
                  {gameType === 'trivia' ? 'Answer Submitted!' :
                   gameType === 'wavelength' ? 'Words Submitted!' :
                   gameType === 'poll' ? 'Response Submitted!' : 'Application Submitted!'}
                </h3>
                <p>Waiting for other players&hellip;</p>
              </div>
            )}
          </div>
        )}

        {gameState.startsWith('VOTE#') && answers.length > 0 && (
          <div className="voting-screen">
            <h2>
              <Icon name="ListChecks" weight="duotone" size={26} color="var(--primary)" />
              {gameType === 'poll' ? 'Vote for the Best Response' : 'Vote for the Best Applications'}
            </h2>
            <p>
              {gameType === 'poll'
                ? 'Which response best captures where the room should land?'
                : 'Which applications would be most valuable for teams to implement?'}
            </p>
            
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
                            const isSelected = Object.values(votes).includes(idx.toString());
                            const isCurrentSelection = votes[position] === idx.toString();
                            const shouldDisable = isSelected && !isCurrentSelection;
                            
                            // Truncate long answers for dropdown display
                            const truncatedAnswer = answer.answer.length > 20 
                              ? answer.answer.substring(0, 20) + '...' 
                              : answer.answer;
                            
                            return (
                              <option 
                                key={idx} 
                                value={idx}
                                disabled={shouldDisable}
                                title={answer.answer} // Full answer on hover
                              >
                                "{truncatedAnswer}" by {answer.name}{answer.name === playerName ? ' (You)' : ''}
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
              Question {parseInt(gameState.split('#')[1])} Results
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

      {/* GitHub Issue Reporting FAB */}
      <IssueFab context="player" gameId={gameId} />
    </div>
  );
}

export default PlayerPage;