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
