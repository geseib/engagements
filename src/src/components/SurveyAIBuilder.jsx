import React, { useState, useEffect, useCallback, useRef } from 'react';
import FileUploadPrompt from './FileUploadPrompt';
import { startGenerationJob, pollGenerationJob } from '../utils/aiBatchClient';
import Icon from './Icon';
import CountField from './CountField';
import GenerationJobPanel from './GenerationJobPanel';
import GeneratedItemsTable from './GeneratedItemsTable';
import StatusMessage from './StatusMessage';
import {
  interpretGenerationJob,
  rememberGenerationJob,
  recallGenerationJob,
  forgetGenerationJob,
  resumeIsGone,
} from '../utils/generationJob';
import {
  SURVEY_KINDS,
  surveyKindMeta,
  kindLabel,
  previewLine,
  convertKind,
  estimateMinutes,
} from '../config/surveyKinds';
import {
  SURVEY_SIZES,
  DEFAULT_SURVEY_COUNT,
  DEFAULT_SURVEY_KINDS,
  MAX_SURVEY_QUESTIONS,
  clampQuestionCount,
  plannedMinutes,
  draftSurveyTitle,
  draftSurveyDescription,
  surveyItemsToCsv,
  surveyItemProblem,
  kindMix,
} from '../utils/surveyDraft';
import './SurveyAIBuilder.css';

const API_BASE = window.API_BASE;
const ENDPOINT = `${API_BASE}admin/ai-generate-survey`;

const EMPTY_FORM = { source: '', goal: '', title: '', customPrompt: '' };

const minutesWord = (n) => `${n} minute${n === 1 ? '' : 's'}`;

