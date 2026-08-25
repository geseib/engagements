/**
 * DOES THE HOST PAGE SURVIVE CHANGING SCREENS?
 *
 *   "I tried launching a QuickStart game and it goes to a blank screen"
 *   "same thing. I need someone to go through fix and and test to make sure
 *    these errors are gone."
 *
 * Three product-down bugs in two days, all in this file, all with the same
 * symptom, and every one of them shipped past a green suite. The reason is
 * always the same sentence: GameHostPage has never been mounted by a test.
 *
 * IT WAS NEVER UNMOUNTABLE. Its own suite fails on
 * `useAuth must be used within an AuthProvider` — one mock. Every claim in this
 * repo that the component "cannot be rendered in jsdom" traces back to that,
 * and the claim then justified testing this file only by reading it as text.
 * Source scans catch the bug you already found; they do not catch the next one.
 * This mounts it.
 *
 * ── WHY THE TRANSITIONS ARE THE TEST ───────────────────────────────────────
 *
 * Both blank pages were ordering faults that only fire when the render path
 * CHANGES:
 *
 *   - a hook below an early return runs on the renders that get past the guard
 *     and not on the ones that stop at it, so React counts a different number
 *     of hooks and throws #310. Steady state on either screen is fine; the
 *     crossing is fatal.
 *   - a dependency array naming a later `const` throws on the very first
 *     render, which at least fails loudly everywhere.
 *
 * So the assertions here are about MOVING between screens: welcome → quickstart
 * → live game, and back. Rendering one screen and stopping would have passed
 * against both shipped bugs.
 *
 * ── WHAT IS MOCKED, AND WHY THAT IS HONEST ─────────────────────────────────
 *
 * Auth, the socket and fetch. None of them can produce or prevent a hook-order
 * fault: React counts hooks per component instance, and a mocked fetch changes
 * WHICH branch renders, never how many hooks a branch declares. What the mocks
 * buy is the ability to drive the state machine, which is the thing under test.
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

/**
 * A backend that says "nothing here yet" to everything.
 *
 * Deliberately minimal. This suite is about what the COMPONENT does when the
 * screen changes; a richer fixture would test the backend contract, which the
 * other suites already do, and would make a hook-order failure harder to read
 * among the noise.
 */
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

/**
 * Render errors reach the console rather than the test, because React catches
 * them to report them. #310 in particular is thrown, logged and then rethrown,
 * and jsdom's default handler swallows the second throw — so a test that only
 * asserted on the DOM would go green over a blank page. This is what makes the
 * failure visible.
 */
function captureRenderErrors() {
  const seen = [];
  const realError = console.error;
  jest.spyOn(console, 'error').mockImplementation((...args) => {
    seen.push(args.map(String).join(' '));
  });
  return {
    seen,
    hookOrderFailures: () => seen.filter((line) => (
      /Rendered more hooks|Rendered fewer hooks|change in the order of Hooks|Minified React error #3(00|01|10)/.test(line)
    )),
    restore: () => { console.error = realError; },
  };
}

