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
}));

import AdminPage from '../AdminPage';

/**
 * THE ADMIN CONSOLE RENDERS.
 *
 * This suite has never run: it mounted AdminPage with no AuthProvider and died
 * on `useAuth must be used within an AuthProvider` before reaching a single
 * assertion. Underneath that, its assertions looked for an "Admin Panel"
 * heading and an upload form that today's console does not have — written
 * against an older screen, never re-run, never noticed.
 *
 * What is here now is what only a mounted test can give: the console draws,
 * and it survives a backend that is unavailable or answering badly. The
 * question-set behaviour it used to reach for has its own suites
 * (questionSetUploadPanel, questionSetsPalette, sessionsPanel) which do run.
 */
describe('the admin console', () => {
  beforeEach(() => {
    localStorage.clear();
    window.history.pushState({}, '', '/admin');
    global.fetch.mockClear();
    global.fetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ questionSets: [], sets: [], games: [], prompts: [] }),
      text: async () => '{}',
    });
  });

  /*
    ASSERTED ON THE NAV, not on a section heading. The console opens on a
    landing view and its sections live behind those entries — an assertion on
    "AI Prompt Management" failed not because the console was broken but
    because that heading is one click away, and its text is split across an
    Icon and a text node besides. The nav is what proves the console drew.
  */
  // rejects: the console failing to render — the same blank-page class that hit
  //          the host page three times this week, on the screen a host opens
  //          BECAUSE something is wrong.
  test('it renders its sections', async () => {
    render(<AdminPage />);
    // `findAllByText`: the console names each section in the nav AND in the
    // breadcrumb, so a single-match query fails on a screen that is perfectly
    // correct. What matters is that the entries are there at all.
    expect((await screen.findAllByText(/Question sets/i)).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Sessions/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Prompts/i).length).toBeGreaterThan(0);
  });

  // rejects: an unreachable backend blanking the console. This is the screen
  //          somebody opens BECAUSE something is wrong, so it has to survive
  //          things being wrong.
  test('an unreachable API does not blank it', async () => {
    global.fetch.mockRejectedValue(new Error('network down'));
    render(<AdminPage />);
    expect((await screen.findAllByText(/Question sets/i)).length).toBeGreaterThan(0);
  });

  // rejects: a non-2xx being parsed as data and crashing the render.
  test('a 500 from every endpoint does not blank it', async () => {
    global.fetch.mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => { throw new Error('not json'); },
      text: async () => 'Internal Server Error',
    });
    render(<AdminPage />);
    expect((await screen.findAllByText(/Question sets/i)).length).toBeGreaterThan(0);
  });
});
