import React, { useState, useEffect, useCallback } from 'react';
import { authFetch } from '../auth/authFetch';
import { adminApiUrl } from '../utils/adminApi';
import Icon from './Icon';
import ListControls from './ListControls';
import useListControls from '../hooks/useListControls';
import { formatWhen } from '../config/tableCells';
import { shareLinkFor } from '../config/reportShare';
import CopyField from './CopyField';
import {
  kindOf, kindLabel, isEventRow, typeOptions, itemTitles, groupReports, itemKindLabel,
  itemStateLabel, eventStateLabel, itemCountText, EVENT_KIND,
} from '../config/engagementKinds';
import './ReportsPanel.css';

/**
 * REPORTS — the saved PDFs, findable after the session that made them is gone.
 *
 * Built from docs/design/reports-list/01-reports.html (2026-09-21). The three
 * decisions the mockup takes are kept:
 *   - "Kept until" is a DATE, never a countdown; red inside seven days; the pin
 *     marks the year-long keep.
 *   - The session column says "Expired" rather than offering a dead Open.
 *
 * One the mockup took is REVERSED: "a second save of one session is a second
 * row". The owner, 2026-09-23: "creating the report again doesn't overwrite it
 * for the same session it creates a new line item. Probably wasteful." A save
 * now replaces the session's earlier one (save-report.js), so a session is one
 * row here. Rows saved twice before that change collapse the next time that
 * session's report is saved.
 *
 * SHARE, per row: the link and passkey a person with no account needs, found
 * again here (the owner: "no way to get the link and passkey back"). It opens
 * INLINE under the row, not as a dialog — on the host screen this whole list
 * is already inside one, and a dialog is never opened from a dialog.
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

/** A row's retention for the filter: an event is kept for a year if any item's report is. */
const keepOf = (r) => {
  if (isEventRow(r)) return (r.items || []).some((i) => i.report && i.report.permanent) ? 'year' : 'standard';
  return r.permanent ? 'year' : 'standard';
};

/*
  EVERY ROW TYPED, AN EVENT ONE ROW (2026-10-04). GET /reports names each
  report's format and files an event item's report under its event;
  config/engagementKinds.js `groupReports` turns that into rows, so an item's
  report is never listed twice and a Build Room's report reads Build Room.
*/
const LIST_CONFIG = {
  searchFields: ['title', 'gameId', itemTitles],
  axes: {
    type: { get: kindOf },
    keep: { get: keepOf },
  },
  sorts: SORTS,
  defaultSort: 'newest',
};

const WEEK = 7 * 24 * 60 * 60 * 1000;

