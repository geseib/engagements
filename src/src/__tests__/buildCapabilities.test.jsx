/**
 * NOTHING BUILD ROOM DOES IS LOST (docs/design/parity/PLAN.md §2.6b; owner,
 * 17 Oct 2026). Every id in buildroom/capabilities.js must have an entry point
 * (`data-capability="<id>"`) on the one-screen page. The two-screen half (the
 * console) joins this file with B8.
 *
 * A capability belongs to a moment: the ask's moves need an ask, What's next
 * needs the time between asks, the opening needs the opening. So the page is
 * walked in three moments, each a fixture with everything it can carry
 * switched on (ideas, points, a running list, the crew, a decided ask), and
 * the union must cover the list. Fixtures go through the REAL server's pure
 * half (build-store.js roomFromRows + hostView), as buildRoomPage.test.jsx does.
 */
import React from 'react';
import {
  render, screen, fireEvent, within, cleanup,
} from '@testing-library/react';
import { authFetch, getAuthToken } from '../auth/authFetch';
import BuildRoomPage from '../buildroom/BuildRoomPage';
import { CAPABILITIES, CAPABILITY_IDS } from '../buildroom/capabilities';

jest.mock('../utils/reloadPage', () => ({ __esModule: true, default: jest.fn() }));
jest.mock('../auth/authFetch', () => ({ authFetch: jest.fn(), getAuthToken: jest.fn(async () => 'id-token') }));
jest.mock('../WebSocketClient', () => ({
  __esModule: true,
  default: {
    connect: jest.fn(), disconnect: jest.fn(), onMessage: jest.fn(), offMessage: jest.fn(), onReconnected: jest.fn(), onConnectionStatusChange: jest.fn(), isConnected: jest.fn(() => false), ensureConnected: jest.fn(),
  },
}));

const S = require('../../../lambda-functions/game/build-store');

const API = 'https://api.example.test/dev/';
const GAME = '4821';
const NOW = new Date().toISOString();
const ago = (s) => new Date(Date.now() - s * 1000).toISOString();

const CHOICE = {
  AskId: '003', Kind: 'choice', Prompt: 'Which header should volunteers see first?', Detail: '', MaxPicks: 1,
  Options: [{ label: 'A', title: 'Bold banner', detail: '', url: '' }, { label: 'B', title: 'Calm photo', detail: '', url: '' }],
};
const DECIDED = { ...CHOICE, AskId: '002', Status: 'decided', DecidedAt: ago(700), Decision: { direction: 'Go calm', chosen: ['B'], note: '' } };
const ANSWERS = [
  { SK: 'BUILD#ANS#003#Ana', AskId: '003', PlayerName: 'Ana', Choice: ['B'], CreatedAt: ago(200) },
  { SK: 'BUILD#ANS#003#Sam', AskId: '003', PlayerName: 'Sam', Choice: ['B'], CreatedAt: ago(200) },
  { SK: 'BUILD#ANS#003#Dee', AskId: '003', PlayerName: 'Dee', Choice: ['A'], CreatedAt: ago(200) },
];
const POINT = (n, over = {}) => ({
  SK: `BUILD#POINT#${`p${n}`.padStart(13, '0')}`, PointId: `p${n}`, Kind: 'idea', Text: `Point ${n} for Claude`, Status: 'new', By: 'claude', ByRole: 'agent', BatchId: 'b1', CreatedAt: ago(300 - n), Sources: [], ...over,
});
const RUN = {
  SK: 'BUILD#RUN', RunId: 'r1', Status: 'running', Cur: 1, Ver: 2, StartedAt: ago(500),
  Marks: ['done', 'doing', 'pending'], SentAt: [ago(480), ago(300), ''], DoneAt: [ago(400), '', ''],
  Items: [1, 2, 3].map((n) => ({ pointId: `p${n}`, text: `Point ${n} for Claude`, kind: 'idea', site: '', dir: `dir ${n}` })),
};
const CREW = { enabled: true, repoUrl: 'https://github.com/example/foodbank', baseBranch: 'build-room/4821', baseCommit: 'e91b04d', modes: ['fork', 'patch'], runCrewCode: false };

