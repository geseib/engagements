import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Icon from './Icon';
import StatusMessage from './StatusMessage';
import QuestionPullDialog from './QuestionPullDialog';
import { authFetch } from '../auth/authFetch';
import { normalizeGameType } from '../config/gameTypes';
import { ROUND_KIND_IDS, ROUND_KINDS, roundKindApplies } from '../config/roundKinds';
import { summarizeCsv, describeReplacePlan } from '../utils/questionSetEditing';
import {
  editableRows,
  blankRow,
  moveRow,
  rowsToCsv,
  rowProblems,
  workingCopyProblems,
  summarizeRowChanges,
  describeRowChanges,
  versionNote,
  toTagList,
} from '../utils/questionRows';

const API_BASE = () => window.API_BASE;

/**
 * THE QUESTIONS PANEL — add, edit, delete, reorder, and pull from another set.
 *
 * Until this existed there was no way to change a single question anywhere in
 * the product. `QuestionSetEditor` edited the set's METADATA; the only write
 * path to a question was "download the whole CSV, edit it in Excel, upload it
 * back", which is the workflow the owner reported as missing.
 *
 * ── THE MECHANISM, WHICH IS NOT A NEW API ──────────────────────────────────
 *
 * There is no per-question write endpoint and there must not be one: it would
 * be a second writer racing the version system, and versions exist so a game in
 * progress keeps reading the rows it started on. So this panel holds a WORKING
 * COPY in the browser, mutates an array, and saves it as ONE
 * `POST /admin/upload-questions` — one replace, one version (decision 3). Add,
 * edit, delete, reorder and copy-in are all array operations; Save is the only
 * request that writes anything.
 *
 * `utils/questionRows.js` serialises the array to the CSV the importer reads,
 * byte-identically to what `download-question-set.js` emits — asserted in
 * tests/question-set-roundtrip.js, against the real handlers, because a second
 * writer of that CSV is a second chance to reintroduce the silent-data-loss
 * defect that suite was written for.
 *
 * ── UNSAVED WORK IS THE RISK THIS PANEL IS DESIGNED AROUND ─────────────────
 *
 * A working copy means a person can now lose an afternoon of editing. Four
 * things guard it, and none of them is optional:
 *
 *   1. A dirty bar names every unsaved change ("2 added, 1 edited") and says in
 *      words that nothing has been written yet.
 *   2. A delete is a TOMBSTONE, not a splice. The row stays on screen, struck
 *      through, with Restore, until Save.
 *   3. Discard is explicit, and it asks.
 *   4. Leaving — closing the editor, or the browser tab — is guarded, and a
 *      failed save leaves the working copy exactly as it was.
 *
 * ── SAVING A SET YOU DO NOT OWN: IT BECOMES YOURS ──────────────────────────
 *
 * The owner's ruling. Anyone may edit any set here; on Save, someone who cannot
 * manage the set gets a NEW SET OF THEIR OWN seeded from the working copy, and
 * the original is not touched — not its rows, not its activeVersion, not its
 * version list. The button says so BEFORE it is pressed, and the name is theirs
 * to set in the same step.
 *
 * That is the same code path as building a subset out of pulled questions: both
 * are "create a new set, seeded from this working copy" (`saveRows` below takes
 * either a `replaceSetId` or a `customTitle`, and nothing else differs).
 *
 * The client is choosing WHICH set to write. It is not choosing WHO may write:
 * `upload-questions.js` still runs `requireSetManager` on every replace, and a
 * hand-made request against somebody else's set is still a 403 — proved in
 * tests/question-set-roundtrip.js, not assumed here.
 *
 * ── WHY canManage IS NOT COMPUTED HERE ─────────────────────────────────────
 *
 * It arrives from the server on the set list (`get-question-sets.js` runs the
 * same `canManageSet` the handlers enforce with). The browser never compares
 * `createdBy` to anyone — decision 5, so that ownership becoming a GROUP later
 * is one function in one file.
 */
