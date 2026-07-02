import React, { useState } from 'react';
import { postGenerationBatch, planGenerationTopics, dropNearDuplicates, runWithConcurrency } from '../utils/aiBatchClient';

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
      // Break bulk requests into small parallel batches so each API call
      // completes well under API Gateway's ~30s integration timeout
      const CHUNK_SIZE = 3;
      const MAX_PARALLEL = 3;
      const totalCount = isBulkGeneration ? bulkCount : 1;
      const chunks = Math.ceil(totalCount / CHUNK_SIZE);

      // Two-phase generation: when a bulk request spans multiple parallel
      // batches, first plan ONE list of distinct sub-topics (a small fast
      // call), then anchor each batch to its assigned slice so batches can't
      // duplicate each other. Falls back to the older angle hint on failure.
      let plannedTopics = null;
      if (chunks > 1) {
        plannedTopics = await planGenerationTopics(`${API_BASE}admin/ai-generate-questions`, {
          engagementType,
          userInput: userInput.trim(),
          questionCount: totalCount,
          context: {
            title: questionSet.title,
            description: questionSet.description
          }
        }, totalCount, {
          label: 'Topic planning',
          onStatus: setGenerationStatus
        });
      }

      const batchTasks = Array.from({ length: chunks }, (_, i) => async () => {
        const chunkSize = Math.min(CHUNK_SIZE, totalCount - (i * CHUNK_SIZE));

        // Anchor this batch to its assigned topics; the angle hint is only
        // the fallback when topic planning was unavailable
        const assignedTopics = plannedTopics
          ? plannedTopics.slice(i * CHUNK_SIZE, i * CHUNK_SIZE + chunkSize)
          : undefined;
        const otherTopics = plannedTopics
          ? plannedTopics.filter((_, idx) => idx < i * CHUNK_SIZE || idx >= i * CHUNK_SIZE + chunkSize)
          : undefined;

        let batchInput = userInput.trim();
        if (chunks > 1 && !plannedTopics) {
          batchInput += `\n\nThis request is part ${i + 1} of ${chunks} of a larger set generated in parallel - cover a distinct sub-topic or angle for this part and avoid the most obvious questions.`;
        }

        const result = await postGenerationBatch(`${API_BASE}admin/ai-generate-questions`, {
          engagementType,
          userInput: batchInput,
          questionCount: chunkSize,
          existingQuestion: isBulkGeneration ? null : questionSet.questions[questionIndex],
          context: {
            title: questionSet.title,
            description: questionSet.description,
            customInstructions: questionSet.customInstructions,
            aiContextInstructions: questionSet.aiContextInstructions
          },
          assignedTopics,
          otherTopics
        }, {
          label: `Batch ${i + 1} of ${chunks}`,
          onStatus: setGenerationStatus
        });

        return result.questions;
      });

      const batchResults = await runWithConcurrency(batchTasks, MAX_PARALLEL);
      // Safety net (bulk only): drop any near-duplicate titles that slipped through
      const allQuestions = isBulkGeneration
        ? dropNearDuplicates(batchResults.flat())
        : batchResults.flat();

      setGenerationStatus(`✅ Generated ${allQuestions.length} question(s) successfully`);
      onQuestionsGenerated(allQuestions);
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
        case 'wavelength':
          return 'e.g., "Create business scenarios with key terms like AI, Leadership, Innovation, Agile, Strategy. Each should have a realistic workplace context where someone introduces the concept."';
        default:
          return 'e.g., "Create strategic thinking questions about project management and team leadership. Focus on real-world scenarios that encourage discussion and problem-solving."';
      }
    } else {
      switch (engagementType) {
        case 'trivia':
          return 'e.g., "Make this question more challenging and add better wrong answers" or "Focus on practical business applications"';
        case 'poll':
          return 'e.g., "Add more diverse options" or "Make this question more specific to remote work preferences"';
        case 'wavelength':
          return 'e.g., "Make this topic more specific" or "Choose a word that will generate more interesting associations"';
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
        case 'wavelength':
          return [
            'AI and technology terms with workplace scenarios',
            'Leadership concepts introduced in business contexts',
            'Innovation and strategy terms from realistic situations',
            'Modern business buzzwords with contextual introductions'
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
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>🤖 AI Assistant</h2>
          <button className="close-button" onClick={onClose}>✕</button>
        </div>

        <div className="modal-body">
          <div className="ai-context">
            <h3>
              {isBulkGeneration 
                ? `Generate Multiple ${engagementType === 'call-and-answer' ? 'Call & Answer' : 
                    engagementType === 'trivia' ? 'Trivia' : 
                    engagementType === 'wavelength' ? 'Wavelength' : 'Poll'} Questions`
                : `Improve ${engagementType === 'call-and-answer' ? 'Call & Answer' : 
                    engagementType === 'trivia' ? 'Trivia' : 
                    engagementType === 'wavelength' ? 'Wavelength' : 'Poll'} Question`
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
              <label htmlFor="bulk-count">Number of questions to generate: <strong>{bulkCount}</strong></label>
              <div className="quantity-controls">
                <input
                  type="range"
                  id="bulk-count-slider"
                  min="1"
                  max="100"
                  value={bulkCount}
                  onChange={(e) => setBulkCount(parseInt(e.target.value))}
                  className="quantity-slider"
                />
                <input
                  type="number"
                  id="bulk-count-input"
                  min="1"
                  max="100"
                  value={bulkCount}
                  onChange={(e) => setBulkCount(Math.min(100, Math.max(1, parseInt(e.target.value) || 1)))}
                  className="quantity-input"
                />
              </div>
              <div className="quantity-presets">
                <button type="button" className="preset-btn" onClick={() => setBulkCount(5)}>5</button>
                <button type="button" className="preset-btn" onClick={() => setBulkCount(10)}>10</button>
                <button type="button" className="preset-btn" onClick={() => setBulkCount(20)}>20</button>
                <button type="button" className="preset-btn" onClick={() => setBulkCount(50)}>50</button>
              </div>
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
