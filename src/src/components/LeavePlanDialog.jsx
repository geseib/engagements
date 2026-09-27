import React, { useCallback, useEffect, useRef, useState } from 'react';
import Modal from './Modal';
import { authFetch } from '../auth/authFetch';
import { adminApiUrl } from '../utils/adminApi';
import { gameTypeLabel } from '../config/gameTypes';
import { SET_TOPICS, SET_TOPIC_IDS } from '../config/setTopics';
import './LeavePlanDialog.css';

/**
 * LEAVING A PAID PLAN — lambda-functions/admin/orgs/leave-plan.js.
 *
 * The owner, 27 Sep 2026: "they will be given a list of their team or
 * individual sets and be told how many they have to delete to get down to 5
 * free. they can before deleting also click a make public button (but they will
 * be told they will not be deleted until they are accepted into public (a copy)
 * or they come back and uncheck make public".
 *
 * So the dialog is the list and one sentence about it. Every number on it —
 * the allowance, how many are kept, how many must go — is the SERVER's
 * (`GET /orgs/{orgId}/plan/leave`), because the refusal the Leave button can
 * meet is computed from the same read; a second count here would be a second
 * answer to "can I leave yet?".
 *
 * Each row has two exits and they are not symmetrical:
 *
 *   Delete       destroys the set. Confirmed IN THE ROW — never a second modal
 *                over this one (the container rule) — through the same
 *                `DELETE /admin/question-sets/{setId}` the Question sets screen
 *                uses.
 *   Make public  a toggle, and not a delete: the set is HELD, stops counting,
 *                and goes to the public library through the ordinary check. It
 *                is removed from here only once a copy is live there. Unticking
 *                keeps it. A set with no topic is asked for one inline — the
 *                same closed list the set editor's topic field offers
 *                (config/setTopics.js), because the library files every set
 *                under exactly one.
 *
 * Leave is disabled, with its reason beside it, until the kept sets fit. On
 * success the caller refreshes Plan & usage.
 */
const leaveUrl = (orgId, suffix = '') => adminApiUrl(`orgs/${encodeURIComponent(orgId)}/plan/leave${suffix}`);
const setWord = (n) => `${n} ${n === 1 ? 'set' : 'sets'}`;
/** "Standard plan" and "Organisation plan" stay themselves; a bare "Standard" becomes "Standard plan". */
export const planLabel = (name) => {
  const n = String(name || '').trim() || 'paid';
  return /\bplan$/i.test(n) ? n : `${n} plan`;
};

/**
 * THE SENTENCE. Plain words, the owner's arithmetic: how many there are, what
 * the free plan keeps, how many to delete. Held sets are named once, because
 * they are why the kept number is not the total.
 */
export function leadSentence(view) {
  if (!view) return '';
  const { total, held, kept, allowance, mustDelete } = view;
  const heldPart = held > 0
    ? ` ${held === 1 ? '1 is' : `${held} are`} waiting for the public library and ${held === 1 ? 'does' : 'do'} not count.`
    : '';
  if (mustDelete > 0) {
    return `You have ${setWord(total)}.${heldPart} The free plan keeps ${allowance} — delete ${mustDelete}, or make some public.`;
  }
  if (total === 0) return `You have no sets. The free plan keeps ${allowance}, so you can leave now.`;
  return `You have ${setWord(total)}.${heldPart} The free plan keeps ${allowance}, so you can leave now.`;
}

const HOLD_STATE = {
  checking: 'Being checked for the public library',
  waiting: 'With a person at Engage',
  stalled: 'Not moving — tick Make public again to restart it',
};
const HELD_NOTE = 'Kept until the public library accepts a copy — then it’s removed from here. Untick to keep it.';
const RELEASED_NOTE = {
  declined: 'The public library declined it, so it counts again.',
  flagged: 'The content check flagged it, so it was not made public and counts again.',
  changed: 'The public library took an earlier version, and you have changed this set since — so it was kept, and counts again.',
};

