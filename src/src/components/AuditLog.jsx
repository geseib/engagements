import React, { useCallback, useEffect, useRef, useState } from 'react';
import { authFetch } from '../auth/authFetch';
import { adminApiUrl } from '../utils/adminApi';
import Modal from './Modal';
import {
  RETENTION_LINE, describeAction, actorName, actorLine, targetName, targetTypeLabel, changeLine, whenLabel, outcomeLabel,
} from '../utils/auditCopy';
import './AuditLog.css';

/**
 * THE AUDIT LOG — who changed what here, and why. Newest first, a page at a
 * time.
 *
 * The owner, 2026-10-04: "make sure that any action by an Engage admin on a
 * team or user is logged, and available [to see], with who did it." The log
 * itself is written by lambda-functions/admin/shared/audit-log.js before each
 * action; this is where it is read.
 *
 * Mounted in two places, with one look:
 *   - Data & privacy (PrivacyPanel), for a team's owners and admins and for a
 *     person in their own space: GET /orgs/{orgId}/audit.
 *   - the Organisations screen, for Engage staff: one organisation's log, or
 *     every staff action across the platform: GET /platform/audit[?orgId=].
 *
 * Built in the shape of the access log on docs/design/tenancy-redesign/
 * 08-privacy.html (one table: who, what they did with the reason under it,
 * what it touched, when), because that mockup is the nearest drawn surface and
 * the two logs sit on the same page. Reasons WRAP and never truncate — a
 * reason cut short is a reason deleted (RATIONALE §4).
 *
 * Two parts: `AuditLogTable` is pure props (testable without a network), and
 * the default export fetches and pages.
 */

