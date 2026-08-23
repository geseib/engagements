import React, { useCallback, useEffect, useState } from 'react';
import Icon from './Icon';
import Modal from './Modal';
import StatusMessage from './StatusMessage';
import PromptShapePreview from './PromptShapePreview';
import RoundKindPicker from './RoundKindPicker';
import QuestionsPanel from './QuestionsPanel';
import SetMediaPanel from './SetMediaPanel';
import { authFetch } from '../auth/authFetch';
import { GAME_TYPE_LIST, gameTypeLabel, normalizeGameType } from '../config/gameTypes';
import {
  editableSnapshot,
  EDITABLE_SET_FIELDS,
  buildEditPayload,
  summarizeEditResult,
  selectableSummaryPrompts,
  normalizeVersions,
  nextVersionNumber,
  interpretVersionDelete,
  versionDeleteTone
} from '../utils/questionSetEditing';
import { roundKindApplies, roundKindGaps } from '../config/roundKinds';
import { editableRows } from '../utils/questionRows';
import { startGenerationJob, pollGenerationJob } from '../utils/aiBatchClient';
import { interpretGenerationJob, generationJobTone } from '../utils/generationJob';

const API_BASE = () => window.API_BASE;

/* ═══════════════════════════════════════════════ drafting the set's fields ══
 *
 * The owner: *"there is no ai button to update fix the question set fields."*
 *
 * These four fields are not decoration. `QuestionsPanel.buildAiContext()` sends
 * exactly them to `admin/ai-generate-questions` as `context.title`,
 * `description`, `customInstructions` and `aiContextInstructions`, so a thin
 * description silently degrades every question drafted for the set afterwards.
 * Repairing them by hand is the one job the console never helped with.
 *
 * THREE RULES GOVERN THIS PANEL and none of them is negotiable:
 *
 *   1. THE RESULT IS A DRAFT IN THIS FORM. Nothing is written. The Save
 *      Changes button below is still the only writer, exactly as it is for a
 *      question drafted in QuestionsPanel.
 *   2. TEXT THE AUTHOR ALREADY WROTE IS NEVER REPLACED WITHOUT BEING ASKED.
 *      A blank field is filled in — there is nothing there to destroy. A field
 *      that already holds words is HELD BACK and shown beside what the author
 *      has, with a per-field choice. See `applyDraft`.
 *   3. WHAT THE SCREEN SHOWS IS WHAT THE MODEL IS GIVEN. `aiQuestions` is one
 *      array: the list rendered under "Drafted from these questions" IS the
 *      array in the request body. A screen that claims the model read a list it
 *      did not read is worse than no screen at all.
 */

/** The four fields the endpoint drafts, in the order the form shows them. */
const AI_DRAFT_FIELDS = ['name', 'description', 'customInstruction', 'aiContextInstruction'];

/** What each one is called on this screen, for the provenance line. */
const AI_FIELD_LABELS = {
  name: 'Title',
  description: 'Description',
  customInstruction: 'Custom Instructions',
  aiContextInstruction: 'AI Context Instructions'
};

/**
 * MIRRORS `lambda-functions/admin/ai-draft-set-metadata.js` (MAX_QUESTIONS,
 * MAX_DETAIL). Duplicated rather than imported because the lambda bundle is
 * CommonJS and unreachable from this ESM build — the same deliberate
 * duplication `edit-question-set.js` makes for GAME_TYPE_IDS.
 *
 * They are applied HERE, before the list is rendered, so the server's identical
 * caps are a no-op on what arrives. A server-side truncation this screen did not
 * know about would quietly break rule 3 above.
 */
const AI_MAX_QUESTIONS = 60;
const AI_MAX_DETAIL = 240;
const AI_MAX_CATEGORIES = 24;

const aiClip = (value, max) => {
  const v = String(value ?? '').trim();
  return v.length > max ? `${v.slice(0, max - 1)}…` : v;
};

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
 *   2. Questions  — the questions themselves: add, edit, delete, reorder, and
 *                   pull from another set (components/QuestionsPanel.jsx)
 *   3. Versions   — list, promote, delete
 *   4. Media      — seam only; a separate change owns uploads
 *
 * The save payload is a DIFF (see utils/questionSetEditing). Do not "simplify"
 * it into sending the whole form: null used to mean "skip" in the lambda, which
 * made clearing any field a silent no-op.
 *
 * TWO PANELS NOW HOLD UNSAVED STATE and they save to different places: Details
 * PUTs metadata (no version), Questions POSTs a replace (one version). They are
 * deliberately separate saves — a rename must not manufacture a version a game
 * could pin to — so Cancel has to ask about the Questions panel's working copy
 * before it closes the editor and drops it.
 */
