import React, { useState, useEffect } from 'react';
import './AIPromptManager.css';

const API_BASE = window.API_BASE;

// AI Prompt Editor Modal Component
function AIPromptEditor({ prompt, isNew = false, onSave, onCancel }) {
  const [formData, setFormData] = useState({
    name: prompt?.name || '',
    description: prompt?.description || '',
    gameType: prompt?.gameType || 'callandanswer',
    category: prompt?.category || '',
    scenario: prompt?.scenario || '',
    template: prompt?.template || '',
    instructions: prompt?.instructions || '',
    outputFormat: prompt?.outputFormat || '',
    status: prompt?.status || 'draft',
    tags: prompt?.tags || [],
    isDefault: prompt?.isDefault || false,
    questionSetIds: prompt?.questionSetIds || []
  });

  const [tagInput, setTagInput] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [outputFormatTextareaRef, setOutputFormatTextareaRef] = useState(null);

  // Available template variables with game type availability
  const templateVariables = [
    // SET INFO - Available for all game types
    { 
      name: 'questionSetName', 
      description: 'Name of the question set being used', 
      category: 'Set Info',
      gameTypes: ['callandanswer', 'trivia', 'polls', 'wavelength'],
      example: 'Amazon Leadership Principles, Team Building Icebreakers'
    },
    { 
      name: 'questionSetDescription', 
      description: 'Description of the question set theme and purpose', 
      category: 'Set Info',
      gameTypes: ['callandanswer', 'trivia', 'polls', 'wavelength'], 
      example: 'Questions designed to explore leadership scenarios and decision-making'
    },
    { 
      name: 'categoryCount', 
      description: 'Number of different categories in the question set', 
      category: 'Set Info',
      gameTypes: ['callandanswer', 'trivia', 'polls', 'wavelength'],
      example: '8 categories, 5 different themes'
    },
    { 
      name: 'totalQuestions', 
      description: 'Total number of questions available in the set', 
      category: 'Set Info',
      gameTypes: ['callandanswer', 'trivia', 'polls', 'wavelength'],
      example: '45 questions across all categories'
    },
    { 
      name: 'sessionContext', 
      description: 'Session/event context and instructions', 
      category: 'Set Info',
      gameTypes: ['callandanswer', 'trivia', 'polls', 'wavelength'],
      example: 'Strategic Planning Session for Q4 - Focus on innovation and market expansion'
    },

    // GAME INFO - Available for all game types
    { 
      name: 'eventTitle', 
      description: 'Name/title of the game or event session', 
      category: 'Game Info',
      gameTypes: ['callandanswer', 'trivia', 'polls', 'wavelength'],
      example: 'Q4 Strategy Session, Team Building Workshop, Leadership Development'
    },
    { 
      name: 'gameType', 
      description: 'Type of engagement activity', 
      category: 'Game Info',
      gameTypes: ['callandanswer', 'trivia', 'polls', 'wavelength'],
      example: 'call-and-answer, trivia, polls, survey'
    },
    { 
      name: 'gameId', 
      description: 'Unique identifier for the current game session', 
      category: 'Game Info',
      gameTypes: ['callandanswer', 'trivia', 'polls', 'wavelength'],
      example: '1234, ABCD'
    },
    { 
      name: 'sessionDuration', 
      description: 'How long the game session has been running', 
      category: 'Game Info',
      gameTypes: ['callandanswer', 'trivia', 'polls', 'wavelength'],
      example: '45 minutes, 1 hour 15 minutes'
    },
    { 
      name: 'currentRound', 
      description: 'Current question number or round being played', 
      category: 'Game Info',
      gameTypes: ['callandanswer', 'trivia', 'polls', 'wavelength'],
      example: 'Round 3 of 8, Question 5'
    },
    { 
      name: 'totalScores', 
      description: 'Overall leaderboard with cumulative player scores (Top 5)', 
      category: 'Game Info',
      gameTypes: ['callandanswer', 'trivia', 'polls', 'wavelength'],
      example: '1. Sarah: 85 pts, 2. Mike: 72 pts, 3. Alex: 68 pts'
    },
    { 
      name: 'gameContext', 
      description: 'Alias for eventTitle - backward compatibility', 
      category: 'Game Info',
      gameTypes: ['callandanswer', 'trivia', 'polls', 'wavelength'],
      example: 'Q4 Strategy Session, Team Building Workshop'
    },

    // PLAYER INFO - Available for all game types
    { 
      name: 'totalParticipants', 
      description: 'Number of people who joined the session', 
      category: 'Player Info',
      gameTypes: ['callandanswer', 'trivia', 'polls', 'wavelength'],
      example: '15 participants, 8 team members'
    },
    { 
      name: 'totalPlayers', 
      description: 'Alias for totalParticipants - used in trivia templates', 
      category: 'Player Info',
      gameTypes: ['trivia'],
      example: '15 participants, 8 team members'
    },
    { 
      name: 'activeParticipants', 
      description: 'Number of players currently engaged/responding', 
      category: 'Player Info',
      gameTypes: ['callandanswer', 'trivia', 'polls', 'wavelength'],
      example: '12 of 15 players active this round'
    },
    { 
      name: 'playerNames', 
      description: 'List of participant names', 
      category: 'Player Info',
      gameTypes: ['callandanswer', 'trivia', 'polls', 'wavelength'],
      example: 'Sarah, Mike, Alex, Jordan, Casey, Taylor'
    },
    { 
      name: 'playerRankings', 
      description: 'Current player rankings with positions', 
      category: 'Player Info',
      gameTypes: ['callandanswer', 'trivia', 'polls', 'wavelength'],
      example: '1st: Sarah (85 pts), 2nd: Mike (72 pts), 3rd: Alex (68 pts)'
    },
    { 
      name: 'topPerformers', 
      description: 'Highest scoring players this session', 
      category: 'Player Info',
      gameTypes: ['callandanswer', 'trivia', 'polls', 'wavelength'],
      example: 'Sarah leads with 3 correct answers, Mike close behind'
    },

    // QUESTION INFO - Availability varies by game type
    { 
      name: 'question', 
      description: 'Main question text - used in trivia templates', 
      category: 'Question Info',
      gameTypes: ['trivia'],
      example: 'What is the capital of France?'
    },
    { 
      name: 'questionTitle', 
      description: 'Short title or summary of the current question', 
      category: 'Question Info',
      gameTypes: ['callandanswer', 'trivia', 'polls', 'wavelength'],
      example: 'Comfort Food Preferences, Leadership Decision, Innovation Strategy'
    },
    { 
      name: 'questionDetail', 
      description: 'The full question text or prompt presented to participants', 
      category: 'Question Info',
      gameTypes: ['callandanswer', 'trivia', 'polls', 'wavelength'],
      example: 'What is your favorite comfort food and why does it bring you comfort?'
    },
    { 
      name: 'questionCategory', 
      description: 'Category/theme of the current question', 
      category: 'Question Info',
      gameTypes: ['callandanswer', 'trivia', 'polls', 'wavelength'],
      example: 'Personal Preferences, Team Building, Strategy, Leadership'
    },
    { 
      name: 'questionContext', 
      description: 'Additional context or instructions for the question', 
      category: 'Question Info',
      gameTypes: ['callandanswer', 'trivia', 'polls', 'wavelength'],
      example: 'Think about foods that bring you comfort during stressful times...'
    },
    { 
      name: 'questionNumber', 
      description: 'Current question number in the session', 
      category: 'Question Info',
      gameTypes: ['callandanswer', 'trivia', 'polls', 'wavelength'],
      example: 'Question 3, Round 5, Item 7'
    },
    { 
      name: 'triviaChoices', 
      description: 'Multiple choice options for trivia questions (A, B, C, D format)', 
      category: 'Question Info',
      gameTypes: ['trivia'],
      example: 'A) Pizza, B) Burgers, C) Tacos, D) Sushi'
    },
    { 
      name: 'pollOptions', 
      description: 'Available options for poll questions', 
      category: 'Question Info',
      gameTypes: ['polls'],
      example: 'Option 1: Remote work, Option 2: Hybrid, Option 3: In-office'
    },
    { 
      name: 'correctAnswer', 
      description: 'The correct answer for trivia questions (actual text, not option ID)', 
      category: 'Question Info',
      gameTypes: ['trivia'],
      example: 'Tacos, Multiple answers: Pizza and Tacos'
    },

    // ANSWERS - Available for all game types with some variations
    { 
      name: 'playerAnswers', 
      description: 'Individual responses from each participant', 
      category: 'Answers',
      gameTypes: ['callandanswer', 'trivia', 'polls', 'wavelength'],
      example: 'Sarah: "Pizza - reminds me of family", Mike: "Ice cream - sweet comfort"'
    },
    { 
      name: 'playerResponses', 
      description: 'Alias for playerAnswers - used in trivia templates', 
      category: 'Answers',
      gameTypes: ['trivia'],
      example: 'Sarah: "A", Mike: "C", Alex: "B"'
    },
    { 
      name: 'responseCount', 
      description: 'Total number of participant responses received', 
      category: 'Answers',
      gameTypes: ['callandanswer', 'trivia', 'polls', 'wavelength'],
      example: '12 answers from 15 participants, 8 responses submitted'
    },
    { 
      name: 'uniqueAnswers', 
      description: 'Distinct/unique responses without duplicates', 
      category: 'Answers',
      gameTypes: ['callandanswer', 'polls'],
      example: '8 unique answers: Pizza, Ice cream, Chocolate, Mac and cheese...'
    },
    { 
      name: 'answerCategories', 
      description: 'Grouped answers by theme or similarity', 
      category: 'Answers',
      gameTypes: ['callandanswer', 'polls'],
      example: 'Sweet foods: 5 responses, Savory: 4 responses, Homemade: 3 responses'
    },
    { 
      name: 'triviaResponses', 
      description: 'Player answer distribution for trivia questions', 
      category: 'Answers',
      gameTypes: ['trivia'],
      example: 'A: 3 players, B: 2 players, C: 7 players (correct), D: 1 player'
    },
    { 
      name: 'responsesText', 
      description: 'Top player responses ranked by popularity/votes or points', 
      category: 'Answers',
      gameTypes: ['callandanswer', 'trivia', 'polls', 'wavelength'],
      example: '1st Place: Pizza (5 votes), 2nd Place: Mac and cheese (3 votes)'
    },
    { 
      name: 'correctCount', 
      description: 'Number of players who answered correctly (trivia only)', 
      category: 'Answers',
      gameTypes: ['trivia'],
      example: '7 of 12 players got it right'
    },

    // VOTES - Only available for call-and-answer games
    { 
      name: 'voteData', 
      description: 'Complete voting information for call-and-answer questions', 
      category: 'Votes',
      gameTypes: ['callandanswer'],
      example: 'Sarah voted for Mike (1st), Alex (2nd), Jordan (3rd)'
    },
    { 
      name: 'voteCount', 
      description: 'Total number of votes cast by participants', 
      category: 'Votes',
      gameTypes: ['callandanswer'],
      example: '10 voters participated, 45 total votes cast'
    },
    { 
      name: 'votingParticipation', 
      description: 'Percentage of players who participated in voting', 
      category: 'Votes',
      gameTypes: ['callandanswer'],
      example: '83% participation (10 of 12 players voted)'
    },
    { 
      name: 'votingPattern', 
      description: 'Analysis of how votes were distributed', 
      category: 'Votes',
      gameTypes: ['callandanswer'],
      example: 'Close competition, Clear winner, Evenly distributed votes'
    },

    // VOTE TALLY - Only available for call-and-answer games
    { 
      name: 'voteTally', 
      description: 'Ranked results showing vote counts per answer', 
      category: 'Vote Tally',
      gameTypes: ['callandanswer'],
      example: '1. Pizza (8 votes), 2. Ice cream (5 votes), 3. Chocolate (3 votes)'
    },
    { 
      name: 'topVotedAnswers', 
      description: 'Highest voted responses with vote counts', 
      category: 'Vote Tally',
      gameTypes: ['callandanswer'],
      example: 'Pizza: 8 votes, Ice cream: 5 votes, Chocolate: 3 votes'
    },
    { 
      name: 'votingBreakdown', 
      description: 'Detailed breakdown of first, second, third place votes', 
      category: 'Vote Tally',
      gameTypes: ['callandanswer'],
      example: 'Pizza: 5 first-place, 2 second-place, 1 third-place votes'
    },
    { 
      name: 'consensusLevel', 
      description: 'How much agreement there was in voting', 
      category: 'Vote Tally',
      gameTypes: ['callandanswer'],
      example: 'Strong consensus, Divided opinions, Clear winner emerged'
    },

    // RESULTS - Available for all game types
    { 
      name: 'finalResults', 
      description: 'Complete ranked results with winners and scores/votes', 
      category: 'Results',
      gameTypes: ['callandanswer', 'trivia', 'polls', 'wavelength'],
      example: '🥇 Pizza (8 votes), 🥈 Ice cream (5 votes), 🥉 Chocolate (3 votes)'
    },
    { 
      name: 'winnerInfo', 
      description: 'Information about the winning answer(s) and player(s)', 
      category: 'Results',
      gameTypes: ['callandanswer', 'trivia', 'polls', 'wavelength'],
      example: 'Winner: Sarah with "Pizza - family memories" (8 votes)'
    },
    { 
      name: 'resultsSummary', 
      description: 'High-level summary of question outcomes', 
      category: 'Results',
      gameTypes: ['callandanswer', 'trivia', 'polls', 'wavelength'],
      example: 'Clear winner with 50% of votes, competitive race for 2nd place'
    },
    { 
      name: 'participationRate', 
      description: 'Percentage of players who participated in this question', 
      category: 'Results',
      gameTypes: ['callandanswer', 'trivia', 'polls', 'wavelength'],
      example: '92% answered (11 of 12), 83% voted (10 of 12)'
    },
    { 
      name: 'triviaCorrectness', 
      description: 'Accuracy results for trivia questions', 
      category: 'Results',
      gameTypes: ['trivia'],
      example: '7 of 12 players correct (58%), Average response time: 8 seconds'
    },

    // SCORES - Available for all game types
    { 
      name: 'roundScores', 
      description: 'Points awarded for the current question/round only', 
      category: 'Scores',
      gameTypes: ['callandanswer', 'trivia', 'polls', 'wavelength'],
      example: 'Sarah: +5 pts, Mike: +3 pts, Alex: +1 pt'
    },
    { 
      name: 'cumulativeScores', 
      description: 'Total points accumulated by each player (same as totalScores)', 
      category: 'Scores',
      gameTypes: ['callandanswer', 'trivia', 'polls', 'wavelength'],
      example: 'Sarah: 25 total, Mike: 18 total, Alex: 15 total'
    },
    { 
      name: 'scoreChanges', 
      description: 'How scores changed from previous round', 
      category: 'Scores',
      gameTypes: ['callandanswer', 'trivia', 'polls', 'wavelength'],
      example: 'Sarah: +5 (was 20), Mike: +3 (was 15), Alex: +1 (was 14)'
    },
    { 
      name: 'leaderboard', 
      description: 'Current ranking of all players by total score (Top 5)', 
      category: 'Scores',
      gameTypes: ['callandanswer', 'trivia', 'polls', 'wavelength'],
      example: '1. Sarah (25 pts), 2. Mike (18 pts), 3. Alex (15 pts)'
    },
    { 
      name: 'scoringSystem', 
      description: 'Explanation of how points are awarded', 
      category: 'Scores',
      gameTypes: ['callandanswer', 'trivia', 'polls', 'wavelength'],
      example: '1st place: 5 pts, 2nd place: 3 pts, 3rd place: 1 pt'
    },
    { 
      name: 'averageScore', 
      description: 'Average points per player in the current session', 
      category: 'Scores',
      gameTypes: ['callandanswer', 'trivia', 'polls', 'wavelength'],
      example: 'Average: 16.8 points per player, Median: 15 points'
    },

    // CONTEXT - Available for all game types (backward compatibility)
    { 
      name: 'contextSections', 
      description: 'Combined context from event and question set', 
      category: 'Context',
      gameTypes: ['callandanswer', 'trivia', 'polls', 'wavelength'],
      example: 'Team Building Workshop - Building rapport through personal sharing'
    },
    { 
      name: 'contextInstructions', 
      description: 'Specific instructions for AI analysis', 
      category: 'Context',
      gameTypes: ['callandanswer', 'trivia', 'polls', 'wavelength'],
      example: 'Focus on team dynamics and provide actionable insights for managers'
    }
  ];

  const insertVariable = (variableName) => {
    if (outputFormatTextareaRef) {
      const cursorPos = outputFormatTextareaRef.selectionStart;
      const textBefore = formData.outputFormat.substring(0, cursorPos);
      const textAfter = formData.outputFormat.substring(outputFormatTextareaRef.selectionEnd);
      const newOutputFormat = textBefore + `{${variableName}}` + textAfter;
      
      setFormData({ ...formData, outputFormat: newOutputFormat });
      
      // Move cursor after inserted variable
      setTimeout(() => {
        outputFormatTextareaRef.setSelectionRange(
          cursorPos + variableName.length + 2,
          cursorPos + variableName.length + 2
        );
        outputFormatTextareaRef.focus();
      }, 0);
    }
  };

  const gameTypes = [
    { value: 'callandanswer', label: 'Call and Answer' },
    { value: 'trivia', label: 'Trivia' },
    { value: 'polls', label: 'Polls' },
    { value: 'wavelength', label: 'Wavelength' }
  ];

  const categories = {
    callandanswer: [
      'lessons-learned',
      'problem-solving',
      'amazon-principles',
      'interview-prep',
      'team-building',
      'custom',
      'opinions'
    ],
    trivia: ['general', 'business', 'technology', 'history', 'science', 'custom'],
    polls: ['opinion', 'preference', 'feedback', 'evaluation', 'custom'],
    wavelength: ['word-association', 'brainstorming', 'creativity', 'team-building', 'custom']
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setIsSaving(true);

    try {
      const endpoint = isNew 
        ? `${API_BASE}admin/ai-prompts`
        : `${API_BASE}admin/ai-prompts/${prompt.promptId}`;
      
      const method = isNew ? 'POST' : 'PUT';
      
      const response = await fetch(endpoint, {
        method,
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(formData)
      });

      if (!response.ok) {
        throw new Error(`Failed to ${isNew ? 'create' : 'update'} prompt`);
      }

      const result = await response.json();
      onSave(result);
    } catch (error) {
      console.error('Error saving prompt:', error);
      alert(`Failed to ${isNew ? 'create' : 'update'} prompt: ${error.message}`);
    } finally {
      setIsSaving(false);
    }
  };

  const handleAddTag = () => {
    if (tagInput.trim() && !formData.tags.includes(tagInput.trim())) {
      setFormData({ ...formData, tags: [...formData.tags, tagInput.trim()] });
      setTagInput('');
    }
  };

  const handleRemoveTag = (tag) => {
    setFormData({ ...formData, tags: formData.tags.filter(t => t !== tag) });
  };

  return (
    <div className="prompt-editor-overlay">
      <div className="prompt-editor-modal">
        <div className="prompt-editor-header">
          <h2>{isNew ? 'Create New AI Prompt' : 'Edit AI Prompt'}</h2>
          <button className="close-btn" onClick={onCancel}>×</button>
        </div>
        
        <form onSubmit={handleSubmit} className="prompt-editor-form">
          <div className="form-group">
            <label>Prompt Name *</label>
            <input
              type="text"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              placeholder="e.g., Lessons Learned - Call and Answer"
              required
            />
          </div>

          <div className="form-group">
            <label>Description</label>
            <textarea
              value={formData.description}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              placeholder="Describe what this prompt does..."
              rows="3"
            />
          </div>

          <div className="form-row">
            <div className="form-group">
              <label>Game Type *</label>
              <select
                value={formData.gameType}
                onChange={(e) => setFormData({ 
                  ...formData, 
                  gameType: e.target.value,
                  category: '' // Reset category when game type changes
                })}
                required
              >
                {gameTypes.map(type => (
                  <option key={type.value} value={type.value}>{type.label}</option>
                ))}
              </select>
            </div>

            <div className="form-group">
              <label>Category</label>
              <select
                value={formData.category}
                onChange={(e) => setFormData({ ...formData, category: e.target.value })}
              >
                <option value="">Select a category...</option>
                {categories[formData.gameType]?.map(cat => (
                  <option key={cat} value={cat}>{cat}</option>
                ))}
              </select>
            </div>

            <div className="form-group">
              <label>Status</label>
              <select
                value={formData.status}
                onChange={(e) => setFormData({ ...formData, status: e.target.value })}
              >
                <option value="draft">Draft</option>
                <option value="active">Active</option>
                <option value="archived">Archived</option>
              </select>
            </div>
          </div>

          <div className="form-group">
            <label>Scenario</label>
            <input
              type="text"
              value={formData.scenario}
              onChange={(e) => setFormData({ ...formData, scenario: e.target.value })}
              placeholder="e.g., Lessons Learned Scenarios"
            />
          </div>

          <div className="form-group">
            <label>1. General Instructions *</label>
            <textarea
              value={formData.instructions}
              onChange={(e) => setFormData({ ...formData, instructions: e.target.value })}
              placeholder="Example: You are a Developer Consultant that provides deep thoughtful expertise on how to deploy code and develop products. You provide detailed answers and speak clearly, explaining any jargon to make sure everyone's on the same page."
              rows="4"
              required
            />
            <small className="form-help">
              Define the AI's persona, expertise, and communication style.
            </small>
          </div>

          <div className="form-group template-group">
            <label>2. Output Format (Markdown) *</label>
            <div className="template-editor-container">
              <div className="template-variables-panel">
                <h4>📝 Available Variables</h4>
                <p className="variables-help">
                  Click to insert into output format:<br />
                  <small><strong>💡 Pro Tip:</strong> Use markdown headers (## Header Name) to create custom sections in your output format.</small>
                  <br />
                  <small><strong>🎯 Game Type:</strong> {formData.gameType} - Variables marked with ⚠️ are not available for this game type</small>
                </p>
                {['Set Info', 'Game Info', 'Player Info', 'Question Info', 'Answers', 'Votes', 'Vote Tally', 'Results', 'Scores', 'Context'].map(category => {
                  const categoryVariables = templateVariables.filter(v => v.category === category);
                  if (categoryVariables.length === 0) return null;
                  
                  return (
                    <div key={category} className="variable-category">
                      <h5 className="category-header">{category}</h5>
                      <div className="category-variables">
                        {categoryVariables.map(variable => {
                          const isAvailable = variable.gameTypes.includes(formData.gameType);
                          const isTriviaMostly = variable.gameTypes.length === 1 && variable.gameTypes[0] === 'trivia';
                          const isCallAnswerOnly = variable.gameTypes.length === 1 && variable.gameTypes[0] === 'callandanswer';
                          
                          return (
                            <button
                              key={variable.name}
                              type="button"
                              className={`variable-btn ${!isAvailable ? 'variable-unavailable' : ''} ${isTriviaMostly ? 'variable-trivia-only' : ''} ${isCallAnswerOnly ? 'variable-callanswer-only' : ''}`}
                              onClick={() => insertVariable(variable.name)}
                              title={`${variable.description}\n\nAvailable for: ${variable.gameTypes.join(', ')}\n\nExample: ${variable.example}`}
                              disabled={!isAvailable}
                            >
                              {!isAvailable && '⚠️ '}
                              {isTriviaMostly && formData.gameType === 'trivia' && '🎲 '}
                              {isCallAnswerOnly && formData.gameType === 'callandanswer' && '🗳️ '}
                              {'{' + variable.name + '}'}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
              <div className="template-textarea-container">
                <textarea
                  ref={setOutputFormatTextareaRef}
                  value={formData.outputFormat}
                  onChange={(e) => setFormData({ ...formData, outputFormat: e.target.value })}
                  placeholder="Example output format:

## 🎯 Key Insights
Analyze the responses from {eventTitle} where participants answered: {questionTitle}

Based on {responseCount} responses, here are the top insights:
{responsesText}

## 💡 Strategic Implications
[Provide 2-3 strategic implications for the team/organization]

## 🚀 Recommended Actions
[List 3-4 specific next steps the team should consider]

Click variable buttons to insert them into your output format."
                  rows="12"
                  required
                />
              </div>
            </div>
            <small className="form-help">
              Click the variable buttons to insert them into your output format. Variables will be replaced with actual content when the AI summary is generated.
            </small>
          </div>

          <div className="form-group">
            <label>Tags</label>
            <div className="tag-input-container">
              <input
                type="text"
                value={tagInput}
                onChange={(e) => setTagInput(e.target.value)}
                onKeyPress={(e) => e.key === 'Enter' && (e.preventDefault(), handleAddTag())}
                placeholder="Add tags..."
              />
              <button type="button" onClick={handleAddTag} className="btn-add-tag">Add</button>
            </div>
            <div className="tags-list">
              {formData.tags.map(tag => (
                <span key={tag} className="tag">
                  {tag}
                  <button type="button" onClick={() => handleRemoveTag(tag)}>×</button>
                </span>
              ))}
            </div>
          </div>

          <div className="form-group checkbox-group">
            <label>
              <input
                type="checkbox"
                checked={formData.isDefault}
                onChange={(e) => setFormData({ ...formData, isDefault: e.target.checked })}
              />
              Set as default prompt for this category
            </label>
          </div>

          <div className="form-actions">
            <button type="button" className="btn-secondary" onClick={onCancel}>
              Cancel
            </button>
            <button type="submit" className="btn-primary" disabled={isSaving}>
              {isSaving ? 'Saving...' : (isNew ? 'Create Prompt' : 'Save Changes')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// AI Prompt Advisor Modal Component
function AIPromptAdvisor({ prompt, onClose, onApplyImprovedPrompt }) {
  const [analysisType, setAnalysisType] = useState('improve');
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysis, setAnalysis] = useState(null);

  const analysisTypes = [
    { value: 'improve', label: 'Improve Prompt', icon: '✨' },
    { value: 'validate', label: 'Validate Quality', icon: '🔍' },
    { value: 'optimize', label: 'Optimize Performance', icon: '⚡' }
  ];

  const runAnalysis = async () => {
    setIsAnalyzing(true);
    setAnalysis(null);

    try {
      const response = await fetch(`${API_BASE}admin/ai-prompt-advisor`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          promptText: prompt.template || (prompt.instructions + '\n\n' + prompt.outputFormat),
          gameType: prompt.gameType,
          scenario: prompt.scenario,
          analysisType,
          existingPromptId: prompt.promptId
        })
      });

      if (!response.ok) {
        throw new Error('Failed to analyze prompt');
      }

      const result = await response.json();
      setAnalysis(result.analysis);
    } catch (error) {
      console.error('Error analyzing prompt:', error);
      alert('Failed to analyze prompt: ' + error.message);
    } finally {
      setIsAnalyzing(false);
    }
  };

  return (
    <div className="prompt-advisor-overlay">
      <div className="prompt-advisor-modal">
        <div className="prompt-advisor-header">
          <h2>🪄 AI Prompt Advisor</h2>
          <button className="close-btn" onClick={onClose}>×</button>
        </div>

        <div className="prompt-advisor-content">
          <div className="prompt-info">
            <h3>{prompt.name}</h3>
            <div className="prompt-meta">
              <span className="badge">{prompt.gameType}</span>
              {prompt.category && <span className="badge">{prompt.category}</span>}
            </div>
          </div>

          <div className="analysis-types">
            {analysisTypes.map(type => (
              <label key={type.value} className={`analysis-type-option ${analysisType === type.value ? 'selected' : ''}`}>
                <input
                  type="radio"
                  value={type.value}
                  checked={analysisType === type.value}
                  onChange={(e) => setAnalysisType(e.target.value)}
                />
                <span className="type-icon">{type.icon}</span>
                <span className="type-label">{type.label}</span>
              </label>
            ))}
          </div>

          <button 
            className="btn-primary analyze-btn"
            onClick={runAnalysis}
            disabled={isAnalyzing}
          >
            {isAnalyzing ? 'Analyzing...' : 'Run Analysis'}
          </button>

          {analysis && (
            <div className="analysis-results">
              {analysisType === 'improve' && analysis.improvedPrompt && (
                <div className="result-section">
                  <h4>✨ Improved Prompt</h4>
                  <div className="improved-prompt">
                    <pre>{analysis.improvedPrompt}</pre>
                    <div className="improved-prompt-actions">
                      <button 
                        className="btn-secondary copy-btn"
                        onClick={() => navigator.clipboard.writeText(analysis.improvedPrompt)}
                      >
                        📋 Copy to Clipboard
                      </button>
                      <button 
                        className="btn-primary apply-btn"
                        onClick={() => {
                          onApplyImprovedPrompt(analysis.improvedPrompt);
                          onClose();
                        }}
                      >
                        ✨ Apply to Prompt
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {analysis.overallScore && (
                <div className="result-section">
                  <h4>📊 Overall Score</h4>
                  <div className="score-display">
                    <div className="score-value">{analysis.overallScore}/10</div>
                    <div className="score-bar">
                      <div 
                        className="score-fill"
                        style={{ width: `${analysis.overallScore * 10}%` }}
                      />
                    </div>
                  </div>
                </div>
              )}

              {analysis.strengths && (
                <div className="result-section">
                  <h4>💪 Strengths</h4>
                  <ul className="analysis-list">
                    {analysis.strengths.map((strength, idx) => (
                      <li key={idx}>{strength}</li>
                    ))}
                  </ul>
                </div>
              )}

              {analysis.improvements && (
                <div className="result-section">
                  <h4>📝 Improvements</h4>
                  <div className="improvements-list">
                    {analysis.improvements.map((improvement, idx) => (
                      <div key={idx} className={`improvement-item priority-${improvement.priority}`}>
                        <div className="improvement-header">
                          <span className="improvement-category">{improvement.category}</span>
                          <span className="improvement-priority">{improvement.priority}</span>
                        </div>
                        <p className="improvement-issue">{improvement.issue}</p>
                        <p className="improvement-suggestion">{improvement.suggestion}</p>
                        {improvement.example && (
                          <pre className="improvement-example">{improvement.example}</pre>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {analysis.alternativeApproaches && (
                <div className="result-section">
                  <h4>🔄 Alternative Approaches</h4>
                  {analysis.alternativeApproaches.map((approach, idx) => (
                    <div key={idx} className="alternative-approach">
                      <h5>{approach.approach}</h5>
                      <p>{approach.description}</p>
                      <div className="approach-details">
                        <div className="pros">
                          <strong>Pros:</strong>
                          <ul>
                            {approach.pros.map((pro, i) => (
                              <li key={i}>{pro}</li>
                            ))}
                          </ul>
                        </div>
                        <div className="cons">
                          <strong>Cons:</strong>
                          <ul>
                            {approach.cons.map((con, i) => (
                              <li key={i}>{con}</li>
                            ))}
                          </ul>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {analysis.recommendations && (
                <div className="result-section">
                  <h4>💡 Recommendations</h4>
                  <ul className="analysis-list">
                    {analysis.recommendations.map((rec, idx) => (
                      <li key={idx}>{rec}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// Main AI Prompt Manager Component
function AIPromptManager() {
  const [prompts, setPrompts] = useState([]);
  const [filteredPrompts, setFilteredPrompts] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedGameType, setSelectedGameType] = useState('all');
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [selectedStatus, setSelectedStatus] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  
  const [editingPrompt, setEditingPrompt] = useState(null);
  const [isCreating, setIsCreating] = useState(false);
  const [advisorPrompt, setAdvisorPrompt] = useState(null);

  useEffect(() => {
    fetchPrompts();
  }, []);

  useEffect(() => {
    filterPrompts();
  }, [prompts, selectedGameType, selectedCategory, selectedStatus, searchQuery]);

  const fetchPrompts = async () => {
    setIsLoading(true);
    try {
      const response = await fetch(`${API_BASE}admin/ai-prompts?includeContent=true`);
      if (!response.ok) {
        throw new Error('Failed to fetch prompts');
      }
      const data = await response.json();
      
      // Transform the prompts to include the content from S3
      const transformedPrompts = (data.prompts || []).map(prompt => ({
        ...prompt,
        // Handle both old (template) and new (instructions + outputFormat) structure
        template: prompt.promptContent?.template || '',
        instructions: prompt.promptContent?.instructions || '',
        outputFormat: prompt.promptContent?.outputFormat || '',
        description: prompt.promptContent?.description || prompt.description || '',
        tags: prompt.promptContent?.tags || prompt.tags || []
      }));
      
      setPrompts(transformedPrompts);
    } catch (error) {
      console.error('Error fetching prompts:', error);
      alert('Failed to load prompts: ' + error.message);
    } finally {
      setIsLoading(false);
    }
  };

  const filterPrompts = () => {
    let filtered = [...prompts];

    if (selectedGameType !== 'all') {
      filtered = filtered.filter(p => p.gameType === selectedGameType);
    }

    if (selectedCategory !== 'all') {
      filtered = filtered.filter(p => p.category === selectedCategory);
    }

    if (selectedStatus !== 'all') {
      filtered = filtered.filter(p => p.status === selectedStatus);
    }

    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(p => 
        p.name.toLowerCase().includes(query) ||
        p.description?.toLowerCase().includes(query) ||
        p.tags?.some(tag => tag.toLowerCase().includes(query))
      );
    }

    setFilteredPrompts(filtered);
  };

  const handleDeletePrompt = async (promptId) => {
    if (!window.confirm('Are you sure you want to archive this prompt?')) {
      return;
    }

    try {
      const response = await fetch(`${API_BASE}admin/ai-prompts/${promptId}`, {
        method: 'DELETE'
      });

      if (!response.ok) {
        throw new Error('Failed to delete prompt');
      }

      await fetchPrompts();
    } catch (error) {
      console.error('Error deleting prompt:', error);
      alert('Failed to delete prompt: ' + error.message);
    }
  };

  const handleSavePrompt = async (result) => {
    setEditingPrompt(null);
    setIsCreating(false);
    await fetchPrompts();
  };

  const handleApplyImprovedPrompt = (improvedTemplate) => {
    if (advisorPrompt) {
      // Update the prompt in the state and open it for editing
      // For now, put the improved template in the outputFormat field
      const updatedPrompt = { ...advisorPrompt, outputFormat: improvedTemplate };
      setEditingPrompt(updatedPrompt);
      setAdvisorPrompt(null);
    }
  };

  const handlePopulateDefaults = async () => {
    if (!window.confirm('This will create default AI prompts for all categories. Existing prompts will be overwritten. Continue?')) {
      return;
    }

    try {
      setIsLoading(true);
      const response = await fetch(`${API_BASE}admin/populate-defaults`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ overwrite: true })
      });

      if (!response.ok) {
        throw new Error('Failed to populate default prompts');
      }

      const result = await response.json();
      
      if (result.success) {
        const { created, skipped, overwritten, errors } = result.results;
        let message = 'Success! ';
        
        if (created > 0) message += `Created ${created} new prompts. `;
        if (overwritten > 0) message += `Overwritten ${overwritten} existing prompts. `;
        if (skipped > 0) message += `${skipped} prompts were skipped. `;
        if (errors > 0) message += `${errors} errors occurred. `;
        
        alert(message.trim());
        await fetchPrompts(); // Refresh the list
      } else {
        throw new Error(result.message || 'Unknown error');
      }
    } catch (error) {
      console.error('Error populating defaults:', error);
      alert('Failed to populate default prompts: ' + error.message);
    } finally {
      setIsLoading(false);
    }
  };

  const getStatusBadgeClass = (status) => {
    switch (status) {
      case 'active': return 'status-active';
      case 'draft': return 'status-draft';
      case 'archived': return 'status-archived';
      default: return '';
    }
  };

  return (
    <div className="ai-prompt-manager">
      <div className="prompt-manager-header">
        <h2>🤖 AI Prompt Management</h2>
        <p className="section-description">
          Create and manage AI prompts for different game types. Use the AI Advisor to improve your prompts.
        </p>
      </div>

      <div className="prompt-controls">
        <div className="prompt-filters">
          <select 
            value={selectedGameType}
            onChange={(e) => setSelectedGameType(e.target.value)}
            className="filter-select"
          >
            <option value="all">All Game Types</option>
            <option value="callandanswer">Call and Answer</option>
            <option value="trivia">Trivia</option>
            <option value="polls">Polls</option>
          </select>

          <select 
            value={selectedCategory}
            onChange={(e) => setSelectedCategory(e.target.value)}
            className="filter-select"
          >
            <option value="all">All Categories</option>
            <option value="lessons-learned">Lessons Learned</option>
            <option value="problem-solving">Problem Solving</option>
            <option value="amazon-principles">Amazon Principles</option>
            <option value="interview-prep">Interview Prep</option>
            <option value="team-building">Team Building</option>
            <option value="custom">Custom</option>
          </select>

          <select 
            value={selectedStatus}
            onChange={(e) => setSelectedStatus(e.target.value)}
            className="filter-select"
          >
            <option value="all">All Status</option>
            <option value="active">Active</option>
            <option value="draft">Draft</option>
            <option value="archived">Archived</option>
          </select>

          <input
            type="text"
            placeholder="Search prompts..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="search-input"
          />
        </div>

        <div className="prompt-control-actions">
          <button 
            className="btn-secondary"
            onClick={handlePopulateDefaults}
            disabled={isLoading}
          >
            🎯 Populate Default Prompts
          </button>
          <button 
            className="btn-primary create-prompt-btn"
            onClick={() => setIsCreating(true)}
          >
            ➕ Create New Prompt
          </button>
        </div>
      </div>

      {isLoading ? (
        <div className="loading-state">Loading prompts...</div>
      ) : (
        <div className="prompts-grid">
          {filteredPrompts.length === 0 ? (
            <div className="empty-state">
              <p>No prompts found. Create your first AI prompt to get started!</p>
            </div>
          ) : (
            filteredPrompts.map(prompt => (
              <div key={prompt.promptId} className="prompt-card">
                <div className="prompt-card-header">
                  <h3>{prompt.name}</h3>
                  <span className={`status-badge ${getStatusBadgeClass(prompt.status)}`}>
                    {prompt.status}
                  </span>
                </div>
                
                <div className="prompt-card-meta">
                  <span className="game-type-badge">{prompt.gameType}</span>
                  {prompt.category && (
                    <span className="category-badge">{prompt.category}</span>
                  )}
                  {prompt.isDefault && (
                    <span className="default-badge">Default</span>
                  )}
                </div>

                {prompt.description && (
                  <p className="prompt-description">{prompt.description}</p>
                )}

                {prompt.tags && prompt.tags.length > 0 && (
                  <div className="prompt-tags">
                    {prompt.tags.map(tag => (
                      <span key={tag} className="tag">{tag}</span>
                    ))}
                  </div>
                )}

                <div className="prompt-card-actions">
                  <button
                    className="btn-icon"
                    onClick={() => setEditingPrompt(prompt)}
                    title="Edit"
                  >
                    ✏️
                  </button>
                  <button
                    className="btn-icon"
                    onClick={() => setAdvisorPrompt(prompt)}
                    title="AI Advisor"
                  >
                    🪄
                  </button>
                  <button
                    className="btn-icon delete"
                    onClick={() => handleDeletePrompt(prompt.promptId)}
                    title="Archive"
                  >
                    🗑️
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {(editingPrompt || isCreating) && (
        <AIPromptEditor
          prompt={editingPrompt}
          isNew={isCreating}
          onSave={handleSavePrompt}
          onCancel={() => {
            setEditingPrompt(null);
            setIsCreating(false);
          }}
        />
      )}

      {advisorPrompt && (
        <AIPromptAdvisor
          prompt={advisorPrompt}
          onClose={() => setAdvisorPrompt(null)}
          onApplyImprovedPrompt={handleApplyImprovedPrompt}
        />
      )}
    </div>
  );
}

export default AIPromptManager;