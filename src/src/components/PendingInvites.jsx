import React, { useCallback, useEffect, useRef, useState } from 'react';
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
 * use, would be worse than the missing prompt. It retries on the next load,
 * and whenever the person comes back to the tab.
 *
 * ── WHERE IT SHOWS (owner, 2026-10-10: docs/design/pending-invite-notice) ───
 *
 * A reviewer lost the invite while making their first Build Room, so it now
 * follows the invited person: the dashboard, both waiting-for-approval
 * screens, New Build Room, and the Build Room's Host screen as a slim bar
 * (`variant="bar"`). Never on Stage, Build, History or any phone: the room
 * sees those. Blue, never orange: every one of those screens already has its
 * one orange. Accept only; there is no Decline.
 *
 * `stay` is for pages that keep their place: after Accept it says
 * "You joined X." for a few seconds and then draws nothing. Without it the
 * page reloads, as the dashboard always has, so the team switcher shows the
 * team. `note` is a second line saying what Accept does (the waiting screens:
 * accepting does not approve hosting).
 */
/** The waiting screens' second line: accepting does not approve hosting (owner, 2026-10-10). */
export const NOT_APPROVAL_NOTE = 'Accepting adds you to the team. Hosting still needs approval.';

/** How long "You joined X." stays before the row draws nothing. */
export const JOINED_MS = 6000;
/** How often a row checks its own expiry time; a room can stay open for hours. */
const TICK_MS = 60000;
/** Refusals with nothing to retry: someone else's address, gone, expired. */
const FINAL = [403, 404, 410];

const daysLeft = (days) => {
  if (typeof days !== 'number' || days < 0) return '';
  if (days === 0) return ' · expires today';
  return days === 1 ? ' · 1 day left' : ` · ${days} days left`;
};

const expired = (invite, now) => {
  const t = Date.parse(invite.expiresAt || '');
  return Number.isFinite(t) && t <= now;
};

export default function PendingInvites({
  onAccepted, variant = 'row', note = '', stay = false, flush = false,
}) {
  const [invites, setInvites] = useState([]);
  const [busyToken, setBusyToken] = useState('');
  // Per invitation: { text, final }. A final one shows OK instead of Accept.
  const [errors, setErrors] = useState({});
  const [joined, setJoined] = useState('');
  const [now, setNow] = useState(() => Date.now());
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);

  const load = useCallback(async () => {
    try {
      const res = await authFetch(`${window.API_BASE || ''}invites`);
      if (!res.ok) return;
      const data = await res.json();
      if (alive.current) setInvites(Array.isArray(data.invites) ? data.invites : []);
    } catch (err) {
      /* Deliberately silent — see the header. */
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Read again when the person comes back to the tab, and tick so a row goes
  // at its expiry time rather than at the next load.
  useEffect(() => {
    const visible = () => typeof document === 'undefined' || document.visibilityState !== 'hidden';
    const onBack = () => { if (visible()) { setNow(Date.now()); load(); } };
    window.addEventListener('focus', onBack);
    document.addEventListener('visibilitychange', onBack);
    const tick = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => {
      window.removeEventListener('focus', onBack);
      document.removeEventListener('visibilitychange', onBack);
      clearInterval(tick);
    };
  }, [load]);

  useEffect(() => {
    if (!joined) return undefined;
    const t = setTimeout(() => setJoined(''), JOINED_MS);
    return () => clearTimeout(t);
  }, [joined]);

  const drop = (token) => {
    setInvites((list) => list.filter((i) => i.token !== token));
    setErrors(({ [token]: _gone, ...rest }) => rest);
  };

  const accept = async (invite) => {
    setBusyToken(invite.token);
    setErrors(({ [invite.token]: _gone, ...rest }) => rest);
    let status = 0;
    try {
      const res = await authFetch(
        `${window.API_BASE || ''}invites/${encodeURIComponent(invite.token)}/accept`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' } },
      );
      status = res.status;
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        /* A 5xx carries the server's internals; the person needs only this. */
        throw new Error(status >= 500 ? '' : (body.error || `The server answered ${status}.`));
      }
      if (onAccepted) onAccepted(invite, body);
      if (stay) {
        drop(invite.token);
        setJoined(invite.orgName || '');
        setBusyToken('');
      } else if (!onAccepted) {
        /* Reloaded rather than filtered out locally: joining changes what the
           org switcher contains, and this component does not own that. */
        window.location.reload();
      }
    } catch (err) {
      setErrors((all) => ({
        ...all,
        [invite.token]: { text: err.message || 'Could not accept that invitation.', final: FINAL.includes(status) },
      }));
      setBusyToken('');
    }
  };

  const live = invites.filter((i) => !expired(i, now));
  if (!live.length && !joined) return null;

  return (
    <section className={`pinv pinv--${variant}${flush ? ' pinv--flush' : ''}`} data-theme="dark" aria-label="Invitations">
      {joined && (
        <div className="pinv-row pinv-row--ok" role="status">
          <span className="pinv-icon" aria-hidden="true">
            <Icon name="Check" size={16} weight="bold" />
          </span>
          <span className="pinv-text"><b>{`You joined ${joined}.`}</b></span>
        </div>
      )}

      {live.map((invite) => {
        const busy = busyToken === invite.token;
        const error = errors[invite.token];
        const final = Boolean(error && error.final);
        return (
          <div className="pinv-row" key={invite.token}>
            <span className="pinv-icon" aria-hidden="true">
              <Icon name="UsersThree" size={16} weight="bold" />
            </span>

            <span className="pinv-text">
              <b>{invite.orgName}</b>
              {' invited you to join as a '}
              {invite.role === 'admin' ? 'team admin' : 'host'}
              {!final && invite.invitedByEmail ? ` · ${invite.invitedByEmail}` : ''}
              {!final && <span className="pinv-when">{daysLeft(invite.daysUntilExpiry)}</span>}
              {note && !final && <span className="pinv-what">{note}</span>}
            </span>

            {error && <p className="pinv-error" role="alert">{error.text}</p>}

            {final ? (
              <button type="button" className="pinv-btn" onClick={() => drop(invite.token)}>OK</button>
            ) : (
              <button
                type="button"
                className="pinv-btn"
                disabled={busy}
                onClick={() => accept(invite)}
              >
                {busy ? 'Joining…' : 'Accept'}
              </button>
            )}
          </div>
        );
      })}
    </section>
  );
}
