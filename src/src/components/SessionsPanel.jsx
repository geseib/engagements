import React, { useState, useEffect, useCallback } from 'react';
import { deleteEvent } from '../utils/eventsApi';
import {
  isEventRow, mergeSessions, itemSessionPath, eventStagePath, eventAgendaPath,
} from '../config/engagementKinds';
import { authFetch } from '../auth/authFetch';
import { adminApiUrl } from '../utils/adminApi';
import {
  isBuildSession, buildRoomPath, buildReportPath,
} from '../buildroom/buildHostApi';
import Icon from './Icon';
import DeleteReasonField from './DeleteReasonField';
import SessionList, { matchesSessionFilters } from './SessionList';
import InviteDialog from './InviteDialog';
import { sessionIntentPath, continuePath, inviteTargetFor } from '../config/sessionRows';
import { deleteSessionRow, copyJoinLink } from '../utils/sessionRowsApi';
import './SessionsPanel.css';
import { formatWhen, countOrDash } from '../config/tableCells';

/* Re-exported: this module was formatWhen's home before three screens needed
   it, and existing importers should not have to move. matchesSessionFilters
   moved with the list into SessionList.jsx. */
export { formatWhen, countOrDash, matchesSessionFilters };

/**
 * THE SESSIONS SCREEN — Library & team's Sessions place.
 *
 * Grounded in docs/design/admin-redesign/12-sessions.html, 13-sessions-empty.html
 * and 15-confirm-delete-all.html (RATIONALE.md §8, §9). Wave D of
 * docs/superpowers/plans/2026-08-10-admin-console.md.
 *
 * WHAT THIS REPLACES. "Game Management" was a single red card: a Single/All
 * radio pair, a free-text "Enter Game ID" box and a Delete button. There was no
 * list — so to delete one session you had to already know an id this console
 * never showed you.
 *
 * ONE LIST, TWO FRAMES (experience plan 4a). The table is SessionList, the
 * same component the host's start screen uses, so a row here offers exactly
 * what it offers there: Start, Edit, Continue, Report, Survey results, Invite,
 * the join link and Delete. This file keeps what is the console's alone: the
 * load, the empty state that knows why, and Delete all.
 *
 * DATES ARE PRINTED AS THEY ARE. A missing timestamp renders as an em dash; a
 * timestamp that parses renders. Epoch-zero rows therefore show up as 1969
 * rather than being quietly normalised away.
 */

/** The phrase that has to be typed before delete-all is armed. */
export const DELETE_ALL_PHRASE = 'delete all sessions';

