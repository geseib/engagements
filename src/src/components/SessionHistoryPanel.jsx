import React, { useMemo } from 'react';
import './SessionHistoryPanel.css';
import Icon from './Icon';
import { DialogHead } from './ui/DialogParts';
import HelpButton from './HelpButton';
import { helpFor } from '../config/help/screens';
import SessionList from './SessionList';
import { START_WORDS, startModeFor } from '../config/sessionStart';
import { kindOf, isEventRow, itemTitles } from '../config/engagementKinds';
import { sessionActions, allActions } from '../config/sessionRows';
import { hostListHandlers, startLabelFor, startRow } from '../config/hostSessionActions';

/**
 * THE HOST'S OWN SESSION LIST, AS A TABLE.
 *
 * What this replaces: 170 lines of card markup inside `GameHostPage.jsx`'s
 * `showReportsModal` early return. Each card carried a title, a status badge
 * and a four-item label/value grid, so forty sessions was forty stacked blocks
 * of chrome — the wall RATIONALE §4 rejects, and the same argument the console
 * already settled for question sets.
 *
 * ONE OBJECT, ONE TABLE (experience plan 4a). The rows are SessionList — the
 * same component Library & team's Sessions place and Home use — so a host who
 * is also an admin no longer sees sessions drawn two different ways, and a row
 * offers the same actions wherever it is met. This file is the dialog's frame:
 * its heading, the page's notice, the "just created" line and the
 * like-last-time line under the list.
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
 * So both are true for a closed survey now, alongside `continue`: Survey
 * results is the row's primary and Report and Continue are in its ⋯ menu.
 * Dropping `continue` would remove the row's only path back to the live
 * stage; dropping either of the other two would hide one of the two things
 * Task 3 and Task 4 each built. `session.surveyClosed` (get-games-list.js,
 * true for SURVEY#CLOSED and ENDED) is the ONLY thing this reads. A survey still
 * collecting, or one that never opened, falls through to the ordinary rule
 * unchanged, the same as any other session of its `started` state.
 */
