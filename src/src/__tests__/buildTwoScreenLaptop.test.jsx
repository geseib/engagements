/**
 * THE BUILD ROOM ON TWO SCREENS, ITEMS 1-4 (owner, 19 Oct 2026: "yes do 1-4";
 * docs/qa/2026-10-18-build-room-walk F2, F3, T2, T3, W1-W3; parity PLAN §2.6,
 * §2.7).
 *
 *   1  the header carries "Room's window ↗" and whether that window is up, on
 *      Host, Build and History; the Stage's dock carries it as PRESENT
 *   2  while the window is up the laptop stays where it is: 2/3/4, P and "The
 *      room sees" send the screen to the window only; with none up, today's
 *      one screen exactly
 *   3  "Where will the room watch?" once on the Host screen, the same choice
 *      Call & Answer stores; Two screens opens the room's window in the click;
 *      Settings, Screens shows and changes it
 *   4  no second display: Open as a tab (placed=1) and one visible line
 *
 * Fixtures from the REAL backend's pure half (build-store.js hostView) plus
 * what build-room.js adds to the host's read (wallKey, wall, presenting,
 * presentDetail; parity PLAN §2.9a). NO GEOMETRIC ASSERTIONS.
 */
import React from 'react';
import {
  render, screen, fireEvent, waitFor, within,
} from '@testing-library/react';
import { authFetch } from '../auth/authFetch';
import BuildRoomPage from '../buildroom/BuildRoomPage';
import { SURFACES_KEY } from '../config/surfaces';

jest.mock('../utils/reloadPage', () => ({ __esModule: true, default: jest.fn() }));
jest.mock('../auth/authFetch', () => ({ authFetch: jest.fn(), getAuthToken: jest.fn(async () => 'id-token') }));
jest.mock('../WebSocketClient', () => ({
  __esModule: true,
  default: {
    connect: jest.fn(),
    disconnect: jest.fn(),
    onMessage: jest.fn(),
    offMessage: jest.fn(),
    onReconnected: jest.fn(),
    onConnectionStatusChange: jest.fn(),
    isConnected: jest.fn(() => false),
    ensureConnected: jest.fn(),
  },
}));

const S = require('../../../lambda-functions/game/build-store');

const API = 'https://api.example.test/dev/';
const GAME = '4821';
const KEY = 'K3y_abcdefghijklmnopqrstuvwxyz0123456789ABCD';
const WALL = `/present?gameId=${GAME}&type=build&k=${encodeURIComponent(KEY)}`;
const NOW = new Date().toISOString();
const ago = (s) => new Date(Date.now() - s * 1000).toISOString();

const UP = { open: true, fullscreen: true, visible: true, statusAt: NOW, ageMs: 1000 };

function hostState({ presenting = 0, detail = null, wallScreen = 'stage', rev = 1 } = {}) {
  const room = S.roomFromRows([{ SK: 'BUILD#STATE', Rev: 7, AgentSeenAt: ago(6), Phase: 'building' }]);
  const view = S.hostView({
    gameId: GAME,
    meta: { Title: 'Volunteer sign-up', Details: 'A one-page site to pick a shift in a minute.' },
    sessionState: 'STARTED',
    room,
    players: ['Ana', 'Dee'],
    now: NOW,
  });
  return {
    ...view,
    wallKey: KEY,
    wall: { screen: wallScreen, codes: 'none', profile: 'room', rev },
    presenting,
    presentDetail: detail,
  };
}

let calls;
let current;
const res = (data) => ({ ok: true, status: 200, json: async () => data });
function serve(state) {
  current = state;
  calls = [];
  authFetch.mockImplementation(async (url, opts = {}) => {
    const method = opts.method || 'GET';
    calls.push({ url, method, body: opts.body ? JSON.parse(opts.body) : undefined });
    if (method === 'GET' && url.endsWith('/build/state')) return res(current);
    if (method === 'GET' && url.endsWith('/players')) return res({ players: [], removedPlayers: [] });
    if (url.endsWith('/host-ticket')) return res({ ticket: 't' });
    return res({ ok: true, wall: current.wall });
  });
}
const wallPosts = () => calls.filter((c) => c.method === 'POST' && c.url.endsWith(`/games/${GAME}/build/wall`)).map((c) => c.body);

async function openRoom(state) {
  serve(state);
  window.history.pushState({}, '', `/build?gameId=${GAME}`);
  render(<BuildRoomPage />);
  await screen.findByText('Volunteer sign-up');
}

