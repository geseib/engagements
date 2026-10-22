/**
 * ONE PAGE, ONE CHOICE (review #38, test 5b908b65, session 7360): "Explicit
 * One-screen choice intermittently reverts to Two". The host page re-read the
 * browser's stored choice on every render, and that storage is shared by every
 * tab (another host tab, a Build Room since 19 Oct, a ?surfaces= link). The
 * page now decides from the choice it holds; storage is read once when it opens.
 */
import React from 'react';
import { render } from '@testing-library/react';
import fs from 'fs';
import path from 'path';
import { twoSurfacesFor } from '../config/surfaces';
import ReadPanel from '../components/console/panels/ReadPanel';

const host = fs.readFileSync(path.join(__dirname, '..', 'GameHostPage.jsx'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');

test('the choice decides; no choice falls back to the tier default', () => {
  expect(twoSurfacesFor('two', { gameType: 'call-and-answer' })).toBe(true);
  expect(twoSurfacesFor('classic', { gameType: 'call-and-answer', env: 'development' })).toBe(false);
  expect(twoSurfacesFor(null, { gameType: 'call-and-answer', env: 'development' })).toBe(true);
  expect(twoSurfacesFor(null, { gameType: 'call-and-answer', env: 'test' })).toBe(false);
  expect(twoSurfacesFor('two', { gameType: 'trivia' })).toBe(false);
});

test('the host page reads the mode from its own choice, not from storage on every render', () => {
  expect(host).toMatch(/const twoSurfaces = twoSurfacesFor\(roomScreenChoice,/);
  expect(host).not.toMatch(/const twoSurfaces = twoSurfacesHere\(/);
});

// review #38: "During generation, the console says 'The wall shows this page' beside an empty read."
test('the read panel says the wall shows it only when there is a read', () => {
  const { container, rerender } = render(React.createElement(ReadPanel, { kicker: 'k', markdown: '' }));
  expect(container.querySelector('.hc-card-h').textContent).not.toMatch(/The wall shows this page/);
  rerender(React.createElement(ReadPanel, { kicker: 'k', markdown: 'Workie read' }));
  expect(container.querySelector('.hc-card-h').textContent).toMatch(/The wall shows this page/);
});
