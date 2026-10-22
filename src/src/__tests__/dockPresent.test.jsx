/**
 * PRESENT IN THE HOST'S DOCK (two-surface PLAN 2.13).
 *
 * A real link to /present that opens a new window (so a drag to the
 * projector works), shaped like AGENDA and SESSION, reading PRESENTING once a
 * Presentation has connected. Absent when the switch is off (no `present`).
 * The host page passes it only under twoSurfacesHere.
 */
import React from 'react';
import fs from 'fs';
import path from 'path';
import { render, screen } from '@testing-library/react';
import Dock from '../components/stage/Dock';

beforeAll(() => {
  global.ResizeObserver = global.ResizeObserver || class { observe() {} disconnect() {} unobserve() {} };
});

test('no present prop, no link', () => {
  render(<Dock status="Ready" onSetup={() => {}} />);
  expect(screen.queryByRole('link')).toBeNull();
});

test('PRESENT opens /present in a new window', () => {
  render(<Dock status="Ready" onSetup={() => {}} present={{ href: '/present?gameId=5479', presenting: 0 }} />);
  const link = screen.getByRole('link', { name: "Open the room's window in a new window" });
  expect(link.getAttribute('href')).toBe('/present?gameId=5479');
  expect(link.getAttribute('target')).toBe('_blank');
  expect(link.getAttribute('rel')).toMatch(/noopener/);
  expect(link.textContent).toBe('PRESENT');
  expect(link.className).toMatch(/dock-more/);
});

test('PRESENTING once a Presentation is connected', () => {
  render(<Dock status="Ready" present={{ href: '/present?gameId=5479', presenting: 2 }} />);
  const link = screen.getByRole('link');
  expect(link.textContent).toBe('PRESENTING');
  expect(link.hasAttribute('data-presenting')).toBe(true);
});

test('the host page offers it only under the two-surface switch', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'GameHostPage.jsx'), 'utf8');
  expect(src).toMatch(/present=\{twoSurfaces && gameId \? \{ href: presentHref\(gameId\), presenting \} : null\}/);
  // The page decides from the choice it holds (review #38), not storage re-read per render.
  expect(src).toMatch(/const twoSurfaces = twoSurfacesFor\(roomScreenChoice, \{ gameType: currentGameType/);
});

test('the Remote swaps Big screen for Present only under the switch', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'HostRemote.jsx'), 'utf8');
  expect(src).toMatch(/twoSurfacesHere\(gameType\) \?/);
  expect(src).toMatch(/href=\{presentHref\(gameId\)\}/);
  expect(src).toMatch(/Big screen/);
});
