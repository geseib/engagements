/**
 * RESULTS, IDEAS FIRST ON THE ONE-SCREEN STAGE (owner, 16 Oct 2026,
 * docs/design/results-ideas-first version A): "the voting is less about the
 * people and more about getting the best or most relevant ideas to the top of
 * the conversation." The idea is the headline in full; a rank and a share bar
 * say how much the room backed it; the points and the name (only when the
 * round shows names) are a small credit; the top card is outlined; the
 * heading reads "What the room backed"; the people podium is off the results
 * (standings stay on the scoreboard, opened on demand).
 *
 * rejects: the three-names podium on RESULTS; the points as a big figure
 * beside the idea; a name or points while the round hides names.
 */
import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';

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

const GAME = '7862';
const LONG = 'Set the thermostat rule before the meeting starts, not halfway through it';

function installFetch(overrides) {
  global.fetch = jest.fn(async (url) => {
    const u = String(url);
    for (const [pattern, body] of Object.entries(overrides)) {
      const hit = pattern.endsWith('$') ? u.endsWith(pattern.slice(0, -1)) : u.includes(pattern);
      if (hit) {
        if (pattern === 'games/get-results') await new Promise((r) => setTimeout(r, 50));
        return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) };
      }
    }
    return { ok: true, status: 200, json: async () => ({}), text: async () => '{}' };
  });
}

const tally = (playerName, answerText, totalScore, firstPlace) => ({
  playerName, answerText, totalScore, firstPlace, secondPlace: 0, thirdPlace: 0,
});

const mount = async ({ anonymous }) => {
  installFetch({
    [`games/${GAME}$`]: { started: true, anonymousUntilReveal: anonymous },
    [`games/${GAME}/host-state`]: {
      state: 'RESULTS#002',
      currentQuestion: 2,
      stageBeat: 'results',
      authorsRevealed: !anonymous,
      gameMetadata: { gameType: 'call-and-answer', title: 'Temperature', anonymousUntilReveal: anonymous },
      currentQuestionData: { id: 'q2', title: 'Temperature control', questionDetail: 'Say it in one line' },
    },
    [`games/${GAME}/question?role=host`]: { id: 'q2', title: 'Temperature control', questionDetail: 'Say it in one line' },
    'games/get-players': { players: [{ name: 'Ada', score: 16 }, { name: 'Ben', score: 12 }, { name: 'Cleo', score: 8 }], scoresAfterRound: 2 },
    'games/get-results': {
      gameType: 'call-and-answer',
      voteTallies: {
        0: tally('Ben', 'Cool the room when the argument heats up', 6, 1),
        1: tally('Ada', LONG, 8, 2),
        2: tally('Cleo', 'Name the temperature out loud', 4, 0),
      },
    },
  });
  window.history.pushState({}, '', `/host?gameId=${GAME}`);
  render(<GameHostPage />);
  await screen.findByRole('button', { name: /session panel/i }, { timeout: 5000 });
  await waitFor(() => {
    expect(document.querySelectorAll('.cards .card .ans').length).toBe(3);
  }, { timeout: 5000 });
};

beforeEach(() => {
  localStorage.clear();
  jest.restoreAllMocks();
});

test('named round: the idea leads in full, the credit is small, the top card outlined, no podium', async () => {
  await mount({ anonymous: false });
  const cards = [...document.querySelectorAll('.cards .card')];
  expect(cards[0].querySelector('.ans').textContent).toBe(LONG);
  expect(cards[0]).toHaveClass('lead');
  expect(cards[0].querySelector('.who').textContent).toBe('8 points — Ada');
  expect(cards[0].querySelector('.share').style.width).toBe('100%');
  expect(cards[1].querySelector('.share').style.width).toBe('75%');
  // No big points figure beside the idea.
  expect(document.querySelector('.cards .tally')).toBeNull();
  // The people podium is off the results.
  expect(document.querySelector('.podium')).toBeNull();
  expect(screen.getByText('What the room backed')).toBeInTheDocument();
}, 15000);

test('hidden round: no name and no points, the share bar stays', async () => {
  await mount({ anonymous: true });
  const cards = [...document.querySelectorAll('.cards .card')];
  expect(document.querySelector('.cards').textContent).not.toMatch(/Ada|Ben|Cleo|points/);
  expect(cards[0].querySelector('.share')).not.toBeNull();
}, 15000);

/* PUT THE QUESTION ON THE WALL (owner, 16 Oct 2026): on the stage, where the
   cards put a response up, the question line above them puts the question up. */
test('the question line above the cards puts the question up', async () => {
  await mount({ anonymous: false });
  const q = screen.getByRole('button', { name: 'Show the question on the screen' });
  expect(q.textContent).toBe('Temperature control');
  expect(document.querySelector('.expanded-lesson-overlay')).toBeNull();
  fireEvent.click(q);
  expect(document.querySelector('.expanded-lesson-overlay')).not.toBeNull();
}, 15000);
