import React, { useEffect, useRef } from 'react';
import Icon from './Icon';
import { planLimitCopy } from '../utils/planLimitCopy';
import './PlanLimitNotice.css';

/**
 * THE ONE NOTICE EVERY PLAN-LIMIT REFUSAL SHOWS — a new session, a new set, a
 * library copy, an upload, a builder save, Quickstart.
 * Mockup: docs/design/tenancy-redesign/22-plan-limit-notice.html.
 *
 * INLINE, WHERE THE BUTTON WAS PRESSED — never a pop-up. Most of these screens
 * are already dialogs, and the repo does not open a dialog from inside one
 * (admin-container-rule.md). `role="alert"` is how a screen reader hears that
 * the press failed; it scrolls itself into view because the button is often at
 * the foot of a long form; it does NOT take focus, so a keyboard user is still
 * on the control they pressed.
 *
 * The words come from utils/planLimitCopy.js, a pure function of the refusal —
 * including WHO is reading it, which the server works out (plan-limit.js):
 * the owner gets the request, an admin is told only the owner can, a member is
 * told whom to ask, by name.
 *
 * @param {object}   refusal   what utils/upgradeRequired.js:parseUpgradeRequired returned
 * @param {string}   [outcome] what did not happen, in the caller's words
 * @param {'dusk'|'paper'} [surface] dusk by default; inside the host shelf's
 *                             `.qsets--onlight` card it re-tints on its own
 * @param {boolean}  [compact] a narrow place: drops the price from the way out
 * @param {Function} [onDismiss] renders an X when the caller can dismiss it
 */
export default function PlanLimitNotice({
  refusal,
  outcome,
  surface,
  compact = false,
  onDismiss,
  billingHref,
  requestHref,
  className = '',
}) {
  const ref = useRef(null);

  useEffect(() => {
    if (refusal && ref.current && typeof ref.current.scrollIntoView === 'function') {
      ref.current.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }, [refusal]);

  if (!refusal) return null;
  const copy = planLimitCopy(refusal, { outcome, compact, billingHref, requestHref });

  const classes = ['plim'];
  if (surface === 'paper') classes.push('plim--paper');
  if (surface === 'dusk') classes.push('plim--dusk');
  if (compact) classes.push('plim--compact');
  if (className) classes.push(className);

  return (
    <div ref={ref} className={classes.join(' ')} role="alert" data-testid="plan-limit-notice">
      <Icon name={copy.icon} weight="bold" size={20} className="plim-ico" aria-hidden="true" />
      <p className="plim-head">
        <strong>{copy.headline}</strong> {copy.outcome}
      </p>
      {onDismiss ? (
        <button type="button" className="plim-x" onClick={onDismiss} aria-label="Dismiss this notice">
          <Icon name="X" size={16} aria-hidden="true" />
        </button>
      ) : null}
      {copy.why ? <p className="plim-why">{copy.why}</p> : null}
      {copy.contacts.length ? (
        <ul className="plim-who" aria-label="Who can change the plan">
          {copy.contacts.map((c) => {
            const inner = (
              <>
                <span className="plim-avatar" aria-hidden="true">{initials(c.name)}</span>
                {c.name} <span className="plim-role">{c.role}</span>
              </>
            );
            return (
              <li key={`${c.role}:${c.email || c.name}`}>
                {c.email
                  ? <a className="plim-person" href={`mailto:${c.email}`}>{inner}</a>
                  : <span className="plim-person">{inner}</span>}
              </li>
            );
          })}
        </ul>
      ) : null}
      {copy.action || copy.alternative ? (
        <div className="plim-way">
          {copy.action ? (
            <a
              className={`plim-btn${copy.action.primary ? ' plim-btn--primary' : ''}`}
              href={copy.action.href}
            >
              {copy.action.label}
            </a>
          ) : null}
          {copy.alternative ? <span className="plim-or">{copy.alternative}</span> : null}
        </div>
      ) : null}
    </div>
  );
}

function initials(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  return ((parts[0] || '')[0] || '').toUpperCase() + ((parts[1] || '')[0] || '').toUpperCase();
}
