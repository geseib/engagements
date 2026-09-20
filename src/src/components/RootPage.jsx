import React from 'react';
import { navigateTo } from '../auth/navigate';
import { rememberReturnPath } from '../auth/returnPath';
import useJoinCode, { CODE_LENGTH } from '../hooks/useJoinCode';
import './RootPage.css';

/**
 * The signed-out door at `/`.
 *
 * Built from docs/design/entry-redesign/01-root.html (and 03-join-unknown-code
 * for the error state). Two audiences arrive at one URL and almost everything
 * about them differs: a participant is on a phone, once ever, late, being
 * watched, and needs four digits; a host is at a desk, weekly for years, and
 * needs an email and a password. Until this page existed `/` gave the
 * participant a sign-in form for an account they will never have.
 *
 * The DOM order below IS the priority order, at every width. The second column
 * is a media query, not a reordering, so tab order and screen-reader order are
 * correct for free.
 */

function envLabel() {
  const hostname = window.location.hostname || '';
  if (hostname.includes('.dev.')) return 'dev';
  if (hostname.includes('.test.')) return 'test';
  return '';
}

export default function RootPage() {
  const {
    code, note, missing, focused, setFocused, canSubmit, cells,
    handleChange, handlePaste, handleSubmit,
  } = useJoinCode();

  // `/` is the host page for a signed-in user, so remembering it is correct --
  // it is where the OAuth round trip should land, and without it the callback
  // falls back to a hardcoded destination.
  const goToAuth = (destination) => (event) => {
    event.preventDefault();
    rememberReturnPath();
    navigateTo(destination);
  };

  const env = envLabel();

  return (
    <div className="entry-page">
      <header className="entry-pad">
        <div className="entry-shell entry-top">
          <a className="entry-brand" href="/">
            Engagements {env && <span className="entry-env">{env}</span>}
          </a>
        </div>
      </header>

      <main className="entry-grow entry-pad entry-main">
        <div className="entry-shell entry-split">

          {/* Join first in the DOM at every width. */}
          <section className="entry-join">
            <p className="entry-kicker">Join a session</p>
            <h1>Enter the 4&#8209;digit code</h1>
            {!missing && (
              <p className="entry-muted" style={{ marginTop: '12px', maxWidth: '32ch' }}>
                It is on the screen at the front of the room.
              </p>
            )}

            <form
              className="entry-codeblock"
              style={{ marginTop: missing ? '22px' : '24px' }}
              onSubmit={handleSubmit}
            >
              <label
                className="entry-label"
                htmlFor="entry-code"
                style={{ display: 'block', marginBottom: '9px' }}
              >
                Session code
              </label>

              <div
                className={[
                  'entry-codewrap',
                  focused ? 'is-focused' : '',
                  missing ? 'is-bad' : '',
                ].filter(Boolean).join(' ')}
              >
                <div className="entry-cells" aria-hidden="true">
                  {cells.map((index) => (
                    <div
                      key={index}
                      className={[
                        'entry-cell',
                        code[index] ? 'is-filled' : '',
                        index === code.length ? 'is-next' : '',
                      ].filter(Boolean).join(' ')}
                    >
                      {code[index] || ''}
                    </div>
                  ))}
                </div>
                <input
                  id="entry-code"
                  name="code"
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  maxLength={CODE_LENGTH}
                  autoComplete="off"
                  autoCorrect="off"
                  spellCheck="false"
                  // Declarative, so each platform does the right thing: Chrome
                  // on Android raises the keyboard, iOS Safari declines without
                  // a gesture. A script forcing focus would fight both.
                  autoFocus
                  aria-label="Session code, 4 digits"
                  value={code}
                  onChange={handleChange}
                  onPaste={handlePaste}
                  onFocus={() => setFocused(true)}
                  onBlur={() => setFocused(false)}
                />
              </div>

              <p className="entry-hint" role="status" aria-live="polite">{note}</p>

              <button
                type="submit"
                className="entry-btn entry-btn-primary"
                style={{ marginTop: '14px' }}
                disabled={!canSubmit}
              >
                {missing ? 'Try again' : 'Join'}
              </button>
            </form>

            {missing ? (
              <div
                className="entry-notice entry-codeblock"
                role="alert"
                style={{ marginTop: '18px' }}
              >
                <svg
                  className="entry-ico"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  aria-hidden="true"
                >
                  <circle cx="12" cy="12" r="9" />
                  <path d="M12 7.5v5.5" />
                  <circle cx="12" cy="16.6" r="1.1" fill="currentColor" stroke="none" />
                </svg>
                <div className="entry-notice-body">
                  {/* The server returns one 404 for a typo, an ended session, a
                      deleted session and a TTL expiry. It cannot tell them
                      apart, so this copy must not pretend to. */}
                  <h3>Nothing is running under {missing}</h3>
                  <p>
                    Codes are different for every session, and they stop working once a
                    session ends. Check the screen at the front of the room, or ask your
                    host to read it out.
                  </p>
                </div>
              </div>
            ) : (
              <p
                className="entry-meta entry-phoneonly"
                style={{ marginTop: '18px', maxWidth: '40ch' }}
              >
                Scanning the QR code on screen skips this step. No account, no app.
              </p>
            )}
          </section>

          {/* Quiet, but a real column -- not a link in a corner. A host signs in
              a few hundred times and needs this findable; a participant sees
              this page once, under time pressure, while a room waits. */}
          <aside className="entry-host">
            <p className="entry-kicker">Running a session</p>
            <h2>Host sign in</h2>
            <p
              className="entry-muted"
              style={{ marginTop: '10px', fontSize: 'var(--entry-t-label)', maxWidth: '34ch' }}
            >
              For people who create and run sessions.
            </p>
            <div className="entry-stack" style={{ marginTop: '18px' }}>
              <a
                className="entry-btn entry-btn-ghost"
                href="/auth"
                onClick={goToAuth('/auth')}
              >
                Sign in
              </a>
              <a
                className="entry-btn entry-btn-quiet"
                href="/auth?mode=register"
                onClick={goToAuth('/auth?mode=register')}
              >
                Create a host account
              </a>
            </div>
          </aside>

        </div>
      </main>

      <footer className="entry-pad">
        <div className="entry-shell entry-foot">
          <nav className="entry-footlinks">
            <a href="/privacy">Privacy</a>
            <a href="/terms">Terms</a>
          </nav>
        </div>
      </footer>
    </div>
  );
}
