import React, { useEffect, useState } from 'react';
import Modal from './Modal';
import StatusMessage from './StatusMessage';
import { authFetch } from '../auth/authFetch';
import { adminApiUrl } from '../utils/adminApi';
import { gameTypeLabel } from '../config/gameTypes';
import './ScoreCard.css';

/**
 * THE SCORE CARD — spec §10.5. A PLACE in the platform console, the way the
 * set editor is a place in the org console: it holds a timeline and a table,
 * so it is not a modal. Reached from the staff Public library and from a
 * queue row that carries a publicSetId. Reports (Stage 3) and the notice
 * editor (Stage 4) join the seams marked below.
 */
const BAND_RANK = { HIGH: 0, MEDIUM: 1, LOW: 2 };
const BAND_WORD = { HIGH: 'flagged', MEDIUM: 'uncertain', LOW: 'low' };
const bandWord = (b) => BAND_WORD[String(b || '').toUpperCase()] || String(b || '').toLowerCase();
const day = (iso) => (iso ? new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : '');
const when = (iso) => (iso ? new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '');
const humanise = (id) => String(id || '').replace(/[-_]+/g, ' ');
const itemUrl = (id) => adminApiUrl(`admin/public-library/${encodeURIComponent(id)}`);

const EVENT_WORDS = {
  checked: (e) => `Checked${e.outcome ? ` — ${e.outcome}` : ''}`,
  escalated: () => 'Sent to a person',
  appealed: (e) => `Appealed${e.appealMessage ? `: “${e.appealMessage}”` : ''}`,
  decided: (e) => `${e.decision === 'approve' ? 'Approved' : 'Rejected'}${e.reviewer ? ` by ${e.reviewer}` : ''}`,
  published: (e) => `Published${e.publicVersion ? ` as public v${e.publicVersion}` : ''}`,
  unpublished: () => 'Unpublished by the organisation',
  'taken-down': (e) => `Taken down${e.reviewer ? ` by ${e.reviewer}` : ''}`,
  reported: (e) => `Reported${e.type ? ` — ${e.type}` : ''}`,
  'notice-set': () => 'Content notice set',
  'notice-cleared': () => 'Content notice cleared',
  access: (e) => `Opened by ${(e.who && e.who.name) || 'Engage'}`,
};
const eventWords = (e) => (EVENT_WORDS[e.event] ? EVENT_WORDS[e.event](e) : e.event);

function TakedownDialog({ name, busy, onClose, onConfirm }) {
  const [note, setNote] = useState('');
  const requestClose = () => { if (!busy) onClose(); };
  return (
    <Modal overlayClassName="scard scard-scrim" contentClassName="scard-dialog" labelledBy="scard-td-title" onClose={requestClose} closeOnBackdrop={() => !busy} closeOnEscape={() => !busy}>
      <header className="scard-head">
        <h2 id="scard-td-title">Take down “{name}”?</h2>
        <button type="button" className="scard-x" onClick={requestClose} aria-label="Close" title="Close" disabled={busy}>×</button>
      </header>
      <div className="scard-body">
        <p>It is gone for everyone. The organisation keeps their copy and sees your note — their editor shows it where the check's own findings would.</p>
        <label className="scard-label" htmlFor="scard-td-note">Note to the organisation (required)</label>
        <textarea id="scard-td-note" className="scard-textarea" rows={3} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
      </div>
      <footer className="scard-foot">
        <button type="button" className="scard-btn" onClick={requestClose} disabled={busy}>Cancel</button>
        <button type="button" className="scard-btn scard-btn--danger" onClick={() => onConfirm(note.trim())} disabled={busy || !note.trim()}>Take down</button>
      </footer>
    </Modal>
  );
}

