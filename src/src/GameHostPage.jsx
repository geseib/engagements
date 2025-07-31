import React, { useState, useEffect } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import html2pdf from 'html2pdf.js';
import webSocketClient from './WebSocketClient';
import MarkdownRenderer from './components/MarkdownRenderer';
import IssueFab from './components/IssueFab';
import QuickstartMenu from './components/QuickstartMenu';

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

function GameHostPage() {
  // 🎯 GAME ID MANAGEMENT: Use URL as single source of truth
  const [gameId, setGameId] = useState('');
  
  // Helper function to check if game is in waiting state
  const isWaitingState = (state) => {
    if (!state) {
      console.log('🚨 DEBUG: isWaitingState - no state provided, returning true');
      return true; // Default to waiting state if no state
    }
    const isWaiting = state === 'CREATED' || state === 'STARTED' || 
           (!state.startsWith('ASK#') && !state.startsWith('VOTE#') && !state.startsWith('RESULTS#'));
    console.log(`🚨 DEBUG: isWaitingState - state: ${state}, isWaiting: ${isWaiting}`);
    return isWaiting;
  };
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
  const [playersWhoAnswered, setPlayersWhoAnswered] = useState([]);
  const [votes, setVotes] = useState([]);
  const [playersWhoVoted, setPlayersWhoVoted] = useState([]);
  const [currentQuestionVotes, setCurrentQuestionVotes] = useState([]);
  const [currentAnswerIndex, setCurrentAnswerIndex] = useState(0);
  const [manualStateChange, setManualStateChange] = useState(false);
  const [lessonExpanded, setLessonExpanded] = useState(false);
  const [qrSidebarVisible, setQrSidebarVisible] = useState(true);
  const [instructionsVisible, setInstructionsVisible] = useState(false);
  const [showExpandedQR, setShowExpandedQR] = useState(false);
  const [questionSetTabVisible, setQuestionSetTabVisible] = useState(false);
  const [showReport, setShowReport] = useState(false);
  const [reportData, setReportData] = useState(null);
  const [lessonNumber, setLessonNumber] = useState(0);
  
  // Reports List Modal
  const [showReportsModal, setShowReportsModal] = useState(false);
  const [gamesList, setGamesList] = useState([]);
  const [reportsModalMode, setReportsModalMode] = useState('reports'); // 'reports' or 'select'
  
  // WebSocket state
  const [wsConnected, setWsConnected] = useState(false);
  const [useWebSocket, setUseWebSocket] = useState(true); // Always use WebSocket

  // Flag to prevent auto-selection during game state restoration
  const [isRestoringState, setIsRestoringState] = useState(false);

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
  
  // Question Set Management
  const [questionSets, setQuestionSets] = useState([]);
  const [selectedSetId, setSelectedSetId] = useState('');
  const [categories, setCategories] = useState([]);
  const [activeCategoryIds, setActiveCategoryIds] = useState(new Set());


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
  
  // Big screen mode for conference room displays (always defaults to false on page load)
  const [bigScreenMode, setBigScreenMode] = useState(false);
  
  // Ensure big screen mode is always false on page load/refresh
  useEffect(() => {
    setBigScreenMode(false);
    console.log('🖥️ Big screen mode reset to false on component mount');
  }, []);

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
            if (typeof nextQuestion === 'function') {
              nextQuestion();
            }
            break;
          case 'START_VOTING':
            if (typeof startVoting === 'function') {
              startVoting();
            }
            break;
          case 'SHOW_RESULTS':
            if (typeof showResults === 'function') {
              showResults();
            }
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
  
  // Flash alerts for when all players have answered/voted
  const [showAllAnsweredAlert, setShowAllAnsweredAlert] = useState(false);
  const [showAllVotedAlert, setShowAllVotedAlert] = useState(false);
  
  // Invite creation state
  const [showInviteCreated, setShowInviteCreated] = useState(false);
  const [inviteCopied, setInviteCopied] = useState(false);
  
  // Loading overlay state
  const [isLoadingData, setIsLoadingData] = useState(false);
  const [loadingMessage, setLoadingMessage] = useState('Loading...');
  
  // Note: Save Report Modal state moved to GameReport component
  
  // Get instruction text based on question set
  const getInstructionText = () => {
    // Try to get setId from current question first, then fall back to selectedSetId
    const setId = questions[0]?.setId || selectedSetId;
    
    if (!setId) return 'How could you adapt this lesson to your work, project, or team?';
    
    // Get current question set info
    const currentSet = questionSets.find(set => set.id === setId);
    if (currentSet && currentSet.customInstruction) {
      return currentSet.customInstruction;
    }
    
    // Default fallback for different sets
    const setInstructions = {
      'AmazonBP': 'How could you adapt this Amazon leadership principle to your work, project, or team?',
      'amazonleadershipprinciples': 'How could you adapt this Amazon leadership principle to your work, project, or team?',
      'greatest-hits': 'How could you adapt this lesson to your work, project, or team?',
      'default': 'How could you adapt this lesson to your work, project, or team?'
    };
    
    return setInstructions[setId] || setInstructions['default'];
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

  // Regenerate AI Summary with new generation
  const handleRegenerateAISummary = async () => {
    const currentQuestionNum = gameState.match(/#(\d+)/)?.[1];
    if (!currentQuestionNum) {
      console.log('⚠️ No current question number found for regeneration');
      return;
    }

    console.log('🔄 Regenerating AI Summary for question:', currentQuestionNum);
    setCurrentAIInsights(null); // Clear current insights to show loading
    setLoadingAIInsights(true);
    
    try {
      const debugParam = gameDebugMode ? '&debug=true' : '';
      const response = await fetch(`${API_BASE}games/${gameId}/ai-summary?questionId=${currentQuestionNum}&generateNew=true${debugParam}`);
      
      if (response.ok) {
        const newSummary = await response.json();
        setCurrentAIInsights({
          summary: newSummary.summary,
          summaryText: newSummary.summaryText,
          discussionTopics: newSummary.discussionQuestions || [],
          nextSteps: newSummary.nextSteps || [],
          markdownResponse: newSummary.markdownResponse,
          prompt: gameDebugMode ? newSummary.debugPrompt : undefined,
          debugPrompt: gameDebugMode ? newSummary.debugPrompt : undefined,
          debugProvenance: gameDebugMode ? newSummary.debugProvenance : undefined
        });
        // Also update the cached summaries
        setAiSummaries(prev => ({
          ...prev,
          [currentQuestionNum]: newSummary
        }));
        console.log('✅ AI Summary regenerated successfully');
      } else {
        console.error('❌ Failed to regenerate AI Summary. Status:', response.status);
      }
    } catch (error) {
      console.error('❌ Error regenerating AI Summary:', error);
    } finally {
      setLoadingAIInsights(false);
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

  // Load AI insights when in results state and we have answers
  useEffect(() => {
    if (gameState.startsWith('RESULTS#') && currentQuestionIndex >= 0 && answers.length > 0) {
      const questionId = String(currentQuestionIndex + 1).padStart(3, '0');
      console.log(`🤖 Starting AI insights load for question ${questionId} with ${answers.length} answers`);
      setLoadingAIInsights(true);
      setCurrentAIInsights(null);
      
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
              debugPrompt: gameDebugMode ? existingSummary.debugPrompt : undefined,
              debugProvenance: gameDebugMode ? existingSummary.debugProvenance : undefined
            });
            setLoadingAIInsights(false);
          } else {
            // Trigger AI generation - WebSocket will notify us when done
            console.log('🤖 Triggering AI generation, will wait for WebSocket notification...');
            fetch(`${API_BASE}games/${gameId}/ai-summary?questionId=${questionId}&generateNew=true`, {
              method: 'GET',
              headers: { 'Content-Type': 'application/json' }
            }).catch(error => {
              console.error('❌ Failed to trigger AI generation:', error);
              setLoadingAIInsights(false);
            });
          }
        });
        return;
      }
      
      // REMOVED: AI insights polling - WebSocket handles notifications
    }
  }, [gameState, currentQuestionIndex, answers.length, gameId, gameDebugMode, useWebSocket]);

  // Check if all players have answered and trigger flash alert
  useEffect(() => {
    if (gameState.startsWith('ASK#') && players.length > 0 && playersWhoAnswered.length === players.length && playersWhoAnswered.length > 0) {
      console.log('🎉 All players have answered! Triggering flash alert.');
      setShowAllAnsweredAlert(true);
      
      // Auto-close lesson expansion if open
      if (lessonExpanded) {
        setLessonExpanded(false);
        console.log('📚 Auto-closing lesson expansion since all players answered');
      }
      
      // Hide alert after 3 seconds
      setTimeout(() => {
        setShowAllAnsweredAlert(false);
      }, 3000);
    }
  }, [gameState, players.length, playersWhoAnswered.length, lessonExpanded]);

  // Check if all players have voted and trigger flash alert (only for call-and-answer)
  useEffect(() => {
    if (gameState.startsWith('VOTE#') && currentGameType !== 'trivia' && players.length > 0 && playersWhoVoted.length === players.length && playersWhoVoted.length > 0) {
      console.log('🗳️ All players have voted! Triggering flash alert.');
      setShowAllVotedAlert(true);
      
      // Hide alert after 3 seconds
      setTimeout(() => {
        setShowAllVotedAlert(false);
      }, 3000);
    }
  }, [gameState, currentGameType, players.length, playersWhoVoted.length]);

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
      // Update the playersWhoAnswered list directly
      if (data.playerName) {
        setPlayersWhoAnswered(prev => {
          if (!prev.includes(data.playerName)) {
            console.log(`✅ Marking ${data.playerName} as answered`);
            return [...prev, data.playerName];
          }
          return prev;
        });
        
        // Refresh answers array to enable vote button
        if (data.questionNumber) {
          console.log(`🔄 Refreshing answers for question ${data.questionNumber} to enable vote button`);
          fetchAnswersForQuestion(data.questionNumber);
        }
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
      // Update game state to voting without full restoration
      if (data.newState) {
        setGameState(data.newState);
        console.log(`🔌 Updated game state to: ${data.newState}`);
      }
    });

    webSocketClient.onMessage('aiSummaryReady', (data) => {
      console.log('🔌 AI Summary ready notification:', data);
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
              debugPrompt: gameDebugMode ? summary.debugPrompt : undefined,
              debugProvenance: gameDebugMode ? summary.debugProvenance : undefined
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

    // Connect as host - WebSocket is required
    console.log('🔌 HOST: Connecting WebSocket for real-time updates');
    webSocketClient.connect(gameId, null, true);

    return () => {
      console.log(`🔌 HOST: Disconnecting WebSocket for game ${gameId}`);
      webSocketClient.disconnect();
      webSocketClient.onConnectionStatusChange(null);
      webSocketClient.offMessage('initialStateSync');
      webSocketClient.offMessage('playerJoined');
      webSocketClient.offMessage('playerLeft');
      webSocketClient.offMessage('gameStateChanged');
      webSocketClient.offMessage('questionStarted');
      webSocketClient.offMessage('playerAnswered');
      webSocketClient.offMessage('playerVoted');
      webSocketClient.offMessage('votingStarted');
      webSocketClient.offMessage('aiSummaryReady');
    };
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
      if (stateRes.ok) {
        const gameStateData = await stateRes.json();
        console.log(`📊 HOST: Found existing game state:`, gameStateData);
        
        // First, load question sets for the restored game
        console.log(`🔍 HOST: Loading question sets for restored game...`);
        await fetchQuestionSets(true); // true = during restoration, no auto-selection
        
        // Restore basic game metadata
        if (gameStateData.gameMetadata) {
          setEventTitle(gameStateData.gameMetadata.title || '');
          setCurrentGameType(gameStateData.gameMetadata.gameType || 'call-and-answer');
          const restoredSetId = gameStateData.gameMetadata.questionSetId || '';
          setSelectedSetId(restoredSetId);
          console.log(`🎮 HOST: Restored game metadata`);
          
          // Restore categories from bitmask if we have a question set
          if (restoredSetId) {
            await fetchCategories(restoredSetId, true); // true = restore from game bitmask
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
        console.log(`🔍 HOST: Questions array length: ${questions.length}`);
        
        // If we have a current question, set it up
        if (questionNumber > 0) {
          setCurrentQuestionIndex(questionNumber - 1); // Convert to 0-based index
          setLessonNumber(questionNumber);
          
          // Get the current question data using new API (only if we have currentQuestionData)
          if (gameStateData.currentQuestionData) {
            // Use the question data from game state
            setQuestions([gameStateData.currentQuestionData]);
            console.log(`📝 HOST: Loaded question ${questionNumber} from game state:`, gameStateData.currentQuestionData.title);
          } else {
            // Try to fetch question data with question number
            try {
              const paddedQuestionNumber = String(questionNumber).padStart(3, '0');
              const questionRes = await fetch(`${API_BASE}games/${gameId}/question?role=host`);
              
              if (questionRes.ok) {
                const questionData = await questionRes.json();
                setQuestions([questionData]);
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
            // Get results data
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
        }
        
        // Fetch current players with scores
        await fetchPlayers('state-restore');
        
        setIsRestoringState(false); // End restoration
        return true; // Successfully restored existing game
        
      } else {
        console.log(`ℹ️ HOST: No existing game state found - starting fresh`);
        setIsRestoringState(false); // End restoration
        return false; // No existing game found
      }
    } catch (e) {
      console.error('Error restoring game state:', e);
      setIsRestoringState(false); // End restoration
      return false; // Restoration failed
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
      
      const playerNames = questionAnswers.map(a => a.playerName);
      setPlayersWhoAnswered(playerNames);
      console.log(`✅ HOST: Set playersWhoAnswered to:`, playerNames);
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
        shouldAutoSelect: activeSets.length > 0 && !selectedSetId && isWaitingState(gameState) && !duringRestoration
      });
      
      // Auto-select first set if none selected and no game is running
      // CRITICAL: Don't auto-select during state restoration to prevent override of restored questionSetId
      if (activeSets.length > 0 && !selectedSetId && isWaitingState(gameState) && !isRestoringState && !duringRestoration) {
        const firstSetId = activeSets[0].id;
        setSelectedSetId(firstSetId);
        fetchCategories(firstSetId);
        console.log(`🎯 HOST: Auto-selected first question set: ${firstSetId}`);
      } else if (selectedSetId) {
        console.log(`⏳ HOST: Question set already selected: ${selectedSetId}`);
      } else if (!isWaitingState(gameState)) {
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
      setCurrentAnswerIndex(0);
      setLessonNumber(lessonNumber);
      setCurrentQuestionId(questionId);
      
      // Set the questions array
      setQuestions([questionData]);
      
      // WebSocket notification is handled automatically by the backend
      console.log(`✅ HOST: Question ${lessonNumber} started successfully`);
      
      // Refresh players to show any updated status
      await fetchPlayers('after-next-question');
      
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
    // For trivia, go straight to results using the same unified mechanism as call-and-answer
    if (currentGameType === 'trivia') {
      // Warn if not all players have answered
      if (playersWhoAnswered.length < players.length) {
        const proceed = await showConfirmation(
          'Show Results?',
          `Only ${playersWhoAnswered.length} of ${players.length} players have answered. Do you want to show results anyway?`,
          'Show Results'
        );
        if (!proceed) return;
      }
      
      // Skip calculateTriviaScores - the get-results API already handles all scoring
      console.log(`🧠 TRIVIA: Using unified handleShowResults() mechanism (scoring handled by backend)`);
      await handleShowResults();
      return;
    }
    
    // Call and Answer flow - proceed to voting
    // Warn if not all players have answered
    if (playersWhoAnswered.length < players.length) {
      const proceed = await showConfirmation(
        'Proceed to Voting?',
        `Only ${playersWhoAnswered.length} of ${players.length} players have answered. Do you want to proceed to voting anyway?`,
        'Proceed to Voting'
      );
      if (!proceed) return;
    }

    setManualStateChange(true);
    setGameState('voting');
    setCurrentAnswerIndex(0); // Reset to first answer for navigation

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
    // For trivia games, no voting phase - skip vote check
    // For call-and-answer games, warn if not all players have voted
    if (currentGameType !== 'trivia' && playersWhoVoted.length < players.length) {
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
      
      // Use new getResults API to calculate scores and get formatted results
      const resultsRes = await fetch(`${API_BASE}games/get-results`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          gameId: gameId,
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
        
      } else {
        // Call-and-answer results format: { voteTallies: {...} }
        console.log(`💬 HOST: Processing call-and-answer results with voteTallies`);
        
        formattedAnswers = resultsData.voteTallies && Object.keys(resultsData.voteTallies).length > 0
          ? Object.values(resultsData.voteTallies).map(tally => ({
              player: tally.playerName,
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
      
      
      // Make sure currentQuestionId is set to the question number
      setCurrentQuestionId(questionNumber);
      
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

  const handleNewGame = async () => {
    // Ensure question sets are loaded
    if (questionSets.length === 0) {
      await fetchQuestionSets();
    }
    // Show the new game dialog
    setNewGameSetId(selectedSetId); // Pre-select current set
    setEventTitle(''); // Clear event title
    setShowNewGameDialog(true);
  };

  const handleSwitchGame = () => {
    // Show the welcome screen (Get Started dialog)
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
    
    // Generate new game ID and update URL
    setGameId(gameIdToUse);
    setShowWelcomeScreen(false);
    
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
    setGameId(selectedGameId);
    setEventTitle(selectedEventTitle);
    setShowWelcomeScreen(false);
    
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
      setGameId(selectedGameId);
      setEventTitle(selectedEventTitle || 'Engagement Session');
      setShowWelcomeScreen(false);
      
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
    const inviteText = `🎮 Join the engagement!\n\nGame ID: ${game.gameId}\nURL: ${window.location.origin}/player?gameId=${game.gameId}\n\nTitle: ${game.eventTitle || 'Engagement Session'}`;
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
      const clearResponse = await fetch(`${API_BASE}admin/clear-game/${gameId || 'empty'}`, {
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
      console.error('handleNewGame clear error', e);
      // Don't fail the new game creation if clear fails
      console.log(`⚠️ HOST: Clear failed, but continuing with new game creation`);
    }
    
    // Create the game first - let backend generate the gameId
    console.log(`🆕 HOST: Creating new game with backend-generated ID`);
    
    // Update question set selection
    setSelectedSetId(newGameSetId);
    
    // Reset all state
    setCurrentQuestionIndex(-1);
    setGameState('CREATED');
    setCurrentGameType(engagementType); // Set the game type
    setAnswers([]);
    setPlayersWhoAnswered([]);
    setVotes([]);
    setPlayersWhoVoted([]);
    setCurrentQuestionVotes([]);
    setCurrentAnswerIndex(0);
    setPlayers([]);
    setShowReport(false);
    setReportData(null);
    setLessonNumber(0);
    
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
          hostName: 'Host'
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
    
    // Reset AI context for next game
    setGameAiContext('');
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
                'Wavelength (Spectrum-based Guessing)'}
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
      setInviteCopied(true);
      setShowInviteCreated(true);
      
      // Hide success feedback after 4 seconds
      setTimeout(() => {
        setInviteCopied(false);
        setShowInviteCreated(false);
      }, 4000);
      
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
        players: report.playerPerformance || [],
        questions: report.detailedQuestions || [],
        allAnswers: [],
        allVotes: [],
        aiSummaries: {}
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
          
          // Add AI summary if available
          if (question.aiSummary) {
            gameData.aiSummaries[question.questionNumber] = {
              summary: question.aiSummary.summaryText,
              discussionQuestions: question.aiSummary.discussionQuestions || [],
              nextSteps: question.aiSummary.nextSteps || [],
              markdownResponse: question.aiSummary.markdownResponse || null
            };
          }
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
          // Extract the gameId and eventTitle from the gameData object
          setGameId(gameData.gameId);
          setEventTitle(gameData.eventTitle);
          setShowWelcomeScreen(false);
          // The useEffect hook will automatically initialize the game when gameId is set
        }}
        onClose={() => setShowQuickstartMenu(false)}
      />
    );
  }

  // Render the welcome screen if no game is selected
  if (showWelcomeScreen) {
    return (
      <div className="welcome-screen">
        <div className="parallax">
          <section className="parallax__header">
            <div className="parallax__visuals">
              <div className="parallax__black-line-overflow"></div>
              <div data-parallax-layers className="parallax__layers">
                <img src="https://cdn.prod.website-files.com/671752cd4027f01b1b8f1c7f/6717795be09b462b2e8ebf71_osmo-parallax-layer-3.webp" loading="eager" width="800" data-parallax-layer="1" alt="" className="parallax__layer-img" />
                <img src="https://cdn.prod.website-files.com/671752cd4027f01b1b8f1c7f/6717795b4d5ac529e7d3a562_osmo-parallax-layer-2.webp" loading="eager" width="800" data-parallax-layer="2" alt="" className="parallax__layer-img" />
                <div data-parallax-layer="3" className="parallax__layer-title">
                  <h2 className="parallax__title">{currentGameType === 'trivia' ? 'Trivia' : 'Engagements'}</h2>
                </div>
                <img src="https://cdn.prod.website-files.com/671752cd4027f01b1b8f1c7f/6717795bb5aceca85011ad83_osmo-parallax-layer-1.webp" loading="eager" width="800" data-parallax-layer="4" alt="" className="parallax__layer-img" />
              </div>
              <div className="parallax__fade"></div>
            </div>
          </section>
        </div>

        <div className="welcome-content">
          <div className="welcome-card">
            <h3>Get Started</h3>
            <p>Choose how you'd like to begin your collaborative learning session:</p>
            
            <div className="welcome-options">
              <button className="btn-secondary btn-large welcome-btn" onClick={() => setShowQuickstartMenu(true)}>
                ⚡ Quick Start
              </button>
              
              <button className="btn-primary btn-large welcome-btn" onClick={handleWelcomeNewGame}>
                🎯 Create Engagement
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
                📋 View Game History
              </button>
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
            <h2 className="modal-title">{reportsModalMode === 'select' ? '🎮 Game History' : '📊 Game Reports'}</h2>
            <div className="modal-subtitle">
              {reportsModalMode === 'select' ? 'Select a game to start or continue' : 'View past game reports'}
            </div>
          </div>
          
          <div className="dialog-content">
            <div className="games-list">
              {gamesList.length === 0 ? (
                <div className="empty-state">
                  <div className="empty-icon">🎯</div>
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
                            {isRecent && <span className="new-badge">✨ Latest</span>}
                            {isCurrent && <span className="current-badge">📍 Current</span>}
                          </h3>
                          <div className="game-id">#{game.gameId}</div>
                        </div>
                        <div className="game-status-badges">
                          {game.started ? (
                            <span className="status-badge started">▶️ Started</span>
                          ) : (
                            <span className="status-badge pending">⏸️ Ready to Start</span>
                          )}
                        </div>
                      </div>
                      
                      <div className="game-details">
                        <div className="game-info-grid">
                          <div className="info-item">
                            <span className="info-label">Type:</span>
                            <span className="info-value">
                              {game.gameType === 'call-and-answer' ? '💬 Call & Answer' : '🧠 Trivia'}
                            </span>
                          </div>
                          <div className="info-item">
                            <span className="info-label">Question Set:</span>
                            <span className="info-value">{game.questionSetId || 'Unknown'}</span>
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
                          🔗 Player URL
                        </button>
                        <button 
                          className="game-action-btn category-style-btn"
                          onClick={(e) => {
                            e.stopPropagation();
                            copyInviteInfo(game);
                          }}
                          title="Copy invite info"
                        >
                          📋 Invite
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
                            📊 Report
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
                          {game.started ? '▶️ Continue' : '🚀 Start Game'}
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
                if (reportsModalMode === 'select' && isWaitingState(gameState) && lessonNumber === 0) {
                  setShowWelcomeScreen(true);
                }
              }}
            >
              {reportsModalMode === 'select' ? '❌ Cancel' : '✖️ Close'}
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
          <h2>{isWaitingState(gameState) && lessonNumber === 0 ? 'Create Engagement' : 'Start New Game'}</h2>
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
                  }
                }}
                className="dialog-select"
              >
                <option value="">Select a question set...</option>
                {questionSets
                  .filter(set => set.engagementType === engagementType)
                  .map(set => (
                    <option key={set.id} value={set.id}>
                      {set.name} ({set.totalQuestions} questions)
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
          </div>
          
          <div className="dialog-actions">
            <button 
              className="btn-secondary" 
              onClick={() => {
                setShowNewGameDialog(false);
                if (isWaitingState(gameState) && lessonNumber === 0) {
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

  return (
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
          
        </div>
      </div>
      <div className="instructions-tab" onClick={() => setInstructionsVisible(!instructionsVisible)}>
        <span>{instructionsVisible ? '◀ Close' : '▶ How to Play'}</span>
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
                    ✓ Link copied!
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
                    🔌 WebSocket {wsConnected ? 'Connected' : 'Connecting...'}
                  </span>
                ) : (
                  <span className="status-indicator polling">
                    🔄 HTTP Polling Mode
                  </span>
                )}
              </div>
              <div className="qr-section">
                <div className="qr-code-clickable" onClick={() => setShowExpandedQR(true)}>
                  <QRCodeSVG value={playUrl} size={180} />
                  <p>Scan to join!</p>
                </div>
              </div>
            </div>
            <div className="qr-controls">
              <button 
                className={`btn-${inviteCopied ? 'success' : 'primary'}`}
                onClick={createInvite}
                title="Copy meeting invitation to clipboard"
              >
                📋 {inviteCopied ? 'Copied!' : 'Copy Invite'}
              </button>
              <button 
                className={`btn-${gameDebugMode ? 'primary' : 'secondary'}`} 
                onClick={handleToggleGameDebugMode}
                title="Toggle debug mode to show AI prompts in results"
              >
                🐛 Debug {gameDebugMode ? 'ON' : 'OFF'}
              </button>
              <button 
                className={`btn-${bigScreenMode ? 'primary' : 'secondary'}`} 
                onClick={() => {
                  const newMode = !bigScreenMode;
                  console.log(`🖥️ Toggling big screen mode: ${bigScreenMode} → ${newMode}`);
                  setBigScreenMode(newMode);
                }}
                title="Toggle big screen mode for conference room displays"
              >
                📺 Big Screen {bigScreenMode ? 'ON' : 'OFF'}
              </button>
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
            </div>
          </div>

          {/* Right Column - Question Set Info */}
          {selectedSetId && (
            <div className="qr-column-right">
              <div className="question-set-panel">
                <div className="question-set-header">
                  <h3>📚 {questionSets.find(set => set.id === selectedSetId)?.name || 'Unknown Set'}</h3>
                  <div className="set-details">
                    {questionSets.find(set => set.id === selectedSetId)?.totalQuestions || 0} questions
                  </div>
                </div>
                
                {categories.length > 0 && (
                  <div className="categories-section">
                    <h4>Categories</h4>
                    <div className="categories-list">
                      {categories.map(category => (
                        <div 
                          key={category.name} 
                          className={`category-item ${activeCategoryIds.has(category.name) ? 'active' : 'inactive'}`}
                          onClick={() => toggleCategoryActive(category.name)}
                          title={`Click to ${activeCategoryIds.has(category.name) ? 'disable' : 'enable'} ${category.name} questions`}
                        >
                          <span className="category-name">{category.name}</span>
                          <span className="category-count">{category.questionCount}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
      <div className="qr-tab" onClick={() => setQrSidebarVisible(!qrSidebarVisible)}>
        <span>{qrSidebarVisible ? 'Hide ▶' : '◀ Game Info'}</span>
      </div>
      
      <div className={`outer-container ${!qrSidebarVisible ? 'qr-hidden' : ''} ${instructionsVisible ? 'instructions-open' : ''} ${bigScreenMode ? 'big-screen-mode' : ''}`}>
      
      <div className="game-host-container">
        <div className="parallax">
          <section className="parallax__header">
            <div className="parallax__visuals">
              <div className="parallax__black-line-overflow"></div>
              <div data-parallax-layers className="parallax__layers">
                <img src="https://cdn.prod.website-files.com/671752cd4027f01b1b8f1c7f/6717795be09b462b2e8ebf71_osmo-parallax-layer-3.webp" loading="eager" width="800" data-parallax-layer="1" alt="" className="parallax__layer-img" />
                <img src="https://cdn.prod.website-files.com/671752cd4027f01b1b8f1c7f/6717795b4d5ac529e7d3a562_osmo-parallax-layer-2.webp" loading="eager" width="800" data-parallax-layer="2" alt="" className="parallax__layer-img" />
                <div data-parallax-layer="3" className="parallax__layer-title">
                  <h2 className="parallax__title">{currentGameType === 'trivia' ? 'Trivia' : 'Engagements'}</h2>
                </div>
                <img src="https://cdn.prod.website-files.com/671752cd4027f01b1b8f1c7f/6717795bb5aceca85011ad83_osmo-parallax-layer-1.webp" loading="eager" width="800" data-parallax-layer="4" alt="" className="parallax__layer-img" />
              </div>
              <div className="parallax__fade"></div>
            </div>
          </section>
        </div>

      <div className="players-section">
        {bigScreenMode && gameId && (
          <div className="big-screen-players-qr">
            <QRCodeSVG 
              value={`${window.location.origin}/play?gameId=${gameId}`}
              size={120}
              level="M"
              includeMargin={true}
              className="players-qr-code"
            />
            <p className="players-qr-text">Scan to Join</p>
          </div>
        )}
        {eventTitle && (
          <div className="game-title-header">
            <h1 className="game-title-main">{eventTitle}</h1>
            <div className="game-meta-info">
              <span className="question-set-name">{questionSets.find(set => set.id === selectedSetId)?.name || 'Unknown Set'}</span>
              <span className="player-count-info">({players.length} Player{players.length !== 1 ? 's' : ''})</span>
            </div>
          </div>
        )}
        {!eventTitle && (
          <div className="players-header-simple">
            <h2>{players.length} Player{players.length !== 1 ? 's' : ''}</h2>
          </div>
        )}
        <div className="players-grid">
          {calculatePlayerRankings(players).map((player) => {
            const score = player.score || 0;
            const hasPoints = score > 0;
            
            // Only show trophies if player has 1+ points
            let rankEmoji = '👤'; // Default person icon
            if (hasPoints) {
              if (player.rank === 1) rankEmoji = '🏆';
              else if (player.rank === 2) rankEmoji = '🥈';
              else if (player.rank === 3) rankEmoji = '🥉';
              else rankEmoji = '📍';
            }
            
            return (
              <div key={player.name || `player-${Math.random()}`} className="player-card">
                <div className="player-name">
                  {rankEmoji} {player.name || player.playerName || 'Unknown Player'}
                </div>
                <div className="player-score">{score} pts</div>
                {gameState.startsWith('ASK#') && (
                  <div className={`answer-status ${playersWhoAnswered.includes(player.name) ? 'answered' : 'waiting'}`}>
                    {playersWhoAnswered.includes(player.name) ? '✓' : '⏱️'}
                  </div>
                )}
                {gameState.startsWith('VOTE#') && (
                  <div className={`answer-status ${playersWhoVoted.includes(player.name) ? 'answered' : 'waiting'}`}>
                    {playersWhoVoted.includes(player.name) ? '✓' : '⏱️'}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <div className={`game-content ${bigScreenMode ? 'big-screen-mode' : ''}`}>
        {isWaitingState(gameState) && (
          <div className={`waiting-state ${bigScreenMode ? 'big-screen-mode' : ''}`}>
            {bigScreenMode && gameId && (
              <div className="big-screen-join-qr">
                <QRCodeSVG 
                  value={`${window.location.origin}/play?gameId=${gameId}`}
                  size={bigScreenMode ? 300 : 200}
                  level="M"
                  includeMargin={true}
                  className="join-qr-code"
                />
                <div className="join-instructions">
                  <p className="join-url-text">Scan to join the game</p>
                  <p className="game-id-display">Game ID: <strong>{gameId}</strong></p>
                </div>
              </div>
            )}
            <h2>Waiting for players to join...</h2>
            <div className="waiting-controls">
              {selectedSetId && (
                <button 
                  className="btn-primary btn-large" 
                  onClick={() => { closeAllSidePanels(); handleNextQuestion(false); }}
                  disabled={players.length === 0}
                >
                  Start First Question
                </button>
              )}
              {!selectedSetId && (
                <p>Please select a question set in the sidebar to begin.</p>
              )}
            </div>
          </div>
        )}

        {gameState.startsWith('ASK#') && questions.length > 0 && (
          <div className={`question-state ${bigScreenMode ? 'big-screen-mode' : ''}`}>
            <div className="question-header">
              <h2>{currentGameType === 'trivia' ? `Question ${lessonNumber}` : `Lesson ${lessonNumber}`}</h2>
              <div className="field-badge">
                {questions[0].field || questions[0].category}
              </div>
              {questions[0].school && currentGameType === 'call-and-answer' && (
                <div className="school-name">{questions[0].school}</div>
              )}
            </div>
            <div 
              className="lesson-title clickable-lesson"
              onClick={() => setLessonExpanded(true)}
              title="Click to expand"
            >
              {currentGameType === 'trivia' ? 
                (questions[0].title || questions[0].question) :
                (questions[0].title || questions[0].question)
              }
            </div>
            {!lessonExpanded && currentGameType === 'trivia' && questions[0].questionDetail && (
              <div 
                className="lesson-detail clickable-lesson" 
                onClick={() => setLessonExpanded(true)}
                title="Click to expand"
              >
                {questions[0].questionDetail}
              </div>
            )}
            {!lessonExpanded && questions[0].detail && currentGameType === 'call-and-answer' && (
              <div 
                className="lesson-detail clickable-lesson" 
                onClick={() => setLessonExpanded(true)}
                title="Click to expand"
              >
                {questions[0].detail}
              </div>
            )}
            {!lessonExpanded && currentGameType === 'wavelength' && questions[0].topic && (
              <div className="wavelength-topic-display lesson-detail">
                <strong>Topic:</strong> {questions[0].topic}
              </div>
            )}
            
            {currentGameType === 'trivia' && questions[0] && (
              <div className="trivia-options">
                {['optionA', 'optionB', 'optionC', 'optionD', 'optionE', 'optionF']
                  .filter(key => questions[0][key])
                  .map((key, index) => (
                    <div key={key} className="category-item trivia-option">
                      <span className="category-name">
                        <span className="option-letter">{String.fromCharCode(65 + index)}.</span> {questions[0][key]}
                      </span>
                    </div>
                  ))}
              </div>
            )}
            
            <div className="application-prompt">
              <strong>{currentGameType === 'trivia' ? 'Select the best answer:' : getInstructionText()}</strong>
            </div>
            <div className="answer-progress">
              {playersWhoAnswered.length} of {players.length} players answered
            </div>
            <div className="question-controls">
              <button 
                className="btn-primary" 
                onClick={() => { closeAllSidePanels(); handleFinishQuestion(); }}
                disabled={answers.length === 0}
              >
                {currentGameType === 'trivia' ? 'Show Results' : 'Vote'}
              </button>
              <button 
                className="btn-secondary" 
                onClick={() => { closeAllSidePanels(); handleNextQuestion(true); }}
              >
                Skip to Next Question
              </button>
            </div>
          </div>
        )}

        {gameState.startsWith('VOTE#') && (
          <div className={`voting-state ${bigScreenMode ? 'big-screen-mode' : ''}`}>
            <h2>Vote for the Best Applications!</h2>
            <p>Which applications of this lesson would be most valuable for teams to implement?</p>
            
            {answers.length > 0 && (
              <div className="answer-navigator">
                <div className="answer-counter">
                  Answer {currentAnswerIndex + 1} of {answers.length}
                </div>
                
                <div className="answer-display-container">
                  <button 
                    className="nav-arrow nav-arrow-left"
                    onClick={() => setCurrentAnswerIndex(Math.max(0, currentAnswerIndex - 1))}
                    disabled={currentAnswerIndex === 0}
                  >
                    ‹
                  </button>
                  
                  <div className="single-answer-display">
                    <div className="answer-text">"{answers[currentAnswerIndex]?.answer}"</div>
                    <div className="answer-author">- {answers[currentAnswerIndex]?.name}</div>
                  </div>
                  
                  <button 
                    className="nav-arrow nav-arrow-right"
                    onClick={() => setCurrentAnswerIndex(Math.min(answers.length - 1, currentAnswerIndex + 1))}
                    disabled={currentAnswerIndex === answers.length - 1}
                  >
                    ›
                  </button>
                </div>
              </div>
            )}
            
            <div className="voting-progress">
              {playersWhoVoted.length} of {players.length} players voted
            </div>
            <div className="voting-controls">
              <button 
                className="btn-primary" 
                onClick={() => { closeAllSidePanels(); handleShowResults(); }}
              >
                Show Results
              </button>
            </div>
          </div>
        )}

        {gameState.startsWith('RESULTS#') && (
          <div className={`results-state ${bigScreenMode ? 'big-screen-mode' : ''}`}>
            <h2>🏆 Question {parseInt(gameState.split('#')[1])} Results</h2>
            
            {currentGameType === 'trivia' ? (
              <div className="trivia-results-display">
                <div className="trivia-question-recap">
                  <h3>{questions[0]?.questionDetail || questions[0]?.detail || questions[0]?.title}</h3>
                </div>
                
                <div className="trivia-options-results">
                  {['optionA', 'optionB', 'optionC', 'optionD', 'optionE', 'optionF']
                    .filter(key => questions[0]?.[key])
                    .map((key, index) => {
                      const optionLetter = String.fromCharCode(65 + index);
                      const optionId = `Option${optionLetter}`;
                      const correctAnswers = Array.isArray(questions[0]?.correctAnswer) ? 
                        questions[0]?.correctAnswer : [questions[0]?.correctAnswer];
                      
                      // Comprehensive correct answer checking (same logic as PlayerPage)
                      let isCorrect = false;
                      
                      for (const correctAns of correctAnswers) {
                        if (!correctAns) continue;
                        
                        // Direct matches
                        if (correctAns === optionId || // "OptionA"
                            correctAns === optionLetter || // "A"  
                            correctAns === questions[0]?.[key]) { // actual option text
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
                      
                      // Calculate how many players selected this option
                      const playersWhoSelectedThis = answers.filter(answer => answer.answer === optionLetter).length;
                      const totalPlayers = answers.length;
                      const percentage = totalPlayers > 0 ? Math.round((playersWhoSelectedThis / totalPlayers) * 100) : 0;
                      
                      return (
                        <div 
                          key={key} 
                          className={`category-item trivia-result-option ${isCorrect ? 'correct' : 'incorrect'}`}
                        >
                          <span className="category-name">
                            <span className="option-letter">{optionLetter}.</span> {questions[0][key]}
                            {isCorrect && <span className="correct-indicator"> ✓</span>}
                          </span>
                          <span className="category-count">
                            {percentage}%
                          </span>
                        </div>
                      );
                    })}
                </div>
                
                <div className="trivia-player-scores">
                  <h4>Player Scores This Round:</h4>
                  {answers.map((answer, idx) => {
                    // Use the already calculated data from the API instead of recalculating
                    const playerName = answer.player; // Correct property name for trivia results
                    const isCorrect = answer.isCorrect; // From API calculation
                    const roundPoints = answer.points || 0; // From API calculation (includes speed bonus)
                    const player = players.find(p => p.name === playerName);
                    
                    console.log(`🏆 TRIVIA PLAYER RESULT: ${playerName} answered ${answer.answer}, isCorrect: ${isCorrect}, points: ${roundPoints}, total: ${player?.score}`);
                    
                    return (
                      <div key={idx} className={`trivia-player-result ${isCorrect ? 'correct' : 'incorrect'}`}>
                        <span className="player-name">{playerName}</span>
                        <span className="player-answer">Answer: {answer.answer}</span>
                        <span className="player-points">{isCorrect ? '✓' : '✗'} +{roundPoints} pts</span>
                        <span className="player-total">Total: {player?.score || 0} pts</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : (
              <div className="results-display">
                {answers.length === 0 && (
                  <div className="no-results-message">
                    <p>No results available. Results should load automatically when the game transitions to RESULTS state.</p>
                    <p>Current answers array: {JSON.stringify(answers)}</p>
                  </div>
                )}
                {answers.map((answer, idx) => {
                // 🎯 RESULTS DISPLAY: Use data from get-results API (already calculated)
                console.log(`🖥️ RENDERING RESULT FOR ANSWER ${idx}: "${answer.answer}" by ${answer.player}`);
                console.log(`📊 Using get-results data: ${answer.points} points, ${answer.votes} votes, placement: ${answer.placement}`);
                
                const totalPoints = answer.points || 0;
                
                console.log(`💰 TOTAL POINTS FOR ANSWER ${idx}: ${totalPoints}`);
                
                // Find the player's current total score from backend
                const player = players.find(p => p.name === answer.player);
                const playerTotalScore = player?.score || 0;
                console.log(`👤 Player ${answer.player} total score from backend: ${playerTotalScore}`);
                console.log(`🧮 This means previous score was: ${playerTotalScore - totalPoints}`);
                
                const previousScore = playerTotalScore - totalPoints;
                
                return (
                  <div key={idx} className={`result-item ${totalPoints > 0 ? 'scored' : ''}`}>
                    <div className="result-player-header">
                      <div className="result-player-name">{answer.player}</div>
                      <div className="result-points">
                        <span className="points-this-round">+{totalPoints} pts this round</span>
                        <span className="points-total">Total: {playerTotalScore} pts</span>
                      </div>
                    </div>
                    <div className="result-answer">"{answer.answer}"</div>
                    <div className="result-breakdown">
                      <span className="vote-summary">
                        {answer.votes} votes • Placement: {answer.placement ? (answer.placement === 1 ? '🥇' : answer.placement === 2 ? '🥈' : '🥉') : '-'}
                      </span>
                    </div>
                  </div>
                );
              })}
              </div>
            )}
            
            <div className="results-controls">
              <button className="btn-primary" onClick={() => { closeAllSidePanels(); handleNextQuestion(false); }}>
                Next Question
              </button>
            </div>
            
            {/* AI Insights Section - Inline Display */}
            <div className="ai-insights-section">
              {loadingAIInsights ? (
                <div className="ai-insights-loading">
                  <img src="/workie.png" alt="Workie" className="workie-avatar" />
                  <div className="ai-insights-content">
                    <h3>🤖 Workie is analyzing responses...</h3>
                    <p>Please wait while I generate strategic insights</p>
                  </div>
                </div>
              ) : currentAIInsights ? (
                <div className="ai-insights-inline">
                  <div className="ai-insights-header">
                    <img src="/workie.png" alt="Workie" className="workie-avatar" />
                    <div className="ai-insights-title">
                      <h3>💡 Strategic Insights from Workie</h3>
                      <p>AI-powered analysis of your team's responses</p>
                    </div>
                    <button 
                      className="regenerate-ai-btn"
                      onClick={handleRegenerateAISummary}
                      title="Regenerate AI Summary with fresh analysis"
                      disabled={loadingAIInsights}
                    >
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <path d="M1 4v6h6M23 20v-6h-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                        <path d="M20.49 9A9 9 0 0 0 5.64 5.64L1 10m22 4l-4.64 4.36A9 9 0 0 1 3.51 15" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                      </svg>
                    </button>
                  </div>
                  
                  <div className="ai-insights-body">
                    {currentAIInsights.markdownResponse ? (
                      // Use Markdown renderer if available
                      <MarkdownRenderer 
                        content={currentAIInsights.markdownResponse} 
                        className="ai-insights-markdown"
                      />
                    ) : (
                      // Fallback to structured display
                      <>
                        {/* Summary */}
                        <div className="ai-insights-section-item">
                          <h4>📋 Summary</h4>
                          <p>{currentAIInsights.summary}</p>
                        </div>
                        
                        {/* Discussion Topics */}
                        <div className="ai-insights-section-item">
                          <h4>💬 Discussion Topics</h4>
                          <ul>
                            {currentAIInsights.discussionTopics.map((topic, idx) => (
                              <li key={idx}>{topic}</li>
                            ))}
                          </ul>
                        </div>
                        
                        {/* Next Steps */}
                        <div className="ai-insights-section-item">
                          <h4>🎡 Next Steps</h4>
                          <ul>
                            {currentAIInsights.nextSteps.map((step, idx) => (
                              <li key={idx}>{step}</li>
                            ))}
                          </ul>
                        </div>
                      </>
                    )}
                    
                    {/* Debug Prompt Display */}
                    {gameDebugMode && (currentAIInsights.prompt || currentAIInsights.debugPrompt || currentAIInsights.debugProvenance) && (
                      <div className="ai-insights-section-item debug-section">
                        <h4>🐛 Debug: AI Prompt Information</h4>
                        
                        {/* Prompt Provenance Information */}
                        {currentAIInsights.debugProvenance && (
                          <div className="debug-provenance-section">
                            <h5>📋 Prompt Source</h5>
                            <div className="provenance-info">
                              <strong>Source:</strong> {currentAIInsights.debugProvenance.source === 'question_set' ? 'Custom prompt from question set' : 
                                                       currentAIInsights.debugProvenance.source === 'default_category' ? 'Default prompt for game type + category' :
                                                       currentAIInsights.debugProvenance.source === 'default_game_type' ? 'Default prompt for game type' :
                                                       'Fallback prompt'}
                              <br />
                              <strong>Details:</strong> {currentAIInsights.debugProvenance.details}
                              {currentAIInsights.debugProvenance.promptName && (
                                <>
                                  <br />
                                  <strong>Prompt Name:</strong> {currentAIInsights.debugProvenance.promptName}
                                </>
                              )}
                              {currentAIInsights.debugProvenance.category && (
                                <>
                                  <br />
                                  <strong>Category:</strong> {currentAIInsights.debugProvenance.category}
                                </>
                              )}
                            </div>
                            
                            {/* Context Hierarchy */}
                            {currentAIInsights.debugProvenance.hierarchy && currentAIInsights.debugProvenance.hierarchy.length > 0 && (
                              <div className="context-hierarchy">
                                <h6>🎯 Context Sources:</h6>
                                <ul>
                                  {currentAIInsights.debugProvenance.hierarchy.map((item, idx) => (
                                    <li key={idx}>
                                      <strong>{item.type === 'customInstruction' ? 'Custom Instructions' : 'AI Context'}:</strong> 
                                      <span className="context-source"> from {item.source === 'question_set' ? 'question set' : item.source}</span>
                                      <div className="context-preview">{item.value.substring(0, 100)}...</div>
                                    </li>
                                  ))}
                                </ul>
                              </div>
                            )}
                          </div>
                        )}
                        
                        {/* Full Prompt Display */}
                        <div className="debug-prompt-content">
                          <h5>📝 Full AI Prompt</h5>
                          <div className="prompt-display">{currentAIInsights.debugPrompt || currentAIInsights.prompt}</div>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                <div className="ai-insights-placeholder">
                  <img src="/workie.png" alt="Workie" className="workie-avatar-disabled" />
                  <div className="ai-insights-content">
                    <h3>🤖 Workie's Analysis</h3>
                    <p>Strategic insights will appear here after responses are submitted</p>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      </div>
      </div>
      
      {/* Expanded QR Code Modal */}
      {showExpandedQR && (
        <div className="expanded-qr-overlay" onClick={() => setShowExpandedQR(false)}>
          <div className="expanded-qr-content" onClick={(e) => e.stopPropagation()}>
            <div className="expanded-qr-header">
              <h2>{eventTitle || 'Engagements Session'}</h2>
            </div>
            <div className="expanded-qr-code">
              <QRCodeSVG value={playUrl} size={300} />
            </div>
            {expandedCopyMessage && (
              <div className="copy-message expanded-copy-message">
                ✓ Link copied!
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
            <div className="expanded-qr-instructions">
              Click anywhere to close
            </div>
          </div>
        </div>
      )}
      
      {/* Loading Data Overlay */}
      {isLoadingData && (
        <div className="flash-alert-overlay">
          <div className="flash-alert">
            <div className="flash-alert-icon">⏳</div>
            <div className="flash-alert-text">{loadingMessage}</div>
            <div className="flash-alert-subtext">Please wait while we update the game...</div>
          </div>
        </div>
      )}

      {/* Flash Alert for All Players Answered */}
      {showAllAnsweredAlert && (
        <div className="flash-alert-overlay">
          <div className="flash-alert">
            <div className="flash-alert-icon">🎉</div>
            <div className="flash-alert-text">All Players Have Answered!</div>
            <div className="flash-alert-subtext">Ready to proceed to voting</div>
          </div>
        </div>
      )}
      
      {/* Flash Alert for All Players Voted */}
      {showAllVotedAlert && (
        <div className="flash-alert-overlay">
          <div className="flash-alert">
            <div className="flash-alert-icon">🗳️</div>
            <div className="flash-alert-text">All Players Have Voted!</div>
            <div className="flash-alert-subtext">Ready to see results</div>
          </div>
        </div>
      )}
      
      {/* Invite Created Success Alert */}
      {showInviteCreated && (
        <div className="flash-alert-overlay">
          <div className="flash-alert">
            <div className="flash-alert-icon">📋</div>
            <div className="flash-alert-text">Invite Created & Copied!</div>
            <div className="flash-alert-subtext">Meeting invitation copied to clipboard</div>
          </div>
        </div>
      )}
      
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
            {currentGameType === 'wavelength' && questions[0].topic && (
              <div className="expanded-lesson-detail wavelength-topic-expanded">
                <strong>Topic:</strong> {questions[0].topic}
              </div>
            )}
            <div className="expanded-lesson-prompt">
              <strong>{getInstructionText()}</strong>
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
  );
}

// Game Report Component
function GameReport({ reportData, onClose }) {
  const { gameId, eventTitle, players, questions, allAnswers, allVotes, aiSummaries } = reportData;
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
    <div className="report-container">
      <div className="report-header">
        <div className="parallax">
          <section className="parallax__header">
            <div className="parallax__visuals">
              <div className="parallax__black-line-overflow"></div>
              <div data-parallax-layers className="parallax__layers">
                <img src="https://cdn.prod.website-files.com/671752cd4027f01b1b8f1c7f/6717795be09b462b2e8ebf71_osmo-parallax-layer-3.webp" loading="eager" width="800" data-parallax-layer="1" alt="" className="parallax__layer-img" />
                <img src="https://cdn.prod.website-files.com/671752cd4027f01b1b8f1c7f/6717795b4d5ac529e7d3a562_osmo-parallax-layer-2.webp" loading="eager" width="800" data-parallax-layer="2" alt="" className="parallax__layer-img" />
                <div data-parallax-layer="3" className="parallax__layer-title">
                  <h2 className="parallax__title report-title">Engagements Game Report</h2>
                </div>
                <img src="https://cdn.prod.website-files.com/671752cd4027f01b1b8f1c7f/6717795bb5aceca85011ad83_osmo-parallax-layer-1.webp" loading="eager" width="800" data-parallax-layer="4" alt="" className="parallax__layer-img" />
              </div>
              <div className="parallax__fade"></div>
            </div>
          </section>
        </div>
        
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
            <span>{questions.length} Lesson{questions.length !== 1 ? 's' : ''}</span>
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
            ← Back to Game
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
                  Lesson {qIdx + 1} - {questionData.title || `Question ${questionNumber}`}
                </h3>
                <div className="field-badge">{questionData.category || 'General'}</div>
              </div>
              
              {questionData.detail && (
                <div className="report-lesson-detail">
                  {questionData.detail}
                </div>
              )}
              
              {/* Trivia Question Options - show choices with correct answer marked */}
              {currentGameType === 'trivia' && (
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
                          {isCorrect && <span className="correct-indicator">✓ Correct Answer</span>}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
              
              {/* AI Summary for this question */}
              {aiSummary && (
                <div className="report-ai-summary">
                  <h4>🤖 AI Analysis</h4>
                  
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
                const rankEmoji = player.rank === 1 ? '🏆' : player.rank === 2 ? '🥈' : player.rank === 3 ? '🥉' : '📍';
                return (
                  <div key={player.name} className={`score-item ${isChampion ? 'champion' : ''}`}>
                    {isChampion && <div className="champion-badge">🏆 Session Champion</div>}
                    <div className="player-name">{rankEmoji} #{player.rank} {player.name}</div>
                    <div className="player-final-score">{player.score || 0} points</div>
                  </div>
                );
              });
            })()}
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

    </div>
  );
}

export default GameHostPage;