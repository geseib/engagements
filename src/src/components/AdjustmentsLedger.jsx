import React from 'react';
import Icon from './Icon';
import pricingAdjust from '../../../lambda-functions/game/pricing-adjust';
import pricing from '../../../lambda-functions/game/pricing';
import './AdjustmentsLedger.css';

const { describe } = pricingAdjust;
const { formatCents } = pricing;

/**
 * THE LEDGER, AS A LIST — one component for both sides (mockups 16 and 19).
 *
 * The customer sees exactly the rows staff see, in the same words, minus the
 * revoke button. That is the transparency rule in one place: there is one
 * list, not a staff version and a customer version that could disagree.
 *
 * `describe()` is the pricing module's own wording, so a row reads the same
 * here, on the invoice and on the staff drawer.
 */
const KIND_ICON = { CREDIT_CENTS: 'CreditCard', CREDIT_UNITS: 'Plus', RATE_OVERRIDE: 'ArrowsClockwise', CODE_REDEMPTION: 'FlagCheckered', OFFER: 'Confetti' };
const STATUS_LABEL = { active: 'Active', upcoming: 'Upcoming', ended: 'Ended', revoked: 'Revoked' };

export function adjustmentAmount(a) {
  if (a.kind === 'CREDIT_CENTS') return formatCents(a.amountCents);
  if (a.percentOff != null) return `${a.percentOff}%`;
  if (a.fixedOffCents != null) return formatCents(a.fixedOffCents);
  if (a.kind === 'RATE_OVERRIDE' && a.rate && a.rate.baseCents != null) return `${formatCents(a.rate.baseCents)} base`;
  if (a.kind === 'CREDIT_UNITS' && a.units) return `+${(a.units.sessions || 0) + (a.units.sets || 0)}`;
  return '';
}

function when(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

export default function AdjustmentsLedger({ adjustments = [], onRevoke = null, audience = 'org' }) {
  if (!adjustments.length) {
    return (
      <p className="adjl-empty" data-testid="adjl-empty">
        {audience === 'staff' ? 'Nothing granted yet.' : 'Nothing on your account. Discounts, credits and offers from Engage appear here.'}
      </p>
    );
  }
  return (
    <ul className="adjl" data-testid="adjl">
      {adjustments.map((a) => {
        const off = a.status !== 'active';
        const by = a.source && a.source.type === 'code' ? `Applied ${when(a.createdAt)} when your plan request was approved` : `From Engage, ${when(a.createdAt)}`;
        const span = a.validFrom ? ` · ${a.validFrom}${a.validTo && a.validTo !== a.validFrom ? ` to ${a.validTo}` : ''}` : '';
        return (
          <li key={a.adjId} className={`adjl-row${off ? ' adjl-row--off' : ''}`} data-testid="adjl-row" data-status={a.status}>
            <Icon name={KIND_ICON[a.kind] || 'Circle'} weight="duotone" size={18} color="currentColor" className="adjl-ico" />
            <div className="adjl-main">
              <span className="adjl-name">
                {describe(a)}
                <b className="adjl-amt">{adjustmentAmount(a)}</b>
                <span className={`adjl-chip adjl-chip--${a.status}`}>{STATUS_LABEL[a.status] || a.status}</span>
              </span>
              <span className="adjl-sub">
                {audience === 'staff' ? `Granted ${when(a.createdAt)} by ${a.createdByEmail || a.createdBy || 'Engage'}` : by}
                {span}
                {a.note && a.kind !== 'CODE_REDEMPTION' ? <> · “{a.note}”</> : null}
                {a.kind === 'CREDIT_CENTS' && a.remainingCents != null && a.remainingCents !== a.amountCents
                  ? ` · ${formatCents(a.remainingCents)} left` : ''}
                {a.kind === 'CREDIT_CENTS' && a.remainingCents === a.amountCents && a.status === 'active' ? ' · carries forward until spent' : ''}
                {a.revokedAt ? <> · <b>revoked {when(a.revokedAt)}</b>{a.revokeNote ? `: “${a.revokeNote}”` : ''}</> : null}
              </span>
            </div>
            {onRevoke && a.status !== 'revoked' && (
              <button type="button" className="adjl-btn" onClick={() => onRevoke(a)} aria-label={`Revoke ${describe(a)}`}>Revoke</button>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/**
 * THE BILL IN MINIATURE — list, each adjustment as a negative line with its
 * source, the total. Fed by `adjusted` from GET /orgs/{id}/usage (the same
 * `applyAdjustments` the invoice will be written from).
 */
export function AdjustedBill({ adjusted, audience = 'org' }) {
  if (!adjusted) return null;
  const nothing = !adjusted.discounts.length && !adjusted.credits.length;
  return (
    <div className="adjl-bill" data-testid="adjl-bill">
      {adjusted.lines.map((l) => (
        <div key={l.key} className="adjl-bill-r"><span>{l.label}{l.detail ? <span className="adjl-dim"> · {l.detail}</span> : null}</span><span>{l.amountDisplay}</span></div>
      ))}
      {!nothing && <div className="adjl-bill-r"><span>List</span><span>{adjusted.listDisplay}</span></div>}
      {adjusted.discounts.map((d) => (
        <div key={d.adjId} className="adjl-bill-r"><span>{d.label}{d.notApplied ? <span className="adjl-dim"> · not applied — {d.notApplied}</span> : null}</span><span className={d.amountCents ? 'adjl-neg' : 'adjl-dim'}>−{d.amountDisplay}</span></div>
      ))}
      {adjusted.credits.map((c) => (
        <div key={c.adjId} className="adjl-bill-r"><span>{c.label}<span className="adjl-dim"> · {c.remainingAfterDisplay} stays for next month</span></span><span className="adjl-neg">−{c.appliedDisplay}</span></div>
      ))}
      <div className="adjl-bill-r adjl-bill-tot"><span>{audience === 'staff' ? 'Would have been charged' : 'You would be charged'}</span><b data-testid="adjl-total">{adjusted.totalDisplay}</b></div>
      <p className="adjl-sim">
        <Icon name="ShieldCheck" weight="duotone" size={16} color="currentColor" />
        <span><b>This is a simulation.</b> {audience === 'staff' ? 'No money moves in either direction.' : 'No card is on file and nothing is charged.'} {adjusted.sentence}</span>
      </p>
      {!nothing && <p className="adjl-order">How discounts apply: {adjusted.order}</p>}
    </div>
  );
}
