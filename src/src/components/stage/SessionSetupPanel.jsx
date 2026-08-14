import React, { useEffect, useMemo, useRef, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import Icon from '../Icon';
import {
  setupPanelTabs, categoryRows, questionsRemaining,
  browserRow, filterBrowserRows, rosterRows,
} from '../../config/setupPanel';
import {
  anonymityApplies, anonymityActive, waitingNamesCaution,
} from '../../config/anonymity';
import { roundSubtitle, hasSummary } from '../../config/sessionHistory';

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

  // Settings
  gameId = '',
  playUrl = '',
  remoteUrl = '',
  joinLinkCopied = false,
  inviteCopied = false,
  onCopyJoinLink = () => {},
  onCopyInvite = () => {},
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
      if (event.key === 'Escape' || event.key === '\\') {
        event.preventDefault();
        onClose();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

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
                          </div>
                          {row.detail && <div className="setup-qb__detail">{row.detail}</div>}
                          <div className="setup-qb__meta">
                            {row.category && <span className="setup-qb__cat">{row.category}</span>}
                            {row.difficulty && <span className="setup-qb__diff">{row.difficulty}</span>}
                            <span className="setup-qb__kind">{row.responseKind}</span>
                          </div>
                        </div>
                        <button
                          type="button"
                          className="setup-qb__use"
                          onClick={() => onSelectQuestion(question)}
                        >
                          {row.used ? 'Ask again' : 'Ask next'}
                        </button>
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

              <h3 className="setup-h">Display</h3>
              <label className="setup-field">
                <span>Display profile</span>
                <select value={profile} onChange={(e) => onProfileChange(e.target.value)}>
                  {DISPLAY_PROFILES.map(([value, label]) => (
                    <option key={value} value={value}>{label}</option>
                  ))}
                </select>
              </label>
              <div className="setup-row">
                <button type="button" onClick={onViewReports}>Session report</button>
              </div>

              <h3 className="setup-h">Players join at</h3>
              <p className="setup-url">{playUrl}</p>
              {gameId && <p className="setup-note">{`Session code ${gameId}`}</p>}
              <div className="setup-row">
                <button type="button" onClick={onCopyJoinLink}>
                  {joinLinkCopied ? 'Copied!' : 'Copy join link'}
                </button>
                {/* A calendar-invite blob, not a url — distinct from the link
                    above, and the mockup only drew the link. */}
                <button type="button" onClick={onCopyInvite}>
                  {inviteCopied ? 'Copied!' : 'Copy Invite'}
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
                <button type="button" onClick={onShowHowToPlay}>Show how this works on the stage →</button>
                <button type="button" onClick={onSwitchGame}>Switch game</button>
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
