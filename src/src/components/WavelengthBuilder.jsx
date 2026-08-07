import React from 'react';
import Icon from './Icon';

function WavelengthBuilder({ questions, onUpdateQuestion, onDeleteQuestion, onAIAssistance }) {
  
  const handleQuestionChange = (index, field, value) => {
    const updatedQuestion = { ...questions[index], [field]: value };
    onUpdateQuestion(index, updatedQuestion);
  };

  return (
    <div className="wavelength-builder">
      {questions.map((question, index) => (
        <div key={question.id} className="question-card">
          <div className="question-header">
            <h3>Wavelength Question {index + 1}</h3>
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
                  placeholder="e.g., Leadership, Strategy, Communication"
                  className="input-field"
                />
              </div>
              <div className="form-group">
                <label>School/Context</label>
                <input
                  type="text"
                  value={question.school}
                  onChange={(e) => handleQuestionChange(index, 'school', e.target.value)}
                  placeholder="e.g., Business School, Trade School"
                  className="input-field"
                />
              </div>
            </div>

            <div className="form-row">
              <div className="form-group full-width">
                <label>Question Title *</label>
                <input
                  type="text"
                  value={question.title}
                  onChange={(e) => handleQuestionChange(index, 'title', e.target.value)}
                  placeholder="Enter the main question or prompt"
                  className="input-field"
                />
              </div>
            </div>

            <div className="form-row">
              <div className="form-group full-width">
                <label>Topic/Word *</label>
                <input
                  type="text"
                  value={question.topic || question.detail || ''}
                  onChange={(e) => handleQuestionChange(index, 'topic', e.target.value)}
                  placeholder="Enter the topic or starting word that players will respond to"
                  className="input-field"
                />
              </div>
            </div>

            <div className="form-row">
              <div className="form-group full-width">
                <label>Instructions</label>
                <textarea
                  value={question.instructions || 'Enter 10 words that come to mind when you think of this topic:'}
                  onChange={(e) => handleQuestionChange(index, 'instructions', e.target.value)}
                  placeholder="Instructions for players (default: Enter 10 words that come to mind when you think of this topic:)"
                  className="textarea-field"
                  rows="3"
                />
              </div>
            </div>

            <div className="form-row">
              <div className="form-group full-width">
                <label>Custom Instructions</label>
                <textarea
                  value={question.customInstructions}
                  onChange={(e) => handleQuestionChange(index, 'customInstructions', e.target.value)}
                  placeholder="Specific instructions for this question (optional)"
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
              <strong>Question:</strong> {question.title || 'No title entered'}<br/>
              <strong>Topic:</strong> {question.topic || question.detail || 'No topic entered'}<br/>
              <strong>Instructions:</strong> {question.instructions || 'Enter 10 words that come to mind when you think of this topic:'}
            </div>
            <div className="wavelength-preview">
              <div style={{marginTop: '10px', padding: '10px', background: '#f5f5f5', borderRadius: '4px'}}>
                <strong>Player will see:</strong>
                <div style={{marginTop: '5px'}}>
                  <div><strong>Topic:</strong> {question.topic || question.detail || '[Topic]'}</div>
                  <div style={{marginTop: '5px'}}>{question.instructions || 'Enter 10 words that come to mind when you think of this topic:'}</div>
                  <div style={{marginTop: '5px', fontSize: '0.9em', color: '#666'}}>
                    [10 text boxes will appear for player responses]
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

export default WavelengthBuilder;