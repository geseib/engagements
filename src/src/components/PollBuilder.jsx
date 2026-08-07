import React from 'react';
import Icon from './Icon';

function PollBuilder({ questions, onUpdateQuestion, onDeleteQuestion, onAIAssistance }) {
  
  const handleQuestionChange = (index, field, value) => {
    const updatedQuestion = { ...questions[index], [field]: value };
    onUpdateQuestion(index, updatedQuestion);
  };

  const handleOptionChange = (questionIndex, optionIndex, value) => {
    const question = questions[questionIndex];
    const updatedOptions = [...question.options];
    updatedOptions[optionIndex] = value;
    handleQuestionChange(questionIndex, 'options', updatedOptions);
  };

  const addOption = (questionIndex) => {
    const question = questions[questionIndex];
    const updatedOptions = [...question.options, ''];
    handleQuestionChange(questionIndex, 'options', updatedOptions);
  };

  const removeOption = (questionIndex, optionIndex) => {
    const question = questions[questionIndex];
    if (question.options.length > 2) { // Keep at least 2 options
      const updatedOptions = question.options.filter((_, i) => i !== optionIndex);
      handleQuestionChange(questionIndex, 'options', updatedOptions);
    }
  };

  return (
    <div className="poll-builder">
      {questions.map((question, index) => (
        <div key={question.id} className="question-card">
          <div className="question-header">
            <h3>Poll Question {index + 1}</h3>
            <div className="question-actions">
              <button
                className="btn-ai"
                onClick={() => onAIAssistance(index)}
                title="Get AI assistance for this question"
              >
                <Icon name="Sparkle" weight="duotone" size={16} color="var(--primary)" /> AI Help
              </button>
              <button
                className="btn-danger btn-small"
                onClick={() => onDeleteQuestion(index)}
                title="Delete this question"
              >
                <Icon name="Trash" weight="bold" size={16} color="currentColor" />
              </button>
            </div>
          </div>

          <div className="question-form">
            <div className="form-row">
              <div className="form-group">
                <label>Category *</label>
                <input
                  type="text"
                  value={question.category}
                  onChange={(e) => handleQuestionChange(index, 'category', e.target.value)}
                  placeholder="e.g., Preferences, Opinions, Feedback"
                  className="input-field"
                />
              </div>
              <div className="form-group">
                <label>School/Context</label>
                <input
                  type="text"
                  value={question.school}
                  onChange={(e) => handleQuestionChange(index, 'school', e.target.value)}
                  placeholder="e.g., Business School, Survey"
                  className="input-field"
                />
              </div>
            </div>

            <div className="form-row">
              <div className="form-group full-width">
                <label>Poll Question *</label>
                <input
                  type="text"
                  value={question.title}
                  onChange={(e) => handleQuestionChange(index, 'title', e.target.value)}
                  placeholder="Enter the poll question"
                  className="input-field"
                />
              </div>
            </div>

            <div className="form-row">
              <div className="form-group full-width">
                <label>Additional Context/Description</label>
                <textarea
                  value={question.detail}
                  onChange={(e) => handleQuestionChange(index, 'detail', e.target.value)}
                  placeholder="Provide additional context or description for the poll (optional)"
                  className="textarea-field"
                  rows="3"
                />
              </div>
            </div>

            <div className="options-section">
              <div className="options-header">
                <h4>Poll Options</h4>
                <button
                  type="button"
                  className="btn-secondary btn-small"
                  onClick={() => addOption(index)}
                >
                  <Icon name="Plus" weight="bold" size={16} color="currentColor" /> Add Option
                </button>
              </div>
              
              {question.options.map((option, optionIndex) => (
                <div key={optionIndex} className="option-row">
                  <div className="form-group option-input">
                    <label>Option {optionIndex + 1} *</label>
                    <input
                      type="text"
                      value={option}
                      onChange={(e) => handleOptionChange(index, optionIndex, e.target.value)}
                      placeholder={`Enter option ${optionIndex + 1}`}
                      className="input-field"
                    />
                  </div>
                  {question.options.length > 2 && (
                    <button
                      type="button"
                      className="btn-danger btn-small remove-option"
                      onClick={() => removeOption(index, optionIndex)}
                      title="Remove this option"
                    >
                      <Icon name="Trash" weight="bold" size={16} color="currentColor" />
                    </button>
                  )}
                </div>
              ))}
            </div>

            <div className="form-row">
              <div className="form-group">
                <label>
                  <input
                    type="checkbox"
                    checked={question.allowMultiple}
                    onChange={(e) => handleQuestionChange(index, 'allowMultiple', e.target.checked)}
                  />
                  Allow multiple selections
                </label>
              </div>
            </div>

            <div className="form-row">
              <div className="form-group full-width">
                <label>Custom Instructions</label>
                <textarea
                  value={question.customInstructions}
                  onChange={(e) => handleQuestionChange(index, 'customInstructions', e.target.value)}
                  placeholder="Specific instructions for this poll question (optional)"
                  className="textarea-field"
                  rows="2"
                />
              </div>
            </div>

            <div className="form-row">
              <div className="form-group">
                <label>
                  <input
                    type="checkbox"
                    checked={question.active}
                    onChange={(e) => handleQuestionChange(index, 'active', e.target.checked)}
                  />
                  Active (include in question set)
                </label>
              </div>
            </div>
          </div>

          <div className="question-preview">
            <h4>Preview:</h4>
            <div className="preview-content">
              <strong>Category:</strong> {question.category || 'Not specified'}<br/>
              <strong>Question:</strong> {question.title || 'No question entered'}<br/>
              <strong>Options:</strong> {question.options.filter(o => o.trim()).join(', ') || 'No options specified'}<br/>
              <strong>Multiple Selection:</strong> {question.allowMultiple ? 'Yes' : 'No'}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

export default PollBuilder;
