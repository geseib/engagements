import React, { useCallback, useEffect, useState } from 'react';
import Icon from './Icon';
import Modal from './Modal';
import StatusMessage from './StatusMessage';
import { authFetch } from '../auth/authFetch';
import { adminApiUrl } from '../utils/adminApi';
import { gameTypeLabel } from '../config/gameTypes';
import { whyLabel, waitedLabel, queueHeadline } from '../utils/moderationRow';
import './ModerationPanel.css';

/**
 * MODERATION — docs/design/tenancy-redesign/11-moderation.html.
 *
 * The queue is the pointer partition (spec §3.2): a row per set the check
 * would not decide on its own, oldest first. Review opens the snapshot in a
 * full-height Modal with the uncertain questions first — the reviewer's job is
 * the handful the check could not decide, not a re-read of the set — and the
 * two decisions of Stage 2, Approve and Reject. "Approve with a content notice"
 * arrives with the notice vocabulary (Stage 4, spec §7); dismiss / take down /
 * keep-with-a-notice arrive with reports (Stage 3, spec §6.2).
 *
 * Two reviewers cannot both decide: the server's transition is conditional,
 * and a lost race reads "Already decided by <name>" here and refreshes.
 */
const BAND_WORD = { HIGH: 'flagged', MEDIUM: 'uncertain', LOW: 'low', NONE: '' };
const bandWord = (band) => BAND_WORD[String(band || '').toUpperCase()] || String(band || '').toLowerCase();
const skUrl = (sk) => adminApiUrl(`admin/moderation/${encodeURIComponent(sk)}`);

