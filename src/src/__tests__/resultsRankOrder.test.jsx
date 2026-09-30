/**
 * CALL & ANSWER RESULTS, IN RANK ORDER — config/podium.js `assignPlacements`
 * and the host stage that draws its rows (QA drive 2026-09-29, finding #20).
 *
 * Reproduced in both rooms on Day 2: the rows came out in the server's order,
 * which read as vote count, while the 1st/2nd/3rd labels came from points —
 * so on a vote tie "4th" (+3, 2 votes) sat above "3rd" (+4, 2 votes). Harbor
 * read 1st, 2nd, 4th, 3rd, 5th; Brightline 1st, 2nd, 5th, 3rd, 3rd.
 *
 * rejects: a row labelled Nth above one labelled N−1; the order depending on
 * what order the server sent; ties on points broken any way but votes, then
 * arrival; the stage re-ordering what assignPlacements returned.
 */
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { assignPlacements, placeLabel } from '../config/podium';

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

const row = (player, points, votes) => ({ player, playerName: player, answer: `${player}'s answer`, points, votes });

// The two rooms, in the order the stage drew them (votes descending).
const HARBOR = [row('Ben', 13, 5), row('Jordan', 8, 4), row('Maya', 3, 2), row('Rosa', 4, 2), row('Tasha', 2, 2)];
const BRIGHTLINE = [row('Alex', 11, 5), row('Chloe', 8, 4), row('Omar', 3, 2), row('Priti', 4, 2), row('Sam', 4, 2)];

const labels = (rows) => rows.map((r) => placeLabel(r.placement));

describe('assignPlacements returns the rows in place order', () => {
  test('Harbor: a vote tie no longer puts 4th above 3rd', () => {
    const out = assignPlacements(HARBOR);
    expect(out.map((r) => r.player)).toEqual(['Ben', 'Jordan', 'Rosa', 'Maya', 'Tasha']);
    expect(labels(out)).toEqual(['1st', '2nd', '3rd', '4th', '5th']);
  });

  test('Brightline: the shared 3rd sits together, then 5th', () => {
    const out = assignPlacements(BRIGHTLINE);
    expect(out.map((r) => r.player)).toEqual(['Alex', 'Chloe', 'Priti', 'Sam', 'Omar']);
    expect(labels(out)).toEqual(['1st', '2nd', '3rd', '3rd', '5th']);
  });

  test('equal points: more votes first, then the order the server sent', () => {
    const out = assignPlacements([row('A', 4, 1), row('B', 4, 3), row('C', 4, 3), row('D', 4, 2)]);
    expect(out.map((r) => r.player)).toEqual(['B', 'C', 'D', 'A']);
    expect(out.every((r) => r.placement === 1)).toBe(true);
  });

  test('unplaced rows (no points) keep the quiet dot and sink to the bottom', () => {
    const out = assignPlacements([row('Z', 0, 0), row('Y', 2, 1), row('X', 0, 0)]);
    expect(out.map((r) => r.player)).toEqual(['Y', 'Z', 'X']);
    expect(labels(out)).toEqual(['1st', '·', '·']);
  });

  test('whatever order the server sends, a label never sits above a better one', () => {
    // Every rotation and the reverse of both rooms: same result each time.
    for (const room of [HARBOR, BRIGHTLINE]) {
      const expected = assignPlacements(room).map((r) => r.placement);
      const orders = [[...room].reverse()];
      for (let k = 1; k < room.length; k += 1) orders.push([...room.slice(k), ...room.slice(0, k)]);
      for (const order of orders) {
        const places = assignPlacements(order).map((r) => r.placement).filter((p) => p > 0);
        places.forEach((p, i) => { if (i > 0) expect(p).toBeGreaterThanOrEqual(places[i - 1]); });
        expect(assignPlacements(order).map((r) => r.placement)).toEqual(expected);
      }
    }
  });

  test('the input is not mutated', () => {
    const input = [...HARBOR];
    assignPlacements(input);
    expect(input.map((r) => r.player)).toEqual(HARBOR.map((r) => r.player));
    expect(input[0].placement).toBeUndefined();
  });
});

/* ---------------------------------------------------------------- mounted */

const GAME = '7861';

function installFetch(overrides) {
  global.fetch = jest.fn(async (url) => {
    const u = String(url);
    for (const [pattern, body] of Object.entries(overrides)) {
      const hit = pattern.endsWith('$') ? u.endsWith(pattern.slice(0, -1)) : u.includes(pattern);
      if (hit) {
        // The results read lands a beat after host-state, as it does over a
        // network: the page files rows under the state it has rendered
        // (stageAnswersKey against gameStateRef), and an instant mock beats
        // that render.
        if (pattern === 'games/get-results') await new Promise((r) => setTimeout(r, 50));
        return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) };
      }
    }
    return { ok: true, status: 200, json: async () => ({}), text: async () => '{}' };
  });
}

// voteTallies as get-results sends them: keyed by answer index, which is not
// place order — Maya (+3) arrives before Rosa (+4).
const tally = (playerName, totalScore, firstPlace, secondPlace, thirdPlace) => ({
  playerName, answerText: `${playerName}'s answer`, totalScore, firstPlace, secondPlace, thirdPlace,
});

beforeEach(() => {
  localStorage.clear();
  jest.restoreAllMocks();
});

test('the host stage draws the RESULTS rows in the order of their labels', async () => {
  installFetch({
    [`games/${GAME}$`]: { started: true },
    [`games/${GAME}/host-state`]: {
      state: 'RESULTS#001',
      currentQuestion: 1,
      stageBeat: 'results',
      gameMetadata: { gameType: 'call-and-answer', title: 'Harbor' },
      currentQuestionData: {
        id: 'q1', title: 'How we want to work together', questionDetail: 'Say it in one line', category: 'How we say it',
      },
    },
    [`games/${GAME}/question?role=host`]: {
      id: 'q1', title: 'How we want to work together', questionDetail: 'Say it in one line',
    },
    'games/get-results': {
      gameType: 'call-and-answer',
      voteTallies: {
        0: tally('Ben', 13, 3, 2, 0),
        1: tally('Jordan', 8, 1, 2, 1),
        2: tally('Maya', 3, 0, 1, 1),
        3: tally('Rosa', 4, 1, 0, 1),
        4: tally('Tasha', 2, 0, 0, 2),
      },
    },
  });
  window.history.pushState({}, '', `/host?gameId=${GAME}`);
  render(<GameHostPage />);
  await screen.findByRole('button', { name: /session panel/i }, { timeout: 5000 });

  await waitFor(() => {
    expect(document.querySelectorAll('.card .rank').length).toBe(5);
  }, { timeout: 5000 });
  const ranks = [...document.querySelectorAll('.card .rank')].map((el) => el.textContent);
  expect(ranks).toEqual(['1st', '2nd', '3rd', '4th', '5th']);
  const answers = [...document.querySelectorAll('.card .ans')].map((el) => el.textContent);
  expect(answers[2]).toContain('Rosa');
  expect(answers[3]).toContain('Maya');
});
