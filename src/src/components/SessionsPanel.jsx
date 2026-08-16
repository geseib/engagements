import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { authFetch } from '../auth/authFetch';
import { adminApiUrl } from '../utils/adminApi';
import { resolveGameType, gameTypeLabel } from '../config/gameTypes';
import Icon from './Icon';
import './SessionsPanel.css';
import { formatWhen, countOrDash } from '../config/tableCells';

/* Re-exported: this module was formatWhen's home before three screens needed
   it, and existing importers should not have to move. */
export { formatWhen, countOrDash };

/**
 * THE SESSIONS SCREEN.
 *
 * Grounded in docs/design/admin-redesign/12-sessions.html, 13-sessions-empty.html
 * and 15-confirm-delete-all.html (RATIONALE.md §8, §9). Wave D of
 * docs/superpowers/plans/2026-08-10-admin-console.md.
 *
 * WHAT THIS REPLACES. "Game Management" was a single red card: a Single/All
 * radio pair, a free-text "Enter Game ID" box and a Delete button. There was no
 * list — so to delete one session you had to already know an id this console
 * never showed you, and the only surface that displays a game id is the host
 * screen. `GET /games` has been deployed the whole time
 * (template-clean.yaml:808-825) and the admin console has never called it.
 *
 * WHAT IS NOT HERE, AND WHY. The mockup draws Players, Report and a Live state.
 * `get-games-list.js` returns exactly nine fields — gameId, title, gameType,
 * questionSetId, createdAt, started, lastPlayedAt, visibility, hostName — and
 * none of them is a player count, a report, or current liveness. Drawing those
 * columns would be the same class of error as the users screen's Provider
 * column, which printed "cognito" for all 24 accounts because nothing ever set
 * it. They are omitted and reported, not invented.
 *
 * DATES ARE PRINTED AS THEY ARE. A missing timestamp renders as an em dash; a
 * timestamp that parses renders. Epoch-zero rows ("31 Dec 1969", CLAUDE.md
 * Active Issues) therefore show up here as 1969 rather than being quietly
 * normalised away — OPEN-QUESTIONS #11 needs to know whether that is a bad
 * write or a bad formatter, and a guard here would hide the evidence.
 */

/** The phrase that has to be typed before delete-all is armed. */
export const DELETE_ALL_PHRASE = 'delete all sessions';

