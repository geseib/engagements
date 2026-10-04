import React, { useMemo, useState } from 'react';
import './SessionHistoryPanel.css';
import Icon from './Icon';
import SetImageBadge from './SetImageBadge';
import { formatWhen, countOrDash } from '../config/tableCells';
import {
  isBuildSession, buildRoomPath, buildReportPath,
} from '../buildroom/buildHostApi';
import {
  kindOf, kindLabel, kindIcon, isEventRow, typeOptions, itemTitles, itemKindLabel, itemStateLabel,
  eventStateLabel, itemCountText, eventStagePath, eventAgendaPath, itemSessionPath, EVENT_KIND,
} from '../config/engagementKinds';

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
 * completely different ways. One object, one table. `formatWhen` and
 * `countOrDash` come from config/tableCells.js, which is where those two rules
 * were consolidated when this screen became their third caller.
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
 * `selectGameFromHistory` already does exactly what "Open" needed and Open was
 * this panel's first answer. It lasted one review: with Edit grown to cover
 * categories, three buttons on every unstarted row was *"too many"* (the
 * owner's words), and Open — the only one whose job both others could do
 * between them — is gone. rowActions carries the full argument. `onOpen`
 * remains as a prop because Continue rides on it for started sessions.
 */

/**
 * Which actions a row offers, given whether it has been started.
 *
 * TWO PER ROW, DOWN FROM THREE. The owner, on the unstarted row's
 * Edit + Open + Start: *"i think thats too many. we want to edit a session
 * without allowing players into it... and then we want to start a session
 * (still allow edits, but this opens up the session for joiners)."*
 *
 * Open was the odd one out, and it died of its own success: it existed so a
 * host could reach a session's setup without POSTing /start, back when the
 * Edit dialog could not touch categories. Now that Edit carries everything —
 * title, details, voice, anonymity AND the category selection — Open's only
 * remaining job was "look at the stage without starting", which nobody asked
 * to keep at the cost of a three-way choice on every row.
 *
 * So: EDIT is the safe act (a dialog, no players, nothing on any wall) and
 * START is the deliberate one (loads the stage and opens the doors). Both
 * still permit change afterwards — the stage's setup panel toggles categories
 * in every live state including pre-start CREATED (toggle-category.js).
 *
 * Edit exists exactly while Start does: PUT /games/{id} refuses any session
 * whose STATE is not CREATED, so offering Edit on a started row would be a
 * button whose only outcome is a 400.
 *
 * A CLOSED SURVEY GETS REPORT ALONGSIDE RESULTS — I-2, 2026-09-26 final
 * review, correcting Task 3 fix round 1. That round had `results` REPLACE
 * `report` in the row on the premise that "a survey has no session report to
 * open at all" (create-report.js read rounds, and a survey has none). Task 4
 * made that premise false: create-report.js now reuses survey-host.js's
 * `surveyResultsPayload` directly, so a closed survey's saved report is a
 * real document carrying the event details, the roster and every survey
 * chart — the same "every open answer" content `results` shows live, just as
 * a document a host can come back for later. Swapping it out hid Task 4's
 * deliverable from the Sessions list entirely: the only way back to it was
 * Continue → Settings → Rounds tab.
 *
 * So both are true for a closed survey now, alongside `continue` — three
 * verb buttons where every other row has two. `.shist__acts`'s grid is only
 * ever `grid-template-columns: repeat(2, ...)` (`.shist__acts` in the
 * stylesheet); it is not capped at two ROWS, so a third verb button simply
 * wraps the row to a third line instead of overflowing. That is the least
 * disruptive placement available: dropping `continue` would remove this
 * row's only path back to the live stage (Results and Report each open a
 * narrower view — a modal and a document — neither replaces it), and
 * dropping either `results` or `report` would hide one of the two
 * independent things Task 3 and Task 4 each built. `session.surveyClosed`
 * (get-games-list.js, read off the same STATE batch as roundsPlayed: true
 * for SURVEY#CLOSED and ENDED, false otherwise, including "never opened" and
 * "still collecting") is the ONLY thing this reads. A survey still
 * collecting, or one that never opened, falls through to the ordinary rule
 * unchanged, the same as any other session of its `started` state.
 */
export function rowActions(session) {
  /*
    AN EVENT (2026-10-04) — one row, like any session. OPEN is its stage (the
    agenda board, /host/event/<code>), EDIT its agenda builder (the host's
    side of the console's builder), LINK the attendees' join link. Its items'
    sessions are under it, each with its own Continue and Report.
  */
  if (isEventRow(session)) {
    return {
      start: false, continue: false, report: false, edit: true, results: false, open: true,
    };
  }
  // A Build Room opens on its own page (/build), which starts nothing and
  // edits nothing here: Continue and Report, always.
  if (isBuildSession(session)) {
    return {
      start: false, continue: true, report: true, edit: false, results: false,
    };
  }
  if (session.gameType === 'survey' && session.surveyClosed) {
    return {
      start: false, continue: true, report: true, edit: false, results: true,
    };
  }
  return session.started
    ? {
      start: false, continue: true, report: true, edit: false, results: false,
    }
    : {
      start: true, continue: false, report: false, edit: true, results: false,
    };
}

/** Case-insensitive match over the fields a host would actually search by. */
export function matchesSearch(session, term) {
  const q = String(term || '').trim().toLowerCase();
  if (!q) return true;
  return [session.title, session.eventTitle, session.gameId, session.hostName, session.questionSetId,
    ...itemTitles(session)]
    .filter(Boolean)
    .some((v) => String(v).toLowerCase().includes(q));
}

/** Does this row survive the Type filter? 'all' keeps everything. */
export function matchesType(session, type) {
  return !type || type === 'all' || kindOf(session) === type;
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
  /** 'select' offers Edit/Start/Continue; 'reports' is the same list, read for reports. */
  mode = 'select',
  /** Only for the has-images badge. Optional — an absent list simply omits it. */
  questionSets = [],
  onCopyPlayerUrl = () => {},
  onInvite = () => {},
  onReport = () => {},
  /** A closed survey's "Results" button (Task 3 fix round 1) — (gameId, title). */
  onResults = () => {},
  onOpen = () => {},
  onStart = () => {},
  /** Where a Build Room row goes: /build is a page of its own. Injectable for tests. */
  navigate = (url) => window.location.assign(url),
  onEdit = () => {},
  onClose = () => {},
  /**
   * A sentence from the page — why a Start (or the create dialog's "Open the
   * survey", which lands the host here when it is refused) did not go through,
   * in the server's own words. Shown as an alert under the header.
   */
  notice = '',
}) {
  const [search, setSearch] = useState('');
  const [type, setType] = useState('all');
  /** The event rows whose agenda items are showing. */
  const [openEvents, setOpenEvents] = useState(() => new Set());
  const toggleEvent = (code) => setOpenEvents((prev) => {
    const next = new Set(prev);
    if (next.has(code)) next.delete(code); else next.add(code);
    return next;
  });
  const { sorted, latestId } = useMemo(() => orderSessions(sessions), [sessions]);
  const shown = useMemo(
    () => sorted.filter((s) => matchesSearch(s, search) && matchesType(s, type)),
    [sorted, search, type]
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
            {/* "Your sessions", not "Session history": half this list's job
                is sessions that have not happened yet — Edit and Start act on
                the future, and "history" told hosts the opposite. */}
            {mode === 'select' ? ' Your sessions' : ' Session reports'}
          </h2>
          <p className="shist__sub">
            {mode === 'select'
              ? 'Edit one to set it up, or start it when the room is ready.'
              : 'Read a report from a session that has been played.'}
          </p>
        </div>
        <button
          type="button"
          className="shist__close"
          onClick={onClose}
          aria-label="Close your sessions"
        >
          ✕
        </button>
      </div>

      {notice && (
        <div className="shist__notice" role="alert">{notice}</div>
      )}

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
          {/* TYPE, like the console's Sessions list (2026-10-04): every format,
              Build Room, and Event while events are in the list. */}
          <label className="shist__srch shist__srch--type">
            <span className="shist__srch-lab">Type</span>
            <select value={type} onChange={(e) => setType(e.target.value)} aria-label="Filter by type">
              {typeOptions(sorted).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
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
              <th className="shist__c-num">Players</th>
              <th className="shist__c-num">Rounds</th>
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
                <td colSpan={9}>
                  No sessions yet. Create one and it will appear here.
                </td>
              </tr>
            )}
            {sorted.length > 0 && shown.length === 0 && (
              <tr className="shist__dim">
                <td colSpan={9}>No session matches that search and type.</td>
              </tr>
            )}

            {shown.map((session) => (isEventRow(session) ? renderEvent(session) : renderSession(session)))}
          </tbody>
        </table>
      </div>
    </div>
  );

  function renderSession(session) {
              /*
                `resolveGameType`, not `normalizeGameType`. The latter always
                returns something — its documented job — which would print
                "Call & Answer" on every legacy row whose type was never
                written. "We do not know" has to survive as "we do not know".
              */
              const kind = kindOf(session);
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
                    {/* Build Room is not a config/gameTypes.js type on purpose
                        (Build Room PLAN §4); config/engagementKinds.js names it. */}
                    {kind ? (
                      <span className="shist__chip shist__chip--type">
                        <Icon name={kindIcon(kind)} weight="bold" size={13} color="currentColor" />
                        {` ${kindLabel(kind)}`}
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
                  {/*
                      NULL IS NOT ZERO. "Nobody joined" and "we could not read
                      it" are different facts, and rendering the second as `0`
                      is the empty-state-that-lies rule in miniature. The API
                      sends null when its per-session read failed or the row
                      predates the counters.
                  */}
                  <td className="shist__num">{countOrDash(session.playerCount)}</td>
                  <td className="shist__num">{countOrDash(session.roundsPlayed)}</td>
                  <td className="shist__when">{formatWhen(session.createdAt)}</td>
                  <td className="shist__when">{formatWhen(session.lastPlayedAt)}</td>
                  <td>
                    {/*
                      A FIXED TWO-COLUMN GRID, deliberately: four buttons in a
                      wrapping flex row broke at a different point per row and
                      read as misaligned twice over. The verbs (Report/Edit,
                      Start/Continue) take the top row because they are why
                      the screen exists; Link and Invite sit beneath them in
                      every OTHER row. A closed survey's row is the one
                      exception (I-2, 2026-09-26 final review): it carries
                      three verbs — Report, Results and Continue — so the
                      grid simply wraps to a third line before Link and
                      Invite; see rowActions' own comment for why that is the
                      least disruptive place to put the third button. See
                      .shist__acts in the stylesheet.
                    */}
                    <div className="shist__acts">
                      {acts.report && (
                        <button
                          type="button"
                          className="shist__btn shist__btn--sm"
                          onClick={() => (isBuildSession(session) ? navigate(buildReportPath(session.gameId)) : onReport(session.gameId, title))}
                          title={`Read the report for "${title}"`}
                        >
                          <Icon name="ChartBar" weight="bold" size={14} /> Report
                        </button>
                      )}
                      {/* REPORT's slot, for a closed survey — never both on one
                          row (rowActions). Reuses SurveyResultsPanel exactly;
                          this button only names which session to fetch it for. */}
                      {acts.results && (
                        <button
                          type="button"
                          className="shist__btn shist__btn--sm"
                          onClick={() => onResults(session.gameId, title)}
                          title={`See the results for "${title}"`}
                        >
                          <Icon name="ChartBar" weight="bold" size={14} /> Results
                        </button>
                      )}
                      {acts.edit && (
                        /*
                          PRIMARY, because it is the reflex act: everything it
                          does is reversible and nothing reaches a player. It
                          changes what the session IS — title, details, voice,
                          anonymity, categories — via PUT /games/{id}, which
                          only a session that has not started accepts.
                        */
                        <button
                          type="button"
                          className="shist__btn shist__btn--sm shist__btn--primary"
                          onClick={() => onEdit(session.gameId, title)}
                          title={`Edit "${title}" — title, settings and categories. Players cannot join yet.`}
                        >
                          <Icon name="PencilSimple" weight="bold" size={14} /> Edit
                        </button>
                      )}
                      {acts.start && (
                        /*
                          NOT primary, deliberately: this is the one that lets
                          players in, and it should take a decision rather than
                          a reflex. (Open used to sit between these two; see
                          rowActions for why it is gone.)
                        */
                        <button
                          type="button"
                          className="shist__btn shist__btn--sm"
                          onClick={() => onStart(session.gameId, title)}
                          title={`Start "${title}" — puts it on the stage and players can join`}
                        >
                          <Icon name="PlayCircle" weight="fill" size={14} /> Start
                        </button>
                      )}
                      {acts.continue && (
                        <button
                          type="button"
                          className="shist__btn shist__btn--sm shist__btn--primary"
                          onClick={() => (isBuildSession(session) ? navigate(buildRoomPath(session.gameId)) : onOpen(session.gameId, title))}
                          title={`Continue "${title}"`}
                        >
                          <Icon name="Play" weight="fill" size={14} /> Continue
                        </button>
                      )}
                      {/* The utilities take the second grid row, under the
                          verbs — every row has exactly these two, so the
                          bottom row never varies and the grid never staggers. */}
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
                    </div>
                  </td>
                </tr>
              );
  }

  /*
    AN EVENT'S ROW, AND — OPENED — ITS AGENDA (2026-10-04). One row, labelled
    Event with its item count; the disclosure is the name, a real button.
    Each item says its kind and state; an engagement's session continues on
    the host's stage inside the event (the stage's AGENDA door leads back) and
    opens its report, or says it has expired. A talk or a break has no session.
  */
  function renderEvent(event) {
    const acts = rowActions(event);
    const open = openEvents.has(event.gameId);
    const title = event.title || 'Untitled event';
    const itemsId = `shist-items-${event.gameId}`;
    const rows = [
      <tr key={event.gameId} data-testid="event-row">
        <td>
          <button
            type="button"
            className="shist__disclose"
            aria-expanded={open}
            aria-controls={itemsId}
            onClick={() => toggleEvent(event.gameId)}
            title={title}
          >
            <Icon name={open ? 'CaretDown' : 'CaretRight'} weight="bold" size={12} color="currentColor" />
            <span className="shist__nm">{title}</span>
          </button>
          <span className="shist__sub2">
            {itemCountText(event.itemCount)}
            {event.place ? ` · ${event.place}` : ''}
          </span>
        </td>
        <td className="shist__mono">{event.gameId}</td>
        <td>
          <span className="shist__chip shist__chip--type">
            <Icon name={kindIcon(EVENT_KIND)} weight="bold" size={13} color="currentColor" />
            {` ${kindLabel(EVENT_KIND)}`}
          </span>
        </td>
        <td>
          <span className={`shist__chip ${event.started ? 'shist__chip--on' : 'shist__chip--off'}`}>
            {eventStateLabel(event)}
          </span>
        </td>
        <td className="shist__num">{countOrDash(event.playerCount)}</td>
        <td className="shist__num">—</td>
        <td className="shist__when">{formatWhen(event.createdAt)}</td>
        <td className="shist__when">{formatWhen(event.lastPlayedAt)}</td>
        <td>
          <div className="shist__acts">
            {acts.edit && (
              <button
                type="button"
                className="shist__btn shist__btn--sm"
                onClick={() => navigate(eventAgendaPath(event.gameId))}
                title={`Edit the agenda of "${title}"`}
              >
                <Icon name="PencilSimple" weight="bold" size={14} /> Edit
              </button>
            )}
            {acts.open && (
              <button
                type="button"
                className="shist__btn shist__btn--sm shist__btn--primary"
                onClick={() => navigate(eventStagePath(event.gameId))}
                title={`Open "${title}" on its stage`}
              >
                <Icon name="Play" weight="fill" size={14} /> Open
              </button>
            )}
            <button
              type="button"
              className="shist__btn shist__btn--sm"
              onClick={() => onCopyPlayerUrl(event.gameId, { event: true })}
              title={`Copy the join link for "${title}"`}
            >
              <Icon name="LinkSimple" weight="bold" size={14} /> Link
            </button>
          </div>
        </td>
      </tr>,
    ];
    if (!open) return rows;
    (event.items || []).forEach((item, n) => {
      const s = item.session;
      const itemTitle = item.title || (item.decryptFailed ? 'Unreadable item' : itemKindLabel(item.type));
      rows.push(
        <tr key={`${event.gameId}-${item.itemId}`} className="shist__subrow" id={n === 0 ? itemsId : undefined} data-testid="event-item-row">
          <td>
            <span className="shist__nm">{itemTitle}</span>
            <span className="shist__sub2">{item.minutes ? `${item.minutes} min` : '—'}</span>
          </td>
          <td className="shist__mono">{s ? s.gameId : '—'}</td>
          <td><span className="shist__chip shist__chip--type">{` ${itemKindLabel(item.type)}`}</span></td>
          <td>
            <span className={`shist__chip ${item.state === 'planned' ? 'shist__chip--off' : 'shist__chip--on'}`}>
              {itemStateLabel(item.state)}
            </span>
          </td>
          <td className="shist__num">{s ? countOrDash(s.playerCount) : '—'}</td>
          <td className="shist__num">{s ? countOrDash(s.roundsPlayed) : '—'}</td>
          <td className="shist__when">{formatWhen(item.startedAt)}</td>
          <td className="shist__when">{formatWhen(item.endedAt)}</td>
          <td>
            <div className="shist__acts">
              {s && s.started && (
                <button
                  type="button"
                  className="shist__btn shist__btn--sm"
                  onClick={() => onReport(s.gameId, itemTitle)}
                  title={`Read the report for "${itemTitle}"`}
                >
                  <Icon name="ChartBar" weight="bold" size={14} /> Report
                </button>
              )}
              {s && (
                <button
                  type="button"
                  className="shist__btn shist__btn--sm shist__btn--primary"
                  onClick={() => navigate(itemSessionPath(s.gameId, event.gameId))}
                  title={`Continue "${itemTitle}" on the stage`}
                >
                  <Icon name="Play" weight="fill" size={14} /> Continue
                </button>
              )}
              {item.sessionGone && <span className="shist__chip shist__chip--off">Session expired</span>}
            </div>
          </td>
        </tr>,
      );
    });
    return rows;
  }
}
