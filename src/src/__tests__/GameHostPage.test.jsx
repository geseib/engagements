import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
/*
  THE ONE MOCK THAT STOOD BETWEEN THIS SUITE AND EVER RUNNING.

  It failed on `useAuth must be used within an AuthProvider` — and that single
  unmocked provider is the entire reason this file has been red since it was
  written, and the reason a claim spread through this repo that the component
  "cannot be rendered in jsdom". Three product-down bugs shipped behind that
  claim. The component was always mountable.
*/
jest.mock('../auth/AuthContext', () => ({
  __esModule: true,
  useAuth: () => ({
    currentUser: { username: 'host', attributes: { email: 'host@example.com' } },
    signOut: jest.fn(),
    isAdmin: true,
  }),
  AuthProvider: ({ children }) => children,
}));

jest.mock('../auth/authFetch', () => ({
  __esModule: true,
  authFetch: (...args) => global.fetch(...args),
  /* The active-organisation accessors live beside `authFetch` because the
     header they drive is sent from there. A mock that stubs only `authFetch`
     leaves these undefined, and the host screen now mounts
     `ActiveOrgSwitcher` — which calls `getActiveOrgId()` in a `useState`
     initialiser and takes the whole page down. It reads as a component bug and
     is a mock gap; AdminPage.test.jsx carries the same note. */
  getActiveOrgId: () => '',
  setActiveOrgId: () => {},
  ORG_HEADER: 'X-Engage-Org',
  ACTIVE_ORG_STORAGE_KEY: 'engage.activeOrg',
}));

import GameHostPage from '../GameHostPage';

// Mock WebSocketClient
jest.mock('../WebSocketClient', () => ({
  __esModule: true,
  default: {
    connect: jest.fn(),
    disconnect: jest.fn(),
    isConnected: jest.fn(() => false),
    sendMessage: jest.fn(),
    onMessage: jest.fn(),
    onConnectionChange: null,
  },
}));

/**
 * THE STALE HALF OF THIS FILE IS GONE, AND THIS RECORDS WHY.
 *
 * These tests asserted copy that no longer exists — "Welcome to Engagements",
 * "Create New Game", a players grid keyed on a name — because they were written
 * against an older UI and then never ran again to notice. A test that has never
 * passed is not a regression test; it is a description of a product that may
 * never have shipped.
 *
 * The behaviour they were reaching for is now covered properly, and by
 * something that mounts the real component and drives real journeys:
 * `hostRenderTransitions.test.jsx`. What is left here is the smoke check that
 * matters and that file does not duplicate — the page renders its entry screen
 * against today's copy, and an API that answers badly does not blank it.
 */
describe('GameHostPage — the entry screen', () => {
  beforeEach(() => {
    global.fetch.mockClear();
    global.fetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({}),
      text: async () => '{}',
    });
    localStorage.clear();
    window.history.pushState({}, '', '/host');
  });

  // rejects: the entry screen failing to render at all, which is the shape all
  //          three of this week's blank-page bugs took.
  test('it offers the ways into a session', async () => {
    render(<GameHostPage />);
    expect(await screen.findByText(/start an engagement/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /create engagement/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /quick start/i })).toBeInTheDocument();
  });

  // rejects: an unreachable or failing API taking the page down with it. The
  //          host must still get a screen they can act on.
  test('an API that fails does not blank the page', async () => {
    global.fetch.mockRejectedValue(new Error('network down'));
    render(<GameHostPage />);
    expect(await screen.findByText(/start an engagement/i)).toBeInTheDocument();
  });

  // rejects: a non-2xx answer being treated as data and crashing the render.
  test('a 500 from every endpoint does not blank the page', async () => {
    global.fetch.mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => { throw new Error('not json'); },
      text: async () => 'Internal Server Error',
    });
    render(<GameHostPage />);
    expect(await screen.findByText(/start an engagement/i)).toBeInTheDocument();
  });
});
