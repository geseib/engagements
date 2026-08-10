import React, { useEffect, useMemo, useRef, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import Icon from '../Icon';
import {
  setupPanelTabs, categoryRows, questionsRemaining,
  browserRow, filterBrowserRows, rosterRows,
} from '../../config/setupPanel';

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
  onViewReports = () => {},
  onShowHowToPlay = () => {},
  onSwitchGame = () => {},
  onSignOut = () => {},
  issueControl = null,
}) {
  const [tab, setTab] = useState('players');
  const [search, setSearch] = useState('');
  const [filterCategory, setFilterCategory] = useState('');
  const [unaskedOnly, setUnaskedOnly] = useState(false);

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
  const rows = useMemo(
    () => questions.map((question) => ({ row: browserRow(question, { usedIds: usedQuestionIds }), question })),
    [questions, usedQuestionIds],
  );
  const visible = useMemo(() => {
    const filtered = filterBrowserRows(rows.map((r) => r.row), { search, category: filterCategory, unaskedOnly });
    const keep = new Set(filtered.map((r) => r.id));
    return rows.filter(({ row }) => keep.has(row.id));
  }, [rows, search, filterCategory, unaskedOnly]);

  return (
    <>
      <div className="setup-panel-scrim" onClick={onClose} aria-hidden="true" />
      <aside
        className="setup-panel"
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
                        className={`setup-qb__row ${row.used ? 'is-used' : ''}`}
                        data-testid="browser-row"
                      >
                        <div className="setup-qb__main">
                          <div className="setup-qb__title">{row.title}</div>
                          {row.detail && <div className="setup-qb__detail">{row.detail}</div>}
                          <div className="setup-qb__meta">
                            {row.category && <span className="setup-qb__cat">{row.category}</span>}
                            {row.difficulty && <span className="setup-qb__diff">{row.difficulty}</span>}
                            <span className="setup-qb__kind">{row.responseKind}</span>
                            {row.used && <span className="setup-qb__used">· already asked</span>}
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

          {tab === 'settings' && (
            <section
              className="setup-settings"
              role="tabpanel"
              id="setup-panel-settings"
              aria-labelledby="setup-tab-settings"
            >
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