export default function SessionsPanel({
  environment,
  /** (code, title) => void — open an event in the console's Events place. */
  onOpenEvent,
  /** How many question sets are inactive, when the page knows. Optional: an
   *  empty state that states "0 of 0 sets" while the list is loading is an
   *  empty state that lies. */
  inactiveSetCount,
  totalSetCount,
  /** The organisation's sets, for each row's set name and its invite. Optional. */
  questionSets = [],
  /** Where a row's action goes. Injectable for tests; a page load in the app. */
  navigate = (url) => window.location.assign(url),
}) {
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [confirmAll, setConfirmAll] = useState(false);
  const [typed, setTyped] = useState('');
  /*
    THE OWNER'S DELETE RULE (2026-10-04). Each row says the role this caller
    would delete it in (`deleteAs`, from GET /games): its host, an owner or
    admin of the team, or Engage staff — who must give a reason. SessionList
    asks for that reason in the row's own confirm; `deleteAllAs` is the same
    answer for Delete all.
  */
  const [deleteAllAs, setDeleteAllAs] = useState(undefined);
  const [allReason, setAllReason] = useState('');
  const [inviteTarget, setInviteTarget] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await authFetch(adminApiUrl('games'));
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data.error || `Could not load sessions (HTTP ${response.status})`);
      }
      setSessions(mergeSessions(data));
      setDeleteAllAs(data.deleteAllAs);
      setError(null);
    } catch (err) {
      console.error('Error loading sessions:', err);
      setError(err.message || 'Failed to load sessions');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  /* ---------------------------------------------------------------- deletes */

  const deleteAll = async () => {
    setBusyId('__all__');
    try {
      /*
        EVENTS FIRST, EACH THROUGH ITS OWN ROUTE, so its item sessions go with
        it; clear-all-games then deletes the sessions a host made and leaves
        any event's. An event with an item running is refused and kept — and
        named, so nobody thinks it went.
      */
      const kept = [];
      for (const event of sessions.filter(isEventRow)) {
        try {
          // eslint-disable-next-line no-await-in-loop
          await (allAsStaff ? deleteEvent(event.gameId, { reason: allReason.trim() }) : deleteEvent(event.gameId));
        } catch (err) {
          kept.push(event);
        }
      }
      const response = await authFetch(adminApiUrl('admin/clear-all-games'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        ...(allAsStaff ? { body: JSON.stringify({ reason: allReason.trim() }) } : {}),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(result.error || 'Could not delete the sessions');
      }
      setSessions(kept);
      setError(kept.length
        ? `Kept ${kept.map((e) => e.title || e.gameId).join(', ')}: an item is running. End it on the stage, then delete the event.`
        : null);
      setConfirmAll(false);
      setTyped('');
      setAllReason('');
    } catch (err) {
      console.error('Delete all sessions error:', err);
      setError(err.message || 'Failed to delete sessions');
    } finally {
      setBusyId(null);
    }
  };

  /* --------------------------------------------------------------- the list */

  const allAsStaff = deleteAllAs === 'platform-admin';
  const armed = typed.trim() === DELETE_ALL_PHRASE && (!allAsStaff || allReason.trim().length > 0);

  /*
    THE ROW ACTIONS, IN THIS FRAME (experience plan 4a). The list and which
    actions a row offers are SessionList's and config/sessionRows.js's — the
    same as the host's own list. What differs is where they go: this console
    is a page of its own, so Start, Edit, Report and Survey results open the
    host page with the session and the action named (sessionIntentPath), and
    Continue opens the session there. Invite and the join link happen here.
  */
  const on = {
    start: (row) => navigate(sessionIntentPath(row.gameId, 'start')),
    edit: (row) => navigate(sessionIntentPath(row.gameId, 'edit')),
    report: (row) => navigate(isBuildSession(row) ? buildReportPath(row.gameId) : sessionIntentPath(row.gameId, 'report')),
    results: (row) => navigate(sessionIntentPath(row.gameId, 'results')),
    continue: (row) => navigate(isBuildSession(row) ? buildRoomPath(row.gameId) : continuePath(row.gameId)),
    open: (row) => (onOpenEvent ? onOpenEvent(row.gameId, row.title) : navigate(eventStagePath(row.gameId))),
    agenda: (row) => (onOpenEvent ? onOpenEvent(row.gameId, row.title) : navigate(eventAgendaPath(row.gameId))),
    invite: (row) => setInviteTarget(inviteTargetFor(row, questionSets)),
    link: (row) => { copyJoinLink(row.gameId, { event: isEventRow(row) }); },
    delete: async (row, reason) => {
      await deleteSessionRow(row, reason);
      setSessions((prev) => prev.filter((item) => item.gameId !== row.gameId));
      setError(null);
    },
    continueItem: (item, event) => navigate(itemSessionPath(item.session.gameId, event.gameId)),
    reportItem: (item) => navigate(sessionIntentPath(item.session.gameId, 'report')),
  };

  return (
    <div className="sp">
      {error && (
        <div className="sp-alert" role="alert">
          <Icon name="Warning" weight="fill" size={16} color="var(--danger-text)" />
          <span>{error}</span>
          <button type="button" className="sp-alert-close" onClick={() => setError(null)}>
            Dismiss
          </button>
        </div>
      )}

      {loading && sessions.length === 0 && <p className="sp-loading">Loading sessions…</p>}

      {!loading && sessions.length === 0 && !error && (
        /*
          THE EMPTY STATE THAT KNOWS WHY. "No sessions" is not the useful
          sentence; the likeliest reason a host could not start one is, and this
          console already holds that number. When it does not hold it, it says
          nothing rather than printing a zero (host §7.9).
        */
        <div className="sp-empty">
          <Icon name="GameController" weight="duotone" size={40} color="var(--muted)" />
          <h3>No sessions yet</h3>
          <p>
            Sessions are created by hosts, not here. This screen is where you find one
            afterwards — to look it up, or to clear it out.
          </p>
          {inactiveSetCount != null && totalSetCount != null && (
            <p className="sp-empty-hint">
              A host can only start a session from a set that is Active.{' '}
              <span className="sp-dim">
                {inactiveSetCount} of your {totalSetCount} sets are currently inactive.
              </span>
            </p>
          )}
        </div>
      )}

      {sessions.length > 0 && (
        <SessionList
          rows={sessions}
          questionSets={questionSets}
          on={on}
          controls
          label="Sessions"
          idPrefix="sp"
          toolbar={deleteAllAs !== '' ? (
            /* DELETE ALL lives beside the list rather than in a red card of
               its own: the list is the thing that says what would be lost. */
            <button
              type="button"
              className="sp-btn sp-btn--danger"
              onClick={() => {
                setTyped('');
                setAllReason('');
                setConfirmAll(true);
              }}
            >
              <Icon name="Trash" weight="bold" size={14} color="currentColor" />
              Delete all sessions…
            </button>
          ) : null}
        />
      )}

      <InviteDialog target={inviteTarget} onClose={() => setInviteTarget(null)} />

      {confirmAll && (
        /*
          COUNT BEFORE YOU ASK (RATIONALE §8). The shipped dialog said "Are you
          sure you want to delete ALL games? This action cannot be undone!" and
          then reported itemsDeleted AFTERWARDS. Severity is not information —
          the person already knows delete is delete. The number is.
        */
        <div className="sp-scrim" onClick={() => setConfirmAll(false)}>
          <div
            className="sp-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="sp-delall-title"
            onClick={(event) => event.stopPropagation()}
          >
            <header>
              <Icon name="Warning" weight="fill" size={20} color="var(--danger-text)" />
              <div>
                <h2 id="sp-delall-title">
                  Delete all {sessions.length} session{sessions.length === 1 ? '' : 's'}?
                </h2>
                <p className="sp-dim">Everything below goes at once. There is no undo and no export first.</p>
              </div>
            </header>

            <div className="sp-modal-body">
              <ul className="sp-impact">
                <li className="sp-bad">
                  <Icon name="Warning" weight="bold" size={14} color="var(--danger-text)" />
                  <span>
                    {sessions.filter((s) => s.started).length} of {sessions.length} have been
                    played. If one is running right now, the players' phones stop working
                    immediately.
                  </span>
                </li>
                <li className="sp-bad">
                  <Icon name="Warning" weight="bold" size={14} color="var(--danger-text)" />
                  <span>
                    Every answer, vote and player record stored under those sessions goes with
                    them, along with any report built from one.
                  </span>
                </li>
                {/*
                  What SURVIVES, and it is not decoration: clear-all-games.js:30-34
                  filters to PK GAME# and the GAMES index, so question sets
                  genuinely are untouched. Naming that is what stops someone
                  cancelling a delete they actually wanted.
                */}
                <li className="sp-ok">
                  <Icon name="Check" weight="bold" size={14} color="var(--sp-success-text)" />
                  <span>
                    {totalSetCount != null
                      ? `Question sets are not touched. All ${totalSetCount} stay exactly as they are.`
                      : 'Question sets are not touched.'}
                  </span>
                </li>
              </ul>

              <div className="sp-field">
                <label htmlFor="sp-delall-confirm">
                  Type <span className="sp-mono sp-danger-text">{DELETE_ALL_PHRASE}</span> to
                  confirm
                </label>
                <input
                  id="sp-delall-confirm"
                  className="sp-input sp-mono"
                  autoComplete="off"
                  placeholder={DELETE_ALL_PHRASE}
                  value={typed}
                  onChange={(event) => setTyped(event.target.value)}
                />
              </div>
              {allAsStaff && (
                <DeleteReasonField
                  id="sp-delall-reason"
                  value={allReason}
                  onChange={setAllReason}
                  scope="sp"
                  labelClass="sp-reason-label"
                  hintClass="sp-dim"
                />
              )}
            </div>

            <footer>
              {environment && (
                /* Repeated here, in the one dialog that could ruin a Tuesday:
                   the three tiers share an API shape and an archive service. */
                <span className="sp-envwarn">
                  <Icon name="Warning" weight="bold" size={13} color="currentColor" />
                  You are on <b>{environment.label}</b>
                </span>
              )}
              <span className="sp-grow" />
              <button type="button" className="sp-btn" onClick={() => setConfirmAll(false)}>
                Cancel
              </button>
              <button
                type="button"
                className="sp-btn sp-btn--dangersolid"
                disabled={!armed || busyId === '__all__'}
                onClick={deleteAll}
              >
                Delete all {sessions.length}
              </button>
            </footer>
          </div>
        </div>
      )}
    </div>
  );
}
