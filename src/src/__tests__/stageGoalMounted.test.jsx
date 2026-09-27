/**
 * THE GOAL, FROM A REAL MOUNT OF GameHostPage (events M1b, Task 5, fix round 1).
 *
 * stageGoalWiring.test.js reads GameHostPage.jsx as TEXT — it would still pass
 * if the restore sat in a dead branch, or if the goal's fetch quietly moved
 * back to the public /state door. This file is the behavioural check: mount
 * the real page, the way sessionPanelMounted.test.jsx does (three mocks — auth,
 * authFetch, WebSocketClient — are enough), feed it a host-state response that
 * carries `target` and a round, and read the two places the goal is supposed
 * to land: the dock's status line and the SESSION panel's Questions tab.
 *
 * rejects: the notice missing from the dock on the goal's own RESULTS; the
 * primary disabled by it; the panel's progress line missing or wrong; the
 * notice bleeding into a round that has not reached the goal yet.
 */
import React from 'react';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';

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
const GOAL_LINE = 'That’s your 5. Keep going if there’s time, or end the session.';

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
 * Mounts the real host page on a host-state response the caller supplies.
 * Mirrors sessionPanelMounted.test.jsx's own `renderLiveGame`.
 */
async function renderLiveGame(hostState, { restoredText } = {}) {
  installFetch({
    [`games/${GAME}$`]: { started: true },
    [`games/${GAME}/host-state`]: hostState,
    [`games/get-results`]: { gameType: 'trivia', answers: [] },
    [`games/${GAME}/question?role=host`]: hostState.currentQuestionData || {
      id: 'qx', title: 'Q', questionDetail: 'D',
      optionA: 'A', optionB: 'B', optionC: 'C', optionD: 'D',
    },
  });
  window.history.pushState({}, '', `/host?gameId=${GAME}`);
  render(<GameHostPage />);
  await screen.findByRole('button', { name: /session panel/i }, { timeout: 5000 });
  // Something only the restored session can put on screen means host-state
  // has been read and restored — the loading gate `\` obeys is down and the
  // goal is known. Each case names its own (RESULTS restates a question
  // differently from ASK).
  if (restoredText) {
    await screen.findAllByText(restoredText, {}, { timeout: 5000 });
  }
}

/** The Questions tab's own progress line, opened the way a host would: `\`. */
async function openGoalProgress() {
  await act(async () => { fireEvent.keyDown(document.body, { key: '\\' }); });
  fireEvent.click(await screen.findByRole('tab', { name: 'Questions' }, { timeout: 5000 }));
  return screen.findByTestId('goal-progress', {}, { timeout: 5000 });
}

/*
  The SESSION button renders before host-state has been read and restored, so
  awaiting it alone leaves the page mid-restore. Under the full suite's load
  that read lands after the assertions — the dock still reads its pre-restore
  status — which is why this file passed alone and failed in the full run.
  Wait for the restore itself: the dock's status to carry the given words.
*/
async function dockStatusContains(text) {
  await waitFor(() => {
    const status = document.querySelector('.dock .status');
    expect(status && status.textContent).toContain(text);
  }, { timeout: 5000 });
  return document.querySelector('.dock .status');
}

beforeEach(() => {
  localStorage.clear();
  jest.restoreAllMocks();
});

describe('the goal, mounted (events M1b, Task 5 fix round 1)', () => {
  test('the goal round\'s RESULTS: the dock says it, the primary stays live, the panel says reached', async () => {
    await renderLiveGame({
      state: 'RESULTS#005',
      currentQuestion: 5,
      stageBeat: 'results',
      target: 5,
      gameMetadata: { gameType: 'trivia', title: 'T' },
      currentQuestionData: {
        id: 'q5', title: 'Q5', questionDetail: 'Detail 5', category: 'General',
        optionA: 'A', optionB: 'B', optionC: 'C', optionD: 'D',
        correctAnswer: 'OptionA', answerDetails: 'Because A is right.',
      },
    });

    const status = await dockStatusContains(GOAL_LINE);
    expect(status).not.toBeNull();

    const primary = document.querySelector('.dock .host-action-bar__primary');
    expect(primary).not.toBeNull();
    expect(primary.disabled).toBe(false);

    const progress = await openGoalProgress();
    expect(progress).toHaveTextContent('Question 5 of 5 · goal reached');
  });

  test('a round short of the goal: the panel counts up, the dock says nothing about it', async () => {
    await renderLiveGame({
      state: 'ASK#006',
      currentQuestion: 6,
      target: 5,
      gameMetadata: { gameType: 'trivia', title: 'T' },
      currentQuestionData: {
        id: 'q6', title: 'Q6', questionDetail: 'Detail 6',
        optionA: 'A', optionB: 'B', optionC: 'C', optionD: 'D',
      },
    }, { restoredText: 'Detail 6' });

    // The panel's count proves host-state was restored (the goal is known);
    // only then is the dock's silence about the goal evidence of anything.
    const progress = await openGoalProgress();
    await waitFor(() => expect(progress).toHaveTextContent('Question 6 · your goal was 5'), { timeout: 5000 });

    const status = document.querySelector('.dock .status');
    expect(status).not.toBeNull();
    expect(status.textContent).not.toContain(GOAL_LINE);
    expect(status.textContent).not.toContain('Keep going');
  });
});
