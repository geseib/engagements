/**
 * WHERE THE REPORT-A-PROBLEM CONTROL LIVES.
 *
 * Reported from dev: "the report bug/feature/etc button is floating in the way.
 * lets find a better place for it throughout the system."
 *
 * It was `position: fixed` at `z-index: 20000` in the stylesheet, with no way
 * to ask for anything else — so it sat over every screen that mounted it, and,
 * worse, over the panels that were already passing it in as a slotted control.
 * GameHostPage hands it to SessionSetupPanel as `issueControl`, which places it
 * in that panel's footer; the CSS then ignored the placement its own caller had
 * chosen. These assertions are about class names and mount points, which is
 * what jsdom can actually answer — there is no layout engine here, so nothing
 * below measures a pixel.
 */
import React from 'react';
import { render, screen } from '@testing-library/react';
import IssueFab from '../components/IssueFab';

const container = () => document.querySelector('.issue-fab-container');

describe('placement', () => {
  // rejects: going back to fixed-by-default. Every current mount has a header
  // or footer to sit in, so floating is the exception and must be asked for.
  it('is inline unless the caller asks otherwise', () => {
    render(<IssueFab context="admin" />);
    expect(container()).toHaveClass('issue-fab-container--inline');
    expect(container()).not.toHaveClass('issue-fab-container--floating');
  });

  // rejects: dropping the floating variant altogether. A surface with no chrome
  // still needs somewhere to put this, and that case should stay expressible.
  it('still floats when a surface has nowhere to put it', () => {
    render(<IssueFab context="host" placement="floating" />);
    expect(container()).toHaveClass('issue-fab-container--floating');
  });
});

describe('the corner placement', () => {
  // rejects: 'corner' quietly falling back to inline, which is how a control
  // ends up back in a header that most screens do not have
  it('is its own placement, and lifts only when asked to', () => {
    const { unmount } = render(<IssueFab context="player" placement="corner" />);
    expect(container()).toHaveClass('issue-fab-container--corner');
    expect(container()).not.toHaveClass('issue-fab-container--lifted');
    unmount();
    render(<IssueFab context="player" placement="corner" lifted />);
    expect(container()).toHaveClass('issue-fab-container--corner', 'issue-fab-container--lifted');
  });

  // rejects: `lifted` leaking onto a placement it means nothing for
  it('ignores lifted anywhere but the corner', () => {
    render(<IssueFab context="admin" placement="inline" lifted />);
    expect(container()).not.toHaveClass('issue-fab-container--lifted');
  });

  // rejects: an unknown placement string producing an unstyled class
  it('falls back to inline for a placement it does not know', () => {
    render(<IssueFab context="admin" placement="somewhere" />);
    expect(container()).toHaveClass('issue-fab-container--inline');
  });
});

describe('clearing a dock that spans the bottom of the screen', () => {
  // A fixed 88px lift was the first attempt, and the first screen it was looked
  // at on proved it wrong: the player's join dock is ~130px and changes height
  // with every phase. So the dock declares itself and is measured.
  const dockAt = (top, bottom) => {
    const dock = document.createElement('footer');
    dock.setAttribute('data-issue-clearance', '');
    dock.getBoundingClientRect = () => ({ top, bottom, height: bottom - top, left: 0, right: 375, width: 375 });
    document.body.appendChild(dock);
    return dock;
  };
  const lift = () => container().style.getPropertyValue('--issue-fab-lift');

  beforeEach(() => { Object.defineProperty(window, 'innerHeight', { value: 812, configurable: true }); });
  afterEach(() => { document.querySelectorAll('[data-issue-clearance]').forEach((el) => el.remove()); });

  it('rises by the height of the dock it would otherwise cover', () => {
    dockAt(682, 812);
    render(<IssueFab context="player" placement="corner" lifted />);
    expect(lift()).toBe('130px');
  });

  // rejects: lifting for a dock that is not at the bottom edge — mid-page on a
  // tall screen, or scrolled away — and leaving the tab stranded up the screen
  it('ignores a dock that does not reach the bottom edge', () => {
    dockAt(300, 430);
    render(<IssueFab context="player" placement="corner" lifted />);
    expect(lift()).toBe('');
  });

  it('measures nothing unless it was asked to lift', () => {
    dockAt(682, 812);
    render(<IssueFab context="admin" placement="corner" />);
    expect(lift()).toBe('');
  });

  // rejects: the attribute being dropped in a refactor of either surface, which
  // would silently put the tab back over the dock's first button
  it('both docks that span the screen declare themselves', () => {
    const fs = require('fs');
    const path = require('path');
    const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
    expect(read('PlayerPage.jsx')).toMatch(/className="plr-dock" data-issue-clearance/);
    expect(read('HostRemote.jsx')).toMatch(/className="hr-dock" data-issue-clearance/);
  });
});

describe('the control itself', () => {
  // rejects: an icon-only button with no accessible name, which is what it was
  // — `title` alone is not a name for every assistive technology, and this is
  // the one control on the page for saying something is broken.
  it('has an accessible name and reports its menu state', () => {
    render(<IssueFab context="admin" />);
    const button = screen.getByRole('button', { name: /report a problem/i });
    expect(button).toHaveAttribute('aria-expanded', 'false');
  });
});