export default function QuestionSetEditor({
  questionSet,
  availablePrompts = [],
  availablePersonas = [],
  availableSets = [],
  defaultInstructions = '',
  /*
   * ── THE THREE PANELS A HOST CANNOT CALL THE ROUTES FOR ────────────────────
   *
   * This editor is mounted twice: by AdminPage, and by HostQuestionSetsDialog
   * (the owner: *"expose the same style … to the host question set screens. why
   * recreate everything"*). Almost all of it works for a host — the details
   * save is `PUT /admin/edit-question-set/{id}`, the questions save is
   * `POST /admin/upload-questions` with `replaceSetId`, and both are on the host
   * route list and ownership-guarded by `requireSetManager`.
   *
   * Three things are not. The version routes and the CSV download are
   * admins-only in `auth/authorizer.js`; the AI draft is admins-only AND
   * Bedrock spend. So they are flags, following the pattern
   * QuestionSetUploadPanel already set (`showAIBuilder` and friends) rather
   * than a second copy of this file.
   *
   * EVERY FLAG DEFAULTS TO THE CURRENT BEHAVIOUR. AdminPage passes none of
   * them, so the console is byte-for-byte what it was — which is how you can
   * tell the seam was cut in the right place.
   *
   * A FLAG IS NOT A PERMISSION. Turning `showAIAssist` on for a host would draw
   * the button and change nothing about the 403 behind it; the route list is a
   * separate decision in a separate file.
   */
  /** `GET|POST|DELETE /admin/question-sets/{id}/versions…` — admins only. */
  showVersions = true,
  /** `GET /admin/download-question-set/{id}` — admins only. */
  showDownload = true,
  /** `POST /admin/ai-generate-questions` — admins only. */
  showAIAssist = true,
  onSaved,
  onChanged,
  /**
   * Reports the Questions panel's unsaved working copy upward, so a container
   * that owns the way out (the host's modal answers Escape) can refuse to throw
   * it away. AdminPage does not pass it: its way out is this editor's own
   * Cancel, which already asks.
   */
  onDirtyChange,
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
  // diff against this. Rebaselined on every successful save, so "dirty" always
  // means "differs from what the server now holds", not "differs from open".
  const [original, setOriginal] = useState({});
  // The title as last saved, tracked separately: `questionSet.name` goes stale
  // the moment a save renames the set, and stays stale until the list refetches.
  const [savedTitle, setSavedTitle] = useState('');
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

  /* ----------------------------------------------------------- questions -- */
  // The Questions panel's working copy is unsaved until IT saves. Closing the
  // editor drops it, so Cancel asks first — reported up rather than reached
  // into, so the panel stays the only owner of its own state.
  const [questionsDirty, setQuestionsDirty] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);

  /* ------------------------------------------------- AI drafting the details */
  const [aiOpen, setAiOpen] = useState(false);
  const [aiBrief, setAiBrief] = useState('');
  const [aiBusy, setAiBusy] = useState(false);
  const [aiStatus, setAiStatus] = useState({ text: '', tone: '' });
  // THE ONE ARRAY. Rendered under "Drafted from these questions" and sent as
  // `questions`. Never two arrays, never re-derived at send time.
  const [aiQuestions, setAiQuestions] = useState([]);
  const [aiTotalQuestions, setAiTotalQuestions] = useState(0);
  const [aiCategories, setAiCategories] = useState([]);
  const [aiSourceState, setAiSourceState] = useState('idle'); // idle|loading|ready|error
  // Which fields the model wrote into this form. Provenance — see the panel copy.
  const [aiDrafted, setAiDrafted] = useState([]);
  // Fields the model drafted that the author had ALREADY written. Held back
  // rather than applied, and offered one at a time. `{ field: draftedText }`.
  const [aiHeld, setAiHeld] = useState({});

  const activeVersion = questionSet?.activeVersion;

  // Prompts worth offering for THIS set. Keyed off the live engagementType
  // rather than the saved one, so switching the type re-filters immediately —
  // otherwise you pick "Trivia", save, reopen, and only then see trivia prompts.
  const summaryPromptChoices = selectableSummaryPrompts(availablePrompts, engagementType);
  const hiddenPromptCount = availablePrompts.length - summaryPromptChoices.length;


  const loadVersions = useCallback(async () => {
    if (!setId) return;
    // NOT FETCHED WHEN THE PANEL IS NOT DRAWN. The catch below swallows a failed
    // load into an empty list — correct for a set that predates versioning, and
    // indistinguishable from the 403 a host gets. Withholding the request is
    // what keeps "no Versions panel" from meaning "a Versions panel that is
    // silently always empty".
    if (!showVersions) return;
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
  }, [setId, activeVersion, showVersions]);

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
    setSavedTitle(questionSet?.name || '');
    setSaveStatus('');
    setSaveOk(null);
    setVersionStatus({ text: '', tone: '' });
    setPendingDelete(null);
    setConfirmClose(false);
    // A different set means a different set's questions and a different set's
    // provenance. Carrying either across would make both of them lies.
    setAiOpen(false);
    setAiBrief('');
    setAiStatus({ text: '', tone: '' });
    setAiQuestions([]);
    setAiTotalQuestions(0);
    setAiCategories([]);
    setAiSourceState('idle');
    setAiDrafted([]);
    setAiHeld({});
    loadVersions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setId]);

  // Pass the Questions panel's unsaved state on to whoever owns the container.
  // Reported rather than reached into, the same way the panel reports it here.
  useEffect(() => {
    if (onDirtyChange) onDirtyChange(questionsDirty);
  }, [questionsDirty, onDirtyChange]);

  /*
   * THE ONE WAY OUT, CALLED FROM THREE PLACES.
   *
   * Reported by the owner: *"there is no way to back out of 'edit question set'
   * for the host (no x in upper right, or cancel bottom …)"*. This editor is
   * mounted inside `HostQuestionSetsDialog`'s `Modal`, whose scrim is
   * `closeOnBackdrop={false}` and whose Escape is `() => !editorDirty`. Its own
   * only exit was the Cancel beside Save Changes — which sits in the FIRST of
   * four panels, above the Questions panel, the Versions panel and the Media
   * panel, inside a `.qsets-editor-frame` that is `max-height: 86vh;
   * overflow: auto`. Scroll down to the questions, which is the whole reason a
   * host opens this, and every exit in the product is off-screen at once: the
   * Cancel has scrolled away, the backdrop is inert by design, and on a tablet
   * there is no Escape key. That is the same trap
   * `docs/…/modalReachability` and QuestionsPanel's own `×` were written for.
   *
   * So there are now three: the `×` in the header, the Cancel in the Details
   * panel that was always here, and a Cancel in the editor's own footer. All
   * three go through THIS function, and this function honours the same rule the
   * container's Escape gate does — an unsaved working copy is confirmed before
   * it is dropped, never silently binned. A second way out that skipped the
   * confirmation would be a new way to lose an afternoon's work, which is
   * exactly what the gate exists to prevent.
   */
  const requestClose = useCallback(() => {
    if (!onCancel) return;
    if (questionsDirty) {
      setConfirmClose(true);
      return;
    }
    onCancel();
  }, [onCancel, questionsDirty]);

  /** Display name for a stored personaId, or a warning when it resolves to nothing. */
  const personaLabel = (id) => {
    const match = availablePersonas.find((p) => p.personaId === id);
    return match ? match.name : `${id} (unknown — Workie will adapt instead)`;
  };

  /* ------------------------------------------------ AI drafting the details */

  /** The live form values, keyed the way the endpoint keys them. */
  const aiCurrent = {
    name: title,
    description,
    customInstruction: instructions,
    aiContextInstruction: aiContext
  };

  /** Who writes each field. One table, so nothing can set the wrong box. */
  const AI_FIELD_SETTERS = {
    name: setTitle,
    description: setDescription,
    customInstruction: setInstructions,
    aiContextInstruction: setAiContext
  };

  /**
   * THE ARRAY THE MODEL IS GIVEN, built once, when the panel opens.
   *
   * Read from the SERVER's copy of the questions, not from the Questions
   * panel's unsaved working copy — the two panels save to different places and
   * this one cannot see inside the other. The panel copy says so out loud
   * rather than leaving the author to guess which set of words was summarised.
   *
   * The caps are applied here, before anything is rendered, so the identical
   * caps in the handler are a no-op and the list on screen is the list on the
   * wire, character for character.
   */
  const loadAiSource = useCallback(async () => {
    if (!setId) return;
    setAiSourceState('loading');
    try {
      const response = await authFetch(`${API_BASE()}question-sets/${setId}/questions`);
      if (!response.ok) {
        setAiSourceState('error');
        return;
      }
      const rows = editableRows(await response.json());
      const shaped = rows
        .map((r) => ({
          title: r.title,
          category: r.category,
          detail: aiClip(r.detail, AI_MAX_DETAIL),
          // SINGULAR on the row, PLURAL on the wire — the same mapping
          // QuestionsPanel.buildAiContext() makes, and the same trap.
          customInstructions: aiClip(r.customInstruction, AI_MAX_DETAIL)
        }))
        .filter((q) => q.title || q.detail)
        .slice(0, AI_MAX_QUESTIONS);

      const seen = [];
      for (const r of rows) {
        const c = String(r.category || '').trim();
        if (c && !seen.includes(c)) seen.push(c);
      }

      setAiQuestions(shaped);
      // The REAL total, so the prompt can say honestly that it read a sample.
      setAiTotalQuestions(rows.length);
      setAiCategories(seen.slice(0, AI_MAX_CATEGORIES));
      setAiSourceState('ready');
    } catch (error) {
      console.error('AI source load error:', error);
      setAiSourceState('error');
    }
  }, [setId]);

  const toggleAiPanel = () => {
    const opening = !aiOpen;
    setAiOpen(opening);
    // Retried on 'error' as well as 'idle'. A failed load is otherwise sticky
    // for the life of the editor, and the copy below tells the author to close
    // the panel and try again — advice nothing would act on.
    if (opening && (aiSourceState === 'idle' || aiSourceState === 'error')) loadAiSource();
  };

  /**
   * A drafted field becomes an EDITABLE FORM VALUE, or it waits its turn.
   *
   * The rule, and the reason it is not "fill everything in":
   *
   *   BLANK  → written into the form. There is nothing there to destroy, and a
   *            blank aiContextInstruction is precisely the degraded generator
   *            input this whole feature exists to repair.
   *   WRITTEN → HELD. The author's words stay exactly as they typed them and the
   *            draft is shown next to them with a per-field choice. An AI that
   *            silently replaces a paragraph somebody wrote is a data-loss bug
   *            wearing a feature's clothes: nothing here is saved yet, but the
   *            author would have no way back to their own sentence.
   *
   * Nothing in this function calls the server. `handleSave` is still the only
   * writer in this component.
   */
  const applyDraft = (item) => {
    const written = [];
    const held = {};
    for (const field of AI_DRAFT_FIELDS) {
      const drafted = String(item?.[field] ?? '').trim();
      // A field the model left blank is a field it had nothing to say about,
      // not an instruction to clear the author's.
      if (!drafted) continue;
      if (String(aiCurrent[field] ?? '').trim()) held[field] = drafted;
      else {
        AI_FIELD_SETTERS[field](drafted);
        written.push(field);
      }
    }
    setAiDrafted((current) => [...new Set([...current, ...written])]);
    setAiHeld(held);
    return { written, held: Object.keys(held) };
  };

  /** The author chose the draft over their own words, on purpose, one field. */
  const acceptHeld = (field) => {
    const value = aiHeld[field];
    if (value === undefined) return;
    AI_FIELD_SETTERS[field](value);
    setAiDrafted((current) => [...new Set([...current, field])]);
    setAiHeld(({ [field]: dropped, ...rest }) => rest);
  };

  /** The author kept their own words. The draft is dropped, not stored. */
  const rejectHeld = (field) =>
    setAiHeld(({ [field]: dropped, ...rest }) => rest);

  const draftDetails = async () => {
    setAiBusy(true);
    setAiHeld({});
    setAiStatus({ text: 'Starting generation...', tone: 'pending' });
    const endpoint = `${API_BASE()}admin/ai-draft-set-metadata`;
    const onStatus = (text) => setAiStatus({ text, tone: 'pending' });
    try {
      // Generation cannot run inside the request — API Gateway's 30s ceiling —
      // so this is the same start-a-job-and-poll shape every other builder uses.
      const { jobId } = await startGenerationJob(endpoint, {
        setId,
        engagementType: normalizeGameType(engagementType),
        current: aiCurrent,
        // THE SAME ARRAY THE LIST BELOW RENDERS. Not a copy, not a re-derivation.
        questions: aiQuestions,
        totalQuestions: aiTotalQuestions,
        categories: aiCategories,
        brief: aiBrief.trim()
      }, { label: 'Set details', onStatus });

      const job = await pollGenerationJob(endpoint, jobId, { label: 'Set details', onStatus });

      // Read the outcome, never `items.length` — see utils/generationJob.js.
      const interpreted = interpretGenerationJob(job);
      if (interpreted.outcome !== 'complete') {
        setAiStatus({
          text: `Nothing was drafted: ${interpreted.error
            || interpreted.warnings.join(' ')
            || 'the job ended without producing anything'}. Your details are untouched.`,
          tone: generationJobTone(interpreted.outcome)
        });
        return;
      }

      const { written, held } = applyDraft(interpreted.items[0]);
      const names = (list) => list.map((f) => AI_FIELD_LABELS[f]).join(', ');
      if (written.length === 0 && held.length === 0) {
        setAiStatus({ text: 'The draft came back empty. Your details are untouched.', tone: 'error' });
      } else {
        setAiStatus({
          text: [
            written.length ? `Drafted into the form: ${names(written)}.` : '',
            held.length
              ? `${names(held)} already had your words in ${held.length === 1 ? 'it' : 'them'}, so nothing was replaced — the draft is below for you to take or leave.`
              : '',
            'Nothing is saved until you press Save Changes.'
          ].filter(Boolean).join(' '),
          tone: 'success'
        });
      }
    } catch (error) {
      console.error('AI set-details draft error:', error);
      setAiStatus({ text: `${error.message} Your details are untouched.`, tone: 'error' });
    } finally {
      setAiBusy(false);
    }
  };

  /** Small "AI drafted this" mark beside a field label. Provenance, visibly. */
  const aiMark = (field) => (aiDrafted.includes(field) ? (
    <span className="qs-ai-field-mark" data-testid={`ai-drafted-${field}`}>
      <Icon name="Sparkle" weight="duotone" size={12} color="var(--primary)" /> AI drafted
    </span>
  ) : null);

  /* --------------------------------------------------------------- save --- */

  // The form as it stands, normalised the way the save normalises it. One
  // object serving two readers: the save diffs it against `original`, and the
  // exit label below asks whether that diff is empty.
  const currentDetails = {
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

  const detailsDirty = title.trim() !== savedTitle.trim()
    || Object.keys(EDITABLE_SET_FIELDS).some((f) => currentDetails[f] !== (original[f] ?? ''));

  /*
   * WHAT THE WAY OUT IS CALLED. Reported by the owner: after replacing the
   * questions from a CSV — a change that has already LANDED, version written,
   * banner shown — the only button out of the modal still said "Cancel", which
   * reads as "undo that". So the exit is "Close" whenever leaving abandons
   * nothing, and "Cancel" only while something typed here is still unsaved —
   * where leaving really does discard it (the Questions copy after a
   * confirmation, the Details form silently).
   */
  const exitLabel = (questionsDirty || detailsDirty) ? 'Cancel' : 'Close';

  const handleSave = async () => {
    if (!title.trim()) {
      setSaveOk(false);
      setSaveStatus('Title is required');
      return;
    }

    const current = currentDetails;

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
        // Rebaseline: what was just saved is the new "unchanged", so the exit
        // reads Close again and a second Save has nothing phantom to re-send.
        setOriginal(current);
        setSavedTitle(savedName);
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
      {/*
        THE TITLE AND THE WAY OUT, ON ONE LINE — the same `.qs-dialog-head` /
        `.qs-dialog-close` pair QuestionsPanel's question dialog already uses,
        reused rather than re-invented so the two surfaces a host meets one
        inside the other carry the identical control in the identical corner.

        Drawn only when there is somewhere to go. `onCancel` is optional, and a
        `×` that is wired to nothing is worse than no `×` — it is the control
        people reach for first, so it must never be the one that does nothing.
      */}
      <div className="qs-dialog-head">
        <h2>
          <Icon name="PencilSimple" weight="bold" size={16} color="currentColor" />{' '}
          Edit Question Set
        </h2>
        {onCancel && (
          <button
            type="button"
            className="qs-dialog-close"
            onClick={requestClose}
            aria-label="Close the editor"
            title="Close the editor"
            data-testid="qs-editor-close"
          >
            ×
          </button>
        )}
      </div>
      <p className="section-description">
        {currentSet.name || setId} · {gameTypeLabel(currentSet.engagementType)} ·{' '}
        {currentSet.totalQuestions || 0} questions in {currentSet.categoryCount || 0} categories
        {activeVersion != null && <> · active version {activeVersion}</>}
      </p>

      {/*
        AI PROVENANCE, AND — SEPARATELY — WHETHER ANYTHING IS ASKED OF YOU.
        These are two different facts and the banner used to conflate them: it
        rendered on `isAIGenerated` alone while the copy hardcoded "is currently
        inactive … activate it when ready". Business Concepts in engagedev is
        `isAIGenerated: true, active: true`, so a live set was telling its editor
        it was switched off and asking to be switched on. Being AI-written is
        worth saying permanently; needing activation is only worth saying while
        it is true.
      */}
      {currentSet.isAIGenerated && (
        <div className={`ai-review-banner${currentSet.active ? ' ai-review-banner--noted' : ''}`}>
          <div className="ai-review-content">
            <span className="ai-review-icon">
              <Icon name="Sparkle" weight="duotone" size={16} color="var(--primary)" />
            </span>
            <div className="ai-review-text">
              {currentSet.active ? (
                <>
                  <strong>Written by AI</strong>
                  <p>
                    This question set was generated, then activated. Edits you make here are
                    live for anyone hosting from it.
                  </p>
                </>
              ) : (
                <>
                  <strong>AI-Generated Content - Review Required</strong>
                  <p>
                    This question set was created by AI and is currently inactive. Please review and
                    edit the content, then activate it when ready.
                  </p>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ================================================== 1. DETAILS === */}
      <section className="qs-panel">
        <div className="qs-panel-header">
          <h3><Icon name="ClipboardText" weight="bold" size={16} color="currentColor" /> Details</h3>
          <span className="qs-panel-note">Everything that could be set when this set was created</span>
          {/* `showAIAssist` is admins-only and Bedrock spend — the same flag the
              Questions panel's drafter uses, and the same reason. A FLAG IS NOT
              A PERMISSION: the route is admins-only in auth/authorizer.js and
              the handler checks again. */}
          {showAIAssist && (
            <button
              type="button"
              className="btn-secondary btn-small qs-ai-toggle"
              onClick={toggleAiPanel}
              aria-expanded={aiOpen}
              disabled={aiBusy}
            >
              <Icon name="Sparkle" weight="duotone" size={14} color="currentColor" />{' '}
              {aiOpen ? 'Hide the AI draft' : 'Draft these fields with AI'}
            </button>
          )}
        </div>

        {showAIAssist && aiOpen && (
          <div className="qs-ai-panel" data-testid="ai-details-panel">
            <p className="qs-panel-note">
              These four fields are what the question generator is given every time it
              writes for this set, so a thin description quietly degrades everything drafted
              afterwards. The model reads the set&rsquo;s own questions and proposes new
              wording. <strong>Nothing is saved</strong> — it fills this form in and you press
              Save Changes, or you don&rsquo;t.
            </p>

            <div className="form-group">
              <label htmlFor="ai-details-brief">Anything it should know? (optional)</label>
              <textarea
                id="ai-details-brief"
                className="form-textarea"
                rows="2"
                value={aiBrief}
                onChange={(e) => setAiBrief(e.target.value)}
                disabled={aiBusy}
                placeholder="e.g. this is for new managers, not for engineers"
              />
            </div>

            {/* DRAFTED FROM THESE QUESTIONS — the array in the request body,
                rendered. If this list and `questions` ever disagree, the screen
                is lying about what the model read. */}
            <div className="qs-ai-source" data-testid="ai-source-questions">
              <h4>Drafted from these questions.</h4>
              {aiSourceState === 'loading' && <p className="qs-empty">Loading the set&rsquo;s questions…</p>}
              {aiSourceState === 'error' && (
                <p className="qs-empty">
                  The set&rsquo;s questions could not be loaded, so the model would have only what
                  you have already typed to go on. Close this and try again.
                </p>
              )}
              {aiSourceState === 'ready' && aiQuestions.length === 0 && (
                <p className="qs-empty">
                  This set has no questions yet. The model will work from what you have already
                  written and will not invent content the set does not contain.
                </p>
              )}
              {aiSourceState === 'ready' && aiQuestions.length > 0 && (
                <>
                  {/*
                    EVERY FIELD THAT IS SENT IS RENDERED, and rendered WHOLE —
                    no display truncation anywhere in here. The sibling browser
                    in QuestionsPanel clips its preview at 120 characters, which
                    is fine for a list that only claims to jog the memory; this
                    list claims something stronger, that it IS the model's input,
                    and a preview shorter than the payload would quietly make
                    that false. `aiClip` has already bounded every value at
                    AI_MAX_DETAIL, so whole is short enough to show.

                    `data-field` is what lets a test reconstruct each object out
                    of the DOM and deep-equal the result against the request
                    body — see questionSetDetailsAi.test.jsx.
                  */}
                  <ol className="qs-sibling-list">
                    {aiQuestions.map((q, i) => (
                      <li key={`${q.title}-${i}`} data-testid="ai-source-question">
                        <strong data-field="title">{q.title}</strong>
                        {!q.title && <em>Untitled question</em>}
                        {q.category && (
                          <span className="qs-question-detail" data-field="category">{q.category}</span>
                        )}
                        {q.detail && (
                          <span className="qs-question-detail" data-field="detail">{q.detail}</span>
                        )}
                        {q.customInstructions && (
                          <span className="qs-question-detail" data-field="customInstructions">
                            {q.customInstructions}
                          </span>
                        )}
                      </li>
                    ))}
                  </ol>
                  <p className="qs-panel-note">
                    {aiTotalQuestions > aiQuestions.length
                      ? `${aiQuestions.length} of ${aiTotalQuestions} questions — the first ${AI_MAX_QUESTIONS} are enough to establish the voice, and they are what is sent.`
                      : `All ${aiQuestions.length} question${aiQuestions.length === 1 ? '' : 's'} — this is exactly what is sent.`}
                    {' '}As last saved: unsaved edits in the Questions panel below are not
                    included, because that panel saves separately.
                  </p>
                </>
              )}
            </div>

            <div className="qs-panel-actions">
              <button
                className="btn-primary btn-small"
                onClick={draftDetails}
                disabled={aiBusy || aiSourceState === 'loading'}
              >
                {aiBusy ? 'Drafting…' : 'Draft it'}
              </button>
            </div>

            {aiStatus.text && <StatusMessage message={aiStatus.text} tone={aiStatus.tone} />}
          </div>
        )}

        {/* HELD BACK — fields the author had already written. The draft is shown
            beside their words and goes nowhere until they say so. */}
        {Object.keys(aiHeld).length > 0 && (
          <div className="qs-ai-held" data-testid="ai-held-panel">
            <h4>
              <Icon name="Warning" weight="fill" size={14} color="var(--primary)" />{' '}
              You had already written {Object.keys(aiHeld).length === 1 ? 'this one' : 'these'}
            </h4>
            <p className="qs-panel-note">
              Nothing below has been applied. Your wording is still in the form untouched;
              take the draft only where you want it.
            </p>
            {AI_DRAFT_FIELDS.filter((f) => aiHeld[f] !== undefined).map((field) => (
              <div className="qs-ai-held-field" key={field} data-testid={`ai-held-${field}`}>
                <strong>{AI_FIELD_LABELS[field]}</strong>
                <blockquote className="qs-ai-held-yours">
                  <span className="qs-ai-held-label">Yours</span>
                  {aiCurrent[field]}
                </blockquote>
                <blockquote className="qs-ai-held-draft">
                  <span className="qs-ai-held-label">The draft</span>
                  {aiHeld[field]}
                </blockquote>
                <div className="qs-panel-actions">
                  <button className="btn-secondary btn-small" onClick={() => acceptHeld(field)}>
                    Replace mine with this
                  </button>
                  <button className="btn-secondary btn-small" onClick={() => rejectHeld(field)}>
                    Keep mine
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* PROVENANCE, and an honest statement of its limits.
            A question carries its authorship in an `ai-drafted` TAG, which
            survives the CSV round trip. There is no equivalent carrier here: the
            SETS row has no tag list, and `edit-question-set.js` writes a CLOSED
            allow-list of fields (OPTIONAL_FIELDS) that `get-question-sets.js`
            then projects field by field — so a `draftedByAI` attribute invented
            here would be dropped on the write, and unread on the way back. That
            is the same silent discard `upload-questions.js`'s getColumnIndex
            does to an unknown CSV column, which is exactly the failure the
            question path chose a tag to avoid. So provenance lives where it can
            still be acted on: named, per field, at the moment before the save. */}
        {aiDrafted.length > 0 && (
          <p className="qs-ai-provenance" data-testid="ai-set-provenance">
            <Icon name="Sparkle" weight="duotone" size={14} color="var(--primary)" />{' '}
            <strong>AI drafted {aiDrafted.map((f) => AI_FIELD_LABELS[f]).join(', ')}.</strong>{' '}
            {aiDrafted.length === 1 ? 'It is' : 'They are'} a draft in this form and nothing
            else — not written until you press Save Changes. Nothing records this afterwards:
            a set row has no tag list the way a question does, so if the authorship is worth
            keeping on the record, say so in the description before you save.
          </p>
        )}

        <div className="edit-form">
          <div className="form-group">
            <label htmlFor="edit-title">Title *{aiMark('name')}</label>
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
            <label htmlFor="edit-description">Description{aiMark('description')}</label>
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
            <label htmlFor="edit-instructions">Custom Instructions{aiMark('customInstruction')}</label>
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
            <label htmlFor="edit-ai-context-instructions">AI Context Instructions{aiMark('aiContextInstruction')}</label>
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
              Categories come from the questions themselves. To add, rename or remove one, change
              the category on a question in the Questions panel below — there is no separate list
              to keep in step, which is why there is no field here.
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
            {/* Same gate as the other two exits: `onCancel` is optional, and a
                Cancel wired to nothing is a control that reads as a frozen
                screen. It used to render unconditionally and call
                `onCancel && onCancel()`. */}
            {onCancel && (
              <button className="btn-secondary" onClick={requestClose}>
                {exitLabel}
              </button>
            )}
          </div>

          {saveStatus && (
            <StatusMessage
              message={saveStatus}
              tone={saveOk === true ? 'success' : saveOk === false ? 'error' : 'pending'}
            />
          )}
        </div>
      </section>

      {/* ================================================ 2. QUESTIONS ===
        The working copy: add, edit, delete, reorder, pull from another set,
        then ONE Save = one replace = one version. It owns the download and the
        replace-from-a-file controls too, because a file replace and an unsaved
        working copy are two writers of the same rows and only a panel that
        holds both can say so. See components/QuestionsPanel.jsx.
      */}
      <QuestionsPanel
        questionSet={currentSet}
        availableSets={availableSets}
        plannedVersion={plannedVersion}
        showDownload={showDownload}
        showAIAssist={showAIAssist}
        onChanged={async () => { await loadVersions(); if (onChanged) onChanged(); }}
        onDirtyChange={setQuestionsDirty}
      />

      {/* ================================================= 3. VERSIONS === */}
      {showVersions && (
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
      )}

      {/* ==================================================== 4. MEDIA === */}
      {/*
        THE SEAM THIS FILLS, and the two places the shipped thing differs from
        the contract that was written here in advance. Both differences are
        deliberate; the seam's third route is simply not built.

          written: POST /admin/question-sets/{setId}/media -> { uploadUrl, key }
          shipped: POST /admin/question-sets/{setId}/media/uploads
                     -> { uploads: [{ name, key, url, contentType }], rejected: [] }

          The owner asked to *"select a local folder"*. A one-URL-per-call
          endpoint makes that N sequential authenticated round trips before the
          first byte moves — sixty images is sixty calls to learn sixty keys
          this handler could have derived in one. Batched, and the key is still
          chosen by the server and never by the caller.

          written: GET /admin/question-sets/{setId}/media -> { images: [...] }
          shipped: GET /admin/question-sets/{setId}/media
                     -> { counts, missing: [...], unused: [...] }

          A thumbnail list is not the question the owner asked
          (*"verify these images are mapped to the questions"*), and the
          browser cannot answer it locally: CloudFront maps 403/404 to
          /index.html with status 200, so a missing image fetches successfully
          as the app's own HTML. The comparison has to happen server-side, and
          once it does, the file list is a by-product of it (`unused`).

          not built: DELETE .../media/{key}. Nothing asked for it, and the
          verification report already names orphaned files without giving
          anybody a one-click way to delete artwork a half-renamed CSV still
          needs.

        What the seam got exactly right, and what the storage decision rests on:
        `s3://<env>-media/sets/<setId>/<filename>` — a SEPARATE BUCKET, per SET
        and not per version. See template-clean.yaml's MediaBucket for why the
        website bucket would have lost every image on the next deploy.
      */}
      <section className="qs-panel" data-testid="media-panel">
        <div className="qs-panel-header">
          <h3><Icon name="Image" weight="bold" size={16} color="currentColor" /> Images</h3>
          <span className="qs-panel-note">
            Upload a folder of pictures, and see which questions are pointing at one that is not there
          </span>
        </div>
        <SetMediaPanel
          setId={setId}
          onUploaded={() => { if (onChanged) onChanged(); }}
        />
      </section>

      {/*
        THE BOTTOM OF THE EDITOR IS ALSO AN EXIT.

        The owner asked for both this and the `×` above, and both because of
        where the panels sit: the Details panel's Cancel is roughly a quarter of
        the way down a four-panel form, so the moment you scroll to the
        questions — the reason you opened the editor — there is nothing on
        screen that gets you back. A person who has finished reading DOWN should
        not have to scroll back UP to leave.

        Deliberately a lone secondary. There is no second "Save Changes" here:
        Details PUTs metadata and Questions POSTs a replace that manufactures a
        version, so a footer Save would have to pick one of two different writes
        and would be lying whichever it picked. It routes through
        `requestClose`, so an unsaved working copy is still asked about.
      */}
      {onCancel && (
        <div className="form-actions" data-testid="qs-editor-footer">
          <button
            type="button"
            className="btn-secondary"
            onClick={requestClose}
            data-testid="qs-editor-cancel"
          >
            {exitLabel}
          </button>
        </div>
      )}

      {/* Closing with an unsaved working copy. The Questions panel holds edits
          that exist nowhere but this browser tab, so closing the editor is the
          one click that can silently destroy an afternoon's work. */}
      {confirmClose && (
        /*
          THROUGH THE PRIMITIVE, NOT A HAND-ROLLED OVERLAY. This was a raw
          `.modal-overlay` div: no `role="dialog"`, no accessible name, no focus
          trap, and — the part that matters here — no Escape. It is the dialog
          that now stands between three separate exits and an afternoon of
          unsaved questions, so it must not itself be a thing you can only leave
          by aiming at the backdrop.

          `Modal` answers the INNERMOST dialog by DOM containment, and this
          renders inside the editor's own scrim, so Escape here means "go back
          and save them" — the safe half of the choice — and cannot reach past
          it to the close it is guarding.
        */
        <Modal
          overlayClassName="modal-overlay"
          contentClassName="modal-content"
          labelledBy="qs-editor-confirm-close-title"
          onClose={() => setConfirmClose(false)}
        >
          <h3 id="qs-editor-confirm-close-title">
            <Icon name="Warning" weight="fill" size={16} color="var(--primary)" />{' '}
            You have unsaved questions
          </h3>
          <p>
            The Questions panel has changes that have not been saved. Closing the editor
            throws them away — there is no draft kept anywhere.
          </p>
          <div className="modal-actions">
            <button className="btn-secondary" onClick={() => setConfirmClose(false)}>
              Go back and save them
            </button>
            <button className="btn-danger" onClick={() => { setConfirmClose(false); if (onCancel) onCancel(); }}>
              Close and lose the changes
            </button>
          </div>
        </Modal>
      )}

      {/* Pinned-game delete confirmation. The ids matter: "some games are using
          this" is not enough information to decide with. */}
      {pendingDelete && (
        <Modal
          overlayClassName="modal-overlay"
          contentClassName="modal-content"
          labelledBy="qs-pinned-delete-title"
          onClose={() => setPendingDelete(null)}
        >
            <h3 id="qs-pinned-delete-title">
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
        </Modal>
      )}
    </div>
  );
}
