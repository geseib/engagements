/**
 * THE BUILD ROOM'S SESSION PANEL — buildroom/BuildSessionPanel.jsx inside
 * buildroom/BuildRoomPage.jsx (docs/design/build-room-sidebar, S1-S6; plan
 * docs/superpowers/plans/2026-10-09-build-room-session-panel.md, Task 2).
 *
 * Fixtures come from the REAL backend's pure half (build-store.js hostView,
 * build-crew.js crewView), and the roster from the shape GET /players answers
 * with (get-players.js). Pinned: the panel opens by the SESSION button and by
 * the backslash key and closes by Esc, the X and Close; Players runs the
 * routes the other engagements use; the request strip names the person on the
 * Host screen only; Build, History and the Stage carry a count and no name;
 * Space never answers a request; the request strip is never orange; the
 * header's menu is gone and every item in it is in Settings, in four groups
 * with End session last and alone. NO GEOMETRIC ASSERTIONS — jsdom has none.
 */
import React from 'react';
import {
  render, screen, fireEvent, waitFor, within, act,
} from '@testing-library/react';
import { authFetch } from '../auth/authFetch';
import webSocketClient from '../WebSocketClient';
import BuildRoomPage from '../buildroom/BuildRoomPage';

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
const C = require('../../../lambda-functions/game/build-crew');

const API = 'https://api.example.test/dev/';
const GAME = '4821';
const NOW = new Date().toISOString();
const ago = (s) => new Date(Date.now() - s * 1000).toISOString();

const CREW_ON = {
  enabled: true, repoUrl: 'https://github.com/george/foodbank', baseBranch: 'build-room/4821', baseCommit: 'e91b04d', modes: ['fork'], runCrewCode: false,
};

function hostState({ crew = null, st = {}, ideas = [], ended = false } = {}) {
  const rows = [
    { SK: 'BUILD#STATE', Rev: 7, AgentSeenAt: ago(6), Phase: 'building', ...(crew ? { Crew: crew } : {}), ...st },
    ...(crew ? [
      { SK: 'BUILD#BLD#Sam', PlayerName: 'Sam', Mode: 'fork', Status: 'building', TaskId: '001' },
      { SK: 'BUILD#TASK#001', TaskId: '001', Text: 'Parking map', Detail: '', ClaimedBy: ['Sam'], State: 'open' },
    ] : []),
    ...ideas.map((d, i) => ({ SK: `BUILD#IDEA#${String(i).padStart(13, '0')}#i${i}`, IdeaId: `${i}-i${i}`, Status: 'new', CreatedAt: ago(120), ...d })),
  ];
  const room = S.roomFromRows(rows);
  const view = S.hostView({
    gameId: GAME,
    meta: { Title: 'Volunteer sign-up', Details: 'A one-page site to pick a shift in a minute.' },
    sessionState: ended ? 'ENDED' : 'STARTED',
    room,
    players: ['Ana', 'Dee', 'Priya', 'Sam'],
    now: NOW,
  });
  if (crew) view.crew = C.crewView(room, 'host', null);
  return view;
}

const person = (name, over = {}) => ({
  playerId: name, playerName: name, joinedAt: ago(1800), isConnected: true, handover: { open: false, requested: false, requestedAt: null }, ...over,
});
const ROSTER = () => ({
  players: [
    person('Ana'),
    person('Dee'),
    person('Priya', { isConnected: false }),
    person('Sam'),
  ],
  removedPlayers: [{ playerId: 'Kit', playerName: 'Kit', joinedAt: ago(3000), removedAt: ago(100) }],
});
const ASKING = () => {
  const r = ROSTER();
  r.players[1] = person('Dee', { handover: { open: false, requested: true, requestedAt: ago(30) } });
  return r;
};

let current;
let roster;
let calls;
const res = (data, ok = true, status = 200) => ({ ok, status, json: async () => data });

