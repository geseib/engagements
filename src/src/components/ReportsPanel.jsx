import React, { useState, useEffect, useCallback } from 'react';
import { authFetch } from '../auth/authFetch';
import { adminApiUrl } from '../utils/adminApi';
import Icon from './Icon';
import ListControls from './ListControls';
import useListControls from '../hooks/useListControls';
import { formatWhen } from '../config/tableCells';
import './ReportsPanel.css';

/**
 * REPORTS — the saved PDFs, findable after the session that made them is gone.
 *
 * Built from docs/design/reports-list/01-reports.html (2026-09-21). The three
 * decisions the mockup takes are kept:
 *   - "Kept until" is a DATE, never a countdown; red inside seven days; the pin
 *     marks the year-long keep.
 *   - The session column says "Expired" rather than offering a dead Open.
 *   - A second save of one session is a second row.
 *
 * Reads GET /reports (lambda-functions/game/get-reports.js). Downloads go
 * through GET /reports/download, which authorises on the caller's own index
 * row rather than the session's METADATA — the row that expires.
 *
 * `.rp` is its own scope. It copies SessionsPanel's tokens rather than reusing
 * `.sp`, because the namespace tests hold each screen to one scope class.
 */
const SORTS = {
  newest: (a, b) => new Date(b.savedAt || 0) - new Date(a.savedAt || 0),
  oldest: (a, b) => new Date(a.savedAt || 0) - new Date(b.savedAt || 0),
  expiring: (a, b) => new Date(a.expiresAt || 0) - new Date(b.expiresAt || 0),
  title: (a, b) => String(a.title || '').localeCompare(String(b.title || '')),
};

const LIST_CONFIG = {
  searchFields: ['title', 'gameId'],
  axes: {
    keep: { get: (r) => (r.permanent ? 'year' : 'standard') },
  },
  sorts: SORTS,
  defaultSort: 'newest',
};

const WEEK = 7 * 24 * 60 * 60 * 1000;