function ReviewDialog({ sk, onClose, onDecided }) {
  const [state, setState] = useState('loading');   // loading | ready | error
  const [item, setItem] = useState(null);
  const [error, setError] = useState(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [verdict, setVerdict] = useState(null);      // the 409 sentence
  /*
    requestClose is the DELIBERATE exit — the X and the bottom Close both call
    it, gated only on `busy` (a decision in flight can't be interrupted by a
    stray click; see decide()'s finally, which always clears it). A deliberate
    click discards an unsaved note on purpose, same as clicking Reject/Approve
    would have.

    Escape and a backdrop click are the ACCIDENTAL exits, below on the Modal —
    gated on `busy` AND on an unsaved note (`!note.trim()`), so a note the
    reviewer is mid-typing survives a stray Escape press or an off-card click.
    This is the design contract's "gated on unsaved work, not disabled".
  */
  const requestClose = () => { if (!busy) onClose(); };

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const res = await authFetch(skUrl(sk));
        const body = await res.json().catch(() => ({}));
        if (!live) return;
        if (!res.ok) { setError(body.error || `Could not open that entry (${res.status}).`); setState('error'); return; }
        setItem(body); setState('ready');
      } catch (e) { if (live) { setError(`Could not open that entry: ${e.message}`); setState('error'); } }
    })();
    return () => { live = false; };
  }, [sk]);

  const decide = async (decision) => {
    setBusy(true); setVerdict(null); setError(null);
    try {
      const res = await authFetch(adminApiUrl('admin/moderation/decide'), {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sk, decision, note: note.trim() }),
      });
      const body = await res.json().catch(() => ({}));
      if (res.status === 409) { setVerdict(body.error || 'Already decided.'); onDecided({ refreshOnly: true }); return; }
      if (!res.ok) { setError(body.error || `The decision was not recorded (${res.status}).`); return; }
      onDecided(body);
    } catch (e) {
      setError(`The decision was not recorded: ${e.message}`);
    } finally {
      setBusy(false);
    }
  };

  const title = (item && item.snapshot && item.snapshot.meta.name) || (item && item.pointer && item.pointer.title) || 'Review';
  const questions = (item && item.snapshot && item.snapshot.questions) || [];
  const uncertain = questions.filter((q) => q.findings.length).length;
  return (
    <Modal overlayClassName="modq modq-scrim" contentClassName="modq-card modq-card--tall" labelledBy="modq-title" onClose={requestClose} closeOnBackdrop={() => !busy && !note.trim()} closeOnEscape={() => !busy && !note.trim()}>
      <header className="modq-head">
        <h2 id="modq-title">{title}</h2>
        {/* aria-label reads "Close review" rather than the bare "Close" the rest
            of the app's X buttons use: the footer exit below is also literally
            labelled "Close" (Stage 2's copy, not "Cancel"), and two buttons in
            one dialog sharing one accessible name is not two exits — it is one
            exit a screen reader or getByRole('button', { name }) cannot pick
            between. See task-9-report.md for how this was found. */}
        <button type="button" className="modq-x" onClick={requestClose} aria-label="Close review" title="Close review" disabled={busy}>×</button>
      </header>
      <div className="modq-body">
        {state === 'loading' && <p className="modq-fine">Opening…</p>}
        {state === 'error' && <StatusMessage message={error} tone="error" className="modq-alert" />}
        {state === 'ready' && item && (
          <>
            <p className="modq-dlg-sub">
              {item.pointer.orgName} · {gameTypeLabel(item.snapshot ? item.snapshot.meta.engagementType : item.pointer.gameType)} · {questions.length || item.pointer.questionCount || 0} questions · v{item.pointer.version} · {whyLabel(item.pointer)}
            </p>
            {!item.snapshot && (
              <StatusMessage message="The snapshot is gone, so there is nothing to approve — ask the organisation to submit it again. Reject still records a note." tone="error" className="modq-alert" />
            )}
            {item.setFindings.length > 0 && (
              <p className="modq-note"><strong>The set's own text:</strong> {item.setFindings.map((f) => `${bandWord(f.band)} for ${String(f.category || '').toLowerCase()}`).join('; ')}.</p>
            )}
            <h3 className="modq-h">{uncertain ? `${uncertain} question${uncertain === 1 ? '' : 's'} the check could not decide` : 'Every question'}</h3>
            <ul className="modq-list">
              {questions.map((q) => (
                <li key={q.questionId} className={`modq-q${q.findings.length ? ' modq-q--uncertain' : ''}`} data-testid="modq-question">
                  <div className="modq-q-head">
                    <strong>{q.title || q.questionId}</strong>
                    <span className="modq-chip">{q.category}</span>
                    {/*
                      The chip's visible text is the raw band (high/medium/low),
                      not bandWord()'s translation — a reviewer deciding
                      Approve/Reject needs the actual severity the check
                      assigned, not "uncertain" for every non-clear band. The
                      CSS colour is still driven by bandWord() below: only
                      .modq-chip--flagged and .modq-chip--uncertain are styled
                      (a LOW band falls through to the base chip style, which
                      is intentional — low findings are context, not a flag).
                    */}
                    {q.findings.map((f, i) => (
                      <span key={i} className={`modq-chip modq-chip--${bandWord(f.band) || 'none'}`}>{String(f.band || '').toLowerCase()} · {String(f.category || '').toLowerCase()}</span>
                    ))}
                  </div>
                  <p className="modq-q-text">{q.text}</p>
                  {q.findings.map((f, i) => f.explanation && <p key={`e${i}`} className="modq-why">{f.explanation}</p>)}
                </li>
              ))}
            </ul>
            <label className="modq-label" htmlFor="modq-note">Note to the organisation (they read it on reject)</label>
            <textarea id="modq-note" className="modq-textarea" rows={3} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
            {verdict && <p className="modq-note" role="status">{verdict}</p>}
            {error && <StatusMessage message={error} tone="error" className="modq-alert" />}
          </>
        )}
      </div>
      <footer className="modq-foot">
        <button type="button" className="modq-btn" onClick={requestClose} disabled={busy}>Close</button>
        {state === 'ready' && !verdict && (
          <>
            <button type="button" className="modq-btn modq-btn--danger" onClick={() => decide('reject')} disabled={busy}>Reject</button>
            {/* Stage 4: "Approve with a content notice" opens the picker inline here. */}
            <button type="button" className="modq-btn modq-btn--primary" onClick={() => decide('approve')} disabled={busy || !item || !item.snapshot}>Approve</button>
          </>
        )}
      </footer>
    </Modal>
  );
}

