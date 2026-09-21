import React from 'react';
import { render, screen } from '@testing-library/react';

/**
 * THE MARK IS THE WAY HOME — where that is safe.
 *
 * Clicking the mountain and the wordmark goes to the marketing home from every
 * marketing page, from /join, from the host's main screen and from the admin
 * console. It does NOT on the player page or on a live session's stage: one
 * stray tap there takes a participant out of their round or the projector off
 * the session.
 *
 * The destination is `/home`, not `/`. For a signed-in host `/` is the host's
 * main screen (App.jsx RootGate), so a link to `/` from the console would go to
 * the app and never to the marketing page. `/home` always renders it — that
 * half is pinned in marketingRoutes.test.jsx, beside the other public routes.
 */

jest.mock('../auth/navigate', () => ({ navigateTo: jest.fn() }));

import MarketingShell from '../marketing/MarketingShell';

const fs = require('fs');
const path = require('path');
const read = (...p) => fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8');

describe('the mark links home where that is safe', () => {
  test('on every marketing page', () => {
    render(<MarketingShell title="T" current="how"><p>x</p></MarketingShell>);
    expect(screen.getByRole('link', { name: /engagements/i })).toHaveAttribute('href', '/home');
  });

  test('on the host main screen', () => {
    const src = read('components', 'WelcomeScreen.jsx');
    expect(src).toMatch(/<a className="wel-brand" href="\/home"/);
  });

  test('on the admin console', () => {
    const src = read('components', 'AdminShell.jsx');
    expect(src).toMatch(/<a className="adm-home" href="\/home"/);
    expect(read('components', 'AdminShell.css')).toMatch(/\.adm-home\s*\{[^}]*text-decoration:\s*none/);
  });

  test('on /join', () => {
    expect(read('components', 'RootPage.jsx')).toMatch(/<a className="entry-brand" href="\/home"/);
  });

  test('and NOT on the player page or the stage', () => {
    // rejects: a tidy-minded "make every brand a link". A participant mid-round
    // and a projector mid-session must not be one tap from leaving.
    for (const file of [['PlayerPage.jsx'], ['components', 'PlayerSurface.jsx'], ['components', 'stage', 'Stage.jsx'], ['HostRemote.jsx']]) {
      const full = path.join(__dirname, '..', ...file);
      if (!fs.existsSync(full)) continue;
      expect(fs.readFileSync(full, 'utf8')).not.toMatch(/href="\/home"/);
    }
  });
});

describe('signed out — or with no provider at all — the two doors are there', () => {
  test('Sign in and Create a host account, and no "Open the app"', () => {
    // The signed-in half is in marketingShellSignedIn.test.jsx, which has to
    // mock the auth module at the top of its own file.
    render(<MarketingShell title="T" current="home"><p>x</p></MarketingShell>);
    expect(screen.getByRole('link', { name: /^sign in$/i })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /open the app/i })).toBeNull();
  });
});

describe('the favicon is the mountain', () => {
  const html = read('..', 'public', 'index.html');

  test('index.html points at an SVG icon, a PNG fallback and a touch icon — all on this site', () => {
    expect(html).toMatch(/<link rel="icon" type="image\/svg\+xml" href="\/favicon\.svg"/);
    expect(html).toMatch(/<link rel="icon" type="image\/png" sizes="32x32" href="\/favicon-32\.png"/);
    expect(html).toMatch(/<link rel="apple-touch-icon" href="\/apple-touch-icon\.png"/);
    for (const f of ['favicon.svg', 'favicon-32.png', 'apple-touch-icon.png']) {
      expect(fs.existsSync(path.join(__dirname, '..', '..', 'public', f))).toBe(true);
    }
  });

  test('it is the same mark the nav draws, in the same two colours', () => {
    const svg = read('..', 'public', 'favicon.svg');
    const shell = read('marketing', 'MarketingShell.jsx');
    const mark = shell.match(/className="mk-brand-mark"[\s\S]*?<path d="([^"]+)"/)[1];
    expect(svg).toContain(`d="${mark}"`);
    expect(svg).toMatch(/#F6A94C/i);
    expect(svg).toMatch(/#0F1A2E/i);
    expect(svg).not.toMatch(/<script|href=|<image/i);
  });
});
