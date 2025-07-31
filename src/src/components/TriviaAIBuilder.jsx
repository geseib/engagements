import React, { useState } from 'react';
import FileUploadPrompt from './FileUploadPrompt';

const API_BASE = window.API_BASE;

function TriviaAIBuilder({ onClose, onTriviaGenerated }) {
  const [step, setStep] = useState(1);
  const [triviaConfig, setTriviaConfig] = useState({
    topic: '',
    audience: '',
    difficulty: 'medium',
    count: 10,
    numChoices: 4,
    numCorrect: 1,
    numberOfCategories: 3,
    mustHaveCategories: '',
    customPrompt: ''
  });
  const [generatedTrivia, setGeneratedTrivia] = useState([]);
  const [currentTriviaIndex, setCurrentTriviaIndex] = useState(0);
  const [isGenerating, setIsGenerating] = useState(false);
  const [generationStatus, setGenerationStatus] = useState('');

  const difficultyLevels = [
    { value: 'easy', label: 'Easy', description: 'Basic knowledge, straightforward questions' },
    { value: 'medium', label: 'Medium', description: 'Moderate difficulty, some thinking required' },
    { value: 'hard', label: 'Hard', description: 'Advanced knowledge, challenging questions' }
  ];

  const handleConfigSubmit = async () => {
    setIsGenerating(true);
    setGenerationStatus('🤖 Generating trivia questions with AI...');
    setStep(2);

    try {
      // Break large requests into chunks to avoid timeout and rate limiting
      const CHUNK_SIZE = 5; // Reduced to 5 questions per request for better rate limiting
      const totalCount = triviaConfig.count;
      const chunks = Math.ceil(totalCount / CHUNK_SIZE);
      
      let allQuestions = [];
      
      // Helper function for batch retry with exponential backoff
      const retryBatch = async (batchIndex, chunkSize, maxRetries = 3) => {
        for (let attempt = 0; attempt <= maxRetries; attempt++) {
          try {
            const response = await fetch(`${API_BASE}admin/ai-generate-trivia`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                topic: triviaConfig.topic,
                audience: triviaConfig.audience,
                difficulty: triviaConfig.difficulty,
                count: chunkSize,
                numChoices: triviaConfig.numChoices,
                numCorrect: triviaConfig.numCorrect,
                numberOfCategories: triviaConfig.numberOfCategories,
                mustHaveCategories: triviaConfig.mustHaveCategories,
                customPrompt: triviaConfig.customPrompt
              })
            });

            const result = await response.json();

            if (response.ok) {
              return result.questions;
            } else {
              const error = result.error || 'Unknown error';
              const isThrottled = error.includes('Too many requests') || 
                                error.includes('throttle') || 
                                error.includes('rate limit') ||
                                response.status === 429;
              
              if (isThrottled && attempt < maxRetries) {
                // For rate limits, wait longer - at least 30 seconds
                const baseDelay = 30000; // 30 seconds minimum
                const delay = baseDelay + (attempt * 15000) + Math.random() * 5000; // 30s, 45s, 60s...
                setGenerationStatus(`⏳ Rate limited! Waiting ${Math.round(delay/1000)}s before retry (Bedrock has per-minute limits)`);
                await new Promise(resolve => setTimeout(resolve, delay));
                continue;
              }
              
              throw new Error(`Batch ${batchIndex + 1} failed: ${error}`);
            }
          } catch (fetchError) {
            if (attempt < maxRetries) {
              const delay = Math.pow(2, attempt) * 2000 + Math.random() * 1000;
              setGenerationStatus(`⏳ Batch ${batchIndex + 1} error, retrying in ${Math.round(delay/1000)}s (attempt ${attempt + 1}/${maxRetries + 1})`);
              await new Promise(resolve => setTimeout(resolve, delay));
              continue;
            }
            throw fetchError;
          }
        }
      };

      for (let i = 0; i < chunks; i++) {
        const remainingCount = totalCount - (i * CHUNK_SIZE);
        const chunkSize = Math.min(CHUNK_SIZE, remainingCount);
        
        setGenerationStatus(`🤖 Generating batch ${i + 1} of ${chunks} (${chunkSize} questions)...`);
        
        const batchQuestions = await retryBatch(i, chunkSize);
        allQuestions.push(...batchQuestions);
        setGenerationStatus(`✅ Generated ${allQuestions.length} of ${totalCount} questions...`);
        
        // Much longer delay between successful requests to respect per-minute rate limits
        if (i < chunks - 1) {
          const interBatchDelay = 12000; // 12 seconds between batches
          setGenerationStatus(`⏳ Waiting ${interBatchDelay/1000}s before next batch (respecting rate limits)...`);
          await new Promise(resolve => setTimeout(resolve, interBatchDelay));
        }
      }

      setGeneratedTrivia(allQuestions);
      setGenerationStatus(`✅ Generated ${allQuestions.length} trivia questions successfully`);
      setCurrentTriviaIndex(0);
      
    } catch (error) {
      console.error('AI trivia generation error:', error);
      setGenerationStatus(`❌ Generation failed: ${error.message}`);
    } finally {
      setIsGenerating(false);
    }
  };

  const handleTriviaEdit = (index, field, value) => {
    const updatedTrivia = [...generatedTrivia];
    updatedTrivia[index] = { ...updatedTrivia[index], [field]: value };
    setGeneratedTrivia(updatedTrivia);
  };

  const handleOptionEdit = (triviaIndex, optionKey, value) => {
    const updatedTrivia = [...generatedTrivia];
    updatedTrivia[triviaIndex] = { ...updatedTrivia[triviaIndex], [optionKey]: value };
    setGeneratedTrivia(updatedTrivia);
  };

  const navigateTrivia = (direction) => {
    if (direction === 'prev' && currentTriviaIndex > 0) {
      setCurrentTriviaIndex(currentTriviaIndex - 1);
    } else if (direction === 'next' && currentTriviaIndex < generatedTrivia.length - 1) {
      setCurrentTriviaIndex(currentTriviaIndex + 1);
    }
  };

  const handleExportCSV = () => {
    const csvContent = generateTriviaCSV();
    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `trivia-${triviaConfig.topic.replace(/[^a-zA-Z0-9]/g, '_')}-${Date.now()}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);
  };

  const generateTriviaCSV = () => {
    const headers = 'Category,Question#,Title,QuestionDetail,AnswerDetails,School,OptionA,OptionB,OptionC,OptionD,OptionE,OptionF,CorrectAnswer,Difficulty';
    const rows = generatedTrivia.map((trivia, index) => {
      const correctAnswer = Array.isArray(trivia.correctAnswer) ? trivia.correctAnswer.join(',') : trivia.correctAnswer;
      
      return `"${trivia.category}","${index + 1}","${trivia.title}","${trivia.questionDetail}","${trivia.answerDetails}","${trivia.school || 'General'}","${trivia.optionA || ''}","${trivia.optionB || ''}","${trivia.optionC || ''}","${trivia.optionD || ''}","${trivia.optionE || ''}","${trivia.optionF || ''}","${correctAnswer}","${trivia.difficulty}"`;
    });
    return headers + '\n' + rows.join('\n');
  };

  const handleLoadIntoSystem = () => {
    const metadata = {
      title: `${triviaConfig.topic} Trivia${triviaConfig.audience ? ` for ${triviaConfig.audience}` : ''}`,
      description: `${generatedTrivia.length} AI-generated trivia questions about ${triviaConfig.topic}. Difficulty: ${triviaConfig.difficulty}. ${triviaConfig.numChoices} choices per question.`,
      customInstructions: `Select the best answer for each question. ${triviaConfig.numCorrect > 1 ? `Some questions may have ${triviaConfig.numCorrect} correct answers.` : ''}`,
      aiContextInstructions: `These are ${triviaConfig.difficulty}-level trivia questions about ${triviaConfig.topic}. Provide explanations for correct answers and encourage learning.`
    };
    
    onTriviaGenerated({
      questions: generatedTrivia,
      metadata: metadata
    });
  };

  const currentTrivia = generatedTrivia[currentTriviaIndex];
  const optionKeys = ['optionA', 'optionB', 'optionC', 'optionD', 'optionE', 'optionF'];
  const availableOptions = optionKeys.slice(0, triviaConfig.numChoices);

  return (
    <div className="trivia-ai-builder-modal">
      <div className="modal-overlay" onClick={onClose}></div>
      <div className="modal-content trivia-builder" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>🧠 AI Trivia Builder</h2>
          <button className="close-button" onClick={onClose}>✕</button>
        </div>

        <div className="modal-body">
          {step === 1 && (
            <div className="trivia-configuration">
              <h3>Configure Your Trivia Questions</h3>
              <div className="config-form">
                <div className="form-row">
                  <div className="form-group">
                    <label>Topic/Subject *</label>
                    <input
                      type="text"
                      value={triviaConfig.topic}
                      onChange={(e) => setTriviaConfig(prev => ({ ...prev, topic: e.target.value }))}
                      placeholder="e.g., American History, Science, Business Strategy"
                    />
                  </div>
                </div>

                <div className="form-row">
                  <div className="form-group">
                    <label>Target Audience</label>
                    <input
                      type="text"
                      value={triviaConfig.audience}
                      onChange={(e) => setTriviaConfig(prev => ({ ...prev, audience: e.target.value }))}
                      placeholder="e.g., High School Students, Business Professionals"
                    />
                  </div>
                  <div className="form-group">
                    <label>Difficulty Level</label>
                    <select
                      value={triviaConfig.difficulty}
                      onChange={(e) => setTriviaConfig(prev => ({ ...prev, difficulty: e.target.value }))}
                    >
                      {difficultyLevels.map(level => (
                        <option key={level.value} value={level.value}>{level.label}</option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="form-row">
                  <div className="form-group">
                    <label>Number of Questions: <strong>{triviaConfig.count}</strong></label>
                    <div className="quantity-controls">
                      <input
                        type="range"
                        min="1"
                        max="100"
                        value={triviaConfig.count}
                        onChange={(e) => setTriviaConfig(prev => ({ ...prev, count: parseInt(e.target.value) }))}
                        className="quantity-slider"
                      />
                      <input
                        type="number"
                        min="1"
                        max="100"
                        value={triviaConfig.count}
                        onChange={(e) => setTriviaConfig(prev => ({ ...prev, count: Math.min(100, Math.max(1, parseInt(e.target.value) || 1)) }))}
                        className="quantity-input"
                      />
                    </div>
                    <div className="quantity-presets">
                      <button type="button" className="preset-btn" onClick={() => setTriviaConfig(prev => ({ ...prev, count: 5 }))}>5</button>
                      <button type="button" className="preset-btn" onClick={() => setTriviaConfig(prev => ({ ...prev, count: 10 }))}>10</button>
                      <button type="button" className="preset-btn" onClick={() => setTriviaConfig(prev => ({ ...prev, count: 20 }))}>20</button>
                      <button type="button" className="preset-btn" onClick={() => setTriviaConfig(prev => ({ ...prev, count: 50 }))}>50</button>
                    </div>
                  </div>
                </div>

                <div className="form-row">
                  <div className="form-group">
                    <label>Number of Answer Choices</label>
                    <select
                      value={triviaConfig.numChoices}
                      onChange={(e) => setTriviaConfig(prev => ({ ...prev, numChoices: parseInt(e.target.value) }))}
                    >
                      <option value={4}>4 choices (A, B, C, D)</option>
                      <option value={5}>5 choices (A, B, C, D, E)</option>
                      <option value={6}>6 choices (A, B, C, D, E, F)</option>
                    </select>
                  </div>
                  <div className="form-group">
                    <label>Number of Correct Answers</label>
                    <select
                      value={triviaConfig.numCorrect}
                      onChange={(e) => setTriviaConfig(prev => ({ ...prev, numCorrect: parseInt(e.target.value) }))}
                    >
                      <option value={1}>1 correct answer (default)</option>
                      <option value={2}>2 correct answers</option>
                      <option value={3}>3 correct answers</option>
                    </select>
                  </div>
                </div>

                <div className="form-row">
                  <div className="form-group">
                    <label>Number of Categories: <strong>{triviaConfig.numberOfCategories}</strong></label>
                    <div className="quantity-controls">
                      <input
                        type="range"
                        min="1"
                        max="24"
                        value={triviaConfig.numberOfCategories}
                        onChange={(e) => setTriviaConfig(prev => ({ ...prev, numberOfCategories: parseInt(e.target.value) }))}
                        className="quantity-slider"
                      />
                      <input
                        type="number"
                        min="1"
                        max="24"
                        value={triviaConfig.numberOfCategories}
                        onChange={(e) => setTriviaConfig(prev => ({ ...prev, numberOfCategories: Math.min(24, Math.max(1, parseInt(e.target.value) || 1)) }))}
                        className="quantity-input"
                      />
                    </div>
                    <div className="quantity-note" style={{fontSize: '0.9em', color: '#666', marginTop: '5px'}}>
                      Recommended: 1-8 categories for optimal organization
                    </div>
                    <div className="quantity-presets">
                      <button type="button" className="preset-btn" onClick={() => setTriviaConfig(prev => ({ ...prev, numberOfCategories: 3 }))}>3</button>
                      <button type="button" className="preset-btn" onClick={() => setTriviaConfig(prev => ({ ...prev, numberOfCategories: 5 }))}>5</button>
                      <button type="button" className="preset-btn" onClick={() => setTriviaConfig(prev => ({ ...prev, numberOfCategories: 8 }))}>8</button>
                      <button type="button" className="preset-btn" onClick={() => setTriviaConfig(prev => ({ ...prev, numberOfCategories: 12 }))}>12</button>
                    </div>
                  </div>
                  <div className="form-group">
                    <label>Must Have Categories</label>
                    <input
                      type="text"
                      value={triviaConfig.mustHaveCategories}
                      onChange={(e) => setTriviaConfig(prev => ({ ...prev, mustHaveCategories: e.target.value }))}
                      placeholder="History, Science, Sports, Entertainment..."
                    />
                  </div>
                </div>

                <div className="form-group">
                  <label>Additional Requirements (Optional)</label>
                  <textarea
                    value={triviaConfig.customPrompt}
                    onChange={(e) => setTriviaConfig(prev => ({ ...prev, customPrompt: e.target.value }))}
                    placeholder="Any specific requirements, themes, or constraints..."
                    rows="3"
                  />
                </div>

                <FileUploadPrompt
                  onContentExtracted={(content) => {
                    setTriviaConfig(prev => ({
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
            <div className="trivia-generation">
              {isGenerating ? (
                <div className="generation-progress">
                  <div className="spinner"></div>
                  <p>{generationStatus}</p>
                </div>
              ) : generatedTrivia.length > 0 ? (
                <div className="trivia-review">
                  <div className="trivia-navigation">
                    <button
                      className="nav-button prev"
                      onClick={() => navigateTrivia('prev')}
                      disabled={currentTriviaIndex === 0}
                    >
                      ← Previous
                    </button>
                    
                    <div className="trivia-counter">
                      <span>Question {currentTriviaIndex + 1} of {generatedTrivia.length}</span>
                      <h3>{currentTrivia?.title}</h3>
                    </div>
                    
                    <button
                      className="nav-button next"
                      onClick={() => navigateTrivia('next')}
                      disabled={currentTriviaIndex === generatedTrivia.length - 1}
                    >
                      Next →
                    </button>
                  </div>

                  {currentTrivia && (
                    <div className="trivia-editor">
                      <div className="form-group">
                        <label>Question Title</label>
                        <input
                          type="text"
                          value={currentTrivia.title || ''}
                          onChange={(e) => handleTriviaEdit(currentTriviaIndex, 'title', e.target.value)}
                          placeholder="Short descriptive title"
                        />
                      </div>

                      <div className="form-group">
                        <label>Question Text</label>
                        <textarea
                          value={currentTrivia.questionDetail || ''}
                          onChange={(e) => handleTriviaEdit(currentTriviaIndex, 'questionDetail', e.target.value)}
                          placeholder="The actual question shown to players"
                          rows="3"
                        />
                      </div>

                      <div className="form-group">
                        <label>Answer Explanation</label>
                        <textarea
                          value={currentTrivia.answerDetails || ''}
                          onChange={(e) => handleTriviaEdit(currentTriviaIndex, 'answerDetails', e.target.value)}
                          placeholder="Educational explanation about the correct answer"
                          rows="3"
                        />
                      </div>

                      <div className="form-row">
                        <div className="form-group">
                          <label>Category</label>
                          <input
                            type="text"
                            value={currentTrivia.category || ''}
                            onChange={(e) => handleTriviaEdit(currentTriviaIndex, 'category', e.target.value)}
                          />
                        </div>
                        <div className="form-group">
                          <label>Difficulty</label>
                          <select
                            value={currentTrivia.difficulty || 'medium'}
                            onChange={(e) => handleTriviaEdit(currentTriviaIndex, 'difficulty', e.target.value)}
                          >
                            <option value="easy">Easy</option>
                            <option value="medium">Medium</option>
                            <option value="hard">Hard</option>
                          </select>
                        </div>
                      </div>

                      <div className="trivia-options-editor">
                        <h4>Answer Options</h4>
                        {availableOptions.map((optionKey, index) => {
                          const optionLetter = String.fromCharCode(65 + index);
                          const optionId = `Option${optionLetter}`;
                          const correctAnswers = Array.isArray(currentTrivia.correctAnswer) ? currentTrivia.correctAnswer : [currentTrivia.correctAnswer];
                          const isCorrect = correctAnswers.includes(optionId);
                          
                          return (
                            <div key={optionKey} className={`option-editor ${isCorrect ? 'correct-option' : ''}`}>
                              <label>
                                <span className="option-letter">{optionLetter}.</span>
                                <input
                                  type="text"
                                  value={currentTrivia[optionKey] || ''}
                                  onChange={(e) => handleOptionEdit(currentTriviaIndex, optionKey, e.target.value)}
                                  className={isCorrect ? 'correct-answer' : ''}
                                />
                                {isCorrect && <span className="correct-indicator">✓ Correct</span>}
                              </label>
                              <button
                                type="button"
                                className={`set-correct-btn ${isCorrect ? 'active' : ''}`}
                                onClick={() => {
                                  if (isCorrect) {
                                    // Remove from correct answers
                                    const newCorrectAnswers = correctAnswers.filter(id => id !== optionId);
                                    handleTriviaEdit(currentTriviaIndex, 'correctAnswer', newCorrectAnswers.length === 1 ? newCorrectAnswers[0] : newCorrectAnswers);
                                  } else {
                                    // Add to correct answers
                                    const newCorrectAnswers = [...correctAnswers, optionId];
                                    handleTriviaEdit(currentTriviaIndex, 'correctAnswer', newCorrectAnswers.length === 1 ? newCorrectAnswers[0] : newCorrectAnswers);
                                  }
                                }}
                              >
                                {isCorrect ? '✗ Remove' : '✓ Set as Correct'}
                              </button>
                            </div>
                          );
                        })}
                      </div>

                      <div className="trivia-preview">
                        <h4>Preview:</h4>
                        <div className="trivia-preview-display">
                          <div className="question-header">
                            <h3>{currentTrivia.title}</h3>
                            <div className="field-badge">{currentTrivia.category}</div>
                          </div>
                          <div className="question-text">
                            <strong>Question:</strong> {currentTrivia.questionDetail}
                          </div>
                          <div className="trivia-options">
                            {availableOptions.map((optionKey, index) => {
                              const optionLetter = String.fromCharCode(65 + index);
                              const optionId = `Option${optionLetter}`;
                              const correctAnswers = Array.isArray(currentTrivia.correctAnswer) ? currentTrivia.correctAnswer : [currentTrivia.correctAnswer];
                              const isCorrect = correctAnswers.includes(optionId);
                              
                              return (
                                <div key={optionKey} className={`category-item trivia-option ${isCorrect ? 'correct' : ''}`}>
                                  <span className="category-name">
                                    <span className="option-letter">{optionLetter}.</span> {currentTrivia[optionKey]}
                                    {isCorrect && <span className="correct-indicator"> ✓</span>}
                                  </span>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      </div>
                    </div>
                  )}

                  <div className="trivia-actions">
                    <button className="btn-secondary" onClick={handleExportCSV}>
                      📄 Export CSV
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
                disabled={!triviaConfig.topic.trim()}
              >
                🤖 Generate Trivia Questions
              </button>
            </>
          )}
          {step === 2 && !isGenerating && generatedTrivia.length > 0 && (
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

export default TriviaAIBuilder;
