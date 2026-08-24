import React, { useCallback, useEffect, useState } from 'react';
import Icon from './Icon';
import { authFetch } from '../auth/authFetch';
import './PendingInvites.css';

/**
 * "NORTHWIND LEARNING WOULD LIKE YOU TO JOIN." — on the screen you land on.
 *
 * ── WHY THIS IS NOT AN EMAILED LINK ────────────────────────────────────────
 *
 * Because an emailed link never worked. `invite-member.js` wrote a row and said
 * in its own header that it sends no email; the delivery it was waiting for was
 * never wired; the token was returned by the API and never shown to the admin;
 * and `POST /invites/{token}/accept` — complete and correct — had no caller and
 * had never once been invoked on any tier. Meanwhile the Members screen said
 * "The invitation to X was mailed again."
 *
 * The owner's answer removes the delivery problem rather than solving it:
 * sign in with the address you were invited at and press the button. The server
 * check has always been the email match — `accept-invite.js` refuses any
 * invitation whose address is not the caller's — so the token was only ever a
 * way to find the row, and `GET /invites` finds it instead.
 *
 * ── WHY IT DRAWS NOTHING WHEN THERE IS NOTHING ─────────────────────────────
 *
 * Most people have no invitation almost all of the time. A card that is
 * permanently present and permanently empty is one you stop seeing, which is
 * exactly the wrong outcome for the one moment it matters.
 *
 * A failure is also silent. This sits above somebody's own work on the screen
 * they use to run sessions; an error banner there, for a feature they may never
 * use, would be worse than the missing prompt. It retries on the next load.
 */
export default function PendingInvites({ onAccepted }) {
  const [invites, setInvites] = useState([]);
  const [busyToken, setBusyToken] = useState('');
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      const res = await authFetch(`${window.API_BASE || ''}invites`);
      if (!res.ok) return;
      const data = await res.json();
      setInvites(Array.isArray(data.invites) ? data.invites : []);
    } catch (err) {
      /* Deliberately silent — see the header. */
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const accept = async (invite) => {
    setBusyToken(invite.token);
    setError('');
    try {
      const res = await authFetch(
        `${window.API_BASE || ''}invites/${encodeURIComponent(invite.token)}/accept`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' } },
      );
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `The server answered ${res.status}.`);
      /* Reloaded rather than filtered out locally: joining changes what the org
         switcher contains, and this component does not own that. */
      if (onAccepted) onAccepted(invite, body);
      else window.location.reload();
    } catch (err) {
      setError(err.message || 'Could not accept that invitation.');
      setBusyToken('');
    }
  };

  if (!invites.length) return null;

  return (
    <section className="pinv" data-theme="dark" aria-label="Invitations">
      {error && <p className="pinv-error" role="alert">{error}</p>}

      {invites.map((invite) => {
        const busy = busyToken === invite.token;
        const days = invite.daysUntilExpiry;
        return (
          <div className="pinv-row" key={invite.token}>
            <span className="pinv-icon" aria-hidden="true">
              <Icon name="UsersThree" size={16} weight="bold" color="var(--primary)" />
            </span>

            <span className="pinv-text">
              <b>{invite.orgName}</b>
              {' invited you to join as a '}
              {invite.role === 'admin' ? 'team admin' : 'host'}
              {invite.invitedByEmail ? ` · ${invite.invitedByEmail}` : ''}
              {typeof days === 'number' && days >= 0 && (
                <span className="pinv-when">
                  {days === 0 ? ' · expires today' : ` · ${days} days left`}
                </span>
              )}
            </span>

            <button
              type="button"
              className="pinv-btn"
              disabled={busy}
              onClick={() => accept(invite)}
            >
              {busy ? 'Joining…' : 'Accept'}
            </button>
          </div>
        );
      })}
    </section>
  );
}