/** "6 Aug 2027" — a date the page can be printed with. */
export function formatKeptUntil(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

export default function ReportsPanel({ heading = null }) {
  const [reports, setReports] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [busyId, setBusyId] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await authFetch(adminApiUrl('reports'));
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || `HTTP ${response.status}`);
      setReports(Array.isArray(body.reports) ? body.reports : []);
    } catch (err) {
      setError(err.message || 'Could not load reports');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  /** Fetch with the signed-in token, then hand the browser a blob: the route
   *  is authorised, so a bare <a href> would 401. */
  const download = async (report) => {
    setBusyId(report.id);
    try {
      const response = await authFetch(adminApiUrl(report.downloadUrl));
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = report.s3Key.replace(/^permanent\//, '').replace(/\.enc$/, '');
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (err) {
      setError(`Could not download “${report.title || report.gameId}”: ${err.message}`);
    } finally {
      setBusyId(null);
    }
  };

  const {
    state: { search, keep, sort },
    set, shown, drops, activeFilterCount, clearOne, clearAll,
  } = useListControls(reports, LIST_CONFIG, {
    labels: {
      search: (needle) => `Search “${needle}”`,
      keep: (value) => (value === 'year' ? 'Kept for a year' : 'Standard (90 days)'),
    },
  });

  const now = Date.now();

  return (
    <div className="rp">
      {heading}
      {error && (
        <div className="rp-alert" role="alert">
          <Icon name="Warning" weight="fill" size={16} color="currentColor" />
          <span>{error}</span>
          <button type="button" className="rp-alert-close" onClick={() => setError(null)}>Dismiss</button>
        </div>
      )}

      {loading && reports.length === 0 && <p className="rp-loading">Loading reports…</p>}

      {!loading && reports.length === 0 && !error && (
        <div className="rp-empty" data-testid="reports-empty">
          <h3>No saved reports</h3>
          <p>
            A report is saved from a session's report screen. Standard reports are kept 90 days from the
            day they are saved; one saved as <b>Keep for a year</b> is kept 365. They stay here after the
            session itself has expired.
          </p>
        </div>
      )}

      {reports.length > 0 && (
        <>
          <ListControls
            scope="rp"
            search={{
              value: search,
              onChange: (value) => set({ search: value }),
              ariaLabel: 'Search title or session code',
              placeholder: 'Search title or session code',
            }}
            selects={[
              {
                key: 'keep',
                value: keep,
                onChange: (value) => set({ keep: value }),
                ariaLabel: 'Filter by retention',
                options: [
                  { value: 'all', label: 'Any retention' },
                  { value: 'year', label: 'Kept for a year' },
                  { value: 'standard', label: 'Standard (90 days)' },
                ],
              },
              {
                key: 'sort',
                value: sort,
                onChange: (value) => set({ sort: value }),
                ariaLabel: 'Sort',
                options: [
                  { value: 'newest', label: 'Newest saved' },
                  { value: 'oldest', label: 'Oldest saved' },
                  { value: 'expiring', label: 'Expiring soonest' },
                  { value: 'title', label: 'Title A–Z' },
                ],
              },
            ]}
            count={`${reports.length} report${reports.length === 1 ? '' : 's'}${shown.length !== reports.length ? ` · ${shown.length} shown` : ''}`}
          />

          {shown.length === 0 ? (
            <div className="rp-nomatch" data-testid="reports-nomatch">
              <p>No report matches. {activeFilterCount} filter{activeFilterCount === 1 ? '' : 's'} on:</p>
              <div className="rp-drops">
                {drops.map((d) => (
                  <button key={d.key} type="button" className="rp-drop" onClick={() => clearOne(d.key)}>
                    {d.label} <span aria-hidden="true">×</span>
                  </button>
                ))}
              </div>
              <button type="button" className="rp-btn rp-btn--link" onClick={clearAll}>Clear all filters</button>
            </div>
          ) : (
            <table className="rp-tbl">
              <thead>
                <tr>
                  <th className="rp-col-name">Report</th>
                  <th className="rp-col-when">Saved</th>
                  <th className="rp-col-until">Kept until</th>
                  <th className="rp-col-sess">Session</th>
                  <th className="rp-col-acts" />
                </tr>
              </thead>
              <tbody>
                {shown.map((report) => {
                  const expires = report.expiresAt ? new Date(report.expiresAt).getTime() : 0;
                  const soon = expires > 0 && expires - now < WEEK;
                  return (
                    <tr key={report.id} className={busyId === report.id ? 'rp-busy' : ''} data-testid="report-row">
                      <td>
                        <span className="rp-name" title={report.title || report.gameId}>{report.title || 'Untitled report'}</span>
                        <span className="rp-sub">
                          Session <span className="rp-mono">{report.gameId}</span>
                          {report.permanent && <> · <b>kept for a year</b></>}
                        </span>
                      </td>
                      <td className="rp-when">{formatWhen(report.savedAt)}</td>
                      <td className={`rp-until${soon ? ' rp-until--soon' : ''}`} data-testid="kept-until">
                        {report.permanent && <Icon name="PushPin" weight="fill" size={13} color="currentColor" />}
                        {formatKeptUntil(report.expiresAt)}
                      </td>
                      <td>
                        {report.sessionGone
                          ? <span className="rp-chip rp-chip--off">Session expired</span>
                          : <span className="rp-chip rp-chip--on">Still open</span>}
                      </td>
                      <td>
                        <div className="rp-rowact">
                          <button
                            type="button"
                            className="rp-btn rp-btn--sm"
                            disabled={busyId === report.id}
                            onClick={() => download(report)}
                            aria-label={`Download ${report.title || report.gameId}`}
                          >
                            <Icon name="DownloadSimple" weight="bold" size={13} color="currentColor" /> PDF
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </>
      )}
    </div>
  );
}
