/**
 * THE BUILD ROOM ON THE SHARED FRAME (experience plan Phase 2 step 2e;
 * docs/design/experience-plan/PLAN.md §3.2, §3.2a Build Room column, §3.2b).
 *
 *   1  words: the Build Room's top bar, Session menu and ways out say what
 *      config/hostWords.js says, the same as Call & Answer's
 *   2  the top bar's slots, in TOP_SLOTS order, on the console and on the
 *      one-screen Host screen's header
 *   3  the Session menu opens from the top bar as a sheet over the content
 *      area and holds Build settings
 *   4  the Needs-you line carries Claude's ask (Now, amber, Decide), the
 *      room's ideas (Soon, Review) and a name request; the bell counts it
 *   5  the person row: dot, name, doing now, the ideas given, ⋯
 *
 * // rejects: the 2a note that the Build Room kept its own SESSION button,
 * //          its own "Waiting for you" as the only place Claude's question
 * //          showed, and a rail slot of set-once settings.
 *
 * Fixtures from the REAL backend's pure half (build-store.js hostView), as
 * buildTwoScreen.test.jsx builds them. NO GEOMETRIC ASSERTIONS.
 */
import React from 'react';
import {
  render, screen, fireEvent, within,
} from '@testing-library/react';
import { authFetch } from '../auth/authFetch';
import BuildRoomPage from '../buildroom/BuildRoomPage';
import { SURFACES_KEY } from '../config/surfaces';
import HW, { TOP_SLOTS } from '../config/hostWords';
import { W } from '../buildroom/words';
import { needsYou, NEEDS_ACTIONS, NEEDS_LEVELS, kindSummary } from '../config/needsYou';
import { buildNeedsOf } from '../buildroom/buildScreens';
import { peopleRows } from '../buildroom/buildConsole';

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
const PLAYERS = ['Ana', 'Dee', 'Priya', 'Sam'];

const CLAUDE_ASK = {
  SK: 'BUILD#ASK#004', AskId: '004', Source: 'agent', CreatedAt: ago(60), Kind: 'choice', Status: 'proposed', MaxPicks: 1,
  Prompt: 'Which header should the sign-up page use?', Detail: '',
  Options: [{ label: 'A', title: 'A photo', detail: '', url: '' }, { label: 'B', title: 'Plain text', detail: '', url: '' }],
};
const IDEA = (n, who, text) => ({ SK: `BUILD#IDEA#000000000000${n}#i${n}`, IdeaId: `${n}-i${n}`, Status: 'new', Source: 'room', PlayerName: who, Text: text, CreatedAt: ago(130 - n * 10) });
const IDEAS = [IDEA(1, 'Ana', 'Show where to park'), IDEA(2, 'Ana', 'Text a reminder'), IDEA(3, 'Dee', 'Print a rota')];

function hostState(rows = []) {
  const view = S.hostView({
    gameId: GAME,
    meta: { Title: 'Volunteer sign-up', Details: '' },
    sessionState: 'STARTED',
    room: S.roomFromRows([{ SK: 'BUILD#STATE', Rev: 7, AgentSeenAt: ago(6), Phase: 'building' }, ...rows]),
    players: PLAYERS,
    now: NOW,
  });
  return {
    ...view, wallKey: 'K'.repeat(43), wall: { screen: 'stage', codes: 'none', profile: 'room', rev: 1 }, presenting: 0, presentDetail: null,
  };
}

let roster = [];
const res = (data) => ({ ok: true, status: 200, json: async () => data });
function serve(state) {
  authFetch.mockImplementation(async (url, opts = {}) => {
    const method = opts.method || 'GET';
    if (method === 'GET' && url.endsWith('/build/state')) return res(state);
    if (method === 'GET' && url.endsWith('/players')) return res({ players: roster, removedPlayers: [] });
    if (url.endsWith('/host-ticket')) return res({ ticket: 't' });
    return res({ ok: true, wall: state.wall });
  });
}

async function openRoom(state, choice = 'two') {
  if (choice) window.localStorage.setItem(SURFACES_KEY, choice);
  serve(state);
  window.history.pushState({}, '', `/build?gameId=${GAME}`);
  render(<BuildRoomPage />);
  await screen.findAllByText('Volunteer sign-up');
}

const consoleEl = () => document.querySelector('.hc.hc--build');
const slotsIn = (el) => [...el.querySelectorAll('[data-slot]')].map((n) => n.getAttribute('data-slot'));

beforeEach(() => {
  window.API_BASE = API;
  jest.clearAllMocks();
  window.localStorage.clear();
  roster = [];
});

