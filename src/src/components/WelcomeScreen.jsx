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

            <div className="wel-aside-more">
              <button type="button" className="wel-btn wel-btn-quiet" onClick={() => onViewHistory?.()}>
                Game history
              </button>
              <p className="wel-meta">
                Every session you have run, with its report — and anything you left part-way.
              </p>
            </div>
          </aside>

        </div>
      </main>
    </div>
  );
}