export default function QuestionsPanel({
  questionSet,
  availableSets = [],
  plannedVersion,
  onChanged,
  onDirtyChange,
}) {
  const setId = questionSet?.id || '';
  const setName = questionSet?.name || setId;
  const engagementType = normalizeGameType(questionSet?.engagementType);
  // The server's answer to "may this caller write to this set", never ours.
  // Absent means an older payload: assume the historical behaviour (replace)
  // and let the handler refuse, which the 403 path below turns into a fork.
  const canManage = questionSet?.canManage !== false;

  /* ------------------------------------------------------- working copy -- */
  const [rows, setRows] = useState([]);
  const [baseline, setBaseline] = useState([]);      // the rows as loaded
  const [baselineOrder, setBaselineOrder] = useState([]);
  const [loadState, setLoadState] = useState('loading');
  const [loadError, setLoadError] = useState('');
  const [status, setStatus] = useState({ text: '', tone: '' });
  const [saving, setSaving] = useState(false);

  /* ------------------------------------------------------------- editing -- */
  const [editingUid, setEditingUid] = useState(null);
  const [draft, setDraft] = useState(null);
  const [selected, setSelected] = useState([]);
  const [categoryFilter, setCategoryFilter] = useState('');
  const [showPull, setShowPull] = useState(false);
  // { mode: 'fork' | 'subset', title, rows }
  const [newSetDialog, setNewSetDialog] = useState(null);
  const [confirmDiscard, setConfirmDiscard] = useState(false);

  /* ------------------------------------------------------------- replace -- */
  const [replaceFile, setReplaceFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [isReplacing, setIsReplacing] = useState(false);
  const replaceInputRef = useRef(null);

  const summary = useMemo(() => summarizeRowChanges(rows, baselineOrder), [rows, baselineOrder]);
  const dirty = summary.total > 0;
  const problems = useMemo(
    () => workingCopyProblems(rows, engagementType), [rows, engagementType]
  );

  /* ----------------------------------------------------------- loading --- */

  const load = useCallback(async () => {
    if (!setId) return;
    setLoadState('loading');
    try {
      // The set's own questions. This route carries no authorizer on purpose —
      // the host's question browser and the phone remote both read it with a
      // bare fetch — so nothing here attaches one. The permission that matters
      // is on the WRITE, and it lives in the handler.
      const response = await authFetch(`${API_BASE()}question-sets/${setId}/questions`);
      if (!response.ok) {
        setLoadState('error');
        setLoadError(`Could not load the questions (HTTP ${response.status}).`);
        return;
      }
      const json = await response.json();
      const loaded = editableRows(json);
      setRows(loaded);
      setBaseline(loaded);
      setBaselineOrder(loaded.map((r) => r.uid));
      setLoadState('ready');
      setLoadError('');
    } catch (error) {
      console.error('Load questions error:', error);
      setLoadState('error');
      setLoadError(`Could not load the questions: ${error.message}`);
    }
  }, [setId]);

  useEffect(() => {
    setRows([]);
    setSelected([]);
    setEditingUid(null);
    setDraft(null);
    setStatus({ text: '', tone: '' });
    setCategoryFilter('');
    load();
  }, [setId, load]);

  // Tell the editor, so closing it can ask first.
  useEffect(() => {
    if (onDirtyChange) onDirtyChange(dirty);
  }, [dirty, onDirtyChange]);

  // And guard the browser itself. A reload with unsaved questions in memory
  // loses them with no way back — the working copy is not persisted anywhere.
  useEffect(() => {
    if (!dirty) return undefined;
    const guard = (e) => { e.preventDefault(); e.returnValue = ''; return ''; };
    window.addEventListener('beforeunload', guard);
    return () => window.removeEventListener('beforeunload', guard);
  }, [dirty]);

  /* ------------------------------------------------- working-copy edits --- */

  const categories = useMemo(() => {
    const seen = [];
    for (const r of rows) if (r.category && !seen.includes(r.category)) seen.push(r.category);
    return seen;
  }, [rows]);

  const visibleRows = categoryFilter
    ? rows.filter((r) => r.category === categoryFilter)
    : rows;

  const startAdd = () => {
    const seedCategory = categoryFilter || rows[rows.length - 1]?.category || '';
    const row = blankRow({ category: seedCategory });
    setRows((current) => [...current, row]);
    setEditingUid(row.uid);
    setDraft(row);
    setStatus({ text: '', tone: '' });
  };

  const startEdit = (row) => {
    setEditingUid(row.uid);
    setDraft({ ...row });
  };

  const cancelEdit = () => {
    // A brand-new row abandoned before it was ever filled in leaves nothing
    // behind; anything else keeps whatever it had.
    setRows((current) => current.filter((r) => !(r.uid === editingUid && r.origin === 'new' && !r.title && !r.category)));
    setEditingUid(null);
    setDraft(null);
  };

  const commitEdit = () => {
    if (!draft) return;
    const problemsNow = rowProblems(draft, engagementType);
    if (problemsNow.length) {
      setStatus({ text: `That question ${problemsNow.join(', and ')}.`, tone: 'error' });
      return;
    }
    setRows((current) => current.map((r) => (r.uid === draft.uid
      ? { ...draft, edited: r.origin === 'loaded' ? true : r.edited }
      : r)));
    setEditingUid(null);
    setDraft(null);
    setStatus({ text: '', tone: '' });
  };

  const removeRow = (uid) => {
    setRows((current) => current
      // A row that was never saved has nothing to tombstone: drop it outright.
      .filter((r) => !(r.uid === uid && r.origin !== 'loaded'))
      .map((r) => (r.uid === uid ? { ...r, removed: true } : r)));
    setSelected((s) => s.filter((id) => id !== uid));
    if (editingUid === uid) { setEditingUid(null); setDraft(null); }
  };

  const restoreRow = (uid) =>
    setRows((current) => current.map((r) => (r.uid === uid ? { ...r, removed: false } : r)));

  const move = (uid, delta) => setRows((current) => moveRow(current, uid, delta));

  const toggleSelected = (uid) => setSelected((s) =>
    (s.includes(uid) ? s.filter((id) => id !== uid) : [...s, uid]));

  const discard = () => {
    setRows(baseline);
    setSelected([]);
    setEditingUid(null);
    setDraft(null);
    setConfirmDiscard(false);
    setStatus({ text: 'Unsaved changes discarded. The set is as it was when you opened it.', tone: 'pending' });
  };

  /** Questions pulled out of another set arrive here as independent copies. */
  const acceptPulled = (pulled) => {
    setShowPull(false);
    if (!pulled.length) return;
    setRows((current) => [...current, ...pulled]);
    setStatus({
      text: `${pulled.length} question${pulled.length === 1 ? '' : 's'} copied in. `
        + 'They are copies — editing them here will not change the originals. Nothing is saved until you press Save.',
      tone: 'pending'
    });
  };

  /* ------------------------------------------------------------- saving --- */

  /**
   * THE ONE WRITE PATH.
   *
   * `target` is either `{ replaceSetId }` — a new version of this set — or
   * `{ customTitle }` — a new set seeded from the same rows. Forking a set you
   * do not own and carving a subset out of one you do are the same operation
   * with a different target, which is why there is one function and not two.
   */
  const saveRows = async (rowsToSave, target, changeSummary) => {
    const csv = rowsToCsv(rowsToSave, engagementType, { renumber: changeSummary.reordered });
    const isReplace = Boolean(target.replaceSetId);
    const response = await authFetch(`${API_BASE()}admin/upload-questions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...target,
        fileName: isReplace ? 'console-edit.csv' : 'console-new-set.csv',
        fileContent: csv,
        engagementType,
        // What this version changed, in words. The field has always existed and
        // nothing has ever written it, so every version in the list reads the
        // same and a rollback is a guess between identical rows.
        versionNote: versionNote(changeSummary),
        // Provenance for a forked or carved-out set. Never read for permission.
        ...(isReplace ? {} : { sourceSetId: setId }),
      }),
    });
    const result = await response.json().catch(() => ({}));
    return { response, result };
  };

  const handleSave = async () => {
    if (problems.length) {
      setStatus({
        text: `${problems.length} question${problems.length === 1 ? '' : 's'} cannot be saved yet: `
          + problems.map((p) => `"${p.title || 'untitled'}" ${p.problems.join(' and ')}`).join('; ') + '.',
        tone: 'error'
      });
      return;
    }
    if (!summary.questionCount) {
      setStatus({ text: 'A set needs at least one question. Add one, or restore one you removed.', tone: 'error' });
      return;
    }
    // Not mine to replace: the save forks instead, and the person is told which
    // it will be before they press anything.
    if (!canManage) {
      setNewSetDialog({ mode: 'fork', title: `${setName} (adapted)`, rows: null });
      return;
    }

    setSaving(true);
    setStatus({ text: 'Saving...', tone: 'pending' });
    try {
      const { response, result } = await saveRows(rows, { replaceSetId: setId }, summary);
      if (response.ok) {
        const version = result.version != null ? `Version ${result.version}` : 'A new version';
        const skipped = Number(result.skippedRowCount || 0);
        setStatus({
          text: `${version} of "${setName}" is now live with ${result.questionCount} questions `
            + `(${describeRowChanges(summary) || 'no changes'}). `
            + (skipped ? `${skipped} row${skipped === 1 ? '' : 's'} could not be read and ${skipped === 1 ? 'was' : 'were'} skipped. ` : '')
            + 'The previous version is kept and can be promoted back.',
          tone: 'success'
        });
        await load();
        if (onChanged) onChanged();
      } else if (response.status === 403) {
        // The handler's refusal, surfaced as the offer it implies. Reaching
        // here means the list said this set was manageable and the server
        // disagreed — the server is right, and the work is not lost.
        setNewSetDialog({ mode: 'fork', title: `${setName} (adapted)`, rows: null });
        setStatus({
          text: 'This set belongs to someone else, so it cannot be replaced. '
            + 'Your changes are still here — save them as your own copy.',
          tone: 'pending'
        });
      } else {
        setStatus({
          text: `Save failed: ${result.error || `HTTP ${response.status}`} — nothing was written, `
            + 'and your changes are still here.',
          tone: 'error'
        });
      }
    } catch (error) {
      console.error('Save questions error:', error);
      setStatus({
        text: `Save failed: ${error.message} — nothing was written, and your changes are still here.`,
        tone: 'error'
      });
    } finally {
      setSaving(false);
    }
  };

  /** Fork, or carve a subset out. One path; only the rows and the title differ. */
  const handleSaveAsNewSet = async () => {
    if (!newSetDialog) return;
    const title = String(newSetDialog.title || '').trim();
    if (!title) {
      setStatus({ text: 'The new set needs a name.', tone: 'error' });
      return;
    }
    const chosen = (newSetDialog.rows || rows).filter((r) => !r.removed);
    // Provenance, write-once: a row copied in from a third set keeps ITS
    // origin, because that is the truer answer to "where did this come from".
    const stamped = chosen.map((r) => ({
      ...r,
      sourceSetId: r.sourceSetId || setId,
      sourceQuestionSk: r.sourceQuestionSk || r.sk,
    }));

    setSaving(true);
    setStatus({ text: `Creating "${title}"...`, tone: 'pending' });
    try {
      const { response, result } = await saveRows(
        stamped,
        {
          customTitle: title,
          customDescription: `Adapted from "${setName}".`,
        },
        summarizeRowChanges(stamped, [])
      );
      if (response.ok) {
        setNewSetDialog(null);
        setStatus({
          text: `Created "${result.setName || title}" with ${result.questionCount} questions, and it is yours. `
            + `"${setName}" was not changed`
            + (newSetDialog.mode === 'fork' && dirty
              ? ' — your edits live in the new set now, and this one still shows them as unsaved.'
              : '.'),
          tone: 'success'
        });
        if (onChanged) onChanged();
      } else {
        setStatus({
          text: `Could not create "${title}": ${result.error || `HTTP ${response.status}`}. Your changes are still here.`,
          tone: 'error'
        });
      }
    } catch (error) {
      console.error('Create set from working copy error:', error);
      setStatus({ text: `Could not create "${title}": ${error.message}`, tone: 'error' });
    } finally {
      setSaving(false);
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
    setStatus({ text: 'Downloading question set...', tone: 'pending' });
    try {
      const response = await authFetch(`${API_BASE()}admin/download-question-set/${setId}`);
      const text = await response.text();

      if (!response.ok) {
        let error = `HTTP ${response.status}`;
        try { error = JSON.parse(text).error || error; } catch (_) { /* not JSON */ }
        setStatus({ text: `Download failed: ${error}`, tone: 'error' });
        return;
      }

      // download-question-set.js answers { filename, content, contentType }.
      // Tolerate a raw CSV body too, so a route that later starts streaming the
      // file does not break this button.
      let filename = `${(setName || setId).replace(/[^a-zA-Z0-9-_]/g, '_')}.csv`;
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
      setStatus({ text: `${filename} downloaded`, tone: 'success' });
    } catch (error) {
      console.error('Download question set error:', error);
      setStatus({ text: `Download failed: ${error.message}`, tone: 'error' });
    }
  };

  /* ------------------------------------------------- replace from a file --- */

  const handleReplaceFileSelect = (event) => {
    const file = event.target.files && event.target.files[0];
    setPreview(null);
    setReplaceFile(null);
    if (!file) return;

    if (!/\.csv$/i.test(file.name)) {
      setStatus({ text: 'Please select a CSV file', tone: 'error' });
      return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
      const csvSummary = summarizeCsv(e.target.result);
      if (csvSummary.error) {
        setStatus({ text: csvSummary.error, tone: 'error' });
        return;
      }
      setReplaceFile(file);
      setPreview({ ...csvSummary, content: e.target.result, fileName: file.name });
      setStatus({
        text: (csvSummary.warning ? `${csvSummary.warning} ` : `Read ${file.name}. Review the change below, then confirm. `)
          + (dirty ? 'This file replaces the whole set — the unsaved edits above will be dropped.' : ''),
        tone: csvSummary.warning || dirty ? 'pending' : 'success'
      });
    };
    reader.onerror = () => setStatus({ text: `Could not read ${file.name}`, tone: 'error' });
    reader.readAsText(file);
  };

  const handleReplace = async () => {
    if (!preview || !replaceFile) return;
    setIsReplacing(true);
    setStatus({ text: 'Uploading new version...', tone: 'pending' });
    try {
      // replaceSetId is what turns this from "create a set" into "write a new
      // version of this set". Title and description are deliberately NOT sent:
      // they belong to the details form, and a CSV must never silently rename
      // the set it replaces.
      const response = await authFetch(`${API_BASE()}admin/upload-questions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          replaceSetId: setId,
          fileName: replaceFile.name,
          fileContent: preview.content,
          engagementType,
          versionNote: `Replaced from ${replaceFile.name}.`,
        }),
      });

      const result = await response.json();

      if (response.ok) {
        const version = result.version != null ? `Version ${result.version}` : 'A new version';
        const count = result.questionCount != null ? ` with ${result.questionCount} questions` : '';
        // The importer reports rows it could not use. Say so — an import that
        // quietly drops half a file otherwise looks like a clean success.
        const skipped = Number(result.skippedRowCount || 0);
        setStatus({
          text: `${version} of "${setName}" is now live${count}. `
            + (skipped
              ? `${skipped} row${skipped === 1 ? '' : 's'} in the file could not be read and ${skipped === 1 ? 'was' : 'were'} skipped. `
              : '')
            + 'The previous version is still listed below and can be promoted back.',
          tone: 'success'
        });
        setReplaceFile(null);
        setPreview(null);
        if (replaceInputRef.current) replaceInputRef.current.value = '';
        await load();
        if (onChanged) onChanged();
      } else {
        // Nothing was written: the lambda validates the whole file before it
        // touches a single row, and the flip to the new version is one write.
        setStatus({
          text: `Upload failed: ${result.error || 'Unknown error'} — nothing changed, the current version is still live.`,
          tone: 'error'
        });
      }
    } catch (error) {
      console.error('Replace question set error:', error);
      setStatus({ text: `Upload failed: ${error.message}`, tone: 'error' });
    } finally {
      setIsReplacing(false);
    }
  };

  /* -------------------------------------------------------------- render --- */

  const kindLabel = (id) => ROUND_KINDS[id]?.label || id;
  const showKind = roundKindApplies(engagementType);
  const saveLabel = canManage
    ? `Save${plannedVersion ? ` as version ${plannedVersion}` : ''}`
    : 'Save as my own copy…';

  return (
    <section className="qs-panel qs-questions" data-testid="questions-panel">
      <div className="qs-panel-header">
        <h3><Icon name="Books" weight="bold" size={16} color="currentColor" /> Questions</h3>
        <span className="qs-panel-note">
          {canManage
            ? 'Edit here, then Save once — one save is one new version'
            : 'This set belongs to someone else. Edit it freely; saving makes your own copy and leaves the original alone'}
        </span>
      </div>

      {/* The dirty bar. It is the whole answer to "did I lose my work?" and it
          says what is unsaved, in words, with both ways out. */}
      {dirty && (
        <div className="qs-dirty-bar" data-testid="unsaved-bar" role="status">
          <div className="qs-dirty-text">
            <Icon name="Warning" weight="fill" size={16} color="#8a5300" />{' '}
            <strong>Unsaved: {describeRowChanges(summary)}.</strong>{' '}
            Nothing has been written yet — {summary.questionCount} question
            {summary.questionCount === 1 ? '' : 's'} will be saved
            {canManage
              ? `${plannedVersion ? ` as version ${plannedVersion}` : ' as a new version'}.`
              : ' into a new set of your own.'}
          </div>
          <div className="qs-dirty-actions">
            <button className="btn-primary btn-small" onClick={handleSave} disabled={saving}>
              <Icon name="FloppyDisk" weight="bold" size={14} color="currentColor" />{' '}
              {saving ? 'Saving...' : saveLabel}
            </button>
            <button className="btn-secondary btn-small" onClick={() => setConfirmDiscard(true)} disabled={saving}>
              Discard changes
            </button>
          </div>
        </div>
      )}

      <div className="qs-panel-actions">
        <button className="btn-primary btn-small" onClick={startAdd} disabled={loadState !== 'ready'}>
          <Icon name="Plus" weight="bold" size={14} color="currentColor" /> Add a question
        </button>
        <button
          className="btn-secondary btn-small"
          onClick={() => setShowPull(true)}
          disabled={loadState !== 'ready'}
        >
          <Icon name="Books" weight="bold" size={14} color="currentColor" /> Pull from another set
        </button>
        {selected.length > 0 && (
          <button
            className="btn-secondary btn-small"
            onClick={() => setNewSetDialog({
              mode: 'subset',
              title: `${setName} — selection`,
              rows: rows.filter((r) => selected.includes(r.uid)),
            })}
          >
            Save {selected.length} selected as a new set…
          </button>
        )}
        {categories.length > 1 && (
          <label className="qs-filter">
            Filter by category:{' '}
            <select
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
              className="form-select"
            >
              <option value="">All categories</option>
              {categories.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </label>
        )}
      </div>

      {loadState === 'loading' && <p className="qs-empty">Loading questions…</p>}
      {loadState === 'error' && (
        <StatusMessage message={`${loadError} Nothing has been changed.`} tone="error" />
      )}

      {loadState === 'ready' && visibleRows.length === 0 && (
        <p className="qs-empty">
          {rows.length
            ? 'No questions in that category.'
            : 'This set has no questions yet. Add one, or pull some from another set.'}
        </p>
      )}

      {loadState === 'ready' && visibleRows.length > 0 && (
        <ol className="qs-question-list">
          {visibleRows.map((row) => {
            const rowIndex = rows.indexOf(row);
            const badge = row.removed ? 'Removed'
              : row.origin === 'new' ? 'Added'
                : row.origin === 'copied' ? 'Copied in'
                  : row.edited ? 'Edited' : '';
            return (
              <li
                key={row.uid}
                className={`qs-question-row${row.removed ? ' removed' : ''}${badge && !row.removed ? ' changed' : ''}`}
                data-testid={`question-${rowIndex}`}
              >
                <div className="qs-question-main">
                  {!row.removed && (
                    <input
                      type="checkbox"
                      className="qs-question-select"
                      checked={selected.includes(row.uid)}
                      onChange={() => toggleSelected(row.uid)}
                      aria-label={`Select ${row.title || 'untitled question'}`}
                    />
                  )}
                  <div className="qs-question-text">
                    <div className="qs-question-title">
                      <strong>{row.title || <em>Untitled question</em>}</strong>
                      {badge && <span className={`qs-change-badge ${badge.split(' ')[0].toLowerCase()}`}>{badge}</span>}
                    </div>
                    <div className="qs-question-meta">
                      <span>{row.category || 'no category'}</span>
                      {showKind && row.roundKind && <span>{kindLabel(row.roundKind)}</span>}
                      {row.sourceSetId && <span>from {row.sourceSetId}</span>}
                      {engagementType === 'trivia' && row.correctAnswer && <span>answer: {row.correctAnswer}</span>}
                      {row.detail && <span className="qs-question-detail">{row.detail.slice(0, 90)}{row.detail.length > 90 ? '…' : ''}</span>}
                    </div>
                  </div>
                  <div className="qs-question-actions">
                    {row.removed ? (
                      <button className="btn-secondary btn-small" onClick={() => restoreRow(row.uid)}>
                        <Icon name="ArrowCounterClockwise" weight="bold" size={14} color="currentColor" />{' '}
                        Restore
                      </button>
                    ) : (
                      <>
                        <button
                          className="btn-secondary btn-small"
                          onClick={() => move(row.uid, -1)}
                          disabled={rowIndex === 0 || Boolean(categoryFilter)}
                          aria-label={`Move ${row.title || 'question'} up`}
                          title={categoryFilter ? 'Clear the category filter to reorder' : 'Move up'}
                        >
                          <Icon name="ArrowUp" weight="bold" size={14} color="currentColor" />
                        </button>
                        <button
                          className="btn-secondary btn-small"
                          onClick={() => move(row.uid, 1)}
                          disabled={rowIndex === rows.length - 1 || Boolean(categoryFilter)}
                          aria-label={`Move ${row.title || 'question'} down`}
                          title={categoryFilter ? 'Clear the category filter to reorder' : 'Move down'}
                        >
                          <Icon name="ArrowDown" weight="bold" size={14} color="currentColor" />
                        </button>
                        <button className="btn-secondary btn-small" onClick={() => startEdit(row)}>
                          <Icon name="PencilSimple" weight="bold" size={14} color="currentColor" /> Edit
                        </button>
                        <button
                          className="btn-danger btn-small"
                          onClick={() => removeRow(row.uid)}
                          aria-label={`Remove ${row.title || 'question'}`}
                        >
                          <Icon name="Trash" weight="bold" size={14} color="currentColor" /> Remove
                        </button>
                      </>
                    )}
                  </div>
                </div>

                {editingUid === row.uid && draft && (
                  <QuestionForm
                    draft={draft}
                    engagementType={engagementType}
                    showKind={showKind}
                    onChange={setDraft}
                    onCancel={cancelEdit}
                    onDone={commitEdit}
                  />
                )}
              </li>
            );
          })}
        </ol>
      )}

      {status.text && <StatusMessage message={status.text} tone={status.tone} />}

      {/* Save is also here, at the bottom of the list, because a long set puts
          the dirty bar off screen exactly when it matters most. */}
      {loadState === 'ready' && (
        <div className="qs-panel-actions">
          <button
            className="btn-primary"
            onClick={handleSave}
            disabled={!dirty || saving}
            title={dirty ? undefined : 'Nothing has changed yet'}
          >
            <Icon name="FloppyDisk" weight="bold" size={16} color="currentColor" />{' '}
            {saving ? 'Saving...' : saveLabel}
          </button>
          {dirty && (
            <button className="btn-secondary" onClick={() => setConfirmDiscard(true)} disabled={saving}>
              Discard changes
            </button>
          )}
          <button className="btn-secondary" onClick={handleDownload}>
            <Icon name="DownloadSimple" weight="bold" size={16} color="currentColor" /> Download CSV
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
              {replaceFile ? replaceFile.name : 'Replace every question from a CSV...'}
            </label>
          </div>
        </div>
      )}

      {preview && (
        <div className="qs-replace-preview">
          <h4>
            <Icon name="Info" weight="bold" size={16} color="var(--primary)" /> Before you replace
          </h4>
          <ul className="qs-preview-lines">
            {describeReplacePlan(questionSet || {}, preview, plannedVersion).map((line) => (
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
              {isReplacing ? 'Uploading...' : `Replace questions with ${preview.fileName}`}
            </button>
            <button
              className="btn-secondary"
              onClick={() => {
                setPreview(null);
                setReplaceFile(null);
                if (replaceInputRef.current) replaceInputRef.current.value = '';
                setStatus({ text: '', tone: '' });
              }}
              disabled={isReplacing}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {showPull && (
        <QuestionPullDialog
          currentSetId={setId}
          engagementType={engagementType}
          availableSets={availableSets}
          onCancel={() => setShowPull(false)}
          onCopy={acceptPulled}
        />
      )}

      {confirmDiscard && (
        <div className="modal-overlay" onClick={() => setConfirmDiscard(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <h3><Icon name="Warning" weight="fill" size={16} color="var(--primary)" /> Discard your changes?</h3>
            <p>
              {describeRowChanges(summary)} — none of it has been saved. Discarding puts the set
              back exactly as it was when you opened it, and there is no way to get the edits back.
            </p>
            <div className="modal-actions">
              <button className="btn-secondary" onClick={() => setConfirmDiscard(false)}>
                Keep editing
              </button>
              <button className="btn-danger" onClick={discard}>Discard changes</button>
            </div>
          </div>
        </div>
      )}

      {newSetDialog && (
        <div className="modal-overlay" onClick={() => setNewSetDialog(null)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <h3>
              <Icon name="Plus" weight="bold" size={16} color="var(--primary)" />{' '}
              {newSetDialog.mode === 'fork' ? 'Save this as your own copy' : 'New set from your selection'}
            </h3>
            <p>
              {newSetDialog.mode === 'fork'
                ? `"${setName}" belongs to someone else, so it cannot be changed. This creates a new set that is yours, `
                  + 'with the questions as you have them here. The original is left exactly as it is.'
                : `This creates a new set from the ${(newSetDialog.rows || []).length} question`
                  + `${(newSetDialog.rows || []).length === 1 ? '' : 's'} you selected. `
                  + `They become copies — editing them there will not change "${setName}".`}
            </p>
            <div className="form-group">
              <label htmlFor="new-set-title">Name the new set</label>
              <input
                id="new-set-title"
                type="text"
                className="form-input"
                value={newSetDialog.title}
                onChange={(e) => setNewSetDialog({ ...newSetDialog, title: e.target.value })}
              />
            </div>
            <div className="modal-actions">
              <button className="btn-secondary" onClick={() => setNewSetDialog(null)} disabled={saving}>
                Cancel
              </button>
              <button className="btn-primary" onClick={handleSaveAsNewSet} disabled={saving}>
                {saving ? 'Creating...' : 'Create the set'}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

/**
 * One question's fields, per engagement type.
 *
 * Every field the row carries is editable EXCEPT the ones the editor has no
 * business rewriting by hand — the stored key and the provenance stamp. What is
 * not on screen is still carried: the row object is the whole question, so a
 * field this form never renders survives the save untouched (asserted in
 * tests/question-set-roundtrip.js, "keeps every field the form never showed").
 */
function QuestionForm({ draft, engagementType, showKind, onChange, onCancel, onDone }) {
  const set = (field) => (e) => onChange({ ...draft, [field]: e.target.value });
  const id = (field) => `q-${field}-${draft.uid}`;

  return (
    <div className="qs-question-form">
      <div className="qs-form-grid">
        <div className="form-group">
          <label htmlFor={id('category')}>Category *</label>
          <input id={id('category')} className="form-input" value={draft.category} onChange={set('category')} />
        </div>
        <div className="form-group">
          <label htmlFor={id('title')}>Title *</label>
          <input id={id('title')} className="form-input" value={draft.title} onChange={set('title')} />
        </div>
      </div>

      <div className="form-group">
        <label htmlFor={id('detail')}>
          {engagementType === 'trivia' ? 'Question detail' : 'Detail shown to the room'}
        </label>
        <textarea id={id('detail')} className="form-textarea" rows="3" value={draft.detail} onChange={set('detail')} />
      </div>

      {engagementType === 'trivia' && (
        <>
          <div className="qs-form-grid">
            {['A', 'B', 'C', 'D', 'E', 'F'].map((letter) => (
              <div className="form-group" key={letter}>
                <label htmlFor={id(`option${letter}`)}>Option {letter}</label>
                <input
                  id={id(`option${letter}`)}
                  className="form-input"
                  value={draft[`option${letter}`]}
                  onChange={set(`option${letter}`)}
                />
              </div>
            ))}
          </div>
          <div className="qs-form-grid">
            <div className="form-group">
              <label htmlFor={id('correctAnswer')}>Correct answer</label>
              <select id={id('correctAnswer')} className="form-select" value={draft.correctAnswer} onChange={set('correctAnswer')}>
                <option value="">Choose one</option>
                {['A', 'B', 'C', 'D', 'E', 'F']
                  .filter((l) => draft[`option${l}`])
                  .map((l) => <option key={l} value={`Option${l}`}>Option {l}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label htmlFor={id('difficulty')}>Difficulty</label>
              <select id={id('difficulty')} className="form-select" value={draft.difficulty || 'medium'} onChange={set('difficulty')}>
                {['easy', 'medium', 'hard'].map((d) => <option key={d} value={d}>{d}</option>)}
              </select>
            </div>
          </div>
        </>
      )}

      {engagementType === 'poll' && (
        <div className="qs-form-grid">
          <div className="form-group">
            <label htmlFor={id('options')}>Options (one per line)</label>
            <textarea
              id={id('options')}
              className="form-textarea"
              rows="4"
              value={(draft.options || []).join('\n')}
              onChange={(e) => onChange({
                ...draft,
                options: e.target.value.split('\n').map((o) => o.trim()).filter(Boolean),
              })}
            />
          </div>
          <div className="form-group">
            <label htmlFor={id('allowMultiple')}>Answers allowed</label>
            <select
              id={id('allowMultiple')}
              className="form-select"
              value={draft.allowMultiple ? 'many' : 'one'}
              onChange={(e) => onChange({ ...draft, allowMultiple: e.target.value === 'many' })}
            >
              <option value="one">Pick one</option>
              <option value="many">Pick as many as apply</option>
            </select>
          </div>
        </div>
      )}

      {showKind && (
        <div className="qs-form-grid">
          <div className="form-group">
            <label htmlFor={id('roundKind')}>Round direction</label>
            <select id={id('roundKind')} className="form-select" value={draft.roundKind} onChange={set('roundKind')}>
              <option value="">Inherit the set's direction</option>
              {ROUND_KIND_IDS.map((k) => (
                <option key={k} value={k}>{ROUND_KINDS[k]?.label || k}</option>
              ))}
            </select>
          </div>
          <div className="form-group">
            <label htmlFor={id('sourceAttribution')}>Whose material is this?</label>
            <input
              id={id('sourceAttribution')}
              className="form-input"
              value={draft.sourceAttribution}
              onChange={set('sourceAttribution')}
              placeholder="Only for Apply rounds — e.g. Gary Klein, Performing a Project Premortem"
            />
          </div>
        </div>
      )}

      <div className="qs-form-grid">
        <div className="form-group">
          <label htmlFor={id('customInstruction')}>Instruction shown to the room</label>
          <input id={id('customInstruction')} className="form-input" value={draft.customInstruction} onChange={set('customInstruction')} />
        </div>
        <div className="form-group">
          <label htmlFor={id('school')}>School / source</label>
          <input id={id('school')} className="form-input" value={draft.school} onChange={set('school')} />
        </div>
      </div>

      <div className="qs-form-grid">
        <div className="form-group">
          <label htmlFor={id('answerDetails')}>Reveal (shown only after the round)</label>
          <input id={id('answerDetails')} className="form-input" value={draft.answerDetails} onChange={set('answerDetails')} />
        </div>
        <div className="form-group">
          <label htmlFor={id('tags')}>Tags</label>
          <input
            id={id('tags')}
            className="form-input"
            value={(draft.tags || []).join(', ')}
            onChange={(e) => onChange({ ...draft, tags: toTagList(e.target.value) })}
          />
        </div>
      </div>

      <div className="qs-panel-actions">
        <button className="btn-primary btn-small" onClick={onDone}>Done</button>
        <button className="btn-secondary btn-small" onClick={onCancel}>Cancel</button>
        <span className="qs-panel-note">
          Nothing is written until you Save the set.
        </span>
      </div>
    </div>
  );
}
