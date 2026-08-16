import React, { useMemo, useState } from 'react';
import './SessionHistoryPanel.css';
import Icon from './Icon';
import SetImageBadge from './SetImageBadge';
import { formatWhen } from './SessionsPanel';
import { resolveGameType, gameTypeLabel, gameTypeMeta } from '../config/gameTypes';

/**
 * THE HOST'S OWN SESSION LIST, AS A TABLE.
 *
 * What this replaces: 170 lines of card markup inside `GameHostPage.jsx`'s
 * `showReportsModal` early return. Each card carried a title, a status badge
 * and a four-item label/value grid, so forty sessions was forty stacked blocks
 * of chrome — the wall RATIONALE §4 rejects, and the same argument the console
 * already settled for question sets.
 *
 * IT IS BUILT ON `.sp`, THE ADMIN SESSIONS TABLE, NOT ON `.qsets` DIRECTLY.
 * Both are the owner's standard — `.sp` is itself cut from the question-set
 * screen — but the admin already renders exactly this object, with exactly
 * these columns, and a host who is also an admin was seeing sessions drawn two
 * completely different ways. One object, one table. `formatWhen` is imported
 * from that panel rather than re-written for the same reason.
 *
 * PRESENTATIONAL BY RULE. No fetch, no `useAuth`, no API_BASE — every action is
 * a prop, exactly as `SessionSetupPanel` is. That is what makes it mountable in
 * jsdom, and the whole reason to lift it out of a 5,000-line file.
 *
 * ── THE OPEN / START SPLIT ─────────────────────────────────────────────────
 *
 * The owner: *"i cant edit the session without starting it today. maybe fix
 * it"* — and they were describing a real seam, not a missing feature. The card
 * had ONE primary button whose behaviour forked on `game.started`:
 *
 *     if (game.started) selectGameFromHistory(...)   // just loads it
 *     else               startGameFromHistory(...)   // POSTs /start, THEN loads
 *
 * So for a session that had never been started, the only way to reach its setup
 * — categories, question set, display, the lot — went through `/start`, which
 * opens the doors to players. There was no way to set a session up before
 * letting anyone in.
 *
 * `selectGameFromHistory` already does exactly what "Open" needs and always
 * did; it was simply never offered for an unstarted session. So a session that
 * has not started gets both, with **Open** as the default and Start as the
 * deliberate one — starting is the irreversible-feeling act on this screen and
 * it should not also be the only door.
 */

/** Which primary actions a row offers, given whether it has been started. */
export function rowActions(session) {
  return session.started
    ? { open: false, start: false, continue: true, report: true }
    : { open: true, start: true, continue: false, report: false };
}

/** Case-insensitive match over the fields a host would actually search by. */
export function matchesSearch(session, term) {
  const q = String(term || '').trim().toLowerCase();
  if (!q) return true;
  return [session.title, session.eventTitle, session.gameId, session.hostName, session.questionSetId]
    .filter(Boolean)
    .some((v) => String(v).toLowerCase().includes(q));
}

/** Newest first, and the newest one's id — the row that gets the Latest flag. */
export function orderSessions(sessions) {
  const sorted = [...(sessions || [])].sort(
    (a, b) => new Date(b.createdAt) - new Date(a.createdAt)
  );
  return { sorted, latestId: sorted.length ? sorted[0].gameId : null };
}