function serve(state, players = ROSTER()) {
  current = state;
  roster = players;
  calls = [];
  authFetch.mockImplementation(async (url, opts = {}) => {
    const method = opts.method || 'GET';
    calls.push({ url, method, body: opts.body ? JSON.parse(opts.body) : undefined });
    if (method === 'GET' && url.endsWith('/build/state')) return res(current);
    if (method === 'GET' && url.endsWith(`/games/${GAME}/players`)) return res(roster);
    if (url.endsWith('/host-ticket')) return res({ ticket: 't' });
    return res({ ok: true, ask: {}, entry: {}, idea: {} });
  });
}
const posts = () => calls.filter((c) => c.method === 'POST' && !c.url.endsWith('/host-ticket'));
const lastPost = () => posts()[posts().length - 1];
const path = (c) => c.url.slice(API.length);
const playerGets = () => calls.filter((c) => c.method === 'GET' && c.url.endsWith(`/games/${GAME}/players`));

async function openRoom(state, players) {
  serve(state, players);
  window.history.pushState({}, '', `/build?gameId=${GAME}`);
  render(<BuildRoomPage />);
  await screen.findByText('Volunteer sign-up');
  await waitFor(() => expect(playerGets().length).toBeGreaterThan(0));
}

const sessionButton = () => screen.getByRole('button', { name: /^SESSION/i });
const panel = () => screen.getByRole('dialog', { name: 'Session' });
const openPanel = () => { fireEvent.click(sessionButton()); return panel(); };
const openSettings = () => {
  const p = openPanel();
  fireEvent.click(within(p).getByRole('tab', { name: /^Settings/ }));
  return p;
};
const rowOf = (name) => within(panel()).getAllByTestId('roster-row').find((r) => within(r).getByTestId('roster-name').textContent === name);
const press = async (el) => { await waitFor(() => expect(el.disabled).toBe(false)); fireEvent.click(el); };
const onMessage = (type) => webSocketClient.onMessage.mock.calls.filter(([t]) => t === type).pop()[1];

beforeEach(() => {
  window.API_BASE = API;
  jest.clearAllMocks();
  window.localStorage.clear();
});

describe('opening and closing', () => {
  test('SESSION replaces the three-dot menu, and every item that was in it is in Settings', async () => {
    await openRoom(hostState());
    expect(screen.queryByRole('button', { name: /^More/ })).toBeNull();
    expect(screen.queryByRole('group', { name: 'Session' })).toBeNull();
    openSettings();
    const p = panel();
    ['Connect Claude Code', 'Open to a crew', 'Wrap up', 'Report', 'End session'].forEach((name) => {
      expect(within(p).getByRole('button', { name: new RegExp(`^${name}`) })).toBeInTheDocument();
    });
    expect(within(p).getByRole('switch', { name: /Auto-open Claude's questions/ })).toBeInTheDocument();
  });

  test('the SESSION button is the last control in the header', async () => {
    await openRoom(hostState());
    const header = document.querySelector('.brm-hbar');
    const controls = header.querySelectorAll('a, button');
    expect(controls[controls.length - 1]).toBe(sessionButton());
  });

  test('the panel opens by the button and the backslash key; Esc, the X and Close put it away', async () => {
    await openRoom(hostState());
    expect(screen.queryByRole('dialog', { name: 'Session' })).toBeNull();
    openPanel();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: 'Session' })).toBeNull();

    fireEvent.keyDown(document, { key: '\\' });
    expect(panel()).toBeInTheDocument();
    fireEvent.keyDown(document, { key: '\\' });
    expect(screen.queryByRole('dialog', { name: 'Session' })).toBeNull();

    openPanel();
    fireEvent.click(within(panel()).getByRole('button', { name: 'Close the session panel' }));
    expect(screen.queryByRole('dialog', { name: 'Session' })).toBeNull();

    openPanel();
    fireEvent.click(within(panel()).getAllByRole('button', { name: /^Close$/ }).pop());
    expect(screen.queryByRole('dialog', { name: 'Session' })).toBeNull();
  });

  test('backslash while typing in a box does not open it', async () => {
    await openRoom(hostState());
    const box = document.querySelector('textarea');
    fireEvent.keyDown(box, { key: '\\' });
    expect(screen.queryByRole('dialog', { name: 'Session' })).toBeNull();
  });

  test('while it is open, Space and the screen keys are held', async () => {
    await openRoom(hostState());
    openPanel();
    fireEvent.keyDown(window, { key: '3' });
    expect(screen.queryByRole('button', { name: /^Build$/ })).toBeTruthy();
    // still on the Host screen behind the panel
    expect(document.querySelector('.brm-host')).not.toBeNull();
    fireEvent.keyDown(document.body, { key: ' ' });
    expect(posts()).toHaveLength(0);
  });

  test('pressing a screen keeps the panel open over the new screen', async () => {
    await openRoom(hostState());
    openPanel();
    fireEvent.click(screen.getByRole('button', { name: /^Build/ }));
    expect(panel()).toBeInTheDocument();
    expect(document.querySelector('.brm-host')).toBeNull();
  });

  test('on the Stage the dock has SESSION as its last button', async () => {
    await openRoom(hostState());
    fireEvent.keyDown(window, { key: '2' });
    const dock = document.querySelector('.dock');
    const buttons = dock.querySelectorAll('button');
    expect(buttons[buttons.length - 1].textContent).toMatch(/SESSION/);
    fireEvent.click(buttons[buttons.length - 1]);
    expect(panel()).toBeInTheDocument();
  });

  test('the joined count is a button into Players', async () => {
    await openRoom(hostState());
    fireEvent.click(screen.getByRole('button', { name: /4 here|4 joined/ }));
    const p = panel();
    expect(within(p).getByRole('tab', { name: /^Players/ })).toHaveAttribute('aria-selected', 'true');
  });
});

