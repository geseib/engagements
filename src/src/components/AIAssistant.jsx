import React, { useState } from 'react';

const API_BASE = window.API_BASE;

function AIAssistant({ engagementType, questionIndex, questionSet, onClose, onQuestionsGenerated }) {
  const [userInput, setUserInput] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [generationStatus, setGenerationStatus] = useState('');
  const [bulkCount, setBulkCount] = useState(5);

  const isBulkGeneration = questionIndex === -1;

  const handleGenerate = async () => {
    if (!userInput.trim()) {
      setGenerationStatus('❌ Please provide some context or requirements');
      return;
    }

    setIsGenerating(true);
    setGenerationStatus('🤖 Generating with AI...');

    try {
      const response = await fetch(`${API_BASE}admin/ai-generate-questions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          engagementType,
          userInput: userInput.trim(),
          questionCount: isBulkGeneration ? bulkCount : 1,
          existingQuestion: isBulkGeneration ? null : questionSet.questions[questionIndex],
          context: {
            title: questionSet.title,
            description: questionSet.description,
            customInstructions: questionSet.customInstructions,
            aiContextInstructions: questionSet.aiContextInstructions
          }
        })
      });

      const result = await response.json();

      if (response.ok) {
        setGenerationStatus(`✅ Generated ${result.questions.length} question(s) successfully`);
        onQuestionsGenerated(result.questions);
      } else {
        setGenerationStatus(`❌ Generation failed: ${result.error || 'Unknown error'}`);
      }
    } catch (error) {
      console.error('AI generation error:', error);
      setGenerationStatus(`❌ Generation failed: ${error.message}`);
    } finally {
      setIsGenerating(false);
    }
  };

  const getPlaceholderText = () => {
    if (isBulkGeneration) {
      switch (engagementType) {
        case 'trivia':
          return 'e.g., "Create trivia questions about business strategy and leadership for MBA students. Include questions about Porter\'s Five Forces, SWOT analysis, and team management."';
        case 'poll':
          return 'e.g., "Create poll questions to gather feedback about workplace preferences, communication styles, and team collaboration methods."';
        default:
          return 'e.g., "Create strategic thinking questions about project management and team leadership. Focus on real-world scenarios that encourage discussion and problem-solving."';
      }
    } else {
      switch (engagementType) {
        case 'trivia':
          return 'e.g., "Make this question more challenging and add better wrong answers" or "Focus on practical business applications"';
        case 'poll':
          return 'e.g., "Add more diverse options" or "Make this question more specific to remote work preferences"';
        default:
          return 'e.g., "Make this question more thought-provoking" or "Add a scenario about team conflict resolution"';
      }
    }
  };

  const getExamplePrompts = () => {
    if (isBulkGeneration) {
      switch (engagementType) {
        case 'trivia':
          return [
            'Business fundamentals for new managers',
            'Technology trends and digital transformation',
            'Financial literacy for entrepreneurs',
            'Marketing strategy and customer acquisition'
          ];
        case 'poll':
          return [
            'Workplace culture and employee satisfaction',
            'Remote work preferences and challenges',
            'Professional development priorities',
            'Communication and collaboration tools'
          ];
        default:
          return [
            'Leadership challenges in modern organizations',
            'Strategic planning and decision making',
            'Team building and conflict resolution',
            'Innovation and change management'
          ];
      }
    } else {
      return [
        'Make it more specific to my industry',
        'Add a real-world scenario',
        'Make it more challenging',
        'Focus on practical applications'
      ];
    }
  };

  return (
    <div className="ai-assistant-modal">
      <div className="modal-overlay" onClick={onClose}></div>
      <div className="modal-content">
        <div className="modal-header">
          <h2>🤖 AI Assistant</h2>
          <button className="close-button" onClick={onClose}>✕</button>
        </div>

        <div className="modal-body">
          <div className="ai-context">
            <h3>
              {isBulkGeneration 
                ? `Generate Multiple ${engagementType === 'call-and-answer' ? 'Call & Answer' : 
                    engagementType === 'trivia' ? 'Trivia' : 'Poll'} Questions`
                : `Improve ${engagementType === 'call-and-answer' ? 'Call & Answer' : 
                    engagementType === 'trivia' ? 'Trivia' : 'Poll'} Question`
              }
            </h3>
            <p>
              {isBulkGeneration 
                ? `Describe what kind of ${engagementType} questions you want to create. Be specific about the topic, audience, and any requirements.`
                : 'Describe how you want to improve or modify this question. The AI will help enhance it based on your feedback.'
              }
            </p>
          </div>

          {isBulkGeneration && (
            <div className="bulk-controls">
              <label htmlFor="bulk-count">Number of questions to generate:</label>
              <select
                id="bulk-count"
                value={bulkCount}
                onChange={(e) => setBulkCount(parseInt(e.target.value))}
                className="input-field"
              >
                <option value={3}>3 questions</option>
                <option value={5}>5 questions</option>
                <option value={10}>10 questions</option>
                <option value={15}>15 questions</option>
                <option value={20}>20 questions</option>
              </select>
            </div>
          )}

          <div className="input-section">
            <label htmlFor="user-input">Your Requirements:</label>
            <textarea
              id="user-input"
              value={userInput}
              onChange={(e) => setUserInput(e.target.value)}
              placeholder={getPlaceholderText()}
              className="textarea-field"
              rows="4"
              disabled={isGenerating}
            />
          </div>

          <div className="example-prompts">
            <h4>Example prompts:</h4>
            <div className="prompt-buttons">
              {getExamplePrompts().map((prompt, index) => (
                <button
                  key={index}
                  className="btn-example"
                  onClick={() => setUserInput(prompt)}
                  disabled={isGenerating}
                >
                  {prompt}
                </button>
              ))}
            </div>
          </div>

          {!isBulkGeneration && questionSet.questions[questionIndex] && (
            <div className="current-question">
              <h4>Current Question:</h4>
              <div className="question-display">
                <strong>Title:</strong> {questionSet.questions[questionIndex].title || 'No title'}<br/>
                <strong>Category:</strong> {questionSet.questions[questionIndex].category || 'No category'}<br/>
                {questionSet.questions[questionIndex].detail && (
                  <>
                    <strong>Detail:</strong> {questionSet.questions[questionIndex].detail.substring(0, 200)}
                    {questionSet.questions[questionIndex].detail.length > 200 ? '...' : ''}
                  </>
                )}
              </div>
            </div>
          )}

          {generationStatus && (
            <div className="generation-status">
              {generationStatus}
            </div>
          )}
        </div>

        <div className="modal-footer">
          <button
            className="btn-secondary"
            onClick={onClose}
            disabled={isGenerating}
          >
            Cancel
          </button>
          <button
            className="btn-primary"
            onClick={handleGenerate}
            disabled={isGenerating || !userInput.trim()}
          >
            {isGenerating ? '🤖 Generating...' : 
             isBulkGeneration ? `🤖 Generate ${bulkCount} Questions` : '🤖 Improve Question'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default AIAssistant;
