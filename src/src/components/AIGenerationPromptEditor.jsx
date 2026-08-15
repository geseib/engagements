import React, { useState, useEffect, useMemo } from 'react';
import './AIPromptManager.css';
import { authFetch } from '../auth/authFetch';
import { normalizeGameType } from '../config/gameTypes';
import Icon from './Icon';
import PromptLibraryPanel from './PromptLibraryPanel';

const API_BASE = window.API_BASE;

/*
  THE THIRD PROMPT UI IS GONE — AUDIT §6.2 item 9, admin RATIONALE §9.

  This screen used to draw its own `.prompts-grid` of `.prompt-card`s: one card
  per generation prompt carrying name, status, description, game type, scenario
  type, tags and an Edit button. That is the wall of cards the sets screen threw
  out (RATIONALE §4, design rule 7 — "Lists are tables, not cards"), and it was
  the THIRD list UI over the one `AIPROMPTS` table, with its own status-badge
  scheme and its own game-type list.

  It now mounts `PromptLibraryPanel`, the same table the summary library uses.
  Nothing the cards showed was dropped:

    card                       →  table
    ------------------------------------------------------------------
    <h4>{name}</h4>            →  .plib-nm, the first column
    .prompt-description        →  .plib-sub, under the name
    .status-badge {status}     →  the State column's status chip
    .game-type                 →  the Type column, through gameTypeLabel()
    .scenario-type (raw slug)  →  the Scenario column, through its LABEL
    .default-badge             →  the Default chip, which now says what it costs
    .tag                       →  .plib-tag, under the name
    Edit                       →  the row's Edit action

  And four things arrive that the card grid never had: a search box, a second
  empty state for "your filters exclude everything", one-click exits from each
  filter that is costing rows, and a "Broken record" chip for the rows
  `populate-generation-prompts.js` wrote with no `promptId`
  (`get-ai-prompts.js:118-119`) — which are exactly the rows that write a
  dangling reference into a question set when picked.

  WHAT THE PANEL HAD TO BE TOLD, and why it is props rather than a fork: these
  records spell the second axis `scenarioType`, not `category`, and their
  scenario slugs have written labels; and `summaryPromptStatus: 'unusable'` is
  true of every row on a list filtered to generation prompts, so its chip is
  suppressed here. See the header block in PromptLibraryPanel.jsx.
*/

/** Canonical dashed ids, the vocabulary `config/gameTypes.js` and
 *  AIPromptManager already use. `survey` is absent because no generation
 *  prompt is written for it — the create form offers the same four. */
const GAME_TYPE_OPTIONS = [
  { value: 'call-and-answer', label: 'Call & Answer' },
  { value: 'trivia', label: 'Trivia' },
  { value: 'poll', label: 'Polls' },
  { value: 'wavelength', label: 'Wavelength' }
];

function AIGenerationPromptEditor({ onClose }) {
  const [prompts, setPrompts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedPrompt, setSelectedPrompt] = useState(null);
  const [isEditing, setIsEditing] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  /*
    `category` is the panel's name for the second filter axis; on these records
    it holds a `scenarioType` slug, which is what `categoryKey` tells the panel.
    No `promptType` key: the fetch below pins it to `generation` server-side, so
    carrying it in the filter object made it look adjustable when it is not.
  */
  const [filters, setFilters] = useState({
    search: '',
    gameType: 'all',
    category: 'all',
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

  /*
    THE SCENARIO OPTIONS FOR THE CURRENT GAME TYPE. Derived here, from the same
    table the create form uses, so the panel stays free of this vocabulary —
    the arrangement AIPromptManager already uses for its categories.

    With no game type chosen the union is offered rather than nothing: the old
    grid's scenario select was EMPTY unless a game type was picked first, so
    "show me every lessons-learned prompt" was two steps or none.
  */
  const scenarioOptions = useMemo(() => {
    const lists = filters.gameType === 'all'
      ? Object.values(scenarioTypeOptions)
      : [scenarioTypeOptions[normalizeGameType(filters.gameType)] || []];
    const seen = new Map();
    lists.flat().forEach((o) => { if (!seen.has(o.value)) seen.set(o.value, o); });
    return [...seen.values()];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters.gameType]);

  useEffect(() => {
    fetchPrompts();
  }, []);

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

  /*
    THE FILTER IS `matchesPromptFilters` NOW, not a private copy of it. The
    local one had to normalize game types by hand for the same reason the
    shared one does — legacy rows spell it `callandanswer` / `polls` — and a
    second implementation is a second place for that to be forgotten. It is
    also the function the drop-exit counts are computed from, so the counts
    cannot disagree with the list they describe.
  */

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
              /*
                The filter controls come with the panel — the three selects and
                the search box are one arrangement, and splitting them across
                two components is how the old grid ended up with a scenario
                select that was empty until a game type was chosen.

                No `onAdvise`, no `onDelete`, no `onPopulateDefaults`: this
                screen has never had an advisor, a delete endpoint wired up or a
                defaults installer, and the panel draws only the controls whose
                handler exists (design rule 2).
              */
              <PromptLibraryPanel
                prompts={prompts}
                loading={loading}
                filters={filters}
                onFilterChange={setFilters}
                gameTypeOptions={GAME_TYPE_OPTIONS}
                categoryOptions={scenarioOptions}
                categoryKey="scenarioType"
                categoryHeading="Scenario"
                categoryFilterAllLabel="All Scenario Types"
                flagSummaryUsability={false}
                emptyHeading="No generation prompts yet"
                emptyBody={
                  'A generation prompt is the instruction the AI is given when it writes a new '
                  + 'question set. Until one exists for an engagement type and scenario, the '
                  + 'builder falls back to the template compiled into the code.'
                }
                onEdit={handleEditPrompt}
                onCreate={handleCreateNew}
              />
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