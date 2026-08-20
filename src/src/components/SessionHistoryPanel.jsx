import React, { useMemo, useState } from 'react';
import './SessionHistoryPanel.css';
import Icon from './Icon';
import SetImageBadge from './SetImageBadge';
import { formatWhen, countOrDash } from '../config/tableCells';
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
 */
export function rowActions(session) {
  return session.started
    ? { start: false, continue: true, report: true, edit: false }
    : { start: true, continue: false, report: false, edit: true };
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
  /** 'select' offers Edit/Start/Continue; 'reports' is the same list, read for reports. */
  mode = 'select',
  /** Only for the has-images badge. Optional — an absent list simply omits it. */
  questionSets = [],
  onCopyPlayerUrl = () => {},
  onInvite = () => {},
  onReport = () => {},
  onOpen = () => {},
  onStart = () => {},
  onEdit = () => {},
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
                <td colSpan={9}>No session matches that search.</td>
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
                      A FIXED 2×2 GRID, deliberately: four buttons in a
                      wrapping flex row broke at a different point per row and
                      read as misaligned twice over. The verbs (Report/Edit,
                      Start/Continue) take the top row because they are why
                      the screen exists; Link and Invite sit beneath them in
                      every row. See .shist__acts in the stylesheet.
                    */}
                    <div className="shist__acts">
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
                          onClick={() => onOpen(session.gameId, title)}
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
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
