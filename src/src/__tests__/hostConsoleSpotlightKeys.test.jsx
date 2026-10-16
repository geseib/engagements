/**
 * A RESPONSE ON THE WALL DOES NOT TAKE THE KEYS AWAY (final review, 15 Oct).
 * On two screens the console puts a response up on /present; it never mounts
 * the stage's <AnswerSpotlight>, so the spotlight is not a local overlay and
 * Space / → / the clicker keep driving the footer's main button.
 */
import React from 'react';
import { render, screen, act, waitFor, fireEvent } from '@testing-library/react';

jest.mock('../auth/AuthContext', () => ({
  __esModule: true,
  useAuth: () => ({
    currentUser: { username: 'host', attributes: { email: 'host@example.com' } },
    signOut: jest.fn(),
    isAdmin: false,
  }),
  AuthProvider: ({ children }) => children,
}));

jest.mock('../auth/authFetch', () => ({
  __esModule: true,
  authFetch: (...args) => global.fetch(...args),
  getActiveOrgId: () => '',
  setActiveOrgId: () => {},
  ORG_HEADER: 'X-Engage-Org',
  ACTIVE_ORG_STORAGE_KEY: 'engage.activeOrg',
}));

jest.mock('../WebSocketClient', () => ({
  __esModule: true,
  default: {
    connect: jest.fn(),
    disconnect: jest.fn(),
    ensureConnected: jest.fn(),
    isConnected: () => false,
    sendCleanMessage: jest.fn(),
    onConnectionStatusChange: jest.fn(),
    onReconnected: jest.fn(),
    onMessage: jest.fn(),
    offMessage: jest.fn(),
  },
}));

import GameHostPage from '../GameHostPage';

const GAME = '5481';
const ok = (body) => ({ ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) });
const ANSWERS = [
  { answer: 'Weekly status meetings', playerName: 'Ada', playerId: 'p1' },
  { answer: 'The paper sign-off sheet', playerName: 'Ben', playerId: 'p2' },
  { answer: 'The Friday phone round-up', playerName: 'Cleo', playerId: 'p3' },
];

beforeAll(() => {
  global.ResizeObserver = global.ResizeObserver || class { observe() {} disconnect() {} unobserve() {} };
});

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  localStorage.setItem('engage.surfaces', 'two');
  window.alert = jest.fn();
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'trace').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  window.history.pushState({}, '', `/host?gameId=${GAME}`);
  global.fetch = jest.fn(async (url) => {
    const u = String(url);
    if (u.endsWith(`games/${GAME}`)) return ok({ started: true, gameType: 'call-and-answer' });
    if (u.includes(`games/${GAME}/host-state`)) {
      return ok({
        state: 'VOTE#001',
        currentQuestion: 1,
        gameMetadata: { gameType: 'call-and-answer', title: 'Relay expansion' },
        votingProgress: { votesReceived: 0, totalPlayers: 3, votersIds: [] },
        presenting: 1,
        presentDetail: { open: true, fullscreen: true, visible: true, statusAt: new Date().toISOString() },
      });
    }
    // A network's worth of delay: the page lets VOTE rows in only once the
    // stage is on that vote, which a same-tick mock would beat.
    if (u.includes(`games/${GAME}/answers/host`)) {
      await new Promise((r) => setTimeout(r, 50));
      return ok({ answers: ANSWERS });
    }
    if (u.includes(`games/${GAME}/question?role=host`)) {
      return ok({ id: 'q1', title: 'The Meiji Restoration', questionDetail: 'Which process ended?' });
    }
    return ok({});
  });
});

afterEach(() => {
  jest.restoreAllMocks();
  localStorage.clear();
});

test('a response put on the wall from the console: → → still drives the footer', async () => {
  const { container } = render(<GameHostPage />);
  await waitFor(() => expect(container.querySelectorAll('.hc-main [data-testid="hc-resp"]').length).toBe(3), { timeout: 5000 });
  const bar = container.querySelector('.hc-foot .host-action-bar');
  expect(bar).toBeTruthy();

  // Put the second response on the wall from the console.
  await act(async () => { fireEvent.click(container.querySelectorAll('.hc-main [data-testid="hc-resp"]')[1]); });
  await waitFor(() => expect(container.querySelectorAll('.hc-main [data-testid="hc-resp"]')[1]).toHaveClass('is-onwall'));

  const before = global.fetch.mock.calls.length;
  await act(async () => { fireEvent.keyDown(window, { key: 'ArrowRight' }); });
  await act(async () => { fireEvent.keyDown(window, { key: 'ArrowRight' }); });
  // The footer's main button on a vote with nobody voted is "Show results",
  // armed in place: the first → arms it, the second closes the round.
  const closes = global.fetch.mock.calls.slice(before)
    .filter(([u, o]) => String(u).endsWith(`games/${GAME}/close-round`) && o && o.method === 'POST');
  expect(closes).toHaveLength(1);
});