const header = () => document.querySelector('.brm-hbar');
const onHost = () => screen.queryByRole('main', { name: 'Now' }) !== null;
const sees = () => screen.getByRole('group', { name: 'The room sees' });

beforeEach(() => {
  window.API_BASE = API;
  jest.clearAllMocks();
  window.localStorage.clear();
  // Most of these are about the header and the keys: the browser has chosen already.
  window.localStorage.setItem(SURFACES_KEY, 'two');
});

describe('1. the room\'s window on the header and the Stage', () => {
  test('Host: "Room\'s window ↗" to the wall with its key, and its state, here "not open"', async () => {
    await openRoom(hostState());
    const h = header();
    const link = within(h).getByRole('link', { name: "Room's window ↗" });
    expect(link).toHaveAttribute('href', WALL);
    expect(link).toHaveAttribute('target', '_blank');
    // The state alone shows (the link names the window); a reader hears it whole.
    const stat = h.querySelector('.brm-winstat');
    expect(stat).toHaveTextContent("Room's window: Not open");
    expect(stat).toHaveClass('is-muted');
  });

  test('the state follows the server: open, not full screen; on, full screen', async () => {
    await openRoom(hostState({ presenting: 1, detail: { ...UP, fullscreen: false } }));
    expect(within(header()).getByRole('status')).toHaveTextContent("Room's window: Open, not full screen");
    // W3: the one instruction, as text, where the status is.
    expect(header().textContent).toMatch("Click the room's window once to fill the screen (or press F)");
  });

  test('a window row on the session that stopped reporting reads as not open', async () => {
    await openRoom(hostState({ presenting: 1, detail: { ...UP, ageMs: 10 * 60 * 1000 } }));
    expect(header().querySelector('.brm-winstat')).toHaveTextContent('Not open');
  });

  test('Build and History carry it too', async () => {
    await openRoom(hostState());
    for (const key of ['3', '4']) {
      fireEvent.keyDown(window, { key });
      expect(within(header()).getByRole('link', { name: "Room's window ↗" })).toHaveAttribute('href', WALL);
    }
  });

  test('the Stage carries it in its dock as PRESENT, with the window\'s state in its title', async () => {
    await openRoom(hostState());
    fireEvent.keyDown(window, { key: '2' });
    const dock = document.querySelector('footer.dock');
    const present = within(dock).getByRole('link', { name: /Open the Presentation/ });
    expect(present).toHaveAttribute('href', WALL);
    expect(present).toHaveAttribute('title', "Room's window: not open");
    // HOST and SESSION stay the last two, as D1-D2 hold them.
    const items = [...dock.querySelectorAll('a, button')];
    expect(items[items.length - 1].textContent).toMatch(/SESSION/);
  });

  test('an older server with no wall key: nothing to open, nothing claimed', async () => {
    await openRoom({ ...hostState(), wallKey: undefined });
    expect(within(header()).queryByRole('link', { name: "Room's window ↗" })).toBeNull();
  });
});

