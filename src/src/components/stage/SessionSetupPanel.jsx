import React, { useEffect, useMemo, useRef, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import Icon from '../Icon';
import {
  setupPanelTabs, categoryRows, questionsRemaining,
  browserRow, filterBrowserRows, rosterRows, departedRows, questionKey,
} from '../../config/setupPanel';
import {
  anonymityApplies, anonymityActive, waitingNamesCaution,
} from '../../config/anonymity';
import { roundSubtitle, hasSummary } from '../../config/sessionHistory';
import { queuePosition } from '../../config/questionQueue';
import QueueList from './QueueList';
import HelpButton from '../HelpButton';

/**
 * Everything the host needs and the room does not, behind one dock button.
 *
 * Built from `docs/design/host-redesign/11-console.html` and
 * `18-question-browser.html` — the mockups own the chrome, the geometry, the
 * type and the copy. What changed is the ORGANISATION: the owner ruled three
 * tabs in place of the mockup's nine-section scroll, so the mockup's content
 * redistributes rather than being redrawn.
 *
 * IT REPLACES BOTH EDGE TABS AND BOTH SIDE PANELS. Owner ruling: *"As much as I
 * like the pull tab, I think they somewhat distract from the game."* Along with
 * them go the how-to-play document (which rendered for only three of five game
 * types — a wavelength or survey host opened it and saw a heading, nothing, and
 * a Sign Out button) and both identity blocks, which printed the signed-in
 * name, email and Administrator badge twice over. THE ROOM MUST NEVER SEE AN
 * EMAIL ADDRESS, and this panel is a surface the room can watch.
 *
 * A SIBLING OF <Stage>, NOT A CHILD, and the geometry is not negotiable:
 * `position: fixed` with `bottom: var(--dock-measured, var(--dock-h, 0px))`,
 * the rule reasoned out at styles.css:400-447. `.stage` is `height:100dvh` and
 * this is an overlay, so mounting it outside the measured subtree is what keeps
 * `useStageFit` from re-entering — a list of unknown length inside the fitter's
 * world drives the scale search to its floor. The dock is a no-overlay zone
 * (audit A6), which is why the offset is `--dock-measured` (the dock outgrows
 * its token: 100px measured against 82.8px at 1280x720 in Table) and not
 * `--dock-h`.
 *
 * IT DOES NOT JOIN `anyOverlayOpen`. The dock's SPACE chip renders exactly when
 * nothing is suppressing, so blanket suppression would make the host watch the
 * affordance blink out while looking at a button that still works — and blanket
 * suppression is what produced the unadvanceable state that rule was written to
 * fix. The narrower hazard is real and handled elsewhere: SPACE landing on a
 * focused button in here would advance the round instead of pressing it, so
 * HostActionBar ignores SPACE whose target is inside `.setup-panel`. THAT CLASS
 * NAME IS LOAD-BEARING — renaming it disables the guard silently.
 *
 * The word "Console" is the internal name for this thing and stays internal.
 */

const FOCUSABLE = 'button:not([disabled]), input:not([disabled]), select:not([disabled]), a[href], [tabindex="0"]';

const DISPLAY_PROFILES = [
  ['room', 'Room — projector'],
  ['tv', 'TV — large panel'],
  ['call', 'Call — screen share'],
  ['table', 'Table — laptop'],
];

export default function SessionSetupPanel({
  onClose = () => {},
  wsConnected = false,

  // Players
  players = [],
  gameState = '',
  playersWhoAnswered = [],
  playersWhoVoted = [],
  /* WHO LEFT, kept out of `players` by get-players.js so that every count the
     host page derives from `players.length` is automatically a count of the
     room rather than a count of the session's history. Passed separately
     because the Players tab is the only place a removal can be undone. */
  removedPlayers = [],
  /* Both host-gated (template-clean.yaml). Defaulted to no-ops so the panel
     stays presentational and mountable without the page — every other action
     on it is wired the same way. */
  onRemovePlayer = () => {},
  onRestorePlayer = () => {},
  onGrantHandover = () => {},

  // Questions — categories
  categories = [],
  categoryCounts = null,
  categoryBitmasks = null,
  activeCategoryIds = new Set(),
  isTogglingCategory = false,
  onToggleCategory = () => {},

  // Questions — the browser
  questions = [],
  loadingQuestions = false,
  usedQuestionIds = [],
  onSelectQuestion = () => {},

  /*
    Questions — THE QUEUE.

    Presentational like everything else on this panel: the list arrives as an
    array of canonical keys and every action goes back out as a prop. The panel
    never fetches and never reorders locally — `GameHostPage` owns the optimistic
    update because it also owns the WebSocket that corrects it, and a second
    optimistic copy in here would fight that one.

    `queueBusyKeys` names the rows with a request in flight, so a host cannot
    press ↑ three times on a 200ms round trip and send three ops for one intent.
  */
  questionQueue = [],
  queueBusyKeys = [],
  upNext = [],
  /* Queue entries the plan cannot serve right now (not in this set, no
     reachable category), straight from GET /up-next. QueueList turns each
     into a visible "parked" tag on the row the host already sees. */
  upNextBlocked = [],
  /* Served-but-labeled one-offs (category off) and the host's veto list —
     the other two GET /up-next projections QueueList renders. */
  upNextAdvisories = [],
  upNextExcluded = [],
  onQueueQuestion = () => {},
  onQueueMove = () => {},
  onQueueRemove = () => {},
  /* Rearranging an AUTO row — materialises the displayed plan into the queue
     and applies the move. The semantics and the ops live in
     config/questionQueue.js:materializePlanOps. */
  onAutoMove = () => {},
  /* The disable/restore pair for the per-session veto list. */
  onDisableQuestion = () => {},
  onRestoreQuestion = () => {},

  // Settings
  gameId = '',
  playUrl = '',
  remoteUrl = '',
  joinLinkCopied = false,
  onCopyJoinLink = () => {},
  onInvite = () => {},
  /*
    Silence this panel's own document-level keydown while a dialog it opened is
    on screen. That handler answers Escape AND `\` unconditionally, and it is
    hand-rolled, so `Modal`'s topmost-by-DOM-containment logic cannot see it —
    without this, Escape inside the invite dialog closes the dialog and the
    panel underneath it, and `\` types a backslash nowhere while toggling the
    panel shut.
  */
  suppressKeys = false,
  onShowJoinCode = () => {},
  profile = 'room',
  onProfileChange = () => {},

  // Settings — the two name decisions the owner moved out of the code.
  //
  // BOTH ARE SESSION-LEVEL AND NEITHER HAS A PER-ROUND OVERRIDE: *"Just leave
  // the decision to the host."* `anonymousUntilReveal` is not a new flag — it
  // is the per-game flag chosen at setup (config/anonymity.js's
  // createPayloadFor), read back by get-game.js, surfaced here so a host can
  // change their mind mid-session. The checkbox below is its inverse, because
  // the host-facing question is "show the names?" and the stored flag is
  // "withhold them?".
  //
  // `profile` IS NOT AN INPUT TO EITHER, and that is a ruling rather than an
  // oversight: *"Don't use screen type for name reveal decision. I often have a
  // projector with a team of four."* A display profile is not a proxy for room
  // size, audience or sensitivity. Nothing in this section may read it.
  gameType = '',
  anonymousUntilReveal = true,
  onAnonymousUntilRevealChange = () => {},
  nameWaitingWhenAnonymous = true,
  onNameWaitingChange = () => {},
  /* AUTO-MODE — the session advances itself when everyone has responded,
     paging through responses and Workie prose at reading pace first. The
     decisions live in config/autoMode.js and the timer in GameHostPage; this
     panel only renders the switch, presentational by the same rule as
     everything else here. */
  autoMode = false,
  onAutoModeChange = () => {},
  // The round's response count and reveal state — the caution's quantity, never
  // a threshold that decides anything. See config/anonymity.js's
  // MIN_ANONYMOUS_ANSWERS for what this used to gate.
  answerCount = 0,
  authorsRevealed = false,
  onViewReports = () => {},
  onShowHowToPlay = () => {},
  onSwitchGame = () => {},
  onSignOut = () => {},
  // Whether to offer the Admin link at all. Derived by the page from the
  // signed-in user's Cognito groups, not read here, so the panel stays a
  // presentational component with no auth dependency — GameHostPage is the
  // only thing that can reach `useAuth`.
  isAdmin = false,
  issueControl = null,
  /* The rounds played so far, already normalised by config/sessionHistory.js.
     Props rather than a fetch: this panel is presentational by rule, and the
     page owns the request — the same reason `isAdmin` arrives as a prop rather
     than from a `useAuth` call in here. */
  rounds = [],
  historyLoading = false,
  onOpenRound = () => {},
}) {
  const [tab, setTab] = useState('players');
  const [search, setSearch] = useState('');
  const [filterCategory, setFilterCategory] = useState('');
  const [unaskedOnly, setUnaskedOnly] = useState(false);
  /* "a button that has enabled categories only" — see filterBrowserRows. */
  const [enabledOnly, setEnabledOnly] = useState(false);

  const panelRef = useRef(null);
  // Where focus came from, so it can go back. A keyboard host who opens this
  // and closes it must not be dropped at the top of the document mid-session.
  const openerRef = useRef(null);

  useEffect(() => {
    openerRef.current = document.activeElement;
    return () => {
      const opener = openerRef.current;
      if (opener && typeof opener.focus === 'function' && document.contains(opener)) {
        opener.focus();
      }
    };
  }, []);

  // Esc and `\` both close, because `\` is what opened it.
  useEffect(() => {
    const onKeyDown = (event) => {
      // A dialog this panel opened is on top. This listener is on `document`
      // and hand-rolled, so `Modal`'s topmost-by-containment check cannot see
      // it — without this bail, one Escape closes the dialog AND the panel
      // under it, and `\` shuts the panel out from under an open dialog.
      if (suppressKeys) return;
      if (event.key === 'Escape' || event.key === '\\') {
        event.preventDefault();
        onClose();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose, suppressKeys]);

  /**
   * Focus stays inside while it is open. Without this, Tab walks out of the
   * panel and onto the dock's primary action, where the next Space or Enter
   * advances a live round the host was still setting up.
   */
  const trapFocus = (event) => {
    if (event.key !== 'Tab') return;
    const panel = panelRef.current;
    if (!panel) return;
    const focusables = Array.from(panel.querySelectorAll(FOCUSABLE));
    if (focusables.length === 0) return;
    const firstEl = focusables[0];
    const lastEl = focusables[focusables.length - 1];

    if (event.shiftKey && document.activeElement === firstEl) {
      event.preventDefault();
      lastEl.focus();
    } else if (!event.shiftKey && document.activeElement === lastEl) {
      event.preventDefault();
      firstEl.focus();
    }
  };

  const roster = rosterRows({ players, gameState, playersWhoAnswered, playersWhoVoted });
  const departed = departedRows(removedPlayers);

  const catRows = useMemo(
    () => categoryRows({ categories, categoryCounts, categoryBitmasks, activeCategoryIds }),
    [categories, categoryCounts, categoryBitmasks, activeCategoryIds],
  );
  const remaining = questionsRemaining(catRows);

  // The projection is what reaches the DOM; the original is what goes back to
  // the caller. Keeping them paired here is what lets `Ask next` hand
  // `selectQuestion` a question the next-question endpoint will accept while
  // the row on screen carries no answer.
  /*
    WHICH CATEGORIES ARE ON, derived from the rows the chips above already use
    so the tag and the chip can never disagree.

    `null` when there is nothing live to read — before a game starts there are
    no masks — because `browserRow` treats an absent set as "cannot tell" rather
    than "everything is off". Passing an empty Set instead would mark every
    question in the set disabled on the setup screen.
  */
  const activeCategoryNames = useMemo(() => {
    if (!catRows.length) return null;
    return new Set(catRows.filter((r) => r.enabled).map((r) => r.name));
  }, [catRows]);

  // The projection is what reaches the DOM; the original is what goes back to
  // the caller. Keeping them paired here is what lets `Ask next` hand
  // `selectQuestion` a question the next-question endpoint will accept while
  // the row on screen carries no answer.
  const rows = useMemo(
    () => questions.map((question) => ({
      row: browserRow(question, {
        usedIds: usedQuestionIds, activeCategories: activeCategoryNames,
      }),
      question,
    })),
    [questions, usedQuestionIds, activeCategoryNames],
  );
  /*
    THE ROWS WITH A QUEUE REQUEST IN FLIGHT, canonicalised through the SAME
    `questionKey` the queue itself uses. Both spellings of a question id are on
    the wire — `QUESTION#c005#001` from `get-question.js` and the bare form from
    the browsing endpoint — so a raw Set membership test would leave the button
    live on exactly the surface that spells it the other way, which is the fault
    that killed the "Unasked only" filter for its whole life (setupPanel.js:154).
  */
  const queueBusy = useMemo(
    () => new Set(queueBusyKeys.map((key) => questionKey(String(key)))),
    [queueBusyKeys],
  );

  const visible = useMemo(() => {
    const filtered = filterBrowserRows(rows.map((r) => r.row), {
      search, category: filterCategory, unaskedOnly, enabledOnly,
    });
    const keep = new Set(filtered.map((r) => r.id));
    return rows.filter(({ row }) => keep.has(row.id));
  }, [rows, search, filterCategory, unaskedOnly, enabledOnly]);

  return (
    <>
      <div className="setup-panel-scrim" onClick={onClose} aria-hidden="true" />
      {/* Wide only on Questions. `18-question-browser.html` renders the panel
          as `console console--wide` for exactly this screen: a question's text
          wraps rather than truncating, so at the default 44vw a long prompt
          became a five-line row and comparing two of them meant scrolling.
          The other two tabs are short rows that would sit in an empty column,
          and every pixel of panel is a pixel of projected stage the room
          loses. */}
      <aside
        className={`setup-panel${tab === 'questions' ? ' setup-panel--wide' : ''}`}
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="Session setup"
        onKeyDown={trapFocus}
      >
        <div className="setup-panel__header">
          <h2 className="setup-panel__title">Session setup</h2>
          {/* THE FIRST THING A HOST LOOKS AT WHEN THE ROOM STOPS UPDATING, so
              it is in the header rather than behind a tab. It is also the only
              WebSocket status anywhere on the host page. The `useWebSocket ===
              false` polling branch that used to sit beside it is gone:
              `useWebSocket` has been hardcoded true since the polling loop was
              removed, so the branch was an unreachable second answer. */}
          <span
            className={`setup-panel__ws ${wsConnected ? 'connected' : 'connecting'}`}
            aria-live="polite"
          >
            <Icon
              name={wsConnected ? 'Broadcast' : 'WifiSlash'}
              weight="bold"
              size={15}
              color={wsConnected ? 'var(--success)' : 'var(--muted)'}
            />
            {wsConnected ? ' Connected' : ' Connecting…'}
          </span>
          {/*
            THE HOST GUIDES, IN THE HEADER.

            The first version of this put it in the Settings tab, under a
            "Session" heading — the FOURTH tab, the FIFTH block down. That is
            not an entry point, it is a hiding place, and the owner's report
            was "i dont see the help anywhere". A control nobody can find is
            the same as the placeholder screens this whole change removed.

            Beside Close because the header is the one part of this panel that
            is on screen whichever tab is open, and because help and close are
            the two things you reach for when you are lost. It is NOT on the
            dock: the dock faces the room, and the room does not need this.

            `onShowHowToPlay` stays where it is in Settings and is a different
            thing — that one puts an explanation on the PROJECTOR for everyone
            to read. This one is documentation on the host's own screen.
          */}
          <HelpButton
            section="host"
            variant="inline"
            size="small"
            tooltip="Host guides"
            className="setup-panel__help"
          />
          <button
            type="button"
            className="setup-panel__close"
            onClick={onClose}
            aria-label="Close setup"
          >
            ✕
          </button>
        </div>

        <div className="setup-panel__tabs" role="tablist" aria-label="Session setup sections">
          {setupPanelTabs().map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              id={`setup-tab-${t.id}`}
              aria-selected={tab === t.id}
              aria-controls={`setup-panel-${t.id}`}
              className={`setup-panel__tab ${tab === t.id ? 'is-active' : ''}`}
              onClick={() => setTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="setup-panel__body">
          {tab === 'players' && (
            <section
              className="setup-players"
              role="tabpanel"
              id="setup-panel-players"
              aria-labelledby="setup-tab-players"
            >
              {/* EVERY PLAYER, IN SCORE ORDER — the owner's ruling, against a
                  design review that wanted this on the phone. His reason:
                  "the anonymity is just for preventing people voting for an
                  answer based on who said it. thats it." config/anonymity.js
                  already argues the same position, and get-results.js sets
                  AuthorsRevealed unconditionally on entering RESULTS, so there
                  is no state in which a cumulative total attributes an
                  unrevealed answer. */}
              {roster.length === 0 ? (
                <p className="setup-empty">Nobody has joined yet.</p>
              ) : (
                <>
                  <h3 className="setup-h">{`${roster.length} player${roster.length === 1 ? '' : 's'}`}</h3>
                  <ul className="setup-roster">
                    {roster.map((player) => (
                      <li
                        key={player.name}
                        className="setup-roster__row"
                        data-testid="roster-row"
                        data-done={player.done === null ? undefined : String(player.done)}
                      >
                        <span className="setup-roster__rank">{player.rank}</span>
                        <span className="setup-roster__name" data-testid="roster-name">{player.name}</span>
                        <span className="setup-roster__score" data-testid="roster-score">{`${player.score} pts`}</span>
                        {player.done !== null && (
                          <Icon
                            name={player.done ? 'CheckCircle' : 'Timer'}
                            weight={player.done ? 'fill' : 'bold'}
                            size={16}
                            color={player.done ? 'var(--success)' : 'var(--muted)'}
                          />
                        )}
                        {/* THE HOST'S TWO DECISIONS ABOUT THIS PERSON.
                            `margin-left: auto` on the group, never
                            `justify-content: flex-end` — hard rule 9: flex-end
                            inside a clipped cell overflows towards the START,
                            where a hidden overflow is unreachable. */}
                        <span className="setup-roster__acts">
                          {/* THE STATE IS PRINTED, NOT COLOURED. This panel is
                              read on a projector that has lifted the black
                              point and by hosts who cannot rely on hue, so
                              "asking" and "unlocked" are words. */}
                          {player.handoverRequested && !player.handoverOpen && (
                            <span className="setup-roster__flag" data-testid="handover-flag">
                              asking to take this name
                            </span>
                          )}
                          {player.handoverOpen && (
                            <span className="setup-roster__flag" data-testid="handover-flag">
                              unlocked for one handover
                            </span>
                          )}
                          {/* One button whose MEANING changes with the ask,
                              not two buttons one of which is usually inert.
                              Bound when somebody asked (only they can spend
                              it); open when the host is acting on something
                              said out loud, which is the commoner case in a
                              real room. */}
                          <button
                            type="button"
                            className="setup-roster__act"
                            onClick={() => onGrantHandover(player.name, player.handoverRequested)}
                            title={player.handoverRequested
                              ? `Let the person who asked take over "${player.name}" — once`
                              : `Unlock "${player.name}" so one other device can take it — once`}
                          >
                            {player.handoverRequested ? 'Let them take it' : 'Unlock name'}
                          </button>
                          <button
                            type="button"
                            className="setup-roster__act"
                            onClick={() => onRemovePlayer(player.name)}
                            title={`Take "${player.name}" out of the live counts. Their answers and points stay in the report.`}
                          >
                            Remove
                          </button>
                        </span>
                      </li>
                    ))}
                  </ul>
                </>
              )}

              {/* WHO LEFT. A separate list, below the room, because these
                  people are not in the counts and must not read as though they
                  are — and on screen at all, because this is the only place a
                  removal can be undone.

                  Their points are printed for the same reason: a row showing
                  "0 pts" would say removal wipes a score, which is precisely
                  what the design promises it does not do (create-report.js
                  still counts them). */}
              {departed.length > 0 && (
                <>
                  <h3 className="setup-h setup-h--after" data-testid="departed-heading">
                    {`${departed.length} removed from the room`}
                  </h3>
                  <p className="setup-note">
                    Out of the live counts. Their answers, votes and points stay in the session report.
                  </p>
                  <ul className="setup-roster">
                    {departed.map((player) => (
                      <li
                        key={player.name}
                        className="setup-roster__row setup-roster__row--gone"
                        data-testid="departed-row"
                      >
                        <span className="setup-roster__name" data-testid="departed-name">{player.name}</span>
                        <span className="setup-roster__score">{`${player.score} pts`}</span>
                        <span className="setup-roster__acts">
                          <button
                            type="button"
                            className="setup-roster__act"
                            onClick={() => onRestorePlayer(player.name)}
                            title={`Put "${player.name}" back into the live counts`}
                          >
                            Bring back
                          </button>
                        </span>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </section>
          )}

          {tab === 'questions' && (
            <section
              className="setup-questions"
              role="tabpanel"
              id="setup-panel-questions"
              aria-labelledby="setup-tab-questions"
            >
              <h3 className="setup-h">Categories</h3>
              <p className="setup-note" data-testid="questions-remaining">
                {`${remaining} questions remaining`}
              </p>
              {/* The bitmask arithmetic behind these numbers is
                  config/setupPanel.js's, ported from the shipped panel where it
                  existed twice, byte for byte. The mockup drew `7 left · on` as
                  static text; the shipped number moves, and `exhausted` at zero
                  is the thing that stops a host enabling a category which
                  cannot yield a question. */}
              <div className="setup-cats">
                {catRows.map((row) => (
                  <button
                    key={row.name}
                    type="button"
                    data-testid="category-toggle"
                    className={`setup-cat ${row.enabled ? 'selected' : ''} ${row.exhausted ? 'exhausted' : ''}`}
                    onClick={() => onToggleCategory(row)}
                    disabled={isTogglingCategory}
                    aria-pressed={row.enabled}
                    aria-label={`${row.name} — ${row.remaining} left, ${row.enabled ? 'on' : 'off'}`}
                  >
                    <span className="setup-cat__name">{row.name}</span>
                    <span className="setup-cat__count">{`${row.remaining} left`}</span>
                    {/* The state in words, not only in colour. Amber-vs-hollow
                        reads instantly for most people and not at all for a
                        colour-blind host — and this row gets scanned under
                        pressure with a room waiting. `11-console.html` prints
                        it the same way: "Pricing Power · 7 left · on". */}
                    <span className="setup-cat__state">{row.enabled ? 'on' : 'off'}</span>
                  </button>
                ))}
              </div>

              {/*
                THE RUNNING ORDER, ABOVE THE BROWSER THAT FILLS IT.

                This order is the reading order: what is coming up, then where
                to add to it. Putting the queue below a list of sixty questions
                would mean the host scrolls past everything they might add to
                reach the thing that says what they already chose.

                It renders when EMPTY too — see QueueList. A queue that appears
                only once it is in use is a feature that has to be explained
                somewhere else, and the empty line is where the difference
                between Queue and Ask next is stated.
              */}
              <QueueList
                queue={questionQueue}
                questions={questions}
                busyKeys={queueBusyKeys}
                upNext={upNext}
                blocked={upNextBlocked}
                advisories={upNextAdvisories}
                excludedRows={upNextExcluded}
                onMove={onQueueMove}
                onRemove={onQueueRemove}
                onAutoMove={onAutoMove}
                onDisable={onDisableQuestion}
                onRestore={onRestoreQuestion}
              />

              {/* THE BROWSER, AS A SECTION RATHER THAN A MODAL. Until now the
                  only way in was the per-category magnifier, which scoped the
                  fetch to one category — so a host could never see the whole
                  set at once. The chips below filter what is already here. */}
              <h3 className="setup-h">Choose the next question</h3>
              <div className="setup-qb__tools">
                <label className="setup-qb__searchlbl">
                  <span className="setup-visually-hidden">Search titles</span>
                  <input
                    className="setup-qb__search"
                    type="search"
                    placeholder="Search titles…"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                </label>
                <button
                  type="button"
                  className={`setup-chip ${filterCategory === '' ? 'on' : ''}`}
                  onClick={() => setFilterCategory('')}
                >
                  All
                </button>
                {catRows.map((row) => (
                  <button
                    key={row.name}
                    type="button"
                    className={`setup-chip ${filterCategory === row.name ? 'on' : ''}`}
                    onClick={() => setFilterCategory(filterCategory === row.name ? '' : row.name)}
                  >
                    {row.name}
                  </button>
                ))}
                <button
                  type="button"
                  className={`setup-chip ${unaskedOnly ? 'on' : ''}`}
                  aria-pressed={unaskedOnly}
                  onClick={() => setUnaskedOnly((v) => !v)}
                >
                  Unasked only
                </button>
                {/* The complement of the category chips, not one more of them:
                    those pick ONE category, this drops every switched-off one
                    at once. Offered only when there is a live mask to read —
                    before a game starts nothing is switched off, so the button
                    would filter nothing and imply otherwise. */}
                {activeCategoryNames && (
                  <button
                    type="button"
                    className={`setup-chip ${enabledOnly ? 'on' : ''}`}
                    aria-pressed={enabledOnly}
                    onClick={() => setEnabledOnly((v) => !v)}
                  >
                    Enabled only
                  </button>
                )}
              </div>

              {/* The mockup's line, kept verbatim, because it is enforced
                  rather than promised: browserRow is an allow-list and
                  setupPanel.test.js fails if any value in a row equals the
                  question's correct answer. */}
              <p className="setup-qb__privacy">
                <b>Correct answers are not on this screen.</b>{' '}
                The stage is a shared surface in every display profile, so an answer shown
                here is an answer shown to the room. Open the browser on your phone to see them.
              </p>

              {loadingQuestions ? (
                <div className="setup-loading"><span className="spinner" /> Loading questions…</div>
              ) : rows.length === 0 ? (
                <p className="setup-empty">No questions are available for this set.</p>
              ) : (
                <>
                  <p className="setup-qb__count" data-testid="browser-count">
                    {`Showing ${visible.length} of ${rows.length}`}
                  </p>
                  <div className="setup-qb__list">
                    {visible.map(({ row, question }) => (
                      <div
                        key={row.id}
                        className={`setup-qb__row ${row.used ? 'is-used' : ''} ${row.disabled ? 'is-disabled' : ''}`}
                        data-testid="browser-row"
                      >
                        <div className="setup-qb__main">
                          <div className="setup-qb__title">
                            {row.title}
                            {/*
                              TAGS, in the shape the owner pointed at: *"small
                              tags like are used in the admin question sets for
                              active and ai those are nice tags."* Same
                              `qsets-chip` classes as that list, so the two
                              screens read as one product rather than as two
                              takes on a badge.

                              Beside the TITLE, not down in the meta line. The
                              meta line is where `· already asked` used to
                              live, in the same grey as the category and the
                              difficulty — which is why the owner asked for
                              this despite it technically existing. A status
                              worth filtering on is worth seeing at a glance.

                              NOT LITERALLY `.qsets-chip`, and that is not
                              laziness. Those rules read `--qsets-t-floor` and
                              `--qsets-rule-strong`, which are declared on
                              `.qsets` (QuestionSetsPanel.css:52) and exist
                              nowhere else — so the class applied here would
                              render with no border colour and no font size.
                              `.setup-qb__tag` copies the treatment using this
                              panel's own variables.
                            */}
                            {row.used && (
                              <span className="setup-qb__tag setup-qb__tag--asked" title="Already asked this session">
                                Asked
                              </span>
                            )}
                            {row.disabled && (
                              <span className="setup-qb__tag setup-qb__tag--off" title="This category is switched off, so the game will not serve it">
                                Off
                              </span>
                            )}
                            {/*
                              QUEUED, AND WHERE. The position lives in the tag
                              rather than on the button because the button has
                              to say what pressing it DOES — a control reading
                              "Queued #2" that removes on press is the shape
                              that gets pressed by mistake in front of a room.
                              Same pill treatment as Asked and Off, which is
                              the idiom the owner picked out by name.
                            */}
                            {queuePosition(questionQueue, row.id) > 0 && (
                              <span
                                className="setup-qb__tag setup-qb__tag--queued"
                                title="This question is in the running order"
                                data-testid="browser-queued-tag"
                              >
                                {`Queued #${queuePosition(questionQueue, row.id)}`}
                              </span>
                            )}
                          </div>
                          {row.detail && <div className="setup-qb__detail">{row.detail}</div>}
                          <div className="setup-qb__meta">
                            {row.category && <span className="setup-qb__cat">{row.category}</span>}
                            {row.difficulty && <span className="setup-qb__diff">{row.difficulty}</span>}
                            <span className="setup-qb__kind">{row.responseKind}</span>
                          </div>
                        </div>
                        {/*
                          TWO ACTIONS, AND THE DIFFERENCE BETWEEN THEM IS THE
                          FEATURE. `Ask next` interrupts — it puts the question
                          on the room's screen now, which is what the owner
                          described as the old behaviour: *"no matter where you
                          are it forward to that question."* `Queue` does not
                          touch the round in flight.

                          Queue is listed FIRST and Ask next keeps the primary
                          treatment it already had. Queueing is the safe,
                          reversible action and the one a host will reach for
                          most; interrupting the room stays the deliberate one.
                        */}
                        <div className="setup-qb__acts">
                          <button
                            type="button"
                            className="setup-qb__queue"
                            disabled={queueBusy.has(questionKey(String(row.id)))}
                            onClick={() => (
                              queuePosition(questionQueue, row.id) > 0
                                ? onQueueRemove(row.id)
                                : onQueueQuestion(question)
                            )}
                          >
                            {queuePosition(questionQueue, row.id) > 0 ? 'Unqueue' : 'Queue'}
                          </button>
                          <button
                            type="button"
                            className="setup-qb__use"
                            onClick={() => onSelectQuestion(question)}
                          >
                            {row.used ? 'Ask again' : 'Ask next'}
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </section>
          )}

          {tab === 'history' && (
            <section
              className="setup-history"
              role="tabpanel"
              id="setup-panel-history"
              aria-labelledby="setup-tab-history"
            >
              {/*
                THE SESSION REPORT, AT THE TOP OF THE ROUNDS IT REPORTS ON.

                The owner: *"i would like to [move] the report button to the
                rounds page, at the top. as it fits well with that section."*

                It used to sit under "Display" in the Settings tab, between the
                display-profile select and the join links — filed with the
                plumbing, three items away from the only list on this screen it
                describes. The report IS the rounds, read end to end, so it
                belongs above them.

                ABOVE THE LIST RATHER THAN BESIDE THE TAB, because the list is
                what it summarises and a host scanning rounds is exactly the
                host who wants the whole thing. It stays a single row so it
                cannot be mistaken for one of the rounds beneath it.
              */}
              <div className="setup-row setup-history__actions">
                <button type="button" onClick={onViewReports}>Session report</button>
              </div>

              {/*
                THE ROUNDS PLAYED SO FAR. The list is one half of what the owner
                asked for; the arrows inside <PastRound> are the other.

                `rounds` and `onOpenRound` are props rather than a fetch, because
                this panel is presentational by rule — the same rule that keeps
                `isAdmin` a prop rather than a `useAuth` call in here. The page
                owns the request.
              */}
              {rounds.length === 0 ? (
                <p className="setup-empty">
                  {historyLoading
                    ? 'Loading rounds…'
                    : 'No rounds yet. They appear here once a round has been played.'}
                </p>
              ) : (
                <ul className="setup-history__list">
                  {rounds.map((round, i) => (
                    <li key={round.number}>
                      <button
                        type="button"
                        className="setup-history__row"
                        onClick={() => onOpenRound(i)}
                      >
                        <span className="setup-history__num">{round.ordinal}</span>
                        <span className="setup-history__text">
                          <span className="setup-history__title">{round.title}</span>
                          <span className="setup-history__sub">{roundSubtitle(round)}</span>
                        </span>
                        {/* The badge answers the question the host actually has
                            when scanning this list — which of these has a
                            summary I can read out — rather than decorating. */}
                        {hasSummary(round) && (
                          <span className="setup-history__badge" title="Has an AI summary">AI</span>
                        )}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}

          {tab === 'settings' && (
            <section
              className="setup-settings"
              role="tabpanel"
              id="setup-panel-settings"
              aria-labelledby="setup-tab-settings"
            >
              {/* NAMES FIRST, ahead of Display and the join links, because it
                  is the only thing in this tab that changes what the room can
                  learn about a colleague. The rest of the tab is plumbing. */}
              {anonymityApplies(gameType) && (
                <>
                  <h3 className="setup-h">Names</h3>

                  <label className="setup-toggle">
                    <input
                      type="checkbox"
                      data-testid="attribute-authors"
                      checked={anonymousUntilReveal === false}
                      onChange={(e) => onAnonymousUntilRevealChange(!e.target.checked)}
                    />
                    <span>Show who wrote each response</span>
                  </label>
                  <p className="setup-note">
                    Off, the stage labels responses “Response 1”, “Response 2” and names
                    nobody, all session. On, every response carries its author.
                  </p>
                  {/* THE TRADE-OFF, STATED, NOT ENFORCED. The two directions are
                      genuinely not symmetric — one crosses the wire and one does
                      not — and a host standing in front of a room deserves to
                      know which is which BEFORE they press it, rather than
                      afterwards. */}
                  <p className="setup-note">
                    <b>Turning this on shows the names to everyone and cannot be taken back.</b>{' '}
                    Turning it off again takes them off the stage; it does not un-send them.
                  </p>

                  {anonymityActive({ gameType, anonymousUntilReveal }) && (
                    <>
                      <label className="setup-toggle">
                        <input
                          type="checkbox"
                          data-testid="name-waiting"
                          checked={nameWaitingWhenAnonymous !== false}
                          onChange={(e) => onNameWaitingChange(e.target.checked)}
                        />
                        <span>Name who is still waiting</span>
                      </label>
                      <p className="setup-note">
                        The room meter can list who has not responded yet — only while you
                        hover or click it, and never who has.
                      </p>
                      {(() => {
                        const caution = waitingNamesCaution({
                          answerCount, gameType, anonymousUntilReveal, authorsRevealed,
                        });
                        if (!caution) return null;
                        return (
                          <p
                            className={`setup-note${caution.strong ? ' setup-note--warn' : ''}`}
                            data-testid="waiting-caution"
                            data-strong={String(caution.strong)}
                          >
                            {'Naming who is still waiting also names who has answered — the room '
                              + 'can subtract one list from the other. '}
                            {caution.text}
                          </p>
                        );
                      })()}
                    </>
                  )}
                </>
              )}

              {/* PACE, between Names and Display: it changes what the room
                  experiences, not what a colleague can be identified by, so it
                  ranks below Names — but it is not plumbing either. */}
              <h3 className="setup-h">Pace</h3>
              <label className="setup-toggle">
                <input
                  type="checkbox"
                  data-testid="auto-mode"
                  checked={autoMode === true}
                  onChange={(e) => onAutoModeChange(e.target.checked)}
                />
                <span>Auto-advance when everyone has responded</span>
              </label>
              <p className="setup-note">
                Once every player has answered — and voted, on formats that vote — the
                session moves forward on its own after a short beat. Responses and the
                AI summary page through at reading pace before the next round starts.
                Opening anything (a response, the QR, a dialog) pauses it, and your own
                controls always work.
              </p>

              <h3 className="setup-h">Display</h3>
              <label className="setup-field">
                <span>Display profile</span>
                <select value={profile} onChange={(e) => onProfileChange(e.target.value)}>
                  {DISPLAY_PROFILES.map(([value, label]) => (
                    <option key={value} value={value}>{label}</option>
                  ))}
                </select>
              </label>
              {/* "Session report" moved to the top of the Rounds tab, above the
                  list it summarises. It was filed here with the display profile
                  and the join links — plumbing — which is not what it is. */}

              <h3 className="setup-h">Players join at</h3>
              <p className="setup-url">{playUrl}</p>
              {gameId && <p className="setup-note">{`Session code ${gameId}`}</p>}
              <div className="setup-row">
                <button type="button" onClick={onCopyJoinLink}>
                  {joinLinkCopied ? 'Copied!' : 'Copy join link'}
                </button>
                {/* A calendar-invite blob, not a url — distinct from the link
                    above, and the mockup only drew the link. */}
                <button type="button" onClick={onInvite}>
                  {'Invite…'}
                </button>
                <button type="button" onClick={onShowJoinCode}>
                  Put the join code back on the stage
                </button>
              </div>

              {/* THE HOST'S OWN PHONE. The word "join" must not appear in this
                  section: this QR is behind the host sign-in, and shipped once
                  under a "Join In" heading — so a host who told a latecomer to
                  "scan the QR in the panel" sent that player to a login for an
                  account they will never have. The room-facing join QR is the
                  rail's, and has exactly one home. */}
              <section className="setup-remote">
                <h3 className="setup-h">Controls on your phone</h3>
                <QRCodeSVG value={remoteUrl} size={180} />
                <p className="setup-note">
                  Scan with your own phone to run the session from it. You will be asked to sign in.
                </p>
                <p className="setup-url">{remoteUrl}</p>
              </section>

              <h3 className="setup-h">Session</h3>
              <div className="setup-row">
                {/* The host guides used to be here, which is why nobody found
                    them. They are in the panel header now, beside Close. This
                    control is a different thing: it puts an explanation on the
                    PROJECTOR, for the room. */}
                <button type="button" onClick={onShowHowToPlay}>Show how this works on the stage →</button>
                {/*
                  "BACK TO MENU", NOT "EXIT", AND THE DIFFERENCE IS FACTUAL.

                  The owner proposed Exit. The trouble is that this button does
                  not end anything: `handleSwitchGame` resets this page's state
                  and shows the welcome screen, while the SESSION STAYS LIVE on
                  the server, keeps its game id, and is rejoinable through
                  Continue. Nothing here writes ENDED.

                  So Exit would claim a consequence the button does not have,
                  and it would misfire in both directions — a host who wanted to
                  step away might not press it for fear of killing the room's
                  session, and a host who wanted to finish might press it and
                  believe they had. "Back to Menu" names where you land and
                  claims nothing about what happens to the session, which is
                  exactly the amount this button knows.

                  Same label on ENDED's new secondary and on the phone remote,
                  because it is the same act on all three.
                */}
                <button type="button" onClick={onSwitchGame}>Back to Menu</button>
                {/*
                  ADMIN OPENS IN A NEW TAB, AND THAT IS THE WHOLE POINT.

                  `App.jsx` is a `window.location.pathname` switch with no
                  client-side navigation, so navigating here in-place would be
                  a full page load — which tears down the host's WebSocket and
                  the entire in-memory session, mid-round, in front of a room.
                  `target="_blank"` is the only safe shape for this link.

                  `rel="noopener"` because the new tab must not get a handle on
                  this one: `window.opener.location` from an admin tab pointed
                  at the live projector is a foot-gun with no upside.

                  Admins only — `admins` is the group AdminPage's own
                  ProtectedRoute requires, so showing it to a host would be
                  offering a door that opens onto Access Denied.
                */}
                {isAdmin && (
                  <a
                    className="setup-link"
                    href="/admin"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Admin ↗
                  </a>
                )}
                {issueControl}
                <button type="button" onClick={onSignOut}>Sign out</button>
              </div>

              <h3 className="setup-h">Keys</h3>
              <ul className="setup-keys">
                <li><kbd>Space</kbd> or <kbd>→</kbd> advance</li>
                <li><kbd>←</kbd> step back a beat</li>
                <li><kbd>\</kbd> open and close this panel</li>
                <li><kbd>Esc</kbd> close</li>
              </ul>
            </section>
          )}
        </div>
      </aside>
    </>
  );
}
