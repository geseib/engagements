import React, { useCallback, useEffect, useState } from 'react';
import { authFetch } from '../auth/authFetch';
import { adminApiUrl } from '../utils/adminApi';
import Modal from './Modal';
import Icon from './Icon';
import pricing from '../../../lambda-functions/game/pricing';
import './InvoicePanel.css';

const { formatCents } = pricing;

/**
 * THE SIMULATED INVOICE and BILLING HISTORY — mockups 20 and 21.
 *
 * Read from the frozen INVOICE rows (GET /orgs/{id}/invoices[/{period}]),
 * never recomputed: an invoice reads the same in a year whatever the ledger
 * does after it closed.
 *
 * THE TRANSPARENCY RULE, enforced: every currency amount rendered here
 * carries a `data-source` naming the row it came from — `plan:<id>` for a
 * list price, `USAGE#<period>` for a meter, `ADJ#…` for an adjustment,
 * `INVOICE#<period>` for the totals — and clicking a tagged number opens the
 * row as stored. invoicePanel.test.jsx walks the rendered invoice for any `$`
 * without one.
 *
 * THE BANNER, TWICE: at the top and as the total's own sub-line. The
 * sentence keys off `settlement.kind`, which is the one Stripe seam.
 */
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export function periodLabel(period) {
  const m = /^(\d{4})-(\d{2})$/.exec(String(period || ''));
  return m ? `${MONTHS[+m[2] - 1]} ${m[1]}` : String(period || '');
}
const when = (iso) => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }); };

/** A number with its source tag. */
function Amount({ cents, display, source, onOpen }) {
  const text = display != null ? display : formatCents(cents);
  return (
    <button type="button" className="inv-amt" data-source={source} onClick={() => onOpen && onOpen(source)} title={`From ${source}`}>
      {text}
    </button>
  );
}