describe('1. the Build Room says what hostWords says', () => {
  test('the Build Room\'s own words file agrees with hostWords for the shared ones', () => {
    expect(W.mainMenu).toBe(HW.mainMenu);
    expect(W.endSessionBtn).toBe(HW.endSession);
  });

  test('console: Main menu, Join, Room\'s window, Needs you and Session menu, in hostWords\' words; no SESSION', async () => {
    await openRoom(hostState());
    const top = consoleEl().querySelector('.hc-top');
    expect(within(top).getByRole('button', { name: new RegExp(`^${HW.mainMenu}`) })).toBeInTheDocument();
    expect(within(top).getByRole('button', { name: new RegExp(`^${HW.join} ${GAME}`) })).toBeInTheDocument();
    expect(within(top).getByRole('button', { name: new RegExp(`^${HW.sessionMenu}`) })).toBeInTheDocument();
    expect(top.querySelector('[data-slot="needs-you"]').textContent).toMatch(HW.needsYou);
    expect(top.textContent).not.toMatch('SESSION');
  });

  test('one screen: the header uses the same words; the Session menu and End session too', async () => {
    await openRoom(hostState(), 'classic');
    const header = document.querySelector('header.brm-hbar');
    expect(within(header).getByRole('link', { name: new RegExp(HW.mainMenu) })).toHaveAttribute('title', HW.mainMenuHint);
    const menu = within(header).getByRole('button', { name: new RegExp(`^${HW.sessionMenu}`) });
    expect(header.textContent).not.toMatch('SESSION');
    fireEvent.click(menu);
    const sheet = screen.getByRole('dialog', { name: HW.sessionMenu });
    expect(within(sheet).getByRole('heading', { level: 2 })).toHaveTextContent(HW.sessionMenu);
    expect(within(sheet).getByRole('button', { name: HW.closeSessionMenu })).toBeInTheDocument();
    // End session is the foot's, in every section (docs/design/session-menu F2).
    expect(within(sheet.querySelector('.brm-sp-foot')).getByRole('button', { name: `${HW.endSession}…` })).toHaveAttribute('title', HW.endSessionHint);
  });
});

describe('2. the top bar\'s slots, in order', () => {
  // Each surface draws a subsequence of TOP_SLOTS (connection only when broken; join hidden when tucked).
  const inOrder = (got) => {
    const idx = got.map((g) => TOP_SLOTS.indexOf(g));
    expect(idx.every((i) => i >= 0)).toBe(true);
    expect([...idx].sort((a, b) => a - b)).toEqual(idx);
  };

  test('console: Main menu first, Session menu last, every slot in TOP_SLOTS order', async () => {
    await openRoom(hostState());
    const got = slotsIn(consoleEl().querySelector('.hc-top'));
    expect(got).toEqual(['main-menu', 'name', 'join', 'room-screen', 'needs-you', 'help', 'session-menu']);
    inOrder(got);
  });

  test('one screen, the Host screen\'s header: the same slots in the same order', async () => {
    await openRoom(hostState(), 'classic');
    const got = slotsIn(document.querySelector('header.brm-hbar'));
    expect(got).toEqual(['main-menu', 'name', 'join', 'room-screen', 'needs-you', 'help', 'session-menu']);
    inOrder(got);
    // Main menu is the first control and the Session menu the last.
    const controls = document.querySelector('header.brm-hbar').querySelectorAll('a, button');
    expect(controls[0].getAttribute('data-slot')).toBe('main-menu');
    expect(controls[controls.length - 1].getAttribute('data-slot')).toBe('session-menu');
  });
});

