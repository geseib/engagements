import React, { useCallback, useEffect, useRef, useState } from 'react';
import Icon from './Icon';
import StatusMessage from './StatusMessage';
import PromptShapePreview from './PromptShapePreview';
import RoundKindPicker from './RoundKindPicker';
import { authFetch } from '../auth/authFetch';
import { GAME_TYPE_LIST, gameTypeLabel, normalizeGameType } from '../config/gameTypes';
import {
  editableSnapshot,
  buildEditPayload,
  summarizeEditResult,
  summarizeCsv,
  describeReplacePlan,
  selectableSummaryPrompts,
  normalizeVersions,
  nextVersionNumber,
  interpretVersionDelete,
  versionDeleteTone
} from '../utils/questionSetEditing';
import { roundKindApplies, roundKindGaps } from '../config/roundKinds';

const API_BASE = () => window.API_BASE;

/**
 * The whole question-set admin, extracted out of AdminPage.jsx.
 *
 * Before this, the editor exposed five fields and everything else chosen at
 * creation — the engagement type, the questions themselves, the images — was
 * unreachable. Fixing one bad row meant deleting the set and re-uploading it,
 * which lost the set id along with its prompt, persona and instructions.
 *
 * Four panels, in the order the owner works:
 *   1. Details    — every field settable at creation
 *   2. Questions  — download the current CSV, upload a replacement
 *   3. Versions   — list, promote, delete
 *   4. Media      — seam only; a separate change owns uploads
 *
 * The save payload is a DIFF (see utils/questionSetEditing). Do not "simplify"
 * it into sending the whole form: null used to mean "skip" in the lambda, which
 * made clearing any field a silent no-op.
 */
