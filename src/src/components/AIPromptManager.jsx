import React, { useState, useEffect, useMemo } from 'react';
import './AIPromptManager.css';
import { authFetch } from '../auth/authFetch';
import { normalizeGameType } from '../config/gameTypes';
import {
  unknownVariableTokens,
  extractVariableTokens,
} from '../config/templateVariables';
import Icon from './Icon';
import PromptVariableInspector, { DEFAULT_ROOM_SIZE } from './PromptVariableInspector';
import PromptAssembledPreview from './PromptAssembledPreview';
import PromptPreflightPanel, { blocksSave } from './PromptPreflightPanel';

const API_BASE = window.API_BASE;

/**
 * `utils/promptPreflight.js`, if this build has it.
 *
 * It is owned by another stream and may not be present. A literal
 * `require('../utils/promptPreflight')` — even inside a try/catch — is a
 * webpack build ERROR when the file is absent, not a catchable one, and `npm
 * run build` must compile today. Composing the specifier makes it a runtime
 * context lookup instead, so a missing module degrades to `null` and the panel
 * says the checks did not run.
 *
 * Contract, fixed, and the panel is written against it:
 *   preflightPrompt({ instructions, outputFormat, outputSections, template,
 *                     gameType, isDefault, targetModel })
 *     => { blocking, silent, advisory, stats }
 */
/**
 * The model a summary prompt is actually read by, and it is not the model that
 * helped write it. `get-ai-summary.js:2267` invokes
 * `us.anthropic.claude-haiku-4-5-20251001-v1:0` with `max_tokens: 1024` and
 * `temperature: 0.5`. The dry run's §D.1 is binding: a prompt that behaves on a
 * large model may ramble or manufacture consensus here, so the preflight is
 * told which model it is grading for rather than assuming.
 */
const SUMMARY_MODEL_ID = 'claude-haiku-4-5-20251001';

const PREFLIGHT_MODULE = 'promptPreflight';
function loadPreflight() {
  try {
    // A DELIBERATE dynamic require: the preflight module is optional and this
    // returns null rather than failing the editor when it is absent. (Was a
    // disable directive for import/no-dynamic-require and global-require;
    // neither rule is configured, and a directive naming an unknown rule is an
    // error in itself.)
    const mod = require(`../utils/${PREFLIGHT_MODULE}`);
    const fn = mod && (mod.preflightPrompt || (mod.default && mod.default.preflightPrompt));
    return typeof fn === 'function' ? fn : null;
  } catch (err) {
    return null;
  }
}

// Canonical dashed ids — the same vocabulary as src/config/gameTypes.js and
// AIGenerationPromptEditor. `survey` is included so survey sets can carry a
// summary prompt at all; it previously matched nothing anywhere.
const GAME_TYPE_OPTIONS = [
  { value: 'call-and-answer', label: 'Call & Answer' },
  { value: 'trivia', label: 'Trivia' },
  { value: 'poll', label: 'Poll' },
  { value: 'wavelength', label: 'Wavelength' },
  { value: 'survey', label: 'Survey' }
];

/** Derived, not a second list — the default warning names the type out loud. */
const GAME_TYPE_LABELS = Object.fromEntries(
  GAME_TYPE_OPTIONS.map((t) => [t.value, t.label])
);

// Lifted to module scope so the LIST FILTER can derive from it too. The filter
// used to hardcode the call-and-answer categories, so filtering the library by
// a trivia or wavelength category was impossible — you could author one and
// never find it again.
const PROMPT_CATEGORIES = {
  'call-and-answer': [
    'lessons-learned',
    'problem-solving',
    'amazon-principles',
    'interview-prep',
    'team-building',
    'art-titles',
    'custom',
    'opinions'
  ],
  trivia: ['general', 'business', 'technology', 'history', 'science', 'custom'],
  poll: ['opinion', 'preference', 'feedback', 'evaluation', 'custom'],
  wavelength: ['word-association', 'brainstorming', 'creativity', 'team-building', 'general', 'custom'],
  survey: ['general', 'feedback', 'evaluation', 'custom']
};