export default function SessionHistoryPanel({
  sessions = [],
  /** The session currently loaded on the stage, flagged so it is not restarted. */
  currentGameId = null,
  /** 'select' offers Open/Start/Continue; 'reports' is the same list, read for reports. */
  mode = 'select',
  /** Only for the has-images badge. Optional — an absent list simply omits it. */
  questionSets = [],
  onCopyPlayerUrl = () => {},
  onInvite = () => {},
  onReport = () => {},
  onOpen = () => {},
  onStart = () => {},
  onClose = () => {},
}) {
  const [search, setSearch] = useState('');
  const { sorted, latestId } = useMemo(() => orderSessions(sessions), [sessions]);
  const shown = useMemo(
    () => sorted.filter((s) => matchesSearch(s, search)),
    [sorted, search]
  );

  const titleOf = (s) => s.title || s.eventTitle || 'Untitled session';

  return (
    <div className="shist" data-theme="dark">
      <div className="shist__head">
        <div>
          <h2 className="shist__title">
            <Icon
              name={mode === 'select' ? 'GameController' : 'ChartBar'}
              weight="duotone"
              size={22}
              color="var(--primary)"
            />
            {mode === 'select' ? ' Session history' : ' Session reports'}
          </h2>
          <p className="shist__sub">
            {mode === 'select'
              ? 'Open one to set it up, or start it when the room is ready.'
              : 'Read a report from a session that has been played.'}
          </p>
        </div>
        <button
          type="button"
          className="shist__close"
          onClick={onClose}
          aria-label="Close session history"
        >
          ✕
        </button>
      </div>

      {/* The search is what makes the second empty state below meaningful. With
          no way to filter, "nothing matches" can never happen and the only
          honest empty state is "nothing exists". */}
      {sorted.length > 0 && (
        <div className="shist__filters">
          <label className="shist__srch">
            <span className="shist__srch-lab">Search sessions</span>
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Title, code, host or set…"
            />
          </label>
          <span className="shist__count">
            {shown.length === sorted.length
              ? `${sorted.length} ${sorted.length === 1 ? 'session' : 'sessions'}`
              : `${shown.length} of ${sorted.length}`}
          </span>
        </div>
      )}

      {/* `table-layout: fixed` lives in the stylesheet — under auto layout a
          declared width is a hint and one nowrap chip grows the whole table. */}
      <div className="shist__scroll">
        <table className="shist__tbl">
          <thead>
            <tr>
              <th className="shist__c-name">Session</th>
              <th className="shist__c-id">Code</th>
              <th className="shist__c-type">Type</th>
              <th className="shist__c-state">State</th>
              <th className="shist__c-when">Created</th>
              <th className="shist__c-when">Last played</th>
              <th className="shist__c-acts" />
            </tr>
          </thead>
          <tbody>
            {/*
              TWO EMPTY STATES, AND THEY SAY DIFFERENT THINGS. "You have not run
              a session yet" and "your search matched none of your sessions" are
              different situations with different ways out; the card list had
              only the first, so filtering to nothing would have told a host
              with forty sessions that they had none.
            */}
            {sorted.length === 0 && (
              <tr className="shist__dim">
                <td colSpan={7}>
                  No sessions yet. Create one and it will appear here.
                </td>
              </tr>
            )}
            {sorted.length > 0 && shown.length === 0 && (
              <tr className="shist__dim">
                <td colSpan={7}>No session matches that search.</td>
              </tr>
            )}

            {shown.map((session) => {
              /*
                `resolveGameType`, not `normalizeGameType`. The latter always
                returns something — its documented job — which would print
                "Call & Answer" on every legacy row whose type was never
                written. "We do not know" has to survive as "we do not know".
              */
              const type = resolveGameType(session.gameType);
              const acts = rowActions(session);
              const isCurrent = session.gameId === currentGameId;
              const isLatest = session.gameId === latestId;
              const title = titleOf(session);
              const set = questionSets.find((s) => s.id === session.questionSetId);

              return (
                <tr key={session.gameId} className={isCurrent ? 'shist__row--now' : undefined}>
                  <td>
                    <span className="shist__nm">
                      {title}
                      {isCurrent && <span className="shist__flag shist__flag--now">On stage</span>}
                      {isLatest && !isCurrent && <span className="shist__flag">Latest</span>}
                    </span>
                    <span className="shist__sub2">
                      {session.questionSetId ? `Set: ${session.questionSetId}` : 'Set: —'}
                      {session.hostName ? ` · host ${session.hostName}` : ''}
                      <SetImageBadge hasImages={set?.hasImages} />
                    </span>
                  </td>
                  <td className="shist__mono">{session.gameId}</td>
                  <td>
                    {type ? (
                      <span className="shist__chip shist__chip--type">
                        <Icon
                          name={gameTypeMeta(type).icon}
                          weight="bold"
                          size={13}
                          color="currentColor"
                        />
                        {` ${gameTypeLabel(type)}`}
                      </span>
                    ) : '—'}
                  </td>
                  <td>
                    {/* The state is a WORD, not a colour. This list is read on
                        laptops of every calibration and by hosts who cannot
                        rely on hue — the same rule the roster flags follow. */}
                    <span
                      className={`shist__chip ${session.started ? 'shist__chip--on' : 'shist__chip--off'}`}
                    >
                      {session.started ? 'Played' : 'Not started'}
                    </span>
                  </td>
                  <td className="shist__when">{formatWhen(session.createdAt)}</td>
                  <td className="shist__when">{formatWhen(session.lastPlayedAt)}</td>
                  <td>
                    {/*
                      `margin-left: auto` on the first child, NEVER
                      `justify-content: flex-end` — hard rule 9. Inside a cell
                      with `overflow: hidden`, flex-end overflows towards the
                      START, where the hidden overflow is unreachable and the
                      first buttons simply vanish. Plus `flex-wrap`, because
                      this row carries up to five actions.
                    */}
                    <div className="shist__acts">
                      <button
                        type="button"
                        className="shist__btn shist__btn--sm"
                        onClick={() => onCopyPlayerUrl(session.gameId)}
                        title={`Copy the player link for "${title}"`}
                      >
                        <Icon name="LinkSimple" weight="bold" size={14} /> Link
                      </button>
                      <button
                        type="button"
                        className="shist__btn shist__btn--sm"
                        onClick={() => onInvite(session)}
                        title={`Invite people to "${title}"`}
                      >
                        <Icon name="ClipboardText" weight="bold" size={14} /> Invite…
                      </button>
                      {acts.report && (
                        <button
                          type="button"
                          className="shist__btn shist__btn--sm"
                          onClick={() => onReport(session.gameId, title)}
                          title={`Read the report for "${title}"`}
                        >
                          <Icon name="ChartBar" weight="bold" size={14} /> Report
                        </button>
                      )}
                      {acts.open && (
                        <button
                          type="button"
                          className="shist__btn shist__btn--sm shist__btn--primary"
                          onClick={() => onOpen(session.gameId, title)}
                          title={`Open "${title}" to set it up — this does not let players in`}
                        >
                          <Icon name="Gear" weight="bold" size={14} /> Open
                        </button>
                      )}
                      {acts.start && (
                        <button
                          type="button"
                          className="shist__btn shist__btn--sm"
                          onClick={() => onStart(session.gameId, title)}
                          title={`Start "${title}" — players can join from this point`}
                        >
                          <Icon name="PlayCircle" weight="fill" size={14} /> Start
                        </button>
                      )}
                      {acts.continue && (
                        <button
                          type="button"
                          className="shist__btn shist__btn--sm shist__btn--primary"
                          onClick={() => onOpen(session.gameId, title)}
                          title={`Continue "${title}"`}
                        >
                          <Icon name="Play" weight="fill" size={14} /> Continue
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
    </div>
  );
}
