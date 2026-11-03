/**
 * SCORES IN THE CONSOLE'S PEOPLE COLUMN (owner, dev, 3 Nov 2026): "before the
 * scores showed up in the hosts screen 2 screen mode in the people list, but
 * not now."
 *
 * PLAN §3.2b: a person row's one added fact is the score for Call & Answer
 * and Trivia. config/consoleRail.js personFactsFor returned null for every
 * format but Trivia, so a two-screen Call & Answer host had no score anywhere
 * once the Session menu's Players list (with "N pts") moved behind People.
 *
 * rejects: a C&A person row with no score after a reload on the results, a
 * score that does not move after the next results, a score on a poll's row.
 */
import React from 'react';
import { render, act, waitFor } from '@testing-library/react';

const LOAD_WAIT = 15000;

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
import webSocketClient from '../WebSocketClient';

const GAME = '5483';
const ok = (body) => ({ ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) });
let scores;
let gameType;

beforeAll(() => {
  global.ResizeObserver = global.ResizeObserver || class { observe() {} disconnect() {} unobserve() {} };
});

beforeEach(() => {
  scores = { Ada: 30, Ben: 10, Cleo: 0 };
  gameType = 'call-and-answer';
  localStorage.clear();
  sessionStorage.clear();
  localStorage.setItem('engage.surfaces', 'two');
  window.alert = jest.fn();
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'trace').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
  // A reload mid-session, on the first round's results.
  window.history.pushState({}, '', `/host?gameId=${GAME}`);
  global.fetch = jest.fn(async (url) => {
    const u = String(url);
    if (u.endsWith(`games/${GAME}`)) return ok({ started: true, gameType });
    if (u.includes(`games/${GAME}/host-state`)) {
      return ok({
        state: 'RESULTS#001',
        currentQuestion: 1,
        gameMetadata: { gameType, title: 'Relay expansion' },
        presenting: 1,
        presentDetail: { open: true, fullscreen: true, visible: true, statusAt: new Date().toISOString() },
      });
    }
    if (u.includes(`games/${GAME}/players`)) {
      return ok({
        players: Object.entries(scores).map(([playerName, totalScore], i) => ({ playerId: `p${i + 1}`, playerName, totalScore })),
        afterRound: 1,
      });
    }
    if (u.includes(`games/${GAME}/question?role=host`)) {
      return ok({ id: 'c001#001', title: 'What slows us down?', questionDetail: 'Name one thing.' });
    }
    return ok({});
  });
});

afterEach(() => {
  jest.restoreAllMocks();
  localStorage.clear();
});

/* The person row's score, null for a row with no fact, undefined for no row. */
const scoreOf = (container, name) => {
  const li = [...container.querySelectorAll('.hc-rail [data-section="people"] .hc-list li')]
    .find((n) => n.textContent.includes(name));
  if (!li) return undefined;
  const s = li.querySelector('[data-testid="person-fact"] .hc-score');
  return s ? s.textContent : null;
};

test('two screens, Call & Answer, after a reload on the results: each person row shows their score', async () => {
  const { container } = render(<GameHostPage />);
  await waitFor(() => expect(scoreOf(container, 'Ada')).toBe('30'), { timeout: LOAD_WAIT });
  expect(scoreOf(container, 'Ben')).toBe('10');
  expect(scoreOf(container, 'Cleo')).toBe('0');
});

test('and the scores move after the next round\'s results', async () => {
  const { container } = render(<GameHostPage />);
  await waitFor(() => expect(scoreOf(container, 'Ada')).toBe('30'), { timeout: LOAD_WAIT });
  scores = { Ada: 30, Ben: 40, Cleo: 20 };
  const frame = webSocketClient.onMessage.mock.calls.filter(([type]) => type === 'gameStateChanged').pop();
  expect(frame).toBeTruthy();
  await act(async () => { frame[1]({ type: 'gameStateChanged', gameId: GAME }); });
  await waitFor(() => expect(scoreOf(container, 'Ben')).toBe('40'));
  expect(scoreOf(container, 'Cleo')).toBe('20');
});

test('a poll on two screens: the rows carry no score', async () => {
  gameType = 'poll';
  const { container } = render(<GameHostPage />);
  await waitFor(() => expect(scoreOf(container, 'Ada')).toBeDefined(), { timeout: LOAD_WAIT });
  expect(container.querySelector('.hc-rail [data-testid="person-fact"]')).toBeNull();
});
