import React, { useState, useEffect } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import html2pdf from 'html2pdf.js';
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

function GameHostPage() {
  // 🎯 GAME ID MANAGEMENT: Use URL as single source of truth
  const [gameId, setGameId] = useState('');
  const [players, setPlayers] = useState([]);
  const [questions, setQuestions] = useState([]);
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(-1);
  const [currentQuestionId, setCurrentQuestionId] = useState('');
  const [answers, setAnswers] = useState([]);
  const [gameState, setGameState] = useState('waiting'); // waiting, question, voting (call-and-answer only), results
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
  const [newGameSetId, setNewGameSetId] = useState('');
  const [eventTitle, setEventTitle] = useState('');
  const [gameAiContext, setGameAiContext] = useState('');
  const [engagementType, setEngagementType] = useState('call-and-answer'); // 'call-and-answer' or 'trivia'
  const [triviaTimer, setTriviaTimer] = useState(30); // Timer for trivia questions in seconds
  
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
  
  // AI Summary data
  const [aiSummaries, setAiSummaries] = useState({});
  const [currentAIInsights, setCurrentAIInsights] = useState(null);
  const [loadingAIInsights, setLoadingAIInsights] = useState(false);
  
  // Flash alerts for when all players have answered/voted
  const [showAllAnsweredAlert, setShowAllAnsweredAlert] = useState(false);
  const [showAllVotedAlert, setShowAllVotedAlert] = useState(false);
  
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

  // Handle debug mode toggle
  const handleToggleGameDebugMode = async () => {
    if (!gameId) return;
    
    try {
      const newDebugMode = !gameDebugMode;
      const response = await fetch(`${API_BASE}games/${gameId}/debug-mode`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ debugMode: newDebugMode })
      });
      
      if (response.ok) {
        setGameDebugMode(newDebugMode);
        console.log(`🐛 Game ${gameId} debug mode ${newDebugMode ? 'ENABLED' : 'DISABLED'}`);
      } else {
        console.error('Failed to update game debug mode:', response.status);
      }
    } catch (error) {
      console.error('Error updating game debug mode:', error);
    }
  };

  // Fetch AI summary for a specific question from DynamoDB
  const fetchAISummary = async (questionId) => {
    if (!gameId || !questionId) return null;
    
    try {
      const debugParam = gameDebugMode ? '?debug=true' : '';
      const response = await fetch(`${API_BASE}games/${gameId}/summary/${questionId}${debugParam}`);
      
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
    if (gameState === 'results' && currentQuestionIndex >= 0 && answers.length > 0) {
      const questionId = String(currentQuestionIndex + 1).padStart(3, '0');
      console.log(`🤖 Starting AI insights load for question ${questionId} with ${answers.length} answers`);
      setLoadingAIInsights(true);
      setCurrentAIInsights(null);
      
      // In WebSocket mode, we still need to trigger AI generation but rely on WebSocket for completion notification
      if (useWebSocket) {
        console.log('🔌 WebSocket mode: Triggering AI generation and waiting for WebSocket notification');
        
        // Check if AI summary already exists first
        fetchAISummary(questionId).then(existingSummary => {
          if (existingSummary && existingSummary.summaryText) {
            console.log('✅ Found existing AI summary');
            setCurrentAIInsights({
              summary: existingSummary.summaryText,
              discussionTopics: existingSummary.discussionQuestions || [],
              nextSteps: existingSummary.nextSteps || [],
              prompt: gameDebugMode ? existingSummary.debugPrompt : undefined
            });
            setLoadingAIInsights(false);
          } else {
            // Trigger AI generation - WebSocket will notify us when done
            console.log('🤖 Triggering AI generation, will wait for WebSocket notification...');
            fetch(`${API_BASE}admin/ai-summary/${gameId}`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ questionIds: [questionId] })
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
    if (gameState === 'question' && players.length > 0 && playersWhoAnswered.length === players.length && playersWhoAnswered.length > 0) {
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

  // Check if all players have voted and trigger flash alert
  useEffect(() => {
    if (gameState === 'voting' && players.length > 0 && playersWhoVoted.length === players.length && playersWhoVoted.length > 0) {
      console.log('🗳️ All players have voted! Triggering flash alert.');
      setShowAllVotedAlert(true);
      
      // Hide alert after 3 seconds
      setTimeout(() => {
        setShowAllVotedAlert(false);
      }, 3000);
    }
  }, [gameState, players.length, playersWhoVoted.length]);

  // 🔗 Initialize game ID and event title from URL or generate new one
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const gameIdFromUrl = urlParams.get('gameId');
    const eventTitleFromUrl = urlParams.get('eventTitle');
    
    if (gameIdFromUrl) {
      console.log(`🔗 HOST: Found game ID in URL: ${gameIdFromUrl}`);
      setGameId(gameIdFromUrl);
      setShowWelcomeScreen(false); // Hide welcome screen if we have a game ID
      
      // Restore event title from URL or localStorage
      if (eventTitleFromUrl) {
        const decodedTitle = decodeURIComponent(eventTitleFromUrl);
        setEventTitle(decodedTitle);
        console.log(`🔗 HOST: Restored event title from URL: ${decodedTitle}`);
        // Update the database with the restored title
        updateGameTitle(gameIdFromUrl, decodedTitle);
      } else {
        // Try localStorage as backup
        const storedTitle = localStorage.getItem(`game_${gameIdFromUrl}_title`);
        if (storedTitle) {
          setEventTitle(storedTitle);
          console.log(`🔗 HOST: Restored event title from localStorage: ${storedTitle}`);
          // Update the database with the restored title
          updateGameTitle(gameIdFromUrl, storedTitle);
        }
      }
    } else {
      // No game ID in URL - show welcome screen
      console.log(`🏠 HOST: No game ID in URL - showing welcome screen`);
      setShowWelcomeScreen(true);
      // Preload question sets for the new game dialog
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
      await restoreGameState(); // This will determine if it's an existing game
      
      // Check the current state after restoration
      console.log(`🔍 HOST: After restoration - gameState: ${gameState}, selectedSetId: ${selectedSetId}`);
      
      // Use a small delay to ensure state updates have propagated
      await new Promise(resolve => setTimeout(resolve, 100));
      
      // Re-check selectedSetId after state has had time to update
      const currentSelectedSetId = selectedSetId;
      console.log(`🔍 HOST: Current selectedSetId after delay: ${currentSelectedSetId}`);
      
      // If no state was restored (new game), fetch question sets first
      if (gameState === 'waiting' && !currentSelectedSetId) {
        console.log(`📚 HOST: No question set found, fetching available sets...`);
        await fetchQuestionSets(); // This will set selectedSetId
      } else if (currentSelectedSetId) {
        console.log(`✅ HOST: Question set already restored: ${currentSelectedSetId}`);
      }
      
      // Now create/validate game with proper questionSetId
      await createGame();
      
      fetchPlayers('initial-load');
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
      // Fetch latest answers for the question
      if (data.questionId) {
        console.log(`🔌 Refreshing answers for question ${data.questionId}`);
        fetchAnswersForQuestion(data.questionId);
      }
    });

    webSocketClient.onMessage('playerVoted', (data) => {
      console.log('🔌 Player voted notification:', data);
      // Fetch latest votes for the question
      if (data.questionId) {
        console.log(`🔌 Refreshing votes for question ${data.questionId}`);
        fetchVotesForQuestion(data.questionId);
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
              summary: summary.summaryText,
              discussionTopics: summary.discussionQuestions || [],
              nextSteps: summary.nextSteps || [],
              prompt: gameDebugMode ? summary.debugPrompt : undefined
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

    // Connect as host
    const connected = webSocketClient.connect(gameId, null, true);
    if (!connected) {
      console.error('🔌 Failed to connect WebSocket, falling back to polling');
      setUseWebSocket(false);
    }

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

  const createGame = async (aiContext = null) => {
    try {
      console.log(`🔍 HOST: Checking if game ${gameId} already exists...`);
      
      // First check if game already exists (for reconnection scenarios)
      const validateRes = await fetch(`${API_BASE}games/${gameId}/validate`);
      
      if (validateRes.ok) {
        const validateData = await validateRes.json();
        if (validateData.exists) {
          console.log(`✅ HOST: Game ${gameId} already exists - reconnecting to existing game`);
          return; // Don't create, just connect to existing game
        }
      }
      
      // Game doesn't exist, create it
      console.log(`🆕 HOST: Game ${gameId} doesn't exist - creating new game`);
      console.log(`🔍 HOST: Creating game with questionSetId: ${selectedSetId}, gameType: ${currentGameType}`);
      const titleToUse = eventTitle || 'Engagements Session';
      await fetch(`${API_BASE}games/${gameId}/create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          eventTitle: titleToUse,
          aiContext: aiContext || null,
          gameType: currentGameType,
          questionSetId: selectedSetId
        })
      });
      console.log(`🆕 HOST: Game ${gameId} created with title: ${titleToUse}, questionSetId: ${selectedSetId}`);
      console.log(`✅ HOST: Game ${gameId} created successfully`);
    } catch (e) {
      console.error('Failed to create/validate game', e);
    }
  };

  const restoreGameState = async () => {
    setIsRestoringState(true); // Start restoration
    try {
      console.log(`🔄 HOST: Restoring game state for ${gameId}...`);
      
      // Don't restore state if we just manually changed it
      if (manualStateChange) {
        console.log(`⏭️ HOST: Skipping state restore - manual change in progress`);
        setManualStateChange(false); // Reset the flag
        return;
      }
      
      const stateRes = await fetch(`${API_BASE}games/${gameId}/state`);
      if (stateRes.ok) {
        const gameStateData = await stateRes.json();
        console.log(`📊 HOST: Found existing game state:`, gameStateData);
        
        // Restore game state
        if (gameStateData.state) {
          setGameState(gameStateData.state);
          console.log(`🎮 HOST: Restored game state: ${gameStateData.state}`);
        }
        
        // Restore game type
        if (gameStateData.gameType) {
          setCurrentGameType(gameStateData.gameType);
          console.log(`🎯 HOST: Restored game type: ${gameStateData.gameType}`);
        }
        
        // Restore question set
        if (gameStateData.questionSetId) {
          console.log(`🔄 HOST: Restoring question set: ${gameStateData.questionSetId}`);
          setSelectedSetId(gameStateData.questionSetId);
          fetchCategories(gameStateData.questionSetId);
          console.log(`📚 HOST: Restored question set: ${gameStateData.questionSetId}`);
        } else {
          console.log(`⚠️ HOST: No questionSetId in game state to restore`);
        }
        
        // Calculate currentQuestionIndex from playedQuestions
        if (gameStateData.playedQuestions && gameStateData.currentQuestion) {
          const playedQuestions = gameStateData.playedQuestions;
          const currentQuestion = gameStateData.currentQuestion;
          
          // Track current question ID
          setCurrentQuestionId(currentQuestion);
          
          // Find the index of the current question in the played questions array
          const questionIndex = playedQuestions.indexOf(currentQuestion);
          if (questionIndex !== -1) {
            setCurrentQuestionIndex(questionIndex);
            console.log(`📝 HOST: Restored question index: ${questionIndex} for question ${currentQuestion}`);
          } else {
            // If current question not found in played questions, it's probably the latest one
            setCurrentQuestionIndex(playedQuestions.length - 1);
            console.log(`📝 HOST: Current question not found in played list, using latest index: ${playedQuestions.length - 1}`);
          }
          
          // Set lesson number from played questions count
          setLessonNumber(playedQuestions.length);
          console.log(`🔢 HOST: Restored lesson number: ${playedQuestions.length}`);
        } else if (gameStateData.currentQuestion) {
          // If we have a current question but no played questions array, assume it's question 1
          setCurrentQuestionIndex(0);
          setLessonNumber(1);
          console.log(`📝 HOST: Set to first question (no played questions array)`);
        }
        
        // If we're in an active game state, set up the current question data
        if ((gameStateData.state === 'question' || gameStateData.state === 'voting' || gameStateData.state === 'results') && 
            gameStateData.currentQuestion && gameStateData.currentQuestionData) {
          console.log(`📝 HOST: Setting up current question: ${gameStateData.currentQuestion}`);
          
          // Set the questions array with the current question for display
          console.log(`📝 HOST: Setting question data for display:`, gameStateData.currentQuestionData);
          setQuestions([gameStateData.currentQuestionData]);
          
          // Fetch answers for current question
          console.log(`📝 HOST: Fetching answers for current question: ${gameStateData.currentQuestion}`);
          await fetchAnswersForQuestion(gameStateData.currentQuestion);
          
          // If we're in voting or results state, fetch the votes too
          if (gameStateData.state === 'voting' || gameStateData.state === 'results') {
            console.log(`🗳️ HOST: Fetching votes for current question: ${gameStateData.currentQuestion}`);
            await fetchVotesForQuestion(gameStateData.currentQuestion);
          }
        }
      } else {
        console.log(`ℹ️ HOST: No existing game state found - starting fresh`);
      }
    } catch (e) {
      console.error('Error restoring game state:', e);
    } finally {
      setIsRestoringState(false); // End restoration
    }
  };

  const fetchAnswersForQuestion = async (questionNumber) => {
    try {
      console.log(`📡 HOST: Fetching answers for question ${questionNumber}`);
      const url = `${API_BASE}games/${gameId}/answers?questionNumber=${questionNumber}`;
      console.log(`📡 HOST: API call: ${url}`);
      
      const res = await fetch(url);
      const json = await res.json();
      console.log(`📊 HOST: Raw answer response:`, json);
      
      const questionAnswers = json.answers || [];
      console.log(`🔍 HOST: Answers for question ${questionNumber}:`, questionAnswers);
      
      setAnswers(questionAnswers);
      
      const playerNames = questionAnswers.map(a => a.name);
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
      const url = `${API_BASE}games/${gameId}/votes?questionNumber=${questionNumber}`;
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
      setPlayers(json.players || []);
    } catch (e) {
      console.error('fetchPlayers error', e);
    }
  };

  const fetchQuestions = async (setId = null) => {
    try {
      const url = setId ? `${API_BASE}questions?setId=${setId}` : `${API_BASE}questions`;
      const res = await fetch(url);
      const json = await res.json();
      setQuestions(json.questions || []);
      console.log(`📚 Loaded ${json.questions?.length || 0} questions from ${setId ? `set ${setId}` : 'default source'}`);
    } catch (e) {
      console.error('fetchQuestions error', e);
    }
  };

  const fetchRandomQuestion = async () => {
    if (!selectedSetId || !gameId) {
      console.error('Cannot fetch random question: missing setId or gameId');
      return null;
    }
    
    try {
      // Convert Set to Array for URL params
      const activeCategoriesArray = Array.from(activeCategoryIds);
      const categoriesParam = activeCategoriesArray.length > 0 ? `&categories=${encodeURIComponent(activeCategoriesArray.join(','))}` : '';
      
      const url = `${API_BASE}questions?setId=${selectedSetId}&gameId=${gameId}&getNext=true${categoriesParam}`;
      console.log(`🎲 Fetching random question: ${url}`);
      console.log(`🏷️ Active categories: ${activeCategoriesArray.join(', ')}`);
      console.log(`🔗 Categories param: ${categoriesParam}`);
      
      const res = await fetch(url);
      const json = await res.json();
      
      if (json.gameComplete) {
        console.log('🎉 Game complete - all questions used!');
        alert('Congratulations! You\'ve completed all questions in this set.');
        return null;
      }
      
      if (json.questions && json.questions.length > 0) {
        const question = json.questions[0];
        console.log(`🎯 Got random question: ${question.id} - ${question.title}`);
        console.log(`📊 Remaining questions: ${json.availableCount}`);
        console.log(`🎮 Question type: ${currentGameType}, has options: ${!!question.optionA}`);
        console.log(`📝 Full question data:`, question);
        return question;
      }
      
      return null;
    } catch (e) {
      console.error('fetchRandomQuestion error', e);
      return null;
    }
  };

  const fetchQuestionSets = async () => {
    try {
      const res = await fetch(`${API_BASE}question-sets`);
      const json = await res.json();
      const activeSets = json.sets?.filter(set => set.active) || [];
      setQuestionSets(activeSets);
      
      console.log(`🔍 HOST: fetchQuestionSets auto-selection check:`, {
        activeSetsCount: activeSets.length,
        selectedSetId,
        gameState,
        shouldAutoSelect: activeSets.length > 0 && !selectedSetId && gameState === 'waiting'
      });
      
      // Auto-select first set if none selected and no game is running
      // CRITICAL: Don't auto-select during state restoration to prevent override of restored questionSetId
      if (activeSets.length > 0 && !selectedSetId && gameState === 'waiting' && !isRestoringState) {
        const firstSetId = activeSets[0].id;
        setSelectedSetId(firstSetId);
        fetchCategories(firstSetId);
        fetchQuestions(firstSetId);
        console.log(`🎯 HOST: Auto-selected first question set: ${firstSetId}`);
      } else if (selectedSetId) {
        console.log(`⏳ HOST: Question set already selected: ${selectedSetId}`);
      } else if (gameState !== 'waiting') {
        console.log(`⏳ HOST: Game in progress (${gameState}) - not auto-selecting question set`);
      } else if (isRestoringState) {
        console.log(`🔄 HOST: State restoration in progress - skipping auto-selection`);
      } else {
        console.log(`⏳ HOST: No auto-selection - no active sets available`);
      }
    } catch (e) {
      console.error('fetchQuestionSets error', e);
    }
  };

  const fetchCategories = async (setId) => {
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
      
      // Initialize all categories as active by default
      const allCategoryIds = new Set(fetchedCategories.map(cat => cat.name));
      setActiveCategoryIds(allCategoryIds);
    } catch (e) {
      console.error('fetchCategories error', e);
    }
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

  const handleNextQuestion = async () => {
    // Show confirmation when skipping to next question during Ask phase
    if (gameState === 'question') {
      const proceed = await showConfirmation(
        'Skip to Next Question?',
        'Do you want to skip to the next question?',
        'Skip Question'
      );
      if (!proceed) return;
    }

    try {
      // Get a random question
      const randomQuestion = await fetchRandomQuestion();
      
      if (!randomQuestion) {
        console.log('🚫 No more questions available or game complete');
        return;
      }
      
      // Get current state to track progress
      const stateRes = await fetch(`${API_BASE}games/${gameId}/state`);
      const currentState = stateRes.ok ? await stateRes.json() : {};
      let scoredQuestions = currentState.scoredQuestions || [];
      let usedQuestions = currentState.usedQuestions || [];
      let playedQuestions = currentState.playedQuestions || [];
      
      // Calculate the next sequential question number
      const nextQuestionNumber = String(playedQuestions.length + 1).padStart(3, '0'); // "001", "002", etc.
      console.log(`🎯 Starting question ${nextQuestionNumber}: ${randomQuestion.title}`);
      
      // Update the used questions list
      usedQuestions = [...usedQuestions, randomQuestion.id];
      playedQuestions = [...playedQuestions, nextQuestionNumber];
      
      // Call StartQuestion endpoint to create the pointer record
      await fetch(`${API_BASE}games/${gameId}/start-question`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          questionNumber: nextQuestionNumber,
          questionRef: randomQuestion.id, // Pointer to the original question
          setId: randomQuestion.setId,
          category: randomQuestion.category
        })
      });
      
      // Update game state with current question
      await fetch(`${API_BASE}games/${gameId}/state`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          state: 'question',
          currentQuestion: nextQuestionNumber,
          currentQuestionId: nextQuestionNumber,
          scoredQuestions,
          usedQuestions,
          playedQuestions,
          currentQuestionData: randomQuestion,
          gameType: currentGameType
        })
      });
      
      // Update local state - mark as manual change to prevent restore override
      setManualStateChange(true);
      setCurrentQuestionIndex(playedQuestions.length - 1); // Set to the index of this question
      setGameState('question');
      
      // Clear all answer/voting state for new question
      console.log(`🧹 HOST: Clearing state for new question - resetting answers and players`);
      setAnswers([]);
      setPlayersWhoAnswered([]);
      setVotes([]);
      setPlayersWhoVoted([]);
      setCurrentQuestionVotes([]);
      setCurrentAnswerIndex(0);
      setLessonNumber(playedQuestions.length);
      
      console.log(`📊 HOST: State after reset - Answers: ${[].length}, PlayersWhoAnswered: ${[].length}`);
      
      // Set the questions array from the data that was sent to the state
      setQuestions([randomQuestion]);
      
      // Reset manual state change flag after a delay to allow polling to resume
      setTimeout(() => {
        setManualStateChange(false);
      }, 3000);
      
      // DON'T immediately check for answers on a new question - let players answer first
      console.log(`🚀 HOST: New question ${nextQuestionNumber} ready - waiting for player answers`);
      
      console.log(`🎯 Started question ${nextQuestionNumber}: ${randomQuestion.title}`);
    } catch (e) {
      console.error('Failed to get next question', e);
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
        const isCorrect = questionData.correctAnswer === playerAnswerText;
        
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
    // For trivia, go straight to results
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
      
      // Calculate trivia scores before showing results
      try {
        await calculateTriviaScores();
      } catch (e) {
        console.error('Error calculating trivia scores:', e);
      }
      
      setManualStateChange(true);
      setGameState('results');
      
      // Update game state in database
      try {
        const stateRes = await fetch(`${API_BASE}games/${gameId}/state`);
        const currentState = stateRes.ok ? await stateRes.json() : {};
        
        await fetch(`${API_BASE}games/${gameId}/state`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            state: 'results',
            currentQuestion: currentState.currentQuestion,
            currentQuestionId: currentState.currentQuestion,
            scoredQuestions: [...(currentState.scoredQuestions || []), currentState.currentQuestion],
            usedQuestions: currentState.usedQuestions || [],
            gameType: currentGameType
          })
        });
      } catch (e) {
        console.error('Error updating game state to results:', e);
      }
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
    
    // Update game state in database
    try {
      // Get current state to preserve scoredQuestions
      const stateRes = await fetch(`${API_BASE}games/${gameId}/state`);
      const currentState = stateRes.ok ? await stateRes.json() : {};
      
      await fetch(`${API_BASE}games/${gameId}/state`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          state: 'voting',
          currentQuestion: currentState.currentQuestion, // Keep the sequential number
          currentQuestionId: currentState.currentQuestion, // Use sequential number as ID
          scoredQuestions: currentState.scoredQuestions || [],
          usedQuestions: currentState.usedQuestions || [],
          playedQuestions: currentState.playedQuestions || [],
          currentQuestionData: currentState.currentQuestionData
        })
      });
    } catch (e) {
      console.error('Failed to update game state', e);
    }
  };

  const handleShowResults = async () => {
    // Warn if not all players have voted
    if (playersWhoVoted.length < players.length) {
      const proceed = await showConfirmation(
        'Show Results?',
        `Only ${playersWhoVoted.length} of ${players.length} players have voted. Do you want to show results anyway?`,
        'Show Results'
      );
      if (!proceed) return;
    }

    try {
      // Get current sequential question number
      const stateRes = await fetch(`${API_BASE}games/${gameId}/state`);
      const currentState = stateRes.ok ? await stateRes.json() : {};
      const questionNumber = currentState.currentQuestion;
      
      if (!questionNumber) {
        console.log('⚠️ No current question number found');
        return;
      }
      
      // STEP 1: Fetch votes for ONLY this specific question
      console.log(`🎯 FETCHING VOTES FOR QUESTION: ${questionNumber}`);
      console.log(`📡 API Call: ${API_BASE}games/${gameId}/votes?questionNumber=${questionNumber}`);
      
      const votesRes = await fetch(`${API_BASE}games/${gameId}/votes?questionNumber=${questionNumber}`);
      const votesJson = await votesRes.json();
      const questionVotes = votesJson.votes || [];
      
      // STEP 2: Update state with fresh vote data
      console.log(`📊 RAW VOTE DATA RECEIVED:`, questionVotes);
      setVotes(questionVotes);
      setCurrentQuestionVotes(questionVotes);
      
      // STEP 3: Analyze vote distribution for debugging
      const votesByRank = { 1: 0, 2: 0, 3: 0 };
      questionVotes.forEach(vote => {
        votesByRank[vote.rank] = (votesByRank[vote.rank] || 0) + 1;
        console.log(`  👤 Vote: ${vote.voter} ranked answer ${vote.answerIndex} as #${vote.rank} for question ${vote.questionNumber}`);
      });
      
      console.log(`=== 🏆 SCORING DEBUG for question ${questionNumber} ===`);
      console.log('📈 Vote counts by rank:', votesByRank);
      console.log('👥 Total players:', players.length);
      console.log('🗳️ Total votes received:', questionVotes.length);
      console.log('📋 Complete vote list:', questionVotes);
      
      // STEP 4: Calculate points for each answer (3=1st, 2=2nd, 1=3rd)
      console.log(`🧮 CALCULATING POINTS FOR ${answers.length} ANSWERS...`);
      const answerPoints = {};
      questionVotes.forEach(vote => {
        const answerIndex = vote.answerIndex;
        if (!answerPoints[answerIndex]) answerPoints[answerIndex] = 0;
        
        // 3 points for 1st place, 2 points for 2nd, 1 point for 3rd
        let points = 0;
        if (vote.rank === 1) points = 3;
        else if (vote.rank === 2) points = 2;
        else if (vote.rank === 3) points = 1;
        
        answerPoints[answerIndex] += points;
        console.log(`  💰 Answer ${answerIndex} gets +${points} points from ${vote.voter}'s rank ${vote.rank} vote`);
      });
      
      // STEP 5: Map points back to player names
      console.log(`👤 MAPPING POINTS TO PLAYERS...`);
      const playerScoreUpdates = {};
      answers.forEach((answer, index) => {
        const points = answerPoints[index] || 0;
        console.log(`  🎯 Answer ${index} "${answer.answer}" by ${answer.name}: ${points} points`);
        if (points > 0) {
          playerScoreUpdates[answer.name] = points;
        }
      });
      
      console.log('💯 FINAL ANSWER POINTS:', answerPoints);
      console.log('🏆 PLAYER SCORE UPDATES:', playerScoreUpdates);
      
      // STEP 6: Check if this question has already been scored (prevent double-scoring)
      console.log(`🔍 CHECKING IF QUESTION ${questionNumber} ALREADY SCORED...`);
      const scoredRes = await fetch(`${API_BASE}games/${gameId}/state`);
      const currentGameState = await scoredRes.json();
      const scoredQuestions = currentGameState.scoredQuestions || [];
      
      const alreadyScored = scoredQuestions.includes(questionNumber);
      console.log(`❓ Question ${questionNumber} scoring status:`, {
        alreadyScored,
        scoredQuestions,
        playerScoreUpdates
      });
      
      if (alreadyScored) {
        console.log(`⚠️ QUESTION ${questionNumber} ALREADY SCORED - SKIPPING BACKEND UPDATE`);
      } else {
        console.log(`✅ QUESTION ${questionNumber} NOT YET SCORED - PROCEEDING WITH UPDATE`);
      }
      
      if (!scoredQuestions.includes(questionNumber)) {
        // STEP 7: Update scores in backend (only if not already scored)
        if (Object.keys(playerScoreUpdates).length > 0) {
          console.log(`💾 UPDATING PLAYER SCORES IN BACKEND:`, playerScoreUpdates);
          await fetch(`${API_BASE}games/${gameId}/scores`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              questionNumber: questionNumber,
              scores: playerScoreUpdates
            })
          });
          console.log(`✅ SCORES UPDATED IN BACKEND`);
          
          // STEP 8: Mark this question as scored to prevent double-scoring
          console.log(`🏷️ MARKING QUESTION ${questionNumber} AS SCORED`);
          await fetch(`${API_BASE}games/${gameId}/state`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              state: 'results',
              currentQuestion: questionNumber,
              currentQuestionId: questionNumber,
              scoredQuestions: [...scoredQuestions, questionNumber],
              usedQuestions: currentGameState.usedQuestions || [],
              playedQuestions: currentGameState.playedQuestions || [],
              currentQuestionData: currentState.currentQuestionData
            })
          });
          console.log(`🎯 QUESTION ${questionNumber} MARKED AS SCORED`);
        } else {
          console.log(`⚠️ NO SCORE UPDATES TO APPLY - NO PLAYERS EARNED POINTS`);
        }
      } else {
        console.log(`⏭️ QUESTION ${questionNumber} ALREADY SCORED - JUST UPDATING GAME STATE`);
        // Just update state to results without scoring
        await fetch(`${API_BASE}games/${gameId}/state`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            state: 'results',
            currentQuestion: questionNumber,
            currentQuestionId: questionNumber,
            scoredQuestions,
            usedQuestions: currentGameState.usedQuestions || [],
            playedQuestions: currentGameState.playedQuestions || []
          })
        });
      }
      
      // Refresh player data to show updated scores
      await fetchPlayers('after-start-question');
      
      
      // Make sure currentQuestionId is set to the question number
      setCurrentQuestionId(questionNumber);
      
      // Fetch AI summary for this question if available
      await fetchAISummary(questionNumber);
      
      setManualStateChange(true);
      setGameState('results');
    } catch (e) {
      console.error('handleShowResults error', e);
      setGameState('results');
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
    
    // Update URL
    const url = new URL(window.location);
    url.searchParams.set('gameId', selectedGameId);
    url.searchParams.set('eventTitle', encodeURIComponent(selectedEventTitle));
    window.history.replaceState(null, '', url);
    console.log(`🔗 HOST: Selected game ${selectedGameId} from history`);
  };

  const handleStartNewGame = async () => {
    if (!newGameSetId || !eventTitle.trim()) {
      alert('Please select a question set and enter an event title.');
      return;
    }

    try {
      // Clear all game data from database
      console.log(`🗑️ HOST: Clearing old game ${gameId} data`);
      await fetch(`${API_BASE}games/${gameId}/clear`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });
    } catch (e) {
      console.error('handleNewGame clear error', e);
    }
    
    // Generate new game ID and update URL
    const newGameId = generateGameId();
    console.log(`🆕 HOST: Starting new game with ID ${newGameId}`);
    
    // Update URL with both gameId and eventTitle
    const url = new URL(window.location);
    url.searchParams.set('gameId', newGameId);
    url.searchParams.set('eventTitle', encodeURIComponent(eventTitle));
    window.history.replaceState(null, '', url);
    console.log(`🔗 HOST: Updated URL for new game`);
    
    // Store event title in localStorage as backup
    localStorage.setItem(`game_${newGameId}_title`, eventTitle);
    
    // Update question set selection
    setSelectedSetId(newGameSetId);
    fetchCategories(newGameSetId);
    
    // Reset all state
    setGameId(newGameId);
    setCurrentQuestionIndex(-1);
    setGameState('waiting');
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
    
    // Create the game with AI context
    await createGame(gameAiContext);
    
    // Close dialog
    setShowNewGameDialog(false);
    
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
      
      // Use the event title from the games list (which comes from database)
      const finalEventTitle = targetEventTitle || 'Engagements Session';
      
      // Get played questions from game state
      const stateRes = await fetch(`${API_BASE}games/${targetGameId}/state`);
      const gameState = stateRes.ok ? await stateRes.json() : {};
      const playedQuestions = gameState.playedQuestions || [];
      
      console.log(`📋 Found ${playedQuestions.length} played questions for report`);
      
      // Get players for this game
      const playersRes = await fetch(`${API_BASE}games/${targetGameId}/players`);
      const playersData = await playersRes.json();
      const gamePlayers = playersData.players || [];
      
      // Collect all game data
      const gameData = {
        gameId: targetGameId,
        eventTitle: finalEventTitle,
        players: gamePlayers,
        questions: [],
        allAnswers: [],
        allVotes: [],
        aiSummaries: {}
      };

      // Fetch all question data from the report endpoint
      const reportDataRes = await fetch(`${API_BASE}games/${targetGameId}/report`);
      const reportData = await reportDataRes.json();
      gameData.questions = reportData.questions || [];
      
      console.log(`📋 Retrieved ${gameData.questions.length} questions with full data`);
      
      // Get all answers and votes for played questions
      for (let i = 0; i < playedQuestions.length; i++) {
        const questionNumber = playedQuestions[i]; // Sequential number like "001", "002"
        
        // Get answers for this question
        const answersRes = await fetch(`${API_BASE}games/${targetGameId}/answers?questionNumber=${questionNumber}`);
        const answersData = await answersRes.json();
        const questionAnswers = answersData.answers || [];
        
        // Get votes for this question
        const votesRes = await fetch(`${API_BASE}games/${targetGameId}/votes?questionNumber=${questionNumber}`);
        const votesData = await votesRes.json();
        const questionVotes = votesData.votes || [];
        
        gameData.allAnswers.push({
          questionNumber,
          answers: questionAnswers
        });
        
        gameData.allVotes.push({
          questionNumber,
          votes: questionVotes
        });
        
        // Fetch AI summary for this question
        try {
          // Check if we should include debug info based on current game's debug mode
          const gameStateRes = await fetch(`${API_BASE}games/${targetGameId}/state`);
          const gameStateData = gameStateRes.ok ? await gameStateRes.json() : {};
          const debugMode = gameStateData.debugMode || false;
          
          const debugParam = debugMode ? '?debug=true' : '';
          const summaryRes = await fetch(`${API_BASE}games/${targetGameId}/summary/${questionNumber}${debugParam}`);
          if (summaryRes.ok) {
            const summary = await summaryRes.json();
            gameData.aiSummaries[questionNumber] = summary;
          }
        } catch (error) {
          console.log(`Could not fetch AI summary for question ${questionNumber}:`, error);
        }
      }

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
                  <h2 className="parallax__title">{currentGameType === 'trivia' ? 'Trivia' : 'Call & Answer'}</h2>
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
              <button className="btn-primary btn-large welcome-btn" onClick={handleWelcomeNewGame}>
                🎯 Start New Game
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


  // Render the reports modal if it's being shown
  if (showReportsModal) {
    return (
      <div className="new-game-overlay">
        <div className="new-game-dialog reports-modal">
          <h2>{reportsModalMode === 'select' ? 'Select Game' : 'Game Reports'}</h2>
          <div className="dialog-content">
            <div className="games-list">
              {gamesList.length === 0 ? (
                <p>No games found.</p>
              ) : (
                gamesList.map((game, index) => (
                  <div 
                    key={game.gameId} 
                    className={`game-list-item ${game.gameId === gameId ? 'current-game' : ''}`}
                    onClick={() => {
                      if (reportsModalMode === 'select') {
                        selectGameFromHistory(game.gameId, game.eventTitle);
                      } else {
                        generateReportForGame(game.gameId, game.eventTitle);
                      }
                    }}
                  >
                    <div className="game-header">
                      <div className="game-title">
                        {game.eventTitle}
                        {game.gameId === gameId && <span className="current-badge">Current Game</span>}
                      </div>
                      <div className="game-id">Game ID: {game.gameId}</div>
                    </div>
                    <div className="game-date">
                      Last played: {new Date(game.lastPlayedAt).toLocaleDateString('en-US', {
                        weekday: 'short',
                        year: 'numeric', 
                        month: 'short', 
                        day: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit'
                      })}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
          
          <div className="dialog-actions">
            <button 
              className="btn-secondary" 
              onClick={() => {
                setShowReportsModal(false);
                if (reportsModalMode === 'select' && gameState === 'waiting' && lessonNumber === 0) {
                  setShowWelcomeScreen(true);
                }
              }}
            >
              {reportsModalMode === 'select' ? 'Cancel' : 'Close'}
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
          <h2>{gameState === 'waiting' && lessonNumber === 0 ? 'Create Game' : 'Start New Game'}</h2>
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
                <label>Categories Preview:</label>
                <div className="categories-preview">
                  {categories.map(category => (
                    <div key={category.name} className="category-preview-item">
                      <span className="category-name">{category.name}</span>
                      <span className="category-count">({category.questionCount})</span>
                    </div>
                  ))}
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
              <label>AI Context (Optional):</label>
              <textarea
                value={gameAiContext}
                onChange={(e) => setGameAiContext(e.target.value)}
                placeholder="Describe your project, team context, or goals to help AI provide more relevant analysis (e.g., 'Building a new application to support engineering learning' or 'Developer advocacy team in healthcare sector')..."
                className="dialog-textarea"
                rows="3"
              />
              <small className="dialog-help-text">
                This helps AI provide more contextual analysis during the session.
              </small>
            </div>
          </div>
          
          <div className="dialog-actions">
            <button 
              className="btn-secondary" 
              onClick={() => {
                setShowNewGameDialog(false);
                if (gameState === 'waiting' && lessonNumber === 0) {
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
              Start New Game
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
          <ol>
            <li><strong>Read the Lesson:</strong> Each round presents a lesson learned from professionals in various fields.</li>
            <li><strong>Apply the Lesson:</strong> Players write how they would adapt this lesson to their own work, project, or team.</li>
            <li><strong>Vote for Best Applications:</strong> Everyone votes on which applications would be most valuable to implement.</li>
            <li><strong>Collaborative Learning:</strong> Share insights and learn from each other's perspectives.</li>
          </ol>
          <h4>Tips</h4>
          <ul>
            <li>Be specific about your context and situation</li>
            <li>Think about practical implementation steps</li>
            <li>Consider potential challenges and solutions</li>
            <li>Vote for applications that inspire your own work</li>
          </ul>
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
                className={`btn-${gameDebugMode ? 'primary' : 'secondary'}`} 
                onClick={handleToggleGameDebugMode}
                title="Toggle debug mode to show AI prompts in results"
              >
                🐛 Debug {gameDebugMode ? 'ON' : 'OFF'}
              </button>
              <button className="btn-secondary" onClick={handleViewReports}>
                View Reports
              </button>
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
      
      <div className={`outer-container ${!qrSidebarVisible ? 'qr-hidden' : ''} ${instructionsVisible ? 'instructions-open' : ''}`}>
      
      <div className="game-host-container">
        <div className="parallax">
          <section className="parallax__header">
            <div className="parallax__visuals">
              <div className="parallax__black-line-overflow"></div>
              <div data-parallax-layers className="parallax__layers">
                <img src="https://cdn.prod.website-files.com/671752cd4027f01b1b8f1c7f/6717795be09b462b2e8ebf71_osmo-parallax-layer-3.webp" loading="eager" width="800" data-parallax-layer="1" alt="" className="parallax__layer-img" />
                <img src="https://cdn.prod.website-files.com/671752cd4027f01b1b8f1c7f/6717795b4d5ac529e7d3a562_osmo-parallax-layer-2.webp" loading="eager" width="800" data-parallax-layer="2" alt="" className="parallax__layer-img" />
                <div data-parallax-layer="3" className="parallax__layer-title">
                  <h2 className="parallax__title">{currentGameType === 'trivia' ? 'Trivia' : 'Call & Answer'}</h2>
                </div>
                <img src="https://cdn.prod.website-files.com/671752cd4027f01b1b8f1c7f/6717795bb5aceca85011ad83_osmo-parallax-layer-1.webp" loading="eager" width="800" data-parallax-layer="4" alt="" className="parallax__layer-img" />
              </div>
              <div className="parallax__fade"></div>
            </div>
          </section>
        </div>

      <div className="players-section">
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
          {calculatePlayerRankings(players)
            .map((player) => (
            <div key={player.name} className="player-card">
              <div className="player-name">
                {player.rank === 1 ? '🏆' : player.rank === 2 ? '🥈' : player.rank === 3 ? '🥉' : '📍'} 
                {player.name}
              </div>
              <div className="player-score">{player.score || 0} pts</div>
              {gameState === 'question' && (
                <div className={`answer-status ${playersWhoAnswered.includes(player.name) ? 'answered' : 'waiting'}`}>
                  {playersWhoAnswered.includes(player.name) ? '✓' : '⏱️'}
                </div>
              )}
              {gameState === 'voting' && (
                <div className={`answer-status ${playersWhoVoted.includes(player.name) ? 'answered' : 'waiting'}`}>
                  {playersWhoVoted.includes(player.name) ? '✓' : '⏱️'}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      <div className="game-content">
        {gameState === 'waiting' && (
          <div className="waiting-state">
            <h2>Waiting for players to join...</h2>
            {selectedSetId && (
              <button 
                className="btn-primary btn-large" 
                onClick={() => { closeAllSidePanels(); handleNextQuestion(); }}
                disabled={players.length === 0}
              >
                Start First Question
              </button>
            )}
            {!selectedSetId && (
              <p>Please select a question set in the sidebar to begin.</p>
            )}
          </div>
        )}

        {gameState === 'question' && questions.length > 0 && (
          <div className="question-state">
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
              {questions[0].title || questions[0].question}
            </div>
            {!lessonExpanded && questions[0].detail && currentGameType === 'call-and-answer' && (
              <div 
                className="lesson-detail clickable-lesson" 
                onClick={() => setLessonExpanded(true)}
                title="Click to expand"
              >
                {questions[0].detail}
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
                onClick={() => { closeAllSidePanels(); handleNextQuestion(); }}
              >
                Next Question
              </button>
            </div>
          </div>
        )}

        {gameState === 'voting' && (
          <div className="voting-state">
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
            <button 
              className="btn-primary" 
              onClick={() => { closeAllSidePanels(); handleShowResults(); }}
            >
              Show Results
            </button>
          </div>
        )}

        {gameState === 'results' && (
          <div className="results-state">
            <h2>🏆 Results</h2>
            
            {currentGameType === 'trivia' ? (
              <div className="trivia-results-display">
                <div className="trivia-question-recap">
                  <h3>{questions[0]?.title}</h3>
                </div>
                
                <div className="trivia-options-results">
                  {['optionA', 'optionB', 'optionC', 'optionD', 'optionE', 'optionF']
                    .filter(key => questions[0]?.[key])
                    .map((key, index) => {
                      const optionLetter = String.fromCharCode(65 + index);
                      const isCorrect = questions[0]?.correctAnswer === questions[0]?.[key];
                      
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
                    const isCorrect = questions[0]?.correctAnswer === questions[0]?.[`option${answer.answer}`];
                    const points = isCorrect ? (questions[0]?.points || 10) : 0;
                    const player = players.find(p => p.name === answer.name);
                    
                    return (
                      <div key={idx} className={`trivia-player-result ${isCorrect ? 'correct' : 'incorrect'}`}>
                        <span className="player-name">{answer.name}</span>
                        <span className="player-answer">Answer: {answer.answer}</span>
                        <span className="player-points">{isCorrect ? '✓' : '✗'} {points} pts</span>
                        <span className="player-total">Total: {player?.score || 0} pts</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : (
              <div className="results-display">
                {answers.map((answer, idx) => {
                // 🎯 RESULTS DISPLAY: Calculate points for THIS answer from THIS question only
                console.log(`🖥️ RENDERING RESULT FOR ANSWER ${idx}: "${answer.answer}" by ${answer.name}`);
                console.log(`📊 Using currentQuestionVotes (length: ${currentQuestionVotes.length}):`, currentQuestionVotes);
                
                const answerVotes = currentQuestionVotes.filter(v => v.answerIndex === idx);
                console.log(`🗳️ Votes for answer ${idx}:`, answerVotes);
                
                const totalPoints = answerVotes.reduce((sum, vote) => {
                  let points = 0;
                  if (vote.rank === 1) points = 3;
                  else if (vote.rank === 2) points = 2;
                  else if (vote.rank === 3) points = 1;
                  console.log(`  📈 Vote from ${vote.voter} (rank ${vote.rank}): +${points} points`);
                  return sum + points;
                }, 0);
                
                console.log(`💰 TOTAL POINTS FOR ANSWER ${idx}: ${totalPoints}`);
                
                // Find the player's current total score from backend
                const player = players.find(p => p.name === answer.name);
                const playerTotalScore = player?.score || 0;
                console.log(`👤 Player ${answer.name} total score from backend: ${playerTotalScore}`);
                console.log(`🧮 This means previous score was: ${playerTotalScore - totalPoints}`);
                
                const previousScore = playerTotalScore - totalPoints;
                
                return (
                  <div key={idx} className={`result-item ${totalPoints > 0 ? 'scored' : ''}`}>
                    <div className="result-player-header">
                      <div className="result-player-name">{answer.name}</div>
                      <div className="result-points">
                        <span className="points-this-round">+{totalPoints} pts this round</span>
                        <span className="points-total">Total: {playerTotalScore} pts</span>
                      </div>
                    </div>
                    <div className="result-answer">"{answer.answer}"</div>
                    <div className="result-breakdown">
                      {answerVotes.map((vote, vIdx) => (
                        <span key={vIdx} className={`vote-badge rank-${vote.rank}`}>
                          {vote.rank === 1 ? '🥇' : vote.rank === 2 ? '🥈' : '🥉'}
                        </span>
                      ))}
                    </div>
                  </div>
                );
              })}
              </div>
            )}
            
            <div className="results-actions">
              <button className="btn-primary" onClick={() => { closeAllSidePanels(); handleNextQuestion(); }}>
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
                  </div>
                  
                  <div className="ai-insights-body">
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
                    
                    {/* Debug Prompt Display */}
                    {gameDebugMode && currentAIInsights.prompt && (
                      <div className="ai-insights-section-item debug-section">
                        <h4>🐛 Debug: AI Prompt</h4>
                        <div className="debug-prompt-content">{currentAIInsights.prompt}</div>
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
              {questions[0].title || questions[0].question}
            </div>
            {questions[0].detail && (
              <div className="expanded-lesson-detail">
                {questions[0].detail}
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

  // Calculate winners for each question
  const getQuestionWinners = (questionNumber) => {
    const questionAnswers = allAnswers.find(qa => qa.questionNumber === questionNumber)?.answers || [];
    const questionVotes = allVotes.find(qv => qv.questionNumber === questionNumber)?.votes || [];

    // Calculate points for each answer
    const answerPoints = {};
    questionAnswers.forEach((answer, idx) => {
      answerPoints[idx] = 0;
    });

    questionVotes.forEach(vote => {
      const points = vote.rank === 1 ? 3 : vote.rank === 2 ? 2 : 1;
      if (answerPoints[vote.answerIndex] !== undefined) {
        answerPoints[vote.answerIndex] += points;
      }
    });

    // Find winning answer(s)
    const maxPoints = Math.max(...Object.values(answerPoints));
    const winners = questionAnswers.filter((_, idx) => answerPoints[idx] === maxPoints);

    return { winners, answerPoints, questionAnswers };
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
          const { winners, answerPoints, questionAnswers } = getQuestionWinners(question.id);
          
          return (
            <div key={question.id} className="report-question">
              <div className="report-question-header">
                <h3 className="report-lesson-heading">
                  Lesson {qIdx + 1} - {question.title || question.question}
                </h3>
                <div className="field-badge">{question.field || question.category}</div>
              </div>
              
              {question.detail && (
                <div className="report-lesson-detail">
                  {question.detail}
                </div>
              )}
              
              {/* AI Summary for this question */}
              {aiSummaries && aiSummaries[question.id] && (
                <div className="report-ai-summary">
                  <h4>🤖 AI Analysis</h4>
                  
                  {/* Debug Prompt Display */}
                  {aiSummaries[question.id].debugPrompt && (
                    <div className="debug-prompt">
                      <div className="debug-prompt-header">🐛 DEBUG: AI Prompt</div>
                      <div className="debug-prompt-content">{aiSummaries[question.id].debugPrompt}</div>
                    </div>
                  )}
                  
                  <div className="report-ai-content">
                    {/* Summary */}
                    <div className="report-ai-text">
                      <h5>Summary</h5>
                      <p>{aiSummaries[question.id].summaryText}</p>
                    </div>
                    
                    {/* Conversation Starters */}
                    {aiSummaries[question.id].discussionQuestions && (
                      <div className="report-ai-discussion">
                        <h5>Conversation Starters</h5>
                        <ul>
                          {(Array.isArray(aiSummaries[question.id].discussionQuestions) 
                            ? aiSummaries[question.id].discussionQuestions 
                            : []
                          ).map((question, idx) => (
                            <li key={idx}>{question}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                    
                    {/* Next Steps */}
                    {aiSummaries[question.id].nextSteps && (
                      <div className="report-ai-steps">
                        <h5>Next Steps</h5>
                        <ul>
                          {(Array.isArray(aiSummaries[question.id].nextSteps) 
                            ? aiSummaries[question.id].nextSteps 
                            : []
                          ).map((step, idx) => (
                            <li key={idx}>{step}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                </div>
              )}
              
              <div className="report-answers">
                <h4>Player Applications:</h4>
                {questionAnswers.map((answer, aIdx) => {
                  const isWinner = winners.some(w => w.name === answer.name);
                  const points = answerPoints[aIdx] || 0;
                  
                  return (
                    <div key={aIdx} className={`report-answer ${isWinner ? 'winner' : ''}`}>
                      {isWinner && <div className="winner-badge">🏆 Best Application</div>}
                      <div className="answer-text">"{answer.answer}"</div>
                      <div className="answer-meta">
                        <span className="answer-author">by {answer.name}</span>
                        <span className="answer-points">{points} point{points !== 1 ? 's' : ''}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
        
        <div className="report-final-scores">
          <h3>Final Scores</h3>
          <div className="score-grid">
            {(() => {
              const rankedPlayers = calculatePlayerRankings(players);
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