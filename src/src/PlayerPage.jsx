import React, { useState, useEffect } from 'react';
import webSocketClient from './WebSocketClient';

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
const getPlayerInstructionText = (customInstruction) => {
  if (customInstruction) {
    return customInstruction;
  }
  // Default fallback
  return 'How could you adapt this lesson to your work, project, or team?';
};

function PlayerPage() {
  const [gameId, setGameId] = useState('');
  const [playerName, setPlayerName] = useState('');
  const [nameInput, setNameInput] = useState('');
  const [joined, setJoined] = useState(false);
  const [currentQuestion, setCurrentQuestion] = useState(null);
  const [answerInput, setAnswerInput] = useState('');
  const [hasAnswered, setHasAnswered] = useState(false);
  const [gameState, setGameState] = useState('waiting'); // waiting, question, voting, results
  const [gameType, setGameType] = useState('call-and-answer'); // 'call-and-answer' or 'trivia'
  const [selectedTriviaAnswer, setSelectedTriviaAnswer] = useState(null); // For trivia: stores selected option letter
  const [answers, setAnswers] = useState([]);
  const [votes, setVotes] = useState({ first: '', second: '', third: '' });
  const [hasVoted, setHasVoted] = useState(false);
  const [isAnswerInputFocused, setIsAnswerInputFocused] = useState(false);
  const [isDesktop, setIsDesktop] = useState(false);
  const [gameIdFromUrl, setGameIdFromUrl] = useState(false);
  const [lastVoteInteraction, setLastVoteInteraction] = useState(0);
  const [isUserVoting, setIsUserVoting] = useState(false);
  const [rejoinedPlayer, setRejoinedPlayer] = useState(false);
  const [votingMode, setVotingMode] = useState('quick'); // 'quick' or 'detailed'
  const [playerScore, setPlayerScore] = useState(0);
  const [playerRanking, setPlayerRanking] = useState(null);
  const [allPlayers, setAllPlayers] = useState([]);
  const [customInstruction, setCustomInstruction] = useState(null);
  const [lastProcessedQuestionId, setLastProcessedQuestionId] = useState(null);

  // WebSocket state
  const [wsConnected, setWsConnected] = useState(false);
  const [useWebSocket, setUseWebSocket] = useState(true); // Always use WebSocket

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
          // Previously joined this game with this name
          console.log(`✅ PLAYER: Auto-joining - name matches saved data`);
          setPlayerName(nameFromUrl);
          setJoined(true);
          // Immediately check game state to load current question/voting/results
          setTimeout(() => {
            checkGameState(gameIdFromUrl, nameFromUrl);
          }, 100);
        } else {
          // Try to join automatically
          console.log(`🔄 PLAYER: Auto-joining with URL name (not previously saved)`);
          attemptAutoJoin(gameIdFromUrl, nameFromUrl);
        }
      } else if (savedName) {
        // No name in URL but we have saved name - pre-fill the form
        console.log(`💾 PLAYER: Pre-filling form with saved name: ${savedName}`);
        setNameInput(savedName);
      }
    } else {
      console.log(`🔗 PLAYER: No game ID in URL - showing manual join form`);
      // No game ID in URL - player will need to enter it manually
    }
  }, []);

  // 🔄 Attempt to automatically join the game
  const attemptAutoJoin = async (gameId, name) => {
    try {
      console.log(`🔄 PLAYER: Auto-joining game ${gameId} as ${name}`);
      const joinRes = await fetch(`${API_BASE}games/${gameId}/players`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim() }),
      });

      if (joinRes.ok) {
        const joinData = await joinRes.json();
        console.log(`✅ PLAYER: Auto-join successful`, joinData);
        
        setPlayerName(name.trim());
        setJoined(true);
        localStorage.setItem(`playerName_${gameId}`, name.trim());
        
        // Check if auto-join was a rejoin
        if (joinData.rejoined) {
          setRejoinedPlayer(true);
          console.log(`🔄 PLAYER: Auto-rejoined with previous score: ${joinData.previousScore}`);
          // Note: Vote restoration will happen automatically in checkGameState when entering voting phase
        }
        
        // Immediately check game state to load current question/voting/results
        setTimeout(() => checkGameState(gameId, name.trim()), 100);
        
        // Update URL to include name if not already there
        const url = new URL(window.location);
        url.searchParams.set('name', name.trim());
        window.history.replaceState(null, '', url);
      } else {
        console.log(`❌ PLAYER: Auto-join failed - will show join form`);
      }
    } catch (e) {
      console.error('PLAYER: Auto-join error:', e);
    }
  };

  // Save partial vote state to server
  const savePartialVote = async (playerName, questionId, votes) => {
    if (!gameId || !playerName || !questionId) return;
    
    // Only save if there are actual votes to preserve
    const hasVotes = Object.values(votes).some(v => v !== '');
    if (!hasVotes) return;
    
    try {
      const response = await fetch(`${API_BASE}games/${gameId}/partial-votes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          playerName: playerName,
          questionNumber: questionId,
          votes: votes
        })
      });
      
      if (response.ok) {
        console.log('💾 PLAYER: Partial vote saved to server', { questionId, votes });
      } else {
        console.error('Failed to save partial vote:', response.status);
      }
    } catch (e) {
      console.error('Failed to save partial vote:', e);
    }
  };

  // Restore partial vote from server
  const restorePartialVote = async (playerName, questionId) => {
    if (!gameId || !playerName || !questionId) return;
    
    try {
      const response = await fetch(`${API_BASE}games/${gameId}/partial-votes?playerName=${playerName}&questionNumber=${questionId}`, {
        // Add headers to suppress console 404 logging in browser
        headers: {
          'Accept': 'application/json'
        }
      });
      
      if (response.ok) {
        const data = await response.json();
        
        // Set protection flags to prevent polling interference
        setLastVoteInteraction(Date.now());
        setIsUserVoting(true);
        
        // Restore vote state
        setVotes(data.votes || { first: '', second: '', third: '' });
        
        // Clear protection flag
        setTimeout(() => {
          setIsUserVoting(false);
        }, 2000);
        
        console.log('🔄 PLAYER: Partial vote restored from server', data.votes);
        return true;
      } else if (response.status === 404) {
        // 404 is expected for first vote - don't log as error
        console.log('🔄 PLAYER: No partial vote found - starting fresh');
        return false;
      } else {
        // Only log unexpected errors
        console.error('🚨 PLAYER: Unexpected error restoring partial vote:', response.status);
        return false;
      }
    } catch (e) {
      console.error('Failed to restore partial vote:', e);
      return false;
    }
  };

  // Clean up partial vote on game end
  const cleanupPartialVote = async (playerName, questionId) => {
    if (!gameId || !playerName || !questionId) return;
    
    try {
      // Partial votes have TTL, but we can clean up immediately when votes are submitted
      console.log('🧹 PLAYER: Partial vote will auto-expire via TTL');
    } catch (e) {
      console.error('Failed to cleanup partial vote:', e);
    }
  };

  // REMOVED: HTTP polling - WebSocket handles all state updates

  // Monitor WebSocket mode changes from admin panel
  useEffect(() => {
    const checkWebSocketMode = () => {
      const adminSetting = localStorage.getItem('admin_websocket_mode') === 'true';
      const windowSetting = window.WEBSOCKET_MODE || false;
      const currentMode = adminSetting || windowSetting;
      
      if (currentMode !== useWebSocket) {
        console.log(`🔌 PLAYER: WebSocket mode changed: ${currentMode ? 'ENABLED' : 'DISABLED'}`);
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
      // Fetch current game state from API
      checkGameState();
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

    // Connect as player
    const connected = webSocketClient.connect(gameId, playerName, false);
    if (!connected) {
      console.error('🔌 Failed to connect WebSocket, falling back to polling');
      setUseWebSocket(false);
    } else {
      // Do initial state check when WebSocket connects
      console.log('🔌 PLAYER: WebSocket connected, doing initial state check');
      setTimeout(() => checkGameState(), 500);
    }

    return () => {
      console.log(`🔌 PLAYER: Disconnecting WebSocket for game ${gameId}`);
      webSocketClient.disconnect();
      webSocketClient.onConnectionStatusChange(null);
      webSocketClient.offMessage('initialStateSync');
      webSocketClient.offMessage('gameStateChanged');
      webSocketClient.offMessage('questionStarted');
      webSocketClient.offMessage('playerAnswered');
      webSocketClient.offMessage('playerVoted');
      webSocketClient.offMessage('aiSummaryReady');
    };
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

  const checkGameState = async (gameIdOverride = null, playerNameOverride = null) => {
    const currentGameId = gameIdOverride || gameId;
    const currentPlayerName = playerNameOverride || playerName;
    
    if (!currentGameId || !currentPlayerName) {
      console.log('⏭️ PLAYER: Skipping checkGameState - no gameId or playerName yet');
      return;
    }
    
    try {
      // Check game state from the database
      const stateRes = await fetch(`${API_BASE}games/${currentGameId}/state`);
      const stateJson = await stateRes.json();
      const serverGameState = stateJson.state || 'waiting';
      const currentQuestionNumber = stateJson.currentQuestion; // Use currentQuestion (sequential number)
      const serverGameType = stateJson.gameType || 'call-and-answer';
      
      // Update game type if changed
      if (serverGameType !== gameType) {
        setGameType(serverGameType);
      }
      
      if (serverGameState === 'question' && currentQuestionNumber) {
        // Get the current question from the game state data
        const newQuestionData = stateJson.currentQuestionData;
        
        if (newQuestionData) {
          console.log(`✅ PLAYER: Found question in state:`, newQuestionData);
          console.log(`📝 PLAYER: Question number: ${currentQuestionNumber}`);
          
          // Check if this is a NEW question by comparing against the last processed question ID
          const isNewQuestion = lastProcessedQuestionId !== currentQuestionNumber;
          
          // Set the current question ID to the sequential number for consistency
          newQuestionData.id = currentQuestionNumber;
          
          setCurrentQuestion(newQuestionData);
          
          // Fetch custom instruction for this question's set
          if (newQuestionData.setId || newQuestionData.SetId) {
            fetchQuestionSetInstruction(newQuestionData.setId || newQuestionData.SetId);
          }
          
          // CRITICAL FIX: Only check answer status and reset state for NEW questions
          // This prevents race conditions that cause auto-submission
          if (isNewQuestion) {
            console.log(`🆕 PLAYER: New question detected (${currentQuestionNumber}) - checking answer status`);
            
            // Mark this question as processed to prevent repeated processing
            setLastProcessedQuestionId(currentQuestionNumber);
            
            // Check if player has already answered this question
            const answersRes = await fetch(`${API_BASE}games/${currentGameId}/answers?questionNumber=${currentQuestionNumber}`);
            const answersJson = await answersRes.json();
            const playerAnswer = answersJson.answers?.find(a => 
              a.name === currentPlayerName && a.questionNumber === currentQuestionNumber
            );
            
            if (playerAnswer) {
              setHasAnswered(true);
              console.log(`✅ PLAYER: Already answered this question`);
            } else {
              setHasAnswered(false);
              // Always reset trivia selection for new questions
              setSelectedTriviaAnswer(null);
              console.log(`📝 PLAYER: Ready to answer new question - reset trivia selection`);
            }
          } else {
            console.log(`🔄 PLAYER: Same question (${currentQuestionNumber}) - preserving answer state`);
          }
          
          // Reset voting state for new question (but preserve if user is actively voting)
          const recentInteraction = Date.now() - lastVoteInteraction < 2000;
          if (!recentInteraction && !isUserVoting) {
            setVotes({ first: '', second: '', third: '' });
          }
          setHasVoted(false);
          
          setGameState('question');
        } else {
          // Fallback: question not found in state yet, might still be loading
          console.log(`⚠️ PLAYER: Question ${currentQuestionNumber} not found in game state, waiting...`);
        }
      } else if (serverGameState === 'voting') {
        // Get answers for voting
        const answersRes = await fetch(`${API_BASE}games/${currentGameId}/answers?questionNumber=${currentQuestionNumber}`);
        const answersJson = await answersRes.json();
        const gameAnswers = answersJson.answers || [];
        
        // Check if player has already voted for this specific question
        const votesRes = await fetch(`${API_BASE}games/${currentGameId}/votes?questionNumber=${currentQuestionNumber}`);
        const votesJson = await votesRes.json();
        const playerVote = votesJson.votes?.find(v => v.voter === currentPlayerName && v.questionNumber === currentQuestionNumber);
        
        if (playerVote) {
          setHasVoted(true);
          console.log('✅ PLAYER: Already voted for this question');
        } else {
          setHasVoted(false);
          
          // Check for partial votes on server if we don't have local votes
          const hasActiveVotes = Object.values(votes).some(v => v !== '');
          const recentInteraction = Date.now() - lastVoteInteraction < 5000;
          
          if (!hasActiveVotes && !recentInteraction && !isUserVoting) {
            // Try to restore partial vote from server
            restorePartialVote(currentPlayerName, currentQuestionNumber).then((restored) => {
              if (!restored) {
                // No partial vote found, start fresh
                setVotes({ first: '', second: '', third: '' });
                console.log('🗑️ PLAYER: No partial vote - starting fresh');
              }
            });
          }
        }
        
        setAnswers(gameAnswers);
        setGameState('voting');
      } else if (serverGameState === 'results') {
        setGameState('results');
        // Fetch player ranking and scores for results display
        fetchPlayerRanking(currentGameId, currentPlayerName);
      } else {
        // Waiting state
        if (gameState !== 'waiting') {
          setGameState('waiting');
          setHasAnswered(false);
          setCurrentQuestion(null);
          setAnswers([]);
          
          // Only reset votes if user isn't actively voting
          const recentInteraction = Date.now() - lastVoteInteraction < 2000;
          if (!recentInteraction && !isUserVoting) {
            setVotes({ first: '', second: '', third: '' });
          }
          setHasVoted(false);
        }
      }
    } catch (e) {
      console.error('checkGameState error', e);
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
        body: JSON.stringify({ name: nameInput.trim() }),
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
          alert(errorData.error || 'Failed to join game. Please check the game ID and try again.');
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
      
      // Check if this was a rejoin
      if (successData.rejoined) {
        setRejoinedPlayer(true);
        console.log(`🔄 PLAYER: Rejoined successfully with previous score: ${successData.previousScore}`);
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

  const handleSubmitAnswer = async (e, triviaAnswer = null) => {
    if (e) e.preventDefault();
    
    console.log(`🎯 PLAYER: handleSubmitAnswer called - gameType: ${gameType}, triviaAnswer: ${triviaAnswer}, hasAnswered: ${hasAnswered}`);
    
    // For trivia, use the provided answer; for call-and-answer, use the text input
    const answer = gameType === 'trivia' ? triviaAnswer : answerInput.trim();
    
    if (!answer || !currentQuestion) {
      console.log(`❌ PLAYER: Submit blocked - answer: ${answer}, currentQuestion: ${!!currentQuestion}`);
      return;
    }
    
    if (hasAnswered) {
      console.log(`❌ PLAYER: Submit blocked - already answered`);
      return;
    }

    try {
      await fetch(`${API_BASE}games/${gameId}/answers`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: playerName,
          questionNumber: currentQuestion.id,
          answer: answer,
        }),
      });
      
      setHasAnswered(true);
      setAnswerInput('');
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
      setTimeout(() => savePartialVote(playerName, currentQuestion.id, newVotes), 100);
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

    try {
      await fetch(`${API_BASE}games/${gameId}/votes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: playerName,
          questionNumber: currentQuestion?.id,
          votes: backendVotes,
        }),
      });
      
      setHasVoted(true);
    } catch (e) {
      console.error('handleSubmitVotes error', e);
      alert('Failed to submit votes. Please try again.');
    }
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
                    const emoji = position === 'first' ? '🥇' : position === 'second' ? '🥈' : '🥉';
                    
                    return (
                      <button
                        key={position}
                        className={`vote-btn-detailed ${isSelected ? 'selected' : ''}`}
                        onClick={() => handleVoteClick(idx, position)}
                      >
                        {emoji}
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
                  💡 Save this URL to easily reconnect later!
                </p>
              </div>
            )}
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
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="player-outer-container-full">
      <div className="player-info-external">
        <span className="player-name">👤 {playerName}</span>
        <span className="game-id">Game: {gameId}</span>
        {currentQuestion && <span className="lesson-number">Lesson {currentQuestion.id}</span>}
      </div>
      
      {rejoinedPlayer && (
        <div className="rejoin-notification">
          🔄 Welcome back! Your previous game state has been restored.
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
        {gameState === 'waiting' && (
          <div className="waiting-screen">
            <h2>✅ You're in!</h2>
            <p>Waiting for the game to start...</p>
            <div className="status-indicator">
              <div className="pulse"></div>
              <span>Ready to play</span>
            </div>
          </div>
        )}

        {gameState === 'question' && currentQuestion && (
          <div className="question-screen">
            <div className="question-header">
              <div className="field-badge">
                {currentQuestion.field || currentQuestion.category}
              </div>
              {currentQuestion.school && (
                <div className="school-name">{currentQuestion.school}</div>
              )}
            </div>
            <div className="lesson-title">
              {currentQuestion.title || currentQuestion.question}
            </div>
            {currentQuestion.detail && (
              <div className="lesson-detail">
                {currentQuestion.detail}
              </div>
            )}
            <div className="application-prompt">
              <strong>{gameType === 'trivia' ? 'Select the best answer:' : getPlayerInstructionText(customInstruction)}</strong>
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
              ) : (
                <>
                  {isAnswerInputFocused && !isDesktop && (
                    <div className="mobile-input-overlay" onClick={() => setIsAnswerInputFocused(false)}>
                      <div className="mobile-input-container" onClick={(e) => e.stopPropagation()}>
                        <button 
                          className="mobile-minimize-btn mobile-minimize-left"
                          onClick={() => setIsAnswerInputFocused(false)}
                          type="button"
                        >
                          ↓
                        </button>
                        <button 
                          className="mobile-submit-btn-top"
                          onClick={handleSubmitAnswer}
                          type="button"
                          disabled={!answerInput.trim()}
                        >
                          ✈️
                        </button>
                        <form onSubmit={handleSubmitAnswer} className="mobile-answer-form">
                          <textarea
                            value={answerInput}
                            onChange={(e) => setAnswerInput(e.target.value)}
                            placeholder="Describe how you would apply this lesson to your work, project, or team..."
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
                    placeholder="Describe how you would apply this lesson to your work, project, or team..."
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
                <h3>✅ {gameType === 'trivia' ? 'Answer Submitted!' : 'Application Submitted!'}</h3>
                <p>Waiting for other players...</p>
              </div>
            )}
          </div>
        )}

        {gameState === 'voting' && answers.length > 0 && (
          <div className="voting-screen">
            <h2>🗳️ Vote for the Best Applications</h2>
            <p>Which applications would be most valuable for teams to implement?</p>
            
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
                          {position === 'first' && '🥇 1st Place:'}
                          {position === 'second' && '🥈 2nd Place:'}
                          {position === 'third' && '🥉 3rd Place:'}
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
                <h3>✅ Votes Submitted!</h3>
                <p>Waiting for results...</p>
              </div>
            )}
          </div>
        )}

        {gameState === 'results' && (
          <div className="results-screen">
            <h2>📊 Round Results</h2>
            
            {gameType === 'trivia' ? (
              <div className="trivia-player-results">
                <div className="trivia-question-recap">
                  <h3>{currentQuestion?.title}</h3>
                </div>
                
                <div className="trivia-options-results">
                  {['optionA', 'optionB', 'optionC', 'optionD', 'optionE', 'optionF']
                    .filter(key => currentQuestion?.[key])
                    .map((key, index) => {
                      const optionLetter = String.fromCharCode(65 + index);
                      const isCorrect = currentQuestion?.correctAnswer === currentQuestion?.[key];
                      
                      // Find player's answer from the answers array
                      const playerAnswer = answers.find(answer => answer.name === playerName);
                      const isPlayerChoice = playerAnswer?.answer === optionLetter;
                      
                      let className = 'category-item trivia-result-option';
                      if (isCorrect) {
                        className += ' correct';
                      } else if (isPlayerChoice) {
                        className += ' player-wrong';
                      }
                      
                      return (
                        <div key={key} className={className}>
                          <span className="category-name">
                            <span className="option-letter">{optionLetter}.</span> {currentQuestion[key]}
                            {isCorrect && <span className="correct-indicator"> ✓</span>}
                            {isPlayerChoice && !isCorrect && <span className="wrong-indicator"> ✗</span>}
                            {isPlayerChoice && <span className="your-choice"> (Your Choice)</span>}
                          </span>
                        </div>
                      );
                    })}
                </div>
                
                <div className="player-results-summary">
                  <div className="player-total-score">
                    <span className="score-label">Total Score:</span>
                    <span className="score-value">{playerScore} points</span>
                  </div>
                  
                  {playerRanking && (
                    <div className="player-ranking">
                      <span className="ranking-label">Your Ranking:</span>
                      <span className="ranking-value">
                        {playerRanking.rank === 1 ? '🏆' : 
                         playerRanking.rank === 2 ? '🥈' : 
                         playerRanking.rank === 3 ? '🥉' : '📍'} 
                        {playerRanking.rank} of {playerRanking.total}
                      </span>
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div className="call-and-answer-results">
                <div className="player-results-summary">
                  <div className="player-total-score">
                    <span className="score-label">Total Score:</span>
                    <span className="score-value">{playerScore} points</span>
                  </div>
                  
                  {playerRanking && (
                    <div className="player-ranking">
                      <span className="ranking-label">Your Ranking:</span>
                      <span className="ranking-value">
                        {playerRanking.rank === 1 ? '🏆' : 
                         playerRanking.rank === 2 ? '🥈' : 
                         playerRanking.rank === 3 ? '🥉' : '📍'} 
                        {playerRanking.rank} of {playerRanking.total}
                      </span>
                    </div>
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
    </div>
  );
}

export default PlayerPage;