describe('Players', () => {
  test('everyone in the room A to Z, with here or away, a builder tag and idea counts; the removed are apart', async () => {
    await openRoom(hostState({ crew: CREW_ON, ideas: [{ PlayerName: 'Ana', Text: 'a' }, { PlayerName: 'Ana', Text: 'b' }, { PlayerName: 'Dee', Text: 'c' }] }), undefined);
    const p = openPanel();
    expect(within(p).getAllByTestId('roster-name').map((n) => n.textContent)).toEqual(['Ana', 'Dee', 'Priya', 'Sam']);
    expect(rowOf('Ana').textContent).toMatch(/Here/);
    expect(rowOf('Ana').textContent).toMatch(/2 ideas/);
    expect(rowOf('Dee').textContent).toMatch(/1 idea(?!s)/);
    expect(rowOf('Priya').textContent).toMatch(/Away/);
    expect(within(rowOf('Sam')).getByText('Builder')).toBeInTheDocument();
    expect(rowOf('Sam').textContent).toMatch(/Parking map/);
    expect(within(p).getByTestId('departed-heading').textContent).toMatch(/1 removed from the room/);
    expect(within(p).getByTestId('departed-name').textContent).toBe('Kit');
  });

  test('Unlock name grants one handover to whoever takes the name next', async () => {
    await openRoom(hostState());
    openPanel();
    fireEvent.click(within(rowOf('Ana')).getByRole('button', { name: 'Unlock name' }));
    await waitFor(() => expect(path(lastPost())).toBe(`games/${GAME}/players/Ana/handover`));
    expect(lastPost().body).toEqual({ bindToRequester: false });
  });

  test('a name somebody asked for reads Let them take it, binds to the asker, and sits on top', async () => {
    await openRoom(hostState(), ASKING());
    openPanel();
    expect(within(panel()).getByTestId('asking-heading')).toBeInTheDocument();
    fireEvent.click(within(within(panel()).getByTestId('asking-list')).getByRole('button', { name: 'Let them take it' }));
    await waitFor(() => expect(path(lastPost())).toBe(`games/${GAME}/players/Dee/handover`));
    expect(lastPost().body).toEqual({ bindToRequester: true });
  });

  test('Not now refuses the ask', async () => {
    await openRoom(hostState(), ASKING());
    openPanel();
    fireEvent.click(within(rowOf('Dee')).getByRole('button', { name: 'Not now' }));
    await waitFor(() => expect(path(lastPost())).toBe(`games/${GAME}/players/Dee/handover`));
    expect(lastPost().body).toEqual({ refuse: true });
  });

  test('an unlocked name offers Lock again', async () => {
    const r = ROSTER();
    r.players[0] = person('Ana', { handover: { open: true, requested: false } });
    await openRoom(hostState(), r);
    openPanel();
    expect(within(rowOf('Ana')).getByTestId('handover-flag').textContent).toMatch(/Unlocked/);
    fireEvent.click(within(rowOf('Ana')).getByRole('button', { name: 'Lock again' }));
    await waitFor(() => expect(path(lastPost())).toBe(`games/${GAME}/players/Ana/handover`));
    expect(lastPost().body).toEqual({ lock: true });
  });

  test('Remove takes a person out of the counts; Bring back puts them in', async () => {
    await openRoom(hostState());
    openPanel();
    fireEvent.click(within(rowOf('Dee')).getByRole('button', { name: 'Remove' }));
    await waitFor(() => expect(path(lastPost())).toBe(`games/${GAME}/players/Dee/remove`));
    expect(lastPost().body).toEqual({ removed: true });
    fireEvent.click(within(panel()).getByRole('button', { name: 'Bring back' }));
    await waitFor(() => expect(path(lastPost())).toBe(`games/${GAME}/players/Kit/remove`));
    expect(lastPost().body).toEqual({ removed: false });
  });

  test('a builder\'s Remove calls the builder route, which also takes them off the crew', async () => {
    await openRoom(hostState({ crew: CREW_ON }));
    openPanel();
    fireEvent.click(within(rowOf('Sam')).getByRole('button', { name: 'Remove' }));
    await waitFor(() => expect(path(lastPost())).toBe(`games/${GAME}/build/crew/builders/Sam/remove`));
    expect(posts().some((c) => c.url.endsWith('/players/Sam/remove'))).toBe(false);
  });

  test('every action refetches the roster, so the row reflects the server', async () => {
    await openRoom(hostState());
    openPanel();
    const before = playerGets().length;
    fireEvent.click(within(rowOf('Ana')).getByRole('button', { name: 'Unlock name' }));
    await waitFor(() => expect(playerGets().length).toBeGreaterThan(before));
  });
});

