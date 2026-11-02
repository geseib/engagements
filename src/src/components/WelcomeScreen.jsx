import React from 'react';
import ActiveOrgSwitcher from './ActiveOrgSwitcher';
import HostNotificationsBell from './HostNotificationsBell';
import PendingInvites from './PendingInvites';
import './WelcomeScreen.css';
import HelpButton from './HelpButton';
import { helpFor } from '../config/help/screens';
import BrandMark from './BrandMark';
import WelcomeEvents from './WelcomeEvents';
import Icon from './Icon';
import Button from './ui/Button';
import SessionList from './SessionList';
import { kindOf, kindLabel } from '../config/engagementKinds';
import { formatWhen } from '../config/tableCells';
import {
  LIBRARY_NAME, LIBRARY_SESSIONS_PATH, HOME_PATH, RECENT_COUNT, isRejoinable, recentSessions, rowDate,
} from '../config/sessionRows';
import { hostListHandlers, startLabelFor } from '../config/hostSessionActions';

/**
 * The host's front door: the screen before any session exists.
 *
 * THERE IS NO MOCKUP FOR THIS SURFACE — it is the one screen in the redesign
 * program without one, so it is derived from the shipped system rather than
 * ported. Its closest precedent is `RootPage` (built from
 * docs/design/entry-redesign/01-root.html): a full-page door, dusk field,
 * brand strip, kicker + display heading, and a priority split where the DOM
 * order IS the priority order at every width and the second column is a media
 * query rather than a reordering. This screen is the same job one step later —
 * the same door, now signed in — so it is the same shape.
 *
 * NOT A PANEL, AND THE REASON MATTERS. `.setup-panel` is right where it lives:
 * it is an overlay over a stage the host must keep watching, so a right edge
 * and a scrim are exactly the semantics. Here there is nothing behind. A panel
 * would scrim an empty void, hand the host a 420px column on a 1440px desk,
 * and imply a Close that has nowhere to close to. A door is a page.
 *
 * DUSK VIA THE SYSTEM'S OWN SWITCH. `public/index.html` sets
 * `data-theme="light"` on <html>, so `--bg` is paper everywhere by default.
 * `data-theme="dark"` on this page's root is the documented mechanism for
 * "a big-screen container re-entering dusk under a paper ancestor"
 * (styles.css:57). Every colour below therefore resolves from a token; none is
 * invented. What is gone is the amber PAGE: `--primary` is the one hero
 * accent, and a screen that floods it has nothing left to accent with.
 *
 * A COMPONENT, NOT A ROUTE, and not inline in `GameHostPage`. `App.jsx` is a
 * `window.location.pathname` switch with no history integration, so a route
 * would be a full page load. And `GameHostPage` cannot be mounted in jsdom at
 * all — it dies on the auth provider — so an inline surface is an untestable
 * one. `GameSetupDialog`, `SessionSetupPanel` and `Podium` were extracted for
 * the same reason.
 *
 * THE IDENTITY BLOCK. This is the only one left in the product. The two the
 * panel rewrite deleted were room-facing; this one is not — nobody has joined
 * yet — so a name and an admin badge are fine here. An ADDRESS is not, and
 * `setupPanelCallSite.test.js` plus this component's own test both hold that
 * line. It sits in the top strip, where account chrome lives, rather than
 * glued under the buttons in a grey box.
 *
 * HOME (experience plan 4b, §3.1; the owner's decision 6, 1 Nov 2026). This
 * screen is the host's one home. It holds New (one button), Rejoin (the
 * host's live sessions), the five most recent sessions — rows of the same
 * SessionList that Library & team's Sessions place shows in full, with the
 * same actions — and events. "See all" opens Library & team's Sessions in
 * place. The console is no longer a second home: it is Library & team, and
 * it is called that wherever it is linked.
 */

const CODE_LENGTH = 4;

const digitsOnly = (value) => String(value || '').replace(/\D+/g, '');

function envLabel() {
  const hostname = (typeof window !== 'undefined' && window.location.hostname) || '';
  if (hostname.includes('.dev.')) return 'dev';
  if (hostname.includes('.test.')) return 'test';
  return '';
}

