import React, { useState } from 'react';
import { authFetch } from '../auth/authFetch';
import { adminApiUrl } from '../utils/adminApi';
import Modal from './Modal';
import pricing from '../../../lambda-functions/game/pricing';
import { formatWhen } from '../config/tableCells';
import './PlanRequests.css';

const { upgradePlanFor, planById, formatCents, PERSONAL_PLAN } = pricing;

/** "Standard plan", "Organisation plan", "Free" — for a stored plan id. */
export const planNameOf = (planId) => planById(planId).name;

/**
 * The terms, in the dialog's two summary rows. Standard has a monthly price
 * and an allowance; the Organisation plan is pay per use, with neither.
 */
export function planTerms(plan) {
  const each = formatCents(plan.perSession);
  const event = formatCents(plan.perEvent);
  if (plan.base > 0) {
    return {
      price: <>{formatCents(plan.base)} <small>a month</small></>,
      includes: `${plan.includedSessions} sessions · ${plan.includedSets} stored sets · then ${each} each · events ${event} each`,
    };
  }
  return {
    price: <>No monthly fee</>,
    includes: `Pay per use: ${each} a session · ${formatCents(plan.perSet)} a stored set a month · ${event} an event`,
  };
}

/**
 * "REQUEST THE PLAN" — docs/design/tenancy-redesign/13-plan-request.html.
 *
 * WHICH PLAN (the owner, 27 Sep 2026): a person's own space asks for
 * STANDARD — "the standard tier for individuals (should not be team plan)" —
 * and a team for the ORGANISATION plan, the request create-org files for it
 * when it is made. `orgType` decides; the server refuses a crossed request.
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
export default function PlanRequestDialog({ orgId, orgName, orgType = '', onClose, onRequested }) {
  const plan = upgradePlanFor({ type: orgType });
  const terms = planTerms(plan);
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
        body: JSON.stringify({ toPlan: plan.id, note: note.trim(), code: code.trim().toUpperCase() }),
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
          <h2 id="preq-ask-title">{`Request the ${plan.name}`}</h2>
          <p className="preq-dim">For <b>{orgName}</b>. Engage reviews requests by hand for now — usually within a day.</p>
        </div>
        <button type="button" className="preq-x" onClick={requestClose} aria-label="Close" title="Close" disabled={busy}>×</button>
      </header>
      <div className="preq-modal-body">
        <div className="preq-sum" data-testid="preq-sum">
          <div className="preq-sum-row"><span>{`${plan.name}, list price`}</span><b>{terms.price}</b></div>
          <div className="preq-sum-row">
            <span>{plan.base > 0 ? 'Includes' : 'Charges'}</span>
            <span>{terms.includes}</span>
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
  const { status, decisionNote, decidedAt, requestedAt, withdrawnAt, code, toPlan, kind } = request;
  // A row always names its plan; one that somehow does not still reads as a
  // paid plan, never as "Free requested".
  const name = toPlan ? planNameOf(toPlan) : 'Paid plan';
  const tone = status === 'approved' ? 'ok' : status === 'declined' ? 'no' : '';
  return (
    <div className={`preq-strip${tone ? ` preq-strip--${tone}` : ''}`} data-testid="preq-strip" data-status={status}>
      <div className="preq-grow">
        {status === 'requested' && (
          <>
            {kind === 'new-organisation'
              ? <><b>{`${name} requested with this team`}</b> — waiting for Engage to approve it. {`Until then it runs on Free: ${PERSONAL_PLAN.includedSessions} sessions, ${PERSONAL_PLAN.includedSets} sets, no events.`}</>
              : <><b>{`${name} requested`}</b> — waiting for Engage.</>}
            <div className="preq-who">Sent {formatWhen(requestedAt)}{code ? ` · code ${code}` : ''} · usually decided within a day.</div>
          </>
        )}
        {status === 'approved' && (
          <>
            <b>{`You are on the ${name}`}</b> from {formatWhen(decidedAt)}.{decisionNote ? <> <q>{decisionNote}</q></> : null}
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
          {status === 'declined' ? 'Request again' : `Request the ${name}`}
        </button>
      )}
    </div>
  );
}