describe('2. while the room\'s window is up, the laptop stays where it is', () => {
  test('no window: 2, 3, 4 switch this laptop, and the window follows, as today', async () => {
    await openRoom(hostState());
    expect(screen.queryByRole('group', { name: 'The room sees' })).toBeNull();
    fireEvent.keyDown(window, { key: '3' });
    expect(onHost()).toBe(false);
    await waitFor(() => expect(wallPosts()).toContainEqual({ screen: 'build' }));
    fireEvent.keyDown(window, { key: '1' });
    expect(onHost()).toBe(true);
  });

  test('window up: "The room sees" with the window\'s screen marked; the tabs keep this laptop\'s place', async () => {
    await openRoom(hostState({ presenting: 1, detail: UP, wallScreen: 'history' }));
    const g = sees();
    expect(within(g).getByRole('button', { name: 'History' })).toHaveAttribute('aria-pressed', 'true');
    expect(within(g).getByRole('button', { name: 'Stage' })).toHaveAttribute('aria-pressed', 'false');
    const laptop = screen.getByRole('navigation', { name: 'This laptop' });
    expect(within(laptop).getAllByRole('button').map((b) => b.textContent)).toEqual(['Host']);
  });

  test('window up: 3 sends Build to the window and the laptop stays on Host; the chip moves', async () => {
    await openRoom(hostState({ presenting: 1, detail: UP }));
    fireEvent.keyDown(window, { key: '3' });
    expect(onHost()).toBe(true);
    await waitFor(() => expect(wallPosts()).toEqual([{ screen: 'build' }]));
    expect(within(sees()).getByRole('button', { name: 'Build' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.keyDown(window, { key: '4' });
    fireEvent.keyDown(window, { key: '2' });
    expect(onHost()).toBe(true);
    await waitFor(() => expect(wallPosts()).toEqual([{ screen: 'build' }, { screen: 'history' }, { screen: 'stage' }]));
  });

  test('window up: a chip sends that screen, P sends the last one, neither moves the laptop', async () => {
    await openRoom(hostState({ presenting: 1, detail: UP }));
    fireEvent.click(within(sees()).getByRole('button', { name: 'History' }));
    expect(onHost()).toBe(true);
    fireEvent.keyDown(window, { key: 'p' });
    expect(onHost()).toBe(true);
    await waitFor(() => expect(wallPosts()).toEqual([{ screen: 'history' }, { screen: 'history' }]));
  });

  test('window up: "See it here" shows the room\'s screen on the laptop too; 1 and the Host tab come home', async () => {
    await openRoom(hostState({ presenting: 1, detail: UP, wallScreen: 'history' }));
    fireEvent.click(screen.getByRole('button', { name: 'See it here' }));
    expect(onHost()).toBe(false);
    expect(screen.getByRole('button', { name: 'See it here' })).toBeDisabled();
    // The laptop's own tabs now say where it is: Host and History.
    const laptop = screen.getByRole('navigation', { name: 'This laptop' });
    expect(within(laptop).getAllByRole('button').map((b) => b.textContent)).toEqual(['Host', 'History']);
    fireEvent.click(within(laptop).getByRole('button', { name: 'Host' }));
    expect(onHost()).toBe(true);
  });

  test('window up, laptop on the Stage: 3 sends Build and the Stage stays; HOST still goes home in one press', async () => {
    await openRoom(hostState({ presenting: 1, detail: UP, wallScreen: 'stage' }));
    fireEvent.click(screen.getByRole('button', { name: 'See it here' }));
    const dock = () => document.querySelector('footer.dock');
    expect(dock()).not.toBeNull();
    expect(within(dock()).getByRole('link', { name: /Presenting/ })).toHaveAttribute('href', WALL);
    const before = wallPosts().length;
    fireEvent.keyDown(window, { key: '3' });
    expect(dock()).not.toBeNull();
    await waitFor(() => expect(wallPosts().slice(before)).toEqual([{ screen: 'build' }]));
    fireEvent.click(within(dock()).getByRole('button', { name: /Host/ }));
    expect(onHost()).toBe(true);
  });
});

describe('3. where will the room watch?', () => {
  const fakeWindow = () => ({ opener: {}, focus: jest.fn(), moveTo: jest.fn(), resizeTo: jest.fn(), location: {} });

  test('asked once on the Host screen, with Help me pick, until this browser has chosen', async () => {
    window.localStorage.removeItem(SURFACES_KEY);
    await openRoom(hostState());
    const q = screen.getByRole('region', { name: 'Where will the room watch?' });
    expect(within(q).getByRole('button', { name: 'Help me pick' })).toBeInTheDocument();
    // The Build Room's own words for what stays private: no Workie here.
    expect(q.textContent).toMatch("Claude's questions, the room's ideas and what waits for you stay private");
    expect(q.textContent).not.toMatch(/Workie/);
  });

  test('Two screens: stored as Call & Answer stores it, and the room\'s window opens in the click, placed', async () => {
    window.localStorage.removeItem(SURFACES_KEY);
    const open = jest.spyOn(window, 'open').mockImplementation(() => fakeWindow());
    try {
      await openRoom(hostState());
      fireEvent.click(screen.getByRole('button', { name: 'Use two screens' }));
      expect(open).toHaveBeenCalledTimes(1);
      expect(open.mock.calls[0][0]).toBe(`${WALL}&placed=1`);
      expect(open.mock.calls[0][1]).toBe('engage-room');
      expect(window.localStorage.getItem(SURFACES_KEY)).toBe('two');
      expect(screen.queryByRole('region', { name: 'Where will the room watch?' })).toBeNull();
    } finally {
      open.mockRestore();
    }
  });

  test('a blocked popup says where to open it instead', async () => {
    window.localStorage.removeItem(SURFACES_KEY);
    const open = jest.spyOn(window, 'open').mockImplementation(() => null);
    try {
      await openRoom(hostState());
      fireEvent.click(screen.getByRole('button', { name: 'Use two screens' }));
      expect(screen.getByRole('alert')).toHaveTextContent("The browser blocked the room's window. Open it from Room's window ↗ at the top.");
    } finally {
      open.mockRestore();
    }
  });

  test('One screen: stored, nothing opens, the page is today\'s', async () => {
    window.localStorage.removeItem(SURFACES_KEY);
    const open = jest.spyOn(window, 'open').mockImplementation(() => fakeWindow());
    try {
      await openRoom(hostState());
      fireEvent.click(screen.getByRole('button', { name: 'Use one screen' }));
      expect(open).not.toHaveBeenCalled();
      expect(window.localStorage.getItem(SURFACES_KEY)).toBe('classic');
      fireEvent.keyDown(window, { key: '3' });
      expect(onHost()).toBe(false);
    } finally {
      open.mockRestore();
    }
  });

  test('a browser that has chosen is not asked', async () => {
    window.localStorage.setItem(SURFACES_KEY, 'classic');
    await openRoom(hostState());
    expect(screen.queryByRole('region', { name: 'Where will the room watch?' })).toBeNull();
  });

  test('Settings, Screens shows the choice and changes it; Two screens there opens the window too', async () => {
    window.localStorage.setItem(SURFACES_KEY, 'classic');
    const open = jest.spyOn(window, 'open').mockImplementation(() => fakeWindow());
    try {
      await openRoom(hostState());
      fireEvent.click(screen.getByRole('button', { name: /^SESSION/ }));
      const panel = screen.getByRole('dialog', { name: 'Session' });
      fireEvent.click(within(panel).getByRole('tab', { name: /^Settings/ }));
      const g = panel.querySelector('[data-group="screens"]');
      const seg = within(g).getByRole('group', { name: 'Where the room watches' });
      expect(within(seg).getByRole('button', { name: 'One screen' })).toHaveAttribute('aria-pressed', 'true');
      fireEvent.click(within(seg).getByRole('button', { name: 'Two screens' }));
      expect(window.localStorage.getItem(SURFACES_KEY)).toBe('two');
      expect(open).toHaveBeenCalledTimes(1);
      expect(within(seg).getByRole('button', { name: 'Two screens' })).toHaveAttribute('aria-pressed', 'true');
      expect(g.textContent).toMatch("This laptop stays where it is; 2, 3 and 4 change the room's window");
    } finally {
      open.mockRestore();
    }
  });

  test('a window already up: choosing two screens opens no second one', async () => {
    window.localStorage.removeItem(SURFACES_KEY);
    const open = jest.spyOn(window, 'open').mockImplementation(() => fakeWindow());
    try {
      await openRoom(hostState({ presenting: 1, detail: UP }));
      fireEvent.click(screen.getByRole('button', { name: 'Use two screens' }));
      expect(open).not.toHaveBeenCalled();
    } finally {
      open.mockRestore();
    }
  });
});

describe('4. one laptop, no second display', () => {
  test('the header offers Open as a tab, with placed=1, and says what to do', async () => {
    await openRoom(hostState());
    const tab = within(header()).getByRole('link', { name: 'Open as a tab' });
    expect(tab).toHaveAttribute('href', `${WALL}&placed=1`);
    expect(tab).toHaveAttribute('target', '_blank');
    expect(header().textContent).toMatch('No second display? Open it in a tab and share that tab, or press F.');
  });

  test('Settings, Screens: the same offer and line; New link says why you would press it', async () => {
    await openRoom(hostState());
    fireEvent.click(screen.getByRole('button', { name: /^SESSION/ }));
    const panel = screen.getByRole('dialog', { name: 'Session' });
    fireEvent.click(within(panel).getByRole('tab', { name: /^Settings/ }));
    const g = panel.querySelector('[data-group="screens"]');
    expect(within(g).getByRole('link', { name: 'Open as a tab' })).toHaveAttribute('href', `${WALL}&placed=1`);
    expect(g.textContent).toMatch('No second display? Open it in a tab and share that tab, or press F.');
    expect(within(g).getByText('Link shared by mistake?')).toBeInTheDocument();
    expect(g.textContent).toMatch('A new link cuts off every window opened with the old one');
    expect(g.textContent).not.toMatch('Stops every window opened with the old link.');
  });

  test('once the window is up the tab offer goes; the line keeps its place for the fill instruction', async () => {
    await openRoom(hostState({ presenting: 1, detail: UP }));
    expect(within(header()).queryByRole('link', { name: 'Open as a tab' })).toBeNull();
    expect(header().querySelector('.rws-note')).not.toBeNull();
  });
});
