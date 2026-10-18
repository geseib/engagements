/**
 * VOTING AND THE QR ON THE ONE-SCREEN STAGE, MOUNTED (owner, 18 Oct 2026,
 * docs/design/room-content-v2 frames 4, 9-11).
 *
 *   "same goes for the results and the voting its nice to see a bar chart
 *    results but not at the expense of seeing what was voted on."
 *
 *   "i like this idea whenever the host wants to show the qr code. it moves
 *    the screen around a bit so all content is there but the qr code is
 *    avail."
 *
 * Voting: the title is the reminder, every answer whole and numbered; no
 * name, points or rank (owner, 2026-10-12). A card opens the answer with its
 * number and chips (frame 11); → / ← step; Esc goes back to all.
 * The QR: the host's show-QR control puts a side panel up beside the content
 * and sends `{ join: true }` to /stage-focus; pressing again takes it down
 * with `{ join: false }`. A restored `stageFocus.join` (or a legacy
 * `focus: 'join'`) brings it back up.
 */
import React from 'react';
import {
  render, screen, waitFor, fireEvent, act,
} from '@testing-library/react';

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

const GAME = '5150';
const ok = (body) => ({ ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) });
// Longer than the spotlight's part budget on every profile (2 x the room
// content's per-answer overview budget, at most 480 characters).
const LONG = 'Our reorg went badly because there was not one. Teams changed on a Monday: new managers, new on-call, new standups, all at once. Nobody had a week where both the old and the new team existed. Every question that used to go down the hall went nowhere. It took us most of a quarter to rebuild what a two-week overlap would have kept. Next time we will run the old and new structures side by side for a fortnight. We will name a contact on each side for every open question. And we will not move the on-call rota in the same week as the reporting lines.';
const ANSWERS = [
  { answer: 'We moved to a two-week shadow mode.', playerName: 'Ada', playerId: 'p1', points: 0 },
  { answer: 'New hires get a buddy for their first on-call.', playerName: 'Ben', playerId: 'p2', points: 0 },
  { answer: LONG, playerName: 'Cleo', playerId: 'p3', points: 0 },
];

const mount = async ({ stageFocus = null } = {}) => {
  global.fetch = jest.fn(async (url) => {
    const u = String(url);
    if (u.endsWith(`games/${GAME}`)) return ok({ started: true, gameType: 'call-and-answer' });
    if (u.includes(`games/${GAME}/host-state`)) {
      return ok({
        state: 'VOTE#003',
        currentQuestion: 3,
        gameMetadata: { gameType: 'call-and-answer', title: 'Offsite' },
        votingProgress: { votesReceived: 1, totalPlayers: 3, votersIds: ['p1'] },
        currentQuestionData: { id: 'q3', title: 'THE IMPORTANCE OF THRESHOLDS', questionDetail: 'A lesson.' },
        ...(stageFocus ? { stageFocus } : {}),
      });
    }
    if (u.includes(`games/${GAME}/answers/host`)) {
      // A network's worth of delay: the page lets VOTE rows in only once the
      // stage is on that vote (stageAnswersKey), which a fast mock can beat
      // under a loaded test run.
      await new Promise((r) => setTimeout(r, 250));
      return ok({ answers: ANSWERS });
    }
    if (u.includes(`games/${GAME}/question?role=host`)) {
      return ok({ id: 'q3', title: 'THE IMPORTANCE OF THRESHOLDS', questionDetail: 'A lesson.' });
    }
    return ok({});
  });
  window.history.pushState({}, '', `/host?gameId=${GAME}`);
  const view = render(<GameHostPage />);
  await waitFor(() => expect(document.querySelectorAll('.cards.is-ballot .card').length).toBe(3), { timeout: 8000 });
  return view;
};

const focusPosts = () => global.fetch.mock.calls
  .filter(([u, o]) => String(u).endsWith(`games/${GAME}/stage-focus`) && o && o.method === 'POST')
  .map(([, o]) => JSON.parse(o.body));

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  window.alert = jest.fn();
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
  localStorage.clear();
});

