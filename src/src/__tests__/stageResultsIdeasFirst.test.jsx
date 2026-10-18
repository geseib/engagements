/**
 * RESULTS, IDEAS FIRST ON THE ONE-SCREEN STAGE (owner, 16 Oct 2026,
 * docs/design/results-ideas-first version A): "the voting is less about the
 * people and more about getting the best or most relevant ideas to the top of
 * the conversation." Redrawn 18 Oct 2026 (docs/design/room-content-v2 frame
 * 5): "nice to see a bar chart results but not at the expense of seeing what
 * was voted on. think of what is important to take away and discuss."
 *
 * The title is the reminder; the top idea is in full in a card marked "The
 * room's pick"; the runners-up keep their text, each with its bar as the fill
 * behind it, relative to the pick; the points and the name are a small credit
 * only when the round shows names; "and N more answers"; the talk line at the
 * foot; the people podium is off the results (standings stay on the
 * scoreboard, opened on demand).
 *
 * rejects: the three-names podium on RESULTS; the points as a big figure
 * beside the idea; a name, points, count or percentage while the round hides
 * names; the winning text clamped or dropped for the sake of the chart.
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
import { TALK_LINE } from '../config/roomContent';
import { ROOM_RESULTS_PAGE } from '../components/stage/roomPaging';
import { loadProfile } from '../config/displayProfile';

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

const mount = async ({ anonymous, extra = 0 }) => {
  const more = {};
  for (let i = 0; i < extra; i += 1) more[3 + i] = tally(`P${i}`, `Another idea number ${i + 1}`, 0, 0);
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
        ...more,
      },
    },
  });
  window.history.pushState({}, '', `/host?gameId=${GAME}`);
  render(<GameHostPage />);
  await screen.findByRole('button', { name: /session panel/i }, { timeout: 5000 });
  await waitFor(() => {
    expect(document.querySelectorAll('.cards .card .ans').length).toBeGreaterThanOrEqual(3);
  }, { timeout: 5000 });
};

beforeEach(() => {
  localStorage.clear();
  jest.restoreAllMocks();
});

test('named round: the pick in full in its own card, the credit and points small, runners with their text, no podium', async () => {
  await mount({ anonymous: false });
  const cards = [...document.querySelectorAll('.cards .card')];
  // The pick: in full, marked "The room's pick", outlined (.lead), no bar of its own.
  expect(cards[0].querySelector('.ans').textContent).toBe(LONG);
  expect(cards[0]).toHaveClass('lead');
  expect(cards[0]).toHaveClass('is-pick');
  expect(cards[0].querySelector('.pick-k').textContent).toBe("The room's pick");
  expect(cards[0].querySelector('.who').textContent).toBe('8 points — Ada');
  expect(cards[0].querySelector('.fill')).toBeNull();
  // A runner keeps its text; its bar is the fill behind it, relative to the pick.
  expect(cards[1]).toHaveClass('is-runner');
  expect(cards[1].querySelector('.ans').textContent).toBe('Cool the room when the argument heats up');
  expect(cards[1].querySelector('.fill').style.width).toBe('75%');
  expect(cards[1].querySelector('.rank').textContent).toBe('2nd');
  // No big points figure beside the idea, and no podium.
  expect(document.querySelector('.cards .tally')).toBeNull();
  expect(document.querySelector('.podium')).toBeNull();
  // The title is the reminder; the talk line is at the foot and may give way.
  expect(document.querySelector('.q-remind').textContent).toBe('Temperature control');
  const talk = document.querySelector('.talk');
  expect(talk.textContent).toContain(TALK_LINE);
  expect(talk.getAttribute('data-drop')).toBe('3');
  expect(talk.getAttribute('data-drop-note')).toBe('Talk about it');
}, 15000);

test('hidden round: every answer\'s text, the bars behind them, and not one name, point, count or percentage', async () => {
  await mount({ anonymous: true });
  const list = document.querySelector('.cards');
  const cards = [...list.querySelectorAll('.card')];
  expect(cards.map((c) => c.querySelector('.ans').textContent)).toEqual([
    LONG, 'Cool the room when the argument heats up', 'Name the temperature out loud',
  ]);
  // Places ("2nd") are allowed; any other figure is not.
  const words = cards.map((c) => [...c.childNodes].filter((n) => !(n.classList && n.classList.contains('rank'))).map((n) => n.textContent).join(' ')).join(' ');
  expect(words).not.toMatch(/Ada|Ben|Cleo|points?\b|votes?\b|%|\d/);
  expect(cards[1].querySelector('.fill')).not.toBeNull();
  expect(cards[0].querySelector('.who')).toBeNull();
}, 15000);

test('more answers than the page: "and N more answers" under the runners-up, the rest a page away', async () => {
  await mount({ anonymous: true, extra: 6 });
  // The profile's page (components/stage/roomPaging.js ROOM_RESULTS_PAGE:
  // jsdom's narrow window reads as Table, 5); the other four are a page away.
  const shown = document.querySelectorAll('.cards .card').length;
  expect(shown).toBe(ROOM_RESULTS_PAGE[loadProfile(window.localStorage, window.innerWidth)] || ROOM_RESULTS_PAGE.table);
  expect(document.querySelector('.more-answers').textContent).toBe(`and ${9 - shown} more answers`);
}, 15000);

/* PUT THE QUESTION ON THE WALL (owner, 16 Oct 2026): on the stage, where the
   cards put a response up, the question line above them puts the question up. */