export function BillingHistory({ orgId, onOpen, onBack }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await authFetch(adminApiUrl(`orgs/${encodeURIComponent(orgId)}/invoices`));
        const body = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
        setRows(body.invoices || []);
      } catch (e) { if (!cancelled) setError(e.message || 'Could not load invoices.'); } finally { if (!cancelled) setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [orgId]);

  return (
    <div className="inv">
      <div className="inv-bar">
        <button type="button" className="inv-btn" onClick={onBack}><Icon name="ArrowLeft" weight="bold" size={14} color="currentColor" /> Plan &amp; usage</button>
        <span className="inv-count">{loading ? 'Loading…' : `${rows.length} closed month${rows.length === 1 ? '' : 's'}`}</span>
      </div>
      {error && <p className="inv-alert" role="alert">{error}</p>}
      {!loading && rows.length === 0 && !error && (
        <div className="inv-empty" data-testid="inv-empty">
          <h3>No closed months yet</h3>
          <p>An invoice is written for each month on the 1st of the next. The open month is on Plan &amp; usage, with the same arithmetic.</p>
        </div>
      )}
      {rows.length > 0 && (
        <table className="inv-tbl">
          <thead><tr><th className="inv-col-period">Period</th><th className="inv-col-plan">Plan</th><th className="inv-col-num">List</th><th className="inv-col-applied">Applied</th><th className="inv-col-num">Would have been charged</th><th className="inv-col-acts" /></tr></thead>
          <tbody>
            {rows.map((r) => {
              const applied = [...(r.discounts || []).filter((d) => d.amountCents), ...(r.credits || []).filter((c) => c.appliedCents)];
              const free = r.planId === 'personal';
              return (
                <tr key={r.period} className={free ? 'inv-row--free' : ''} data-testid="inv-row">
                  <td><b>{periodLabel(r.period)}</b><span className="inv-sub">{r.number} · closed {when(r.closedAt)}</span></td>
                  <td><span className={`inv-chip${free ? ' inv-chip--off' : ''}`}>{free ? 'Free' : 'Team'}</span></td>
                  <td className="inv-num">{r.listDisplay}</td>
                  <td className="inv-wrap">{applied.length ? applied.map((a) => `${a.label.split(' · ')[0]} −${a.amountDisplay || a.appliedDisplay}`).join(' · ') : <span className="inv-dim">—</span>}</td>
                  <td className="inv-num"><b>{r.totalDisplay}</b></td>
                  <td><div className="inv-rowact"><button type="button" className={`inv-btn inv-btn--sm${free ? '' : ' inv-btn--primary'}`} onClick={() => onOpen(r.period)}>Invoice</button></div></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      <p className="inv-note"><b>Free months have invoices too.</b> A $0.00 invoice is still the record of a month — it is what stops a history from inventing $5.00 for months nobody was on the plan.</p>
    </div>
  );
}

export function Invoice({ orgId, period, onBack }) {
  const [inv, setInv] = useState(null);
  const [error, setError] = useState('');
  const [openRow, setOpenRow] = useState('');
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await authFetch(adminApiUrl(`orgs/${encodeURIComponent(orgId)}/invoices/${encodeURIComponent(period)}`));
        const body = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
        setInv(body.invoice);
      } catch (e) { if (!cancelled) setError(e.message || 'Could not load the invoice.'); }
    })();
    return () => { cancelled = true; };
  }, [orgId, period]);

  const open = useCallback((source) => setOpenRow(source), []);
  if (error) return <div className="inv"><button type="button" className="inv-btn" onClick={onBack}><Icon name="ArrowLeft" weight="bold" size={14} color="currentColor" /> Billing history</button><p className="inv-alert" role="alert">{error}</p></div>;
  if (!inv) return <div className="inv"><p className="inv-dim">Loading the invoice…</p></div>;

  const simulated = !inv.settlement || inv.settlement.kind === 'simulated';
  const usageSrc = `USAGE#${inv.period}`;
  const adjSrc = (id) => { const snap = (inv.adjustmentSnapshot || []).find((a) => a.adjId === id); return snap ? snap.SK : `ADJ#${id}`; };
  const invSrc = `INVOICE#${inv.period}`;
  const hasApplied = (inv.discounts || []).length > 0 || (inv.credits || []).length > 0;

  return (
    <div className="inv">
      <div className="inv-bar">
        <button type="button" className="inv-btn" onClick={onBack}><Icon name="ArrowLeft" weight="bold" size={14} color="currentColor" /> Billing history</button>
        <button type="button" className="inv-btn" onClick={() => window.print()}><Icon name="DownloadSimple" weight="bold" size={14} color="currentColor" /> Print / save as PDF</button>
      </div>
      <article className="inv-doc" aria-labelledby="inv-h" data-testid="invoice">
        <div className="inv-head">
          <div><h2 id="inv-h">{inv.orgName || orgId}</h2><div className="inv-meta">{inv.planId === 'personal' ? 'Free' : 'Team plan'} · {inv.periodBounds ? `${inv.periodBounds.start} to ${inv.periodBounds.end}` : periodLabel(inv.period)} · closed {when(inv.closedAt)}</div></div>
          <div className="inv-numblock">Invoice<b>{inv.number}</b>{simulated ? 'Simulated · not a receipt' : 'Paid'}</div>
        </div>
        {simulated && (
          <div className="inv-banner" role="note" data-testid="inv-banner">
            <Icon name="ShieldCheck" weight="duotone" size={20} color="currentColor" />
            <div><b>This is a simulation. No card was charged.</b>{inv.sentence.replace(/^This is a simulation\. No card was charged\.\s*/, '')} Nothing was taken and nothing is owed.</div>
          </div>
        )}
        <div className="inv-body">
          <table className="inv-lines">
            <tbody>
              <tr className="inv-sec"><td>What you used</td><td /></tr>
              {(inv.lines || []).map((l) => (
                <tr key={l.key}>
                  <td>{l.label}<span className="inv-sub">{l.detail}{l.key !== 'base' && l.quantity != null ? ` · ${l.quantity} ${l.key === 'sets' ? 'held at peak' : 'run'} · ${l.included} included${l.billable ? ` · ${l.billable} × ${formatCents(l.unitCents)}` : ''}` : ''}</span></td>
                  <td><Amount cents={l.amountCents} display={l.amountDisplay} source={l.key === 'base' ? `plan:${inv.planId}` : usageSrc} onOpen={open} /></td>
                </tr>
              ))}
              <tr className="inv-list"><td><b>List price</b></td><td><Amount cents={inv.listCents} display={inv.listDisplay} source={invSrc} onOpen={open} /></td></tr>
              {hasApplied && <tr className="inv-sec"><td>Applied to it</td><td /></tr>}
              {(inv.discounts || []).map((d) => (
                <tr key={d.adjId} className={d.amountCents ? 'inv-neg' : 'inv-off'}>
                  <td>{d.label}<span className="inv-sub">{d.notApplied ? `Not applied — ${d.notApplied}` : ''}</span></td>
                  <td><Amount cents={d.amountCents} display={`−${d.amountDisplay}`} source={adjSrc(d.adjId)} onOpen={open} /></td>
                </tr>
              ))}
              {(inv.credits || []).map((c) => (
                <tr key={c.adjId} className="inv-neg">
                  <td>{c.label}<span className="inv-sub">{c.appliedDisplay} used · {c.remainingAfterDisplay} carries to the next month</span></td>
                  <td><Amount cents={c.appliedCents} display={`−${c.appliedDisplay}`} source={adjSrc(c.adjId)} onOpen={open} /></td>
                </tr>
              ))}
              <tr className="inv-tot">
                <td>{simulated ? 'You would have been charged' : 'Charged'}<span className="inv-sub">{inv.savingsCents > 0 ? `A ${inv.savingsPercent}% discount from the list price. ` : ''}{simulated ? 'Simulated — see the banner above.' : ''}</span></td>
                <td><Amount cents={inv.totalCents} display={inv.totalDisplay} source={invSrc} onOpen={open} /></td>
              </tr>
            </tbody>
          </table>
          <p className="inv-how"><b>How this was calculated.</b> {inv.order} Storage is charged on the highest number of sets held at once this period. Every number is a button naming the row it came from; open it to see the row as stored, who wrote it and when.</p>
        </div>
        <div className="inv-foot">Written by the nightly reconciler on {when(inv.closedAt)} · the usage and adjustments it read are frozen inside this invoice, so it reads the same in a year.</div>
      </article>
      {openRow && <LedgerRowDialog source={openRow} invoice={inv} onClose={() => setOpenRow('')} />}
    </div>
  );
}

