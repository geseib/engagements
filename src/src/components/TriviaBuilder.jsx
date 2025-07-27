import React from 'react';

function TriviaBuilder({ questions, onUpdateQuestion, onDeleteQuestion, onAIAssistance }) {
  
  const handleQuestionChange = (index, field, value) => {
    const updatedQuestion = { ...questions[index], [field]: value };
    onUpdateQuestion(index, updatedQuestion);
  };

  const handleOptionChange = (questionIndex, optionKey, value) => {
    handleQuestionChange(questionIndex, optionKey, value);
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
                <label>Question Title *</label>
                <input
                  type="text"
                  value={question.title}
                  onChange={(e) => handleQuestionChange(index, 'title', e.target.value)}
                  placeholder="Short descriptive title (e.g., 'Mastermind of the Boston Tea Party')"
                  className="input-field"
                />
              </div>
            </div>

            <div className="form-row">
              <div className="form-group full-width">
                <label>Question Text *</label>
                <textarea
                  value={question.questionDetail}
                  onChange={(e) => handleQuestionChange(index, 'questionDetail', e.target.value)}
                  placeholder="Enter the actual trivia question that will be shown to players"
                  className="textarea-field"
                  rows="3"
                />
              </div>
            </div>

            <div className="form-row">
              <div className="form-group full-width">
                <label>Answer Explanation</label>
                <textarea
                  value={question.answerDetails}
                  onChange={(e) => handleQuestionChange(index, 'answerDetails', e.target.value)}
                  placeholder="Educational explanation about the correct answer (shown in results)"
                  className="textarea-field"
                  rows="3"
                />
              </div>
            </div>

            <div className="answers-section">
              <h4>Answer Options</h4>
              
              {['A', 'B', 'C', 'D'].map((letter, optionIndex) => {
                const optionKey = `option${letter}`;
                const optionId = `Option${letter}`;
                const correctAnswers = Array.isArray(question.correctAnswer) ? question.correctAnswer : [question.correctAnswer];
                const isCorrect = correctAnswers.includes(optionId);
                
                return (
                  <div key={optionKey} className="form-row option-row">
                    <div className="option-selector">
                      <input
                        type="checkbox"
                        checked={isCorrect}
                        onChange={(e) => {
                          if (e.target.checked) {
                            // Add to correct answers
                            const newCorrectAnswers = Array.isArray(question.correctAnswer) 
                              ? [...question.correctAnswer, optionId]
                              : [question.correctAnswer, optionId].filter(Boolean);
                            handleQuestionChange(index, 'correctAnswer', newCorrectAnswers.length === 1 ? newCorrectAnswers[0] : newCorrectAnswers);
                          } else {
                            // Remove from correct answers
                            const newCorrectAnswers = correctAnswers.filter(id => id !== optionId);
                            handleQuestionChange(index, 'correctAnswer', newCorrectAnswers.length === 1 ? newCorrectAnswers[0] : newCorrectAnswers);
                          }
                        }}
                        className="correct-checkbox"
                      />
                      <span className="option-letter">{letter}.</span>
                    </div>
                    <div className="form-group full-width">
                      <input
                        type="text"
                        value={question[optionKey] || ''}
                        onChange={(e) => handleOptionChange(index, optionKey, e.target.value)}
                        placeholder={`Answer option ${letter}`}
                        className={`input-field ${isCorrect ? 'correct-answer' : ''}`}
                      />
                    </div>
                  </div>
                );
              })}
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
              <strong>Title:</strong> {question.title || 'No title entered'}<br/>
              <strong>Question:</strong> {question.questionDetail || 'No question text entered'}<br/>
              <strong>Correct Answer(s):</strong> {(() => {
                const correctAnswers = Array.isArray(question.correctAnswer) ? question.correctAnswer : [question.correctAnswer];
                return correctAnswers.filter(Boolean).map(ans => `${ans.replace('Option', '')}. ${question[ans.toLowerCase()]}`).join(', ') || 'Not specified';
              })()}<br/>
              <strong>Options:</strong> {['optionA', 'optionB', 'optionC', 'optionD'].map(opt => question[opt]).filter(a => a && a.trim()).join(' | ') || 'Not specified'}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

export default TriviaBuilder;
