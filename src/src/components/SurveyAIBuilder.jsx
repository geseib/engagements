import React, { useState } from 'react';
import FileUploadPrompt from './FileUploadPrompt';
import { authFetch } from '../auth/authFetch';

const API_BASE = window.API_BASE;

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
  const [isGenerating, setIsGenerating] = useState(false);
  const [generationStatus, setGenerationStatus] = useState('');

  const questionTypes = [
    { id: 'rating', label: 'Rating Questions', description: 'Scale-based questions (1-5, 1-10, etc.)' },
    { id: 'multiple_choice', label: 'Multiple Choice', description: 'Questions with predefined options' },
    { id: 'text_entry', label: 'Text Entry', description: 'Open-ended questions requiring written responses' }
  ];

  const handleConfigSubmit = async () => {
    setIsGenerating(true);
    setGenerationStatus('🤖 Generating comprehensive survey with AI...');
    setStep(2);

    try {
      const response = await authFetch(`${API_BASE}admin/ai-generate-survey`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
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
        })
      });

      const result = await response.json();

      if (response.ok) {
        setGeneratedSurvey(result.survey);
        setGenerationStatus(`✅ Generated survey with ${result.survey.questions.length} questions successfully`);
        setCurrentQuestionIndex(0);
      } else {
        setGenerationStatus(`❌ Generation failed: ${result.error || 'Unknown error'}`);
      }
    } catch (error) {
      console.error('AI survey generation error:', error);
      setGenerationStatus(`❌ Generation failed: ${error.message}`);
    } finally {
      setIsGenerating(false);
    }
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
    if (direction === 'prev' && currentQuestionIndex > 0) {
      setCurrentQuestionIndex(currentQuestionIndex - 1);
    } else if (direction === 'next' && currentQuestionIndex < generatedSurvey.questions.length - 1) {
      setCurrentQuestionIndex(currentQuestionIndex + 1);
    }
  };

  const handleExportJSON = () => {
    const jsonContent = JSON.stringify(generatedSurvey, null, 2);
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

  const handleLoadIntoSystem = () => {
    onSurveyGenerated({
      survey: generatedSurvey,
      metadata: {
        title: surveyConfig.title,
        description: surveyConfig.description,
        type: 'survey',
        questionCount: generatedSurvey.questions.length
      }
    });
  };

  const currentQuestion = generatedSurvey?.questions[currentQuestionIndex];

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
                      ✕
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
          <h2>📋 AI Survey Builder</h2>
          <button className="close-button" onClick={onClose}>✕</button>
        </div>

        <div className="modal-body">
          {step === 1 && (
            <div className="survey-configuration">
              <h3>Configure Your Survey</h3>
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
              {isGenerating ? (
                <div className="generation-progress">
                  <div className="spinner"></div>
                  <p>{generationStatus}</p>
                </div>
              ) : generatedSurvey ? (
                <div className="survey-review">
                  <div className="survey-header">
                    <h3>{generatedSurvey.title}</h3>
                    <p>{generatedSurvey.description}</p>
                  </div>

                  <div className="question-navigation">
                    <button
                      className="nav-button prev"
                      onClick={() => navigateQuestion('prev')}
                      disabled={currentQuestionIndex === 0}
                    >
                      ← Previous
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
                      Next →
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
                    <button className="btn-secondary" onClick={handleExportJSON}>
                      📄 Export JSON
                    </button>
                    <button className="btn-primary" onClick={handleLoadIntoSystem}>
                      📥 Load into System
                    </button>
                  </div>
                </div>
              ) : (
                <div className="generation-error">
                  <p>{generationStatus}</p>
                  <button className="btn-secondary" onClick={() => setStep(1)}>
                    ← Back to Configuration
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
                disabled={!surveyConfig.title.trim() || !surveyConfig.topic.trim()}
              >
                🤖 Generate Survey
              </button>
            </>
          )}
          {step === 2 && !isGenerating && generatedSurvey && (
            <>
              <button className="btn-secondary" onClick={() => setStep(1)}>
                ← Back to Configuration
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