export default function LeavePlanDialog({
  orgId, orgName = '', onClose, onLeft, onSetsChanged,
}) {
  const [view, setView] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [rowBusy, setRowBusy] = useState({});         // setId -> true
  const [rowNote, setRowNote] = useState({});         // setId -> { text, tone }
  const [askTopic, setAskTopic] = useState({});       // setId -> chosen topic id ('' until chosen)
  const [confirming, setConfirming] = useState('');   // setId whose delete is being confirmed
  const [notes, setNotes] = useState([]);             // sets that have left the list, and why
  const [leaving, setLeaving] = useState(false);
  const [leaveError, setLeaveError] = useState('');
  const changed = useRef(false);

  const busy = leaving || Object.values(rowBusy).some(Boolean);

  const load = useCallback(async () => {
    setLoadError('');
    try {
      const res = await authFetch(leaveUrl(orgId));
      const body = await res.json().catch(() => ({}));
      if (!res.ok) { setLoadError(body.error || `Could not read your sets (${res.status}).`); return; }
      setView(body);
    } catch (e) {
      setLoadError(e.message || 'Could not read your sets.');
    }
  }, [orgId]);

  useEffect(() => { load(); }, [load]);

  const requestClose = () => {
    if (busy) return;
    if (changed.current && onSetsChanged) onSetsChanged();
    onClose();
  };

  const note = (setId, text, tone = 'info') => setRowNote((m) => ({ ...m, [setId]: text ? { text, tone } : null }));
  const markBusy = (setId, on) => setRowBusy((m) => ({ ...m, [setId]: on }));

  /* --------------------------------------------------------- make public -- */
  const toggleHold = async (set, on, topic) => {
    markBusy(set.setId, true);
    note(set.setId, '');
    try {
      const res = await authFetch(leaveUrl(orgId, '/hold'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ setId: set.setId, hold: on, ...(topic ? { topic } : {}) }),
      });
      const body = await res.json().catch(() => ({}));
      if (res.status === 409 && body.needsTopic) {
        setAskTopic((m) => ({ ...m, [set.setId]: m[set.setId] || '' }));
        note(set.setId, body.error, 'info');
        return;
      }
      if (!res.ok) { note(set.setId, body.error || `That did not work (${res.status}).`, 'bad'); return; }
      changed.current = true;
      setAskTopic((m) => { const next = { ...m }; delete next[set.setId]; return next; });
      if (body.preview) setView(body.preview);
      if (body.deleted) {
        setNotes((list) => [...list, { setId: set.setId, text: body.message }]);
      } else if (!on) {
        note(set.setId, body.message, 'info');
      } else if (body.message && body.state === 'public') {
        note(set.setId, body.message, 'bad');
      }
    } catch (e) {
      note(set.setId, e.message || 'That did not work.', 'bad');
    } finally {
      markBusy(set.setId, false);
    }
  };

  /* -------------------------------------------------------------- delete -- */
  const remove = async (set) => {
    markBusy(set.setId, true);
    note(set.setId, '');
    try {
      const res = await authFetch(adminApiUrl(`admin/question-sets/${encodeURIComponent(set.setId)}?scope=org`), {
        method: 'DELETE', headers: { 'Content-Type': 'application/json' },
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) { note(set.setId, `Delete failed: ${body.error || `HTTP ${res.status}`}`, 'bad'); return; }
      changed.current = true;
      setConfirming('');
      setNotes((list) => [...list, { setId: set.setId, text: `Deleted “${set.name}”.` }]);
      await load();
    } catch (e) {
      note(set.setId, `Delete failed: ${e.message}`, 'bad');
    } finally {
      markBusy(set.setId, false);
    }
  };

  /* --------------------------------------------------------------- leave -- */
  const leave = async () => {
    setLeaving(true);
    setLeaveError('');
    try {
      const res = await authFetch(leaveUrl(orgId), { method: 'POST', headers: { 'Content-Type': 'application/json' } });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (body && Array.isArray(body.sets)) setView(body);
        setLeaveError(body.error || `Could not leave the plan (${res.status}).`);
        setLeaving(false);
        return;
      }
      if (changed.current && onSetsChanged) onSetsChanged();
      onLeft(body);
    } catch (e) {
      setLeaveError(e.message || 'Could not leave the plan.');
      setLeaving(false);
    }
  };

  const plan = planLabel(view && view.plan && view.plan.name);
  const canLeave = Boolean(view && view.canLeave);
  const why = !view ? '' : !view.plan.paid
    ? 'This organisation is already on the free plan.'
    : view.mustDelete > 0
      ? `Delete ${view.mustDelete} more, or make ${view.mustDelete === 1 ? 'one' : 'some'} public, to leave.`
      : '';
  const sessions = view && view.sessions;
  const sessionsOver = sessions && sessions.used > sessions.included;

  return (
    <Modal
      overlayClassName="lvp lvp-scrim"
      contentClassName="lvp-modal"
      theme="dark"
      labelledBy="lvp-title"
      onClose={requestClose}
      closeOnBackdrop={() => !busy}
      closeOnEscape={() => !busy}
    >
      <header className="lvp-head">
        <div className="lvp-grow">
          <h2 id="lvp-title">Leave the {plan}</h2>
          <p className="lvp-dim">
            {orgName ? <b>{orgName}</b> : 'This organisation'} moves to the free plan the moment you leave —
            no request, nothing to wait for.
          </p>
        </div>
        <button type="button" className="lvp-x" onClick={requestClose} aria-label="Close" title="Close" disabled={busy}>×</button>
      </header>

      <div className="lvp-body">
        {loadError && <p className="lvp-alert" role="alert">{loadError}</p>}
        {!view && !loadError && <p className="lvp-dim" role="status">Reading your sets…</p>}

        {view && (
          <>
            <p className="lvp-lead" data-testid="lvp-lead">{leadSentence(view)}</p>

            {sessionsOver && (
              <p className="lvp-note" data-testid="lvp-sessions">
                {`You have run ${sessions.used} sessions this month. The free plan includes ${sessions.included}, so a new one waits until `}
                {new Date(`${sessions.resetsOn}T00:00:00Z`).toLocaleDateString(undefined, { day: 'numeric', month: 'long', timeZone: 'UTC' })}
                . A session already running is never stopped.
              </p>
            )}

            {notes.length > 0 && (
              <ul className="lvp-gone" role="status" data-testid="lvp-gone">
                {notes.map((n) => <li key={n.setId}>{n.text}</li>)}
              </ul>
            )}

            {view.sets.length > 0 && (
              <table className="lvp-tbl">
                <thead>
                  <tr>
                    <th className="lvp-col-set">Set</th>
                    <th className="lvp-col-pub">Make public</th>
                    <th className="lvp-col-acts" aria-label="Delete" />
                  </tr>
                </thead>
                <tbody>
                  {view.sets.map((set) => {
                    const rowIsBusy = Boolean(rowBusy[set.setId]);
                    const asking = Object.prototype.hasOwnProperty.call(askTopic, set.setId);
                    const own = rowNote[set.setId];
                    const releasedText = set.released
                      ? [RELEASED_NOTE[set.released.reason] || 'It counts again.', set.released.note && set.released.reason === 'declined' ? `“${set.released.note}”` : '']
                        .filter(Boolean).join(' ')
                      : '';
                    return (
                      <tr key={set.setId} data-testid={`lvp-row-${set.setId}`} className={set.held ? 'lvp-row--held' : undefined}>
                        <td className="lvp-cell-set">
                          <span className="lvp-nm" title={set.name}>{set.name}</span>
                          <span className="lvp-sub">
                            {[gameTypeLabel(set.engagementType), `${set.questionCount} questions`, set.version ? `version ${set.version}` : '']
                              .filter(Boolean).join(' · ')}
                          </span>
                          {set.held && (
                            <span className="lvp-held" data-testid={`lvp-held-${set.setId}`}>
                              <b>{HOLD_STATE[set.holdState] || HOLD_STATE.stalled}.</b> {HELD_NOTE}
                            </span>
                          )}
                          {!set.held && releasedText && <span className="lvp-released">{releasedText}</span>}
                          {own && own.text && (
                            <span className={`lvp-rownote${own.tone === 'bad' ? ' lvp-rownote--bad' : ''}`} role={own.tone === 'bad' ? 'alert' : 'status'}>
                              {own.text}
                            </span>
                          )}
                          {asking && (
                            <span className="lvp-topic">
                              <label className="lvp-lab" htmlFor={`lvp-topic-${set.setId}`}>Topic</label>
                              <select
                                id={`lvp-topic-${set.setId}`}
                                className="lvp-select"
                                value={askTopic[set.setId]}
                                onChange={(e) => setAskTopic((m) => ({ ...m, [set.setId]: e.target.value }))}
                                disabled={rowIsBusy}
                              >
                                <option value="" disabled>Choose a topic</option>
                                {SET_TOPIC_IDS.map((id) => <option key={id} value={id}>{SET_TOPICS[id].label}</option>)}
                              </select>
                              <button
                                type="button"
                                className="lvp-btn lvp-btn--sm lvp-btn--primary"
                                disabled={rowIsBusy || !askTopic[set.setId]}
                                onClick={() => toggleHold(set, true, askTopic[set.setId])}
                              >
                                File it and make public
                              </button>
                            </span>
                          )}
                          {confirming === set.setId && (
                            <span className="lvp-confirm" data-testid={`lvp-confirm-${set.setId}`}>
                              <span>
                                {`Delete “${set.name}”? Every version of it goes, and a past session's report that was never saved may not rebuild without it. `}
                                {!set.held && 'Making it public instead keeps it here until the library has a copy.'}
                              </span>
                              <button type="button" className="lvp-btn lvp-btn--sm lvp-btn--dangersolid" disabled={rowIsBusy} onClick={() => remove(set)}>
                                {rowIsBusy ? 'Deleting…' : 'Delete it'}
                              </button>
                              <button type="button" className="lvp-btn lvp-btn--sm" disabled={rowIsBusy} onClick={() => setConfirming('')}>Keep it</button>
                            </span>
                          )}
                        </td>
                        <td>
                          <label className="lvp-toggle">
                            <input
                              type="checkbox"
                              checked={set.held}
                              disabled={rowIsBusy || leaving}
                              onChange={(e) => toggleHold(set, e.target.checked)}
                              aria-label={`Make “${set.name}” public`}
                            />
                            <span>{set.held ? 'On' : 'Off'}</span>
                          </label>
                        </td>
                        <td>
                          <div className="lvp-rowact">
                            <button
                              type="button"
                              className="lvp-btn lvp-btn--sm lvp-btn--ghostdanger"
                              disabled={rowIsBusy || leaving || confirming === set.setId}
                              onClick={() => { setConfirming(set.setId); note(set.setId, ''); }}
                              aria-label={`Delete “${set.name}”`}
                            >
                              Delete
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}

            <p className="lvp-fine">
              Make public copies a set into the library everyone using Engage can browse and copy from. It is checked
              first, exactly as sharing always is, and it counts against nothing while it waits.
            </p>
          </>
        )}
        {leaveError && <p className="lvp-alert" role="alert">{leaveError}</p>}
      </div>

      <footer className="lvp-foot">
        {why && <span className="lvp-why" id="lvp-why" data-testid="lvp-why">{why}</span>}
        <button type="button" className="lvp-btn" onClick={requestClose} disabled={busy}>Not now</button>
        <button
          type="button"
          className="lvp-btn lvp-btn--primary"
          onClick={leave}
          disabled={!canLeave || busy}
          aria-describedby={why ? 'lvp-why' : undefined}
          data-testid="lvp-leave"
        >
          {leaving ? 'Leaving…' : `Leave the ${plan}`}
        </button>
      </footer>
    </Modal>
  );
}
