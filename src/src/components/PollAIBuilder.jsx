import React, { useState } from 'react';
import FileUploadPrompt from './FileUploadPrompt';
import { startGenerationJob, pollGenerationJob } from '../utils/aiBatchClient';
import Icon from './Icon';
import { normalizeTags, tagsToCsvCell } from '../utils/tags';

const API_BASE = window.API_BASE;

function PollAIBuilder({ onClose, onPollGenerated }) {
  const [step, setStep] = useState(1);
  const [pollConfig, setPollConfig] = useState({
    topic: '',
    category: '',
    audience: '',
    difficulty: 'medium',
    count: 10,
    allowMultiple: false,
    customPrompt: ''
  });
  const [generatedPolls, setGeneratedPolls] = useState([]);
  const [currentPollIndex, setCurrentPollIndex] = useState(0);
  const [isGenerating, setIsGenerating] = useState(false);
  const [generationStatus, setGenerationStatus] = useState('');
  // Raw text of the tag field while it is being edited. null = not editing, so
  // the input falls back to the poll's stored tags. Normalising on every
  // keystroke would eat the hyphen out of "remote-" as it is typed.
  const [tagDraft, setTagDraft] = useState(null);

  const difficultyLevels = [
    { value: 'easy', label: 'Easy', description: 'Simple, straightforward poll questions' },
    { value: 'medium', label: 'Medium', description: 'Moderate complexity, some thought required' },
    { value: 'hard', label: 'Hard', description: 'Complex topics requiring deeper consideration' }
  ];

  const handleConfigSubmit = async () => {
    setIsGenerating(true);
    setGenerationStatus('Starting generation...');
    setStep(2);

    // Generation runs as a background job. It cannot run inside the request:
    // API Gateway's 30s integration timeout is a hard ceiling and a full set
    // takes minutes, which is what produced the "HTTP 503 - retrying" loop.
    const endpoint = `${API_BASE}admin/ai-generate-polls`;
    try {
      const { jobId } = await startGenerationJob(endpoint, {
        topic: pollConfig.topic,
        category: pollConfig.category,
        audience: pollConfig.audience,
        difficulty: pollConfig.difficulty,
        count: pollConfig.count,
        allowMultiple: pollConfig.allowMultiple,
        customPrompt: pollConfig.customPrompt
      }, { label: 'Generation', onStatus: setGenerationStatus });

      const job = await pollGenerationJob(endpoint, jobId, {
        label: 'Generation',
        onStatus: setGenerationStatus,
        // Show polls as they land rather than a spinner for minutes.
        onProgress: (update) => {
          if (Array.isArray(update.items) && update.items.length > 0) {
            setGeneratedPolls(update.items);
          }
        }
      });

      setGeneratedPolls(job.items);
      setCurrentPollIndex(0);
      setGenerationStatus(
        job.warnings?.length
          ? `Generated ${job.items.length} poll questions. ${job.warnings.join(' ')}`
          : `Generated ${job.items.length} poll questions successfully`
      );
    } catch (error) {
      console.error('AI poll generation error:', error);
      // A failed job still returns whatever it managed to generate.
      if (error.partialItems?.length) {
        setGeneratedPolls(error.partialItems);
        setCurrentPollIndex(0);
      }
      setGenerationStatus(`Generation failed: ${error.message}`);
    } finally {
      setIsGenerating(false);
    }
  };

  const handlePollEdit = (index, field, value) => {
    const updatedPolls = [...generatedPolls];
    updatedPolls[index] = { ...updatedPolls[index], [field]: value };
    setGeneratedPolls(updatedPolls);
  };

  const handleOptionEdit = (pollIndex, optionIndex, value) => {
    const updatedPolls = [...generatedPolls];
    const newOptions = [...updatedPolls[pollIndex].options];
    newOptions[optionIndex] = value;
    updatedPolls[pollIndex] = { ...updatedPolls[pollIndex], options: newOptions };
    setGeneratedPolls(updatedPolls);
  };

  const addOption = (pollIndex) => {
    const updatedPolls = [...generatedPolls];
    updatedPolls[pollIndex].options.push('');
    setGeneratedPolls(updatedPolls);
  };

  const removeOption = (pollIndex, optionIndex) => {
    const updatedPolls = [...generatedPolls];
    updatedPolls[pollIndex].options.splice(optionIndex, 1);
    setGeneratedPolls(updatedPolls);
  };

  const navigatePoll = (direction) => {
    // Drop any in-flight tag edit; it belongs to the poll being left.
    setTagDraft(null);
    if (direction === 'prev' && currentPollIndex > 0) {
      setCurrentPollIndex(currentPollIndex - 1);
    } else if (direction === 'next' && currentPollIndex < generatedPolls.length - 1) {
      setCurrentPollIndex(currentPollIndex + 1);
    }
  };

  const handleExportCSV = () => {
    const csvContent = generatePollCSV();
    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `polls-${pollConfig.topic.replace(/[^a-zA-Z0-9]/g, '_')}-${Date.now()}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);
  };

  const generatePollCSV = () => {
    const headers = 'Category,Question#,Title,Detail_lesson,School,CustomInstruction,Option1,Option2,Option3,Option4,Option5,AllowMultiple,Tags';
    const rows = generatedPolls.map((poll, index) => {
      const options = [...poll.options];
      while (options.length < 5) {
        options.push('');
      }

      return `"${poll.category}","${index + 1}","${poll.title}","${poll.detail}","${poll.school || 'General'}","${poll.customInstructions || ''}","${options[0]}","${options[1]}","${options[2]}","${options[3]}","${options[4]}","${poll.allowMultiple ? 'true' : 'false'}","${tagsToCsvCell(poll.tags)}"`;
    });
    return headers + '\n' + rows.join('\n');
  };

  const handleLoadIntoSystem = () => {
    const metadata = {
      title: `${pollConfig.topic} Polls${pollConfig.audience ? ` for ${pollConfig.audience}` : ''}`,
      description: `${generatedPolls.length} AI-generated poll questions about ${pollConfig.topic}. Difficulty: ${pollConfig.difficulty}.`,
      customInstructions: `Select your preferred option(s) for each poll question. ${pollConfig.allowMultiple ? 'Multiple selections may be allowed for some questions.' : ''}`,
      aiContextInstructions: `These are ${pollConfig.difficulty}-level poll questions about ${pollConfig.topic}. Encourage thoughtful consideration and diverse perspectives.`
    };
    
    onPollGenerated({
      questions: generatedPolls,
      metadata: metadata
    });
  };

  const currentPoll = generatedPolls[currentPollIndex];

  return (
    <div className="poll-ai-builder-modal">
      <div className="modal-overlay" onClick={onClose}></div>
      <div className="modal-content poll-builder" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2><Icon name="ChartBar" weight="duotone" size={16} color="var(--primary)" /> AI Poll Builder</h2>
          <button className="close-button" onClick={onClose}><Icon name="X" weight="bold" size={16} color="currentColor" /></button>
        </div>

        <div className="modal-body">
          {step === 1 && (
            <div className="poll-configuration">
              <h3>Configure Your Poll Questions</h3>
              <div className="config-form">
                <div className="form-row">
                  <div className="form-group">
                    <label>Topic/Subject *</label>
                    <input
                      type="text"
                      value={pollConfig.topic}
                      onChange={(e) => setPollConfig(prev => ({ ...prev, topic: e.target.value }))}
                      placeholder="e.g., Team Preferences, Product Feedback, Decision Making"
                    />
                  </div>
                  <div className="form-group">
                    <label>Category</label>
                    <input
                      type="text"
                      value={pollConfig.category}
                      onChange={(e) => setPollConfig(prev => ({ ...prev, category: e.target.value }))}
                      placeholder="e.g., Team Building, Feedback, Decisions"
                    />
                  </div>
                </div>

                <div className="form-row">
                  <div className="form-group">
                    <label>Target Audience</label>
                    <input
                      type="text"
                      value={pollConfig.audience}
                      onChange={(e) => setPollConfig(prev => ({ ...prev, audience: e.target.value }))}
                      placeholder="e.g., Team Members, Customers, Stakeholders"
                    />
                  </div>
                  <div className="form-group">
                    <label>Complexity Level</label>
                    <select
                      value={pollConfig.difficulty}
                      onChange={(e) => setPollConfig(prev => ({ ...prev, difficulty: e.target.value }))}
                    >
                      {difficultyLevels.map(level => (
                        <option key={level.value} value={level.value}>{level.label}</option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="form-row">
                  <div className="form-group">
                    <label>Number of Poll Questions: <strong>{pollConfig.count}</strong></label>
                    <div className="quantity-controls">
                      <input
                        type="range"
                        min="1"
                        max="100"
                        value={pollConfig.count}
                        onChange={(e) => setPollConfig(prev => ({ ...prev, count: parseInt(e.target.value) }))}
                        className="quantity-slider"
                      />
                      <input
                        type="number"
                        min="1"
                        max="100"
                        value={pollConfig.count}
                        onChange={(e) => setPollConfig(prev => ({ ...prev, count: Math.min(100, Math.max(1, parseInt(e.target.value) || 1)) }))}
                        className="quantity-input"
                      />
                    </div>
                    <div className="quantity-presets">
                      <button type="button" className="preset-btn" onClick={() => setPollConfig(prev => ({ ...prev, count: 5 }))}>5</button>
                      <button type="button" className="preset-btn" onClick={() => setPollConfig(prev => ({ ...prev, count: 10 }))}>10</button>
                      <button type="button" className="preset-btn" onClick={() => setPollConfig(prev => ({ ...prev, count: 20 }))}>20</button>
                      <button type="button" className="preset-btn" onClick={() => setPollConfig(prev => ({ ...prev, count: 50 }))}>50</button>
                    </div>
                  </div>
                </div>

                <div className="form-row">
                  <div className="form-group">
                    <label>
                      <input
                        type="checkbox"
                        checked={pollConfig.allowMultiple}
                        onChange={(e) => setPollConfig(prev => ({ ...prev, allowMultiple: e.target.checked }))}
                      />
                      Allow multiple selections (where appropriate)
                    </label>
                  </div>
                </div>

                <div className="form-group">
                  <label>Additional Requirements (Optional)</label>
                  <textarea
                    value={pollConfig.customPrompt}
                    onChange={(e) => setPollConfig(prev => ({ ...prev, customPrompt: e.target.value }))}
                    placeholder="Any specific requirements, themes, or constraints..."
                    rows="3"
                  />
                </div>

                <FileUploadPrompt
                  onContentExtracted={(content) => {
                    setPollConfig(prev => ({
                      ...prev,
                      customPrompt: prev.customPrompt + '\n\n' + content
                    }));
                  }}
                  acceptedFormats={['.txt', '.pdf', '.md', '.docx']}
                  label="Or upload a document with context/examples"
                />
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="poll-generation">
              {isGenerating ? (
                <div className="generation-progress">
                  <div className="spinner"></div>
                  <p>{generationStatus}</p>
                </div>
              ) : generatedPolls.length > 0 ? (
                <div className="poll-review">
                  <div className="poll-navigation">
                    <button
                      className="nav-button prev"
                      onClick={() => navigatePoll('prev')}
                      disabled={currentPollIndex === 0}
                    >
                      <Icon name="ArrowLeft" weight="bold" size={16} color="currentColor" /> Previous
                    </button>
                    
                    <div className="poll-counter">
                      <span>Poll {currentPollIndex + 1} of {generatedPolls.length}</span>
                      <h3>{currentPoll?.title}</h3>
                    </div>
                    
                    <button
                      className="nav-button next"
                      onClick={() => navigatePoll('next')}
                      disabled={currentPollIndex === generatedPolls.length - 1}
                    >
                      Next <Icon name="ArrowRight" weight="bold" size={16} color="currentColor" />
                    </button>
                  </div>

                  {currentPoll && (
                    <div className="poll-editor">
                      <div className="form-group">
                        <label>Poll Question</label>
                        <input
                          type="text"
                          value={currentPoll.title || ''}
                          onChange={(e) => handlePollEdit(currentPollIndex, 'title', e.target.value)}
                        />
                      </div>

                      <div className="form-row">
                        <div className="form-group">
                          <label>Category</label>
                          <input
                            type="text"
                            value={currentPoll.category || ''}
                            onChange={(e) => handlePollEdit(currentPollIndex, 'category', e.target.value)}
                          />
                        </div>
                        <div className="form-group">
                          <label>
                            <input
                              type="checkbox"
                              checked={currentPoll.allowMultiple || false}
                              onChange={(e) => handlePollEdit(currentPollIndex, 'allowMultiple', e.target.checked)}
                            />
                            Allow multiple selections
                          </label>
                        </div>
                      </div>

                      {/*
                        Suggested tags, not imposed tags. The model that just wrote
                        the poll is best placed to say what it is about, but the
                        owner gets the final word before anything is saved. Stored
                        as a flat lowercase kebab-case array under `tags`.
                      */}
                      <div className="form-group">
                        <label>Tags <span className="field-hint">suggested — edit freely, comma separated</span></label>
                        <input
                          type="text"
                          value={tagDraft !== null ? tagDraft : (currentPoll?.tags || []).join(', ')}
                          onChange={(e) => setTagDraft(e.target.value)}
                          onBlur={() => {
                            if (tagDraft !== null) {
                              handlePollEdit(currentPollIndex, 'tags', normalizeTags(tagDraft));
                              setTagDraft(null);
                            }
                          }}
                          placeholder="remote-work, feedback, decisions"
                        />
                        {(currentPoll?.tags || []).length > 0 && (
                          <div className="tag-chips">
                            {currentPoll.tags.map((tag) => (
                              <span className="tag-chip" key={tag}>{tag}</span>
                            ))}
                          </div>
                        )}
                      </div>

                      <div className="poll-options-editor">
                        <h4>Poll Options</h4>
                        {currentPoll.options?.map((option, index) => (
                          <div key={index} className="option-editor">
                            <label>
                              <span className="option-number">{index + 1}.</span>
                              <input
                                type="text"
                                value={option}
                                onChange={(e) => handleOptionEdit(currentPollIndex, index, e.target.value)}
                              />
                            </label>
                            {currentPoll.options.length > 2 && (
                              <button
                                type="button"
                                className="remove-option-btn"
                                onClick={() => removeOption(currentPollIndex, index)}
                              >
                                <Icon name="X" weight="bold" size={16} color="currentColor" />
                              </button>
                            )}
                          </div>
                        ))}
                        <button
                          type="button"
                          className="add-option-btn"
                          onClick={() => addOption(currentPollIndex)}
                        >
                          + Add Option
                        </button>
                      </div>

                      <div className="poll-preview">
                        <h4>Preview:</h4>
                        <div className="poll-preview-display">
                          <div className="question-header">
                            <h3>{currentPoll.title}</h3>
                            <div className="field-badge">{currentPoll.category}</div>
                            {currentPoll.allowMultiple && <div className="multiple-badge">Multiple Choice</div>}
                          </div>
                          <div className="poll-options">
                            {currentPoll.options?.map((option, index) => (
                              <div key={index} className="category-item poll-option">
                                <span className="category-name">
                                  <span className="option-number">{index + 1}.</span> {option}
                                </span>
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>
                    </div>
                  )}

                  <div className="poll-actions">
                    <button className="btn-secondary" onClick={handleExportCSV}>
                      <Icon name="FileText" weight="bold" size={16} color="currentColor" /> Export CSV
                    </button>
                    <button className="btn-primary" onClick={handleLoadIntoSystem}>
                      <Icon name="DownloadSimple" weight="bold" size={16} color="currentColor" /> Load into System
                    </button>
                  </div>
                </div>
              ) : (
                <div className="generation-error">
                  <p>{generationStatus}</p>
                  <button className="btn-secondary" onClick={() => setStep(1)}>
                    <Icon name="ArrowLeft" weight="bold" size={16} color="currentColor" /> Back to Configuration
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="modal-footer">
          {step === 1 && (
            <>
              <button className="btn-secondary" onClick={onClose}>
                Cancel
              </button>
              <button 
                className="btn-primary" 
                onClick={handleConfigSubmit}
                disabled={!pollConfig.topic.trim()}
              >
                <Icon name="Sparkle" weight="duotone" size={16} color="var(--primary)" /> Generate Poll Questions
              </button>
            </>
          )}
          {step === 2 && !isGenerating && generatedPolls.length > 0 && (
            <>
              <button className="btn-secondary" onClick={() => setStep(1)}>
                <Icon name="ArrowLeft" weight="bold" size={16} color="currentColor" /> Back to Configuration
              </button>
              <button className="btn-secondary" onClick={onClose}>
                Cancel
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export default PollAIBuilder;
