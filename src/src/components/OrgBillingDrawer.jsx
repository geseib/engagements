import React, { useCallback, useEffect, useState } from 'react';
import { authFetch } from '../auth/authFetch';
import { adminApiUrl } from '../utils/adminApi';
import Modal from './Modal';
import AdjustmentsLedger, { AdjustedBill } from './AdjustmentsLedger';
import pricingAdjust from '../../../lambda-functions/game/pricing-adjust';
import pricing from '../../../lambda-functions/game/pricing';
import './OrgBillingDrawer.css';

const { applyAdjustments, simulationSentence, offerWindow } = pricingAdjust;
const { TEAM_PLAN, PERSONAL_PLAN, formatCents } = pricing;

/**
 * AN ORGANISATION'S BILLING, AS ENGAGE SEES IT — mockups 16 and 17.
 *
 * A ledger, not a plan editor. The month is previewed as the invoice in
 * miniature (the same `applyAdjustments` the customer's screen and the
 * invoice use), then every adjustment ever granted with who/when/why;
 * revoke adds a fact. "Grant an adjustment" opens ONE dialog for the four
 * kinds the owner named, with the effect on this period previewed BEFORE
 * anything is written, and "Simulated" said again.
 *
 * Reads GET /platform/orgs/{id}/adjustments and the org's usage (staff are
 * not members, so the usage numbers come with the ledger read: this drawer
 * asks the platform list for `usage` on the org row, or previews against the
 * list month when none is known).
 */
export default function OrgBillingDrawer({ org, onClose }) {
  const [rows, setRows] = useState([]);
  const [period, setPeriod] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [granting, setGranting] = useState(false);
  const [revoking, setRevoking] = useState(null);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const res = await authFetch(adminApiUrl(`platform/orgs/${encodeURIComponent(org.orgId)}/adjustments`));
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
      setRows(body.adjustments || []);
      setPeriod(body.period || '');
    } catch (e) {
      setError(e.message || 'Could not read the ledger.');
    } finally {
      setLoading(false);
    }
  }, [org.orgId]);
  useEffect(() => { load(); }, [load]);

  const plan = org.plan === 'team' ? TEAM_PLAN : PERSONAL_PLAN;
  const usage = org.usage || { sessionsRun: 0, setsPeak: 0, setsCurrent: 0 };
  const adjusted = period ? applyAdjustments(plan, usage, rows, period) : null;
  if (adjusted) adjusted.sentence = simulationSentence(adjusted);

  return (
    <Modal
      overlayClassName="obill obill-scrim"
      contentClassName="obill-modal"
      labelledBy="obill-title"
      onClose={onClose}
      closeOnBackdrop={() => !granting && !revoking}
      closeOnEscape={() => !granting && !revoking}
    >
      <header className="obill-head">
        <div className="obill-grow">
          <h2 id="obill-title">{org.name} — billing</h2>
          <p className="obill-dim">{org.plan === 'team' ? 'Team plan' : 'Free'}{org.ownerEmail ? ` · owner ${org.ownerEmail}` : ''} · every number here is a row you can open.</p>
        </div>
        <button type="button" className="obill-x" onClick={onClose} aria-label="Close" title="Close">×</button>
      </header>
      <div className="obill-body">
        {error && <p className="obill-alert" role="alert">{error}</p>}
        {loading && <p className="obill-dim">Loading the ledger…</p>}
        {adjusted && (
          <>
            <h3 className="obill-h3">{period}, if it ended today</h3>
            <AdjustedBill adjusted={adjusted} audience="staff" />
          </>
        )}
        <h3 className="obill-h3">Adjustments</h3>
        {!loading && <AdjustmentsLedger adjustments={rows} audience="staff" onRevoke={(a) => setRevoking(a)} />}
      </div>
      <footer className="obill-foot">
        <button type="button" className="obill-btn" onClick={onClose}>Close</button>
        <button type="button" className="obill-btn obill-btn--primary" onClick={() => setGranting(true)} data-testid="obill-grant">Grant an adjustment</button>
      </footer>

      {granting && (
        <GrantAdjustmentDialog
          org={org}
          plan={plan}
          usage={usage}
          rows={rows}
          period={period}
          onCancel={() => setGranting(false)}
          onGranted={() => { setGranting(false); load(); }}
        />
      )}
      {revoking && (
        <RevokeDialog
          org={org}
          adjustment={revoking}
          onCancel={() => setRevoking(null)}
          onRevoked={() => { setRevoking(null); load(); }}
        />
      )}
    </Modal>
  );
}

const KINDS = [
  { id: 'CREDIT_CENTS', label: 'Credit', help: 'A dollar amount in their favour. Carries forward until spent.' },
  { id: 'OFFER', label: 'Months at a discount', help: 'X months at Y% off, or free. Starts this period unless you say later.' },
  { id: 'RATE_OVERRIDE', label: 'Special rate', help: 'A different base price, for a window.' },
  { id: 'CREDIT_UNITS', label: 'Extra allowance', help: 'More included sessions or sets, for a window. No money.' },
];