describe('the websocket tells the host', () => {
  test('handoverRequested, playerRemoved and playerRestored refetch the roster', async () => {
    await openRoom(hostState());
    for (const type of ['handoverRequested', 'playerRemoved', 'playerRestored', 'playersChanged']) {
      const before = playerGets().length;
      await act(async () => { onMessage(type)({}); });
      await waitFor(() => expect(playerGets().length).toBeGreaterThan(before));
    }
  });

  test('the listeners are put away when the page goes', async () => {
    const { unmount } = (serve(hostState()), render(<BuildRoomPage />));
    unmount();
    ['handoverRequested', 'playerRemoved', 'playerRestored', 'playersChanged'].forEach((t) => {
      expect(webSocketClient.offMessage).toHaveBeenCalledWith(t);
    });
  });
});

describe('a second host device', () => {
  test('a strip raised here clears when the other device answers (playersChanged)', async () => {
    await openRoom(hostState());
    roster = ASKING();
    await act(async () => { onMessage('handoverRequested')({}); });
    await screen.findByRole('region', { name: 'Someone is asking to take a name' });
    roster = ROSTER();
    await act(async () => { onMessage('playersChanged')({}); });
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Someone is asking to take a name' })).toBeNull());
    expect(sessionButton().textContent).not.toMatch(/\d/);
  });

  test('the roster is also re-read on the room\'s 8s poll', async () => {
    jest.useFakeTimers();
    try {
      serve(hostState());
      window.history.pushState({}, '', `/build?gameId=${GAME}`);
      render(<BuildRoomPage />);
      await act(async () => { await Promise.resolve(); });
      await screen.findByText('Volunteer sign-up');
      const before = playerGets().length;
      await act(async () => { jest.advanceTimersByTime(8000); });
      expect(playerGets().length).toBeGreaterThan(before);
    } finally {
      jest.useRealTimers();
    }
  });
});

