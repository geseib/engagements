import React, { useCallback, useEffect, useState } from 'react';
import { authFetch } from '../auth/authFetch';
import { adminApiUrl } from '../utils/adminApi';
import Modal from './Modal';
import pricing from '../../../lambda-functions/game/pricing';
import './DiscountCodes.css';

const { TEAM_PLAN, formatCents } = pricing;

/**
 * DISCOUNT CODES — mockup 18. Platform rows with terms and a use counter;
 * each redemption is a row on the team that used it (plan-requests.js
 * redeems on approval). Retire, never delete: a retired code stops
 * redeeming; the rows that used it keep pointing at it.
 */
function what(c) {
  const give = c.percentOff != null ? `${c.percentOff}% off` : `${formatCents(c.fixedOffCents)} off`;
  return c.months ? `${give} for ${c.months} month${c.months === 1 ? '' : 's'}` : `${give}, ongoing`;
}
const STATUS = { active: 'Active', expired: 'Expired', exhausted: 'Used up', retired: 'Retired' };

export default function DiscountCodesPanel() {
  const [codes, setCodes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [creating, setCreating] = useState(false);
  const [retiring, setRetiring] = useState('');

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const res = await authFetch(adminApiUrl('platform/codes'));
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
      setCodes(body.codes || []);
    } catch (e) { setError(e.message || 'Could not load codes.'); } finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const retire = async (code) => {
    if (!window.confirm(`Retire ${code}? Nobody can redeem it after this; teams that already used it keep their discount.`)) return;
    setRetiring(code);
    try {
      const res = await authFetch(adminApiUrl(`platform/codes/${encodeURIComponent(code)}/retire`), { method: 'POST' });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `HTTP ${res.status}`);
      await load();
    } catch (e) { setError(e.message); } finally { setRetiring(''); }
  };

  return (
    <div className="dcode">
      {error && <p className="dcode-alert" role="alert">{error}</p>}
      <div className="dcode-head">
        <span className="dcode-count">{loading ? 'Loading…' : `${codes.length} code${codes.length === 1 ? '' : 's'}`}</span>
        <button type="button" className="dcode-btn dcode-btn--primary" onClick={() => setCreating(true)} data-testid="dcode-new">New code</button>
      </div>
      {!loading && codes.length === 0 && !error && (
        <div className="dcode-empty" data-testid="dcode-empty">
          <h3>No codes yet</h3>
          <p>A code is redeemed by a team owner when they request the plan, and applied on approval. Each use is a row on that team's ledger.</p>
        </div>
      )}
      {codes.length > 0 && (
        <table className="dcode-tbl">
          <thead><tr><th className="dcode-col-code">Code</th><th className="dcode-col-gives">Gives</th><th className="dcode-col-valid">Valid</th><th className="dcode-col-uses">Uses</th><th className="dcode-col-note">Note</th><th className="dcode-col-acts" /></tr></thead>
          <tbody>
            {codes.map((c) => {
              const frac = c.maxUses ? Math.min(1, (c.uses || 0) / c.maxUses) : 0;
              return (
                <tr key={c.code} className={c.status !== 'active' ? 'dcode-row--off' : ''} data-testid="dcode-row" data-status={c.status}>
                  <td><code className="dcode-code">{c.code}</code>{c.status !== 'active' && <span className={`dcode-chip dcode-chip--${c.status}`}>{STATUS[c.status]}</span>}</td>
                  <td>{what(c)}</td>
                  <td className="dcode-when">{c.validUntil ? `to ${c.validUntil}` : 'no end'}</td>
                  <td>
                    {c.maxUses ? (
                      <span className="dcode-uses"><span className="dcode-track"><span className="dcode-fill" style={{ width: `${frac * 100}%` }} /></span><span className="dcode-dim">{c.uses || 0} of {c.maxUses}</span></span>
                    ) : <span className="dcode-dim">{c.uses || 0}, no cap</span>}
                  </td>
                  <td className="dcode-wrap">{c.note}</td>
                  <td>
                    {c.status === 'active' && (
                      <div className="dcode-rowact"><button type="button" className="dcode-btn dcode-btn--sm" disabled={retiring === c.code} onClick={() => retire(c.code)}>Retire</button></div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      {creating && <NewCodeDialog onCancel={() => setCreating(false)} onCreated={() => { setCreating(false); load(); }} />}
    </div>
  );
}

export function NewCodeDialog({ onCancel, onCreated }) {
  const [f, setF] = useState({ code: '', amount: '25', unit: 'percent', months: '2', validUntil: '', maxUses: '100', note: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: k === 'code' ? e.target.value.toUpperCase() : e.target.value }));
  const dirty = f.code.length > 0 || f.note.length > 0;
  const n = Number(f.amount) || 0;
  const listCents = TEAM_PLAN.base;
  const offCents = f.unit === 'percent' ? Math.round(listCents * Math.min(100, n) / 100) : Math.min(listCents, Math.round(n * 100));

  const requestClose = () => {
    if (busy) return;
    if (dirty && !window.confirm('Close without creating the code?')) return;
    onCancel();
  };
  const submit = async () => {
    setBusy(true); setError('');
    const body = { code: f.code.trim(), note: f.note.trim(), maxUses: Number(f.maxUses) || 0, validUntil: f.validUntil.trim() };
    if (f.months.trim()) body.months = Number(f.months) || 1;
    if (f.unit === 'percent') body.percentOff = n; else body.fixedOffCents = Math.round(n * 100);
    try {
      const res = await authFetch(adminApiUrl('platform/codes'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const out = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(out.error || `HTTP ${res.status}`);
      onCreated(out.code);
    } catch (e) { setError(e.message || 'Not created.'); setBusy(false); }
  };

  return (
    <Modal overlayClassName="dcode dcode-scrim" contentClassName="dcode-modal" labelledBy="dcode-new-title" onClose={requestClose} closeOnBackdrop={() => !dirty && !busy} closeOnEscape={() => !dirty && !busy}>
      <header className="dcode-mhead">
        <div className="dcode-grow"><h2 id="dcode-new-title">New discount code</h2></div>
        <button type="button" className="dcode-x" onClick={requestClose} aria-label="Close" title="Close" disabled={busy}>×</button>
      </header>
      <div className="dcode-mbody">
        <div className="dcode-grid">
          <label className="dcode-field"><span className="dcode-lab">Code</span><input className="dcode-input dcode-input--code" value={f.code} onChange={set('code')} placeholder="AUTUMN25" maxLength={32} aria-label="Code" /><span className="dcode-help">Letters, digits and dashes. It is what the customer types.</span></label>
          <div className="dcode-field"><span className="dcode-lab">Gives</span>
            <div className="dcode-inline">
              <input className="dcode-input" value={f.amount} onChange={set('amount')} inputMode="decimal" aria-label="Amount" style={{ maxWidth: 80 }} />
              <select className="dcode-input" value={f.unit} onChange={set('unit')} aria-label="Unit" style={{ maxWidth: 110 }}><option value="percent">% off</option><option value="fixed">$ off</option></select>
              <span className="dcode-dim">for</span>
              <input className="dcode-input" value={f.months} onChange={set('months')} inputMode="numeric" aria-label="Months" style={{ maxWidth: 64 }} />
              <span className="dcode-dim">months</span>
            </div>
            <span className="dcode-help">Leave months empty for ongoing.</span>
          </div>
          <label className="dcode-field"><span className="dcode-lab">Valid until <span className="dcode-dim">(optional)</span></span><input className="dcode-input" value={f.validUntil} onChange={set('validUntil')} placeholder="2026-11-30" aria-label="Valid until" /></label>
          <label className="dcode-field"><span className="dcode-lab">Max uses</span><input className="dcode-input" value={f.maxUses} onChange={set('maxUses')} inputMode="numeric" aria-label="Max uses" /><span className="dcode-help">One redemption per team, whatever the cap. Blank for no cap.</span></label>
        </div>
        <label className="dcode-field"><span className="dcode-lab">Note <span className="dcode-dim">(staff only)</span></span><input className="dcode-input" value={f.note} onChange={set('note')} aria-label="Note" /></label>
        <div className="dcode-preview" data-testid="dcode-preview">
          <div className="dcode-pr"><span>On a {formatCents(listCents)} list month</span><span>{formatCents(listCents)}</span></div>
          <div className="dcode-pr"><span>{f.code || 'This code'} · {f.unit === 'percent' ? `${n}% off` : `${formatCents(Math.round(n * 100))} off`}{f.months.trim() ? ` · ${f.months} months` : ''}</span><span className="dcode-neg">−{formatCents(offCents)}</span></div>
          <div className="dcode-pr dcode-pr--tot"><span>A team would be charged</span><b>{formatCents(listCents - offCents)}</b></div>
        </div>
        {error && <p className="dcode-alert" role="alert">{error}</p>}
      </div>
      <footer className="dcode-mfoot">
        <button type="button" className="dcode-btn" onClick={requestClose} disabled={busy}>Cancel</button>
        <button type="button" className="dcode-btn dcode-btn--primary" onClick={submit} disabled={busy || !f.code} data-testid="dcode-create">{busy ? 'Creating…' : `Create ${f.code || 'code'}`}</button>
      </footer>
    </Modal>
  );
}
