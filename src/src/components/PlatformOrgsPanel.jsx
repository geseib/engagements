import React, { useCallback, useEffect, useState } from 'react';
import { authFetch } from '../auth/authFetch';
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
 * Each is one field on two rows and nothing else. A PERSONAL space cannot be
 * suspended at all — the server refuses it and this hides the control, for the
 * reason recorded in platform-orgs.js: suspending somebody's own home is an
 * account deletion with a friendlier name, and the lever for a person is their
 * account on the Accounts screen.
 */
const API = () => window.API_BASE || '';

const STATUS_LABEL = { active: 'Active', pending: 'Pending', suspended: 'Suspended' };

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
  const [counts, setCounts] = useState({ teams: 0, personal: 0, suspended: 0, pending: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busyId, setBusyId] = useState('');

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

  const setStatus = async (org, status) => {
    setBusyId(org.orgId);
    setError('');
    setNotice('');
    try {
      const res = await authFetch(`${API()}platform/orgs/${encodeURIComponent(org.orgId)}/status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `The server answered ${res.status}.`);
      /* Reloaded rather than patched in place: the counts at the top are
         derived server-side, and a local edit would leave "3 suspended" beside
         a table showing four. */
      setNotice(`${org.name} is now ${STATUS_LABEL[status].toLowerCase()}.`);
      await load();
    } catch (err) {
      setError(err.message || 'That did not work.');
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
                        {status === 'active' && !personal && (
                          <button
                            type="button"
                            className="porgs-btn porgs-btn--danger"
                            disabled={busy}
                            onClick={() => setStatus(org, 'suspended')}
                          >
                            Suspend
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