describe('the panel\'s controls', () => {
  test('the Stage dock\'s SESSION opens and closes it, and says which', async () => {
    await openRoom(hostState());
    fireEvent.keyDown(window, { key: '2' });
    const dockButton = () => within(document.querySelector('.dock')).getByRole('button', { name: /SESSION/ });
    expect(dockButton()).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(dockButton());
    expect(panel()).toBeInTheDocument();
    expect(dockButton()).toHaveAttribute('aria-expanded', 'true');
    fireEvent.click(dockButton());
    expect(screen.queryByRole('dialog', { name: 'Session' })).toBeNull();
  });

  test('arrow keys move between the tabs; only the selected tab points at a mounted pane', async () => {
    await openRoom(hostState());
    const p = openPanel();
    const players = within(p).getByRole('tab', { name: /^Players/ });
    const settings = within(p).getByRole('tab', { name: /^Settings/ });
    expect(players).toHaveAttribute('aria-controls', 'brm-sp-pane-players');
    expect(settings).not.toHaveAttribute('aria-controls');
    expect(document.getElementById('brm-sp-pane-players')).not.toBeNull();
    fireEvent.keyDown(players, { key: 'ArrowRight' });
    expect(settings).toHaveAttribute('aria-selected', 'true');
    expect(settings).toHaveAttribute('aria-controls', 'brm-sp-pane-settings');
    expect(players).not.toHaveAttribute('aria-controls');
    expect(document.activeElement).toBe(settings);
    fireEvent.keyDown(settings, { key: 'ArrowLeft' });
    expect(players).toHaveAttribute('aria-selected', 'true');
    fireEvent.keyDown(players, { key: 'End' });
    expect(settings).toHaveAttribute('aria-selected', 'true');
    fireEvent.keyDown(settings, { key: 'Home' });
    expect(players).toHaveAttribute('aria-selected', 'true');
  });

  test('on the Stage the top line carries the Wi-Fi and connection chips, which the Stage has no header for', async () => {
    await openRoom(hostState());
    fireEvent.keyDown(window, { key: '2' });
    fireEvent.click(within(document.querySelector('.dock')).getByRole('button', { name: /SESSION/ }));
    const top = within(panel()).getByTestId('brm-sp-top');
    expect(top.querySelector('.brm-wifi')).not.toBeNull();
    expect(within(top).getByTestId('brm-conn')).toBeInTheDocument();
  });
});

describe('someone asks to take a name (S6)', () => {
  const ask = async (state = hostState()) => {
    await openRoom(state);
    roster = ASKING();
    await act(async () => { onMessage('handoverRequested')({}); });
    await screen.findByRole('region', { name: 'Someone is asking to take a name' });
  };

  test('the Host screen gets a strip that names the person and the three answers', async () => {
    await ask();
    const strip = screen.getByRole('region', { name: 'Someone is asking to take a name' });
    expect(strip.textContent).toMatch(/Another device wants the name/);
    expect(within(strip).getByText('Dee')).toBeInTheDocument();
    expect(within(strip).getByRole('button', { name: 'See in Players' })).toBeInTheDocument();
    expect(within(strip).getByRole('button', { name: 'Not now' })).toBeInTheDocument();
    expect(within(strip).getByRole('button', { name: 'Let them take it' })).toBeInTheDocument();
  });

  test('Let them take it grants one handover to the device that asked, and the strip goes', async () => {
    await ask();
    fireEvent.click(within(screen.getByRole('region', { name: 'Someone is asking to take a name' })).getByRole('button', { name: 'Let them take it' }));
    await waitFor(() => expect(path(lastPost())).toBe(`games/${GAME}/players/Dee/handover`));
    expect(lastPost().body).toEqual({ bindToRequester: true });
    roster = ROSTER();
    await act(async () => { onMessage('handoverRequested')({}); });
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Someone is asking to take a name' })).toBeNull());
  });

  test('Not now refuses it', async () => {
    await ask();
    fireEvent.click(within(screen.getByRole('region', { name: 'Someone is asking to take a name' })).getByRole('button', { name: 'Not now' }));
    await waitFor(() => expect(path(lastPost())).toBe(`games/${GAME}/players/Dee/handover`));
    expect(lastPost().body).toEqual({ refuse: true });
  });

  test('See in Players opens the panel on Players with the ask on top', async () => {
    await ask();
    fireEvent.click(within(screen.getByRole('region', { name: 'Someone is asking to take a name' })).getByRole('button', { name: 'See in Players' }));
    expect(within(panel()).getByTestId('asking-heading')).toBeInTheDocument();
  });

  test('Space does not answer it', async () => {
    await ask();
    fireEvent.keyDown(window, { key: ' ' });
    fireEvent.keyDown(document.body, { key: ' ' });
    expect(posts().filter((c) => /handover/.test(c.url))).toHaveLength(0);
  });

  test('the strip is never orange, and the screen keeps exactly the primary it had', async () => {
    await openRoom(hostState());
    const had = document.querySelectorAll('.brm-host .brm-btn--primary').length;
    roster = ASKING();
    await act(async () => { onMessage('handoverRequested')({}); });
    const strip = await screen.findByRole('region', { name: 'Someone is asking to take a name' });
    expect(strip.querySelectorAll('.brm-btn--primary')).toHaveLength(0);
    expect(document.querySelectorAll('.brm-host .brm-btn--primary')).toHaveLength(had);
    expect(had).toBe(1);
  });

  test('two asks at once: the strip counts them and offers See in Players only', async () => {
    await openRoom(hostState());
    const r = ASKING();
    r.players[0] = person('Ana', { handover: { open: false, requested: true, requestedAt: ago(10) } });
    roster = r;
    await act(async () => { onMessage('handoverRequested')({}); });
    const strip = await screen.findByRole('region', { name: 'Someone is asking to take a name' });
    expect(strip.textContent).toMatch(/2 people are asking to take a name/);
    expect(within(strip).queryByRole('button', { name: 'Let them take it' })).toBeNull();
    expect(within(strip).getByRole('button', { name: 'See in Players' })).toBeInTheDocument();
  });

  test('the count lights SESSION on every screen', async () => {
    await ask();
    expect(sessionButton().textContent).toMatch(/1/);
    fireEvent.keyDown(window, { key: '3' });
    expect(sessionButton().textContent).toMatch(/1/);
  });

  test('Build and History show a pill and a count and no name; so does the Stage', async () => {
    await ask();
    for (const key of ['3', '4']) {
      fireEvent.keyDown(window, { key });
      expect(screen.queryByRole('region', { name: 'Someone is asking to take a name' })).toBeNull();
      const pill = screen.getByRole('button', { name: '1 asking to take a name' });
      expect(document.body.textContent).not.toMatch(/Dee/);
      fireEvent.click(pill);
      expect(within(panel()).getByTestId('asking-heading')).toBeInTheDocument();
      fireEvent.keyDown(document, { key: 'Escape' });
    }
    fireEvent.keyDown(window, { key: '2' });
    expect(within(document.querySelector('.dock')).getByRole('button', { name: /SESSION/ }).textContent).toMatch(/1/);
    expect(document.body.textContent).not.toMatch(/\bDee\b/);
  });
});

