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

// Routed by URL rather than a single canned reply: the sheet now makes TWO
// authFetch calls with different shapes (the set list, then the create), and a
// blanket mockResolvedValue would hand the create an object with no `ok`,
// sending it down the error branch while looking like a fixture detail.
beforeEach(() => {
  jest.clearAllMocks();
  authFetch.mockImplementation(async (url) => {
    if (String(url).endsWith('admin/question-sets')) {
      return { ok: true, json: async () => ({ questionSets: SETS }) };
    }
    return { ok: true, json: async () => ({ gameId: '4821' }) };
  });
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    json: async () => ({}),
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
  // create, then start — BOTH authenticated now.
  //
  // `/start` used to be asserted against the bare `global.fetch` mock, because
  // POST /games/{id}/start was a public route. It is not any more: an
  // unauthenticated start let anyone holding the four-digit join code open
  // somebody else's session. The route and this call site moved together —
  // see tests/session-control-routes-authorization.js, which fails if either
  // half is reverted alone.
  const authUrls = authFetch.mock.calls.map(([url]) => String(url));
  expect(authUrls.some((u) => u.endsWith('games'))).toBe(true);
  expect(authUrls.some((u) => u.endsWith('games/4821/start'))).toBe(true);
  expect(onClose).toHaveBeenCalled();
});

test('the create call carries a token', async () => {
  // rejects: this call site reverting to a bare `fetch`. `POST /games` is
  // public today and about to stop being — anyone can create unlimited
  // sessions in the environment — and buildspec-dev.yml:49-58 deploys the API
  // BEFORE the frontend, with cached bundles outliving the build. So the token
  // has to be here first; a route that starts demanding one before its callers
  // send one 401s quick start for everyone still holding the old JS, and the
  // breakage surfaces as a dead button, not as a build error.
  //
  // A token is always available: QuickstartMenu renders only from GameHostPage
  // (GameHostPage.jsx:3118), which sits behind ProtectedRoute (App.jsx:176).
  renderMenu();
  const card = await screen.findByRole('button', { name: /Tech Trends/ });
  fireEvent.click(card);

  await waitFor(() =>
    expect(authFetch.mock.calls.some(([url]) => String(url).endsWith('games'))).toBe(true));

  const barePost = global.fetch.mock.calls.find(
    ([url, opts]) => String(url).endsWith('games') && opts?.method === 'POST'
  );
  expect(barePost).toBeUndefined();
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
