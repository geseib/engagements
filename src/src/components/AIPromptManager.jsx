import React, { useState, useEffect } from 'react';
import './AIPromptManager.css';
import { authFetch } from '../auth/authFetch';
import Icon from './Icon';

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
  const [isGeneratingWithAI, setIsGeneratingWithAI] = useState(false);
  const [savedInstructions, setSavedInstructions] = useState('');
  const [savedOutputFormat, setSavedOutputFormat] = useState('');

  // Complete template variables definitions for AI Summary prompts
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
      description: 'Total number of questions in the question set', 
      category: 'Set Info',
      gameTypes: ['callandanswer', 'trivia', 'polls', 'wavelength'],
      example: '25 questions, 120 total questions'
    },
    { 
      name: 'sessionContext', 
      description: 'Combined context about the session including set name and description', 
      category: 'Set Info',
      gameTypes: ['callandanswer', 'trivia', 'polls', 'wavelength'],
      example: 'a Team Building session using Amazon Leadership Principles'
    },
    
    // GAME INFO - Available for all game types
    { 
      name: 'eventTitle', 
      description: 'Title of the game/event as entered by the host', 
      category: 'Game Info',
      gameTypes: ['callandanswer', 'trivia', 'polls', 'wavelength'],
      example: 'Q4 Leadership Workshop, Friday Team Building'
    },
    { 
      name: 'gameType', 
      description: 'Type of engagement game being played', 
      category: 'Game Info',
      gameTypes: ['callandanswer', 'trivia', 'polls', 'wavelength'],
      example: 'call-and-answer, trivia, polls, wavelength'
    },
    { 
      name: 'gameId', 
      description: 'Unique identifier for this game session', 
      category: 'Game Info',
      gameTypes: ['callandanswer', 'trivia', 'polls', 'wavelength'],
      example: '1234, 5678'
    },
    { 
      name: 'sessionDuration', 
      description: 'How long the game session has been running', 
      category: 'Game Info',
      gameTypes: ['callandanswer', 'trivia', 'polls', 'wavelength'],
      example: '15 minutes, 32 seconds, 1 hour, 45 minutes'
    },
    { 
      name: 'currentRound', 
      description: 'Current question number being analyzed', 
      category: 'Game Info',
      gameTypes: ['callandanswer', 'trivia', 'polls', 'wavelength'],
      example: '1, 3, 15'
    },
    
    // PLAYER INFO - Available for all game types
    { 
      name: 'totalParticipants', 
      description: 'Total number of players who joined the game', 
      category: 'Player Info',
      gameTypes: ['callandanswer', 'trivia', 'polls', 'wavelength'],
      example: '12 players, 8 participants'
    },
    { 
      name: 'activeParticipants', 
      description: 'Number of players who participated in voting (call-and-answer only)', 
      category: 'Player Info',
      gameTypes: ['callandanswer'],
      example: '8 players voted, 6 active voters'
    },
    { 
      name: 'playerNames', 
      description: 'Comma-separated list of all player names', 
      category: 'Player Info',
      gameTypes: ['callandanswer', 'trivia', 'polls', 'wavelength'],
      example: 'Alice, Bob, Charlie, Diana'
    },
    { 
      name: 'playerRankings', 
      description: 'Formatted leaderboard with player rankings and scores', 
      category: 'Player Info',
      gameTypes: ['callandanswer', 'trivia'],
      example: '1st: Alice (15 pts), 2nd: Bob (12 pts), 3rd: Charlie (8 pts)'
    },
    { 
      name: 'topPerformers', 
      description: 'Top 3 players with highest scores', 
      category: 'Player Info',
      gameTypes: ['callandanswer', 'trivia'],
      example: 'Alice (15 pts), Bob (12 pts), Charlie (8 pts)'
    },
    
    // QUESTION INFO - Available for all game types
    { 
      name: 'question', 
      description: 'The main question text (title or questionDetail)', 
      category: 'Question Info',
      gameTypes: ['callandanswer', 'trivia', 'polls', 'wavelength'],
      example: 'Tell me about a time when you had to work with ambiguity'
    },
    { 
      name: 'questionTitle', 
      description: 'The question title or main prompt', 
      category: 'Question Info',
      gameTypes: ['callandanswer', 'trivia', 'polls', 'wavelength'],
      example: 'Working with Ambiguity, Leadership Challenge'
    },
    { 
      name: 'questionDetail', 
      description: 'Additional context and details about the question', 
      category: 'Question Info',
      gameTypes: ['callandanswer', 'trivia', 'polls', 'wavelength'],
      example: 'In this scenario, consider times when you didn\'t have all the information...'
    },
    { 
      name: 'questionCategory', 
      description: 'Category or theme of the current question', 
      category: 'Question Info',
      gameTypes: ['callandanswer', 'trivia', 'polls', 'wavelength'],
      example: 'Leadership, Problem Solving, Team Dynamics'
    },
    { 
      name: 'questionNumber', 
      description: 'Current question number in the session', 
      category: 'Question Info',
      gameTypes: ['callandanswer', 'trivia', 'polls', 'wavelength'],
      example: '1, 5, 12'
    },
    { 
      name: 'correctAnswer', 
      description: 'The correct answer for trivia questions', 
      category: 'Question Info',
      gameTypes: ['trivia'],
      example: 'The correct answer is B: Machine Learning'
    },
    { 
      name: 'triviaChoices', 
      description: 'All multiple choice options for trivia questions', 
      category: 'Question Info',
      gameTypes: ['trivia'],
      example: 'A: Artificial Intelligence, B: Machine Learning, C: Deep Learning, D: Neural Networks'
    },
    { 
      name: 'answerDetails', 
      description: 'Explanation of why the trivia answer is correct', 
      category: 'Question Info',
      gameTypes: ['trivia'],
      example: 'Machine Learning is a subset of AI that focuses on learning from data...'
    },
    { 
      name: 'difficulty', 
      description: 'Difficulty level of the question', 
      category: 'Question Info',
      gameTypes: ['trivia'],
      example: 'easy, medium, hard'
    },
    
    // ANSWERS - Available for call-and-answer and trivia
    { 
      name: 'playerAnswers', 
      description: 'All player responses to the question', 
      category: 'Answers',
      gameTypes: ['callandanswer', 'trivia'],
      example: 'Alice: "I approached the customer concern by...", Bob: "In my experience..."'
    },
    { 
      name: 'responseCount', 
      description: 'Number of players who submitted responses', 
      category: 'Answers',
      gameTypes: ['callandanswer', 'trivia', 'polls'],
      example: '8 responses, 12 participants answered'
    },
    { 
      name: 'responsesText', 
      description: 'Formatted list of all player responses with names', 
      category: 'Answers',
      gameTypes: ['callandanswer'],
      example: '1. Alice: "I approached this by...", 2. Bob: "My strategy was..."'
    },
    { 
      name: 'triviaResponses', 
      description: 'Trivia answers showing which choice each player selected', 
      category: 'Answers',
      gameTypes: ['trivia'],
      example: 'Alice: A (Incorrect), Bob: B (Correct), Charlie: C (Incorrect)'
    },
    { 
      name: 'correctCount', 
      description: 'Number of players who got the trivia question correct', 
      category: 'Answers',
      gameTypes: ['trivia'],
      example: '5 out of 8 players answered correctly'
    },
    
    // VOTES - Available for call-and-answer only
    { 
      name: 'voteCount', 
      description: 'Total number of votes cast', 
      category: 'Votes',
      gameTypes: ['callandanswer'],
      example: '24 total votes, 8 voting players'
    },
    { 
      name: 'votingParticipation', 
      description: 'Percentage of players who participated in voting', 
      category: 'Votes',
      gameTypes: ['callandanswer'],
      example: '75% voting participation, 100% participated'
    },
    { 
      name: 'consensusLevel', 
      description: 'Level of agreement among voters', 
      category: 'Votes',
      gameTypes: ['callandanswer'],
      example: 'Strong consensus, Moderate agreement, Diverse opinions'
    },
    
    // VOTE TALLY - Available for call-and-answer only
    { 
      name: 'voteTally', 
      description: 'Detailed breakdown of votes received by each response', 
      category: 'Vote Tally',
      gameTypes: ['callandanswer'],
      example: 'Alice: 3 first-place, 2 second-place votes (13 points), Bob: 1 first-place, 3 third-place votes (6 points)'
    },
    { 
      name: 'topVotedAnswers', 
      description: 'Top 3 most voted responses with vote details', 
      category: 'Vote Tally',
      gameTypes: ['callandanswer'],
      example: 'Alice\'s response (13 points), Bob\'s response (8 points), Charlie\'s response (5 points)'
    },
    
    // RESULTS - Available for call-and-answer and trivia
    { 
      name: 'finalResults', 
      description: 'Top 3 results with rankings and scores/correctness', 
      category: 'Results',
      gameTypes: ['callandanswer', 'trivia'],
      example: 'Alice: Leadership approach (13 points), Bob: Process improvement (8 points)'
    },
    { 
      name: 'winnerInfo', 
      description: 'Information about the winner(s) of this round', 
      category: 'Results',
      gameTypes: ['callandanswer', 'trivia'],
      example: 'Winner: Alice with "I approached the problem by..." (13 vote points)'
    },
    { 
      name: 'resultsSummary', 
      description: 'Summary of round results and participation', 
      category: 'Results',
      gameTypes: ['callandanswer', 'trivia', 'wavelength'],
      example: 'Clear winner with 54% of possible vote points, 5 out of 8 players answered correctly'
    },
    { 
      name: 'participationRate', 
      description: 'Participation statistics for answering and voting', 
      category: 'Results',
      gameTypes: ['callandanswer', 'trivia'],
      example: '100% answered, 75% voted'
    },
    { 
      name: 'triviaCorrectness', 
      description: 'Correctness summary for trivia questions', 
      category: 'Results',
      gameTypes: ['trivia'],
      example: '5 correct answers, 3 incorrect answers (62% accuracy)'
    },
    
    // SCORES - Available for call-and-answer and trivia
    { 
      name: 'cumulativeScores', 
      description: 'All player scores accumulated across all rounds', 
      category: 'Scores',
      gameTypes: ['callandanswer', 'trivia'],
      example: 'Alice: 28 points, Bob: 22 points, Charlie: 15 points'
    },
    { 
      name: 'scoreChanges', 
      description: 'Points earned by each player in this specific round', 
      category: 'Scores',
      gameTypes: ['callandanswer', 'trivia'],
      example: 'Alice: +13 points, Bob: +8 points, Charlie: +5 points'
    },
    { 
      name: 'leaderboard', 
      description: 'Current top 5 players with rankings and total scores', 
      category: 'Scores',
      gameTypes: ['callandanswer', 'trivia'],
      example: '1st: Alice (28 pts), 2nd: Bob (22 pts), 3rd: Charlie (15 pts)'
    },
    { 
      name: 'averageScore', 
      description: 'Average score across all players', 
      category: 'Scores',
      gameTypes: ['callandanswer', 'trivia'],
      example: '18.5 points, 12.3 points'
    },
    
    // WAVELENGTH SPECIFIC - Available for wavelength only
    { 
      name: 'wavelengthTopic', 
      description: 'The topic or prompt players associated words with', 
      category: 'Wavelength',
      gameTypes: ['wavelength'],
      example: 'Innovation, Leadership, Teamwork'
    },
    { 
      name: 'wavelengthWords', 
      description: 'All words submitted by players for the wavelength topic', 
      category: 'Wavelength',
      gameTypes: ['wavelength'],
      example: 'Alice: creativity, solutions, breakthrough; Bob: change, ideas, progress'
    },
    { 
      name: 'commonWords', 
      description: 'Words that multiple players thought of (team alignment)', 
      category: 'Wavelength',
      gameTypes: ['wavelength'],
      example: 'creativity, innovation, ideas, solutions'
    },
    { 
      name: 'commonWordsCount', 
      description: 'Number of words that showed team alignment', 
      category: 'Wavelength',
      gameTypes: ['wavelength'],
      example: '4 common words, 7 shared concepts'
    },
    { 
      name: 'connectionScore', 
      description: 'Percentage showing how aligned the team\'s thinking was', 
      category: 'Wavelength',
      gameTypes: ['wavelength'],
      example: '65% connection rate, 42% team alignment'
    },
    { 
      name: 'teamScore', 
      description: 'Team\'s collective score for the wavelength round', 
      category: 'Wavelength',
      gameTypes: ['wavelength'],
      example: '4 points (one per common word), 7 team points'
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
      
      const response = await authFetch(endpoint, {
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

  // Magic wand AI generation handler
  const handleGenerateWithAI = async () => {
    if (!formData.gameType) {
      alert('Please select a game type first');
      return;
    }

    setIsGeneratingWithAI(true);
    
    // Save current values for revert functionality
    setSavedInstructions(formData.instructions);
    setSavedOutputFormat(formData.outputFormat);

    try {
      const response = await authFetch(`${API_BASE}admin/ai-generate-prompt`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          gameType: formData.gameType,
          category: formData.category || 'general',
          currentInstructions: formData.instructions,
          currentOutputFormat: formData.outputFormat,
          promptName: formData.name,
          description: formData.description
        })
      });

      if (!response.ok) {
        throw new Error('Failed to generate AI prompt');
      }

      const result = await response.json();
      
      // Ensure response fields are strings, not objects
      const safeInstructions = typeof result.instructions === 'string' 
        ? result.instructions 
        : (result.instructions ? JSON.stringify(result.instructions, null, 2) : '');
      
      const safeOutputFormat = typeof result.outputFormat === 'string' 
        ? result.outputFormat 
        : (result.outputFormat ? JSON.stringify(result.outputFormat, null, 2) : '');
      
      // Update the form with generated content
      setFormData(prev => ({
        ...prev,
        instructions: safeInstructions || prev.instructions,
        outputFormat: safeOutputFormat || prev.outputFormat
      }));

    } catch (error) {
      console.error('Error generating AI prompt:', error);
      alert('Failed to generate AI prompt: ' + error.message);
    } finally {
      setIsGeneratingWithAI(false);
    }
  };

  // Revert to saved values
  const handleRevert = () => {
    setFormData(prev => ({
      ...prev,
      instructions: savedInstructions,
      outputFormat: savedOutputFormat
    }));
    
    // Clear saved values
    setSavedInstructions('');
    setSavedOutputFormat('');
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
            <div className="label-with-actions">
              <label>1. General Instructions *</label>
              <div className="magic-wand-actions">
                <button 
                  type="button" 
                  className="magic-wand-btn"
                  onClick={handleGenerateWithAI}
                  disabled={isGeneratingWithAI || !formData.gameType}
                  title="Generate AI-powered prompt based on game type and category"
                >
                  {isGeneratingWithAI
                    ? <Icon name="Timer" weight="bold" size={16} color="var(--muted)" />
                    : <Icon name="MagicWand" weight="duotone" size={16} color="var(--primary)" />}
                  {' '}AI Generate
                </button>
                {(savedInstructions || savedOutputFormat) && (
                  <button 
                    type="button" 
                    className="revert-btn"
                    onClick={handleRevert}
                    title="Restore your original text"
                  >
                    <Icon name="ArrowCounterClockwise" weight="bold" size={16} color="currentColor" /> Revert
                  </button>
                )}
              </div>
            </div>
            <textarea
              value={formData.instructions}
              onChange={(e) => setFormData({ ...formData, instructions: e.target.value })}
              placeholder="Example: You are a Developer Consultant that provides deep thoughtful expertise on how to deploy code and develop products. You provide detailed answers and speak clearly, explaining any jargon to make sure everyone's on the same page."
              rows="4"
              required
            />
            <small className="form-help">
              Define the AI's persona, expertise, and communication style. Click "AI Generate" to create a prompt based on your game type and category.
            </small>
          </div>

          <div className="form-group template-group">
            <label>2. Output Format (Markdown) *</label>
            <div className="template-editor-container">
              <div className="template-variables-panel">
                <h4><Icon name="NotePencil" weight="bold" size={16} color="currentColor" /> Available Variables</h4>
                <p className="variables-help">
                  Click to insert into output format:<br />
                  <small><strong><Icon name="Lightbulb" weight="duotone" size={16} color="var(--primary)" /> Markdown Support:</strong> Use ## Headers, **bold**, *italic*, `code`, and | tables | for | formatting |</small>
                  <br />
                  <small><strong><Icon name="Target" weight="duotone" size={16} color="var(--primary)" /> Game Type:</strong> {formData.gameType} - Variables marked with <Icon name="Warning" weight="fill" size={16} color="var(--primary)" /> are not available for this game type</small>
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
                              {!isAvailable && <Icon name="Warning" weight="fill" size={13} color="var(--primary)" />}
                              {isTriviaMostly && formData.gameType === 'trivia' && <Icon name="Brain" weight="bold" size={13} />}
                              {isCallAnswerOnly && formData.gameType === 'callandanswer' && <Icon name="ChatCircleText" weight="bold" size={13} />}
                              {' '}
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
                  placeholder="Example output format with Markdown formatting:

## Key Insights from {eventTitle}
Analyze the **{responseCount} responses** from participants who answered: *{questionTitle}*

### Top Responses:
{responsesText}

## Strategic Implications
Based on the **{winnerInfo}**, here are strategic implications:

1. **Leadership Alignment**: How responses demonstrate team thinking
2. **Process Improvement**: Areas for operational enhancement  
3. **Culture Insights**: What responses reveal about team culture

## Recommended Actions
Priority actions based on `{sessionContext}`:

| Priority | Action | Owner | Timeline |
|----------|--------|--------|----------|
| High | Follow up on winning response | Team Lead | 1 week |
| Medium | Address common themes | Manager | 2 weeks |
| Low | Document lessons learned | Team | 1 month |

**Bold text**, *italic text*, `inline code`, and tables are supported!

Click variable buttons to insert them into your output format."
                  rows="12"
                  required
                />
              </div>
            </div>
            <small className="form-help">
              Click the variable buttons to insert them into your output format. Variables will be replaced with actual content when the AI summary is generated. Supports full Markdown formatting including headers, bold, italic, code, and tables.
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
    { value: 'improve', label: 'Improve Prompt', icon: 'Sparkle' },
    { value: 'validate', label: 'Validate Quality', icon: 'MagnifyingGlass' },
    { value: 'optimize', label: 'Optimize Performance', icon: 'Lightning' }
  ];

  const runAnalysis = async () => {
    setIsAnalyzing(true);
    setAnalysis(null);

    try {
      const response = await authFetch(`${API_BASE}admin/ai-prompt-advisor`, {
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
          <h2><Icon name="MagicWand" weight="duotone" size={16} color="var(--primary)" /> AI Prompt Advisor</h2>
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
                <span className="type-icon"><Icon name={type.icon} weight="duotone" size={18} color="var(--primary)" /></span>
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
                  <h4><Icon name="Sparkle" weight="fill" size={16} color="var(--primary)" /> Improved Prompt</h4>
                  <div className="improved-prompt">
                    <pre>{analysis.improvedPrompt}</pre>
                    <div className="improved-prompt-actions">
                      <button 
                        className="btn-secondary copy-btn"
                        onClick={() => navigator.clipboard.writeText(analysis.improvedPrompt)}
                      >
                        <Icon name="ClipboardText" weight="bold" size={16} color="currentColor" /> Copy to Clipboard
                      </button>
                      <button 
                        className="btn-primary apply-btn"
                        onClick={() => {
                          onApplyImprovedPrompt(analysis.improvedPrompt);
                          onClose();
                        }}
                      >
                        <Icon name="Sparkle" weight="fill" size={16} color="var(--primary)" /> Apply to Prompt
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {analysis.overallScore && (
                <div className="result-section">
                  <h4><Icon name="ChartBar" weight="duotone" size={16} color="var(--primary)" /> Overall Score</h4>
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
                  <h4>Strengths</h4>
                  <ul className="analysis-list">
                    {analysis.strengths.map((strength, idx) => (
                      <li key={idx}>{strength}</li>
                    ))}
                  </ul>
                </div>
              )}

              {analysis.improvements && (
                <div className="result-section">
                  <h4><Icon name="NotePencil" weight="bold" size={16} color="currentColor" /> Improvements</h4>
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
                  <h4><Icon name="ArrowsClockwise" weight="bold" size={16} color="currentColor" /> Alternative Approaches</h4>
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
                  <h4><Icon name="Lightbulb" weight="duotone" size={16} color="var(--primary)" /> Recommendations</h4>
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
      const response = await authFetch(`${API_BASE}admin/ai-prompts?includeContent=true`);
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
      const response = await authFetch(`${API_BASE}admin/ai-prompts/${promptId}`, {
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
      const response = await authFetch(`${API_BASE}admin/populate-defaults`, {
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
        <h2><Icon name="Sparkle" weight="duotone" size={16} color="var(--primary)" /> AI Prompt Management</h2>
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
            <Icon name="Target" weight="duotone" size={16} color="var(--primary)" /> Populate Default Prompts
          </button>
          <button 
            className="btn-primary create-prompt-btn"
            onClick={() => setIsCreating(true)}
          >
            <Icon name="Plus" weight="bold" size={16} color="currentColor" /> Create New Prompt
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
                    <Icon name="PencilSimple" weight="bold" size={16} color="currentColor" />
                  </button>
                  <button
                    className="btn-icon"
                    onClick={() => setAdvisorPrompt(prompt)}
                    title="AI Advisor"
                  >
                    <Icon name="MagicWand" weight="duotone" size={16} color="var(--primary)" />
                  </button>
                  <button
                    className="btn-icon delete"
                    onClick={() => handleDeletePrompt(prompt.promptId)}
                    title="Archive"
                  >
                    <Icon name="Trash" weight="bold" size={16} color="currentColor" />
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