import React, { useState, useEffect } from 'react';

const API_BASE = window.API_BASE;

function CreateGameForm({ onCancel, onSuccess }) {
  const [formData, setFormData] = useState({
    title: '',
    questionSetId: '',
    gameType: 'call-and-answer',
    randomize: true,
    engagementInfo: '',
    aiInfo: '',
    visibility: 'public',
    accessCode: ''
  });
  const [questionSets, setQuestionSets] = useState([]);
  const [categories, setCategories] = useState([]);
  const [selectedCategories, setSelectedCategories] = useState([]);
  const [loadingCategories, setLoadingCategories] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [gameUrl, setGameUrl] = useState('');

  // Load question sets filtered by game type
  useEffect(() => {
    const loadQuestionSets = async () => {
      try {
        const response = await fetch(`${API_BASE}question-sets`);
        if (response.ok) {
          const data = await response.json();
          console.log('Question sets response:', data);
          // Handle if the response is wrapped in an object
          const allSets = Array.isArray(data) ? data : (data.sets || data.questionSets || []);
          
          // Filter sets by game type
          const filteredSets = allSets.filter(set => {
            const setType = set.type || set.gameType || set.engagementType || set.questionSetType || 'call-and-answer';
            return setType === formData.gameType;
          });
          
          console.log(`Filtered ${allSets.length} sets to ${filteredSets.length} for game type: ${formData.gameType}`);
          setQuestionSets(filteredSets);
        } else {
          console.error('Failed to load question sets:', response.status);
          setQuestionSets([]);
        }
      } catch (error) {
        console.error('Failed to load question sets:', error);
        setQuestionSets([]);
      } finally {
        setLoading(false);
      }
    };

    loadQuestionSets();
  }, [formData.gameType]); // Reload when game type changes

  // Load categories when question set changes
  useEffect(() => {
    const loadCategories = async () => {
      console.log(`🔍 Category Effect Triggered - questionSetId: ${formData.questionSetId}, questionSets.length: ${questionSets.length}`);
      
      if (!formData.questionSetId || formData.questionSetId === '') {
        console.log('❌ No question set ID, skipping category load');
        setCategories([]);
        setSelectedCategories([]);
        return;
      }

      console.log(`🔍 Loading categories for question set: ${formData.questionSetId}`);
      setLoadingCategories(true);
      try {
        const url = `${API_BASE}question-sets/${formData.questionSetId}/categories`;
        console.log(`📡 Fetching from: ${url}`);
        const response = await fetch(url);
        console.log(`📡 Response status: ${response.status}`);
        
        if (response.ok) {
          const data = await response.json();
          console.log('📊 Categories response:', data);
          // Handle if the response is wrapped in an object
          const cats = Array.isArray(data) ? data : (data.categories || []);
          console.log(`✅ Loaded ${cats.length} categories:`, cats.map(c => c.name));
          setCategories(cats);
          setSelectedCategories(cats.map(c => c.id || c.name)); // Select all categories by default
        } else {
          console.error('❌ Failed to load categories:', response.status, response.statusText);
          setCategories([]);
        }
      } catch (error) {
        console.error('❌ Failed to load categories:', error);
        setCategories([]);
      } finally {
        setLoadingCategories(false);
      }
    };

    loadCategories();
  }, [formData.questionSetId]);

  const handleInputChange = (field, value) => {
    setFormData(prev => {
      const newData = {
        ...prev,
        [field]: value
      };
      
      // Reset question set when game type changes
      if (field === 'gameType') {
        newData.questionSetId = '';
        setCategories([]);
        setSelectedCategories([]);
      }
      
      return newData;
    });
  };

  const handleCategoryToggle = (categoryId) => {
    setSelectedCategories(prev => {
      if (prev.includes(categoryId)) {
        return prev.filter(cat => cat !== categoryId);
      } else {
        return [...prev, categoryId];
      }
    });
  };

  const copyToClipboard = async () => {
    // Create meeting invite style text
    const questionSet = questionSets.find(set => set.id === formData.questionSetId);
    const selectedCatNames = selectedCategories.length > 0 ? selectedCategories : 'All categories';
    const catText = Array.isArray(selectedCatNames) ? selectedCatNames.join(', ') : selectedCatNames;
    
    const inviteText = `ENGAGEMENT INVITATION

${formData.title}

You're invited to participate in an interactive engagement session!

DETAILS:
• Type: ${formData.gameType === 'call-and-answer' ? 'Call and Answer (Discussion + Voting)' : 'Trivia (Questions Only)'}
• Question Set: ${questionSet?.name || questionSet?.title || 'Unknown'}
• Categories: ${catText}
${formData.engagementInfo ? `• Context: ${formData.engagementInfo}` : ''}
${formData.visibility === 'private' ? `• Access Code: ${formData.accessCode}` : ''}

TO JOIN:
Click this link or copy it to your browser:
${gameUrl}

INSTRUCTIONS:
1. Click the link above or paste it into your browser
2. Enter your name when prompted
${formData.visibility === 'private' ? '3. Enter the access code provided above' : ''}
${formData.visibility === 'private' ? '4. Wait for the host to begin' : '3. Wait for the host to begin'}
${formData.visibility === 'private' ? '5. Participate by answering questions and voting' : '4. Participate by answering questions and voting'}

Ready to engage? See you there!`;

    try {
      await navigator.clipboard.writeText(inviteText);
      console.log('✅ Meeting invite copied to clipboard');
      
      // Show a brief confirmation
      const originalText = document.querySelector('.copy-instruction');
      if (originalText) {
        const oldText = originalText.textContent;
        originalText.textContent = '✓ Invite copied to clipboard!';
        originalText.style.color = '#10b981';
        setTimeout(() => {
          originalText.textContent = oldText;
          originalText.style.color = '';
        }, 2000);
      }
    } catch (err) {
      console.error('Failed to copy invite:', err);
      // Fallback for older browsers
      const textArea = document.createElement('textarea');
      textArea.value = inviteText;
      document.body.appendChild(textArea);
      textArea.select();
      document.execCommand('copy');
      document.body.removeChild(textArea);
    }
  };

  const generateGameId = () => {
    // Generate 4-character alphanumeric ID, ensuring exactly 4 characters
    let gameId;
    do {
      gameId = Math.random().toString(36).substring(2, 6).toUpperCase();
    } while (gameId.length < 4);
    
    // Ensure it's exactly 4 characters
    return gameId.substring(0, 4);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    
    if (!formData.title.trim()) {
      setError('Please enter a game title');
      return;
    }

    if (formData.visibility === 'private' && !formData.accessCode.trim()) {
      setError('Please enter an access code for private games');
      return;
    }

    setSubmitting(true);
    setError('');

    try {
      // Generate a unique game ID with retry logic
      let gameId;
      let attempts = 0;
      const maxAttempts = 5;
      
      while (attempts < maxAttempts) {
        gameId = generateGameId();
        console.log(`🎯 HOST: Attempting to create game with ID: ${gameId} (attempt ${attempts + 1})`);
        
        const createPayload = {
          eventTitle: formData.title.trim(),
          questionSetId: formData.questionSetId,
          gameType: formData.gameType,
          randomizeQuestions: formData.randomize,
          selectedCategories: selectedCategories,
          engagementInfo: formData.engagementInfo.trim(),
          aiContext: formData.aiInfo.trim(),
          visibility: formData.visibility,
          accessCode: formData.visibility === 'private' ? formData.accessCode.trim() : null
        };
        
        console.log('🚀 Creating engagement with payload:', createPayload);
        console.log('🚀 Selected question set details:', questionSets.find(set => set.id === formData.questionSetId));
        
        const response = await fetch(`${API_BASE}games`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(createPayload)
        });

        if (response.ok) {
          // Success - game created
          const result = await response.json();
          console.log('✅ HOST: Game created successfully:', result);
          
          // Use the gameId from the response
          const actualGameId = result.gameId || gameId;
          
          // Generate shareable URL for players
          const playerUrl = `${window.location.origin}/play?gameId=${actualGameId}`;
          setGameUrl(playerUrl);
          
          // Don't auto-redirect - let them copy the invite and start when ready
          return;
        } else {
          // Check if it's a duplicate error
          const errorData = await response.json().catch(() => ({}));
          if (errorData.error && errorData.error.includes('already exists')) {
            console.log(`⚠️ HOST: Game ID ${gameId} already exists, retrying...`);
            attempts++;
            continue; // Try again with new ID
          } else {
            // Other error - don't retry
            throw new Error(errorData.error || `Failed to create game: ${response.status}`);
          }
        }
      }
      
      // If we get here, all attempts failed
      throw new Error(`Unable to generate unique game ID after ${maxAttempts} attempts. Please try again.`);

    } catch (error) {
      console.error('❌ HOST: Create game error:', error);
      setError(error.message);
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="create-game-form">
        <div className="form-container">
          <h2>Create Engagement</h2>
          <div className="loading-message">Loading question sets...</div>
        </div>
      </div>
    );
  }

  return (
    <div className="create-game-form">
      <div className="form-container">
        <h2>Create Engagement</h2>
        
        {error && (
          <div className="error-alert">
            <span className="error-icon">!</span>
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label htmlFor="title">Engagement Title:</label>
            <input
              id="title"
              type="text"
              value={formData.title}
              onChange={(e) => handleInputChange('title', e.target.value)}
              placeholder="e.g., Team Building Session"
              required
              disabled={submitting}
              maxLength={100}
            />
          </div>

          <div className="form-group">
            <label htmlFor="gameType">Engagement Type:</label>
            <select
              id="gameType"
              value={formData.gameType}
              onChange={(e) => handleInputChange('gameType', e.target.value)}
              disabled={submitting}
            >
              <option value="call-and-answer">Call and Answer (Discussion + Voting)</option>
              <option value="trivia">Trivia (Questions Only)</option>
            </select>
          </div>

          <div className="form-group">
            <label htmlFor="visibility">Game Visibility:</label>
            <select
              id="visibility"
              value={formData.visibility}
              onChange={(e) => handleInputChange('visibility', e.target.value)}
              disabled={submitting}
            >
              <option value="public">Public - Anyone with game ID can join</option>
              <option value="private">Private - Requires access code to join</option>
              <option value="unlisted">Unlisted - Hidden but accessible with game ID</option>
            </select>
          </div>

          {formData.visibility === 'private' && (
            <div className="form-group">
              <label htmlFor="accessCode">Access Code:</label>
              <input
                id="accessCode"
                type="text"
                value={formData.accessCode}
                onChange={(e) => handleInputChange('accessCode', e.target.value)}
                placeholder="Enter access code (e.g., TeamMeeting2024)"
                disabled={submitting}
                maxLength={50}
              />
              <small>Participants will need this code to join the game</small>
            </div>
          )}

          <div className="form-group">
            <label htmlFor="questionSetId">Question Set:</label>
            <select
              id="questionSetId"
              value={formData.questionSetId}
              onChange={(e) => handleInputChange('questionSetId', e.target.value)}
              required
              disabled={submitting}
            >
              <option value="">Select a question set...</option>
              {questionSets.map(set => (
                <option key={set.id} value={set.id}>
                  {set.name || set.title} ({set.totalQuestions || set.questionCount || 0} questions)
                </option>
              ))}
            </select>
            {questionSets.length === 0 && (
              <small>No question sets available</small>
            )}
          </div>


          {/* Category Selection */}
          {formData.questionSetId && (
            <div className="form-group">
              <label>Categories:</label>
              {loadingCategories ? (
                <div className="loading-message">Loading categories...</div>
              ) : categories.length > 0 ? (
                <div className="category-selection">
                  <div className="category-button-grid">
                    {categories.map(category => (
                      <button
                        key={category.id || category.name}
                        type="button"
                        className={`category-button ${selectedCategories.includes(category.id || category.name) ? 'selected' : ''}`}
                        onClick={() => handleCategoryToggle(category.id || category.name)}
                        disabled={submitting}
                      >
                        <span className="category-name">{category.name}</span>
                        <span className="category-count">({category.count})</span>
                      </button>
                    ))}
                  </div>
                  <small>
                    {selectedCategories.length === 0 
                      ? 'No categories selected - all categories will be included'
                      : `${selectedCategories.length} category(ies) selected`
                    }
                  </small>
                </div>
              ) : (
                <small>No categories available for this question set</small>
              )}
            </div>
          )}

          <div className="form-group checkbox-group">
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={formData.randomize}
                onChange={(e) => handleInputChange('randomize', e.target.checked)}
                disabled={submitting}
              />
              <span>Randomize question order</span>
            </label>
          </div>

          <div className="form-group">
            <label htmlFor="engagementInfo">Engagement Info (for participants):</label>
            <textarea
              id="engagementInfo"
              value={formData.engagementInfo}
              onChange={(e) => handleInputChange('engagementInfo', e.target.value)}
              placeholder="Optional: Context about this session for participants (e.g., team goals, event purpose)"
              disabled={submitting}
              rows={3}
              maxLength={500}
            />
            <small>{formData.engagementInfo.length}/500 characters</small>
          </div>

          <div className="form-group">
            <label htmlFor="aiInfo">AI Info (background for AI Workie):</label>
            <textarea
              id="aiInfo"
              value={formData.aiInfo}
              onChange={(e) => handleInputChange('aiInfo', e.target.value)}
              placeholder="Optional: Background context for AI to understand your team/organization (e.g., industry, team dynamics)"
              disabled={submitting}
              rows={3}
              maxLength={500}
            />
            <small>{formData.aiInfo.length}/500 characters</small>
          </div>

          <div className="form-actions">
            <button 
              type="button" 
              className="btn-secondary"
              onClick={onCancel}
              disabled={submitting}
            >
              Cancel
            </button>
            <button 
              type="submit" 
              className="btn-primary"
              disabled={submitting || !formData.title.trim() || questionSets.length === 0}
            >
              {submitting ? 'Creating...' : 'Create Engagement'}
            </button>
          </div>
        </form>

        {/* Meeting Invite Box */}
        {gameUrl && (
          <div className="share-url-container">
            <h3>✓ Engagement Created Successfully!</h3>
            <p>Your engagement is ready! Copy the participant invite and use the host link when ready to start.</p>
            
            {/* Participant Invite */}
            <div className="invite-section">
              <h4>👥 Participant Invite</h4>
              <div className="url-box" onClick={copyToClipboard}>
                <div className="url-text">
                  <strong>Copy Participant Invite</strong>
                  <br />
                  <small>Includes engagement details, instructions, and join link</small>
                </div>
                <div className="copy-icon">⧉</div>
              </div>
              <small className="copy-instruction">Click above to copy a complete meeting invitation to clipboard</small>
            </div>

            {/* Host Actions */}
            <div className="invite-section">
              <h4>🎯 Host Controls</h4>
              <div className="engagement-actions">
                <button 
                  type="button" 
                  className="btn-primary btn-large"
                  onClick={() => {
                    const gameId = gameUrl.split('gameId=')[1];
                    const hostUrl = `${window.location.origin}/host?gameId=${gameId}`;
                    window.open(hostUrl, '_blank');
                  }}
                >
                  🚀 Open Host Dashboard
                </button>
                <button 
                  type="button" 
                  className="btn-secondary"
                  onClick={() => {
                    const gameId = gameUrl.split('gameId=')[1];
                    const hostInvite = `HOST INVITE - ${formData.title}

Game ID: ${gameId}
Host Dashboard: ${window.location.origin}/host?gameId=${gameId}

As the host, you can:
- Start and control the engagement
- Monitor participant responses
- View real-time results
- Guide the session flow

Click the link above to access your host dashboard and begin the session when ready.`;
                    
                    navigator.clipboard.writeText(hostInvite).then(() => {
                      console.log('✅ Host invite copied to clipboard');
                    }).catch(err => {
                      console.error('Failed to copy host invite:', err);
                    });
                  }}
                >
                  📋 Copy Host Invite
                </button>
              </div>
            </div>

            {/* Additional Actions */}
            <div className="additional-actions">
              <button 
                type="button" 
                className="btn-outline"
                onClick={() => window.location.reload()}
              >
                Create Another Engagement
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default CreateGameForm;