export default function QuestionSetEditor({
  questionSet,
  availablePrompts = [],
  availablePersonas = [],
  defaultInstructions = '',
  onSaved,
  onChanged,
  onCancel
}) {
  const setId = questionSet?.id || '';

  /* ------------------------------------------------------------- details -- */
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [instructions, setInstructions] = useState('');
  const [aiContext, setAiContext] = useState('');
  const [engagementType, setEngagementType] = useState('call-and-answer');
  const [promptId, setPromptId] = useState('');
  const [roundNoun, setRoundNoun] = useState('');
  // Per-set voice. '' means "adapt to the session", which is the default and
  // beats the prompt template's baked-in persona on purpose.
  const [personaId, setPersonaId] = useState('');
  // THE SET'S DIRECTION — what the room is asked to DO with each item, as
  // distinct from the topic it is about. '' means the set has never been asked,
  // which every reader treats as `produce`. Kept as '' rather than 'produce' so
  // the diffed save does not write a value nobody chose onto the ~41 sets that
  // predate the field. See config/roundKinds.js.
  const [roundKind, setRoundKind] = useState('');
  const [roundKindBrief, setRoundKindBrief] = useState('');
  // Snapshot of the set as it was when the editor opened; the save payload is a
  // diff against this.
  const [original, setOriginal] = useState({});
  const [saveStatus, setSaveStatus] = useState('');
  // Success/failure is explicit state. It used to be inferred by sniffing the
  // status string for a checkmark, which silently broke when the copy changed.
  const [saveOk, setSaveOk] = useState(null); // true | false | null (in progress)

  /* ------------------------------------------------------------ versions -- */
  const [versions, setVersions] = useState([]);
  const [versionStatus, setVersionStatus] = useState({ text: '', tone: '' });
  const [busyVersion, setBusyVersion] = useState(null);
  // A delete the server answered with a warning instead of a deletion: the games
  // still playing this version, held until the owner says go ahead.
  const [pendingDelete, setPendingDelete] = useState(null);

  /* ------------------------------------------------------------- replace -- */
  const [replaceFile, setReplaceFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [replaceStatus, setReplaceStatus] = useState({ text: '', tone: '' });
  const [isReplacing, setIsReplacing] = useState(false);
  const replaceInputRef = useRef(null);

  const activeVersion = questionSet?.activeVersion;

  // Prompts worth offering for THIS set. Keyed off the live engagementType
  // rather than the saved one, so switching the type re-filters immediately —
  // otherwise you pick "Trivia", save, reopen, and only then see trivia prompts.
  const summaryPromptChoices = selectableSummaryPrompts(availablePrompts, engagementType);
  const hiddenPromptCount = availablePrompts.length - summaryPromptChoices.length;


  const loadVersions = useCallback(async () => {
    if (!setId) return;
    try {
      const response = await authFetch(`${API_BASE()}admin/question-sets/${setId}/versions`);
      if (!response.ok) {
        // A set that predates versioning has no version history and no endpoint
        // answer for it. That is not an error worth shouting about — the panel
        // just says so.
        setVersions([]);
        return;
      }
      const json = await response.json();
      setVersions(normalizeVersions(json, activeVersion));
    } catch (error) {
      console.error('Version list error:', error);
      setVersions([]);
    }
  }, [setId, activeVersion]);

  // Reload the form whenever a different set is opened.
  useEffect(() => {
    const snapshot = editableSnapshot(questionSet || {});
    setTitle(questionSet?.name || '');
    setDescription(snapshot.description);
    setInstructions(snapshot.customInstruction);
    setAiContext(snapshot.aiContextInstruction);
    setEngagementType(snapshot.engagementType);
    setPromptId(snapshot.promptId);
    setRoundNoun(snapshot.roundNoun);
    setPersonaId(snapshot.personaId);
    setRoundKind(snapshot.roundKind);
    setRoundKindBrief(snapshot.roundKindBrief);
    setOriginal(snapshot);
    setSaveStatus('');
    setSaveOk(null);
    setReplaceFile(null);
    setPreview(null);
    setReplaceStatus({ text: '', tone: '' });
    setVersionStatus({ text: '', tone: '' });
    setPendingDelete(null);
    if (replaceInputRef.current) replaceInputRef.current.value = '';
    loadVersions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setId]);

  /** Display name for a stored personaId, or a warning when it resolves to nothing. */
  const personaLabel = (id) => {
    const match = availablePersonas.find((p) => p.personaId === id);
    return match ? match.name : `${id} (unknown — Workie will adapt instead)`;
  };

  /* --------------------------------------------------------------- save --- */

  const handleSave = async () => {
    if (!title.trim()) {
      setSaveOk(false);
      setSaveStatus('Title is required');
      return;
    }

    const current = {
      description: description.trim(),
      customInstruction: instructions.trim(),
      aiContextInstruction: aiContext.trim(),
      promptId: promptId.trim(),
      engagementType: normalizeGameType(engagementType),
      roundNoun: roundNoun.trim(),
      personaId: personaId.trim(),
      roundKind: roundKind.trim(),
      // Only meaningful for `custom`; cleared when the kind moves off it, so a
      // set cannot keep steering the generator with a brief for a direction it
      // no longer has.
      roundKindBrief: roundKind === 'custom' ? roundKindBrief.trim() : ''
    };

    // Only send what actually changed. An omitted key means "leave it alone";
    // an empty string means "clear it". The backend guards on `!== undefined`,
    // so both intentions survive the round trip — which they did not when every
    // blank field was flattened to null and then skipped.
    const payload = buildEditPayload(title, current, original);
    const savedName = payload.name;
    const { name, ...changed } = payload;

    setSaveOk(null);
    setSaveStatus('Saving...');
    try {
      const response = await authFetch(`${API_BASE()}admin/edit-question-set/${setId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      const result = await response.json();

      if (response.ok) {
        // Report what the backend says it wrote, not what we hoped it wrote.
        setSaveOk(true);
        setSaveStatus(summarizeEditResult(savedName, result.updated || changed));
        if (onSaved) onSaved(summarizeEditResult(savedName, result.updated || changed));
      } else {
        setSaveOk(false);
        setSaveStatus(`Save failed: ${result.error || 'Unknown error'}`);
      }
    } catch (error) {
      console.error('Edit save error:', error);
      setSaveOk(false);
      setSaveStatus(`Save failed: ${error.message}`);
    }
  };

  /* ----------------------------------------------------------- download --- */

  const saveBlob = (content, filename, mimeType) => {
    const blob = new Blob([content], { type: mimeType });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);
  };

  const handleDownload = async () => {
    setReplaceStatus({ text: 'Downloading question set...', tone: 'pending' });
    try {
      const response = await authFetch(`${API_BASE()}admin/download-question-set/${setId}`);
      const text = await response.text();

      if (!response.ok) {
        let error = `HTTP ${response.status}`;
        try { error = JSON.parse(text).error || error; } catch (_) { /* not JSON */ }
        setReplaceStatus({ text: `Download failed: ${error}`, tone: 'error' });
        return;
      }

      // download-question-set.js answers { filename, content, contentType } the
      // same way download-template does. Tolerate a raw CSV body too, so a route
      // that later starts streaming the file does not break this button.
      let filename = `${(questionSet?.name || setId).replace(/[^a-zA-Z0-9-_]/g, '_')}.csv`;
      let content = text;
      let contentType = 'text/csv';
      try {
        const parsed = JSON.parse(text);
        if (parsed && typeof parsed.content === 'string') {
          content = parsed.content;
          filename = parsed.filename || filename;
          contentType = parsed.contentType || contentType;
        }
      } catch (_) { /* raw CSV body */ }

      saveBlob(content, filename, contentType);
      setReplaceStatus({ text: `${filename} downloaded`, tone: 'success' });
    } catch (error) {
      console.error('Download question set error:', error);
      setReplaceStatus({ text: `Download failed: ${error.message}`, tone: 'error' });
    }
  };

  /* ------------------------------------------------------------- upload --- */

  const handleReplaceFileSelect = (event) => {
    const file = event.target.files && event.target.files[0];
    setPreview(null);
    setReplaceFile(null);
    if (!file) return;

    if (!/\.csv$/i.test(file.name)) {
      setReplaceStatus({ text: 'Please select a CSV file', tone: 'error' });
      return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
      const summary = summarizeCsv(e.target.result);
      if (summary.error) {
        setReplaceStatus({ text: summary.error, tone: 'error' });
        return;
      }
      setReplaceFile(file);
      setPreview({ ...summary, content: e.target.result, fileName: file.name });
      setReplaceStatus({
        text: summary.warning || `Read ${file.name}. Review the change below, then confirm.`,
        tone: summary.warning ? 'pending' : 'success'
      });
    };
    reader.onerror = () => setReplaceStatus({ text: `Could not read ${file.name}`, tone: 'error' });
    reader.readAsText(file);
  };

  const handleReplace = async () => {
    if (!preview || !replaceFile) return;
    setIsReplacing(true);
    setReplaceStatus({ text: 'Uploading new version...', tone: 'pending' });
    try {
      // replaceSetId is what turns this from "create a set" into "write a new
      // version of this set". Title and description are deliberately NOT sent:
      // they belong to the details form above, and a CSV must never silently
      // rename the set it replaces.
      const response = await authFetch(`${API_BASE()}admin/upload-questions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          replaceSetId: setId,
          fileName: replaceFile.name,
          fileContent: preview.content,
          engagementType: normalizeGameType(engagementType)
        })
      });

      const result = await response.json();

      if (response.ok) {
        const version = result.version != null ? `Version ${result.version}` : 'A new version';
        const count = result.questionCount != null ? ` with ${result.questionCount} questions` : '';
        // The importer reports rows it could not use. Say so — an import that
        // quietly drops half a file otherwise looks like a clean success.
        const skipped = Number(result.skippedRowCount || 0);
        setReplaceStatus({
          text: `${version} of "${questionSet?.name || setId}" is now live${count}. `
            + (skipped
              ? `${skipped} row${skipped === 1 ? '' : 's'} in the file could not be read and ${skipped === 1 ? 'was' : 'were'} skipped. `
              : '')
            + 'The previous version is still listed below and can be promoted back.',
          tone: 'success'
        });
        setReplaceFile(null);
        setPreview(null);
        if (replaceInputRef.current) replaceInputRef.current.value = '';
        await loadVersions();
        if (onChanged) onChanged();
      } else {
        // Nothing was written: the lambda validates the whole file before it
        // touches a single row, and the flip to the new version is one write.
        setReplaceStatus({
          text: `Upload failed: ${result.error || 'Unknown error'} — nothing changed, the current version is still live.`,
          tone: 'error'
        });
      }
    } catch (error) {
      console.error('Replace question set error:', error);
      setReplaceStatus({ text: `Upload failed: ${error.message}`, tone: 'error' });
    } finally {
      setIsReplacing(false);
    }
  };

  /* ----------------------------------------------------------- versions --- */

  const handlePromote = async (version) => {
    setBusyVersion(version);
    setVersionStatus({ text: `Promoting version ${version}...`, tone: 'pending' });
    try {
      const response = await authFetch(
        `${API_BASE()}admin/question-sets/${setId}/versions/${version}/promote`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' } }
      );
      const result = await response.json().catch(() => ({}));
      if (response.ok) {
        setVersionStatus({
          text: `Version ${version} is now the active version. `
            + 'Engagements already in play keep the version they started with.',
          tone: 'success'
        });
        await loadVersions();
        if (onChanged) onChanged();
      } else {
        setVersionStatus({ text: `Promote failed: ${result.error || 'Unknown error'}`, tone: 'error' });
      }
    } catch (error) {
      console.error('Promote version error:', error);
      setVersionStatus({ text: `Promote failed: ${error.message}`, tone: 'error' });
    } finally {
      setBusyVersion(null);
    }
  };

  /**
   * Delete a version.
   *
   * `confirmed` re-sends the same delete after the owner has seen which live
   * engagements are pinned to it. The first call is what discovers them — the
   * server answers 200 with a warning and the game ids INSTEAD of deleting.
   */
  const deleteVersion = async (version, confirmed = false) => {
    setBusyVersion(version);
    setVersionStatus({ text: `Deleting version ${version}...`, tone: 'pending' });
    try {
      const url = `${API_BASE()}admin/question-sets/${setId}/versions/${version}`
        + (confirmed ? '?confirm=true' : '');
      const response = await authFetch(url, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' }
      });
      const result = await response.json().catch(() => ({}));
      const verdict = interpretVersionDelete(version, response.status, result);

      if (verdict.outcome === 'confirm' && !confirmed) {
        setPendingDelete({ version, ...verdict });
        setVersionStatus({ text: verdict.message, tone: versionDeleteTone(verdict.outcome) });
        return;
      }

      setPendingDelete(null);
      setVersionStatus({
        text: verdict.message,
        tone: versionDeleteTone(verdict.outcome === 'confirm' ? 'deleted' : verdict.outcome)
      });

      if (verdict.outcome === 'deleted' || confirmed) {
        await loadVersions();
        if (onChanged) onChanged();
      }
    } catch (error) {
      console.error('Delete version error:', error);
      setPendingDelete(null);
      setVersionStatus({ text: `Delete failed: ${error.message}`, tone: 'error' });
    } finally {
      setBusyVersion(null);
    }
  };

  const currentSet = questionSet || {};
  const plannedVersion = nextVersionNumber(versions, activeVersion);

  return (
    <div className="admin-section edit-section qs-editor">
      <h2>
        <Icon name="PencilSimple" weight="bold" size={16} color="currentColor" />{' '}
        Edit Question Set
      </h2>
      <p className="section-description">
        {currentSet.name || setId} · {gameTypeLabel(currentSet.engagementType)} ·{' '}
        {currentSet.totalQuestions || 0} questions in {currentSet.categoryCount || 0} categories
        {activeVersion != null && <> · active version {activeVersion}</>}
      </p>

      {/* AI-Generated Content Warning */}
      {currentSet.isAIGenerated && (
        <div className="ai-review-banner">
          <div className="ai-review-content">
            <span className="ai-review-icon">
              <Icon name="Sparkle" weight="duotone" size={16} color="var(--primary)" />
            </span>
            <div className="ai-review-text">
              <strong>AI-Generated Content - Review Required</strong>
              <p>
                This question set was created by AI and is currently inactive. Please review and
                edit the content, then activate it when ready.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* ================================================== 1. DETAILS === */}
      <section className="qs-panel">
        <div className="qs-panel-header">
          <h3><Icon name="ClipboardText" weight="bold" size={16} color="currentColor" /> Details</h3>
          <span className="qs-panel-note">Everything that could be set when this set was created</span>
        </div>

        <div className="edit-form">
          <div className="form-group">
            <label htmlFor="edit-title">Title *</label>
            <input
              id="edit-title"
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Question set title"
              className="form-input"
            />
          </div>

          <div className="form-group">
            <label htmlFor="edit-description">Description</label>
            <textarea
              id="edit-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Brief description of this question set"
              className="form-textarea"
              rows="3"
            />
          </div>

          {/*
            Engagement type was loaded into state but never rendered and never
            sent, so a set imported with the wrong type could only be fixed by
            deleting and re-importing it. It drives phases, default prompt and
            round label, so it has to be editable.
          */}
          <div className="form-group">
            <label htmlFor="edit-engagement-type">Engagement Type</label>
            <select
              id="edit-engagement-type"
              value={engagementType}
              onChange={(e) => setEngagementType(e.target.value)}
              className="form-select"
            >
              {GAME_TYPE_LIST.map((type) => (
                <option key={type.id} value={type.id}>{type.label}</option>
              ))}
            </select>
            <small className="help-text">
              Controls which phases the session runs and which default AI prompt applies.
              Changing it does not rewrite the questions themselves.
            </small>
          </div>

          {/*
            THE SET'S DIRECTION, editable here because it is the only place a
            set that already exists can acquire one. The builder sets it at
            generation time; the ~41 sets that predate this field, and every set
            imported from a CSV, would otherwise be stuck reading as Produce
            with no way to say otherwise. It steers the generator and it is what
            the participant instruction should agree with.
          */}
          {roundKindApplies(engagementType) && (
            <div className="form-group">
              <label id="edit-round-kind-label">Round Direction</label>
              <RoundKindPicker
                headingId="edit-round-kind-label"
                idPrefix="edit-round-kind"
                value={roundKind}
                onChange={setRoundKind}
                brief={roundKindBrief}
                onBriefChange={setRoundKindBrief}
              />
              <small className="help-text">
                What the room is asked to DO with each item — not what the set is about.
                It steers AI generation for this set. Leave it on Produce for a set that
                hands people a prompt and nothing else.
                {roundKindGaps(roundKind, { brief: roundKindBrief, instruction: 'n/a' }).length > 0
                  && ' Saving without a description leaves the generator no direction to follow.'}
              </small>
            </div>
          )}

          <div className="form-group">
            <label htmlFor="edit-round-noun">Round Label</label>
            <input
              id="edit-round-noun"
              type="text"
              value={roundNoun}
              onChange={(e) => setRoundNoun(e.target.value)}
              placeholder="Leave blank for the default (Round, Question, Artwork…)"
              className="form-input"
            />
            <small className="help-text">
              What one item in this set is called on screen — "Lesson 3", "Scenario 3".
              Blank uses the default for the engagement type.
            </small>
          </div>

          <div className="form-group">
            <label htmlFor="edit-instructions">Custom Instructions</label>
            <textarea
              id="edit-instructions"
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
              placeholder={`Custom instruction for players (optional). Default: "${defaultInstructions}"`}
              className="form-textarea"
              rows="4"
            />
            <small className="help-text">
              This instruction will be shown to players and used by AI for analysis.
              Leave blank to use default instructions.
            </small>
          </div>

          <div className="form-group">
            <label htmlFor="edit-ai-context-instructions">AI Context Instructions</label>
            <textarea
              id="edit-ai-context-instructions"
              value={aiContext}
              onChange={(e) => setAiContext(e.target.value)}
              placeholder="Provide background context about your project, team, or meeting for AI analysis..."
              className="form-textarea"
              rows="4"
            />
            <small className="help-text">
              This context helps AI provide more relevant analysis based on your specific project,
              industry, or goals. Leave blank for general analysis.
            </small>
          </div>

          <div className="form-group">
            <label htmlFor="edit-prompt-id">AI Summary Prompt</label>
            <select
              id="edit-prompt-id"
              value={promptId}
              onChange={(e) => setPromptId(e.target.value)}
              className="form-select"
            >
              <option value="">Use default prompt for game type</option>
              {summaryPromptChoices.map((prompt) => (
                <option key={prompt.promptId} value={prompt.promptId}>
                  {prompt.name}
                  {prompt.category ? ` (${prompt.category})` : ''}
                  {prompt.summaryPromptStatus === 'unusable' ? ' — not a summary prompt' : ''}
                </option>
              ))}
            </select>
            <small className="help-text">
              Prompts for <strong>{gameTypeLabel(engagementType)}</strong> sets only.
              Leave blank to use the default for this game type.
              {hiddenPromptCount > 0 && ` ${hiddenPromptCount} prompt${
                hiddenPromptCount === 1 ? '' : 's'
              } for other game types are hidden.`}
            </small>
            <PromptShapePreview promptId={promptId} prompts={summaryPromptChoices} />
          </div>

          <div className="form-group">
            <label htmlFor="edit-persona-id">Workie's Voice</label>
            <select
              id="edit-persona-id"
              value={personaId}
              onChange={(e) => setPersonaId(e.target.value)}
              className="form-select"
            >
              {/* Adapting is the designed default, not a fallback. A host who
                  picks a voice at creation still overrides this. */}
              <option value="">Adapt to the session (recommended)</option>
              {availablePersonas.map((persona) => (
                <option key={persona.personaId} value={persona.personaId}>
                  {persona.name}{persona.tagline ? ` — ${persona.tagline}` : ''}
                </option>
              ))}
            </select>
            <small className="help-text">
              The voice Workie uses for summaries of this set. A host's pick at engagement
              creation takes precedence over this. Leave blank and Workie reads the room.
              {personaId && <> Currently: {personaLabel(personaId)}.</>}
            </small>
          </div>

          {/*
            Categories are derived from the CSV, not stored as an editable list —
            there is no per-set category endpoint and inventing one here would
            let the set metadata drift from the questions. Editing them means
            replacing the CSV, so say that instead of pretending otherwise.
          */}
          <div className="form-group">
            <label>Categories</label>
            <div className="qs-readonly-field">
              <span className="stat-badge">{currentSet.categoryCount || 0} categories</span>
              <span className="stat-badge">{currentSet.totalQuestions || 0} questions</span>
            </div>
            <small className="help-text">
              Categories come from the Category column of the set's CSV. To add, rename or remove
              one, download the CSV below, edit it, and upload it as a new version.
            </small>
          </div>

          <div className="form-actions">
            <button
              className="btn-primary"
              onClick={handleSave}
              disabled={saveStatus === 'Saving...'}
            >
              <Icon name="FloppyDisk" weight="bold" size={16} color="currentColor" />{' '}
              {saveStatus === 'Saving...' ? 'Saving...' : 'Save Changes'}
            </button>
            <button className="btn-secondary" onClick={onCancel}>
              Cancel
            </button>
          </div>

          {saveStatus && (
            <StatusMessage
              message={saveStatus}
              tone={saveOk === true ? 'success' : saveOk === false ? 'error' : 'pending'}
            />
          )}
        </div>
      </section>

      {/* ================================================ 2. QUESTIONS === */}
      <section className="qs-panel">
        <div className="qs-panel-header">
          <h3><Icon name="Books" weight="bold" size={16} color="currentColor" /> Questions</h3>
          <span className="qs-panel-note">Download the current CSV, edit it, upload it back</span>
        </div>

        <div className="qs-panel-actions">
          <button className="btn-secondary" onClick={handleDownload}>
            <Icon name="DownloadSimple" weight="bold" size={16} color="currentColor" />{' '}
            Download CSV
          </button>

          <div className="file-input-wrapper qs-replace-input">
            <input
              type="file"
              id="replace-questions-file"
              accept=".csv"
              ref={replaceInputRef}
              onChange={handleReplaceFileSelect}
              className="file-input"
            />
            <label htmlFor="replace-questions-file" className="file-input-label">
              {replaceFile ? replaceFile.name : 'Choose a replacement CSV...'}
            </label>
          </div>
        </div>

        {preview && (
          <div className="qs-replace-preview">
            <h4>
              <Icon name="Info" weight="bold" size={16} color="var(--primary)" />{' '}
              Before you replace
            </h4>
            <ul className="qs-preview-lines">
              {describeReplacePlan(currentSet, preview, plannedVersion).map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
            {preview.categories && preview.categories.length > 0 && (
              <p className="qs-preview-categories">
                <strong>Categories in the new file:</strong> {preview.categories.join(', ')}
              </p>
            )}
            <div className="qs-panel-actions">
              <button className="btn-primary" onClick={handleReplace} disabled={isReplacing}>
                <Icon name="UploadSimple" weight="bold" size={16} color="currentColor" />{' '}
                {isReplacing
                  ? 'Uploading...'
                  : `Replace questions with ${preview.fileName}`}
              </button>
              <button
                className="btn-secondary"
                onClick={() => {
                  setPreview(null);
                  setReplaceFile(null);
                  if (replaceInputRef.current) replaceInputRef.current.value = '';
                  setReplaceStatus({ text: '', tone: '' });
                }}
                disabled={isReplacing}
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {replaceStatus.text && (
          <StatusMessage message={replaceStatus.text} tone={replaceStatus.tone} />
        )}
      </section>

      {/* ================================================= 3. VERSIONS === */}
      <section className="qs-panel">
        <div className="qs-panel-header">
          <h3>
            <Icon name="ArrowCounterClockwise" weight="bold" size={16} color="currentColor" />{' '}
            Versions
          </h3>
          <span className="qs-panel-note">
            Every replace keeps the version it replaced, so a bad CSV is one promote away from undone
          </span>
        </div>

        {versions.length === 0 ? (
          <p className="qs-empty">
            No version history for this set yet. The next CSV upload creates one.
          </p>
        ) : (
          <ul className="qs-version-list">
            {versions.map((v) => (
              <li
                key={v.version}
                className={`qs-version-row${v.isActive ? ' active' : ''}`}
                data-testid={`version-${v.version}`}
              >
                <div className="qs-version-id">
                  <strong>Version {v.version}</strong>
                  {v.isActive && (
                    <span className="qs-version-active-badge">
                      <Icon name="CheckCircle" weight="fill" size={14} color="var(--success)" />{' '}
                      Active
                    </span>
                  )}
                  {v.pinnedByGames.length > 0 && (
                    <span className="qs-version-pinned-badge" title={v.pinnedByGames.join(', ')}>
                      <Icon name="PushPin" weight="fill" size={14} color="var(--primary)" />{' '}
                      {v.pinnedByGames.length} in play
                    </span>
                  )}
                </div>
                <div className="qs-version-meta">
                  <span>{v.questionCount} questions</span>
                  <span>{v.categoryCount} categories</span>
                  {v.sourceFile && <span>{v.sourceFile}</span>}
                  {v.createdAt && <span>{new Date(v.createdAt).toLocaleString()}</span>}
                </div>
                <div className="qs-version-actions">
                  <button
                    className="btn-secondary btn-small"
                    onClick={() => handlePromote(v.version)}
                    disabled={v.isActive || busyVersion === v.version}
                    title={v.isActive ? 'Already the active version' : `Make version ${v.version} active`}
                  >
                    <Icon name="ArrowCounterClockwise" weight="bold" size={14} color="currentColor" />{' '}
                    Promote
                  </button>
                  <button
                    className="btn-danger btn-small"
                    onClick={() => deleteVersion(v.version)}
                    disabled={busyVersion === v.version}
                    title={
                      v.isActive
                        ? 'The active version cannot be deleted — promote another one first'
                        : `Delete version ${v.version}`
                    }
                  >
                    <Icon name="Trash" weight="bold" size={14} color="currentColor" /> Delete
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}

        {versionStatus.text && (
          <StatusMessage message={versionStatus.text} tone={versionStatus.tone} />
        )}
      </section>

      {/* ==================================================== 4. MEDIA === */}
      {/*
        SEAM — media panel. Owned by a separate change; do not build it here.
        Contract that lands with it:
          GET    /admin/question-sets/{setId}/media        -> { images: [{ key, url, size }] }
          POST   /admin/question-sets/{setId}/media        -> { uploadUrl, key }  (presigned PUT)
          DELETE /admin/question-sets/{setId}/media/{key}  -> { deleted: true }
        Images live flat at s3://<env>-media/sets/<setId>/<filename> — per SET,
        not per version, because versions share artwork. The browser PUTs
        straight to S3: API Gateway caps payloads at 10 MB and base64 inflates
        by a third, so artwork cannot go through the lambda.
        Render the thumbnails here, inside this section, keeping .qs-panel.
      */}
      <section className="qs-panel qs-media-seam" data-testid="media-seam">
        <div className="qs-panel-header">
          <h3><Icon name="Image" weight="bold" size={16} color="currentColor" /> Media</h3>
          <span className="qs-panel-note">Artwork and images used by this set's questions</span>
        </div>
        <p className="qs-empty">
          Image management is not wired up yet. Until it is, images come from the Image
          column of the set's CSV.
        </p>
      </section>

      {/* Pinned-game delete confirmation. The ids matter: "some games are using
          this" is not enough information to decide with. */}
      {pendingDelete && (
        <div className="modal-overlay" onClick={() => setPendingDelete(null)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <h3>
              <Icon name="Warning" weight="fill" size={16} color="var(--primary)" />{' '}
              Version {pendingDelete.version} is in play
            </h3>
            <p>{pendingDelete.message}</p>
            {pendingDelete.pinnedByGames.length > 0 && (
              <ul className="qs-pinned-games">
                {pendingDelete.pinnedByGames.map((gameId) => (
                  <li key={gameId}>{gameId}</li>
                ))}
              </ul>
            )}
            <p>
              Those engagements read their questions from version {pendingDelete.version} while
              they run. Deleting it now will break them mid-session.
            </p>
            <div className="modal-actions">
              <button className="btn-secondary" onClick={() => setPendingDelete(null)}>
                Keep version {pendingDelete.version}
              </button>
              <button
                className="btn-danger"
                onClick={() => deleteVersion(pendingDelete.version, true)}
              >
                Delete it anyway
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