describe('GameHostPage survives every screen change', () => {
  let errors;

  beforeEach(() => {
    localStorage.clear();
    window.history.pushState({}, '', '/host');
    installFetch();
    errors = captureRenderErrors();
  });

  afterEach(() => {
    errors.restore();
    jest.restoreAllMocks();
  });

  // rejects: a first-render crash — the temporal-dead-zone shape. A dependency
  //          array naming a `const` declared further down throws before
  //          anything paints, on every route.
  test('it mounts at all', () => {
    render(<GameHostPage />);
    expect(errors.hookOrderFailures()).toEqual([]);
    expect(document.body.textContent.trim()).not.toBe('');
  });

  /**
   * THE REPORTED JOURNEY, ALL THE WAY THROUGH.
   *
   * The first version of this test stopped at the Quick Start MENU and passed
   * against the broken code — because welcome and the menu are BOTH
   * early-return branches, and both render the same reduced set of hooks.
   * Nothing is wrong until the render gets past every guard into the live page,
   * which is the hop the owner described: *"once starting the quick start"*.
   *
   * So this drives the whole journey — welcome → menu → pick a set → live game —
   * and it is the hop at the end that does the work.
   */
  test('welcome → Quick Start → a started game does not change the hook count', async () => {
    installFetch({
      'admin/question-sets': {
        // `questionSets`, not `sets` — QuickstartMenu:44 reads that key, and a
        // fixture with the wrong one renders an empty menu that passes for the
        // wrong reason.
        questionSets: [{
          id: 'lessons-learned',
          name: 'Lessons learned',
          engagementType: 'call-and-answer',
          questionCount: 8,
          active: true,
          quickstart: true,
        }],
      },
    });
    render(<GameHostPage />);

    const quickStart = await screen.findByRole('button', { name: /quick start/i });
    await act(async () => { fireEvent.click(quickStart); });
    expect(errors.hookOrderFailures()).toEqual([]);

    // The set button carries the set's name. Clicking it creates the game and
    // hands `onGameCreated` back to the page, which clears every guard at once.
    const set = await screen.findByText(/lessons learned/i);
    await act(async () => {
      fireEvent.click(set.closest('button') || set);
      await Promise.resolve();
    });

    await waitFor(() => expect(errors.hookOrderFailures()).toEqual([]));
    // ...and the page is actually showing something, not a blank body.
    expect(document.body.textContent.trim()).not.toBe('');
  });

  // rejects: the crossing that actually reached a host — leaving the welcome
  //          screen for a live game. Every early-return guard clears at once
  //          here, so every hook below them starts running for the first time.
  test('welcome → a live game does not change the hook count', async () => {
    window.history.pushState({}, '', `/host?gameId=${GAME}`);
    const { rerender } = render(<GameHostPage />);

    await act(async () => { await Promise.resolve(); });
    rerender(<GameHostPage />);
    await waitFor(() => expect(errors.hookOrderFailures()).toEqual([]));
  });

  // rejects: a crash on the create dialog, which is another of the five guards
  //          and therefore another place a stray hook could hide.
  test('welcome → create engagement does not change the hook count', async () => {
    render(<GameHostPage />);

    const create = await screen.findByRole('button', { name: /engagement|create|new/i });
    await act(async () => { fireEvent.click(create); });
    expect(errors.hookOrderFailures()).toEqual([]);
  });
});

/*
 * THE ROUNDS TAB, AGAINST THE PAYLOAD THE SERVER ACTUALLY SENDS.
 *
 *   "i ran game 6105, and completed round 1 but the session rounds tab says
 *    'No rounds yet. They appear here once a round has been played.'"
 *
 * `roundsFrom` read `detailedQuestions` off the top of the response; the POST
 * route wraps it in `report`. Every unit test passed because its fixture was
 * INVENTED to match my reading of the client rather than copied from the
 * handler — so the client and the fixture agreed with each other and both
 * disagreed with the server.
 *
 * The empty result is what made it invisible: an unreadable envelope and a
 * session with no rounds produce the identical screen, so the defect reads as
 * data.
 *
 * This uses the literal envelope from create-report.js:674-681. A reader that
 * looks in the wrong place cannot pass it, whatever a fixture elsewhere
 * believes.
 */
describe('the Rounds tab shows a round that has been played', () => {
  const REPORT = {
    success: true,
    gameId: '6105',
    message: 'Game report created successfully',
    report: {
      detailedQuestions: [{
        questionNumber: '001',
        questionData: { title: 'What did we learn?', category: 'Lessons', detail: 'Round one' },
        answers: [{ answer: 'Ship smaller', playerName: 'Ada', rank: 1 }],
        voteStats: { totalAnswers: 1, totalVotes: 1 },
        aiSummary: { summaryText: 'The room agreed.' },
      }],
    },
  };

  // rejects: THE REPORTED BUG, read straight off the wire shape.
  test('the real response envelope yields the round', () => {
    // eslint-disable-next-line global-require
    const { roundsFrom } = require('../config/sessionHistory');
    const rounds = roundsFrom(REPORT);
    expect(rounds).toHaveLength(1);
    expect(rounds[0].title).toBe('What did we learn?');
    expect(rounds[0].number).toBe('001');
  });

  // rejects: the page fetching the wrong route or the wrong way. create-report
  //          is a POST; the GET route returns only a report already saved, so
  //          pointing at it leaves the tab empty for every session that has not
  //          generated one.
  test('the page asks the route that assembles the rounds', async () => {
    localStorage.clear();
    window.history.pushState({}, '', '/host?gameId=6105');
    installFetch({ '/report': REPORT });
    render(<GameHostPage />);
    await act(async () => { await Promise.resolve(); });

    const reportCalls = global.fetch.mock.calls.filter(([u]) => String(u).includes('/report'));
    for (const [, options] of reportCalls) {
      expect(options?.method).toBe('POST');
    }
  });
});
