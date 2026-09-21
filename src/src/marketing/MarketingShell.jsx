import React, { useEffect, useRef, useState } from 'react';
import { navigateTo } from '../auth/navigate';
import { rememberReturnPath } from '../auth/returnPath';
import { useOptionalAuth } from '../auth/AuthContext';
import useScrollProgress from './useScrollProgress';
import RidgeScene from './components/RidgeScene';
import './MarketingShell.css';

const LINKS = [
  { id: 'how', label: 'How it works', href: '/how-it-works' },
  { id: 'cases', label: 'Use cases', href: '/use-cases' },
  { id: 'reports', label: 'Reports', href: '/reports' },
  { id: 'help', label: 'Help', href: '/help' },
];

const NAV_LINKS_ID = 'mk-nav-links';

/**
 * A host who signs in from a brochure page wants their host page, which is `/`.
 * rememberReturnPath() with no argument would record the brochure the host was
 * reading, not the host page they actually want back — see returnPath.js.
 */
export const goToAuth = (destination) => (event) => {
  event.preventDefault();
  rememberReturnPath({ pathname: '/', search: '' });
  navigateTo(destination);
};

class PageBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { failed: false };
  }

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="mk-shell mk-failed" role="alert">
        <h1 className="mk-head">This page could not load.</h1>
        <p className="mk-lead">Reload to try again. Everything else still works:</p>
        <p>
          <a href="/join">Join a session</a>
          {' · '}
          <a href="/auth">Sign in</a>
        </p>
      </div>
    );
  }
}

export default function MarketingShell({ title, current, scene = true, children }) {
  const [open, setOpen] = useState(false);
  // Null outside a provider (the page tests mount this bare), and `loading`
  // counts as signed out: the doors are the safe thing to show for a beat.
  const auth = useOptionalAuth();
  const signedIn = Boolean(auth && !auth.loading && auth.currentUser);
  const progress = useScrollProgress();
  const burgerRef = useRef(null);

  useEffect(() => {
    document.title = title ? `${title} · Engagements` : 'Engagements';
  }, [title]);

  // Escape closes the mobile menu and gives focus back to the control that
  // opened it, the same as HelpPage's role-list toggle. The listener is only
  // attached while the menu is open, so it never intercepts Escape elsewhere
  // on the page (a modal, a form) and is torn down on close/unmount.
  useEffect(() => {
    if (!open) return undefined;
    const onKeyDown = (event) => {
      if (event.key !== 'Escape') return;
      setOpen(false);
      if (burgerRef.current) burgerRef.current.focus();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open]);

  return (
    <div className="mk-root">
      {/*
        The ridge scene, moved here from HomePage so every inner page carries
        it too (mockups 02-05 all draw the identical `.mk-ridge` block as the
        first child of `.mk-root`). It renders OUTSIDE `PageBoundary` below on
        purpose: the scene is decoration (`aria-hidden`, and RidgeScene has its
        own defensive math), so a page crashing should not also lose it, and a
        broken scene is not this boundary's problem to catch — keeping it
        simple beats handling a failure mode nothing here can actually cause.
      */}
      {scene && <RidgeScene progress={progress} />}
      <header className="mk-nav">
        <div className="mk-shell mk-nav-in">
          <a className="mk-brand" href="/home">
            <svg className="mk-brand-mark" viewBox="0 0 32 32" aria-hidden="true">
              <path d="M2 27 L11 13 L16 20 L22 6 L30 27 Z" />
            </svg>
            Engagements
          </a>

          {/*
            The mockup keeps Sign in / Create a host account outside the
            `<nav aria-label="Main">` element, as siblings in `.mk-nav-acts`.
            The behavioural contract requires the nav to CONTAIN both auth
            doors (marketingShell.test.jsx: `nav.toContainElement(...)`), so
            they are nested inside `.mk-nav-links` here instead. The burger
            stays outside, in its own `.mk-nav-acts`, so collapsing the nav at
            narrow widths never hides the control that reopens it.
          */}
          <nav
            id={NAV_LINKS_ID}
            aria-label="Main"
            className={`mk-nav-links${open ? ' mk-nav--open' : ''}`}
          >
            {LINKS.map((link) => (
              <a
                key={link.id}
                className="mk-nav-link"
                href={link.href}
                aria-current={current === link.id ? 'page' : undefined}
              >
                {link.label}
              </a>
            ))}
            {/* A SIGNED-IN HOST IS NOT ASKED TO SIGN IN. The mark on the host's
                main screen and in the console leads here (/home), so somebody
                already inside the app does land on this page — and two doors
                inviting them to sign in or register would read as having been
                signed out. They get the one way back instead. `/` is the app
                for anybody signed in (App.jsx RootGate). */}
            {signedIn ? (
              <a className="mk-btn mk-btn-primary" href="/">Open the app</a>
            ) : (
              <>
                <a className="mk-btn mk-btn-quiet" href="/auth" onClick={goToAuth('/auth')}>
                  Sign in
                </a>
                <a
                  className="mk-btn mk-btn-primary"
                  href="/auth?mode=register"
                  onClick={goToAuth('/auth?mode=register')}
                >
                  Create a host account
                </a>
              </>
            )}
          </nav>

          <div className="mk-nav-acts">
            <button
              ref={burgerRef}
              type="button"
              className="mk-nav-burger"
              aria-expanded={open}
              aria-controls={NAV_LINKS_ID}
              aria-label="Menu"
              onClick={() => setOpen((v) => !v)}
            >
              <svg viewBox="0 0 24 24" aria-hidden="true" fill="none">
                <path d="M4 7h16M4 12h16M4 17h16" />
              </svg>
            </button>
          </div>
        </div>
      </header>

      <main>
        <PageBoundary>{children}</PageBoundary>
      </main>

      <footer className="mk-foot">
        <div className="mk-shell mk-foot-in">
          <span className="mk-foot-legal">Engagements</span>
          <nav className="mk-foot-links" aria-label="Footer">
            <a href="/privacy">Privacy</a>
            <a href="/terms">Terms</a>
            <a href="/help">Help</a>
            <a href="/join">Join with a code</a>
          </nav>
        </div>
      </footer>
    </div>
  );
}
