import React, { useCallback, useEffect, useState } from 'react';
import { authFetch } from '../auth/authFetch';
import OrgBillingDrawer from './OrgBillingDrawer';
import { AuditLogDialog } from './AuditLog';
import Modal from './Modal';
import './PlatformOrgsPanel.css';

/**
 * EVERY ORGANISATION ON THIS TIER — the Engage staff screen.
 *
 * Built from docs/design/tenancy-redesign/10-platform-orgs.html.
 *
 * ── WHAT IS DELIBERATELY ABSENT ────────────────────────────────────────────
 *
 * There is no way from here into anybody's question sets, sessions, answers or
 * reports, and that is the feature. The mockup says it out loud on the screen
 * itself and so does `.porgs-note`, because this is the one place in the
 * product where the isolation guarantee is explained to the people it takes
 * capability away from — an Engage admin who used to be able to open anything
 * and now cannot will otherwise read the absence as a bug.
 *
 * The mockup also draws a "Request access" control per row. It is NOT built
 * here: the break-glass grant it belongs to (a written reason, a four-hour
 * expiry, an email to the org's owners, a row in their access log) does not
 * exist yet, and a button that opens a dialog leading nowhere would suggest a
 * safeguard is in place that is not. It comes back with the grant.
 *
 * ── WHAT IT CAN DO ─────────────────────────────────────────────────────────
 *
 * Approve an organisation that is waiting, suspend one, and lift a suspension.
 * Each is one field on two rows and nothing else. Suspend asks first, with a
 * written reason (#40); Approve and Reinstate stay one click. A PERSONAL space cannot be
 * suspended at all — the server refuses it and this hides the control, for the
 * reason recorded in platform-orgs.js: suspending somebody's own home is an
 * account deletion with a friendlier name, and the lever for a person is their
 * account on the Accounts screen.
 */
const API = () => window.API_BASE || '';

const STATUS_LABEL = { active: 'Active', pending: 'Pending', suspended: 'Suspended' };

/* The server's floor and cap for a suspension's reason (platform-orgs.js). */
export const SUSPEND_REASON_MIN = 10;
export const SUSPEND_REASON_MAX = 600;

/**
 * `2026-02-01T…` -> `since Feb 2026`. The mockup's "since Feb 2026".
 *
 * FORMATTED IN UTC, and that is a fix rather than a detail. `createdAt` is
 * written as UTC midnight, so rendering it in the viewer's zone puts every
 * first-of-the-month organisation into the PREVIOUS month for anybody west of
 * Greenwich — an org created on 1 February reads "since Jan 2026" in New York
 * and "since Feb 2026" in Berlin, from the same row. A month-and-year label is
 * far too coarse to be worth localising, and being wrong by a month on a
 * billing-adjacent screen is worse than being an hour off.
 */
export function sinceLabel(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `since ${d.toLocaleString('en-GB', { month: 'short', year: 'numeric', timeZone: 'UTC' })}`;
}