export default function WelcomeScreen({
  currentUser = null,
  continueGameId = '',
  onContinueGameIdChange,
  onContinue,
  onCreateEngagement,
  onReports,
  onQuestionSets,
  onSignOut,
  /** A plain line about why the host is here, e.g. the session they opened no longer exists. */
  notice = '',
  /**
   * The host's sessions (GET /games, merged with events), or null while they
   * load. Home shows the live ones under Rejoin and the newest five below.
   */
  sessions = null,
  /** For each row's set name. Optional. */
  questionSets = [],
  /**
   * What a row's actions do — the page's own callbacks, the shape
   * SessionHistoryPanel takes: { onStart, onEdit, onOpen, onReport,
   * onResults, onInvite, onCopyPlayerUrl, onDelete }.
   */
  rowActions = {},
  /** Where the room watches, remembered (2b): Start says "Start · two screens". */
  roomScreen = null,
  /** Injectable for tests: where a link-like action goes. */
  navigate,
}) {
  const code = digitsOnly(continueGameId).slice(0, CODE_LENGTH);
  const complete = code.length === CODE_LENGTH;
  const env = envLabel();
  const isAdmin = Boolean(currentUser?.groups?.includes('admins'));

  // A code is four digits and nothing else. `maxLength` alone caps the length
  // and admits letters, which is how a pasted "Game 1234" used to arrive at
  // handleContinueGame as "Game" and raise an alert.
  const handleCodeChange = (event) => {
    onContinueGameIdChange?.(digitsOnly(event.target.value).slice(0, CODE_LENGTH));
  };

  const handleContinue = (event) => {
    event.preventDefault();
    if (!complete) return;
    onContinue?.();
  };

  const cells = Array.from({ length: CODE_LENGTH }, (_, index) => index);

  /* ONE SET OF HANDLERS for both Home lists and the full dialog
     (config/hostSessionActions.js), so a row here does what it does there. */
  const on = hostListHandlers({ ...rowActions, roomScreen, ...(navigate ? { navigate } : {}) });
  const loaded = Array.isArray(sessions);
  const live = loaded ? sessions.filter((row) => isRejoinable(row)) : [];
  const recent = loaded ? recentSessions(sessions, RECENT_COUNT) : [];

  return (
    <div className="wel-page" data-theme="dark">
      <header className="wel-pad">
        <div className="wel-shell wel-top">
          {/* THE MARK IS THE WAY HOME, AND HOME IS IN THE APP (experience
              plan 4b; audit E S3). Signed in, that is this screen, `/`; it
              used to leave for the marketing page at /home. Signed out (only
              in tests and previews) there is no Home to go to, so it keeps
              /home. Safe because this screen renders only when no session is
              open — the stage and the player page deliberately do not link
              their brand. */}
          <a className="wel-brand" href={currentUser ? HOME_PATH : '/home'}>
            <BrandMark size={24} />
            Engagements {env && <span className="wel-env">{env}</span>}
          </a>

          {currentUser && (
            <div className="wel-who">
              {/* WHICH ORGANISATION'S SETS AM I ABOUT TO PICK FROM? This screen
                  never said. `GET /question-sets` is scoped by the header the
                  switcher writes, so a host in two teams was choosing from one
                  of them blind, with no way to change it without a trip through
                  the console. It draws nothing at all for somebody with a
                  single space, which is most people. */}
              <ActiveOrgSwitcher />
              {/* THE BELL (owner, 21 Oct 2026): the console's inbox here too.
                  No session is open on this screen, so a click opens in place. */}
              <HostNotificationsBell />
              <span className="wel-who-name">{currentUser.attributes?.name || 'Signed in'}</span>
              {isAdmin && <span className="wel-badge">Administrator</span>}
              {/* THE LINK BACK, WHICH ONLY EXISTED IN ONE DIRECTION.
                  AdminShell has carried a "Host ↗" link since it was written;
                  nothing anywhere on the host side pointed at /admin, so the
                  only way in was to type the URL — on the very screen that
                  prints an "Administrator" badge at you.

                  IN PLACE, not a new tab, and that is the opposite of the
                  console's choice for a reason. Its Host link opens a tab
                  because a second host page is a second host WebSocket, which
                  evicts the projector. There is no session to evict here: this
                  screen renders only when no game is open.

                  A real <a href>, so middle-click and "open in new tab" work.
                  App.jsx routes on pathname, so this is a page load either way
                  and an onClick would only take that choice away. */}
              {/* NOT `isAdmin` ANY MORE. `/admin` used to require the `admins`
                  group and now accepts hosts, because that console is where a
                  host manages their question sets, their team and their plan.
                  Gating the link on staff kept every customer out of the screen
                  built for them. */}
              {/* ONE NAME FOR IT (experience plan 4b): "Library & team" for
                  everyone. It was "Admin console" for staff and "Question
                  sets & team" for everyone else (audit E S2). */}
              {/* The account corner's two are ui/Button, tertiary: text that
                  moves the host elsewhere, never a second main action (5c). */}
              <Button as="a" variant="tertiary" size={36} className="wel-corner" href="/admin">
                {LIBRARY_NAME}
              </Button>
              <Button variant="tertiary" size={36} className="wel-corner" onClick={() => onSignOut?.()}>
                Sign out
              </Button>
              {/* THE ONE `?` ON THIS SCREEN — and until 2026-09-21 there was none.
                  The host guides were reachable only from inside a running
                  session's side panel, and reporting a bug from here meant
                  opening a session first. One button: the guides, report a bug,
                  request a feature, ask for help (HelpButton's `reports`).
                  Last in the row, where the same control sits in the session
                  panel's header and the console's. No session is open on this
                  screen, so a report from here carries no game id. Its guides
                  open at the start screen's own section (Help Phase 3). */}
              <HelpButton
                {...helpFor('host-start')}
                variant="inline"
                size="small"
                tooltip="Help and feedback"
                className="wel-helpbtn"
                reports={{ context: 'host' }}
              />
            </div>
          )}
        </div>
      </header>

      <main className="wel-grow wel-pad wel-main">
        {/*
          ONE FLEX CHILD, ALWAYS.

          `.wel-main` is `display: flex` above 900px, so a SECOND child is a
          second flex item sharing the row. The invitations prompt was added in
          its own `.wel-shell` sibling and — because both carry
          `width: 100%; max-width: 62rem` — the two split the row between them:
          an empty box on the left (PendingInvites renders null when there is
          nothing waiting) and every visible thing shoved into the right half.

          So the shell is the single child and stacks its contents. `.wel-split`
          keeps its own grid inside it, and the invitation prompt sits above the
          split without competing with it for the row.
        */}
        <div className="wel-shell wel-column">
          {/* Above the split because an invitation is time-limited and nothing
              below it is. It draws nothing at all when there is nothing
              waiting, which is almost always. */}
          <PendingInvites />

          {notice && <p className="wel-notice" role="status">{notice}</p>}

          <div className="wel-split">

          {/* NEW, ONE BUTTON, ONE DOOR (experience plan 4c; audit E N1).
              Starting something is why a host opens this page, so it is first
              in the DOM at every width. Quick start, the Build Room and a new
              event used to be doors of their own here, each landing somewhere
              different; all three are inside New engagement now (Quick start
              as its fast lane, Build Room and Event as formats), and every
              one lands on its own Setup or page. */}
          <section className="wel-start">
            <p className="wel-kicker">Home</p>
            <h1>Start an engagement</h1>
            <p className="wel-muted wel-lede">
              Every format puts a four&#8209;digit code on the screen for the room to join with.
            </p>

            <div className="wel-stack">
              {/* THE ONE PRIMARY ON HOME (experience plan §5.1, step 5c): the
                  shared ui/Button in the orange look, its sentence inside. */}
              <Button variant="primary" size={44} className="wel-action" onClick={() => onCreateEngagement?.()}>
                <span className="wel-action-name">New engagement</span>
                <span className="wel-action-note">
                  A session, a survey, a Build Room or an event. In a hurry? Quick start is inside.
                </span>
              </Button>
            </div>
          </section>

          {/* REJOIN: the host's own live sessions, each one press from its
              stage, then a code for anybody else's. A host who reloaded
              mid-session finds it here in one look. */}
          <aside className="wel-resume" aria-labelledby="wel-rejoin-title">
            <p className="wel-kicker">Already running</p>
            <h2 id="wel-rejoin-title">Rejoin</h2>

            {loaded && live.length > 0 && (
              <ul className="wel-live" data-testid="wel-rejoin">
                {live.map((row) => (
                  <li key={row.gameId} className="wel-live-row">
                    <span className="wel-ev-main">
                      <span className="wel-ev-name" title={row.title || 'Untitled session'}>{row.title || 'Untitled session'}</span>
                      <span className="wel-ev-meta">
                        {[kindLabel(kindOf(row)), row.gameId, formatWhen(rowDate(row))].filter(Boolean).join(' · ')}
                      </span>
                    </span>
                    <Button
                      variant="secondary"
                      size={36}
                      className="wel-line"
                      onClick={() => on.continue && on.continue(row)}
                      aria-label={`Rejoin ${row.title || 'the session'}`}
                    >
                      <Icon name="Play" weight="fill" size={14} color="currentColor" /> Rejoin
                    </Button>
                  </li>
                ))}
              </ul>
            )}
            {loaded && live.length === 0 && (
              <p className="wel-meta wel-live-none">Nothing of yours is running right now.</p>
            )}

            <form className="wel-codeblock" onSubmit={handleContinue}>
              <label className="wel-label" htmlFor="wel-code">Or type a session code</label>

              {/* ONE input behind four painted cells — the same idiom the
                  participant meets on RootPage, because it is literally the
                  same four digits. Four real inputs break paste and backspace
                  and read as four unlabelled fields to a screen reader. */}
              <div className={`wel-codewrap${complete ? ' is-complete' : ''}`}>
                <div className="wel-cells" aria-hidden="true">
                  {cells.map((index) => (
                    <div
                      key={index}
                      className={[
                        'wel-cell',
                        code[index] ? 'is-filled' : '',
                        index === code.length ? 'is-next' : '',
                      ].filter(Boolean).join(' ')}
                    >
                      {code[index] || ''}
                    </div>
                  ))}
                </div>
                <input
                  id="wel-code"
                  name="continueGameId"
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  maxLength={CODE_LENGTH}
                  autoComplete="off"
                  autoCorrect="off"
                  spellCheck="false"
                  aria-label="Session code, 4 digits"
                  value={code}
                  onChange={handleCodeChange}
                />
              </div>

              <Button type="submit" variant="secondary" size={44} className="wel-continue" disabled={!complete}>
                Continue
              </Button>
            </form>
          </aside>

          </div>

          {/* RECENT SESSIONS: five rows of the very list Library & team shows
              in full — same row, same actions (experience plan 4a/4b). "See
              all" opens that list, in place. */}
          <section className="wel-recent" aria-labelledby="wel-recent-title">
            <div className="wel-evhead">
              <h2 id="wel-recent-title">Recent sessions</h2>
              <Button as="a" variant="secondary" size={36} className="wel-line" href={LIBRARY_SESSIONS_PATH}>
                See all <span className="wel-meta wel-seeall-in">in {LIBRARY_NAME}</span>
              </Button>
            </div>
            {!loaded && <p className="wel-meta wel-recent-wait">Loading your sessions…</p>}
            {loaded && (
              <SessionList
                rows={recent}
                questionSets={questionSets}
                on={on}
                startLabel={startLabelFor(roomScreen)}
                compact
                label="Recent sessions"
                idPrefix="wel-recent"
                emptyText="No sessions yet. Press New engagement to make your first."
              />
            )}
          </section>

          {/* An organisation's events, each one door to its agenda and stage
              (events, 27 Sep 2026). Draws nothing when there are none. */}
          <WelcomeEvents />

          {/* THE LIBRARY, ONE PRESS AWAY. The sets and saved reports open
              over this screen (the same dialogs as always); the rest of the
              library — the team, the plan, every session — is Library & team. */}
          <section className="wel-library" aria-label="Your library">
            <p className="wel-kicker">Your library</p>
            <div className="wel-library-row">
              <Button variant="secondary" size={36} className="wel-line" onClick={() => onQuestionSets?.()}>
                Question sets
              </Button>
              {onReports && (
                /* Sessions expire a week after they start; a saved report
                   does not. This is where it is found afterwards. */
                <Button variant="secondary" size={36} className="wel-line" onClick={() => onReports()}>
                  Reports
                </Button>
              )}
              <Button as="a" variant="tertiary" size={36} className="wel-corner" href="/admin">{LIBRARY_NAME}</Button>
            </div>
          </section>
        </div>
      </main>
    </div>
  );
}
