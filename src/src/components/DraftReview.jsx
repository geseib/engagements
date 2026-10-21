import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Icon from './Icon';
import PlanLimitNotice from './PlanLimitNotice';
import { authFetch } from '../auth/authFetch';
import {
  DRAFT_STATUS, getDraft, updateDraftItems, cancelDraft, discardDraft, restoreDraft,
  acceptNewSetDraft, libraryHeaders, groupByCategory, itemDefect, draftNoun, tokenEstimate,
} from '../utils/draftsApi';
import { acceptIntoSet, undoAccept } from '../utils/draftAccept';
import { libraryLabel, ENGAGE_KEY } from '../utils/libraries';
import { parseUpgradeRequired } from '../utils/upgradeRequired';
import { SET_TOPICS, SET_TOPIC_IDS } from '../config/setTopics';
import './DraftReview.css';

/**
 * THE REVIEW OF AN AI DRAFT — what a generation run produced, before any of it
 * is saved. docs/design/ai-generation-review/README.md, and the owner's words:
 * "an approval to accept the work that was created, and a new version of the
 * question set is created … cost effective and reversible (both at the
 * acceptance phase and after (via versioning))."
 *
 * ONE SCREEN FOR BOTH KINDS OF RUN:
 *   - a NEW set: accepting makes the set, in the library the draft names,
 *     switched on (or left off, if the person says so);
 *   - ADDING to a set: accepting writes ONE new version of that set with the
 *     kept questions (utils/draftAccept.js), and Undo puts the previous
 *     version back.
 *
 * NOTHING HERE CALLS THE MODEL except the two buttons that say they do —
 * "Regenerate this category" and "Generate the remaining N" — and each states
 * its size before it is pressed. Reading, keeping, leaving out and editing are
 * free, and the draft is saved as you go: closing loses nothing.
 *
 * `libraryKey` is the draft's library (an org id, or Engage). Every request
 * carries it, so a review opened from the bell works whichever library the
 * console is standing in.
 */
const POLL_MS = 5000;
const GENERATORS = {
  trivia: 'admin/ai-generate-trivia',
  scenarios: 'admin/ai-generate-scenarios',
  poll: 'admin/ai-generate-polls',
  survey: 'admin/ai-generate-survey',
};
const OPTION_KEYS = ['optionA', 'optionB', 'optionC', 'optionD', 'optionE', 'optionF'];
const apiBase = () => (typeof window !== 'undefined' && window.API_BASE) || '';

const when = (iso) => {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
};

function itemBody(item, engagementType) {
  if (engagementType === 'trivia') return item.questionDetail || '';
  return item.detail || '';
}

