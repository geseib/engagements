/**
 * NOTHING BUILD ROOM DOES IS LOST (docs/design/parity/PLAN.md §2.6b; owner,
 * 17 Oct 2026). Every id in buildroom/capabilities.js must have an entry point
 * (`data-capability="<id>"`) on the one-screen page, and on the two-screen
 * console (B8; the console mockup's view 4, "Where everything went", whose
 * table is each entry's `twoScreens`).
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
import { SURFACES_KEY } from '../config/surfaces';

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
  const view = S.hostView({
    gameId: GAME,
    meta: { Title: 'Volunteer sign-up', Details: 'A one-page site to pick a shift in a minute.' },
    sessionState: 'STARTED',
    room: S.roomFromRows(rows),
    players: ['Ana', 'Dee', 'Priya', 'Sam'],
    now: NOW,
  });
  // What build-room.js adds to the host's read (parity PLAN §2.9a): the wall key and the window's status.
  return {
    ...view, wallKey: 'K'.repeat(43), wall: { screen: 'stage', codes: 'none', profile: 'room', rev: 1 }, presenting: 0, presentDetail: null,
  };
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

/**
 * TWO SCREENS (B8): the console, its rail's four slots opened in turn, each
 * fold, "Look here, privately" to Build and History (1 comes back), then the
 * Session panel from the Session slot. The laptop stays the console for 2-4.
 */
async function walkConsole(state) {
  window.localStorage.setItem(SURFACES_KEY, 'two');
  serve(state);
  window.history.pushState({}, '', `/build?gameId=${GAME}`);
  render(<BuildRoomPage />);
  await screen.findAllByText('Volunteer sign-up');
  expect(document.querySelector('.hc--build')).not.toBeNull();
  const found = new Set();
  seenIn(found);
  document.querySelectorAll('.hc-rail summary').forEach((s) => { fireEvent.click(s); seenIn(found); });
  document.querySelectorAll('.hc-side .brm-stackhead').forEach((b) => { fireEvent.click(b); seenIn(found); });
  for (const name of ['Build', 'History']) {
    fireEvent.click(document.querySelector('.hc-rail summary') || document.body);
    const door = [...document.querySelectorAll('.hc-rail button')].find((b) => b.textContent === name);
    if (door) {
      fireEvent.click(door);
      seenIn(found);
      fireEvent.keyDown(window, { key: '1' });
    }
  }
  fireEvent.click(document.querySelector('.hc--build .bc-sess'));
  const panel = screen.getByRole('dialog', { name: 'Session' });
  seenIn(found);
  fireEvent.click(within(panel).getByRole('tab', { name: /^Settings/ }));
  seenIn(found);
  cleanup();
  window.localStorage.clear();
  return found;
}

beforeEach(() => {
  window.API_BASE = API;
  jest.clearAllMocks();
  window.localStorage.clear();
  getAuthToken.mockImplementation(async () => 'id-token');
});

test('the list is the §2.6b table: unique ids, each with a name and where it lives on one screen', () => {
  expect(new Set(CAPABILITY_IDS).size).toBe(CAPABILITY_IDS.length);
  expect(CAPABILITY_IDS.length).toBe(21);
  CAPABILITIES.forEach((c) => {
    expect(c.id).toMatch(/^[a-z][a-z-]+$/);
    expect(c.name).toBeTruthy();
    expect(c.oneScreen).toBeTruthy();
    // Where it went on the two-screen console (the mockup's view 4 table).
    expect(c.twoScreens).toBeTruthy();
  });
});

test('two screens: every capability has an entry point on the console (the "Where everything went" checklist)', async () => {
  const all = new Set();
  const byMoment = {};
  for (const [name, mk] of MOMENTS) {
    // eslint-disable-next-line no-await-in-loop
    const found = await walkConsole(mk());
    byMoment[name] = [...found].sort();
    found.forEach((id) => all.add(id));
  }
  const missing = CAPABILITIES.filter((c) => !all.has(c.id)).map((c) => `${c.id}: ${c.twoScreens}`);
  expect({ missing, byMoment }).toEqual({ missing: [], byMoment });
  expect([...all].filter((id) => !CAPABILITY_IDS.includes(id))).toEqual([]);
});

test('two screens: the console itself, without the Session panel, carries every capability but the panel\'s own settings', async () => {
  // The panel's groups (codes, list names, the release switch) live in the panel; everything else is a door on the console.
  const all = new Set();
  for (const [, mk] of MOMENTS) {
    window.localStorage.setItem(SURFACES_KEY, 'two');
    serve(mk());
    window.history.pushState({}, '', `/build?gameId=${GAME}`);
    render(<BuildRoomPage />);
    // eslint-disable-next-line no-await-in-loop
    await screen.findAllByText('Volunteer sign-up');
    document.querySelectorAll('.hc-rail summary').forEach((s) => { fireEvent.click(s); seenIn(all); });
    seenIn(all);
    cleanup();
  }
  const missing = CAPABILITY_IDS.filter((id) => !all.has(id) && id !== 'release-posts');
  expect(missing).toEqual([]);
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

/**
 * AN EMPTY ROOM (simplify PLAN item 18, phase 2): Later and Points are drawn only once
 * they have something, so each keeps a door that does not depend on content. Points:
 * What's next's Ask Claude for points between asks, and the composer's More always;
 * Later: Save for later in the composer. Walked on both layouts, before any building ask
 * (the starter question, no What's next) and between asks.
 */
function emptyRoom({ decided = false } = {}) {
  const rows = [
    { SK: 'BUILD#STATE', Rev: 3, AgentSeenAt: ago(6), Phase: 'building' },
    ...(decided ? [{ SK: 'BUILD#ASK#002', Source: 'agent', CreatedAt: ago(600), ...DECIDED }] : []),
  ];
  const view = S.hostView({
    gameId: GAME, meta: { Title: 'Volunteer sign-up', Details: '' }, sessionState: 'STARTED', room: S.roomFromRows(rows), players: ['Ana', 'Dee'], now: NOW,
  });
  return { ...view, wallKey: 'K'.repeat(43), wall: { screen: 'stage', codes: 'none', profile: 'room', rev: 1 }, presenting: 0, presentDetail: null };
}

test.each([
  ['one screen', false], ['two screens', true],
])('an empty room, %s: Points and Later each keep a door with nothing in them', async (_, two) => {
  for (const decided of [false, true]) {
    if (two) window.localStorage.setItem(SURFACES_KEY, 'two');
    serve(emptyRoom({ decided }));
    window.history.pushState({}, '', `/build?gameId=${GAME}`);
    render(<BuildRoomPage />);
    // eslint-disable-next-line no-await-in-loop
    await screen.findAllByText('Volunteer sign-up');
    // Nothing in either list: no Points tab drawn, no Later list on one screen.
    expect(screen.queryByRole('tab', { name: /^Points/ })).toBeNull();
    if (decided) {
      // Between asks: What's next carries Ask Claude for points.
      const move = within(screen.getByRole('list', { name: "What's next" })).getByRole('button', { name: 'Ask Claude' });
      expect(move).toHaveAttribute('data-capability', 'points');
    }
    fireEvent.click(screen.getByRole('button', { name: 'Tell Claude…' }));
    const found = new Set();
    seenIn(found);
    expect(found).toContain('points');
    expect(found).toContain('later');
    const composer = screen.getByRole('region', { name: 'Tell Claude' });
    expect(within(composer).getByRole('button', { name: 'Save for later' })).toHaveAttribute('data-capability', 'later');
    cleanup();
    window.localStorage.clear();
  }
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
