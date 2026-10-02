/**
 * A BUILD ROOM THROUGH THE PLAYER PAGE — PlayerPage → BuildPlayer.
 *
 * 'build' is deliberately not in config/gameTypes.js, so normalizing it would
 * say call-and-answer. PlayerPage must read the RAW type off /state and hand a
 * joined phone to BuildPlayer — never to the call-and-answer lobby — and turn
 * every `buildChanged` frame into a refetch.
 *
 * rejects: a build session drawn as the C&A lobby; BuildPlayer called without
 * the clientId the join minted; a `buildChanged` frame that changes nothing; a
 * handler left registered after the page goes.
 */
import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import PlayerPage from '../PlayerPage';

jest.mock('../WebSocketClient', () => ({
  __esModule: true,
  default: {
    connect: jest.fn(),
    disconnect: jest.fn(),
    ensureConnected: jest.fn(),
    sendCleanMessage: jest.fn(() => true),
    onConnectionStatusChange: jest.fn(),
    onReconnected: jest.fn(),
    onMessage: jest.fn(),
    offMessage: jest.fn(),
  },
}));
const ws = require('../WebSocketClient').default;

const GAME = '4821';
const ME = 'Ana';

const PUBLIC_STATE = {
  gameId: GAME,
  title: 'Food bank sign-up',
  goal: 'A one-page site for volunteer shifts.',
  state: 'STARTED',
  playerCount: 1,
  currentAskId: null,
  current: null,
  decisions: [],
  log: [],
  myIdeas: [],
  outcome: null,
  agentConnected: true,
  mine: { responses: [], vote: [], answer: null },
  rev: 1,
};

function installServer() {
  global.fetch.mockImplementation((url, options) => {
    const u = String(url);
    const method = (options && options.method) || 'GET';
    let body = {};
    if (u.includes('/build-play/state')) body = PUBLIC_STATE;
    else if (method === 'POST' && u.includes(`games/${GAME}/players`)) body = { success: true, playerName: ME };
    else if (u.includes(`games/${GAME}/state`)) body = { state: 'STARTED', gameType: 'build' };
    else if (u.includes(`games/${GAME}/players`)) body = { players: [{ name: ME, playerName: ME, score: 0 }] };
    else if (u.includes(`games/${GAME}`)) body = { engagementInfo: '' };
    return Promise.resolve({ ok: true, status: 200, json: async () => body });
  });
}

const buildGets = () => global.fetch.mock.calls.map(([u]) => String(u)).filter((u) => u.includes('/build-play/state'));

async function join() {
  const utils = render(<PlayerPage />);
  fireEvent.change(screen.getByPlaceholderText(/Game ID/i), { target: { value: GAME } });
  fireEvent.change(screen.getByPlaceholderText(/Your Name/i), { target: { value: ME } });
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Join Game/i })); });
  return utils;
}

beforeEach(() => {
  global.fetch.mockReset();
  ws.onMessage.mockClear();
  ws.offMessage.mockClear();
  localStorage.clear();
  window.history.pushState({}, '', '/play');
});

test('a joined phone in a build session lands in BuildPlayer, not the lobby', async () => {
  installServer();
  const { container } = await join();
  await waitFor(() => expect(screen.getByText('Claude is building')).toBeInTheDocument());
  expect(container.querySelector('.bpl')).not.toBeNull();
  expect(screen.getByText('Claude Code is connected')).toBeInTheDocument();
  expect(screen.queryByText(/Waiting for the game to start/i)).toBeNull();

  // Identity is the one the join sent.
  const joinCall = global.fetch.mock.calls.find(([u, o]) => String(u).endsWith(`games/${GAME}/players`) && o && o.method === 'POST');
  const { clientId } = JSON.parse(joinCall[1].body);
  expect(clientId).toBeTruthy();
  expect(buildGets()[0]).toContain(`playerName=${ME}&clientId=${encodeURIComponent(clientId)}`);
});

test('a buildChanged frame refetches the room, and the handler goes with the page', async () => {
  installServer();
  const { unmount } = await join();
  await waitFor(() => expect(screen.getByText('Claude is building')).toBeInTheDocument());

  const reg = ws.onMessage.mock.calls.filter(([type]) => type === 'buildChanged');
  expect(reg.length).toBeGreaterThan(0);
  const handler = reg[reg.length - 1][1];
  const before = buildGets().length;
  await act(async () => { handler({ gameId: GAME, rev: 2 }); });
  await waitFor(() => expect(buildGets().length).toBe(before + 1));

  unmount();
  expect(ws.offMessage).toHaveBeenCalledWith('buildChanged');
});
