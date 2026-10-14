/**
 * A HOST SCREEN WHOSE SESSION HAS ENDED SOMEWHERE ELSE (owner, 2026-10-12).
 *
 * Session 5479 on dev was ended at 15:42 UTC by POST /end from another screen.
 * The projector's host page stayed on the old round, and its Next Round came
 * back as a browser alert. The owner: "Maybe because the session was ended
 * elsewhere. Still would be nice to avoid and go to the report instead after
 * login."
 *
 * Pinned here, on the real page:
 *   - a host action refused because the session is over moves the screen to its
 *     ENDED phase (primary: Open Session Report), with a plain dock line and no
 *     alert;
 *   - coming back from an expired sign-in to a session that has ended opens its
 *     report, with one line saying why;
 *   - coming back to a session that is still live does NOT open the report,
 *     then or later;
 *   - no alert( is left on the host action paths this fixed.
 */
import React from 'react';
import fs from 'fs';
import path from 'path';
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
import { RESUME_KEY, __resetSessionExpiryForTests } from '../auth/sessionExpiry';
import { ENDED_ELSEWHERE, ENDED_AFTER_SIGN_IN } from '../utils/hostActionFailure';

const GAME = '5479';
let serverState = 'RESULTS#001';

const ok = (body) => ({ ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) });

function installFetch() {
  global.fetch = jest.fn(async (url, options) => {
    const u = String(url);
    const method = options?.method || 'GET';
    if (u.endsWith(`games/${GAME}`)) return ok({ started: true, gameType: 'trivia' });
    if (u.includes(`games/${GAME}/host-state`)) {
      return ok({
        state: serverState,
        currentQuestion: 1,
        gameMetadata: { gameType: 'trivia', title: 'Friday quiz' },
      });
    }
    if (u.includes(`games/${GAME}/next-question`) && method === 'POST') {
      // next-question.js for an ENDED session: 400, the state named in the body.
      const body = {
        error: 'Invalid state transition',
        message: "Cannot advance from state 'ENDED'. Use action 'skip' to force progression.",
        currentState: 'ENDED',
      };
      return { ok: false, status: 400, json: async () => body, text: async () => JSON.stringify(body) };
    }
    if (u.includes(`games/${GAME}/question?role=host`)) {
      return ok({ id: 'q1', title: 'Sample', questionDetail: 'Detail', optionA: 'A', optionB: 'B', optionC: 'C', optionD: 'D' });
    }
    return ok({});
  });
}

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  __resetSessionExpiryForTests();
  serverState = 'RESULTS#001';
  installFetch();
  window.alert = jest.fn();
  window.history.pushState({}, '', `/host?gameId=${GAME}`);
});

afterEach(() => {
  jest.restoreAllMocks();
});

/* RESULTS opens on the tally, whose primary is What We Heard; one press puts
   the read-back up, and its primary advances the round (Next Question for trivia, Next Round elsewhere) — the button the owner pressed. */
async function reachNextRound() {
  const heard = await screen.findByRole('button', { name: /what we heard/i }, { timeout: 5000 });
  await act(async () => { fireEvent.click(heard); });
  return screen.findByRole('button', { name: /next (round|question)/i }, { timeout: 5000 });
}

const reportWasRequested = () => global.fetch.mock.calls.some(([url]) => /report/i.test(String(url)));

describe('an action on a session that has ended elsewhere', () => {
  // rejects: "Failed to get next question: …" as a browser alert, and a host
  //          screen left on a round that no longer exists.
  test('Next Round switches the screen to the ended state, with the report as its one primary, and no alert', async () => {
    render(<GameHostPage />);
    const next = await reachNextRound();

    serverState = 'ENDED'; // ended from the remote while this screen sat open
    await act(async () => { fireEvent.click(next); });

    expect(await screen.findByText(ENDED_ELSEWHERE)).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: /open session report/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /next (round|question)/i })).toBeNull();
    expect(window.alert).not.toHaveBeenCalled();
    expect(document.body.textContent).not.toMatch(/HTTP 400|HTTP 401/);
  });
});

describe('coming back from an expired sign-in', () => {
  // rejects: a host who signed in again being put back on the stage of a
  //          session that is over, instead of on its report.
  test('to an ENDED session: the report opens, with one line saying why', async () => {
    serverState = 'ENDED';
    sessionStorage.setItem(RESUME_KEY, `/host?gameId=${GAME}`);
    render(<GameHostPage />);
    expect(await screen.findByText(ENDED_AFTER_SIGN_IN, {}, { timeout: 5000 })).toBeInTheDocument();
    await waitFor(() => expect(reportWasRequested()).toBe(true));
    expect(sessionStorage.getItem(RESUME_KEY)).toBeNull();
    expect(window.alert).not.toHaveBeenCalled();
  });

  // rejects: the marker outliving the return, so a host who ends a live session
  //          an hour later is thrown onto its report with "after sign-in" copy.
  test('to a LIVE session: the stage, not the report, and the marker is spent', async () => {
    sessionStorage.setItem(RESUME_KEY, `/host?gameId=${GAME}`);
    render(<GameHostPage />);
    await screen.findByRole('button', { name: /what we heard/i }, { timeout: 5000 });
    await waitFor(() => expect(sessionStorage.getItem(RESUME_KEY)).toBeNull());
    expect(screen.queryByText(ENDED_AFTER_SIGN_IN)).toBeNull();
    expect(reportWasRequested()).toBe(false);
  });
});

describe('no alert( on the host action paths', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'GameHostPage.jsx'), 'utf8');

  // The body of `const name = …` up to the next top-level `const … = ` in the
  // component, which is where every one of these handlers ends.
  const bodyOf = (name) => {
    const start = src.indexOf(`const ${name} = `);
    if (start < 0) throw new Error(`${name} not found in GameHostPage.jsx`);
    const rest = src.slice(start + 1);
    const end = rest.search(/\n {2}const [A-Za-z]+ = /);
    return rest.slice(0, end < 0 ? undefined : end);
  };
  const stripComments = (code) => code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

  test.each([
    'handleNextQuestion',
    'selectQuestion',
    'handleFinishQuestion',
    'handleShowResults',
    'toggleCategoryDuringGame',
    'runQueueOp',
    'handleAutoMove',
    'handleDisableQuestion',
    'handleRestoreQuestion',
    'regenerateRoundSummary',
    'endSessionNow',
  ])('%s says its failures without alert()', (name) => {
    expect(stripComments(bodyOf(name))).not.toMatch(/\balert\(/);
  });
});
