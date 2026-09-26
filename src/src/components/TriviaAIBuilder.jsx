import React, { useState, useEffect, useCallback, useRef } from 'react';
import FileUploadPrompt from './FileUploadPrompt';
import { startGenerationJob, pollGenerationJob } from '../utils/aiBatchClient';
import Icon from './Icon';
import { SetSizeField } from './CountField';
import AppendModeSwitch from './AppendModeSwitch';
import { isAppend, appendsToExisting, appendCategoryDefaults, withAppendRequirement, batchGuidanceFor } from '../utils/appendMode';
import BatchGuidanceField from './BatchGuidanceField';
import { tagsToCsvCell, normalizeTags } from '../utils/tags';
import { csvRow, buildCsv } from '../utils/csv';
import { buildWorkieSetNote } from '../utils/workieSetNote';
import GenerationJobPanel from './GenerationJobPanel';
import GeneratedItemsTable from './GeneratedItemsTable';
import StatusMessage from './StatusMessage';
import AIFormAssist from './AIFormAssist';
import FieldLock from './FieldLock';
import { BUILDER_FORM_FIELDS } from '../config/builderFormFields';
import {
  interpretGenerationJob,
  rememberGenerationJob,
  recallGenerationJob,
  forgetGenerationJob,
  resumeIsGone,
} from '../utils/generationJob';

const API_BASE = window.API_BASE;
const ENDPOINT = `${API_BASE}admin/ai-generate-trivia`;
const ASSIST_FORM = BUILDER_FORM_FIELDS.trivia;

