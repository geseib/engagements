import React, { useCallback, useEffect, useMemo, useState } from 'react';
import './RemoteSessionPanel.css';
import Icon from './Icon';
import RemoteQuestionBrowser from './RemoteQuestionBrowser';
import { remotePanelTabs, rosterListing } from '../config/hostRemote';
import { roundsFrom, roundSubtitle, hasSummary } from '../config/sessionHistory';
import { displayLabelFor } from '../config/anonymity';
import { authFetch } from '../auth/authFetch';

/**
 * THE SESSION TAB, ON A PHONE.
 *
 *   *"it no longer list the players that joined in the beginning, it would be
 *    nice if it had the same menu as the main screen with listing the players,
 *    the rounds, the questions. can this just be a mobile friendly version of
 *    the session tab?"*
 *
 * Yes — and "mobile friendly version" is taken literally in one direction and
 * refused in the other. The DATA is the desktop panel's, function for function:
 * `rosterListing` composes `config/setupPanel.js:rosterRows`, the rounds come
 * from `config/sessionHistory.js:roundsFrom` — the same normaliser
 * `components/stage/SessionSetupPanel.jsx` is handed — and the questions ARE
 * `RemoteQuestionBrowser`, which already existed. Nothing here is a second
 * answer to a question one of those modules already answers.
 *
 * The LAYOUT is not the desktop's, because a phone is not a narrow laptop:
 *
 *   NO SCRIM, NO DIALOG, NO FOCUS TRAP. The desktop panel is an overlay on a
 *   projected stage and traps focus so Tab cannot walk onto the dock and
 *   advance a live round. This is a whole screen on a device with no Tab key
 *   and nothing behind it to protect, and a modal here would be a scrim over a
 *   viewport it entirely covers.
 *
 *   THE DOCK IS NOT SPENT ON GETTING BACK. `RemoteQuestionBrowser` used to own
 *   the whole screen and put "Back to the round" in the thumb arc, which cost
 *   the host their advance for as long as they were reading — three lists made
 *   that trade three times as often. So the way back is a 48px control in the
 *   sticky bar, and HostRemote goes on rendering the primary action underneath.
 *   A facilitator can check who is missing and still advance without navigating.
 *
 *   ONE LIST AT A TIME. Three lists stacked is a scroll a host cannot hold in
 *   their head between sentences; tabs are the same shape the desktop uses and
 *   the same shape the phone already uses nowhere else, so they are cheap to
 *   learn once.
 *
 * ROWS, NOT CARDS, for the two read-only lists. `docs/design/AUDIT.md` §4 and
 * the admin RATIONALE §4 both say a list of forty is a wall of cards; a phone
 * makes that worse, not better, because the wall is one column wide.
 */

/** How the rounds list is fetched. See `loadRounds` for why this is a POST. */
const apiBase = () => window.API_BASE || '';