describe('Settings, in four groups', () => {
  test('The room, Claude, Crew, This session, in that order; End session last and alone', async () => {
    await openRoom(hostState({ crew: CREW_ON }));
    openSettings();
    const heads = within(panel()).getAllByRole('heading', { level: 3 }).map((h) => h.textContent);
    expect(heads).toEqual(['The room', 'Claude', 'Crew', 'This session']);
    const buttons = within(panel()).getAllByRole('button').map((b) => b.textContent.trim());
    expect(buttons[buttons.indexOf('End session') + 1]).toMatch(/Close/);
    const end = within(panel()).getByRole('button', { name: 'End session' });
    expect(end.closest('.brm-sp-end')).not.toBeNull();
    expect(end.closest('.brm-sp-end').querySelectorAll('button')).toHaveLength(1);
  });

  test('The room: join code and link, the QR, Share demo, and names on the room meter', async () => {
    await openRoom(hostState());
    openSettings();
    const p = panel();
    expect(within(p).getByText(GAME)).toBeInTheDocument();
    expect(within(p).getByRole('button', { name: 'Copy join link' })).toBeInTheDocument();
    expect(within(p).getByRole('button', { name: 'Show the QR on the wall' })).toBeInTheDocument();
    // Share demo stays reachable here after Not now (D3).
    expect(within(p).getByLabelText('Share demo')).toBeInTheDocument();
    expect(within(p).getByRole('switch', { name: 'List names on the room meter' })).toHaveAttribute('aria-checked', 'false');
  });

  test('the Share demo chip opens its own panel, hanging from the chip (D2, 2026-10-10), not the Session panel', async () => {
    await openRoom(hostState());
    fireEvent.click(screen.getByTestId('brm-wifi'));
    const d = screen.getByRole('dialog', { name: 'Share demo' });
    expect(d.closest('.brm-wifiwrap')).not.toBeNull();
    expect(screen.queryByRole('dialog', { name: 'Session' })).toBeNull();
  });

  test('Claude: Connect Claude Code opens its dialog and puts the panel away', async () => {
    await openRoom(hostState());
    openSettings();
    fireEvent.click(within(panel()).getByRole('button', { name: /^Connect Claude Code/ }));
    expect(screen.getByRole('dialog', { name: 'Connect Claude Code' })).toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: 'Session' })).toBeNull();
  });

  test('no crew: one line and Open to a crew; a crew: Crew and the Run crew code switch', async () => {
    await openRoom(hostState());
    openSettings();
    expect(panel().textContent).toMatch(/Up to 8 builders, each with their own Claude\./);
    expect(within(panel()).queryByRole('switch', { name: /Run crew code/ })).toBeNull();
    fireEvent.click(within(panel()).getByRole('button', { name: 'Open to a crew' }));
    expect(screen.getByRole('dialog', { name: 'Open to a crew' })).toBeInTheDocument();
  });

  test('a crew: builders named, Crew button, Run crew code switch', async () => {
    await openRoom(hostState({ crew: CREW_ON }));
    openSettings();
    expect(within(panel()).getByRole('switch', { name: /Run crew code: Off/ })).toBeInTheDocument();
    expect(within(panel()).getByRole('button', { name: 'Crew' })).toBeInTheDocument();
    expect(panel().textContent).toMatch(/Sam/);
  });

  test('This session: Back to the opening only while building; End session keeps its confirm', async () => {
    await openRoom(hostState());
    openSettings();
    fireEvent.click(within(panel()).getByRole('button', { name: 'Back to the opening' }));
    await waitFor(() => expect(path(lastPost())).toBe(`games/${GAME}/build/opening/resume`));
  });

  test('End session confirms before it posts', async () => {
    await openRoom(hostState());
    openSettings();
    fireEvent.click(within(panel()).getByRole('button', { name: 'End session' }));
    const dialog = screen.getByRole('dialog', { name: 'End this session?' });
    expect(posts()).toHaveLength(0);
    fireEvent.click(within(dialog).getByRole('button', { name: 'End session' }));
    await waitFor(() => expect(path(lastPost())).toBe(`games/${GAME}/end`));
  });

  test('an ended session offers no End session, no Connect and no Open to a crew', async () => {
    await openRoom(hostState({ ended: true }));
    openSettings();
    const p = panel();
    expect(within(p).queryByRole('button', { name: 'End session' })).toBeNull();
    expect(within(p).queryByRole('button', { name: /^Connect Claude Code/ })).toBeNull();
    expect(within(p).getByRole('button', { name: 'Report' })).toBeInTheDocument();
  });

  test('the keys are one line at the foot', async () => {
    await openRoom(hostState());
    openSettings();
    expect(panel().textContent).toMatch(/screens/);
    expect(panel().textContent).toMatch(/Esc/);
  });
});

