import React from 'react';
import './WelcomeScreen.css';

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
  onQuickStart,
  onCreateEngagement,
  onViewHistory,
  onQuestionSets,
  onSignOut,
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

  return (
    <div className="wel-page" data-theme="dark">
      <header className="wel-pad">
        <div className="wel-shell wel-top">
          <span className="wel-brand">
            Engagements {env && <span className="wel-env">{env}</span>}
          </span>

          {currentUser && (
            <div className="wel-who">
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
              {isAdmin && (
                <a className="wel-btn wel-btn-quiet" href="/admin">
                  Admin console
                </a>
              )}
              <button type="button" className="wel-btn wel-btn-quiet" onClick={() => onSignOut?.()}>
                Sign out
              </button>
            </div>
          )}
        </div>
      </header>

      <main className="wel-grow wel-pad wel-main">
        <div className="wel-shell wel-split">

          {/* Starting something is why a host opens this page, so it is first
              in the DOM at every width and the wide column when there is one. */}
          <section className="wel-start">
            <p className="wel-kicker">New session</p>
            <h1>Start an engagement</h1>
            <p className="wel-muted wel-lede">
              Two ways in. Either one puts a four&#8209;digit code on the screen for the
              room to join with.
            </p>

            <div className="wel-stack">
              {/* THE ONE AMBER THING ON THE PAGE. Four full-width buttons of
                  equal weight is what the old card had, and it made the host
                  read all four every time. */}
              <button type="button" className="wel-action is-primary" onClick={() => onCreateEngagement?.()}>
                <span className="wel-action-name">Create engagement</span>
                <span className="wel-action-note">
                  Choose the format, the question set and which categories the room gets.
                </span>
              </button>

              <button type="button" className="wel-action" onClick={() => onQuickStart?.()}>
                <span className="wel-action-name">Quick start</span>
                <span className="wel-action-note">
                  Launch a ready-made set straight into a live room. No decisions to make.
                </span>
              </button>
            </div>
          </section>

          {/* Quieter, but a real column rather than a link in a corner: a host
              who reloaded mid-session needs this findable in one look. */}
          <aside className="wel-resume">
            <p className="wel-kicker">Already running</p>
            <h2>Rejoin a session</h2>

            <form className="wel-codeblock" onSubmit={handleContinue}>
              <label className="wel-label" htmlFor="wel-code">Session code</label>

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

              <button type="submit" className="wel-btn wel-btn-ghost" disabled={!complete}>
                Continue
              </button>
            </form>

            {/* THE TWO THINGS A HOST OWNS BETWEEN SESSIONS.
                Question sets were reachable from exactly one place — the set
                picker inside the create screen — so "fix the typo in the set I
                made last week" meant starting an engagement you did not want.
                It is the same <HostQuestionSetsDialog>; only the door is new.

                Both are OUTLINED now. The history control was `wel-btn-quiet`:
                muted text, no border, pulled 12px left to sit flush — which is
                a link's appearance, and it was read as one.
                *"the button for game histroy should be more obviousd that its a
                button (doesnt need to be bigger though)"* — so the border and
                the text colour change and the metrics do not. */}
            <div className="wel-aside-more">
              <p className="wel-kicker">Your library</p>

              <div className="wel-links">
                <div className="wel-link">
                  <button type="button" className="wel-btn wel-btn-line" onClick={() => onQuestionSets?.()}>
                    Question sets
                  </button>
                  <p className="wel-meta">
                    Make one, rename one, or upload your own — the questions a session asks come
                    from here.
                  </p>
                </div>

                <div className="wel-link">
                  <button type="button" className="wel-btn wel-btn-line" onClick={() => onViewHistory?.()}>
                    Game history
                  </button>
                  <p className="wel-meta">
                    Every session you have run, with its report — and anything you left part-way.
                  </p>
                </div>
              </div>
            </div>
          </aside>

        </div>
      </main>
    </div>
  );
}
