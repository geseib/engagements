import React, { useState, useEffect } from 'react';
import { authFetch } from '../auth/authFetch';
import Icon from './Icon';
import SetImageBadge from './SetImageBadge';
import { gameTypeMeta } from '../config/gameTypes';

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
      const response = await authFetch(`${API_BASE}admin/question-sets`);
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
      
      // Create the game.
      //
      // authFetch, NOT fetch, and it is deliberately ahead of the backend.
      // `POST /games` is still public today; this call site is being taught to
      // send a token FIRST because buildspec-dev.yml:49-58 deploys the API
      // before the frontend and cached bundles outlive the build — so a route
      // that starts demanding a token before its callers send one 401s the
      // quick-start path for everyone still holding the old JS. A token on a
      // public route is ignored, so this is a no-op until the authorizer lands
      // and correct the moment it does.
      //
      // The token always exists here: QuickstartMenu only ever renders from
      // GameHostPage (GameHostPage.jsx:3118), which sits behind
      // ProtectedRoute (App.jsx:176), which requires `hosts` or `admins`.
      const createResponse = await authFetch(`${API_BASE}games`, {
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
          // `triviaTimer` used to be sent here. It was deleted: create-game.js:9's
          // destructure is a whitelist that never named it, nothing anywhere
          // reads a timer, and no countdown exists on any screen.
          // No `personaId` on purpose. Quickstart's whole premise is zero
          // decisions, and adding a voice picker here would be one more. The
          // set's own persona still applies — resolvePersona() falls through
          // host → set → context → inferred — so a set that has been given a
          // voice keeps it, and everything else gets the adaptive default,
          // which is the designed behaviour rather than a gap.
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

  // Clicking the scrim already closed this; Escape did not, so a keyboard user
  // who opened it had no way back out at all. Not gated on `creating` — the
  // create call is already in flight by then and the overlay closes itself on
  // success, so blocking the key would only trap someone whose request failed.
  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.key === 'Escape') onClose?.();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  if (loading) {
    return (
      <div className="quickstart-overlay" data-theme="dark">
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
    <div className="quickstart-overlay" data-theme="dark" onClick={onClose}>
      <div
        className="quickstart-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="quickstart-heading"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="quickstart-header">
          <div className="quickstart-title">
            <p className="quickstart-kicker">Quick start</p>
            <h2 id="quickstart-heading">
              <Icon name="Lightning" weight="fill" size={18} color="var(--primary)" /> Pick a set and go
            </h2>
            <p>Creates the session and starts it in one press. Nothing else to fill in.</p>
          </div>

          {/* The glyph is decorative; the name is on the button. Without it a
              screen reader announced this control as "multiplication sign". */}
          <button
            type="button"
            className="quickstart-close"
            onClick={onClose}
            aria-label="Close quick start"
          >
            <span aria-hidden="true">×</span>
          </button>
        </div>

        <div className="quickstart-content">
          {totalQuickstartSets === 0 ? (
            <div className="no-quickstart-sets">
              <h3>No Quickstart Sets Available</h3>
              <p>To enable quickstart, go to Admin <Icon name="ArrowRight" weight="bold" size={16} color="currentColor" /> Question Sets and check the "Quickstart" box for your desired question sets.</p>
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
                      <Icon
                        name={gameTypeMeta(type).icon}
                        weight="duotone"
                        size={18}
                        color={gameTypeMeta(type).accent}
                      />{' '}
                      {gameTypeMeta(type).label}
                      <span className="set-count">({sets.length} available)</span>
                    </h3>
                  </div>

                  {/* The nav gutter is RESERVED whether or not this format
                      pages. Without it a five-set format's cards sat inside a
                      grid 104px narrower than a two-set format's, so the same
                      sheet drew two different card widths. */}
                  <div className="quickstart-sets-container">
                    {showNavigation ? (
                      <button
                        type="button"
                        className="quickstart-nav-btn prev"
                        onClick={() => prevPage(type)}
                        aria-label={`Previous ${gameTypeMeta(type).label} sets`}
                      >
                        <Icon name="ArrowLeft" weight="bold" size={16} color="currentColor" />
                      </button>
                    ) : (
                      <span className="quickstart-nav-gap" aria-hidden="true" />
                    )}

                    <div className="quickstart-sets-grid">
                      {/* A BUTTON, NOT A DIV. Every one of these was a <div>
                          with an onClick: no tab stop, no Enter, no role, so
                          the entire quick-start path was mouse-only. */}
                      {visibleSets.map(set => (
                        <button
                          type="button"
                          key={set.id}
                          className="quickstart-set-card"
                          disabled={creating}
                          onClick={() => !creating && createQuickGame(set)}
                        >
                          <div className="quickstart-set-info">
                            <h4>{set.name}<SetImageBadge hasImages={set.hasImages} /></h4>
                            <p className="quickstart-set-description">
                              {set.description || 'Ready to play'}
                            </p>
                            <div className="quickstart-set-stats">
                              <span>{set.totalQuestions} questions</span>
                              <span>{set.categoryCount} categories</span>
                            </div>
                          </div>
                          <span className="quickstart-play-icon">
                            {creating
                              ? <Icon name="Timer" weight="bold" size={20} color="var(--muted)" />
                              : <Icon name="PlayCircle" weight="fill" size={20} color="var(--primary)" />}
                          </span>
                        </button>
                      ))}
                    </div>

                    {showNavigation ? (
                      <button
                        type="button"
                        className="quickstart-nav-btn next"
                        onClick={() => nextPage(type)}
                        aria-label={`More ${gameTypeMeta(type).label} sets`}
                      >
                        <Icon name="ArrowRight" weight="bold" size={16} color="currentColor" />
                      </button>
                    ) : (
                      <span className="quickstart-nav-gap" aria-hidden="true" />
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