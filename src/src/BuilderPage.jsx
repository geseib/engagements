import React, { useState, useEffect } from 'react';
import CallAnswerBuilder from './components/CallAnswerBuilder';
import TriviaBuilder from './components/TriviaBuilder';
import PollBuilder from './components/PollBuilder';
import WavelengthBuilder from './components/WavelengthBuilder';
import AIAssistant from './components/AIAssistant';
import './BuilderPage.css';
import { authFetch } from './auth/authFetch';
import Icon from './components/Icon';
import { tagsToCsvCell } from './utils/tags';

const API_BASE = window.API_BASE;

function BuilderPage() {
  const [engagementType, setEngagementType] = useState('call-and-answer');
  const [questionSet, setQuestionSet] = useState({
    title: '',
    description: '',
    customInstructions: '',
    aiContextInstructions: '',
    promptId: 'lessons-learned', // Default AI prompt
    questions: []
  });
  const [showAIAssistant, setShowAIAssistant] = useState(false);
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(-1);
  const [saveStatus, setSaveStatus] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  // Handle adding a new question
  const handleAddQuestion = () => {
    const newQuestion = {
      id: Date.now(),
      title: '',
      detail: '',
      category: '',
      school: '',
      customInstructions: '',
      active: true
    };

    // Add engagement-type specific fields
    if (engagementType === 'trivia') {
      newQuestion.questionDetail = '';
      newQuestion.optionA = '';
      newQuestion.optionB = '';
      newQuestion.optionC = '';
      newQuestion.optionD = '';
      newQuestion.correctAnswer = 'OptionA';
      newQuestion.answerDetails = '';
      newQuestion.difficulty = 'medium';
    } else if (engagementType === 'poll') {
      newQuestion.options = ['', ''];
      newQuestion.allowMultiple = false;
    } else if (engagementType === 'wavelength') {
      newQuestion.topic = '';
      newQuestion.instructions = 'Enter 10 words that come to mind when you think of this topic:';
    }

    setQuestionSet(prev => ({
      ...prev,
      questions: [...prev.questions, newQuestion]
    }));
  };

  // Handle updating a question
  const handleUpdateQuestion = (index, updatedQuestion) => {
    setQuestionSet(prev => ({
      ...prev,
      questions: prev.questions.map((q, i) => i === index ? updatedQuestion : q)
    }));
  };

  // Handle deleting a question
  const handleDeleteQuestion = (index) => {
    setQuestionSet(prev => ({
      ...prev,
      questions: prev.questions.filter((_, i) => i !== index)
    }));
  };

  // Handle AI assistance for a specific question
  const handleAIAssistance = (questionIndex) => {
    setCurrentQuestionIndex(questionIndex);
    setShowAIAssistant(true);
  };

  // Handle bulk AI generation
  const handleBulkAIGeneration = () => {
    setCurrentQuestionIndex(-1); // -1 indicates bulk generation
    setShowAIAssistant(true);
  };

  // Handle saving the question set
  const handleSaveQuestionSet = async () => {
    if (!questionSet.title.trim()) {
      setSaveStatus('Title is required');
      return;
    }

    if (questionSet.questions.length === 0) {
      setSaveStatus('At least one question is required');
      return;
    }

    setIsSaving(true);
    setSaveStatus('Saving question set...');

    try {
      // Convert questions to CSV format
      const csvContent = generateCSVContent();
      
      const response = await authFetch(`${API_BASE}admin/upload-questions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          fileName: `${questionSet.title.replace(/[^a-zA-Z0-9]/g, '_')}.csv`,
          fileContent: csvContent,
          customTitle: questionSet.title.trim(),
          customDescription: questionSet.description.trim(),
          customInstructions: questionSet.customInstructions.trim(),
          aiContextInstructions: questionSet.aiContextInstructions.trim(),
          promptId: questionSet.promptId,
          engagementType: engagementType
        })
      });

      const result = await response.json();

      if (response.ok) {
        setSaveStatus(`${result.message}`);
        // Reset form after successful save
        setQuestionSet({
          title: '',
          description: '',
          customInstructions: '',
          aiContextInstructions: '',
          promptId: 'lessons-learned',
          questions: []
        });
      } else {
        setSaveStatus(`Save failed: ${result.error || 'Unknown error'}`);
      }
    } catch (error) {
      console.error('Save error:', error);
      setSaveStatus(`Save failed: ${error.message}`);
    } finally {
      setIsSaving(false);
    }
  };

  // Generate CSV content from questions
  const generateCSVContent = () => {
    let headers, rows;

    if (engagementType === 'trivia') {
      headers = 'Category,Question#,Title,QuestionDetail,School,CustomInstruction,OptionA,OptionB,OptionC,OptionD,CorrectAnswer,AnswerDetails,Difficulty,Tags';
      rows = questionSet.questions.map((q, index) => {
        return `"${q.category}","${index + 1}","${q.title}","${q.questionDetail || q.detail}","${q.school}","${q.customInstructions}","${q.optionA}","${q.optionB}","${q.optionC}","${q.optionD}","${q.correctAnswer}","${q.answerDetails}","${q.difficulty}","${tagsToCsvCell(q.tags)}"`;
      });
    } else if (engagementType === 'poll') {
      headers = 'Category,Question#,Title,Detail_lesson,School,CustomInstruction,Options,AllowMultiple,Tags';
      rows = questionSet.questions.map((q, index) => {
        const options = q.options.join('|');
        return `"${q.category}","${index + 1}","${q.title}","${q.detail}","${q.school}","${q.customInstructions}","${options}","${q.allowMultiple}","${tagsToCsvCell(q.tags)}"`;
      });
    } else if (engagementType === 'wavelength') {
      headers = 'Category,Question#,Title,Topic,Instructions,School,CustomInstruction,Tags';
      rows = questionSet.questions.map((q, index) => {
        return `"${q.category}","${index + 1}","${q.title}","${q.topic || q.detail}","${q.instructions}","${q.school}","${q.customInstructions}","${tagsToCsvCell(q.tags)}"`;
      });
    } else {
      // call-and-answer
      headers = 'Category,Question#,Title,Detail_lesson,School,CustomInstruction,Tags';
      rows = questionSet.questions.map((q, index) => {
        return `"${q.category}","${index + 1}","${q.title}","${q.detail}","${q.school}","${q.customInstructions}","${tagsToCsvCell(q.tags)}"`;
      });
    }

    return headers + '\n' + rows.join('\n');
  };

  // Render the appropriate builder component
  const renderBuilder = () => {
    const commonProps = {
      questions: questionSet.questions,
      onUpdateQuestion: handleUpdateQuestion,
      onDeleteQuestion: handleDeleteQuestion,
      onAIAssistance: handleAIAssistance
    };

    switch (engagementType) {
      case 'trivia':
        return <TriviaBuilder {...commonProps} />;
      case 'poll':
        return <PollBuilder {...commonProps} />;
      case 'wavelength':
        return <WavelengthBuilder {...commonProps} />;
      default:
        return <CallAnswerBuilder {...commonProps} />;
    }
  };

  return (
    <div className="builder-page">
      <div className="builder-header">
        <h1><Icon name="Palette" weight="duotone" size={16} color="var(--primary)" /> Question Set Builder</h1>
        <p>Create engaging question sets with AI assistance</p>
      </div>

      <div className="builder-content">
        {/* Question Set Metadata */}
        <div className="builder-section">
          <h2><Icon name="ClipboardText" weight="bold" size={16} color="currentColor" /> Question Set Details</h2>
          
          <div className="form-row">
            <div className="form-group">
              <label htmlFor="engagement-type">Engagement Type *</label>
              <select
                id="engagement-type"
                value={engagementType}
                onChange={(e) => setEngagementType(e.target.value)}
                className="input-field"
              >
                <option value="call-and-answer">Call and Answer</option>
                <option value="trivia">Trivia</option>
                <option value="poll">Poll</option>
                <option value="wavelength">Wavelength</option>
              </select>
            </div>
          </div>

          <div className="form-row">
            <div className="form-group">
              <label htmlFor="title">Title *</label>
              <input
                id="title"
                type="text"
                value={questionSet.title}
                onChange={(e) => setQuestionSet(prev => ({ ...prev, title: e.target.value }))}
                placeholder="Enter question set title"
                className="input-field"
              />
            </div>
          </div>

          <div className="form-row">
            <div className="form-group">
              <label htmlFor="description">Description</label>
              <textarea
                id="description"
                value={questionSet.description}
                onChange={(e) => setQuestionSet(prev => ({ ...prev, description: e.target.value }))}
                placeholder="Brief description of this question set"
                className="textarea-field"
                rows="3"
              />
            </div>
          </div>

          <div className="form-row">
            <div className="form-group">
              <label htmlFor="custom-instructions">Custom Instructions</label>
              <textarea
                id="custom-instructions"
                value={questionSet.customInstructions}
                onChange={(e) => setQuestionSet(prev => ({ ...prev, customInstructions: e.target.value }))}
                placeholder="Custom instructions for participants"
                className="textarea-field"
                rows="3"
              />
            </div>
          </div>

          <div className="form-row">
            <div className="form-group">
              <label htmlFor="ai-context">AI Context Instructions</label>
              <textarea
                id="ai-context"
                value={questionSet.aiContextInstructions}
                onChange={(e) => setQuestionSet(prev => ({ ...prev, aiContextInstructions: e.target.value }))}
                placeholder="Context for AI analysis during sessions"
                className="textarea-field"
                rows="3"
              />
            </div>
          </div>

          {engagementType === 'call-and-answer' && (
            <div className="form-row">
              <div className="form-group">
                <label htmlFor="prompt-id">AI Summary Prompt</label>
                <select
                  id="prompt-id"
                  value={questionSet.promptId}
                  onChange={(e) => setQuestionSet(prev => ({ ...prev, promptId: e.target.value }))}
                  className="input-field"
                >
                  <option value="lessons-learned">Lessons Learned - Strategic Insights</option>
                  <option value="problem-solving">Problem-Solving - Solution Architecture</option>
                  <option value="team-building">Team Building - Culture & Collaboration</option>
                  <option value="strategic-planning">Strategic Planning - Vision & Goals</option>
                  <option value="innovation">Innovation - Creative Solutions</option>
                  <option value="leadership">Leadership - Development & Growth</option>
                  <option value="customer-insights">Customer Experience - Voice of Customer</option>
                  <option value="process-improvement">Process Improvement - Operational Excellence</option>
                  <option value="change-management">Change Management - Transformation</option>
                  <option value="interview-prep">Interview Prep - Best Practices</option>
                </select>
                <p className="form-helper">Select the AI analysis style for summarizing player responses</p>
              </div>
            </div>
          )}
        </div>

        {/* Questions Section */}
        <div className="builder-section">
          <div className="section-header">
            <h2><Icon name="Question" weight="bold" size={16} color="currentColor" /> Questions ({questionSet.questions.length})</h2>
            <div className="section-actions">
              <button
                className="btn-secondary"
                onClick={handleBulkAIGeneration}
              >
                <Icon name="Sparkle" weight="duotone" size={16} color="var(--primary)" /> Bulk AI Generation
              </button>
              <button
                className="btn-primary"
                onClick={handleAddQuestion}
              >
                <Icon name="Plus" weight="bold" size={16} color="currentColor" /> Add Question
              </button>
            </div>
          </div>

          {questionSet.questions.length === 0 ? (
            <div className="no-questions">
              <p>No questions yet. Add your first question or use AI assistance to get started.</p>
            </div>
          ) : (
            renderBuilder()
          )}
        </div>

        {/* Save Section */}
        <div className="builder-section">
          <div className="save-controls">
            <button
              className="btn-success btn-large"
              onClick={handleSaveQuestionSet}
              disabled={isSaving}
            >
              {isSaving ? 'Saving...' : 'Save Question Set'}
            </button>
            {saveStatus && (
              <div className="save-status">
                {saveStatus}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* AI Assistant Modal */}
      {showAIAssistant && (
        <AIAssistant
          engagementType={engagementType}
          questionIndex={currentQuestionIndex}
          questionSet={questionSet}
          onClose={() => setShowAIAssistant(false)}
          onQuestionsGenerated={(newQuestions) => {
            if (currentQuestionIndex === -1) {
              // Bulk generation
              setQuestionSet(prev => ({
                ...prev,
                questions: [...prev.questions, ...newQuestions]
              }));
            } else {
              // Single question update
              handleUpdateQuestion(currentQuestionIndex, newQuestions[0]);
            }
            setShowAIAssistant(false);
          }}
        />
      )}
    </div>
  );
}

export default BuilderPage;