/** The table and its three states. Pure. */
export function AuditLogTable({
  entries = [], loading = false, error = '', cursor = '', loadingMore = false, onMore,
  orgNames = null, emptyTitle, emptyText,
}) {
  if (loading && !entries.length) {
    return (
      <div className="alog-state">
        <h4>Loading the log</h4>
        <p>One moment.</p>
      </div>
    );
  }
  if (error && !entries.length) {
    return (
      <div className="alog-state alog-state--bad" role="alert">
        <h4>The log could not be loaded</h4>
        <p>{error} Nothing has been removed. Reload to try again.</p>
      </div>
    );
  }
  if (!entries.length) {
    return (
      <div className="alog-state">
        <h4>{emptyTitle || 'Nothing has been changed yet'}</h4>
        <p>{emptyText || 'When anyone changes something here, it appears in this list with who did it and why.'}</p>
      </div>
    );
  }
  const showOrg = Boolean(orgNames);
  return (
    <>
      <div className="alog-wrap">
        <table className={showOrg ? 'alog-tbl alog-tbl--org' : 'alog-tbl'}>
          <thead>
            <tr>
              <th scope="col" className="alog-col-who">Who</th>
              <th scope="col" className="alog-col-what">What happened</th>
              <th scope="col" className="alog-col-touched">What it touched</th>
              {showOrg && <th scope="col" className="alog-col-org">Organisation</th>}
              <th scope="col" className="alog-col-when">When</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((e) => {
              const change = changeLine(e);
              const outcome = outcomeLabel(e.outcome);
              const line = actorLine(e);
              return (
                <tr key={e.id} className="alog-row" data-testid="alog-row">
                  <td className="alog-wrapcell">
                    <span className="alog-actor">{actorName(e)}</span>
                    {line && <span className="alog-sub">{line}</span>}
                  </td>
                  <td className="alog-wrapcell">
                    <span className="alog-what">{describeAction(e.action)}</span>
                    {change && <span className="alog-sub">{change}</span>}
                    {e.reason && <span className="alog-reason">“{e.reason}”</span>}
                    {outcome && <span className="alog-outcome">{outcome}</span>}
                  </td>
                  <td className="alog-wrapcell">
                    <span>{targetName(e)}</span>
                    <span className="alog-sub">{targetTypeLabel(e.target && e.target.type)}</span>
                  </td>
                  {showOrg && (
                    <td className="alog-wrapcell">
                      {e.orgId ? (orgNames[e.orgId] || e.orgId) : <span className="alog-dim">None</span>}
                    </td>
                  )}
                  <td className="alog-wrapcell alog-dim">
                    <time dateTime={e.at}>{whenLabel(e.at)}</time>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {error && <p className="alog-err" role="alert">{error}</p>}
      {cursor && onMore && (
        <div className="alog-more">
          <button type="button" className="alog-btn" onClick={onMore} disabled={loadingMore}>
            {loadingMore ? 'Loading…' : 'Show older entries'}
          </button>
        </div>
      )}
    </>
  );
}

const PAGE = 25;

/**
 * Fetches `path` (an API path, e.g. `orgs/<id>/audit`) a page at a time and
 * renders the table. `path` may carry its own query string.
 */
export default function AuditLog({ path, orgNames = null, emptyTitle, emptyText }) {
  const [entries, setEntries] = useState([]);
  const [cursor, setCursor] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState('');
  // A newer request for a different path must win over a slower older one.
  const generation = useRef(0);

  const fetchPage = useCallback(async (after) => {
    const sep = path.includes('?') ? '&' : '?';
    const qs = `limit=${PAGE}${after ? `&cursor=${encodeURIComponent(after)}` : ''}`;
    const res = await authFetch(adminApiUrl(`${path}${sep}${qs}`));
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || `The server answered ${res.status}.`);
    return { entries: Array.isArray(body.entries) ? body.entries : [], cursor: body.cursor || '' };
  }, [path]);

  useEffect(() => {
    const mine = generation.current + 1;
    generation.current = mine;
    setEntries([]); setCursor(''); setError(''); setLoading(true);
    fetchPage('').then((page) => {
      if (generation.current !== mine) return;
      setEntries(page.entries); setCursor(page.cursor);
    }).catch((e) => {
      if (generation.current !== mine) return;
      setError(e.message || 'The log could not be loaded.');
    }).finally(() => {
      if (generation.current === mine) setLoading(false);
    });
  }, [fetchPage]);

  const more = async () => {
    if (!cursor || loadingMore) return;
    const mine = generation.current;
    setLoadingMore(true); setError('');
    try {
      const page = await fetchPage(cursor);
      if (generation.current !== mine) return;
      setEntries((prev) => {
        const seen = new Set(prev.map((e) => e.id));
        return [...prev, ...page.entries.filter((e) => !seen.has(e.id))];
      });
      setCursor(page.cursor);
    } catch (e) {
      if (generation.current === mine) setError(e.message || 'The next page could not be loaded.');
    } finally {
      if (generation.current === mine) setLoadingMore(false);
    }
  };

  return (
    <div className="alog" data-theme="dark">
      <AuditLogTable
        entries={entries}
        loading={loading}
        error={error}
        cursor={cursor}
        loadingMore={loadingMore}
        onMore={more}
        orgNames={orgNames}
        emptyTitle={emptyTitle}
        emptyText={emptyText}
      />
    </div>
  );
}

/**
 * THE STAFF VIEW, as a dialog over the Organisations screen: one
 * organisation's log (`org` given) or every staff action across the platform
 * (`org` null, with an Organisation column). Read-only, so nothing is ever
 * unsaved: the X, the backdrop, Escape and the bottom Close all simply close.
 */
export function AuditLogDialog({ org = null, orgNames = null, onClose }) {
  const logPath = org ? `platform/audit?orgId=${encodeURIComponent(org.orgId)}` : 'platform/audit';
  return (
    <Modal
      overlayClassName="alog alog-scrim"
      contentClassName="alog-modal"
      labelledBy="alog-title"
      onClose={onClose}
      theme="dark"
    >
      <header className="alog-head">
        <div className="alog-grow">
          <h2 id="alog-title">{org ? `${org.name}: who changed what` : 'What Engage staff have changed'}</h2>
          <p className="alog-dim alog-headnote">
            {org
              ? `The same list the organisation's owners and admins see on Data & privacy. ${RETENTION_LINE}`
              : `Every change staff made to a team, an account or a discount code, newest first. ${RETENTION_LINE}`}
          </p>
        </div>
        <button type="button" className="alog-x" onClick={onClose} aria-label="Close" title="Close">×</button>
      </header>
      <div className="alog-body">
        <AuditLog
          path={logPath}
          orgNames={org ? null : (orgNames || {})}
          emptyText={org
            ? 'When anyone changes something for this organisation, it appears here with who did it and why.'
            : 'When Engage staff change a team, an account or a discount code, it appears here.'}
        />
      </div>
      <footer className="alog-foot">
        <button type="button" className="alog-btn" onClick={onClose}>Close</button>
      </footer>
    </Modal>
  );
}