/** Months from now → period ids for the "applies from" select. */
function upcomingPeriods(period, n = 4) {
  const out = [];
  for (let i = 0; i < n; i += 1) out.push(pricingAdjust.addMonths(period, i));
  return out;
}

/** The dollar/percent inputs as they are typed, turned into a grant body. */
export function grantBody(kind, fields, period) {
  const body = { kind, note: fields.note.trim(), validFrom: fields.validFrom || period };
  const dollars = Number(String(fields.amount).replace(/[^0-9.]/g, '')) || 0;
  if (kind === 'CREDIT_CENTS') body.amountCents = Math.round(dollars * 100);
  if (kind === 'OFFER') {
    if (fields.percent) body.percentOff = Number(fields.percent) || 0;
    else body.fixedOffCents = Math.round(dollars * 100);
    body.months = Number(fields.months) || 1;
  }
  if (kind === 'RATE_OVERRIDE') { body.rate = { baseCents: Math.round(dollars * 100) }; body.months = Number(fields.months) || 1; }
  if (kind === 'CREDIT_UNITS') { body.units = { sessions: Number(fields.sessions) || 0, sets: Number(fields.sets) || 0 }; body.months = Number(fields.months) || 1; }
  return body;
}

/** A local preview row in the shape the ledger stores, for applyAdjustments. */
function previewRow(body, period) {
  const w = body.months ? offerWindow(body.validFrom || period, body.months) : { validFrom: body.validFrom || period };
  return { adjId: 'preview', createdAt: '9999', source: { type: 'platform_admin' }, ...body, ...w, ...(body.kind === 'CREDIT_CENTS' ? { remainingCents: body.amountCents } : {}) };
}