test('the question line above the cards puts the question up, and the fitter may not drop it', async () => {
  await mount({ anonymous: false });
  const q = screen.getByRole('button', { name: 'Show the question on the screen' });
  expect(q.textContent).toBe('Temperature control');
  expect(q.hasAttribute('data-drop')).toBe(false);
  expect(document.querySelector('.expanded-lesson-overlay')).toBeNull();
  fireEvent.click(q);
  expect(document.querySelector('.expanded-lesson-overlay')).not.toBeNull();
}, 15000);

/* ONE RESULT, PUT UP (frame 12): its place and a ladder of bars beside it,
   with no figures while names are hidden. */
test('a result put up shows its place and where it sits on the ladder, with no figures when names are hidden', async () => {
  await mount({ anonymous: true });
  fireEvent.click(document.querySelectorAll('.cards .card')[1]);
  const spot = await waitFor(() => {
    const el = document.querySelector('.answer-spotlight.is-result');
    expect(el).not.toBeNull();
    return el;
  });
  expect(spot.querySelector('.answer-spotlight__place').textContent).toBe('2nd');
  const rungs = [...spot.querySelectorAll('.answer-spotlight__rung')];
  expect(rungs).toHaveLength(3);
  expect(rungs[0]).toHaveClass('is-pick');
  expect(rungs[1]).toHaveClass('is-here');
  expect(spot.querySelector('.answer-spotlight__tally')).toBeNull();
  expect(spot.textContent).not.toMatch(/Ada|Ben|Cleo|points|votes|%/);
}, 15000);

/* The top idea's points are found once over the whole round, not once per
   card (review of the 16 Oct batch, finding 3). The bar widths above prove
   the value; this pins where it is computed. */
test('the bars read one top-points value, computed outside the cards', () => {
  // eslint-disable-next-line global-require
  const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'GameHostPage.jsx'), 'utf8');
  const cards = src.slice(src.indexOf('<div className="cards is-ideas"'));
  const mapBody = cards.slice(0, cards.indexOf('{resultsMore > 0'));
  expect(mapBody).toMatch(/resultsTopPoints/);
  expect(mapBody).not.toMatch(/answers\.reduce/);
  expect(src.indexOf('const resultsTopPoints')).toBeLessThan(src.indexOf('<div className="cards is-ideas"'));
});