test('voting: the title the reminder, every answer whole and numbered, no name, points or rank', async () => {
  await mount();
  expect(document.querySelector('.q-remind').textContent).toBe('The Importance of Thresholds');
  const cards = [...document.querySelectorAll('.cards.is-ballot .card')];
  expect(cards.map((c) => c.querySelector('.num').textContent)).toEqual(['1', '2', '3']);
  // Whole: the long answer is not cut, quoted or clamped by the markup.
  expect(cards[2].querySelector('.ans').textContent).toBe(LONG);
  const ballot = document.querySelector('.cards.is-ballot');
  expect(ballot.getAttribute('data-rc')).toBe('lead');
  expect(ballot.textContent).not.toMatch(/Ada|Ben|Cleo|points|Response \d|1st|2nd/);
  expect(ballot.querySelector('.rank, .who, .fill, .share')).toBeNull();
}, 15000);

test('a card opens the answer with its number and chips; → steps (through the parts of a long one); Esc goes back', async () => {
  await mount();
  fireEvent.click(document.querySelectorAll('.cards.is-ballot .card')[1]);
  const spot = () => document.querySelector('.answer-spotlight.is-vote');
  await waitFor(() => expect(spot()).not.toBeNull());
  expect(spot().querySelector('.answer-spotlight__num').textContent).toBe('2');
  expect(spot().querySelector('.answer-spotlight__count').textContent).toBe('answer 2 of 3');
  const chips = [...spot().querySelectorAll('.answer-spotlight__chip')];
  expect(chips.map((c) => c.textContent)).toEqual(['1', '2', '3']);
  expect(chips[1]).toHaveClass('is-on');
  expect(spot().textContent).not.toMatch(/Ada|Ben|Cleo|Response \d/);

  await act(async () => { fireEvent.keyDown(document, { key: 'ArrowRight' }); });
  await waitFor(() => expect(spot().querySelector('.answer-spotlight__num').textContent).toBe('3'));
  // The long one splits into parts and → walks them before it moves on.
  const part = spot().querySelector('.answer-spotlight__part');
  expect(part).not.toBeNull();
  expect(part.textContent).toMatch(/^Part 1 of \d$/);
  const first = spot().querySelector('.answer-spotlight__text').textContent;
  expect(LONG.startsWith(first)).toBe(true);
  expect(first.length).toBeLessThan(LONG.length);
  await act(async () => { fireEvent.keyDown(document, { key: 'ArrowRight' }); });
  expect(spot().querySelector('.answer-spotlight__part').textContent).toMatch(/^Part 2 of \d$/);

  // A chip is a way to an answer.
  await act(async () => { fireEvent.click(spot().querySelectorAll('.answer-spotlight__chip')[0]); });
  await waitFor(() => expect(spot().querySelector('.answer-spotlight__num').textContent).toBe('1'));

  await act(async () => { fireEvent.keyDown(document, { key: 'Escape' }); });
  expect(spot()).toBeNull();
  expect(document.querySelectorAll('.cards.is-ballot .card')).toHaveLength(3);
}, 15000);

test('show the QR: a side panel beside the content, not a takeover; again takes it down; each press reaches /stage-focus', async () => {
  await mount();
  const code = screen.getByRole('button', { name: /Show the join QR code/ });
  await act(async () => { fireEvent.click(code); });
  const panel = await screen.findByTestId('stage-join-panel');
  expect(panel.textContent).toContain('Scan to join · no app, no account');
  expect(panel.querySelector('.qr')).not.toBeNull();
  expect(panel.querySelector('.stage-join-code').textContent).toBe(GAME);
  // Nothing leaves the screen: the answers are still drawn beside it.
  expect(document.querySelector('.content[data-join]')).not.toBeNull();
  expect(document.querySelectorAll('.cards.is-ballot .card')).toHaveLength(3);
  // ...and the full-screen overlay is not drawn.
  expect(document.querySelector('.expanded-qr-overlay')).toBeNull();
  expect(focusPosts()).toContainEqual({ join: true, questionNumber: 3 });

  await act(async () => { fireEvent.keyDown(document, { key: 'j' }); });
  expect(screen.queryByTestId('stage-join-panel')).toBeNull();
  expect(document.querySelector('.content[data-join]')).toBeNull();
  expect(focusPosts()).toEqual([{ join: true, questionNumber: 3 }, { join: false, questionNumber: 3 }]);
}, 15000);

test.each([
  ['the join fact', { focus: 'none', index: null, join: true, rev: 4 }],
  ['a legacy join focus', { focus: 'join', index: null, rev: 4 }],
])('a restore with %s puts the side panel back up', async (label, stageFocus) => {
  await mount({ stageFocus });
  expect(await screen.findByTestId('stage-join-panel')).toBeInTheDocument();
  expect(document.querySelector('.expanded-qr-overlay')).toBeNull();
}, 15000);
