/**
 * "START IT NOW" STARTS THE SESSION IT NAMES — issue #48 finding 1, on the real
 * host page (GameHostPage mounted, the network faked).
 *
 * Seen on engage.test at 043a7c93: create a Call & Answer session with
 * Ctrl/⌘+Enter, open the new row's Edit, close it without changes, press
 * "Start it now" on the confirmation. The page sent
 * POST /games/[object%20Object]/start and alerted "Game not found", while the
 * row's own Start worked for the same session. The banner handed `onStart` the
 * whole session row; its contract is (gameId, title).
 */
import React from 'react';
import { render, screen, fireEvent, waitFor, within, act } from '@testing-library/react';

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
import { pickSet } from '../testUtils/setChooser';
import { setRefKey } from '../utils/setRef';

const GAME = '1224';
const TITLE = 'Retro test';
const SET = { id: 'seta', name: 'Lessons from Different Schools', totalQuestions: 14, engagementType: 'call-and-answer', active: true };
const ROW = {
  gameId: GAME, title: TITLE, gameType: 'call-and-answer', questionSetId: 'seta',
  hostName: 'Host', byMe: true, started: false, createdAt: '2026-10-30T09:00:00Z', state: 'CREATED',
};

const ok = (body) => ({ ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) });

function installFetch() {
  let created = false;
  global.fetch = jest.fn(async (url, options) => {
    const u = String(url);
    const method = (options && options.method) || 'GET';
    if (/question-sets\/seta\/categories/.test(u)) {
      return ok({ categories: [{ name: 'Architecture', questionCount: 8 }, { name: 'Law', questionCount: 6 }] });
    }
    if (/question-sets(\?|$)/.test(u)) return ok({ sets: [SET] });
    if (/\/games$/.test(u) && method === 'POST') { created = true; return ok({ gameId: GAME }); }
    if (/\/games$/.test(u)) return ok({ games: created ? [ROW] : [] });
    if (u.includes(`games/${GAME}/host-details`)) {
      return ok({ ...ROW, details: '', questionSetId: 'seta', gameType: 'call-and-answer' });
    }
    if (/\/start$/.test(u) && method === 'POST') {
      return u.includes(`games/${GAME}/start`)
        ? ok({ ok: true })
        : { ok: false, status: 404, json: async () => ({ error: 'Game not found' }), text: async () => '{"error":"Game not found"}' };
    }
    return ok({});
  });
}

const startCalls = () => global.fetch.mock.calls
  .map(([url, options]) => [String(url), (options && options.method) || 'GET'])
  .filter(([url, method]) => method === 'POST' && /\/start$/.test(url))
  .map(([url]) => url);

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  installFetch();
  window.alert = jest.fn();
  window.history.pushState({}, '', '/host');
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('Your sessions: the confirmation after Create', () => {
  // rejects: issue #48 finding 1 — "Start it now" after opening and closing the
  //          new row's Edit sent POST /games/[object Object]/start (404, "That
  //          session did not start: Game not found"); the banner passed the
  //          session row where the page's start expects the game id.
  jest.setTimeout(30000);
  test('create with Ctrl+Enter, Edit and close it unchanged, then Start it now starts that session by its id', async () => {
    render(<GameHostPage />);

    // Create engagement → Call & Answer → a set → Ctrl+Enter.
    await act(async () => {
      fireEvent.click(await screen.findByRole('button', { name: /create engagement/i }, { timeout: 5000 }));
    });
    const format = await screen.findByRole('radio', { name: 'Call & Answer' }, { timeout: 5000 });
    fireEvent.click(format);
    const name = screen.getByLabelText(/name it/i);
    fireEvent.change(name, { target: { value: TITLE } });
    pickSet(setRefKey({ id: 'seta' }));
    await act(async () => {
      fireEvent.keyDown(screen.getByLabelText(/name it/i), { key: 'Enter', ctrlKey: true });
    });

    // The confirmation, with its Start it now.
    const done = await screen.findByTestId('shist-done', {}, { timeout: 5000 });
    expect(done).toHaveTextContent(`Its code is ${GAME}`);

    // Open the new row's Edit, then close it without changes.
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /^Edit$/ })); });
    const cancel = await screen.findByRole('button', { name: 'Close without saving changes' }, { timeout: 5000 });
    await act(async () => { fireEvent.click(cancel); });

    const again = await screen.findByTestId('shist-done', {}, { timeout: 5000 });
    await act(async () => {
      fireEvent.click(within(again).getByRole('button', { name: /Start it now/ }));
    });

    await waitFor(() => expect(startCalls()).toHaveLength(1));
    expect(startCalls()[0]).toMatch(new RegExp(`games/${GAME}/start$`));
    expect(startCalls()[0]).not.toMatch(/object/i);
    expect(window.alert).not.toHaveBeenCalled();
    expect(screen.queryByText(/did not start/)).toBeNull();
  });
});
