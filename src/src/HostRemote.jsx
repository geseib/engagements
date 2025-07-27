import React, { useState, useEffect } from 'react';
import { QRCodeCanvas as QRCode } from 'qrcode.react';
import './HostRemote.css';

const API_BASE = window.API_BASE;

function HostRemote() {
  const [gameId, setGameId] = useState('');
  const [gameState, setGameState] = useState(null);
  const [isConnected, setIsConnected] = useState(false);
  const [hostWindow, setHostWindow] = useState(null);

  // Extract game ID from URL or allow manual entry
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const gameIdFromUrl = urlParams.get('gameId');
    if (gameIdFromUrl) {
      setGameId(gameIdFromUrl);
    }
  }, []);

  // Poll for game state when we have a game ID
  useEffect(() => {
    if (!gameId) return;

    const pollGameState = async () => {
      try {
        const response = await fetch(`${API_BASE}games/${gameId}?role=host`);
        if (response.ok) {
          const data = await response.json();
          setGameState(data);
          setIsConnected(true);
        } else {
          setIsConnected(false);
        }
      } catch (error) {
        console.error('Error fetching game state:', error);
        setIsConnected(false);
      }
    };

    pollGameState();
    const interval = setInterval(pollGameState, 2000);
    return () => clearInterval(interval);
  }, [gameId]);

  // Open host page in new window/tab
  const openHostPage = () => {
    const hostUrl = `${window.location.origin}/host?gameId=${gameId}`;
    const newWindow = window.open(hostUrl, '_blank', 'width=1200,height=800');
    setHostWindow(newWindow);
  };

  // Control functions that send messages to host window
  const sendCommandToHost = (command, data = {}) => {
    if (hostWindow && !hostWindow.closed) {
      hostWindow.postMessage({
        type: 'REMOTE_COMMAND',
        command,
        data,
        gameId
      }, window.location.origin);
    } else {
      alert('Host page is not open. Please open the host page first.');
    }
  };

  // Remote control functions
  const scrollHostToTop = () => sendCommandToHost('SCROLL_TO_TOP');
  const scrollHostToBottom = () => sendCommandToHost('SCROLL_TO_BOTTOM');
  const scrollHostToResults = () => sendCommandToHost('SCROLL_TO_RESULTS');
  const toggleBigScreen = () => sendCommandToHost('TOGGLE_BIG_SCREEN');
  const nextQuestion = () => sendCommandToHost('NEXT_QUESTION');
  const startVoting = () => sendCommandToHost('START_VOTING');
  const showResults = () => sendCommandToHost('SHOW_RESULTS');

  const playerJoinUrl = `${window.location.origin}/play?gameId=${gameId}`;

  return (
    <div className="host-remote">
      <div className="remote-header">
        <h1>🎮 Host Remote Control</h1>
        <div className="connection-status">
          <span className={`status-indicator ${isConnected ? 'connected' : 'disconnected'}`}>
            {isConnected ? '🟢 Connected' : '🔴 Disconnected'}
          </span>
        </div>
      </div>

      {!gameId ? (
        <div className="game-id-input">
          <h2>Enter Game ID</h2>
          <input
            type="text"
            placeholder="Enter Game ID..."
            value={gameId}
            onChange={(e) => setGameId(e.target.value.toUpperCase())}
            style={{ fontSize: '18px', padding: '12px', width: '200px', textAlign: 'center' }}
          />
        </div>
      ) : (
        <div className="remote-controls">
          <div className="game-info">
            <h2>Game: {gameId}</h2>
            {gameState && (
              <div className="game-details">
                <p><strong>Title:</strong> {gameState.eventTitle}</p>
                <p><strong>Players:</strong> {gameState.playerCount || 0}</p>
                <p><strong>State:</strong> {gameState.currentState}</p>
                <p><strong>Question:</strong> {gameState.currentQuestionNumber || 0}</p>
              </div>
            )}
          </div>

          <div className="host-page-control">
            <button className="btn-primary large" onClick={openHostPage}>
              📺 Open Host Page
            </button>
            <p className="help-text">Opens the main host page in a new window that you can control from here</p>
          </div>

          <div className="player-join-section">
            <h3>Player Join</h3>
            <div className="qr-code-container">
              <QRCode 
                value={playerJoinUrl} 
                size={200}
                level="M"
                includeMargin={true}
              />
            </div>
            <div className="join-url">
              <p><strong>Join URL:</strong></p>
              <code>{playerJoinUrl}</code>
              <button 
                className="btn-secondary"
                onClick={() => navigator.clipboard.writeText(playerJoinUrl)}
              >
                📋 Copy
              </button>
            </div>
          </div>

          <div className="scroll-controls">
            <h3>Screen Control</h3>
            <div className="control-grid">
              <button className="btn-action" onClick={scrollHostToTop}>
                ⬆️ Scroll to Top
              </button>
              <button className="btn-action" onClick={scrollHostToResults}>
                📊 Scroll to Results
              </button>
              <button className="btn-action" onClick={scrollHostToBottom}>
                ⬇️ Scroll to Bottom
              </button>
              <button className="btn-action" onClick={toggleBigScreen}>
                🖥️ Toggle Big Screen
              </button>
            </div>
          </div>

          <div className="game-controls">
            <h3>Game Control</h3>
            <div className="control-grid">
              <button className="btn-primary" onClick={nextQuestion}>
                ➡️ Next Question
              </button>
              <button className="btn-primary" onClick={startVoting}>
                🗳️ Start Voting
              </button>
              <button className="btn-primary" onClick={showResults}>
                📈 Show Results
              </button>
            </div>
          </div>

          <div className="change-game">
            <button 
              className="btn-secondary"
              onClick={() => setGameId('')}
            >
              🔄 Change Game
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default HostRemote;