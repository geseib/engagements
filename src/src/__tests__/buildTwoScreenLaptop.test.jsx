/**
 * THE BUILD ROOM ON TWO SCREENS, ITEMS 1-4 (owner, 19 Oct 2026: "yes do 1-4";
 * docs/qa/2026-10-18-build-room-walk F2, F3, T2, T3, W1-W3; parity PLAN §2.6,
 * §2.7).
 *
 *   1  the header carries "Room's window ↗" and whether that window is up, on
 *      Host, Build and History; the Stage's dock carries it as ROOM'S WINDOW
 *   2  while the window is up the laptop stays where it is: 2/3/4, P and "The
 *      room sees" send the screen to the window only; on one screen with none
 *      up, today's one screen exactly. Since B8 the laptop on two screens is
 *      the console (__tests__/buildTwoScreen.test.jsx); its top line carries
 *      the header's window parts, so `header()` reads either
 *   3  which screen: since the simplify plan (26 Oct 2026) one screen without
 *      asking, Use two screens a row of Before the room starts (the same
 *      choice Call & Answer stores; it opens the room's window in the click);
 *      Settings, Screens shows and changes it
 *   4  no second display: Open as a tab (placed=1) and one visible line
 *
 * Fixtures from the REAL backend's pure half (build-store.js hostView) plus
 * what build-room.js adds to the host's read (wallKey, wall, presenting,
 * presentDetail; parity PLAN §2.9a). NO GEOMETRIC ASSERTIONS.
 */
import React from 'react';
import {
  render, screen, fireEvent, waitFor, within, cleanup,
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

function hostState({ presenting = 0, detail = null, wallScreen = 'stage', rev = 1, seen = true } = {}) {
  const room = S.roomFromRows([{ SK: 'BUILD#STATE', Rev: 7, ...(seen ? { AgentSeenAt: ago(6) } : {}), Phase: 'building' }]);
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

// One screen: the Host screen's header. Two screens (B8): the console's top line carries the same parts.
const header = () => document.querySelector('.brm-hbar') || document.querySelector('.hc-top');
const classic = () => window.localStorage.setItem(SURFACES_KEY, 'classic');
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
    const stat = h.querySelector('.brm-winstat, .hc-winstat');
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
    expect(header().querySelector('.brm-winstat, .hc-winstat')).toHaveTextContent('Not open');
  });

  test('Build and History carry it too', async () => {
    classic();
    await openRoom(hostState());
    for (const key of ['3', '4']) {
      fireEvent.keyDown(window, { key });
      expect(within(header()).getByRole('link', { name: "Room's window ↗" })).toHaveAttribute('href', WALL);
    }
  });

  test('the Stage carries it in its dock as ROOM\'S WINDOW, with the window\'s state in its title', async () => {
    classic();
    await openRoom(hostState());
    fireEvent.keyDown(window, { key: '2' });
    const dock = document.querySelector('footer.dock');
    const present = within(dock).getByRole('link', { name: /Open the room's window/ });
    expect(present).toHaveAttribute('href', WALL);
    expect(present).toHaveAttribute('title', "Room's window: not open");
    // Named as the header and help name it, never the retired PRESENT (host review, 25 Oct 2026).
    expect(present.textContent).toBe("ROOM'S WINDOW");
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
  test('one screen, no window: 2, 3, 4 switch this laptop, and the window follows, as today', async () => {
    classic();
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
    // Two screens (B8): this laptop is the console, and stays it.
    expect(document.querySelector('.hc--build')).not.toBeNull();
    expect(onHost()).toBe(true);
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

/*
 * 3, SINCE THE SIMPLIFY PLAN (item 10; owner, 26 Oct 2026): nothing asks
 * "Where will the room watch?" on the Host screen. One screen is the default;
 * Use two screens is a row of Before the room starts, and Settings, Screens
 * changes it later.
 */
describe('3. which screen the room watches', () => {
  const fakeWindow = () => ({ opener: {}, focus: jest.fn(), moveTo: jest.fn(), resizeTo: jest.fn(), location: {} });
  const setup = () => screen.getByRole('region', { name: 'Before the room starts' });

  test('not chosen: no question; the card reads one screen, with Use two screens as a row', async () => {
    window.localStorage.removeItem(SURFACES_KEY);
    await openRoom(hostState({ seen: false }));
    expect(screen.queryByRole('region', { name: 'Where will the room watch?' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Help me pick' })).toBeNull();
    const row = within(setup()).getByText('The room watches this laptop').closest('li');
    expect(row).toHaveClass('is-done');
    expect(within(row).getByRole('button', { name: 'Use two screens' })).toBeInTheDocument();
    // One screen without asking: 3 shows Build on this laptop.
    fireEvent.keyDown(window, { key: '3' });
    expect(onHost()).toBe(false);
  });

  test('before Claude connects, Connect is the card\'s one orange, above the screen row (host review, 25 Oct 2026)', async () => {
    window.localStorage.removeItem(SURFACES_KEY);
    await openRoom(hostState({ seen: false }));
    const connect = within(setup()).getByRole('button', { name: /Connect/ });
    expect(connect).toHaveClass('brm-btn--primary');
    const two = within(setup()).getByRole('button', { name: 'Use two screens' });
    expect(two.className).not.toMatch(/brm-btn--primary/);
    expect(connect.compareDocumentPosition(two) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(document.querySelectorAll('.brm-host .brm-btn--primary')).toHaveLength(1);
  });

  test('Two screens: stored as Call & Answer stores it, and the room\'s window opens in the click, placed', async () => {
    window.localStorage.removeItem(SURFACES_KEY);
    const open = jest.spyOn(window, 'open').mockImplementation(() => fakeWindow());
    try {
      await openRoom(hostState({ seen: false }));
      fireEvent.click(screen.getByRole('button', { name: 'Use two screens' }));
      expect(open).toHaveBeenCalledTimes(1);
      expect(open.mock.calls[0][0]).toBe(`${WALL}&placed=1`);
      expect(open.mock.calls[0][1]).toBe('engage-room');
      expect(window.localStorage.getItem(SURFACES_KEY)).toBe('two');
      // The console now, and the card's row says two screens.
      expect(document.querySelector('.hc--build')).not.toBeNull();
      expect(setup().textContent).toMatch('The room watches its own window');
      expect(screen.queryByRole('button', { name: 'Use two screens' })).toBeNull();
    } finally {
      open.mockRestore();
    }
  });

  test('a blocked popup says where to open it instead', async () => {
    window.localStorage.removeItem(SURFACES_KEY);
    const open = jest.spyOn(window, 'open').mockImplementation(() => null);
    try {
      await openRoom(hostState({ seen: false }));
      fireEvent.click(screen.getByRole('button', { name: 'Use two screens' }));
      expect(screen.getByRole('alert')).toHaveTextContent("The browser blocked the room's window. Open it from Room's window ↗ at the top.");
    } finally {
      open.mockRestore();
    }
  });

  test('a browser that has chosen is not asked either', async () => {
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

  test('a window already up: the row is done and offers no second window', async () => {
    window.localStorage.removeItem(SURFACES_KEY);
    const open = jest.spyOn(window, 'open').mockImplementation(() => fakeWindow());
    try {
      await openRoom(hostState({ presenting: 1, detail: UP, seen: false }));
      const row = within(setup()).getByText('The room watches its own window').closest('li');
      expect(row).toHaveClass('is-done');
      expect(within(row).queryByRole('button')).toBeNull();
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
    classic();
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