/** Every category any game type offers, de-duplicated, in game-type order. */
const ALL_PROMPT_CATEGORIES = [...new Set(Object.values(PROMPT_CATEGORIES).flat())];

/**
 * The `{tokens}` in this text that nothing will ever substitute.
 *
 * Author-time gate. Deliberately a WARNING: the wall is create/update-ai-prompt,
 * which is the gate both AI helpers pass through. Blocking here would only stop
 * the one person who can already see the problem.
 */
const unknownTokensIn = (...texts) => {
  const seen = [];
  for (const text of texts) {
    for (const name of unknownVariableTokens(text)) {
      if (!seen.includes(name)) seen.push(name);
    }
  }
  return seen;
};

// AI Prompt Editor Modal Component
function AIPromptEditor({ prompt, isNew = false, onSave, onCancel }) {
  const [formData, setFormData] = useState({
    name: prompt?.name || '',
    description: prompt?.description || '',
    // This manager only ever authors ANALYSIS (summary) prompts. It used not to
    // send promptType at all, so create-ai-prompt.js's old `= 'generation'`
    // default persisted every one of them mislabeled (D15).
    promptType: 'analysis',
    // Canonical dashed ids, matching config/gameTypes.js. Storing
    // `callandanswer` here while the generation editor stored
    // `call-and-answer` is what made every game-type filter miss (R3).
    gameType: normalizeGameType(prompt?.gameType),
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

  // The catalogue used to be redeclared here, 49 entries long, and then read
  // straight out of config/templateVariables.js. It is now read by
  // PromptVariableInspector, which does not trust the catalogue's descriptions
  // — see the header of that file for why.

  // Author-time gate: name the tokens nothing can fill, as they are typed.
  const unknownTokens = unknownTokensIn(formData.outputFormat, formData.instructions);

  /* ---- what this prompt will actually do, before it is saved ------------- */

  // The sample room the preview and the inspector share, so the value shown
  // beside a variable is the value substituted into the preview. Two different
  // sample sets on one screen would be a worse lie than none.
  const [roomSize, setRoomSize] = useState(DEFAULT_ROOM_SIZE);

  const preflightPrompt = useMemo(() => loadPreflight(), []);
  const report = useMemo(() => {
    if (!preflightPrompt) return null;
    try {
      return preflightPrompt({
        instructions: formData.instructions,
        outputFormat: formData.outputFormat,
        outputSections: prompt?.outputSections,
        template: formData.template,
        gameType: normalizeGameType(formData.gameType),
        isDefault: formData.isDefault,
        targetModel: SUMMARY_MODEL_ID,
      });
    } catch (err) {
      // A preflight that throws must not take the editor down with it. The
      // panel's absent state then says the checks did not run, which is true.
      console.error('promptPreflight threw; treating the checks as not run', err);
      return null;
    }
  }, [
    preflightPrompt,
    formData.instructions,
    formData.outputFormat,
    formData.template,
    formData.gameType,
    formData.isDefault,
    prompt,
  ]);

  const saveBlocked = blocksSave(report);

  // Every token the author has written, for the "In your prompt" mark in the
  // inspector. Unknown ones are included deliberately — a token you invented is
  // exactly the one you want to find in the list and fail to find.
  const usedTokens = useMemo(
    () => [
      ...new Set([
        ...extractVariableTokens(formData.instructions || ''),
        ...extractVariableTokens(formData.outputFormat || ''),
        ...extractVariableTokens(formData.template || ''),
      ]),
    ],
    [formData.instructions, formData.outputFormat, formData.template]
  );

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

  const gameTypes = GAME_TYPE_OPTIONS;
  const categories = PROMPT_CATEGORIES;

  const handleSubmit = async (e) => {
    e.preventDefault();
    // The disabled button is not the gate. Pressing Enter in any text input
    // submits a form whose submit button is disabled, which is how a "blocked"
    // save ships anyway. This is the gate.
    if (saveBlocked) return;
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
        // The handler now rejects an unrecognised game type by name rather than
        // silently generating against an empty variable list. Discarding that
        // message would put the loudness back where nobody can hear it.
        const detail = await response.json().catch(() => null);
        throw new Error(detail?.message || detail?.error || 'Failed to generate AI prompt');
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
                {categories[normalizeGameType(formData.gameType)]?.map(cat => (
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
              {/*
                THE PALETTE IS NOW AN INSPECTOR. The chips were a name and a
                tooltip quoting `variable.description` — and the catalogue's
                descriptions are not reliable: `voteTally`'s reads back
                `votingBreakdown`'s shape and example (defect D11), and no entry
                said anything at all about how large a value renders, which is
                how one prompt ended up 40% tally. Every row's sample is now
                built the way get-ai-summary.js builds the value, from the same
                sample room the preview substitutes.
              */}
              <PromptVariableInspector
                gameType={normalizeGameType(formData.gameType)}
                roomSize={roomSize}
                usedNames={usedTokens}
                onInsert={insertVariable}
              />
            </div>
            {unknownTokens.length > 0 && (
              <div className="unknown-variable-warning" data-testid="unknown-variable-warning">
                <Icon name="Warning" weight="fill" size={16} color="var(--danger)" />{' '}
                <strong>
                  {unknownTokens.length === 1 ? 'This variable does not exist' : 'These variables do not exist'}:
                </strong>{' '}
                {unknownTokens.map((name) => `{${name}}`).join(', ')}
                {' — '}
                nothing replaces them, so they appear on screen as literal braces and the
                prompt will be rejected when you save. Use a variable from the panel.
              </div>
            )}
            <small className="form-help">
              Click the variable buttons to insert them into your output format. Variables will be replaced with actual content when the AI summary is generated. Supports full Markdown formatting including headers, bold, italic, code, and tables.
            </small>
          </div>

          {/*
            3. WHAT THIS PROMPT WILL DO. Everything above is what you typed;
            everything here is what the model gets. The two are not the same
            string and the difference is where six shipped defects lived.
          */}
          <div className="form-group prompt-check-group">
            <label>3. Before you save</label>
            <PromptPreflightPanel report={report} unavailable={!preflightPrompt} />
            <PromptAssembledPreview
              instructions={formData.instructions}
              outputFormat={formData.outputFormat}
              template={formData.template}
              outputSections={prompt?.outputSections}
              gameType={normalizeGameType(formData.gameType)}
              roomSize={roomSize}
              onRoomSizeChange={setRoomSize}
            />
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

          {/*
            THE BLAST RADIUS, AT THE POINT OF THE DECISION.
            The old label read "Set as default prompt for this category" and it
            was wrong in the direction that matters. `create-ai-prompt.js:230`
            and `update-ai-prompt.js:255` clear isDefault from every other prompt
            of this GAME TYPE, not this category — deliberately, because
            `findDefaultPromptId` (get-ai-summary.js:344-352) looks the default
            up by game type alone, and per-category defaults once produced seven
            simultaneous call-and-answer "defaults" and an arbitrary winner.
            So ticking this box silently demotes whatever is default now, and
            unticking it later does NOT put that prompt back
            (update-ai-prompt.js:320-333 deletes the lookup and restores
            nothing). The screen used to say none of this.
          */}
          <div className="form-group checkbox-group default-group">
            <label>
              <input
                type="checkbox"
                checked={formData.isDefault}
                onChange={(e) => setFormData({ ...formData, isDefault: e.target.checked })}
              />
              Make this the default {GAME_TYPE_LABELS[normalizeGameType(formData.gameType)] || ''} summary prompt
            </label>
            <p className="default-blast-note">
              Not a per-category default. There is exactly one default per engagement type, and it
              is what runs for <strong>every</strong> {GAME_TYPE_LABELS[normalizeGameType(formData.gameType)] || 'session'} set
              in this environment that has no prompt of its own.
            </p>
            {formData.isDefault && (
              <div className="default-blast-warning" data-testid="default-blast-warning" role="alert">
                <Icon name="Warning" weight="fill" size={16} color="currentColor" />{' '}
                <strong>
                  Saving this replaces the default for every{' '}
                  {GAME_TYPE_LABELS[normalizeGameType(formData.gameType)] || 'session'} set in this
                  environment.
                </strong>{' '}
                The prompt that is default now is demoted in the same write, with no record of
                which one it was, and un-ticking this box later does not put it back &mdash; it
                leaves the engagement type with no default at all. Hosts will not be told the
                summary changed.
              </div>
            )}
          </div>

          <div className="form-actions">
            {saveBlocked && (
              <p className="save-blocked-note" data-testid="save-blocked-note">
                Save is blocked by {report.blocking.length}{' '}
                {report.blocking.length === 1 ? 'finding' : 'findings'} above.
              </p>
            )}
            <button type="button" className="btn-secondary" onClick={onCancel}>
              Cancel
            </button>
            <button type="submit" className="btn-primary" disabled={isSaving || saveBlocked}>
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
      // Normalize both sides: rows written before the vocabulary was unified
      // still carry `callandanswer` / `polls`, and an exact-match filter on the
      // dashed id would show none of them.
      const wanted = normalizeGameType(selectedGameType);
      filtered = filtered.filter(p => normalizeGameType(p.gameType) === wanted);
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
            onChange={(e) => {
              setSelectedGameType(e.target.value);
              // The category list below is derived from the game type, so a
              // category that is no longer offered would otherwise stay
              // selected and silently filter everything out.
              setSelectedCategory('all');
            }}
            className="filter-select"
          >
            {/* D20: wavelength was missing entirely, so wavelength prompts were
                unreachable through this filter; survey matched nothing anywhere.
                Values are the canonical dashed ids. */}
            <option value="all">All Game Types</option>
            <option value="call-and-answer">Call & Answer</option>
            <option value="trivia">Trivia</option>
            <option value="poll">Poll</option>
            <option value="wavelength">Wavelength</option>
            <option value="survey">Survey</option>
          </select>

          <select 
            value={selectedCategory}
            onChange={(e) => setSelectedCategory(e.target.value)}
            className="filter-select"
          >
            {/* Derived per game type, as the editor's own select already does.
                This list was hardcoded to the call-and-answer categories, so a
                trivia or wavelength prompt could be authored under a category
                and then never filtered for again. */}
            <option value="all">All Categories</option>
            {(selectedGameType === 'all'
              ? ALL_PROMPT_CATEGORIES
              : (PROMPT_CATEGORIES[normalizeGameType(selectedGameType)] || [])
            ).map(cat => (
              <option key={cat} value={cat}>{cat}</option>
            ))}
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
                  {/* R1b: a generation-format prompt attached to a question set
                      does nothing at runtime — the summary engine rejects it and
                      silently uses the game-type default. Say so here rather
                      than letting someone attach it and wonder why the summary
                      never changed. */}
                  {prompt.summaryPromptStatus === 'unusable' && (
                    <span
                      className="warning-badge"
                      title={`Cannot be used as a summary prompt: ${prompt.summaryPromptDefect || 'wrong format'}`}
                    >
                      <Icon name="Warning" weight="fill" size={12} color="currentColor" /> Not a summary prompt
                    </span>
                  )}
                  {prompt.malformed && (
                    <span
                      className="warning-badge"
                      title="This record has no promptId attribute. It cannot be attached to a question set safely — run scripts/cull-ai-prompts.js."
                    >
                      <Icon name="Warning" weight="fill" size={12} color="currentColor" /> Broken record
                    </span>
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