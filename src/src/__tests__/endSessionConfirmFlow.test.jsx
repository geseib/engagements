/**
 * TASK 4 FIX ROUND 1 — the behavioural half of "confirm calls the route,
 * cancel does not": a real mount of GameHostPage, driven to a live round, the
 * settings panel opened, End session pressed, and the confirm dialog either
 * confirmed or cancelled.
 *
 * Modelled on hostRenderTransitions.test.jsx, the one file in this stream that
 * mounts GameHostPage rather than reading it as text — the same three mocks
 * (auth, authFetch, WebSocketClient), the same `installFetch` shape.
 */
import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';

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

const GAME = '4821';

function installFetch(overrides = {}) {
  global.fetch = jest.fn(async (url, options) => {
    const u = String(url);
    const method = options?.method || 'GET';
    for (const [pattern, body] of Object.entries(overrides)) {
      if (u.includes(pattern)) {
        return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) };
      }
    }
    if (method === 'POST' && u.includes('/games') && !u.includes('/report')) {
      return { ok: true, status: 200, json: async () => ({ gameId: GAME, success: true }) };
    }
    return { ok: true, status: 200, json: async () => ({}), text: async () => '{}' };
  });
}

async function renderLiveGame() {
  installFetch({
    [`games/${GAME}?role=host`]: { started: true },
    [`games/${GAME}/state?includeHostData=true`]: {
      state: 'ASK#001',
      currentQuestion: 1,
      gameMetadata: { gameType: 'trivia', title: 'Test Game' },
    },
    [`games/${GAME}/question?role=host`]: {
      id: 'q1', title: 'Sample question', questionDetail: 'Detail',
      optionA: 'A', optionB: 'B', optionC: 'C', optionD: 'D',
    },
  });
  window.history.pushState({}, '', `/host?gameId=${GAME}`);
  render(<GameHostPage />);
  const setup = await screen.findByRole('button', { name: /session panel/i }, { timeout: 5000 });
  await act(async () => { fireEvent.click(setup); });
  await screen.findByRole('tab', { name: 'Settings' });
  fireEvent.click(screen.getByRole('tab', { name: 'Settings' }));
}

beforeEach(() => {
  localStorage.clear();
  jest.restoreAllMocks();
});

describe('End session — no modal on a modal (fix round 1, item 1)', () => {
  /*
    THE REPRODUCTION. Before the fix, `onEndSession` called `runHostAction`
    directly, and `runHostAction` closes the panel only AFTER `showConfirmation`
    resolves — so the confirm opened on top of the still-open setup panel.
    Caught here exactly as it shows up to a host: TWO "End session" buttons on
    screen at once (the panel's `btn-danger` and the dialog's `btn-primary`),
    which made `getByRole('button', {name: /end session/i})` throw "Found
    multiple elements" the first time this test was written.
  */
  test('the setup panel is gone before the confirm dialog appears', async () => {
    await renderLiveGame();
    fireEvent.click(screen.getByRole('button', { name: /^end session$/i }));
    expect(document.querySelector('.setup-panel')).toBeNull();
    // Exactly one "End session" on screen now — the confirm dialog's own.
    expect(screen.getAllByText(/end session/i)).toHaveLength(1);
  });

  test('confirming calls POST /games/{id}/end', async () => {
    await renderLiveGame();
    fireEvent.click(screen.getByRole('button', { name: /^end session$/i }));
    fireEvent.click(await screen.findByRole('button', { name: /^end session/i }));
    await waitFor(() => {
      expect(global.fetch.mock.calls.some(([url]) => String(url).includes(`games/${GAME}/end`))).toBe(true);
    });
  });

  test('cancelling never calls the route', async () => {
    await renderLiveGame();
    fireEvent.click(screen.getByRole('button', { name: /^end session$/i }));
    const cancel = await screen.findByRole('button', { name: /cancel/i });
    fireEvent.click(cancel);
    await new Promise((r) => setTimeout(r, 0));
    expect(global.fetch.mock.calls.some(([url]) => String(url).includes(`games/${GAME}/end`))).toBe(false);
  });
});
