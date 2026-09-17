// src/src/components/ShareSetDialog.jsx
import React, { useEffect, useRef, useState } from 'react';
import Icon from './Icon';
import Modal from './Modal';
import StatusMessage from './StatusMessage';
import { authFetch } from '../auth/authFetch';
import { adminApiUrl } from '../utils/adminApi';
import { pollGenerationJob } from '../utils/aiBatchClient';
import { interpretCheckJob } from '../utils/checkJob';
import { gameTypeLabel } from '../config/gameTypes';
import './ShareSetDialog.css';

/**
 * SHARING A SET PUBLICLY — docs/design/tenancy-redesign/05-share-review.html.
 *
 * The copy is the mockup's, verbatim, because it is the promise the backend
 * keeps: every question is checked first; pass → the library; flagged → the
 * questions and why; unsure → a person at Engage. One addition (spec §10.1):
 * the Workie note, when the set's prompt is not one of Engage's.
 *
 * The check is a JOB. Submit answers 202 and this dialog becomes the progress
 * panel; closing it keeps the job running — the outcome lands in rows, not in
 * this window — so `onOutcome` fires even after unmount and the list refreshes.
 * "You'll hear back" is never said: there is no channel that could keep it.
 */
const checkUrl = (setId) => adminApiUrl(`question-sets/${encodeURIComponent(setId)}/check`);

