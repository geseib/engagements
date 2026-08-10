import React from 'react';
import './auth.css';

/**
 * The shell every authentication surface sits in, and the glyphs they share.
 *
 * Ported from docs/design/entry-redesign/_build/shell.py — the same top strip,
 * footer and icon set the eight mockups are drawn with. It exists as a
 * component rather than as copy-paste because eight surfaces sharing a header
 * by convention is eight surfaces that drift.
 *
 * The glyphs are drawn here rather than pulled from the Icon component because
 * they are 22x22 two-pixel strokes sized by CSS (`.au-ico`), and an inline SVG
 * with no intrinsic size fills its container — which is how a Google mark once
 * rendered 300px tall on this very screen.
 */

const stroke = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round',
  'aria-hidden': true,
  viewBox: '0 0 24 24',
  className: 'au-ico',
};

export const AlertIcon = () => (
  <svg {...stroke}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7.5v5.5" />
    <circle cx="12" cy="16.6" r="1.1" fill="currentColor" stroke="none" />
  </svg>
);

export const ClockIcon = () => (
  <svg {...stroke}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5.4l3.4 2" />
  </svg>
);

export const CheckIcon = () => (
  <svg {...stroke} strokeWidth={2.2} strokeLinejoin="round">
    <path d="M4.5 12.6l4.6 4.6L19.5 6.8" />
  </svg>
);

export const LockIcon = () => (
  <svg {...stroke}>
    <rect x="4.5" y="10.5" width="15" height="10" rx="2.2" />
    <path d="M8.2 10.5V7.6a3.8 3.8 0 0 1 7.6 0v2.9" />
  </svg>
);

/** The provider mark. Fixed 18x18 — it is the one glyph that is not currentColor. */
export const GoogleMark = () => (
  <svg className="au-ico" viewBox="0 0 18 18" aria-hidden="true">
    <path fill="#4285F4" d="M16.51 8H8.98v3h4.3c-.18 1-.74 1.48-1.6 2.04v2.01h2.6a7.8 7.8 0 0 0 2.38-5.88c0-.57-.05-.66-.15-1.18Z" />
    <path fill="#34A853" d="M8.98 17c2.16 0 3.97-.72 5.3-1.94l-2.6-2.01a4.8 4.8 0 0 1-2.7.75 4.92 4.92 0 0 1-4.64-3.4H1.73v2.08A8.02 8.02 0 0 0 8.98 17Z" />
    <path fill="#FBBC05" d="M4.34 10.4a4.9 4.9 0 0 1 0-3.12V5.2H1.73a8.08 8.08 0 0 0 0 7.28l2.6-2.08Z" />
    <path fill="#EA4335" d="M8.98 3.58c1.32 0 2.5.45 3.44 1.35l2.54-2.54A7.72 7.72 0 0 0 8.98 1a8.02 8.02 0 0 0-7.25 4.47l2.6 2.08c.6-1.83 2.35-3.4 4.65-3.4Z" />
  </svg>
);

export const Spinner = ({ size = 40 }) => (
  <div className="au-spin">
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d="M12 3.2a8.8 8.8 0 1 0 8.8 8.8" />
      <animateTransform
        attributeName="transform"
        type="rotate"
        from="0 12 12"
        to="360 12 12"
        dur="0.95s"
        repeatCount="indefinite"
      />
    </svg>
  </div>
);

function envLabel() {
  const hostname = (window.location && window.location.hostname) || '';
  if (hostname.includes('.dev.')) return 'dev';
  if (hostname.includes('.test.')) return 'test';
  return '';
}

/**
 * `back` is the one route out of an auth surface that is not an auth surface.
 * On sign-in it is "Join a session instead" — the participant escape hatch,
 * which was one dead sentence in the footer and is now a real link at top left
 * where a back affordance belongs, on the screen most likely to be reached by
 * mistake.
 */
export default function AuthChrome({ back, children }) {
  const env = envLabel();

  // `data-theme="dark"` is not decoration. public/index.html puts
  // data-theme="light" on <html>, so --bg is warm paper everywhere by default;
  // this attribute is the documented mechanism (styles.css:54-62) for a
  // container to re-enter the dusk set, and it is what WelcomeScreen uses.
  // Without it every colour on this page resolves against the paper theme and
  // the measured contrast in auth.css is measuring the wrong pairs.
  return (
    <div className="au-page" data-theme="dark">
      <header className="au-pad">
        <div className="au-top">
          <a className="au-brand" href="/">
            Engagements {env && <span className="au-env">{env}</span>}
          </a>
          {back && (
            <a className="au-back" href={back.href} onClick={back.onClick}>
              &larr; {back.label}
            </a>
          )}
        </div>
      </header>

      <main className="au-grow au-pad">{children}</main>

      <footer className="au-pad">
        <div className="au-foot">
          <nav className="au-footlinks">
            <a href="/privacy">Privacy</a>
            <a href="/terms">Terms</a>
          </nav>
        </div>
      </footer>
    </div>
  );
}
