import React, { useState, useEffect, useCallback, useRef } from 'react';
import FileUploadPrompt from './FileUploadPrompt';
import { startGenerationJob, pollGenerationJob } from '../utils/aiBatchClient';
import Icon from './Icon';
import CountField from './CountField';
import RoundKindPicker from './RoundKindPicker';
import {
  roundKindParticipantInstruction, roundKindGaps, DEFAULT_ROUND_KIND,
} from '../config/roundKinds';
import { normalizeTags, tagsToCsvCell } from '../utils/tags';
import { csvRow, buildCsv, optionsToCsvCell, allowMultipleToCsvCell } from '../utils/csv';
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
const ENDPOINT = `${API_BASE}admin/ai-generate-polls`;
const ASSIST_FORM = BUILDER_FORM_FIELDS.poll;

function PollAIBuilder({ onClose, onPollGenerated }) {
  const [step, setStep] = useState(1);
  const [pollConfig, setPollConfig] = useState({
    topic: '',
    category: '',
    audience: '',
    difficulty: 'medium',
    count: 10,
    allowMultiple: false,
    customPrompt: '',
    // DIRECTION — what the room is asked to DO with each item, as distinct
    // from the topic. A poll round can hand people somebody else's material
    // and ask which reading of it lands; the difference from call-and-answer
    // is only that the answers are picked rather than written.
    roundKind: DEFAULT_ROUND_KIND,
    roundKindBrief: '',
    roundKindInstruction: ''
  });
  const [generatedPolls, setGeneratedPolls] = useState([]);
  const [currentPollIndex, setCurrentPollIndex] = useState(0);
  // The last poll response, in the shape jobToResponse() actually sends. Every
  // render branch reads interpretGenerationJob(job).outcome, never
  // generatedPolls.length — which is true for a FAILED job carrying partials.
  const [job, setJob] = useState(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [transportError, setTransportError] = useState(null);
  const [generationStatus, setGenerationStatus] = useState('');
  const [excluded, setExcluded] = useState(() => new Set());
  const [editingItem, setEditingItem] = useState(false);
  const [reviewingPartial, setReviewingPartial] = useState(false);
  // Raw text of the tag field while it is being edited. null = not editing, so
  // the input falls back to the poll's stored tags. Normalising on every
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
    { value: 'easy', label: 'Easy', description: 'Simple, straightforward poll questions' },
    { value: 'medium', label: 'Medium', description: 'Moderate complexity, some thought required' },
    { value: 'hard', label: 'Hard', description: 'Complex topics requiring deeper consideration' }
  ];

  const jobIdRef = useRef(null);

  /** See TriviaAIBuilder.watchJob — same contract, same reasons. */
  const watchJob = useCallback(async (jobId) => {
    jobIdRef.current = jobId;
    setIsGenerating(true);
    setTransportError(null);
    setStep(2);
    try {
      const terminal = await pollGenerationJob(ENDPOINT, jobId, {
        label: 'Generation',
        onStatus: setGenerationStatus,
        // Show polls as they land rather than a spinner for minutes.
        onProgress: (update) => {
          setJob(update);
          if (Array.isArray(update.items) && update.items.length > 0) {
            setGeneratedPolls(update.items);
          }
        }
      });
      setJob(terminal);
      setGeneratedPolls(Array.isArray(terminal.items) ? terminal.items : []);
      setCurrentPollIndex(0);
    } catch (error) {
      console.error('AI poll generation error:', error);
      if (resumeIsGone(error)) {
        forgetGenerationJob(ENDPOINT);
        jobIdRef.current = null;
        setJob(null);
        setStep(1);
        setGenerationStatus('That job has expired — generation jobs are readable for three days. Start a new one.');
      } else {
        // Keep the stored id: the worker may still be running.
        setTransportError(error.message);
      }
    } finally {
      setIsGenerating(false);
    }
  }, []);

  useEffect(() => {
    const stored = recallGenerationJob(ENDPOINT);
    if (!stored) return;
    setGenerationStatus('Reconnecting to the job you left…');
    watchJob(stored.jobId);
  }, [watchJob]);

  /**
   * Empty for the four named kinds; `custom` supplies its own or it is not ready.
   *
   * A custom direction with an empty brief would send the generator a prompt
   * with a hole where the direction should be, and an empty instruction would
   * put a blank line in front of the room. Gates the Generate button below,
   * beside the existing "a poll needs a topic" gate.
   */
  const kindGaps = roundKindGaps(pollConfig.roundKind, {
    brief: pollConfig.roundKindBrief,
    instruction: pollConfig.roundKindInstruction,
  });

  const handleConfigSubmit = async () => {
    setIsGenerating(true);
    setGenerationStatus('Starting generation...');
    setTransportError(null);
    setJob(null);
    setGeneratedPolls([]);
    setExcluded(new Set());
    setEditingItem(false);
    setReviewingPartial(false);
    setStep(2);

    // Generation runs as a background job. It cannot run inside the request:
    // API Gateway's 30s integration timeout is a hard ceiling and a full set
    // takes minutes, which is what produced the "HTTP 503 - retrying" loop.
    try {
      const { jobId } = await startGenerationJob(ENDPOINT, {
        topic: pollConfig.topic,
        category: pollConfig.category,
        audience: pollConfig.audience,
        difficulty: pollConfig.difficulty,
        count: pollConfig.count,
        allowMultiple: pollConfig.allowMultiple,
        customPrompt: pollConfig.customPrompt,
        roundKind: pollConfig.roundKind,
        roundKindBrief: pollConfig.roundKindBrief,
        // THE SET'S OWN COPY, SENT WITH THE REQUEST. The worker creates the
        // question set itself now — that is the fix for "Close — this keeps
        // running", which was true about the job and false about the outcome —
        // and it needs a title, a description and the participant instruction
        // to do it. The instruction in particular can only be computed here:
        // it folds in the operator's own words for a `custom` round kind,
        // which the Lambda never sees.
        setMetadata: buildSetMetadata()
      }, { label: 'Generation', onStatus: setGenerationStatus });

      rememberGenerationJob(ENDPOINT, jobId, { topic: pollConfig.topic });
      await watchJob(jobId);
    } catch (error) {
      console.error('AI poll generation error:', error);
      setIsGenerating(false);
      setTransportError(error.message);
    }
  };

  const dismissJob = () => {
    forgetGenerationJob(ENDPOINT);
    jobIdRef.current = null;
  };

  const backToConfiguration = () => {
    dismissJob();
    setJob(null);
    setTransportError(null);
    setGenerationStatus('');
    setGeneratedPolls([]);
    setExcluded(new Set());
    setEditingItem(false);
    setReviewingPartial(false);
    setStep(1);
  };

  const retryRemaining = (remaining) => {
    setPollConfig(prev => ({ ...prev, count: Math.max(1, Math.min(100, remaining || prev.count)) }));
    backToConfiguration();
  };

  const toggleExcluded = (index) => {
    setExcluded(prev => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index); else next.add(index);
      return next;
    });
  };

  const keptPolls = generatedPolls.filter((_, index) => !excluded.has(index));

  const handlePollEdit = (index, field, value) => {
    const updatedPolls = [...generatedPolls];
    updatedPolls[index] = { ...updatedPolls[index], [field]: value };
    setGeneratedPolls(updatedPolls);
  };

  const handleOptionEdit = (pollIndex, optionIndex, value) => {
    const updatedPolls = [...generatedPolls];
    const newOptions = [...updatedPolls[pollIndex].options];
    newOptions[optionIndex] = value;
    updatedPolls[pollIndex] = { ...updatedPolls[pollIndex], options: newOptions };
    setGeneratedPolls(updatedPolls);
  };

  const addOption = (pollIndex) => {
    const updatedPolls = [...generatedPolls];
    updatedPolls[pollIndex].options.push('');
    setGeneratedPolls(updatedPolls);
  };

  const removeOption = (pollIndex, optionIndex) => {
    const updatedPolls = [...generatedPolls];
    updatedPolls[pollIndex].options.splice(optionIndex, 1);
    setGeneratedPolls(updatedPolls);
  };

  const navigatePoll = (direction) => {
    // Drop any in-flight tag edit; it belongs to the poll being left.
    setTagDraft(null);
    if (direction === 'prev' && currentPollIndex > 0) {
      setCurrentPollIndex(currentPollIndex - 1);
    } else if (direction === 'next' && currentPollIndex < generatedPolls.length - 1) {
      setCurrentPollIndex(currentPollIndex + 1);
    }
  };

  const handleExportCSV = () => {
    const csvContent = generatePollCSV();
    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `polls-${pollConfig.topic.replace(/[^a-zA-Z0-9]/g, '_')}-${Date.now()}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);
  };

  const generatePollCSV = () => {
    // ONE `Options` column, pipe-separated — see optionsToCsvCell(). This used
    // to emit Option1..Option5, which upload-questions.js does not read and has
    // no fallback for, so every exported poll set re-imported with zero
    // options. Do not "restore" the numbered columns.
    const headers = 'Category,Question#,Title,Detail_lesson,School,CustomInstruction,Options,AllowMultiple,Tags';
    // Excluded rows are excluded everywhere — see TriviaAIBuilder.
    const rows = keptPolls.map((poll, index) => csvRow([
      poll.category,
      index + 1,
      poll.title,
      poll.detail,
      poll.school || 'General',
      poll.customInstructions || '',
      optionsToCsvCell(poll.options),
      allowMultipleToCsvCell(poll.allowMultiple),
      tagsToCsvCell(poll.tags)
    ]));
    return buildCsv(headers, rows);
  };

  /**
   * The set's own copy, from the CONFIGURATION and nothing else.
   *
   * Lifted out of handleLoadIntoSystem because it is needed twice and at two
   * different moments: once here, on the manual load, and once at the START of
   * generation, where it is sent to the worker so the worker can name the set
   * it creates. It therefore may not depend on the generated items —
   * `keptPolls.length` used to open the description and would read as zero at
   * the moment the job is dispatched. The real number is on the set already, as
   * questionCount.
   */
  const buildSetMetadata = () => ({
    title: `${pollConfig.topic} Polls${pollConfig.audience ? ` for ${pollConfig.audience}` : ''}`,
    description: `AI-generated poll questions about ${pollConfig.topic}. Difficulty: ${pollConfig.difficulty}.`,
    // The MECHANIC line plus the round's DIRECTION. The mechanic ("pick an
    // option") is a property of the game and never changes; the direction is
    // what tells the room whether they are choosing between their own
    // instincts, between readings of a passage they were handed, or between
    // verdicts. A poll that says only "select your preferred option" leaves
    // the second and third of those looking identical to the first.
    customInstructions: [
      `Select your preferred option(s) for each poll question.`,
      pollConfig.allowMultiple ? 'Multiple selections may be allowed for some questions.' : '',
      roundKindParticipantInstruction(pollConfig.roundKind, pollConfig.roundKindInstruction),
    ].filter(Boolean).join(' '),
    aiContextInstructions: `These are ${pollConfig.difficulty}-level poll questions about ${pollConfig.topic}. Encourage thoughtful consideration and diverse perspectives.`
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
    onPollGenerated({ createdSet: interpreted.createdSet });
  };

  const handleLoadIntoSystem = () => {
    dismissJob();
    onPollGenerated({
      questions: keptPolls,
      metadata: buildSetMetadata(),
      // The direction travels with the set, or it steers one generation and is
      // then forgotten — see AdminPage's handleScenariosGenerated.
      roundKind: pollConfig.roundKind,
      roundKindBrief: pollConfig.roundKindBrief
    });
  };

  const currentPoll = generatedPolls[currentPollIndex];

  const interpreted = interpretGenerationJob(job);
  const reviewing = !isGenerating && !transportError
    && (interpreted.outcome === 'complete'
      || (interpreted.outcome === 'partial' && reviewingPartial));

  /**
   * A poll with fewer than two options is unplayable — there is nothing to
   * choose between. Real: the importer stores whatever it is given, and the
   * emitter drops empty option slots rather than padding them.
   */
  const optionDefect = (poll) => {
    const options = Array.isArray(poll?.options)
      ? poll.options.filter((option) => String(option ?? '').trim())
      : [];
    if (options.length === 0) return 'No options — nobody can vote on this.';
    if (options.length === 1) return 'Only one option — there is nothing to choose between.';
    return null;
  };

  return (
    <div className="poll-ai-builder-modal">
      <div className="modal-overlay" onClick={onClose}></div>
      <div className="modal-content poll-builder" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2><Icon name="ChartBar" weight="duotone" size={16} color="var(--primary)" /> AI Poll Builder</h2>
          <button className="close-button" onClick={onClose}><Icon name="X" weight="bold" size={16} color="currentColor" /></button>
        </div>

        <div className="modal-body">
          {step === 1 && (
            <div className="poll-configuration">
              <h3>Configure Your Poll Questions</h3>
              {/* Only ever set on step 1 by the resume path, when the stored
                  job id has outlived the job record's three-day TTL. */}
              <StatusMessage message={generationStatus} tone="pending" />

              {/* Direction before topic, for the same reason it leads in the
                  scenario builder: it changes what a good topic answer even
                  looks like. */}
              <section className="round-kind-step">
                <h4 id="poll-round-kind-heading">What will the room do with each one?</h4>
                <p className="step-lede">
                  This is the direction, not the subject. It decides whether people are
                  choosing between their own instincts, between readings of material you
                  hand them, or between verdicts.
                </p>
                <RoundKindPicker
                  headingId="poll-round-kind-heading"
                  idPrefix="poll-round-kind"
                  value={pollConfig.roundKind}
                  onChange={(roundKind) => setPollConfig(prev => ({ ...prev, roundKind }))}
                  brief={pollConfig.roundKindBrief}
                  onBriefChange={(roundKindBrief) => setPollConfig(prev => ({ ...prev, roundKindBrief }))}
                  instruction={pollConfig.roundKindInstruction}
                  onInstructionChange={(roundKindInstruction) => setPollConfig(prev => ({ ...prev, roundKindInstruction }))}
                />
              </section>

              {/* The helper, before the fields it writes into. */}
              <AIFormAssist
                formId={ASSIST_FORM.formId}
                fields={ASSIST_FORM.fields}
                seed={ASSIST_FORM.seed}
                values={pollConfig}
                locked={lockedFields}
                onApply={(patch) => setPollConfig(prev => ({ ...prev, ...patch }))}
                hints={[
                  `The operator asked for ${pollConfig.count} poll questions.`,
                  `Complexity: ${pollConfig.difficulty}.`,
                ]}
              />

              <div className="config-form">
                <div className="form-row">
                  <div className="form-group">
                    <div className="label-row">
                      <label>Topic/Subject *</label>
                      {lockFor('topic')}
                    </div>
                    <input
                      type="text"
                      value={pollConfig.topic}
                      onChange={(e) => setPollConfig(prev => ({ ...prev, topic: e.target.value }))}
                      placeholder="e.g., Team Preferences, Product Feedback, Decision Making"
                    />
                  </div>
                  <div className="form-group">
                    <div className="label-row">
                      <label>Category</label>
                      {lockFor('category')}
                    </div>
                    <input
                      type="text"
                      value={pollConfig.category}
                      onChange={(e) => setPollConfig(prev => ({ ...prev, category: e.target.value }))}
                      placeholder="e.g., Team Building, Feedback, Decisions"
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
                      value={pollConfig.audience}
                      onChange={(e) => setPollConfig(prev => ({ ...prev, audience: e.target.value }))}
                      placeholder="e.g., Team Members, Customers, Stakeholders"
                    />
                  </div>
                  <div className="form-group">
                    <label>Complexity Level</label>
                    <select
                      value={pollConfig.difficulty}
                      onChange={(e) => setPollConfig(prev => ({ ...prev, difficulty: e.target.value }))}
                    >
                      {difficultyLevels.map(level => (
                        <option key={level.value} value={level.value}>{level.label}</option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="form-row">
                  <CountField
                      label="Poll questions to generate"
                      value={pollConfig.count}
                      onChange={(n) => setPollConfig((prev) => ({ ...prev, count: n }))}
                      min={1}
                      max={50}
                      presets={[3, 5, 10, 20]}
                    />
                </div>

                <div className="form-row">
                  <div className="form-group">
                    <label>
                      <input
                        type="checkbox"
                        checked={pollConfig.allowMultiple}
                        onChange={(e) => setPollConfig(prev => ({ ...prev, allowMultiple: e.target.checked }))}
                      />
                      Allow multiple selections (where appropriate)
                    </label>
                  </div>
                </div>

                <div className="form-group">
                  <div className="label-row">
                    <label>Additional Requirements (Optional)</label>
                    {lockFor('customPrompt')}
                  </div>
                  <textarea
                    value={pollConfig.customPrompt}
                    onChange={(e) => setPollConfig(prev => ({ ...prev, customPrompt: e.target.value }))}
                    placeholder="Any specific requirements, themes, or constraints..."
                    rows="3"
                  />
                </div>

                <FileUploadPrompt
                  onContentExtracted={(content) => {
                    setPollConfig(prev => ({
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
            <div className="poll-generation">
              {!reviewing ? (
                <GenerationJobPanel
                  job={interpreted}
                  noun="poll questions"
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
                  items={generatedPolls}
                  requested={interpreted.requested}
                  noun="poll questions"
                  excluded={excluded}
                  savedAs={interpreted.createdSet}
                  onToggleExclude={interpreted.createdSet ? undefined : toggleExcluded}
                  onEdit={interpreted.createdSet
                    ? undefined
                    : (index) => { setCurrentPollIndex(index); setTagDraft(null); setEditingItem(true); }}
                  primary={(poll) => poll.title}
                  secondary={(poll) => (Array.isArray(poll.options) && poll.options.length
                    ? poll.options.join(' · ')
                    : null)}
                  flag={optionDefect}
                  columns={[
                    { header: 'Category', value: (poll) => poll.category, width: '150px', filterable: true },
                    { header: 'Options', value: (poll) => (Array.isArray(poll.options) ? poll.options.length : 0), width: '90px' },
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
                        <button className="btn-primary" onClick={handleLoadIntoSystem} disabled={keptPolls.length === 0}>
                          <Icon name="DownloadSimple" weight="bold" size={16} color="currentColor" /> Load {keptPolls.length} into System
                        </button>
                      )}
                    </>
                  )}
                />
              ) : (
                <div className="poll-review">
                  <div className="poll-navigation">
                    <button
                      className="nav-button prev"
                      onClick={() => navigatePoll('prev')}
                      disabled={currentPollIndex === 0}
                    >
                      <Icon name="ArrowLeft" weight="bold" size={16} color="currentColor" /> Previous
                    </button>

                    <div className="poll-counter">
                      <span>Poll {currentPollIndex + 1} of {generatedPolls.length}</span>
                      <h3>{currentPoll?.title}</h3>
                    </div>

                    <button
                      className="nav-button next"
                      onClick={() => navigatePoll('next')}
                      disabled={currentPollIndex === generatedPolls.length - 1}
                    >
                      Next <Icon name="ArrowRight" weight="bold" size={16} color="currentColor" />
                    </button>
                  </div>

                  {currentPoll && (
                    <div className="poll-editor">
                      <div className="form-group">
                        <label>Poll Question</label>
                        <input
                          type="text"
                          value={currentPoll.title || ''}
                          onChange={(e) => handlePollEdit(currentPollIndex, 'title', e.target.value)}
                        />
                      </div>

                      <div className="form-row">
                        <div className="form-group">
                          <label>Category</label>
                          <input
                            type="text"
                            value={currentPoll.category || ''}
                            onChange={(e) => handlePollEdit(currentPollIndex, 'category', e.target.value)}
                          />
                        </div>
                        <div className="form-group">
                          <label>
                            <input
                              type="checkbox"
                              checked={currentPoll.allowMultiple || false}
                              onChange={(e) => handlePollEdit(currentPollIndex, 'allowMultiple', e.target.checked)}
                            />
                            Allow multiple selections
                          </label>
                        </div>
                      </div>

                      {/*
                        Suggested tags, not imposed tags. The model that just wrote
                        the poll is best placed to say what it is about, but the
                        owner gets the final word before anything is saved. Stored
                        as a flat lowercase kebab-case array under `tags`.
                      */}
                      <div className="form-group">
                        <label>Tags <span className="field-hint">suggested — edit freely, comma separated</span></label>
                        <input
                          type="text"
                          value={tagDraft !== null ? tagDraft : (currentPoll?.tags || []).join(', ')}
                          onChange={(e) => setTagDraft(e.target.value)}
                          onBlur={() => {
                            if (tagDraft !== null) {
                              handlePollEdit(currentPollIndex, 'tags', normalizeTags(tagDraft));
                              setTagDraft(null);
                            }
                          }}
                          placeholder="remote-work, feedback, decisions"
                        />
                        {(currentPoll?.tags || []).length > 0 && (
                          <div className="tag-chips">
                            {currentPoll.tags.map((tag) => (
                              <span className="tag-chip" key={tag}>{tag}</span>
                            ))}
                          </div>
                        )}
                      </div>

                      <div className="poll-options-editor">
                        <h4>Poll Options</h4>
                        {currentPoll.options?.map((option, index) => (
                          <div key={index} className="option-editor">
                            <label>
                              <span className="option-number">{index + 1}.</span>
                              <input
                                type="text"
                                value={option}
                                onChange={(e) => handleOptionEdit(currentPollIndex, index, e.target.value)}
                              />
                            </label>
                            {currentPoll.options.length > 2 && (
                              <button
                                type="button"
                                className="remove-option-btn"
                                onClick={() => removeOption(currentPollIndex, index)}
                              >
                                <Icon name="X" weight="bold" size={16} color="currentColor" />
                              </button>
                            )}
                          </div>
                        ))}
                        <button
                          type="button"
                          className="add-option-btn"
                          onClick={() => addOption(currentPollIndex)}
                        >
                          + Add Option
                        </button>
                      </div>

                      <div className="poll-preview">
                        <h4>Preview:</h4>
                        <div className="poll-preview-display">
                          <div className="question-header">
                            <h3>{currentPoll.title}</h3>
                            <div className="field-badge">{currentPoll.category}</div>
                            {currentPoll.allowMultiple && <div className="multiple-badge">Multiple Choice</div>}
                          </div>
                          <div className="poll-options">
                            {currentPoll.options?.map((option, index) => (
                              <div key={index} className="category-item poll-option">
                                <span className="category-name">
                                  <span className="option-number">{index + 1}.</span> {option}
                                </span>
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>
                    </div>
                  )}

                  <div className="poll-actions">
                    <button className="btn-secondary" onClick={() => { setTagDraft(null); setEditingItem(false); }}>
                      <Icon name="ListChecks" weight="bold" size={16} color="currentColor" /> Back to all {generatedPolls.length} poll questions
                    </button>
                    <button
                      className="btn-secondary"
                      onClick={() => toggleExcluded(currentPollIndex)}
                    >
                      {excluded.has(currentPollIndex) ? 'Put this one back' : 'Leave this one out'}
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
                disabled={!pollConfig.topic.trim() || kindGaps.length > 0}
              >
                <Icon name="Sparkle" weight="duotone" size={16} color="var(--primary)" /> Generate Poll Questions
              </button>
            </>
          )}
          {step === 2 && reviewing && (
            <>
              <button className="btn-secondary" onClick={backToConfiguration}>
                <Icon name="ArrowLeft" weight="bold" size={16} color="currentColor" /> Back to Configuration
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

export default PollAIBuilder;
