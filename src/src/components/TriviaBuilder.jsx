import React from 'react';

function TriviaBuilder({ questions, onUpdateQuestion, onDeleteQuestion, onAIAssistance }) {
  
  const handleQuestionChange = (index, field, value) => {
    const updatedQuestion = { ...questions[index], [field]: value };
    onUpdateQuestion(index, updatedQuestion);
  };

  const handleWrongAnswerChange = (questionIndex, answerIndex, value) => {
    const question = questions[questionIndex];
    const updatedWrongAnswers = [...question.wrongAnswers];
    updatedWrongAnswers[answerIndex] = value;
    handleQuestionChange(questionIndex, 'wrongAnswers', updatedWrongAnswers);
  };

  return (
    <div className="trivia-builder">
      {questions.map((question, index) => (
        <div key={question.id} className="question-card">
          <div className="question-header">
            <h3>Trivia Question {index + 1}</h3>
            <div className="question-actions">
              <button
                className="btn-ai"
                onClick={() => onAIAssistance(index)}
                title="Get AI assistance for this question"
              >
                🤖 AI Help
              </button>
              <button
                className="btn-danger btn-small"
                onClick={() => onDeleteQuestion(index)}
                title="Delete this question"
              >
                🗑️
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
                  placeholder="e.g., History, Science, Business"
                  className="input-field"
                />
              </div>
              <div className="form-group">
                <label>Difficulty</label>
                <select
                  value={question.difficulty}
                  onChange={(e) => handleQuestionChange(index, 'difficulty', e.target.value)}
                  className="input-field"
                >
                  <option value="easy">Easy</option>
                  <option value="medium">Medium</option>
                  <option value="hard">Hard</option>
                </select>
              </div>
              <div className="form-group">
                <label>School/Context</label>
                <input
                  type="text"
                  value={question.school}
                  onChange={(e) => handleQuestionChange(index, 'school', e.target.value)}
                  placeholder="e.g., Business School"
                  className="input-field"
                />
              </div>
            </div>

            <div className="form-row">
              <div className="form-group full-width">
                <label>Question *</label>
                <input
                  type="text"
                  value={question.title}
                  onChange={(e) => handleQuestionChange(index, 'title', e.target.value)}
                  placeholder="Enter the trivia question"
                  className="input-field"
                />
              </div>
            </div>

            <div className="form-row">
              <div className="form-group full-width">
                <label>Additional Context/Explanation</label>
                <textarea
                  value={question.detail}
                  onChange={(e) => handleQuestionChange(index, 'detail', e.target.value)}
                  placeholder="Background information or explanation (optional)"
                  className="textarea-field"
                  rows="3"
                />
              </div>
            </div>

            <div className="answers-section">
              <h4>Answers</h4>
              
              <div className="form-row">
                <div className="form-group full-width">
                  <label>Correct Answer *</label>
                  <input
                    type="text"
                    value={question.correctAnswer}
                    onChange={(e) => handleQuestionChange(index, 'correctAnswer', e.target.value)}
                    placeholder="Enter the correct answer"
                    className="input-field correct-answer"
                  />
                </div>
              </div>

              <div className="wrong-answers">
                <label>Wrong Answers (3 required) *</label>
                {question.wrongAnswers.map((wrongAnswer, answerIndex) => (
                  <div key={answerIndex} className="form-row">
                    <div className="form-group full-width">
                      <input
                        type="text"
                        value={wrongAnswer}
                        onChange={(e) => handleWrongAnswerChange(index, answerIndex, e.target.value)}
                        placeholder={`Wrong answer ${answerIndex + 1}`}
                        className="input-field wrong-answer"
                      />
                    </div>
                  </div>
                ))}
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
              <strong>Category:</strong> {question.category || 'Not specified'} 
              <span className="difficulty-badge">{question.difficulty}</span><br/>
              <strong>Question:</strong> {question.title || 'No question entered'}<br/>
              <strong>Correct Answer:</strong> {question.correctAnswer || 'Not specified'}<br/>
              <strong>Wrong Answers:</strong> {question.wrongAnswers.filter(a => a.trim()).join(', ') || 'Not specified'}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

export default TriviaBuilder;