function hostState({ st = {}, asks = [] } = {}) {
  const rows = [
    { SK: 'BUILD#STATE', Rev: 7, AgentSeenAt: ago(6), Phase: 'building', Crew: CREW, ...st },
    ...asks.map((a) => ({ SK: `BUILD#ASK#${a.AskId}`, Source: 'agent', CreatedAt: ago(600), ...a })),
    ...ANSWERS,
    POINT(1, { Status: 'sent' }), POINT(2, { Status: 'sent' }), POINT(3, { Status: 'queued' }), POINT(4), POINT(5),
    RUN,
    { SK: 'BUILD#IDEA#0000000000001#i1', IdeaId: '1-i1', Status: 'new', Source: 'room', PlayerName: 'Ana', Text: 'Show parking', CreatedAt: ago(120) },
    { SK: 'BUILD#IDEA#0000000000002#i2', IdeaId: '2-i2', Status: 'later', Source: 'room', PlayerName: 'Dee', Text: 'Print a rota', CreatedAt: ago(110) },
    { SK: 'BUILD#LOG#0000000000001#s1', LogId: '1-s1', Kind: 'showing', Text: 'Header is live', Link: 'http://localhost:5173/', By: 'agent', CreatedAt: ago(90) },
  ];
  return S.hostView({
    gameId: GAME,
    meta: { Title: 'Volunteer sign-up', Details: 'A one-page site to pick a shift in a minute.' },
    sessionState: 'STARTED',
    room: S.roomFromRows(rows),
    players: ['Ana', 'Dee', 'Priya', 'Sam'],
    now: NOW,
  });
}

const MOMENTS = [
  ['an ask at results', () => hostState({ st: { CurrentAskId: '003' }, asks: [DECIDED, { ...CHOICE, Status: 'results' }] })],
  ['between asks', () => hostState({ asks: [DECIDED] })],
  ['the opening', () => hostState({ st: { Phase: undefined }, asks: [DECIDED] })],
];

const res = (data, ok = true, status = 200) => ({ ok, status, json: async () => data });
function serve(state) {
  authFetch.mockImplementation(async (url, opts = {}) => {
    const method = opts.method || 'GET';
    if (method === 'GET' && url.endsWith('/build/state')) return res(state);
    if (method === 'GET' && url.endsWith('/players')) return res({ players: [], removedPlayers: [] });
    if (url.endsWith('/host-ticket')) return res({ ticket: 't' });
    return res({ ok: true });
  });
}

const seenIn = (found) => {
  document.querySelectorAll('[data-capability]').forEach((el) => found.add(el.getAttribute('data-capability')));
};

/** Every screen, then the Session panel's two tabs: every id the page offers in this moment. */
async function walk(state) {
  serve(state);
  window.history.pushState({}, '', `/build?gameId=${GAME}`);
  render(<BuildRoomPage />);
  await screen.findByText('Volunteer sign-up');
  const found = new Set();
  seenIn(found);
  ['2', '3', '4', '1'].forEach((key) => { fireEvent.keyDown(window, { key }); seenIn(found); });
  fireEvent.click(screen.getAllByRole('button', { name: /^SESSION/ })[0]);
  const panel = screen.getByRole('dialog', { name: 'Session' });
  seenIn(found);
  fireEvent.click(within(panel).getByRole('tab', { name: /^Settings/ }));
  seenIn(found);
  cleanup();
  return found;
}

beforeEach(() => {
  window.API_BASE = API;
  jest.clearAllMocks();
  getAuthToken.mockImplementation(async () => 'id-token');
});

test('the list is the §2.6b table: unique ids, each with a name and where it lives on one screen', () => {
  expect(new Set(CAPABILITY_IDS).size).toBe(CAPABILITY_IDS.length);
  expect(CAPABILITY_IDS.length).toBe(18);
  CAPABILITIES.forEach((c) => {
    expect(c.id).toMatch(/^[a-z][a-z-]+$/);
    expect(c.name).toBeTruthy();
    expect(c.oneScreen).toBeTruthy();
  });
});

test('one screen: every capability has an entry point, and the page names no capability the list lacks', async () => {
  const all = new Set();
  const byMoment = {};
  for (const [name, mk] of MOMENTS) {
    // eslint-disable-next-line no-await-in-loop
    const found = await walk(mk());
    byMoment[name] = [...found].sort();
    found.forEach((id) => all.add(id));
  }
  const missing = CAPABILITY_IDS.filter((id) => !all.has(id));
  expect({ missing, byMoment }).toEqual({ missing: [], byMoment });
  expect([...all].filter((id) => !CAPABILITY_IDS.includes(id))).toEqual([]);
});

test('the Stage carries its own: the moves, the board pick, HOST and SESSION', async () => {
  serve(MOMENTS[0][1]());
  window.history.pushState({}, '', `/build?gameId=${GAME}`);
  render(<BuildRoomPage />);
  await screen.findByText('Volunteer sign-up');
  fireEvent.keyDown(window, { key: '2' });
  const found = new Set();
  seenIn(found);
  ['ask-moves', 'board-pick', 'host-alert', 'settings'].forEach((id) => expect(found).toContain(id));
});
