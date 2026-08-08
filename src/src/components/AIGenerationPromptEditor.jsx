import React, { useState, useEffect } from 'react';
import './AIPromptManager.css';
import { authFetch } from '../auth/authFetch';
import { normalizeGameType } from '../config/gameTypes';
import Icon from './Icon';

const API_BASE = window.API_BASE;

function AIGenerationPromptEditor({ onClose }) {
  const [prompts, setPrompts] = useState([]);
  const [filteredPrompts, setFilteredPrompts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedPrompt, setSelectedPrompt] = useState(null);
  const [isEditing, setIsEditing] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [filters, setFilters] = useState({
    promptType: 'generation',
    gameType: 'all',
    scenarioType: 'all',
    status: 'all'
  });

  // New prompt form state
  const [newPrompt, setNewPrompt] = useState({
    promptType: 'generation',
    gameType: 'call-and-answer',
    name: '',
    description: '',
    basePrompt: '',
    contextTemplate: '\n\nContext: {context}',
    audienceTemplate: '\nAudience: {audience}',
    categoryTemplate: '\nOrganize scenarios into {numberOfCategories} categories.\nMust include these categories: {mustHaveCategories}',
    outputFormat: '\n\nReturn as JSON array: [{"title": "Title", "category": "Category", "detail": "Description", "school": "Professional Development", "customInstructions": "Instructions"}]\nReturn ONLY the JSON array.',
    defaultSettings: {
      difficulty: 'medium',
      numberOfCategories: 3,
      mustHaveCategories: '',
      sampleCategories: '',
      contextPlaceholder: '',
      audiencePlaceholder: ''
    },
    status: 'active',
    isDefault: false,
    tags: []
  });

  const [tagInput, setTagInput] = useState('');

  // Scenario type options by game type
  const scenarioTypeOptions = {
    'call-and-answer': [
      { value: 'lessons-learned', label: 'Lessons Learned' },
      { value: 'problem-solving', label: 'Problem Solving' },
      { value: 'interview-prep', label: 'Interview Preparation' },
      { value: 'amazon-principles', label: 'Amazon Leadership Principles' },
      { value: 'team-building', label: 'Team Building' },
      { value: 'custom', label: 'Custom Scenarios' }
    ],
    'trivia': [
      { value: 'general-knowledge', label: 'General Knowledge' },
      { value: 'subject-specific', label: 'Subject Specific' },
      { value: 'workplace-trivia', label: 'Workplace & Business' },
      { value: 'fun-facts', label: 'Fun Facts' },
      { value: 'custom-trivia', label: 'Custom Topics' },
      { value: 'custom', label: 'Custom Scenarios (Minimal Pre-prompt)' }
    ],
    'poll': [
      { value: 'opinion-polls', label: 'Opinion & Preference' },
      { value: 'decision-making', label: 'Decision Making' },
      { value: 'feedback-polls', label: 'Feedback & Assessment' },
      { value: 'icebreaker-polls', label: 'Icebreaker & Team' },
      { value: 'custom-polls', label: 'Custom Topics' },
      { value: 'custom', label: 'Custom Scenarios (Minimal Pre-prompt)' }
    ],
    'wavelength': [
      { value: 'tech-terms', label: 'Technology Terms' },
      { value: 'business-concepts', label: 'Business Concepts' },
      { value: 'lists-favorites', label: 'Lists & Favorites' },
      { value: 'brainstorming', label: 'Brainstorming' },
      { value: 'icebreakers-fun', label: 'Icebreakers & Fun' },
      { value: 'custom', label: 'Custom Scenarios (Minimal Pre-prompt)' }
    ]
  };

  useEffect(() => {
    fetchPrompts();
  }, []);

  useEffect(() => {
    applyFilters();
  }, [prompts, filters]);

  const fetchPrompts = async () => {
    try {
      setLoading(true);
      // D16: get-ai-prompts.js used to ignore this param entirely, so this
      // "generation only" list actually contained every prompt in the table,
      // summary prompts included. It is honoured now.
      const params = new URLSearchParams({
        promptType: 'generation'
      });


      const response = await authFetch(`${API_BASE}admin/ai-prompts?${params}`);
      const data = await response.json();
      
      if (response.ok) {
        setPrompts(data.prompts || []);
      } else {
        console.error('Failed to fetch prompts:', data.error);
        setPrompts([]);
      }
    } catch (error) {
      console.error('Error fetching prompts:', error);
      setPrompts([]);
    } finally {
      setLoading(false);
    }
  };

  const applyFilters = () => {
    let filtered = [...prompts];

    if (filters.gameType !== 'all') {
      // Legacy rows still spell this `callandanswer` / `polls`; the backend now
      // returns a normalized gameType but normalize here too so this list is
      // correct even against an older API response.
      const wanted = normalizeGameType(filters.gameType);
      filtered = filtered.filter(prompt => normalizeGameType(prompt.gameType) === wanted);
    }

    if (filters.scenarioType !== 'all') {
      filtered = filtered.filter(prompt => prompt.scenarioType === filters.scenarioType);
    }

    if (filters.status !== 'all') {
      filtered = filtered.filter(prompt => prompt.status === filters.status);
    }

    setFilteredPrompts(filtered);
  };

  const handleSavePrompt = async () => {
    try {
      const promptToSave = isEditing ? { ...selectedPrompt } : { ...newPrompt };
      
      const response = await authFetch(`${API_BASE}admin/ai-prompts/save`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(promptToSave)
      });

      const data = await response.json();
      
      if (response.ok) {
        console.log('✅ Prompt saved successfully');
        setIsEditing(false);
        setIsCreating(false);
        setSelectedPrompt(null);
        setNewPrompt({
          promptType: 'generation',
          gameType: 'call-and-answer',
          name: '',
          description: '',
          basePrompt: '',
          contextTemplate: '\n\nContext: {context}',
          audienceTemplate: '\nAudience: {audience}',
          categoryTemplate: '\nOrganize scenarios into {numberOfCategories} categories.\nMust include these categories: {mustHaveCategories}',
          outputFormat: '\n\nReturn as JSON array: [{"title": "Title", "category": "Category", "detail": "Description", "school": "Professional Development", "customInstructions": "Instructions"}]\nReturn ONLY the JSON array.',
          defaultSettings: {
            difficulty: 'medium',
            numberOfCategories: 3,
            mustHaveCategories: '',
            sampleCategories: '',
            contextPlaceholder: '',
            audiencePlaceholder: ''
          },
          status: 'active',
          isDefault: false,
          tags: []
        });
        fetchPrompts(); // Refresh the list
      } else {
        console.error('Failed to save prompt:', data.error);
        alert('Failed to save prompt: ' + data.message);
      }
    } catch (error) {
      console.error('Error saving prompt:', error);
      alert('Error saving prompt: ' + error.message);
    }
  };

  const handleEditPrompt = (prompt) => {
    setSelectedPrompt({ ...prompt });
    setIsEditing(true);
    setIsCreating(false);
  };

  const handleCreateNew = () => {
    setIsCreating(true);
    setIsEditing(false);
    setSelectedPrompt(null);
  };

  const handleCancel = () => {
    setIsEditing(false);
    setIsCreating(false);
    setSelectedPrompt(null);
  };

  const addTag = (prompt, isNew = false) => {
    if (tagInput.trim()) {
      const targetPrompt = isNew ? newPrompt : selectedPrompt;
      const updatedTags = [...(targetPrompt.tags || []), tagInput.trim()];
      
      if (isNew) {
        setNewPrompt({ ...newPrompt, tags: updatedTags });
      } else {
        setSelectedPrompt({ ...selectedPrompt, tags: updatedTags });
      }
      
      setTagInput('');
    }
  };

  const removeTag = (tagToRemove, prompt, isNew = false) => {
    const targetPrompt = isNew ? newPrompt : selectedPrompt;
    const updatedTags = targetPrompt.tags.filter(tag => tag !== tagToRemove);
    
    if (isNew) {
      setNewPrompt({ ...newPrompt, tags: updatedTags });
    } else {
      setSelectedPrompt({ ...selectedPrompt, tags: updatedTags });
    }
  };

  if (loading) {
    return (
      <div className="ai-prompt-editor-modal">
        <div className="modal-overlay" onClick={onClose}>
          <div className="modal-content large-modal">
            <div className="loading-spinner">Loading prompts...</div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="ai-prompt-editor-modal">
      <div className="modal-overlay" onClick={onClose}>
        <div className="modal-content large-modal" onClick={(e) => e.stopPropagation()}>
          <div className="modal-header">
            <h2><Icon name="Sparkle" weight="duotone" size={16} color="var(--primary)" /> AI Generation Prompt Editor</h2>
            <button className="close-button" onClick={onClose}><Icon name="X" weight="bold" size={16} color="currentColor" /></button>
          </div>

          <div className="modal-body">
            {!isEditing && !isCreating && (
              <>
                {/* Filters */}
                <div className="filters-section">
                  <div className="filter-row">
                    <label>
                      Game Type:
                      <select
                        value={filters.gameType}
                        onChange={(e) => setFilters({ ...filters, gameType: e.target.value })}
                      >
                        <option value="all">All Game Types</option>
                        <option value="call-and-answer">Call & Answer</option>
                        <option value="trivia">Trivia</option>
                        <option value="poll">Polls</option>
                        <option value="wavelength">Wavelength</option>
                      </select>
                    </label>
                    
                    <label>
                      Scenario Type:
                      <select
                        value={filters.scenarioType}
                        onChange={(e) => setFilters({ ...filters, scenarioType: e.target.value })}
                      >
                        <option value="all">All Scenario Types</option>
                        {filters.gameType !== 'all' && scenarioTypeOptions[filters.gameType]?.map(option => (
                          <option key={option.value} value={option.value}>{option.label}</option>
                        ))}
                      </select>
                    </label>

                    <label>
                      Status:
                      <select
                        value={filters.status}
                        onChange={(e) => setFilters({ ...filters, status: e.target.value })}
                      >
                        <option value="all">All Statuses</option>
                        <option value="active">Active</option>
                        <option value="draft">Draft</option>
                        <option value="archived">Archived</option>
                      </select>
                    </label>

                    <button className="btn-primary" onClick={handleCreateNew}>
                      <Icon name="Plus" weight="bold" size={16} color="currentColor" /> Create New Prompt
                    </button>
                  </div>
                </div>

                {/* Prompts List */}
                <div className="prompts-list">
                  <h3>Generation Prompts ({filteredPrompts.length})</h3>
                  {filteredPrompts.length === 0 ? (
                    <p>No prompts found matching the current filters.</p>
                  ) : (
                    <div className="prompts-grid">
                      {filteredPrompts.map((prompt) => (
                        <div key={prompt.SK} className="prompt-card">
                          <div className="prompt-header">
                            <h4>{prompt.name}</h4>
                            <span className={`status-badge ${prompt.status}`}>
                              {prompt.status}
                            </span>
                          </div>
                          <p className="prompt-description">{prompt.description}</p>
                          <div className="prompt-meta">
                            <span className="game-type">{prompt.gameType}</span>
                            <span className="scenario-type">{prompt.scenarioType}</span>
                            {prompt.isDefault && <span className="default-badge">Default</span>}
                          </div>
                          <div className="prompt-tags">
                            {prompt.tags?.map((tag, index) => (
                              <span key={index} className="tag">{tag}</span>
                            ))}
                          </div>
                          <div className="prompt-actions">
                            <button 
                              className="btn-secondary"
                              onClick={() => handleEditPrompt(prompt)}
                            >
                              Edit
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </>
            )}

            {/* Edit/Create Form */}
            {(isEditing || isCreating) && (
              <div className="prompt-edit-form">
                <h3>{isCreating ? 'Create New Prompt' : 'Edit Prompt'}</h3>
                
                {/* Use the appropriate prompt object */}
                {(() => {
                  const currentPrompt = isCreating ? newPrompt : selectedPrompt;
                  const updatePrompt = isCreating 
                    ? (updates) => setNewPrompt({ ...newPrompt, ...updates })
                    : (updates) => setSelectedPrompt({ ...selectedPrompt, ...updates });

                  return (
                    <div className="form-grid">
                      <div className="form-group">
                        <label>Game Type *</label>
                        <select
                          value={currentPrompt.gameType}
                          onChange={(e) => updatePrompt({ gameType: e.target.value, scenarioType: '' })}
                        >
                          <option value="call-and-answer">Call & Answer</option>
                          <option value="trivia">Trivia</option>
                          <option value="poll">Polls</option>
                          <option value="wavelength">Wavelength</option>
                        </select>
                      </div>


                      <div className="form-group full-width">
                        <label>Name *</label>
                        <input
                          type="text"
                          value={currentPrompt.name}
                          onChange={(e) => updatePrompt({ name: e.target.value })}
                          placeholder="Prompt name"
                        />
                      </div>

                      <div className="form-group full-width">
                        <label>Description</label>
                        <textarea
                          value={currentPrompt.description}
                          onChange={(e) => updatePrompt({ description: e.target.value })}
                          placeholder="Describe what this prompt generates"
                          rows="2"
                        />
                      </div>

                      <div className="form-group full-width">
                        <label>Base Prompt *</label>
                        <textarea
                          value={currentPrompt.basePrompt}
                          onChange={(e) => updatePrompt({ basePrompt: e.target.value })}
                          placeholder="Core generation instruction"
                          rows="3"
                        />
                      </div>

                      <div className="form-group">
                        <label>Context Template</label>
                        <textarea
                          value={currentPrompt.contextTemplate}
                          onChange={(e) => updatePrompt({ contextTemplate: e.target.value })}
                          placeholder="Template for adding context (use {context})"
                          rows="2"
                        />
                      </div>

                      <div className="form-group">
                        <label>Audience Template</label>
                        <textarea
                          value={currentPrompt.audienceTemplate}
                          onChange={(e) => updatePrompt({ audienceTemplate: e.target.value })}
                          placeholder="Template for adding audience (use {audience})"
                          rows="2"
                        />
                      </div>

                      <div className="form-group full-width">
                        <label>Category Template</label>
                        <textarea
                          value={currentPrompt.categoryTemplate}
                          onChange={(e) => updatePrompt({ categoryTemplate: e.target.value })}
                          placeholder="Template for category requirements (use {numberOfCategories}, {mustHaveCategories})"
                          rows="2"
                        />
                      </div>

                      <div className="form-group full-width">
                        <label>Output Format *</label>
                        <textarea
                          value={currentPrompt.outputFormat}
                          onChange={(e) => updatePrompt({ outputFormat: e.target.value })}
                          placeholder="JSON format specification"
                          rows="3"
                        />
                      </div>

                      <div className="form-group">
                        <label>Status</label>
                        <select
                          value={currentPrompt.status}
                          onChange={(e) => updatePrompt({ status: e.target.value })}
                        >
                          <option value="active">Active</option>
                          <option value="draft">Draft</option>
                          <option value="archived">Archived</option>
                        </select>
                      </div>

                      <div className="form-group">
                        <label>
                          <input
                            type="checkbox"
                            checked={currentPrompt.isDefault}
                            onChange={(e) => updatePrompt({ isDefault: e.target.checked })}
                          />
                          Default prompt for this type
                        </label>
                      </div>

                      <div className="form-group">
                        <label>Sample Categories</label>
                        <input
                          type="text"
                          value={currentPrompt.defaultSettings?.sampleCategories || ''}
                          onChange={(e) => updatePrompt({ 
                            defaultSettings: { 
                              ...currentPrompt.defaultSettings, 
                              sampleCategories: e.target.value 
                            }
                          })}
                          placeholder="Movies, History, Literature, Music..."
                        />
                      </div>

                      <div className="form-group">
                        <label>Context Placeholder</label>
                        <input
                          type="text"
                          value={currentPrompt.defaultSettings?.contextPlaceholder || ''}
                          onChange={(e) => updatePrompt({ 
                            defaultSettings: { 
                              ...currentPrompt.defaultSettings, 
                              contextPlaceholder: e.target.value 
                            }
                          })}
                          placeholder="e.g., Famous quotes from movies, historical speeches..."
                        />
                      </div>

                      <div className="form-group">
                        <label>Audience Placeholder</label>
                        <input
                          type="text"
                          value={currentPrompt.defaultSettings?.audiencePlaceholder || ''}
                          onChange={(e) => updatePrompt({ 
                            defaultSettings: { 
                              ...currentPrompt.defaultSettings, 
                              audiencePlaceholder: e.target.value 
                            }
                          })}
                          placeholder="e.g., Team members, trivia enthusiasts..."
                        />
                      </div>

                      <div className="form-group full-width">
                        <label>Tags</label>
                        <div className="tags-input">
                          <input
                            type="text"
                            value={tagInput}
                            onChange={(e) => setTagInput(e.target.value)}
                            placeholder="Add a tag"
                            onKeyPress={(e) => e.key === 'Enter' && (e.preventDefault(), addTag(currentPrompt, isCreating))}
                          />
                          <button 
                            type="button"
                            onClick={() => addTag(currentPrompt, isCreating)}
                          >
                            Add
                          </button>
                        </div>
                        <div className="tags-list">
                          {currentPrompt.tags?.map((tag, index) => (
                            <span key={index} className="tag">
                              {tag}
                              <button 
                                type="button"
                                onClick={() => removeTag(tag, currentPrompt, isCreating)}
                              >
                                ×
                              </button>
                            </span>
                          ))}
                        </div>
                      </div>
                    </div>
                  );
                })()}

                <div className="form-actions">
                  <button className="btn-secondary" onClick={handleCancel}>
                    Cancel
                  </button>
                  <button className="btn-primary" onClick={handleSavePrompt}>
                    {isCreating ? 'Create Prompt' : 'Save Changes'}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default AIGenerationPromptEditor;