export default function SessionsPanel({
  environment,
  /** How many question sets are inactive, when the page knows. Optional: an
   *  empty state that states "0 of 0 sets" while the list is loading is an
   *  empty state that lies. */
  inactiveSetCount,
  totalSetCount,
}) {
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState('');
  const [stateFilter, setStateFilter] = useState('all');
  const [busyId, setBusyId] = useState(null);
  const [confirmAll, setConfirmAll] = useState(false);
  const [typed, setTyped] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await authFetch(adminApiUrl('games'));
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data.error || `Could not load sessions (HTTP ${response.status})`);
      }
      setSessions(Array.isArray(data.games) ? data.games : []);
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

  const deleteOne = async (session) => {
    const name = session.title || 'this session';
    if (
      !window.confirm(
        `Delete ${name} (${session.gameId})?\n\nEvery answer, vote and player record stored under this session goes with it. The question set it was built from is not touched.`
      )
    ) {
      return;
    }
    setBusyId(session.gameId);
    try {
      const response = await authFetch(
        adminApiUrl(`admin/clear-game/${encodeURIComponent(session.gameId)}`),
        { method: 'POST', headers: { 'Content-Type': 'application/json' } }
      );
      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(result.error || `Could not delete ${session.gameId}`);
      }
      setSessions((prev) => prev.filter((item) => item.gameId !== session.gameId));
      setError(null);
    } catch (err) {
      console.error('Delete session error:', err);
      setError(err.message || 'Failed to delete session');
    } finally {
      setBusyId(null);
    }
  };

  const deleteAll = async () => {
    setBusyId('__all__');
    try {
      const response = await authFetch(adminApiUrl('admin/clear-all-games'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(result.error || 'Could not delete the sessions');
      }
      setSessions([]);
      setError(null);
      setConfirmAll(false);
      setTyped('');
    } catch (err) {
      console.error('Delete all sessions error:', err);
      setError(err.message || 'Failed to delete sessions');
    } finally {
      setBusyId(null);
    }
  };

  /* --------------------------------------------------------------- the list */

  const shown = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return sessions.filter((session) => {
      if (stateFilter === 'played' && !session.started) return false;
      if (stateFilter === 'unstarted' && session.started) return false;
      if (!needle) return true;
      // The id is included on purpose: a game code is the one thing an operator
      // arrives holding, and it is what the old free-text box demanded.
      return [session.title, session.gameId, session.hostName, session.questionSetId]
        .filter(Boolean)
        .some((field) => String(field).toLowerCase().includes(needle));
    });
  }, [sessions, search, stateFilter]);

  const armed = typed.trim() === DELETE_ALL_PHRASE;

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
        <>
          <div className="sp-filters">
            <div className="sp-search">
              <Icon name="MagnifyingGlass" weight="bold" size={14} color="var(--muted)" />
              <input
                type="search"
                className="sp-input"
                aria-label="Search title, session code, host"
                placeholder="Search title, session code, host"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </div>

            <select
              className="sp-input sp-select"
              aria-label="Filter by state"
              value={stateFilter}
              onChange={(event) => setStateFilter(event.target.value)}
            >
              <option value="all">All states</option>
              <option value="played">Played</option>
              <option value="unstarted">Never started</option>
            </select>

            <span className="sp-count">
              {sessions.length} session{sessions.length === 1 ? '' : 's'}
              {shown.length !== sessions.length ? ` · ${shown.length} shown` : ''}
            </span>

            {/*
              DELETE ALL. It lives beside the list rather than in a red card of
              its own, because the list is now the thing that says what would be
              lost. It is not rendered when there is nothing to delete.
            */}
            <button
              type="button"
              className="sp-btn sp-btn--danger"
              onClick={() => {
                setTyped('');
                setConfirmAll(true);
              }}
            >
              <Icon name="Trash" weight="bold" size={14} color="currentColor" />
              Delete all sessions…
            </button>
          </div>

          <table className="sp-tbl">
            <thead>
              <tr>
                <th className="sp-col-name">Session</th>
                <th className="sp-col-id">Code</th>
                <th className="sp-col-type">Type</th>
                <th className="sp-col-state">State</th>
                <th className="sp-col-num">Players</th>
                <th className="sp-col-num">Rounds</th>
                <th className="sp-col-when">Created</th>
                <th className="sp-col-when">Last played</th>
                <th className="sp-col-acts" />
              </tr>
            </thead>
            <tbody>
              {shown.length === 0 && (
                <tr className="sp-dimrow">
                  <td colSpan={9}>No session matches this search.</td>
                </tr>
              )}
              {shown.map((session) => {
                /*
                  resolveGameType, not normalizeGameType. The latter always
                  returns something — its documented job — which would print
                  "Call & Answer" on every legacy row whose GameType was never
                  written. "We do not know" has to survive as "we do not know".
                */
                const type = resolveGameType(session.gameType);
                const busy = busyId === session.gameId;
                return (
                  <tr key={session.gameId} className={busy ? 'sp-busy' : undefined}>
                    <td>
                      <span className="sp-nm">{session.title || 'Untitled session'}</span>
                      <span className="sp-sub">
                        {session.questionSetId ? `Set: ${session.questionSetId}` : 'Set: —'}
                        {session.hostName ? ` · host ${session.hostName}` : ''}
                      </span>
                    </td>
                    <td className="sp-mono">{session.gameId}</td>
                    <td>
                      {type ? <span className="sp-chip sp-chip--type">{gameTypeLabel(type)}</span> : '—'}
                    </td>
                    <td>
                      <span className={`sp-chip ${session.started ? 'sp-chip--on' : 'sp-chip--off'}`}>
                        {session.started ? 'Played' : 'Never started'}
                      </span>
                    </td>
                    {/* null, never 0 — "we could not read it" is not "nobody
                        joined". get-games-list sends null when its per-session
                        read failed or the row predates the counts. */}
                    <td className="sp-num">{countOrDash(session.playerCount)}</td>
                    <td className="sp-num">{countOrDash(session.roundsPlayed)}</td>
                    <td className="sp-when">{formatWhen(session.createdAt)}</td>
                    <td className="sp-when">{formatWhen(session.lastPlayedAt)}</td>
                    <td>
                      <div className="sp-rowact">
                        <button
                          type="button"
                          className="sp-btn sp-btn--sm sp-btn--ghostdanger"
                          disabled={busy}
                          onClick={() => deleteOne(session)}
                        >
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </>
      )}

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