/** The list's look for the shared CopyField (ReportsPanel.css). */
const SHARE_FIELD = {
  field: 'rp-share-field',
  label: 'rp-share-label',
  row: 'rp-share-row',
  input: 'rp-share-input',
  button: 'rp-btn',
  note: 'rp-share-copynote',
};

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
  const [sharingId, setSharingId] = useState(null);
  /** The event rows whose agenda items are showing. */
  const [openEvents, setOpenEvents] = useState(() => new Set());
  const toggleEvent = (code) => setOpenEvents((prev) => {
    const next = new Set(prev);
    if (next.has(code)) next.delete(code); else next.add(code);
    return next;
  });

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await authFetch(adminApiUrl('reports'));
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || `HTTP ${response.status}`);
      setReports(groupReports(body));
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
    state: { search, type, keep, sort },
    set, shown, drops, activeFilterCount, clearOne, clearAll,
  } = useListControls(reports, LIST_CONFIG, {
    labels: {
      search: (needle) => `Search “${needle}”`,
      type: (value) => `Type: ${kindLabel(value)}`,
      keep: (value) => (value === 'year' ? 'Kept for a year' : 'Standard (90 days)'),
    },
  });

  const now = Date.now();

  /*
    ONE SAVED REPORT'S ROW, and its share row when open. Used for a report on
    its own and for an event item's report under its event (`sub`), so both
    share and download exactly the same way.
  */
  const renderReport = (report, { sub = false, title = '' } = {}) => {
    const expires = report.expiresAt ? new Date(report.expiresAt).getTime() : 0;
    const soon = expires > 0 && expires - now < WEEK;
    const sharing = sharingId === report.id;
    const shareId = `rp-share-${String(report.id).replace(/[^A-Za-z0-9_-]/g, '')}`;
    const name = title || report.title;
    const kind = kindOf(report);
    const rowClass = [busyId === report.id ? 'rp-busy' : '', sharing ? 'rp-open' : '', sub ? 'rp-subrow' : ''].filter(Boolean).join(' ');
    const out = [
      <tr key={report.id} className={rowClass || undefined} data-testid="report-row">
        <td>
          <span className="rp-name" title={name || report.gameId}>{name || 'Untitled report'}</span>
          <span className="rp-sub">
            Session <span className="rp-mono">{report.gameId}</span>
            {report.permanent && <> · <b>kept for a year</b></>}
          </span>
        </td>
        <td>{kind ? <span className="rp-chip rp-chip--type">{kindLabel(kind)}</span> : '—'}</td>
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
              onClick={() => setSharingId(sharing ? null : report.id)}
              aria-expanded={sharing}
              aria-controls={shareId}
              aria-label={`Share ${name || report.gameId}`}
            >
              <Icon name="LinkSimple" weight="bold" size={13} color="currentColor" /> Share
            </button>
            <button
              type="button"
              className="rp-btn rp-btn--sm"
              disabled={busyId === report.id}
              onClick={() => download(report)}
              aria-label={`Download ${name || report.gameId}`}
            >
              <Icon name="DownloadSimple" weight="bold" size={13} color="currentColor" /> PDF
            </button>
          </div>
        </td>
      </tr>,
    ];
    if (sharing) {
      out.push(
        <tr key={`${report.id}-share`} className="rp-sharerow" data-testid="report-share-row">
          <td colSpan={6}>
            <div className="rp-share" id={shareId}>
              {report.passkey ? (
                <>
                  <CopyField
                    id={`${shareId}-link`}
                    label="Link"
                    value={shareLinkFor(window.location.origin, report.gameId, report.s3Key)}
                    copyLabel={`Copy the link to ${name || report.gameId}`}
                    classes={SHARE_FIELD}
                  />
                  <CopyField
                    id={`${shareId}-key`}
                    label="Passkey"
                    value={report.passkey}
                    inputClassName="rp-share-input--key"
                    copyLabel={`Copy the passkey for ${name || report.gameId}`}
                    classes={SHARE_FIELD}
                  />
                  <p className="rp-share-note">
                    Someone without an account needs both to download it, until {formatKeptUntil(report.expiresAt)}.
                    Sending the passkey separately keeps a forwarded link from opening it.
                  </p>
                </>
              ) : (
                <p className="rp-share-note">
                  This report was saved before its passkey was kept, so there is no link to share.
                  Save the session&apos;s report again to get one, or download the PDF and send that.
                </p>
              )}
            </div>
          </td>
        </tr>,
      );
    }
    return out;
  };

  /*
    AN EVENT, ONE ROW (2026-10-04). Its agenda opens under it: an item with a
    saved report is that report's own row (Share, PDF); an engagement with no
    saved report says so, and whether its session is still there to save one
    from; a talk or a break has no session and no report.
  */
  const renderEvent = (event) => {
    const open = openEvents.has(event.code);
    const itemsId = `rp-items-${event.code}`;
    const title = event.title || `Event ${event.code}`;
    const rows = [
      <tr key={event.id} data-testid="event-row">
        <td>
          <button
            type="button"
            className="rp-disclose"
            aria-expanded={open}
            aria-controls={itemsId}
            onClick={() => toggleEvent(event.code)}
            title={title}
          >
            <Icon name={open ? 'CaretDown' : 'CaretRight'} weight="bold" size={12} color="currentColor" />
            <span className="rp-nm">{title}</span>
          </button>
          <span className="rp-sub">
            {itemCountText(event.itemCount)} · {event.reportCount} report{event.reportCount === 1 ? '' : 's'} saved
          </span>
        </td>
        <td><span className="rp-chip rp-chip--type">{kindLabel(EVENT_KIND)}</span></td>
        <td className="rp-when">{formatWhen(event.savedAt)}</td>
        <td className="rp-until">{event.expiresAt ? formatKeptUntil(event.expiresAt) : '—'}</td>
        <td><span className="rp-chip rp-chip--type">{eventStateLabel(event)}</span></td>
        <td />
      </tr>,
    ];
    if (!open) return rows;
    (event.items || []).forEach((item, n) => {
      const itemTitle = item.title || (item.decryptFailed ? 'Unreadable item' : itemKindLabel(item.type));
      if (item.report) {
        rows.push(...renderReport(item.report, { sub: true, title: itemTitle }));
        return;
      }
      rows.push(
        <tr key={`${event.code}-${item.itemId}`} className="rp-subrow" id={n === 0 ? itemsId : undefined} data-testid="event-item-row">
          <td>
            <span className="rp-name" title={itemTitle}>{itemTitle}</span>
            <span className="rp-sub">{item.gameId ? <>Session <span className="rp-mono">{item.gameId}</span></> : itemStateLabel(item.state)}</span>
          </td>
          <td><span className="rp-chip rp-chip--type">{itemKindLabel(item.type)}</span></td>
          <td className="rp-when">—</td>
          <td className="rp-until">—</td>
          <td>
            {item.gameId
              ? <span className="rp-chip rp-chip--off">{item.sessionGone ? 'Session expired' : 'No report saved'}</span>
              : '—'}
          </td>
          <td />
        </tr>,
      );
    });
    return rows;
  };

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
                key: 'type',
                value: type,
                onChange: (value) => set({ type: value }),
                ariaLabel: 'Filter by type',
                options: typeOptions(reports),
              },
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
                  <th className="rp-col-type">Type</th>
                  <th className="rp-col-when">Saved</th>
                  <th className="rp-col-until">Kept until</th>
                  <th className="rp-col-sess">Session</th>
                  <th className="rp-col-acts" />
                </tr>
              </thead>
              <tbody>
                {shown.map((row) => (isEventRow(row) ? renderEvent(row) : renderReport(row)))}
              </tbody>
            </table>
          )}
        </>
      )}
    </div>
  );
}
