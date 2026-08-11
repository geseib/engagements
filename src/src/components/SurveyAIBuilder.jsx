import React, { useState, useEffect, useCallback, useRef } from 'react';
import FileUploadPrompt from './FileUploadPrompt';
import { startGenerationJob, pollGenerationJob } from '../utils/aiBatchClient';
import Icon from './Icon';
import { normalizeTags } from '../utils/tags';
import GenerationJobPanel from './GenerationJobPanel';
import GeneratedItemsTable from './GeneratedItemsTable';
import StatusMessage from './StatusMessage';
import {
  interpretGenerationJob,
  rememberGenerationJob,
  recallGenerationJob,
  forgetGenerationJob,
  resumeIsGone,
} from '../utils/generationJob';

const API_BASE = window.API_BASE;
const ENDPOINT = `${API_BASE}admin/ai-generate-survey`;

function SurveyAIBuilder({ onClose, onSurveyGenerated }) {
  const [step, setStep] = useState(1);
  const [surveyConfig, setSurveyConfig] = useState({
    title: '',
    description: '',
    topic: '',
    audience: '',
    purpose: '',
    questionCount: 15,
    includeRating: true,
    includeMultipleChoice: true,
    includeTextEntry: true,
    customPrompt: ''
  });
  const [generatedSurvey, setGeneratedSurvey] = useState(null);
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
  // The last poll response, in the shape jobToResponse() actually sends. Every
  // render branch reads interpretGenerationJob(job).outcome, never
  // `generatedSurvey` being truthy — which it is for a FAILED job with partials.
  const [job, setJob] = useState(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [transportError, setTransportError] = useState(null);
  const [generationStatus, setGenerationStatus] = useState('');
  const [excluded, setExcluded] = useState(() => new Set());
  const [editingItem, setEditingItem] = useState(false);
  const [reviewingPartial, setReviewingPartial] = useState(false);
  // Raw text of the tag field while it is being edited. null = not editing, so
  // the input falls back to the question's stored tags. Normalising on every
  // keystroke would eat the hyphen out of "remote-" as it is typed.
  const [tagDraft, setTagDraft] = useState(null);

  const questionTypes = [
    { id: 'rating', label: 'Rating Questions', description: 'Scale-based questions (1-5, 1-10, etc.)' },
    { id: 'multiple_choice', label: 'Multiple Choice', description: 'Questions with predefined options' },
    { id: 'text_entry', label: 'Text Entry', description: 'Open-ended questions requiring written responses' }
  ];

  const jobIdRef = useRef(null);
  const configRef = useRef(surveyConfig);
  configRef.current = surveyConfig;

  // The job stores a flat item list; the survey's own framing travels in
  // `meta`. Prefer what the AI improved, fall back to what was typed.
  const assemble = useCallback((items, meta) => {
    const config = configRef.current;
    return {
      id: Date.now(),
      title: meta?.title || config.title,
      description: meta?.description || config.description,
      topic: config.topic,
      audience: config.audience,
      purpose: config.purpose,
      createdAt: new Date().toISOString(),
      questions: items
    };
  }, []);

  /** See TriviaAIBuilder.watchJob — same contract, same reasons. */
  const watchJob = useCallback(async (jobId) => {
    jobIdRef.current = jobId;
    setIsGenerating(true);
    setTransportError(null);
    setStep(2);
    try {
      const terminal = await pollGenerationJob(ENDPOINT, jobId, {
        label: 'Survey generation',
        onStatus: setGenerationStatus,
        onProgress: (update) => {
          setJob(update);
          if (Array.isArray(update.items) && update.items.length > 0) {
            setGeneratedSurvey(assemble(update.items, update.meta));
          }
        }
      });
      setJob(terminal);
      setGeneratedSurvey(assemble(Array.isArray(terminal.items) ? terminal.items : [], terminal.meta));
      setCurrentQuestionIndex(0);
    } catch (error) {
      console.error('AI survey generation error:', error);
      if (resumeIsGone(error)) {
        forgetGenerationJob(ENDPOINT);
        jobIdRef.current = null;
        setJob(null);
        setStep(1);
        setGenerationStatus('That job has expired — generation jobs are readable for three days. Start a new one.');
      } else {
        // Keep the stored id: the worker may still be running.
        setTransportError(error.message);
      }
    } finally {
      setIsGenerating(false);
    }
  }, [assemble]);

  useEffect(() => {
    const stored = recallGenerationJob(ENDPOINT);
    if (!stored) return;
    setGenerationStatus('Reconnecting to the job you left…');
    watchJob(stored.jobId);
  }, [watchJob]);

  const handleConfigSubmit = async () => {
    setIsGenerating(true);
    setGenerationStatus('Starting generation...');
    setTransportError(null);
    setJob(null);
    setGeneratedSurvey(null);
    setExcluded(new Set());
    setEditingItem(false);
    setReviewingPartial(false);
    setStep(2);

    // Surveys used to be a single un-chunked call for up to 50 questions
    // against API Gateway's 30s ceiling. Now a background job, chunked.
    try {
      const { jobId } = await startGenerationJob(ENDPOINT, {
        title: surveyConfig.title,
        description: surveyConfig.description,
        topic: surveyConfig.topic,
        audience: surveyConfig.audience,
        purpose: surveyConfig.purpose,
        questionCount: surveyConfig.questionCount,
        includeRating: surveyConfig.includeRating,
        includeMultipleChoice: surveyConfig.includeMultipleChoice,
        includeTextEntry: surveyConfig.includeTextEntry,
        customPrompt: surveyConfig.customPrompt
      }, { label: 'Survey generation', onStatus: setGenerationStatus });

      rememberGenerationJob(ENDPOINT, jobId, { title: surveyConfig.title });
      await watchJob(jobId);
    } catch (error) {
      console.error('AI survey generation error:', error);
      setIsGenerating(false);
      setTransportError(error.message);
    }
  };

  const dismissJob = () => {
    forgetGenerationJob(ENDPOINT);
    jobIdRef.current = null;
  };

  const backToConfiguration = () => {
    dismissJob();
    setJob(null);
    setTransportError(null);
    setGenerationStatus('');
    setGeneratedSurvey(null);
    setExcluded(new Set());
    setEditingItem(false);
    setReviewingPartial(false);
    setStep(1);
  };

  const retryRemaining = (remaining) => {
    setSurveyConfig(prev => ({
      ...prev,
      questionCount: Math.max(5, Math.min(50, remaining || prev.questionCount))
    }));
    backToConfiguration();
  };

  const toggleExcluded = (index) => {
    setExcluded(prev => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index); else next.add(index);
      return next;
    });
  };

  const handleQuestionEdit = (index, field, value) => {
    const updatedSurvey = { ...generatedSurvey };
    updatedSurvey.questions[index] = { ...updatedSurvey.questions[index], [field]: value };
    setGeneratedSurvey(updatedSurvey);
  };

  const handleOptionEdit = (questionIndex, optionIndex, value) => {
    const updatedSurvey = { ...generatedSurvey };
    const newOptions = [...updatedSurvey.questions[questionIndex].options];
    newOptions[optionIndex] = value;
    updatedSurvey.questions[questionIndex] = { 
      ...updatedSurvey.questions[questionIndex], 
      options: newOptions 
    };
    setGeneratedSurvey(updatedSurvey);
  };

  const addOption = (questionIndex) => {
    const updatedSurvey = { ...generatedSurvey };
    updatedSurvey.questions[questionIndex].options.push('');
    setGeneratedSurvey(updatedSurvey);
  };

  const removeOption = (questionIndex, optionIndex) => {
    const updatedSurvey = { ...generatedSurvey };
    updatedSurvey.questions[questionIndex].options.splice(optionIndex, 1);
    setGeneratedSurvey(updatedSurvey);
  };

  const navigateQuestion = (direction) => {
    // Drop any in-flight tag edit; it belongs to the question being left.
    setTagDraft(null);
    if (direction === 'prev' && currentQuestionIndex > 0) {
      setCurrentQuestionIndex(currentQuestionIndex - 1);
    } else if (direction === 'next' && currentQuestionIndex < generatedSurvey.questions.length - 1) {
      setCurrentQuestionIndex(currentQuestionIndex + 1);
    }
  };

  const surveyQuestions = generatedSurvey?.questions || [];
  const keptQuestions = surveyQuestions.filter((_, index) => !excluded.has(index));
  /** What either export button writes: the survey minus the excluded rows. */
  const keptSurvey = generatedSurvey ? { ...generatedSurvey, questions: keptQuestions } : null;

  const handleExportJSON = () => {
    const jsonContent = JSON.stringify(keptSurvey, null, 2);
    const blob = new Blob([jsonContent], { type: 'application/json' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `survey-${surveyConfig.title.replace(/[^a-zA-Z0-9]/g, '_')}-${Date.now()}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);
  };

  /**
   * O1 — "label it". THIS DOES NOT UPLOAD ANYTHING, and the button that calls
   * it no longer claims to.
   *
   * `onSurveyGenerated` is AdminPage.handleSurveyGenerated, which builds a Blob,
   * clicks an anchor and reports "exported as JSON file". There is no survey
   * write path behind it: upload-questions.js rejects survey outright, and its
   * gate is three-way — engagementType === 'survey', OR a .json filename, OR
   * content starting with `[` or `{` — so a survey set cannot be created by any
   * route. `config/gameTypes.js` already holds `survey` in UNPLAYABLE_GAME_TYPES
   * for the same reason.
   *
   * So this is an export, and the label says Export. Calling it "Load into
   * System" reported a success it never achieved.
   */
  const handleExportAndClose = () => {
    dismissJob();
    onSurveyGenerated({
      survey: keptSurvey,
      metadata: {
        title: surveyConfig.title,
        description: surveyConfig.description,
        type: 'survey',
        questionCount: keptQuestions.length
      }
    });
  };

  const currentQuestion = surveyQuestions[currentQuestionIndex];

  const interpreted = interpretGenerationJob(job);
  const reviewing = !isGenerating && !transportError
    && (interpreted.outcome === 'complete'
      || (interpreted.outcome === 'partial' && reviewingPartial));

  /** A multiple-choice question with nothing to choose between is unanswerable. */
  const questionDefect = (question) => {
    if (!String(question?.question || '').trim()) return 'No question text.';
    if (question?.type === 'multiple_choice') {
      const options = Array.isArray(question.options)
        ? question.options.filter((option) => String(option ?? '').trim())
        : [];
      if (options.length < 2) return 'A multiple-choice question with fewer than two options cannot be answered.';
    }
    return null;
  };

  const renderQuestionEditor = (question, index) => {
    switch (question.type) {
      case 'rating':
        return (
          <div className="rating-editor">
            <div className="form-row">
              <div className="form-group">
                <label>Scale Type</label>
                <select
                  value={question.scale?.type || '1-5'}
                  onChange={(e) => {
                    const newScale = { ...question.scale, type: e.target.value };
                    handleQuestionEdit(index, 'scale', newScale);
                  }}
                >
                  <option value="1-5">1 to 5</option>
                  <option value="1-10">1 to 10</option>
                  <option value="0-10">0 to 10</option>
                </select>
              </div>
              <div className="form-group">
                <label>Low Label</label>
                <input
                  type="text"
                  value={question.scale?.lowLabel || ''}
                  onChange={(e) => {
                    const newScale = { ...question.scale, lowLabel: e.target.value };
                    handleQuestionEdit(index, 'scale', newScale);
                  }}
                  placeholder="e.g., Strongly Disagree"
                />
              </div>
              <div className="form-group">
                <label>High Label</label>
                <input
                  type="text"
                  value={question.scale?.highLabel || ''}
                  onChange={(e) => {
                    const newScale = { ...question.scale, highLabel: e.target.value };
                    handleQuestionEdit(index, 'scale', newScale);
                  }}
                  placeholder="e.g., Strongly Agree"
                />
              </div>
            </div>
          </div>
        );

      case 'multiple_choice':
        return (
          <div className="multiple-choice-editor">
            <div className="form-row">
              <div className="form-group">
                <label>
                  <input
                    type="checkbox"
                    checked={question.allowMultiple || false}
                    onChange={(e) => handleQuestionEdit(index, 'allowMultiple', e.target.checked)}
                  />
                  Allow multiple selections
                </label>
              </div>
            </div>
            <div className="options-editor">
              <h5>Options</h5>
              {question.options?.map((option, optionIndex) => (
                <div key={optionIndex} className="option-editor">
                  <label>
                    <span className="option-number">{optionIndex + 1}.</span>
                    <input
                      type="text"
                      value={option}
                      onChange={(e) => handleOptionEdit(index, optionIndex, e.target.value)}
                    />
                  </label>
                  {question.options.length > 2 && (
                    <button
                      type="button"
                      className="remove-option-btn"
                      onClick={() => removeOption(index, optionIndex)}
                    >
                      <Icon name="X" weight="bold" size={16} color="currentColor" />
                    </button>
                  )}
                </div>
              ))}
              <button
                type="button"
                className="add-option-btn"
                onClick={() => addOption(index)}
              >
                + Add Option
              </button>
            </div>
          </div>
        );

      case 'text_entry':
        return (
          <div className="text-entry-editor">
            <div className="form-row">
              <div className="form-group">
                <label>Response Type</label>
                <select
                  value={question.textType || 'short'}
                  onChange={(e) => handleQuestionEdit(index, 'textType', e.target.value)}
                >
                  <option value="short">Short Text (single line)</option>
                  <option value="long">Long Text (paragraph)</option>
                  <option value="email">Email Address</option>
                  <option value="number">Number</option>
                </select>
              </div>
              <div className="form-group">
                <label>Placeholder Text</label>
                <input
                  type="text"
                  value={question.placeholder || ''}
                  onChange={(e) => handleQuestionEdit(index, 'placeholder', e.target.value)}
                  placeholder="e.g., Enter your thoughts here..."
                />
              </div>
            </div>
            <div className="form-row">
              <div className="form-group">
                <label>
                  <input
                    type="checkbox"
                    checked={question.required || false}
                    onChange={(e) => handleQuestionEdit(index, 'required', e.target.checked)}
                  />
                  Required field
                </label>
              </div>
            </div>
          </div>
        );

      default:
        return null;
    }
  };

  const renderQuestionPreview = (question) => {
    switch (question.type) {
      case 'rating':
        const scaleRange = question.scale?.type === '1-10' ? 10 : question.scale?.type === '0-10' ? 11 : 5;
        const startValue = question.scale?.type === '0-10' ? 0 : 1;
        
        return (
          <div className="rating-preview">
            <div className="scale-labels">
              <span>{question.scale?.lowLabel}</span>
              <span>{question.scale?.highLabel}</span>
            </div>
            <div className="rating-scale">
              {Array.from({ length: scaleRange }, (_, i) => (
                <div key={i} className="rating-option">
                  <input type="radio" name={`preview-${currentQuestionIndex}`} disabled />
                  <label>{startValue + i}</label>
                </div>
              ))}
            </div>
          </div>
        );

      case 'multiple_choice':
        return (
          <div className="multiple-choice-preview">
            {question.options?.map((option, index) => (
              <div key={index} className="choice-option">
                <input 
                  type={question.allowMultiple ? "checkbox" : "radio"} 
                  name={`preview-${currentQuestionIndex}`} 
                  disabled 
                />
                <label>{option}</label>
              </div>
            ))}
          </div>
        );

      case 'text_entry':
        return (
          <div className="text-entry-preview">
            {question.textType === 'long' ? (
              <textarea 
                placeholder={question.placeholder} 
                disabled 
                rows="4"
              />
            ) : (
              <input 
                type={question.textType === 'email' ? 'email' : question.textType === 'number' ? 'number' : 'text'}
                placeholder={question.placeholder} 
                disabled 
              />
            )}
            {question.required && <span className="required-indicator">*</span>}
          </div>
        );

      default:
        return null;
    }
  };

  return (
    <div className="survey-ai-builder-modal">
      <div className="modal-overlay" onClick={onClose}></div>
      <div className="modal-content survey-builder" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2><Icon name="ClipboardText" weight="bold" size={16} color="currentColor" /> AI Survey Builder</h2>
          <button className="close-button" onClick={onClose}><Icon name="X" weight="bold" size={16} color="currentColor" /></button>
        </div>

        <div className="modal-body">
          {step === 1 && (
            <div className="survey-configuration">
              <h3>Configure Your Survey</h3>
              {/* Only ever set on step 1 by the resume path, when the stored
                  job id has outlived the job record's three-day TTL. */}
              <StatusMessage message={generationStatus} tone="pending" />
              <div className="config-form">
                <div className="form-row">
                  <div className="form-group">
                    <label>Survey Title *</label>
                    <input
                      type="text"
                      value={surveyConfig.title}
                      onChange={(e) => setSurveyConfig(prev => ({ ...prev, title: e.target.value }))}
                      placeholder="e.g., Employee Satisfaction Survey, Product Feedback"
                    />
                  </div>
                  <div className="form-group">
                    <label>Topic/Subject *</label>
                    <input
                      type="text"
                      value={surveyConfig.topic}
                      onChange={(e) => setSurveyConfig(prev => ({ ...prev, topic: e.target.value }))}
                      placeholder="e.g., Workplace Culture, Product Experience"
                    />
                  </div>
                </div>

                <div className="form-group">
                  <label>Survey Description</label>
                  <textarea
                    value={surveyConfig.description}
                    onChange={(e) => setSurveyConfig(prev => ({ ...prev, description: e.target.value }))}
                    placeholder="Brief description of the survey purpose and what participants can expect..."
                    rows="3"
                  />
                </div>

                <div className="form-row">
                  <div className="form-group">
                    <label>Target Audience</label>
                    <input
                      type="text"
                      value={surveyConfig.audience}
                      onChange={(e) => setSurveyConfig(prev => ({ ...prev, audience: e.target.value }))}
                      placeholder="e.g., Employees, Customers, Students"
                    />
                  </div>
                  <div className="form-group">
                    <label>Survey Purpose</label>
                    <input
                      type="text"
                      value={surveyConfig.purpose}
                      onChange={(e) => setSurveyConfig(prev => ({ ...prev, purpose: e.target.value }))}
                      placeholder="e.g., Feedback Collection, Research, Assessment"
                    />
                  </div>
                </div>

                <div className="form-row">
                  <div className="form-group">
                    <label>Number of Questions: <strong>{surveyConfig.questionCount}</strong></label>
                    <div className="quantity-controls">
                      <input
                        type="range"
                        min="5"
                        max="50"
                        value={surveyConfig.questionCount}
                        onChange={(e) => setSurveyConfig(prev => ({ ...prev, questionCount: parseInt(e.target.value) }))}
                        className="quantity-slider"
                      />
                      <input
                        type="number"
                        min="5"
                        max="50"
                        value={surveyConfig.questionCount}
                        onChange={(e) => setSurveyConfig(prev => ({ ...prev, questionCount: Math.min(50, Math.max(5, parseInt(e.target.value) || 5)) }))}
                        className="quantity-input"
                      />
                    </div>
                    <div className="quantity-presets">
                      <button type="button" className="preset-btn" onClick={() => setSurveyConfig(prev => ({ ...prev, questionCount: 10 }))}>10</button>
                      <button type="button" className="preset-btn" onClick={() => setSurveyConfig(prev => ({ ...prev, questionCount: 15 }))}>15</button>
                      <button type="button" className="preset-btn" onClick={() => setSurveyConfig(prev => ({ ...prev, questionCount: 25 }))}>25</button>
                      <button type="button" className="preset-btn" onClick={() => setSurveyConfig(prev => ({ ...prev, questionCount: 40 }))}>40</button>
                    </div>
                  </div>
                </div>

                <div className="question-types-selection">
                  <h4>Include Question Types:</h4>
                  {questionTypes.map(type => (
                    <div key={type.id} className="question-type-option">
                      <label>
                        <input
                          type="checkbox"
                          checked={surveyConfig[`include${type.id.charAt(0).toUpperCase() + type.id.slice(1).replace('_', '')}`]}
                          onChange={(e) => {
                            const fieldName = `include${type.id.charAt(0).toUpperCase() + type.id.slice(1).replace('_', '')}`;
                            setSurveyConfig(prev => ({ ...prev, [fieldName]: e.target.checked }));
                          }}
                        />
                        <strong>{type.label}</strong>
                        <span className="type-description">{type.description}</span>
                      </label>
                    </div>
                  ))}
                </div>

                <div className="form-group">
                  <label>Additional Requirements (Optional)</label>
                  <textarea
                    value={surveyConfig.customPrompt}
                    onChange={(e) => setSurveyConfig(prev => ({ ...prev, customPrompt: e.target.value }))}
                    placeholder="Any specific requirements, themes, or constraints for the survey..."
                    rows="3"
                  />
                </div>

                <FileUploadPrompt
                  onContentExtracted={(content) => {
                    setSurveyConfig(prev => ({
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
            <div className="survey-generation">
              {!reviewing ? (
                <GenerationJobPanel
                  job={interpreted}
                  noun="questions"
                  jobId={jobIdRef.current}
                  statusLine={generationStatus}
                  transportError={transportError}
                  onKeepRunning={onClose}
                  onReconnect={() => jobIdRef.current && watchJob(jobIdRef.current)}
                  onReview={() => setReviewingPartial(true)}
                  onRetryRemaining={retryRemaining}
                  onDiscard={backToConfiguration}
                  onBackToConfig={backToConfiguration}
                />
              ) : !editingItem ? (
                <div className="survey-review">
                  <div className="survey-header">
                    <h3>{generatedSurvey?.title}</h3>
                    <p>{generatedSurvey?.description}</p>
                  </div>
                  <GeneratedItemsTable
                    items={surveyQuestions}
                    requested={interpreted.requested}
                    noun="questions"
                    excluded={excluded}
                    onToggleExclude={toggleExcluded}
                    onEdit={(index) => { setCurrentQuestionIndex(index); setTagDraft(null); setEditingItem(true); }}
                    primary={(question) => question.question}
                    secondary={(question) => (Array.isArray(question.options) && question.options.length
                      ? question.options.join(' · ')
                      : question.placeholder || null)}
                    flag={questionDefect}
                    columns={[
                      { header: 'Type', value: (question) => String(question.type || '').replace('_', ' '), width: '150px', filterable: true },
                    ]}
                    actions={(
                      <>
                        <button className="btn-secondary" onClick={handleExportJSON}>
                          <Icon name="FileText" weight="bold" size={16} color="currentColor" /> Export JSON
                        </button>
                        <button className="btn-primary" onClick={handleExportAndClose} disabled={keptQuestions.length === 0}>
                          <Icon name="DownloadSimple" weight="bold" size={16} color="currentColor" /> Export JSON and close
                        </button>
                      </>
                    )}
                  />
                  {/* O1. Say what the two buttons above actually do, because the
                      form still offers Survey and the server has no survey
                      import path at all. */}
                  <p
                    className="survey-export-note"
                    /* #5b6b7c on the modal's white is 5.47:1 — the builders'
                       usual #7f8c8d is 3.48:1 and fails AA. */
                    style={{ marginTop: '12px', fontSize: '13px', color: '#5b6b7c' }}
                  >
                    Both buttons download a JSON file. A survey set <b>cannot</b> be added to the
                    question-set library: <code>upload-questions</code> rejects survey uploads
                    outright, and no game type plays one. Keep the file until that changes.
                  </p>
                </div>
              ) : (
                <div className="survey-review">
                  <div className="survey-header">
                    <h3>{generatedSurvey?.title}</h3>
                    <p>{generatedSurvey?.description}</p>
                  </div>

                  <div className="question-navigation">
                    <button
                      className="nav-button prev"
                      onClick={() => navigateQuestion('prev')}
                      disabled={currentQuestionIndex === 0}
                    >
                      <Icon name="ArrowLeft" weight="bold" size={16} color="currentColor" /> Previous
                    </button>
                    
                    <div className="question-counter">
                      <span>Question {currentQuestionIndex + 1} of {generatedSurvey.questions.length}</span>
                      <div className="question-type-badge">{currentQuestion?.type.replace('_', ' ')}</div>
                    </div>
                    
                    <button
                      className="nav-button next"
                      onClick={() => navigateQuestion('next')}
                      disabled={currentQuestionIndex === generatedSurvey.questions.length - 1}
                    >
                      Next <Icon name="ArrowRight" weight="bold" size={16} color="currentColor" />
                    </button>
                  </div>

                  {currentQuestion && (
                    <div className="question-editor">
                      <div className="form-group">
                        <label>Question Text</label>
                        <input
                          type="text"
                          value={currentQuestion.question || ''}
                          onChange={(e) => handleQuestionEdit(currentQuestionIndex, 'question', e.target.value)}
                        />
                      </div>

                      <div className="form-group">
                        <label>Question Type</label>
                        <select
                          value={currentQuestion.type}
                          onChange={(e) => handleQuestionEdit(currentQuestionIndex, 'type', e.target.value)}
                        >
                          <option value="rating">Rating Scale</option>
                          <option value="multiple_choice">Multiple Choice</option>
                          <option value="text_entry">Text Entry</option>
                        </select>
                      </div>

                      {renderQuestionEditor(currentQuestion, currentQuestionIndex)}

                      {/*
                        Suggested tags, not imposed tags. The model that just wrote
                        the question is best placed to say what it is about, but the
                        owner gets the final word before anything is saved. Stored
                        as a flat lowercase kebab-case array under `tags`.
                      */}
                      <div className="form-group">
                        <label>Tags <span className="field-hint">suggested — edit freely, comma separated</span></label>
                        <input
                          type="text"
                          value={tagDraft !== null ? tagDraft : (currentQuestion?.tags || []).join(', ')}
                          onChange={(e) => setTagDraft(e.target.value)}
                          onBlur={() => {
                            if (tagDraft !== null) {
                              handleQuestionEdit(currentQuestionIndex, 'tags', normalizeTags(tagDraft));
                              setTagDraft(null);
                            }
                          }}
                          placeholder="employee-satisfaction, culture, feedback"
                        />
                        {(currentQuestion?.tags || []).length > 0 && (
                          <div className="tag-chips">
                            {currentQuestion.tags.map((tag) => (
                              <span className="tag-chip" key={tag}>{tag}</span>
                            ))}
                          </div>
                        )}
                      </div>

                      <div className="question-preview">
                        <h4>Preview:</h4>
                        <div className="question-preview-display">
                          <div className="question-text">
                            <h5>{currentQuestion.question}</h5>
                            <div className="question-type-indicator">{currentQuestion.type.replace('_', ' ')}</div>
                          </div>
                          {renderQuestionPreview(currentQuestion)}
                        </div>
                      </div>
                    </div>
                  )}

                  <div className="survey-actions">
                    <button className="btn-secondary" onClick={() => { setTagDraft(null); setEditingItem(false); }}>
                      <Icon name="ListChecks" weight="bold" size={16} color="currentColor" /> Back to all {surveyQuestions.length} questions
                    </button>
                    <button
                      className="btn-secondary"
                      onClick={() => toggleExcluded(currentQuestionIndex)}
                    >
                      {excluded.has(currentQuestionIndex) ? 'Put this one back' : 'Leave this one out'}
                    </button>
                  </div>
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
                disabled={!surveyConfig.title.trim() || !surveyConfig.topic.trim()}
              >
                <Icon name="Sparkle" weight="duotone" size={16} color="var(--primary)" /> Generate Survey
              </button>
            </>
          )}
          {step === 2 && reviewing && (
            <>
              <button className="btn-secondary" onClick={backToConfiguration}>
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

export default SurveyAIBuilder;
