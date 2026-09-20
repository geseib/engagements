import React, { useEffect, useState } from 'react';
import { navigateTo } from '../auth/navigate';
import { rememberReturnPath } from '../auth/returnPath';
import './MarketingShell.css';

const LINKS = [
  { id: 'how', label: 'How it works', href: '/how-it-works' },
  { id: 'cases', label: 'Use cases', href: '/use-cases' },
  { id: 'reports', label: 'Reports', href: '/reports' },
  { id: 'help', label: 'Help', href: '/help' },
];

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

export default function MarketingShell({ title, current, children }) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    document.title = title ? `${title} · Engagements` : 'Engagements';
  }, [title]);

  return (
    <div className="mk-root">
      <header className="mk-nav">
        <div className="mk-shell mk-nav-in">
          <a className="mk-brand" href="/">
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
          </nav>

          <div className="mk-nav-acts">
            <button
              type="button"
              className="mk-nav-burger"
              aria-expanded={open}
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