describe('List names on the room meter', () => {
  const meter = () => screen.queryByRole('button', { name: /^Already joined/ });

  test('off by default: the Stage meter is a plain count and names nobody', async () => {
    await openRoom(hostState());
    fireEvent.keyDown(window, { key: '2' });
    expect(meter()).toBeNull();
    expect(document.querySelector('[data-list-kind="joined"]')).toBeNull();
  });

  test('on in the room: the Stage meter lists who has joined, as it did before', async () => {
    await openRoom(hostState({ st: { Settings: { listNames: true } } }));
    fireEvent.keyDown(window, { key: '2' });
    expect(meter()).toBeInTheDocument();
    fireEvent.mouseEnter(meter());
    expect(screen.getByText('Ana')).toBeInTheDocument();
  });

  test('the switch saves a room setting on the server, through the settings route, and nothing in the browser', async () => {
    await openRoom(hostState());
    openSettings();
    const sw = within(panel()).getByRole('switch', { name: 'List names on the room meter' });
    expect(sw).toHaveAttribute('aria-checked', 'false');
    fireEvent.click(sw);
    await waitFor(() => expect(path(lastPost())).toBe(`games/${GAME}/build/settings`));
    expect(lastPost().body).toEqual({ listNames: true });
    expect(window.localStorage.length).toBe(0);
  });

  test('another host device sees the same switch state', async () => {
    await openRoom(hostState({ st: { Settings: { listNames: true } } }));
    openSettings();
    expect(within(panel()).getByRole('switch', { name: 'List names on the room meter' })).toHaveAttribute('aria-checked', 'true');
  });
});