export function GrantAdjustmentDialog({ org, plan, usage, rows, period, onCancel, onGranted }) {
  const [kind, setKind] = useState('CREDIT_CENTS');
  const [fields, setFields] = useState({ amount: '10.00', percent: '30', months: '3', sessions: '5', sets: '0', validFrom: period, note: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = (k) => (e) => setFields((f) => ({ ...f, [k]: e.target.value }));
  const dirty = fields.note.trim().length > 0;

  const body = grantBody(kind, fields, period);
  const preview = period ? applyAdjustments(plan, usage, [...rows, previewRow(body, period)], period) : null;

  const requestClose = () => {
    if (busy) return;
    if (dirty && !window.confirm('Close without granting? What you typed will be lost.')) return;
    onCancel();
  };
  const submit = async () => {
    if (!body.note) { setError('A reason is required — the customer reads it.'); return; }
    setBusy(true); setError('');
    try {
      const res = await authFetch(adminApiUrl(`platform/orgs/${encodeURIComponent(org.orgId)}/adjustments`), {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      const out = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(out.error || `HTTP ${res.status}`);
      onGranted(out.adjustment);
    } catch (e) {
      setError(e.message || 'Nothing was granted.');
      setBusy(false);
    }
  };

  const buttonLabel = kind === 'CREDIT_CENTS' ? `Grant ${formatCents(body.amountCents || 0)} credit`
    : kind === 'OFFER' ? `Grant ${fields.percent ? `${body.percentOff}% off` : `${formatCents(body.fixedOffCents || 0)} off`} for ${body.months} month${body.months === 1 ? '' : 's'}`
      : kind === 'RATE_OVERRIDE' ? `Set ${formatCents(body.rate.baseCents)} base for ${body.months} month${body.months === 1 ? '' : 's'}`
        : `Grant ${body.units.sessions} sessions, ${body.units.sets} sets`;

  return (
    <Modal
      overlayClassName="obill obill-scrim obill-scrim--over"
      contentClassName="obill-modal obill-modal--narrow"
      labelledBy="obill-grant-title"
      onClose={requestClose}
      closeOnBackdrop={() => !dirty && !busy}
      closeOnEscape={() => !dirty && !busy}
    >
      <header className="obill-head">
        <div className="obill-grow">
          <h2 id="obill-grant-title">Grant an adjustment</h2>
          <p className="obill-dim">To <b>{org.name}</b>. Written to their ledger with your name; they see it on Plan &amp; usage.</p>
        </div>
        <button type="button" className="obill-x" onClick={requestClose} aria-label="Close" title="Close" disabled={busy}>×</button>
      </header>
      <div className="obill-body">
        <fieldset className="obill-kinds">
          <legend className="obill-lab">Kind</legend>
          {KINDS.map((k) => (
            <label key={k.id} className={`obill-kind${kind === k.id ? ' is-on' : ''}`}>
              <input type="radio" name="obill-kind" value={k.id} checked={kind === k.id} onChange={() => setKind(k.id)} />
              <span><b>{k.label}</b><small>{k.help}</small></span>
            </label>
          ))}
        </fieldset>

        <div className="obill-grid">
          {(kind === 'CREDIT_CENTS' || kind === 'RATE_OVERRIDE' || (kind === 'OFFER' && !fields.percent)) && (
            <label className="obill-field"><span className="obill-lab">{kind === 'RATE_OVERRIDE' ? 'Base price a month' : 'Amount'}</span>
              <input className="obill-input" value={fields.amount} onChange={set('amount')} inputMode="decimal" aria-label="Amount in dollars" /></label>
          )}
          {kind === 'OFFER' && (
            <label className="obill-field"><span className="obill-lab">Percent off <span className="obill-dim">(blank for a fixed amount)</span></span>
              <input className="obill-input" value={fields.percent} onChange={set('percent')} inputMode="numeric" aria-label="Percent off" /></label>
          )}
          {kind === 'CREDIT_UNITS' && (
            <>
              <label className="obill-field"><span className="obill-lab">Extra sessions</span><input className="obill-input" value={fields.sessions} onChange={set('sessions')} inputMode="numeric" aria-label="Extra sessions" /></label>
              <label className="obill-field"><span className="obill-lab">Extra sets</span><input className="obill-input" value={fields.sets} onChange={set('sets')} inputMode="numeric" aria-label="Extra sets" /></label>
            </>
          )}
          {kind !== 'CREDIT_CENTS' && (
            <label className="obill-field"><span className="obill-lab">For how many months</span>
              <input className="obill-input" value={fields.months} onChange={set('months')} inputMode="numeric" aria-label="Months" /></label>
          )}
          <label className="obill-field"><span className="obill-lab">Applies from</span>
            <select className="obill-input" value={fields.validFrom} onChange={set('validFrom')} aria-label="Applies from">
              {upcomingPeriods(period).map((p, i) => <option key={p} value={p}>{i === 0 ? `This period (${p})` : p}</option>)}
            </select></label>
        </div>

        <label className="obill-field">
          <span className="obill-lab">Reason <span className="obill-dim">(required — the customer reads it)</span></span>
          <textarea className="obill-input" rows={2} value={fields.note} onChange={set('note')} disabled={busy} data-testid="obill-reason" />
        </label>

        {preview && (
          <div data-testid="obill-preview">
            <h3 className="obill-h3">{period}, with this grant</h3>
            <AdjustedBill adjusted={{ ...preview, sentence: simulationSentence(preview) }} audience="staff" />
          </div>
        )}
        {error && <p className="obill-alert" role="alert">{error}</p>}
      </div>
      <footer className="obill-foot">
        <button type="button" className="obill-btn" onClick={requestClose} disabled={busy}>Cancel</button>
        <button type="button" className="obill-btn obill-btn--primary" onClick={submit} disabled={busy} data-testid="obill-grant-submit">{busy ? 'Granting…' : buttonLabel}</button>
      </footer>
    </Modal>
  );
}

function RevokeDialog({ org, adjustment, onCancel, onRevoked }) {
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const submit = async () => {
    if (!note.trim()) { setError('A reason is required — the customer reads it.'); return; }
    setBusy(true); setError('');
    try {
      const res = await authFetch(adminApiUrl(`platform/orgs/${encodeURIComponent(org.orgId)}/adjustments/${encodeURIComponent(adjustment.adjId)}/revoke`), {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ note: note.trim() }),
      });
      const out = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(out.error || `HTTP ${res.status}`);
      onRevoked();
    } catch (e) { setError(e.message || 'Not revoked.'); setBusy(false); }
  };
  return (
    <Modal overlayClassName="obill obill-scrim obill-scrim--over" contentClassName="obill-modal obill-modal--narrow" labelledBy="obill-revoke-title" onClose={onCancel} closeOnBackdrop={() => !busy} closeOnEscape={() => !busy}>
      <header className="obill-head">
        <div className="obill-grow"><h2 id="obill-revoke-title">Revoke this adjustment?</h2><p className="obill-dim">{pricingAdjust.describe(adjustment)}. The row stays on their ledger, marked revoked with your reason.</p></div>
        <button type="button" className="obill-x" onClick={onCancel} aria-label="Close" title="Close" disabled={busy}>×</button>
      </header>
      <div className="obill-body">
        <label className="obill-field"><span className="obill-lab">Reason <span className="obill-dim">(required — the customer reads it)</span></span>
          <textarea className="obill-input" rows={2} value={note} onChange={(e) => setNote(e.target.value)} disabled={busy} /></label>
        {error && <p className="obill-alert" role="alert">{error}</p>}
      </div>
      <footer className="obill-foot">
        <button type="button" className="obill-btn" onClick={onCancel} disabled={busy}>Cancel</button>
        <button type="button" className="obill-btn obill-btn--danger" onClick={submit} disabled={busy}>{busy ? 'Revoking…' : 'Revoke'}</button>
      </footer>
    </Modal>
  );
}
