/**
 * THE HOST CONSOLE ON THE REAL PAGE (host console spec §4.1, plan Task 8).
 * Two screens on (the per-browser `engage.surfaces` choice), a Call & Answer
 * round being answered: the page renders the console, not the stage; the
 * host's notes from /host-state land in "For you"; and the `presentChanged`
 * frame reads the host door again.
 */
import React from 'react';
import { render, screen, act, waitFor } from '@testing-library/react';

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

const GAME = '5480';
const ok = (body) => ({ ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) });
const hostStateReads = () => global.fetch.mock.calls.filter(([url]) => String(url).includes(`games/${GAME}/host-state`)).length;

beforeAll(() => {
  global.ResizeObserver = global.ResizeObserver || class { observe() {} disconnect() {} unobserve() {} };
});

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  localStorage.setItem('engage.surfaces', 'two');
  window.alert = jest.fn();
  window.history.pushState({}, '', `/host?gameId=${GAME}`);
  global.fetch = jest.fn(async (url) => {
    const u = String(url);
    if (u.endsWith(`games/${GAME}`)) return ok({ started: true, gameType: 'call-and-answer' });
    if (u.includes(`games/${GAME}/host-state`)) {
      return ok({
        state: 'ASK#001',
        currentQuestion: 1,
        gameMetadata: { gameType: 'call-and-answer', title: 'Relay expansion' },
        presenting: 1,
        presentDetail: { open: true, fullscreen: true, visible: true, statusAt: new Date().toISOString() },
        hostNotes: { background: 'The Meiji reforms took two decades.' },
      });
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

test('two screens: the console, not the stage, with the host notes beside the responses', async () => {
  const { container } = render(<GameHostPage />);
  await waitFor(() => expect(container.querySelector('.hc')).toBeTruthy(), { timeout: 5000 });
  expect(container.querySelector('.stage')).toBeNull();
  expect(await screen.findByText('The Meiji reforms took two decades.', {}, { timeout: 5000 })).toBeInTheDocument();
  // One main button, in the console's footer.
  expect(container.querySelector('.hc-now .host-action-bar')).toBeTruthy();
});

test('presentChanged reads the host door again', async () => {
  const { container } = render(<GameHostPage />);
  await waitFor(() => expect(container.querySelector('.hc')).toBeTruthy(), { timeout: 5000 });
  const call = webSocketClient.onMessage.mock.calls.filter(([type]) => type === 'presentChanged').pop();
  expect(call).toBeTruthy();
  const before = hostStateReads();
  await act(async () => { call[1]({ type: 'presentChanged', gameId: GAME }); });
  await waitFor(() => expect(hostStateReads()).toBeGreaterThan(before));
});
