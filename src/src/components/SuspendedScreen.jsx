import React from 'react';
import Icon from './Icon';
import Button from './ui/Button';
import { ACCOUNT_SUSPENDED } from '../auth/suspension';
import './SuspendedScreen.css';

/**
 * THE ONE SCREEN A SUSPENDED HOST SEES (#40), instead of a page of refusals.
 *
 * Shown by ProtectedRoute whenever auth/suspension.js holds a suspension:
 *
 *   ACCOUNT_SUSPENDED  the account itself. Nothing in the console works for it,
 *                      so the only ways off are signing out and joining a
 *                      session as a player (players need no account).
 *   ORG_SUSPENDED      the organisation the console is acting for. The account
 *                      is fine, so its other places are offered — a personal
 *                      space, another team — one button each.
 *
 * Neither says why: the reason is Engage staff's note, kept for staff.
 */
export default function SuspendedScreen({ suspension, onSignOut, onGoTo }) {
  const account = suspension && suspension.code === ACCOUNT_SUSPENDED;
  const elsewhere = (!account && Array.isArray(suspension && suspension.elsewhere)) ? suspension.elsewhere.slice(0, 3) : [];
  const orgName = (suspension && suspension.orgName) || 'Your organisation';
  return (
    <div className="susp" data-theme="dark">
      <main className="susp-card" role="main" aria-labelledby="susp-title">
        <Icon name="Lock" weight="duotone" size={40} color="var(--primary)" />
        <h1 id="susp-title" className="susp-title">
          {account ? 'This account is suspended' : `${orgName} is suspended`}
        </h1>
        {account ? (
          <>
            <p className="susp-body">
              While it is suspended you can’t host sessions or use the console. Nothing you made has been deleted.
            </p>
            <p className="susp-body">
              To have it reinstated, contact the Engage team. You can still join a session as a player with its code.
            </p>
          </>
        ) : (
          <>
            <p className="susp-body">
              Its sessions, question sets and reports are unavailable until Engage reinstates it. Nothing has been deleted.
            </p>
            <p className="susp-body">
              Contact your organisation’s owner or the Engage team.
              {elsewhere.length ? ' Meanwhile you can carry on in another of your spaces.' : ''}
            </p>
          </>
        )}
        <div className="susp-acts">
          {elsewhere.map((o) => (
            <Button key={o.orgId} variant="action" onClick={() => onGoTo && onGoTo(o.orgId)}>
              Go to {o.type === 'personal' ? 'your own space' : (o.name || 'that team')}
            </Button>
          ))}
          {account && (
            <Button as="a" variant="quiet" href="/play">Join a session</Button>
          )}
          {onSignOut && (
            <Button variant="quiet" onClick={onSignOut}>Sign out</Button>
          )}
        </div>
      </main>
    </div>
  );
}
