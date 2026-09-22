import React, { useState } from 'react';
import { authFetch } from '../auth/authFetch';
import { adminApiUrl } from '../utils/adminApi';
import Modal from './Modal';
import pricing from '../../../lambda-functions/game/pricing';
import { formatWhen } from '../config/tableCells';
import './PlanRequests.css';

const { TEAM_PLAN, formatCents } = pricing;

/**
 * "REQUEST THE TEAM PLAN" — docs/design/tenancy-redesign/13-plan-request.html.
 *
 * The upgrade is a request Engage decides by hand. It is drawn as a real
 * checkout — list price, what is included, a code — because the simulated
 * invoice will read the same way and a person should meet these numbers
 * before they see them on a bill. "No card. No charge." sits above the
 * button, not in a footer: it is the sentence the whole simulated system
 * rests on.
 *
 * The code is CARRIED on the request and applied only on approval by step 3's
 * ledger; until codes exist server-side it is shown back, not priced. The
 * dialog says so rather than inventing a discount it cannot promise.
 */
export default function PlanRequestDialog({ orgId, orgName, onClose, onRequested }) {
  const [code, setCode] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const dirty = note.trim().length > 0 || code.trim().length > 0;

  const requestClose = () => {
    if (busy) return;
    if (dirty && !window.confirm('Close without sending? What you typed will be lost.')) return;
    onClose();
  };

  const submit = async () => {
    setBusy(true); setError('');
    try {
      const res = await authFetch(adminApiUrl(`orgs/${encodeURIComponent(orgId)}/plan-requests`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ toPlan: 'team', note: note.trim(), code: code.trim().toUpperCase() }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
      onRequested(body.request);
    } catch (e) {
      setError(e.message || 'The request was not sent.');
      setBusy(false);
    }
  };

  return (
    <Modal
      overlayClassName="preq preq-scrim"
      contentClassName="preq-modal"
      labelledBy="preq-ask-title"
      onClose={requestClose}
      closeOnBackdrop={() => !dirty && !busy}
      closeOnEscape={() => !dirty && !busy}
    >
      <header className="preq-modal-head">
        <div className="preq-grow">
          <h2 id="preq-ask-title">Request the Team plan</h2>
          <p className="preq-dim">For <b>{orgName}</b>. Engage reviews requests by hand for now — usually within a day.</p>
        </div>
        <button type="button" className="preq-x" onClick={requestClose} aria-label="Close" title="Close" disabled={busy}>×</button>
      </header>
      <div className="preq-modal-body">
        <div className="preq-sum" data-testid="preq-sum">
          <div className="preq-sum-row"><span>Team plan, list price</span><b>{formatCents(TEAM_PLAN.base)} <small>a month</small></b></div>
          <div className="preq-sum-row">
            <span>Includes</span>
            <span>{TEAM_PLAN.includedSessions} sessions · {TEAM_PLAN.includedSets} stored sets · then {formatCents(TEAM_PLAN.perSession)} each</span>
          </div>
        </div>

        <label className="preq-field">
          <span className="preq-lab">Discount code <span className="preq-dim">(optional)</span></span>
          <input
            className="preq-input preq-input--code"
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            placeholder="e.g. WELCOME30"
            maxLength={32}
            disabled={busy}
          />
          <span className="preq-help">Carried with the request and applied when it is approved, never before.</span>
        </label>

        <label className="preq-field">
          <span className="preq-lab">Anything Engage should know? <span className="preq-dim">(optional)</span></span>
          <textarea
            className="preq-input"
            rows={2}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="e.g. We run a facilitator programme for 40 people from October."
            maxLength={600}
            disabled={busy}
          />
        </label>

        <p className="preq-note" data-testid="preq-no-charge">
          <b>No card. No charge.</b> Billing is simulated while Engage is in preview: each month you will see an
          invoice that says what you <i>would</i> have been charged, and why, and nothing is taken. You can
          withdraw this request any time before it is decided.
        </p>
        {error && <p className="preq-alert" role="alert">{error}</p>}
      </div>
      <footer className="preq-modal-foot">
        <button type="button" className="preq-btn" onClick={requestClose} disabled={busy}>Not now</button>
        <button type="button" className="preq-btn preq-btn--primary" onClick={submit} disabled={busy} data-testid="preq-send">
          {busy ? 'Sending…' : 'Send the request'}
        </button>
      </footer>
    </Modal>
  );
}

/**
 * THE STRIP — mockup 14. One component, four states, told apart by the first
 * word as well as the rule colour. Sits above the meters on Plan & usage.
 */
export function PlanRequestStrip({ request, onWithdraw, onRequestAgain, busy = false }) {
  if (!request) return null;
  const { status, decisionNote, decidedAt, requestedAt, withdrawnAt, code, toPlan } = request;
  const tone = status === 'approved' ? 'ok' : status === 'declined' ? 'no' : '';
  return (
    <div className={`preq-strip${tone ? ` preq-strip--${tone}` : ''}`} data-testid="preq-strip" data-status={status}>
      <div className="preq-grow">
        {status === 'requested' && (
          <>
            <b>Team plan requested</b> — waiting for Engage.
            <div className="preq-who">Sent {formatWhen(requestedAt)}{code ? ` · code ${code}` : ''} · usually decided within a day.</div>
          </>
        )}
        {status === 'approved' && (
          <>
            <b>You are on the {toPlan} plan</b> from {formatWhen(decidedAt)}.{decisionNote ? <> <q>{decisionNote}</q></> : null}
            <div className="preq-who">Approved {formatWhen(decidedAt)} by Engage.</div>
          </>
        )}
        {status === 'declined' && (
          <>
            <b>Not this time.</b>{decisionNote ? <> <q>{decisionNote}</q></> : null}
            <div className="preq-who">Declined {formatWhen(decidedAt)} by Engage. You can request again straight away.</div>
          </>
        )}
        {status === 'withdrawn' && (
          <>
            <b>Request withdrawn</b> on {formatWhen(withdrawnAt)}. Nothing changed.
            <div className="preq-who">Request again whenever you like.</div>
          </>
        )}
      </div>
      {status === 'requested' && onWithdraw && (
        <button type="button" className="preq-btn preq-btn--sm" onClick={onWithdraw} disabled={busy}>Withdraw</button>
      )}
      {(status === 'declined' || status === 'withdrawn') && onRequestAgain && (
        <button type="button" className="preq-btn preq-btn--sm preq-btn--primary" onClick={onRequestAgain} disabled={busy}>
          {status === 'declined' ? 'Request again' : 'Request the Team plan'}
        </button>
      )}
    </div>
  );
}
