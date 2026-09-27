import React, { useState, useEffect, useCallback, useRef } from 'react';
import FileUploadPrompt from './FileUploadPrompt';
import { startGenerationJob, pollGenerationJob } from '../utils/aiBatchClient';
import Icon from './Icon';
import CountField from './CountField';
import AppendModeSwitch from './AppendModeSwitch';
import { isAppend, appendsToExisting, withAppendRequirement } from '../utils/appendMode';
import RoundKindPicker from './RoundKindPicker';
import {
  roundKindParticipantInstruction, roundKindGaps, DEFAULT_ROUND_KIND,
} from '../config/roundKinds';
import { normalizeTags } from '../utils/tags';
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
import SurveyQuestionFields from './SurveyQuestionFields';
import { convertKind } from '../config/surveyKinds';
import {
  POLL_KINDS, POLL_KIND_IDS, DEFAULT_POLL_KINDS,
  pollKindOf, pollKindMeta, pollKindLabel, pollItemsToCsv, pollItemProblem, pollSummary, pollMechanicInstruction,
} from '../utils/pollDraft';
// The set editor's ground: its token block and the dusk inking of the shared
// form controls. The question form below is the editor's own
// (SurveyQuestionFields), and that form paints only inside `.qs-editor` — see
// the edit card's comment. Imported here rather than trusted to be in the
// bundle, because this builder also opens where the editor has never loaded.
import './QuestionSetEditor.css';
import './PollAIBuilder.css';

const API_BASE = window.API_BASE;
const ENDPOINT = `${API_BASE}admin/ai-generate-polls`;
const ASSIST_FORM = BUILDER_FORM_FIELDS.poll;

