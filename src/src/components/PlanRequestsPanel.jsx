import React, { useCallback, useEffect, useState } from 'react';
import { authFetch } from '../auth/authFetch';
import { adminApiUrl } from '../utils/adminApi';
import Modal from './Modal';
import Icon from './Icon';
import { formatWhen } from '../config/tableCells';
import './PlanRequests.css';

/**
 * THE PLATFORM QUEUE — docs/design/tenancy-redesign/15-platform-plan-requests.html.
 *
 * Staff see what the customer will pay (list price, and the code they named)
 * and decide with a note the customer reads word for word. The primary
 * button is named for the decision, never "Submit", because a plan change is
 * not undone by pressing back.
 *
 * Reads GET /platform/plan-requests?status=; decides with
 * POST /platform/plan-requests/{orgId}/{reqId}/decide. `.preq` is this
 * screen's scope; PlanRequests.css carries it and the owner-side strip.
 */
const STATUS_LABEL = { requested: 'Waiting', approved: 'Approved', declined: 'Declined', withdrawn: 'Withdrawn' };

export default function PlanRequestsPanel({ onCountChange }) {
  const [status, setStatus] = useState('requested');
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [deciding, setDeciding] = useState(null); // the row
  const [notice, setNotice] = useState('');

  const load = useCallback(async (which = status) => {
    setLoading(true); setError('');
    try {
      const res = await authFetch(adminApiUrl(`platform/plan-requests?status=${encodeURIComponent(which)}`));
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
      setRows(body.requests || []);
      if (which === 'requested' && onCountChange) onCountChange((body.requests || []).length);
    } catch (e) {
      setError(e.message || 'Could not load plan requests.');
    } finally {
      setLoading(false);
    }
  }, [status, onCountChange]);

  useEffect(() => { load(status); }, [status]); // eslint-disable-line react-hooks/exhaustive-deps

  const decided = (row, plan, decision, note) => {
    setDeciding(null);
    setNotice(`${row.orgName}: ${decision} — “${note}”${decision === 'approved' ? ` They are on the ${plan} plan now.` : ''}`);
    load(status);
  };

  return (
    <div className="preq">
      {notice && (
        <div className="preq-alert preq-alert--ok" role="status">
          <Icon name="Check" weight="fill" size={16} color="currentColor" />
          <span>{notice}</span>
          <button type="button" className="preq-btn preq-btn--link" onClick={() => setNotice('')}>Dismiss</button>
        </div>
      )}
      {error && (
        <div className="preq-alert" role="alert">
          <Icon name="Warning" weight="fill" size={16} color="currentColor" />
          <span>{error}</span>
        </div>
      )}

      <div className="preq-head">
        <label className="preq-filter">
          <span className="preq-lab">Show</span>
          <select className="preq-select" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Which requests">
            <option value="requested">Waiting</option>
            <option value="approved">Approved</option>
            <option value="declined">Declined</option>
            <option value="withdrawn">Withdrawn</option>
            <option value="all">All</option>
          </select>
        </label>
        <span className="preq-count">{loading ? 'Loading…' : `${rows.length} request${rows.length === 1 ? '' : 's'}`}</span>
      </div>

      {!loading && rows.length === 0 && !error && (
        <div className="preq-empty" data-testid="preq-empty">
          <h3>{status === 'requested' ? 'Nothing waiting' : 'Nothing here'}</h3>
          <p>{status === 'requested'
            ? 'When a team owner asks for the Team plan, the request appears here with their note and any code they named.'
            : 'No requests in this state.'}</p>
        </div>
      )}

      {rows.length > 0 && (
        <table className="preq-tbl">
          <thead>
            <tr>
              <th className="preq-col-org">Organisation</th>
              <th className="preq-col-when">Asked</th>
              <th className="preq-col-plan">Plan</th>
              <th className="preq-col-code">Code</th>
              <th className="preq-col-note">Note</th>
              <th className="preq-col-acts" />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={`${r.orgId}:${r.reqId}`} data-testid="preq-row">
                <td>
                  <span className="preq-name" title={r.orgName}>{r.orgName}</span>
                  <span className="preq-sub">{r.orgType || 'org'} · {r.requestedByEmail || r.requestedBy}</span>
                </td>
                <td className="preq-when">{formatWhen(r.requestedAt)}</td>
                <td>{r.fromPlan} → <b>{r.toPlan}</b></td>
                <td>{r.code ? <code className="preq-code">{r.code}</code> : <span className="preq-dim">—</span>}</td>
                <td className="preq-wrap">{r.status === 'requested'
                  ? (r.note || <span className="preq-dim">(no note)</span>)
                  : <><span className={`preq-chip preq-chip--${r.status}`}>{STATUS_LABEL[r.status]}</span> {r.decisionNote}</>}</td>
                <td>
                  {r.status === 'requested' && (
                    <div className="preq-rowact">
                      <button type="button" className="preq-btn preq-btn--primary preq-btn--sm" onClick={() => setDeciding(r)}>
                        Decide…
                      </button>
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {deciding && (
        <DecideRequestDialog
          request={deciding}
          onCancel={() => setDeciding(null)}
          onDecided={decided}
        />
      )}
    </div>
  );
}

/**
 * THE DECISION. Approve/Decline as a radio, a REQUIRED note to the customer,
 * and a primary button that says which it will do. X and Cancel share one
 * close; Escape and the backdrop are held while a note is typed.
 */
export function DecideRequestDialog({ request, onCancel, onDecided }) {
  const [decision, setDecision] = useState('approved');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const dirty = note.trim().length > 0;

  const requestClose = () => {
    if (busy) return;
    if (dirty && !window.confirm('Close without deciding? The note you typed will be lost.')) return;
    onCancel();
  };

  const submit = async () => {
    if (!note.trim()) { setError('A note to the customer is required — they read it.'); return; }
    setBusy(true); setError('');
    try {
      const res = await authFetch(adminApiUrl(`platform/plan-requests/${encodeURIComponent(request.orgId)}/${encodeURIComponent(request.reqId)}/decide`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision, note: note.trim() }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
      onDecided(request, body.plan, decision, note.trim());
    } catch (e) {
      setError(e.message || 'The decision was not saved.');
      setBusy(false);
    }
  };

  return (
    <Modal
      overlayClassName="preq preq-scrim"
      contentClassName="preq-modal"
      labelledBy="preq-decide-title"
      onClose={requestClose}
      closeOnBackdrop={() => !dirty && !busy}
      closeOnEscape={() => !dirty && !busy}
    >
      <header className="preq-modal-head">
        <div className="preq-grow">
          <h2 id="preq-decide-title">Decide: {request.orgName}</h2>
          <p className="preq-dim">
            Asked {formatWhen(request.requestedAt)}{request.code ? ` with code ${request.code}` : ''} · {request.fromPlan} → {request.toPlan}
          </p>
        </div>
        <button type="button" className="preq-x" onClick={requestClose} aria-label="Close" title="Close" disabled={busy}>×</button>
      </header>
      <div className="preq-modal-body">
        {request.note && <blockquote className="preq-quote">“{request.note}”</blockquote>}
        <div className="preq-sum">
          <div className="preq-sum-row"><span>If approved, from today</span><b>Team · $5.00 <small>list</small></b></div>
          {request.code && (
            <div className="preq-sum-row preq-sum-row--code">
              <span>Code <code className="preq-code">{request.code}</code></span>
              <span className="preq-dim">applied by the ledger once codes exist (step 3) — recorded on the request now</span>
            </div>
          )}
        </div>
        <fieldset className="preq-fieldset">
          <legend className="preq-lab">Decision</legend>
          <label className={`preq-opt${decision === 'approved' ? ' is-on' : ''}`}>
            <input type="radio" name="preq-decision" value="approved" checked={decision === 'approved'} onChange={() => setDecision('approved')} />
            <b>Approve</b> <span className="preq-dim">— plan changes now</span>
          </label>
          <label className={`preq-opt${decision === 'declined' ? ' is-on' : ''}`}>
            <input type="radio" name="preq-decision" value="declined" checked={decision === 'declined'} onChange={() => setDecision('declined')} />
            <b>Decline</b> <span className="preq-dim">— nothing changes; they can ask again</span>
          </label>
        </fieldset>
        <label className="preq-field">
          <span className="preq-lab">Note to the customer <span className="preq-dim">(required)</span></span>
          <textarea className="preq-input" rows={3} value={note} onChange={(e) => setNote(e.target.value)} disabled={busy} />
          <span className="preq-help">Shown to them word for word on their Plan &amp; usage screen, and kept in their plan history with your name.</span>
        </label>
        {error && <p className="preq-alert" role="alert">{error}</p>}
      </div>
      <footer className="preq-modal-foot">
        <button type="button" className="preq-btn" onClick={requestClose} disabled={busy}>Cancel</button>
        <button
          type="button"
          className={`preq-btn ${decision === 'approved' ? 'preq-btn--primary' : 'preq-btn--danger'}`}
          onClick={submit}
          disabled={busy}
          data-testid="preq-decide"
        >
          {busy ? 'Saving…' : decision === 'approved' ? 'Approve' : 'Decline'}
        </button>
      </footer>
    </Modal>
  );
}