export default function ScoreCard({ publicSetId, onBack, onTakenDown }) {
  const [card, setCard] = useState(null);
  const [error, setError] = useState(null);
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    setCard(null); setError(null);
    (async () => {
      try {
        const res = await authFetch(itemUrl(publicSetId));
        const body = await res.json().catch(() => ({}));
        if (!live) return;
        if (!res.ok) { setError(body.error || `Could not open that set (${res.status}).`); return; }
        setCard(body);
      } catch (e) { if (live) setError(`Could not open that set: ${e.message}`); }
    })();
    return () => { live = false; };
  }, [publicSetId]);

  const takeDown = async (note) => {
    setBusy(true);
    try {
      const res = await authFetch(itemUrl(publicSetId), { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ note }) });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) { setError(body.error || `Could not take it down (${res.status}).`); setAsking(false); return; }
      setAsking(false);
      if (onTakenDown) onTakenDown(publicSetId);
    } catch (e) { setError(`Could not take it down: ${e.message}`); setAsking(false); } finally { setBusy(false); }
  };

  const identity = card ? [
    `Public v${card.publicVersion || '—'}`,
    card.sourceOrgName ? `by ${card.sourceOrgName}` : '',
    card.review && card.review.reviewer ? `approved by ${card.review.reviewer}${card.review.decidedAt ? `, ${day(card.review.decidedAt)}` : ''}` : (card.publishedAt ? `published ${day(card.publishedAt)}` : ''),
    card.sensitivity && card.sensitivity.length ? `content notice: ${card.sensitivity.map(humanise).join(', ')}` : '',
    // Stage 3: `${reports} reports` joins here.
  ].filter(Boolean).join(' · ') : '';
  const findings = card ? [...(card.review.findings || [])].sort((a, b) => (BAND_RANK[String(a.band).toUpperCase()] ?? 9) - (BAND_RANK[String(b.band).toUpperCase()] ?? 9)) : [];
  const timeline = card ? [...(card.log || [])].sort((a, b) => String(b.at || '').localeCompare(String(a.at || ''))) : [];

  return (
    <section className="scard" data-theme="dark">
      <button type="button" className="scard-back" onClick={onBack}>← Public library</button>
      {error && <div className="scard-outage" role="alert">{error}</div>}
      {card && (
        <>
          <header className="scard-title">
            <h2>{card.name || card.publicSetId}</h2>
            <p className="scard-fine">{gameTypeLabel(card.engagementType)} · {card.questionCount || 0} questions{card.description ? ` · ${card.description}` : ''}</p>
            <p className="scard-identity" data-testid="scard-identity">{identity}</p>
          </header>
          <div className="scard-acts">
            <button type="button" className="scard-btn scard-btn--danger" onClick={() => setAsking(true)}>Take down</button>
            {/* Stage 4: the content-notice editor sits beside Take down. */}
          </div>
          <h3 className="scard-h">Timeline</h3>
          <ol className="scard-timeline">
            {timeline.map((e, i) => (
              <li key={`${e.at}-${i}`} className="scard-event" data-testid="scard-event">
                <span className="scard-when">{when(e.at)}</span>
                <span className="scard-what">{eventWords(e)}{e.version ? ` · v${e.version}` : ''}</span>
                {e.note && <span className="scard-note">“{e.note}”</span>}
              </li>
            ))}
            {!timeline.length && <li className="scard-fine">No events recorded.</li>}
          </ol>
          <h3 className="scard-h">The latest check{card.review.checkedAt ? ` · ${day(card.review.checkedAt)}` : ''}</h3>
          {findings.length ? (
            <table className="scard-tbl">
              <thead><tr><th className="scard-col-q">Question</th><th className="scard-col-b">Band</th><th className="scard-col-c">Category</th><th className="scard-col-w">Why</th></tr></thead>
              <tbody>
                {findings.map((f, i) => (
                  <tr key={i} className="scard-finding" data-testid="scard-finding">
                    <td>{f.questionId === '(set)' ? "The set's own text" : f.questionId}</td>
                    <td><span className={`scard-chip scard-chip--${bandWord(f.band) || 'none'}`}>{bandWord(f.band)}</span></td>
                    <td>{String(f.category || '').toLowerCase()}</td>
                    <td className="scard-why">{f.explanation || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : <p className="scard-fine">The check found nothing to say.</p>}
          {/* Stage 3: reports by type, and each report's note (never the reporter). */}
        </>
      )}
      {asking && card && <TakedownDialog name={card.name || card.publicSetId} busy={busy} onClose={() => setAsking(false)} onConfirm={takeDown} />}
    </section>
  );
}