export default function ShareSetDialog({ set, version = null, onClose, onOutcome, onNeedsChanges }) {
  const [state, setState] = useState('idle');       // idle | submitting | running | passed | escalated | failed
  const [note, setNote] = useState('');              // the 409/429 sentence
  const [error, setError] = useState(null);
  const [progress, setProgress] = useState({ phase: '', completed: 0, requested: 0 });
  const [meta, setMeta] = useState({});
  const mounted = useRef(true);
  useEffect(() => () => { mounted.current = false; }, []);
  const safe = (fn) => { if (mounted.current) fn(); };

  const targetVersion = version || set.activeVersion || null;
  const busy = state === 'submitting' || state === 'running';
  const canClose = () => true; // closing keeps the job running

  const submit = async () => {
    setNote(''); setError(null); setState('submitting');
    let jobId;
    try {
      const res = await authFetch(checkUrl(set.id), {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ version: targetVersion, publish: true }),
      });
      const body = await res.json().catch(() => ({}));
      if (res.status === 409 || res.status === 429) { setNote(body.error || 'Not right now.'); setState('idle'); return; }
      if (!res.ok) { setError(body.error || `The check could not start (${res.status}).`); setState('idle'); return; }
      jobId = body.jobId;
    } catch (e) {
      setError(`The check could not start: ${e.message}`); setState('idle'); return;
    }
    setState('running');
    let job;
    try {
      job = await pollGenerationJob(checkUrl(set.id), jobId, {
        label: 'Content check',
        onProgress: (j) => safe(() => setProgress({ phase: j.phase || '', completed: j.completed || 0, requested: j.requested || 0 })),
      });
    } catch (e) {
      safe(() => { setError(e.message); setState('failed'); });
      return;
    }
    const read = interpretCheckJob(job);
    if (onOutcome) onOutcome({ outcome: read.outcome, meta: read.meta, items: read.items });
    if (read.outcome === 'flagged') { if (onNeedsChanges) onNeedsChanges(read); safe(() => onClose && onClose()); return; }
    safe(() => { setMeta(read.meta || {}); setError(read.error); setState(read.outcome === 'failed' ? 'failed' : read.outcome); });
  };

  return (
    <Modal
      overlayClassName="pubshare pubshare-scrim"
      contentClassName="pubshare-card"
      labelledBy="pubshare-title"
      onClose={() => onClose && onClose()}
      closeOnBackdrop={canClose}
      closeOnEscape={canClose}
    >
      <header className="pubshare-head">
        <h2 id="pubshare-title">Share “{set.name}” publicly</h2>
        <button type="button" className="pubshare-x" onClick={() => onClose && onClose()} aria-label="Close" title="Close">×</button>
      </header>

      {state === 'idle' || state === 'submitting' ? (
        <div className="pubshare-body">
          <p className="pubshare-sub">
            {gameTypeLabel(set.engagementType)} · {set.totalQuestions || 0} questions · version {targetVersion || '—'}
          </p>
          <p>Anyone using Engage will be able to find this set, read every question in it, and copy it into their own team.</p>
          <div className="pubshare-callout">
            <strong>Every question is checked first.</strong> An automated review reads the whole set looking for material
            that should not be published without a person seeing it: violence, sexual content, harassment, and content that
            targets a group. It usually finishes in under a minute.
          </div>
          <dl className="pubshare-outcomes">
            <dt>If it passes</dt><dd>The set appears in the public library. You can unpublish it at any time.</dd>
            <dt>If something is flagged</dt><dd>Nothing is published. You get the specific questions and the reason for each, and you can edit and resubmit.</dd>
            <dt>If the check is unsure</dt><dd>It goes to a person at Engage. The outcome will show on this set's row.</dd>
          </dl>
          {set.promptId && set.promptScope !== 'platform' && (
            <p className="pubshare-note">Published without your Workie — Engage's default is used for the public copy.</p>
          )}
          <p className="pubshare-fine">Publishing copies the set. The public copy does not change when you edit yours, and nobody who copies it can change yours.</p>
          {note && <p className="pubshare-note" role="status">{note}</p>}
          <StatusMessage message={error} tone="error" className="pubshare-alert" />
          <footer className="pubshare-foot">
            <button type="button" className="pubshare-btn" onClick={() => onClose && onClose()}>Cancel</button>
            <button type="button" className="pubshare-btn pubshare-btn--primary" onClick={submit} disabled={busy}>
              {state === 'submitting' ? 'Starting…' : 'Submit for review'}
            </button>
          </footer>
        </div>
      ) : null}

      {state === 'running' && (
        <div className="pubshare-body pubshare-running" aria-live="polite">
          <p className="pubshare-bignum">
            {progress.completed}{progress.requested > 0 && <span className="pubshare-of"> / {progress.requested}</span>}
          </p>
          <p className="pubshare-phase">{progress.phase || 'Checking…'}</p>
          <p className="pubshare-fine">Closing this keeps the check running. The outcome shows on this set's row.</p>
          <footer className="pubshare-foot">
            <button type="button" className="pubshare-btn" onClick={() => onClose && onClose()}>Close — this keeps running</button>
          </footer>
        </div>
      )}

      {state === 'passed' && (
        <div className="pubshare-body pubshare-done">
          <p className="pubshare-result pubshare-result--ok"><Icon name="CheckCircle" weight="fill" size={18} color="var(--pubshare-success-text)" /> Now in the public library{meta.publicVersion ? ` as version ${meta.publicVersion}` : ''}.</p>
          {meta.promptDropped && <p className="pubshare-fine">Published without your Workie — Engage's default is used.</p>}
          <footer className="pubshare-foot"><button type="button" className="pubshare-btn pubshare-btn--primary" onClick={() => onClose && onClose()}>Done</button></footer>
        </div>
      )}
      {state === 'escalated' && (
        <div className="pubshare-body pubshare-done">
          <p className="pubshare-result"><Icon name="UserCircle" weight="fill" size={18} color="var(--primary)" /> Gone to a person at Engage. The outcome will show on this set's row.</p>
          <footer className="pubshare-foot"><button type="button" className="pubshare-btn pubshare-btn--primary" onClick={() => onClose && onClose()}>Done</button></footer>
        </div>
      )}
      {state === 'failed' && (
        <div className="pubshare-body pubshare-done">
          <StatusMessage message={error || 'The check did not finish. Submit it again.'} tone="error" className="pubshare-alert" />
          <footer className="pubshare-foot">
            <button type="button" className="pubshare-btn" onClick={() => onClose && onClose()}>Close</button>
            <button type="button" className="pubshare-btn pubshare-btn--primary" onClick={() => { setError(null); setNote(''); setState('idle'); }}>Try again</button>
          </footer>
        </div>
      )}
    </Modal>
  );
}