export default function PlatformOrgsPanel() {
  const [orgs, setOrgs] = useState([]);
  const [billing, setBilling] = useState(null);
  /* The audit log dialog: an org row (its log), 'all' (every staff action), or null. */
  const [activity, setActivity] = useState(null);
  const [counts, setCounts] = useState({ teams: 0, personal: 0, suspended: 0, pending: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busyId, setBusyId] = useState('');
  /* The organisation whose Suspend was pressed: the dialog asks before it acts. */
  const [suspending, setSuspending] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await authFetch(`${API()}platform/orgs`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `The server answered ${res.status}.`);
      }
      const data = await res.json();
      setOrgs(Array.isArray(data.orgs) ? data.orgs : []);
      setCounts(data.counts || { teams: 0, personal: 0, suspended: 0, pending: 0 });
    } catch (err) {
      setError(err.message || 'Could not load organisations.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  /* Resolves true when the change went through; a refusal shows on the page
     (or, from the dialog, in it: `throwOnError`). */
  const setStatus = async (org, status, { reason, throwOnError = false } = {}) => {
    setBusyId(org.orgId);
    setError('');
    setNotice('');
    try {
      const res = await authFetch(`${API()}platform/orgs/${encodeURIComponent(org.orgId)}/status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(reason ? { status, reason } : { status }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `The server answered ${res.status}.`);
      /* Reloaded rather than patched in place: the counts at the top are
         derived server-side, and a local edit would leave "3 suspended" beside
         a table showing four. */
      setNotice(`${org.name} is now ${STATUS_LABEL[status].toLowerCase()}.`);
      await load();
      return true;
    } catch (err) {
      if (throwOnError) throw err;
      setError(err.message || 'That did not work.');
      return false;
    } finally {
      setBusyId('');
    }
  };

  return (
    <div className="porgs" data-theme="dark">
      {error && (
        <div className="porgs-alert" role="alert">
          <span className="porgs-alert-text">{error}</span>
        </div>
      )}
      {notice && !error && (
        <div className="porgs-alert porgs-alert--ok" role="status">
          <span className="porgs-alert-text">{notice}</span>
        </div>
      )}

      <div className="porgs-head">
        <span className="porgs-count">
          <strong>{counts.teams}</strong>
          {counts.teams === 1 ? ' team' : ' teams'}
          {', '}
          <strong>{counts.personal}</strong>
          {' personal '}
          {counts.personal === 1 ? 'space' : 'spaces'}
          {counts.pending ? <>{', '}<strong>{counts.pending}</strong>{' waiting'}</> : null}
          {counts.suspended ? <>{', '}<strong>{counts.suspended}</strong>{' suspended'}</> : null}
        </span>
        <button
          type="button"
          className="porgs-btn porgs-head-btn"
          onClick={() => setActivity('all')}
          data-testid="porgs-staff-activity"
        >
          Staff activity…
        </button>
      </div>

      {loading && <p className="porgs-loading">Loading organisations…</p>}

      {!loading && orgs.length === 0 && (
        <p className="porgs-empty">No organisations on this tier yet.</p>
      )}

      {!loading && orgs.length > 0 && (
        <div className="porgs-tablewrap">
          <table className="porgs-tbl">
            <thead>
              <tr>
                <th scope="col">Organisation</th>
                <th scope="col" className="porgs-col-plan">Plan</th>
                <th scope="col" className="porgs-col-num">Members</th>
                <th scope="col" className="porgs-col-status">Status</th>
                <th scope="col" className="porgs-col-acts" />
              </tr>
            </thead>
            <tbody>
              {orgs.map((org) => {
                const status = org.status || 'active';
                const personal = org.type === 'personal';
                const busy = busyId === org.orgId;
                return (
                  <tr key={org.orgId}>
                    <td>
                      <span className="porgs-name">{org.name}</span>
                      {personal && <span className="porgs-kind">Personal</span>}
                      {org.createdAt && (
                        <>
                          {' '}
                          <span className="porgs-meta">{sinceLabel(org.createdAt)}</span>
                        </>
                      )}
                      {/* Why it is suspended, for staff (#40). Cut to one line; the title carries it whole. */}
                      {status === 'suspended' && org.suspendedReason && (
                        <span className="porgs-why" title={org.suspendedReason}>
                          Suspended{org.suspendedAt ? ` ${whenLabel(org.suspendedAt)}` : ''}: {org.suspendedReason}
                        </span>
                      )}
                    </td>
                    <td className="porgs-col-plan">{org.plan === 'team' ? 'Team' : 'Free'}</td>
                    <td className="porgs-col-num">{org.members}</td>
                    <td className="porgs-col-status">
                      <span className={`porgs-status porgs-status--${status}`}>
                        {STATUS_LABEL[status] || status}
                      </span>
                    </td>
                    <td className="porgs-col-acts">
                      <div className="porgs-acts">
                        {status === 'pending' && (
                          <button
                            type="button"
                            className="porgs-btn"
                            disabled={busy}
                            onClick={() => setStatus(org, 'active')}
                          >
                            Approve
                          </button>
                        )}
                        {status === 'suspended' && (
                          <button
                            type="button"
                            className="porgs-btn"
                            disabled={busy}
                            onClick={() => setStatus(org, 'active')}
                          >
                            Reinstate
                          </button>
                        )}
                        {/* A home has no Suspend at all — the server refuses it,
                            and offering a control that always fails is worse
                            than not offering one. */}
                        {/* Billing step 3: the ledger drawer (mockup 16). */}
                        <button
                          type="button"
                          className="porgs-btn"
                          disabled={busy}
                          onClick={() => setBilling(org)}
                          data-testid="porgs-billing"
                        >
                          Billing…
                        </button>
                        {/* Who changed what in this organisation (the audit log). */}
                        <button
                          type="button"
                          className="porgs-btn"
                          disabled={busy}
                          onClick={() => setActivity(org)}
                          data-testid="porgs-activity"
                        >
                          Activity…
                        </button>
                        {status === 'active' && !personal && (
                          <button
                            type="button"
                            className="porgs-btn porgs-btn--danger"
                            disabled={busy}
                            onClick={() => setSuspending(org)}
                          >
                            Suspend…
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {suspending && (
        <SuspendOrgDialog
          org={suspending}
          onCancel={() => setSuspending(null)}
          onSuspend={async (reason) => {
            await setStatus(suspending, 'suspended', { reason, throwOnError: true });
            setSuspending(null);
          }}
        />
      )}
      {billing && <OrgBillingDrawer org={billing} onClose={() => setBilling(null)} />}
      {activity && (
        <AuditLogDialog
          org={activity === 'all' ? null : activity}
          orgNames={Object.fromEntries(orgs.map((o) => [o.orgId, o.name]))}
          onClose={() => setActivity(null)}
        />
      )}

      <p className="porgs-note">
        <strong>There is no “view their sets” button, and that is the change.</strong>
        {' '}
        Being an Engage administrator used to mean being able to open any question set in
        the system. It now means managing accounts, plans and moderation. An organisation’s
        questions, answers and reports are encrypted with that organisation’s own key, and
        reading them takes a request with a written reason that expires and appears in
        their own access log.
      </p>
    </div>
  );
}

/** `2026-10-24T…` -> `24 Oct 2026`, in UTC for the reason sinceLabel gives. */
function whenLabel(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
}

/**
 * SUSPEND, ASKED FIRST (#40). It acted on one click with nothing saying why.
 * The dialog says what Suspend does today, and no more: the organisation is
 * marked Suspended, and nothing yet stops its members working. A written
 * reason is required; it goes to the server, onto the row and into the audit
 * log. X and Cancel share one close; Escape and the backdrop are held while a
 * reason is typed or the change is in flight.
 */
export function SuspendOrgDialog({ org, onCancel, onSuspend }) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const why = reason.replace(/\s+/g, ' ').trim();
  const dirty = why.length > 0;
  const ready = why.length >= SUSPEND_REASON_MIN && why.length <= SUSPEND_REASON_MAX;

  const requestClose = () => {
    if (busy) return;
    if (dirty && !window.confirm('Close without suspending? The reason you typed will be lost.')) return;
    onCancel();
  };

  const submit = async () => {
    if (!ready) {
      setError(why.length > SUSPEND_REASON_MAX
        ? `Keep the reason to ${SUSPEND_REASON_MAX} characters.`
        : 'Say why, in a few words.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      await onSuspend(why);
    } catch (e) {
      setError(e.message || 'Not suspended.');
      setBusy(false);
    }
  };

  return (
    <Modal
      overlayClassName="porgs-scrim"
      contentClassName="porgs-modal"
      labelledBy="porgs-suspend-title"
      onClose={requestClose}
      closeOnBackdrop={() => !dirty && !busy}
      closeOnEscape={() => !dirty && !busy}
    >
      <header className="porgs-modal-head">
        <div className="porgs-grow">
          <h2 id="porgs-suspend-title">Suspend {org.name}?</h2>
          <p className="porgs-dim">
            This marks the organisation Suspended on this list. Nothing else changes yet: its members
            can still sign in and run sessions. Reinstate lifts it.
          </p>
        </div>
        <button type="button" className="porgs-x" onClick={requestClose} aria-label="Close" title="Close" disabled={busy}>×</button>
      </header>
      <div className="porgs-modal-body">
        <label className="porgs-field">
          <span className="porgs-lab">Reason <span className="porgs-dim">(required)</span></span>
          <textarea
            className="porgs-input"
            rows={3}
            value={reason}
            maxLength={SUSPEND_REASON_MAX}
            onChange={(e) => { setReason(e.target.value); setError(''); }}
            disabled={busy}
          />
          <span className="porgs-help">
            A few words at least. It shows on this row and goes in the organisation’s audit log, which its owners and admins can read.
          </span>
        </label>
        {error && <p className="porgs-alert" role="alert">{error}</p>}
      </div>
      <footer className="porgs-modal-foot">
        <button type="button" className="porgs-btn" onClick={requestClose} disabled={busy}>Cancel</button>
        <button
          type="button"
          className="porgs-btn porgs-btn--danger"
          onClick={submit}
          disabled={busy || !ready}
          data-testid="porgs-suspend"
        >
          {busy ? 'Suspending…' : 'Suspend'}
        </button>
      </footer>
    </Modal>
  );
}