export function rowActions(session) {
  /*
    SINCE THE EXPERIENCE PLAN'S 4a this is a view of config/sessionRows.js
    `sessionActions`, the one rule both sessions lists follow. The booleans
    are the shape this export has always had; the rules above still hold
    (Edit exactly while Start; a closed survey keeps Report beside Results;
    an event opens its stage and edits its agenda; a Build Room continues on
    its own page). Invite, the join link and Delete are in every row's menu.
  */
  const ids = allActions(session);
  return {
    start: ids.includes('start'),
    continue: ids.includes('continue'),
    report: ids.includes('report'),
    edit: ids.includes('edit') || ids.includes('agenda'),
    results: ids.includes('results'),
    ...(isEventRow(session) ? { open: ids.includes('open') } : {}),
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
  /** For each row's set name and has-images badge. Optional. */
  questionSets = [],
  onCopyPlayerUrl = () => {},
  onInvite = () => {},
  onReport = () => {},
  /** A closed survey's "Survey results" — (gameId, title). */
  onResults = () => {},
  onOpen = () => {},
  onStart = () => {},
  /** Delete a row — (row, reason) => Promise. Absent: the list offers no Delete. */
  onDelete = null,
  /*
    A RETURNING HOST'S START (session-start D2, F5; experience plan 2b): the
    browser's stored choice of where the room watches ('two' | 'classic' |
    null). With 'two', a Call & Answer row's Start says "Start · two screens"
    and opens the room's window inside its own click (openPendingRoomWindow),
    handing it to onStart as its third argument: (gameId, title,
    { pending, blocked }). `onRoomScreen` is "One screen this time".
  */
  roomScreen = null,
  onRoomScreen = null,
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
  /**
   * WHAT WAS JUST MADE OR SAVED: { gameId, title, verb: 'created' | 'saved' }
   * from the page, or null. Said on the list it lands on, with the join code
   * and the next step (live dev tests: "Did it work? What's 1224? Do I press
   * Start now?").
   */
  done = null,
}) {
  const { sorted } = useMemo(() => orderSessions(sessions), [sessions]);
  const titleOf = (s) => s.title || s.eventTitle || 'Untitled session';

  /* THE ROWS ARE SessionList (experience plan 4a): the same list, row shape
     and actions as Library & team's Sessions and Home's recent rows. */
  const on = hostListHandlers({
    onStart, onEdit, onOpen, onReport, onResults, onInvite, onCopyPlayerUrl, onDelete, roomScreen, navigate,
  });
  const offersMode = roomScreen && sorted.some((s) => !isEventRow(s) && sessionActions(s).primary === 'start' && startModeFor(s, roomScreen));

  return (
    <div className="shist" data-theme="dark">
      {/* The shared dialog head (ui/DialogParts, experience plan 5b): this
          panel is the content of the sessions dialog. */}
      <DialogHead
        className="shist__head"
        titleId="shist-title"
        titleClassName="shist__title"
        titleProps={{ tabIndex: -1 }}
        title={(
          <>
            <Icon
              name={mode === 'select' ? 'GameController' : 'ChartBar'}
              weight="duotone"
              size={22}
              color="var(--primary)"
            />
            {/* "Your sessions", not "Session history": half this list's job
                is sessions that have not happened yet. In reports mode it is
                the same list, read for a played session's report. */}
            {' Your sessions'}
          </>
        )}
        sub={mode === 'select'
          ? 'Start one when the room is ready, or edit it first. More is under ⋯ on each row.'
          : 'Read a report from a session that has been played. Saved PDFs are under Reports.'}
        subClassName="shist__sub"
        onClose={onClose}
        closeLabel="Close your sessions"
        closeClassName="shist__close"
      >
        {/* The setup guide's sessions-list section (Help Phase 3). */}
        <HelpButton {...helpFor('host-sessions')} variant="inline" size="small" tooltip="Help: your sessions" className="help-button-quiet shist__help" />
      </DialogHead>

      {notice && (
        <div className="shist__notice" role="alert">{notice}</div>
      )}

      {done && done.gameId && (() => {
        const row = (sessions || []).find((s) => String(s.gameId) === String(done.gameId)) || null;
        return (
          <div className="shist__done" role="status" data-testid="shist-done">
            <Icon name="CheckCircle" weight="fill" size={18} color="currentColor" />
            <p>
              <b>{done.verb === 'saved' ? 'Saved' : 'Created'} “{done.title || (row && titleOf(row)) || 'your session'}”.</b>
              {' '}Its code is <b className="shist__mono">{done.gameId}</b>.
              {' '}It waits here, and nobody can join until you press <b>Start</b> when the room is ready
              {' '}— today or on the day. You can still <b>Edit</b> it first, from ⋯ on its row.
            </p>
            {row && !row.started && (
              /* onStart's contract is (gameId, title), as the row's own Start
                 calls it. This passed the whole row once, and the page built
                 POST /games/[object Object]/start from it (issue #48 finding 1). */
              <button type="button" className="shist__done-start" onClick={() => startRow(row, done.title || titleOf(row), { onStart, roomScreen })}>
                <Icon name="Play" weight="fill" size={13} color="currentColor" /> {START_WORDS.now(startModeFor(row, roomScreen))}
              </button>
            )}
          </div>
        );
      })()}

      <div className="shist__scroll">
        <SessionList
          rows={sorted}
          questionSets={questionSets}
          on={on}
          startLabel={startLabelFor(roomScreen)}
          currentGameId={currentGameId}
          highlightId={done && done.gameId ? done.gameId : null}
          highlightWord={done && done.verb === 'saved' ? 'Just saved' : 'Just created'}
          flagLatest
          controls
          label="Your sessions"
          idPrefix="shist"
          emptyText="No sessions yet. Create one and it will appear here."
        />
      </div>
      {/* LIKE LAST TIME (A7): what Start will do, and the one-off way round it. */}
      {offersMode ? (
        <p className="shist__mode" data-testid="shist-mode">
          <Icon name="CheckCircle" weight="fill" size={16} color="currentColor" />
          <span><b>{START_WORDS.likeLast(roomScreen)}</b> {START_WORDS.likeLastLine(roomScreen)}</span>
          {roomScreen === 'two' && typeof onRoomScreen === 'function' ? (
            <button type="button" className="shist__mode-switch" onClick={() => onRoomScreen('classic')}>{START_WORDS.oneThisTime}</button>
          ) : null}
        </p>
      ) : null}
    </div>
  );
}