/** The row behind a number, as stored — from the invoice's own snapshot. */
export function LedgerRowDialog({ source, invoice, onClose }) {
  let row;
  if (source.startsWith('plan:')) row = { source, ...invoice.plan, note: 'The list prices of the plan at the time the month closed.' };
  else if (source.startsWith('USAGE#')) row = { source, ...invoice.usage, period: invoice.period, note: 'The meter for the month, as reconciled from the session ledger on the night it closed.' };
  else if (source.startsWith('INVOICE#')) row = { source, number: invoice.number, listCents: invoice.listCents, totalCents: invoice.totalCents, savingsPercent: invoice.savingsPercent, closedAt: invoice.closedAt, closedBy: invoice.closedBy, settlement: invoice.settlement };
  else row = (invoice.adjustmentSnapshot || []).find((a) => a.SK === source) || { source, note: 'Not in this invoice\'s snapshot.' };
  return (
    <Modal overlayClassName="inv inv-scrim" contentClassName="inv-modal" labelledBy="inv-row-title" onClose={onClose}>
      <header className="inv-mhead">
        <div className="inv-grow"><h2 id="inv-row-title">The row behind this number</h2><p className="inv-dim"><code className="inv-code">{source}</code></p></div>
        <button type="button" className="inv-x" onClick={onClose} aria-label="Close" title="Close">×</button>
      </header>
      <div className="inv-mbody">
        <dl className="inv-kv" data-testid="inv-row-fields">
          {Object.entries(row).filter(([k]) => k !== 'source').map(([k, v]) => (
            <React.Fragment key={k}><dt>{k}</dt><dd>{typeof v === 'object' && v !== null ? JSON.stringify(v) : String(v)}</dd></React.Fragment>
          ))}
        </dl>
      </div>
      <footer className="inv-mfoot"><button type="button" className="inv-btn" onClick={onClose}>Close</button></footer>
    </Modal>
  );
}