export default function ModerationPanel({ onOpenScoreCard }) {
  const [queue, setQueue] = useState({ items: [], count: 0, oldestWaitingSince: null });
  const [state, setState] = useState('loading');   // loading | ready | outage
  const [outage, setOutage] = useState('');
  const [open, setOpen] = useState(null);           // the sk under review
  const now = Date.now();

  const load = useCallback(async () => {
    try {
      const res = await authFetch(adminApiUrl('admin/moderation'));
      const body = await res.json().catch(() => ({}));
      /*
        Always framed as "Could not read the queue" — never the server's raw
        error verbatim. The decide endpoint's failures (below, and in
        ReviewDialog) DO show body.error verbatim, because interfaces §Copy
        says so explicitly for the 409 case ("a 409 renders its error") and
        that text is already about a specific set's decision. A queue-load
        failure has no such framing of its own — passing an unrelated
        `{ error: 'boom' }` straight through would say something true but
        useless ("boom") instead of naming what actually failed. So the detail
        is appended to the fixed lede rather than replacing it.
      */
      if (!res.ok) { setOutage(body.error ? `Could not read the queue: ${body.error}` : `Could not read the queue (${res.status}).`); setState('outage'); return; }
      setQueue({ items: body.items || [], count: body.count || 0, oldestWaitingSince: body.oldestWaitingSince || null });
      setState('ready');
    } catch (e) { setOutage(`Could not read the queue: ${e.message}`); setState('outage'); }
  }, []);
  useEffect(() => { load(); }, [load]);

  return (
    <section className="modq" data-theme="dark">
      <div className="modq-lede">
        {state === 'ready' && queue.count > 0 && <p className="modq-headline">{queueHeadline(queue.count, queue.oldestWaitingSince, now)}</p>}
        <p className="modq-fine">The check escalates rather than guessing. These are the ones it flagged as uncertain, not the ones it rejected.</p>
      </div>
      {state === 'outage' && <div className="modq-outage" role="alert"><Icon name="WarningCircle" weight="fill" size={16} color="var(--danger-text)" /> {outage}</div>}
      {state === 'ready' && queue.count === 0 && <p className="modq-empty">Nothing is waiting — the check decided everything on its own.</p>}
      {state === 'ready' && queue.count > 0 && (
        <table className="modq-tbl">
          <thead>
            <tr><th className="modq-col-set">Set</th><th className="modq-col-org">Organisation</th><th className="modq-col-why">Why it escalated</th><th className="modq-col-wait">Waiting</th><th className="modq-col-act" /></tr>
          </thead>
          <tbody>
            {queue.items.map((item) => {
              // Every truncating cell (.modq-nm, .modq-why-cell, and this
              // sub-line) carries its full text as `title` — the row is the
              // one place in the console where three separate strings on one
              // line can all be clipped by table-layout: fixed at once.
              const subLine = `${gameTypeLabel(item.gameType)} · ${item.questionCount || 0} questions · v${item.version}`;
              return (
                <tr key={item.sk} className="modq-row">
                  <td>
                    <span className="modq-nm" title={item.title}>{item.title || item.setId}</span>
                    <span className="modq-sub" title={subLine}>{subLine}</span>
                  </td>
                  <td><span className="modq-nm" title={item.orgName}>{item.orgName || item.orgId}</span></td>
                  <td><span className="modq-why-cell" title={whyLabel(item)}>{whyLabel(item)}</span></td>
                  <td className="modq-wait">{waitedLabel(item.waitingSince, now)}</td>
                  <td>
                    <div className="modq-rowact">
                      {onOpenScoreCard && item.publicSetId && (
                        <button type="button" className="modq-btn modq-btn--sm" onClick={() => onOpenScoreCard(item.publicSetId)}>Score card</button>
                      )}
                      <button type="button" className="modq-btn modq-btn--sm modq-btn--primary" onClick={() => setOpen(item.sk)}>Review</button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      {open && (
        <ReviewDialog sk={open} onClose={() => setOpen(null)} onDecided={(r) => { if (!(r && r.refreshOnly)) setOpen(null); load(); }} />
      )}
    </section>
  );
}