describe('a narrow header (480px and under)', () => {
  afterEach(() => { delete window.matchMedia; });
  test('the extras go to the panel\'s top line, not a menu', async () => {
    window.matchMedia = (q) => ({ matches: /max-width: 480px/.test(q), media: q, addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {} });
    await openRoom(hostState());
    const header = document.querySelector('.brm-hbar');
    expect(within(header).queryByRole('button', { name: `Join code ${GAME}. Show the QR code` })).toBeNull();
    openPanel();
    const top = within(panel()).getByTestId('brm-sp-top');
    expect(within(top).getByRole('button', { name: `Join code ${GAME}. Show the QR code` })).toBeInTheDocument();
  });
});

describe('the request strip advice sits on the buttons it explains', () => {
  test('Let them take it and Not now carry their own titles', async () => {
    const ROS = () => { const r = ROSTER(); r.players[1] = person('Dee', { handover: { open: false, requested: true, requestedAt: ago(30) } }); return r; };
    await openRoom(hostState(), ROS());
    const strip = screen.getByRole('region', { name: 'Someone is asking to take a name' });
    expect(within(strip).getByRole('button', { name: 'Let them take it' })).toHaveAttribute('title', 'The name keeps its ideas and votes.');
    expect(within(strip).getByRole('button', { name: 'Not now' })).toHaveAttribute('title', 'Dee stays as they are.');
  });
});

describe('the plugin update notice (owner, 2026-10-10): the Host screen only', () => {
  const OLD = { AgentPlugin: '1.14.0' };
  const CURRENT = { AgentPlugin: S.LATEST_PLUGIN };

  test('out of date: Session > Claude says so with Update, and SESSION carries a dot', async () => {
    await openRoom(hostState({ st: OLD }));
    expect(screen.getByTestId('brm-plugin-dot')).toBeInTheDocument();
    expect(within(sessionButton()).getByText("Claude's plugin is out of date")).toBeInTheDocument();
    openSettings();
    const line = within(panel()).getByTestId('brm-plugin-out');
    expect(line.textContent).toMatch(/^Claude's plugin is out of date\.\s*Update$/);
    expect(within(line).getByRole('button', { name: 'Update' })).toBeInTheDocument();
  });

  test('Update opens Connect Claude Code at the install step and puts the panel away', async () => {
    await openRoom(hostState({ st: OLD }));
    openSettings();
    fireEvent.click(within(within(panel()).getByTestId('brm-plugin-out')).getByRole('button', { name: 'Update' }));
    const dialog = screen.getByRole('dialog', { name: 'Connect Claude Code' });
    expect(screen.queryByRole('dialog', { name: 'Session' })).toBeNull();
    const step = dialog.querySelector('[data-step="install"]');
    expect(step).not.toBeNull();
    expect(step.contains(document.activeElement)).toBe(true);
    expect(within(step).getByTestId('brm-install')).toBeInTheDocument();
  });

  test('a Claude that never said its version (older than the header) counts as out of date', async () => {
    await openRoom(hostState());
    openSettings();
    expect(within(panel()).getByTestId('brm-plugin-out')).toBeInTheDocument();
  });

  test('current: no line and no dot', async () => {
    await openRoom(hostState({ st: CURRENT }));
    expect(screen.queryByTestId('brm-plugin-dot')).toBeNull();
    openSettings();
    expect(within(panel()).queryByTestId('brm-plugin-out')).toBeNull();
    expect(panel().textContent).not.toMatch(/out of date/);
  });

  test('never on the Stage, nor on Build or History, which the room sees', async () => {
    await openRoom(hostState({ st: OLD }));
    expect(screen.getByTestId('brm-plugin-dot')).toBeInTheDocument();
    for (const key of ['2', '3', '4']) {
      fireEvent.keyDown(window, { key });
      expect(screen.queryByTestId('brm-plugin-dot')).toBeNull();
      expect(document.body.textContent).not.toMatch(/plugin is out of date/i);
    }
    fireEvent.keyDown(window, { key: '1' });
    expect(screen.getByTestId('brm-plugin-dot')).toBeInTheDocument();
  });

  test('a finished session says nothing about the plugin', async () => {
    await openRoom(hostState({ st: OLD, ended: true }));
    expect(screen.queryByTestId('brm-plugin-dot')).toBeNull();
  });
});