/** "a, b and c" — what a kind switch would lose, as a sentence. */
function listed(items) {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

/**
 * GENERATE A SURVEY — docs/design/survey-redesign/02-generate.html (the form)
 * and 03-review.html (the review).
 *
 * WHAT CHANGED, AND THE TWO PHASE 0 FIXES IT CARRIES:
 *
 *   1. THE KINDS. Three "Include question types" checkboxes, two of which never
 *      did anything: the key was built as `include` + `Multiple_choice` minus
 *      its underscore — `includeMultiplechoice` — against state named
 *      `includeMultipleChoice`, so the box read undefined and wrote a key no
 *      one read (`text_entry` the same). Now five toggles, one per contract
 *      kind, sent as `kinds` (Track A, A5). At least one stays on.
 *   2. THE EXIT. The only way out used to be "Export JSON and close", because
 *      no survey write path existed. The worker now creates a DRAFT survey set
 *      (A5's `setCreation`), so this builder hands over exactly as the trivia
 *      and poll builders do: `{ createdSet }` when the worker made it, and
 *      `{ questions, metadata }` — the manual fallback — when it could not.
 *
 * THE MATERIAL IS THE INPUT. An attached document used to be appended to
 * "Additional Requirements". What the questions are ABOUT (the outline, the
 * deck) and what they are FOR (one sentence) do different jobs in the prompt,
 * so each has its own field and travels as `source` and `goal`; the rules
 * Workie must obey are folded behind a <details>.
 *
 * DERIVED ON WHITE, like the rest of the builder. The mockups draw this on the
 * console's dusk field; the builder modal is `.modal-content { background:
 * white }` (BuilderPage.css), and GenerationJobPanel.css and
 * GeneratedItemsTable.css already re-derive their mockups on white for the same
 * reason. SurveyAIBuilder.css carries the measured palette.
 *
 * NOT HERE, DELIBERATELY: the old one-question-at-a-time editor. It edited the
 * retired item shape (`question`, `type`, a `scale` object) and the contract's
 * fields are the set editor's job — mockup 03's Edit "opens the same question
 * form the editor uses, so there is one form, not two". A generated survey is
 * reviewed here (leave out, change kind) and edited in the set.
 */
function SurveyAIBuilder({ onClose, onSurveyGenerated }) {
  const [step, setStep] = useState(1);
  const [form, setForm] = useState(EMPTY_FORM);
  const [kinds, setKinds] = useState(DEFAULT_SURVEY_KINDS);
  // How many to ask for, 1..20. CountField hands back only clamped integers.
  const [count, setCount] = useState(DEFAULT_SURVEY_COUNT);

  // The generated questions, as the operator has changed them (kinds switched).
  const [items, setItems] = useState([]);
  // The kind each question was drafted as, by index, once it has been switched
  // — mockup 03's "· was Multiple choice".
  const [draftedKinds, setDraftedKinds] = useState([]);
  // The last poll response, in the shape jobToResponse() actually sends. Every
  // render branch reads interpretGenerationJob(job).outcome, never whether
  // `items` has anything in it — which it does for a FAILED job with partials.
  const [job, setJob] = useState(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [transportError, setTransportError] = useState(null);
  const [generationStatus, setGenerationStatus] = useState('');
  const [excluded, setExcluded] = useState(() => new Set());
  const [reviewingPartial, setReviewingPartial] = useState(false);

  const jobIdRef = useRef(null);
  // The set copy the job was started with. On the resume path the form is
  // empty, so the fallback save names the set from what was remembered.
  const setCopyRef = useRef(null);

  const plannedTitle = draftSurveyTitle(form);

  const buildSetMetadata = () => {
    if (setCopyRef.current) return setCopyRef.current;
    return { title: draftSurveyTitle(form), description: draftSurveyDescription(form) };
  };

  /** See TriviaAIBuilder.watchJob — same contract, same reasons. */
  const watchJob = useCallback(async (jobId) => {
    jobIdRef.current = jobId;
    setIsGenerating(true);
    setTransportError(null);
    setStep(2);
    try {
      const terminal = await pollGenerationJob(ENDPOINT, jobId, {
        label: 'Survey generation',
        onStatus: setGenerationStatus,
        onProgress: (update) => {
          setJob(update);
          if (Array.isArray(update.items) && update.items.length > 0) {
            setItems(update.items);
          }
        }
      });
      setJob(terminal);
      setItems(Array.isArray(terminal.items) ? terminal.items : []);
      setDraftedKinds([]);
    } catch (error) {
      console.error('AI survey generation error:', error);
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
    if (stored.title) {
      setCopyRef.current = { title: stored.title, description: stored.description || '' };
    }
    setGenerationStatus('Reconnecting to the job you left…');
    watchJob(stored.jobId);
  }, [watchJob]);

  const handleConfigSubmit = async () => {
    const title = draftSurveyTitle(form);
    const description = draftSurveyDescription(form);
    setCopyRef.current = { title, description };

    setIsGenerating(true);
    setGenerationStatus('Starting generation...');
    setTransportError(null);
    setJob(null);
    setItems([]);
    setDraftedKinds([]);
    setExcluded(new Set());
    setReviewingPartial(false);
    setStep(2);

    try {
      const { jobId } = await startGenerationJob(ENDPOINT, {
        source: form.source.trim(),
        goal: form.goal.trim(),
        kinds,
        questionCount: count,
        title,
        description,
        customPrompt: form.customPrompt.trim(),
        // THE SET'S OWN COPY, as the trivia and poll builders send it. The
        // worker creates the draft set itself (shared/generated-set.js) and
        // reads its name from `setMetadata.title` — with no title it creates
        // nothing and the operator lands on the manual path instead.
        setMetadata: { title, description },
      }, { label: 'Survey generation', onStatus: setGenerationStatus });

      rememberGenerationJob(ENDPOINT, jobId, { title, description });
      await watchJob(jobId);
    } catch (error) {
      console.error('AI survey generation error:', error);
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
    setItems([]);
    setDraftedKinds([]);
    setExcluded(new Set());
    setReviewingPartial(false);
    setStep(1);
  };

  const retryRemaining = (remaining) => {
    setCount(clampQuestionCount(remaining || count));
    backToConfiguration();
  };

  const toggleExcluded = (index) => {
    setExcluded(prev => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index); else next.add(index);
      return next;
    });
  };

  /** One kind toggle. The last one ticked stays ticked. */
  const toggleKind = (id) => setKinds((prev) => {
    if (prev.includes(id)) return prev.length === 1 ? prev : prev.filter((k) => k !== id);
    return SURVEY_KINDS.map((k) => k.id).filter((k) => k === id || prev.includes(k));
  });

  /**
   * The document's text is the material. FileUploadPrompt reports it twice
   * (on Process, and again on "Use this content"), so text already in the
   * field is not added again.
   */
  const addMaterial = (content) => {
    const extracted = String(content ?? '').trim();
    if (!extracted) return;
    setForm((prev) => {
      if (prev.source.includes(extracted)) return prev;
      return { ...prev, source: prev.source.trim() ? `${prev.source}\n\n${extracted}` : extracted };
    });
  };

  /**
   * Switch a question's kind — convertKind decides what survives, and a
   * switch that would throw something away is asked about first, naming it.
   * Choice ↔ Ranking keeps the list and asks nothing.
   */
  const changeKind = (index, toKind) => {
    const current = items[index];
    if (!current || current.kind === toKind) return;
    const { row, loses } = convertKind(current, toKind);
    if (loses.length > 0) {
      const ok = window.confirm(
        `Make question ${index + 1} ${surveyKindMeta(toKind).label}? It would lose ${listed(loses)}.`
      );
      if (!ok) return;
    }
    setItems((prev) => prev.map((item, i) => (i === index ? row : item)));
    setDraftedKinds((prev) => {
      const next = [...prev];
      if (next[index] === undefined) next[index] = current.kind;
      return next;
    });
  };

  const keptItems = items.filter((_, index) => !excluded.has(index));

  /** The kept questions as the contract CSV — rowsToCsv's survey branch. */
  const handleDownloadCsv = () => {
    const blob = new Blob([surveyItemsToCsv(keptItems)], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `survey-${buildSetMetadata().title.replace(/[^a-zA-Z0-9]/g, '_')}-${Date.now()}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);
  };

  /**
   * The worker already made the set. Take the operator to it and write
   * nothing — the no-double-creation rule TriviaAIBuilder.handleOpenCreatedSet
   * states.
   */
  const handleOpenCreatedSet = () => {
    dismissJob();
    onSurveyGenerated({ createdSet: interpreted.createdSet });
  };

  /** The manual fallback: the page makes the draft set from these. */
  const handleSaveDraft = () => {
    dismissJob();
    onSurveyGenerated({ questions: keptItems, metadata: buildSetMetadata() });
  };

  const interpreted = interpretGenerationJob(job);
  const created = interpreted.createdSet;
  const reviewing = step === 2 && !isGenerating && !transportError
    && (interpreted.outcome === 'complete'
      || (interpreted.outcome === 'partial' && reviewingPartial));

  /*
    EVERY WAY OUT IS THIS FUNCTION — the X, Cancel, Close and the backdrop.
    It asks only when something would be lost: typed material on the form, or
    a review the operator has changed and the worker has not already saved.
    Closing while the job runs asks nothing; the job keeps running and is
    remembered.
  */
  const formDirty = step === 1
    && Object.values(form).some((value) => String(value).trim() !== '');
  const reviewDirty = reviewing && !created
    && (excluded.size > 0 || draftedKinds.some((kind) => kind !== undefined));
  const requestClose = () => {
    if ((formDirty || reviewDirty)
      && !window.confirm('Close the survey generator? What you have typed or changed here will be lost.')) {
      return;
    }
    onClose();
  };

  const secondaryLine = (item) => {
    const drafted = draftedKinds[items.indexOf(item)];
    const was = drafted !== undefined && drafted !== item.kind
      ? ` · was ${surveyKindMeta(drafted).label}`
      : '';
    return `${previewLine(item)}${was}`;
  };

  const plannedTime = plannedMinutes(count, kinds);
  const keptTime = estimateMinutes(keptItems);
  const canWrite = !isGenerating && count >= 1
    && (form.source.trim() !== '' || form.goal.trim() !== '');

  return (
    <div className="survey-ai-builder-modal">
      <div className="modal-overlay" onClick={requestClose}></div>
      <div
        className={`modal-content survey-builder sab${step === 1 ? ' sab--form' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="sab-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <div className="sab-headtext">
            <h2 id="sab-title">
              {reviewing ? `Workie wrote ${items.length} question${items.length === 1 ? '' : 's'}` : 'Generate a survey'}
            </h2>
            {step === 1 && (
              <p className="sab-sub">The job runs on the server, so you can close this once it starts.</p>
            )}
          </div>
          <button
            type="button"
            className="close-button"
            onClick={requestClose}
            aria-label="Close the survey generator"
            title="Close"
          >
            <Icon name="X" weight="bold" size={16} color="currentColor" />
          </button>
        </div>

        <div className="modal-body">
          {step === 1 && (
            <div className="sab-form">
              {/* Only ever set on step 1 by the resume path, when the stored
                  job id has outlived the job record's three-day TTL. */}
              <StatusMessage message={generationStatus} tone="pending" />

              <div className="sab-field">
                <label className="sab-lab" htmlFor="sab-source">
                  What was the session? Paste the outline, or attach the deck
                </label>
                <textarea
                  id="sab-source"
                  className="sab-input sab-source"
                  rows="6"
                  value={form.source}
                  onChange={(e) => setForm((prev) => ({ ...prev, source: e.target.value }))}
                  placeholder="The agenda, the talk outline, or the notes — whatever says what the session covered."
                />
                <FileUploadPrompt
                  onContentExtracted={addMaterial}
                  acceptedFormats={['.txt', '.pdf', '.md', '.docx']}
                  label="Or attach the deck — text, PDF or Word, up to 5 MB"
                />
              </div>

              <div className="sab-field">
                <label className="sab-lab" htmlFor="sab-goal">What do you want to find out?</label>
                <input
                  id="sab-goal"
                  type="text"
                  className="sab-input"
                  value={form.goal}
                  onChange={(e) => setForm((prev) => ({ ...prev, goal: e.target.value }))}
                  placeholder="Whether the new format worked, and what people want next time"
                />
                <p className="sab-help">
                  One sentence. It decides what the questions are for; the material decides what they
                  are about.
                </p>
              </div>

              <div className="sab-field">
                <span className="sab-lab" id="sab-kinds-label">Kinds of question</span>
                <div className="sab-opts" role="group" aria-labelledby="sab-kinds-label">
                  {SURVEY_KINDS.map((kind) => {
                    const on = kinds.includes(kind.id);
                    return (
                      <button
                        key={kind.id}
                        type="button"
                        className="sab-opt"
                        aria-pressed={on}
                        onClick={() => toggleKind(kind.id)}
                        title={kind.blurb}
                      >
                        <Icon name={kind.icon} weight="bold" size={15} color="currentColor" />
                        {kind.label}
                        <span className="sab-tick" aria-hidden="true">✓</span>
                      </button>
                    );
                  })}
                </div>
                <p className="sab-help">
                  Workie uses only the ticked kinds and mixes them. Tick one for a single-kind survey.
                </p>
              </div>

              {/*
                HOW MANY, asked the way every builder asks it: the shared
                CountField ("the builders all ask the same way",
                countField.test.jsx). Mockup 02's Quick 5 / Standard 8 /
                Thorough 12 are its three presets and their words are the hint;
                the one fact the mockup adds — time to answer — sits under it.
              */}
              <div className="sab-field">
                <CountField
                  label="How many questions"
                  value={count}
                  onChange={setCount}
                  min={1}
                  max={MAX_SURVEY_QUESTIONS}
                  presets={SURVEY_SIZES.map((size) => size.count)}
                  hint={`${SURVEY_SIZES.map((size, i) => `${i === 0 ? size.label : size.label.toLowerCase()}${i === 0 ? ' is' : ''} ${size.count}`).join(', ')}. `
                    + `Past twelve, people stop reading; the cap is ${MAX_SURVEY_QUESTIONS}.`}
                />
                <p className="sab-per">about {minutesWord(plannedTime)} to answer</p>
              </div>

              <div className="sab-field">
                <label className="sab-lab" htmlFor="sab-name">Name it</label>
                <input
                  id="sab-name"
                  type="text"
                  className="sab-input"
                  value={form.title}
                  onChange={(e) => setForm((prev) => ({ ...prev, title: e.target.value }))}
                  placeholder={plannedTitle}
                />
                <p className="sab-help">
                  What the draft is called in your question sets. Left blank, it is called what the
                  box shows.
                </p>
              </div>

              <details className="sab-more">
                <summary>
                  <Icon name="CaretDown" weight="bold" size={14} color="currentColor" />
                  Anything else Workie must obey
                </summary>
                <textarea
                  className="sab-input"
                  rows="3"
                  aria-label="Anything else Workie must obey"
                  value={form.customPrompt}
                  onChange={(e) => setForm((prev) => ({ ...prev, customPrompt: e.target.value }))}
                  placeholder="Rules, not material: “no questions about pricing”, “keep it under a minute”…"
                />
              </details>
            </div>
          )}

          {step === 2 && (
            <div className="survey-generation">
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
              ) : (
                <div className="sab-review">
                  {/* Mockup 03's mix line: what kinds came back, and how long
                      the KEPT ones take to answer. */}
                  <p className="sab-mix">
                    <span className="sab-dim">Mix:</span>
                    {kindMix(items).map(({ kind, count: n }) => (
                      <React.Fragment key={kind}>
                        <span className="sab-kind">
                          <Icon name={surveyKindMeta(kind).icon} weight="bold" size={13} color="currentColor" />
                          {surveyKindMeta(kind).label}
                        </span>
                        <span className="sab-dim">×{n}</span>
                      </React.Fragment>
                    ))}
                    <span className="sab-dim sab-mix-end">
                      {keptItems.length} kept · about {minutesWord(keptTime)}
                    </span>
                  </p>
                  {/*
                    ONCE THE WORKER HAS MADE THE SET, THIS TABLE IS A RECEIPT —
                    the rule TriviaAIBuilder states. Leave out and the kind
                    select are withheld rather than left live and inert, and the
                    primary action opens the set instead of making one.
                  */}
                  <GeneratedItemsTable
                    items={items}
                    requested={interpreted.requested}
                    noun="questions"
                    excluded={excluded}
                    savedAs={created}
                    onToggleExclude={created ? undefined : toggleExcluded}
                    primary={(item) => item.title || item.question}
                    secondary={secondaryLine}
                    flag={surveyItemProblem}
                    kinds={{
                      options: SURVEY_KINDS,
                      of: (item) => item.kind,
                      label: kindLabel,
                      onChange: created ? undefined : changeKind,
                    }}
                    actions={(
                      <>
                        <button type="button" className="btn-secondary" onClick={handleDownloadCsv}>
                          <Icon name="FileText" weight="bold" size={16} color="currentColor" /> Download as CSV
                        </button>
                        {created ? (
                          <button type="button" className="btn-primary" onClick={handleOpenCreatedSet}>
                            <Icon name="ArrowRight" weight="bold" size={16} color="currentColor" />{' '}
                            Open &ldquo;{created.setName}&rdquo;
                          </button>
                        ) : (
                          <button
                            type="button"
                            className="btn-primary"
                            onClick={handleSaveDraft}
                            disabled={keptItems.length === 0}
                          >
                            Save {keptItems.length} as a draft survey
                          </button>
                        )}
                      </>
                    )}
                  />
                </div>
              )}
            </div>
          )}
        </div>

        <div className="modal-footer">
          {step === 1 && (
            <>
              <button type="button" className="btn-secondary" onClick={requestClose}>
                Cancel
              </button>
              <button
                type="button"
                className="btn-primary"
                onClick={handleConfigSubmit}
                disabled={!canWrite}
              >
                <Icon name="Sparkle" weight="duotone" size={16} color="currentColor" /> Write the survey
              </button>
            </>
          )}
          {reviewing && (
            <>
              <button type="button" className="btn-secondary" onClick={backToConfiguration}>
                <Icon name="ArrowLeft" weight="bold" size={16} color="currentColor" /> Back to the form
              </button>
              <button type="button" className="btn-secondary" onClick={requestClose}>
                Close
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export default SurveyAIBuilder;