describe('3. the Session menu holds the Build Room\'s sections', () => {
  test('console: the top bar\'s Session menu opens a sheet over the content area, at Claude', async () => {
    await openRoom(hostState());
    fireEvent.click(consoleEl().querySelector('[data-slot="session-menu"]'));
    const sheet = screen.getByRole('dialog', { name: HW.sessionMenu });
    expect(sheet.closest('[data-testid="hc-sheet"]')).not.toBeNull();
    expect(consoleEl().querySelector('.hc-now').contains(sheet)).toBe(false);
    expect(within(sheet).getByRole('tab', { name: /^Claude/ })).toHaveAttribute('aria-selected', 'true');
    expect(within(sheet).getAllByRole('tab').map((t) => t.textContent.replace(/\d.*$/, '').trim()))
      .toEqual(['Claude', 'Asks so far', 'People', 'Screens', 'Joining']);
    const build = sheet.querySelector('[data-group="claude"]');
    expect(within(build).getByRole('button', { name: /Connect Claude Code/ })).toBeInTheDocument();
    expect(within(build).getByRole('switch', { name: /Review Claude's questions/ })).toBeInTheDocument();
    // The rail's old Session slot is gone: set-once settings are in the Session menu only.
    expect(consoleEl().querySelector('.hc-rail [data-section="session"]')).toBeNull();
  });
});

describe('4. the Needs-you line carries the Build Room\'s waiting work', () => {
  test('pure: Claude\'s ask is Now with Decide, the room\'s ideas one Soon item with Review, mockups and posts too', () => {
    const room = { asks: [{ askId: '004', status: 'proposed', source: 'agent', kind: 'choice', prompt: 'Which header?', options: [{ id: 'A' }, { id: 'B' }], createdAt: ago(60) }], ideas: [{ status: 'new', source: 'room', playerName: 'Ana' }, { status: 'new', source: 'host' }], log: [{ logId: 'l1', roomHold: 'held' }] };
    const build = buildNeedsOf(room);
    expect(build).toEqual({ asks: [{ askId: '004', title: 'Which header?' }], mockups: [], ideas: 1, posts: 1 });
    const n = needsYou({ build });
    expect(n.top).toMatchObject({ kind: 'claude-ask', level: NEEDS_LEVELS.NOW, text: 'Claude asked: Which header?', actions: [NEEDS_ACTIONS.DECIDE] });
    expect(n.nowCount).toBe(1);
    expect(n.items.map((i) => i.kind)).toEqual(['claude-ask', 'ideas', 'posts']);
    expect(n.items[1].actions).toEqual([NEEDS_ACTIONS.REVIEW]);
    // On a screen the room can see: by kind, never the question's words.
    expect(kindSummary(n)).toBe('A question from Claude · 1 idea from the room · 1 post from Claude to release');
  });

  test('console: Claude\'s question turns the line amber with Decide; the bell counts it; Decide opens Waiting for you', async () => {
    await openRoom(hostState([CLAUDE_ASK, ...IDEAS]));
    const line = consoleEl().querySelector('.hc-needs [data-testid="needs-line"]');
    expect(line).toHaveAttribute('data-level', 'now');
    expect(line.textContent).toMatch('Claude asked: Which header should the sign-up page use?');
    expect(line.textContent).toMatch('+1 more in Needs you');
    expect(consoleEl().querySelector('.hc-top [data-slot="needs-you"]').textContent).toMatch('1');
    fireEvent.click(within(line).getByRole('button', { name: 'Decide' }));
    expect(screen.getByRole('region', { name: 'Waiting for you, in the main area' })).toBeInTheDocument();
  });

  test('console: a name request is on the line and on the person\'s row, with Let them and Not now', async () => {
    roster = PLAYERS.map((name) => ({ playerName: name, isConnected: true, handover: name === 'Sam' ? { requested: true, requestedAt: ago(20) } : {} }));
    await openRoom(hostState());
    const line = await screen.findByText('Sam wants their name on a new device');
    expect(line.closest('[data-testid="needs-line"]')).toHaveAttribute('data-level', 'now');
    const people = consoleEl().querySelector('[data-section="people"]');
    expect(people.querySelector('summary').textContent).toMatch('1 needs you');
    const row = within(people).getByTestId('person-asking');
    expect(row.querySelector('.prow-name').textContent).toBe('Sam');
    expect(within(row).getByRole('button', { name: 'Let them: Sam' })).toBeInTheDocument();
    expect(within(row).getByRole('button', { name: 'Not now: Sam' })).toBeInTheDocument();
  });
});

describe('5. the person row', () => {
  test('pure: status, doing now and the one fact, ideas given', () => {
    const room = { players: ['Ana', 'Dee'], ideas: [{ playerName: 'Ana', source: 'room' }, { playerName: 'Ana', source: 'room' }, { playerName: 'Dee', source: 'host' }] };
    const r = peopleRows(room, null, { players: [{ playerName: 'Ana', deviceConnected: true }, { playerName: 'Dee', deviceConnected: false }] });
    expect(r.rows.map(({ name, status, doing, fact }) => ({ name, status, doing, fact }))).toEqual([
      { name: 'Ana', status: 'here', doing: '', fact: '2 ideas' },
      { name: 'Dee', status: 'away', doing: 'away', fact: '0 ideas' },
    ]);
  });

  test('console: every row has the five slots in order; the fact is the ideas given; ⋯ holds the Build Room\'s moves', async () => {
    await openRoom(hostState(IDEAS));
    const people = consoleEl().querySelector('[data-section="people"]');
    fireEvent.click(people.querySelector('summary'));
    const rows = [...people.querySelectorAll('.bc-people > li.prow')];
    expect(rows).toHaveLength(4);
    rows.forEach((li) => {
      expect([...li.children].map((c) => c.className.split(' ')[0])).toEqual(['prow-dot', 'prow-name', 'prow-doing', 'prow-fact', 'prow-more']);
    });
    const fact = (name) => rows.find((li) => li.querySelector('.prow-name').textContent === name).querySelector('.prow-fact').textContent;
    expect(fact('Ana')).toBe('2 ideas');
    expect(fact('Dee')).toBe('1 idea');
    expect(fact('Sam')).toBe('0 ideas');
    const more = within(rows[0]).getByRole('button', { name: 'More for Ana' });
    fireEvent.click(more);
    const menu = within(rows[0]).getByRole('menu');
    expect(within(menu).getAllByRole('menuitem').map((b) => b.textContent)).toEqual(['Move to a new device', 'Remove from session']);
    // Remove is confirmed in place: the first press arms it.
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Remove from session' }));
    expect(within(menu).getByRole('menuitem', { name: 'Press again to remove' })).toBeInTheDocument();
  });
});
