import React, { useState, useEffect } from 'react';

const API_BASE = window.API_BASE;

const QuickstartMenu = ({ onGameCreated, onClose }) => {
  const [quickstartSets, setQuickstartSets] = useState({
    'call-and-answer': [],
    'trivia': [],
    'wavelength': [],
    'poll': []
  });
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [currentPage, setCurrentPage] = useState({
    'call-and-answer': 0,
    'trivia': 0,
    'wavelength': 0,
    'poll': 0
  });

  const SETS_PER_PAGE = 4;

  useEffect(() => {
    fetchQuickstartSets();
  }, []);

  const fetchQuickstartSets = async () => {
    try {
      setLoading(true);
      const response = await fetch(`${API_BASE}admin/question-sets`);
      const data = await response.json();
      
      // Filter and group quickstart-enabled sets by engagement type
      const quickstartData = {
        'call-and-answer': [],
        'trivia': [],
        'wavelength': [],
        'poll': []
      };

      (data.questionSets || []).forEach(set => {
        if (set.quickstart && set.active) {
          const type = set.engagementType || 'call-and-answer';
          if (quickstartData[type]) {
            quickstartData[type].push(set);
          }
        }
      });

      setQuickstartSets(quickstartData);
    } catch (error) {
      console.error('Error fetching quickstart sets:', error);
    } finally {
      setLoading(false);
    }
  };


  const createQuickGame = async (questionSet) => {
    if (creating) return;
    
    setCreating(true);
    try {
      console.log(`🚀 Creating quickstart game with set: ${questionSet.name}`);
      
      // Generate automatic title
      const quickTitle = `Quick ${questionSet.engagementType === 'call-and-answer' ? 'Lessons' : 
                          questionSet.engagementType === 'trivia' ? 'Trivia' :
                          questionSet.engagementType === 'wavelength' ? 'Wavelength' :
                          'Poll'}: ${questionSet.name}`;
      
      // Create the game
      const createResponse = await fetch(`${API_BASE}games`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          eventTitle: quickTitle,
          engagementInfo: `Quick start session using ${questionSet.name}`,
          aiContext: null,
          gameType: questionSet.engagementType,
          questionSetId: questionSet.id,
          randomizeQuestions: true,
          selectedCategories: [], // Use all categories
          triviaTimer: questionSet.engagementType === 'trivia' ? 30 : null
        })
      });

      if (createResponse.ok) {
        const gameData = await createResponse.json();
        console.log(`✅ Quickstart game created:`, gameData);
        
        // Start the game immediately
        const startResponse = await fetch(`${API_BASE}games/${gameData.gameId}/start`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' }
        });

        if (startResponse.ok) {
          console.log(`✅ Quickstart game started: ${gameData.gameId}`);
          
          // Store the event title in localStorage
          localStorage.setItem(`game_${gameData.gameId}_title`, quickTitle);
          
          // Update the URL
          const url = new URL(window.location);
          url.searchParams.set('gameId', gameData.gameId);
          url.searchParams.set('eventTitle', encodeURIComponent(quickTitle));
          window.history.replaceState(null, '', url);
          
          // Notify parent component
          onGameCreated({
            gameId: gameData.gameId,
            eventTitle: quickTitle,
            questionSetId: questionSet.id,
            gameType: questionSet.engagementType
          });
          
          onClose();
        } else {
          throw new Error('Failed to start game');
        }
      } else {
        const errorData = await createResponse.json();
        throw new Error(errorData.error || 'Failed to create game');
      }
    } catch (error) {
      console.error('Failed to create quickstart game:', error);
      alert(`Failed to create quickstart game: ${error.message}`);
    } finally {
      setCreating(false);
    }
  };

  const nextPage = (type) => {
    const maxPage = Math.max(0, Math.ceil(quickstartSets[type].length / SETS_PER_PAGE) - 1);
    setCurrentPage(prev => ({
      ...prev,
      [type]: prev[type] >= maxPage ? 0 : prev[type] + 1 // Circular navigation
    }));
  };

  const prevPage = (type) => {
    const maxPage = Math.max(0, Math.ceil(quickstartSets[type].length / SETS_PER_PAGE) - 1);
    setCurrentPage(prev => ({
      ...prev,
      [type]: prev[type] <= 0 ? maxPage : prev[type] - 1 // Circular navigation
    }));
  };

  const getVisibleSets = (type) => {
    const sets = quickstartSets[type];
    const startIdx = currentPage[type] * SETS_PER_PAGE;
    return sets.slice(startIdx, startIdx + SETS_PER_PAGE);
  };

  const getTypeIcon = (type) => {
    switch (type) {
      case 'call-and-answer': return '💬';
      case 'trivia': return '🧠';
      case 'wavelength': return '🌊';
      case 'poll': return '📊';
      default: return '❓';
    }
  };

  const getTypeDisplayName = (type) => {
    switch (type) {
      case 'call-and-answer': return 'Call & Answer';
      case 'trivia': return 'Trivia';
      case 'wavelength': return 'Wavelength';
      case 'poll': return 'Poll';
      default: return type;
    }
  };

  if (loading) {
    return (
      <div className="quickstart-overlay">
        <div className="quickstart-modal">
          <div className="quickstart-loading">
            <div className="loading-spinner"></div>
            <p>Loading quickstart options...</p>
          </div>
        </div>
      </div>
    );
  }

  const totalQuickstartSets = Object.values(quickstartSets).reduce((sum, sets) => sum + sets.length, 0);

  return (
    <div className="quickstart-overlay" onClick={onClose}>
      <div className="quickstart-modal" onClick={(e) => e.stopPropagation()}>
        <div className="quickstart-header">
          <div className="quickstart-title">
            <h2>⚡ Quickstart Menu</h2>
            <p>Create and start a game instantly with pre-configured question sets</p>
          </div>
          
          
          <button className="quickstart-close" onClick={onClose}>×</button>
        </div>

        <div className="quickstart-content">
          {totalQuickstartSets === 0 ? (
            <div className="no-quickstart-sets">
              <h3>No Quickstart Sets Available</h3>
              <p>To enable quickstart, go to Admin → Question Sets and check the "⚡ Quickstart" box for your desired question sets.</p>
            </div>
          ) : (
            Object.entries(quickstartSets).map(([type, sets]) => {
              if (sets.length === 0) return null;
              
              const visibleSets = getVisibleSets(type);
              const totalPages = Math.ceil(sets.length / SETS_PER_PAGE);
              const showNavigation = sets.length > SETS_PER_PAGE;

              return (
                <div key={type} className="quickstart-section">
                  <div className="quickstart-section-header">
                    <h3>
                      {getTypeIcon(type)} {getTypeDisplayName(type)}
                      <span className="set-count">({sets.length} available)</span>
                    </h3>
                  </div>

                  <div className="quickstart-sets-container">
                    {showNavigation && (
                      <button 
                        className="quickstart-nav-btn prev" 
                        onClick={() => prevPage(type)}
                        title="Previous sets"
                      >
                        ←
                      </button>
                    )}

                    <div className="quickstart-sets-grid">
                      {visibleSets.map(set => (
                        <div 
                          key={set.id} 
                          className={`quickstart-set-card ${creating ? 'disabled' : ''}`}
                          onClick={() => !creating && createQuickGame(set)}
                        >
                          <div className="quickstart-set-info">
                            <h4>{set.name}</h4>
                            <p className="quickstart-set-description">
                              {set.description || 'Ready to play'}
                            </p>
                            <div className="quickstart-set-stats">
                              <span>{set.totalQuestions} questions</span>
                              <span>{set.categoryCount} categories</span>
                            </div>
                          </div>
                          <div className="quickstart-play-icon">
                            {creating ? '⏳' : '▶️'}
                          </div>
                        </div>
                      ))}
                    </div>

                    {showNavigation && (
                      <button 
                        className="quickstart-nav-btn next" 
                        onClick={() => nextPage(type)}
                        title="Next sets"
                      >
                        →
                      </button>
                    )}
                  </div>

                  {showNavigation && (
                    <div className="quickstart-pagination">
                      <span>Page {currentPage[type] + 1} of {totalPages}</span>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>

        {creating && (
          <div className="quickstart-creating-overlay">
            <div className="creating-message">
              <div className="loading-spinner"></div>
              <p>Creating and starting your quickstart game...</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default QuickstartMenu;