function PollAIBuilder({ onClose, onPollGenerated, appendTo = null }) {
  const appendMode = appendTo?.mode;
  const [step, setStep] = useState(1);
  const [pollConfig, setPollConfig] = useState({
    topic: appendTo?.brief?.topic || '',
    // Adding to a set's own categories starts on the first of them.
    category: appendsToExisting(appendTo) ? (appendTo.categories[0] || '') : '',
    audience: appendTo?.brief?.audience || '',
    difficulty: appendTo?.brief?.difficulty || 'medium',
    count: 10,
    // THE KINDS OF POLL QUESTION — the four the contract gives a poll, all on
    // by default so Workie can choose the one that fits each question. It
    // replaced an "Allow multiple selections" checkbox, which was the only say
    // a host had over what a poll asked for, and which said nothing about the
    // ratings, yes/no calls and open answers a poll can now be.
    kinds: DEFAULT_POLL_KINDS,
    customPrompt: '',
    // DIRECTION — what the room is asked to DO with each item, as distinct
    // from the topic. A poll round can hand people somebody else's material
    // and ask which reading of it lands; the difference from call-and-answer
    // is only that the answers are picked rather than written.
    roundKind: DEFAULT_ROUND_KIND,
    roundKindBrief: '',
    roundKindInstruction: ''
  });
  // The category follows the mode: one of the set's own in `existing`, a blank
  // to be named in `new` (AppendModeSwitch can change it from in here).
  useEffect(() => {
    if (!isAppend(appendTo)) return;
    setPollConfig((prev) => ({
      ...prev,
      category: appendsToExisting(appendTo) ? (appendTo.categories[0] || '') : '',
    }));
  }, [appendMode]); // eslint-disable-line react-hooks/exhaustive-deps
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
  // A kind the question form offered and a poll cannot be (Ranking), named
  // under the form until the host picks another or moves on. null = none.
  const [refusedKind, setRefusedKind] = useState(null);

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
  /* ONE PRESS, FROM THE SET. The Add questions dialog already knows the brief,
     the categories and the count, so when it says `autoStart` this builder
     opens GENERATING rather than on a form repeating what was just decided —
     only if the brief carries a topic; with nothing to write about, the form
     is the honest place to land. */
  const autoStarted = useRef(false);

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
        count: appendTo?.count || pollConfig.count,
        kinds: pollConfig.kinds,
        customPrompt: withAppendRequirement(pollConfig.customPrompt, appendTo),
        roundKind: pollConfig.roundKind,
        roundKindBrief: pollConfig.roundKindBrief,
        // THE SET'S OWN COPY, SENT WITH THE REQUEST. The worker creates the
        // question set itself now — that is the fix for "Close — this keeps
        // running", which was true about the job and false about the outcome —
        // and it needs a title, a description and the participant instruction
        // to do it. The instruction in particular can only be computed here:
        // it folds in the operator's own words for a `custom` round kind,
        // which the Lambda never sees.
        // ADDING makes no set: the items come back and the editor appends them.
        ...(isAppend(appendTo) ? { appendOnly: true } : { setMetadata: buildSetMetadata() })
      }, { label: 'Generation', onStatus: setGenerationStatus });

      rememberGenerationJob(ENDPOINT, jobId, { topic: pollConfig.topic });
      await watchJob(jobId);
    } catch (error) {
      console.error('AI poll generation error:', error);
      setIsGenerating(false);
      setTransportError(error.message);
    }
  };

  useEffect(() => {
    if (!appendTo?.autoStart || autoStarted.current || !pollConfig.topic.trim()) return;
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

  /**
   * The question form's change, for the poll being edited. The form is the
   * set editor's survey question form, which offers all five survey kinds; a
   * poll is four of them, so a switch to Ranking is refused here and said
   * under the form rather than accepted into a question the importer would
   * then skip.
   */
  const handleQuestionChange = (index, next) => {
    if (!POLL_KIND_IDS.includes(next.kind)) {
      setRefusedKind(next.kind);
      return;
    }
    setRefusedKind(null);
    setGeneratedPolls((prev) => prev.map((poll, i) => (i === index ? next : poll)));
  };

  /**
   * Switch a question's kind from the review table — convertKind decides what
   * survives, and a switch that would throw something away is asked about
   * first, naming it, exactly as the survey builder asks.
   */
  const changeKind = (index, toKind) => {
    const current = generatedPolls[index];
    if (!current) return;
    const typed = { ...current, kind: pollKindOf(current) };
    if (typed.kind === toKind) return;
    const { row, loses } = convertKind(typed, toKind);
    if (loses.length > 0) {
      const ok = window.confirm(
        `Make question ${index + 1} ${POLL_KINDS.find((k) => k.id === toKind).label}? It would lose ${loses.join(', ')}.`
      );
      if (!ok) return;
    }
    setGeneratedPolls((prev) => prev.map((poll, i) => (i === index ? row : poll)));
  };

  /** One kind toggle on the form. The last one ticked stays ticked. */
  const toggleKind = (id) => setPollConfig((prev) => {
    const on = prev.kinds.includes(id);
    if (on && prev.kinds.length === 1) return prev;
    const next = on ? prev.kinds.filter((k) => k !== id) : [...prev.kinds, id];
    return { ...prev, kinds: POLL_KIND_IDS.filter((k) => next.includes(k)) };
  });

  const navigatePoll = (direction) => {
    // Drop any in-flight tag edit and refusal; they belong to the poll being left.
    setTagDraft(null);
    setRefusedKind(null);
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

  /**
   * The kept polls as the poll contract's CSV — the survey's columns, each
   * question under its own category (utils/pollDraft.js). Excluded rows are
   * excluded everywhere — see TriviaAIBuilder.
   */
  const generatePollCSV = () => pollItemsToCsv(keptPolls);

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
    description: `AI-generated instant-feedback polls about ${pollConfig.topic}. Difficulty: ${pollConfig.difficulty}.`,
    // The MECHANIC line plus the round's DIRECTION. The mechanic is how a poll
    // is answered — for the kinds this set was made with, since "select your
    // preferred option(s)" is wrong for a rating, a yes/no or an open answer —
    // and the direction is what tells the room whether they are answering from
    // their own instincts, about a passage they were handed, or with a
    // verdict. A poll that states only the mechanic leaves the second and
    // third of those looking identical to the first.
    customInstructions: [
      pollMechanicInstruction(pollConfig.kinds),
      roundKindParticipantInstruction(pollConfig.roundKind, pollConfig.roundKindInstruction),
    ].filter(Boolean).join(' '),
    // "These are <level>-level … questions about <topic>." is the shape
    // utils/appendMode.js briefFromSet reads back when the host adds more.
    aiContextInstructions: `These are ${pollConfig.difficulty}-level instant-feedback poll questions about ${pollConfig.topic}. `
      + 'The room answers each in seconds and sees the results fill in on screen, so read the answers as the room\'s view as a whole: where it agrees, and where it splits.'
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

  /** See TriviaAIBuilder.requestClose — same contract, same reasons. */
  const requestClose = () => {
    if (isAppend(appendTo) && reviewing && keptPolls.length > 0
      && !window.confirm('Close without adding these poll questions? They have not been added and will be lost.')) {
      return;
    }
    onClose();
  };

  // A kept poll the importer would skip — a choice switched here and left
  // without its options — must not reach the set: it would be made without it
  // and only a skipped-row count would say so.
  const keptFlagged = keptPolls.filter((poll) => pollItemProblem(poll)).length;

  return (
    <div className="poll-ai-builder-modal">
      <div className="modal-overlay" onClick={requestClose}></div>
      <div className="modal-content poll-builder" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2><Icon name="ChartBar" weight="duotone" size={16} color="var(--primary)" /> {isAppend(appendTo) ? `Add polls to “${appendTo.setName}”` : 'AI Poll Builder'}</h2>
          <button className="close-button" onClick={requestClose}><Icon name="X" weight="bold" size={16} color="currentColor" /></button>
        </div>

        <div className="modal-body">
          {step === 1 && (
            <div className="poll-configuration">
              <h3>Configure Your Poll Questions</h3>
              <AppendModeSwitch appendTo={appendTo} />
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
                      <label>{isAppend(appendTo) && !appendsToExisting(appendTo) ? 'New category name' : 'Category'}</label>
                      {lockFor('category')}
                    </div>
                    {appendsToExisting(appendTo) ? (
                      /* This builder writes ONE category per run, so adding to a
                         set's own categories means choosing which one. */
                      <select
                        aria-label="Category"
                        value={pollConfig.category}
                        onChange={(e) => setPollConfig(prev => ({ ...prev, category: e.target.value }))}
                      >
                        {appendTo.categories.map((name) => <option key={name} value={name}>{name}</option>)}
                      </select>
                    ) : (
                    <input
                      type="text"
                      value={pollConfig.category}
                      onChange={(e) => setPollConfig(prev => ({ ...prev, category: e.target.value }))}
                      placeholder="e.g., Team Building, Feedback, Decisions"
                    />
                    )}
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
                      label={isAppend(appendTo) ? 'New poll questions to add' : 'Poll questions to generate'}
                      hint={isAppend(appendTo)
                        ? `On top of the ${appendTo.existingTotal || 0} already in the set — it goes from ${appendTo.existingTotal || 0} to ${(appendTo.existingTotal || 0) + pollConfig.count}. Nothing existing is replaced.`
                        : ''}
                      value={pollConfig.count}
                      onChange={(n) => setPollConfig((prev) => ({ ...prev, count: n }))}
                      min={1}
                      max={50}
                      presets={[3, 5, 10, 20]}
                    />
                </div>

                {/* The kinds, as the survey builder asks for them: pressed
                    toggles with a word and a tick, never the fill alone. */}
                <div className="pab pab-field">
                  <span className="pab-lab" id="pab-kinds-label">Kinds of poll question</span>
                  <div className="pab-opts" role="group" aria-labelledby="pab-kinds-label">
                    {POLL_KINDS.map((kind) => (
                      <button
                        key={kind.id}
                        type="button"
                        className="pab-opt"
                        aria-pressed={pollConfig.kinds.includes(kind.id)}
                        onClick={() => toggleKind(kind.id)}
                        title={kind.blurb}
                      >
                        <Icon name={kind.icon} weight="bold" size={15} color="currentColor" />
                        {kind.label}
                        <span className="pab-tick" aria-hidden="true">✓</span>
                      </button>
                    ))}
                  </div>
                  <p className="pab-help">
                    Workie uses only the ticked kinds and picks the one that fits each question. Tick one
                    for a set of a single kind.
                  </p>
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
                    : (index) => {
                      setCurrentPollIndex(index); setTagDraft(null); setRefusedKind(null); setEditingItem(true);
                    }}
                  primary={(poll) => poll.title}
                  // What the room will see: the options, the scale and its
                  // words, the two buttons, or the answer box and its hint.
                  secondary={pollSummary}
                  flag={pollItemProblem}
                  // The Kind column, as the survey builder's: with onChange the
                  // chip IS the select, offering the four poll kinds.
                  kinds={{
                    options: POLL_KINDS,
                    of: pollKindOf,
                    label: pollKindLabel,
                    onChange: interpreted.createdSet ? undefined : changeKind,
                  }}
                  columns={[
                    { header: 'Category', value: (poll) => poll.category, width: '150px', filterable: true },
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
                        <button
                          className="btn-primary"
                          onClick={handleLoadIntoSystem}
                          disabled={keptPolls.length === 0 || keptFlagged > 0}
                          title={keptFlagged > 0
                            ? `${keptFlagged === 1 ? 'One poll' : `${keptFlagged} polls`} could not be imported as ${keptFlagged === 1 ? 'it stands' : 'they stand'} — edit ${keptFlagged === 1 ? 'it' : 'them'}, or leave ${keptFlagged === 1 ? 'it' : 'them'} out.`
                            : undefined}
                        >
                          <Icon name="DownloadSimple" weight="bold" size={16} color="currentColor" /> {isAppend(appendTo) ? `Add ${keptPolls.length} to “${appendTo.setName}”` : `Load ${keptPolls.length} into System`}
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

                    {/* Where you are, not what the question says: the question
                        is in the form below, and stating it twice is noise. */}
                    <div className="poll-counter">
                      <span>Poll {currentPollIndex + 1} of {generatedPolls.length}</span>
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
                    /*
                      THE SET EDITOR'S OWN QUESTION FORM, ON THE SET EDITOR'S
                      OWN GROUND. A poll question is a survey question the host
                      asks, so it is edited with the survey's form
                      (SurveyQuestionFields): the kind first, then the question,
                      its detail and the kind's fields. That form is drawn and
                      measured on the editor's dusk card and paints only inside
                      `.qs-editor` (SurveyQuestionFields.css), so this card IS
                      one — dusk on its own root, whatever the builder is on.
                      Category and tags sit on the same card, inked by the same
                      scope. PollAIBuilder.css draws the card itself.
                    */
                    <div className="qs-editor pab pab-edit" data-theme="dark">
                      <SurveyQuestionFields
                        draft={{ ...currentPoll, kind: pollKindOf(currentPoll) }}
                        onChange={(next) => handleQuestionChange(currentPollIndex, next)}
                        idOf={(field) => `pab-${currentPollIndex}-${field}`}
                      />
                      {refusedKind && (
                        <p className="pab-note" role="status">
                          A poll can&rsquo;t be a ranking — a ranking is a ballot, and a poll is answered at a
                          glance. This one stays {pollKindMeta(currentPoll).label}.
                        </p>
                      )}

                      <div className="pab-row">
                        <div className="form-group">
                          <label htmlFor={`pab-${currentPollIndex}-category`}>Category</label>
                          <input
                            id={`pab-${currentPollIndex}-category`}
                            type="text"
                            className="form-input"
                            value={currentPoll.category || ''}
                            onChange={(e) => handlePollEdit(currentPollIndex, 'category', e.target.value)}
                          />
                        </div>

                        {/*
                          Suggested tags, not imposed tags. The model that just wrote
                          the poll is best placed to say what it is about, but the
                          owner gets the final word before anything is saved. Stored
                          as a flat lowercase kebab-case array under `tags`.
                        */}
                        <div className="form-group">
                          <label htmlFor={`pab-${currentPollIndex}-tags`}>
                            Tags <span className="pab-dim">— suggested; edit freely, comma separated</span>
                          </label>
                          <input
                            id={`pab-${currentPollIndex}-tags`}
                            type="text"
                            className="form-input"
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
                        </div>
                      </div>

                      {/* What would stop it importing, in the importer's words. */}
                      {pollItemProblem(currentPoll) && (
                        <p className="pab-note" role="status">
                          Can&rsquo;t be loaded yet: {pollItemProblem(currentPoll)}. Fix it here, or leave it out.
                        </p>
                      )}
                    </div>
                  )}

                  <div className="poll-actions">
                    <button className="btn-secondary" onClick={() => { setTagDraft(null); setRefusedKind(null); setEditingItem(false); }}>
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

export default PollAIBuilder;
