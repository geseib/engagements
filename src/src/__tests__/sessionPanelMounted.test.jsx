/**
 * THE SESSION PANEL'S OPEN KEY, FROM A REAL MOUNT OF GameHostPage.
 *
 * sessionPanelOpenKey.test.jsx's own header used to say GameHostPage "cannot
 * easily be exercised for this (an AuthProvider and a live socket)". That
 * claim is exactly the one hostRenderTransitions.test.jsx already retired for
 * its own file: three mocks (auth, authFetch, WebSocketClient) are enough —
 * the same shape endSessionConfirmFlow.test.jsx uses for the setup panel's
 * OTHER keyboard-adjacent regression (End session on top of the panel). This
 * file is that same pattern, aimed at `\`: does it actually toggle
 * `.setup-panel` on a fully-mounted host screen, not just inside an isolated
 * harness.
 *
 * What this file deliberately does NOT attempt: reaching the survey
 * walk-through through a real mount. That needs a survey/poll session driven
 * to CLOSED with a `Walk through` control resolved and clicked, which pulls
 * in game-type branching and a `survey-results` round trip this fix does not
 * touch — sessionPanelOpenKey.test.jsx's synthetic-harness test (`enabledExtra
 * = false`) and its GameHostPage.jsx source assertion already cover that gate
 * precisely; duplicating it here would mostly test the restore pipeline.
 */
import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';

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
      const hit = pattern.endsWith('$') ? u.endsWith(pattern.slice(0, -1)) : u.includes(pattern);
      if (hit) {
        return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) };
      }
    }
    if (method === 'POST' && u.includes('/games') && !u.includes('/report')) {
      return { ok: true, status: 200, json: async () => ({ gameId: GAME, success: true }) };
    }
    return { ok: true, status: 200, json: async () => ({}), text: async () => '{}' };
  });
}

/**
 * Unlike endSessionConfirmFlow.test.jsx's own `renderLiveGame`, this one
 * does NOT click the SESSION button — the panel must start CLOSED, which is
 * exactly the state the owner reported the keyboard could never leave.
 */
async function renderLiveGame() {
  installFetch({
    [`games/${GAME}$`]: { started: true },
    [`games/${GAME}/host-state`]: {
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
  // The stage is up once the dock's SESSION button exists — the same signal
  // endSessionConfirmFlow.test.jsx waits on before it clicks it. This suite
  // never clicks it.
  await screen.findByRole('button', { name: /session panel/i }, { timeout: 5000 });
}

beforeEach(() => {
  localStorage.clear();
  jest.restoreAllMocks();
});

describe('\\ on a mounted, live GameHostPage', () => {
  test('opens the Session panel from closed', async () => {
    await renderLiveGame();
    expect(document.querySelector('.setup-panel')).toBeNull();
    await act(async () => { fireEvent.keyDown(document.body, { key: '\\' }); });
    expect(document.querySelector('.setup-panel')).not.toBeNull();
  });

  test('a second \\ closes it, and it stays closed after flushing', async () => {
    await renderLiveGame();
    await act(async () => { fireEvent.keyDown(document.body, { key: '\\' }); });
    expect(document.querySelector('.setup-panel')).not.toBeNull();

    await act(async () => { fireEvent.keyDown(document.body, { key: '\\' }); });
    // Flush a further tick — the fix round 1 regression was a listener
    // re-arming and firing again within the same event's dispatch, which a
    // single assertion right after the press could still race.
    await act(async () => { await Promise.resolve(); });
    expect(document.querySelector('.setup-panel')).toBeNull();
  });

  test('Escape also closes it, through the panel\'s own listener', async () => {
    await renderLiveGame();
    await act(async () => { fireEvent.keyDown(document.body, { key: '\\' }); });
    expect(document.querySelector('.setup-panel')).not.toBeNull();
    await act(async () => { fireEvent.keyDown(document.body, { key: 'Escape' }); });
    expect(document.querySelector('.setup-panel')).toBeNull();
  });
});
