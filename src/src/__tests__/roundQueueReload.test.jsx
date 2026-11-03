/**
 * THE ROUND QUEUE AFTER A RELOAD (owner, dev, 3 Nov 2026): "when i refresh the
 * host screen in 2 screen mode, the rounds list doesn't list correctly. only
 * when i click rounds and questions".
 *
 * The rail's Round queue is built from three reads — the rounds played
 * (POST /report), the server's plan (GET /up-next) and the running order with
 * the host's own questions (GET /queue). Only the last was read on load; the
 * other two waited for the Session menu to open, so a reload mid-session left
 * the rail with the round on screen and nothing either side of it. One loader
 * now reads all three on load, on every round, and when the menu opens, and
 * the plan is re-read when the other surface changes the queue.
 *
 * rejects: a rail that needs the Session menu opened before it lists played
 * and planned rounds; a rail and a Running order numbering apart after load
 * or after a queue change from the phone.
 */
import React from 'react';
import { render, screen, act, waitFor, within } from '@testing-library/react';

const LOAD_WAIT = 15000;

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
import webSocketClient from '../WebSocketClient';

const GAME = '5482';
const ok = (body) => ({ ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) });

const NOW_TITLE = 'The Sync Deal That Changed the Catalogue';
const OWN = { key: 'own:a1', title: 'Who is our customer', status: 'queued' };
const REPORT = {
  success: true,
  gameId: GAME,
  report: {
    detailedQuestions: [{
      questionNumber: '001',
      questionData: { title: 'Shelved for Three Years', category: 'Catalogue' },
      answers: [],
      voteStats: { totalAnswers: 0, totalVotes: 0 },
    }],
  },
};
const PLAN = [
  { source: 'own', questionId: 'own:a1', title: OWN.title, round: 3 },
  { source: 'auto', questionId: 'QUESTION#c003#001', title: 'Second auto', round: 4 },
  { source: 'auto', questionId: 'QUESTION#c004#001', title: 'Third auto', round: 5 },
];
let upNext = PLAN;
let queue = ['own:a1'];

beforeAll(() => {
  global.ResizeObserver = global.ResizeObserver || class { observe() {} disconnect() {} unobserve() {} };
});

beforeEach(() => {
  upNext = PLAN;
  queue = ['own:a1'];
  localStorage.clear();
  sessionStorage.clear();
  localStorage.setItem('engage.surfaces', 'two');
  window.alert = jest.fn();
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'trace').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
  // A reload: the page arrives with only the session in the address.
  window.history.pushState({}, '', `/host?gameId=${GAME}`);
  global.fetch = jest.fn(async (url) => {
    const u = String(url);
    if (u.endsWith(`games/${GAME}`)) return ok({ started: true, gameType: 'call-and-answer' });
    if (u.includes(`games/${GAME}/host-state`)) {
      return ok({
        state: 'ASK#002',
        currentQuestion: 2,
        gameMetadata: { gameType: 'call-and-answer', title: 'Relay expansion' },
        presenting: 1,
        presentDetail: { open: true, fullscreen: true, visible: true, statusAt: new Date().toISOString() },
      });
    }
    if (u.includes(`games/${GAME}/question?role=host`)) {
      return ok({ id: 'c002#001', title: NOW_TITLE, questionDetail: 'What changed?' });
    }
    if (u.includes(`games/${GAME}/report`)) return ok(REPORT);
    if (u.includes(`games/${GAME}/up-next`)) return ok({ upNext, blocked: [], advisories: [], excluded: [], ownQuestions: [OWN] });
    if (u.includes(`games/${GAME}/queue`)) return ok({ queue, version: 1, ownQuestions: [OWN] });
    return ok({});
  });
});

afterEach(() => {
  jest.restoreAllMocks();
  localStorage.clear();
});

const railRows = (container) => [...container.querySelectorAll('.hc-rail [data-section="queue"] .hc-list li')]
  .map((li) => ({
    n: li.querySelector('.hc-n').textContent,
    own: Boolean(li.querySelector('.hc-yours')),
    text: li.textContent,
  }));

const openRunningOrder = async (container) => {
  await act(async () => { container.querySelector('[data-slot="session-menu"]').click(); });
  const sheet = await screen.findByRole('dialog', { name: 'Session menu' });
  await act(async () => { within(sheet).getByRole('tab', { name: 'Up next' }).click(); });
  return sheet;
};

test('right after a reload the rail lists played, now and planned rounds, without the Session menu', async () => {
  const { container } = render(<GameHostPage />);
  await waitFor(() => expect(railRows(container).map((r) => r.n)).toEqual(['1', '2', '3', '4', '5']), { timeout: LOAD_WAIT });
  const rows = railRows(container);
  expect(rows[0].text).toMatch('Shelved for Three Years');
  expect(rows[1].text).toMatch(NOW_TITLE);
  expect(rows[2].text).toMatch(OWN.title);
  expect(rows[2].own).toBe(true);
  expect(rows[3].text).toMatch('Second auto');
  expect(screen.queryByRole('dialog', { name: 'Session menu' })).toBeNull();
});

test('the rail and the Running order show the same rounds after load, and after a queue change from the phone', async () => {
  const { container } = render(<GameHostPage />);
  await waitFor(() => expect(railRows(container)).toHaveLength(5), { timeout: LOAD_WAIT });
  const sheet = await openRunningOrder(container);
  const runningOrder = () => within(sheet).getAllByTestId('queue-pos').map((el) => el.textContent);
  // The Running order has no played rows: it starts at the round on screen.
  const railFromNow = () => railRows(container).slice(1).map((r) => r.n);
  await waitFor(() => expect(runningOrder()).toEqual(railFromNow()));
  expect(runningOrder()).toEqual(['2', '3', '4', '5']);

  // The phone queues a set question first; the frame carries the list only.
  queue = ['c009#001', 'own:a1'];
  upNext = [
    { source: 'queued', questionId: 'QUESTION#c009#001', title: 'Queued from the phone', round: 3 },
    { ...PLAN[0], round: 4 },
    { ...PLAN[1], round: 5 },
  ];
  const frame = webSocketClient.onMessage.mock.calls.filter(([type]) => type === 'questionQueueChanged').pop();
  expect(frame).toBeTruthy();
  await act(async () => { frame[1]({ type: 'questionQueueChanged', queue, version: 2 }); });
  await waitFor(() => expect(railRows(container)[2].text).toMatch('Queued from the phone'));
  expect(railRows(container)[3].own).toBe(true);
  await waitFor(() => expect(runningOrder()).toEqual(railFromNow()));
});

/*
  ONE SCREEN, AFTER A RELOAD: no rail, so the rounds played (POST /report,
  which rewrites the session's REPORT snapshot) wait for the Session menu, but
  the queue and the plan are read on load, as on two screens.
*/
test('one screen: the queue and the plan are read on load; the rounds played wait for the menu', async () => {
  localStorage.setItem('engage.surfaces', 'classic');
  const reads = (part) => global.fetch.mock.calls.filter(([u]) => String(u).includes(`games/${GAME}/${part}`)).length;
  const { container } = render(<GameHostPage />);
  await waitFor(() => expect(reads('up-next')).toBeGreaterThan(0), { timeout: LOAD_WAIT });
  expect(reads('queue')).toBeGreaterThan(0);
  expect(container.querySelector('.hc-rail')).toBeNull();
  expect(reads('report')).toBe(0);
});
