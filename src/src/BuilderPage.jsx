import React, { useState, useEffect } from 'react';
import CallAnswerBuilder from './components/CallAnswerBuilder';
import TriviaBuilder from './components/TriviaBuilder';
import PollBuilder from './components/PollBuilder';
import WavelengthBuilder from './components/WavelengthBuilder';
import AIAssistant from './components/AIAssistant';
import './BuilderPage.css';
import PlanLimitNotice from './components/PlanLimitNotice';
import { parseUpgradeRequired } from './utils/upgradeRequired';
import { authFetch } from './auth/authFetch';
import Icon from './components/Icon';
import SetTopicField from './components/SetTopicField';
import { tagsToCsvCell } from './utils/tags';
import { csvRow, buildCsv, optionsToCsvCell, allowMultipleToCsvCell } from './utils/csv';
import { adminApiUrl } from './utils/adminApi';
import { selectableSummaryPrompts } from './utils/questionSetEditing';
import { gameTypeLabel } from './config/gameTypes';
import { setTopicRefusal } from './config/setTopics';

const API_BASE = window.API_BASE;

function BuilderPage() {
  const [engagementType, setEngagementType] = useState('call-and-answer');
  const [questionSet, setQuestionSet] = useState({
    title: '',
    description: '',
    customInstructions: '',
    aiContextInstructions: '',
    /* EMPTY MEANS "WHATEVER THIS GAME TYPE ALREADY DOES".
       This used to read `promptId: 'lessons-learned'`, one of ten ids written
       into the JSX below by hand. No seeder mints them —
       scripts/populate-defaults.js mints random ids — so the value this page
       sent on every save resolved to nothing, for every set it ever made.
       An absent promptId is the honest default: get-ai-summary.js already
       resolves a type-appropriate prompt when a set carries none. */
    promptId: '',
    /* THE SHELF THIS SET WILL SIT ON, and the author's own words beside it.
       Starts UNFILED rather than on the first shelf: seeding one would file
       every set nobody thought about under Arts & Culture, which is a wrong
       answer stated as fact instead of an honest blank. Required before the
       save goes — this route creates a set that lands live. */
    topic: '',
    tags: [],
    questions: []
  });
  const [showAIAssistant, setShowAIAssistant] = useState(false);
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(-1);
  const [saveStatus, setSaveStatus] = useState('');
  // A save refused at the stored-set allowance (402): a plan fact with a way
  // out, shown as the plan-limit notice rather than "Save failed: …".
  const [limit, setLimit] = useState(null);
  const [isSaving, setIsSaving] = useState(false);
  const [availablePrompts, setAvailablePrompts] = useState([]);

  /* THE PROMPT LIBRARY, READ THE WAY THE CONSOLE READS IT.
     AdminPage.fetchAvailablePrompts() is the model: GET admin/ai-prompts
     through authFetch, keep the active rows, and let the picker filter the
     rest. The route is allowed to hosts as well as admins
     (auth/authorizer.js), which matters because the host's create dialog
     offers this page too.

     A failure is not fatal here. The picker falls back to its one honest
     option — use the game type's default — which is exactly what an unset
     promptId does at run time. */
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const response = await authFetch(adminApiUrl('admin/ai-prompts'));
        if (!response.ok) {
          console.warn(`Prompt library unavailable (${response.status})`);
          return;
        }
        const data = await response.json();
        const active = (data.prompts || []).filter((prompt) => prompt.status === 'active');
        if (!cancelled) setAvailablePrompts(active);
      } catch (error) {
        console.error('Error fetching available prompts:', error);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  /* Prompts this set could actually use: the right game type, and a summary
     prompt rather than a generation one. The same helper the console's editor
     and the upload panel use, so all three pickers agree. */
  const promptChoices = selectableSummaryPrompts(availablePrompts, engagementType);

  /* CHANGING THE FORMAT RE-EXAMINES THE SUMMARY APPROACH, because the picker is
     conditional and the save body is not.

     The select above renders for call & answer only — `handleSave` sends
     `promptId` for every format. So a prompt chosen here and then abandoned by
     switching to Trivia stayed in state and rode onto a trivia set, with no
     control left on the screen that would have shown it. The person who chose
     it could not have known, which is what makes it worth a rule rather than a
     note.

     RE-VALIDATED, NOT BLANKED. A prompt filed under `gameType: 'all'` is
     offered for the new format too, and clearing it unconditionally would take
     away a choice that is still good without saying so. The test is the same
     one the picker applies to what it offers, so what the builder can see and
     what the builder can save cannot disagree. */
  const handleEngagementTypeChange = (nextType) => {
    setEngagementType(nextType);
    setQuestionSet((prev) => {
      if (!prev.promptId) return prev;
      const stillOffered = selectableSummaryPrompts(availablePrompts, nextType)
        .some((prompt) => prompt.promptId === prev.promptId);
      return stillOffered ? prev : { ...prev, promptId: '' };
    });
  };

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

    /* A CREATE THAT LANDS LIVE NAMES ITS SHELF. `upload-questions.js` answers
       400 without one; refused here, with the same sentence, so nobody meets
       that refusal over a field this page never showed them. */
    const topicRefusal = setTopicRefusal(questionSet.topic);
    if (topicRefusal) {
      setSaveStatus(topicRefusal);
      return;
    }

    setIsSaving(true);
    setLimit(null);
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
          engagementType: engagementType,
          topic: questionSet.topic,
          // Only when there are some: an empty list is a value nobody chose.
          ...(questionSet.tags.length ? { tags: questionSet.tags } : {})
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
          promptId: '',
          topic: '',
          tags: [],
          questions: []
        });
      } else {
        const refusal = parseUpgradeRequired(response, result);
        if (refusal) {
          setSaveStatus('');
          setLimit(refusal);
        } else {
          setSaveStatus(`Save failed: ${result.error || 'Unknown error'}`);
        }
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
      rows = questionSet.questions.map((q, index) => csvRow([
        q.category,
        index + 1,
        q.title,
        q.questionDetail || q.detail,
        q.school,
        q.customInstructions,
        q.optionA,
        q.optionB,
        q.optionC,
        q.optionD,
        q.correctAnswer,
        q.answerDetails,
        q.difficulty,
        tagsToCsvCell(q.tags)
      ]));
    } else if (engagementType === 'poll') {
      headers = 'Category,Question#,Title,Detail_lesson,School,CustomInstruction,Options,AllowMultiple,Tags';
      rows = questionSet.questions.map((q, index) => csvRow([
        q.category,
        index + 1,
        q.title,
        q.detail,
        q.school,
        q.customInstructions,
        optionsToCsvCell(q.options),
        allowMultipleToCsvCell(q.allowMultiple),
        tagsToCsvCell(q.tags)
      ]));
    } else if (engagementType === 'wavelength') {
      headers = 'Category,Question#,Title,Topic,Instructions,School,CustomInstruction,Tags';
      rows = questionSet.questions.map((q, index) => csvRow([
        q.category,
        index + 1,
        q.title,
        q.topic || q.detail,
        q.instructions,
        q.school,
        q.customInstructions,
        tagsToCsvCell(q.tags)
      ]));
    } else {
      // call-and-answer
      headers = 'Category,Question#,Title,Detail_lesson,School,CustomInstruction,Tags';
      rows = questionSet.questions.map((q, index) => csvRow([
        q.category,
        index + 1,
        q.title,
        q.detail,
        q.school,
        q.customInstructions,
        tagsToCsvCell(q.tags)
      ]));
    }

    return buildCsv(headers, rows);
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
                onChange={(e) => handleEngagementTypeChange(e.target.value)}
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

          {/* Where this set will sit in the library, asked with the title
              rather than discovered from a 400 after the questions are written. */}
          <div className="form-row">
            <SetTopicField
              idPrefix="builder"
              topic={questionSet.topic}
              onTopicChange={(value) => setQuestionSet(prev => ({ ...prev, topic: value }))}
              tags={questionSet.tags}
              onTagsChange={(value) => setQuestionSet(prev => ({ ...prev, tags: value }))}
            />
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
                  <option value="">Use the default prompt for {gameTypeLabel(engagementType)}</option>
                  {promptChoices.map((prompt) => (
                    <option key={prompt.promptId} value={prompt.promptId}>
                      {prompt.name}
                    </option>
                  ))}
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
            <PlanLimitNotice refusal={limit} outcome="Nothing was saved." surface="paper" onDismiss={() => setLimit(null)} />
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
