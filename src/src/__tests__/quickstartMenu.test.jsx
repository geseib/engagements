/**
 * The Quick start sheet, opened from the welcome screen.
 *
 * It is redesigned onto the same dusk field as WelcomeScreen (it covers that
 * screen and nothing else), and two defects went with the restyle: the set
 * "cards" were <div>s with an onClick, so no keyboard could reach a single
 * one, and the close control was a bare "×" with no accessible name.
 *
 * NO GEOMETRIC ASSERTIONS — jsdom has no layout engine, so every measured box
 * is zero and every such assertion passes unconditionally.
 */
import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import QuickstartMenu from '../components/QuickstartMenu';

jest.mock('../auth/authFetch', () => ({
  authFetch: jest.fn(),
}));
const { authFetch } = require('../auth/authFetch');

const SETS = [
  {
    id: 'set-tech',
    name: 'Tech Trends',
    description: 'Where the industry is heading',
    engagementType: 'call-and-answer',
    totalQuestions: 12,
    categoryCount: 3,
    quickstart: true,
    active: true,
  },
];

beforeEach(() => {
  jest.clearAllMocks();
  authFetch.mockResolvedValue({ json: async () => ({ questionSets: SETS }) });
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ gameId: '4821' }),
  });
});

const renderMenu = (props = {}) => {
  const onGameCreated = jest.fn();
  const onClose = jest.fn();
  const utils = render(
    <QuickstartMenu onGameCreated={onGameCreated} onClose={onClose} {...props} />
  );
  return { ...utils, onGameCreated, onClose };
};

test('a set is a real button, not a div nobody can tab to', async () => {
  // rejects: the shipped state — `<div className="quickstart-set-card"
  // onClick=…>`, which is unreachable by keyboard and announces as nothing.
  // getByRole('button') matches no div, so reverting fails this outright.
  renderMenu();
  await waitFor(() => expect(screen.getByRole('button', { name: /Tech Trends/ })).toBeInTheDocument());
});

test('pressing a set still creates and starts the game', async () => {
  // rejects: the onClick being lost in the swap from <div> to <button> — the
  // element changed, so the handler is exactly the thing that can go missing
  // while the screen still looks right.
  const { onGameCreated, onClose } = renderMenu();
  const card = await screen.findByRole('button', { name: /Tech Trends/ });
  fireEvent.click(card);

  await waitFor(() => expect(onGameCreated).toHaveBeenCalledTimes(1));
  expect(onGameCreated).toHaveBeenCalledWith(
    expect.objectContaining({ gameId: '4821', questionSetId: 'set-tech' })
  );
  // create, then start
  const urls = global.fetch.mock.calls.map(([url]) => String(url));
  expect(urls.some((u) => u.endsWith('games'))).toBe(true);
  expect(urls.some((u) => u.endsWith('games/4821/start'))).toBe(true);
  expect(onClose).toHaveBeenCalled();
});

test('the close control has a name a screen reader can read', async () => {
  // rejects: the bare "×" glyph, whose accessible name was the multiplication
  // sign and nothing else.
  const { onClose } = renderMenu();
  const close = await screen.findByRole('button', { name: /close/i });
  fireEvent.click(close);
  expect(onClose).toHaveBeenCalledTimes(1);
});

test('Escape closes it', async () => {
  // rejects: an overlay with no keyboard exit. Clicking the scrim already
  // worked and is the mouse path; Escape was the missing keyboard path, and
  // without it a keyboard user who opened this had no way back at all.
  const { onClose } = renderMenu();
  await screen.findByRole('button', { name: /Tech Trends/ });
  fireEvent.keyDown(document, { key: 'Escape' });
  expect(onClose).toHaveBeenCalledTimes(1);
});
