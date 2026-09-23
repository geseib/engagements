/**
 * The mountain is in every top-left corner, and it is one drawing.
 * Source-level on purpose: five of these six screens need auth, sockets or a
 * router to mount, and the claim being pinned is "this file draws the mark
 * through the shared component", which the source states exactly.
 */
import React from 'react';
import fs from 'fs';
import path from 'path';
import { render, screen } from '@testing-library/react';
import BrandMark, { BRAND_MARK_PATH } from '../components/BrandMark';

const read = (...p) => fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8');

describe('BrandMark', () => {
  it('draws the favicon\'s mountain', () => {
    render(<BrandMark />);
    expect(screen.getByTestId('brand-mark').querySelector('path')).toHaveAttribute('d', BRAND_MARK_PATH);
    expect(read('..', 'public', 'favicon.svg')).toContain(BRAND_MARK_PATH);
    expect(read('marketing', 'MarketingShell.jsx')).toContain(BRAND_MARK_PATH);
  });

  it('is decoration beside a wordmark, and never a link of its own', () => {
    const { container } = render(<BrandMark />);
    expect(screen.getByTestId('brand-mark')).toHaveAttribute('aria-hidden', 'true');
    // rejects: the mark growing an href, which would put a way out of a live
    // round on the session panel and the player bar.
    expect(container.querySelector('a')).toBeNull();
  });

  it.each([
    ['components/AdminShell.jsx'],
    ['components/WelcomeScreen.jsx'],
    ['components/RootPage.jsx'],
    ['auth/AuthChrome.jsx'],
    ['components/stage/SessionSetupPanel.jsx'],
    // The player bar. It moved out of PlayerPage.jsx with the survey, so the
    // runner could draw in it without a circular import.
    ['components/PlayerShell.jsx'],
  ])('%s draws it', (file) => {
    expect(read(...file.split('/'))).toMatch(/<BrandMark\b/);
  });

  it('the console no longer draws a gradient square in its place', () => {
    expect(read('components', 'AdminShell.jsx')).not.toMatch(/className="adm-mark"/);
  });
});
