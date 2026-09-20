import React from 'react';
import fs from 'fs';
import path from 'path';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import JoinCodeEntry from '../components/JoinCodeEntry';
import { navigateTo } from '../auth/navigate';

jest.mock('../auth/navigate', () => ({ navigateTo: jest.fn() }));
const field = () => screen.getByLabelText(/session code/i);

beforeEach(() => { jest.clearAllMocks(); global.fetch.mockReset(); window.API_BASE = 'https://api.example/'; });

test('it does not steal focus from a marketing page', () => {
  // rejects: copying RootPage's autoFocus, which on the home page would scroll
  // a reader to the field and raise a phone keyboard over the headline
  render(<JoinCodeEntry />);
  expect(field()).not.toHaveFocus();
});

test('a valid code joins', async () => {
  render(<JoinCodeEntry />);
  fireEvent.change(field(), { target: { value: '4821' } });
  global.fetch.mockResolvedValueOnce({ status: 200, ok: true, json: async () => ({}) });
  fireEvent.click(screen.getByRole('button', { name: /join/i }));
  await waitFor(() => expect(navigateTo).toHaveBeenCalledWith('/play?gameId=4821'));
});

test('an unknown code says so inline, as an alert', async () => {
  render(<JoinCodeEntry />);
  fireEvent.change(field(), { target: { value: '4821' } });
  global.fetch.mockResolvedValueOnce({ status: 404, ok: false, json: async () => ({}) });
  fireEvent.click(screen.getByRole('button', { name: /join/i }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Nothing is running under 4821');
  expect(navigateTo).not.toHaveBeenCalled();
});

test('every class is in the jce namespace', () => {
  const { container } = render(<JoinCodeEntry />);
  const names = [...container.querySelectorAll('[class]')].flatMap((el) => [...el.classList]);
  expect(names.filter((n) => !n.startsWith('jce'))).toEqual([]);
});

// Ruling 5: typing "48" renders the digits in the first two cells and marks
// the third cell as next -- DOM facts (text + class), not geometry.
test('typing partial digits fills cells left to right and marks the next one', () => {
  const { container } = render(<JoinCodeEntry />);
  fireEvent.change(field(), { target: { value: '48' } });
  const cells = container.querySelectorAll('.jce-cell');
  expect(cells).toHaveLength(4);
  expect(cells[0]).toHaveTextContent('4');
  expect(cells[1]).toHaveTextContent('8');
  expect(cells[2]).toHaveTextContent('');
  expect(cells[2].classList.contains('jce-next')).toBe(true);
  expect(cells[3].classList.contains('jce-next')).toBe(false);
});

// Fix round 1: the real input is invisible (opacity: 0), so the wrapper's
// `jce-focused` modifier is the only thing that can paint a visible focus
// state. A keyboard user tabbing in must see something react.
test('focusing the field marks the wrapper focused, blurring clears it', () => {
  const { container } = render(<JoinCodeEntry />);
  const row = container.querySelector('.jce-row');
  expect(row.classList.contains('jce-focused')).toBe(false);

  fireEvent.focus(field());
  expect(row.classList.contains('jce-focused')).toBe(true);

  fireEvent.blur(field());
  expect(row.classList.contains('jce-focused')).toBe(false);
});

// jsdom does not run a layout engine (no computed styles), so this is a
// stylesheet-text check in the style of this repo's other CSS-contract tests:
// it proves the rule and the reduced-motion guard exist in source, not that
// they render correctly on screen.
test('the stylesheet declares a visible focus rule and respects reduced motion', () => {
  const css = fs.readFileSync(
    path.join(__dirname, '..', 'components', 'JoinCodeEntry.css'),
    'utf8',
  );
  expect(css).toMatch(/\.jce-focused\s*{|\.jce-row\.jce-focused\s*{/);
  expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)/);
});