function TriviaAIBuilder({ onClose, onTriviaGenerated, appendTo = null }) {
  const [step, setStep] = useState(1);
  const [triviaConfig, setTriviaConfig] = useState({
    // ADDING TO A SET starts from the brief that set was made from.
    topic: appendTo?.brief?.topic || '',
    audience: appendTo?.brief?.audience || '',
    difficulty: appendTo?.brief?.difficulty || 'medium',
    count: 15,
    numChoices: 4,
    numCorrect: 1,
    numberOfCategories: 3,
    mustHaveCategories: '',
    customPrompt: '',
    // ADDING TO A SET'S OWN CATEGORIES: the count and the names are the set's,
    // not the form's. Count follows so "in each" starts at a sensible 3.
    ...appendCategoryDefaults(appendTo),
    ...(appendsToExisting(appendTo) ? { count: Math.min(100, Math.max(1, appendTo.categories.length) * 3) } : {}),
  });
  // The mode can be changed from inside the builder (AppendModeSwitch). The
  // category settings follow it: the set's own names and count in `existing`,
  // a clean slate in `new` — never the existing names left in "must have".
  const appendMode = appendTo?.mode;
  useEffect(() => {
    if (!isAppend(appendTo)) return;
    setTriviaConfig((prev) => {
      const per = Math.max(1, Math.round(prev.count / Math.max(1, prev.numberOfCategories)));
      const next = appendsToExisting(appendTo)
        ? appendCategoryDefaults(appendTo)
        : { numberOfCategories: Math.min(3, Math.max(1, 24 - appendTo.categories.length)), mustHaveCategories: '' };
      return { ...prev, ...next, count: Math.min(100, next.numberOfCategories * per) };
    });
  }, [appendMode]); // eslint-disable-line react-hooks/exhaustive-deps

  // GUIDANCE FOR THIS BATCH, adding only — BatchGuidanceField. Its own state,
  // not a triviaConfig key: it is not the set's brief and is not kept. It may
  // arrive from the Add questions dialog, so the auto-start sends it.
  // `guidanceSent` is what the running batch was made with, for the review.
  const [batchGuidance, setBatchGuidance] = useState(appendTo?.batchGuidance || '');
  const [guidanceSent, setGuidanceSent] = useState('');

  const [generatedTrivia, setGeneratedTrivia] = useState([]);
  const [currentTriviaIndex, setCurrentTriviaIndex] = useState(0);
  // The last poll response, in the shape jobToResponse() actually sends. EVERY
  // render branch below reads interpretGenerationJob(job).outcome — never
  // generatedTrivia.length, which is true for a FAILED job carrying partials
  // and is exactly how a partial failure used to render as a success.
  const [job, setJob] = useState(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [transportError, setTransportError] = useState(null);
  const [generationStatus, setGenerationStatus] = useState('');
  // Per-item reject (G6). Indices into generatedTrivia.
  const [excluded, setExcluded] = useState(() => new Set());
  // The carousel is now a drill-in from the table, not the only way through.
  const [editingItem, setEditingItem] = useState(false);
  // A partial failure has to be acknowledged before its items are reviewable.
  const [reviewingPartial, setReviewingPartial] = useState(false);
  // Raw text of the tag field while it is being edited. null = not editing, so
  // the input falls back to the question's stored tags. Normalising on every
  // keystroke would eat the hyphen out of "remote-" as it is typed.
  const [tagDraft, setTagDraft] = useState(null);

  /*
   * FIELDS LOCKED AGAINST THE AI HELPER — see AIScenarioBuilder for the full
   * note. The set is sent with the drafting request and becomes the tool schema
   * server-side, so a locked field is never offered to the model; it is refused
   * again on the way back in `utils/fieldDrafting.applyFieldDraft`.
   */
  const [lockedFields, setLockedFields] = useState(() => new Set());
  const toggleLock = (field) => setLockedFields((prev) => {
    const next = new Set(prev);
    if (next.has(field)) next.delete(field); else next.add(field);
    return next;
  });
  const lockFor = (field) => (
    <FieldLock
      field={field}
      label={ASSIST_FORM.fields.find((f) => f.key === field).label}
      locked={lockedFields.has(field)}
      onToggle={toggleLock}
    />
  );

  const difficultyLevels = [
    { value: 'easy', label: 'Easy', description: 'Basic knowledge, straightforward questions' },
    { value: 'medium', label: 'Medium', description: 'Moderate difficulty, some thinking required' },
    { value: 'hard', label: 'Hard', description: 'Advanced knowledge, challenging questions' }
  ];

  const jobIdRef = useRef(null);
  /* ONE PRESS, FROM THE SET. The Add questions dialog already knows the brief,
     the categories and the count, so when it says `autoStart` this builder
     opens GENERATING rather than on a form repeating what was just decided —
     only if the brief carries a topic; with nothing to write about, the form
     is the honest place to land. */
  const autoStarted = useRef(false);

  /**
   * Watch a job to its terminal state.
   *
   * pollGenerationJob RESOLVES on `status:'error'` now — a failed job is an
   * answer and carries `items`, `completed`, `requested` and `warnings`. Only
   * transport failures throw, and of those only a 404 means the job is gone.
   */
  const watchJob = useCallback(async (jobId) => {
    jobIdRef.current = jobId;
    setIsGenerating(true);
    setTransportError(null);
    setStep(2);
    try {
      const terminal = await pollGenerationJob(ENDPOINT, jobId, {
        label: 'Generation',
        onStatus: setGenerationStatus,
        // Show questions as they land rather than a spinner for minutes.
        onProgress: (update) => {
          setJob(update);
          if (Array.isArray(update.items) && update.items.length > 0) {
            setGeneratedTrivia(update.items);
          }
        }
      });
      setJob(terminal);
      setGeneratedTrivia(Array.isArray(terminal.items) ? terminal.items : []);
      setCurrentTriviaIndex(0);
    } catch (error) {
      console.error('AI trivia generation error:', error);
      if (resumeIsGone(error)) {
        // The job row's 3-day TTL is stamped only at creation and never
        // refreshed, so a stored id expiring is ordinary. Not an error screen.
        forgetGenerationJob(ENDPOINT);
        jobIdRef.current = null;
        setJob(null);
        setStep(1);
        setGenerationStatus('That job has expired — generation jobs are readable for three days. Start a new one.');
      } else {
        // KEEP the stored id: a timeout or a lost connection says nothing about
        // the worker, which has its own fifteen minutes. Reopening resumes it.
        setTransportError(error.message);
      }
    } finally {
      setIsGenerating(false);
    }
  }, []);

  // Resume the job this browser was last watching. Without this the jobId lived
  // in a local const inside handleConfigSubmit, so closing the modal lost it
  // forever — while the client's own timeout message advised reopening the
  // builder to check, which nothing made possible.
  useEffect(() => {
    const stored = recallGenerationJob(ENDPOINT);
    if (!stored) return;
    setGenerationStatus('Reconnecting to the job you left…');
    // Remembered with the job, so the review still quotes it after a reload.
    setGuidanceSent(stored.batchGuidance || '');
    watchJob(stored.jobId);
  }, [watchJob]);

  const handleConfigSubmit = async () => {
    setIsGenerating(true);
    setGenerationStatus('Starting generation...');
    setTransportError(null);
    setJob(null);
    setGeneratedTrivia([]);
    setExcluded(new Set());
    setEditingItem(false);
    setReviewingPartial(false);
    setStep(2);
    const sentGuidance = batchGuidanceFor(appendTo, batchGuidance);
    setGuidanceSent(sentGuidance);

    // Generation runs as a background job. It cannot run inside the request:
    // API Gateway's 30s integration timeout is a hard ceiling and a full set
    // takes minutes, which is what produced the "HTTP 503 - retrying" loop.
    try {
      const { jobId } = await startGenerationJob(ENDPOINT, {
        topic: triviaConfig.topic,
        audience: triviaConfig.audience,
        difficulty: triviaConfig.difficulty,
        count: appendTo?.count || triviaConfig.count,
        numChoices: triviaConfig.numChoices,
        numCorrect: triviaConfig.numCorrect,
        numberOfCategories: appendTo?.numberOfCategories || triviaConfig.numberOfCategories,
        mustHaveCategories: triviaConfig.mustHaveCategories,
        customPrompt: withAppendRequirement(triviaConfig.customPrompt, appendTo),
        // Its own field, never folded into customPrompt; absent when blank.
        ...(sentGuidance ? { batchGuidance: sentGuidance } : {}),
        // THE SET'S OWN COPY, SENT WITH THE REQUEST. The worker creates the
        // question set itself now — that is the fix for "Close — this keeps
        // running", which was true about the job and false about the outcome —
        // and it needs a title and a description to do it. Computed in the
        // browser and sent, rather than re-derived in the Lambda, so there is
        // one author of this copy and not two that drift.
        // ADDING makes no set: the items come back and the editor appends them.
        ...(isAppend(appendTo) ? { appendOnly: true } : { setMetadata: buildSetMetadata() })
      }, { label: 'Generation', onStatus: setGenerationStatus });

      rememberGenerationJob(ENDPOINT, jobId, {
        topic: triviaConfig.topic,
        ...(sentGuidance ? { batchGuidance: sentGuidance } : {}),
      });
      await watchJob(jobId);
    } catch (error) {
      console.error('AI trivia generation error:', error);
      setIsGenerating(false);
      setTransportError(error.message);
    }
  };

  /** Done with this job: stop offering to resume it. */
  useEffect(() => {
    if (!appendTo?.autoStart || autoStarted.current || !triviaConfig.topic.trim()) return;
    autoStarted.current = true;
    handleConfigSubmit();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const dismissJob = () => {
    forgetGenerationJob(ENDPOINT);
    jobIdRef.current = null;
  };

  const backToConfiguration = () => {
    dismissJob();
    setJob(null);
    setTransportError(null);
    setGenerationStatus('');
    setGeneratedTrivia([]);
    setExcluded(new Set());
    setEditingItem(false);
    setReviewingPartial(false);
    setStep(1);
  };

  const retryRemaining = (remaining) => {
    setTriviaConfig(prev => ({ ...prev, count: Math.max(1, Math.min(100, remaining || prev.count)) }));
    backToConfiguration();
  };

  const toggleExcluded = (index) => {
    setExcluded(prev => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index); else next.add(index);
      return next;
    });
  };

  const keptTrivia = generatedTrivia.filter((_, index) => !excluded.has(index));

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
    // Drop any in-flight tag edit; it belongs to the question being left.
    setTagDraft(null);
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
    const headers = 'Category,Question#,Title,QuestionDetail,AnswerDetails,School,OptionA,OptionB,OptionC,OptionD,OptionE,OptionF,CorrectAnswer,Difficulty,Tags,Background';
    // Excluded rows are excluded everywhere. Exporting what the operator just
    // said to leave out would make the CSV and the set disagree.
    const rows = keptTrivia.map((trivia, index) => {
      const correctAnswer = Array.isArray(trivia.correctAnswer) ? trivia.correctAnswer.join(',') : trivia.correctAnswer;

      return csvRow([
        trivia.category,
        index + 1,
        trivia.title,
        trivia.questionDetail,
        trivia.answerDetails,
        trivia.school || 'General',
        trivia.optionA || '',
        trivia.optionB || '',
        trivia.optionC || '',
        trivia.optionD || '',
        trivia.optionE || '',
        trivia.optionF || '',
        correctAnswer,
        trivia.difficulty,
        tagsToCsvCell(trivia.tags),
        trivia.background || ''
      ]);
    });
    return buildCsv(headers, rows);
  };

  /**
   * The set's own copy, from the CONFIGURATION and nothing else.
   *
   * Lifted out of handleLoadIntoSystem because it is now needed twice and at
   * two different moments: once here, on the manual load, and once at the START
   * of generation, where it is sent to the worker so the worker can name the
   * set it creates. It therefore may not depend on the generated items —
   * `keptTrivia.length` used to open the description and would read as zero at
   * the moment the job is dispatched. The real number is on the set already, as
   * questionCount.
   */
  const buildSetMetadata = () => ({
    title: `${triviaConfig.topic} Trivia${triviaConfig.audience ? ` for ${triviaConfig.audience}` : ''}`,
    description: `AI-generated trivia questions about ${triviaConfig.topic}. Difficulty: ${triviaConfig.difficulty}. ${triviaConfig.numChoices} choices per question.`,
    customInstructions: `Select the best answer for each question. ${triviaConfig.numCorrect > 1 ? `Some questions may have ${triviaConfig.numCorrect} correct answers.` : ''}`,
    aiContextInstructions: buildWorkieSetNote({
      subject: `${triviaConfig.topic} trivia`,
      audience: triviaConfig.audience,
      difficulty: triviaConfig.difficulty,
      brief: triviaConfig.customPrompt,
    })
  });

  /**
   * The worker already made the set. Take the operator to it and write nothing.
   *
   * THE NO-DOUBLE-CREATION RULE. `createdSet` is written on the job record
   * BEFORE the job goes terminal, so a terminal job either carries a set or
   * genuinely has none. Posting to /admin/upload-questions as well would be
   * refused — the importer will not write over a set that exists — and would
   * report that refusal as a failure over a set that is sitting there.
   */
  const handleOpenCreatedSet = () => {
    dismissJob();
    onTriviaGenerated({ createdSet: interpreted.createdSet });
  };

  const handleLoadIntoSystem = () => {
    dismissJob();
    onTriviaGenerated({
      questions: keptTrivia,
      metadata: buildSetMetadata()
    });
  };

  const currentTrivia = generatedTrivia[currentTriviaIndex];
  const optionKeys = ['optionA', 'optionB', 'optionC', 'optionD', 'optionE', 'optionF'];
  const availableOptions = optionKeys.slice(0, triviaConfig.numChoices);

  const interpreted = interpretGenerationJob(job);
  // The ONE branch. 'complete' goes straight to review; a 'partial' has to be
  // acknowledged on the failure screen first; everything else is the panel.
  const reviewing = !isGenerating && !transportError
    && (interpreted.outcome === 'complete'
      || (interpreted.outcome === 'partial' && reviewingPartial));

  /*
   * EVERY WAY OUT OF THE REVIEW SCREEN GOES THROUGH THIS — the scrim, the X,
   * and Cancel. Configuring or generating loses nothing (the job keeps
   * running and is remembered, resumable on reopen), so this asks only when
   * ADDING and the review holds questions not yet added — appendOnly mode
   * makes no set, so they live nowhere else, and reopening would auto-start a
   * fresh job that overwrites the one just abandoned.
   */
  const requestClose = () => {
    if (isAppend(appendTo) && reviewing && keptTrivia.length > 0
      && !window.confirm('Close without adding these questions? They have not been added and will be lost.')) {
      return;
    }
    onClose();
  };

  /**
   * A real defect the model produces, not a decoration: a correctAnswer that
   * does not name one of the options this set actually has. upload-questions
   * takes the string as given, so the question plays with an answer nobody can
   * pick.
   */
  const answerDefect = (trivia) => {
    const answers = Array.isArray(trivia?.correctAnswer) ? trivia.correctAnswer : [trivia?.correctAnswer];
    const valid = availableOptions.map((_, i) => `Option${String.fromCharCode(65 + i)}`);
    const named = answers.filter(Boolean);
    if (named.length === 0) return 'No correct answer was set — this question cannot be scored.';
    const unknown = named.filter((answer) => !valid.includes(answer));
    if (unknown.length) return `Correct answer ${unknown.join(', ')} is not one of this set's ${valid.length} options.`;
    const missing = named.filter((answer) => !String(trivia[`option${answer.slice(6)}`] || '').trim());
    if (missing.length) return 'The correct answer points at an empty option.';
    return null;
  };

  const correctAnswerLine = (trivia) => {
    const answers = Array.isArray(trivia?.correctAnswer) ? trivia.correctAnswer : [trivia?.correctAnswer];
    const named = answers.filter(Boolean);
    if (!named.length) return null;
    return named
      .map((answer) => {
        const letter = String(answer).replace(/^Option/, '');
        const text = trivia[`option${letter}`];
        return text ? `${letter} — ${text}` : letter;
      })
      .join('; ');
  };

  return (
    <div className="trivia-ai-builder-modal">
      <div className="modal-overlay" onClick={requestClose}></div>
      <div className="modal-content trivia-builder" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2><Icon name="Brain" weight="duotone" size={16} color="var(--primary)" /> {isAppend(appendTo) ? `Add trivia to “${appendTo.setName}”` : 'AI Trivia Builder'}</h2>
          <button className="close-button" onClick={requestClose}><Icon name="X" weight="bold" size={16} color="currentColor" /></button>
        </div>

        <div className="modal-body">
          {step === 1 && (
            <div className="trivia-configuration">
              <h3>Configure Your Trivia Questions</h3>
              <AppendModeSwitch appendTo={appendTo} />
              {/* Only ever set on step 1 by the resume path, when the stored
                  job id has outlived the job record's three-day TTL. */}
              <StatusMessage message={generationStatus} tone="pending" />

              {/* The helper, before the fields it writes into. */}
              <AIFormAssist
                formId={ASSIST_FORM.formId}
                fields={ASSIST_FORM.fields}
                seed={ASSIST_FORM.seed}
                values={triviaConfig}
                locked={lockedFields}
                onApply={(patch) => setTriviaConfig(prev => ({ ...prev, ...patch }))}
                hints={[
                  `The operator asked for ${triviaConfig.count} questions across ${triviaConfig.numberOfCategories} categories.`,
                  `Difficulty: ${triviaConfig.difficulty}.`,
                ]}
              />

              <div className="config-form">
                {/* ADDING ONLY, and first: this batch's instruction. */}
                {isAppend(appendTo) && <BatchGuidanceField value={batchGuidance} onChange={setBatchGuidance} />}

                <div className="form-row">
                  <div className="form-group">
                    <div className="label-row">
                      <label>Topic/Subject *</label>
                      {lockFor('topic')}
                    </div>
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
                    <div className="label-row">
                      <label>Target Audience</label>
                      {lockFor('audience')}
                    </div>
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

                {/*
                  ONE GROUP FOR THE TWO NUMBERS THAT MULTIPLY. They used to sit
                  two fields apart — a total here, a category count further
                  down — with "how many per category" left as arithmetic. It is
                  now asked directly, 2/3/5/10 per category, and the total is
                  stated under it.
                */}
                <div className="form-row">
                  <SetSizeField
                    count={triviaConfig.count}
                    categories={triviaConfig.numberOfCategories}
                    onChange={({ count, categories }) => setTriviaConfig((prev) => ({ ...prev, count, numberOfCategories: categories }))}
                    noun="questions"
                    maxTotal={100}
                    lockedCategories={appendsToExisting(appendTo) ? appendTo.categories : null}
                    adding={isAppend(appendTo) ? { existingTotal: appendTo.existingTotal || 0 } : null}
                    maxCategories={isAppend(appendTo) && !appendsToExisting(appendTo) ? Math.max(1, 24 - appendTo.categories.length) : 24}
                    hint="Categories are what the host can switch on and off mid-session."
                  />
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

                {!appendsToExisting(appendTo) && (
                <div className="form-row">
                  <div className="form-group">
                    <div className="label-row">
                      <label>{isAppend(appendTo) ? 'Name the new categories (optional)' : 'Must Have Categories'}</label>
                      {lockFor('mustHaveCategories')}
                    </div>
                    <input
                      type="text"
                      value={triviaConfig.mustHaveCategories}
                      onChange={(e) => setTriviaConfig(prev => ({ ...prev, mustHaveCategories: e.target.value }))}
                      placeholder="History, Science, Sports, Entertainment..."
                    />
                  </div>
                </div>
                )}

                <div className="form-group">
                  <div className="label-row">
                    <label>Additional Requirements (Optional)</label>
                    {lockFor('customPrompt')}
                  </div>
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
              {!reviewing ? (
                <GenerationJobPanel
                  job={interpreted}
                  noun="questions"
                  jobId={jobIdRef.current}
                  createsSet
                  statusLine={generationStatus}
                  transportError={transportError}
                  onKeepRunning={onClose}
                  onReconnect={() => jobIdRef.current && watchJob(jobIdRef.current)}
                  onReview={() => setReviewingPartial(true)}
                  onRetryRemaining={retryRemaining}
                  onDiscard={backToConfiguration}
                  onBackToConfig={backToConfiguration}
                />
              ) : !editingItem ? (
                /*
                  ONCE THE WORKER HAS MADE THE SET, THIS TABLE IS A RECEIPT.
                  Excluding or editing a row here would change an array that is
                  no longer what gets saved — all of them are already in the
                  draft. Both row controls are withheld rather than left live
                  and inert, and the primary action opens the set instead of
                  creating one. See AIScenarioBuilder for the same shape.
                */
                <GeneratedItemsTable
                  items={generatedTrivia}
                  requested={interpreted.requested}
                  noun="questions"
                  guidance={guidanceSent}
                  excluded={excluded}
                  savedAs={interpreted.createdSet}
                  onToggleExclude={interpreted.createdSet ? undefined : toggleExcluded}
                  onEdit={interpreted.createdSet
                    ? undefined
                    : (index) => { setCurrentTriviaIndex(index); setTagDraft(null); setEditingItem(true); }}
                  primary={(trivia) => trivia.title}
                  secondary={(trivia) => {
                    const line = correctAnswerLine(trivia);
                    return line ? `Correct: ${line}` : null;
                  }}
                  flag={answerDefect}
                  columns={[
                    { header: 'Category', value: (trivia) => trivia.category, width: '150px', filterable: true },
                    { header: 'Difficulty', value: (trivia) => trivia.difficulty, width: '110px' },
                  ]}
                  actions={(
                    <>
                      <button className="btn-secondary" onClick={handleExportCSV}>
                        <Icon name="FileText" weight="bold" size={16} color="currentColor" /> Export CSV
                      </button>
                      {interpreted.createdSet ? (
                        <button className="btn-primary" onClick={handleOpenCreatedSet}>
                          <Icon name="ArrowRight" weight="bold" size={16} color="currentColor" />{' '}
                          Open &ldquo;{interpreted.createdSet.setName}&rdquo;
                        </button>
                      ) : (
                        <button className="btn-primary" onClick={handleLoadIntoSystem} disabled={keptTrivia.length === 0}>
                          <Icon name="DownloadSimple" weight="bold" size={16} color="currentColor" /> {isAppend(appendTo) ? `Add ${keptTrivia.length} to “${appendTo.setName}”` : `Load ${keptTrivia.length} into System`}
                        </button>
                      )}
                    </>
                  )}
                />
              ) : (
                <div className="trivia-review">
                  <div className="trivia-navigation">
                    <button
                      className="nav-button prev"
                      onClick={() => navigateTrivia('prev')}
                      disabled={currentTriviaIndex === 0}
                    >
                      <Icon name="ArrowLeft" weight="bold" size={16} color="currentColor" /> Previous
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
                      Next <Icon name="ArrowRight" weight="bold" size={16} color="currentColor" />
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

                      {/*
                        Suggested tags, not imposed tags. The model that just wrote
                        the question is best placed to say what it is about, but the
                        owner gets the final word before anything is saved. Stored
                        as a flat lowercase kebab-case array under `tags`.
                      */}
                      <div className="form-group">
                        <label>Tags <span className="field-hint">suggested — edit freely, comma separated</span></label>
                        <input
                          type="text"
                          value={tagDraft !== null ? tagDraft : (currentTrivia?.tags || []).join(', ')}
                          onChange={(e) => setTagDraft(e.target.value)}
                          onBlur={() => {
                            if (tagDraft !== null) {
                              handleTriviaEdit(currentTriviaIndex, 'tags', normalizeTags(tagDraft));
                              setTagDraft(null);
                            }
                          }}
                          placeholder="remote-work, history, geography"
                        />
                        {(currentTrivia?.tags || []).length > 0 && (
                          <div className="tag-chips">
                            {currentTrivia.tags.map((tag) => (
                              <span className="tag-chip" key={tag}>{tag}</span>
                            ))}
                          </div>
                        )}
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
                                {isCorrect && <span className="correct-indicator"><Icon name="Check" weight="bold" size={16} color="var(--success)" /> Correct</span>}
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
                                {isCorrect ? 'Remove' : 'Set as Correct'}
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
                                    {isCorrect && <span className="correct-indicator"> <Icon name="Check" weight="bold" size={16} color="var(--success)" /></span>}
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
                    <button className="btn-secondary" onClick={() => { setTagDraft(null); setEditingItem(false); }}>
                      <Icon name="ListChecks" weight="bold" size={16} color="currentColor" /> Back to all {generatedTrivia.length} questions
                    </button>
                    <button
                      className="btn-secondary"
                      onClick={() => toggleExcluded(currentTriviaIndex)}
                    >
                      {excluded.has(currentTriviaIndex) ? 'Put this one back' : 'Leave this one out'}
                    </button>
                  </div>
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
                <Icon name="Sparkle" weight="duotone" size={16} color="var(--primary)" /> Generate Trivia Questions
              </button>
            </>
          )}
          {step === 2 && reviewing && (
            <>
              <button className="btn-secondary" onClick={backToConfiguration}>
                <Icon name="ArrowLeft" weight="bold" size={16} color="currentColor" /> Back to Configuration
              </button>
              <button className="btn-secondary" onClick={requestClose}>
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