export default function RemoteSessionPanel({
  gameId = '',
  setId = '',
  initialTab = 'players',
  roster = null,
  state = '',
  round = null,
  unaskedCount = null,
  busy = false,
  onAsk = () => {},
}) {
  const [tab, setTab] = useState(initialTab);
  const [rounds, setRounds] = useState([]);
  const [roundsLoading, setRoundsLoading] = useState(false);
  const [openRound, setOpenRound] = useState(null);

  const listing = useMemo(() => rosterListing(roster, state), [roster, state]);

  /**
   * THE ROUNDS PLAYED SO FAR — no new endpoint, for the reason
   * `config/sessionHistory.js` sets out at length: `POST /games/{id}/report`
   * already assembles every round with its question, its ranked answers and its
   * AI summary, and it is already the route that redacts this data correctly.
   * Reimplementing that judgement in a second place is the specific mistake
   * that hid the names and the podium for a whole session.
   *
   * Fetched ON TAB OPEN rather than on a timer, and refetched when the round
   * number changes. The call writes a `REPORT` snapshot row as its last act
   * (one fixed key, so repeats overwrite), which is affordable when a host asks
   * for it and is not something to do every two seconds from a phone.
   */
  const loadRounds = useCallback(async () => {
    if (!gameId) return;
    setRoundsLoading(true);
    try {
      // authFetch, like every other call HostRemote makes: POST /report carries
      // the Cognito authorizer. This panel only ever renders inside HostRemote,
      // which is behind ProtectedRoute, so the token is there to send — and
      // without it the tab would silently show the empty copy below.
      const res = await authFetch(`${apiBase()}games/${gameId}/report`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      if (!res.ok) {
        // A session with no completed round has no report. That is the normal
        // state for the first minutes of every game, not an error worth a red
        // flash on the host's phone — the empty copy below says it in words.
        setRounds([]);
        return;
      }
      setRounds(roundsFrom(await res.json()));
    } catch {
      /* the empty state covers it; the tab can be reopened */
    } finally {
      setRoundsLoading(false);
    }
  }, [gameId]);

  useEffect(() => {
    if (tab === 'history') loadRounds();
  }, [tab, round, loadRounds]);

  const tabs = remotePanelTabs();

  return (
    <div className="hrs">
      <div className="hrs-tabs" role="tablist" aria-label="Session">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            id={`hrs-tab-${t.id}`}
            aria-selected={tab === t.id}
            aria-controls={`hrs-panel-${t.id}`}
            className={`hrs-tab ${tab === t.id ? 'is-active' : ''}`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'players' && (
        <section
          className="hrs-pane"
          role="tabpanel"
          id="hrs-panel-players"
          aria-labelledby="hrs-tab-players"
          /* WHICH SET THIS LIST IS, as a fact in the markup rather than
             something inferred from the heading — RoomMeter.jsx's idiom, and
             its reason: a joined list under a waiting caption is an accusation,
             and that is this feature's failure mode. */
          data-list-kind={listing.kind}
        >
          <h2 className="hrs-heading">{listing.heading}</h2>

          {listing.rows.length === 0 ? (
            /* THE EXIT, NOT A SECOND STATEMENT OF THE COUNT. The heading above
               already says nobody has joined; repeating it here would be one
               fact about one object stated twice in a viewport. What an empty
               room needs is the way to fix it, and on this phone that is one
               tap away on the round view. */
            <p className="hr-hint">
              Go back and open <b>Join code</b> to put the QR in front of the room.
            </p>
          ) : (
            <ul className="hrs-list">
              {listing.rows.map((player) => (
                <li className="hrs-row" key={player.name}>
                  <span className="hrs-rank">{player.rank}</span>
                  <span className="hrs-name">{player.name}</span>
                  <span className="hrs-score">{`${player.score} pts`}</span>
                  {/* The tick is `null` outside ASK and VOTE — nothing is being
                      waited for in a lobby or on a results screen, and a
                      permanently pending timer beside every name would read as
                      a room that never finishes. */}
                  {player.done !== null && (
                    <Icon
                      name={player.done ? 'CheckCircle' : 'Timer'}
                      weight={player.done ? 'fill' : 'bold'}
                      size={18}
                      color={player.done ? 'var(--success)' : 'var(--muted)'}
                    />
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {tab === 'history' && (
        <section
          className="hrs-pane"
          role="tabpanel"
          id="hrs-panel-history"
          aria-labelledby="hrs-tab-history"
        >
          {rounds.length === 0 ? (
            <p className="hr-hint">
              {roundsLoading
                ? 'Reading the rounds…'
                : 'No rounds yet. They appear here once a round has been played.'}
            </p>
          ) : (
            <ul className="hrs-list hrs-rounds">
              {rounds.map((entry, index) => {
                const open = openRound === index;
                return (
                  <li key={entry.number}>
                    <button
                      type="button"
                      className={`hrs-round ${open ? 'is-open' : ''}`}
                      aria-expanded={open}
                      onClick={() => setOpenRound(open ? null : index)}
                    >
                      <span className="hrs-rank">{entry.ordinal}</span>
                      <span className="hrs-round-text">
                        <span className="hrs-round-title">{entry.title}</span>
                        <span className="hrs-round-sub">{roundSubtitle(entry)}</span>
                      </span>
                      {/* Answers the question a host scanning this list
                          actually has — which of these has a summary I can read
                          out — rather than decorating. Same badge, same word as
                          the desktop tab. */}
                      {hasSummary(entry) && <span className="hrs-badge">AI</span>}
                    </button>

                    {/* INLINE, NOT A DIALOG. The desktop opens `PastRound` in a
                        modal over the stage; a modal on a phone covers the tab
                        bar, the bar's way back AND the dock's advance, which is
                        the one thing this panel is shaped to protect. An
                        accordion keeps all three. */}
                    {open && (
                      <div className="hrs-round-body">
                        {entry.detail && <p className="hrs-round-detail">{entry.detail}</p>}
                        {hasSummary(entry) && entry.aiSummary?.summaryText && (
                          <p className="hrs-round-summary">{entry.aiSummary.summaryText}</p>
                        )}
                        {entry.answers.length === 0 ? (
                          <p className="hr-hint">No responses were recorded for this round.</p>
                        ) : (
                          <ol className="hrs-answers">
                            {entry.answers.map((answer, i) => (
                              <li key={answer.answerIndex}>
                                {/* `displayLabelFor` reads the ROW, which is
                                    where create-report.js put its per-round
                                    anonymity decision: a redacted answer simply
                                    has no `playerName`, and this prints
                                    "Response N" for it. Deciding it again here
                                    from the session settings is how the two
                                    answers drift apart. */}
                                <b>{displayLabelFor(answer, i)}</b>
                                <span>{answer.answer}</span>
                              </li>
                            ))}
                          </ol>
                        )}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      )}

      {tab === 'questions' && (
        <section
          className="hrs-pane"
          role="tabpanel"
          id="hrs-panel-questions"
          aria-labelledby="hrs-tab-questions"
        >
          {/* THE BROWSER THAT ALREADY EXISTED, not a second question list. It
              used to own the whole viewport — its own bar, its own dock — which
              is why it is the tab whose chrome had to move rather than the tab
              that had to be written. */}
          <RemoteQuestionBrowser
            setId={setId}
            unaskedCount={unaskedCount}
            busy={busy}
            onAsk={onAsk}
          />
        </section>
      )}
    </div>
  );
}