export default function DraftReview({
  draftId,
  libraryKey = '',
  libraries = [],
  onClose,
  onChanged,
  onOpenSet,
  /** A sentence saying why accepting must wait (the editor has unsaved edits), or ''. */
  blockAccept = '',
}) {
  const [draft, setDraft] = useState(null);
  const [items, setItems] = useState([]);
  const [loadError, setLoadError] = useState('');
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState(null); // { tone, text }
  const [planLimit, setPlanLimit] = useState(null);
  const [editing, setEditing] = useState(null); // { seq, item }
  const [regen, setRegen] = useState(null); // { category, count } | { remaining, count }
  const [guidance, setGuidance] = useState('');
  const [name, setName] = useState('');
  const [topic, setTopic] = useState('');
  const [activate, setActivate] = useState(true);
  const [result, setResult] = useState(null);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const nameTouched = useRef(false);

  const where = libraryLabel(libraryKey || (draft && draft.orgId) || (draft ? ENGAGE_KEY : ''), libraries);

  const load = useCallback(async () => {
    const res = await getDraft(draftId, libraryKey);
    if (!res.ok) {
      setLoadError(res.status === 404
        ? 'This draft is gone — it was decided already, or it expired.'
        : (res.data.error || `The draft could not be read (HTTP ${res.status}).`));
      return null;
    }
    setLoadError('');
    setDraft(res.data.draft);
    setItems(res.data.items || []);
    if (!nameTouched.current) setName(res.data.draft.title || '');
    if (res.data.draft.topic) setTopic(res.data.draft.topic);
    return res.data.draft;
  }, [draftId, libraryKey]);

  useEffect(() => { load(); }, [load]);

  /* Poll only while a run is writing into it. */
  useEffect(() => {
    if (!draft || ![DRAFT_STATUS.GENERATING, DRAFT_STATUS.ACCEPTING].includes(draft.status)) return undefined;
    const t = setTimeout(() => { load(); }, POLL_MS);
    return () => clearTimeout(t);
  }, [draft, load]);

  const engagementType = draft ? draft.engagementType : '';
  const noun = draftNoun(engagementType);
  const groups = useMemo(() => groupByCategory(items), [items]);
  const kept = items.filter((it) => it.decision !== 'leave');
  const keptWithDefects = kept.filter((it) => itemDefect(it.item, engagementType));
  const isAppend = draft && draft.mode === 'append';
  const reviewable = draft && (draft.status === DRAFT_STATUS.READY || draft.status === DRAFT_STATUS.FAILED);
  const missing = draft ? Math.max(0, (draft.requested || 0) - items.length) : 0;
  const canRegenerate = draft && engagementType !== 'survey' && GENERATORS[draft.kind];

  // ── keep / leave / edit (free: no model call) ─────────────────────────
  const setDecision = async (seqs, decision) => {
    setItems((list) => list.map((it) => (seqs.includes(it.seq) ? { ...it, decision } : it)));
    const res = await updateDraftItems(draftId, seqs.map((seq) => ({ seq, decision })), libraryKey);
    if (!res.ok) { setMessage({ tone: 'error', text: res.data.error || 'That change was not saved.' }); load(); }
  };

  const saveEdit = async () => {
    if (!editing) return;
    setBusy('edit');
    const res = await updateDraftItems(draftId, [{ seq: editing.seq, item: editing.item }], libraryKey);
    setBusy('');
    if (!res.ok) { setMessage({ tone: 'error', text: res.data.error || 'The edit was not saved.' }); return; }
    setItems((list) => list.map((it) => (it.seq === editing.seq ? { ...it, item: editing.item, edited: true } : it)));
    setEditing(null);
  };

  // ── the two buttons that cost something ───────────────────────────────
  const runRegenerate = async () => {
    if (!regen || !draft) return;
    setBusy('regen');
    const body = {
      draftId,
      regenerate: regen.category ? { category: regen.category, count: regen.count } : { remaining: true, count: regen.count },
      ...(guidance.trim() ? { batchGuidance: guidance.trim().slice(0, 500) } : {}),
    };
    const res = await authFetch(`${apiBase()}${GENERATORS[draft.kind]}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...libraryHeaders(libraryKey) },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    setBusy('');
    if (!res.ok) { setMessage({ tone: 'error', text: data.error || `Regenerating failed (HTTP ${res.status}).` }); return; }
    setRegen(null);
    setGuidance('');
    setMessage({ tone: 'pending', text: 'Writing — the draft fills in here as it lands. You can close this; the bell says when it is ready.' });
    load();
  };

  const stop = async () => {
    setBusy('stop');
    const res = await cancelDraft(draftId, libraryKey);
    setBusy('');
    setMessage(res.ok
      ? { tone: 'pending', text: 'Stopping after the pass that is already running. What it wrote is kept.' }
      : { tone: 'error', text: res.data.error || 'Could not stop it.' });
    load();
  };

  // ── decide ─────────────────────────────────────────────────────────────
  const accept = async () => {
    if (!draft || !kept.length) return;
    if (blockAccept) { setMessage({ tone: 'error', text: blockAccept }); return; }
    if (keptWithDefects.length && !window.confirm(
      `${keptWithDefects.length} of the kept ${noun} ${keptWithDefects.length === 1 ? 'has a problem' : 'have problems'} (marked below). Accept anyway?`,
    )) return;
    setBusy('accept');
    setMessage(null);
    setPlanLimit(null);
    if (isAppend) {
      const out = await acceptIntoSet(draft, libraryKey);
      setBusy('');
      if (!out.ok) {
        if (out.planLimit) setPlanLimit(out.planLimit);
        setMessage({ tone: 'error', text: out.error });
        load();
        return;
      }
      setResult({ mode: 'append', ...out });
    } else {
      const res = await acceptNewSetDraft(draftId, {
        activate: activate && Boolean(topic),
        title: name.trim(),
        ...(topic ? { topic } : {}),
      }, libraryKey);
      setBusy('');
      if (!res.ok) {
        const limit = parseUpgradeRequired(res.status, res.data);
        if (limit) setPlanLimit(limit);
        setMessage({ tone: 'error', text: res.data.error || `The set was not saved (HTTP ${res.status}).` });
        load();
        return;
      }
      setResult({ mode: 'new', ...res.data });
    }
    if (onChanged) onChanged();
  };

  const undo = async () => {
    setBusy('undo');
    const res = await undoAccept(draftId, libraryKey);
    setBusy('');
    if (!res.ok) { setMessage({ tone: 'error', text: res.data.error || 'Undo failed.' }); return; }
    // The draft now records the undo; reading it back shows the undone state.
    setResult(null);
    await load();
    setMessage({ tone: 'success', text: `Back on version ${res.data.activeVersion}. The version this draft made is kept in Versions.` });
    if (onChanged) onChanged();
  };

  const discard = async () => {
    setBusy('discard');
    const res = await discardDraft(draftId, libraryKey);
    setBusy('');
    setConfirmDiscard(false);
    if (!res.ok) { setMessage({ tone: 'error', text: res.data.error || 'Could not discard it.' }); return; }
    setResult({ mode: 'discarded' });
    if (onChanged) onChanged();
  };

  const restore = async () => {
    setBusy('restore');
    const res = await restoreDraft(draftId, libraryKey);
    setBusy('');
    if (!res.ok) { setMessage({ tone: 'error', text: res.data.error || 'Could not restore it.' }); return; }
    setResult(null);
    setMessage({ tone: 'success', text: 'Restored. It is back for review.' });
    load();
    if (onChanged) onChanged();
  };

  // ── render ─────────────────────────────────────────────────────────────
  if (loadError) {
    return (
      <section className="drv" data-theme="dark" aria-label="AI draft">
        <p className="drv-msg drv-msg--error" role="alert">{loadError}</p>
        <div className="drv-actions"><button type="button" className="drv-btn" onClick={onClose}>Back</button></div>
      </section>
    );
  }
  if (!draft) {
    return <section className="drv" data-theme="dark" aria-label="AI draft"><p className="drv-dim">Opening the draft…</p></section>;
  }

  /*
    A DRAFT ALREADY DECIDED — opened from the strip or an old link — shows
    what was decided and the way back: Restore for a discard (seven days),
    Undo for an addition still live.
  */
  const decided = result || (draft.status === DRAFT_STATUS.DISCARDED ? { mode: 'discarded' }
    : draft.status === DRAFT_STATUS.ACCEPTED ? {
      mode: draft.mode === 'append' ? 'append' : 'new',
      version: draft.acceptedVersion,
      previousVersion: draft.previousVersion,
      kept: draft.keptCount,
      left: draft.leftCount,
      setId: draft.acceptedSetId,
      setName: draft.title,
      undone: Boolean(draft.undoneAt),
      active: null,
    } : null);

  if (decided) {
    return (
      <section className="drv" data-theme="dark" aria-label="AI draft">
        {decided.mode === 'discarded' ? (
          <>
            <h2 className="drv-h">Draft discarded</h2>
            <p className="drv-lead">Nothing was saved and nothing in {where} changed. You can restore this draft for 7 days.</p>
            <div className="drv-actions">
              <button type="button" className="drv-btn" onClick={restore} disabled={busy === 'restore'}>
                <Icon name="ArrowCounterClockwise" size={14} color="currentColor" /> Restore it
              </button>
              <button type="button" className="drv-btn drv-btn--primary" onClick={onClose}>Done</button>
            </div>
          </>
        ) : decided.mode === 'append' ? (
          <>
            <h2 className="drv-h">{decided.undone ? 'Undone' : `Version ${decided.version ?? ''} saved`}</h2>
            <p className="drv-lead">
              {decided.undone
                ? `“${draft.title}” is back on version ${decided.previousVersion}.`
                : `${decided.kept} ${noun} added to “${draft.title}” in ${where}${decided.left ? `; ${decided.left} left out` : ''}. `
                  + `Version ${decided.previousVersion} is kept.`}
            </p>
            {message && <p className={`drv-msg drv-msg--${message.tone}`} role="status">{message.text}</p>}
            <div className="drv-actions">
              {!decided.undone && decided.previousVersion != null && (
                <button type="button" className="drv-btn" onClick={undo} disabled={busy === 'undo'}>
                  <Icon name="ArrowCounterClockwise" size={14} color="currentColor" /> Undo — back to version {decided.previousVersion}
                </button>
              )}
              {onOpenSet && (
                <button type="button" className="drv-btn" onClick={() => onOpenSet(draft.targetSetId)}>Open the set</button>
              )}
              <button type="button" className="drv-btn drv-btn--primary" onClick={onClose}>Done</button>
            </div>
          </>
        ) : (
          <>
            <h2 className="drv-h">“{decided.setName}” saved</h2>
            <p className="drv-lead">
              {decided.kept} {noun} saved as a new set in {where}
              {decided.active === null ? '.' : `, ${decided.active ? 'switched on' : 'switched off for now'}.`}
              {' '}To share it beyond {where}, publish it from the set once you are happy with it.
            </p>
            <div className="drv-actions">
              {onOpenSet && (
                <button type="button" className="drv-btn" onClick={() => onOpenSet(decided.setId)}>Open the set</button>
              )}
              <button type="button" className="drv-btn drv-btn--primary" onClick={onClose}>Done</button>
            </div>
          </>
        )}
      </section>
    );
  }

  const generating = draft.status === DRAFT_STATUS.GENERATING;
  const failedEmpty = draft.status === DRAFT_STATUS.FAILED && items.length === 0;

  return (
    <section className="drv" data-theme="dark" aria-label="AI draft" data-testid="draft-review">
      <header className="drv-head">
        <div className="drv-grow">
          <h2 className="drv-h">
            {generating ? `Writing ${noun}…` : `${items.length} ${noun} to review`}
          </h2>
          <p className="drv-dest" data-testid="draft-destination">
            <Icon name="Books" size={14} color="currentColor" />{' '}
            {isAppend
              ? <>Adds to <b>“{draft.title}”</b> in <b>{where}</b>. Nothing changes in the set until you accept.</>
              : <>A new set in <b>{where}</b>. It is saved only when you accept.</>}
          </p>
          <p className="drv-dim">
            Generated {when(draft.createdAt)}
            {draft.daysLeft != null && reviewable && <> · kept for {draft.daysLeft} more day{draft.daysLeft === 1 ? '' : 's'}</>}
            {draft.usage && draft.usage.outputTokens > 0 && <> · used {draft.usage.outputTokens.toLocaleString('en-US')} output tokens</>}
            {draft.promptSource && draft.promptSource.key && <> · written with the {String(draft.promptSource.key).replace(/^AIPROMPT#/, '')} prompt</>}
          </p>
        </div>
        {!isAppend && <p className="drv-note">Public is not a choice here: once the set is saved in {where}, publish it from there.</p>}
      </header>

      {message && <p className={`drv-msg drv-msg--${message.tone}`} role={message.tone === 'error' ? 'alert' : 'status'}>{message.text}</p>}
      {planLimit && (
        <PlanLimitNotice refusal={planLimit} outcome="Nothing was saved. The draft is still here." surface="dusk" compact />
      )}

      {generating && (
        <div className="drv-run" role="status">
          <span className="drv-num">{draft.produced}{draft.requested ? ` / ${draft.requested}` : ''}</span>
          <span className="drv-dim">
            {draft.cancelRequested ? 'Stopping after this pass…' : 'Written so far. It keeps going if you close this, and the bell says when it is ready.'}
          </span>
          {!draft.cancelRequested && (
            <button type="button" className="drv-btn" onClick={stop} disabled={busy === 'stop'}>Stop</button>
          )}
        </div>
      )}

      {draft.warnings && draft.warnings.length > 0 && (
        <ul className="drv-warn">
          {draft.warnings.map((w, i) => <li key={i}><Icon name="Warning" size={14} color="currentColor" /> {w}</li>)}
        </ul>
      )}
      {draft.error && draft.status === DRAFT_STATUS.FAILED && <p className="drv-msg drv-msg--error">{draft.error}</p>}

      {failedEmpty && <p className="drv-lead">Nothing was written, so there is nothing to review. Try again, or discard the draft.</p>}

      {reviewable && missing > 0 && canRegenerate && !regen && (
        <div className="drv-partial">
          <span>{missing} of the {draft.requested} asked for {missing === 1 ? 'was' : 'were'} not written.</span>
          <button type="button" className="drv-btn" onClick={() => setRegen({ remaining: true, count: missing })}>
            Generate the remaining {missing} into this draft
          </button>
        </div>
      )}

      {regen && (
        <div className="drv-regen" data-testid="draft-regen">
          <p>
            {regen.category
              ? <>Write {regen.count} new {noun} for <b>{regen.category}</b>, replacing the {regen.count} there now.</>
              : <>Write the remaining {regen.count} into this draft.</>}
            {' '}This calls the model: {tokenEstimate(regen.count, draft.tokensPerItem) || 'a few thousand tokens'}.
          </p>
          <label className="drv-label" htmlFor="drv-guidance">Guidance for this pass (optional)</label>
          <textarea id="drv-guidance" className="drv-input" rows={2} maxLength={500} value={guidance}
            onChange={(e) => setGuidance(e.target.value)} placeholder="e.g. more on the 19th century" />
          <div className="drv-actions">
            <button type="button" className="drv-btn drv-btn--primary" onClick={runRegenerate} disabled={busy === 'regen'}>
              {busy === 'regen' ? 'Starting…' : 'Write them'}
            </button>
            <button type="button" className="drv-btn" onClick={() => setRegen(null)}>Cancel</button>
          </div>
        </div>
      )}

      {groups.map((group) => {
        const keptHere = group.items.filter((it) => it.decision !== 'leave').length;
        const allKept = keptHere === group.items.length;
        return (
          <div className="drv-cat" key={group.category}>
            <div className="drv-cathead">
              <label className="drv-check">
                <input
                  type="checkbox"
                  checked={allKept}
                  disabled={!reviewable}
                  onChange={() => setDecision(group.items.map((it) => it.seq), allKept ? 'leave' : 'keep')}
                />
                <b>{group.category}</b>
              </label>
              <span className="drv-dim">keep {keptHere} of {group.items.length}</span>
              <span className="drv-grow" />
              {reviewable && canRegenerate && !regen && (
                <button type="button" className="drv-btn drv-btn--sm"
                  onClick={() => setRegen({ category: group.category, count: group.items.length })}>
                  <Icon name="ArrowsClockwise" size={13} color="currentColor" /> Regenerate this category
                </button>
              )}
            </div>
            <ul className="drv-items">
              {group.items.map((it) => {
                const defect = itemDefect(it.item, engagementType);
                const isEditing = editing && editing.seq === it.seq;
                return (
                  <li key={it.seq} className={`drv-item${it.decision === 'leave' ? ' drv-item--out' : ''}`}>
                    <input
                      type="checkbox"
                      aria-label={`Keep “${it.item.title}”`}
                      checked={it.decision !== 'leave'}
                      disabled={!reviewable}
                      onChange={() => setDecision([it.seq], it.decision === 'leave' ? 'keep' : 'leave')}
                    />
                    {isEditing ? (
                      <div className="drv-edit">
                        <label className="drv-label" htmlFor={`drv-t-${it.seq}`}>Title</label>
                        <input id={`drv-t-${it.seq}`} className="drv-input" value={editing.item.title || ''}
                          onChange={(e) => setEditing({ ...editing, item: { ...editing.item, title: e.target.value } })} />
                        <label className="drv-label" htmlFor={`drv-d-${it.seq}`}>{engagementType === 'trivia' ? 'Question' : 'Detail'}</label>
                        <textarea id={`drv-d-${it.seq}`} className="drv-input" rows={3}
                          value={itemBody(editing.item, engagementType)}
                          onChange={(e) => setEditing({
                            ...editing,
                            item: { ...editing.item, [engagementType === 'trivia' ? 'questionDetail' : 'detail']: e.target.value },
                          })} />
                        {engagementType === 'trivia' && OPTION_KEYS.filter((k) => k in editing.item).map((k) => (
                          <div key={k} className="drv-opt">
                            <input type="radio" name={`drv-ok-${it.seq}`} aria-label={`Option ${k.slice(-1)} is correct`}
                              checked={editing.item.correctAnswer === `Option${k.slice(-1)}`}
                              onChange={() => setEditing({ ...editing, item: { ...editing.item, correctAnswer: `Option${k.slice(-1)}` } })} />
                            <input className="drv-input" aria-label={`Option ${k.slice(-1)}`} value={editing.item[k] || ''}
                              onChange={(e) => setEditing({ ...editing, item: { ...editing.item, [k]: e.target.value } })} />
                          </div>
                        ))}
                        <div className="drv-actions">
                          <button type="button" className="drv-btn drv-btn--primary" onClick={saveEdit} disabled={busy === 'edit'}>Save edit</button>
                          <button type="button" className="drv-btn" onClick={() => setEditing(null)}>Cancel</button>
                        </div>
                      </div>
                    ) : (
                      <div className="drv-text">
                        <span className="drv-title">{it.item.title}{it.edited && <span className="drv-tag">edited</span>}</span>
                        {itemBody(it.item, engagementType) && <span className="drv-body">{itemBody(it.item, engagementType)}</span>}
                        {engagementType === 'trivia' && (
                          <span className="drv-opts">
                            {OPTION_KEYS.filter((k) => String(it.item[k] || '').trim()).map((k) => {
                              const right = (Array.isArray(it.item.correctAnswer) ? it.item.correctAnswer : [it.item.correctAnswer])
                                .includes(`Option${k.slice(-1)}`);
                              return <span key={k} className={right ? 'drv-right' : ''}>{k.slice(-1)} {it.item[k]}{right ? ' ✓' : ''}</span>;
                            })}
                          </span>
                        )}
                        {Array.isArray(it.item.options) && it.item.options.length > 0 && (
                          <span className="drv-opts">{it.item.options.map((o, i) => <span key={i}>{o}</span>)}</span>
                        )}
                        {defect && <span className="drv-defect"><Icon name="Warning" size={13} color="currentColor" /> {defect}</span>}
                      </div>
                    )}
                    {!isEditing && reviewable && (
                      <button type="button" className="drv-btn drv-btn--sm" onClick={() => setEditing({ seq: it.seq, item: { ...it.item } })}>
                        <Icon name="PencilSimple" size={13} color="currentColor" /> Edit
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}

      {reviewable && (
        <footer className="drv-foot">
          {blockAccept && <p className="drv-msg drv-msg--pending" role="status">{blockAccept}</p>}
          {!isAppend && items.length > 0 && (
            <div className="drv-newset">
              <label className="drv-label" htmlFor="drv-name">Set name</label>
              <input id="drv-name" className="drv-input" value={name}
                onChange={(e) => { nameTouched.current = true; setName(e.target.value); }} />
              <label className="drv-label" htmlFor="drv-shelf">Shelf</label>
              <select id="drv-shelf" className="drv-input" value={topic} onChange={(e) => setTopic(e.target.value)}>
                <option value="">Choose a shelf…</option>
                {SET_TOPIC_IDS.map((id) => <option key={id} value={id}>{SET_TOPICS[id].label}</option>)}
              </select>
              <label className="drv-check">
                <input type="checkbox" checked={activate && Boolean(topic)} disabled={!topic}
                  onChange={(e) => setActivate(e.target.checked)} />
                Switch it on now{!topic && ' (choose a shelf first)'}
              </label>
            </div>
          )}
          <div className="drv-actions">
            {items.length > 0 && (
              <button type="button" className="drv-btn drv-btn--primary" onClick={accept}
                disabled={!kept.length || busy === 'accept' || Boolean(blockAccept) || (!isAppend && !name.trim())} data-testid="draft-accept">
                {busy === 'accept' ? 'Saving…'
                  : isAppend
                    ? `Accept ${kept.length} of ${items.length} — saves version ${(Number(draft.targetVersion) || 0) + 1}`
                    : `Accept ${kept.length} of ${items.length} — save the set in ${where}`}
              </button>
            )}
            {failedEmpty && canRegenerate && (
              <button type="button" className="drv-btn drv-btn--primary"
                onClick={() => setRegen({ remaining: true, count: draft.requested || 1 })}>Try again</button>
            )}
            {confirmDiscard ? (
              <>
                <span className="drv-dim">Discard {items.length} {noun}? You can restore it for 7 days.</span>
                <button type="button" className="drv-btn drv-btn--danger" onClick={discard} disabled={busy === 'discard'}>Discard</button>
                <button type="button" className="drv-btn" onClick={() => setConfirmDiscard(false)}>Keep it</button>
              </>
            ) : (
              <button type="button" className="drv-btn drv-btn--ghostdanger" onClick={() => setConfirmDiscard(true)}>Discard draft</button>
            )}
            <span className="drv-grow" />
            <button type="button" className="drv-btn" onClick={onClose}>Decide later</button>
          </div>
          {keptWithDefects.length > 0 && (
            <p className="drv-dim">{keptWithDefects.length} kept {keptWithDefects.length === 1 ? 'question has a problem' : 'questions have problems'} — marked above.</p>
          )}
        </footer>
      )}
      {!reviewable && !generating && (
        <div className="drv-actions"><button type="button" className="drv-btn" onClick={onClose}>Back</button></div>
      )}
    </section>
  );
}
